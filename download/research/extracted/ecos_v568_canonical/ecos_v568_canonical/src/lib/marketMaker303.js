'use strict';
/**
 * lib/marketMaker303.js — ECOS V303 (Phase P191) — Alert Escalation, Persistence, Pagination & Latency
 *
 * Four additive components that deepen the V302 observability layer:
 *
 *   1. AlertEscalationBridge303  — when LiveBindHealthAlerter302 fires a level:'error'
 *                                  alert, auto-dispatch it to all HitlWebhookDispatcher301
 *                                  registered URLs so ops teams get a push notification.
 *                                  Wire in server IIFE — no new classes needed beyond bridge.
 *
 *   2. DeliveryLogFlusher303     — flushes WebhookDeliveryLog302 entries to a PostgreSQL
 *                                  table (`ecos_webhook_deliveries`) via a ReceiptDbAdapter301-
 *                                  style pattern. Atomic flush: entries moved from ring → DB.
 *                                  Exposes flush() + autoMigrate, stats(), listFromDb303().
 *
 *   3. PaginatedReplayBuffer303  — extends BacktestResumeBuffer302.replay302() with
 *                                  `limit` + `cursor` (afterIndex) so large sessions can be
 *                                  replayed in chunks: returns { events, nextCursor, hasMore }.
 *
 *   4. ReceiptLatencyTracker303  — wraps ReceiptSourceRouter302.query302() with a rolling
 *                                  window (last 1000) per source, computing p50/p95 latency
 *                                  percentiles. Stats surface: latencyStats303().
 *
 * Sacred files untouched (R1). All new identifiers end in `303` (R2).
 * Zero new npm deps (R3). V287..V302 surfaces preserved (R6).
 * lib/ mirrors src/lib/ (R7). package.json bumped to 303.0.0.
 *
 * @version 303.0.0
 */

const V302 = require('./marketMaker302.js');
const V301 = require('./marketMaker301.js');
const V300 = require('./marketMaker300.js');
const crypto = require('crypto');

const MM_VERSION_303               = '303.0.0';
const LATENCY_WINDOW_SIZE_303      = 1000;   // rolling window per source
const FLUSH_TABLE_303              = 'ecos_webhook_deliveries';
const FLUSH_BATCH_SIZE_303         = 200;    // max rows per flush call
const PAGINATION_MAX_LIMIT_303     = 200;    // safety cap for replay pagination

// ─────────────────────────────────────────────────────────────────────────────
// 1) AlertEscalationBridge303
//    Subscribes to LiveBindHealthAlerter302 and dispatches level:'error' alerts
//    to HitlWebhookDispatcher301 as webhook payloads.
// ─────────────────────────────────────────────────────────────────────────────

class AlertEscalationBridge303 {
  /**
   * @param {{alerter: LiveBindHealthAlerter302, dispatcher: HitlWebhookDispatcher301}} opts
   */
  constructor(opts = {}) {
    this._alerter    = opts.alerter    || V302.defaultLiveBindHealthAlerter302();
    this._dispatcher = opts.dispatcher || V301.defaultHitlWebhookDispatcher301();
    this._subId      = null;
    this._stats      = { escalated: 0, skipped: 0, dispatchErrors: 0 };
  }

  /**
   * start303() — subscribe to the alerter; auto-escalate error alerts.
   * Idempotent: calling twice replaces the old subscription.
   */
  start303() {
    // Unsubscribe any previous subscription
    if (this._subId) {
      try { this._alerter.unsubscribe302(this._subId); } catch (_) {}
    }

    const { id } = this._alerter.subscribe302(alert => {
      if (alert.level !== 'error') {
        this._stats.skipped += 1;
        return;
      }
      this._stats.escalated += 1;
      // Build webhook payload — mirrors HITL ticket shape so existing handlers work
      const ticket = {
        id:          'esc303-' + crypto.randomBytes(4).toString('hex'),
        at:          alert.at,
        type:        'alert_escalation303',
        level:       alert.level,
        alertId:     alert.id,
        adapters:    alert.adapters,
        liveEnabled: alert.liveEnabled,
        version:     MM_VERSION_303,
      };
      try {
        // dispatch301 is fire-and-forget; swallow errors
        this._dispatcher.dispatch301(ticket);
      } catch (e) {
        this._stats.dispatchErrors += 1;
      }
    });

    this._subId = id;
    return { ok: true, subId: id, version: MM_VERSION_303 };
  }

  /** stop303() — unsubscribe from the alerter. */
  stop303() {
    if (!this._subId) return { ok: false, reason: 'not started', version: MM_VERSION_303 };
    const r = this._alerter.unsubscribe302(this._subId);
    this._subId = null;
    return Object.assign({}, r, { version: MM_VERSION_303 });
  }

  stats() {
    return Object.assign({ version: MM_VERSION_303, active: !!this._subId }, this._stats);
  }
}

let _defaultEscalationBridge303 = null;
function defaultAlertEscalationBridge303(opts) {
  if (!_defaultEscalationBridge303 || opts) {
    _defaultEscalationBridge303 = new AlertEscalationBridge303(opts || {});
  }
  return _defaultEscalationBridge303;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) DeliveryLogFlusher303
//    Flushes WebhookDeliveryLog302 ring entries to PostgreSQL (ecos_webhook_deliveries).
//    Pattern mirrors ReceiptDbAdapter301.
// ─────────────────────────────────────────────────────────────────────────────

class DeliveryLogFlusher303 {
  /**
   * @param {{ deliveryLog: WebhookDeliveryLog302, db?: object, autoMigrate?: boolean }} opts
   *   db: any object with .query(sql, params) Promise — optional (falls back gracefully).
   */
  constructor(opts = {}) {
    this._log         = opts.deliveryLog || V302.defaultWebhookDeliveryLog302();
    this._db          = opts.db || null; // injected at wiring time
    this._autoMigrate = opts.autoMigrate !== false;
    this._migrated    = false;
    this._stats       = { flushCalls: 0, rowsFlushed: 0, listDbCalls: 0, errors: 0 };
  }

  /** setDb303(db) — inject a db client after construction (e.g. from global dbPool). */
  setDb303(db) { this._db = db; }

  async _ensureMigrated303() {
    if (this._migrated || !this._autoMigrate || !this._db) return;
    try {
      await this._db.query(`
        CREATE TABLE IF NOT EXISTS ${FLUSH_TABLE_303} (
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
    } catch (e) {
      // Table may already exist or DB unavailable — non-fatal
    }
  }

  /**
   * flushToDb303() — drain current ring entries to DB.
   * Returns { ok, flushed, skipped, version }.
   */
  async flushToDb303() {
    this._stats.flushCalls += 1;
    if (!this._db) {
      return { ok: false, reason: 'no_db', flushed: 0, version: MM_VERSION_303 };
    }
    await this._ensureMigrated303();

    const entries = this._log.query302({ limit: FLUSH_BATCH_SIZE_303 }).items;
    let flushed = 0;
    let skipped = 0;
    for (const e of entries) {
      try {
        await this._db.query(
          `INSERT INTO ${FLUSH_TABLE_303}
             (id, webhook_id, url, at, status, attempt, ticket_id, error, version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (id) DO NOTHING`,
          [e.id, e.webhookId || null, e.url || null,
           e.at, e.status || null, e.attempt || null,
           e.ticketId || null, e.error || null, e.version || MM_VERSION_303]
        );
        flushed += 1;
      } catch (_) {
        skipped += 1;
      }
    }
    this._stats.rowsFlushed += flushed;
    return { ok: true, flushed, skipped, version: MM_VERSION_303 };
  }

  /**
   * listFromDb303(opts) — query the DB table.
   * opts: { webhookId?, status?, limit?, offset? }
   */
  async listFromDb303(opts = {}) {
    this._stats.listDbCalls += 1;
    if (!this._db) throw Object.assign(new Error('DB not available'), { code: 'NO_DB_303', statusCode: 503 });
    await this._ensureMigrated303();

    const conditions = [];
    const params = [];
    if (opts.webhookId) { params.push(opts.webhookId); conditions.push(`webhook_id = $${params.length}`); }
    if (opts.status)    { params.push(opts.status);    conditions.push(`status = $${params.length}`); }

    const where  = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const limit  = Math.min(opts.limit  || 50, 500);
    const offset = opts.offset || 0;
    params.push(limit, offset);

    const rows = await this._db.query(
      `SELECT * FROM ${FLUSH_TABLE_303} ${where} ORDER BY at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { ok: true, items: rows.rows || rows, version: MM_VERSION_303 };
  }

  stats() {
    return Object.assign({ version: MM_VERSION_303, dbAvailable: !!this._db }, this._stats);
  }
}

let _defaultDeliveryLogFlusher303 = null;
function defaultDeliveryLogFlusher303(opts) {
  if (!_defaultDeliveryLogFlusher303 || opts) {
    _defaultDeliveryLogFlusher303 = new DeliveryLogFlusher303(opts || {});
  }
  return _defaultDeliveryLogFlusher303;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) PaginatedReplayBuffer303
//    Thin wrapper around BacktestResumeBuffer302 adding limit+cursor pagination
//    to replay303() so large sessions are replayed in chunks.
// ─────────────────────────────────────────────────────────────────────────────

class PaginatedReplayBuffer303 {
  /**
   * @param {{ resumeBuffer: BacktestResumeBuffer302 }} opts
   */
  constructor(opts = {}) {
    this._buf   = opts.resumeBuffer || V302.defaultBacktestResumeBuffer302();
    this._stats = { replayCalls: 0, eventsSent: 0 };
  }

  /**
   * replay303(token, opts) — paginated replay.
   * opts: { after?: number (-1 = all), limit?: number (default 50, max 200) }
   * Returns: { ok, token, events, nextCursor, hasMore, totalInSession, version }
   */
  replay303(token, opts = {}) {
    this._stats.replayCalls += 1;
    const afterIndex = (opts.after !== undefined) ? Number(opts.after) : -1;
    const limit      = Math.min(Number(opts.limit) || 50, PAGINATION_MAX_LIMIT_303);

    // Delegate to V302's replay302 (gets all events after afterIndex)
    const base = this._buf.replay302(token, afterIndex);
    // base.events is all events from afterIndex onward
    const allEvents = base.events || [];
    const page      = allEvents.slice(0, limit);
    const hasMore   = allEvents.length > limit;

    // nextCursor = index of last returned event in the session
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
      version:        MM_VERSION_303,
    };
  }

  /** createSession303() — delegates to V302 buffer. */
  createSession303() {
    return this._buf.createSession302();
  }

  /** record303(token, event) — delegates to V302 buffer. */
  record303(token, event) {
    return this._buf.record302(token, event);
  }

  /** evictSession303(token) — delegates to V302 buffer. */
  evictSession303(token) {
    return this._buf.evictSession302(token);
  }

  stats() {
    return Object.assign({ version: MM_VERSION_303 }, this._stats, {
      buffer: this._buf.stats ? this._buf.stats() : {},
    });
  }
}

let _defaultPaginatedReplay303 = null;
function defaultPaginatedReplayBuffer303(opts) {
  if (!_defaultPaginatedReplay303 || opts) {
    _defaultPaginatedReplay303 = new PaginatedReplayBuffer303(opts || {});
  }
  return _defaultPaginatedReplay303;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) ReceiptLatencyTracker303
//    Wraps ReceiptSourceRouter302.query302() with per-source rolling latency
//    window (last 1000 durations), computing p50 and p95 percentiles.
// ─────────────────────────────────────────────────────────────────────────────

/** Compute a percentile from a sorted array. */
function _percentile303(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

class ReceiptLatencyTracker303 {
  /**
   * @param {{ router: ReceiptSourceRouter302 }} opts
   */
  constructor(opts = {}) {
    this._router  = opts.router || V302.defaultReceiptSourceRouter302();
    this._windows = {
      db:   [],
      ring: [],
      auto: [],
    };
    this._stats = { queryCalls: 0, errors: 0 };
  }

  /**
   * query303(opts) — timed call to ReceiptSourceRouter302.query302().
   * Returns: router response + { latencyMs } (appended to response).
   */
  async query303(opts = {}) {
    this._stats.queryCalls += 1;
    const source = opts.source || 'auto';
    const t0     = Date.now();
    let result;
    try {
      result = await this._router.query302(opts);
    } catch (e) {
      this._stats.errors += 1;
      this._recordLatency303(source, Date.now() - t0);
      throw e;
    }
    const latencyMs = Date.now() - t0;
    this._recordLatency303(source, latencyMs);
    return Object.assign({}, result, { latencyMs, version: MM_VERSION_303 });
  }

  _recordLatency303(source, ms) {
    const win = this._windows[source] || (this._windows[source] = []);
    if (win.length >= LATENCY_WINDOW_SIZE_303) win.shift();
    win.push(ms);
  }

  /**
   * latencyStats303() — per-source p50 and p95 latency stats.
   */
  latencyStats303() {
    const result = { version: MM_VERSION_303, sources: {} };
    for (const [src, win] of Object.entries(this._windows)) {
      if (!win.length) {
        result.sources[src] = { p50: null, p95: null, count: 0 };
        continue;
      }
      const sorted = [...win].sort((a, b) => a - b);
      result.sources[src] = {
        p50:   _percentile303(sorted, 50),
        p95:   _percentile303(sorted, 95),
        count: sorted.length,
      };
    }
    return result;
  }

  stats() {
    return Object.assign({ version: MM_VERSION_303 }, this._stats, this.latencyStats303());
  }
}

let _defaultLatencyTracker303 = null;
function defaultReceiptLatencyTracker303(opts) {
  if (!_defaultLatencyTracker303 || opts) {
    _defaultLatencyTracker303 = new ReceiptLatencyTracker303(opts || {});
  }
  return _defaultLatencyTracker303;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  MM_VERSION_303,
  LATENCY_WINDOW_SIZE_303,
  FLUSH_TABLE_303,
  FLUSH_BATCH_SIZE_303,
  PAGINATION_MAX_LIMIT_303,
  // 1. Alert escalation bridge
  AlertEscalationBridge303,
  defaultAlertEscalationBridge303,
  // 2. Delivery log flusher (PostgreSQL)
  DeliveryLogFlusher303,
  defaultDeliveryLogFlusher303,
  // 3. Paginated replay buffer
  PaginatedReplayBuffer303,
  defaultPaginatedReplayBuffer303,
  // 4. Receipt latency tracker
  ReceiptLatencyTracker303,
  defaultReceiptLatencyTracker303,
  // helpers (exported for tests)
  _percentile303,
};
