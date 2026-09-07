'use strict';
/**
 * src/lib/marketMaker329.js — ECOS V329 (Phase P217) — Smoothed Streak Volatility,
 *                              Momentum Acceleration Aggregation, Adaptive Entropy Forecast,
 *                              Spread Rank History Summary
 *
 * Four additive components that extend the V328 analytical layer:
 *
 *   1. AuditCapTrail329 — smoothStreakVolatilityTrend329()
 *      Applies EMA (alpha=0.5) over all streak lengths (in order) to produce a smoothed
 *      CV series. Returns smoothedFirstHalfCV and smoothedSecondHalfCV (arithmetic mean
 *      of smoothed values within each half) plus smoothedCvDelta = smoothedSecondHalfCV
 *      - smoothedFirstHalfCV (null when either is null, same null rules as V328).
 *
 *   2. PageRangeDiffBridge329 — aggregateMomentumAcceleration329()
 *      Computes summary statistics over _momentumHistory328:
 *      count, meanMomentum, stdDevMomentum, minAcceleration, maxAcceleration,
 *      meanAcceleration (min/max/mean acceleration require at least 2 readings).
 *
 *   3. RankedOverlapBuffer329 — forecastEntropyStabilityAdaptive329(snapshotTokenSets, threshold, windowSize)
 *      Calls forecastEntropyStability328 and adjusts forecastConfidence by multiplying
 *      by stabilityScore (so a volatile window history lowers confidence).
 *      Returns all fields from forecastEntropyStability328 plus adaptedConfidence
 *      (null when forecastConfidence is null).
 *
 *   4. NormDeltaPercentilesTracker329 — summariseSpreadRankHistory329(regime)
 *      Scans _spreadRankHistory328[regime] and returns:
 *      count, belowP25Rate, inIQRRate, aboveP75Rate (fractions of stored entries
 *      in each zone), and meanNormalizedRank (arithmetic mean of non-null
 *      normalizedRank values, or null when none exist).
 *
 * Sacred files untouched (R1). All new identifiers end in `329` (R2).
 * Zero new npm deps (R3). V287..V328 surfaces preserved (R6).
 * lib/ mirrors src/lib/. package.json bumped to 329.0.0.
 *
 * @version 329.0.0
 */

const V328 = require('./marketMaker328.js');

const MM_VERSION_329 = '329.0.0';

/**
 * _ema329(values, alpha)
 * Applies exponential moving average over the values array.
 * ema[0] = values[0], ema[i] = alpha * values[i] + (1 - alpha) * ema[i-1]
 * Returns the smoothed array.
 */
function _ema329(values329, alpha329) {
  if (!values329 || values329.length === 0) return [];
  const result329 = [values329[0]];
  for (let i329 = 1; i329 < values329.length; i329++) {
    result329.push(alpha329 * values329[i329] + (1 - alpha329) * result329[i329 - 1]);
  }
  return result329;
}

/**
 * _arithmeticMean329(values)
 * Returns arithmetic mean of a numeric array, or null when empty.
 */
function _arithmeticMean329(values329) {
  if (!values329 || values329.length === 0) return null;
  return values329.reduce((s329, v329) => s329 + v329, 0) / values329.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) AuditCapTrail329
//    Extends AuditCapTrail328 with EMA-smoothed streak volatility trend.
// ─────────────────────────────────────────────────────────────────────────────

class AuditCapTrail329 extends V328.AuditCapTrail328 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * smoothStreakVolatilityTrend329()
   *
   * Applies EMA (alpha=0.5) over all streak lengths (in chronological order)
   * to produce a smoothed series of length values. Then splits the smoothed
   * series at mid = floor(n/2) into older first half [0, mid) and newer second
   * half [mid, n). Returns the arithmetic mean of each half as smoothedFirstHalfCV
   * and smoothedSecondHalfCV.
   *
   * Both are null when the respective half has fewer than 1 element.
   * smoothedCvDelta = smoothedSecondHalfCV - smoothedFirstHalfCV
   * (null when either is null).
   *
   * Returns all fields from detectMAEAlertStreakVolatilityTrend328() plus:
   *   - smoothedFirstHalfCV
   *   - smoothedSecondHalfCV
   *   - smoothedCvDelta
   *
   * @returns {{ ok, streakCount, meanStreakLength, stdDevStreakLength,
   *             coefficientOfVariation, firstHalfCV, secondHalfCV, cvDelta,
   *             smoothedFirstHalfCV, smoothedSecondHalfCV, smoothedCvDelta, version }}
   */
  smoothStreakVolatilityTrend329() {
    const base329 = this.detectMAEAlertStreakVolatilityTrend328();

    // Collect streak lengths for EMA
    const lengths329 = V328._collectStreakLengths328(this._maeAlertHistory323);
    const n329 = lengths329.length;

    let smoothedFirstHalfCV329 = null;
    let smoothedSecondHalfCV329 = null;
    let smoothedCvDelta329 = null;

    if (n329 >= 1) {
      // Apply EMA (alpha=0.5) over streak lengths
      const smoothed329 = _ema329(lengths329, 0.5);
      const mid329 = Math.floor(n329 / 2);

      // First half: smoothed[0..mid), Second half: smoothed[mid..n)
      const firstHalf329  = smoothed329.slice(0, mid329);
      const secondHalf329 = smoothed329.slice(mid329);

      smoothedFirstHalfCV329  = firstHalf329.length  >= 1 ? _arithmeticMean329(firstHalf329)  : null;
      smoothedSecondHalfCV329 = secondHalf329.length >= 1 ? _arithmeticMean329(secondHalf329) : null;

      if (smoothedFirstHalfCV329 !== null && smoothedSecondHalfCV329 !== null) {
        smoothedCvDelta329 = smoothedSecondHalfCV329 - smoothedFirstHalfCV329;
      }
    }

    return Object.assign({}, base329, {
      smoothedFirstHalfCV:  smoothedFirstHalfCV329,
      smoothedSecondHalfCV: smoothedSecondHalfCV329,
      smoothedCvDelta:      smoothedCvDelta329,
      version:              MM_VERSION_329,
    });
  }

  stats() {
    const base329 = super.stats();
    return Object.assign({}, base329, { version: MM_VERSION_329 });
  }
}

let _defaultAuditCapTrail329 = null;
function defaultAuditCapTrail329(opts) {
  if (!_defaultAuditCapTrail329 || opts) {
    _defaultAuditCapTrail329 = new AuditCapTrail329(opts || {});
  }
  return _defaultAuditCapTrail329;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) PageRangeDiffBridge329
//    Extends PageRangeDiffBridge328 with momentum acceleration aggregation.
// ─────────────────────────────────────────────────────────────────────────────

class PageRangeDiffBridge329 extends V328.PageRangeDiffBridge328 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * aggregateMomentumAcceleration329()
   *
   * Computes summary statistics over the inherited _momentumHistory328 ring.
   *
   * Returns:
   *   - count:           number of momentum entries in the ring
   *   - meanMomentum:    arithmetic mean of all momentum values (null when count=0)
   *   - stdDevMomentum:  population stdDev of momentum values (null when count=0)
   *   - minAcceleration: min of consecutive differences (null when count < 2)
   *   - maxAcceleration: max of consecutive differences (null when count < 2)
   *   - meanAcceleration: mean of consecutive differences (null when count < 2)
   *
   * @returns {{ ok, count, meanMomentum, stdDevMomentum,
   *             minAcceleration, maxAcceleration, meanAcceleration, version }}
   */
  aggregateMomentumAcceleration329() {
    const history329 = this._momentumHistory328;
    const count329   = history329.length;

    // Mean momentum
    let meanMomentum329    = null;
    let stdDevMomentum329  = null;
    let minAcceleration329 = null;
    let maxAcceleration329 = null;
    let meanAcceleration329 = null;

    if (count329 > 0) {
      // Filter finite values for momentum stats
      const finite329 = history329.filter(v329 => v329 !== null && isFinite(v329));
      if (finite329.length > 0) {
        meanMomentum329 = finite329.reduce((s329, v329) => s329 + v329, 0) / finite329.length;
        const variance329 = finite329.reduce((s329, v329) => s329 + (v329 - meanMomentum329) ** 2, 0) / finite329.length;
        stdDevMomentum329 = Math.sqrt(variance329);
      }
    }

    if (count329 >= 2) {
      // Compute consecutive accelerations
      const accels329 = [];
      for (let i329 = 1; i329 < count329; i329++) {
        const prev329 = history329[i329 - 1];
        const curr329 = history329[i329];
        if (prev329 !== null && curr329 !== null && isFinite(prev329) && isFinite(curr329)) {
          accels329.push(curr329 - prev329);
        }
      }
      if (accels329.length > 0) {
        minAcceleration329  = Math.min(...accels329);
        maxAcceleration329  = Math.max(...accels329);
        meanAcceleration329 = accels329.reduce((s329, v329) => s329 + v329, 0) / accels329.length;
      }
    }

    return {
      ok:              true,
      count:           count329,
      meanMomentum:    meanMomentum329,
      stdDevMomentum:  stdDevMomentum329,
      minAcceleration: minAcceleration329,
      maxAcceleration: maxAcceleration329,
      meanAcceleration: meanAcceleration329,
      version:         MM_VERSION_329,
    };
  }

  stats() {
    const base329 = super.stats();
    return Object.assign({}, base329, { version: MM_VERSION_329 });
  }
}

let _defaultPageRangeDiffBridge329 = null;
function defaultPageRangeDiffBridge329(opts) {
  if (!_defaultPageRangeDiffBridge329 || opts) {
    _defaultPageRangeDiffBridge329 = new PageRangeDiffBridge329(opts || {});
  }
  return _defaultPageRangeDiffBridge329;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) RankedOverlapBuffer329
//    Extends RankedOverlapBuffer328 with adaptive entropy forecast.
// ─────────────────────────────────────────────────────────────────────────────

class RankedOverlapBuffer329 extends V328.RankedOverlapBuffer328 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * forecastEntropyStabilityAdaptive329(snapshotTokenSets, threshold, windowSize)
   *
   * Calls forecastEntropyStability328 and adjusts forecastConfidence by multiplying
   * by stabilityScore so that a volatile window history lowers confidence.
   *
   * Returns all fields from forecastEntropyStability328 plus:
   *   - adaptedConfidence: forecastConfidence * stabilityScore
   *     (null when forecastConfidence is null)
   *
   * @param {string[][]} snapshotTokenSets
   * @param {number}     [threshold]
   * @param {number}     [windowSize]
   * @returns {{ ok, windowCount, meanEntropy, stdDevEntropy, stabilityScore,
   *             forecastEntropy, forecastConfidence, adaptedConfidence, version }}
   */
  forecastEntropyStabilityAdaptive329(snapshotTokenSets, threshold, windowSize) {
    const base329 = this.forecastEntropyStability328(snapshotTokenSets, threshold, windowSize);

    if (!base329.ok) {
      return Object.assign({}, base329, { version: MM_VERSION_329 });
    }

    let adaptedConfidence329 = null;
    if (base329.forecastConfidence !== null && base329.stabilityScore !== null && base329.stabilityScore !== undefined) {
      adaptedConfidence329 = base329.forecastConfidence * base329.stabilityScore;
      // Clamp to [0, 1]
      adaptedConfidence329 = Math.max(0, Math.min(1, adaptedConfidence329));
    }

    return Object.assign({}, base329, {
      adaptedConfidence: adaptedConfidence329,
      version:           MM_VERSION_329,
    });
  }

  stats() {
    const base329 = typeof super.stats === 'function' ? super.stats() : {};
    return Object.assign({}, base329, { version: MM_VERSION_329 });
  }
}

let _defaultRankedOverlapBuffer329 = null;
function defaultRankedOverlapBuffer329(opts) {
  if (!_defaultRankedOverlapBuffer329 || opts) {
    _defaultRankedOverlapBuffer329 = new RankedOverlapBuffer329(opts || {});
  }
  return _defaultRankedOverlapBuffer329;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) NormDeltaPercentilesTracker329
//    Extends NormDeltaPercentilesTracker328 with spread rank history summary.
// ─────────────────────────────────────────────────────────────────────────────

class NormDeltaPercentilesTracker329 extends V328.NormDeltaPercentilesTracker328 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * summariseSpreadRankHistory329(regime)
   *
   * Scans _spreadRankHistory328[regime] and returns:
   *   - count:            number of stored entries for the regime
   *   - belowP25Rate:     fraction of entries where belowP25 is true
   *   - inIQRRate:        fraction of entries where inIQR is true
   *   - aboveP75Rate:     fraction of entries where aboveP75 is true
   *   - meanNormalizedRank: arithmetic mean of non-null normalizedRank values
   *                        (null when no finite values exist)
   *
   * Returns ok:false when regime is invalid or unknown.
   *
   * @param {string} regime
   * @returns {{ ok, regime, count, belowP25Rate, inIQRRate, aboveP75Rate,
   *             meanNormalizedRank, version }}
   */
  summariseSpreadRankHistory329(regime329) {
    if (!regime329 || typeof regime329 !== 'string') {
      return { ok: false, error: 'regime must be a non-empty string', version: MM_VERSION_329 };
    }

    const history329 = this._spreadRankHistory328[regime329];

    if (!history329 || history329.length === 0) {
      return {
        ok:               true,
        regime:           regime329,
        count:            0,
        belowP25Rate:     null,
        inIQRRate:        null,
        aboveP75Rate:     null,
        meanNormalizedRank: null,
        version:          MM_VERSION_329,
      };
    }

    const count329 = history329.length;
    let belowP25Count329 = 0;
    let inIQRCount329    = 0;
    let aboveP75Count329 = 0;
    const normRanks329   = [];

    for (const entry329 of history329) {
      if (entry329.belowP25)  belowP25Count329++;
      if (entry329.inIQR)     inIQRCount329++;
      if (entry329.aboveP75)  aboveP75Count329++;
      if (entry329.normalizedRank !== null && entry329.normalizedRank !== undefined && isFinite(entry329.normalizedRank)) {
        normRanks329.push(entry329.normalizedRank);
      }
    }

    const meanNormalizedRank329 = normRanks329.length > 0
      ? normRanks329.reduce((s329, v329) => s329 + v329, 0) / normRanks329.length
      : null;

    return {
      ok:               true,
      regime:           regime329,
      count:            count329,
      belowP25Rate:     belowP25Count329 / count329,
      inIQRRate:        inIQRCount329    / count329,
      aboveP75Rate:     aboveP75Count329 / count329,
      meanNormalizedRank: meanNormalizedRank329,
      version:          MM_VERSION_329,
    };
  }

  stats() {
    const base329 = super.stats();
    return Object.assign({}, base329, { version: MM_VERSION_329 });
  }
}

let _defaultNormDeltaPercentilesTracker329 = null;
function defaultNormDeltaPercentilesTracker329(opts) {
  if (!_defaultNormDeltaPercentilesTracker329 || opts) {
    _defaultNormDeltaPercentilesTracker329 = new NormDeltaPercentilesTracker329(opts || {});
  }
  return _defaultNormDeltaPercentilesTracker329;
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint registration helper
// ─────────────────────────────────────────────────────────────────────────────

function registerV329Endpoints(app) {
  const trail329   = defaultAuditCapTrail329();
  const bridge329  = defaultPageRangeDiffBridge329();
  const buffer329  = defaultRankedOverlapBuffer329();
  const tracker329 = defaultNormDeltaPercentilesTracker329();

  // 1. GET smoothed streak volatility trend
  app.get(
    '/api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v329/aggregate/db/hydrate/audit/cap/forecast/mae/alert/streak/volatility/trend/smoothed',
    (req, res) => {
      try {
        res.json(trail329.smoothStreakVolatilityTrend329());
      } catch (e329) {
        res.status(500).json({ ok: false, error: e329.message, version: MM_VERSION_329 });
      }
    }
  );

  // 2. GET momentum acceleration aggregate statistics
  app.get(
    '/api/v1/market/alerts/suppress/config/v329/diff/audit/filter/paged/range/outliers/severity/burst/recovery/momentum/acceleration/aggregate',
    (req, res) => {
      try {
        res.json(bridge329.aggregateMomentumAcceleration329());
      } catch (e329) {
        res.status(500).json({ ok: false, error: e329.message, version: MM_VERSION_329 });
      }
    }
  );

  // 3. POST adaptive entropy stability forecast
  app.post(
    '/api/v1/market/backtest/sessions/v329/snapshot/search/ranked/semantic/clusters/entropy/stability/window/forecast/adaptive',
    (req, res) => {
      try {
        const snapshotTokenSets329 = req.body ? req.body.snapshotTokenSets : undefined;
        const threshold329         = req.body ? req.body.threshold         : undefined;
        const windowSize329        = req.body ? req.body.windowSize        : undefined;
        res.json(buffer329.forecastEntropyStabilityAdaptive329(snapshotTokenSets329, threshold329, windowSize329));
      } catch (e329) {
        res.status(500).json({ ok: false, error: e329.message, version: MM_VERSION_329 });
      }
    }
  );

  // 4. GET spread rank history summary
  app.get(
    '/api/v1/contracts/receipts/v329/histogram/rolling/percentiles/trend/delta/cumulative/norm/volatility/regime/sojourn/spread/rank/history/summary',
    (req, res) => {
      try {
        const regime329 = req.query.regime || '';
        res.json(tracker329.summariseSpreadRankHistory329(regime329));
      } catch (e329) {
        res.status(500).json({ ok: false, error: e329.message, version: MM_VERSION_329 });
      }
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  MM_VERSION_329,
  _ema329,
  _arithmeticMean329,
  AuditCapTrail329,
  defaultAuditCapTrail329,
  PageRangeDiffBridge329,
  defaultPageRangeDiffBridge329,
  RankedOverlapBuffer329,
  defaultRankedOverlapBuffer329,
  NormDeltaPercentilesTracker329,
  defaultNormDeltaPercentilesTracker329,
  registerV329Endpoints,
};
