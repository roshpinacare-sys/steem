'use strict';
/**
 * src/lib/marketMaker325.js — ECOS V325 (Phase P213) — MAE Alert Streak Detection,
 *                              Burst Recovery Statistics, Migration Path Entropy,
 *                              Sojourn Histogram Percentiles
 *
 * Four additive components that extend the V324 analytical layer:
 *
 *   1. AuditCapTrail325 — detectMAEAlertStreak325()
 *      Scans the V323 alert history ring to find the longest and current
 *      consecutive run of alert:true entries.
 *      Returns longestStreak, currentStreak, streakStartAt, streakEndAt.
 *
 *   2. PageRangeDiffBridge325 — aggregateBurstRecovery325()
 *      Computes summary statistics over the V324 recovery history ring:
 *      totalRecoveries, minRecoveryMs, maxRecoveryMs, meanRecoveryMs, medianRecoveryMs.
 *
 *   3. RankedOverlapBuffer325 — computeMigrationPathEntropy325(snapshotTokenSets, threshold)
 *      Calculates the Shannon entropy of the path frequency distribution from the
 *      V324 migration path analysis — how unpredictable token migration patterns are.
 *
 *   4. NormDeltaPercentilesTracker325 — computeSojournPercentiles325(regime, percentiles)
 *      Computes requested percentile values (e.g. p50, p90, p99) from the
 *      V324 _sojournSamples324 ring for the requested regime.
 *
 * Sacred files untouched (R1). All new identifiers end in `325` (R2).
 * Zero new npm deps (R3). V287..V324 surfaces preserved (R6).
 * lib/ mirrors src/lib/. package.json bumped to 325.0.0.
 *
 * @version 325.0.0
 */

const V324 = require('./marketMaker324.js');

const MM_VERSION_325 = '325.0.0';

function _coercePositiveInt325(value, fallback325) {
  const n325 = Number(value);
  if (!Number.isFinite(n325) || !Number.isInteger(n325) || n325 < 1) return fallback325;
  return n325;
}

function _coercePositiveFloat325(value, fallback325) {
  const f325 = Number(value);
  if (!Number.isFinite(f325) || f325 <= 0) return fallback325;
  return f325;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) AuditCapTrail325
//    Extends AuditCapTrail324 with MAE alert streak detection.
// ─────────────────────────────────────────────────────────────────────────────

class AuditCapTrail325 extends V324.AuditCapTrail324 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * detectMAEAlertStreak325()
   *
   * Scans the internal V323 alert history ring (_maeAlertHistory323) to find:
   * - longestStreak: the longest consecutive run of alert:true entries.
   * - currentStreak: the active streak at the tail of the history (0 if last entry has alert:false).
   * - streakStartAt: timestamp of the first entry in the longestStreak run.
   * - streakEndAt: timestamp of the last entry in the longestStreak run.
   *
   * When the history ring is empty, all fields are 0 or null.
   *
   * @returns {{ ok, longestStreak, currentStreak, streakStartAt, streakEndAt, version }}
   */
  detectMAEAlertStreak325() {
    const history325 = this._maeAlertHistory323;
    const total325   = history325.length;

    if (total325 === 0) {
      return {
        ok:            true,
        longestStreak: 0,
        currentStreak: 0,
        streakStartAt: null,
        streakEndAt:   null,
        version:       MM_VERSION_325,
      };
    }

    let longestStreak325  = 0;
    let longestStart325   = -1;
    let longestEnd325     = -1;
    let currentRun325     = 0;
    let runStart325       = -1;

    for (let i325 = 0; i325 < total325; i325++) {
      if (history325[i325].alert) {
        if (currentRun325 === 0) runStart325 = i325;
        currentRun325++;
        if (currentRun325 > longestStreak325) {
          longestStreak325 = currentRun325;
          longestStart325  = runStart325;
          longestEnd325    = i325;
        }
      } else {
        currentRun325 = 0;
        runStart325   = -1;
      }
    }

    // currentStreak: the streak at the tail of the ring
    let currentStreak325 = 0;
    for (let i325 = total325 - 1; i325 >= 0; i325--) {
      if (history325[i325].alert) {
        currentStreak325++;
      } else {
        break;
      }
    }

    return {
      ok:            true,
      longestStreak: longestStreak325,
      currentStreak: currentStreak325,
      streakStartAt: longestStart325 >= 0 ? history325[longestStart325].timestamp : null,
      streakEndAt:   longestEnd325   >= 0 ? history325[longestEnd325].timestamp   : null,
      version:       MM_VERSION_325,
    };
  }

  stats() {
    const base325 = super.stats();
    return Object.assign({}, base325, { version: MM_VERSION_325 });
  }
}

let _defaultAuditCapTrail325 = null;
function defaultAuditCapTrail325(opts) {
  if (!_defaultAuditCapTrail325 || opts) {
    _defaultAuditCapTrail325 = new AuditCapTrail325(opts || {});
  }
  return _defaultAuditCapTrail325;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) PageRangeDiffBridge325
//    Extends PageRangeDiffBridge324 with burst recovery statistics.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * _medianOf325(sortedArr)
 * Compute median of a pre-sorted numeric array (ascending).
 * @param {number[]} sortedArr
 * @returns {number}
 */
function _medianOf325(sortedArr) {
  const len325 = sortedArr.length;
  if (len325 === 0) return null;
  const mid325 = Math.floor(len325 / 2);
  if (len325 % 2 === 1) return sortedArr[mid325];
  return (sortedArr[mid325 - 1] + sortedArr[mid325]) / 2;
}

class PageRangeDiffBridge325 extends V324.PageRangeDiffBridge324 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * aggregateBurstRecovery325()
   *
   * Computes summary statistics over the V324 recovery history ring
   * (_recoveryHistory324, each entry: { quietDurationMs, burstAt }).
   *
   * Returns: { ok, totalRecoveries, minRecoveryMs, maxRecoveryMs,
   *            meanRecoveryMs, medianRecoveryMs, version }
   *
   * When the history ring is empty, all numeric stats are null.
   */
  aggregateBurstRecovery325() {
    const history325 = this._recoveryHistory324;
    const total325   = history325.length;

    if (total325 === 0) {
      return {
        ok:               true,
        totalRecoveries:  0,
        minRecoveryMs:    null,
        maxRecoveryMs:    null,
        meanRecoveryMs:   null,
        medianRecoveryMs: null,
        version:          MM_VERSION_325,
      };
    }

    const durations325 = history325.map(e => e.quietDurationMs).sort((a, b) => a - b);
    const sum325       = durations325.reduce((s, d) => s + d, 0);

    return {
      ok:               true,
      totalRecoveries:  total325,
      minRecoveryMs:    durations325[0],
      maxRecoveryMs:    durations325[durations325.length - 1],
      meanRecoveryMs:   sum325 / total325,
      medianRecoveryMs: _medianOf325(durations325),
      version:          MM_VERSION_325,
    };
  }

  stats() {
    const base325 = super.stats();
    return Object.assign({}, base325, { version: MM_VERSION_325 });
  }
}

let _defaultPageRangeDiffBridge325 = null;
function defaultPageRangeDiffBridge325(opts) {
  if (!_defaultPageRangeDiffBridge325 || opts) {
    _defaultPageRangeDiffBridge325 = new PageRangeDiffBridge325(opts || {});
  }
  return _defaultPageRangeDiffBridge325;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) RankedOverlapBuffer325
//    Extends RankedOverlapBuffer324 with migration path entropy.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * _shannonEntropy325(counts)
 * Compute Shannon entropy (bits) from an array of counts (frequencies).
 * @param {number[]} counts — positive integers
 * @returns {number}
 */
function _shannonEntropy325(counts) {
  const total325 = counts.reduce((s, c) => s + c, 0);
  if (total325 === 0) return 0;
  return counts.reduce((entropy325, count325) => {
    if (count325 === 0) return entropy325;
    const p325 = count325 / total325;
    return entropy325 - p325 * Math.log2(p325);
  }, 0);
}

class RankedOverlapBuffer325 extends V324.RankedOverlapBuffer324 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * computeMigrationPathEntropy325(snapshotTokenSets, threshold)
   *
   * Calls buildMigrationPathAnalysis324 to get path frequency distribution, then
   * computes the Shannon entropy (in bits) of how unpredictable the token migration
   * patterns are across snapshots.
   *
   * Shannon entropy = -Σ p_i * log2(p_i), where p_i = count_i / totalTokensWithPaths.
   *
   * Returns:
   * - `entropy`:          Shannon entropy in bits (0 = perfectly predictable).
   * - `pathCount`:        number of distinct paths observed.
   * - `totalTokenPaths`:  total tokens that moved at least once.
   * - `pathFrequency`:    same as returned by buildMigrationPathAnalysis324.
   * - `graph`:            raw graph from buildClusterMigrationGraph323.
   *
   * @param {string[][]} snapshotTokenSets — ordered array of token arrays (≥ 2 snapshots)
   * @param {number}     [threshold]       — Jaccard threshold (default 0.1)
   * @returns {{ ok, entropy, pathCount, totalTokenPaths, pathFrequency, graph, version }}
   */
  computeMigrationPathEntropy325(snapshotTokenSets, threshold) {
    const analysis325 = this.buildMigrationPathAnalysis324(snapshotTokenSets, threshold, Infinity);
    if (!analysis325.ok) {
      return Object.assign({}, analysis325, { version: MM_VERSION_325 });
    }

    const pathFrequency325 = analysis325.pathFrequency;
    const counts325        = Object.values(pathFrequency325);
    const totalTokens325   = counts325.reduce((s, c) => s + c, 0);
    const entropy325       = _shannonEntropy325(counts325);

    return {
      ok:               true,
      entropy:          entropy325,
      pathCount:        counts325.length,
      totalTokenPaths:  totalTokens325,
      pathFrequency:    pathFrequency325,
      graph:            analysis325.graph,
      version:          MM_VERSION_325,
    };
  }

  stats() {
    const base325 = typeof super.stats === 'function' ? super.stats() : {};
    return Object.assign({}, base325, { version: MM_VERSION_325 });
  }
}

let _defaultRankedOverlapBuffer325 = null;
function defaultRankedOverlapBuffer325(opts) {
  if (!_defaultRankedOverlapBuffer325 || opts) {
    _defaultRankedOverlapBuffer325 = new RankedOverlapBuffer325(opts || {});
  }
  return _defaultRankedOverlapBuffer325;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) NormDeltaPercentilesTracker325
//    Extends NormDeltaPercentilesTracker324 with sojourn histogram percentiles.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * _percentileOf325(sortedArr, p)
 * Compute a single percentile value (p in [0,100]) from a pre-sorted array.
 * Uses linear interpolation (nearest-rank method with fraction).
 * @param {number[]} sortedArr — ascending sorted numbers
 * @param {number}   p         — percentile in [0, 100]
 * @returns {number|null}
 */
function _percentileOf325(sortedArr, p) {
  const len325 = sortedArr.length;
  if (len325 === 0) return null;
  if (len325 === 1) return sortedArr[0];
  const pClamped325 = Math.max(0, Math.min(100, p));
  const rank325     = (pClamped325 / 100) * (len325 - 1);
  const lo325       = Math.floor(rank325);
  const hi325       = Math.ceil(rank325);
  if (lo325 === hi325) return sortedArr[lo325];
  const frac325 = rank325 - lo325;
  return sortedArr[lo325] * (1 - frac325) + sortedArr[hi325] * frac325;
}

class NormDeltaPercentilesTracker325 extends V324.NormDeltaPercentilesTracker324 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * computeSojournPercentiles325(regime, percentiles)
   *
   * Computes requested percentile values from the V324 sojourn samples ring
   * (_sojournSamples324[regime]).
   *
   * @param {string}   regime      — the regime key (e.g. 'stable', 'increasing', 'decreasing')
   * @param {number[]} [percentiles] — array of percentile values in [0,100]; defaults to [50, 90, 99]
   * @returns {{ ok, regime, sampleCount, percentiles: {p<N>: value}, version }}
   *
   * When the regime has no samples, `sampleCount` is 0 and all percentile values are null.
   * When regime is not a string, returns ok:false.
   */
  computeSojournPercentiles325(regime, percentiles) {
    if (typeof regime !== 'string' || regime.trim() === '') {
      return {
        ok:      false,
        error:   'regime must be a non-empty string',
        version: MM_VERSION_325,
      };
    }

    const requestedPcts325 = Array.isArray(percentiles) && percentiles.length > 0
      ? percentiles
      : [50, 90, 99];

    const samples325 = this._sojournSamples324[regime] || [];

    if (samples325.length === 0) {
      const emptyResult325 = {};
      requestedPcts325.forEach(p325 => {
        emptyResult325[`p${p325}`] = null;
      });
      return {
        ok:          true,
        regime:      regime,
        sampleCount: 0,
        percentiles: emptyResult325,
        version:     MM_VERSION_325,
      };
    }

    const sorted325 = samples325.slice().sort((a, b) => a - b);
    const result325 = {};
    requestedPcts325.forEach(p325 => {
      result325[`p${p325}`] = _percentileOf325(sorted325, p325);
    });

    return {
      ok:          true,
      regime:      regime,
      sampleCount: samples325.length,
      percentiles: result325,
      version:     MM_VERSION_325,
    };
  }

  stats() {
    const base325 = super.stats();
    return Object.assign({}, base325, { version: MM_VERSION_325 });
  }
}

let _defaultNormDeltaPercentilesTracker325 = null;
function defaultNormDeltaPercentilesTracker325(opts) {
  if (!_defaultNormDeltaPercentilesTracker325 || opts) {
    _defaultNormDeltaPercentilesTracker325 = new NormDeltaPercentilesTracker325(opts || {});
  }
  return _defaultNormDeltaPercentilesTracker325;
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint registration helper
// ─────────────────────────────────────────────────────────────────────────────

function registerV325Endpoints(app) {
  const trail325   = defaultAuditCapTrail325();
  const bridge325  = defaultPageRangeDiffBridge325();
  const buffer325  = defaultRankedOverlapBuffer325();
  const tracker325 = defaultNormDeltaPercentilesTracker325();

  // 1. GET MAE alert streak detection
  app.get(
    '/api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v325/aggregate/db/hydrate/audit/cap/forecast/mae/alert/streak',
    (req, res) => {
      try {
        res.json(trail325.detectMAEAlertStreak325());
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_325 });
      }
    }
  );

  // 2. GET burst recovery statistics
  app.get(
    '/api/v1/market/alerts/suppress/config/v325/diff/audit/filter/paged/range/outliers/severity/burst/recovery/stats',
    (req, res) => {
      try {
        res.json(bridge325.aggregateBurstRecovery325());
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_325 });
      }
    }
  );

  // 3. POST migration path entropy
  app.post(
    '/api/v1/market/backtest/sessions/v325/snapshot/search/ranked/semantic/clusters/migration/paths/entropy',
    (req, res) => {
      try {
        const snapshotTokenSets325 = req.body ? req.body.snapshotTokenSets : undefined;
        const threshold325         = req.body ? req.body.threshold         : undefined;
        res.json(buffer325.computeMigrationPathEntropy325(snapshotTokenSets325, threshold325));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_325 });
      }
    }
  );

  // 4. GET sojourn histogram percentiles
  app.get(
    '/api/v1/contracts/receipts/v325/histogram/rolling/percentiles/trend/delta/cumulative/norm/volatility/regime/sojourn/percentiles',
    (req, res) => {
      try {
        const regime325      = req.query.regime || '';
        const pcts325Raw325  = req.query.percentiles;
        let percentiles325   = [50, 90, 99];
        if (pcts325Raw325) {
          try {
            const parsed325 = JSON.parse(pcts325Raw325);
            if (Array.isArray(parsed325)) percentiles325 = parsed325;
          } catch (_) {
            // fallback to defaults
          }
        }
        res.json(tracker325.computeSojournPercentiles325(regime325, percentiles325));
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, version: MM_VERSION_325 });
      }
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  MM_VERSION_325,
  _coercePositiveInt325,
  _coercePositiveFloat325,
  _medianOf325,
  _shannonEntropy325,
  _percentileOf325,
  AuditCapTrail325,
  defaultAuditCapTrail325,
  PageRangeDiffBridge325,
  defaultPageRangeDiffBridge325,
  RankedOverlapBuffer325,
  defaultRankedOverlapBuffer325,
  NormDeltaPercentilesTracker325,
  defaultNormDeltaPercentilesTracker325,
  registerV325Endpoints,
};
