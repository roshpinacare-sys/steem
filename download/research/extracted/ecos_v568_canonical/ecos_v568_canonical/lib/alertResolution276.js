'use strict';
/**
 * src/lib/alertResolution276.js — ECOS Alert Resolution & Operator Acknowledgement (V276)
 *
 * V276 adds alert lifecycle management on top of the V275 Counter Alert Bus:
 *   - resolveAlert276(alertId)     — marks an alert as resolved + timestamps it
 *   - acknowledgeAlert276(alertId) — operator acknowledgement (ack before resolve)
 *   - getUnresolved276()           — returns only active unresolved alerts
 *   - broadcastResolution276()     — SSE broadcast of resolution events
 *   - manualOverride276()          — wires manualOverride273 events through alert bus
 *
 * Iron rules: zero new npm deps. All identifiers end in 276. Sacred files untouched.
 */

const crypto = require('node:crypto');

const RESOLUTION_VERSION_276         = '276';
const RESOLUTION_HISTORY_MAX_276     = 500;
const RESOLUTION_SSE_MAX_CLIENTS_276 = 200;
const RESOLUTION_SSE_HEARTBEAT_MS_276 = 30_000;

// Resolution event types
const RESOLUTION_EVENT_RESOLVED_276   = 'ALERT_RESOLVED';
const RESOLUTION_EVENT_ACKED_276      = 'ALERT_ACKNOWLEDGED';
const RESOLUTION_EVENT_OVERRIDE_276   = 'MANUAL_OVERRIDE';

class AlertResolution276 {
  /**
   * @param {object} opts
   * @param {object} [opts.counterAlertBus]   — CounterAlertBus275 instance
   * @param {object} [opts.manualOverride]    — manualOverride273 instance (optional)
   * @param {object} [opts.db]                — DB pool (optional, for persistence)
   * @param {object} [opts.logger]
   * @param {object} [opts.logAdapter]
   */
  constructor(opts = {}) {
    this._alertBus276        = opts.counterAlertBus || null;
    this._manualOverride276  = opts.manualOverride || null;
    this._db276              = opts.db || null;
    this._logger276          = opts.logger || console;
    this._logAdapter276      = opts.logAdapter || null;

    // SSE clients for resolution events: Map<clientId, res>
    this._sseClients276     = new Map();
    this._heartbeatTimer276 = null;

    // Local resolution metadata store: Map<alertId, resolutionRecord>
    this._resolutions276    = new Map();

    // Event history for resolution events
    this._eventHistory276   = [];

    // Override wiring state
    this._overrideWired276  = false;
    this._origOverride276   = null;
  }

  // ── Core Resolution Logic ─────────────────────────────────────────────────

  /**
   * Mark an alert as resolved. Updates the alert in CounterAlertBus275 history,
   * stores resolution metadata, broadcasts resolution event over SSE.
   * @param {string} alertId
   * @param {object} [meta] — optional operator notes / context
   * @returns {{ ok, alertId, resolvedAt, error? }}
   */
  resolveAlert276(alertId, meta = {}) {
    if (!alertId) return { ok: false, error: 'alertId required' };

    const resolvedAt = new Date().toISOString();
    const resolution = {
      alertId,
      resolvedAt,
      resolvedBy: meta.resolvedBy || 'operator',
      note: meta.note || '',
      event: RESOLUTION_EVENT_RESOLVED_276,
    };

    // Update in-memory alert history on the bus (if available)
    let alertFound = false;
    if (this._alertBus276 && Array.isArray(this._alertBus276._history275)) {
      for (const alert of this._alertBus276._history275) {
        if (alert.alertId === alertId) {
          alert.resolved      = true;
          alert.resolvedAt    = resolvedAt;
          alert.resolvedBy    = resolution.resolvedBy;
          alert.resolveNote   = resolution.note;
          alertFound = true;
          break;
        }
      }
    }

    // Store resolution locally
    this._resolutions276.set(alertId, resolution);

    // Append to event history (cap at 500)
    this._appendEventHistory276({
      eventId:    crypto.randomUUID(),
      event:      RESOLUTION_EVENT_RESOLVED_276,
      alertId,
      resolvedAt,
      meta:       resolution,
    });

    // Persist to DB if available
    this._persistResolution276(resolution).catch(() => {});

    // Broadcast over SSE
    this._broadcastResolution276(RESOLUTION_EVENT_RESOLVED_276, {
      alertId,
      resolvedAt,
      resolvedBy: resolution.resolvedBy,
      note: resolution.note,
    });

    this._log276('ALERT_RESOLVED', { alertId, resolvedAt, alertFound });

    return { ok: true, alertId, resolvedAt, alertFound };
  }

  /**
   * Acknowledge an alert (operator has seen it, not yet resolved).
   */
  acknowledgeAlert276(alertId, meta = {}) {
    if (!alertId) return { ok: false, error: 'alertId required' };

    const ackedAt = new Date().toISOString();
    const ackRecord = {
      alertId,
      ackedAt,
      ackedBy: meta.ackedBy || 'operator',
      note: meta.note || '',
      event: RESOLUTION_EVENT_ACKED_276,
    };

    // Mark ack in bus history
    let alertFound = false;
    if (this._alertBus276 && Array.isArray(this._alertBus276._history275)) {
      for (const alert of this._alertBus276._history275) {
        if (alert.alertId === alertId) {
          alert.acknowledged   = true;
          alert.acknowledgedAt = ackedAt;
          alert.acknowledgedBy = ackRecord.ackedBy;
          alertFound = true;
          break;
        }
      }
    }

    this._appendEventHistory276({
      eventId:  crypto.randomUUID(),
      event:    RESOLUTION_EVENT_ACKED_276,
      alertId,
      ackedAt,
      meta:     ackRecord,
    });

    this._broadcastResolution276(RESOLUTION_EVENT_ACKED_276, {
      alertId,
      ackedAt,
      ackedBy: ackRecord.ackedBy,
    });

    this._log276('ALERT_ACKED', { alertId, ackedAt, alertFound });

    return { ok: true, alertId, ackedAt, alertFound };
  }

  /**
   * Get all unresolved (active) alerts from the bus history.
   * @returns {{ ok, alerts, total, unresolved }}
   */
  getUnresolved276(opts = {}) {
    const { alertType, since, limit = 100 } = opts;

    let alerts = [];
    if (this._alertBus276 && Array.isArray(this._alertBus276._history275)) {
      alerts = this._alertBus276._history275.filter(a => !a.resolved);
    }

    if (alertType) alerts = alerts.filter(a => a.alertType === alertType);
    if (since) {
      const sinceTs = new Date(since).getTime();
      alerts = alerts.filter(a => new Date(a.ts).getTime() >= sinceTs);
    }

    const total     = alerts.length;
    const paginated = alerts.slice(-limit);

    return { ok: true, alerts: paginated, total, unresolved: total };
  }

  // ── Manual Override Wiring ─────────────────────────────────────────────────

  /**
   * Wire manualOverride273 events through the alert bus so operators see them
   * as MANUAL_OVERRIDE alert events in the SSE stream.
   */
  wireManualOverride276() {
    if (!this._manualOverride276) {
      this._log276('WIRE_OVERRIDE_SKIPPED', { reason: 'no_manual_override' });
      return { ok: true, wired: false, reason: 'no_manual_override' };
    }
    if (this._overrideWired276) {
      return { ok: true, wired: true, reason: 'already_wired' };
    }

    const self = this;
    const overrideFnName = this._detectOverrideFn276();

    if (!overrideFnName) {
      return { ok: false, wired: false, reason: 'no_override_method_found' };
    }

    const orig = this._manualOverride276[overrideFnName].bind(this._manualOverride276);
    this._origOverride276 = this._manualOverride276[overrideFnName];

    this._manualOverride276[overrideFnName] = function _manualOverrideHooked276(...args) {
      const result = orig(...args);
      try { self._onManualOverride276(...args); } catch (_) {}
      return result;
    };

    this._overrideWired276 = true;
    this._log276('WIRE_OVERRIDE_OK', { fn: overrideFnName });
    return { ok: true, wired: true, fn: overrideFnName };
  }

  unwireManualOverride276() {
    if (!this._overrideWired276 || !this._origOverride276) {
      return { ok: true, unwired: false };
    }
    const fnName = this._detectOverrideFn276();
    if (fnName && this._manualOverride276) {
      this._manualOverride276[fnName] = this._origOverride276;
    }
    this._overrideWired276 = false;
    this._origOverride276  = null;
    return { ok: true, unwired: true };
  }

  _detectOverrideFn276() {
    if (!this._manualOverride276) return null;
    for (const fn of ['applyManualOverride273', 'override273', 'apply273', 'execute']) {
      if (typeof this._manualOverride276[fn] === 'function') return fn;
    }
    return null;
  }

  _onManualOverride276(...args) {
    const ts      = new Date().toISOString();
    const alertId = 'ov-' + crypto.randomUUID();

    const overrideAlert = {
      alertId,
      alertType:  RESOLUTION_EVENT_OVERRIDE_276,
      ts,
      resolved:   false,
      context:    { args: args.map(a => typeof a === 'object' ? Object.keys(a) : a) },
    };

    // Inject into bus history if available
    if (this._alertBus276 && Array.isArray(this._alertBus276._history275)) {
      this._alertBus276._history275.push(overrideAlert);
      if (this._alertBus276._history275.length > 500)
        this._alertBus276._history275.shift();
    }

    this._appendEventHistory276({
      eventId: crypto.randomUUID(),
      event:   RESOLUTION_EVENT_OVERRIDE_276,
      alertId,
      ts,
      meta:    overrideAlert,
    });

    // Broadcast over alert bus SSE (if available)
    if (this._alertBus276 && typeof this._alertBus276._broadcastAlert275 === 'function') {
      try { this._alertBus276._broadcastAlert275(overrideAlert); } catch (_) {}
    }

    // Also broadcast over resolution SSE
    this._broadcastResolution276(RESOLUTION_EVENT_OVERRIDE_276, overrideAlert);
  }

  // ── SSE Client Management ─────────────────────────────────────────────────

  addResolutionSseClient276(res) {
    if (this._sseClients276.size >= RESOLUTION_SSE_MAX_CLIENTS_276) {
      res.status(503).json({ ok: false, error: 'too_many_sse_clients', ecosVersion: '276' });
      return null;
    }

    const clientId = crypto.randomUUID();
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    this._sseClients276.set(clientId, res);

    // Send recent event history on connect
    const recent = this._eventHistory276.slice(-10);
    this._sseWrite276(res, 'history', { events: recent, count: recent.length });

    res.on('close', () => this.removeResolutionSseClient276(clientId));

    return clientId;
  }

  removeResolutionSseClient276(clientId) {
    this._sseClients276.delete(clientId);
    return { ok: true, clientId };
  }

  startResolutionHeartbeat276() {
    if (this._heartbeatTimer276) return;
    this._heartbeatTimer276 = setInterval(() => {
      for (const res of this._sseClients276.values()) {
        try { res.write(': heartbeat\n\n'); } catch (_) {}
      }
    }, RESOLUTION_SSE_HEARTBEAT_MS_276);
    if (this._heartbeatTimer276.unref) this._heartbeatTimer276.unref();
  }

  _broadcastResolution276(eventType, data) {
    const payload = JSON.stringify({ eventType, data, ecosVersion: '276', ts: new Date().toISOString() });
    for (const res of this._sseClients276.values()) {
      try { this._sseWrite276(res, 'resolution', JSON.parse(payload)); } catch (_) {}
    }
  }

  _sseWrite276(res, event, data) {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (_) {}
  }

  // ── DB Persistence ────────────────────────────────────────────────────────

  async _persistResolution276(resolution) {
    if (!this._db276) return;
    try {
      await this._db276.query(
        `INSERT INTO credit_alert_history276
           (alert_id, event_type, resolved_at, resolved_by, note, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (alert_id) DO UPDATE
           SET event_type = EXCLUDED.event_type,
               resolved_at = EXCLUDED.resolved_at,
               resolved_by = EXCLUDED.resolved_by,
               note = EXCLUDED.note`,
        [resolution.alertId, resolution.event, resolution.resolvedAt,
         resolution.resolvedBy, resolution.note]
      );
    } catch (_) { /* best-effort, never throw */ }
  }

  // ── History / Status ──────────────────────────────────────────────────────

  getEventHistory276(opts = {}) {
    const { since, limit = 100 } = opts;
    let events = this._eventHistory276.slice();
    if (since) {
      const ts = new Date(since).getTime();
      events = events.filter(e => new Date(e.ts || e.resolvedAt || e.ackedAt || 0).getTime() >= ts);
    }
    return { ok: true, events: events.slice(-limit), total: events.length };
  }

  checkAlertResolutionHealth276() {
    return {
      ok: true,
      version:        RESOLUTION_VERSION_276,
      wiredOverride:  this._overrideWired276,
      sseClients:     this._sseClients276.size,
      eventHistory:   this._eventHistory276.length,
      resolutions:    this._resolutions276.size,
    };
  }

  getStatus276() {
    return {
      ok: true,
      version:       RESOLUTION_VERSION_276,
      wiredOverride: this._overrideWired276,
      sseClients:    this._sseClients276.size,
      eventHistory:  this._eventHistory276.length,
      resolutions:   this._resolutions276.size,
    };
  }

  shutdown276() {
    if (this._heartbeatTimer276) {
      clearInterval(this._heartbeatTimer276);
      this._heartbeatTimer276 = null;
    }
    for (const res of this._sseClients276.values()) {
      try { res.end(); } catch (_) {}
    }
    this._sseClients276.clear();
    this.unwireManualOverride276();
    return { ok: true, shutdown: true };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  _appendEventHistory276(record) {
    this._eventHistory276.push(record);
    if (this._eventHistory276.length > RESOLUTION_HISTORY_MAX_276)
      this._eventHistory276.shift();
  }

  _log276(event, data) {
    if (this._logAdapter276 && typeof this._logAdapter276.log === 'function') {
      try { this._logAdapter276.log({ event, data, ts: new Date().toISOString() }); } catch (_) {}
    }
  }
}

// ── DB Schema Helper ──────────────────────────────────────────────────────────

const CREDIT_ALERT_HISTORY_TABLE_276 = `
CREATE TABLE IF NOT EXISTS credit_alert_history276 (
  alert_id    TEXT PRIMARY KEY,
  event_type  TEXT NOT NULL,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
`;

module.exports = {
  AlertResolution276,
  RESOLUTION_VERSION_276,
  RESOLUTION_EVENT_RESOLVED_276,
  RESOLUTION_EVENT_ACKED_276,
  RESOLUTION_EVENT_OVERRIDE_276,
  RESOLUTION_SSE_MAX_CLIENTS_276,
  CREDIT_ALERT_HISTORY_TABLE_276,
};
