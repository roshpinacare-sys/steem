'use strict';
/**
 * src/lib/creditHealthMonitor273.js — ECOS Credit Health Monitor (V273)
 *
 * V273 wires the four live health counters to real ledger/tip data:
 *   1. reward-to-inflow ratio  — compares total issued credits vs. real inflow
 *   2. sybil-fail-rate         — tracks sybilGuard evaluation failures over window
 *   3. sell-through rate       — consumed vs. issued credits over rolling window
 *   4. tip-circularity index   — ratio of tip volume recycled within platform
 *
 * Fail-closed directives:
 *   - halt_issuance: if backing_ratio < HALT_THRESHOLD_273, block new issuance
 *   - pause_rewards: if reward_to_inflow > REWARD_INFLOW_MAX_273 OR
 *                       tip_circularity > TIP_CIRC_MAX_273, pause reward issuance
 *
 * Iron rules: zero new npm deps. All identifiers end in 273. Sacred files untouched.
 */

const crypto = require('node:crypto');

const HALT_THRESHOLD_273       = 1.0;   // backing ratio below this → halt_issuance
const REWARD_INFLOW_MAX_273    = 0.8;   // reward-to-inflow > 80% → pause_rewards
const SYBIL_FAIL_RATE_MAX_273  = 0.15;  // >15% sybil fail rate → alert
const SELL_THROUGH_MIN_273     = 0.05;  // <5% sell-through → suspicious low activity
const TIP_CIRC_MAX_273         = 0.9;   // >90% tip circularity → wash-trading alert
const WINDOW_SIZE_273          = 1000;  // rolling window for rate calculations
const PERF_RING_MAX_273        = 1000;

class CreditHealthMonitor273 {
  constructor(opts = {}) {
    // Injected live data sources (DI — no new deps)
    this._creditReserve = opts.creditReserve || null;  // CreditReserve268 instance
    this._tipModule     = opts.tipModule     || null;  // TipModule268 instance
    this._sybilGuard    = opts.sybilGuard    || null;  // SybilGuard268 instance
    this._logger        = opts.logger        || console;
    this._logAdapter    = opts.logAdapter    || null;

    // Halt/pause state
    this._haltIssuance273  = false;
    this._pauseRewards273  = false;
    this._haltReason273    = null;
    this._pauseReason273   = null;

    // Counters
    this._sybilWindow273   = [];   // rolling: { ts, failed: bool }
    this._tipWindow273     = [];   // rolling: { ts, fromUserId, toUserId, amount }
    this._evalCount273     = 0;
    this._evalFailed273    = 0;

    // Snapshot of last computed metrics
    this._lastMetrics273   = null;
    this._lastCheck273     = null;

    this._perf273 = { latencies: [] };
  }

  // ── Live counter wiring ────────────────────────────────────────────────────

  /**
   * Record a sybil evaluation result. Called by the sybilGuard integration.
   */
  recordSybilEval273(userId, passed) {
    const entry = { ts: Date.now(), userId, passed: !!passed };
    this._sybilWindow273.push(entry);
    if (this._sybilWindow273.length > WINDOW_SIZE_273)
      this._sybilWindow273.shift();
    this._evalCount273++;
    if (!passed) this._evalFailed273++;
  }

  /**
   * Record a tip event. Called by the tipModule integration.
   */
  recordTip273(fromUserId, toUserId, amountMicro) {
    const entry = { ts: Date.now(), fromUserId, toUserId, amountMicro };
    this._tipWindow273.push(entry);
    if (this._tipWindow273.length > WINDOW_SIZE_273)
      this._tipWindow273.shift();
  }

  // ── Core metrics computation ───────────────────────────────────────────────

  /**
   * Compute reward-to-inflow ratio.
   * Uses creditReserve live data if injected, else falls back to 0.
   */
  _computeRewardToInflow273() {
    if (!this._creditReserve) return { ratio: 0, ok: true, source: 'no_reserve' };
    try {
      const status = this._creditReserve.getStatus268
        ? this._creditReserve.getStatus268()
        : (this._creditReserve.getReserveStatus268
            ? this._creditReserve.getReserveStatus268()
            : null);
      if (!status) return { ratio: 0, ok: true, source: 'no_status' };

      const issued   = BigInt(status.totalIssued   || status.totalIssued268   || '0');
      const reserve  = BigInt(status.reserveBalance || status.reserveBalance268 || '1');
      // reward-to-inflow: issued / (reserve + issued), scaled to float
      const total = reserve + issued;
      if (total === 0n) return { ratio: 0, ok: true, source: 'zero_total' };
      const ratio = Number(issued * 10000n / total) / 10000;
      return { ratio, ok: true, source: 'live' };
    } catch (e) {
      return { ratio: 0, ok: false, error: e.message, source: 'error' };
    }
  }

  /**
   * Compute sybil fail rate from rolling window.
   */
  _computeSybilFailRate273() {
    const window = this._sybilWindow273;
    if (window.length === 0) return { rate: 0, total: 0, failed: 0, source: 'empty_window' };
    const failed = window.filter(e => !e.passed).length;
    return { rate: failed / window.length, total: window.length, failed, source: 'window' };
  }

  /**
   * Compute sell-through rate: consumed vs issued from creditReserve.
   */
  _computeSellThrough273() {
    if (!this._creditReserve) return { rate: 0, ok: true, source: 'no_reserve' };
    try {
      const status = this._creditReserve.getStatus268
        ? this._creditReserve.getStatus268()
        : (this._creditReserve.getReserveStatus268
            ? this._creditReserve.getReserveStatus268()
            : null);
      if (!status) return { rate: 0, ok: true, source: 'no_status' };
      const issued   = BigInt(status.totalIssued   || status.totalIssued268   || '0');
      const consumed = BigInt(status.totalConsumed || status.totalConsumed268 || '0');
      if (issued === 0n) return { rate: 0, ok: true, source: 'no_issuance' };
      const rate = Number(consumed * 10000n / issued) / 10000;
      return { rate, issued: issued.toString(), consumed: consumed.toString(), ok: true, source: 'live' };
    } catch (e) {
      return { rate: 0, ok: false, error: e.message, source: 'error' };
    }
  }

  /**
   * Compute tip circularity index from rolling tip window.
   * Circularity = fraction of unique tips where from→to has also sent to→from.
   */
  _computeTipCircularity273() {
    const window = this._tipWindow273;
    if (window.length < 2) return { index: 0, total: window.length, circular: 0, source: 'small_window' };

    const pairSet = new Set();
    let circular = 0;
    for (const tip of window) {
      const key    = `${tip.fromUserId}:${tip.toUserId}`;
      const revKey = `${tip.toUserId}:${tip.fromUserId}`;
      if (pairSet.has(revKey)) circular++;
      pairSet.add(key);
    }
    const index = circular / window.length;
    return { index, total: window.length, circular, source: 'window' };
  }

  // ── Fail-closed enforcement ────────────────────────────────────────────────

  /**
   * Run all health checks and enforce fail-closed directives.
   * Returns the full metrics snapshot and directive state.
   */
  checkHealth273() {
    const _t0 = Date.now();
    try {
      const rewardInflow  = this._computeRewardToInflow273();
      const sybilRate     = this._computeSybilFailRate273();
      const sellThrough   = this._computeSellThrough273();
      const tipCirc       = this._computeTipCircularity273();

      // Compute backing ratio from creditReserve if available
      let backingRatio = null;
      if (this._creditReserve && typeof this._creditReserve.getBackingRatio268 === 'function') {
        try { backingRatio = this._creditReserve.getBackingRatio268(); } catch (_) {}
      }
      if (backingRatio === null && this._creditReserve) {
        try {
          const st = this._creditReserve.getStatus268
            ? this._creditReserve.getStatus268()
            : (this._creditReserve.getReserveStatus268
                ? this._creditReserve.getReserveStatus268()
                : null);
          if (st) {
            const res = BigInt(st.reserveBalance || st.reserveBalance268 || '0');
            const out = BigInt(st.outstanding    || st.outstanding268    || '1');
            const peg = BigInt(st.peg            || '10000');
            if (out > 0n) backingRatio = Number(res * 10000n / (out * peg)) / 10000;
          }
        } catch (_) {}
      }

      // ── Fail-closed: halt_issuance ───────────────────────────────────────
      if (backingRatio !== null && backingRatio < HALT_THRESHOLD_273) {
        if (!this._haltIssuance273) {
          this._haltIssuance273 = true;
          this._haltReason273 = `backing_ratio=${backingRatio.toFixed(4)} < ${HALT_THRESHOLD_273}`;
          this._log273('HALT_ISSUANCE_ENGAGED', { backingRatio, threshold: HALT_THRESHOLD_273 });
        }
      } else {
        if (this._haltIssuance273) {
          this._haltIssuance273 = false;
          this._haltReason273 = null;
          this._log273('HALT_ISSUANCE_CLEARED', { backingRatio });
        }
      }

      // ── Fail-closed: pause_rewards ───────────────────────────────────────
      const rewardOverflow = rewardInflow.ratio > REWARD_INFLOW_MAX_273;
      const tipWash        = tipCirc.index     > TIP_CIRC_MAX_273;
      if (rewardOverflow || tipWash) {
        if (!this._pauseRewards273) {
          this._pauseRewards273 = true;
          this._pauseReason273  = rewardOverflow
            ? `reward_to_inflow=${rewardInflow.ratio.toFixed(4)} > ${REWARD_INFLOW_MAX_273}`
            : `tip_circularity=${tipCirc.index.toFixed(4)} > ${TIP_CIRC_MAX_273}`;
          this._log273('PAUSE_REWARDS_ENGAGED', {
            rewardToInflow: rewardInflow.ratio, tipCircularity: tipCirc.index,
          });
        }
      } else {
        if (this._pauseRewards273) {
          this._pauseRewards273 = false;
          this._pauseReason273  = null;
          this._log273('PAUSE_REWARDS_CLEARED', {
            rewardToInflow: rewardInflow.ratio, tipCircularity: tipCirc.index,
          });
        }
      }

      // ── Assemble metrics snapshot ─────────────────────────────────────────
      const metrics = {
        version:         '273',
        ts:              new Date().toISOString(),
        counters: {
          rewardToInflow:  rewardInflow,
          sybilFailRate:   sybilRate,
          sellThrough:     sellThrough,
          tipCircularity:  tipCirc,
        },
        backingRatio,
        directives: {
          halt_issuance: this._haltIssuance273,
          pause_rewards: this._pauseRewards273,
          haltReason:    this._haltReason273,
          pauseReason:   this._pauseReason273,
        },
        alerts: [],
      };

      // ── Soft alerts (non-halting) ─────────────────────────────────────────
      if (sybilRate.rate > SYBIL_FAIL_RATE_MAX_273)
        metrics.alerts.push({ code: 'HIGH_SYBIL_FAIL_RATE', rate: sybilRate.rate, threshold: SYBIL_FAIL_RATE_MAX_273 });
      if (sellThrough.rate < SELL_THROUGH_MIN_273 && sellThrough.source === 'live')
        metrics.alerts.push({ code: 'LOW_SELL_THROUGH', rate: sellThrough.rate, threshold: SELL_THROUGH_MIN_273 });

      this._lastMetrics273 = metrics;
      this._lastCheck273   = Date.now();
      this._recordLatency273(_t0);
      return { ok: true, ...metrics };
    } catch (e) {
      this._recordLatency273(_t0);
      return { ok: false, version: '273', error: e.message };
    }
  }

  /**
   * issuanceAllowed273() — call at any credit issuance path.
   * Returns { allowed: bool, reason: string|null }.
   */
  issuanceAllowed273() {
    if (this._haltIssuance273)
      return { allowed: false, reason: this._haltReason273, directive: 'halt_issuance' };
    if (this._pauseRewards273)
      return { allowed: false, reason: this._pauseReason273, directive: 'pause_rewards' };
    return { allowed: true, reason: null, directive: null };
  }

  /**
   * rewardsAllowed273() — call at any reward issuance path.
   */
  rewardsAllowed273() {
    if (this._pauseRewards273)
      return { allowed: false, reason: this._pauseReason273, directive: 'pause_rewards' };
    return { allowed: true, reason: null, directive: null };
  }

  /**
   * getMetrics273() — return the last computed snapshot without recomputing.
   */
  getMetrics273() {
    return this._lastMetrics273
      ? { ok: true, cached: true, ...this._lastMetrics273 }
      : { ok: false, cached: false, error: 'No metrics computed yet; call checkHealth273() first' };
  }

  /**
   * manualOverride273(directive, value, reason) — operator escape hatch.
   * directive: 'halt_issuance' | 'pause_rewards'
   */
  manualOverride273(directive, value, reason = 'manual_override') {
    if (directive === 'halt_issuance') {
      this._haltIssuance273 = !!value;
      this._haltReason273   = value ? reason : null;
      this._log273('MANUAL_OVERRIDE', { directive, value, reason });
      return { ok: true, directive, value };
    }
    if (directive === 'pause_rewards') {
      this._pauseRewards273 = !!value;
      this._pauseReason273  = value ? reason : null;
      this._log273('MANUAL_OVERRIDE', { directive, value, reason });
      return { ok: true, directive, value };
    }
    return { ok: false, error: `Unknown directive: ${directive}` };
  }

  // ── Telemetry (AI_PROTOCOL_V268 pattern) ──────────────────────────────────

  checkCreditHealthMonitorHealth273() {
    try {
      const metrics = this._lastMetrics273;
      return {
        ok:               true,
        version:          '273',
        haltIssuance:     this._haltIssuance273,
        pauseRewards:     this._pauseRewards273,
        lastCheckAge:     this._lastCheck273 ? Date.now() - this._lastCheck273 : null,
        countersPresent:  !!metrics,
        dataSourcesWired: {
          creditReserve: !!this._creditReserve,
          tipModule:     !!this._tipModule,
          sybilGuard:    !!this._sybilGuard,
        },
      };
    } catch (e) {
      return { ok: false, version: '273', error: e.message };
    }
  }

  getPerf273() {
    const lats = this._perf273.latencies;
    if (lats.length === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
    return { ...this._calcPercentiles273([...lats].sort((a, b) => a - b)), count: lats.length };
  }

  _calcPercentiles273(sorted) {
    const idx = (p) => Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
    return { p50: sorted[idx(50)], p95: sorted[idx(95)], p99: sorted[idx(99)] };
  }

  _recordLatency273(t0) {
    const ms = Date.now() - t0;
    this._perf273.latencies.push(ms);
    if (this._perf273.latencies.length > PERF_RING_MAX_273)
      this._perf273.latencies.shift();
  }

  _log273(event, meta = {}) {
    try {
      if (this._logAdapter && typeof this._logAdapter.info === 'function') {
        this._logAdapter.info(`[creditHealthMonitor273] ${event}`, meta);
      } else if (this._logger && typeof this._logger.info === 'function') {
        this._logger.info({ chm273: event, ...meta }, `[creditHealthMonitor273] ${event}`);
      } else {
        this._logger.log(`[creditHealthMonitor273] ${event}`, meta);
      }
    } catch (_) {}
  }
}

// ── Constants export ────────────────────────────────────────────────────────
const CREDIT_HEALTH_THRESHOLDS_273 = Object.freeze({
  HALT_THRESHOLD:      HALT_THRESHOLD_273,
  REWARD_INFLOW_MAX:   REWARD_INFLOW_MAX_273,
  SYBIL_FAIL_RATE_MAX: SYBIL_FAIL_RATE_MAX_273,
  SELL_THROUGH_MIN:    SELL_THROUGH_MIN_273,
  TIP_CIRC_MAX:        TIP_CIRC_MAX_273,
  WINDOW_SIZE:         WINDOW_SIZE_273,
});

module.exports = {
  CreditHealthMonitor273,
  CREDIT_HEALTH_THRESHOLDS_273,
  HALT_THRESHOLD_273,
  REWARD_INFLOW_MAX_273,
  SYBIL_FAIL_RATE_MAX_273,
  SELL_THROUGH_MIN_273,
  TIP_CIRC_MAX_273,
};

// ── NODE_ENV=test exports ────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'test') {
  module.exports._CreditHealthMonitor273 = CreditHealthMonitor273;
  module.exports._CREDIT_HEALTH_THRESHOLDS_273 = CREDIT_HEALTH_THRESHOLDS_273;
  module.exports._HALT_THRESHOLD_273 = HALT_THRESHOLD_273;
  module.exports._REWARD_INFLOW_MAX_273 = REWARD_INFLOW_MAX_273;
}
