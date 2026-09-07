'use strict';
/**
 * src/lib/marketMaker328.js — ECOS V328 (Phase P216) — Streak Volatility Trend,
 *                              Momentum Acceleration, Entropy Stability Forecast,
 *                              Spread Rank History
 *
 * Four additive components that extend the V327 analytical layer:
 *
 *   1. AuditCapTrail328 — detectMAEAlertStreakVolatilityTrend328()
 *      Calls detectMAEAlertStreakVolatility327() and additionally splits the streak
 *      lengths into two halves (older vs newer), returning:
 *      firstHalfCV, secondHalfCV (null when half has fewer than 2 streaks or mean=0),
 *      cvDelta = secondHalfCV - firstHalfCV (null when either is null).
 *      A negative cvDelta means streak volatility is decreasing over time.
 *
 *   2. PageRangeDiffBridge328 — computeRecoveryMomentumAcceleration328()
 *      Maintains a bounded ring _momentumHistory328 (max 50) of momentum values.
 *      Returns currentMomentum (latest), previousMomentum (second-to-last, or null
 *      when fewer than 2 readings), and acceleration = currentMomentum - previousMomentum
 *      (null when either is null).
 *
 *   3. RankedOverlapBuffer328 — forecastEntropyStability328(snapshotTokenSets, threshold, windowSize)
 *      Calls computeEntropyStability327 and extrapolates a one-window-ahead forecast
 *      using simple linear regression (least-squares) over per-window entropy values.
 *      Returns all fields from computeEntropyStability327 plus:
 *      forecastEntropy (predicted next-window entropy, null when windowCount < 2),
 *      forecastConfidence = max(0, 1 - residualStdDev) (null when windowCount < 2).
 *
 *   4. NormDeltaPercentilesTracker328 — recordSojournSpreadPercentileRank328(regime, value)
 *      Calls computeSojournSpreadPercentileRank327(regime, value), stores the result in a
 *      bounded ring _spreadRankHistory328 (max 200 entries per regime), and returns the
 *      result plus historyCount (number of stored results for that regime).
 *
 * Sacred files untouched (R1). All new identifiers end in `328` (R2).
 * Zero new npm deps (R3). V287..V327 surfaces preserved (R6).
 * lib/ mirrors src/lib/. package.json bumped to 328.0.0.
 *
 * @version 328.0.0
 */

const V327 = require('./marketMaker327.js');

const MM_VERSION_328 = '328.0.0';

/**
 * _ringPush328(ring, value, maxSize)
 * Appends value to ring array, trimming to maxSize from the front.
 */
function _ringPush328(ring328, value328, maxSize328) {
  ring328.push(value328);
  if (ring328.length > maxSize328) {
    ring328.shift();
  }
}

/**
 * _halfCV328(lengths, start, end)
 * Computes coefficient of variation for a slice of streak lengths [start, end).
 * Returns null when fewer than 2 elements or mean is 0.
 */
function _halfCV328(lengths328, start328, end328) {
  const slice328 = lengths328.slice(start328, end328);
  if (slice328.length < 2) return null;
  const mean328 = slice328.reduce((s328, v328) => s328 + v328, 0) / slice328.length;
  if (mean328 === 0) return null;
  const variance328 = slice328.reduce((s328, v328) => s328 + (v328 - mean328) ** 2, 0) / slice328.length;
  const stdDev328 = Math.sqrt(variance328);
  return stdDev328 / mean328;
}

/**
 * _collectStreakLengths328(history)
 * Scans _maeAlertHistory323-shaped array and returns an array of streak lengths
 * (maximal consecutive runs where entry.alert === true).
 */
function _collectStreakLengths328(history328) {
  const lengths328 = [];
  let inStreak328 = false;
  let currentLen328 = 0;

  for (const entry328 of history328) {
    if (entry328.alert) {
      inStreak328 = true;
      currentLen328++;
    } else {
      if (inStreak328) {
        lengths328.push(currentLen328);
        inStreak328 = false;
        currentLen328 = 0;
      }
    }
  }
  if (inStreak328 && currentLen328 > 0) {
    lengths328.push(currentLen328);
  }
  return lengths328;
}

/**
 * _linearRegression328(values)
 * Performs simple ordinary least-squares regression of values[i] against index i.
 * Returns { slope, intercept, residualStdDev }.
 * residualStdDev is the population stdDev of residuals (y_i - y_hat_i).
 */
function _linearRegression328(values328) {
  const n328 = values328.length;
  if (n328 < 2) return { slope: 0, intercept: values328[0] !== undefined ? values328[0] : 0, residualStdDev: 0 };

  // Compute means
  const xMean328 = (n328 - 1) / 2; // mean of 0..n-1
  const yMean328 = values328.reduce((s328, v328) => s328 + v328, 0) / n328;

  // Compute slope
  let ssXY328 = 0;
  let ssXX328 = 0;
  for (let i328 = 0; i328 < n328; i328++) {
    const dx328 = i328 - xMean328;
    ssXY328 += dx328 * (values328[i328] - yMean328);
    ssXX328 += dx328 * dx328;
  }

  const slope328 = ssXX328 !== 0 ? ssXY328 / ssXX328 : 0;
  const intercept328 = yMean328 - slope328 * xMean328;

  // Compute residual stdDev (population)
  let sumResidSq328 = 0;
  for (let i328 = 0; i328 < n328; i328++) {
    const residual328 = values328[i328] - (slope328 * i328 + intercept328);
    sumResidSq328 += residual328 * residual328;
  }
  const residualStdDev328 = Math.sqrt(sumResidSq328 / n328);

  return { slope: slope328, intercept: intercept328, residualStdDev: residualStdDev328 };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) AuditCapTrail328
//    Extends AuditCapTrail327 with streak volatility trend analysis.
// ─────────────────────────────────────────────────────────────────────────────

class AuditCapTrail328 extends V327.AuditCapTrail327 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * detectMAEAlertStreakVolatilityTrend328()
   *
   * Calls detectMAEAlertStreakVolatility327() and additionally splits the
   * collected streak lengths into two halves (older first half, newer second half).
   * For each half, computes the coefficient of variation (stdDev/mean).
   *
   * Returns:
   *   - All fields from detectMAEAlertStreakVolatility327()
   *   - firstHalfCV:  CV of the older half (null when half has < 2 streaks or mean=0)
   *   - secondHalfCV: CV of the newer half (null when half has < 2 streaks or mean=0)
   *   - cvDelta:      secondHalfCV - firstHalfCV (null when either is null)
   *     A negative cvDelta indicates streak volatility is decreasing over time.
   *
   * @returns {{ ok, streakCount, meanStreakLength, stdDevStreakLength,
   *             coefficientOfVariation, firstHalfCV, secondHalfCV, cvDelta, version }}
   */
  detectMAEAlertStreakVolatilityTrend328() {
    const base328 = this.detectMAEAlertStreakVolatility327();

    // Collect streak lengths directly for half-split
    const lengths328 = _collectStreakLengths328(this._maeAlertHistory323);
    const n328 = lengths328.length;

    let firstHalfCV328 = null;
    let secondHalfCV328 = null;
    let cvDelta328 = null;

    if (n328 >= 1) {
      const mid328 = Math.floor(n328 / 2);
      // older half: [0, mid), newer half: [mid, n)
      firstHalfCV328  = _halfCV328(lengths328, 0, mid328);
      secondHalfCV328 = _halfCV328(lengths328, mid328, n328);

      if (firstHalfCV328 !== null && secondHalfCV328 !== null) {
        cvDelta328 = secondHalfCV328 - firstHalfCV328;
      }
    }

    return Object.assign({}, base328, {
      firstHalfCV:  firstHalfCV328,
      secondHalfCV: secondHalfCV328,
      cvDelta:      cvDelta328,
      version:      MM_VERSION_328,
    });
  }

  stats() {
    const base328 = super.stats();
    return Object.assign({}, base328, { version: MM_VERSION_328 });
  }
}

let _defaultAuditCapTrail328 = null;
function defaultAuditCapTrail328(opts) {
  if (!_defaultAuditCapTrail328 || opts) {
    _defaultAuditCapTrail328 = new AuditCapTrail328(opts || {});
  }
  return _defaultAuditCapTrail328;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) PageRangeDiffBridge328
//    Extends PageRangeDiffBridge327 with momentum acceleration tracking.
// ─────────────────────────────────────────────────────────────────────────────

class PageRangeDiffBridge328 extends V327.PageRangeDiffBridge327 {
  constructor(opts = {}) {
    super(opts);
    // Bounded ring of the last 50 momentum values
    this._momentumHistory328 = [];
  }

  /**
   * computeRecoveryMomentumAcceleration328()
   *
   * Calls computeRecoveryMomentum327(), appends the returned momentum value to
   * _momentumHistory328 (bounded ring of max 50), and returns:
   *   - currentMomentum:  latest momentum value
   *   - previousMomentum: second-to-last value (null when fewer than 2 readings)
   *   - acceleration:     currentMomentum - previousMomentum (null when either is null)
   *
   * All fields from computeRecoveryMomentum327() are also preserved.
   *
   * @returns {{ ok, ...<fields from computeRecoveryMomentum327>, currentMomentum,
   *             previousMomentum, acceleration, version }}
   */
  computeRecoveryMomentumAcceleration328() {
    const base328 = this.computeRecoveryMomentum327();

    // Append current momentum to history ring
    const currentMomentum328 = base328.momentum;
    _ringPush328(this._momentumHistory328, currentMomentum328, 50);

    const histLen328 = this._momentumHistory328.length;
    const previousMomentum328 = histLen328 >= 2
      ? this._momentumHistory328[histLen328 - 2]
      : null;

    let acceleration328 = null;
    if (currentMomentum328 !== null && previousMomentum328 !== null) {
      acceleration328 = currentMomentum328 - previousMomentum328;
    }

    return Object.assign({}, base328, {
      currentMomentum:  currentMomentum328,
      previousMomentum: previousMomentum328,
      acceleration:     acceleration328,
      version:          MM_VERSION_328,
    });
  }

  stats() {
    const base328 = super.stats();
    return Object.assign({}, base328, { version: MM_VERSION_328 });
  }
}

let _defaultPageRangeDiffBridge328 = null;
function defaultPageRangeDiffBridge328(opts) {
  if (!_defaultPageRangeDiffBridge328 || opts) {
    _defaultPageRangeDiffBridge328 = new PageRangeDiffBridge328(opts || {});
  }
  return _defaultPageRangeDiffBridge328;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) RankedOverlapBuffer328
//    Extends RankedOverlapBuffer327 with entropy stability forecasting.
// ─────────────────────────────────────────────────────────────────────────────

class RankedOverlapBuffer328 extends V327.RankedOverlapBuffer327 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * forecastEntropyStability328(snapshotTokenSets, threshold, windowSize)
   *
   * Calls computeEntropyStability327(snapshotTokenSets, threshold, windowSize) and
   * extrapolates a one-window-ahead forecast using simple linear regression
   * (least-squares) over the per-window entropy values.
   *
   * To get the per-window entropy values, this method recomputes them directly
   * (same logic as computeEntropyStability327 but retaining individual values).
   *
   * Returns all fields from computeEntropyStability327 plus:
   *   - forecastEntropy:     predicted next-window normalised entropy (null when windowCount < 2)
   *   - forecastConfidence:  max(0, 1 - residualStdDev) (null when windowCount < 2)
   *
   * Returns ok:false (propagated from computeEntropyStability327) when input is invalid.
   *
   * @param {string[][]} snapshotTokenSets
   * @param {number}     [threshold]
   * @param {number}     [windowSize]
   * @returns {{ ok, windowCount, meanEntropy, stdDevEntropy, stabilityScore,
   *             forecastEntropy, forecastConfidence, version }}
   */
  forecastEntropyStability328(snapshotTokenSets, threshold, windowSize) {
    // First get the base stability result
    const base328 = this.computeEntropyStability327(snapshotTokenSets, threshold, windowSize);
    if (!base328.ok) {
      return Object.assign({}, base328, { version: MM_VERSION_328 });
    }

    // Recompute per-window entropy values for regression
    const ws328 = Math.max(2, (windowSize !== undefined && Number.isInteger(Number(windowSize)) && Number(windowSize) >= 1) ? Number(windowSize) : 3);
    const n328 = snapshotTokenSets.length;
    const entropyValues328 = [];
    let windowStart328 = 0;

    while (windowStart328 + ws328 <= n328) {
      const window328 = snapshotTokenSets.slice(windowStart328, windowStart328 + ws328);
      const result328 = this.computeNormalisedMigrationPathEntropy326(window328, threshold);
      if (result328.ok) {
        entropyValues328.push(result328.normalisedEntropy);
      }
      windowStart328 += ws328;
    }

    const windowCount328 = entropyValues328.length;

    let forecastEntropy328 = null;
    let forecastConfidence328 = null;

    if (windowCount328 >= 2) {
      const reg328 = _linearRegression328(entropyValues328);
      // Forecast at index = windowCount328 (next window)
      forecastEntropy328 = reg328.slope * windowCount328 + reg328.intercept;
      forecastConfidence328 = Math.max(0, 1 - reg328.residualStdDev);
    }

    return Object.assign({}, base328, {
      forecastEntropy:     forecastEntropy328,
      forecastConfidence:  forecastConfidence328,
      version:             MM_VERSION_328,
    });
  }

  stats() {
    const base328 = typeof super.stats === 'function' ? super.stats() : {};
    return Object.assign({}, base328, { version: MM_VERSION_328 });
  }
}

let _defaultRankedOverlapBuffer328 = null;
function defaultRankedOverlapBuffer328(opts) {
  if (!_defaultRankedOverlapBuffer328 || opts) {
    _defaultRankedOverlapBuffer328 = new RankedOverlapBuffer328(opts || {});
  }
  return _defaultRankedOverlapBuffer328;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) NormDeltaPercentilesTracker328
//    Extends NormDeltaPercentilesTracker327 with spread rank history recording.
// ─────────────────────────────────────────────────────────────────────────────

class NormDeltaPercentilesTracker328 extends V327.NormDeltaPercentilesTracker327 {
  constructor(opts = {}) {
    super(opts);
    // Bounded ring per regime: { [regime]: result[] }
    this._spreadRankHistory328 = {};
  }

  /**
   * recordSojournSpreadPercentileRank328(regime, value)
   *
   * Calls computeSojournSpreadPercentileRank327(regime, value), stores the result
   * in a bounded ring _spreadRankHistory328 (max 200 entries per regime), and returns
   * the result plus historyCount (number of stored results for that regime).
   *
   * Propagates ok:false when computeSojournSpreadPercentileRank327 fails.
   *
   * @param {string} regime
   * @param {number} value
   * @returns {{ ok, ...<fields from computeSojournSpreadPercentileRank327>,
   *             historyCount, version }}
   */
  recordSojournSpreadPercentileRank328(regime, value) {
    const result328 = this.computeSojournSpreadPercentileRank327(regime, value);
    if (!result328.ok) {
      return Object.assign({}, result328, { version: MM_VERSION_328 });
    }

    // Initialise ring for this regime if needed
    if (!this._spreadRankHistory328[regime]) {
      this._spreadRankHistory328[regime] = [];
    }

    _ringPush328(this._spreadRankHistory328[regime], result328, 200);

    const historyCount328 = this._spreadRankHistory328[regime].length;

    return Object.assign({}, result328, {
      historyCount: historyCount328,
      version:      MM_VERSION_328,
    });
  }

  stats() {
    const base328 = super.stats();
    return Object.assign({}, base328, { version: MM_VERSION_328 });
  }
}

let _defaultNormDeltaPercentilesTracker328 = null;
function defaultNormDeltaPercentilesTracker328(opts) {
  if (!_defaultNormDeltaPercentilesTracker328 || opts) {
    _defaultNormDeltaPercentilesTracker328 = new NormDeltaPercentilesTracker328(opts || {});
  }
  return _defaultNormDeltaPercentilesTracker328;
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint registration helper
// ─────────────────────────────────────────────────────────────────────────────

function registerV328Endpoints(app) {
  const trail328   = defaultAuditCapTrail328();
  const bridge328  = defaultPageRangeDiffBridge328();
  const buffer328  = defaultRankedOverlapBuffer328();
  const tracker328 = defaultNormDeltaPercentilesTracker328();

  // 1. GET MAE alert streak volatility trend
  app.get(
    '/api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v328/aggregate/db/hydrate/audit/cap/forecast/mae/alert/streak/volatility/trend',
    (req, res) => {
      try {
        res.json(trail328.detectMAEAlertStreakVolatilityTrend328());
      } catch (e328) {
        res.status(500).json({ ok: false, error: e328.message, version: MM_VERSION_328 });
      }
    }
  );

  // 2. GET recovery momentum acceleration
  app.get(
    '/api/v1/market/alerts/suppress/config/v328/diff/audit/filter/paged/range/outliers/severity/burst/recovery/momentum/acceleration',
    (req, res) => {
      try {
        res.json(bridge328.computeRecoveryMomentumAcceleration328());
      } catch (e328) {
        res.status(500).json({ ok: false, error: e328.message, version: MM_VERSION_328 });
      }
    }
  );

  // 3. POST entropy stability forecast
  app.post(
    '/api/v1/market/backtest/sessions/v328/snapshot/search/ranked/semantic/clusters/entropy/stability/window/forecast',
    (req, res) => {
      try {
        const snapshotTokenSets328 = req.body ? req.body.snapshotTokenSets : undefined;
        const threshold328         = req.body ? req.body.threshold         : undefined;
        const windowSize328        = req.body ? req.body.windowSize        : undefined;
        res.json(buffer328.forecastEntropyStability328(snapshotTokenSets328, threshold328, windowSize328));
      } catch (e328) {
        res.status(500).json({ ok: false, error: e328.message, version: MM_VERSION_328 });
      }
    }
  );

  // 4. GET sojourn spread percentile rank with history recording
  app.get(
    '/api/v1/contracts/receipts/v328/histogram/rolling/percentiles/trend/delta/cumulative/norm/volatility/regime/sojourn/spread/rank/history',
    (req, res) => {
      try {
        const regime328 = req.query.regime || '';
        const value328  = req.query.value !== undefined ? Number(req.query.value) : NaN;
        res.json(tracker328.recordSojournSpreadPercentileRank328(regime328, value328));
      } catch (e328) {
        res.status(500).json({ ok: false, error: e328.message, version: MM_VERSION_328 });
      }
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  MM_VERSION_328,
  _ringPush328,
  _halfCV328,
  _collectStreakLengths328,
  _linearRegression328,
  AuditCapTrail328,
  defaultAuditCapTrail328,
  PageRangeDiffBridge328,
  defaultPageRangeDiffBridge328,
  RankedOverlapBuffer328,
  defaultRankedOverlapBuffer328,
  NormDeltaPercentilesTracker328,
  defaultNormDeltaPercentilesTracker328,
  registerV328Endpoints,
};
