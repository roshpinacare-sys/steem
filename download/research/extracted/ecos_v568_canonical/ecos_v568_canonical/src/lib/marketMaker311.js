'use strict';
/**
 * lib/marketMaker311.js — ECOS V311 (Phase P199) — Load-Back Hydration,
 *                          Diff Audit Pagination, Multi-Token Search Statistics,
 *                          Trend Delta
 *
 * Four additive components that extend the V310 observability layer:
 *
 *   1. HydratingAggregateLoader311  — extends AggregateLoader310 with
 *                                     hydrateFromDb311(pool) that calls
 *                                     loadAggregate310 and, on success, replaces
 *                                     the in-memory ring state.
 *                                     POST /api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v311/aggregate/db/hydrate
 *
 *   2. PagedDiffBridge311           — extends FilteredDiffBridge310 with
 *                                     pagedDiffAudit311(fromVersion, toVersion, page, pageSize)
 *                                     returning { page, pageSize, totalCount, entries }.
 *                                     GET /api/v1/market/alerts/suppress/config/v311/diff/audit/filter/paged?from=&to=&page=&pageSize=
 *
 *   3. StatsMultiRankedBuffer311    — extends MultiRankedSnapshotBuffer310 with
 *                                     multiSearchStats311(tokens[]) that returns
 *                                     { tokenCount, uniqueSnapshots, totalHits, hitsByToken }.
 *                                     POST /api/v1/market/backtest/sessions/v311/snapshot/search/ranked/multi/stats
 *
 *   4. DeltaPercentilesTracker311   — extends SummaryPercentilesTracker310 with
 *                                     trendDelta311(source, windowMs, buckets) that
 *                                     returns a deltas array: [{ fromBucket, toBucket, p99Delta }].
 *                                     GET /api/v1/contracts/receipts/v311/histogram/rolling/percentiles/trend/delta?source=&windowMs=&buckets=
 *
 * Sacred files untouched (R1). All new identifiers end in `311` (R2).
 * Zero new npm deps (R3). V287..V310 surfaces preserved (R6).
 * lib/ mirrors src/lib/ (R5). package.json bumped to 311.0.0.
 *
 * @version 311.0.0
 */

const V310 = require('./marketMaker310.js');
const V309 = require('./marketMaker309.js');
const V308 = require('./marketMaker308.js');
const V307 = require('./marketMaker307.js');
const V306 = require('./marketMaker306.js');
const V305 = require('./marketMaker305.js');

const MM_VERSION_311 = '311.0.0';

// ─────────────────────────────────────────────────────────────────────────────
// 1) HydratingAggregateLoader311
//    Extends AggregateLoader310 with hydrateFromDb311(pool) that calls
//    loadAggregate310(pool) and, on success, replaces the in-memory ring state
//    so subsequent aggregateHistory308() reflects the loaded values.
// ─────────────────────────────────────────────────────────────────────────────

class HydratingAggregateLoader311 extends V310.AggregateLoader310 {
  constructor(opts = {}) {
    super(opts);
    this._hydrateStats311 = { hydrateCalls: 0, hydrateErrors: 0, hydrateSuccesses: 0 };
  }

  /**
   * hydrateFromDb311(pool) — calls loadAggregate310(pool) and, on success,
   * replaces the in-memory aggregate ring state so that subsequent calls to
   * aggregateHistory308() reflect the loaded values from the DB.
   *
   * @param {object} pool — pg Pool (or compatible)
   * @returns {Promise<{ ok, hydrated, aggregate, version }>}
   */
  async hydrateFromDb311(pool) {
    this._hydrateStats311.hydrateCalls++;

    const loaded = await this.loadAggregate310(pool);

    if (!loaded.ok) {
      this._hydrateStats311.hydrateErrors++;
      return {
        ok:      false,
        reason:  loaded.reason,
        version: MM_VERSION_311,
      };
    }

    try {
      const agg = loaded.aggregate;

      // Build a synthetic aggregate snapshot from the DB-loaded values
      const synthetic = {
        totalRuns:         agg.totalRuns,
        successRuns:       agg.successRuns,
        errorRuns:         agg.errorRuns,
        successRate:       agg.successRate,
        errorRate:         agg.errorRate,
        totalRows:         agg.totalRows,
        averageRowsPerRun: agg.averageRowsPerRun,
        firstRanAt:        agg.firstRanAt,
        lastRanAt:         agg.lastRanAt,
        hydratedAt:        new Date().toISOString(),
        hydratedVersion:   MM_VERSION_311,
      };

      // Replace the in-memory ring state (_aggregateRing308 from AggregateHistory308)
      if (!Array.isArray(this._aggregateRing308)) {
        this._aggregateRing308 = [];
      }
      this._aggregateRing308 = [synthetic];

      // Update the running counters if they exist (non-fatal if absent)
      if (typeof agg.totalRuns === 'number') {
        this._pruneRuns308    = agg.totalRuns;
        this._pruneSuccess308 = agg.successRuns;
        this._pruneErrors308  = agg.errorRuns;
      }

      this._hydrateStats311.hydrateSuccesses++;

      return {
        ok:        true,
        hydrated:  true,
        aggregate: synthetic,
        version:   MM_VERSION_311,
      };
    } catch (err) {
      this._hydrateStats311.hydrateErrors++;
      return {
        ok:      false,
        reason:  err.message,
        version: MM_VERSION_311,
      };
    }
  }

  /** hydrateStats311() — expose internal hydration counters. */
  hydrateStats311() {
    return Object.assign({}, this._hydrateStats311, { version: MM_VERSION_311 });
  }

  stats() {
    const base = super.stats();
    return Object.assign({}, base, { version: MM_VERSION_311 });
  }
}

let _defaultHydratingAggregateLoader311 = null;
function defaultHydratingAggregateLoader311(opts) {
  if (!_defaultHydratingAggregateLoader311 || opts) {
    _defaultHydratingAggregateLoader311 = new HydratingAggregateLoader311(opts || {});
  }
  return _defaultHydratingAggregateLoader311;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) PagedDiffBridge311
//    Extends FilteredDiffBridge310 with pagedDiffAudit311(fromVersion, toVersion,
//    page, pageSize) that returns a paginated slice with { page, pageSize,
//    totalCount, entries }.
// ─────────────────────────────────────────────────────────────────────────────

class PagedDiffBridge311 extends V310.FilteredDiffBridge310 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * pagedDiffAudit311(fromVersion, toVersion, page, pageSize) — filters the
   * diff audit ring using filterDiffAudit310 and returns a paginated slice.
   *
   * @param {number} fromVersion — lower bound (inclusive) on entry.fromVersion
   * @param {number} toVersion   — upper bound (inclusive) on entry.toVersion
   * @param {number} page        — 1-based page number (default 1)
   * @param {number} pageSize    — entries per page (default 20, max 200)
   * @returns {{ ok, fromVersion, toVersion, page, pageSize, totalCount, entries, version }}
   */
  pagedDiffAudit311(fromVersion, toVersion, page, pageSize) {
    const filtered = this.filterDiffAudit310(fromVersion, toVersion);
    if (!filtered.ok) {
      return Object.assign({}, filtered, { version: MM_VERSION_311 });
    }

    const p    = (typeof page     === 'number' && Number.isFinite(page)     && page >= 1)
                   ? Math.floor(page) : 1;
    const size = (typeof pageSize === 'number' && Number.isFinite(pageSize) && pageSize >= 1)
                   ? Math.min(Math.floor(pageSize), 200) : 20;

    const totalCount = filtered.entries.length;
    const start      = (p - 1) * size;
    const entries    = filtered.entries.slice(start, start + size);

    return {
      ok:          true,
      fromVersion: filtered.fromVersion,
      toVersion:   filtered.toVersion,
      page:        p,
      pageSize:    size,
      totalCount,
      entries,
      version:     MM_VERSION_311,
    };
  }

  stats() {
    const base = super.stats();
    return Object.assign({}, base, { version: MM_VERSION_311 });
  }
}

let _defaultPagedDiffBridge311 = null;
function defaultPagedDiffBridge311(opts) {
  if (!_defaultPagedDiffBridge311 || opts) {
    _defaultPagedDiffBridge311 = new PagedDiffBridge311(opts || {});
  }
  return _defaultPagedDiffBridge311;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) StatsMultiRankedBuffer311
//    Extends MultiRankedSnapshotBuffer310 with multiSearchStats311(tokens[])
//    that runs the multi-search and returns additional metadata:
//    { tokenCount, uniqueSnapshots, totalHits, hitsByToken }
// ─────────────────────────────────────────────────────────────────────────────

class StatsMultiRankedBuffer311 extends V310.MultiRankedSnapshotBuffer310 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * multiSearchStats311(tokens) — runs multiRankedSearch310 and returns
   * additional search metadata alongside the results.
   *
   * @param {string[]} tokens
   * @returns {{ ok, tokens, results, tokenCount, uniqueSnapshots, totalHits,
   *             hitsByToken, version }}
   */
  multiSearchStats311(tokens) {
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return {
        ok:      false,
        reason:  'tokens must be a non-empty array',
        version: MM_VERSION_311,
      };
    }

    const safeTokens = tokens.slice(0, 50);

    // Collect per-token raw hit counts (before dedup)
    const hitsByToken = {};
    let totalHits = 0;

    for (const token of safeTokens) {
      const r = this.rankedSearch309(String(token));
      const count = r.ok ? r.results.length : 0;
      hitsByToken[String(token)] = count;
      totalHits += count;
    }

    // Run the merged dedup search
    const merged = this.multiRankedSearch310(safeTokens);
    if (!merged.ok) {
      return Object.assign({}, merged, { version: MM_VERSION_311 });
    }

    return {
      ok:              true,
      tokens:          merged.tokens,
      results:         merged.results,
      tokenCount:      safeTokens.length,
      uniqueSnapshots: merged.results.length,
      totalHits,
      hitsByToken,
      version:         MM_VERSION_311,
    };
  }

  stats() {
    const base = typeof super.stats === 'function' ? super.stats() : {};
    return Object.assign({}, base, { version: MM_VERSION_311 });
  }
}

let _defaultStatsMultiRankedBuffer311 = null;
function defaultStatsMultiRankedBuffer311(opts) {
  if (!_defaultStatsMultiRankedBuffer311 || opts) {
    _defaultStatsMultiRankedBuffer311 = new StatsMultiRankedBuffer311(opts || {});
  }
  return _defaultStatsMultiRankedBuffer311;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) DeltaPercentilesTracker311
//    Extends SummaryPercentilesTracker310 with trendDelta311(source, windowMs,
//    buckets) that returns a deltas array: [{ fromBucket, toBucket, p99Delta }]
//    showing the change in p99 between consecutive buckets.
// ─────────────────────────────────────────────────────────────────────────────

class DeltaPercentilesTracker311 extends V310.SummaryPercentilesTracker310 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * trendDelta311(source, windowMs, buckets) — computes the per-bucket trend
   * via trendSummary310 and additionally returns a `deltas` array showing the
   * change in p99 between each pair of consecutive buckets.
   *
   * Each delta entry: { fromBucket, toBucket, p99Delta }
   * p99Delta is null if either adjacent bucket has a null p99.
   *
   * @param {string} source
   * @param {number} windowMs
   * @param {number} buckets
   * @returns {{ ok, source, windowMs, buckets, trend, globalP50, globalP95, globalP99,
   *             peakBucketIndex, deltas, version }}
   */
  trendDelta311(source, windowMs, buckets) {
    const base = this.trendSummary310(source, windowMs, buckets);
    if (!base.ok) {
      return Object.assign({}, base, { version: MM_VERSION_311 });
    }

    const trend  = base.trend;
    const deltas = [];

    for (let i = 0; i < trend.length - 1; i++) {
      const fromBucket = trend[i].bucketIndex;
      const toBucket   = trend[i + 1].bucketIndex;
      const fromP99    = trend[i].p99;
      const toP99      = trend[i + 1].p99;

      const p99Delta =
        (fromP99 !== null && fromP99 !== undefined &&
         toP99   !== null && toP99   !== undefined)
          ? toP99 - fromP99
          : null;

      deltas.push({ fromBucket, toBucket, p99Delta });
    }

    return {
      ok:              true,
      source:          base.source,
      windowMs:        base.windowMs,
      buckets:         base.buckets,
      trend:           base.trend,
      globalP50:       base.globalP50,
      globalP95:       base.globalP95,
      globalP99:       base.globalP99,
      peakBucketIndex: base.peakBucketIndex,
      deltas,
      version:         MM_VERSION_311,
    };
  }

  stats() {
    const base = super.stats();
    return Object.assign({}, base, { version: MM_VERSION_311 });
  }
}

let _defaultDeltaPercentilesTracker311 = null;
function defaultDeltaPercentilesTracker311(opts) {
  if (!_defaultDeltaPercentilesTracker311 || opts) {
    _defaultDeltaPercentilesTracker311 = new DeltaPercentilesTracker311(opts || {});
  }
  return _defaultDeltaPercentilesTracker311;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  MM_VERSION_311,
  // 1. Load-back hydration
  HydratingAggregateLoader311,
  defaultHydratingAggregateLoader311,
  // 2. Paged diff audit
  PagedDiffBridge311,
  defaultPagedDiffBridge311,
  // 3. Multi-token search statistics
  StatsMultiRankedBuffer311,
  defaultStatsMultiRankedBuffer311,
  // 4. Trend delta (p99 change between consecutive buckets)
  DeltaPercentilesTracker311,
  defaultDeltaPercentilesTracker311,
};
