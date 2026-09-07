'use strict';
/**
 * lib/marketMaker306.js — ECOS V306 (Phase P194) — Prune History Ring,
 *                          Suppress Config Persistence, Snapshot Versioning,
 *                          Histogram Reset
 *
 * Four additive components that extend the V305 observability layer:
 *
 *   1. PruneHistoryScheduler306   — extends PruneScheduler305 with a bounded ring
 *                                   (max 50 entries) of historical prune results so
 *                                   operators can see trends.
 *                                   pruneHistory306() → { entries: [...], version }
 *
 *   2. PersistentAlertBridge306   — extends AdaptiveAlertBridge305 with DB-backed
 *                                   persist/load of the override map.
 *                                   persistConfig306(pool) / loadConfig306(pool).
 *                                   GET /api/v1/market/alerts/suppress/config/v306.
 *
 *   3. VersionedSnapshotBuffer306 — extends SnapshotSessionBuffer305 with a
 *                                   time-stamped snapshot history ring (default 10).
 *                                   snapshotHistory306() / restoreFromHistory306(index).
 *
 *   4. ResettableHistogramTracker306 — extends HistogramLatencyTracker305 with
 *                                      resetHistogram306(source?) to clear bucket
 *                                      counts for one or all sources.
 *
 * Sacred files untouched (R1). All new identifiers end in `306` (R2).
 * Zero new npm deps (R3). V287..V305 surfaces preserved (R6).
 * lib/ mirrors src/lib/ (R5). package.json bumped to 306.0.0.
 *
 * @version 306.0.0
 */

const V305   = require('./marketMaker305.js');
const V304   = require('./marketMaker304.js');
const V303   = require('./marketMaker303.js');
const V302   = require('./marketMaker302.js');
const V301   = require('./marketMaker301.js');
const crypto = require('crypto');

const MM_VERSION_306                    = '306.0.0';
const DEFAULT_PRUNE_HISTORY_CAPACITY_306 = 50;
const DEFAULT_SNAPSHOT_HISTORY_CAPACITY_306 = 10;
const SUPPRESS_CONFIG_TABLE_306         = 'ecos_alert_suppress_config';
const SNAPSHOT_HISTORY_VERSION_306      = '306-snapshot';

// ─────────────────────────────────────────────────────────────────────────────
// 1) PruneHistoryScheduler306
//    Extends PruneScheduler305 with a bounded ring of historical prune results.
//    pruneHistory306() → { ok, entries: [...], capacity, version }
// ─────────────────────────────────────────────────────────────────────────────

class PruneHistoryScheduler306 extends V305.PruneScheduler305 {
  /**
   * @param {{
   *   flusher?:       DeliveryLogFlusher304,
   *   intervalMs?:    number,
   *   ttlDays?:       number,
   *   historyCapacity?: number  (default 50)
   * }} opts
   */
  constructor(opts = {}) {
    super(opts);
    this._historyCapacity306 = opts.historyCapacity !== undefined
      ? opts.historyCapacity
      : DEFAULT_PRUNE_HISTORY_CAPACITY_306;
    this._pruneHistory306 = [];
  }

  /** start306() — starts the scheduler, appending each result to the history ring. */
  start306() {
    if (this._timer) this.stop305();

    const runPrune = async () => {
      this._stats.scheduledRuns += 1;
      const olderThan = new Date(Date.now() - this._ttlDays * 24 * 60 * 60 * 1000).toISOString();
      let entry;
      try {
        const result = await this._flusher.prune304(olderThan);
        entry = Object.assign({}, result, { ranAt: new Date().toISOString(), ok: true });
        this._lastStats = entry;
        this._stats.successRuns += 1;
      } catch (e) {
        entry = { ok: false, error: e.message, ranAt: new Date().toISOString() };
        this._lastStats = entry;
        this._stats.errorRuns += 1;
      }
      // Append to bounded history ring
      this._pruneHistory306.push(entry);
      if (this._pruneHistory306.length > this._historyCapacity306) {
        this._pruneHistory306.shift();
      }
      this._nextPruneAt = new Date(Date.now() + this._intervalMs).toISOString();
    };

    this._nextPruneAt = new Date(Date.now() + this._intervalMs).toISOString();
    this._timer = setInterval(runPrune, this._intervalMs);
    if (this._timer.unref) this._timer.unref();

    return { ok: true, intervalMs: this._intervalMs, nextPruneAt: this._nextPruneAt, version: MM_VERSION_306 };
  }

  /**
   * pruneHistory306() — return the bounded history ring of past prune runs.
   * Entries are ordered oldest → newest.
   */
  pruneHistory306() {
    return {
      ok:       true,
      entries:  this._pruneHistory306.slice(),
      capacity: this._historyCapacity306,
      count:    this._pruneHistory306.length,
      version:  MM_VERSION_306,
    };
  }

  /** scheduleInfo306() — extends scheduleInfo305 with history count. */
  scheduleInfo306() {
    const base = this.scheduleInfo305();
    return Object.assign({}, base, {
      historyCount:    this._pruneHistory306.length,
      historyCapacity: this._historyCapacity306,
      version:         MM_VERSION_306,
    });
  }

  stats() {
    const base = super.stats();
    return Object.assign({}, base, {
      version:         MM_VERSION_306,
      historyCount:    this._pruneHistory306.length,
      historyCapacity: this._historyCapacity306,
    });
  }
}

let _defaultPruneHistoryScheduler306 = null;
function defaultPruneHistoryScheduler306(opts) {
  if (!_defaultPruneHistoryScheduler306 || opts) {
    _defaultPruneHistoryScheduler306 = new PruneHistoryScheduler306(opts || {});
  }
  return _defaultPruneHistoryScheduler306;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) PersistentAlertBridge306
//    Extends AdaptiveAlertBridge305 with DB-backed persist/load of the override map.
//    persistConfig306(pool) → writes overrides to ecos_alert_suppress_config table.
//    loadConfig306(pool)    → reads overrides back and merges into _overrides305.
// ─────────────────────────────────────────────────────────────────────────────

class PersistentAlertBridge306 extends V305.AdaptiveAlertBridge305 {
  constructor(opts = {}) {
    super(opts);
    this._db306          = opts.db || null;
    this._dbMigrated306  = false;
    this._persistStats306 = { persistCalls: 0, loadCalls: 0, errors: 0 };
  }

  setDb306(db) { this._db306 = db; }

  async _ensureMigrated306(pool) {
    if (this._dbMigrated306) return;
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${SUPPRESS_CONFIG_TABLE_306} (
          adapter_name TEXT PRIMARY KEY,
          suppress_ms  BIGINT NOT NULL,
          updated_at   TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      this._dbMigrated306 = true;
    } catch (_) {
      // non-fatal; in-memory overrides still work
    }
  }

  /**
   * persistConfig306(pool) — write the current _overrides305 map to DB.
   * Uses upsert (INSERT … ON CONFLICT DO UPDATE).
   */
  async persistConfig306(pool) {
    this._persistStats306.persistCalls += 1;
    const db = pool || this._db306;
    if (!db) {
      return { ok: false, reason: 'no_db', persisted: 0, version: MM_VERSION_306 };
    }
    await this._ensureMigrated306(db);

    const overrides = this._overrides305;
    const keys = Object.keys(overrides);
    let persisted = 0;
    let errors = 0;
    for (const key of keys) {
      try {
        await db.query(
          `INSERT INTO ${SUPPRESS_CONFIG_TABLE_306} (adapter_name, suppress_ms, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (adapter_name) DO UPDATE
             SET suppress_ms = EXCLUDED.suppress_ms,
                 updated_at  = NOW()`,
          [key, overrides[key]]
        );
        persisted += 1;
      } catch (e) {
        errors += 1;
        this._persistStats306.errors += 1;
      }
    }
    return { ok: true, persisted, errors, version: MM_VERSION_306 };
  }

  /**
   * loadConfig306(pool) — load the persisted override map from DB and merge
   * into the in-memory _overrides305.
   */
  async loadConfig306(pool) {
    this._persistStats306.loadCalls += 1;
    const db = pool || this._db306;
    if (!db) {
      return { ok: false, reason: 'no_db', loaded: 0, version: MM_VERSION_306 };
    }
    await this._ensureMigrated306(db);

    let rows;
    try {
      const result = await db.query(
        `SELECT adapter_name, suppress_ms FROM ${SUPPRESS_CONFIG_TABLE_306}`
      );
      rows = result.rows || [];
    } catch (e) {
      this._persistStats306.errors += 1;
      return { ok: false, reason: e.message, loaded: 0, version: MM_VERSION_306 };
    }

    const merged = {};
    for (const row of rows) {
      merged[row.adapter_name] = Number(row.suppress_ms);
    }
    Object.assign(this._overrides305, merged);
    return { ok: true, loaded: rows.length, overrides: Object.assign({}, this._overrides305), version: MM_VERSION_306 };
  }

  /**
   * getPersistedConfig306() — return current in-memory config (which reflects
   * what was last loaded from DB).
   */
  getPersistedConfig306() {
    return {
      ok:        true,
      globalMs:  this._suppressMs,
      overrides: Object.assign({}, this._overrides305),
      persistStats: Object.assign({}, this._persistStats306),
      version:   MM_VERSION_306,
    };
  }

  stats() {
    const base = super.stats();
    return Object.assign({}, base, {
      version:      MM_VERSION_306,
      persistStats: Object.assign({}, this._persistStats306),
    });
  }
}

let _defaultPersistentAlertBridge306 = null;
function defaultPersistentAlertBridge306(opts) {
  if (!_defaultPersistentAlertBridge306 || opts) {
    _defaultPersistentAlertBridge306 = new PersistentAlertBridge306(opts || {});
  }
  return _defaultPersistentAlertBridge306;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) VersionedSnapshotBuffer306
//    Extends SnapshotSessionBuffer305 with a time-stamped snapshot history ring.
//    snapshotHistory306() → last N snapshots (configurable, default 10)
//    restoreFromHistory306(index) → restore from a previous snapshot
// ─────────────────────────────────────────────────────────────────────────────

class VersionedSnapshotBuffer306 extends V305.SnapshotSessionBuffer305 {
  /**
   * @param {{
   *   historyCapacity?: number  (default 10)
   * }} opts
   */
  constructor(opts = {}) {
    super(opts);
    this._historyCapacity306 = opts.historyCapacity !== undefined
      ? opts.historyCapacity
      : DEFAULT_SNAPSHOT_HISTORY_CAPACITY_306;
    this._snapshotHistory306 = [];
  }

  /**
   * snapshotSessions306() — takes a V305 snapshot and also pushes it onto the
   * bounded history ring (max historyCapacity entries).
   */
  snapshotSessions306() {
    const snap = this.snapshotSessions305();
    // Tag with a V306 version field for distinguish from bare V305 snapshots
    const entry = Object.assign({}, snap, {
      historyVersion: SNAPSHOT_HISTORY_VERSION_306,
      savedAt:        new Date().toISOString(),
    });
    this._snapshotHistory306.push(entry);
    if (this._snapshotHistory306.length > this._historyCapacity306) {
      this._snapshotHistory306.shift();
    }
    return Object.assign({}, entry, { version: MM_VERSION_306 });
  }

  /**
   * snapshotHistory306() — return the bounded history ring of past snapshots.
   * Index 0 is oldest; index length-1 is newest.
   */
  snapshotHistory306() {
    return {
      ok:       true,
      history:  this._snapshotHistory306.map((snap, i) => ({
        index:     i,
        savedAt:   snap.savedAt,
        sessions:  snap.sessions ? snap.sessions.length : 0,
        version:   snap.historyVersion,
      })),
      capacity: this._historyCapacity306,
      count:    this._snapshotHistory306.length,
      version:  MM_VERSION_306,
    };
  }

  /**
   * restoreFromHistory306(index) — restore session metadata from a snapshot
   * at the given history index (0 = oldest kept).
   */
  restoreFromHistory306(index) {
    if (typeof index !== 'number' || index < 0 || index >= this._snapshotHistory306.length) {
      throw new Error(
        `restoreFromHistory306: index ${index} out of range [0, ${this._snapshotHistory306.length - 1}]`
      );
    }
    const snap = this._snapshotHistory306[index];
    // restoreSessions305 requires .version === '305-snapshot'
    const result = this.restoreSessions305(snap);
    return Object.assign({}, result, {
      restoredFromIndex: index,
      savedAt:           snap.savedAt,
      version:           MM_VERSION_306,
    });
  }

  stats() {
    const base = typeof super.stats === 'function' ? super.stats() : {};
    return Object.assign({}, base, {
      version:         MM_VERSION_306,
      historyCount:    this._snapshotHistory306.length,
      historyCapacity: this._historyCapacity306,
    });
  }
}

let _defaultVersionedSnapshotBuffer306 = null;
function defaultVersionedSnapshotBuffer306(opts) {
  if (!_defaultVersionedSnapshotBuffer306 || opts) {
    _defaultVersionedSnapshotBuffer306 = new VersionedSnapshotBuffer306(opts || {});
  }
  return _defaultVersionedSnapshotBuffer306;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) ResettableHistogramTracker306
//    Extends HistogramLatencyTracker305 with resetHistogram306(source?) to clear
//    bucket counts for a specific source or all sources.
// ─────────────────────────────────────────────────────────────────────────────

class ResettableHistogramTracker306 extends V305.HistogramLatencyTracker305 {
  constructor(opts = {}) {
    super(opts);
    this._resetStats306 = { totalResets: 0, sourceResets: 0, globalResets: 0 };
  }

  /**
   * resetHistogram306(source?) — reset bucket counts for a specific source, or
   * all sources if source is omitted / null / undefined.
   *
   * @param {string} [source]  If omitted, resets all sources.
   * @returns {{ ok, reset, version }}
   */
  resetHistogram306(source) {
    this._resetStats306.totalResets += 1;

    if (source !== undefined && source !== null) {
      // Reset a single source
      const key = String(source);
      this._resetStats306.sourceResets += 1;
      if (this._histograms305[key]) {
        this._histograms305[key] = {
          bucketCounts: new Array(this._buckets305.length).fill(0),
          overflow:     0,
          count:        0,
        };
        return { ok: true, reset: [key], version: MM_VERSION_306 };
      }
      // Source did not exist — initialise it fresh
      this._initHistogram305(key);
      return { ok: true, reset: [key], created: true, version: MM_VERSION_306 };
    }

    // Reset all sources
    this._resetStats306.globalResets += 1;
    const sources = Object.keys(this._histograms305);
    for (const s of sources) {
      this._histograms305[s] = {
        bucketCounts: new Array(this._buckets305.length).fill(0),
        overflow:     0,
        count:        0,
      };
    }
    return { ok: true, reset: sources, version: MM_VERSION_306 };
  }

  /**
   * resetStats306() — return counters for reset operations.
   */
  resetStats306() {
    return Object.assign({ ok: true, version: MM_VERSION_306 }, this._resetStats306);
  }

  stats() {
    const base = super.stats();
    return Object.assign({}, base, {
      version:     MM_VERSION_306,
      resetStats:  Object.assign({}, this._resetStats306),
    });
  }
}

let _defaultResettableHistogramTracker306 = null;
function defaultResettableHistogramTracker306(opts) {
  if (!_defaultResettableHistogramTracker306 || opts) {
    _defaultResettableHistogramTracker306 = new ResettableHistogramTracker306(opts || {});
  }
  return _defaultResettableHistogramTracker306;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  MM_VERSION_306,
  DEFAULT_PRUNE_HISTORY_CAPACITY_306,
  DEFAULT_SNAPSHOT_HISTORY_CAPACITY_306,
  SUPPRESS_CONFIG_TABLE_306,
  SNAPSHOT_HISTORY_VERSION_306,
  // 1. Prune history scheduler
  PruneHistoryScheduler306,
  defaultPruneHistoryScheduler306,
  // 2. Persistent alert bridge
  PersistentAlertBridge306,
  defaultPersistentAlertBridge306,
  // 3. Versioned snapshot buffer
  VersionedSnapshotBuffer306,
  defaultVersionedSnapshotBuffer306,
  // 4. Resettable histogram tracker
  ResettableHistogramTracker306,
  defaultResettableHistogramTracker306,
};
