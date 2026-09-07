'use strict';
/**
 * lib/marketMaker305.js — ECOS V305 (Phase P193) — Prune Scheduler, Per-Adapter Suppression,
 *                          Session Snapshot, Latency Histogram
 *
 * Four additive components that deepen the V304 observability layer:
 *
 *   1. PruneScheduler305         — background setInterval scheduler that calls
 *                                  DeliveryLogFlusher304.prune304() automatically every N hours.
 *                                  Configurable via ECOS_PRUNE_INTERVAL_MS_V305 (default 24h).
 *                                  Exposes lastPruneStats305 and nextPruneAt305.
 *
 *   2. AdaptiveAlertBridge305    — extends AlertEscalationBridge304 with a per-adapter
 *                                  override map: { adapterName → suppressMs }.
 *                                  Overrides take precedence over the global suppressMs.
 *                                  Configurable at construction or via setSuppressConfig305().
 *
 *   3. SnapshotSessionBuffer305  — extends SessionListReplayBuffer304 with snapshot/restore:
 *                                  snapshotSessions305() → JSON-serialisable metadata snapshot.
 *                                  restoreSessions305(snapshot) → reloads session metadata ring.
 *
 *   4. HistogramLatencyTracker305 — extends LatencyAlertTracker304: tracks full latency histogram
 *                                   over configurable buckets [10,50,100,250,500,1000,2000] ms.
 *                                   histogram305(source) → bucket counts + overflow.
 *
 * Sacred files untouched (R1). All new identifiers end in `305` (R2).
 * Zero new npm deps (R3). V287..V304 surfaces preserved (R6).
 * lib/ mirrors src/lib/ (R5). package.json bumped to 305.0.0.
 *
 * @version 305.0.0
 */

const V304   = require('./marketMaker304.js');
const V303   = require('./marketMaker303.js');
const V302   = require('./marketMaker302.js');
const V301   = require('./marketMaker301.js');
const crypto = require('crypto');

const MM_VERSION_305                   = '305.0.0';
const DEFAULT_PRUNE_INTERVAL_MS_305    = 24 * 60 * 60 * 1000;   // 24 hours
const DEFAULT_HISTOGRAM_BUCKETS_305    = [10, 50, 100, 250, 500, 1000, 2000];
const SESSION_SNAPSHOT_VERSION_305     = '305-snapshot';

// ─────────────────────────────────────────────────────────────────────────────
// 1) PruneScheduler305
//    Background scheduler that automatically calls prune304() every N hours.
//    Tracks next-run time and last-prune stats.
// ─────────────────────────────────────────────────────────────────────────────

class PruneScheduler305 {
  /**
   * @param {{
   *   flusher?:      DeliveryLogFlusher304,
   *   intervalMs?:   number  (default: ECOS_PRUNE_INTERVAL_MS_V305 env or 86400000)
   *   ttlDays?:      number  (default: 7)
   * }} opts
   */
  constructor(opts = {}) {
    this._flusher    = opts.flusher || V304.defaultDeliveryLogFlusher304();
    this._intervalMs = opts.intervalMs !== undefined
      ? opts.intervalMs
      : parseInt(process.env.ECOS_PRUNE_INTERVAL_MS_V305 || String(DEFAULT_PRUNE_INTERVAL_MS_305), 10);
    this._ttlDays    = opts.ttlDays !== undefined ? opts.ttlDays : 7;
    this._timer      = null;
    this._nextPruneAt= null;
    this._lastStats  = null;
    this._stats      = { scheduledRuns: 0, successRuns: 0, errorRuns: 0 };
  }

  /** start305() — start the background pruning loop. Idempotent. */
  start305() {
    if (this._timer) this.stop305();

    const runPrune = async () => {
      this._stats.scheduledRuns += 1;
      const olderThan = new Date(Date.now() - this._ttlDays * 24 * 60 * 60 * 1000).toISOString();
      try {
        const result = await this._flusher.prune304(olderThan);
        this._lastStats = Object.assign({}, result, { ranAt: new Date().toISOString() });
        this._stats.successRuns += 1;
      } catch (e) {
        this._lastStats = { ok: false, error: e.message, ranAt: new Date().toISOString() };
        this._stats.errorRuns += 1;
      }
      // Update next prune time after each run
      this._nextPruneAt = new Date(Date.now() + this._intervalMs).toISOString();
    };

    this._nextPruneAt = new Date(Date.now() + this._intervalMs).toISOString();
    this._timer = setInterval(runPrune, this._intervalMs);
    // Allow process to exit even with timer active
    if (this._timer.unref) this._timer.unref();

    return { ok: true, intervalMs: this._intervalMs, nextPruneAt: this._nextPruneAt, version: MM_VERSION_305 };
  }

  /** stop305() — cancel the background pruning loop. */
  stop305() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._nextPruneAt = null;
    return { ok: true, version: MM_VERSION_305 };
  }

  /** scheduleInfo305() — returns next-prune time and last-prune stats. */
  scheduleInfo305() {
    return {
      ok:           true,
      running:      this._timer !== null,
      intervalMs:   this._intervalMs,
      ttlDays:      this._ttlDays,
      nextPruneAt:  this._nextPruneAt,
      lastPruneStats: this._lastStats,
      version:      MM_VERSION_305,
    };
  }

  stats() {
    return Object.assign({ version: MM_VERSION_305 }, this._stats, {
      running:   this._timer !== null,
      nextPruneAt: this._nextPruneAt,
    });
  }
}

let _defaultPruneScheduler305 = null;
function defaultPruneScheduler305(opts) {
  if (!_defaultPruneScheduler305 || opts) {
    _defaultPruneScheduler305 = new PruneScheduler305(opts || {});
  }
  return _defaultPruneScheduler305;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) AdaptiveAlertBridge305
//    Extends AlertEscalationBridge304 with a per-adapter suppress-window override map.
//    setSuppressConfig305({ adapterName: suppressMs }) stores overrides.
//    _effectiveSuppressMs305(key) returns the override if set, else global suppressMs.
// ─────────────────────────────────────────────────────────────────────────────

class AdaptiveAlertBridge305 extends V304.AlertEscalationBridge304 {
  /**
   * @param {{
   *   alerter?:       LiveBindHealthAlerter302,
   *   dispatcher?:    HitlWebhookDispatcher301,
   *   suppressMs?:    number (global default)
   *   overrides?:     Object.<string, number>  (per-adapter override map)
   * }} opts
   */
  constructor(opts = {}) {
    super(opts);
    // Per-adapter override: { adapterName → suppressMs }
    this._overrides305 = Object.assign({}, opts.overrides || {});
    // Suppress-stats per adapter
    this._adapterStats305 = {};
  }

  /**
   * _effectiveSuppressMs305(adapterKey) — resolve the effective suppress window.
   * The adapter key is a comma-joined sorted list. We also check individual adapter names.
   */
  _effectiveSuppressMs305(adapterKey) {
    // Exact match on composite key first
    if (this._overrides305[adapterKey] !== undefined) {
      return this._overrides305[adapterKey];
    }
    // If single adapter, check its name directly
    const parts = adapterKey.split(',');
    if (parts.length === 1 && this._overrides305[parts[0]] !== undefined) {
      return this._overrides305[parts[0]];
    }
    return this._suppressMs;
  }

  /**
   * Override _isSuppressed304 to use per-adapter window.
   */
  _isSuppressed304(key) {
    const last = this._suppressionMap.get(key);
    if (last === undefined) return false;
    const effectiveMs = this._effectiveSuppressMs305(key);
    return (Date.now() - last) < effectiveMs;
  }

  /**
   * setSuppressConfig305(map) — set/update per-adapter suppress overrides.
   * @param {Object.<string, number>} map
   */
  setSuppressConfig305(map) {
    if (typeof map !== 'object' || map === null) {
      throw new Error('setSuppressConfig305: map must be a non-null object');
    }
    Object.assign(this._overrides305, map);
    return { ok: true, overrides: Object.assign({}, this._overrides305), version: MM_VERSION_305 };
  }

  /**
   * getSuppressConfig305() — get current global + per-adapter suppress config.
   */
  getSuppressConfig305() {
    return {
      ok:         true,
      globalMs:   this._suppressMs,
      overrides:  Object.assign({}, this._overrides305),
      version:    MM_VERSION_305,
    };
  }

  /** Override stats() to include 305-specific config. */
  stats() {
    const base = super.stats();
    return Object.assign({}, base, {
      version:   MM_VERSION_305,
      globalMs:  this._suppressMs,
      overrides: Object.assign({}, this._overrides305),
    });
  }
}

let _defaultAdaptiveAlertBridge305 = null;
function defaultAdaptiveAlertBridge305(opts) {
  if (!_defaultAdaptiveAlertBridge305 || opts) {
    _defaultAdaptiveAlertBridge305 = new AdaptiveAlertBridge305(opts || {});
  }
  return _defaultAdaptiveAlertBridge305;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) SnapshotSessionBuffer305
//    Extends SessionListReplayBuffer304 with snapshot/restore of session metadata.
//    snapshotSessions305() → { version, snapshotAt, sessions: [...] }
//    restoreSessions305(snapshot) → reloads session metadata ring from snapshot.
// ─────────────────────────────────────────────────────────────────────────────

class SnapshotSessionBuffer305 extends V304.SessionListReplayBuffer304 {
  constructor(opts = {}) {
    super(opts);
  }

  /**
   * snapshotSessions305() — serialise current session metadata to a plain JSON object.
   * Safe to JSON.stringify and persist.
   * V304 stores metadata in this._sessions (array of {token,eventCount,createdAt}).
   */
  snapshotSessions305() {
    const sessions = (this._sessions || []).map(m => ({
      token:      m.token,
      eventCount: m.eventCount || 0,
      createdAt:  m.createdAt,
    }));
    return {
      ok:         true,
      version:    SESSION_SNAPSHOT_VERSION_305,
      snapshotAt: new Date().toISOString(),
      sessions,
    };
  }

  /**
   * restoreSessions305(snapshot) — reload session metadata from a snapshotSessions305() result.
   * Only metadata is restored (event buffers cannot be restored from this snapshot).
   * Existing in-memory event data is left intact; metadata ring is replaced.
   */
  restoreSessions305(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
      throw new Error('restoreSessions305: snapshot must be a non-null object');
    }
    if (snapshot.version !== SESSION_SNAPSHOT_VERSION_305) {
      throw new Error(`restoreSessions305: unsupported snapshot version "${snapshot.version}"`);
    }
    const rawSessions = Array.isArray(snapshot.sessions) ? snapshot.sessions : [];
    // Rebuild _sessions ring (up to capacity)
    const restored = rawSessions
      .slice(-V304.SESSION_LIST_CAPACITY_304)
      .map(m => ({ token: m.token, eventCount: m.eventCount || 0, createdAt: m.createdAt }));
    this._sessions = restored;
    // Also rebuild the _sessionMeta Map for record304/replay304 compatibility
    this._sessionMeta = new Map();
    for (const m of restored) {
      this._sessionMeta.set(m.token, m);
    }

    return {
      ok:          true,
      restored:    restored.length,
      snapshotAt:  snapshot.snapshotAt || null,
      version:     MM_VERSION_305,
    };
  }

  stats() {
    const base = typeof super.stats === 'function' ? super.stats() : {};
    return Object.assign({}, base, { version: MM_VERSION_305 });
  }
}

let _defaultSnapshotSessionBuffer305 = null;
function defaultSnapshotSessionBuffer305(opts) {
  if (!_defaultSnapshotSessionBuffer305 || opts) {
    _defaultSnapshotSessionBuffer305 = new SnapshotSessionBuffer305(opts || {});
  }
  return _defaultSnapshotSessionBuffer305;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) HistogramLatencyTracker305
//    Extends LatencyAlertTracker304 with a full bucket histogram per source.
//    histogram305(source) → { buckets: [{le, count}], overflow, count, version }
// ─────────────────────────────────────────────────────────────────────────────

class HistogramLatencyTracker305 extends V304.LatencyAlertTracker304 {
  /**
   * @param {{
   *   router?:      ReceiptSourceRouter302,
   *   alerter?:     LiveBindHealthAlerter302,
   *   thresholdMs?: number,
   *   buckets?:     number[]  (sorted ascending, default DEFAULT_HISTOGRAM_BUCKETS_305)
   * }} opts
   */
  constructor(opts = {}) {
    super(opts);
    this._buckets305 = (opts.buckets || DEFAULT_HISTOGRAM_BUCKETS_305).slice().sort((a, b) => a - b);
    // Per-source histogram storage: { sourceName: { bucketCounts: [...], overflow: 0, count: 0 } }
    this._histograms305 = {};
  }

  /** _initHistogram305(source) — initialise histogram storage for a source. */
  _initHistogram305(source) {
    if (!this._histograms305[source]) {
      this._histograms305[source] = {
        bucketCounts: new Array(this._buckets305.length).fill(0),
        overflow:     0,
        count:        0,
      };
    }
  }

  /** _recordHistogram305(source, ms) — increment the appropriate bucket. */
  _recordHistogram305(source, ms) {
    this._initHistogram305(source);
    const h = this._histograms305[source];
    h.count += 1;
    for (let i = 0; i < this._buckets305.length; i++) {
      if (ms <= this._buckets305[i]) {
        h.bucketCounts[i] += 1;
        return;
      }
    }
    // ms exceeds all defined buckets
    h.overflow += 1;
  }

  /**
   * histogram305(source) — return histogram data for a given source.
   * @param {string} [source='auto']
   */
  histogram305(source = 'auto') {
    this._initHistogram305(source);
    const h = this._histograms305[source];
    return {
      ok:       true,
      source,
      buckets:  this._buckets305.map((le, i) => ({ le, count: h.bucketCounts[i] })),
      overflow: h.overflow,
      count:    h.count,
      version:  MM_VERSION_305,
    };
  }

  /**
   * allHistograms305() — return histograms for all tracked sources.
   */
  allHistograms305() {
    const result = { ok: true, sources: {}, version: MM_VERSION_305 };
    for (const source of Object.keys(this._histograms305)) {
      result.sources[source] = this.histogram305(source);
    }
    return result;
  }

  /**
   * Override query304 to also record histogram data after each call.
   */
  async query304(opts = {}) {
    const source = opts.source || 'auto';
    const t0 = Date.now();
    let result;
    try {
      result = await super.query304(opts);
    } catch (e) {
      this._recordHistogram305(source, Date.now() - t0);
      throw e;
    }
    // latencyMs is attached by the parent query304
    this._recordHistogram305(source, result.latencyMs !== undefined ? result.latencyMs : (Date.now() - t0));
    return result;
  }

  stats() {
    const base = super.stats();
    return Object.assign({}, base, {
      version:    MM_VERSION_305,
      buckets:    this._buckets305,
      histograms: this.allHistograms305(),
    });
  }
}

let _defaultHistogramLatencyTracker305 = null;
function defaultHistogramLatencyTracker305(opts) {
  if (!_defaultHistogramLatencyTracker305 || opts) {
    _defaultHistogramLatencyTracker305 = new HistogramLatencyTracker305(opts || {});
  }
  return _defaultHistogramLatencyTracker305;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  MM_VERSION_305,
  DEFAULT_PRUNE_INTERVAL_MS_305,
  DEFAULT_HISTOGRAM_BUCKETS_305,
  SESSION_SNAPSHOT_VERSION_305,
  // 1. Prune scheduler
  PruneScheduler305,
  defaultPruneScheduler305,
  // 2. Adaptive (per-adapter) alert bridge
  AdaptiveAlertBridge305,
  defaultAdaptiveAlertBridge305,
  // 3. Session snapshot buffer
  SnapshotSessionBuffer305,
  defaultSnapshotSessionBuffer305,
  // 4. Histogram latency tracker
  HistogramLatencyTracker305,
  defaultHistogramLatencyTracker305,
};
