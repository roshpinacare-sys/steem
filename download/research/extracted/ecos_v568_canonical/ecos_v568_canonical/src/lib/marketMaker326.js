'use strict';
/**
 * src/lib/marketMaker326.js — ECOS V326 (Phase P214) — MAE Alert Streak Rate,
 *                              Recovery Trend Tracking, Normalised Migration Path Entropy,
 *                              Sojourn Percentile Spread
 *
 * Four additive components that extend the V325 analytical layer:
 *
 *   1. AuditCapTrail326 — detectMAEAlertStreakRate326()
 *      Extends detectMAEAlertStreak325() with per-entry ratios:
 *      currentStreakRate = currentStreak / totalEntries,
 *      longestStreakRate = longestStreak / totalEntries.
 *      Returns all streak fields plus the two rate fields.
 *
 *   2. PageRangeDiffBridge326 — trackRecoveryTrend326()
 *      Splits _recoveryHistory324 into older vs newer halves and computes
 *      firstHalfMeanMs, secondHalfMeanMs, and
 *      improvementPct = ((firstHalfMean - secondHalfMean) / firstHalfMean) * 100.
 *      Positive improvementPct means the system recovers faster over time.
 *
 *   3. RankedOverlapBuffer326 — computeNormalisedMigrationPathEntropy326(snapshotTokenSets, threshold)
 *      Calls computeMigrationPathEntropy325 and normalises the raw Shannon entropy
 *      by log2(pathCount) to produce a normalised entropy in [0, 1].
 *      When pathCount < 2, normalisedEntropy is 0.
 *
 *   4. NormDeltaPercentilesTracker326 — computeSojournPercentileSpread326(regime)
 *      Calls computeSojournPercentiles325 with [25, 50, 75] and returns
 *      iqr (p75 - p25), median (p50), and spreadRatio = iqr / median
 *      (null when median is 0 or null).
 *
 * Sacred files untouched (R1). All new identifiers end in `326` (R2).
 * Zero new npm deps (R3). V287..V325 surfaces preserved (R6).
 * lib/ mirrors src/lib/. package.json bumped to 326.0.0.
 *
 * @version 326.0.0
 */

const V325 = require('./marketMaker325.js');

const MM_VERSION_326 = '326.0.0';

function _coercePositiveInt326(value, fallback326) {
  const n326 = Number(value);
  if (!Number.isFinite(n326) || !Number.isInteger(n326) || n326 < 1) return fallback326;
  return n326;
}

function _coercePositiveFloat326(value, fallback326) {
  const f326 = Number(value);
  if (!Number.isFinite(f326) || f326 <= 0) return fallback326;
  return f326;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) AuditCapTrail326
//    Extends AuditCapTrail325 with MAE alert streak rate.
// ─────────────────────────────────────────────────────────────────────────────

class AuditCapTrail326 extends V325.AuditCapTrail325 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * detectMAEAlertStreakRate326()
   *
   * Extends detectMAEAlertStreak325() with per-entry streak rate fields.
   * - currentStreakRate = currentStreak / totalEntries  (null when history is empty)
   * - longestStreakRate = longestStreak / totalEntries  (null when history is empty)
   *
   * Returns all streak fields from detectMAEAlertStreak325() plus
   * currentStreakRate and longestStreakRate.
   *
   * @returns {{ ok, longestStreak, currentStreak, streakStartAt, streakEndAt,
   *             currentStreakRate, longestStreakRate, version }}
   */
  detectMAEAlertStreakRate326() {
    const base326       = this.detectMAEAlertStreak325();
    const totalEntries326 = this._maeAlertHistory323.length;

    if (totalEntries326 === 0) {
      return Object.assign({}, base326, {
        currentStreakRate: null,
        longestStreakRate: null,
        version:          MM_VERSION_326,
      });
    }

    return Object.assign({}, base326, {
      currentStreakRate: base326.currentStreak / totalEntries326,
      longestStreakRate: base326.longestStreak / totalEntries326,
      version:          MM_VERSION_326,
    });
  }

  stats() {
    const base326 = super.stats();
    return Object.assign({}, base326, { version: MM_VERSION_326 });
  }
}

let _defaultAuditCapTrail326 = null;
function defaultAuditCapTrail326(opts) {
  if (!_defaultAuditCapTrail326 || opts) {
    _defaultAuditCapTrail326 = new AuditCapTrail326(opts || {});
  }
  return _defaultAuditCapTrail326;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) PageRangeDiffBridge326
//    Extends PageRangeDiffBridge325 with recovery trend tracking.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * _meanOf326(arr)
 * Compute arithmetic mean of a numeric array.
 * @param {number[]} arr
 * @returns {number|null}
 */
function _meanOf326(arr) {
  if (!arr || arr.length === 0) return null;
  return arr.reduce((s326, v326) => s326 + v326, 0) / arr.length;
}

class PageRangeDiffBridge326 extends V325.PageRangeDiffBridge325 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * trackRecoveryTrend326()
   *
   * Splits _recoveryHistory324 into two halves (older vs newer) and computes:
   * - firstHalfMeanMs:  mean quietDurationMs of the older half.
   * - secondHalfMeanMs: mean quietDurationMs of the newer half.
   * - improvementPct:   ((firstHalfMean - secondHalfMean) / firstHalfMean) * 100
   *                     Positive = system recovers faster over time.
   *                     null when either half is empty or firstHalfMean is 0.
   *
   * When the history ring is empty, all stats are null and ok:true.
   * When there is exactly 1 entry, it belongs to the second half only.
   *
   * @returns {{ ok, totalRecoveries, firstHalfMeanMs, secondHalfMeanMs, improvementPct, version }}
   */
  trackRecoveryTrend326() {
    const history326  = this._recoveryHistory324;
    const total326    = history326.length;

    if (total326 === 0) {
      return {
        ok:               true,
        totalRecoveries:  0,
        firstHalfMeanMs:  null,
        secondHalfMeanMs: null,
        improvementPct:   null,
        version:          MM_VERSION_326,
      };
    }

    const mid326     = Math.floor(total326 / 2);
    const first326   = history326.slice(0, mid326).map(e326 => e326.quietDurationMs);
    const second326  = history326.slice(mid326).map(e326 => e326.quietDurationMs);

    const firstMean326  = _meanOf326(first326);
    const secondMean326 = _meanOf326(second326);

    let improvementPct326 = null;
    if (
      firstMean326 !== null &&
      secondMean326 !== null &&
      firstMean326 !== 0
    ) {
      improvementPct326 = ((firstMean326 - secondMean326) / firstMean326) * 100;
    }

    return {
      ok:               true,
      totalRecoveries:  total326,
      firstHalfMeanMs:  firstMean326,
      secondHalfMeanMs: secondMean326,
      improvementPct:   improvementPct326,
      version:          MM_VERSION_326,
    };
  }

  stats() {
    const base326 = super.stats();
    return Object.assign({}, base326, { version: MM_VERSION_326 });
  }
}

let _defaultPageRangeDiffBridge326 = null;
function defaultPageRangeDiffBridge326(opts) {
  if (!_defaultPageRangeDiffBridge326 || opts) {
    _defaultPageRangeDiffBridge326 = new PageRangeDiffBridge326(opts || {});
  }
  return _defaultPageRangeDiffBridge326;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) RankedOverlapBuffer326
//    Extends RankedOverlapBuffer325 with normalised migration path entropy.
// ─────────────────────────────────────────────────────────────────────────────

class RankedOverlapBuffer326 extends V325.RankedOverlapBuffer325 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * computeNormalisedMigrationPathEntropy326(snapshotTokenSets, threshold)
   *
   * Calls computeMigrationPathEntropy325 to get the raw Shannon entropy, then
   * normalises it by log2(pathCount) to produce a value in [0, 1].
   *
   * normalisedEntropy = rawEntropy / log2(pathCount)
   * When pathCount < 2, normalisedEntropy is 0 (degenerate case).
   *
   * Returns all fields from computeMigrationPathEntropy325 plus normalisedEntropy.
   *
   * @param {string[][]} snapshotTokenSets — ordered array of token arrays (≥ 2 snapshots)
   * @param {number}     [threshold]       — Jaccard threshold (default 0.1)
   * @returns {{ ok, entropy, normalisedEntropy, pathCount, totalTokenPaths,
   *             pathFrequency, graph, version }}
   */
  computeNormalisedMigrationPathEntropy326(snapshotTokenSets, threshold) {
    const base326 = this.computeMigrationPathEntropy325(snapshotTokenSets, threshold);
    if (!base326.ok) {
      return Object.assign({}, base326, { version: MM_VERSION_326 });
    }

    const pathCount326 = base326.pathCount;
    let normalisedEntropy326 = 0;

    if (pathCount326 >= 2) {
      const maxEntropy326 = Math.log2(pathCount326);
      normalisedEntropy326 = maxEntropy326 > 0
        ? base326.entropy / maxEntropy326
        : 0;
    }

    return Object.assign({}, base326, {
      normalisedEntropy: normalisedEntropy326,
      version:           MM_VERSION_326,
    });
  }

  stats() {
    const base326 = typeof super.stats === 'function' ? super.stats() : {};
    return Object.assign({}, base326, { version: MM_VERSION_326 });
  }
}

let _defaultRankedOverlapBuffer326 = null;
function defaultRankedOverlapBuffer326(opts) {
  if (!_defaultRankedOverlapBuffer326 || opts) {
    _defaultRankedOverlapBuffer326 = new RankedOverlapBuffer326(opts || {});
  }
  return _defaultRankedOverlapBuffer326;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) NormDeltaPercentilesTracker326
//    Extends NormDeltaPercentilesTracker325 with sojourn percentile spread.
// ─────────────────────────────────────────────────────────────────────────────

class NormDeltaPercentilesTracker326 extends V325.NormDeltaPercentilesTracker325 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * computeSojournPercentileSpread326(regime)
   *
   * Calls computeSojournPercentiles325 with [25, 50, 75] for the given regime
   * and returns:
   * - iqr:         p75 - p25  (inter-quartile range).
   * - median:      p50.
   * - spreadRatio: iqr / median  (null when median is 0 or null).
   *
   * Propagates ok:false from computeSojournPercentiles325 on invalid regime.
   * When the regime has no samples, iqr/median/spreadRatio are all null.
   *
   * @param {string} regime — the regime key (e.g. 'stable', 'increasing', 'decreasing')
   * @returns {{ ok, regime, sampleCount, iqr, median, spreadRatio, version }}
   */
  computeSojournPercentileSpread326(regime) {
    const base326 = this.computeSojournPercentiles325(regime, [25, 50, 75]);
    if (!base326.ok) {
      return Object.assign({}, base326, { version: MM_VERSION_326 });
    }

    const p25326 = base326.percentiles['p25'];
    const p50326 = base326.percentiles['p50'];
    const p75326 = base326.percentiles['p75'];

    let iqr326         = null;
    let spreadRatio326 = null;

    if (p25326 !== null && p75326 !== null) {
      iqr326 = p75326 - p25326;
    }

    if (iqr326 !== null && p50326 !== null && p50326 !== 0) {
      spreadRatio326 = iqr326 / p50326;
    }

    return {
      ok:          true,
      regime:      regime,
      sampleCount: base326.sampleCount,
      iqr:         iqr326,
      median:      p50326,
      spreadRatio: spreadRatio326,
      version:     MM_VERSION_326,
    };
  }

  stats() {
    const base326 = super.stats();
    return Object.assign({}, base326, { version: MM_VERSION_326 });
  }
}

let _defaultNormDeltaPercentilesTracker326 = null;
function defaultNormDeltaPercentilesTracker326(opts) {
  if (!_defaultNormDeltaPercentilesTracker326 || opts) {
    _defaultNormDeltaPercentilesTracker326 = new NormDeltaPercentilesTracker326(opts || {});
  }
  return _defaultNormDeltaPercentilesTracker326;
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint registration helper
// ─────────────────────────────────────────────────────────────────────────────

function registerV326Endpoints(app) {
  const trail326   = defaultAuditCapTrail326();
  const bridge326  = defaultPageRangeDiffBridge326();
  const buffer326  = defaultRankedOverlapBuffer326();
  const tracker326 = defaultNormDeltaPercentilesTracker326();

  // 1. GET MAE alert streak rate
  app.get(
    '/api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v326/aggregate/db/hydrate/audit/cap/forecast/mae/alert/streak/rate',
    (req, res) => {
      try {
        res.json(trail326.detectMAEAlertStreakRate326());
      } catch (e326) {
        res.status(500).json({ ok: false, error: e326.message, version: MM_VERSION_326 });
      }
    }
  );

  // 2. GET burst recovery trend
  app.get(
    '/api/v1/market/alerts/suppress/config/v326/diff/audit/filter/paged/range/outliers/severity/burst/recovery/trend',
    (req, res) => {
      try {
        res.json(bridge326.trackRecoveryTrend326());
      } catch (e326) {
        res.status(500).json({ ok: false, error: e326.message, version: MM_VERSION_326 });
      }
    }
  );

  // 3. POST normalised migration path entropy
  app.post(
    '/api/v1/market/backtest/sessions/v326/snapshot/search/ranked/semantic/clusters/migration/paths/entropy/normalised',
    (req, res) => {
      try {
        const snapshotTokenSets326 = req.body ? req.body.snapshotTokenSets : undefined;
        const threshold326         = req.body ? req.body.threshold         : undefined;
        res.json(buffer326.computeNormalisedMigrationPathEntropy326(snapshotTokenSets326, threshold326));
      } catch (e326) {
        res.status(500).json({ ok: false, error: e326.message, version: MM_VERSION_326 });
      }
    }
  );

  // 4. GET sojourn percentile spread
  app.get(
    '/api/v1/contracts/receipts/v326/histogram/rolling/percentiles/trend/delta/cumulative/norm/volatility/regime/sojourn/spread',
    (req, res) => {
      try {
        const regime326 = req.query.regime || '';
        res.json(tracker326.computeSojournPercentileSpread326(regime326));
      } catch (e326) {
        res.status(500).json({ ok: false, error: e326.message, version: MM_VERSION_326 });
      }
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  MM_VERSION_326,
  _coercePositiveInt326,
  _coercePositiveFloat326,
  _meanOf326,
  AuditCapTrail326,
  defaultAuditCapTrail326,
  PageRangeDiffBridge326,
  defaultPageRangeDiffBridge326,
  RankedOverlapBuffer326,
  defaultRankedOverlapBuffer326,
  NormDeltaPercentilesTracker326,
  defaultNormDeltaPercentilesTracker326,
  registerV326Endpoints,
};
