'use strict';
/**
 * lib/marketMaker310.js — ECOS V310 (Phase P198) — Aggregate Load-Back,
 *                          Diff Audit Filtering, Multi-Token Ranked Search,
 *                          Trend Summary
 *
 * Four additive components that extend the V309 observability layer:
 *
 *   1. AggregateLoader310           — extends PersistedAggregateHistory309 with
 *                                     loadAggregate310(pool) that reads the singleton
 *                                     row back from `ecos_prune_aggregate` and returns
 *                                     it as a plain object.
 *                                     GET /api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v310/aggregate/db/load
 *
 *   2. FilteredDiffBridge310        — extends AutoDiffBridge309 with
 *                                     filterDiffAudit310(fromVersion, toVersion) that
 *                                     filters the audit ring to only entries whose
 *                                     fromVersion/toVersion fall within the given range.
 *                                     GET /api/v1/market/alerts/suppress/config/v310/diff/audit/filter?from=&to=
 *
 *   3. MultiRankedSnapshotBuffer310 — extends RankedSnapshotBuffer309 with
 *                                     multiRankedSearch310(tokens[]) that accepts an
 *                                     array of tokens and returns a merged, globally-
 *                                     ranked list of all occurrences.
 *                                     POST /api/v1/market/backtest/sessions/v310/snapshot/search/ranked/multi
 *                                     (body { tokens: [...] })
 *
 *   4. SummaryPercentilesTracker310 — extends TrendPercentilesTracker309 with
 *                                     trendSummary310(source, windowMs, buckets) that
 *                                     computes the per-bucket trend and also returns
 *                                     global p50/p95/p99 across all buckets plus
 *                                     peak-bucket indices (the bucket with highest p99).
 *                                     GET /api/v1/contracts/receipts/v310/histogram/rolling/percentiles/trend/summary?source=&windowMs=&buckets=
 *
 * Sacred files untouched (R1). All new identifiers end in `310` (R2).
 * Zero new npm deps (R3). V287..V309 surfaces preserved (R6).
 * lib/ mirrors src/lib/ (R5). package.json bumped to 310.0.0.
 *
 * @version 310.0.0
 */

const V309 = require('./marketMaker309.js');
const V308 = require('./marketMaker308.js');
const V307 = require('./marketMaker307.js');
const V306 = require('./marketMaker306.js');
const V305 = require('./marketMaker305.js');

const MM_VERSION_310 = '310.0.0';

// ─────────────────────────────────────────────────────────────────────────────
// 1) AggregateLoader310
//    Extends PersistedAggregateHistory309 with loadAggregate310(pool) that reads
//    the singleton row back from `ecos_prune_aggregate` DB table and returns it
//    as a plain object. Non-fatal if DB unavailable.
// ─────────────────────────────────────────────────────────────────────────────

class AggregateLoader310 extends V309.PersistedAggregateHistory309 {
  constructor(opts = {}) {
    super(opts);
    this._aggregateLoadStats310 = { loadCalls: 0, errors: 0 };
  }

  /**
   * loadAggregate310(pool) — reads the singleton row from `ecos_prune_aggregate`
   * and returns it as a plain object. Returns ok:false (non-fatal) when DB is
   * unavailable or the row has not been persisted yet.
   *
   * @param {object} pool — pg Pool (or compatible)
   * @returns {Promise<{ ok, aggregate, version }>}
   */
  async loadAggregate310(pool) {
    this._aggregateLoadStats310.loadCalls++;

    if (!pool) {
      this._aggregateLoadStats310.errors++;
      return { ok: false, reason: 'no pool provided', version: MM_VERSION_310 };
    }

    try {
      const result = await pool.query(
        `SELECT total_runs, success_runs, error_runs, success_rate, error_rate,
                total_rows, avg_rows_per_run, first_ran_at, last_ran_at,
                version, updated_at
           FROM ecos_prune_aggregate
          WHERE row_key = $1
          LIMIT 1`,
        ['singleton']
      );

      if (!result || !result.rows || result.rows.length === 0) {
        return { ok: false, reason: 'no aggregate row found', version: MM_VERSION_310 };
      }

      const row = result.rows[0];
      const aggregate = {
        totalRuns:         row.total_runs,
        successRuns:       row.success_runs,
        errorRuns:         row.error_runs,
        successRate:       row.success_rate,
        errorRate:         row.error_rate,
        totalRows:         row.total_rows,
        averageRowsPerRun: row.avg_rows_per_run,
        firstRanAt:        row.first_ran_at,
        lastRanAt:         row.last_ran_at,
        persistedVersion:  row.version,
        updatedAt:         row.updated_at,
      };

      return { ok: true, aggregate, version: MM_VERSION_310 };
    } catch (err) {
      this._aggregateLoadStats310.errors++;
      return { ok: false, reason: err.message, version: MM_VERSION_310 };
    }
  }

  /**
   * aggregateLoadStats310() — expose internal load counters.
   */
  aggregateLoadStats310() {
    return Object.assign({}, this._aggregateLoadStats310, { version: MM_VERSION_310 });
  }

  stats() {
    const base = super.stats();
    return Object.assign({}, base, { version: MM_VERSION_310 });
  }
}

let _defaultAggregateLoader310 = null;
function defaultAggregateLoader310(opts) {
  if (!_defaultAggregateLoader310 || opts) {
    _defaultAggregateLoader310 = new AggregateLoader310(opts || {});
  }
  return _defaultAggregateLoader310;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) FilteredDiffBridge310
//    Extends AutoDiffBridge309 with filterDiffAudit310(fromVersion, toVersion)
//    that filters the audit ring to only entries whose fromVersion/toVersion fall
//    within the given inclusive range.
// ─────────────────────────────────────────────────────────────────────────────

class FilteredDiffBridge310 extends V309.AutoDiffBridge309 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * filterDiffAudit310(fromVersion, toVersion) — return all diff audit entries
   * where entry.fromVersion >= fromVersion AND entry.toVersion <= toVersion.
   * Both bounds are inclusive. Accepts numeric version numbers.
   *
   * @param {number} fromVersion — lower bound (inclusive) on entry.fromVersion
   * @param {number} toVersion   — upper bound (inclusive) on entry.toVersion
   * @returns {{ ok, fromVersion, toVersion, entries, count, version }}
   */
  filterDiffAudit310(fromVersion, toVersion) {
    const from = typeof fromVersion === 'number' ? fromVersion : Number(fromVersion);
    const to   = typeof toVersion   === 'number' ? toVersion   : Number(toVersion);

    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      return {
        ok:      false,
        reason:  'fromVersion and toVersion must be finite numbers',
        version: MM_VERSION_310,
      };
    }

    const allEntries = this._diffAudit309.slice();
    const filtered   = allEntries.filter(
      e => e.fromVersion >= from && e.toVersion <= to
    );

    return {
      ok:          true,
      fromVersion: from,
      toVersion:   to,
      entries:     filtered,
      count:       filtered.length,
      version:     MM_VERSION_310,
    };
  }

  stats() {
    const base = super.stats();
    return Object.assign({}, base, { version: MM_VERSION_310 });
  }
}

let _defaultFilteredDiffBridge310 = null;
function defaultFilteredDiffBridge310(opts) {
  if (!_defaultFilteredDiffBridge310 || opts) {
    _defaultFilteredDiffBridge310 = new FilteredDiffBridge310(opts || {});
  }
  return _defaultFilteredDiffBridge310;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) MultiRankedSnapshotBuffer310
//    Extends RankedSnapshotBuffer309 with multiRankedSearch310(tokens[]) that
//    accepts an array of tokens and returns a merged, globally-ranked list of
//    all occurrences across all tokens, sorted by eventCount descending.
// ─────────────────────────────────────────────────────────────────────────────

class MultiRankedSnapshotBuffer310 extends V309.RankedSnapshotBuffer309 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * multiRankedSearch310(tokens) — accepts an array of token strings, runs
   * rankedSearch309 for each, deduplicates by snapshot index (keeping the entry
   * with the highest eventCount if a snapshot appears for multiple tokens), and
   * returns the merged list sorted by eventCount descending.
   *
   * @param {string[]} tokens
   * @returns {{ ok, tokens, results: Array<{ index, savedAt, eventCount, matchedTokens }>, version }}
   */
  multiRankedSearch310(tokens) {
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return {
        ok:      false,
        reason:  'tokens must be a non-empty array',
        version: MM_VERSION_310,
      };
    }

    // Clamp to reasonable maximum (e.g. 50 tokens) to avoid abuse
    const safeTokens = tokens.slice(0, 50);

    // Map from snapshot index → merged entry
    const merged = new Map();

    for (const token of safeTokens) {
      const r = this.rankedSearch309(String(token));
      if (!r.ok) continue;

      for (const hit of r.results) {
        if (merged.has(hit.index)) {
          const existing = merged.get(hit.index);
          // Keep max eventCount; union matchedTokens
          existing.eventCount = Math.max(existing.eventCount, hit.eventCount);
          if (!existing.matchedTokens.includes(String(token))) {
            existing.matchedTokens.push(String(token));
          }
        } else {
          merged.set(hit.index, {
            index:         hit.index,
            savedAt:       hit.savedAt,
            eventCount:    hit.eventCount,
            matchedTokens: [String(token)],
          });
        }
      }
    }

    const results = Array.from(merged.values()).sort((a, b) => b.eventCount - a.eventCount);

    return {
      ok:      true,
      tokens:  safeTokens,
      results,
      version: MM_VERSION_310,
    };
  }

  stats() {
    const base = typeof super.stats === 'function' ? super.stats() : {};
    return Object.assign({}, base, { version: MM_VERSION_310 });
  }
}

let _defaultMultiRankedSnapshotBuffer310 = null;
function defaultMultiRankedSnapshotBuffer310(opts) {
  if (!_defaultMultiRankedSnapshotBuffer310 || opts) {
    _defaultMultiRankedSnapshotBuffer310 = new MultiRankedSnapshotBuffer310(opts || {});
  }
  return _defaultMultiRankedSnapshotBuffer310;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) SummaryPercentilesTracker310
//    Extends TrendPercentilesTracker309 with trendSummary310(source, windowMs,
//    buckets) that runs percentileTrend309 and augments the result with:
//    - globalP50/globalP95/globalP99 across all bucket observations combined
//    - peakBucketIndex: the bucket index with the highest p99 (null if all empty)
// ─────────────────────────────────────────────────────────────────────────────

class SummaryPercentilesTracker310 extends V309.TrendPercentilesTracker309 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * trendSummary310(source, windowMs, buckets) — compute the per-bucket trend
   * (via percentileTrend309) and also return global p50/p95/p99 across all
   * buckets combined plus the peakBucketIndex (the bucket with the highest p99).
   *
   * @param {string} source
   * @param {number} windowMs
   * @param {number} buckets
   * @returns {{ ok, source, windowMs, buckets, trend, globalP50, globalP95, globalP99, peakBucketIndex, version }}
   */
  trendSummary310(source, windowMs, buckets) {
    const base = this.percentileTrend309(source, windowMs, buckets);
    if (!base.ok) {
      return Object.assign({}, base, { version: MM_VERSION_310 });
    }

    // Collect all raw observations that fall within the window for global percentiles
    const src    = source != null ? String(source) : 'default';
    const wMs    = typeof windowMs === 'number' && windowMs > 0 ? windowMs : 60000;
    const now    = Date.now();
    const cutoff = now - wMs;

    const allObs    = (this._timedObs307[src] || []).filter(o => o.ts >= cutoff);
    const allSorted = allObs.map(o => o.latencyMs).sort((a, b) => a - b);

    const globalP50 = this._percentile308(allSorted, 50);
    const globalP95 = this._percentile308(allSorted, 95);
    const globalP99 = this._percentile308(allSorted, 99);

    // Find the bucket with the highest p99 (null if all buckets are empty / p99 is null)
    let peakBucketIndex = null;
    let peakP99         = null;
    for (const bucket of base.trend) {
      if (bucket.p99 !== null && bucket.p99 !== undefined) {
        if (peakP99 === null || bucket.p99 > peakP99) {
          peakP99         = bucket.p99;
          peakBucketIndex = bucket.bucketIndex;
        }
      }
    }

    return {
      ok:               true,
      source:           base.source,
      windowMs:         base.windowMs,
      buckets:          base.buckets,
      trend:            base.trend,
      globalP50,
      globalP95,
      globalP99,
      peakBucketIndex,
      version:          MM_VERSION_310,
    };
  }

  stats() {
    const base = super.stats();
    return Object.assign({}, base, { version: MM_VERSION_310 });
  }
}

let _defaultSummaryPercentilesTracker310 = null;
function defaultSummaryPercentilesTracker310(opts) {
  if (!_defaultSummaryPercentilesTracker310 || opts) {
    _defaultSummaryPercentilesTracker310 = new SummaryPercentilesTracker310(opts || {});
  }
  return _defaultSummaryPercentilesTracker310;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  MM_VERSION_310,
  // 1. Aggregate load-back
  AggregateLoader310,
  defaultAggregateLoader310,
  // 2. Filtered diff audit bridge
  FilteredDiffBridge310,
  defaultFilteredDiffBridge310,
  // 3. Multi-token ranked snapshot search
  MultiRankedSnapshotBuffer310,
  defaultMultiRankedSnapshotBuffer310,
  // 4. Trend summary with globals + peak bucket
  SummaryPercentilesTracker310,
  defaultSummaryPercentilesTracker310,
};
