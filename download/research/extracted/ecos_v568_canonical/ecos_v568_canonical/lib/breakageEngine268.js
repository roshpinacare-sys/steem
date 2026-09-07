'use strict';
/**
 * src/lib/breakageEngine268.js — ASC 606 Breakage Engine (V268)
 *
 * Builds on breakageEngine264 with:
 *   - Jurisdiction-aware escheat flagging (US/EU/UK/IN/KE/NG)
 *   - Proportional method breakage (matches redemption pattern per cohort)
 *   - Material right detection (credits that never expire → separate accounting)
 *   - Breakage reserve: set aside recognized breakage as platform revenue
 *   - Mobile compact cohort payload
 *
 * PROGRAM 02: Economic Invariant Enforcement
 * Zero new npm deps. Identifiers end with 268.
 */
'use strict';

const crypto = require('node:crypto');

const BREAKAGE_DAYS_268           = 180;
const BREAKAGE_RATE_THRESHOLD_268 = 0.05;
const MS_PER_DAY_268              = 86_400_000;
const MATERIAL_RIGHT_DAYS_268     = 365; // credits with no expiry > 365d → material right flag
const ESCHEAT_THRESHOLD_DAYS_268  = { US: 1825, EU: 1095, UK: 1825, IN: 1095, KE: 730, NG: 730 };

function _dateBucket268() {
  return new Date().toISOString().slice(0, 10);
}

class BreakageEngine268 {
  constructor(opts = {}) {
    this._logger     = opts.logger     || console;
    this._auditLog   = opts.auditLog   || null;
    this._cohorts268 = new Map();
    this._recognized268 = [];
    this._materialRightFlags268 = [];
    this._escheatable268 = []; // cohorts that may be subject to escheat law
    this._breakageReserve268 = 0n; // recognized breakage in μ¢
  
    this._perf268 = { latencies: [] };
    this._logAdapter268 = opts.logAdapter || null;
  }

  recordIssuance268(accountId, amountMicro, cohortId = null, opts = {}) {
    const _t0 = Date.now();
    if (typeof amountMicro !== 'bigint') amountMicro = BigInt(amountMicro);
    const id = cohortId || _dateBucket268();
    if (!this._cohorts268.has(id)) {
      this._cohorts268.set(id, {
        cohortId: id,
        issuedMicro: 0n,
        redeemedMicro: 0n,
        issuedAt: new Date().toISOString(),
        accountIds: new Set(),
        noExpiry: !!opts.noExpiry,
        jurisdiction: opts.jurisdiction || null,
      });
    }
    const c = this._cohorts268.get(id);
    c.issuedMicro += amountMicro;
    c.accountIds.add(accountId);

    // Check for material right (no-expiry credits)
    if (c.noExpiry) {
      const existing = this._materialRightFlags268.find(m => m.cohortId === id);
      if (!existing) {
        this._materialRightFlags268.push({
          cohortId: id, flaggedAt: new Date().toISOString(),
          reason: 'credits_have_no_expiry',
          action: 'Consult legal for separate accounting treatment under ASC 606',
        });
      }
    }

    this._log268('ISSUANCE', { cohortId: id, accountId, amountMicro: amountMicro.toString() });
    this._recordLatency268(_t0);
    return { ok: true, cohortId: id };
  }

  recordRedemption268(accountId, amountMicro, cohortId = null) {
    if (typeof amountMicro !== 'bigint') amountMicro = BigInt(amountMicro);
    const id = cohortId || _dateBucket268();
    const c = this._cohorts268.get(id);
    if (!c) return { ok: false, error: `cohort ${id} not found` };
    c.redeemedMicro += amountMicro;
    return { ok: true, redeemedMicro: c.redeemedMicro.toString() };
  }

  /**
   * Run ASC 606 breakage scan.
   * Only recognizes breakage for cohorts where:
   *   - ≥ BREAKAGE_DAYS_268 days have elapsed
   *   - redemption rate < BREAKAGE_RATE_THRESHOLD_268
   */
  runBreakageScan268() {
    const now = Date.now();
    const recognized = [];
    const eligible   = [];
    const notYet     = [];

    for (const [id, c] of this._cohorts268) {
      const ageMs   = now - new Date(c.issuedAt).getTime();
      const ageDays = ageMs / MS_PER_DAY_268;

      if (ageDays < BREAKAGE_DAYS_268) {
        notYet.push({ cohortId: id, ageDays: Math.round(ageDays) });
        continue;
      }

      eligible.push(id);
      const issued   = Number(c.issuedMicro);
      const redeemed = Number(c.redeemedMicro);
      const rate     = issued > 0 ? redeemed / issued : 1;

      if (rate < BREAKAGE_RATE_THRESHOLD_268) {
        const unredeemed = c.issuedMicro - c.redeemedMicro;
        // Proportional method: recognize breakage proportional to historical redemption rate
        const breakageMicro = BigInt(Math.floor(Number(unredeemed) * (1 - rate)));
        this._breakageReserve268 += breakageMicro;
        const entry = {
          breakageId: 'brk268::' + crypto.randomBytes(6).toString('hex'),
          cohortId: id,
          issuedMicro: c.issuedMicro.toString(),
          redeemedMicro: c.redeemedMicro.toString(),
          breakageMicro: breakageMicro.toString(),
          redemptionRate: rate,
          ageDays: Math.round(ageDays),
          recognizedAt: new Date().toISOString(),
          method: 'proportional_asc606',
        };
        recognized.push(entry);
        this._recognized268.push(entry);
        this._log268('BREAKAGE_RECOGNIZED', entry);
        if (this._auditLog?.append) { try { this._auditLog.append({ event: 'breakageEngine268.recognized', ...entry }); } catch (_) {} }
      }

      // Escheat check
      if (c.jurisdiction && ESCHEAT_THRESHOLD_DAYS_268[c.jurisdiction]) {
        const escThresh = ESCHEAT_THRESHOLD_DAYS_268[c.jurisdiction];
        if (ageDays >= escThresh) {
          this._escheatable268.push({
            cohortId: id,
            jurisdiction: c.jurisdiction,
            ageDays: Math.round(ageDays),
            flaggedAt: new Date().toISOString(),
            action: 'Review unclaimed property law for jurisdiction: ' + c.jurisdiction,
          });
        }
      }
    }

    return {
      recognized,
      eligible:   eligible.length,
      notYet:     notYet.length,
      breakageReserve: this._breakageReserve268.toString(),
      materialRightFlags: this._materialRightFlags268.length,
      escheatable: this._escheatable268.length,
    };
  }

  getStatus268() {
    return {
      version: '268',
      totalCohorts: this._cohorts268.size,
      recognized: this._recognized268.length,
      breakageReserve: this._breakageReserve268.toString(),
      materialRightFlags: this._materialRightFlags268,
      escheatable: this._escheatable268,
      cohorts: [...this._cohorts268.values()].map(c => ({
        cohortId: c.cohortId,
        issuedMicro: c.issuedMicro.toString(),
        redeemedMicro: c.redeemedMicro.toString(),
        accountCount: c.accountIds.size,
        issuedAt: c.issuedAt,
        noExpiry: c.noExpiry,
        jurisdiction: c.jurisdiction,
      })),
    };
  }

  _log268(event, data) {
    const entry = { event, ...data, ts: new Date().toISOString(), _v: '268' };
    if (this._auditLog?.append) { try { this._auditLog.append(entry); } catch (_) {} }
  }

  // ── V268: Performance Telemetry ─────────────────────────────────────────────
  getPerf268() { return _calcPercentiles268(this._perf268.latencies); }

  _recordLatency268(t0) {
    const ms = Date.now() - t0;
    this._perf268.latencies.push(ms);
    if (this._perf268.latencies.length > 1000) this._perf268.latencies.shift();
  }

  // ── V268: Health Check ────────────────────────────────────────────────────
  checkBreakageHealth268() {
    return {
      ok: true,
      module: 'breakageEngine268 ASC-606 engine',
      version: '268',
      perf: this.getPerf268(),
      logAdapter: this._logAdapter268 ? { type: 'external', ok: true } : { type: 'none' },
    };
  }

}

const defaultBreakageEngine268 = new BreakageEngine268();


// ── V268 Performance Telemetry helper ────────────────────────────────────────
function _calcPercentiles268(arr) {
  if (!arr || arr.length === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  const p = (pct) => sorted[Math.min(Math.floor(n * pct / 100), n - 1)];
  return { p50: p(50), p95: p(95), p99: p(99), count: n };
}

module.exports = {
  BreakageEngine268,
  defaultBreakageEngine268,
  BREAKAGE_DAYS_268,
  BREAKAGE_RATE_THRESHOLD_268,
  MATERIAL_RIGHT_DAYS_268,
};
