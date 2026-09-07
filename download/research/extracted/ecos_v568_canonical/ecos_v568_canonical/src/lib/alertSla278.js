'use strict';
/**
 * src/lib/alertSla278.js — ECOS Alert SLA Timers & Breach Detection (V278)
 *
 * V278 adds SLA timer management and breach detection on top of the V277 escalation lifecycle:
 *   - registerAlertSla278(alertType, opts)  — define SLA duration per alert type
 *   - checkSlaBreach278(alertId)            — on-demand SLA status for a single alert
 *   - getBreachedAlerts278()               — all currently breached unresolved alerts
 *   - getSlaStatus278()                    — SLA config + live breach counts
 *   - startSlaWatchdog278()                — background timer checking for breaches
 *
 * Iron rules: zero new npm deps. All identifiers end in 278. Sacred files untouched.
 */

const crypto = require('node:crypto');

const SLA_VERSION_278             = '278';
const SLA_HISTORY_MAX_278         = 500;
const SLA_SSE_MAX_CLIENTS_278     = 200;
const SLA_SSE_HEARTBEAT_MS_278    = 30_000;
const SLA_WATCHDOG_INTERVAL_278   = 5_000; // check every 5 s

// SLA event types
const SLA_EVENT_WARNING_278       = 'SLA_WARNING';
const SLA_EVENT_BREACH_278        = 'SLA_BREACH';
const SLA_EVENT_REGISTERED_278    = 'SLA_REGISTERED';
const SLA_EVENT_RESOLVED_278      = 'SLA_RESOLVED';

// SLA status values
const SLA_STATUS_OK_278           = 'OK';
const SLA_STATUS_WARNING_278      = 'WARNING';
const SLA_STATUS_BREACHED_278     = 'BREACHED';
const SLA_STATUS_RESOLVED_278     = 'RESOLVED';

class AlertSla278 {
  /**
   * @param {object} opts
   * @param {object} [opts.counterAlertBus]   — CounterAlertBus275 instance
   * @param {object} [opts.alertResolution]   — AlertResolution276 instance (optional)
   * @param {object} [opts.alertEscalation]   — AlertEscalation277 instance (optional, for auto-escalate)
   * @param {object} [opts.db]                — DB pool (optional, for persistence)
   * @param {object} [opts.logger]
   * @param {object} [opts.logAdapter]
   */
  constructor(opts = {}) {
    this._alertBus278       = opts.counterAlertBus || null;
    this._resolution278     = opts.alertResolution || null;
    this._escalation278     = opts.alertEscalation || null;
    this._db278             = opts.db || null;
    this._logger278         = opts.logger || console;
    this._logAdapter278     = opts.logAdapter || null;

    // SLA config per alert type: Map<alertType, slaConfig>
    this._slaConfigs278     = new Map();

    // Alert SLA tracking: Map<alertId, slaRecord>
    this._slaRecords278     = new Map();

    // Event history (capped at 500)
    this._eventHistory278   = [];

    // SSE clients for SLA events: Map<clientId, res>
    this._sseClients278     = new Map();

    // Background watchdog timer
    this._watchdogTimer278  = null;
    this._heartbeatTimer278 = null;
  }

  // ── SLA Registration ───────────────────────────────────────────────────────

  /**
   * Register an SLA definition for an alert type.
   *
   * @param {string} alertType      — alert type key (e.g. 'SYBIL_FAIL_RATE')
   * @param {object} opts
   * @param {number} opts.warningMs  — ms after creation to fire SLA_WARNING (default 300000 = 5 min)
   * @param {number} opts.breachMs   — ms after creation to fire SLA_BREACH  (default 900000 = 15 min)
   * @param {boolean} [opts.autoEscalate] — auto-escalate to CRITICAL on breach (default false)
   * @returns {{ ok, alertType, warningMs, breachMs, autoEscalate }}
   */
  registerAlertSla278(alertType, opts = {}) {
    if (!alertType) return { ok: false, error: 'alertType required' };

    const warningMs    = Number(opts.warningMs)    || 300_000;  // 5 min default
    const breachMs     = Number(opts.breachMs)     || 900_000;  // 15 min default
    const autoEscalate = Boolean(opts.autoEscalate);

    if (warningMs >= breachMs) {
      return { ok: false, error: 'warningMs must be less than breachMs' };
    }

    const config = {
      alertType,
      warningMs,
      breachMs,
      autoEscalate,
      registeredAt: new Date().toISOString(),
    };

    this._slaConfigs278.set(alertType, config);

    this._appendEventHistory278({
      eventId:      crypto.randomUUID(),
      event:        SLA_EVENT_REGISTERED_278,
      alertType,
      warningMs,
      breachMs,
      autoEscalate,
      ts:           config.registeredAt,
    });

    this._broadcastSla278(SLA_EVENT_REGISTERED_278, { alertType, warningMs, breachMs, autoEscalate });
    this._log278(SLA_EVENT_REGISTERED_278, { alertType, warningMs, breachMs, autoEscalate });

    return { ok: true, alertType, warningMs, breachMs, autoEscalate };
  }

  /**
   * Get SLA config for a specific alert type.
   */
  getSlaConfig278(alertType) {
    if (!alertType) return { ok: false, error: 'alertType required' };
    const config = this._slaConfigs278.get(alertType);
    if (!config) return { ok: false, error: 'no SLA config for alertType', alertType };
    return { ok: true, ...config };
  }

  /**
   * Remove an SLA config for an alert type.
   */
  deregisterAlertSla278(alertType) {
    if (!alertType) return { ok: false, error: 'alertType required' };
    if (!this._slaConfigs278.has(alertType)) return { ok: false, error: 'SLA config not found' };
    this._slaConfigs278.delete(alertType);
    return { ok: true, alertType, deregisteredAt: new Date().toISOString() };
  }

  // ── SLA Breach Checking ────────────────────────────────────────────────────

  /**
   * On-demand SLA status for a single alert.
   *
   * @param {string} alertId
   * @returns {{ ok, alertId, status, ageMs, slaConfig, warningFiredAt?, breachFiredAt? }}
   */
  checkSlaBreach278(alertId) {
    if (!alertId) return { ok: false, error: 'alertId required' };

    // Find the alert in the bus history
    const alert = this._findAlert278(alertId);
    if (!alert) return { ok: false, error: 'alert not found', alertId };

    // If already resolved, return resolved status
    if (alert.resolved) {
      return { ok: true, alertId, status: SLA_STATUS_RESOLVED_278, resolved: true };
    }

    const config = this._slaConfigs278.get(alert.alertType || alert.type || '');
    if (!config) {
      return { ok: true, alertId, status: SLA_STATUS_OK_278, noSlaConfig: true };
    }

    const createdAt = alert.ts || alert.createdAt || alert.registeredAt;
    const ageMs     = createdAt ? Date.now() - new Date(createdAt).getTime() : 0;

    let status = SLA_STATUS_OK_278;
    if (ageMs >= config.breachMs)       status = SLA_STATUS_BREACHED_278;
    else if (ageMs >= config.warningMs) status = SLA_STATUS_WARNING_278;

    // Get any tracked SLA record for this alert
    const record = this._slaRecords278.get(alertId) || {};

    return {
      ok:          true,
      alertId,
      status,
      ageMs,
      warningMs:   config.warningMs,
      breachMs:    config.breachMs,
      autoEscalate: config.autoEscalate,
      warningFiredAt: record.warningFiredAt || null,
      breachFiredAt:  record.breachFiredAt  || null,
      createdAt,
    };
  }

  /**
   * Run SLA checks on all active alerts in the bus.
   * Called by the watchdog and can be called on-demand.
   *
   * @returns {{ ok, checked, warnings, breaches }}
   */
  runSlaCheck278() {
    const alerts = this._getActiveAlerts278();
    let warnings = 0;
    let breaches = 0;

    for (const alert of alerts) {
      const alertId   = alert.alertId;
      const alertType = alert.alertType || alert.type || '';
      const config    = this._slaConfigs278.get(alertType);
      if (!config) continue;

      const createdAt = alert.ts || alert.createdAt || alert.registeredAt;
      if (!createdAt) continue;

      const ageMs  = Date.now() - new Date(createdAt).getTime();
      const record = this._slaRecords278.get(alertId) || { alertId, alertType };

      // Check for warning
      if (ageMs >= config.warningMs && !record.warningFiredAt) {
        record.warningFiredAt = new Date().toISOString();
        this._slaRecords278.set(alertId, record);
        this._fireSlaEvent278(SLA_EVENT_WARNING_278, alert, config, ageMs);
        warnings++;
      }

      // Check for breach
      if (ageMs >= config.breachMs && !record.breachFiredAt) {
        record.breachFiredAt = new Date().toISOString();
        this._slaRecords278.set(alertId, record);
        this._fireSlaEvent278(SLA_EVENT_BREACH_278, alert, config, ageMs);
        breaches++;

        // Auto-escalate if configured
        if (config.autoEscalate && this._escalation278) {
          try {
            this._escalation278.escalateAlert277(alertId, {
              escalatedTo: 'sla-watchdog',
              escalatedBy: 'sla-watchdog-278',
              priority:    'CRITICAL',
              reason:      `SLA breached after ${Math.round(ageMs / 1000)}s (limit: ${config.breachMs}ms)`,
            });
          } catch (_) { /* best-effort */ }
        }
      }
    }

    return { ok: true, checked: alerts.length, warnings, breaches };
  }

  // ── Query Methods ──────────────────────────────────────────────────────────

  /**
   * Get all currently breached unresolved alerts.
   * @param {object} [opts]
   * @param {string} [opts.alertType]  — filter by alert type
   * @returns {{ ok, alerts, total }}
   */
  getBreachedAlerts278(opts = {}) {
    const alerts = this._getActiveAlerts278();
    const { alertType } = opts;
    const now = Date.now();

    const breached = alerts.filter(alert => {
      const type   = alert.alertType || alert.type || '';
      const config = this._slaConfigs278.get(type);
      if (!config) return false;
      if (alertType && type !== alertType) return false;

      const createdAt = alert.ts || alert.createdAt || alert.registeredAt;
      if (!createdAt) return false;

      const ageMs = now - new Date(createdAt).getTime();
      return ageMs >= config.breachMs;
    });

    return { ok: true, alerts: breached, total: breached.length };
  }

  /**
   * Get all alerts currently in WARNING state (not yet breached).
   * @returns {{ ok, alerts, total }}
   */
  getWarningAlerts278() {
    const alerts = this._getActiveAlerts278();
    const now = Date.now();

    const warning = alerts.filter(alert => {
      const type   = alert.alertType || alert.type || '';
      const config = this._slaConfigs278.get(type);
      if (!config) return false;

      const createdAt = alert.ts || alert.createdAt || alert.registeredAt;
      if (!createdAt) return false;

      const ageMs = now - new Date(createdAt).getTime();
      return ageMs >= config.warningMs && ageMs < config.breachMs;
    });

    return { ok: true, alerts: warning, total: warning.length };
  }

  /**
   * SLA configuration + live breach counts.
   * @returns {{ ok, configs, breachCounts, warnCounts, totalAlerts }}
   */
  getSlaStatus278() {
    const configs      = [];
    const breachCounts = {};
    const warnCounts   = {};
    const now          = Date.now();

    for (const [alertType, config] of this._slaConfigs278.entries()) {
      configs.push({ alertType, ...config });
      breachCounts[alertType] = 0;
      warnCounts[alertType]   = 0;
    }

    const alerts = this._getActiveAlerts278();
    for (const alert of alerts) {
      const type   = alert.alertType || alert.type || '';
      const config = this._slaConfigs278.get(type);
      if (!config) continue;

      const createdAt = alert.ts || alert.createdAt || alert.registeredAt;
      if (!createdAt) continue;

      const ageMs = now - new Date(createdAt).getTime();
      if (ageMs >= config.breachMs)       breachCounts[type] = (breachCounts[type] || 0) + 1;
      else if (ageMs >= config.warningMs) warnCounts[type]   = (warnCounts[type]   || 0) + 1;
    }

    return {
      ok:          true,
      version:     SLA_VERSION_278,
      configs,
      breachCounts,
      warnCounts,
      totalAlerts: alerts.length,
      configCount: this._slaConfigs278.size,
      slaRecords:  this._slaRecords278.size,
    };
  }

  // ── Watchdog ───────────────────────────────────────────────────────────────

  /**
   * Start background watchdog that periodically checks for SLA breaches.
   * @param {number} [intervalMs]  — check interval (default: 5000)
   */
  startSlaWatchdog278(intervalMs) {
    if (this._watchdogTimer278) return { ok: true, alreadyRunning: true };
    const ms = Number(intervalMs) || SLA_WATCHDOG_INTERVAL_278;
    this._watchdogTimer278 = setInterval(() => {
      try { this.runSlaCheck278(); } catch (_) {}
    }, ms);
    if (this._watchdogTimer278.unref) this._watchdogTimer278.unref();
    return { ok: true, intervalMs: ms };
  }

  stopSlaWatchdog278() {
    if (this._watchdogTimer278) {
      clearInterval(this._watchdogTimer278);
      this._watchdogTimer278 = null;
    }
    return { ok: true, stopped: true };
  }

  // ── SSE Client Management ──────────────────────────────────────────────────

  addSlaSseClient278(res) {
    if (this._sseClients278.size >= SLA_SSE_MAX_CLIENTS_278) {
      res.status(503).json({ ok: false, error: 'too_many_sse_clients', ecosVersion: '278' });
      return null;
    }

    const clientId = crypto.randomUUID();
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    this._sseClients278.set(clientId, res);

    // Send last 10 events as history on connect
    const recent = this._eventHistory278.slice(-10);
    this._sseWrite278(res, 'history', { events: recent, count: recent.length });

    res.on('close', () => this.removeSlaSseClient278(clientId));

    return clientId;
  }

  removeSlaSseClient278(clientId) {
    this._sseClients278.delete(clientId);
    return { ok: true, clientId };
  }

  startSlaHeartbeat278() {
    if (this._heartbeatTimer278) return;
    this._heartbeatTimer278 = setInterval(() => {
      for (const res of this._sseClients278.values()) {
        try { res.write(': heartbeat\n\n'); } catch (_) {}
      }
    }, SLA_SSE_HEARTBEAT_MS_278);
    if (this._heartbeatTimer278.unref) this._heartbeatTimer278.unref();
  }

  // ── History / Health ───────────────────────────────────────────────────────

  getEventHistory278(opts = {}) {
    const { since, limit = 100 } = opts;
    let events = this._eventHistory278.slice();
    if (since) {
      const ts = new Date(since).getTime();
      events = events.filter(e => new Date(e.ts || 0).getTime() >= ts);
    }
    return { ok: true, events: events.slice(-limit), total: events.length };
  }

  checkAlertSlaHealth278() {
    return {
      ok:          true,
      version:     SLA_VERSION_278,
      configCount: this._slaConfigs278.size,
      slaRecords:  this._slaRecords278.size,
      sseClients:  this._sseClients278.size,
      eventHistory: this._eventHistory278.length,
      watchdogActive: Boolean(this._watchdogTimer278),
    };
  }

  getStatus278() {
    return this.checkAlertSlaHealth278();
  }

  shutdown278() {
    this.stopSlaWatchdog278();
    if (this._heartbeatTimer278) {
      clearInterval(this._heartbeatTimer278);
      this._heartbeatTimer278 = null;
    }
    for (const res of this._sseClients278.values()) {
      try { res.end(); } catch (_) {}
    }
    this._sseClients278.clear();
    return { ok: true, shutdown: true };
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  _fireSlaEvent278(eventType, alert, config, ageMs) {
    const eventId  = crypto.randomUUID();
    const ts       = new Date().toISOString();
    const alertId  = alert.alertId;
    const alertType = alert.alertType || alert.type || '';

    const payload = {
      eventId,
      event:       eventType,
      alertId,
      alertType,
      ageMs,
      warningMs:   config.warningMs,
      breachMs:    config.breachMs,
      autoEscalate: config.autoEscalate,
      ts,
    };

    this._appendEventHistory278({ ...payload });
    this._broadcastSla278(eventType, payload);
    this._log278(eventType, payload);

    // Persist to DB
    this._persistSlaEvent278(payload).catch(() => {});
  }

  _getActiveAlerts278() {
    if (this._alertBus278 && Array.isArray(this._alertBus278._history275)) {
      return this._alertBus278._history275.filter(a => !a.resolved);
    }
    return [];
  }

  _findAlert278(alertId) {
    if (this._alertBus278 && Array.isArray(this._alertBus278._history275)) {
      return this._alertBus278._history275.find(a => a.alertId === alertId) || null;
    }
    return null;
  }

  _broadcastSla278(eventType, data) {
    const payload = JSON.stringify({ eventType, data, ecosVersion: '278', ts: new Date().toISOString() });
    for (const res of this._sseClients278.values()) {
      try { this._sseWrite278(res, 'sla', JSON.parse(payload)); } catch (_) {}
    }
  }

  _sseWrite278(res, event, data) {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (_) {}
  }

  async _persistSlaEvent278(payload) {
    if (!this._db278) return;
    try {
      await this._db278.query(
        `INSERT INTO credit_alert_sla_events278
           (event_id, event_type, alert_id, alert_type, age_ms, warning_ms, breach_ms, auto_escalate, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (event_id) DO NOTHING`,
        [
          payload.eventId, payload.event, payload.alertId, payload.alertType,
          payload.ageMs, payload.warningMs, payload.breachMs, payload.autoEscalate,
        ]
      );
    } catch (_) { /* best-effort, never throw */ }
  }

  _appendEventHistory278(record) {
    this._eventHistory278.push(record);
    if (this._eventHistory278.length > SLA_HISTORY_MAX_278)
      this._eventHistory278.shift();
  }

  _log278(event, data) {
    if (this._logAdapter278 && typeof this._logAdapter278.log === 'function') {
      try { this._logAdapter278.log({ event, data, ts: new Date().toISOString() }); } catch (_) {}
    }
  }
}

// ── DB Schema Helper ──────────────────────────────────────────────────────────

const CREDIT_ALERT_SLA_EVENTS_TABLE_278 = `
CREATE TABLE IF NOT EXISTS credit_alert_sla_events278 (
  event_id     TEXT PRIMARY KEY,
  event_type   TEXT NOT NULL,
  alert_id     TEXT NOT NULL,
  alert_type   TEXT,
  age_ms       BIGINT,
  warning_ms   BIGINT,
  breach_ms    BIGINT,
  auto_escalate BOOLEAN DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
`;

module.exports = {
  AlertSla278,
  SLA_VERSION_278,
  SLA_HISTORY_MAX_278,
  SLA_SSE_MAX_CLIENTS_278,
  SLA_EVENT_WARNING_278,
  SLA_EVENT_BREACH_278,
  SLA_EVENT_REGISTERED_278,
  SLA_EVENT_RESOLVED_278,
  SLA_STATUS_OK_278,
  SLA_STATUS_WARNING_278,
  SLA_STATUS_BREACHED_278,
  SLA_STATUS_RESOLVED_278,
  CREDIT_ALERT_SLA_EVENTS_TABLE_278,
};
