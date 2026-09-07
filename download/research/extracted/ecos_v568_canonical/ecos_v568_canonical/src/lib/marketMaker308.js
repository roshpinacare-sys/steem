'use strict';
/**
 * lib/marketMaker308.js — ECOS V308 (Phase P196) — Prune History Aggregation,
 *                          Suppress Config Diff, Snapshot Search,
 *                          Rolling Histogram Percentiles
 *
 * Four additive components that extend the V307 observability layer:
 *
 *   1. AggregateHistory308         — extends PersistentPruneHistory307 with
 *                                    aggregateHistory308() that computes summary
 *                                    statistics over the history ring.
 *                                    GET /api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v308/aggregate
 *
 *   2. ConfigDiffBridge308         — extends VersionedAlertBridge307 with
 *                                    diffConfigVersions308(vA, vB) that compares
 *                                    overrides at two version numbers.
 *                                    POST /api/v1/market/alerts/suppress/config/v308/diff
 *
 *   3. SearchableSnapshotBuffer308 — extends DiffSnapshotBuffer307 with
 *                                    searchSnapshot308(token) that returns every
 *                                    history index where the token appears.
 *                                    GET /api/v1/market/backtest/sessions/v308/snapshot/search?token=
 *
 *   4. PercentilesHistogramTracker308 — extends RollingHistogramTracker307 with
 *                                    rollingPercentiles308(source, windowMs) that
 *                                    computes p50/p95/p99 from timed observations.
 *                                    GET /api/v1/contracts/receipts/v308/histogram/rolling/percentiles?source=&windowMs=
 *
 * Sacred files untouched (R1). All new identifiers end in `308` (R2).
 * Zero new npm deps (R3). V287..V307 surfaces preserved (R6).
 * lib/ mirrors src/lib/ (R5). package.json bumped to 308.0.0.
 *
 * @version 308.0.0
 */

const V307 = require('./marketMaker307.js');
const V306 = require('./marketMaker306.js');
const V305 = require('./marketMaker305.js');
const V304 = require('./marketMaker304.js');
const V303 = require('./marketMaker303.js');

const MM_VERSION_308 = '308.0.0';

// ─────────────────────────────────────────────────────────────────────────────
// 1) AggregateHistory308
//    Extends PersistentPruneHistory307 with aggregateHistory308() that computes
//    summary statistics over the history ring:
//      - totalRows: total pruned rows across all runs
//      - averageRowsPerRun: mean pruned per successful run
//      - successRate: fraction of ok===true runs
//      - errorRate: fraction of ok===false runs
//      - firstRanAt / lastRanAt: timestamps
// ─────────────────────────────────────────────────────────────────────────────

class AggregateHistory308 extends V307.PersistentPruneHistory307 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * aggregateHistory308() — compute summary statistics over the current
   * in-memory prune history ring.
   *
   * @returns {{ ok, totalRuns, successRuns, errorRuns, successRate, errorRate,
   *             totalRows, averageRowsPerRun, firstRanAt, lastRanAt, version }}
   */
  aggregateHistory308() {
    const history = this._pruneHistory306 || [];
    const totalRuns    = history.length;
    const successRuns  = history.filter(e => e.ok !== false).length;
    const errorRuns    = totalRuns - successRuns;
    const successRate  = totalRuns > 0 ? successRuns / totalRuns : 0;
    const errorRate    = totalRuns > 0 ? errorRuns   / totalRuns : 0;
    const totalRows    = history.reduce((acc, e) => acc + (e.pruned != null ? Number(e.pruned) : 0), 0);
    const averageRowsPerRun = successRuns > 0
      ? history.filter(e => e.ok !== false && e.pruned != null)
               .reduce((acc, e) => acc + Number(e.pruned), 0) / successRuns
      : 0;
    const timestamps = history.map(e => e.ranAt).filter(Boolean).sort();
    const firstRanAt = timestamps.length > 0 ? timestamps[0]  : null;
    const lastRanAt  = timestamps.length > 0 ? timestamps[timestamps.length - 1] : null;

    return {
      ok:              true,
      totalRuns,
      successRuns,
      errorRuns,
      successRate,
      errorRate,
      totalRows,
      averageRowsPerRun,
      firstRanAt,
      lastRanAt,
      version:         MM_VERSION_308,
    };
  }

  stats() {
    const base = super.stats();
    return Object.assign({}, base, { version: MM_VERSION_308 });
  }
}

let _defaultAggregateHistory308 = null;
function defaultAggregateHistory308(opts) {
  if (!_defaultAggregateHistory308 || opts) {
    _defaultAggregateHistory308 = new AggregateHistory308(opts || {});
  }
  return _defaultAggregateHistory308;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) ConfigDiffBridge308
//    Extends VersionedAlertBridge307 with diffConfigVersions308(vA, vB) that
//    compares the overrides stored at two version-history entries and returns
//    added/removed/changed adapter keys.
// ─────────────────────────────────────────────────────────────────────────────

class ConfigDiffBridge308 extends V307.VersionedAlertBridge307 {
  constructor(opts = {}) {
    super(opts);
    // Per-version override snapshot ring: { configVersion, overrides }
    this._overrideSnapshots308 = [];
    this._overrideSnapshotsCap308 = opts.versionHistoryCap !== undefined
      ? opts.versionHistoryCap
      : 50;
  }

  /**
   * Override persistConfig307 to also snapshot overrides at each version.
   */
  async persistConfig307(pool, updatedBy) {
    const result = await super.persistConfig307(pool, updatedBy);
    // Snapshot the current overrides alongside the configVersion
    const overridesSnap = Object.assign({}, this._overrides306 || {});
    this._overrideSnapshots308.push({
      configVersion: this._configVersion307,
      overrides:     overridesSnap,
    });
    if (this._overrideSnapshots308.length > this._overrideSnapshotsCap308) {
      this._overrideSnapshots308.shift();
    }
    return result;
  }

  /**
   * diffConfigVersions308(vA, vB) — compare override keys at two version numbers.
   *
   * @param {number} vA  — first config version number
   * @param {number} vB  — second config version number
   * @returns {{ ok, vA, vB, added, removed, changed, version }}
   */
  diffConfigVersions308(vA, vB) {
    const ring = this._overrideSnapshots308 || [];

    const entryA = ring.find(e => e.configVersion === vA);
    const entryB = ring.find(e => e.configVersion === vB);

    if (!entryA) {
      return { ok: false, reason: `version ${vA} not found in history`, version: MM_VERSION_308 };
    }
    if (!entryB) {
      return { ok: false, reason: `version ${vB} not found in history`, version: MM_VERSION_308 };
    }

    const overridesA = entryA.overrides || {};
    const overridesB = entryB.overrides || {};

    const keysA = new Set(Object.keys(overridesA));
    const keysB = new Set(Object.keys(overridesB));

    const added   = [...keysB].filter(k => !keysA.has(k));
    const removed = [...keysA].filter(k => !keysB.has(k));
    const changed = [...keysA].filter(k => keysB.has(k) && overridesA[k] !== overridesB[k]);

    return {
      ok:      true,
      vA,
      vB,
      added,
      removed,
      changed,
      version: MM_VERSION_308,
    };
  }

  stats() {
    const base = super.stats();
    return Object.assign({}, base, { version: MM_VERSION_308 });
  }
}

let _defaultConfigDiffBridge308 = null;
function defaultConfigDiffBridge308(opts) {
  if (!_defaultConfigDiffBridge308 || opts) {
    _defaultConfigDiffBridge308 = new ConfigDiffBridge308(opts || {});
  }
  return _defaultConfigDiffBridge308;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) SearchableSnapshotBuffer308
//    Extends DiffSnapshotBuffer307 with searchSnapshot308(token) that scans all
//    history entries and returns every index where the given session token
//    appears, along with its eventCount at each snapshot.
// ─────────────────────────────────────────────────────────────────────────────

class SearchableSnapshotBuffer308 extends V307.DiffSnapshotBuffer307 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * searchSnapshot308(token) — scan all history entries and return every index
   * where the given session token appears, with its eventCount.
   *
   * @param {string} token
   * @returns {{ ok, token, results: Array<{ index, savedAt, eventCount }>, version }}
   */
  searchSnapshot308(token) {
    if (typeof token !== 'string' || token.length === 0) {
      return { ok: false, reason: 'token must be a non-empty string', version: MM_VERSION_308 };
    }

    const history = this._snapshotHistory306 || [];
    const results = [];

    history.forEach((snap, idx) => {
      const sessions = Array.isArray(snap.sessions) ? snap.sessions : [];
      const match = sessions.find(s => s.token === token);
      if (match) {
        results.push({
          index:      idx,
          savedAt:    snap.savedAt || null,
          eventCount: match.eventCount != null ? match.eventCount : 0,
        });
      }
    });

    return {
      ok:      true,
      token,
      results,
      version: MM_VERSION_308,
    };
  }

  stats() {
    const base = typeof super.stats === 'function' ? super.stats() : {};
    return Object.assign({}, base, { version: MM_VERSION_308 });
  }
}

let _defaultSearchableSnapshotBuffer308 = null;
function defaultSearchableSnapshotBuffer308(opts) {
  if (!_defaultSearchableSnapshotBuffer308 || opts) {
    _defaultSearchableSnapshotBuffer308 = new SearchableSnapshotBuffer308(opts || {});
  }
  return _defaultSearchableSnapshotBuffer308;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) PercentilesHistogramTracker308
//    Extends RollingHistogramTracker307 with rollingPercentiles308(source, windowMs)
//    that computes p50 / p95 / p99 from the timed observations within the window.
// ─────────────────────────────────────────────────────────────────────────────

class PercentilesHistogramTracker308 extends V307.RollingHistogramTracker307 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * _percentile308(sortedValues, p) — compute the p-th percentile from a sorted
   * numeric array using the nearest-rank method.
   * @private
   */
  _percentile308(sortedValues, p) {
    if (sortedValues.length === 0) return null;
    const idx = Math.ceil((p / 100) * sortedValues.length) - 1;
    return sortedValues[Math.max(0, Math.min(idx, sortedValues.length - 1))];
  }

  /**
   * rollingPercentiles308(source, windowMs) — compute p50/p95/p99 from the
   * timestamped latency observations within the rolling window.
   *
   * @param {string} source
   * @param {number} windowMs
   * @returns {{ ok, source, windowMs, p50, p95, p99, count, version }}
   */
  rollingPercentiles308(source, windowMs) {
    const src    = source != null ? String(source) : 'default';
    const wMs    = typeof windowMs === 'number' && windowMs > 0 ? windowMs : 60000;
    const cutoff = Date.now() - wMs;
    const obs    = (this._timedObs307[src] || []).filter(o => o.ts >= cutoff);

    const sorted = obs.map(o => o.latencyMs).sort((a, b) => a - b);

    return {
      ok:       true,
      source:   src,
      windowMs: wMs,
      cutoff:   new Date(cutoff).toISOString(),
      count:    sorted.length,
      p50:      this._percentile308(sorted, 50),
      p95:      this._percentile308(sorted, 95),
      p99:      this._percentile308(sorted, 99),
      version:  MM_VERSION_308,
    };
  }

  /**
   * allRollingPercentiles308(windowMs) — percentiles for every tracked source.
   */
  allRollingPercentiles308(windowMs) {
    const sources = {};
    for (const src of Object.keys(this._timedObs307)) {
      sources[src] = this.rollingPercentiles308(src, windowMs);
    }
    return { ok: true, windowMs: windowMs || 60000, sources, version: MM_VERSION_308 };
  }

  stats() {
    const base = super.stats();
    return Object.assign({}, base, { version: MM_VERSION_308 });
  }
}

let _defaultPercentilesHistogramTracker308 = null;
function defaultPercentilesHistogramTracker308(opts) {
  if (!_defaultPercentilesHistogramTracker308 || opts) {
    _defaultPercentilesHistogramTracker308 = new PercentilesHistogramTracker308(opts || {});
  }
  return _defaultPercentilesHistogramTracker308;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  MM_VERSION_308,
  // 1. Aggregate prune history
  AggregateHistory308,
  defaultAggregateHistory308,
  // 2. Config diff bridge
  ConfigDiffBridge308,
  defaultConfigDiffBridge308,
  // 3. Searchable snapshot buffer
  SearchableSnapshotBuffer308,
  defaultSearchableSnapshotBuffer308,
  // 4. Percentiles histogram tracker
  PercentilesHistogramTracker308,
  defaultPercentilesHistogramTracker308,
};
