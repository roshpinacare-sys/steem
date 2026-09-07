'use strict';
/**
 * src/lib/counterAlertBus275.js — ECOS Counter Alert Bus (V275)
 *
 * V275 adds threshold-based alerting on top of the V274 SSE counter stream:
 *   - Subscribes internally to EventFeedBridge274 counter events
 *   - Fires configurable alert handlers when thresholds are crossed
 *   - Maintains a capped in-memory alert history (latest 500)
 *   - Broadcasts alert events to subscribers via SSE (/api/v275/alerts/subscribe)
 *   - Exposes alert history via GET /api/v275/alerts/history
 *
 * Default thresholds (overridable via constructor opts):
 *   sybilFailRate  > 0.15  → ALERT_SYBIL_FAIL_RATE_275
 *   tipCircularity > 0.90  → ALERT_TIP_CIRCULARITY_275
 *   haltIssuance   = true  → ALERT_HALT_ISSUANCE_275
 *   pauseRewards   = true  → ALERT_PAUSE_REWARDS_275
 *
 * Iron rules: zero new npm deps. All identifiers end in 275. Sacred files untouched.
 */

const crypto = require('node:crypto');

const ALERT_BUS_VERSION_275          = '275';
const ALERT_HISTORY_MAX_275          = 500;   // max stored alerts
const ALERT_SSE_MAX_CLIENTS_275      = 200;   // max concurrent alert SSE connections
const ALERT_SSE_HEARTBEAT_MS_275     = 30_000;
const ALERT_COOLDOWN_MS_275          = 10_000; // min ms between same-type alerts
const PERF_RING_MAX_275              = 1000;

// Default thresholds
const DEFAULT_THRESHOLDS_275 = Object.freeze({
  sybilFailRate:  0.15,
  tipCircularity: 0.90,
  haltIssuance:   true,   // alert whenever halt_issuance fires
  pauseRewards:   true,   // alert whenever pause_rewards fires
});

// Alert type constants
const ALERT_TYPE_SYBIL_FAIL_RATE_275   = 'SYBIL_FAIL_RATE';
const ALERT_TYPE_TIP_CIRCULARITY_275   = 'TIP_CIRCULARITY';
const ALERT_TYPE_HALT_ISSUANCE_275     = 'HALT_ISSUANCE';
const ALERT_TYPE_PAUSE_REWARDS_275     = 'PAUSE_REWARDS';
const ALERT_TYPE_MANUAL_OVERRIDE_275   = 'MANUAL_OVERRIDE';

class CounterAlertBus275 {
  constructor(opts = {}) {
    this._eventFeedBridge = opts.eventFeedBridge || null;  // EventFeedBridge274
    this._creditHealthMonitor = opts.creditHealthMonitor || null; // CreditHealthMonitor273
    this._logger       = opts.logger      || console;
    this._logAdapter   = opts.logAdapter  || null;

    // Alert thresholds (merge with defaults)
    this._thresholds275 = Object.assign({}, DEFAULT_THRESHOLDS_275, opts.thresholds || {});

    // Alert history: array of alert objects, capped at ALERT_HISTORY_MAX_275
    this._history275    = [];

    // Alert SSE clients: Map<clientId, res>
    this._sseClients275 = new Map();
    this._heartbeatTimer275 = null;

    // Last-fired tracking for cooldown per alert type
    this._lastFired275  = {};

    // Handler registry: Map<alertType, Set<fn>>
    this._handlers275   = new Map();

    // Subscription state
    this._subscribed275 = false;
    this._origBroadcast275 = null;

    this._perf275 = { latencies: [] };
  }

  // ── Subscription to EventFeedBridge274 ──────────────────────────────────────

  /**
   * Subscribe to counter events from EventFeedBridge274.
   * Wraps _broadcastCounterUpdate274 on the bridge instance (additive, non-breaking).
   */
  subscribe275() {
    if (!this._eventFeedBridge) {
      this._log275('SUBSCRIBE_SKIPPED', { reason: 'no_event_feed_bridge' });
      return { ok: true, subscribed: false, reason: 'no_event_feed_bridge' };
    }
    if (this._subscribed275) return { ok: true, subscribed: true, reason: 'already_subscribed' };

    const self = this;

    // Wrap the internal broadcast method on the bridge to intercept counter updates
    if (typeof this._eventFeedBridge._broadcastCounterUpdate274 === 'function') {
      const orig = this._eventFeedBridge._broadcastCounterUpdate274.bind(this._eventFeedBridge);
      this._origBroadcast275 = this._eventFeedBridge._broadcastCounterUpdate274;

      this._eventFeedBridge._broadcastCounterUpdate274 = function _broadcastCounterUpdate274Hooked275(eventType, data) {
        // Call original first (non-breaking)
        const result = orig(eventType, data);
        // Then check thresholds (best-effort, never throw)
        try { self._onCounterEvent275(eventType, data); } catch (_) {}
        return result;
      };
      this._subscribed275 = true;
      this._log275('SUBSCRIBED', { bridge: 'EventFeedBridge274' });
      return { ok: true, subscribed: true };
    }

    // Fallback: store for polling (no wrap if internal method unavailable)
    this._subscribed275 = true;
    this._log275('SUBSCRIBED_FALLBACK', {});
    return { ok: true, subscribed: true, mode: 'fallback' };
  }

  /**
   * Unsubscribe — restore original broadcast method.
   */
  unsubscribe275() {
    if (!this._subscribed275) return { ok: true };
    if (this._eventFeedBridge && this._origBroadcast275) {
      this._eventFeedBridge._broadcastCounterUpdate274 = this._origBroadcast275;
      this._origBroadcast275 = null;
    }
    this._subscribed275 = false;
    this._log275('UNSUBSCRIBED', {});
    return { ok: true };
  }

  // ── Threshold evaluation ────────────────────────────────────────────────────

  /**
   * Process a counter event from the event feed bridge.
   * Evaluates thresholds and fires alerts if crossed.
   */
  _onCounterEvent275(eventType, data) {
    const t0 = Date.now();

    // Pull live health state from creditHealthMonitor if available
    let directives = {};
    let metrics    = {};
    try {
      if (this._creditHealthMonitor) {
        const health = this._creditHealthMonitor.checkHealth273
          ? this._creditHealthMonitor.checkHealth273()
          : null;
        if (health) {
          directives = health.directives || {};
          metrics    = health.counters   || {};
        }
      }
    } catch (_) {}

    // Evaluate each threshold
    const sybilRate = typeof metrics.sybilFailRate === 'number' ? metrics.sybilFailRate :
      (data && eventType === 'sybilEval' ? this._estimateSybilRate275(data) : null);

    if (sybilRate !== null && sybilRate > this._thresholds275.sybilFailRate) {
      this._maybeFireAlert275(ALERT_TYPE_SYBIL_FAIL_RATE_275, {
        rate: sybilRate,
        threshold: this._thresholds275.sybilFailRate,
        eventType,
      });
    }

    const tipCirc = typeof metrics.tipCircularity === 'number' ? metrics.tipCircularity : null;
    if (tipCirc !== null && tipCirc > this._thresholds275.tipCircularity) {
      this._maybeFireAlert275(ALERT_TYPE_TIP_CIRCULARITY_275, {
        circularity: tipCirc,
        threshold: this._thresholds275.tipCircularity,
        eventType,
      });
    }

    if (this._thresholds275.haltIssuance && directives.halt_issuance === true) {
      this._maybeFireAlert275(ALERT_TYPE_HALT_ISSUANCE_275, { directives, eventType });
    }

    if (this._thresholds275.pauseRewards && directives.pause_rewards === true) {
      this._maybeFireAlert275(ALERT_TYPE_PAUSE_REWARDS_275, { directives, eventType });
    }

    this._recordPerf275(Date.now() - t0);
  }

  /**
   * Estimate sybil fail rate from a single event (fallback when CHM not injected).
   */
  _estimateSybilRate275(data) {
    // Can only estimate if we have a running tally; return null if unknown
    return null;
  }

  /**
   * Fire an alert if not in cooldown.
   */
  _maybeFireAlert275(alertType, context) {
    const now = Date.now();
    const last = this._lastFired275[alertType] || 0;
    if (now - last < ALERT_COOLDOWN_MS_275) return; // cooldown

    const alert = this._buildAlert275(alertType, context);
    this._history275.push(alert);
    if (this._history275.length > ALERT_HISTORY_MAX_275) this._history275.shift();

    this._lastFired275[alertType] = now;

    // Fire registered handlers
    const handlers = this._handlers275.get(alertType) || new Set();
    for (const fn of handlers) {
      try { fn(alert); } catch (_) {}
    }
    // Also fire wildcard handlers
    const wildcard = this._handlers275.get('*') || new Set();
    for (const fn of wildcard) {
      try { fn(alert); } catch (_) {}
    }

    // Broadcast to SSE clients
    this._broadcastAlert275(alert);

    this._log275('ALERT_FIRED', { alertType, alertId: alert.alertId });
  }

  /**
   * Build a structured alert object.
   */
  _buildAlert275(alertType, context = {}) {
    return {
      alertId:    crypto.randomUUID(),
      alertType,
      version:    ALERT_BUS_VERSION_275,
      ts:         new Date().toISOString(),
      context,
      resolved:   false,
    };
  }

  // ── Handler registration ────────────────────────────────────────────────────

  /**
   * Register an alert handler.
   * @param {string} alertType — specific type or '*' for all
   * @param {Function} fn — called with (alert) on each alert
   */
  onAlert275(alertType, fn) {
    if (typeof fn !== 'function') return { ok: false, error: 'fn must be a function' };
    if (!this._handlers275.has(alertType)) this._handlers275.set(alertType, new Set());
    this._handlers275.get(alertType).add(fn);
    return { ok: true };
  }

  /**
   * Remove a handler.
   */
  offAlert275(alertType, fn) {
    const set = this._handlers275.get(alertType);
    if (set) set.delete(fn);
    return { ok: true };
  }

  // ── SSE broadcasting ────────────────────────────────────────────────────────

  /**
   * Add an SSE client for alert streaming.
   * Sends the latest 10 alerts immediately on connect.
   */
  addAlertSseClient275(res) {
    if (this._sseClients275.size >= ALERT_SSE_MAX_CLIENTS_275)
      return { ok: false, error: 'max_sse_clients_reached' };

    const clientId = crypto.randomUUID();
    this._sseClients275.set(clientId, res);

    // Send recent history on connect
    const recent = this._history275.slice(-10);
    try {
      res.write(`event: history\ndata: ${JSON.stringify({ alerts: recent, count: this._history275.length })}\n\n`);
    } catch (_) {
      this._sseClients275.delete(clientId);
      return { ok: false, error: 'write_failed' };
    }

    return { ok: true, clientId };
  }

  /**
   * Remove an SSE client.
   */
  removeAlertSseClient275(clientId) {
    this._sseClients275.delete(clientId);
    return { ok: true };
  }

  /**
   * Broadcast an alert to all connected SSE clients.
   */
  _broadcastAlert275(alert) {
    const dead = [];
    const payload = `event: alert\ndata: ${JSON.stringify(alert)}\n\n`;
    for (const [clientId, res] of this._sseClients275) {
      try { res.write(payload); }
      catch (_) { dead.push(clientId); }
    }
    for (const id of dead) this._sseClients275.delete(id);
  }

  /**
   * Start SSE heartbeat to keep connections alive.
   */
  startAlertHeartbeat275() {
    if (this._heartbeatTimer275) return { ok: true, reason: 'already_running' };
    this._heartbeatTimer275 = setInterval(() => {
      const dead = [];
      for (const [clientId, res] of this._sseClients275) {
        try { res.write(': heartbeat\n\n'); }
        catch (_) { dead.push(clientId); }
      }
      for (const id of dead) this._sseClients275.delete(id);
    }, ALERT_SSE_HEARTBEAT_MS_275);
    if (this._heartbeatTimer275.unref) this._heartbeatTimer275.unref();
    return { ok: true };
  }

  // ── History & status ─────────────────────────────────────────────────────────

  /**
   * Get alert history, optionally filtered.
   */
  getHistory275(opts = {}) {
    let alerts = this._history275.slice();
    if (opts.alertType) alerts = alerts.filter(a => a.alertType === opts.alertType);
    if (opts.since)     alerts = alerts.filter(a => a.ts >= opts.since);
    if (opts.limit)     alerts = alerts.slice(-opts.limit);
    return {
      ok:     true,
      alerts,
      total:  this._history275.length,
      filtered: alerts.length,
    };
  }

  /**
   * Get current status of the alert bus.
   */
  getStatus275() {
    return {
      ok:            true,
      version:       ALERT_BUS_VERSION_275,
      subscribed:    this._subscribed275,
      thresholds:    { ...this._thresholds275 },
      historyCount:  this._history275.length,
      sseClients:    this._sseClients275.size,
      lastFired:     { ...this._lastFired275 },
    };
  }

  // ── Telemetry ────────────────────────────────────────────────────────────────

  _recordPerf275(ms) {
    this._perf275.latencies.push(ms);
    if (this._perf275.latencies.length > PERF_RING_MAX_275) this._perf275.latencies.shift();
  }

  getPerf275() {
    const lats = this._perf275.latencies.slice().sort((a, b) => a - b);
    const len  = lats.length;
    if (len === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
    return {
      p50:   lats[Math.floor(len * 0.50)] || 0,
      p95:   lats[Math.floor(len * 0.95)] || 0,
      p99:   lats[Math.floor(len * 0.99)] || 0,
      count: len,
    };
  }

  checkCounterAlertBusHealth275() {
    return {
      ok:           true,
      version:      ALERT_BUS_VERSION_275,
      subscribed:   this._subscribed275,
      sseClients:   this._sseClients275.size,
      historyCount: this._history275.length,
      thresholds:   { ...this._thresholds275 },
    };
  }

  // ── Shutdown ─────────────────────────────────────────────────────────────────

  shutdown275() {
    this.unsubscribe275();
    if (this._heartbeatTimer275) {
      clearInterval(this._heartbeatTimer275);
      this._heartbeatTimer275 = null;
    }
    for (const [, res] of this._sseClients275) {
      try { res.end(); } catch (_) {}
    }
    this._sseClients275.clear();
    return { ok: true };
  }

  // ── Logging ──────────────────────────────────────────────────────────────────

  _log275(event, data) {
    try {
      if (this._logAdapter && typeof this._logAdapter.info === 'function') {
        this._logAdapter.info({ event, ...data, module: 'CounterAlertBus275' });
      } else if (process.env.NODE_ENV !== 'test') {
        this._logger.info?.({ event, ...data }) || this._logger.log?.(event, data);
      }
    } catch (_) {}
  }
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  CounterAlertBus275,
  ALERT_BUS_VERSION_275,
  ALERT_HISTORY_MAX_275,
  ALERT_SSE_MAX_CLIENTS_275,
  ALERT_SSE_HEARTBEAT_MS_275,
  ALERT_COOLDOWN_MS_275,
  DEFAULT_THRESHOLDS_275,
  ALERT_TYPE_SYBIL_FAIL_RATE_275,
  ALERT_TYPE_TIP_CIRCULARITY_275,
  ALERT_TYPE_HALT_ISSUANCE_275,
  ALERT_TYPE_PAUSE_REWARDS_275,
  ALERT_TYPE_MANUAL_OVERRIDE_275,
};
