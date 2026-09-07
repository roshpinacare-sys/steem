'use strict';
/**
 * src/lib/alertDigest279.js — ECOS Alert Aggregation & Digest Reporting (V279)
 *
 * V279 adds alert aggregation and digest generation on top of the V278 SLA lifecycle:
 *   - aggregateAlerts279(opts)           — group alerts by type, severity, assignee
 *   - generateAlertDigest279(opts)       — human-readable digest object
 *   - startDigestScheduler279(intervalMs) — scheduled periodic digest via setInterval
 *   - stopDigestScheduler279()           — stop the scheduler
 *   - getDigestHistory279(opts)          — past generated digests (capped)
 *
 * Iron rules: zero new npm deps. All identifiers end in 279. Sacred files untouched.
 */

const crypto = require('node:crypto');

const DIGEST_VERSION_279           = '279';
const DIGEST_HISTORY_MAX_279       = 200;
const DIGEST_SCHEDULER_DEFAULT_279 = 60_000; // 1-minute default digest interval
const DIGEST_SSE_MAX_CLIENTS_279   = 200;
const DIGEST_SSE_HEARTBEAT_MS_279  = 30_000;

// Digest event types
const DIGEST_EVENT_GENERATED_279   = 'DIGEST_GENERATED';
const DIGEST_EVENT_SCHEDULED_279   = 'DIGEST_SCHEDULED';
const DIGEST_EVENT_STOPPED_279     = 'DIGEST_STOPPED';

class AlertDigest279 {
  /**
   * @param {object} opts
   * @param {object} [opts.counterAlertBus]   — CounterAlertBus275 instance
   * @param {object} [opts.alertResolution]   — AlertResolution276 instance (optional)
   * @param {object} [opts.alertEscalation]   — AlertEscalation277 instance (optional)
   * @param {object} [opts.alertSla]          — AlertSla278 instance (optional, for breach/warning data)
   * @param {object} [opts.db]                — DB pool (optional, for persistence)
   * @param {object} [opts.logger]
   * @param {object} [opts.logAdapter]
   */
  constructor(opts = {}) {
    this._alertBus279      = opts.counterAlertBus || null;
    this._resolution279    = opts.alertResolution || null;
    this._escalation279    = opts.alertEscalation || null;
    this._sla279           = opts.alertSla        || null;
    this._db279            = opts.db              || null;
    this._logger279        = opts.logger          || console;
    this._logAdapter279    = opts.logAdapter      || null;

    // Digest history (capped at 200)
    this._digestHistory279 = [];

    // Scheduler state
    this._schedulerTimer279    = null;
    this._schedulerInterval279 = null;
    this._heartbeatTimer279    = null;

    // SSE clients for digest events: Map<clientId, res>
    this._sseClients279 = new Map();
  }

  // ── Aggregation ────────────────────────────────────────────────────────────

  /**
   * Aggregate active alerts by type, severity, and/or assignee.
   *
   * @param {object} [opts]
   * @param {string} [opts.groupBy]    — 'type' | 'severity' | 'assignee' | 'all' (default: 'all')
   * @param {boolean} [opts.includeResolved]  — include resolved alerts (default: false)
   * @returns {{ ok, byType, bySeverity, byAssignee, topBreachedTypes, escalationSummary,
   *             totalAlerts, unresolvedCount, escalatedCount, ts }}
   */
  aggregateAlerts279(opts = {}) {
    const { groupBy = 'all', includeResolved = false } = opts;

    const allAlerts   = this._getAllAlerts279(includeResolved);
    const now         = Date.now();

    // Group by type
    const byType = {};
    // Group by severity
    const bySeverity = {};
    // Group by assignee
    const byAssignee = {};

    let escalatedCount  = 0;
    let unresolvedCount = 0;

    for (const alert of allAlerts) {
      const type     = alert.alertType || alert.type || 'UNKNOWN';
      const severity = alert.severity  || alert.priority || 'INFO';
      const assignee = alert.assignee  || null;

      if (!alert.resolved) unresolvedCount++;
      if (alert.escalated) escalatedCount++;

      // byType
      if (!byType[type]) byType[type] = { count: 0, resolved: 0, escalated: 0, oldest: null };
      byType[type].count++;
      if (alert.resolved)  byType[type].resolved++;
      if (alert.escalated) byType[type].escalated++;
      const alertAge = alert.ts ? now - new Date(alert.ts).getTime() : 0;
      if (byType[type].oldest === null || alertAge > byType[type].oldest) {
        byType[type].oldest = alertAge;
      }

      // bySeverity
      if (!bySeverity[severity]) bySeverity[severity] = { count: 0, resolved: 0, escalated: 0 };
      bySeverity[severity].count++;
      if (alert.resolved)  bySeverity[severity].resolved++;
      if (alert.escalated) bySeverity[severity].escalated++;

      // byAssignee
      if (assignee) {
        if (!byAssignee[assignee]) byAssignee[assignee] = { count: 0, resolved: 0, escalated: 0 };
        byAssignee[assignee].count++;
        if (alert.resolved)  byAssignee[assignee].resolved++;
        if (alert.escalated) byAssignee[assignee].escalated++;
      }
    }

    // Top breached types (uses SLA module if available)
    const topBreachedTypes = this._getTopBreachedTypes279(byType);

    // Escalation summary
    const escalationSummary = {
      totalEscalated:    escalatedCount,
      byType:            Object.entries(byType)
        .filter(([, v]) => v.escalated > 0)
        .map(([t, v]) => ({ type: t, escalated: v.escalated }))
        .sort((a, b) => b.escalated - a.escalated),
    };

    const result = {
      ok:               true,
      version:          DIGEST_VERSION_279,
      byType,
      bySeverity,
      byAssignee,
      topBreachedTypes,
      escalationSummary,
      totalAlerts:      allAlerts.length,
      unresolvedCount,
      escalatedCount,
      ts:               new Date().toISOString(),
    };

    if (groupBy !== 'all') {
      // Return only the requested grouping + summary fields
      const pick = { ok: true, version: DIGEST_VERSION_279, ts: result.ts,
                     totalAlerts: allAlerts.length, unresolvedCount, escalatedCount };
      if (groupBy === 'type')     pick.byType     = byType;
      if (groupBy === 'severity') pick.bySeverity = bySeverity;
      if (groupBy === 'assignee') pick.byAssignee = byAssignee;
      return pick;
    }

    return result;
  }

  /**
   * Generate a human-readable digest object suitable for email/Slack delivery.
   *
   * @param {object} [opts]
   * @param {string} [opts.period]      — label for the period (default: 'last interval')
   * @param {boolean} [opts.includeResolved] — include resolved alerts (default: false)
   * @returns {{ ok, digestId, period, totalAlerts, unresolved, breached, warned,
   *             escalated, topTypes, escalationSummary, slaSnapshot, ts }}
   */
  generateAlertDigest279(opts = {}) {
    const { period = 'last interval', includeResolved = false } = opts;

    const agg      = this.aggregateAlerts279({ groupBy: 'all', includeResolved });
    const slaSnap  = this._sla279 ? this._getSlaSnapshot279() : null;

    const digestId = crypto.randomUUID();
    const ts       = new Date().toISOString();

    // Top types: sorted by unresolved count desc, top 5
    const topTypes = Object.entries(agg.byType)
      .map(([type, v]) => ({
        type,
        total:     v.count,
        unresolved: v.count - v.resolved,
        escalated: v.escalated,
        oldestAgeMs: v.oldest || 0,
      }))
      .sort((a, b) => b.unresolved - a.unresolved || b.total - a.total)
      .slice(0, 5);

    const digest = {
      ok:                true,
      digestId,
      version:           DIGEST_VERSION_279,
      period,
      totalAlerts:       agg.totalAlerts,
      unresolved:        agg.unresolvedCount,
      breached:          slaSnap ? slaSnap.totalBreached : null,
      warned:            slaSnap ? slaSnap.totalWarned   : null,
      escalated:         agg.escalatedCount,
      topTypes,
      escalationSummary: agg.escalationSummary,
      slaSnapshot:       slaSnap,
      ts,
    };

    // Store in history
    this._appendDigestHistory279(digest);

    // Broadcast over SSE
    this._broadcastDigest279(DIGEST_EVENT_GENERATED_279, digest);

    // Log
    this._log279(DIGEST_EVENT_GENERATED_279, { digestId, totalAlerts: digest.totalAlerts });

    // Persist to DB
    this._persistDigest279(digest).catch(() => {});

    return digest;
  }

  // ── Scheduler ──────────────────────────────────────────────────────────────

  /**
   * Start a background scheduler that generates a digest at regular intervals.
   *
   * @param {number} [intervalMs]  — interval in ms (default: 60000 = 1 min)
   * @returns {{ ok, intervalMs, alreadyRunning? }}
   */
  startDigestScheduler279(intervalMs) {
    if (this._schedulerTimer279) return { ok: true, alreadyRunning: true };
    const ms = Number(intervalMs) || DIGEST_SCHEDULER_DEFAULT_279;
    this._schedulerInterval279 = ms;
    this._schedulerTimer279 = setInterval(() => {
      try { this.generateAlertDigest279({ period: `scheduler-${new Date().toISOString()}` }); } catch (_) {}
    }, ms);
    if (this._schedulerTimer279.unref) this._schedulerTimer279.unref();
    this._broadcastDigest279(DIGEST_EVENT_SCHEDULED_279, { intervalMs: ms });
    return { ok: true, intervalMs: ms };
  }

  /**
   * Stop the background digest scheduler.
   * @returns {{ ok, stopped }}
   */
  stopDigestScheduler279() {
    if (this._schedulerTimer279) {
      clearInterval(this._schedulerTimer279);
      this._schedulerTimer279    = null;
      this._schedulerInterval279 = null;
    }
    this._broadcastDigest279(DIGEST_EVENT_STOPPED_279, {});
    return { ok: true, stopped: true };
  }

  // ── History / Status ───────────────────────────────────────────────────────

  /**
   * Get past generated digests.
   * @param {object} [opts]
   * @param {string} [opts.since]   — ISO date string to filter from
   * @param {number} [opts.limit]   — max number of digests to return (default: 20)
   * @returns {{ ok, digests, total }}
   */
  getDigestHistory279(opts = {}) {
    const { since, limit = 20 } = opts;
    let digests = this._digestHistory279.slice();
    if (since) {
      const ts = new Date(since).getTime();
      digests = digests.filter(d => new Date(d.ts || 0).getTime() >= ts);
    }
    return { ok: true, digests: digests.slice(-limit), total: digests.length };
  }

  checkAlertDigestHealth279() {
    return {
      ok:               true,
      version:          DIGEST_VERSION_279,
      digestCount:      this._digestHistory279.length,
      schedulerActive:  Boolean(this._schedulerTimer279),
      schedulerInterval: this._schedulerInterval279,
      sseClients:       this._sseClients279.size,
    };
  }

  getStatus279() {
    return this.checkAlertDigestHealth279();
  }

  shutdown279() {
    this.stopDigestScheduler279();
    if (this._heartbeatTimer279) {
      clearInterval(this._heartbeatTimer279);
      this._heartbeatTimer279 = null;
    }
    for (const res of this._sseClients279.values()) {
      try { res.end(); } catch (_) {}
    }
    this._sseClients279.clear();
    return { ok: true, shutdown: true };
  }

  // ── SSE Client Management ──────────────────────────────────────────────────

  addDigestSseClient279(res) {
    if (this._sseClients279.size >= DIGEST_SSE_MAX_CLIENTS_279) {
      res.status(503).json({ ok: false, error: 'too_many_sse_clients', ecosVersion: '279' });
      return null;
    }

    const clientId = crypto.randomUUID();
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    this._sseClients279.set(clientId, res);

    // Send last 5 digests as history on connect
    const recent = this._digestHistory279.slice(-5);
    this._sseWrite279(res, 'history', { digests: recent, count: recent.length });

    res.on('close', () => this.removeDigestSseClient279(clientId));

    return clientId;
  }

  removeDigestSseClient279(clientId) {
    this._sseClients279.delete(clientId);
    return { ok: true, clientId };
  }

  startDigestHeartbeat279() {
    if (this._heartbeatTimer279) return;
    this._heartbeatTimer279 = setInterval(() => {
      for (const res of this._sseClients279.values()) {
        try { res.write(': heartbeat\n\n'); } catch (_) {}
      }
    }, DIGEST_SSE_HEARTBEAT_MS_279);
    if (this._heartbeatTimer279.unref) this._heartbeatTimer279.unref();
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  _getAllAlerts279(includeResolved) {
    if (this._alertBus279 && Array.isArray(this._alertBus279._history275)) {
      if (includeResolved) return this._alertBus279._history275.slice();
      return this._alertBus279._history275.filter(a => !a.resolved);
    }
    return [];
  }

  _getTopBreachedTypes279(byType) {
    if (!this._sla279) return [];
    let breachData = {};
    try {
      const status = this._sla279.getSlaStatus278?.();
      if (status && status.ok) breachData = status.breachCounts || {};
    } catch (_) {}

    return Object.entries(byType)
      .filter(([type]) => (breachData[type] || 0) > 0)
      .map(([type, v]) => ({
        type,
        totalCount:    v.count,
        breachedCount: breachData[type] || 0,
        escalated:     v.escalated,
      }))
      .sort((a, b) => b.breachedCount - a.breachedCount)
      .slice(0, 5);
  }

  _getSlaSnapshot279() {
    if (!this._sla279) return null;
    try {
      const status = this._sla279.getSlaStatus278?.();
      if (!status || !status.ok) return null;
      const totalBreached = Object.values(status.breachCounts || {}).reduce((s, n) => s + n, 0);
      const totalWarned   = Object.values(status.warnCounts   || {}).reduce((s, n) => s + n, 0);
      return {
        totalBreached,
        totalWarned,
        breachCounts: status.breachCounts,
        warnCounts:   status.warnCounts,
        configCount:  status.configCount,
      };
    } catch (_) { return null; }
  }

  _appendDigestHistory279(digest) {
    this._digestHistory279.push(digest);
    if (this._digestHistory279.length > DIGEST_HISTORY_MAX_279)
      this._digestHistory279.shift();
  }

  _broadcastDigest279(eventType, data) {
    const payload = JSON.stringify({ eventType, data, ecosVersion: '279', ts: new Date().toISOString() });
    for (const res of this._sseClients279.values()) {
      try { this._sseWrite279(res, 'digest', JSON.parse(payload)); } catch (_) {}
    }
  }

  _sseWrite279(res, event, data) {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (_) {}
  }

  async _persistDigest279(digest) {
    if (!this._db279) return;
    try {
      await this._db279.query(
        `INSERT INTO credit_alert_digests279
           (digest_id, period, total_alerts, unresolved, breached, warned, escalated, payload, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (digest_id) DO NOTHING`,
        [
          digest.digestId, digest.period, digest.totalAlerts,
          digest.unresolved, digest.breached, digest.warned,
          digest.escalated, JSON.stringify(digest),
        ]
      );
    } catch (_) { /* best-effort, never throw */ }
  }

  _log279(event, data) {
    if (this._logAdapter279 && typeof this._logAdapter279.log === 'function') {
      try { this._logAdapter279.log({ event, data, ts: new Date().toISOString() }); } catch (_) {}
    }
  }
}

// ── DB Schema Helper ──────────────────────────────────────────────────────────

const CREDIT_ALERT_DIGESTS_TABLE_279 = `
CREATE TABLE IF NOT EXISTS credit_alert_digests279 (
  digest_id    TEXT PRIMARY KEY,
  period       TEXT,
  total_alerts INTEGER,
  unresolved   INTEGER,
  breached     INTEGER,
  warned       INTEGER,
  escalated    INTEGER,
  payload      JSONB,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
`;

module.exports = {
  AlertDigest279,
  DIGEST_VERSION_279,
  DIGEST_HISTORY_MAX_279,
  DIGEST_SSE_MAX_CLIENTS_279,
  DIGEST_EVENT_GENERATED_279,
  DIGEST_EVENT_SCHEDULED_279,
  DIGEST_EVENT_STOPPED_279,
  CREDIT_ALERT_DIGESTS_TABLE_279,
};
