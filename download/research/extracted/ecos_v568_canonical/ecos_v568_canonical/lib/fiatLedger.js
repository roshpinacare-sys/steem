/**
 * ECOS Fiat Ledger
 * ----------------
 * Internal double-entry style accounting engine for USD-pegged credits.
 *
 * Unit of account: "microcent" (μ¢)
 *   1 USD     = 10_000 μ¢
 *   1 cent    =    100 μ¢
 *   1 μ¢      =  1/100 of a cent  (4 decimal places of precision)
 *
 * All arithmetic is done with BigInt. We NEVER use Number for monetary values.
 * Floating-point math is permanently off the table for this module.
 *
 * Distribution policy for resolved B2B tasks:
 *   40%  →  PLATFORM           (infrastructure / runtime / margin)
 *   40%  →  HITL VALIDATOR     (the human resolver, paid in real terms)
 *   20%  →  INSURANCE POOL     (client refunds, dispute reserves, discounts)
 *
 * The split is computed using integer floor division, and the *insurance*
 * bucket absorbs any remainder so the sum is guaranteed to equal the input
 * exactly (no satoshi-style leakage).
 */

'use strict';

// ---------- Reserved system accounts ----------
const SYSTEM_ACCOUNTS = Object.freeze({
  PLATFORM:  'sys::platform',
  INSURANCE: 'sys::insurance_pool',
  ESCROW:    'sys::escrow',
  GENESIS:   'sys::genesis',
});

const USD_SCALE = 10_000n;   // 1 USD = 10_000 μ¢
const CENT      =    100n;   // 1 cent = 100 μ¢

// ---------- Conversion helpers ----------
function usdToMicrocents(usd) {
  if (typeof usd === 'bigint') return usd * USD_SCALE;
  if (typeof usd === 'string') {
    // Parse a decimal string safely without floats. e.g. "12.3456"
    const s = usd.trim();
    if (!/^-?\d+(\.\d+)?$/.test(s)) {
      throw new TypeError(`usdToMicrocents: invalid decimal string "${usd}"`);
    }
    const negative = s.startsWith('-');
    const body = negative ? s.slice(1) : s;
    const [whole, frac = ''] = body.split('.');
    const fracPadded = (frac + '0000').slice(0, 4); // up to 4 decimal places
    const result = BigInt(whole) * USD_SCALE + BigInt(fracPadded || '0');
    return negative ? -result : result;
  }
  if (typeof usd === 'number') {
    if (!Number.isFinite(usd)) throw new TypeError('usdToMicrocents: non-finite number');
    // Round-trip through string to avoid float surprises for inputs <= 4 dp.
    return usdToMicrocents(usd.toFixed(4));
  }
  throw new TypeError('usdToMicrocents: unsupported type ' + typeof usd);
}

function microcentsToUsdString(uc) {
  const n = typeof uc === 'bigint' ? uc : BigInt(uc);
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const whole = abs / USD_SCALE;
  const frac  = abs % USD_SCALE;
  const fracStr = frac.toString().padStart(4, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fracStr}`;
}

// ---------- Ledger class ----------
class FiatLedger {
  constructor() {
    /** @type {Map<string, bigint>} */
    this._accounts = new Map();
    /** @type {Array<object>} */
    this._entries  = [];
    this._nextEntryId = 1;

    // Bootstrap system accounts so callers can always reference them.
    for (const id of Object.values(SYSTEM_ACCOUNTS)) {
      this._accounts.set(id, 0n);
    }
  }

  // ---- Account management ----
  ensureAccount(accountId) {
    if (typeof accountId !== 'string' || !accountId) {
      throw new TypeError('ensureAccount: accountId must be a non-empty string');
    }
    if (!this._accounts.has(accountId)) {
      this._accounts.set(accountId, 0n);
    }
    return accountId;
  }

  balance(accountId) {
    return this._accounts.get(accountId) ?? 0n;
  }

  balanceUsd(accountId) {
    return microcentsToUsdString(this.balance(accountId));
  }

  listAccounts() {
    return Array.from(this._accounts.entries()).map(([id, bal]) => ({
      id,
      microcents: bal.toString(),
      usd: microcentsToUsdString(bal),
    }));
  }

  // ---- Core write operations ----

  /**
   * Credit funds INTO an account. Used for B2B client deposits / top-ups.
   * `amountMicrocents` MUST be a positive BigInt.
   */
  credit(accountId, amountMicrocents, meta = {}) {
    const amt = this._coerceAmount(amountMicrocents);
    if (amt <= 0n) throw new RangeError('credit: amount must be > 0');
    this.ensureAccount(accountId);
    this._accounts.set(accountId, this.balance(accountId) + amt);
    return this._record({
      kind: 'CREDIT',
      to: accountId,
      from: null,
      amount: amt,
      meta,
    });
  }

  /**
   * Debit funds OUT of an account. Used for refunds / withdrawals.
   * Will throw if the account would go negative (no implicit overdraft).
   */
  debit(accountId, amountMicrocents, meta = {}) {
    const amt = this._coerceAmount(amountMicrocents);
    if (amt <= 0n) throw new RangeError('debit: amount must be > 0');
    this.ensureAccount(accountId);
    const current = this.balance(accountId);
    if (current < amt) {
      throw new Error(
        `debit: insufficient balance on ${accountId} ` +
        `(have ${current}, want ${amt})`
      );
    }
    this._accounts.set(accountId, current - amt);
    return this._record({
      kind: 'DEBIT',
      to: null,
      from: accountId,
      amount: amt,
      meta,
    });
  }

  /**
   * Atomic transfer between two accounts. Used internally by distribution.
   */
  transfer(fromId, toId, amountMicrocents, meta = {}) {
    const amt = this._coerceAmount(amountMicrocents);
    if (amt <= 0n) throw new RangeError('transfer: amount must be > 0');
    if (fromId === toId) throw new RangeError('transfer: from == to');
    this.ensureAccount(fromId);
    this.ensureAccount(toId);
    const fromBal = this.balance(fromId);
    if (fromBal < amt) {
      throw new Error(
        `transfer: insufficient balance on ${fromId} ` +
        `(have ${fromBal}, want ${amt})`
      );
    }
    this._accounts.set(fromId, fromBal - amt);
    this._accounts.set(toId,   this.balance(toId) + amt);
    return this._record({
      kind: 'TRANSFER',
      from: fromId,
      to: toId,
      amount: amt,
      meta,
    });
  }

  // ---- 40/40/20 distribution ----

  /**
   * Apply the canonical 40/40/20 split to a *gross* task payment.
   * Funds are moved out of the client's escrow into the three destination
   * buckets in a single logical operation.
   *
   * @param {object} opts
   * @param {string} opts.clientAccountId   The B2B client (funds debit source).
   * @param {string} opts.validatorAccountId The HITL human who resolved it.
   * @param {bigint|string|number} opts.grossAmountUsd  Gross charge (USD).
   * @param {object} [opts.meta]             Free-form metadata for entries.
   * @returns {{
   *   gross: bigint,
   *   platform: bigint,
   *   validator: bigint,
   *   insurance: bigint,
   *   entries: object[]
   * }}
   */
  distributeTaskPayment({
    clientAccountId,
    validatorAccountId,
    grossAmountUsd,
    meta = {},
  }) {
    if (!clientAccountId)    throw new TypeError('distributeTaskPayment: clientAccountId required');
    if (!validatorAccountId) throw new TypeError('distributeTaskPayment: validatorAccountId required');

    const gross =
      typeof grossAmountUsd === 'bigint'
        ? grossAmountUsd
        : usdToMicrocents(grossAmountUsd);

    if (gross <= 0n) throw new RangeError('distributeTaskPayment: gross must be > 0');

    // Floor-divide for platform & validator. Insurance gets the remainder
    // so the total is exactly equal to `gross` -- never off by 1 μ¢.
    const platform  = (gross * 40n) / 100n;
    const validator = (gross * 40n) / 100n;
    const insurance = gross - platform - validator; // ≥ 20% of gross

    // Ensure all involved accounts exist before any state mutation,
    // so a failure during distribution leaves balances untouched.
    this.ensureAccount(clientAccountId);
    this.ensureAccount(validatorAccountId);

    const baseMeta = { ...meta, split: '40/40/20', grossMicrocents: gross.toString() };

    // 1) Move the full gross from client → escrow (atomic preflight).
    const entries = [];
    entries.push(this.transfer(
      clientAccountId,
      SYSTEM_ACCOUNTS.ESCROW,
      gross,
      { ...baseMeta, leg: 'client→escrow' },
    ));

    // 2) Fan out from escrow → platform / validator / insurance.
    entries.push(this.transfer(
      SYSTEM_ACCOUNTS.ESCROW, SYSTEM_ACCOUNTS.PLATFORM, platform,
      { ...baseMeta, leg: 'escrow→platform', bps: 4000 },
    ));
    entries.push(this.transfer(
      SYSTEM_ACCOUNTS.ESCROW, validatorAccountId, validator,
      { ...baseMeta, leg: 'escrow→validator', bps: 4000 },
    ));
    entries.push(this.transfer(
      SYSTEM_ACCOUNTS.ESCROW, SYSTEM_ACCOUNTS.INSURANCE, insurance,
      { ...baseMeta, leg: 'escrow→insurance', bps: 2000 },
    ));

    return { gross, platform, validator, insurance, entries };
  }

  // ---- AUTO_FLOW distribution (40/60 — no human validator) ----

  /**
   * [FIX-V13-BUG-B] Apply the AUTO_FLOW split to a *gross* task payment.
   *
   * When AUTO_FLOW fires there is no human validator — the AI resolved the
   * task without review. Using distributeTaskPayment() with PLATFORM as the
   * validatorAccountId caused PLATFORM to receive 80% of gross (its own 40%
   * platform leg PLUS the 40% validator leg), inflating the PLATFORM balance
   * and producing a misleading audit label ("validator: PLATFORM got 40%").
   *
   * Correct split for AUTO_FLOW:
   *   40%  →  PLATFORM     (unchanged — infrastructure margin)
   *   60%  →  INSURANCE    (absorbed: client reserve / future royalties)
   *    0%  →  validator    (no human resolver — leg intentionally absent)
   *
   * Insurance gets the remainder so the sum is guaranteed to equal gross exactly.
   *
   * @param {object} opts
   * @param {string} opts.clientAccountId   The B2B client (funds debit source).
   * @param {bigint|string|number} opts.grossAmountUsd  Gross charge (USD).
   * @param {object} [opts.meta]             Free-form metadata for entries.
   * @returns {{
   *   gross: bigint,
   *   platform: bigint,
   *   validator: bigint,   // always 0n
   *   insurance: bigint,
   *   entries: object[]
   * }}
   */
  distributeAutoFlowPayment({
    clientAccountId,
    grossAmountUsd,
    meta = {},
  }) {
    if (!clientAccountId) throw new TypeError('distributeAutoFlowPayment: clientAccountId required');

    const gross =
      typeof grossAmountUsd === 'bigint'
        ? grossAmountUsd
        : usdToMicrocents(grossAmountUsd);

    if (gross <= 0n) throw new RangeError('distributeAutoFlowPayment: gross must be > 0');

    const platform  = (gross * 40n) / 100n;
    const validator = 0n;                       // no human resolver
    const insurance = gross - platform;         // 60% + any floor-div remainder

    this.ensureAccount(clientAccountId);

    const baseMeta = {
      ...meta,
      split: '40/0/60',
      flow: 'AUTO_FLOW',
      grossMicrocents: gross.toString(),
    };

    const entries = [];
    // 1) client → escrow (full gross)
    entries.push(this.transfer(
      clientAccountId,
      SYSTEM_ACCOUNTS.ESCROW,
      gross,
      { ...baseMeta, leg: 'client→escrow' },
    ));

    // 2) escrow → platform (40%)
    entries.push(this.transfer(
      SYSTEM_ACCOUNTS.ESCROW, SYSTEM_ACCOUNTS.PLATFORM, platform,
      { ...baseMeta, leg: 'escrow→platform', bps: 4000 },
    ));

    // 3) escrow → insurance (60% — no validator leg)
    entries.push(this.transfer(
      SYSTEM_ACCOUNTS.ESCROW, SYSTEM_ACCOUNTS.INSURANCE, insurance,
      { ...baseMeta, leg: 'escrow→insurance', bps: 6000 },
    ));

    return { gross, platform, validator, insurance, entries };
  }

  // ---- Inspection ----
  entries() { return this._entries.slice(); }
  entry(id) { return this._entries.find(e => e.id === id) || null; }

  // ---- Internals ----
  _coerceAmount(v) {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'string') return BigInt(v);
    if (typeof v === 'number') {
      if (!Number.isInteger(v)) {
        throw new TypeError('_coerceAmount: numeric amount must be integer microcents');
      }
      return BigInt(v);
    }
    throw new TypeError('_coerceAmount: unsupported type ' + typeof v);
  }

  _record(partial) {
    const entry = {
      id: this._nextEntryId++,
      ts: new Date().toISOString(),
      ...partial,
      // Serialize bigints for safe JSON downstream.
      amount: partial.amount.toString(),
    };
    this._entries.push(entry);
    return entry;
  }
}

// ---------- Singleton + exports ----------
const defaultLedger = new FiatLedger();

module.exports = {
  FiatLedger,
  defaultLedger,
  SYSTEM_ACCOUNTS,
  USD_SCALE,
  CENT,
  usdToMicrocents,
  microcentsToUsdString,
};
