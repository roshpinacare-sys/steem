'use strict';
/**
 * src/lib/marketMaker327.js — ECOS V327 (Phase P215) — MAE Alert Streak Volatility,
 *                              Recovery Momentum, Entropy Stability, Sojourn Spread Percentile Rank
 *
 * Four additive components that extend the V326 analytical layer:
 *
 *   1. AuditCapTrail327 — detectMAEAlertStreakVolatility327()
 *      Analyses the distribution of alert streak lengths:
 *      streakCount (distinct runs), meanStreakLength, stdDevStreakLength,
 *      coefficientOfVariation = stdDev / mean (null when mean=0 or streakCount<2).
 *
 *   2. PageRangeDiffBridge327 — computeRecoveryMomentum327()
 *      Extends trackRecoveryTrend326() with momentum = tanh(improvementPct / 100).
 *      Returns all trend fields plus momentum (null when improvementPct is null).
 *
 *   3. RankedOverlapBuffer327 — computeEntropyStability327(snapshotTokenSets, threshold, windowSize)
 *      Divides snapshots into consecutive windows of windowSize (default 3, min 2),
 *      computes normalised entropy per window, then returns windowCount, meanEntropy,
 *      stdDevEntropy, and stabilityScore = 1 - stdDevEntropy (clamped to [0, 1]).
 *
 *   4. NormDeltaPercentilesTracker327 — computeSojournSpreadPercentileRank327(regime, value)
 *      Calls computeSojournPercentileSpread326 and locates where value falls in the spread:
 *      belowP25, inIQR, aboveP75, normalizedRank = (value - p25) / iqr (null when iqr=0).
 *
 * Sacred files untouched (R1). All new identifiers end in `327` (R2).
 * Zero new npm deps (R3). V287..V326 surfaces preserved (R6).
 * lib/ mirrors src/lib/. package.json bumped to 327.0.0.
 *
 * @version 327.0.0
 */

const V326 = require('./marketMaker326.js');

const MM_VERSION_327 = '327.0.0';

function _coercePositiveInt327(value, fallback327) {
  const n327 = Number(value);
  if (!Number.isFinite(n327) || !Number.isInteger(n327) || n327 < 1) return fallback327;
  return n327;
}

function _coercePositiveFloat327(value, fallback327) {
  const f327 = Number(value);
  if (!Number.isFinite(f327) || f327 <= 0) return fallback327;
  return f327;
}

/**
 * _stdDevOf327(arr, mean)
 * Compute population standard deviation of a numeric array given its mean.
 * @param {number[]} arr
 * @param {number}   mean
 * @returns {number}
 */
function _stdDevOf327(arr, mean327) {
  if (!arr || arr.length === 0) return 0;
  const variance327 = arr.reduce((s327, v327) => s327 + (v327 - mean327) ** 2, 0) / arr.length;
  return Math.sqrt(variance327);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) AuditCapTrail327
//    Extends AuditCapTrail326 with MAE alert streak volatility analysis.
// ─────────────────────────────────────────────────────────────────────────────

class AuditCapTrail327 extends V326.AuditCapTrail326 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * detectMAEAlertStreakVolatility327()
   *
   * Analyses the distribution of distinct alert streak lengths in _maeAlertHistory323.
   * An alert streak is a maximal consecutive run of entries where isAlert is true.
   *
   * Returns:
   * - streakCount:            number of distinct alert runs (0 when no alerts exist).
   * - meanStreakLength:        arithmetic mean of streak lengths (null when streakCount=0).
   * - stdDevStreakLength:      population standard deviation of streak lengths
   *                            (null when streakCount=0).
   * - coefficientOfVariation:  stdDev / mean  (null when mean=0 or streakCount<2).
   *
   * @returns {{ ok, streakCount, meanStreakLength, stdDevStreakLength,
   *             coefficientOfVariation, version }}
   */
  detectMAEAlertStreakVolatility327() {
    const history327 = this._maeAlertHistory323;

    // Collect all streak lengths
    const streakLengths327 = [];
    let inStreak327        = false;
    let currentLen327      = 0;

    for (const entry327 of history327) {
      if (entry327.alert) {
        inStreak327 = true;
        currentLen327++;
      } else {
        if (inStreak327) {
          streakLengths327.push(currentLen327);
          inStreak327    = false;
          currentLen327  = 0;
        }
      }
    }
    // Close any open streak at end of history
    if (inStreak327 && currentLen327 > 0) {
      streakLengths327.push(currentLen327);
    }

    const streakCount327 = streakLengths327.length;

    if (streakCount327 === 0) {
      return {
        ok:                    true,
        streakCount:           0,
        meanStreakLength:       null,
        stdDevStreakLength:     null,
        coefficientOfVariation: null,
        version:               MM_VERSION_327,
      };
    }

    const mean327   = streakLengths327.reduce((s327, v327) => s327 + v327, 0) / streakCount327;
    const stdDev327 = _stdDevOf327(streakLengths327, mean327);

    let cv327 = null;
    if (streakCount327 >= 2 && mean327 !== 0) {
      cv327 = stdDev327 / mean327;
    }

    return {
      ok:                    true,
      streakCount:           streakCount327,
      meanStreakLength:       mean327,
      stdDevStreakLength:     stdDev327,
      coefficientOfVariation: cv327,
      version:               MM_VERSION_327,
    };
  }

  stats() {
    const base327 = super.stats();
    return Object.assign({}, base327, { version: MM_VERSION_327 });
  }
}

let _defaultAuditCapTrail327 = null;
function defaultAuditCapTrail327(opts) {
  if (!_defaultAuditCapTrail327 || opts) {
    _defaultAuditCapTrail327 = new AuditCapTrail327(opts || {});
  }
  return _defaultAuditCapTrail327;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) PageRangeDiffBridge327
//    Extends PageRangeDiffBridge326 with recovery momentum.
// ─────────────────────────────────────────────────────────────────────────────

class PageRangeDiffBridge327 extends V326.PageRangeDiffBridge326 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * computeRecoveryMomentum327()
   *
   * Extends trackRecoveryTrend326() with a momentum score:
   *   momentum = tanh(improvementPct / 100)
   *
   * momentum is null when improvementPct is null.
   * Returns all fields from trackRecoveryTrend326() plus momentum.
   *
   * @returns {{ ok, totalRecoveries, firstHalfMeanMs, secondHalfMeanMs,
   *             improvementPct, momentum, version }}
   */
  computeRecoveryMomentum327() {
    const base327 = this.trackRecoveryTrend326();

    let momentum327 = null;
    if (base327.improvementPct !== null) {
      momentum327 = Math.tanh(base327.improvementPct / 100);
    }

    return Object.assign({}, base327, {
      momentum: momentum327,
      version:  MM_VERSION_327,
    });
  }

  stats() {
    const base327 = super.stats();
    return Object.assign({}, base327, { version: MM_VERSION_327 });
  }
}

let _defaultPageRangeDiffBridge327 = null;
function defaultPageRangeDiffBridge327(opts) {
  if (!_defaultPageRangeDiffBridge327 || opts) {
    _defaultPageRangeDiffBridge327 = new PageRangeDiffBridge327(opts || {});
  }
  return _defaultPageRangeDiffBridge327;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) RankedOverlapBuffer327
//    Extends RankedOverlapBuffer326 with entropy stability across windows.
// ─────────────────────────────────────────────────────────────────────────────

class RankedOverlapBuffer327 extends V326.RankedOverlapBuffer326 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * computeEntropyStability327(snapshotTokenSets, threshold, windowSize)
   *
   * Divides snapshotTokenSets into consecutive non-overlapping windows of
   * windowSize snapshots (default 3, minimum 2). Computes
   * computeNormalisedMigrationPathEntropy326 for each window. Then returns:
   *   - windowCount:    number of windows processed.
   *   - meanEntropy:    arithmetic mean of normalised entropy values across windows.
   *   - stdDevEntropy:  population standard deviation of those values.
   *   - stabilityScore: 1 - stdDevEntropy, clamped to [0, 1].
   *
   * Returns ok:false when snapshotTokenSets is invalid or no complete window
   * can be formed (fewer than windowSize snapshots total).
   *
   * @param {string[][]} snapshotTokenSets — ordered array of token arrays
   * @param {number}     [threshold]       — Jaccard threshold (default 0.1)
   * @param {number}     [windowSize]      — window size (default 3, minimum 2)
   * @returns {{ ok, windowCount, meanEntropy, stdDevEntropy, stabilityScore, version }}
   */
  computeEntropyStability327(snapshotTokenSets, threshold, windowSize) {
    if (!Array.isArray(snapshotTokenSets)) {
      return { ok: false, error: 'snapshotTokenSets must be an array', version: MM_VERSION_327 };
    }

    const ws327 = Math.max(2, _coercePositiveInt327(windowSize, 3));
    const n327  = snapshotTokenSets.length;

    if (n327 < ws327) {
      return {
        ok:    false,
        error: 'not enough snapshots to form a window',
        version: MM_VERSION_327,
      };
    }

    const entropyValues327 = [];
    let windowStart327 = 0;

    while (windowStart327 + ws327 <= n327) {
      const window327 = snapshotTokenSets.slice(windowStart327, windowStart327 + ws327);
      const result327 = this.computeNormalisedMigrationPathEntropy326(window327, threshold);
      if (result327.ok) {
        entropyValues327.push(result327.normalisedEntropy);
      }
      windowStart327 += ws327;
    }

    const windowCount327 = entropyValues327.length;

    if (windowCount327 === 0) {
      return {
        ok:             false,
        error:          'no valid windows could be computed',
        version:        MM_VERSION_327,
      };
    }

    const mean327   = entropyValues327.reduce((s327, v327) => s327 + v327, 0) / windowCount327;
    const stdDev327 = _stdDevOf327(entropyValues327, mean327);

    const stabilityScore327 = Math.min(1, Math.max(0, 1 - stdDev327));

    return {
      ok:             true,
      windowCount:    windowCount327,
      meanEntropy:    mean327,
      stdDevEntropy:  stdDev327,
      stabilityScore: stabilityScore327,
      version:        MM_VERSION_327,
    };
  }

  stats() {
    const base327 = typeof super.stats === 'function' ? super.stats() : {};
    return Object.assign({}, base327, { version: MM_VERSION_327 });
  }
}

let _defaultRankedOverlapBuffer327 = null;
function defaultRankedOverlapBuffer327(opts) {
  if (!_defaultRankedOverlapBuffer327 || opts) {
    _defaultRankedOverlapBuffer327 = new RankedOverlapBuffer327(opts || {});
  }
  return _defaultRankedOverlapBuffer327;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) NormDeltaPercentilesTracker327
//    Extends NormDeltaPercentilesTracker326 with sojourn spread percentile rank.
// ─────────────────────────────────────────────────────────────────────────────

class NormDeltaPercentilesTracker327 extends V326.NormDeltaPercentilesTracker326 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * computeSojournSpreadPercentileRank327(regime, value)
   *
   * Calls computeSojournPercentileSpread326(regime) and locates where value
   * falls within the IQR spread:
   *   - belowP25:      value < p25
   *   - inIQR:         p25 <= value <= p75
   *   - aboveP75:      value > p75
   *   - normalizedRank: (value - p25) / iqr  (null when iqr=0)
   *
   * Propagates ok:false when computeSojournPercentileSpread326 fails.
   * When the regime has no samples (iqr/median null), classification fields
   * are all null.
   *
   * @param {string} regime — the regime key
   * @param {number} value  — the value to rank within the spread
   * @returns {{ ok, regime, value, belowP25, inIQR, aboveP75, normalizedRank, version }}
   */
  computeSojournSpreadPercentileRank327(regime, value) {
    const spread327 = this.computeSojournPercentileSpread326(regime);
    if (!spread327.ok) {
      return Object.assign({}, spread327, { version: MM_VERSION_327 });
    }

    // Need p25 and p75 — call percentiles325 directly with [25, 75]
    const pct327 = this.computeSojournPercentiles325(regime, [25, 75]);
    if (!pct327.ok) {
      return Object.assign({}, pct327, { version: MM_VERSION_327 });
    }

    const p25327 = pct327.percentiles['p25'];
    const p75327 = pct327.percentiles['p75'];
    const iqr327 = spread327.iqr;

    // When no samples, classify as all null
    if (p25327 === null || p75327 === null) {
      return {
        ok:              true,
        regime:          regime,
        value:           value,
        belowP25:        null,
        inIQR:           null,
        aboveP75:        null,
        normalizedRank:  null,
        version:         MM_VERSION_327,
      };
    }

    const v327 = Number(value);
    const belowP25327  = v327 < p25327;
    const aboveP75327  = v327 > p75327;
    const inIQR327     = !belowP25327 && !aboveP75327;

    let normalizedRank327 = null;
    if (iqr327 !== null && iqr327 !== 0) {
      normalizedRank327 = (v327 - p25327) / iqr327;
    }

    return {
      ok:             true,
      regime:         regime,
      value:          v327,
      belowP25:       belowP25327,
      inIQR:          inIQR327,
      aboveP75:       aboveP75327,
      normalizedRank: normalizedRank327,
      version:        MM_VERSION_327,
    };
  }

  stats() {
    const base327 = super.stats();
    return Object.assign({}, base327, { version: MM_VERSION_327 });
  }
}

let _defaultNormDeltaPercentilesTracker327 = null;
function defaultNormDeltaPercentilesTracker327(opts) {
  if (!_defaultNormDeltaPercentilesTracker327 || opts) {
    _defaultNormDeltaPercentilesTracker327 = new NormDeltaPercentilesTracker327(opts || {});
  }
  return _defaultNormDeltaPercentilesTracker327;
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint registration helper
// ─────────────────────────────────────────────────────────────────────────────

function registerV327Endpoints(app) {
  const trail327   = defaultAuditCapTrail327();
  const bridge327  = defaultPageRangeDiffBridge327();
  const buffer327  = defaultRankedOverlapBuffer327();
  const tracker327 = defaultNormDeltaPercentilesTracker327();

  // 1. GET MAE alert streak volatility
  app.get(
    '/api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v327/aggregate/db/hydrate/audit/cap/forecast/mae/alert/streak/volatility',
    (req, res) => {
      try {
        res.json(trail327.detectMAEAlertStreakVolatility327());
      } catch (e327) {
        res.status(500).json({ ok: false, error: e327.message, version: MM_VERSION_327 });
      }
    }
  );

  // 2. GET burst recovery momentum
  app.get(
    '/api/v1/market/alerts/suppress/config/v327/diff/audit/filter/paged/range/outliers/severity/burst/recovery/momentum',
    (req, res) => {
      try {
        res.json(bridge327.computeRecoveryMomentum327());
      } catch (e327) {
        res.status(500).json({ ok: false, error: e327.message, version: MM_VERSION_327 });
      }
    }
  );

  // 3. POST entropy stability across windows
  app.post(
    '/api/v1/market/backtest/sessions/v327/snapshot/search/ranked/semantic/clusters/entropy/stability/window',
    (req, res) => {
      try {
        const snapshotTokenSets327 = req.body ? req.body.snapshotTokenSets : undefined;
        const threshold327         = req.body ? req.body.threshold         : undefined;
        const windowSize327        = req.body ? req.body.windowSize        : undefined;
        res.json(buffer327.computeEntropyStability327(snapshotTokenSets327, threshold327, windowSize327));
      } catch (e327) {
        res.status(500).json({ ok: false, error: e327.message, version: MM_VERSION_327 });
      }
    }
  );

  // 4. GET sojourn spread percentile rank
  app.get(
    '/api/v1/contracts/receipts/v327/histogram/rolling/percentiles/trend/delta/cumulative/norm/volatility/regime/sojourn/spread/rank',
    (req, res) => {
      try {
        const regime327 = req.query.regime || '';
        const value327  = req.query.value !== undefined ? Number(req.query.value) : NaN;
        res.json(tracker327.computeSojournSpreadPercentileRank327(regime327, value327));
      } catch (e327) {
        res.status(500).json({ ok: false, error: e327.message, version: MM_VERSION_327 });
      }
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  MM_VERSION_327,
  _coercePositiveInt327,
  _coercePositiveFloat327,
  _stdDevOf327,
  AuditCapTrail327,
  defaultAuditCapTrail327,
  PageRangeDiffBridge327,
  defaultPageRangeDiffBridge327,
  RankedOverlapBuffer327,
  defaultRankedOverlapBuffer327,
  NormDeltaPercentilesTracker327,
  defaultNormDeltaPercentilesTracker327,
  registerV327Endpoints,
};
