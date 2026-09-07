'use strict';
/**
 * lib/marketMaker301.js — ECOS V301 (Phase P189) — Persistence, Streaming & Ops
 *
 * Four additive components that operationalize the V300 live-binding layer:
 *
 *   1. ReceiptDbAdapter301      — ports ReceiptLedger300 to a PostgreSQL table
 *                                  (`ecos_contract_receipts`); `flushToDb301()`
 *                                  drains the ring to DB; query falls back to
 *                                  the ring when DB is unavailable.
 *
 *   2. BacktestSseStream301     — SSE-capable backtest runner: given a set of
 *                                  `{ priceSeries, gridParams?, asParams? }` runs
 *                                  it emits per-step SSE events so the caller
 *                                  can stream progress without blocking.
 *                                  Pure in-process (no new deps).
 *
 *   3. HitlWebhookDispatcher301 — fires an HTTP(S) POST when a V300 HITL ticket
 *                                  is approved or rejected. Registered URLs are
 *                                  kept in a bounded in-memory registry (cap 100).
 *                                  Delivery uses built-in `http`/`https` with
 *                                  exp-backoff retry (≤3 attempts). Same pattern
 *                                  as lib/webhookRetryQueue.js; no new deps.
 *
 *   4. LiveBindHealthMonitor301  — tracks last-call timestamps per adapter from
 *                                  the V300 LiveCapitalBinder300 and exposes a
 *                                  `GET /api/v1/market/live/status` health snapshot.
 *
 * Sacred files untouched (R1). All new identifiers end in `301` (R2).
 * Zero new npm deps (R3). V287..V300 surfaces preserved (R6).
 * lib/ mirrors src/lib/ (R7). package.json bumped to 301.0.0.
 *
 * @version 301.0.0
 */

const MM298 = require('./marketMaker298.js');
const MM299 = require('./marketMaker299.js');
const MM300 = require('./marketMaker300.js');
const http   = require('http');
const https  = require('https');
const crypto = require('crypto');
const { URL } = require('url');

const MM_VERSION_301              = '301.0.0';
const WEBHOOK_REGISTRY_CAP_301   = 100;   // max registered webhook URLs
const WEBHOOK_MAX_ATTEMPTS_301   = 3;
const WEBHOOK_BACKOFF_BASE_301   = 500;   // ms
const DB_TABLE_RECEIPTS_301      = 'ecos_contract_receipts';
const SSE_BATCH_SIZE_301         = 50;    // max runs per SSE stream call

// ─────────────────────────────────────────────────────────────────────────────
// 1) ReceiptDbAdapter301 — PostgreSQL persistence for audit receipts
// ─────────────────────────────────────────────────────────────────────────────

class ReceiptDbError301 extends Error {
  constructor(msg, code) { super(msg); this.name = 'ReceiptDbError301'; this.code = code || 'DB_ERROR'; }
}

/**
 * ReceiptDbAdapter301
 *
 * Wraps a ReceiptLedger300 ring with optional PostgreSQL persistence.
 *
 * If `opts.dbPool` is provided (a pg-compatible pool with `.query()`):
 *   - `flushToDb301()` — drains every entry in the ring to the DB and
 *     clears the ring.
 *   - `listFromDb301(opts)` — queries the DB for receipts, filtered by
 *     `contractId` and paginated.
 *   - `listWithFallback301(opts)` — tries DB first; falls back to ring
 *     if DB call fails (used by the GET endpoint).
 *
 * When `dbPool` is absent, all DB calls return `{ ok:false, source:'ring-only' }`.
 *
 * CREATE TABLE (idempotent) is attempted on first flush when the `autoMigrate`
 * option is true (default false — migrations stay explicit per the project convention).
 */
class ReceiptDbAdapter301 {
  constructor(opts = {}) {
    this.ledger     = opts.ledger || MM300.defaultReceiptLedger300();
    this.dbPool     = opts.dbPool     || null;
    this.autoMigrate = opts.autoMigrate || false;
    this._migrated  = false;
    this._stats     = { flushes: 0, rowsInserted: 0, dbReads: 0, fallbacks: 0, errors: 0 };
  }

  /** Ensure the DB table exists (only when autoMigrate:true). */
  async _ensureTable() {
    if (this._migrated || !this.dbPool || !this.autoMigrate) return;
    try {
      await this.dbPool.query(`
        CREATE TABLE IF NOT EXISTS ${DB_TABLE_RECEIPTS_301} (
          receipt_id   TEXT PRIMARY KEY,
          contract_id  TEXT,
          version      TEXT,
          at           TIMESTAMPTZ,
          payload      JSONB,
          stored_at    TIMESTAMPTZ DEFAULT now()
        )
      `);
      this._migrated = true;
    } catch (e) {
      this._stats.errors += 1;
    }
  }

  /**
   * flushToDb301() — drain the in-memory ring to the DB.
   * Returns { ok, flushed, skipped, source: 'db' | 'ring-only' }
   */
  async flushToDb301() {
    if (!this.dbPool) {
      return { ok: false, version: MM_VERSION_301, source: 'ring-only', flushed: 0,
        note: 'dbPool not configured; receipts remain in ring' };
    }
    await this._ensureTable();
    const items = this.ledger.list({ limit: this.ledger.capacity }).items;
    let flushed = 0, skipped = 0;
    for (const item of items) {
      try {
        await this.dbPool.query(
          `INSERT INTO ${DB_TABLE_RECEIPTS_301}
             (receipt_id, contract_id, version, at, payload)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (receipt_id) DO NOTHING`,
          [
            item.receiptId  || item._ledgerSeq?.toString(),
            item.contractId || null,
            item.version    || MM_VERSION_301,
            item.at         || item._storedAt || new Date().toISOString(),
            JSON.stringify(item),
          ]
        );
        flushed += 1;
        this._stats.rowsInserted += 1;
      } catch (_) { skipped += 1; this._stats.errors += 1; }
    }
    // Clear ring
    this.ledger._ring    = [];
    this.ledger._writePos = 0;
    this._stats.flushes += 1;
    return { ok: true, version: MM_VERSION_301, source: 'db', flushed, skipped,
      note: 'ring drained to ' + DB_TABLE_RECEIPTS_301 };
  }

  /**
   * listFromDb301(opts) — query the DB directly.
   * opts: { contractId?, limit?, offset? }
   */
  async listFromDb301(opts = {}) {
    if (!this.dbPool) {
      return { ok: false, version: MM_VERSION_301, source: 'ring-only',
        note: 'dbPool not configured' };
    }
    const limit  = Math.min(opts.limit  || 20, 1000);
    const offset = opts.offset || 0;
    let sql    = `SELECT * FROM ${DB_TABLE_RECEIPTS_301}`;
    const params = [];
    if (opts.contractId) {
      params.push(opts.contractId);
      sql += ` WHERE contract_id = $${params.length}`;
    }
    sql += ` ORDER BY stored_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);
    try {
      this._stats.dbReads += 1;
      const result = await this.dbPool.query(sql, params);
      return { ok: true, version: MM_VERSION_301, source: 'db',
        total: result.rowCount, offset, limit, items: result.rows };
    } catch (e) {
      this._stats.errors += 1;
      throw new ReceiptDbError301('DB query failed: ' + e.message, 'DB_QUERY_FAIL');
    }
  }

  /**
   * listWithFallback301(opts) — DB first; falls back to ring on error.
   */
  async listWithFallback301(opts = {}) {
    if (this.dbPool) {
      try {
        return await this.listFromDb301(opts);
      } catch (_) {
        this._stats.fallbacks += 1;
      }
    }
    this._stats.fallbacks += 1;
    return Object.assign({}, this.ledger.list(opts), {
      version: MM_VERSION_301, source: 'ring-fallback',
      note: 'DB unavailable; reading from in-memory ring',
    });
  }

  stats() {
    return Object.assign({ version: MM_VERSION_301, table: DB_TABLE_RECEIPTS_301,
      dbConfigured: !!this.dbPool }, this._stats,
      { ledger: this.ledger.stats() });
  }
}

// Singleton
let _defaultReceiptDb301 = null;
function defaultReceiptDbAdapter301(opts) {
  if (!_defaultReceiptDb301 || opts) _defaultReceiptDb301 = new ReceiptDbAdapter301(opts || {});
  return _defaultReceiptDb301;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) BacktestSseStream301 — SSE-capable backtest runner
// ─────────────────────────────────────────────────────────────────────────────

/**
 * BacktestSseStream301
 *
 * Runs `runBatchBacktest300` over a set of runs and emits per-run events via
 * an SSE writer function (`writeFn`). This is a synchronous generator; the
 * HTTP handler drives it step-by-step so the event loop is not blocked for
 * long between emits (each run is one yield).
 *
 * writeFn(type, data) — called by the runner to emit an SSE event.
 *   type: 'hello' | 'run' | 'done' | 'error'
 *   data: object serialised to JSON
 *
 * Usage:
 *   const runner = new BacktestSseStream301({ runs, globalGridParams, globalAsParams });
 *   for (const event of runner.run()) {
 *     writeFn(event.type, event.data);
 *   }
 */
class BacktestSseStreamError301 extends Error {
  constructor(msg, code) { super(msg); this.name = 'BacktestSseStreamError301'; this.code = code || 'SSE_ERROR'; this.statusCode = 400; }
}

class BacktestSseStream301 {
  constructor(opts = {}) {
    this.runs             = opts.runs             || [];
    this.globalGridParams = opts.globalGridParams || {};
    this.globalAsParams   = opts.globalAsParams   || {};
    this.maxRuns          = opts.maxRuns          || SSE_BATCH_SIZE_301;
  }

  /**
   * *run() — synchronous generator; yields SSE event objects.
   * Each object: { type, data }
   */
  * run() {
    if (!Array.isArray(this.runs) || this.runs.length === 0) {
      throw new BacktestSseStreamError301('runs must be a non-empty array', 'BAD_RUNS');
    }
    if (this.runs.length > this.maxRuns) {
      throw new BacktestSseStreamError301('runs exceed maxRuns=' + this.maxRuns, 'TOO_MANY_RUNS');
    }

    yield { type: 'hello', data: { version: MM_VERSION_301, runCount: this.runs.length, at: new Date().toISOString() } };

    let successCount = 0, failCount = 0;
    const pnls = [];

    for (let i = 0; i < this.runs.length; i++) {
      const run = this.runs[i];
      if (!run || !Array.isArray(run.priceSeries)) {
        yield { type: 'run', data: { runIndex: i, ok: false, error: 'priceSeries missing' } };
        failCount += 1;
        continue;
      }
      const gp = Object.assign({}, this.globalGridParams, run.gridParams || {});
      const ap = Object.assign({}, this.globalAsParams,   run.asParams   || {});
      try {
        const res = MM299.paperBacktest299(run.priceSeries, gp, ap);
        pnls.push(res.pnl);
        successCount += 1;
        yield { type: 'run', data: {
          runIndex: i, ok: true, version: MM_VERSION_301,
          pnl: res.pnl, steps: res.steps, totalFills: res.totalFills,
          finalInventory: res.finalInventory, finalCash: res.finalCash,
        }};
      } catch (e) {
        failCount += 1;
        yield { type: 'run', data: { runIndex: i, ok: false, error: e.message } };
      }
    }

    // Final stats
    const n = pnls.length;
    const meanPnl = n > 0 ? pnls.reduce((a, b) => a + b, 0) / n : 0;
    const winRate = n > 0 ? pnls.filter(p => p > 0).length / n : 0;

    yield { type: 'done', data: {
      version: MM_VERSION_301,
      successCount, failCount,
      stats: {
        meanPnl: +meanPnl.toFixed(8),
        winRate: +winRate.toFixed(4),
        bestPnl:  n > 0 ? Math.max(...pnls) : 0,
        worstPnl: n > 0 ? Math.min(...pnls) : 0,
      },
      at: new Date().toISOString(),
    }};
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) HitlWebhookDispatcher301 — fire HTTP POST on HITL ticket decision
// ─────────────────────────────────────────────────────────────────────────────

class WebhookDeliveryError301 extends Error {
  constructor(msg, code) { super(msg); this.name = 'WebhookDeliveryError301'; this.code = code || 'DELIVERY_ERROR'; }
}

/**
 * HitlWebhookDispatcher301
 *
 * Maintains a bounded registry of webhook endpoints (max 100).
 * When `dispatch301(ticket)` is called, it fires an HTTP(S) POST to all
 * registered URLs with a HMAC-SHA256 `X-Ecos-Signature` header (same
 * pattern as the existing WorkspaceWebhookService). Delivery is attempted
 * up to 3 times with exponential backoff (500ms, 1s, 2s). All attempts
 * are async; errors are collected, not thrown.
 *
 * No new npm deps — uses built-in `http`, `https`, `crypto`.
 */
class HitlWebhookDispatcher301 {
  constructor(opts = {}) {
    this._registry = [];       // [{ id, url, secret, createdAt }]
    this._stats    = { registered: 0, dispatched: 0, delivered: 0, failed: 0 };
    this._maxRetries = WEBHOOK_MAX_ATTEMPTS_301;
    this._backoffBase = WEBHOOK_BACKOFF_BASE_301;
  }

  /**
   * register301(url, opts) — add a webhook endpoint.
   * opts.secret — HMAC secret (optional; empty string → no signature)
   * Returns { id, url, createdAt }
   */
  register301(url, opts = {}) {
    if (!url || typeof url !== 'string') throw new WebhookDeliveryError301('url is required', 'BAD_URL');
    try { new URL(url); } catch (_) { throw new WebhookDeliveryError301('url must be a valid URL', 'INVALID_URL'); }
    if (this._registry.length >= WEBHOOK_REGISTRY_CAP_301) {
      this._registry.shift(); // evict oldest
    }
    const entry = {
      id: 'wh-v301-' + crypto.randomBytes(6).toString('hex'),
      url, secret: opts.secret || '',
      createdAt: new Date().toISOString(),
    };
    this._registry.push(entry);
    this._stats.registered += 1;
    return { id: entry.id, url: entry.url, version: MM_VERSION_301, createdAt: entry.createdAt };
  }

  /**
   * unregister301(id) — remove a webhook by id.
   */
  unregister301(id) {
    const before = this._registry.length;
    this._registry = this._registry.filter(e => e.id !== id);
    return { ok: this._registry.length < before, version: MM_VERSION_301, id };
  }

  /**
   * dispatch301(ticket) — fire to all registered URLs (async, non-blocking).
   * Returns immediately with { dispatched: N } — delivery is fire-and-forget.
   */
  dispatch301(ticket) {
    const body = JSON.stringify({ version: MM_VERSION_301, event: 'hitl.decision', ticket });
    for (const entry of this._registry) {
      this._deliverWithRetry(entry, body).catch(() => {});
    }
    this._stats.dispatched += 1;
    return { version: MM_VERSION_301, dispatched: this._registry.length, webhookCount: this._registry.length };
  }

  async _deliverWithRetry(entry, body) {
    let attempt = 0;
    while (attempt < this._maxRetries) {
      try {
        await this._httpPost(entry.url, body, entry.secret);
        this._stats.delivered += 1;
        return;
      } catch (_) {
        attempt += 1;
        if (attempt < this._maxRetries) {
          await new Promise(r => setTimeout(r, this._backoffBase * Math.pow(2, attempt - 1)));
        }
      }
    }
    this._stats.failed += 1;
  }

  _httpPost(rawUrl, body, secret) {
    return new Promise((resolve, reject) => {
      let parsed;
      try { parsed = new URL(rawUrl); } catch (e) { return reject(e); }
      const mod = parsed.protocol === 'https:' ? https : http;
      const sig = secret
        ? crypto.createHmac('sha256', secret).update(body).digest('hex')
        : '';
      const opts = {
        hostname: parsed.hostname,
        port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path:     parsed.pathname + (parsed.search || ''),
        method:   'POST',
        headers: {
          'Content-Type':    'application/json',
          'Content-Length':  Buffer.byteLength(body),
          'X-Ecos-Version':  MM_VERSION_301,
          ...(sig ? { 'X-Ecos-Signature': 'sha256=' + sig } : {}),
        },
        timeout: 5000,
      };
      const req = mod.request(opts, res => {
        res.resume();
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve();
          else reject(new Error('HTTP ' + res.statusCode));
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.write(body);
      req.end();
    });
  }

  listWebhooks301() {
    return { version: MM_VERSION_301, count: this._registry.length,
      webhooks: this._registry.map(e => ({ id: e.id, url: e.url, createdAt: e.createdAt })) };
  }

  stats() {
    return Object.assign({ version: MM_VERSION_301 }, this._stats);
  }
}

// Singleton
let _defaultHitlWebhook301 = null;
function defaultHitlWebhookDispatcher301(opts) {
  if (!_defaultHitlWebhook301 || opts) _defaultHitlWebhook301 = new HitlWebhookDispatcher301(opts || {});
  return _defaultHitlWebhook301;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) LiveBindHealthMonitor301 — per-adapter health with last-call timestamps
// ─────────────────────────────────────────────────────────────────────────────

/**
 * LiveBindHealthMonitor301
 *
 * Instruments the V300 LiveCapitalBinder300 adapters to record a last-call
 * timestamp and success/fail count per adapter. The `status301()` method
 * returns a unified health object suitable for `GET /api/v1/market/live/status`.
 *
 * Usage: call `instrument301(binder, bridge, treasury)` once after `binder.bind()`.
 * Then `status301()` reflects live adapter health.
 */
class LiveBindHealthMonitor301 {
  constructor() {
    this._adapters = {
      paymentRail:  { lastCall: null, calls: 0, errors: 0, bound: false },
      dispatcher:   { lastCall: null, calls: 0, errors: 0, bound: false },
      credit:       { lastCall: null, calls: 0, errors: 0, bound: false },
      treasury:     { lastCall: null, calls: 0, errors: 0, bound: false },
    };
    this._instrumentedAt = null;
    this._liveEnabled    = false;
  }

  /**
   * instrument301(binder, bridge, treasury)
   *
   * Wraps each adapter on bridge/treasury with a thin monitoring shim that
   * records last-call timestamp and counts calls/errors.
   */
  instrument301(binder, bridge, treasury) {
    if (!bridge || typeof bridge.fulfil !== 'function') return;
    this._liveEnabled    = !!(binder && binder.liveEnabled);
    this._instrumentedAt = new Date().toISOString();

    const wrap = (adapterName, originalFn) => {
      const track = this._adapters[adapterName];
      if (track) track.bound = true;
      return (...args) => {
        if (track) {
          track.calls += 1;
          track.lastCall = new Date().toISOString();
        }
        try {
          const result = typeof originalFn === 'function' ? originalFn(...args) : { ok: true, stub: true };
          return result;
        } catch (e) {
          if (track) track.errors += 1;
          throw e;
        }
      };
    };

    // Wrap bridge adapters
    if (typeof bridge.paymentRailAdapter === 'function') {
      bridge.paymentRailAdapter = wrap('paymentRail', bridge.paymentRailAdapter);
      this._adapters.paymentRail.bound = true;
    }
    if (typeof bridge.dispatcherAdapter === 'function') {
      bridge.dispatcherAdapter = wrap('dispatcher', bridge.dispatcherAdapter);
      this._adapters.dispatcher.bound = true;
    }
    if (typeof bridge.creditReserveAdapter === 'function') {
      bridge.creditReserveAdapter = wrap('credit', bridge.creditReserveAdapter);
      this._adapters.credit.bound = true;
    }
    // Wrap treasury adapter
    if (treasury && typeof treasury.treasuryAdapter === 'function') {
      treasury.treasuryAdapter = wrap('treasury', treasury.treasuryAdapter);
      this._adapters.treasury.bound = true;
    }
  }

  /**
   * status301() — returns health snapshot.
   */
  status301() {
    const adapterStatus = {};
    for (const [name, track] of Object.entries(this._adapters)) {
      const stale = track.lastCall
        ? (Date.now() - new Date(track.lastCall).getTime()) > 300000 // >5 min = stale
        : null;
      adapterStatus[name] = {
        bound:    track.bound,
        calls:    track.calls,
        errors:   track.errors,
        lastCall: track.lastCall,
        stale:    stale,
      };
    }
    const allBound    = Object.values(this._adapters).every(a => a.bound);
    const totalErrors = Object.values(this._adapters).reduce((s, a) => s + a.errors, 0);
    return {
      version: MM_VERSION_301,
      liveEnabled:    this._liveEnabled,
      instrumentedAt: this._instrumentedAt,
      healthy: allBound && totalErrors === 0,
      adapterStatus,
    };
  }
}

// Singleton
let _defaultHealthMonitor301 = null;
function defaultLiveBindHealthMonitor301() {
  if (!_defaultHealthMonitor301) _defaultHealthMonitor301 = new LiveBindHealthMonitor301();
  return _defaultHealthMonitor301;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  MM_VERSION_301,
  DB_TABLE_RECEIPTS_301,
  WEBHOOK_REGISTRY_CAP_301,
  SSE_BATCH_SIZE_301,
  // 1. Receipt DB adapter
  ReceiptDbError301,
  ReceiptDbAdapter301,
  defaultReceiptDbAdapter301,
  // 2. Backtest SSE stream
  BacktestSseStreamError301,
  BacktestSseStream301,
  // 3. HITL webhook dispatcher
  WebhookDeliveryError301,
  HitlWebhookDispatcher301,
  defaultHitlWebhookDispatcher301,
  // 4. Live-bind health monitor
  LiveBindHealthMonitor301,
  defaultLiveBindHealthMonitor301,
};
