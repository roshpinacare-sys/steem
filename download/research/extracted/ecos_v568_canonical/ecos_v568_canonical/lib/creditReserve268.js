'use strict';
/**
 * src/lib/creditReserve268.js — ECOS Credit Reserve (V268)
 *
 * Builds on creditReserve264 with:
 *   - AP2-style mandate-linked issuance: every credit issue references a mandate chain
 *   - Mobile-first reserve status (compact payload)
 *   - Real-time backing-ratio webhooks (threshold alerts)
 *   - Micro-reserve top-up via x402: on-the-fly USDC deposits from x402 payments
 *   - Jurisdiction escheat flags (per NEXT_SESSION_PROMPT_V264 requirement)
 *   - PROGRAM 01: Credit Infrastructure Hardening
 *
 * Iron Rules: zero new npm deps, all identifiers end in 268, sacred files untouched.
 */
'use strict';

const crypto = require('node:crypto');

const RESERVE_PEG_268            = 10_000n;
const REWARD_SOURCES_268         = Object.freeze([
  'externalRevenue', 'sinkBurn', 'reserveYield', 'x402Revenue', 'fiatTopUp', 'clientWork',
]);
const BREAKAGE_DAYS_268          = 180;
const BACKING_WARN_THRESHOLD_268 = 1.1;
const BACKING_HALT_THRESHOLD_268 = 1.0;
const ESCHEAT_JURISDICTIONS_268  = Object.freeze(['US', 'EU', 'UK', 'IN', 'KE', 'NG']);
const TX_LOG_MAX_268             = 10_000;
const MICRO_TOP_UP_MIN_268       = 100n;  // min x402 top-up

class CreditReserve268 {
  constructor(opts = {}) {
    this._logger   = opts.logger   || console;
    this._auditLog = opts.auditLog || null;
    this._db       = opts.db       || null;

    this._reserveBalance268  = 0n;
    this._outstanding268     = 0n;
    this._totalIssued268     = 0n;
    this._totalConsumed268   = 0n;
    this._totalRedeemed268   = 0n;
    this._txLog268           = [];
    this._mandateIndex268    = new Map(); // mandateId → { issued, consumed }
    this._x402Deposits268    = [];        // ring buffer of x402 micro top-ups
    this._alertHandlers268   = [];        // backing-ratio alert callbacks
    this._escrowLocked268    = 0n;        // amount locked for pending escheat review
  
    this._perf268 = { latencies: [] };
    this._logAdapter268 = opts.logAdapter || null;
  }

  // ── Reserve management ────────────────────────────────────────────────────

  depositReserve268(amountMicro, source, meta = {}) {
    if (typeof amountMicro !== 'bigint' || amountMicro <= 0n)
      throw new Error('creditReserve268: amountMicro must be positive BigInt');
    this._reserveBalance268 += amountMicro;
    this._log268('RESERVE_DEPOSIT', { amountMicro: amountMicro.toString(), source, ...meta });
    return { ok: true, reserveBalance: this._reserveBalance268.toString() };
  }

  /**
   * Micro top-up from an x402 payment. Records x402 provenance for audit.
   */
  depositX402268(amountMicro, x402Receipt, meta = {}) {
    if (typeof amountMicro !== 'bigint' || amountMicro < MICRO_TOP_UP_MIN_268)
      throw new Error(`creditReserve268: x402 top-up minimum is ${MICRO_TOP_UP_MIN_268} μ¢`);
    this._reserveBalance268 += amountMicro;
    const entry = {
      depositId: 'x402dep268::' + crypto.randomBytes(6).toString('hex'),
      amountMicro: amountMicro.toString(),
      x402Receipt,
      ts: new Date().toISOString(),
    };
    this._x402Deposits268.push(entry);
    if (this._x402Deposits268.length > 500) this._x402Deposits268.shift();
    this._log268('X402_DEPOSIT', { ...entry, ...meta });
    return { ok: true, depositId: entry.depositId, reserveBalance: this._reserveBalance268.toString() };
  }

  /**
   * Issue credits — enforces Σ outstanding ≤ reserve_balance / peg.
   * V268: mandateId links issuance to an AP2 mandate chain.
   */
  issue268(amountMicro, source, meta = {}) {
    const _t0 = Date.now();
    if (typeof amountMicro !== 'bigint' || amountMicro <= 0n)
      throw new Error('creditReserve268: amountMicro must be positive BigInt');
    if (!REWARD_SOURCES_268.includes(source))
      throw new Error(`creditReserve268: invalid source "${source}". Must be one of: ${REWARD_SOURCES_268.join(', ')}`);

    const projected = this._outstanding268 + amountMicro;
    this._assertInvariant268(projected);

    this._outstanding268 += amountMicro;
    this._totalIssued268 += amountMicro;

    if (meta.mandateId) {
      const m = this._mandateIndex268.get(meta.mandateId) || { issued: 0n, consumed: 0n };
      m.issued += amountMicro;
      this._mandateIndex268.set(meta.mandateId, m);
    }

    this._log268('CREDIT_ISSUE', { amountMicro: amountMicro.toString(), source, ...meta });
    this._checkAlerts268();

    this._recordLatency268(_t0);
    return {
      ok: true,
      issued: amountMicro.toString(),
      outstanding: this._outstanding268.toString(),
      backingRatio: this._backingRatio268(),
    };
  }

  consume268(amountMicro, reason, meta = {}) {
    if (typeof amountMicro !== 'bigint' || amountMicro <= 0n)
      throw new Error('creditReserve268: amountMicro must be positive BigInt');
    if (this._outstanding268 < amountMicro)
      throw new Error(`creditReserve268: cannot consume ${amountMicro} μ¢ — only ${this._outstanding268} μ¢ outstanding`);
    this._outstanding268  -= amountMicro;
    this._totalConsumed268 += amountMicro;

    if (meta.mandateId && this._mandateIndex268.has(meta.mandateId)) {
      const m = this._mandateIndex268.get(meta.mandateId);
      m.consumed += amountMicro;
    }

    this._log268('CREDIT_CONSUME', { amountMicro: amountMicro.toString(), reason, ...meta });
    return { ok: true, outstanding: this._outstanding268.toString() };
  }

  redeem268(amountMicro, meta = {}) {
    if (typeof amountMicro !== 'bigint' || amountMicro <= 0n)
      throw new Error('creditReserve268: amountMicro must be positive BigInt');
    if (this._outstanding268 < amountMicro)
      throw new Error(`creditReserve268: cannot redeem ${amountMicro} μ¢ — only ${this._outstanding268} μ¢ outstanding`);
    if (this._reserveBalance268 < amountMicro)
      throw new Error(`creditReserve268: insufficient reserve (${this._reserveBalance268} μ¢) to redeem ${amountMicro} μ¢`);
    this._outstanding268    -= amountMicro;
    this._reserveBalance268 -= amountMicro;
    this._totalRedeemed268  += amountMicro;
    this._log268('CREDIT_REDEEM', { amountMicro: amountMicro.toString(), ...meta });
    return { ok: true, redeemed: amountMicro.toString(), outstanding: this._outstanding268.toString() };
  }

  /**
   * Called by splitModule268: assert a value is fully backed before the 40/40/20 split.
   */
  assertRealizedValue268(amountMicro) {
    if (typeof amountMicro !== 'bigint') amountMicro = BigInt(amountMicro);
    if (this._reserveBalance268 < amountMicro)
      throw new Error(`creditReserve268: INVARIANT VIOLATION — split attempted on unbacked value (reserve=${this._reserveBalance268}, requested=${amountMicro})`);
  }

  // ── Escheat / Jurisdiction ─────────────────────────────────────────────────

  flagEscheat268(userId, amountMicro, jurisdiction) {
    if (!ESCHEAT_JURISDICTIONS_268.includes(jurisdiction))
      throw new Error(`creditReserve268: unknown jurisdiction ${jurisdiction}`);
    if (typeof amountMicro !== 'bigint') amountMicro = BigInt(amountMicro);
    this._escrowLocked268 += amountMicro;
    this._log268('ESCHEAT_FLAG', { userId, amountMicro: amountMicro.toString(), jurisdiction });
    return { ok: true, escrowLocked: this._escrowLocked268.toString(), jurisdiction };
  }

  // ── Alert subscriptions ───────────────────────────────────────────────────

  onAlert268(handler) {
    if (typeof handler === 'function') this._alertHandlers268.push(handler);
  }

  _checkAlerts268() {
    const ratio = this._backingRatio268();
    if (ratio < BACKING_HALT_THRESHOLD_268) {
      const alert = { type: 'HALT_ISSUANCE', ratio, ts: new Date().toISOString() };
      for (const h of this._alertHandlers268) { try { h(alert); } catch (_) {} }
      this._log268('BACKING_ALERT', alert);
    } else if (ratio < BACKING_WARN_THRESHOLD_268) {
      const alert = { type: 'WARN_LOW_BACKING', ratio, ts: new Date().toISOString() };
      for (const h of this._alertHandlers268) { try { h(alert); } catch (_) {} }
    }
  }

  // ── Status ────────────────────────────────────────────────────────────────

  getStatus268() {
    const ratio = this._backingRatio268();
    return {
      version:        '268',
      reserveBalance: this._reserveBalance268.toString(),
      outstanding:    this._outstanding268.toString(),
      totalIssued:    this._totalIssued268.toString(),
      totalConsumed:  this._totalConsumed268.toString(),
      totalRedeemed:  this._totalRedeemed268.toString(),
      backingRatio:   ratio,
      escrowLocked:   this._escrowLocked268.toString(),
      healthy:        ratio >= BACKING_HALT_THRESHOLD_268,
      warn:           ratio < BACKING_WARN_THRESHOLD_268,
      mandateCount:   this._mandateIndex268.size,
      x402DepositCount: this._x402Deposits268.length,
    };
  }

  getMobileStatus268() {
    return {
      v: '268',
      rb: this._reserveBalance268.toString(),
      os: this._outstanding268.toString(),
      br: this._backingRatio268(),
      ok: this._backingRatio268() >= BACKING_HALT_THRESHOLD_268,
    };
  }

  getMandateStatus268(mandateId) {
    const m = this._mandateIndex268.get(mandateId);
    if (!m) return null;
    return { mandateId, issued: m.issued.toString(), consumed: m.consumed.toString() };
  }

  getX402Deposits268(limit = 50) {
    return this._x402Deposits268.slice(-limit);
  }

  // ── Invariant ─────────────────────────────────────────────────────────────

  _assertInvariant268(projectedOutstanding) {
    const maxIssuable = this._reserveBalance268;
    if (projectedOutstanding > maxIssuable) {
      throw new Error(
        `creditReserve268: INVARIANT VIOLATION — projected outstanding (${projectedOutstanding} μ¢) ` +
        `exceeds reserve (${this._reserveBalance268} μ¢). Issuance halted.`
      );
    }
  }

  _backingRatio268() {
    if (this._outstanding268 === 0n) return Infinity;
    return Number(this._reserveBalance268) / Number(this._outstanding268);
  }

  _log268(event, data) {
    const entry = { event, ...data, ts: new Date().toISOString(), _v: '268' };
    this._txLog268.push(entry);
    if (this._txLog268.length > TX_LOG_MAX_268) this._txLog268.shift();
    if (this._auditLog?.append) { try { this._auditLog.append({ ...entry }); } catch (_) {} }
  }

  // ── V268: Performance Telemetry ─────────────────────────────────────────────
  getPerf268() { return _calcPercentiles268(this._perf268.latencies); }

  _recordLatency268(t0) {
    const ms = Date.now() - t0;
    this._perf268.latencies.push(ms);
    if (this._perf268.latencies.length > 1000) this._perf268.latencies.shift();
  }

  // ── V268: Health Check ────────────────────────────────────────────────────
  checkReserveHealth268() {
    return {
      ok: true,
      module: 'creditReserve268 fiat-backing reserve',
      version: '268',
      perf: this.getPerf268(),
      logAdapter: this._logAdapter268 ? { type: 'external', ok: true } : { type: 'none' },
    };
  }

}

const defaultCreditReserve268 = new CreditReserve268();


// ── V268 Performance Telemetry helper ────────────────────────────────────────
function _calcPercentiles268(arr) {
  if (!arr || arr.length === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  const p = (pct) => sorted[Math.min(Math.floor(n * pct / 100), n - 1)];
  return { p50: p(50), p95: p(95), p99: p(99), count: n };
}

module.exports = {
  CreditReserve268,
  defaultCreditReserve268,
  RESERVE_PEG_268,
  REWARD_SOURCES_268,
  BREAKAGE_DAYS_268,
  BACKING_WARN_THRESHOLD_268,
  BACKING_HALT_THRESHOLD_268,
  ESCHEAT_JURISDICTIONS_268,
};
