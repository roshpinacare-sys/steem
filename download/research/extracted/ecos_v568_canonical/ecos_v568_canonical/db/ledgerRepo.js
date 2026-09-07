/**
 * ECOS Ledger Repo
 * ----------------
 * Persistent counterpart of src/lib/fiatLedger.js. Re-uses the EXACT BigInt
 * math helpers (usdToMicrocents / microcentsToUsdString / SYSTEM_ACCOUNTS)
 * so application code that already imports those constants keeps working.
 *
 * What changes vs the in-memory FiatLedger:
 *   - Account balances live in `accounts.balance_micro` (BIGINT).
 *   - Every credit / debit / transfer / split writes immutable rows to
 *     `ledger_entries` inside one Postgres transaction.
 *   - Concurrent transfers lock involved accounts with FOR UPDATE in a
 *     deterministic order (sorted by id) to prevent deadlocks.
 *   - Overdraft is rejected at TWO layers:
 *       1. Application: we read the current balance under FOR UPDATE
 *          and refuse to apply a debit that would go negative.
 *       2. Storage: accounts.balance_micro CHECK (>= 0).
 *
 * Money types: every monetary input may be a BigInt, a decimal-string USD
 * value ("12.3456"), or a finite Number USD value. Internally we always
 * convert to a BigInt microcent count before touching the database.
 */

'use strict';

const crypto = require('node:crypto');
const { withTx, getPool } = require('./pool');
const {
  SYSTEM_ACCOUNTS,
  usdToMicrocents,
  microcentsToUsdString,
} = require('../lib/fiatLedger');

// ----- amount coercion mirrors fiatLedger._coerceAmount / usdToMicrocents.
function _coerceMicro(v) {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'string') {
    if (/^-?\d+$/.test(v.trim())) return BigInt(v.trim());        // raw μ¢ integer
    return usdToMicrocents(v);                                     // decimal USD
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new TypeError('amount: non-finite');
    if (Number.isInteger(v)) return BigInt(v);                     // μ¢ integer
    return usdToMicrocents(v);                                     // USD with cents
  }
  throw new TypeError('amount: unsupported type ' + typeof v);
}

function _ensureClient(client) {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('ledgerRepo: client is required (call inside withTx)');
  }
}

// ---- Account lifecycle --------------------------------------------------

async function ensureAccount({ id, kind = 'client', metadata = {} } = {}) {
  if (typeof id !== 'string' || !id) {
    throw new TypeError('ensureAccount: id required');
  }
  return withTx(async (client) => {
    const res = await client.query(
      `INSERT INTO accounts (id, kind, metadata)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (id) DO UPDATE SET updated_at = now()
       RETURNING id, kind, balance_micro, metadata`,
      [id, kind, JSON.stringify(metadata)]
    );
    const row = res.rows[0];
    return {
      id: row.id, kind: row.kind,
      balanceMicro: BigInt(row.balance_micro),
      metadata: row.metadata,
    };
  });
}

async function getAccount(id) {
  const { rows } = await getPool().query(
    `SELECT id, kind, balance_micro, metadata, created_at, updated_at
     FROM accounts WHERE id = $1`, [id]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id, kind: r.kind,
    balanceMicro: BigInt(r.balance_micro),
    balanceUsd: microcentsToUsdString(BigInt(r.balance_micro)),
    metadata: r.metadata,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function balance(id) {
  const acc = await getAccount(id);
  if (!acc) throw new Error(`balance: account not found: ${id}`);
  return acc.balanceMicro;
}

// ---- Internal helpers used inside an open transaction ------------------

async function _lockAccounts(client, ids) {
  // Sort to enforce a stable lock order across all callers.
  const ordered = Array.from(new Set(ids)).sort();
  if (ordered.length === 0) return new Map();
  const placeholders = ordered.map((_, i) => `$${i + 1}`).join(',');
  const res = await client.query(
    `SELECT id, balance_micro FROM accounts
     WHERE id IN (${placeholders})
     ORDER BY id
     FOR UPDATE`,
    ordered
  );
  const map = new Map();
  for (const row of res.rows) map.set(row.id, BigInt(row.balance_micro));
  for (const id of ordered) {
    if (!map.has(id)) {
      const err = new Error(`account not found: ${id}`);
      err.code = 'NO_ACCOUNT';
      throw err;
    }
  }
  return map;
}

async function _applyDelta(client, accountId, deltaMicro) {
  // Will raise via CHECK constraint if final balance < 0.
  // We don't rely on that alone -- callers pre-check under FOR UPDATE --
  // but it's defense in depth.
  const res = await client.query(
    `UPDATE accounts
     SET balance_micro = balance_micro + $2,
         updated_at = now()
     WHERE id = $1
     RETURNING balance_micro`,
    [accountId, deltaMicro.toString()]
  );
  if (!res.rowCount) {
    const err = new Error(`account not found: ${accountId}`);
    err.code = 'NO_ACCOUNT';
    throw err;
  }
  return BigInt(res.rows[0].balance_micro);
}

async function _writeEntry(client, { txId, accountId, deltaMicro, kind, refType, refId, meta }) {
  await client.query(
    `INSERT INTO ledger_entries
       (tx_id, account_id, delta_micro, kind, ref_type, ref_id, meta)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      txId, accountId, deltaMicro.toString(), kind,
      refType ?? null, refId ?? null, JSON.stringify(meta || {}),
    ]
  );
}

async function batchAppendLedgerEntries(client, entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return; // Nothing to insert
  }

  const entryValues = entries.map((e, i) => `($${i * 7 + 1}::uuid, $${i * 7 + 2}, $${i * 7 + 3}::bigint, $${i * 7 + 4}, $${i * 7 + 5}, $${i * 7 + 6}, $${i * 7 + 7}::jsonb)`).join(', ');
  const entryParams = entries.flatMap((e) => [
    e.txId, e.accountId, e.deltaMicro.toString(), e.kind,
    e.refType ?? null, e.refId ?? null, JSON.stringify(e.meta || {}),
  ]);

  await client.query(
    `INSERT INTO ledger_entries (tx_id, account_id, delta_micro, kind, ref_type, ref_id, meta)
     VALUES ${entryValues}`,
    entryParams
  );
}

// ---- Public write API ---------------------------------------------------

async function credit({ accountId, amount, ref, meta }) {
  const amt = _coerceMicro(amount);
  if (amt <= 0n) throw new RangeError('credit: amount must be > 0');
  const txId = crypto.randomUUID();
  return withTx(async (client) => {
    await _lockAccounts(client, [accountId]);
    const newBal = await _applyDelta(client, accountId, amt);
    await _writeEntry(client, {
      txId, accountId, deltaMicro: amt, kind: 'credit',
      refType: ref?.type, refId: ref?.id, meta,
    });
    return { txId, amountMicro: amt, newBalanceMicro: newBal };
  });
}

async function debit({ accountId, amount, ref, meta }) {
  const amt = _coerceMicro(amount);
  if (amt <= 0n) throw new RangeError('debit: amount must be > 0');
  const txId = crypto.randomUUID();
  return withTx(async (client) => {
    const locks = await _lockAccounts(client, [accountId]);
    const cur = locks.get(accountId);
    if (cur < amt) {
      const err = new Error(
        `debit: insufficient balance on ${accountId} (have ${cur}, want ${amt})`
      );
      err.code = 'INSUFFICIENT_FUNDS';
      throw err;
    }
    const newBal = await _applyDelta(client, accountId, -amt);
    await _writeEntry(client, {
      txId, accountId, deltaMicro: -amt, kind: 'debit',
      refType: ref?.type, refId: ref?.id, meta,
    });
    return { txId, amountMicro: amt, newBalanceMicro: newBal };
  });
}

async function transfer({ fromId, toId, amount, ref, meta }) {
  const amt = _coerceMicro(amount);
  if (amt <= 0n) throw new RangeError('transfer: amount must be > 0');
  if (fromId === toId) throw new RangeError('transfer: from == to');
  const txId = crypto.randomUUID();
  return withTx(async (client) => {
    const locks = await _lockAccounts(client, [fromId, toId]);
    const cur = locks.get(fromId);
    if (cur < amt) {
      const err = new Error(
        `transfer: insufficient balance on ${fromId} (have ${cur}, want ${amt})`
      );
      err.code = 'INSUFFICIENT_FUNDS';
      throw err;
    }
    await _applyDelta(client, fromId, -amt);
    await _applyDelta(client, toId, amt);
    await _writeEntry(client, {
      txId, accountId: fromId, deltaMicro: -amt, kind: 'transfer_out',
      refType: ref?.type, refId: ref?.id, meta,
    });
    await _writeEntry(client, {
      txId, accountId: toId, deltaMicro: amt, kind: 'transfer_in',
      refType: ref?.type, refId: ref?.id, meta,
    });
    return { txId, amountMicro: amt };
  });
}

/**
 * 40/40/20 distribution of a gross task payment.
 *
 * Steps (all inside ONE Postgres transaction):
 *   1. Lock client + escrow + platform + validator + insurance accounts.
 *   2. Pre-flight: assert the client has the funds.
 *   3. Move full gross client -> escrow (split_escrow entry).
 *   4. Compute platform / validator / insurance using floor division on
 *      BigInt; insurance absorbs the remainder.
 *   5. Move escrow -> platform / validator / insurance and write three
 *      split_* entries.
 *
 * Returns a receipt with the same BigInt shape as the in-memory version
 * for parity with src/lib/fiatLedger.js.
 */
async function distributeTaskPayment({
  clientAccountId,
  validatorAccountId,
  grossAmountUsd,
  ref,
  meta = {},
}) {
  if (!clientAccountId)    throw new TypeError('distribute: clientAccountId required');
  if (!validatorAccountId) throw new TypeError('distribute: validatorAccountId required');

  const gross = _coerceMicro(grossAmountUsd);
  if (gross <= 0n) throw new RangeError('distribute: gross must be > 0');

  const platform  = (gross * 40n) / 100n;
  const validator = (gross * 40n) / 100n;
  const insurance = gross - platform - validator; // absorbs remainder

  const txId = crypto.randomUUID();
  const refType = ref?.type ?? null;
  const refId   = ref?.id   ?? null;
  const m = { ...meta, split: '40/40/20', grossMicrocents: gross.toString() };

  return withTx(async (client) => {
    // Make sure the validator account row exists (clients always exist
    // because missions FK them, but validators may be created lazily).
    await client.query(
      `INSERT INTO accounts (id, kind) VALUES ($1, 'validator')
       ON CONFLICT (id) DO NOTHING`,
      [validatorAccountId]
    );

    const locks = await _lockAccounts(client, [
      clientAccountId,
      SYSTEM_ACCOUNTS.ESCROW,
      SYSTEM_ACCOUNTS.PLATFORM,
      SYSTEM_ACCOUNTS.INSURANCE,
      validatorAccountId,
    ]);

    const clientBal = locks.get(clientAccountId);
    if (clientBal < gross) {
      const err = new Error(
        `distribute: insufficient client balance ${clientAccountId} ` +
        `(have ${clientBal}, want ${gross})`
      );
      err.code = 'INSUFFICIENT_FUNDS';
      throw err;
    }

    // 1) client -> escrow (full gross). Logged as TWO entries (out + in)
    //    so the per-account ledger view is complete.
    await _applyDelta(client, clientAccountId,            -gross);
    await _applyDelta(client, SYSTEM_ACCOUNTS.ESCROW,      gross);
    await _writeEntry(client, {
      txId, accountId: clientAccountId, deltaMicro: -gross,
      kind: 'transfer_out', refType, refId,
      meta: { ...m, leg: 'client→escrow' },
    });
    await _writeEntry(client, {
      txId, accountId: SYSTEM_ACCOUNTS.ESCROW, deltaMicro: gross,
      kind: 'split_escrow', refType, refId,
      meta: { ...m, leg: 'client→escrow' },
    });

    // 2) escrow -> platform / validator / insurance.
    await _applyDelta(client, SYSTEM_ACCOUNTS.ESCROW,      -platform - validator - insurance);
    await _applyDelta(client, SYSTEM_ACCOUNTS.PLATFORM,     platform);
    await _applyDelta(client, validatorAccountId,           validator);
    await _applyDelta(client, SYSTEM_ACCOUNTS.INSURANCE,    insurance);

    await _writeEntry(client, {
      txId, accountId: SYSTEM_ACCOUNTS.PLATFORM, deltaMicro: platform,
      kind: 'split_platform', refType, refId,
      meta: { ...m, leg: 'escrow→platform', bps: 4000 },
    });
    await _writeEntry(client, {
      txId, accountId: validatorAccountId, deltaMicro: validator,
      kind: 'split_validator', refType, refId,
      meta: { ...m, leg: 'escrow→validator', bps: 4000 },
    });
    await _writeEntry(client, {
      txId, accountId: SYSTEM_ACCOUNTS.INSURANCE, deltaMicro: insurance,
      kind: 'split_insurance', refType, refId,
      meta: { ...m, leg: 'escrow→insurance', bps: 2000 },
    });

    return { txId, gross, platform, validator, insurance };
  });
}

// ---- Read helpers ------------------------------------------------------

async function entriesForAccount(accountId, { limit = 100 } = {}) {
  const { rows } = await getPool().query(
    `SELECT id, tx_id, account_id, delta_micro, kind, ref_type, ref_id, meta, created_at
     FROM ledger_entries
     WHERE account_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    [accountId, limit]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    txId: r.tx_id,
    accountId: r.account_id,
    deltaMicro: BigInt(r.delta_micro),
    deltaUsd: microcentsToUsdString(BigInt(r.delta_micro)),
    kind: r.kind,
    refType: r.ref_type,
    refId: r.ref_id,
    meta: r.meta,
    createdAt: r.created_at,
  }));
}

async function entriesForTx(txId) {
  const { rows } = await getPool().query(
    `SELECT id, tx_id, account_id, delta_micro, kind, ref_type, ref_id, meta, created_at
     FROM ledger_entries
     WHERE tx_id = $1::uuid
     ORDER BY id ASC`,
    [txId]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    txId: r.tx_id,
    accountId: r.account_id,
    deltaMicro: BigInt(r.delta_micro),
    kind: r.kind,
    refType: r.ref_type,
    refId: r.ref_id,
    meta: r.meta,
    createdAt: r.created_at,
  }));
}

module.exports = {
  ensureAccount,
  getAccount,
  balance,
  credit,
  debit,
  transfer,
  distributeTaskPayment,
  batchAppendLedgerEntries, // Export the new batch function
  entriesForAccount,
  entriesForTx,
  // re-export for convenience so callers don't double-import
  SYSTEM_ACCOUNTS,
  usdToMicrocents,
  microcentsToUsdString,
};
