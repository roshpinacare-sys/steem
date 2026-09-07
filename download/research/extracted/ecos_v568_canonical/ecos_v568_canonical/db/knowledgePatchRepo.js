/**
 * ECOS Knowledge Patch Repo
 * -------------------------
 * Manages the Knowledge Flywheel: stores AI corrections from validators,
 * retrieves matching patches for new AI requests, and atomically rewards
 * the original validator when their patch is reused.
 *
 * Deadlock safety:
 *   All writes that touch both `knowledge_patches` and `accounts` acquire
 *   locks in a fixed order: accounts first (sorted by id), then
 *   knowledge_patches. Never the reverse.
 *
 * Immutability contract:
 *   Only `reuse_count`, `earned_micro`, `active`, and `updated_at` are ever
 *   mutated. Everything else is write-once at INSERT time.
 */

'use strict';

const crypto = require('node:crypto');
const { withTx, getPool } = require('./pool');
const { sha256Hex, canonicalize } = require('../lib/auditLog');
const { microcentsToUsdString } = require('../lib/fiatLedger');

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _hashOutput(obj) {
  return sha256Hex(canonicalize(obj ?? null));
}

function _patchId() {
  return 'kp_' + crypto.randomBytes(8).toString('hex');
}

// ---------------------------------------------------------------------------
// Write API
// ---------------------------------------------------------------------------

/**
 * Record a new knowledge patch when a validator modifies an AI output.
 * Called automatically from approvalRepo.resolveApproval when decision=modify.
 *
 * @param {object} opts
 * @param {string} opts.approvalId
 * @param {string} opts.validatorId
 * @param {string} opts.taskType        Caller-defined category, e.g. 'summarise'
 * @param {object} opts.aiOutput        The original AI output (before correction)
 * @param {object} opts.finalOutput     The corrected output (what the validator produced)
 * @param {object} [opts.patchDiff]     Optional structured diff
 * @param {string[]} [opts.similarityKeys]  Tags for future retrieval, e.g. ['invoice','amount']
 * @param {number} [opts.rewardPerReuse]    μ¢ to pay per future reuse (default 500 = $0.05)
 * @param {object} [opts.metadata]
 * @returns {Promise<object>}  The created patch row
 */
async function recordPatch({
  approvalId,
  validatorId,
  taskType,
  aiOutput,
  finalOutput,
  patchDiff = null,
  similarityKeys = [],
  rewardPerReuse = 500,
  metadata = {},
}) {
  if (!approvalId)  throw new TypeError('recordPatch: approvalId required');
  if (!validatorId) throw new TypeError('recordPatch: validatorId required');
  if (!taskType)    throw new TypeError('recordPatch: taskType required');
  if (aiOutput === undefined)    throw new TypeError('recordPatch: aiOutput required');
  if (finalOutput === undefined) throw new TypeError('recordPatch: finalOutput required');
  if (rewardPerReuse < 0) throw new RangeError('recordPatch: rewardPerReuse must be >= 0');

  const aiHash    = _hashOutput(aiOutput);
  const patchHash = _hashOutput(finalOutput);
  const id        = _patchId();

  return withTx(async (client) => {
    // Upsert: if same (task_type, ai_output_hash) already exists and is active,
    // update the patch body with the latest validator correction. This prevents
    // duplicate active patches for the same AI error pattern.
    const res = await client.query(
      `INSERT INTO knowledge_patches
         (id, approval_id, validator_id, task_type,
          ai_output_hash, patch_hash, patch_body, patch_diff,
          similarity_keys, reward_per_reuse, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::text[], $10, $11::jsonb)
       ON CONFLICT (task_type, ai_output_hash) WHERE active = true
       DO UPDATE SET
           patch_hash       = EXCLUDED.patch_hash,
           patch_body       = EXCLUDED.patch_body,
           patch_diff       = EXCLUDED.patch_diff,
           similarity_keys  = EXCLUDED.similarity_keys,
           reward_per_reuse = EXCLUDED.reward_per_reuse,
           metadata         = knowledge_patches.metadata || EXCLUDED.metadata,
           updated_at       = now()
       RETURNING *`,
      [
        id, approvalId, validatorId, taskType,
        aiHash, patchHash,
        JSON.stringify(finalOutput),
        patchDiff ? JSON.stringify(patchDiff) : null,
        similarityKeys,
        rewardPerReuse,
        JSON.stringify(metadata),
      ]
    );
    return _shape(res.rows[0]);
  });
}

/**
 * Find the best matching patch for a given AI output.
 *
 * Lookup strategy (two-pass):
 *   1. Exact match: (task_type, ai_output_hash) — highest confidence.
 *   2. Similarity match: task_type + any overlapping similarity_keys.
 *      Returns the patch with highest reuse_count (most battle-tested).
 *
 * Returns null if no active patch is found.
 *
 * @param {string} taskType
 * @param {object} aiOutput       The raw AI output to match against
 * @param {string[]} [keys]       Additional similarity keys from the caller
 * @returns {Promise<object|null>}
 */
async function findMatchingPatch(taskType, aiOutput, keys = []) {
  const aiHash = _hashOutput(aiOutput);

  // Pass 1: exact hash match.
  const exact = await getPool().query(
    `SELECT * FROM knowledge_patches
     WHERE task_type = $1 AND ai_output_hash = $2 AND active = true
     LIMIT 1`,
    [taskType, aiHash]
  );
  if (exact.rowCount) return { ..._shape(exact.rows[0]), matchType: 'exact' };

  // Pass 2: similarity key overlap (if any keys provided).
  if (!keys.length) return null;
  const sim = await getPool().query(
    `SELECT * FROM knowledge_patches
     WHERE task_type = $1
       AND similarity_keys && $2::text[]
       AND active = true
     ORDER BY reuse_count DESC
     LIMIT 1`,
    [taskType, keys]
  );
  if (sim.rowCount) return { ..._shape(sim.rows[0]), matchType: 'similarity' };

  return null;
}

/**
 * Record a patch reuse: increment counter and credit the validator.
 * Called by the AI gateway when it injects a patch into a prompt and the
 * subsequent approval resolves without HITL.
 *
 * Atomicity: runs inside ONE transaction. Lock order:
 *   1. accounts (validator_id) via FOR UPDATE
 *   2. knowledge_patches (patch_id) via FOR UPDATE
 *
 * @param {string} patchId
 * @param {string} approvalId   The new approval that benefited from this patch
 * @returns {Promise<{ rewardMicro: bigint, newReuseCount: number }>}
 */
async function recordReuse(patchId, approvalId) {
  if (!patchId)   throw new TypeError('recordReuse: patchId required');
  if (!approvalId) throw new TypeError('recordReuse: approvalId required');

  return withTx(async (client) => {
    // Read patch first (no lock yet) to get validatorId for ordered locking.
    const patchRead = await client.query(
      `SELECT id, validator_id, reward_per_reuse, active FROM knowledge_patches WHERE id = $1`,
      [patchId]
    );
    if (!patchRead.rowCount) {
      const err = new Error(`recordReuse: patch not found: ${patchId}`);
      err.code = 'NOT_FOUND';
      throw err;
    }
    const patch = patchRead.rows[0];
    if (!patch.active) {
      const err = new Error(`recordReuse: patch ${patchId} is retired`);
      err.code = 'PATCH_RETIRED';
      throw err;
    }

    const rewardMicro = BigInt(patch.reward_per_reuse);
    const validatorId = patch.validator_id;

    // Lock accounts FIRST (deterministic order: sorted id).
    await client.query(
      `SELECT id FROM accounts WHERE id = $1 FOR UPDATE`,
      [validatorId]
    );

    // Now lock the patch row.
    await client.query(
      `SELECT id FROM knowledge_patches WHERE id = $1 FOR UPDATE`,
      [patchId]
    );

    // Credit the validator.
    await client.query(
      `UPDATE accounts
       SET balance_micro = balance_micro + $2, updated_at = now()
       WHERE id = $1`,
      [validatorId, rewardMicro.toString()]
    );

    // Write ledger entry for audit trail.
    const txId = crypto.randomUUID();
    await client.query(
      `INSERT INTO ledger_entries
         (tx_id, account_id, delta_micro, kind, ref_type, ref_id, meta)
       VALUES ($1::uuid, $2, $3, 'credit', 'knowledge_patch', $4,
               $5::jsonb)`,
      [
        txId, validatorId, rewardMicro.toString(), patchId,
        JSON.stringify({ approvalId, patchId, source: 'knowledge_reuse' }),
      ]
    );

    // Atomically increment reuse counter and earned total.
    const upd = await client.query(
      `UPDATE knowledge_patches
       SET reuse_count   = reuse_count + 1,
           earned_micro  = earned_micro + $2,
           updated_at    = now()
       WHERE id = $1
       RETURNING reuse_count, earned_micro`,
      [patchId, rewardMicro.toString()]
    );

    return {
      txId,
      rewardMicro,
      rewardUsd: microcentsToUsdString(rewardMicro),
      newReuseCount: upd.rows[0].reuse_count,
      totalEarnedMicro: BigInt(upd.rows[0].earned_micro),
    };
  });
}

/**
 * Retire a patch (soft-delete). Retired patches are excluded from future
 * lookups but preserved for audit purposes.
 */
async function retirePatch(patchId, reason = '') {
  const res = await getPool().query(
    `UPDATE knowledge_patches
     SET active = false,
         metadata = metadata || $2::jsonb,
         updated_at = now()
     WHERE id = $1
     RETURNING id`,
    [patchId, JSON.stringify({ retired_reason: reason, retired_at: new Date().toISOString() })]
  );
  if (!res.rowCount) {
    const err = new Error(`retirePatch: patch not found: ${patchId}`);
    err.code = 'NOT_FOUND';
    throw err;
  }
  return { retired: true, patchId };
}

// ---------------------------------------------------------------------------
// Read API
// ---------------------------------------------------------------------------

async function getPatch(patchId) {
  const { rows } = await getPool().query(
    `SELECT * FROM knowledge_patches WHERE id = $1`, [patchId]
  );
  return rows[0] ? _shape(rows[0]) : null;
}

async function listPatchesForValidator(validatorId, { limit = 50 } = {}) {
  const { rows } = await getPool().query(
    `SELECT * FROM knowledge_patches
     WHERE validator_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [validatorId, limit]
  );
  return rows.map(_shape);
}

// ---------------------------------------------------------------------------
// Internal shaper
// ---------------------------------------------------------------------------

function _shape(r) {
  return {
    id:               r.id,
    approvalId:       r.approval_id,
    validatorId:      r.validator_id,
    taskType:         r.task_type,
    aiOutputHash:     r.ai_output_hash,
    patchHash:        r.patch_hash,
    patchBody:        r.patch_body,
    patchDiff:        r.patch_diff,
    similarityKeys:   r.similarity_keys,
    reuseCount:       r.reuse_count,
    earnedMicro:      BigInt(r.earned_micro).toString(),
    earnedUsd:        microcentsToUsdString(BigInt(r.earned_micro)),
    rewardPerReuse:   BigInt(r.reward_per_reuse).toString(),
    active:           r.active,
    metadata:         r.metadata,
    createdAt:        r.created_at,
    updatedAt:        r.updated_at,
  };
}

module.exports = {
  recordPatch,
  findMatchingPatch,
  recordReuse,
  retirePatch,
  getPatch,
  listPatchesForValidator,
};
