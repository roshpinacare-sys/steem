'use strict';
/**
 * lib/marketMaker309.js — ECOS V309 (Phase P197) — Aggregate Persistence,
 *                          Config Diff Audit Trail, Snapshot Search Ranking,
 *                          Percentile Trend
 *
 * Four additive components that extend the V308 observability layer:
 *
 *   1. PersistedAggregateHistory309   — extends AggregateHistory308 with
 *                                       persistAggregate309(pool) that writes the
 *                                       current aggregate snapshot to DB (upsert).
 *                                       GET /api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v309/aggregate/db
 *
 *   2. AutoDiffBridge309              — extends ConfigDiffBridge308 with
 *                                       autoDiff309 flag: on each persistConfig307
 *                                       auto-diffs prev→current and stores in
 *                                       bounded ring _diffAudit309.
 *                                       GET /api/v1/market/alerts/suppress/config/v309/diff/audit
 *
 *   3. RankedSnapshotBuffer309        — extends SearchableSnapshotBuffer308 with
 *                                       rankedSearch309(token) that sorts occurrences
 *                                       by eventCount descending.
 *                                       GET /api/v1/market/backtest/sessions/v309/snapshot/search/ranked?token=
 *
 *   4. TrendPercentilesTracker309     — extends PercentilesHistogramTracker308 with
 *                                       percentileTrend309(source, windowMs, buckets)
 *                                       that splits window into equal sub-windows and
 *                                       returns p50/p95/p99 for each bucket.
 *                                       GET /api/v1/contracts/receipts/v309/histogram/rolling/percentiles/trend?source=&windowMs=&buckets=
 *
 * Sacred files untouched (R1). All new identifiers end in `309` (R2).
 * Zero new npm deps (R3). V287..V308 surfaces preserved (R6).
 * lib/ mirrors src/lib/ (R5). package.json bumped to 309.0.0.
 *
 * @version 309.0.0
 */

const V308 = require('./marketMaker308.js');
const V307 = require('./marketMaker307.js');
const V306 = require('./marketMaker306.js');
const V305 = require('./marketMaker305.js');
const V304 = require('./marketMaker304.js');

const MM_VERSION_309 = '309.0.0';

// ─────────────────────────────────────────────────────────────────────────────
// 1) PersistedAggregateHistory309
//    Extends AggregateHistory308 with persistAggregate309(pool) that writes the
//    current aggregate snapshot to a DB table `ecos_prune_aggregate` via a
//    single-row upsert keyed on a fixed row key. Non-fatal if DB is unavailable.
// ─────────────────────────────────────────────────────────────────────────────

class PersistedAggregateHistory309 extends V308.AggregateHistory308 {
  constructor(opts = {}) {
    super(opts);
    this._aggregatePersistStats309 = { persistCalls: 0, errors: 0 };
  }

  /**
   * persistAggregate309(pool) — compute the current aggregate and upsert it into
   * the `ecos_prune_aggregate` DB table. The table is auto-created if missing.
   * Always resolves (non-fatal on DB error).
   *
   * @param {object} pool — pg Pool (or compatible)
   * @returns {Promise<{ ok, aggregate, version }>}
   */
  async persistAggregate309(pool) {
    this._aggregatePersistStats309.persistCalls++;
    const aggregate = this.aggregateHistory308();

    if (!pool) {
      this._aggregatePersistStats309.errors++;
      return { ok: false, reason: 'no pool provided', version: MM_VERSION_309 };
    }

    try {
      // Auto-create table if missing (non-fatal)
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS ecos_prune_aggregate (
            row_key          TEXT PRIMARY KEY,
            total_runs       INT,
            success_runs     INT,
            error_runs       INT,
            success_rate     DOUBLE PRECISION,
            error_rate       DOUBLE PRECISION,
            total_rows       BIGINT,
            avg_rows_per_run DOUBLE PRECISION,
            first_ran_at     TEXT,
            last_ran_at      TEXT,
            version          TEXT,
            updated_at       TIMESTAMPTZ DEFAULT NOW()
          )
        `);
      } catch (_) { /* non-fatal */ }

      await pool.query(
        `INSERT INTO ecos_prune_aggregate
           (row_key, total_runs, success_runs, error_runs, success_rate,
            error_rate, total_rows, avg_rows_per_run, first_ran_at, last_ran_at,
            version, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
         ON CONFLICT (row_key)
         DO UPDATE SET
           total_runs       = EXCLUDED.total_runs,
           success_runs     = EXCLUDED.success_runs,
           error_runs       = EXCLUDED.error_runs,
           success_rate     = EXCLUDED.success_rate,
           error_rate       = EXCLUDED.error_rate,
           total_rows       = EXCLUDED.total_rows,
           avg_rows_per_run = EXCLUDED.avg_rows_per_run,
           first_ran_at     = EXCLUDED.first_ran_at,
           last_ran_at      = EXCLUDED.last_ran_at,
           version          = EXCLUDED.version,
           updated_at       = NOW()`,
        [
          'singleton',
          aggregate.totalRuns,
          aggregate.successRuns,
          aggregate.errorRuns,
          aggregate.successRate,
          aggregate.errorRate,
          aggregate.totalRows,
          aggregate.averageRowsPerRun,
          aggregate.firstRanAt,
          aggregate.lastRanAt,
          MM_VERSION_309,
        ]
      );

      return { ok: true, aggregate, version: MM_VERSION_309 };
    } catch (err) {
      this._aggregatePersistStats309.errors++;
      return { ok: false, reason: err.message, version: MM_VERSION_309 };
    }
  }

  /**
   * aggregatePersistStats309() — expose internal counters.
   */
  aggregatePersistStats309() {
    return Object.assign({}, this._aggregatePersistStats309, { version: MM_VERSION_309 });
  }

  stats() {
    const base = super.stats();
    return Object.assign({}, base, { version: MM_VERSION_309 });
  }
}

let _defaultPersistedAggregateHistory309 = null;
function defaultPersistedAggregateHistory309(opts) {
  if (!_defaultPersistedAggregateHistory309 || opts) {
    _defaultPersistedAggregateHistory309 = new PersistedAggregateHistory309(opts || {});
  }
  return _defaultPersistedAggregateHistory309;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) AutoDiffBridge309
//    Extends ConfigDiffBridge308 with autoDiff309 flag. When enabled, each call
//    to persistConfig307 auto-diffs the previous version against the new version
//    and stores the result in bounded ring _diffAudit309.
// ─────────────────────────────────────────────────────────────────────────────

class AutoDiffBridge309 extends V308.ConfigDiffBridge308 {
  constructor(opts = {}) {
    super(opts);
    this.autoDiff309       = opts.autoDiff309 !== undefined ? !!opts.autoDiff309 : false;
    this._diffAudit309     = [];
    this._diffAuditCap309  = opts.diffAuditCap309 !== undefined ? opts.diffAuditCap309 : 100;
  }

  /**
   * Override persistConfig307 to auto-diff when autoDiff309 is enabled.
   */
  async persistConfig307(pool, updatedBy) {
    // Record the config version BEFORE the parent bumps it
    const prevVersion = this._configVersion307 != null ? this._configVersion307 : 0;

    const result = await super.persistConfig307(pool, updatedBy);

    if (this.autoDiff309 && this._configVersion307 != null && this._configVersion307 !== prevVersion) {
      const diff = this.diffConfigVersions308(prevVersion, this._configVersion307);
      const entry309 = {
        fromVersion: prevVersion,
        toVersion:   this._configVersion307,
        diff,
        recordedAt:  new Date().toISOString(),
        version:     MM_VERSION_309,
      };
      this._diffAudit309.push(entry309);
      if (this._diffAudit309.length > this._diffAuditCap309) {
        this._diffAudit309.shift();
      }
    }

    return result;
  }

  /**
   * getDiffAudit309() — return all entries in the diff audit ring.
   *
   * @returns {{ ok, entries, version }}
   */
  getDiffAudit309() {
    return {
      ok:      true,
      entries: this._diffAudit309.slice(),
      version: MM_VERSION_309,
    };
  }

  stats() {
    const base = super.stats();
    return Object.assign({}, base, { version: MM_VERSION_309 });
  }
}

let _defaultAutoDiffBridge309 = null;
function defaultAutoDiffBridge309(opts) {
  if (!_defaultAutoDiffBridge309 || opts) {
    _defaultAutoDiffBridge309 = new AutoDiffBridge309(opts || {});
  }
  return _defaultAutoDiffBridge309;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) RankedSnapshotBuffer309
//    Extends SearchableSnapshotBuffer308 with rankedSearch309(token) that returns
//    occurrences sorted by eventCount descending so the most-active snapshots
//    appear first.
// ─────────────────────────────────────────────────────────────────────────────

class RankedSnapshotBuffer309 extends V308.SearchableSnapshotBuffer308 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * rankedSearch309(token) — same as searchSnapshot308 but results are sorted by
   * eventCount descending (most-active first).
   *
   * @param {string} token
   * @returns {{ ok, token, results: Array<{ index, savedAt, eventCount }>, version }}
   */
  rankedSearch309(token) {
    const base = this.searchSnapshot308(token);
    if (!base.ok) {
      return Object.assign({}, base, { version: MM_VERSION_309 });
    }

    const ranked = base.results.slice().sort((a, b) => b.eventCount - a.eventCount);
    return {
      ok:      true,
      token,
      results: ranked,
      version: MM_VERSION_309,
    };
  }

  stats() {
    const base = typeof super.stats === 'function' ? super.stats() : {};
    return Object.assign({}, base, { version: MM_VERSION_309 });
  }
}

let _defaultRankedSnapshotBuffer309 = null;
function defaultRankedSnapshotBuffer309(opts) {
  if (!_defaultRankedSnapshotBuffer309 || opts) {
    _defaultRankedSnapshotBuffer309 = new RankedSnapshotBuffer309(opts || {});
  }
  return _defaultRankedSnapshotBuffer309;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) TrendPercentilesTracker309
//    Extends PercentilesHistogramTracker308 with percentileTrend309(source,
//    windowMs, buckets) that splits the window into equal sub-windows and returns
//    p50/p95/p99 for each bucket.
// ─────────────────────────────────────────────────────────────────────────────

class TrendPercentilesTracker309 extends V308.PercentilesHistogramTracker308 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * percentileTrend309(source, windowMs, buckets) — split the rolling window
   * into `buckets` equal sub-windows and compute p50/p95/p99 for each bucket.
   *
   * @param {string} source
   * @param {number} windowMs   — total window length in ms
   * @param {number} buckets    — number of equal sub-windows (default 5)
   * @returns {{ ok, source, windowMs, buckets, trend: Array<{bucketIndex, from, to, p50, p95, p99, count}>, version }}
   */
  percentileTrend309(source, windowMs, buckets) {
    const src       = source != null ? String(source) : 'default';
    const wMs       = typeof windowMs === 'number' && windowMs > 0 ? windowMs : 60000;
    const bCount    = (typeof buckets === 'number' && buckets > 0 && Number.isInteger(buckets))
      ? buckets
      : 5;

    const now       = Date.now();
    const cutoff    = now - wMs;
    const bucketMs  = wMs / bCount;

    const obs = (this._timedObs307[src] || []).filter(o => o.ts >= cutoff);

    const trend = [];
    for (let i = 0; i < bCount; i++) {
      const bucketStart = cutoff + i * bucketMs;
      const bucketEnd   = bucketStart + bucketMs;
      const bucketObs   = obs.filter(o => o.ts >= bucketStart && o.ts < bucketEnd);
      const sorted      = bucketObs.map(o => o.latencyMs).sort((a, b) => a - b);

      trend.push({
        bucketIndex: i,
        from:        new Date(bucketStart).toISOString(),
        to:          new Date(bucketEnd).toISOString(),
        count:       sorted.length,
        p50:         this._percentile308(sorted, 50),
        p95:         this._percentile308(sorted, 95),
        p99:         this._percentile308(sorted, 99),
      });
    }

    return {
      ok:       true,
      source:   src,
      windowMs: wMs,
      buckets:  bCount,
      trend,
      version:  MM_VERSION_309,
    };
  }

  stats() {
    const base = super.stats();
    return Object.assign({}, base, { version: MM_VERSION_309 });
  }
}

let _defaultTrendPercentilesTracker309 = null;
function defaultTrendPercentilesTracker309(opts) {
  if (!_defaultTrendPercentilesTracker309 || opts) {
    _defaultTrendPercentilesTracker309 = new TrendPercentilesTracker309(opts || {});
  }
  return _defaultTrendPercentilesTracker309;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  MM_VERSION_309,
  // 1. Persisted aggregate history
  PersistedAggregateHistory309,
  defaultPersistedAggregateHistory309,
  // 2. Auto diff audit bridge
  AutoDiffBridge309,
  defaultAutoDiffBridge309,
  // 3. Ranked snapshot buffer
  RankedSnapshotBuffer309,
  defaultRankedSnapshotBuffer309,
  // 4. Percentile trend tracker
  TrendPercentilesTracker309,
  defaultTrendPercentilesTracker309,
};
