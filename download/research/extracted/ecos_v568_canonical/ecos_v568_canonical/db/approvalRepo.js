/**
 * ECOS Approval Repo
 * ------------------
 * Persistent HITL state machine. Mirrors src/lib/hitlGate.js semantics
 * exactly but stores rows in Postgres.
 *
 * State transitions:
 *   pending --approve--> approved   (40/40/20 distribution executes)
 *   pending --modify --> modified   (40/40/20 distribution executes,
 *                                    final_output is the modified payload)
 *   pending --reject --> rejected   (no money moves; resolution recorded)
 *
 * The one-shot guarantee is enforced via:
 *     UPDATE approvals
 *     SET status = $X, ...
 *     WHERE id = $id AND status = 'pending'
 *     RETURNING ...;
 * If `rowCount === 0` after that statement, somebody else already
 * resolved the row -> we throw a 409 with code 'ALREADY_RESOLVED'.
 *
 * Each create/resolve writes an audit entry. The audit hash is recorded
 * on the approval row (audit_create_hash / audit_resolve_hash) so a
 * single SELECT yields the full crypto provenance.
 */

'use strict';

const { withTx, getPool } = require('./pool');
const { nanoid }          = require('../vendor/nanoid');
const { STATUS, DECISION } = require('../lib/hitlGate');

const { batchAppendLedgerEntries } = require('./ledgerRepo');
const { appendAudit, appendAuditOnClient } = require('./auditRepo');
const { sha256Hex, canonicalize } = require('../lib/auditLog');
const {
  usdToMicrocents, microcentsToUsdString,
} = require('../lib/fiatLedger');

function _digestOf(obj) {
  if (obj === undefined || obj === null) return null;
  try { return sha256Hex(canonicalize(obj)); }
  catch { return sha256Hex(String(obj)); }
}

async function ensureMission({
  id, clientAccountId, title, description = null, metadata = {},
}) {
  if (!id)              throw new TypeError('ensureMission: id required');
  if (!clientAccountId) throw new TypeError('ensureMission: clientAccountId required');
  if (!title)           throw new TypeError('ensureMission: title required');
  return withTx(async (client) => {
    // Ensure the client account exists so the FK won't blow up later.
    await client.query(
      `INSERT INTO accounts (id, kind) VALUES ($1, 'client')
       ON CONFLICT (id) DO NOTHING`,
      [clientAccountId]
    );
    const res = await client.query(
      `INSERT INTO missions (id, client_account_id, title, description, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (id) DO UPDATE SET updated_at = now()
       RETURNING id, client_account_id, title, description, status, metadata, created_at`,
      [id, clientAccountId, title, description, JSON.stringify(metadata)]
    );
    return res.rows[0];
  });
}

async function getMission(missionId) {
  const { rows } = await getPool().query(
    `SELECT id, client_account_id, title, description, status, metadata, created_at, updated_at
     FROM missions WHERE id = $1`,
    [missionId]
  );
  return rows[0] || null;
}

async function createApproval(input) {
  const {
    missionId,
    clientAccountId,
    priceUsd,
    aiOutput,
    context = {},
    confidence = null,
  } = input || {};

  if (!missionId)        throw new TypeError('createApproval: missionId required');
  if (!clientAccountId)  throw new TypeError('createApproval: clientAccountId required');
  if (priceUsd === undefined || priceUsd === null) {
    throw new TypeError('createApproval: priceUsd required');
  }
  if (aiOutput === undefined) {
    throw new TypeError('createApproval: aiOutput required');
  }

  const priceStr   = String(priceUsd);
  const priceMicro = usdToMicrocents(priceStr);
  if (priceMicro <= 0n) throw new RangeError('createApproval: priceUsd must be > 0');

  const approvalId = 'apv_' + nanoid(16);

  // 1) Write the audit entry FIRST so the create_hash is known before the
  //    INSERT. We MUST do this inside its own transaction because the
  //    audit log uses an advisory lock that should not span unrelated
  //    work. The two-phase write is acceptable here: if the INSERT below
  //    fails, we leave a dangling audit row, but the audit log is by
  //    design a write-once forensic trail -- dangling entries are
  //    expected and well-handled by verifyAudit (the chain remains
  //    intact, and the orphan entry simply has no FK referent).
  const auditEntry = await appendAudit('APPROVAL_CREATED', {
    approvalId,
    missionId,
    clientAccountId,
    priceUsd: priceStr,
    confidence,
    aiOutputDigest: _digestOf(aiOutput),
  });

  return withTx(async (client) => {
    // Ensure mission row exists (we don't auto-create -- callers should
    // call ensureMission first, but we tolerate the missing row by
    // bouncing a clear error).
    const mres = await client.query(
      'SELECT id FROM missions WHERE id = $1 FOR UPDATE',
      [missionId]
    );
    if (!mres.rowCount) {
      const err = new Error(`createApproval: mission not found: ${missionId}`);
      err.code = 'NO_MISSION';
      throw err;
    }

    const ins = await client.query(
      `INSERT INTO approvals
         (id, mission_id, client_account_id, price_usd, price_micro,
          confidence, ai_output, context, audit_create_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
       RETURNING id, mission_id, client_account_id, status, price_usd,
                 price_micro, confidence, ai_output, context, created_at,
                 audit_create_hash`,
      [
        approvalId, missionId, clientAccountId,
        priceStr, priceMicro.toString(),
        confidence,
        JSON.stringify(aiOutput),
        JSON.stringify(context),
        auditEntry.hash,
      ]
    );

    const row = ins.rows[0];
    return _shapeApproval(row, { audit: auditEntry });
  });
}

async function getApproval(approvalId) {
  const { rows } = await getPool().query(
    `SELECT id, mission_id, client_account_id, validator_account_id, status,
            decision, price_usd, price_micro, confidence, ai_output, final_output,
            context, note, settlement_tx_id,
            audit_create_hash, audit_resolve_hash,
            created_at, resolved_at, updated_at
     FROM approvals WHERE id = $1`,
    [approvalId]
  );
  if (!rows.length) return null;
  return _shapeApproval(rows[0]);
}

async function listApprovalsForMission(missionId, { status } = {}) {
  const params = [missionId];
  let where = 'mission_id = $1';
  if (status) {
    params.push(status);
    where += ` AND status = $${params.length}`;
  }
  const { rows } = await getPool().query(
    `SELECT id, mission_id, client_account_id, validator_account_id, status,
            decision, price_usd, price_micro, confidence, ai_output, final_output,
            context, note, settlement_tx_id,
            audit_create_hash, audit_resolve_hash,
            created_at, resolved_at, updated_at
     FROM approvals WHERE ${where} ORDER BY created_at DESC`,
    params
  );
  return rows.map((r) => _shapeApproval(r));
}

/**
 * Resolve a pending approval. ONE-SHOT: the UPDATE WHERE status='pending'
 * makes double-resolve attempts fail with code 'ALREADY_RESOLVED'.
 *
 * Order of operations for a billable decision (approve|modify):
 *   1. Open a transaction.
 *   2. SELECT the approval FOR UPDATE -- guards against concurrent resolves.
 *   3. Run the 40/40/20 distribution inside the SAME transaction (we pass
 *      `client` so ledgerRepo uses the same connection).
 *      ^^ NOTE: distributeTaskPayment internally opens its OWN withTx --
 *      that nests as a savepoint via Postgres? No. To keep this honest,
 *      we INLINE the distribution here when we already have a client,
 *      using ledgerRepo's exported building blocks. See the call to
 *      _distributeInline below.
 *   4. UPDATE the approval row, asserting it is still pending.
 *   5. Append the resolve audit entry AFTER commit so we don't hold the
 *      advisory lock across the long-lived approval update.
 */
async function resolveApproval(approvalId, resolution) {
  const { validatorAccountId, decision, finalOutput, note } = resolution || {};
  if (!validatorAccountId) {
    throw new TypeError('resolveApproval: validatorAccountId required');
  }
  if (!Object.values(DECISION).includes(decision)) {
    throw new TypeError(
      `resolveApproval: decision must be one of ${Object.values(DECISION).join(', ')}`
    );
  }
  if (decision === DECISION.MODIFY && finalOutput === undefined) {
    throw new TypeError('resolveApproval: finalOutput required when decision is "modify"');
  }

  // --- Phase 1: load + lock + (maybe) split-pay + flip status. -----------
  const phase1 = await withTx(async (client) => {
    const lockRes = await client.query(
      `SELECT id, mission_id, client_account_id, status, price_usd, price_micro,
              ai_output
       FROM approvals WHERE id = $1 FOR UPDATE`,
      [approvalId]
    );
    if (!lockRes.rowCount) {
      const err = new Error(`resolveApproval: approval not found: ${approvalId}`);
      err.code = 'NOT_FOUND';
      throw err;
    }
    const a = lockRes.rows[0];
    if (a.status !== STATUS.PENDING) {
      const err = new Error(`resolveApproval: approval already ${a.status}`);
      err.code = 'ALREADY_RESOLVED';
      throw err;
    }

    // Ensure the resolver (validator) account exists before updating approvals
    await client.query(
      `INSERT INTO accounts (id, kind)
       VALUES ($1, 'validator')
       ON CONFLICT (id) DO NOTHING`,
      [validatorAccountId]
    );

    let settlementTxId = null;
    let split = null;
    let delta = null;
    let deltaAuditEntry = null;

    if (decision === DECISION.APPROVE || decision === DECISION.MODIFY) {
      // Run the 40/40/20 distribution on THIS connection (in-transaction).
      const r = await _distributeInline(client, {
        clientAccountId:    a.client_account_id,
        validatorAccountId,
        grossMicro:         BigInt(a.price_micro),
        refType:            'approval',
        refId:              a.id,
        meta:               { missionId: a.mission_id, decision },
      });
      settlementTxId = r.txId;
      split = {
        gross:     r.gross,
        platform:  r.platform,
        validator: r.validator,
        insurance: r.insurance,
      };
      delta = r.delta;
      deltaAuditEntry = await appendAuditOnClient(client, 'DELTA_COMMIT', {
        deltaId:       delta.deltaId,
        domain:        'ECOS_B2B_BILLING',
        txId:          settlementTxId,
        approvalId,
        preStateRoot:  delta.preStateRoot,
        postStateRoot: delta.postStateRoot,
        traceHash:     delta.traceHash,
        prevTraceHash: delta.payload.prevTraceHash,
        mutations:     delta.payload.mutations,
        gross:         split.gross.toString(),
        platform:      split.platform.toString(),
        validator:     split.validator.toString(),
        insurance:     split.insurance.toString(),
      });
    }

    const newStatus =
      decision === DECISION.APPROVE  ? STATUS.APPROVED  :
      decision === DECISION.MODIFY   ? STATUS.MODIFIED  :
                                        STATUS.REJECTED;

    const finalOut =
      decision === DECISION.APPROVE ? a.ai_output :
      decision === DECISION.MODIFY  ? finalOutput :
                                       null;

    const upd = await client.query(
      `UPDATE approvals
       SET status = $2,
           decision = $3,
           validator_account_id = $4,
           final_output = $5::jsonb,
           note = $6,
           settlement_tx_id = $7,
           resolved_at = now(),
           updated_at  = now()
       WHERE id = $1 AND status = 'pending'
       RETURNING id, mission_id, client_account_id, validator_account_id,
                 status, decision, price_usd, price_micro, confidence,
                 ai_output, final_output, context, note, settlement_tx_id,
                 audit_create_hash, audit_resolve_hash,
                 created_at, resolved_at, updated_at`,
      [
        approvalId, newStatus, decision, validatorAccountId,
        finalOut === null ? null : JSON.stringify(finalOut),
        note ?? null,
        settlementTxId,
      ]
    );
    if (!upd.rowCount) {
      // Lost the race to another resolver between the SELECT FOR UPDATE
      // and the UPDATE. This is structurally impossible with FOR UPDATE,
      // but we keep the check as a belt-and-braces guard.
      const err = new Error('resolveApproval: race lost');
      err.code = 'ALREADY_RESOLVED';
      throw err;
    }

    return { row: upd.rows[0], settlementTxId, split, delta, deltaAuditEntry, finalOut };
  }, { isolation: 'SERIALIZABLE', retries: 3 });

  // --- Phase 2: audit append (post-commit). -----------------------------
  // Write DELTA_COMMIT first (it contains the state-root proof), then
  // APPROVAL_RESOLVED which back-references the delta's audit seq.
  const deltaAuditEntry = phase1.deltaAuditEntry || null;

  const auditEntry = await appendAudit('APPROVAL_RESOLVED', {
    approvalId,
    missionId:           phase1.row.mission_id,
    decision,
    validatorAccountId,
    note:                note || null,
    finalOutputDigest:   _digestOf(phase1.finalOut),
    settlementTxId:      phase1.settlementTxId,
    billed:              phase1.settlementTxId !== null,
    deltaCommitSeq:      deltaAuditEntry ? deltaAuditEntry.seq : null,
  });

  // Record the resolve hash on the approval row so a single GET returns
  // the full crypto provenance.
  await getPool().query(
    `UPDATE approvals SET audit_resolve_hash = $2, updated_at = now() WHERE id = $1`,
    [approvalId, auditEntry.hash]
  );

  // If the approval used a knowledge patch, let's credit the original validator!
  if (
    (decision === 'approve' || decision === 'modify') &&
    phase1.row.context &&
    phase1.row.context.knowledgePatch &&
    phase1.row.context.knowledgePatch.patchId
  ) {
    try {
      const patchRepo = require('./knowledgePatchRepo');
      await patchRepo.recordReuse(phase1.row.context.knowledgePatch.patchId, approvalId);
      console.log(`[Flywheel] Atomic reward payout successfully processed for patch: ${phase1.row.context.knowledgePatch.patchId}`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[Flywheel] Reward payout failed for patch:', e.message);
    }
  }

  return {
    approval: _shapeApproval({ ...phase1.row, audit_resolve_hash: auditEntry.hash }),
    audit: auditEntry,
    receipt: phase1.split ? {
      txId:      phase1.settlementTxId,
      gross:     phase1.split.gross.toString(),
      platform:  phase1.split.platform.toString(),
      validator: phase1.split.validator.toString(),
      insurance: phase1.split.insurance.toString(),
      grossUsd:     microcentsToUsdString(phase1.split.gross),
      platformUsd:  microcentsToUsdString(phase1.split.platform),
      validatorUsd: microcentsToUsdString(phase1.split.validator),
      insuranceUsd: microcentsToUsdString(phase1.split.insurance),
    } : null,
  };
}

// -----------------------------------------------------------------------
// Internal: run the 40/40/20 split on a SHARED client (we are already
// inside a transaction).
//
// Two-phase state-root binding (anti-scam invariant §1):
//   Phase 1 — beginDeltaCommit: capture preStateRoot BEFORE any mutation.
//   [balance UPDATE statements execute here]
//   Phase 2 — sealDeltaCommit: capture postStateRoot AFTER all mutations,
//              build delta proof, return for DELTA_COMMIT audit entry.
//
// Every settlement produces a DELTA_COMMIT audit record with a
// cryptographically-provable pre/post state root bound to the
// APPROVAL_RESOLVED entry. The operator CANNOT alter balances without
// breaking the chain — the hash linkage proves it.
//
// Trusted Network Contributor (Win-Win §3):
//   If validatorAccountId is flagged as a Trusted Network Contributor
//   (tnc: true in their accounts.meta column), their validator share
//   receives a 10% fee discount sourced from the platform split,
//   making them stakeholders in the ecosystem.
// -----------------------------------------------------------------------
async function _distributeInline(client, {
  clientAccountId, validatorAccountId, grossMicro, refType, refId, meta,
}) {
  const crypto = require('node:crypto');
  const { SYSTEM_ACCOUNTS } = require('../lib/fiatLedger');
  const { beginDeltaCommit, sealDeltaCommit } = require('../lib/stateRoot');

  if (!(typeof grossMicro === 'bigint' && grossMicro > 0n)) {
    throw new RangeError('_distributeInline: grossMicro must be a positive BigInt');
  }

  // ── Win-Win: check Trusted Network Contributor flag ──────────────────
  // TNC validators receive a fee discount: 10% of platform share is
  // redirected to their validator split. This is a routing-log modifier
  // that does NOT alter the conservation invariant (money still sums to grossMicro).
  let tncDiscount = 0n;
  try {
    const tncRes = await client.query(
      `SELECT metadata->>'tnc' AS tnc FROM accounts WHERE id = $1`,
      [validatorAccountId]
    );
    if (tncRes.rowCount && tncRes.rows[0].tnc === 'true') {
      // 10% of platform share redirected as TNC discount
      tncDiscount = (grossMicro * 40n / 100n) * 10n / 100n;
    }
  } catch (_e) {
    // Non-fatal: proceed with standard split if meta column is absent
  }

  const basePlatform  = (grossMicro * 40n) / 100n;
  const baseValidator = (grossMicro * 40n) / 100n;
  const platform  = basePlatform - tncDiscount;
  const validator = baseValidator + tncDiscount;
  const insurance = grossMicro - basePlatform - baseValidator;
  const txId = crypto.randomUUID();
  const m = {
    ...(meta || {}),
    split: tncDiscount > 0n ? '40/40/20+TNC' : '40/40/20',
    grossMicrocents: grossMicro.toString(),
    tncDiscount: tncDiscount.toString(),
  };

  // Make sure validator account exists.
  await client.query(
    `INSERT INTO accounts (id, kind) VALUES ($1, 'validator')
     ON CONFLICT (id) DO NOTHING`,
    [validatorAccountId]
  );

  // Lock involved rows in deterministic order to avoid deadlocks.
  const ids = [
    clientAccountId,
    SYSTEM_ACCOUNTS.ESCROW,
    SYSTEM_ACCOUNTS.PLATFORM,
    SYSTEM_ACCOUNTS.INSURANCE,
    validatorAccountId,
  ].slice().sort();
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
  const lockRes = await client.query(
    `SELECT id, balance_micro FROM accounts WHERE id IN (${placeholders})
     ORDER BY id FOR UPDATE`, ids
  );
  const balMap = new Map();
  for (const r of lockRes.rows) balMap.set(r.id, BigInt(r.balance_micro));
  for (const id of ids) {
    if (!balMap.has(id)) {
      const err = new Error(`account not found: ${id}`);
      err.code = 'NO_ACCOUNT';
      throw err;
    }
  }
  const clientBal = balMap.get(clientAccountId);
  if (clientBal < grossMicro) {
    const err = new Error(
      `distribute: insufficient client balance ${clientAccountId} ` +
      `(have ${clientBal}, want ${grossMicro})`
    );
    err.code = 'INSUFFICIENT_FUNDS';
    throw err;
  }

  // ── PHASE 1: beginDeltaCommit — capture preStateRoot BEFORE mutations ──
  // This is the cryptographically-proven starting point. No balances have
  // changed yet. If the operator attempts to inject a fake preStateRoot,
  // the chain hash will not match the DELTA_COMMIT entry sealed in Phase 2.
  const preStateRoot = await beginDeltaCommit(client);

  // ── Balance mutations (all within the same ACID transaction) ───────────
  // client -> escrow
  // Batch all account balance updates into a single statement.
  // Escrow net delta = grossMicro - (platform + validator + insurance) = 0
  // (conservation invariant guarantees this). We exclude escrow from the
  // batch UPDATE to avoid Postgres undefined behavior with duplicate keys
  // in the VALUES join (SQL standard does not define which delta wins).
  const accountUpdates = [
    { id: clientAccountId,           delta: -grossMicro },
    { id: SYSTEM_ACCOUNTS.PLATFORM,  delta: platform },
    { id: validatorAccountId,         delta: validator },
    { id: SYSTEM_ACCOUNTS.INSURANCE, delta: insurance },
  ];

  const updateValues = accountUpdates.map((u, i) => `($${i * 2 + 1}::text, $${i * 2 + 2}::bigint)`).join(', ');
  const updateParams = accountUpdates.flatMap((u) => [u.id, u.delta.toString()]);

  await client.query(
    `UPDATE accounts AS a
     SET balance_micro = a.balance_micro + v.delta_micro,
         updated_at = now()
     FROM (VALUES ${updateValues}) AS v(id, delta_micro)
     WHERE a.id = v.id`,
    updateParams
  );

  // ── PHASE 2: sealDeltaCommit — capture postStateRoot AFTER mutations ───
  // sealDeltaCommit reads live DB state (within this tx) for the post root.
  // Mutations list is for the payload record only; roots are derived from DB.
  const mutations = [
    { accountId: clientAccountId,          deltaMicro: -grossMicro },
    { accountId: SYSTEM_ACCOUNTS.ESCROW,   deltaMicro: 0n }, // net zero through escrow
    { accountId: SYSTEM_ACCOUNTS.PLATFORM, deltaMicro: platform },
    { accountId: validatorAccountId,        deltaMicro: validator },
    { accountId: SYSTEM_ACCOUNTS.INSURANCE, deltaMicro: insurance },
  ];

  const delta = await sealDeltaCommit(client, 'ECOS_B2B_BILLING', mutations, { preStateRoot });

  // Conservation check: preStateRoot must differ from postStateRoot.
  // Equal roots after grossMicro > 0 indicate sealDeltaCommit read stale state.
  if (delta.preStateRoot === delta.postStateRoot) {
    const err = new Error(
      `_distributeInline: invariant violation: preStateRoot === postStateRoot after settlement ${txId}`
    );
    err.code = 'STALE_DELTA_ROOT';
    throw err;
  }



  const ledgerEntries = [
    { txId, accountId: clientAccountId, deltaMicro: -grossMicro, kind: 'transfer_out', refType, refId, meta: { ...m, leg: 'client->escrow' } },
    { txId, accountId: SYSTEM_ACCOUNTS.ESCROW, deltaMicro: grossMicro, kind: 'split_escrow', refType, refId, meta: { ...m, leg: 'client->escrow' } },
    { txId, accountId: SYSTEM_ACCOUNTS.PLATFORM, deltaMicro: platform, kind: 'split_platform', refType, refId, meta: { ...m, leg: 'escrow->platform', bps: 4000 } },
    { txId, accountId: validatorAccountId, deltaMicro: validator, kind: 'split_validator', refType, refId, meta: { ...m, leg: 'escrow->validator', bps: 4000 } },
    { txId, accountId: SYSTEM_ACCOUNTS.INSURANCE, deltaMicro: insurance, kind: 'split_insurance', refType, refId, meta: { ...m, leg: 'escrow->insurance', bps: 2000 } },
  ];
  await batchAppendLedgerEntries(client, ledgerEntries);

  return { txId, gross: grossMicro, platform, validator, insurance, delta, preStateRoot };
}
// -----------------------------------------------------------------------
function _shapeApproval(row, extra = {}) {
  return {
    id: row.id,
    missionId: row.mission_id,
    clientAccountId: row.client_account_id,
    validatorAccountId: row.validator_account_id,
    status: row.status,
    decision: row.decision,
    priceUsd: row.price_usd,
    priceMicro: BigInt(row.price_micro).toString(),
    confidence: row.confidence === null ? null : Number(row.confidence),
    aiOutput: row.ai_output,
    finalOutput: row.final_output,
    context: row.context,
    note: row.note,
    settlementTxId: row.settlement_tx_id,
    auditCreateHash: row.audit_create_hash,
    auditResolveHash: row.audit_resolve_hash,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    updatedAt: row.updated_at,
    ...extra,
  };
}

module.exports = {
  ensureMission,
  getMission,
  createApproval,
  resolveApproval,
  getApproval,
  listApprovalsForMission,
  getTrainingData,   // [V19]
  STATUS,
  DECISION,
};

// [V19] labeled data for Platt scaling calibration
async function getTrainingData() {
  const { rows } = await getPool().query(
    `SELECT confidence AS "rawScore", (decision = 'approve')::int AS label
     FROM approvals
     WHERE confidence IS NOT NULL
     ORDER BY created_at DESC LIMIT 500`
  );
  return rows.map(r => ({ rawScore: Number(r.rawScore), label: Number(r.label) }));
}
