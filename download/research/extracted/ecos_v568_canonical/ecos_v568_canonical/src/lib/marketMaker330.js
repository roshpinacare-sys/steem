'use strict';
/**
 * src/lib/marketMaker330.js — ECOS V330 (Phase P218) — Smoothed CV Convergence,
 *                              Momentum Acceleration Percentiles, Adaptive Confidence Band,
 *                              Zone Transition Rate
 *
 * Four additive components that extend the V329 analytical layer:
 *
 *   1. AuditCapTrail330 — detectSmoothedCvConvergence330()
 *      Measures how quickly the EMA series converges by summing absolute differences
 *      between consecutive smoothed values. Returns convergenceSum, convergenceSteps,
 *      and meanConvergenceStep (null when convergenceSteps = 0).
 *
 *   2. PageRangeDiffBridge330 — computeMomentumAccelerationPercentiles330()
 *      Derives the same consecutive acceleration values as V329 and returns p25, p50,
 *      p75 percentiles using nearest-rank method (null when fewer than 2 finite values).
 *
 *   3. RankedOverlapBuffer330 — forecastEntropyConfidenceBand330(snapshotTokenSets, threshold, windowSize)
 *      Calls forecastEntropyStabilityAdaptive329 and computes a confidence band:
 *      lower = adaptedConfidence * (1 - stabilityScore)
 *      upper = min(1, adaptedConfidence * (1 + stabilityScore))
 *      Both null when adaptedConfidence is null.
 *
 *   4. NormDeltaPercentilesTracker330 — computeSpreadRankZoneTransitionRate330(regime)
 *      Scans consecutive entries in _spreadRankHistory328[regime] and counts zone
 *      transitions. Returns transitionCount, transitionRate (null when count < 2),
 *      and mostFrequentTransition (null when no transitions).
 *
 * Sacred files untouched (R1). All new identifiers end in `330` (R2).
 * Zero new npm deps (R3). V287..V329 surfaces preserved (R6).
 * lib/ mirrors src/lib/. package.json bumped to 330.0.0.
 *
 * @version 330.0.0
 */

const V329 = require('./marketMaker329.js');

const MM_VERSION_330 = '330.0.0';

/**
 * _percentileNearestRank330(sortedValues, p)
 * Returns the nearest-rank percentile for p in [0,100].
 * sortedValues must be sorted ascending and non-empty.
 */
function _percentileNearestRank330(sortedValues330, p330) {
  const n330 = sortedValues330.length;
  if (n330 === 0) return null;
  const idx330 = Math.max(0, Math.ceil((p330 / 100) * n330) - 1);
  return sortedValues330[idx330];
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) AuditCapTrail330
//    Extends AuditCapTrail329 with smoothed CV convergence measurement.
// ─────────────────────────────────────────────────────────────────────────────

class AuditCapTrail330 extends V329.AuditCapTrail329 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * detectSmoothedCvConvergence330()
   *
   * Re-applies EMA (alpha=0.5) over all streak lengths (same as V329), then measures
   * convergence by computing absolute differences between consecutive smoothed values.
   *
   * Returns:
   *   - convergenceSum:      sum of |smoothed[i] - smoothed[i-1]| for all i > 0
   *   - convergenceSteps:    number of consecutive differences (= n - 1, or 0 when n <= 1)
   *   - meanConvergenceStep: convergenceSum / convergenceSteps (null when convergenceSteps = 0)
   *
   * Also returns all fields from smoothStreakVolatilityTrend329() plus version 330.0.0.
   *
   * @returns {{ ok, streakCount, ..., smoothedFirstHalfCV, smoothedSecondHalfCV,
   *             smoothedCvDelta, convergenceSum, convergenceSteps, meanConvergenceStep,
   *             version }}
   */
  detectSmoothedCvConvergence330() {
    const base330 = this.smoothStreakVolatilityTrend329();

    // Re-collect streak lengths for EMA (same procedure as V329)
    const V328module330 = require('./marketMaker328.js');
    const lengths330 = V328module330._collectStreakLengths328(this._maeAlertHistory323);
    const n330 = lengths330.length;

    let convergenceSum330   = 0;
    let convergenceSteps330 = 0;
    let meanConvergenceStep330 = null;

    if (n330 >= 2) {
      const smoothed330 = V329._ema329(lengths330, 0.5);
      for (let i330 = 1; i330 < smoothed330.length; i330++) {
        convergenceSum330 += Math.abs(smoothed330[i330] - smoothed330[i330 - 1]);
      }
      convergenceSteps330 = smoothed330.length - 1;
      meanConvergenceStep330 = convergenceSum330 / convergenceSteps330;
    } else if (n330 === 1) {
      // 1 streak: no pairs → convergenceSteps = 0
      convergenceSum330   = 0;
      convergenceSteps330 = 0;
      meanConvergenceStep330 = null;
    }

    return Object.assign({}, base330, {
      convergenceSum:       convergenceSum330,
      convergenceSteps:     convergenceSteps330,
      meanConvergenceStep:  meanConvergenceStep330,
      version:              MM_VERSION_330,
    });
  }

  stats() {
    const base330 = super.stats();
    return Object.assign({}, base330, { version: MM_VERSION_330 });
  }
}

let _defaultAuditCapTrail330 = null;
function defaultAuditCapTrail330(opts) {
  if (!_defaultAuditCapTrail330 || opts) {
    _defaultAuditCapTrail330 = new AuditCapTrail330(opts || {});
  }
  return _defaultAuditCapTrail330;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) PageRangeDiffBridge330
//    Extends PageRangeDiffBridge329 with momentum acceleration percentiles.
// ─────────────────────────────────────────────────────────────────────────────

class PageRangeDiffBridge330 extends V329.PageRangeDiffBridge329 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * computeMomentumAccelerationPercentiles330()
   *
   * Derives consecutive acceleration values from _momentumHistory328 (same as V329)
   * and returns p25, p50, p75 percentiles using the nearest-rank method.
   *
   * Returns:
   *   - p25: 25th percentile of acceleration values (null when fewer than 2 finite values)
   *   - p50: 50th percentile (median)
   *   - p75: 75th percentile
   *
   * @returns {{ ok, count, p25, p50, p75, version }}
   */
  computeMomentumAccelerationPercentiles330() {
    const history330 = this._momentumHistory328;
    const count330   = history330.length;

    let p25330 = null;
    let p50330 = null;
    let p75330 = null;

    if (count330 >= 2) {
      // Compute consecutive accelerations (finite pairs only)
      const accels330 = [];
      for (let i330 = 1; i330 < count330; i330++) {
        const prev330 = history330[i330 - 1];
        const curr330 = history330[i330];
        if (prev330 !== null && curr330 !== null && isFinite(prev330) && isFinite(curr330)) {
          accels330.push(curr330 - prev330);
        }
      }

      if (accels330.length >= 1) {
        const sorted330 = accels330.slice().sort((a330, b330) => a330 - b330);
        p25330 = _percentileNearestRank330(sorted330, 25);
        p50330 = _percentileNearestRank330(sorted330, 50);
        p75330 = _percentileNearestRank330(sorted330, 75);
      }
    }

    return {
      ok:      true,
      count:   count330,
      p25:     p25330,
      p50:     p50330,
      p75:     p75330,
      version: MM_VERSION_330,
    };
  }

  stats() {
    const base330 = super.stats();
    return Object.assign({}, base330, { version: MM_VERSION_330 });
  }
}

let _defaultPageRangeDiffBridge330 = null;
function defaultPageRangeDiffBridge330(opts) {
  if (!_defaultPageRangeDiffBridge330 || opts) {
    _defaultPageRangeDiffBridge330 = new PageRangeDiffBridge330(opts || {});
  }
  return _defaultPageRangeDiffBridge330;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) RankedOverlapBuffer330
//    Extends RankedOverlapBuffer329 with adaptive confidence band.
// ─────────────────────────────────────────────────────────────────────────────

class RankedOverlapBuffer330 extends V329.RankedOverlapBuffer329 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * forecastEntropyConfidenceBand330(snapshotTokenSets, threshold, windowSize)
   *
   * Calls forecastEntropyStabilityAdaptive329 and computes a confidence band around
   * adaptedConfidence using stabilityScore as the half-width factor.
   *
   * Returns all fields from forecastEntropyStabilityAdaptive329 plus:
   *   - confidenceBand: { lower, upper }
   *       lower = adaptedConfidence * (1 - stabilityScore)
   *       upper = min(1, adaptedConfidence * (1 + stabilityScore))
   *       Both null when adaptedConfidence is null.
   *
   * @param {string[][]} snapshotTokenSets
   * @param {number}     [threshold]
   * @param {number}     [windowSize]
   * @returns {{ ok, windowCount, meanEntropy, stdDevEntropy, stabilityScore,
   *             forecastEntropy, forecastConfidence, adaptedConfidence,
   *             confidenceBand, version }}
   */
  forecastEntropyConfidenceBand330(snapshotTokenSets, threshold, windowSize) {
    const base330 = this.forecastEntropyStabilityAdaptive329(snapshotTokenSets, threshold, windowSize);

    if (!base330.ok) {
      return Object.assign({}, base330, {
        confidenceBand: { lower: null, upper: null },
        version: MM_VERSION_330,
      });
    }

    let lower330 = null;
    let upper330 = null;

    if (base330.adaptedConfidence !== null && base330.stabilityScore !== null && base330.stabilityScore !== undefined) {
      lower330 = base330.adaptedConfidence * (1 - base330.stabilityScore);
      upper330 = Math.min(1, base330.adaptedConfidence * (1 + base330.stabilityScore));
      // Clamp lower to [0,1]
      lower330 = Math.max(0, lower330);
    }

    return Object.assign({}, base330, {
      confidenceBand: { lower: lower330, upper: upper330 },
      version:        MM_VERSION_330,
    });
  }

  stats() {
    const base330 = typeof super.stats === 'function' ? super.stats() : {};
    return Object.assign({}, base330, { version: MM_VERSION_330 });
  }
}

let _defaultRankedOverlapBuffer330 = null;
function defaultRankedOverlapBuffer330(opts) {
  if (!_defaultRankedOverlapBuffer330 || opts) {
    _defaultRankedOverlapBuffer330 = new RankedOverlapBuffer330(opts || {});
  }
  return _defaultRankedOverlapBuffer330;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) NormDeltaPercentilesTracker330
//    Extends NormDeltaPercentilesTracker329 with zone transition rate.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * _getZone330(entry)
 * Returns a string label for the zone of an entry based on its flags.
 * Priority: belowP25 > aboveP75 > inIQR > unknown
 */
function _getZone330(entry330) {
  if (entry330.belowP25)  return 'belowP25';
  if (entry330.aboveP75)  return 'aboveP75';
  if (entry330.inIQR)     return 'inIQR';
  return 'unknown';
}

class NormDeltaPercentilesTracker330 extends V329.NormDeltaPercentilesTracker329 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * computeSpreadRankZoneTransitionRate330(regime)
   *
   * Scans consecutive entries in _spreadRankHistory328[regime] and counts zone
   * transitions (e.g. belowP25→inIQR, inIQR→aboveP75, etc.).
   *
   * Returns:
   *   - transitionCount:        total zone changes between consecutive entries
   *   - transitionRate:         transitionCount / (count - 1), null when count < 2
   *   - mostFrequentTransition: zone-pair string "fromZone→toZone" with highest count,
   *                             null when no transitions occurred
   *
   * Returns ok:false when regime is invalid.
   *
   * @param {string} regime
   * @returns {{ ok, regime, count, transitionCount, transitionRate,
   *             mostFrequentTransition, version }}
   */
  computeSpreadRankZoneTransitionRate330(regime330) {
    if (!regime330 || typeof regime330 !== 'string') {
      return { ok: false, error: 'regime must be a non-empty string', version: MM_VERSION_330 };
    }

    const history330 = this._spreadRankHistory328[regime330];
    const count330   = (history330 && history330.length) ? history330.length : 0;

    if (count330 < 2) {
      return {
        ok:                     true,
        regime:                 regime330,
        count:                  count330,
        transitionCount:        0,
        transitionRate:         count330 < 2 ? null : 0,
        mostFrequentTransition: null,
        version:                MM_VERSION_330,
      };
    }

    // Count transitions
    let transitionCount330 = 0;
    const transitionFreq330 = {};

    for (let i330 = 1; i330 < count330; i330++) {
      const fromZone330 = _getZone330(history330[i330 - 1]);
      const toZone330   = _getZone330(history330[i330]);
      if (fromZone330 !== toZone330) {
        transitionCount330++;
        const key330 = fromZone330 + '\u2192' + toZone330;
        transitionFreq330[key330] = (transitionFreq330[key330] || 0) + 1;
      }
    }

    const transitionRate330 = transitionCount330 / (count330 - 1);

    let mostFrequentTransition330 = null;
    if (transitionCount330 > 0) {
      mostFrequentTransition330 = Object.keys(transitionFreq330).reduce(
        (best330, key330) => transitionFreq330[key330] > transitionFreq330[best330] ? key330 : best330
      );
    }

    return {
      ok:                     true,
      regime:                 regime330,
      count:                  count330,
      transitionCount:        transitionCount330,
      transitionRate:         transitionRate330,
      mostFrequentTransition: mostFrequentTransition330,
      version:                MM_VERSION_330,
    };
  }

  stats() {
    const base330 = super.stats();
    return Object.assign({}, base330, { version: MM_VERSION_330 });
  }
}

let _defaultNormDeltaPercentilesTracker330 = null;
function defaultNormDeltaPercentilesTracker330(opts) {
  if (!_defaultNormDeltaPercentilesTracker330 || opts) {
    _defaultNormDeltaPercentilesTracker330 = new NormDeltaPercentilesTracker330(opts || {});
  }
  return _defaultNormDeltaPercentilesTracker330;
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint registration helper
// ─────────────────────────────────────────────────────────────────────────────

function registerV330Endpoints(app) {
  const trail330   = defaultAuditCapTrail330();
  const bridge330  = defaultPageRangeDiffBridge330();
  const buffer330  = defaultRankedOverlapBuffer330();
  const tracker330 = defaultNormDeltaPercentilesTracker330();

  // 1. GET smoothed CV convergence
  app.get(
    '/api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v330/aggregate/db/hydrate/audit/cap/forecast/mae/alert/streak/volatility/trend/smoothed/cv/convergence',
    (req, res) => {
      try {
        res.json(trail330.detectSmoothedCvConvergence330());
      } catch (e330) {
        res.status(500).json({ ok: false, error: e330.message, version: MM_VERSION_330 });
      }
    }
  );

  // 2. GET momentum acceleration percentiles
  app.get(
    '/api/v1/market/alerts/suppress/config/v330/diff/audit/filter/paged/range/outliers/severity/burst/recovery/momentum/acceleration/percentiles',
    (req, res) => {
      try {
        res.json(bridge330.computeMomentumAccelerationPercentiles330());
      } catch (e330) {
        res.status(500).json({ ok: false, error: e330.message, version: MM_VERSION_330 });
      }
    }
  );

  // 3. POST adaptive entropy confidence band
  app.post(
    '/api/v1/market/backtest/sessions/v330/snapshot/search/ranked/semantic/clusters/entropy/stability/window/forecast/confidence/band',
    (req, res) => {
      try {
        const snapshotTokenSets330 = req.body ? req.body.snapshotTokenSets : undefined;
        const threshold330         = req.body ? req.body.threshold         : undefined;
        const windowSize330        = req.body ? req.body.windowSize        : undefined;
        res.json(buffer330.forecastEntropyConfidenceBand330(snapshotTokenSets330, threshold330, windowSize330));
      } catch (e330) {
        res.status(500).json({ ok: false, error: e330.message, version: MM_VERSION_330 });
      }
    }
  );

  // 4. GET spread rank zone transition rate
  app.get(
    '/api/v1/contracts/receipts/v330/histogram/rolling/percentiles/trend/delta/cumulative/norm/volatility/regime/sojourn/spread/rank/zone/transition/rate',
    (req, res) => {
      try {
        const regime330 = req.query.regime || '';
        res.json(tracker330.computeSpreadRankZoneTransitionRate330(regime330));
      } catch (e330) {
        res.status(500).json({ ok: false, error: e330.message, version: MM_VERSION_330 });
      }
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  MM_VERSION_330,
  _percentileNearestRank330,
  _getZone330,
  AuditCapTrail330,
  defaultAuditCapTrail330,
  PageRangeDiffBridge330,
  defaultPageRangeDiffBridge330,
  RankedOverlapBuffer330,
  defaultRankedOverlapBuffer330,
  NormDeltaPercentilesTracker330,
  defaultNormDeltaPercentilesTracker330,
  registerV330Endpoints,
};
