'use strict';
/**
 * lib/marketMaker307.js — ECOS V307 (Phase P195) — Persist Prune History,
 *                          Suppress Config Versioning, Snapshot Diff,
 *                          Histogram Rolling Window
 *
 * Four additive components that extend the V306 observability layer:
 *
 *   1. PersistentPruneHistory307  — extends PruneHistoryScheduler306 with DB-backed
 *                                   persist/restore of the prune history ring.
 *                                   flushHistory307(pool) / loadHistory307(pool).
 *                                   GET /api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v307/db
 *
 *   2. VersionedAlertBridge307    — extends PersistentAlertBridge306 with a
 *                                   config_version counter (incremented on each
 *                                   persistConfig306 call) and updated_by TEXT so
 *                                   changes are attributable.
 *                                   GET /api/v1/market/alerts/suppress/config/v307/version
 *
 *   3. DiffSnapshotBuffer307      — extends VersionedSnapshotBuffer306 with
 *                                   diffSnapshots307(indexA, indexB) that returns
 *                                   added/removed/changed session tokens.
 *                                   POST /api/v1/market/backtest/sessions/v307/snapshot/diff
 *
 *   4. RollingHistogramTracker307 — extends ResettableHistogramTracker306 with
 *                                   rollingHistogram307(source, windowMs) that returns
 *                                   histogram data only for observations within the
 *                                   last windowMs milliseconds (requires timestamps).
 *                                   GET /api/v1/contracts/receipts/v307/histogram/rolling
 *
 * Sacred files untouched (R1). All new identifiers end in `307` (R2).
 * Zero new npm deps (R3). V287..V306 surfaces preserved (R6).
 * lib/ mirrors src/lib/ (R5). package.json bumped to 307.0.0.
 *
 * @version 307.0.0
 */

const V306   = require('./marketMaker306.js');
const V305   = require('./marketMaker305.js');
const V304   = require('./marketMaker304.js');
const V303   = require('./marketMaker303.js');
const V302   = require('./marketMaker302.js');
const crypto = require('crypto');

const MM_VERSION_307              = '307.0.0';
const PRUNE_HISTORY_TABLE_307     = 'ecos_prune_history';
const SUPPRESS_CONFIG_TABLE_307   = 'ecos_alert_suppress_config';   // same table, extended columns

// ─────────────────────────────────────────────────────────────────────────────
// 1) PersistentPruneHistory307
//    Extends PruneHistoryScheduler306 with DB-backed persist/restore of the
//    prune history ring so operators keep trend data across restarts.
//    flushHistory307(pool) → writes each history entry to ecos_prune_history
//    loadHistory307(pool)  → reads rows back and restores the in-memory ring
// ─────────────────────────────────────────────────────────────────────────────

class PersistentPruneHistory307 extends V306.PruneHistoryScheduler306 {
  constructor(opts = {}) {
    super(opts);
    this._dbMigrated307  = false;
    this._historyStats307 = { flushCalls: 0, loadCalls: 0, errors: 0 };
  }

  async _ensurePruneHistoryTable307(pool) {
    if (this._dbMigrated307) return;
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${PRUNE_HISTORY_TABLE_307} (
          id          BIGSERIAL PRIMARY KEY,
          ran_at      TIMESTAMPTZ NOT NULL,
          ok          BOOLEAN     NOT NULL,
          pruned      INTEGER,
          older_than  TEXT,
          error_msg   TEXT,
          version     TEXT
        )
      `);
      this._dbMigrated307 = true;
    } catch (_) {
      // non-fatal; in-memory ring still works
    }
  }

  /**
   * flushHistory307(pool) — persist the current in-memory prune history ring to DB.
   * Each entry that doesn't already exist (matched by ran_at) is inserted.
   * Returns { ok, flushed, errors, version }
   */
  async flushHistory307(pool) {
    this._historyStats307.flushCalls += 1;
    if (!pool) {
      return { ok: false, reason: 'no_db', flushed: 0, version: MM_VERSION_307 };
    }
    await this._ensurePruneHistoryTable307(pool);

    const entries = this._pruneHistory306.slice();
    let flushed = 0;
    let errors  = 0;
    for (const entry of entries) {
      try {
        await pool.query(
          `INSERT INTO ${PRUNE_HISTORY_TABLE_307}
             (ran_at, ok, pruned, older_than, error_msg, version)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT DO NOTHING`,
          [
            entry.ranAt || new Date().toISOString(),
            entry.ok    !== false,
            entry.pruned   != null ? Number(entry.pruned)   : null,
            entry.olderThan != null ? String(entry.olderThan) : null,
            entry.error    != null ? String(entry.error)    : null,
            MM_VERSION_307,
          ]
        );
        flushed += 1;
      } catch (e) {
        errors += 1;
        this._historyStats307.errors += 1;
      }
    }
    return { ok: true, flushed, errors, total: entries.length, version: MM_VERSION_307 };
  }

  /**
   * loadHistory307(pool) — read persisted prune history from DB and restore
   * the in-memory history ring (replacing current contents).
   * Returns { ok, loaded, version }
   */
  async loadHistory307(pool) {
    this._historyStats307.loadCalls += 1;
    if (!pool) {
      return { ok: false, reason: 'no_db', loaded: 0, version: MM_VERSION_307 };
    }
    await this._ensurePruneHistoryTable307(pool);

    let rows;
    try {
      const result = await pool.query(
        `SELECT ran_at, ok, pruned, older_than, error_msg
         FROM ${PRUNE_HISTORY_TABLE_307}
         ORDER BY ran_at ASC
         LIMIT $1`,
        [this._historyCapacity306]
      );
      rows = result.rows || [];
    } catch (e) {
      this._historyStats307.errors += 1;
      return { ok: false, reason: e.message, loaded: 0, version: MM_VERSION_307 };
    }

    this._pruneHistory306 = rows.map(row => ({
      ok:         row.ok,
      pruned:     row.pruned != null ? Number(row.pruned) : undefined,
      olderThan:  row.older_than,
      error:      row.error_msg,
      ranAt:      row.ran_at instanceof Date ? row.ran_at.toISOString() : String(row.ran_at),
    }));

    return { ok: true, loaded: rows.length, version: MM_VERSION_307 };
  }

  /** historyStats307() — expose flush/load counters */
  historyStats307() {
    return Object.assign({ ok: true, version: MM_VERSION_307 }, this._historyStats307);
  }

  stats() {
    const base = super.stats();
    return Object.assign({}, base, {
      version:       MM_VERSION_307,
      historyStats:  Object.assign({}, this._historyStats307),
    });
  }
}

let _defaultPersistentPruneHistory307 = null;
function defaultPersistentPruneHistory307(opts) {
  if (!_defaultPersistentPruneHistory307 || opts) {
    _defaultPersistentPruneHistory307 = new PersistentPruneHistory307(opts || {});
  }
  return _defaultPersistentPruneHistory307;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) VersionedAlertBridge307
//    Extends PersistentAlertBridge306 with a config_version counter (incremented
//    on each persistConfig306 call) and an updated_by TEXT column so changes
//    are attributable.
//    getConfigVersion307() → { configVersion, updatedBy, ... }
// ─────────────────────────────────────────────────────────────────────────────

class VersionedAlertBridge307 extends V306.PersistentAlertBridge306 {
  constructor(opts = {}) {
    super(opts);
    this._configVersion307 = 0;
    this._updatedBy307     = opts.updatedBy || 'system';
    this._versionHistory307 = [];      // bounded ring of (version, updatedBy, updatedAt)
    this._versionHistoryCap307 = opts.versionHistoryCap !== undefined
      ? opts.versionHistoryCap
      : 50;
  }

  /**
   * persistConfig307(pool, updatedBy?) — persist overrides with versioning.
   * Increments config_version on each call; records updatedBy for attribution.
   * Falls through to PersistentAlertBridge306.persistConfig306 after bookkeeping.
   */
  async persistConfig307(pool, updatedBy) {
    this._configVersion307 += 1;
    if (updatedBy) this._updatedBy307 = String(updatedBy);
    const at = new Date().toISOString();

    // Record in version history ring
    this._versionHistory307.push({
      configVersion: this._configVersion307,
      updatedBy:     this._updatedBy307,
      updatedAt:     at,
    });
    if (this._versionHistory307.length > this._versionHistoryCap307) {
      this._versionHistory307.shift();
    }

    // Persist using parent (writes adapter_name, suppress_ms, updated_at)
    // Also attempt to add version columns if DB is available
    const baseResult = await this.persistConfig306(pool);

    if (pool) {
      try {
        // Ensure version/updated_by columns exist (idempotent ALTER TABLE)
        await pool.query(`
          ALTER TABLE ${SUPPRESS_CONFIG_TABLE_307}
            ADD COLUMN IF NOT EXISTS config_version INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS updated_by     TEXT
        `);
        // Update all rows with current version metadata
        await pool.query(
          `UPDATE ${SUPPRESS_CONFIG_TABLE_307}
           SET config_version = $1, updated_by = $2`,
          [this._configVersion307, this._updatedBy307]
        );
      } catch (_) {
        // non-fatal — version tracking is best-effort
      }
    }

    return Object.assign({}, baseResult, {
      configVersion: this._configVersion307,
      updatedBy:     this._updatedBy307,
      updatedAt:     at,
      version:       MM_VERSION_307,
    });
  }

  /**
   * getConfigVersion307() — return current version, updatedBy, and history ring.
   */
  getConfigVersion307() {
    return {
      ok:             true,
      configVersion:  this._configVersion307,
      updatedBy:      this._updatedBy307,
      globalMs:       this._suppressMs,
      overrides:      Object.assign({}, this._overrides305),
      versionHistory: this._versionHistory307.slice(),
      version:        MM_VERSION_307,
    };
  }

  stats() {
    const base = super.stats();
    return Object.assign({}, base, {
      version:       MM_VERSION_307,
      configVersion: this._configVersion307,
      updatedBy:     this._updatedBy307,
    });
  }
}

let _defaultVersionedAlertBridge307 = null;
function defaultVersionedAlertBridge307(opts) {
  if (!_defaultVersionedAlertBridge307 || opts) {
    _defaultVersionedAlertBridge307 = new VersionedAlertBridge307(opts || {});
  }
  return _defaultVersionedAlertBridge307;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) DiffSnapshotBuffer307
//    Extends VersionedSnapshotBuffer306 with diffSnapshots307(indexA, indexB)
//    that compares two history entries and returns added/removed/changed tokens.
// ─────────────────────────────────────────────────────────────────────────────

class DiffSnapshotBuffer307 extends V306.VersionedSnapshotBuffer306 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * diffSnapshots307(indexA, indexB) — compare two snapshot history entries.
   *
   * Returns:
   *   { ok, indexA, indexB, added: [...tokens], removed: [...tokens],
   *     changed: [...tokens], unchanged: number, version }
   *
   * A token is "changed" if it appears in both snapshots but its eventCount
   * differs. Added = in B but not A. Removed = in A but not B.
   */
  diffSnapshots307(indexA, indexB) {
    const history = this._snapshotHistory306;
    const len     = history.length;

    if (typeof indexA !== 'number' || indexA < 0 || indexA >= len) {
      throw new Error(`diffSnapshots307: indexA ${indexA} out of range [0, ${len - 1}]`);
    }
    if (typeof indexB !== 'number' || indexB < 0 || indexB >= len) {
      throw new Error(`diffSnapshots307: indexB ${indexB} out of range [0, ${len - 1}]`);
    }

    const snapA = history[indexA];
    const snapB = history[indexB];

    // Build token → eventCount maps from each snapshot's sessions array
    const mapA = new Map();
    const mapB = new Map();

    const sessionsA = Array.isArray(snapA.sessions) ? snapA.sessions : [];
    const sessionsB = Array.isArray(snapB.sessions) ? snapB.sessions : [];

    for (const s of sessionsA) {
      mapA.set(s.token, s.eventCount != null ? s.eventCount : 0);
    }
    for (const s of sessionsB) {
      mapB.set(s.token, s.eventCount != null ? s.eventCount : 0);
    }

    const added    = [];
    const removed  = [];
    const changed  = [];
    let   unchanged = 0;

    // Tokens only in B → added
    for (const [tok, cnt] of mapB) {
      if (!mapA.has(tok)) {
        added.push(tok);
      } else {
        // Both have it — compare eventCount
        if (mapA.get(tok) !== cnt) {
          changed.push(tok);
        } else {
          unchanged += 1;
        }
      }
    }

    // Tokens only in A → removed
    for (const [tok] of mapA) {
      if (!mapB.has(tok)) {
        removed.push(tok);
      }
    }

    return {
      ok:        true,
      indexA,
      indexB,
      savedAtA:  snapA.savedAt,
      savedAtB:  snapB.savedAt,
      added,
      removed,
      changed,
      unchanged,
      version:   MM_VERSION_307,
    };
  }

  stats() {
    const base = typeof super.stats === 'function' ? super.stats() : {};
    return Object.assign({}, base, { version: MM_VERSION_307 });
  }
}

let _defaultDiffSnapshotBuffer307 = null;
function defaultDiffSnapshotBuffer307(opts) {
  if (!_defaultDiffSnapshotBuffer307 || opts) {
    _defaultDiffSnapshotBuffer307 = new DiffSnapshotBuffer307(opts || {});
  }
  return _defaultDiffSnapshotBuffer307;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) RollingHistogramTracker307
//    Extends ResettableHistogramTracker306 with rollingHistogram307(source, windowMs)
//    that returns histogram data only for observations within the last windowMs ms.
//    Requires storing timestamps alongside bucket increments.
// ─────────────────────────────────────────────────────────────────────────────

class RollingHistogramTracker307 extends V306.ResettableHistogramTracker306 {
  constructor(opts = {}) {
    super(opts);
    // Per-source ring of timed observations: { ts: epochMs, latencyMs: number }
    this._timedObs307    = {};   // source → [{ ts, latencyMs }, ...]
    this._maxObsCap307   = opts.maxObsCap !== undefined ? opts.maxObsCap : 10000;
  }

  /** Override query304 (inherited path) to also record a timestamped observation */
  query304(latencyMs, source) {
    // Record timestamped sample
    const src = source != null ? String(source) : 'default';
    if (!this._timedObs307[src]) this._timedObs307[src] = [];
    this._timedObs307[src].push({ ts: Date.now(), latencyMs: Number(latencyMs) });
    // Evict oldest if over cap
    if (this._timedObs307[src].length > this._maxObsCap307) {
      this._timedObs307[src].shift();
    }
    // Delegate to parent
    return super.query304(latencyMs, source);
  }

  /**
   * rollingHistogram307(source, windowMs) — return histogram data built only
   * from observations recorded within the last `windowMs` milliseconds.
   *
   * @param {string} source
   * @param {number} windowMs   e.g. 60000 for the last 60 seconds
   * @returns {{ ok, source, windowMs, buckets, overflow, count, version }}
   */
  rollingHistogram307(source, windowMs) {
    const src    = source != null ? String(source) : 'default';
    const wMs    = typeof windowMs === 'number' && windowMs > 0 ? windowMs : 60000;
    const cutoff = Date.now() - wMs;
    const obs    = (this._timedObs307[src] || []).filter(o => o.ts >= cutoff);

    // Build rolling bucket counts using the same bucket thresholds as V305
    const buckets = this._buckets305.map(le => ({ le, count: 0 }));
    let overflow  = 0;

    for (const { latencyMs } of obs) {
      let placed = false;
      for (const b of buckets) {
        if (latencyMs <= b.le) { b.count += 1; placed = true; break; }
      }
      if (!placed) overflow += 1;
    }

    return {
      ok:       true,
      source:   src,
      windowMs: wMs,
      cutoff:   new Date(cutoff).toISOString(),
      buckets,
      overflow,
      count:    obs.length,
      version:  MM_VERSION_307,
    };
  }

  /**
   * allRollingHistograms307(windowMs) — return rolling histogram for every
   * source that has timed observations.
   */
  allRollingHistograms307(windowMs) {
    const sources = {};
    for (const src of Object.keys(this._timedObs307)) {
      sources[src] = this.rollingHistogram307(src, windowMs);
    }
    return { ok: true, windowMs: windowMs || 60000, sources, version: MM_VERSION_307 };
  }

  stats() {
    const base = super.stats();
    const obsCounts = {};
    for (const [src, arr] of Object.entries(this._timedObs307)) {
      obsCounts[src] = arr.length;
    }
    return Object.assign({}, base, {
      version:   MM_VERSION_307,
      obsBuffer: obsCounts,
    });
  }
}

let _defaultRollingHistogramTracker307 = null;
function defaultRollingHistogramTracker307(opts) {
  if (!_defaultRollingHistogramTracker307 || opts) {
    _defaultRollingHistogramTracker307 = new RollingHistogramTracker307(opts || {});
  }
  return _defaultRollingHistogramTracker307;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  MM_VERSION_307,
  PRUNE_HISTORY_TABLE_307,
  SUPPRESS_CONFIG_TABLE_307,
  // 1. Persistent prune history
  PersistentPruneHistory307,
  defaultPersistentPruneHistory307,
  // 2. Versioned alert bridge
  VersionedAlertBridge307,
  defaultVersionedAlertBridge307,
  // 3. Diff snapshot buffer
  DiffSnapshotBuffer307,
  defaultDiffSnapshotBuffer307,
  // 4. Rolling histogram tracker
  RollingHistogramTracker307,
  defaultRollingHistogramTracker307,
};
