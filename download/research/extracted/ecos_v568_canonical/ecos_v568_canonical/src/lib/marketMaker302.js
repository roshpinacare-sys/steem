'use strict';
/**
 * lib/marketMaker302.js — ECOS V302 (Phase P190) — Delivery Audit, Resume & Alerting
 *
 * Four additive components that close the observability loop opened in V301:
 *
 *   1. WebhookDeliveryLog302   — bounded ring (cap 500) recording every
 *                                delivery attempt from HitlWebhookDispatcher301.
 *                                `record302(entry)`, `query302({ webhookId?, status?, limit? })`.
 *
 *   2. BacktestResumeBuffer302 — per-session ring (cap 200 events, max 50 sessions)
 *                                that stores BacktestSseStream301 run events so a
 *                                reconnecting client can replay missed events via
 *                                `POST /api/v1/market/backtest/stream/resume?token=<t>`.
 *
 *   3. ReceiptSourceRouter302  — source-aware receipt query wrapper:
 *                                `query302({ source:'db'|'ring', ...opts })` routes to
 *                                `ReceiptDbAdapter301.listFromDb301()` or the in-memory
 *                                ring and always returns `{ source }` in the response.
 *
 *   4. LiveBindHealthAlerter302 — watchdog that polls LiveBindHealthMonitor301 every 60s
 *                                (configurable). When any adapter is stale (>5 min) or has
 *                                errors > 0, it records an alert in a bounded ring (cap 200)
 *                                and publishes to all subscribers. Exposes
 *                                `latestAlerts302(limit)`, `subscribe302(handler)`,
 *                                `unsubscribe302(id)` for the SSE alert stream endpoint.
 *
 * Sacred files untouched (R1). All new identifiers end in `302` (R2).
 * Zero new npm deps (R3). V287..V301 surfaces preserved (R6).
 * lib/ mirrors src/lib/ (R7). package.json bumped to 302.0.0.
 *
 * @version 302.0.0
 */

const V301 = require('./marketMaker301.js');
const V300 = require('./marketMaker300.js');
const V299 = require('./marketMaker299.js');
const crypto = require('crypto');

const MM_VERSION_302                = '302.0.0';
const DELIVERY_LOG_CAP_302         = 500;   // max delivery attempt records
const RESUME_BUFFER_CAP_302        = 200;   // max events per backtest session
const RESUME_SESSION_CAP_302       = 50;    // max concurrent sessions
const RESUME_SESSION_TTL_302       = 3600000; // 1h session expiry (ms)
const ALERT_RING_CAP_302           = 200;   // max health alerts stored
const ALERT_MAX_LISTENERS_302      = 64;    // max alert subscribers
const WATCHDOG_INTERVAL_DEFAULT_302 = 60000; // 60s default watchdog interval

// ─────────────────────────────────────────────────────────────────────────────
// 1) WebhookDeliveryLog302 — audit ring for HitlWebhookDispatcher301 deliveries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WebhookDeliveryLog302
 *
 * Records every webhook delivery attempt (success or failure) from
 * HitlWebhookDispatcher301 into a bounded FIFO ring (cap 500).
 *
 * Each record:
 *   { id, webhookId, url, at, status: 'delivered'|'failed', attempt, ticketId?, error? }
 *
 * Usage: instrument an existing HitlWebhookDispatcher301 via
 * `log.instrument302(dispatcher)` — this monkey-patches _deliverWithRetry
 * to emit records on each attempt outcome.
 */
class WebhookDeliveryLog302 {
  constructor(opts = {}) {
    this._cap   = opts.cap || DELIVERY_LOG_CAP_302;
    this._ring  = [];
    this._stats = { recorded: 0, delivered: 0, failed: 0 };
  }

  /**
   * record302(entry) — push a delivery record into the ring.
   * entry: { webhookId, url, status, attempt, ticketId?, error? }
   */
  record302(entry) {
    if (this._ring.length >= this._cap) this._ring.shift();
    const record = {
      id:        'dlv-v302-' + crypto.randomBytes(4).toString('hex'),
      webhookId: entry.webhookId || null,
      url:       entry.url       || null,
      at:        new Date().toISOString(),
      status:    entry.status    || 'unknown',
      attempt:   entry.attempt   || 1,
      ticketId:  entry.ticketId  || null,
      error:     entry.error     || null,
      version:   MM_VERSION_302,
    };
    this._ring.push(record);
    this._stats.recorded += 1;
    if (record.status === 'delivered') this._stats.delivered += 1;
    else if (record.status === 'failed') this._stats.failed += 1;
    return record;
  }

  /**
   * query302({ webhookId?, status?, limit? }) — query the ring, newest-first.
   * Filters by webhookId and/or status.
   */
  query302(opts = {}) {
    const limit = Math.min(opts.limit || 50, this._cap);
    let items = [...this._ring].reverse();
    if (opts.webhookId) items = items.filter(r => r.webhookId === opts.webhookId);
    if (opts.status)    items = items.filter(r => r.status === opts.status);
    return {
      ok: true, version: MM_VERSION_302,
      total: items.length, limit,
      items: items.slice(0, limit),
    };
  }

  /**
   * instrument302(dispatcher) — monkey-patch a HitlWebhookDispatcher301 to
   * record delivery outcomes into this log.
   */
  instrument302(dispatcher) {
    if (!dispatcher || typeof dispatcher._deliverWithRetry !== 'function') return;
    const log = this;
    const _orig = dispatcher._deliverWithRetry.bind(dispatcher);
    dispatcher._deliverWithRetry = async function (entry, body) {
      let attempt = 0;
      const maxAttempts = dispatcher._maxRetries || 3;
      while (attempt < maxAttempts) {
        try {
          await dispatcher._httpPost(entry.url, body, entry.secret);
          dispatcher._stats.delivered = (dispatcher._stats.delivered || 0) + 1;
          log.record302({ webhookId: entry.id, url: entry.url, status: 'delivered', attempt: attempt + 1 });
          return;
        } catch (e) {
          attempt += 1;
          if (attempt >= maxAttempts) {
            log.record302({ webhookId: entry.id, url: entry.url, status: 'failed',
              attempt, error: e.message });
            dispatcher._stats.failed = (dispatcher._stats.failed || 0) + 1;
            return;
          }
          log.record302({ webhookId: entry.id, url: entry.url, status: 'failed',
            attempt, error: e.message });
          const backoff = (dispatcher._backoffBase || 500) * Math.pow(2, attempt - 1);
          await new Promise(r => setTimeout(r, backoff));
        }
      }
    };
  }

  stats() { return Object.assign({ version: MM_VERSION_302, cap: this._cap }, this._stats); }
}

// Singleton
let _defaultDeliveryLog302 = null;
function defaultWebhookDeliveryLog302(opts) {
  if (!_defaultDeliveryLog302 || opts) _defaultDeliveryLog302 = new WebhookDeliveryLog302(opts || {});
  return _defaultDeliveryLog302;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) BacktestResumeBuffer302 — session-based replay for SSE backtest clients
// ─────────────────────────────────────────────────────────────────────────────

class BacktestResumeError302 extends Error {
  constructor(msg, code) { super(msg); this.name = 'BacktestResumeError302'; this.code = code || 'RESUME_ERROR'; this.statusCode = 400; }
}

/**
 * BacktestResumeBuffer302
 *
 * Maintains a bounded map of session token → event ring (cap 200 events/session).
 * Max 50 concurrent sessions; oldest evicted when cap is reached.
 * Sessions expire after 1h (RESUME_SESSION_TTL_302).
 *
 * The SSE handler calls `record302(token, event)` for each emitted event.
 * A reconnecting client sends `POST /api/v1/market/backtest/stream/resume?token=<t>`
 * which calls `replay302(token, afterIndex)` to get all missed events.
 */
class BacktestResumeBuffer302 {
  constructor(opts = {}) {
    this._sessions  = new Map();        // token → { events, createdAt, lastAt }
    this._eventCap  = opts.eventCap  || RESUME_BUFFER_CAP_302;
    this._sessionCap = opts.sessionCap || RESUME_SESSION_CAP_302;
    this._ttl       = opts.ttl       || RESUME_SESSION_TTL_302;
    this._stats     = { created: 0, replayed: 0, evicted: 0, expired: 0 };
  }

  /**
   * createSession302() — create a new session token.
   * Returns { token, createdAt, eventCap, ttlMs }
   */
  createSession302() {
    this._evictOldest();
    const token = 'brs302-' + crypto.randomBytes(8).toString('hex');
    this._sessions.set(token, {
      events:    [],
      createdAt: new Date().toISOString(),
      lastAt:    Date.now(),
    });
    this._stats.created += 1;
    return { token, version: MM_VERSION_302, createdAt: new Date().toISOString(),
      eventCap: this._eventCap, ttlMs: this._ttl };
  }

  _evictOldest() {
    // Evict expired sessions
    const now = Date.now();
    for (const [tok, sess] of this._sessions) {
      if (now - sess.lastAt > this._ttl) { this._sessions.delete(tok); this._stats.expired += 1; }
    }
    // Evict oldest if still over cap
    if (this._sessions.size >= this._sessionCap) {
      const oldest = [...this._sessions.entries()].sort((a, b) => a[1].lastAt - b[1].lastAt)[0];
      if (oldest) { this._sessions.delete(oldest[0]); this._stats.evicted += 1; }
    }
  }

  /**
   * record302(token, event) — append an event to the session ring.
   * event: any serializable object (BacktestSseStream301 event data).
   * Returns the event index (0-based) for resume tracking.
   */
  record302(token, event) {
    const sess = this._sessions.get(token);
    if (!sess) return -1;
    if (sess.events.length >= this._eventCap) sess.events.shift();
    const idx = sess.events.push({ idx: sess.events.length, at: new Date().toISOString(), event }) - 1;
    sess.lastAt = Date.now();
    return idx;
  }

  /**
   * replay302(token, afterIndex?) — return events after `afterIndex` (exclusive).
   * afterIndex defaults to -1 (replay all).
   */
  replay302(token, afterIndex) {
    const sess = this._sessions.get(token);
    if (!sess) throw new BacktestResumeError302('session not found or expired: ' + token, 'SESSION_NOT_FOUND');
    sess.lastAt = Date.now();
    const after = typeof afterIndex === 'number' ? afterIndex : -1;
    const events = sess.events.filter(e => e.idx > after);
    this._stats.replayed += 1;
    return {
      ok: true, version: MM_VERSION_302, token,
      after, count: events.length,
      events: events.map(e => e.event),
    };
  }

  /**
   * evictSession302(token) — explicitly remove a session (called when SSE ends cleanly).
   */
  evictSession302(token) {
    const had = this._sessions.has(token);
    this._sessions.delete(token);
    if (had) this._stats.evicted += 1;
    return { ok: had, version: MM_VERSION_302, token };
  }

  stats() {
    return Object.assign({ version: MM_VERSION_302, activeSessions: this._sessions.size,
      eventCap: this._eventCap, sessionCap: this._sessionCap }, this._stats);
  }
}

// Singleton
let _defaultResumeBuffer302 = null;
function defaultBacktestResumeBuffer302(opts) {
  if (!_defaultResumeBuffer302 || opts) _defaultResumeBuffer302 = new BacktestResumeBuffer302(opts || {});
  return _defaultResumeBuffer302;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) ReceiptSourceRouter302 — explicit source selection for receipt queries
// ─────────────────────────────────────────────────────────────────────────────

class ReceiptSourceError302 extends Error {
  constructor(msg, code) { super(msg); this.name = 'ReceiptSourceError302'; this.code = code || 'ROUTER_ERROR'; this.statusCode = 400; }
}

/**
 * ReceiptSourceRouter302
 *
 * Wraps a `ReceiptDbAdapter301` and routes queries by explicit `source` param:
 *   source = 'db'   → calls `adapter.listFromDb301(opts)` — throws if DB unavailable
 *   source = 'ring' → calls `adapter.ledger.list(opts)` — always available
 *   source = 'auto' (default) → calls `adapter.listWithFallback301(opts)` — DB-first + ring fallback
 *
 * Always includes `{ source }` in the response so the caller knows which backend was used.
 */
class ReceiptSourceRouter302 {
  constructor(opts = {}) {
    this.adapter = opts.adapter || V301.defaultReceiptDbAdapter301();
    this._stats  = { dbQueries: 0, ringQueries: 0, autoQueries: 0, errors: 0 };
  }

  /**
   * query302(opts) — route by opts.source.
   * opts: { source?: 'db'|'ring'|'auto', contractId?, limit?, offset? }
   */
  async query302(opts = {}) {
    const source = (opts.source || 'auto').toLowerCase();
    const qOpts  = { contractId: opts.contractId, limit: opts.limit, offset: opts.offset };

    if (source === 'db') {
      this._stats.dbQueries += 1;
      if (!this.adapter.dbPool) {
        this._stats.errors += 1;
        throw new ReceiptSourceError302('dbPool not configured; cannot query DB directly', 'DB_UNAVAILABLE');
      }
      try {
        const result = await this.adapter.listFromDb301(qOpts);
        return Object.assign({}, result, { version: MM_VERSION_302, requestedSource: 'db' });
      } catch (e) {
        this._stats.errors += 1;
        throw new ReceiptSourceError302('DB query failed: ' + e.message, 'DB_UNAVAILABLE');
      }
    }

    if (source === 'ring') {
      this._stats.ringQueries += 1;
      const result = this.adapter.ledger.list(qOpts);
      return Object.assign({}, result, { version: MM_VERSION_302, source: 'ring', requestedSource: 'ring' });
    }

    // auto (default)
    this._stats.autoQueries += 1;
    const result = await this.adapter.listWithFallback301(qOpts);
    return Object.assign({}, result, { version: MM_VERSION_302, requestedSource: 'auto' });
  }

  stats() { return Object.assign({ version: MM_VERSION_302 }, this._stats); }
}

// Singleton
let _defaultReceiptRouter302 = null;
function defaultReceiptSourceRouter302(opts) {
  if (!_defaultReceiptRouter302 || opts) _defaultReceiptRouter302 = new ReceiptSourceRouter302(opts || {});
  return _defaultReceiptRouter302;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) LiveBindHealthAlerter302 — watchdog + alert ring + subscriber pub/sub
// ─────────────────────────────────────────────────────────────────────────────

/**
 * LiveBindHealthAlerter302
 *
 * Polls `LiveBindHealthMonitor301.status301()` every `intervalMs` (default 60s).
 * When any adapter is stale (>5 min) or has errors > 0, creates an alert record
 * and publishes it to all subscribers (max ALERT_MAX_LISTENERS_302 = 64).
 *
 * Alert record shape:
 *   { id, at, level: 'warn'|'error', adapters: [{ name, stale, errors, lastCall }],
 *     liveEnabled, version }
 *
 * Methods:
 *   startWatchdog302(intervalMs?) — starts the polling loop (safe to call multiple times)
 *   stopWatchdog302()             — clears the timer
 *   latestAlerts302(limit?)       — return last N alerts, newest-first
 *   subscribe302(handler)         — returns { id }; handler(alert) is called on each alert
 *   unsubscribe302(id)            — remove subscriber
 *   checkNow302()                 — run one immediate check (also used in tests)
 */
class LiveBindHealthAlerter302 {
  constructor(opts = {}) {
    this._monitor     = opts.monitor || V301.defaultLiveBindHealthMonitor301();
    this._intervalMs  = opts.intervalMs || WATCHDOG_INTERVAL_DEFAULT_302;
    this._ring        = [];   // bounded alert history
    this._ringCap     = opts.ringCap || ALERT_RING_CAP_302;
    this._subscribers = new Map(); // id → handler
    this._maxSubs     = opts.maxListeners || ALERT_MAX_LISTENERS_302;
    this._timer       = null;
    this._stats       = { checks: 0, alertsFired: 0, handlerErrors: 0 };
  }

  /** startWatchdog302(intervalMs?) — begin polling. Idempotent. */
  startWatchdog302(intervalMs) {
    if (this._timer) return this;
    const ms = intervalMs || this._intervalMs;
    this._timer = setInterval(() => this.checkNow302(), ms);
    if (this._timer.unref) this._timer.unref(); // don't prevent process exit
    return this;
  }

  /** stopWatchdog302() — clear the polling timer. */
  stopWatchdog302() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    return this;
  }

  /**
   * checkNow302() — run one status check synchronously.
   * If stale/error adapters found → record + publish an alert.
   */
  checkNow302() {
    this._stats.checks += 1;
    const status = this._monitor.status301();
    const bad = Object.entries(status.adapterStatus || {})
      .filter(([, a]) => a.stale === true || a.errors > 0)
      .map(([name, a]) => ({ name, stale: a.stale, errors: a.errors, lastCall: a.lastCall }));

    if (bad.length === 0) return null;

    const alert = {
      id:          'alert302-' + crypto.randomBytes(4).toString('hex'),
      at:          new Date().toISOString(),
      level:       bad.some(a => a.errors > 0) ? 'error' : 'warn',
      adapters:    bad,
      liveEnabled: status.liveEnabled,
      version:     MM_VERSION_302,
    };

    // Push to ring
    if (this._ring.length >= this._ringCap) this._ring.shift();
    this._ring.push(alert);
    this._stats.alertsFired += 1;

    // Publish to subscribers
    for (const [, handler] of this._subscribers) {
      try { handler(alert); } catch (_) { this._stats.handlerErrors += 1; }
    }
    return alert;
  }

  /** latestAlerts302(limit?) — newest-first. */
  latestAlerts302(limit) {
    const n = Math.min(limit || 20, this._ringCap);
    return {
      ok: true, version: MM_VERSION_302,
      count: this._ring.length,
      alerts: [...this._ring].reverse().slice(0, n),
    };
  }

  /**
   * subscribe302(handler) — register a handler; returns { id }.
   * handler(alert) is called synchronously on each fired alert.
   */
  subscribe302(handler) {
    if (typeof handler !== 'function') throw new Error('handler must be a function');
    if (this._subscribers.size >= this._maxSubs) {
      // Evict oldest subscriber
      const oldest = this._subscribers.keys().next().value;
      this._subscribers.delete(oldest);
    }
    const id = 'sub302-' + crypto.randomBytes(4).toString('hex');
    this._subscribers.set(id, handler);
    return { id, version: MM_VERSION_302 };
  }

  /** unsubscribe302(id) — remove a subscriber. */
  unsubscribe302(id) {
    const had = this._subscribers.has(id);
    this._subscribers.delete(id);
    return { ok: had, version: MM_VERSION_302, id };
  }

  stats() {
    return Object.assign({ version: MM_VERSION_302,
      watchdogActive: !!this._timer,
      alertsInRing:   this._ring.length,
      subscribers:    this._subscribers.size }, this._stats);
  }
}

// Singleton
let _defaultHealthAlerter302 = null;
function defaultLiveBindHealthAlerter302(opts) {
  if (!_defaultHealthAlerter302 || opts) _defaultHealthAlerter302 = new LiveBindHealthAlerter302(opts || {});
  return _defaultHealthAlerter302;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  MM_VERSION_302,
  DELIVERY_LOG_CAP_302,
  RESUME_BUFFER_CAP_302,
  RESUME_SESSION_CAP_302,
  ALERT_RING_CAP_302,
  ALERT_MAX_LISTENERS_302,
  WATCHDOG_INTERVAL_DEFAULT_302,
  // 1. Webhook delivery log
  WebhookDeliveryLog302,
  defaultWebhookDeliveryLog302,
  // 2. Backtest resume buffer
  BacktestResumeError302,
  BacktestResumeBuffer302,
  defaultBacktestResumeBuffer302,
  // 3. Receipt source router
  ReceiptSourceError302,
  ReceiptSourceRouter302,
  defaultReceiptSourceRouter302,
  // 4. Health alerter
  LiveBindHealthAlerter302,
  defaultLiveBindHealthAlerter302,
};
