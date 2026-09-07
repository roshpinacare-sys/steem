'use strict';
/**
 * src/lib/marketMaker322.js — ECOS V322 (Phase P210) — MAE Trend Alerting,
 *                              Severity Anomaly Burst Detection, Cluster Stability Tracking,
 *                              Regime Transition Matrix
 *
 * Four additive components that extend the V321 analytical layer:
 *
 *   1. AuditCapTrail322 — auditCapForecastMAEAlert322(threshold, maxEntries)
 *      Extends the V321 MAE tracker to emit an alert flag when the MAE exceeds a
 *      configurable threshold, indicating the forecast model has degraded.
 *
 *   2. PageRangeDiffBridge322 — pagedDiffSeverityBurstDetect322(...)
 *      Extends the severity trend (V321) to detect a "burst" when severity delta
 *      crosses a high-water mark within a short rolling window.
 *
 *   3. RankedOverlapBuffer322 — semanticClusterStability322(tokensA, tokensB, threshold)
 *      Compares two consecutive semanticClusterDiscovery321 results and returns a diff:
 *      which tokens moved clusters, merged, or split.
 *
 *   4. NormDeltaPercentilesTracker322 — trendNormDeltaRegimeTransitionMatrix322(...)
 *      Tracks the full transition history of regime changes and returns a matrix
 *      counting how often each regime transitions to another.
 *
 * Sacred files untouched (R1). All new identifiers end in `322` (R2).
 * Zero new npm deps (R3). V287..V321 surfaces preserved (R6).
 * lib/ mirrors src/lib/. package.json bumped to 322.0.0.
 *
 * @version 322.0.0
 */

const V321 = require('./marketMaker321.js');

const MM_VERSION_322 = '322.0.0';

function _coercePositiveInt322(value, fallback322) {
  const n322 = Number(value);
  if (!Number.isFinite(n322) || !Number.isInteger(n322) || n322 < 1) return fallback322;
  return n322;
}

function _coercePositiveFloat322(value, fallback322) {
  const f322 = Number(value);
  if (!Number.isFinite(f322) || f322 <= 0) return fallback322;
  return f322;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) AuditCapTrail322
//    Extends AuditCapTrail321 with MAE threshold alerting.
// ─────────────────────────────────────────────────────────────────────────────

class AuditCapTrail322 extends V321.AuditCapTrail321 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * auditCapForecastMAEAlert322(threshold, maxEntries)
   * Compute the rolling MAE (via auditCapForecastMAE321) and emit an `alert` flag
   * when the MAE exceeds the given threshold.
   *
   * @param {number} threshold   — MAE value above which `alert` is set to `true`
   * @param {number} [maxEntries] — how many recent entries to include (default: all)
   * @returns {{ ok, mae, entries, count, alert, threshold, alertMessage, version }}
   */
  auditCapForecastMAEAlert322(threshold, maxEntries) {
    const thresh322 = _coercePositiveFloat322(threshold, Infinity);
    const base322 = this.auditCapForecastMAE321(maxEntries);
    if (!base322.ok) {
      return Object.assign({}, base322, {
        alert: false,
        threshold: thresh322,
        version: MM_VERSION_322,
      });
    }
    const alert322 = base322.mae > thresh322;
    const alertMessage322 = alert322
      ? `MAE ${base322.mae.toFixed(6)} exceeds threshold ${thresh322}`
      : null;
    return Object.assign({}, base322, {
      alert: alert322,
      threshold: thresh322,
      alertMessage: alertMessage322,
      version: MM_VERSION_322,
    });
  }

  stats() {
    const base322 = super.stats();
    return Object.assign({}, base322, { version: MM_VERSION_322 });
  }
}

let _defaultAuditCapTrail322 = null;
function defaultAuditCapTrail322(opts) {
  if (!_defaultAuditCapTrail322 || opts) {
    _defaultAuditCapTrail322 = new AuditCapTrail322(opts || {});
  }
  return _defaultAuditCapTrail322;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) PageRangeDiffBridge322
//    Extends PageRangeDiffBridge321 with severity anomaly burst detection.
// ─────────────────────────────────────────────────────────────────────────────

class PageRangeDiffBridge322 extends V321.PageRangeDiffBridge321 {
  constructor(opts = {}) {
    super(opts);
    // Rolling window of severity deltas for burst detection
    this._severityDeltaWindow322 = [];
    this._highWaterMark322 = -Infinity;
  }

  /**
   * pagedDiffSeverityBurstDetect322(from, to, startPage, endPage, pageSize,
   *                                  stdFactor, compareFrom, compareTo,
   *                                  compareStartPage, compareEndPage,
   *                                  trendThreshold, burstWindowSize, burstThresholdFactor)
   *
   * Calls pagedDiffCompoundSeverityTrend321 to get the current severityDelta, then:
   *  - Maintains a rolling window of the last `burstWindowSize` delta values.
   *  - Updates the high-water mark if the new delta exceeds it.
   *  - Detects a "burst" when the current delta exceeds the rolling mean by more
   *    than `burstThresholdFactor` standard deviations within the window.
   *
   * @param {number} [burstWindowSize]      — rolling window size (default: 5)
   * @param {number} [burstThresholdFactor] — std-dev multiplier for burst (default: 2.0)
   * @returns {{ ok, ...(trend result), burst, burstScore, highWaterMark, windowSize, version }}
   */
  pagedDiffSeverityBurstDetect322(
    from, to, startPage, endPage, pageSize, stdFactor,
    compareFrom, compareTo, compareStartPage, compareEndPage,
    trendThreshold, burstWindowSize, burstThresholdFactor
  ) {
    const trend322 = this.pagedDiffCompoundSeverityTrend321(
      from, to, startPage, endPage, pageSize, stdFactor,
      compareFrom, compareTo, compareStartPage, compareEndPage,
      trendThreshold
    );

    const winSize322  = _coercePositiveInt322(burstWindowSize, 5);
    const burstFactor322 = _coercePositiveFloat322(burstThresholdFactor, 2.0);

    // Only track when we have a valid delta
    const delta322 = trend322.severityDelta;
    let burst322 = false;
    let burstScore322 = null;

    if (delta322 !== null && Number.isFinite(delta322)) {
      // Update rolling window
      this._severityDeltaWindow322.push(delta322);
      if (this._severityDeltaWindow322.length > winSize322) {
        this._severityDeltaWindow322.shift();
      }
      // Update high-water mark
      if (delta322 > this._highWaterMark322) {
        this._highWaterMark322 = delta322;
      }
      // Burst detection: compare delta to window statistics
      const win322 = this._severityDeltaWindow322;
      if (win322.length >= 2) {
        const mean322 = win322.reduce((s, v) => s + v, 0) / win322.length;
        const variance322 = win322.reduce((s, v) => s + (v - mean322) ** 2, 0) / win322.length;
        const stdDev322 = Math.sqrt(variance322);
        if (stdDev322 > 0) {
          burstScore322 = (delta322 - mean322) / stdDev322;
          burst322 = burstScore322 > burstFactor322;
        }
      }
    }

    return Object.assign({}, trend322, {
      burst: burst322,
      burstScore: burstScore322,
      highWaterMark: Number.isFinite(this._highWaterMark322) ? this._highWaterMark322 : null,
      windowSize: this._severityDeltaWindow322.length,
      burstThresholdFactor: burstFactor322,
      version: MM_VERSION_322,
    });
  }

  /**
   * resetBurstWindow322()
   * Reset the rolling window and high-water mark.
   */
  resetBurstWindow322() {
    this._severityDeltaWindow322 = [];
    this._highWaterMark322 = -Infinity;
    return { ok: true, version: MM_VERSION_322 };
  }

  stats() {
    const base322 = super.stats();
    return Object.assign({}, base322, { version: MM_VERSION_322 });
  }
}

let _defaultPageRangeDiffBridge322 = null;
function defaultPageRangeDiffBridge322(opts) {
  if (!_defaultPageRangeDiffBridge322 || opts) {
    _defaultPageRangeDiffBridge322 = new PageRangeDiffBridge322(opts || {});
  }
  return _defaultPageRangeDiffBridge322;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) RankedOverlapBuffer322
//    Extends RankedOverlapBuffer321 with cluster stability tracking.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * _clusterMap322(clusters)
 * Build a token → cluster-index map for quick lookup.
 * @param {string[][]} clusters
 * @returns {Map<string, number>}
 */
function _clusterMap322(clusters) {
  const map322 = new Map();
  clusters.forEach((cluster322, idx322) => {
    cluster322.forEach(token322 => { map322.set(token322, idx322); });
  });
  return map322;
}

class RankedOverlapBuffer322 extends V321.RankedOverlapBuffer321 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * semanticClusterStability322(tokensA, tokensB, threshold)
   *
   * Compares two sets of tokens by running semanticClusterDiscovery321 on each,
   * then computing a stability diff:
   *  - `moved`: tokens that appear in both sets but are in a different cluster index.
   *  - `stable`: tokens that appear in both sets and remain in the same cluster index.
   *  - `added`:  tokens present in B but not in A.
   *  - `removed`: tokens present in A but not in B.
   *  - `stabilityScore`: fraction of shared tokens that stayed in the same cluster (0–1).
   *
   * @param {string[]} tokensA  — baseline cluster set
   * @param {string[]} tokensB  — comparison cluster set
   * @param {number}   [threshold] — Jaccard threshold forwarded to cluster discovery (default 0.1)
   * @returns {{ ok, clustersA, clustersB, stable, moved, added, removed,
   *             stabilityScore, sharedCount, version }}
   */
  semanticClusterStability322(tokensA, tokensB, threshold) {
    const resultA322 = this.semanticClusterDiscovery321(tokensA, threshold);
    if (!resultA322.ok) {
      return Object.assign({}, resultA322, { version: MM_VERSION_322 });
    }
    const resultB322 = this.semanticClusterDiscovery321(tokensB, threshold);
    if (!resultB322.ok) {
      return Object.assign({}, resultB322, { version: MM_VERSION_322 });
    }

    const mapA322 = _clusterMap322(resultA322.clusters);
    const mapB322 = _clusterMap322(resultB322.clusters);

    const setA322 = new Set(resultA322.tokens);
    const setB322 = new Set(resultB322.tokens);

    const moved322  = [];
    const stable322 = [];

    // Shared tokens: compare cluster membership
    setA322.forEach(token322 => {
      if (setB322.has(token322)) {
        const clA322 = mapA322.get(token322);
        const clB322 = mapB322.get(token322);
        // Same cluster root index → stable; else moved
        if (clA322 === clB322) {
          stable322.push(token322);
        } else {
          moved322.push({ token: token322, fromCluster: clA322, toCluster: clB322 });
        }
      }
    });

    const added322   = [...setB322].filter(t => !setA322.has(t));
    const removed322 = [...setA322].filter(t => !setB322.has(t));

    const sharedCount322 = stable322.length + moved322.length;
    const stabilityScore322 = sharedCount322 > 0 ? stable322.length / sharedCount322 : 1;

    return {
      ok: true,
      clustersA: resultA322.clusters,
      clustersB: resultB322.clusters,
      stable: stable322,
      moved: moved322,
      added: added322,
      removed: removed322,
      stabilityScore: stabilityScore322,
      sharedCount: sharedCount322,
      version: MM_VERSION_322,
    };
  }

  stats() {
    const base322 = typeof super.stats === 'function' ? super.stats() : {};
    return Object.assign({}, base322, { version: MM_VERSION_322 });
  }
}

let _defaultRankedOverlapBuffer322 = null;
function defaultRankedOverlapBuffer322(opts) {
  if (!_defaultRankedOverlapBuffer322 || opts) {
    _defaultRankedOverlapBuffer322 = new RankedOverlapBuffer322(opts || {});
  }
  return _defaultRankedOverlapBuffer322;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) NormDeltaPercentilesTracker322
//    Extends NormDeltaPercentilesTracker321 with regime transition matrix.
// ─────────────────────────────────────────────────────────────────────────────

// Known regimes (from V320)
const REGIME_VALUES_322 = ['increasing', 'decreasing', 'stable'];

class NormDeltaPercentilesTracker322 extends V321.NormDeltaPercentilesTracker321 {
  constructor(opts = {}) {
    super(opts);
    // Transition matrix: { fromRegime: { toRegime: count } }
    this._transitionMatrix322 = {};
    this._lastTrackedRegime322 = null;
  }

  /**
   * trendNormDeltaRegimeTransitionMatrix322(source, windowMs, buckets, baseline,
   *                                          thresholds, compareWindowMs, regimeThresholds)
   *
   * Calls trendNormDeltaRegimeDuration321 to get the current regime, then:
   *  - Records regime transitions into an internal matrix.
   *  - Returns the current regime info plus the full transition matrix.
   *
   * @returns {{ ok, regime, regimeDuration, regimeChanged, transitionMatrix,
   *             totalTransitions, version }}
   */
  trendNormDeltaRegimeTransitionMatrix322(
    source, windowMs, buckets, baseline, thresholds, compareWindowMs, regimeThresholds
  ) {
    const base322 = this.trendNormDeltaRegimeDuration321(
      source, windowMs, buckets, baseline, thresholds, compareWindowMs, regimeThresholds
    );
    if (!base322.ok) {
      return Object.assign({}, base322, { version: MM_VERSION_322 });
    }

    const currentRegime322 = base322.regime;

    // Record transition if we had a previous regime
    if (this._lastTrackedRegime322 !== null && this._lastTrackedRegime322 !== currentRegime322) {
      const from322 = this._lastTrackedRegime322;
      const to322   = currentRegime322;
      if (!this._transitionMatrix322[from322]) {
        this._transitionMatrix322[from322] = {};
      }
      this._transitionMatrix322[from322][to322] =
        (this._transitionMatrix322[from322][to322] || 0) + 1;
    }
    this._lastTrackedRegime322 = currentRegime322;

    // Count total transitions
    let total322 = 0;
    Object.values(this._transitionMatrix322).forEach(row322 => {
      Object.values(row322).forEach(count322 => { total322 += count322; });
    });

    return Object.assign({}, base322, {
      transitionMatrix: this._transitionMatrix322,
      totalTransitions: total322,
      version: MM_VERSION_322,
    });
  }

  /**
   * resetTransitionMatrix322()
   * Reset the transition matrix and last-tracked regime.
   */
  resetTransitionMatrix322() {
    this._transitionMatrix322    = {};
    this._lastTrackedRegime322   = null;
    return { ok: true, version: MM_VERSION_322 };
  }

  stats() {
    const base322 = super.stats();
    return Object.assign({}, base322, { version: MM_VERSION_322 });
  }
}

let _defaultNormDeltaPercentilesTracker322 = null;
function defaultNormDeltaPercentilesTracker322(opts) {
  if (!_defaultNormDeltaPercentilesTracker322 || opts) {
    _defaultNormDeltaPercentilesTracker322 = new NormDeltaPercentilesTracker322(opts || {});
  }
  return _defaultNormDeltaPercentilesTracker322;
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint registration helper
// ─────────────────────────────────────────────────────────────────────────────

function registerV322Endpoints(app) {
  const trail322   = defaultAuditCapTrail322();
  const bridge322  = defaultPageRangeDiffBridge322();
  const buffer322  = defaultRankedOverlapBuffer322();
  const tracker322 = defaultNormDeltaPercentilesTracker322();

  // 1. GET MAE alert
  app.get(
    '/api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v322/aggregate/db/hydrate/audit/cap/forecast/mae/alert',
    (req, res) => {
      try {
        const threshold322  = req.query.threshold  ? Number(req.query.threshold)  : Infinity;
        const maxEntries322 = req.query.maxEntries ? Number(req.query.maxEntries) : undefined;
        res.json(trail322.auditCapForecastMAEAlert322(threshold322, maxEntries322));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_322 });
      }
    }
  );

  // 2. GET severity burst detection
  app.get(
    '/api/v1/market/alerts/suppress/config/v322/diff/audit/filter/paged/range/outliers/severity/burst',
    (req, res) => {
      try {
        const from322        = Number(req.query.from);
        const to322          = Number(req.query.to);
        const startPage322   = req.query.startPage   ? Number(req.query.startPage)   : 1;
        const endPage322     = req.query.endPage     ? Number(req.query.endPage)     : startPage322;
        const pageSize322    = req.query.pageSize    ? Number(req.query.pageSize)    : 20;
        const stdFactor322   = req.query.stdFactor   ? Number(req.query.stdFactor)   : 2.0;
        const cFrom322       = req.query.compareFrom  !== undefined ? Number(req.query.compareFrom)  : from322;
        const cTo322         = req.query.compareTo    !== undefined ? Number(req.query.compareTo)    : to322;
        const cStart322      = req.query.compareStartPage !== undefined ? Number(req.query.compareStartPage) : startPage322;
        const cEnd322        = req.query.compareEndPage   !== undefined ? Number(req.query.compareEndPage)   : endPage322;
        const thresh322      = req.query.trendThreshold ? Number(req.query.trendThreshold) : 0.01;
        const winSize322     = req.query.burstWindowSize      ? Number(req.query.burstWindowSize)      : 5;
        const burstFactor322 = req.query.burstThresholdFactor ? Number(req.query.burstThresholdFactor) : 2.0;
        res.json(bridge322.pagedDiffSeverityBurstDetect322(
          from322, to322, startPage322, endPage322, pageSize322, stdFactor322,
          cFrom322, cTo322, cStart322, cEnd322, thresh322, winSize322, burstFactor322
        ));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_322 });
      }
    }
  );

  // 3. POST cluster stability comparison
  app.post(
    '/api/v1/market/backtest/sessions/v322/snapshot/search/ranked/semantic/clusters/stability',
    (req, res) => {
      try {
        const tokensA322   = req.body ? req.body.tokensA   : undefined;
        const tokensB322   = req.body ? req.body.tokensB   : undefined;
        const threshold322 = req.body ? req.body.threshold : undefined;
        res.json(buffer322.semanticClusterStability322(tokensA322, tokensB322, threshold322));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_322 });
      }
    }
  );

  // 4. GET regime transition matrix
  app.get(
    '/api/v1/contracts/receipts/v322/histogram/rolling/percentiles/trend/delta/cumulative/norm/volatility/regime/transition/matrix',
    (req, res) => {
      try {
        const source322   = req.query.source   || '';
        const windowMs322 = req.query.windowMs ? Number(req.query.windowMs) : 60000;
        const buckets322  = req.query.buckets  ? Number(req.query.buckets)  : 5;
        const baseline322 = req.query.baseline !== undefined ? Number(req.query.baseline) : 0;
        const elevated322 = req.query.elevated ? Number(req.query.elevated) : 1.5;
        const spike322    = req.query.spike    ? Number(req.query.spike)    : 3.0;
        const cmpWMs322   = req.query.compareWindowMs ? Number(req.query.compareWindowMs) : undefined;
        const incThr322   = req.query.increasing ? Number(req.query.increasing) : 0.05;
        const decThr322   = req.query.decreasing ? Number(req.query.decreasing) : 0.05;
        res.json(tracker322.trendNormDeltaRegimeTransitionMatrix322(
          source322, windowMs322, buckets322, baseline322,
          { elevated: elevated322, spike: spike322 },
          cmpWMs322,
          { increasing: incThr322, decreasing: decThr322 }
        ));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_322 });
      }
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  MM_VERSION_322,
  REGIME_VALUES_322,
  _coercePositiveInt322,
  _coercePositiveFloat322,
  _clusterMap322,
  AuditCapTrail322,
  defaultAuditCapTrail322,
  PageRangeDiffBridge322,
  defaultPageRangeDiffBridge322,
  RankedOverlapBuffer322,
  defaultRankedOverlapBuffer322,
  NormDeltaPercentilesTracker322,
  defaultNormDeltaPercentilesTracker322,
  registerV322Endpoints,
};
