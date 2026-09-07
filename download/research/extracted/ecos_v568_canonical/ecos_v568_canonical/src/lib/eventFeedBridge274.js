'use strict';
/**
 * src/lib/eventFeedBridge274.js — ECOS Event Feed Bridge (V274)
 *
 * V274 connects the creditHealthMonitor273 to the live event stream:
 *   - Hooks into sybilGuard.evaluate268() post-call to auto-record sybil evals
 *   - Hooks into tipModule.tip268() post-call to auto-record tip events
 *   - Provides SSE (Server-Sent Events) counter broadcasting
 *   - Persists the latest checkHealth273() snapshot to DB (optional)
 *
 * Iron rules: zero new npm deps. All identifiers end in 274. Sacred files untouched.
 */

const BRIDGE_VERSION_274    = '274';
const SSE_HEARTBEAT_MS_274  = 30_000;  // 30 s keepalive interval
const SSE_MAX_CLIENTS_274   = 200;     // max concurrent SSE connections
const SNAPSHOT_INTERVAL_274 = 60_000; // persist snapshot every 60 s
const PERF_RING_MAX_274      = 1000;

class EventFeedBridge274 {
  constructor(opts = {}) {
    this._chm          = opts.creditHealthMonitor || null; // CreditHealthMonitor273
    this._sybilGuard   = opts.sybilGuard          || null; // SybilGuard268
    this._tipModule    = opts.tipModule            || null; // TipModule268
    this._db           = opts.db                  || null; // persistence (optional)
    this._logger       = opts.logger              || console;
    this._logAdapter   = opts.logAdapter          || null;

    // SSE clients: Map<clientId, { res, lastEventId }>
    this._sseClients274   = new Map();
    this._sseEventId274   = 0;
    this._heartbeatTimer274 = null;
    this._snapshotTimer274  = null;

    // Hook state
    this._sybilHooked274  = false;
    this._tipHooked274    = false;
    this._origSybilEval274 = null;
    this._origTipMethod274 = null;

    this._perf274 = { latencies: [] };
  }

  // ── Hook wiring ─────────────────────────────────────────────────────────────

  /**
   * Wire all available hooks. Safe to call multiple times (idempotent).
   */
  wireHooks274() {
    this._wireSybilHook274();
    this._wireTipHook274();
    this._log274('HOOKS_WIRED', {
      sybil: this._sybilHooked274,
      tip:   this._tipHooked274,
    });
    return {
      ok:           true,
      sybilHooked:  this._sybilHooked274,
      tipHooked:    this._tipHooked274,
    };
  }

  /**
   * Remove all hooks, restoring original methods.
   */
  unwireHooks274() {
    if (this._sybilGuard && this._sybilHooked274 && this._origSybilEval274) {
      this._sybilGuard.evaluate268 = this._origSybilEval274;
      this._sybilHooked274 = false;
      this._origSybilEval274 = null;
    }
    if (this._tipModule && this._tipHooked274 && this._origTipMethod274) {
      this._tipModule.tip268 = this._origTipMethod274;
      this._tipHooked274 = false;
      this._origTipMethod274 = null;
    }
    this._log274('HOOKS_UNWIRED', {});
    return { ok: true };
  }

  _wireSybilHook274() {
    if (!this._sybilGuard || this._sybilHooked274) return;
    if (typeof this._sybilGuard.evaluate268 !== 'function') return;

    const self = this;
    const orig = this._sybilGuard.evaluate268.bind(this._sybilGuard);
    this._origSybilEval274 = this._sybilGuard.evaluate268;

    this._sybilGuard.evaluate268 = function evaluate268Hooked274(userId, opts) {
      const result = orig(userId, opts);
      // Forward to CreditHealthMonitor (non-blocking, best-effort)
      try {
        if (self._chm && typeof self._chm.recordSybilEval273 === 'function') {
          const passed = result && (result.ok === true || result.passed === true ||
            (typeof result.score === 'number' && result.score >= 0.5));
          self._chm.recordSybilEval273(userId, passed);
          self._broadcastCounterUpdate274('sybilEval', { userId, passed });
        }
      } catch (_) {}
      return result;
    };

    this._sybilHooked274 = true;
  }

  _wireTipHook274() {
    if (!this._tipModule || this._tipHooked274) return;
    if (typeof this._tipModule.tip268 !== 'function') return;

    const self = this;
    const orig = this._tipModule.tip268.bind(this._tipModule);
    this._origTipMethod274 = this._tipModule.tip268;

    this._tipModule.tip268 = function tip268Hooked274(fromUserId, toUserId, amountMicro, opts) {
      const result = orig(fromUserId, toUserId, amountMicro, opts);
      try {
        if (self._chm && typeof self._chm.recordTip273 === 'function') {
          self._chm.recordTip273(fromUserId, toUserId,
            typeof amountMicro === 'bigint' ? amountMicro : BigInt(amountMicro || 0));
          self._broadcastCounterUpdate274('tip', { fromUserId, toUserId, amountMicro: amountMicro ? amountMicro.toString() : '0' });
        }
      } catch (_) {}
      return result;
    };

    this._tipHooked274 = true;
  }

  // ── SSE broadcasting ─────────────────────────────────────────────────────────

  /**
   * Register a new SSE client response object.
   * Returns { ok, clientId } or { ok: false, error } if at capacity.
   */
  addSseClient274(res) {
    if (this._sseClients274.size >= SSE_MAX_CLIENTS_274)
      return { ok: false, error: 'SSE capacity reached' };

    const clientId = 'sse274::' + (++this._sseEventId274).toString(16);
    this._sseClients274.set(clientId, { res, connectedAt: Date.now() });

    // Send initial metrics snapshot immediately
    try {
      const snap = this._chm ? this._chm.getMetrics273() : null;
      if (snap && snap.ok) {
        this._writeSseEvent274(res, 'snapshot', snap);
      }
    } catch (_) {}

    this._log274('SSE_CLIENT_ADD', { clientId, total: this._sseClients274.size });
    return { ok: true, clientId };
  }

  /**
   * Remove a SSE client (on close/error).
   */
  removeSseClient274(clientId) {
    this._sseClients274.delete(clientId);
    this._log274('SSE_CLIENT_REMOVE', { clientId, remaining: this._sseClients274.size });
  }

  /**
   * Start heartbeat timer. Call once after wiring.
   */
  startHeartbeat274() {
    if (this._heartbeatTimer274) return;
    this._heartbeatTimer274 = setInterval(() => {
      this._broadcastRaw274(': heartbeat\n\n');
    }, SSE_HEARTBEAT_MS_274);
    if (this._heartbeatTimer274.unref) this._heartbeatTimer274.unref();
  }

  /**
   * Start periodic snapshot persistence to DB.
   */
  startSnapshotPersistence274() {
    if (!this._db || this._snapshotTimer274) return;
    this._snapshotTimer274 = setInterval(() => {
      this._persistSnapshot274();
    }, SNAPSHOT_INTERVAL_274);
    if (this._snapshotTimer274.unref) this._snapshotTimer274.unref();
  }

  /**
   * Stop all timers and release resources.
   */
  shutdown274() {
    if (this._heartbeatTimer274) { clearInterval(this._heartbeatTimer274); this._heartbeatTimer274 = null; }
    if (this._snapshotTimer274)  { clearInterval(this._snapshotTimer274);  this._snapshotTimer274  = null; }
    this.unwireHooks274();
    for (const [, client] of this._sseClients274) {
      try { client.res.end(); } catch (_) {}
    }
    this._sseClients274.clear();
    this._log274('SHUTDOWN', {});
  }

  _broadcastCounterUpdate274(eventType, data) {
    const _t0 = Date.now();
    if (this._sseClients274.size === 0) return;
    // Include current directives in every broadcast
    let directives = null;
    try {
      if (this._chm) {
        const ia = this._chm.issuanceAllowed273();
        const ra = this._chm.rewardsAllowed273();
        directives = {
          halt_issuance: !ia.allowed,
          pause_rewards: !ra.allowed,
        };
      }
    } catch (_) {}
    const payload = { eventType, data, directives, ts: new Date().toISOString() };
    this._broadcastSseEvent274('counter', payload);
    this._recordLatency274(_t0);
  }

  _broadcastSseEvent274(event, data) {
    const json = JSON.stringify(data);
    const msg  = `event: ${event}\ndata: ${json}\n\n`;
    const dead = [];
    for (const [clientId, client] of this._sseClients274) {
      try { client.res.write(msg); }
      catch (_) { dead.push(clientId); }
    }
    for (const id of dead) this._sseClients274.delete(id);
  }

  _broadcastRaw274(raw) {
    const dead = [];
    for (const [clientId, client] of this._sseClients274) {
      try { client.res.write(raw); }
      catch (_) { dead.push(clientId); }
    }
    for (const id of dead) this._sseClients274.delete(id);
  }

  _writeSseEvent274(res, event, data) {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
    catch (_) {}
  }

  // ── Snapshot persistence ─────────────────────────────────────────────────────

  async _persistSnapshot274() {
    if (!this._db || !this._chm) return;
    try {
      const metrics = this._chm.getMetrics273();
      if (!metrics.ok) return;
      await this._db.insert('credit_health_snapshots274', {
        snapshot_id:  'snap274::' + Date.now().toString(16),
        version:      '274',
        ts:           metrics.ts || new Date().toISOString(),
        payload:      JSON.stringify(metrics),
        halt_issuance: metrics.directives ? (metrics.directives.halt_issuance ? 1 : 0) : 0,
        pause_rewards: metrics.directives ? (metrics.directives.pause_rewards ? 1 : 0) : 0,
      });
      this._log274('SNAPSHOT_PERSISTED', { ts: metrics.ts });
    } catch (e) {
      this._log274('SNAPSHOT_PERSIST_ERROR', { error: e.message });
    }
  }

  // ── Status ────────────────────────────────────────────────────────────────────

  getStatus274() {
    return {
      ok:          true,
      version:     BRIDGE_VERSION_274,
      sseClients:  this._sseClients274.size,
      sybilHooked: this._sybilHooked274,
      tipHooked:   this._tipHooked274,
      dbWired:     !!this._db,
      chmWired:    !!this._chm,
    };
  }

  // ── Telemetry (AI_PROTOCOL_V268 pattern) ─────────────────────────────────────

  checkEventFeedBridgeHealth274() {
    try {
      return {
        ok:          true,
        version:     BRIDGE_VERSION_274,
        sseClients:  this._sseClients274.size,
        sybilHooked: this._sybilHooked274,
        tipHooked:   this._tipHooked274,
        dbWired:     !!this._db,
        chmWired:    !!this._chm,
        heartbeat:   !!this._heartbeatTimer274,
        snapshotTimer: !!this._snapshotTimer274,
      };
    } catch (e) {
      return { ok: false, version: BRIDGE_VERSION_274, error: e.message };
    }
  }

  getPerf274() {
    const lats = this._perf274.latencies;
    if (lats.length === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
    return { ...this._calcPercentiles274([...lats].sort((a, b) => a - b)), count: lats.length };
  }

  _calcPercentiles274(sorted) {
    const idx = (p) => Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
    return { p50: sorted[idx(50)], p95: sorted[idx(95)], p99: sorted[idx(99)] };
  }

  _recordLatency274(t0) {
    const ms = Date.now() - t0;
    this._perf274.latencies.push(ms);
    if (this._perf274.latencies.length > PERF_RING_MAX_274)
      this._perf274.latencies.shift();
  }

  _log274(event, meta = {}) {
    try {
      if (this._logAdapter && typeof this._logAdapter.info === 'function') {
        this._logAdapter.info(`[eventFeedBridge274] ${event}`, meta);
      } else if (this._logger && typeof this._logger.info === 'function') {
        this._logger.info({ efb274: event, ...meta }, `[eventFeedBridge274] ${event}`);
      } else {
        this._logger.log(`[eventFeedBridge274] ${event}`, meta);
      }
    } catch (_) {}
  }
}

module.exports = {
  EventFeedBridge274,
  BRIDGE_VERSION_274,
  SSE_HEARTBEAT_MS_274,
  SSE_MAX_CLIENTS_274,
  SNAPSHOT_INTERVAL_274,
};

if (process.env.NODE_ENV === 'test') {
  module.exports._EventFeedBridge274     = EventFeedBridge274;
  module.exports._BRIDGE_VERSION_274     = BRIDGE_VERSION_274;
  module.exports._SSE_HEARTBEAT_MS_274   = SSE_HEARTBEAT_MS_274;
  module.exports._SSE_MAX_CLIENTS_274    = SSE_MAX_CLIENTS_274;
}
