'use strict';
/**
 * lib/marketMaker304.js — ECOS V304 (Phase P192) — Retention Policy, Alert Suppression,
 *                          Session Listing & Latency Alerting
 *
 * Four additive components that deepen the V303 observability layer:
 *
 *   1. AlertEscalationBridge304  — extends AlertEscalationBridge303 with a configurable
 *                                  suppression window (ECOS_ALERT_SUPPRESS_MS_V304, default 5 min)
 *                                  so the same adapter only triggers one webhook per window.
 *                                  De-duplicates by adapter name; state resets after window expires.
 *
 *   2. DeliveryLogFlusher304     — extends DeliveryLogFlusher303 with a configurable TTL:
 *                                  on flush, prune rows older than `olderThan` from
 *                                  `ecos_webhook_deliveries` via DELETE WHERE flushed_at < NOW()-INTERVAL.
 *                                  Expose prune304(olderThan) independently.
 *
 *   3. SessionListReplayBuffer304 — extends PaginatedReplayBuffer303 to track session metadata
 *                                   (token, eventCount, createdAt) in a bounded ring.
 *                                   Expose listSessions304() for GET /backtest/sessions/v304.
 *
 *   4. LatencyAlertTracker304    — extends ReceiptLatencyTracker303: after each query, checks
 *                                  p95 against a configurable threshold (ECOS_RECEIPT_LATENCY_ALERT_MS_V304,
 *                                  default 500ms) and emits a structured warning via
 *                                  LiveBindHealthAlerter302 when the threshold is breached.
 *
 * Sacred files untouched (R1). All new identifiers end in `304` (R2).
 * Zero new npm deps (R3). V287..V303 surfaces preserved (R6).
 * lib/ mirrors src/lib/ (R5). package.json bumped to 304.0.0.
 *
 * @version 304.0.0
 */

const V303 = require('./marketMaker303.js');
const V302 = require('./marketMaker302.js');
const V301 = require('./marketMaker301.js');
const crypto = require('crypto');

const MM_VERSION_304                    = '304.0.0';
const DEFAULT_SUPPRESS_MS_304           = 5 * 60 * 1000; // 5 minutes
const DEFAULT_LATENCY_ALERT_MS_304      = 500;            // 500ms p95 threshold
const FLUSH_TABLE_304                   = 'ecos_webhook_deliveries'; // same table as V303
const SESSION_LIST_CAPACITY_304         = 1000;           // max tracked sessions in ring

// ─────────────────────────────────────────────────────────────────────────────
// 1) AlertEscalationBridge304
//    Extends AlertEscalationBridge303 with a configurable suppression window.
//    The same adapter name triggers at most one webhook per window duration.
// ─────────────────────────────────────────────────────────────────────────────

class AlertEscalationBridge304 {
  /**
   * @param {{
   *   alerter?:      LiveBindHealthAlerter302,
   *   dispatcher?:   HitlWebhookDispatcher301,
   *   suppressMs?:   number  (default: ECOS_ALERT_SUPPRESS_MS_V304 env or 300000)
   * }} opts
   */
  constructor(opts = {}) {
    this._alerter    = opts.alerter    || V302.defaultLiveBindHealthAlerter302();
    this._dispatcher = opts.dispatcher || V301.defaultHitlWebhookDispatcher301();
    this._suppressMs = opts.suppressMs !== undefined
      ? opts.suppressMs
      : parseInt(process.env.ECOS_ALERT_SUPPRESS_MS_V304 || String(DEFAULT_SUPPRESS_MS_304), 10);
    this._subId      = null;
    // Map of adapterKey → lastDispatchedAt (ms timestamp)
    this._suppressionMap = new Map();
    this._stats = { escalated: 0, suppressed: 0, skipped: 0, dispatchErrors: 0 };
  }

  /**
   * _adapterKey304(alert) — derive a stable suppression key from adapter names.
   * Uses the sorted adapter names joined, or 'unknown' if none.
   */
  _adapterKey304(alert) {
    const adapters = (alert.adapters || []).map(a => a.name || 'unknown').sort();
    return adapters.join(',') || 'unknown';
  }

  /**
   * _isSuppressed304(key) — true if the key was dispatched within the suppress window.
   */
  _isSuppressed304(key) {
    const last = this._suppressionMap.get(key);
    if (last === undefined) return false;
    return (Date.now() - last) < this._suppressMs;
  }

  /**
   * start304() — subscribe to the alerter; auto-escalate error alerts with suppression.
   * Idempotent: calling twice replaces the old subscription.
   */
  start304() {
    if (this._subId) {
      try { this._alerter.unsubscribe302(this._subId); } catch (_) {}
    }

    const { id } = this._alerter.subscribe302(alert => {
      if (alert.level !== 'error') {
        this._stats.skipped += 1;
        return;
      }
      const key = this._adapterKey304(alert);
      if (this._isSuppressed304(key)) {
        this._stats.suppressed += 1;
        return;
      }
      // Record dispatch time BEFORE calling dispatch (optimistic suppress to avoid double-fire)
      this._suppressionMap.set(key, Date.now());
      this._stats.escalated += 1;

      const ticket = {
        id:          'esc304-' + crypto.randomBytes(4).toString('hex'),
        at:          alert.at,
        type:        'alert_escalation304',
        level:       alert.level,
        alertId:     alert.id,
        adapters:    alert.adapters,
        liveEnabled: alert.liveEnabled,
        suppressKey: key,
        version:     MM_VERSION_304,
      };
      try {
        this._dispatcher.dispatch301(ticket);
      } catch (e) {
        this._stats.dispatchErrors += 1;
      }
    });

    this._subId = id;
    return { ok: true, subId: id, suppressMs: this._suppressMs, version: MM_VERSION_304 };
  }

  /** stop304() — unsubscribe from the alerter. */
  stop304() {
    if (!this._subId) return { ok: false, reason: 'not started', version: MM_VERSION_304 };
    const r = this._alerter.unsubscribe302(this._subId);
    this._subId = null;
    return Object.assign({}, r, { version: MM_VERSION_304 });
  }

  /** clearSuppression304() — reset the suppression map (useful in tests / manual reset). */
  clearSuppression304() {
    const cleared = this._suppressionMap.size;
    this._suppressionMap.clear();
    return { ok: true, cleared, version: MM_VERSION_304 };
  }

  stats() {
    return Object.assign(
      { version: MM_VERSION_304, active: !!this._subId, suppressMs: this._suppressMs },
      this._stats,
      { suppressionMapSize: this._suppressionMap.size }
    );
  }
}

let _defaultEscalationBridge304 = null;
function defaultAlertEscalationBridge304(opts) {
  if (!_defaultEscalationBridge304 || opts) {
    _defaultEscalationBridge304 = new AlertEscalationBridge304(opts || {});
  }
  return _defaultEscalationBridge304;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) DeliveryLogFlusher304
//    Extends DeliveryLogFlusher303 with TTL-based row pruning from the DB table.
//    prune304(olderThan) — DELETE rows where flushed_at < olderThan ISO string.
//    flushToDb304() — flush + optional auto-prune if DEFAULT_TTL_DAYS_304 is set.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_TTL_DAYS_304 = 7; // default retention in days (used when autoPrune is enabled)

class DeliveryLogFlusher304 {
  /**
   * @param {{
   *   deliveryLog?: WebhookDeliveryLog302,
   *   db?:          object,
   *   autoMigrate?: boolean,
   *   autoPrune?:   boolean,   (default false — explicit prune required unless true)
   *   ttlDays?:     number     (default 7)
   * }} opts
   */
  constructor(opts = {}) {
    this._log         = opts.deliveryLog || V302.defaultWebhookDeliveryLog302();
    this._db          = opts.db || null;
    this._autoMigrate = opts.autoMigrate !== false;
    this._autoPrune   = opts.autoPrune || false;
    this._ttlDays     = opts.ttlDays !== undefined ? opts.ttlDays : DEFAULT_TTL_DAYS_304;
    this._migrated    = false;
    this._stats       = { flushCalls: 0, rowsFlushed: 0, listDbCalls: 0, pruneCalls: 0, rowsPruned: 0, errors: 0 };
  }

  setDb304(db) { this._db = db; }

  async _ensureMigrated304() {
    if (this._migrated || !this._autoMigrate || !this._db) return;
    try {
      await this._db.query(`
        CREATE TABLE IF NOT EXISTS ${FLUSH_TABLE_304} (
          id           TEXT PRIMARY KEY,
          webhook_id   TEXT,
          url          TEXT,
          at           TIMESTAMPTZ,
          status       TEXT,
          attempt      INTEGER,
          ticket_id    TEXT,
          error        TEXT,
          version      TEXT,
          flushed_at   TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      this._migrated = true;
    } catch (_) {
      // non-fatal
    }
  }

  /**
   * flushToDb304() — drain ring to DB, then auto-prune if configured.
   */
  async flushToDb304() {
    this._stats.flushCalls += 1;
    if (!this._db) {
      return { ok: false, reason: 'no_db', flushed: 0, version: MM_VERSION_304 };
    }
    await this._ensureMigrated304();

    const entries = this._log.query302({ limit: 200 }).items;
    let flushed = 0;
    let skipped = 0;
    for (const e of entries) {
      try {
        await this._db.query(
          `INSERT INTO ${FLUSH_TABLE_304}
             (id, webhook_id, url, at, status, attempt, ticket_id, error, version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (id) DO NOTHING`,
          [e.id, e.webhookId || null, e.url || null,
           e.at, e.status || null, e.attempt || null,
           e.ticketId || null, e.error || null, e.version || MM_VERSION_304]
        );
        flushed += 1;
      } catch (_) {
        skipped += 1;
      }
    }
    this._stats.rowsFlushed += flushed;

    let pruneResult = null;
    if (this._autoPrune) {
      const cutoff = new Date(Date.now() - this._ttlDays * 24 * 60 * 60 * 1000).toISOString();
      pruneResult = await this.prune304(cutoff);
    }

    return { ok: true, flushed, skipped, pruneResult, version: MM_VERSION_304 };
  }

  /**
   * prune304(olderThan) — DELETE rows where flushed_at < olderThan (ISO string).
   * Returns { ok, pruned, olderThan, version }.
   */
  async prune304(olderThan) {
    this._stats.pruneCalls += 1;
    if (!this._db) {
      return { ok: false, reason: 'no_db', pruned: 0, version: MM_VERSION_304 };
    }
    await this._ensureMigrated304();

    if (!olderThan) {
      return { ok: false, reason: 'missing_olderThan', pruned: 0, version: MM_VERSION_304 };
    }

    try {
      const result = await this._db.query(
        `DELETE FROM ${FLUSH_TABLE_304} WHERE flushed_at < $1`,
        [olderThan]
      );
      const pruned = (result.rowCount !== undefined) ? result.rowCount : 0;
      this._stats.rowsPruned += pruned;
      return { ok: true, pruned, olderThan, version: MM_VERSION_304 };
    } catch (e) {
      this._stats.errors += 1;
      return { ok: false, reason: e.message, pruned: 0, version: MM_VERSION_304 };
    }
  }

  /**
   * listFromDb304(opts) — query the DB table.
   */
  async listFromDb304(opts = {}) {
    this._stats.listDbCalls += 1;
    if (!this._db) throw Object.assign(new Error('DB not available'), { code: 'NO_DB_304', statusCode: 503 });
    await this._ensureMigrated304();

    const conditions = [];
    const params = [];
    if (opts.webhookId) { params.push(opts.webhookId); conditions.push(`webhook_id = $${params.length}`); }
    if (opts.status)    { params.push(opts.status);    conditions.push(`status = $${params.length}`); }

    const where  = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const limit  = Math.min(opts.limit  || 50, 500);
    const offset = opts.offset || 0;
    params.push(limit, offset);

    const rows = await this._db.query(
      `SELECT * FROM ${FLUSH_TABLE_304} ${where} ORDER BY at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { ok: true, items: rows.rows || rows, version: MM_VERSION_304 };
  }

  stats() {
    return Object.assign(
      { version: MM_VERSION_304, dbAvailable: !!this._db, autoPrune: this._autoPrune, ttlDays: this._ttlDays },
      this._stats
    );
  }
}

let _defaultDeliveryLogFlusher304 = null;
function defaultDeliveryLogFlusher304(opts) {
  if (!_defaultDeliveryLogFlusher304 || opts) {
    _defaultDeliveryLogFlusher304 = new DeliveryLogFlusher304(opts || {});
  }
  return _defaultDeliveryLogFlusher304;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) SessionListReplayBuffer304
//    Extends PaginatedReplayBuffer303: tracks session metadata (token, eventCount,
//    createdAt) in a bounded ring. Exposes listSessions304() for
//    GET /api/v1/market/backtest/sessions/v304.
// ─────────────────────────────────────────────────────────────────────────────

class SessionListReplayBuffer304 {
  /**
   * @param {{
   *   resumeBuffer?:   BacktestResumeBuffer302,
   *   sessionCapacity?: number (default SESSION_LIST_CAPACITY_304 = 1000)
   * }} opts
   */
  constructor(opts = {}) {
    this._buf      = opts.resumeBuffer || V302.defaultBacktestResumeBuffer302();
    this._capacity = opts.sessionCapacity !== undefined ? opts.sessionCapacity : SESSION_LIST_CAPACITY_304;
    // Ring of { token, eventCount, createdAt }
    this._sessions = [];
    this._sessionMeta = new Map(); // token → { eventCount, createdAt }
    this._stats = { replayCalls: 0, eventsSent: 0, sessionsCreated: 0 };
  }

  /**
   * createSession304() — create a new session and record metadata.
   */
  createSession304() {
    const r = this._buf.createSession302();
    const meta = { token: r.token, eventCount: 0, createdAt: new Date().toISOString() };
    // Ring eviction
    if (this._sessions.length >= this._capacity) {
      const evicted = this._sessions.shift();
      if (evicted) this._sessionMeta.delete(evicted.token);
    }
    this._sessions.push(meta);
    this._sessionMeta.set(r.token, meta);
    this._stats.sessionsCreated += 1;
    return r;
  }

  /**
   * record304(token, event) — record an event and increment session eventCount.
   */
  record304(token, event) {
    const r = this._buf.record302(token, event);
    const meta = this._sessionMeta.get(token);
    if (meta) meta.eventCount += 1;
    return r;
  }

  /**
   * evictSession304(token) — evict a session from both buffer and metadata ring.
   */
  evictSession304(token) {
    const r = this._buf.evictSession302(token);
    this._sessionMeta.delete(token);
    const idx = this._sessions.findIndex(s => s.token === token);
    if (idx !== -1) this._sessions.splice(idx, 1);
    return r;
  }

  /**
   * replay304(token, opts) — paginated replay (delegates to V303 pattern).
   * opts: { after?: number, limit?: number }
   */
  replay304(token, opts = {}) {
    this._stats.replayCalls += 1;
    const afterIndex = (opts.after !== undefined) ? Number(opts.after) : -1;
    const limit      = Math.min(Number(opts.limit) || 50, 200);

    const base     = this._buf.replay302(token, afterIndex);
    const allEvents = base.events || [];
    const page      = allEvents.slice(0, limit);
    const hasMore   = allEvents.length > limit;
    const lastReturnedOffset = afterIndex < 0 ? page.length - 1 : afterIndex + page.length;
    const nextCursor = hasMore ? lastReturnedOffset : null;

    this._stats.eventsSent += page.length;

    return {
      ok:             true,
      token:          token,
      events:         page,
      nextCursor:     nextCursor,
      hasMore:        hasMore,
      totalInSession: allEvents.length,
      version:        MM_VERSION_304,
    };
  }

  /**
   * listSessions304() — return current session metadata ring.
   * Returns { ok, sessions: [{ token, eventCount, createdAt }], version }
   */
  listSessions304() {
    return {
      ok:       true,
      sessions: this._sessions.slice().reverse(), // most-recent-first
      version:  MM_VERSION_304,
    };
  }

  stats() {
    return Object.assign({ version: MM_VERSION_304, sessionCount: this._sessions.length }, this._stats);
  }
}

let _defaultSessionListBuffer304 = null;
function defaultSessionListReplayBuffer304(opts) {
  if (!_defaultSessionListBuffer304 || opts) {
    _defaultSessionListBuffer304 = new SessionListReplayBuffer304(opts || {});
  }
  return _defaultSessionListBuffer304;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) LatencyAlertTracker304
//    Extends ReceiptLatencyTracker303: after each query, if p95 > threshold
//    (ECOS_RECEIPT_LATENCY_ALERT_MS_V304 or 500ms), emits a structured warning
//    via LiveBindHealthAlerter302 so it appears in the SSE alert stream.
// ─────────────────────────────────────────────────────────────────────────────

class LatencyAlertTracker304 {
  /**
   * @param {{
   *   router?:        ReceiptSourceRouter302,
   *   alerter?:       LiveBindHealthAlerter302,
   *   thresholdMs?:   number  (default: ECOS_RECEIPT_LATENCY_ALERT_MS_V304 env or 500)
   * }} opts
   */
  constructor(opts = {}) {
    this._router      = opts.router  || V302.defaultReceiptSourceRouter302();
    this._alerter     = opts.alerter || V302.defaultLiveBindHealthAlerter302();
    this._thresholdMs = opts.thresholdMs !== undefined
      ? opts.thresholdMs
      : parseInt(process.env.ECOS_RECEIPT_LATENCY_ALERT_MS_V304 || String(DEFAULT_LATENCY_ALERT_MS_304), 10);

    // Per-source rolling window (last 1000)
    this._windows = { db: [], ring: [], auto: [] };
    this._stats   = { queryCalls: 0, errors: 0, alertsFired: 0 };
  }

  _recordLatency304(source, ms) {
    const win = this._windows[source] || (this._windows[source] = []);
    if (win.length >= 1000) win.shift();
    win.push(ms);
  }

  _percentile304(sorted, p) {
    if (!sorted.length) return 0;
    const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[idx];
  }

  _p95For304(source) {
    const win = this._windows[source];
    if (!win || !win.length) return null;
    const sorted = [...win].sort((a, b) => a - b);
    return this._percentile304(sorted, 95);
  }

  /**
   * _checkAndAlert304(source) — fires a structured warning alert if p95 > threshold.
   */
  _checkAndAlert304(source) {
    const p95 = this._p95For304(source);
    if (p95 === null) return;
    if (p95 <= this._thresholdMs) return;

    this._stats.alertsFired += 1;
    // Build an alert object compatible with LiveBindHealthAlerter302 push
    const alert = {
      id:           'lat304-' + crypto.randomBytes(4).toString('hex'),
      at:           new Date().toISOString(),
      level:        'warn',
      type:         'latency_alert304',
      source:       source,
      p95Ms:        p95,
      thresholdMs:  this._thresholdMs,
      version:      MM_VERSION_304,
    };

    // Emit via the alerter's subscriber ring if it supports direct push
    // (call _notify indirectly by checking for pushAlert304 method or using subscribers)
    try {
      if (typeof this._alerter.pushAlert304 === 'function') {
        this._alerter.pushAlert304(alert);
      } else if (this._alerter._subscribers) {
        // Direct push to subscribers (compatible with LiveBindHealthAlerter302 internals)
        this._alerter._subscribers.forEach(h => { try { h(alert); } catch (_) {} });
      }
    } catch (_) {
      // Non-fatal
    }
  }

  /**
   * query304(opts) — timed call to ReceiptSourceRouter302.query302(), records latency,
   * checks threshold after each call and emits alert if p95 exceeded.
   */
  async query304(opts = {}) {
    this._stats.queryCalls += 1;
    const source = opts.source || 'auto';
    const t0 = Date.now();
    let result;
    try {
      result = await this._router.query302(opts);
    } catch (e) {
      this._stats.errors += 1;
      this._recordLatency304(source, Date.now() - t0);
      this._checkAndAlert304(source);
      throw e;
    }
    const latencyMs = Date.now() - t0;
    this._recordLatency304(source, latencyMs);
    this._checkAndAlert304(source);
    return Object.assign({}, result, { latencyMs, version: MM_VERSION_304 });
  }

  /**
   * latencyStats304() — per-source p50 and p95 latency stats.
   */
  latencyStats304() {
    const result = { version: MM_VERSION_304, sources: {} };
    for (const [src, win] of Object.entries(this._windows)) {
      if (!win.length) {
        result.sources[src] = { p50: null, p95: null, count: 0 };
        continue;
      }
      const sorted = [...win].sort((a, b) => a - b);
      result.sources[src] = {
        p50:   this._percentile304(sorted, 50),
        p95:   this._percentile304(sorted, 95),
        count: sorted.length,
      };
    }
    return result;
  }

  stats() {
    return Object.assign(
      { version: MM_VERSION_304, thresholdMs: this._thresholdMs },
      this._stats,
      this.latencyStats304()
    );
  }
}

let _defaultLatencyAlertTracker304 = null;
function defaultLatencyAlertTracker304(opts) {
  if (!_defaultLatencyAlertTracker304 || opts) {
    _defaultLatencyAlertTracker304 = new LatencyAlertTracker304(opts || {});
  }
  return _defaultLatencyAlertTracker304;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  MM_VERSION_304,
  DEFAULT_SUPPRESS_MS_304,
  DEFAULT_LATENCY_ALERT_MS_304,
  SESSION_LIST_CAPACITY_304,
  FLUSH_TABLE_304,
  DEFAULT_TTL_DAYS_304,
  // 1. Alert escalation bridge with suppression
  AlertEscalationBridge304,
  defaultAlertEscalationBridge304,
  // 2. Delivery log flusher with TTL pruning
  DeliveryLogFlusher304,
  defaultDeliveryLogFlusher304,
  // 3. Session list replay buffer
  SessionListReplayBuffer304,
  defaultSessionListReplayBuffer304,
  // 4. Latency alert tracker
  LatencyAlertTracker304,
  defaultLatencyAlertTracker304,
};
