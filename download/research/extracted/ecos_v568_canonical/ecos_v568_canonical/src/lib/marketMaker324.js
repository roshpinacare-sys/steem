'use strict';
/**
 * src/lib/marketMaker324.js — ECOS V324 (Phase P212) — MAE Alert History Aggregation,
 *                              Burst Recovery Tracking, Migration Graph Path Analysis,
 *                              Regime Sojourn Histogram
 *
 * Four additive components that extend the V323 analytical layer:
 *
 *   1. AuditCapTrail324 — aggregateMAEAlertHistory324()
 *      Computes summary statistics over the V323 alert history ring:
 *      totalEntries, alertCount, alertRate, minMAE, maxMAE, meanMAE, firstAt, lastAt.
 *
 *   2. PageRangeDiffBridge324 — pagedDiffSeverityBurstRecovery324(...)
 *      Extends burst cooldown (V323) to track how long the system remained "quiet"
 *      (no burst) between successive bursts — i.e. burst recovery time.
 *
 *   3. RankedOverlapBuffer324 — buildMigrationPathAnalysis324(snapshotTokenSets, threshold, topN)
 *      Extends the migration graph (V323) to compute the most frequent token migration
 *      paths (sequences of cluster moves across multiple snapshots).
 *
 *   4. NormDeltaPercentilesTracker324 — trendNormDeltaSojournHistogram324(...)
 *      Extends sojourn time (V323) to produce a per-regime histogram of sojourn
 *      durations (bucketed counts) to visualise dwell-time distribution.
 *
 * Sacred files untouched (R1). All new identifiers end in `324` (R2).
 * Zero new npm deps (R3). V287..V323 surfaces preserved (R6).
 * lib/ mirrors src/lib/. package.json bumped to 324.0.0.
 *
 * @version 324.0.0
 */

const V323 = require('./marketMaker323.js');

const MM_VERSION_324 = '324.0.0';

function _coercePositiveInt324(value, fallback324) {
  const n324 = Number(value);
  if (!Number.isFinite(n324) || !Number.isInteger(n324) || n324 < 1) return fallback324;
  return n324;
}

function _coercePositiveFloat324(value, fallback324) {
  const f324 = Number(value);
  if (!Number.isFinite(f324) || f324 <= 0) return fallback324;
  return f324;
}

function _coerceNonNegativeInt324(value, fallback324) {
  const n324 = Number(value);
  if (!Number.isFinite(n324) || !Number.isInteger(n324) || n324 < 0) return fallback324;
  return n324;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) AuditCapTrail324
//    Extends AuditCapTrail323 with alert history aggregation.
// ─────────────────────────────────────────────────────────────────────────────

class AuditCapTrail324 extends V323.AuditCapTrail323 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * aggregateMAEAlertHistory324()
   *
   * Computes summary statistics over the internal V323 alert history ring.
   * Returns: { ok, totalEntries, alertCount, alertRate, minMAE, maxMAE, meanMAE,
   *            firstAt, lastAt, version }
   *
   * When the history ring is empty, numeric stats are null and timestamps are null.
   */
  aggregateMAEAlertHistory324() {
    const history324 = this._maeAlertHistory323;
    const total324   = history324.length;

    if (total324 === 0) {
      return {
        ok:           true,
        totalEntries: 0,
        alertCount:   0,
        alertRate:    null,
        minMAE:       null,
        maxMAE:       null,
        meanMAE:      null,
        firstAt:      null,
        lastAt:       null,
        version:      MM_VERSION_324,
      };
    }

    let alertCount324 = 0;
    let minMAE324     = Infinity;
    let maxMAE324     = -Infinity;
    let sumMAE324     = 0;

    history324.forEach(entry324 => {
      if (entry324.alert) alertCount324++;
      if (entry324.mae < minMAE324) minMAE324 = entry324.mae;
      if (entry324.mae > maxMAE324) maxMAE324 = entry324.mae;
      sumMAE324 += entry324.mae;
    });

    return {
      ok:           true,
      totalEntries: total324,
      alertCount:   alertCount324,
      alertRate:    alertCount324 / total324,
      minMAE:       minMAE324,
      maxMAE:       maxMAE324,
      meanMAE:      sumMAE324 / total324,
      firstAt:      history324[0].timestamp,
      lastAt:       history324[total324 - 1].timestamp,
      version:      MM_VERSION_324,
    };
  }

  stats() {
    const base324 = super.stats();
    return Object.assign({}, base324, { version: MM_VERSION_324 });
  }
}

let _defaultAuditCapTrail324 = null;
function defaultAuditCapTrail324(opts) {
  if (!_defaultAuditCapTrail324 || opts) {
    _defaultAuditCapTrail324 = new AuditCapTrail324(opts || {});
  }
  return _defaultAuditCapTrail324;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) PageRangeDiffBridge324
//    Extends PageRangeDiffBridge323 with burst recovery tracking.
// ─────────────────────────────────────────────────────────────────────────────

class PageRangeDiffBridge324 extends V323.PageRangeDiffBridge323 {
  constructor(opts = {}) {
    super(opts);
    // Recovery tracking state
    this._lastBurstEndAt324   = null;   // ms timestamp when last cooldown window expired
    this._quietStart324       = null;   // ms timestamp when quiet period began
    this._recoveryHistory324  = [];     // bounded ring of { quietDurationMs, burstAt }
    this._recoveryHistMax324  = _coercePositiveInt324(opts.maxRecoveryHistory, 50);
  }

  /**
   * pagedDiffSeverityBurstRecovery324(from, to, startPage, endPage, pageSize,
   *   stdFactor, compareFrom, compareTo, compareStartPage, compareEndPage,
   *   trendThreshold, burstWindowSize, burstThresholdFactor, burstCooldownMs)
   *
   * Delegates to pagedDiffSeverityBurstCooldown323, then:
   * - When a cooldown ends (was active, now not), marks the start of a quiet period.
   * - When a new real burst fires after a quiet period, records the recovery duration
   *   (ms from cooldown expiry to next burst) into a bounded history ring.
   *
   * @returns {{ ok, ...(cooldown result), lastRecoveryMs, recoveryHistory, version }}
   */
  pagedDiffSeverityBurstRecovery324(
    from, to, startPage, endPage, pageSize, stdFactor,
    compareFrom, compareTo, compareStartPage, compareEndPage,
    trendThreshold, burstWindowSize, burstThresholdFactor, burstCooldownMs
  ) {
    const prevLastBurstAt324  = this._lastBurstAt323;
    const prevCooldownMs324   = _coerceNonNegativeInt324(burstCooldownMs, this._burstCooldownMs323);

    // Check if we were in cooldown before this call
    const wasInCooldown324 = prevLastBurstAt324 !== null &&
      (Date.now() - prevLastBurstAt324) < prevCooldownMs324;

    const base324 = this.pagedDiffSeverityBurstCooldown323(
      from, to, startPage, endPage, pageSize, stdFactor,
      compareFrom, compareTo, compareStartPage, compareEndPage,
      trendThreshold, burstWindowSize, burstThresholdFactor, burstCooldownMs
    );

    const now324 = Date.now();

    // Cooldown just ended → begin quiet period
    if (wasInCooldown324 && !base324.cooldown) {
      this._quietStart324 = now324;
    }

    // A new real burst fired (not suppressed, not in cooldown)
    if (base324.burst && !base324.cooldown && this._quietStart324 !== null) {
      const recoveryMs324 = now324 - this._quietStart324;
      const entry324 = { quietDurationMs: recoveryMs324, burstAt: new Date(now324).toISOString() };
      this._recoveryHistory324.push(entry324);
      while (this._recoveryHistory324.length > this._recoveryHistMax324) {
        this._recoveryHistory324.shift();
      }
      this._quietStart324 = null;
    }

    const lastRecovery324 = this._recoveryHistory324.length > 0
      ? this._recoveryHistory324[this._recoveryHistory324.length - 1]
      : null;

    return Object.assign({}, base324, {
      lastRecoveryMs:   lastRecovery324 ? lastRecovery324.quietDurationMs : null,
      recoveryHistory:  this._recoveryHistory324.slice(),
      version:          MM_VERSION_324,
    });
  }

  /**
   * resetBurstRecovery324()
   * Clear recovery history and quiet-period state.
   */
  resetBurstRecovery324() {
    this._recoveryHistory324 = [];
    this._quietStart324      = null;
    this._lastBurstEndAt324  = null;
    return { ok: true, version: MM_VERSION_324 };
  }

  stats() {
    const base324 = super.stats();
    return Object.assign({}, base324, { version: MM_VERSION_324 });
  }
}

let _defaultPageRangeDiffBridge324 = null;
function defaultPageRangeDiffBridge324(opts) {
  if (!_defaultPageRangeDiffBridge324 || opts) {
    _defaultPageRangeDiffBridge324 = new PageRangeDiffBridge324(opts || {});
  }
  return _defaultPageRangeDiffBridge324;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) RankedOverlapBuffer324
//    Extends RankedOverlapBuffer323 with migration graph path analysis.
// ─────────────────────────────────────────────────────────────────────────────

class RankedOverlapBuffer324 extends V323.RankedOverlapBuffer323 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * buildMigrationPathAnalysis324(snapshotTokenSets, threshold, topN)
   *
   * Calls buildClusterMigrationGraph323 to get the edge list, then builds per-token
   * migration path sequences (the ordered list of cluster indices the token passed
   * through across all snapshots). Returns:
   *
   * - `tokenPaths`: { token: [clusterIdx0, clusterIdx1, ...] } — one entry per token
   *   that moved at least once.
   * - `pathFrequency`: { 'c0→c1→c2': count } — how many tokens share the same
   *   sequence of cluster transitions.
   * - `topPaths`: top-N most frequent paths sorted by count descending.
   * - `graph`: the raw graph from buildClusterMigrationGraph323.
   *
   * @param {string[][]} snapshotTokenSets — ordered array of token arrays (≥ 2 snapshots)
   * @param {number}     [threshold]       — Jaccard threshold (default 0.1)
   * @param {number}     [topN]            — how many top paths to return (default 10)
   * @returns {{ ok, tokenPaths, pathFrequency, topPaths, graph, version }}
   */
  buildMigrationPathAnalysis324(snapshotTokenSets, threshold, topN) {
    const topN324 = _coercePositiveInt324(topN, 10);

    const graph324 = this.buildClusterMigrationGraph323(snapshotTokenSets, threshold);
    if (!graph324.ok) {
      return Object.assign({}, graph324, { version: MM_VERSION_324 });
    }

    // Build per-snapshot cluster maps so we can trace each token's full path
    const snapCount324 = snapshotTokenSets.length;
    const snapMaps324  = [];  // [snapshot_index] → Map<token, clusterIdx>

    for (let i324 = 0; i324 < snapCount324; i324++) {
      const tokens324 = snapshotTokenSets[i324];
      if (!Array.isArray(tokens324) || tokens324.length < 2) {
        snapMaps324.push(null);
        continue;
      }
      const result324 = this.semanticClusterDiscovery321(tokens324, threshold);
      if (!result324.ok) {
        snapMaps324.push(null);
        continue;
      }
      const map324 = new Map();
      result324.clusters.forEach((cluster324, idx324) => {
        cluster324.forEach(t324 => map324.set(t324, idx324));
      });
      snapMaps324.push(map324);
    }

    // Collect all tokens that appear in any snapshot
    const allTokens324 = new Set(graph324.nodes);

    // Build full path for each token across valid snapshots
    const tokenPaths324     = {};
    const pathFrequency324  = {};

    allTokens324.forEach(token324 => {
      const path324 = [];
      snapMaps324.forEach(map324 => {
        if (map324 && map324.has(token324)) {
          path324.push(map324.get(token324));
        }
      });

      // Only track tokens that have a path of length ≥ 2 with at least one cluster change
      if (path324.length >= 2) {
        const hasMove324 = path324.some((v, i) => i > 0 && v !== path324[i - 1]);
        if (hasMove324) {
          tokenPaths324[token324] = path324;
          const key324 = path324.join('→');
          pathFrequency324[key324] = (pathFrequency324[key324] || 0) + 1;
        }
      }
    });

    // Sort by frequency and take topN
    const topPaths324 = Object.entries(pathFrequency324)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN324)
      .map(([path324, count324]) => ({ path: path324, count: count324 }));

    return {
      ok:            true,
      tokenPaths:    tokenPaths324,
      pathFrequency: pathFrequency324,
      topPaths:      topPaths324,
      graph:         graph324,
      version:       MM_VERSION_324,
    };
  }

  stats() {
    const base324 = typeof super.stats === 'function' ? super.stats() : {};
    return Object.assign({}, base324, { version: MM_VERSION_324 });
  }
}

let _defaultRankedOverlapBuffer324 = null;
function defaultRankedOverlapBuffer324(opts) {
  if (!_defaultRankedOverlapBuffer324 || opts) {
    _defaultRankedOverlapBuffer324 = new RankedOverlapBuffer324(opts || {});
  }
  return _defaultRankedOverlapBuffer324;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) NormDeltaPercentilesTracker324
//    Extends NormDeltaPercentilesTracker323 with regime sojourn histogram.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * _buildSojournHistogram324(durations, buckets)
 * Build a bucketed histogram from an array of sojourn duration values.
 * @param {number[]} durations — array of integer sojourn durations
 * @param {number}   buckets   — number of histogram buckets (≥ 1)
 * @returns {Array<{min: number, max: number, count: number}>}
 */
function _buildSojournHistogram324(durations, buckets) {
  if (!durations || durations.length === 0) return [];
  const min324 = Math.min(...durations);
  const max324 = Math.max(...durations);
  const buckets324 = _coercePositiveInt324(buckets, 5);

  // When all durations are equal, produce a single bucket
  if (min324 === max324) {
    return [{ min: min324, max: max324, count: durations.length }];
  }

  const width324 = (max324 - min324) / buckets324;
  const hist324 = Array.from({ length: buckets324 }, (_, i) => ({
    min:   min324 + i * width324,
    max:   min324 + (i + 1) * width324,
    count: 0,
  }));

  durations.forEach(d324 => {
    let idx324 = Math.floor((d324 - min324) / width324);
    // Clamp last value into final bucket
    if (idx324 >= buckets324) idx324 = buckets324 - 1;
    hist324[idx324].count++;
  });

  return hist324;
}

class NormDeltaPercentilesTracker324 extends V323.NormDeltaPercentilesTracker323 {
  constructor(opts = {}) {
    super(opts);
    // Per-regime sojourn duration samples for histogram
    this._sojournSamples324 = {};  // { regime: number[] }
  }

  /**
   * trendNormDeltaSojournHistogram324(source, windowMs, buckets, baseline,
   *   thresholds, compareWindowMs, regimeThresholds, histogramBuckets)
   *
   * Delegates to trendNormDeltaRegimeSojournTime323 and:
   * - On each completed regime transition, records the previous sojourn duration
   *   into `_sojournSamples324[prevRegime]`.
   * - Returns the sojourn result plus `sojournHistogram`:
   *   { [regime]: Array<{min, max, count}> } built by `_buildSojournHistogram324`.
   *
   * @param {number} [histogramBuckets] — number of histogram buckets per regime (default 5)
   * @returns {{ ok, regime, sojournStats, currentSojourn, sojournHistogram, version }}
   */
  trendNormDeltaSojournHistogram324(
    source, windowMs, buckets, baseline, thresholds, compareWindowMs, regimeThresholds,
    histogramBuckets
  ) {
    const histBuckets324 = _coercePositiveInt324(histogramBuckets, 5);
    const prevRegime324  = this._lastSojournRegime323;
    const prevSojourn324 = this._currentSojourn323;

    const base324 = this.trendNormDeltaRegimeSojournTime323(
      source, windowMs, buckets, baseline, thresholds, compareWindowMs, regimeThresholds
    );
    if (!base324.ok) {
      return Object.assign({}, base324, { version: MM_VERSION_324 });
    }

    // Detect a just-completed sojourn (regime changed from prevRegime)
    const currentRegime324 = base324.regime;
    if (prevRegime324 !== null && prevRegime324 !== currentRegime324 && prevSojourn324 > 0) {
      if (!this._sojournSamples324[prevRegime324]) {
        this._sojournSamples324[prevRegime324] = [];
      }
      this._sojournSamples324[prevRegime324].push(prevSojourn324);
    }

    // Build histograms for all regimes that have samples
    const sojournHistogram324 = {};
    Object.keys(this._sojournSamples324).forEach(regime324 => {
      sojournHistogram324[regime324] = _buildSojournHistogram324(
        this._sojournSamples324[regime324], histBuckets324
      );
    });

    return Object.assign({}, base324, {
      sojournHistogram: sojournHistogram324,
      version:          MM_VERSION_324,
    });
  }

  /**
   * resetSojournHistogram324()
   * Clear sojourn samples (histogram data), while preserving V323 sojourn counters.
   * To reset everything including V323 state, also call resetSojournStats323().
   */
  resetSojournHistogram324() {
    this._sojournSamples324 = {};
    return { ok: true, version: MM_VERSION_324 };
  }

  stats() {
    const base324 = super.stats();
    return Object.assign({}, base324, { version: MM_VERSION_324 });
  }
}

let _defaultNormDeltaPercentilesTracker324 = null;
function defaultNormDeltaPercentilesTracker324(opts) {
  if (!_defaultNormDeltaPercentilesTracker324 || opts) {
    _defaultNormDeltaPercentilesTracker324 = new NormDeltaPercentilesTracker324(opts || {});
  }
  return _defaultNormDeltaPercentilesTracker324;
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint registration helper
// ─────────────────────────────────────────────────────────────────────────────

function registerV324Endpoints(app) {
  const trail324   = defaultAuditCapTrail324();
  const bridge324  = defaultPageRangeDiffBridge324();
  const buffer324  = defaultRankedOverlapBuffer324();
  const tracker324 = defaultNormDeltaPercentilesTracker324();

  // 1. GET MAE alert history aggregate
  app.get(
    '/api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v324/aggregate/db/hydrate/audit/cap/forecast/mae/alert/history/aggregate',
    (req, res) => {
      try {
        res.json(trail324.aggregateMAEAlertHistory324());
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_324 });
      }
    }
  );

  // 2. GET severity burst recovery tracking
  app.get(
    '/api/v1/market/alerts/suppress/config/v324/diff/audit/filter/paged/range/outliers/severity/burst/recovery',
    (req, res) => {
      try {
        const from324        = Number(req.query.from);
        const to324          = Number(req.query.to);
        const startPage324   = req.query.startPage   ? Number(req.query.startPage)   : 1;
        const endPage324     = req.query.endPage     ? Number(req.query.endPage)     : startPage324;
        const pageSize324    = req.query.pageSize    ? Number(req.query.pageSize)    : 20;
        const stdFactor324   = req.query.stdFactor   ? Number(req.query.stdFactor)   : 2.0;
        const cFrom324       = req.query.compareFrom  !== undefined ? Number(req.query.compareFrom)  : from324;
        const cTo324         = req.query.compareTo    !== undefined ? Number(req.query.compareTo)    : to324;
        const cStart324      = req.query.compareStartPage !== undefined ? Number(req.query.compareStartPage) : startPage324;
        const cEnd324        = req.query.compareEndPage   !== undefined ? Number(req.query.compareEndPage)   : endPage324;
        const thresh324      = req.query.trendThreshold ? Number(req.query.trendThreshold) : 0.01;
        const winSize324     = req.query.burstWindowSize      ? Number(req.query.burstWindowSize)      : 5;
        const burstFactor324 = req.query.burstThresholdFactor ? Number(req.query.burstThresholdFactor) : 2.0;
        const cooldownMs324  = req.query.burstCooldownMs      ? Number(req.query.burstCooldownMs)      : 0;
        res.json(bridge324.pagedDiffSeverityBurstRecovery324(
          from324, to324, startPage324, endPage324, pageSize324, stdFactor324,
          cFrom324, cTo324, cStart324, cEnd324, thresh324, winSize324, burstFactor324, cooldownMs324
        ));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_324 });
      }
    }
  );

  // 3. POST migration graph path analysis
  app.post(
    '/api/v1/market/backtest/sessions/v324/snapshot/search/ranked/semantic/clusters/migration/paths',
    (req, res) => {
      try {
        const snapshotTokenSets324 = req.body ? req.body.snapshotTokenSets : undefined;
        const threshold324         = req.body ? req.body.threshold         : undefined;
        const topN324              = req.body ? req.body.topN              : undefined;
        res.json(buffer324.buildMigrationPathAnalysis324(snapshotTokenSets324, threshold324, topN324));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_324 });
      }
    }
  );

  // 4. GET regime sojourn histogram
  app.get(
    '/api/v1/contracts/receipts/v324/histogram/rolling/percentiles/trend/delta/cumulative/norm/volatility/regime/sojourn/histogram',
    (req, res) => {
      try {
        const source324      = req.query.source   || '';
        const windowMs324    = req.query.windowMs ? Number(req.query.windowMs) : 60000;
        const buckets324     = req.query.buckets  ? Number(req.query.buckets)  : 5;
        const baseline324    = req.query.baseline !== undefined ? Number(req.query.baseline) : 0;
        const elevated324    = req.query.elevated ? Number(req.query.elevated) : 1.5;
        const spike324       = req.query.spike    ? Number(req.query.spike)    : 3.0;
        const cmpWMs324      = req.query.compareWindowMs ? Number(req.query.compareWindowMs) : undefined;
        const incThr324      = req.query.increasing ? Number(req.query.increasing) : 0.05;
        const decThr324      = req.query.decreasing ? Number(req.query.decreasing) : 0.05;
        const histBuckets324 = req.query.histogramBuckets ? Number(req.query.histogramBuckets) : 5;
        res.json(tracker324.trendNormDeltaSojournHistogram324(
          source324, windowMs324, buckets324, baseline324,
          { elevated: elevated324, spike: spike324 },
          cmpWMs324,
          { increasing: incThr324, decreasing: decThr324 },
          histBuckets324
        ));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_324 });
      }
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  MM_VERSION_324,
  _coercePositiveInt324,
  _coercePositiveFloat324,
  _coerceNonNegativeInt324,
  _buildSojournHistogram324,
  AuditCapTrail324,
  defaultAuditCapTrail324,
  PageRangeDiffBridge324,
  defaultPageRangeDiffBridge324,
  RankedOverlapBuffer324,
  defaultRankedOverlapBuffer324,
  NormDeltaPercentilesTracker324,
  defaultNormDeltaPercentilesTracker324,
  registerV324Endpoints,
};
