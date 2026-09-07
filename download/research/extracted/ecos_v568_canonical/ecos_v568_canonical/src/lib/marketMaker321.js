'use strict';
/**
 * src/lib/marketMaker321.js — ECOS V321 (Phase P209) — Forecast Accuracy Tracking,
 *                              Outlier Trend Detection, Semantic Cluster Discovery,
 *                              Regime Duration Tracking
 *
 * Four additive components that extend the V320 analytical layer:
 *
 *   1. AuditCapTrail321 — auditCapForecastMAE321()
 *      Tracks actual vs. predicted cap values for the last N completed forecasts
 *      and returns a rolling Mean Absolute Error (MAE) alongside per-entry residuals.
 *
 *   2. PageRangeDiffBridge321 — pagedDiffCompoundSeverityTrend321(...)
 *      Runs two consecutive compound-severity queries and flags whether compound
 *      severity is increasing, decreasing, or stable between the two windows.
 *
 *   3. RankedOverlapBuffer321 — semanticClusterDiscovery321(tokens, threshold)
 *      Uses the V320 Jaccard similarity matrix to find connected components of
 *      tokens where all pairwise Jaccard scores exceed a given threshold.
 *
 *   4. NormDeltaPercentilesTracker321 — trendNormDeltaRegimeDuration321(...)
 *      Extends the V320 regime classifier with a `regimeDuration` counter that
 *      increments each time the regime stays the same and resets on change.
 *
 * Sacred files untouched (R1). All new identifiers end in `321` (R2).
 * Zero new npm deps (R3). V287..V320 surfaces preserved (R6).
 * lib/ mirrors src/lib/. package.json bumped to 321.0.0.
 *
 * @version 321.0.0
 */

const V320 = require('./marketMaker320.js');
const V319 = require('./marketMaker319.js');

const MM_VERSION_321 = '321.0.0';

function _coercePositiveInt321(value, fallback321) {
  const n321 = Number(value);
  if (!Number.isFinite(n321) || !Number.isInteger(n321) || n321 < 1) return fallback321;
  return n321;
}

function _coercePositiveFloat321(value, fallback321) {
  const f321 = Number(value);
  if (!Number.isFinite(f321) || f321 <= 0) return fallback321;
  return f321;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) AuditCapTrail321
//    Extends AuditCapTrail320 with forecast accuracy (rolling MAE) tracking.
// ─────────────────────────────────────────────────────────────────────────────

class AuditCapTrail321 extends V320.AuditCapTrail320 {
  constructor(opts = {}) {
    super(opts);
    // Registry of {predicted, actual} pairs recorded via recordActual321()
    this._forecastActuals321 = [];
  }

  /**
   * recordActual321(step, predictedCap, actualCap)
   * Register one actual observation against a forecast prediction.
   * @param {number} step
   * @param {number} predictedCap
   * @param {number} actualCap
   * @returns {{ ok, step, predictedCap, actualCap, absError, version }}
   */
  recordActual321(step, predictedCap, actualCap) {
    const s321  = _coercePositiveInt321(step, 1);
    const p321  = Number(predictedCap);
    const a321  = Number(actualCap);
    if (!Number.isFinite(p321) || !Number.isFinite(a321)) {
      return { ok: false, error: 'predictedCap and actualCap must be finite numbers', version: MM_VERSION_321 };
    }
    const entry321 = { step: s321, predictedCap: p321, actualCap: a321, absError: Math.abs(a321 - p321) };
    this._forecastActuals321.push(entry321);
    return Object.assign({ ok: true }, entry321, { version: MM_VERSION_321 });
  }

  /**
   * auditCapForecastMAE321(maxEntries)
   * Compute the rolling Mean Absolute Error over the last `maxEntries` recorded
   * actuals. Also returns each entry's individual absolute error.
   *
   * @param {number} [maxEntries] — how many recent entries to include (default: all)
   * @returns {{ ok, mae, entries: Array<{step,predictedCap,actualCap,absError}>,
   *             count, version }}
   */
  auditCapForecastMAE321(maxEntries) {
    const all321  = this._forecastActuals321;
    if (all321.length === 0) {
      return { ok: false, error: 'No actual observations recorded yet', version: MM_VERSION_321 };
    }
    const limit321   = _coercePositiveInt321(maxEntries, all321.length);
    const window321  = all321.slice(-limit321);
    const mae321     = window321.reduce((sum321, e321) => sum321 + e321.absError, 0) / window321.length;
    return {
      ok:      true,
      mae:     mae321,
      entries: window321,
      count:   window321.length,
      version: MM_VERSION_321,
    };
  }

  stats() {
    const base321 = super.stats();
    return Object.assign({}, base321, { version: MM_VERSION_321 });
  }
}

let _defaultAuditCapTrail321 = null;
function defaultAuditCapTrail321(opts) {
  if (!_defaultAuditCapTrail321 || opts) {
    _defaultAuditCapTrail321 = new AuditCapTrail321(opts || {});
  }
  return _defaultAuditCapTrail321;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) PageRangeDiffBridge321
//    Extends PageRangeDiffBridge320 with compound severity trend detection.
// ─────────────────────────────────────────────────────────────────────────────

const SEVERITY_TREND_INCREASING_321 = 'increasing';
const SEVERITY_TREND_DECREASING_321 = 'decreasing';
const SEVERITY_TREND_STABLE_321     = 'stable';

class PageRangeDiffBridge321 extends V320.PageRangeDiffBridge320 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * pagedDiffCompoundSeverityTrend321(from, to, startPage, endPage, pageSize,
   *                                    stdFactor, compareFrom, compareTo,
   *                                    compareStartPage, compareEndPage,
   *                                    trendThreshold)
   *
   * Runs pagedDiffCompoundSeverity320 twice — once for the primary window
   * [from..to / startPage..endPage] and once for the comparison window
   * [compareFrom..compareTo / compareStartPage..compareEndPage] — and returns:
   *   - Both compound severity objects
   *   - severityDelta (primary.sum − compare.sum)
   *   - trend: "increasing" | "decreasing" | "stable"
   *
   * @param {number} [trendThreshold] — minimum |delta| to be non-stable (default 0.01)
   */
  pagedDiffCompoundSeverityTrend321(
    from, to, startPage, endPage, pageSize, stdFactor,
    compareFrom, compareTo, compareStartPage, compareEndPage,
    trendThreshold
  ) {
    const primary321 = this.pagedDiffCompoundSeverity320(
      from, to, startPage, endPage, pageSize, stdFactor
    );

    // compareFrom defaults to from, compareTo defaults to to
    const cFrom321  = compareFrom  !== undefined ? compareFrom  : from;
    const cTo321    = compareTo    !== undefined ? compareTo    : to;
    const cStart321 = compareStartPage !== undefined ? compareStartPage : startPage;
    const cEnd321   = compareEndPage   !== undefined ? compareEndPage   : endPage;

    const compare321 = this.pagedDiffCompoundSeverity320(
      cFrom321, cTo321, cStart321, cEnd321, pageSize, stdFactor
    );

    // If either query failed entirely, still return partial result
    const thresh321 = _coercePositiveFloat321(trendThreshold, 0.01);

    let trend321        = SEVERITY_TREND_STABLE_321;
    let severityDelta321 = null;

    if (primary321.ok && primary321.compoundSeverity && compare321.ok && compare321.compoundSeverity) {
      severityDelta321 = primary321.compoundSeverity.sum - compare321.compoundSeverity.sum;
      if (severityDelta321 > thresh321) {
        trend321 = SEVERITY_TREND_INCREASING_321;
      } else if (severityDelta321 < -thresh321) {
        trend321 = SEVERITY_TREND_DECREASING_321;
      }
    }

    return {
      ok:                    primary321.ok || compare321.ok,
      primary:               primary321,
      compare:               compare321,
      severityDelta:         severityDelta321,
      trend:                 trend321,
      trendThreshold:        thresh321,
      version:               MM_VERSION_321,
    };
  }

  stats() {
    const base321 = super.stats();
    return Object.assign({}, base321, { version: MM_VERSION_321 });
  }
}

let _defaultPageRangeDiffBridge321 = null;
function defaultPageRangeDiffBridge321(opts) {
  if (!_defaultPageRangeDiffBridge321 || opts) {
    _defaultPageRangeDiffBridge321 = new PageRangeDiffBridge321(opts || {});
  }
  return _defaultPageRangeDiffBridge321;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) RankedOverlapBuffer321
//    Extends RankedOverlapBuffer320 with semantic cluster discovery.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Union-Find structure for connected component discovery.
 */
class _UnionFind321 {
  constructor(items) {
    this._parent = {};
    items.forEach(item => { this._parent[item] = item; });
  }
  find(x) {
    if (this._parent[x] !== x) this._parent[x] = this.find(this._parent[x]);
    return this._parent[x];
  }
  union(x, y) {
    const rx = this.find(x), ry = this.find(y);
    if (rx !== ry) this._parent[rx] = ry;
  }
  clusters() {
    const groups = {};
    Object.keys(this._parent).forEach(k => {
      const root = this.find(k);
      if (!groups[root]) groups[root] = [];
      groups[root].push(k);
    });
    return Object.values(groups);
  }
}

class RankedOverlapBuffer321 extends V320.RankedOverlapBuffer320 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * semanticClusterDiscovery321(tokens, threshold)
   * Build a Jaccard similarity matrix (via semanticSimilarityMatrix320) then
   * find connected components where all pairwise jaccard >= threshold.
   *
   * @param {string[]} tokens
   * @param {number}   [threshold] — minimum jaccard to merge two tokens (default 0.1)
   * @returns {{ ok, tokens, clusters: Array<string[]>, threshold,
   *             singletons, clusterCount, version }}
   */
  semanticClusterDiscovery321(tokens, threshold) {
    const matrixResult321 = this.semanticSimilarityMatrix320(tokens);
    if (!matrixResult321.ok) {
      return Object.assign({}, matrixResult321, { version: MM_VERSION_321 });
    }

    const thresh321 = _coercePositiveFloat321(threshold, 0.1);
    const uf321 = new _UnionFind321(matrixResult321.tokens);

    matrixResult321.matrix.forEach(pair321 => {
      if (pair321.jaccard >= thresh321) {
        uf321.union(pair321.tokenA, pair321.tokenB);
      }
    });

    const clusters321   = uf321.clusters().sort((a, b) => b.length - a.length);
    const singletons321 = clusters321.filter(c => c.length === 1).length;

    return {
      ok:           true,
      tokens:       matrixResult321.tokens,
      clusters:     clusters321,
      threshold:    thresh321,
      singletons:   singletons321,
      clusterCount: clusters321.length,
      version:      MM_VERSION_321,
    };
  }

  stats() {
    const base321 = typeof super.stats === 'function' ? super.stats() : {};
    return Object.assign({}, base321, { version: MM_VERSION_321 });
  }
}

let _defaultRankedOverlapBuffer321 = null;
function defaultRankedOverlapBuffer321(opts) {
  if (!_defaultRankedOverlapBuffer321 || opts) {
    _defaultRankedOverlapBuffer321 = new RankedOverlapBuffer321(opts || {});
  }
  return _defaultRankedOverlapBuffer321;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) NormDeltaPercentilesTracker321
//    Extends NormDeltaPercentilesTracker320 with regime duration tracking.
// ─────────────────────────────────────────────────────────────────────────────

class NormDeltaPercentilesTracker321 extends V320.NormDeltaPercentilesTracker320 {
  constructor(opts = {}) {
    super(opts);
    this._lastRegime321    = null;
    this._regimeDuration321 = 0;
  }

  /**
   * trendNormDeltaRegimeDuration321(source, windowMs, buckets, baseline,
   *                                  thresholds, compareWindowMs, regimeThresholds)
   *
   * Calls trendNormDeltaRegimeClassifier320, then increments `_regimeDuration321`
   * if the regime is the same as the last call, or resets to 1 on a regime change.
   *
   * @returns {{ ok, regime, regimeDuration, regimeChanged,
   *             volatilityDelta, volatilityIndex, compareVolatilityIndex, version }}
   */
  trendNormDeltaRegimeDuration321(source, windowMs, buckets, baseline, thresholds, compareWindowMs, regimeThresholds) {
    const base321 = this.trendNormDeltaRegimeClassifier320(
      source, windowMs, buckets, baseline, thresholds, compareWindowMs, regimeThresholds
    );
    if (!base321.ok) {
      return Object.assign({}, base321, { version: MM_VERSION_321 });
    }

    const newRegime321    = base321.regime;
    const changed321      = this._lastRegime321 !== null && this._lastRegime321 !== newRegime321;

    if (changed321 || this._lastRegime321 === null) {
      this._regimeDuration321 = 1;
    } else {
      this._regimeDuration321 += 1;
    }
    this._lastRegime321 = newRegime321;

    return Object.assign({}, base321, {
      regimeDuration: this._regimeDuration321,
      regimeChanged:  changed321,
      version:        MM_VERSION_321,
    });
  }

  /**
   * resetRegimeDuration321()
   * Reset the duration counter and last-regime memory.
   */
  resetRegimeDuration321() {
    this._lastRegime321    = null;
    this._regimeDuration321 = 0;
    return { ok: true, version: MM_VERSION_321 };
  }

  stats() {
    const base321 = super.stats();
    return Object.assign({}, base321, { version: MM_VERSION_321 });
  }
}

let _defaultNormDeltaPercentilesTracker321 = null;
function defaultNormDeltaPercentilesTracker321(opts) {
  if (!_defaultNormDeltaPercentilesTracker321 || opts) {
    _defaultNormDeltaPercentilesTracker321 = new NormDeltaPercentilesTracker321(opts || {});
  }
  return _defaultNormDeltaPercentilesTracker321;
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint registration helper
// ─────────────────────────────────────────────────────────────────────────────

function registerV321Endpoints(app) {
  const trail321   = defaultAuditCapTrail321();
  const bridge321  = defaultPageRangeDiffBridge321();
  const buffer321  = defaultRankedOverlapBuffer321();
  const tracker321 = defaultNormDeltaPercentilesTracker321();

  // 1. GET forecast MAE (rolling accuracy)
  app.get(
    '/api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v321/aggregate/db/hydrate/audit/cap/forecast/mae',
    (req, res) => {
      try {
        const maxEntries321 = req.query.maxEntries ? Number(req.query.maxEntries) : undefined;
        res.json(trail321.auditCapForecastMAE321(maxEntries321));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_321 });
      }
    }
  );

  // 2. GET compound severity trend
  app.get(
    '/api/v1/market/alerts/suppress/config/v321/diff/audit/filter/paged/range/outliers/severity/trend',
    (req, res) => {
      try {
        const from321        = Number(req.query.from);
        const to321          = Number(req.query.to);
        const startPage321   = req.query.startPage   ? Number(req.query.startPage)   : 1;
        const endPage321     = req.query.endPage     ? Number(req.query.endPage)     : startPage321;
        const pageSize321    = req.query.pageSize    ? Number(req.query.pageSize)    : 20;
        const stdFactor321   = req.query.stdFactor   ? Number(req.query.stdFactor)   : 2.0;
        const cFrom321       = req.query.compareFrom  !== undefined ? Number(req.query.compareFrom)  : from321;
        const cTo321         = req.query.compareTo    !== undefined ? Number(req.query.compareTo)    : to321;
        const cStart321      = req.query.compareStartPage !== undefined ? Number(req.query.compareStartPage) : startPage321;
        const cEnd321        = req.query.compareEndPage   !== undefined ? Number(req.query.compareEndPage)   : endPage321;
        const thresh321      = req.query.trendThreshold ? Number(req.query.trendThreshold) : 0.01;
        res.json(bridge321.pagedDiffCompoundSeverityTrend321(
          from321, to321, startPage321, endPage321, pageSize321, stdFactor321,
          cFrom321, cTo321, cStart321, cEnd321, thresh321
        ));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_321 });
      }
    }
  );

  // 3. POST semantic cluster discovery
  app.post(
    '/api/v1/market/backtest/sessions/v321/snapshot/search/ranked/semantic/clusters',
    (req, res) => {
      try {
        const tokens321    = req.body ? req.body.tokens    : undefined;
        const threshold321 = req.body ? req.body.threshold : undefined;
        res.json(buffer321.semanticClusterDiscovery321(tokens321, threshold321));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_321 });
      }
    }
  );

  // 4. GET volatility regime with duration
  app.get(
    '/api/v1/contracts/receipts/v321/histogram/rolling/percentiles/trend/delta/cumulative/norm/volatility/regime/duration',
    (req, res) => {
      try {
        const source321   = req.query.source   || '';
        const windowMs321 = req.query.windowMs ? Number(req.query.windowMs) : 60000;
        const buckets321  = req.query.buckets  ? Number(req.query.buckets)  : 5;
        const baseline321 = req.query.baseline !== undefined ? Number(req.query.baseline) : 0;
        const elevated321 = req.query.elevated ? Number(req.query.elevated) : 1.5;
        const spike321    = req.query.spike    ? Number(req.query.spike)    : 3.0;
        const cmpWMs321   = req.query.compareWindowMs ? Number(req.query.compareWindowMs) : undefined;
        const incThr321   = req.query.increasing ? Number(req.query.increasing) : 0.05;
        const decThr321   = req.query.decreasing ? Number(req.query.decreasing) : 0.05;
        res.json(tracker321.trendNormDeltaRegimeDuration321(
          source321, windowMs321, buckets321, baseline321,
          { elevated: elevated321, spike: spike321 },
          cmpWMs321,
          { increasing: incThr321, decreasing: decThr321 }
        ));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_321 });
      }
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  MM_VERSION_321,
  SEVERITY_TREND_INCREASING_321,
  SEVERITY_TREND_DECREASING_321,
  SEVERITY_TREND_STABLE_321,
  _coercePositiveInt321,
  _coercePositiveFloat321,
  _UnionFind321,
  AuditCapTrail321,
  defaultAuditCapTrail321,
  PageRangeDiffBridge321,
  defaultPageRangeDiffBridge321,
  RankedOverlapBuffer321,
  defaultRankedOverlapBuffer321,
  NormDeltaPercentilesTracker321,
  defaultNormDeltaPercentilesTracker321,
  registerV321Endpoints,
};
