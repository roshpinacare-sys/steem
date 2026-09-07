'use strict';
/**
 * src/lib/alertEscalation277.js — ECOS Alert Escalation & Operator Assignment (V277)
 *
 * V277 adds alert escalation and operator assignment on top of the V276 resolution lifecycle:
 *   - escalateAlert277(alertId, opts)      — marks an alert as escalated to a named operator/team
 *   - assignAlert277(alertId, assignee)    — assigns an alert to a specific operator
 *   - getAssignedAlerts277(assignee)       — alerts assigned to a given operator
 *   - getEscalatedAlerts277()              — all escalated unresolved alerts
 *   - broadcastEscalation277()             — SSE broadcast of escalation/assignment events
 *
 * Iron rules: zero new npm deps. All identifiers end in 277. Sacred files untouched.
 */

const crypto = require('node:crypto');

const ESCALATION_VERSION_277          = '277';
const ESCALATION_HISTORY_MAX_277      = 500;
const ESCALATION_SSE_MAX_CLIENTS_277  = 200;
const ESCALATION_SSE_HEARTBEAT_MS_277 = 30_000;

// Escalation priority flags
const ESCALATION_PRIORITY_HIGH_277   = 'HIGH';
const ESCALATION_PRIORITY_CRITICAL_277 = 'CRITICAL';

// Event types
const ESCALATION_EVENT_ESCALATED_277  = 'ALERT_ESCALATED';
const ESCALATION_EVENT_ASSIGNED_277   = 'ALERT_ASSIGNED';
const ESCALATION_EVENT_DEESCALATED_277 = 'ALERT_DEESCALATED';
const ESCALATION_EVENT_UNASSIGNED_277  = 'ALERT_UNASSIGNED';

class AlertEscalation277 {
  /**
   * @param {object} opts
   * @param {object} [opts.counterAlertBus]   — CounterAlertBus275 instance
   * @param {object} [opts.alertResolution]   — AlertResolution276 instance (optional)
   * @param {object} [opts.db]                — DB pool (optional, for persistence)
   * @param {object} [opts.logger]
   * @param {object} [opts.logAdapter]
   */
  constructor(opts = {}) {
    this._alertBus277       = opts.counterAlertBus || null;
    this._resolution277     = opts.alertResolution || null;
    this._db277             = opts.db || null;
    this._logger277         = opts.logger || console;
    this._logAdapter277     = opts.logAdapter || null;

    // SSE clients for escalation events: Map<clientId, res>
    this._sseClients277     = new Map();
    this._heartbeatTimer277 = null;

    // Escalation metadata: Map<alertId, escalationRecord>
    this._escalations277    = new Map();

    // Assignment metadata: Map<alertId, assignmentRecord>
    this._assignments277    = new Map();

    // Reverse index: assignee -> Set<alertId>
    this._assigneeIndex277  = new Map();

    // Event history (capped at 500)
    this._eventHistory277   = [];
  }

  // ── Escalation Logic ──────────────────────────────────────────────────────

  /**
   * Mark an alert as escalated to a named operator or team.
   * Escalated alerts receive a higher-priority visual flag in the SSE stream.
   *
   * @param {string} alertId
   * @param {object} [opts]
   * @param {string} [opts.escalatedTo]   — operator or team name
   * @param {string} [opts.priority]      — 'HIGH' | 'CRITICAL' (default: 'HIGH')
   * @param {string} [opts.reason]        — escalation reason / note
   * @param {string} [opts.escalatedBy]   — who triggered the escalation
   * @returns {{ ok, alertId, escalatedAt, priority, error? }}
   */
  escalateAlert277(alertId, opts = {}) {
    if (!alertId) return { ok: false, error: 'alertId required' };

    const escalatedAt = new Date().toISOString();
    const priority    = opts.priority === ESCALATION_PRIORITY_CRITICAL_277
      ? ESCALATION_PRIORITY_CRITICAL_277
      : ESCALATION_PRIORITY_HIGH_277;

    const escalation = {
      alertId,
      escalatedAt,
      escalatedTo:  opts.escalatedTo  || null,
      escalatedBy:  opts.escalatedBy  || 'operator',
      priority,
      reason:       opts.reason       || '',
      event:        ESCALATION_EVENT_ESCALATED_277,
    };

    // Update bus history if available
    let alertFound = false;
    if (this._alertBus277 && Array.isArray(this._alertBus277._history275)) {
      for (const alert of this._alertBus277._history275) {
        if (alert.alertId === alertId) {
          alert.escalated    = true;
          alert.escalatedAt  = escalatedAt;
          alert.escalatedTo  = escalation.escalatedTo;
          alert.escalatedBy  = escalation.escalatedBy;
          alert.priority277  = priority;
          alertFound = true;
          break;
        }
      }
    }

    this._escalations277.set(alertId, escalation);

    this._appendEventHistory277({
      eventId:     crypto.randomUUID(),
      event:       ESCALATION_EVENT_ESCALATED_277,
      alertId,
      escalatedAt,
      priority,
      meta:        escalation,
    });

    // Persist to DB if available
    this._persistEscalation277(escalation).catch(() => {});

    // Broadcast over SSE with HIGH priority flag
    this._broadcastEscalation277(ESCALATION_EVENT_ESCALATED_277, {
      alertId,
      escalatedAt,
      escalatedTo: escalation.escalatedTo,
      escalatedBy: escalation.escalatedBy,
      priority,
      reason:      escalation.reason,
      _priority277: priority, // visual flag for consumers
    });

    this._log277('ALERT_ESCALATED', { alertId, priority, escalatedTo: escalation.escalatedTo, alertFound });

    return { ok: true, alertId, escalatedAt, priority, escalatedTo: escalation.escalatedTo, alertFound };
  }

  /**
   * De-escalate an alert (clear escalation flag).
   */
  deescalateAlert277(alertId, opts = {}) {
    if (!alertId) return { ok: false, error: 'alertId required' };
    if (!this._escalations277.has(alertId)) {
      return { ok: false, error: 'alert not currently escalated' };
    }

    const deescalatedAt = new Date().toISOString();

    // Update bus history
    if (this._alertBus277 && Array.isArray(this._alertBus277._history275)) {
      for (const alert of this._alertBus277._history275) {
        if (alert.alertId === alertId) {
          alert.escalated   = false;
          alert.priority277 = null;
          break;
        }
      }
    }

    this._escalations277.delete(alertId);

    this._appendEventHistory277({
      eventId:       crypto.randomUUID(),
      event:         ESCALATION_EVENT_DEESCALATED_277,
      alertId,
      deescalatedAt,
      meta:          { deescalatedBy: opts.deescalatedBy || 'operator', deescalatedAt },
    });

    this._broadcastEscalation277(ESCALATION_EVENT_DEESCALATED_277, {
      alertId,
      deescalatedAt,
      deescalatedBy: opts.deescalatedBy || 'operator',
    });

    return { ok: true, alertId, deescalatedAt };
  }

  // ── Assignment Logic ───────────────────────────────────────────────────────

  /**
   * Assign an alert to a specific operator.
   * Stores assignment metadata; broadcasts ALERT_ASSIGNED event over SSE.
   *
   * @param {string} alertId
   * @param {string} assignee   — operator id / name
   * @param {object} [opts]
   * @param {string} [opts.assignedBy]  — who made the assignment
   * @param {string} [opts.note]
   * @returns {{ ok, alertId, assignee, assignedAt, error? }}
   */
  assignAlert277(alertId, assignee, opts = {}) {
    if (!alertId)  return { ok: false, error: 'alertId required' };
    if (!assignee) return { ok: false, error: 'assignee required' };

    const assignedAt = new Date().toISOString();
    const prevAssignment = this._assignments277.get(alertId);

    const assignment = {
      alertId,
      assignee,
      assignedAt,
      assignedBy: opts.assignedBy || 'operator',
      note:       opts.note       || '',
      prevAssignee: prevAssignment ? prevAssignment.assignee : null,
      event:      ESCALATION_EVENT_ASSIGNED_277,
    };

    // Update bus history
    let alertFound = false;
    if (this._alertBus277 && Array.isArray(this._alertBus277._history275)) {
      for (const alert of this._alertBus277._history275) {
        if (alert.alertId === alertId) {
          alert.assignee   = assignee;
          alert.assignedAt = assignedAt;
          alert.assignedBy = assignment.assignedBy;
          alertFound = true;
          break;
        }
      }
    }

    // Remove from prev assignee's index
    if (prevAssignment && prevAssignment.assignee) {
      const prevSet = this._assigneeIndex277.get(prevAssignment.assignee);
      if (prevSet) prevSet.delete(alertId);
    }

    // Store assignment
    this._assignments277.set(alertId, assignment);

    // Update assignee reverse index
    if (!this._assigneeIndex277.has(assignee)) {
      this._assigneeIndex277.set(assignee, new Set());
    }
    this._assigneeIndex277.get(assignee).add(alertId);

    this._appendEventHistory277({
      eventId:    crypto.randomUUID(),
      event:      ESCALATION_EVENT_ASSIGNED_277,
      alertId,
      assignee,
      assignedAt,
      meta:       assignment,
    });

    // Persist to DB
    this._persistAssignment277(assignment).catch(() => {});

    this._broadcastEscalation277(ESCALATION_EVENT_ASSIGNED_277, {
      alertId,
      assignee,
      assignedAt,
      assignedBy:  assignment.assignedBy,
      note:        assignment.note,
      prevAssignee: assignment.prevAssignee,
    });

    this._log277('ALERT_ASSIGNED', { alertId, assignee, alertFound });

    return { ok: true, alertId, assignee, assignedAt, alertFound };
  }

  /**
   * Unassign an alert (remove assignment).
   */
  unassignAlert277(alertId, opts = {}) {
    if (!alertId) return { ok: false, error: 'alertId required' };
    const existing = this._assignments277.get(alertId);
    if (!existing) return { ok: false, error: 'alert not assigned' };

    const unassignedAt = new Date().toISOString();

    // Remove from assignee index
    const assigneeSet = this._assigneeIndex277.get(existing.assignee);
    if (assigneeSet) assigneeSet.delete(alertId);

    this._assignments277.delete(alertId);

    // Update bus history
    if (this._alertBus277 && Array.isArray(this._alertBus277._history275)) {
      for (const alert of this._alertBus277._history275) {
        if (alert.alertId === alertId) {
          alert.assignee   = null;
          alert.assignedAt = null;
          break;
        }
      }
    }

    this._appendEventHistory277({
      eventId:      crypto.randomUUID(),
      event:        ESCALATION_EVENT_UNASSIGNED_277,
      alertId,
      unassignedAt,
      meta:         { prevAssignee: existing.assignee, unassignedBy: opts.unassignedBy || 'operator', unassignedAt },
    });

    this._broadcastEscalation277(ESCALATION_EVENT_UNASSIGNED_277, {
      alertId,
      unassignedAt,
      prevAssignee: existing.assignee,
      unassignedBy: opts.unassignedBy || 'operator',
    });

    return { ok: true, alertId, unassignedAt, prevAssignee: existing.assignee };
  }

  // ── Query Methods ──────────────────────────────────────────────────────────

  /**
   * Get all alerts assigned to a specific operator.
   * @param {string} assignee
   * @param {object} [opts]
   * @returns {{ ok, assignee, alerts, total }}
   */
  getAssignedAlerts277(assignee, opts = {}) {
    if (!assignee) return { ok: false, error: 'assignee required' };

    const alertIds = this._assigneeIndex277.get(assignee) || new Set();
    let alerts = [];

    if (this._alertBus277 && Array.isArray(this._alertBus277._history275)) {
      alerts = this._alertBus277._history275.filter(a => alertIds.has(a.alertId));
    } else {
      // Fall back to assignment records if bus not available
      for (const id of alertIds) {
        const rec = this._assignments277.get(id);
        if (rec) alerts.push(rec);
      }
    }

    const { includeResolved = false } = opts;
    if (!includeResolved) alerts = alerts.filter(a => !a.resolved);

    return { ok: true, assignee, alerts, total: alerts.length };
  }

  /**
   * Get all escalated, unresolved alerts.
   * @param {object} [opts]
   * @returns {{ ok, alerts, total }}
   */
  getEscalatedAlerts277(opts = {}) {
    const { priority, since } = opts;

    let alerts = [];
    if (this._alertBus277 && Array.isArray(this._alertBus277._history275)) {
      alerts = this._alertBus277._history275.filter(a => a.escalated && !a.resolved);
    } else {
      // Fall back to local escalation records
      for (const [alertId, esc] of this._escalations277.entries()) {
        alerts.push({ alertId, ...esc });
      }
    }

    if (priority) {
      alerts = alerts.filter(a => a.priority277 === priority);
    }

    if (since) {
      const sinceTs = new Date(since).getTime();
      alerts = alerts.filter(a => new Date(a.ts || a.escalatedAt || 0).getTime() >= sinceTs);
    }

    return { ok: true, alerts, total: alerts.length };
  }

  // ── SSE Client Management ──────────────────────────────────────────────────

  addEscalationSseClient277(res) {
    if (this._sseClients277.size >= ESCALATION_SSE_MAX_CLIENTS_277) {
      res.status(503).json({ ok: false, error: 'too_many_sse_clients', ecosVersion: '277' });
      return null;
    }

    const clientId = crypto.randomUUID();
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    this._sseClients277.set(clientId, res);

    // Send last 10 events as history on connect
    const recent = this._eventHistory277.slice(-10);
    this._sseWrite277(res, 'history', { events: recent, count: recent.length });

    res.on('close', () => this.removeEscalationSseClient277(clientId));

    return clientId;
  }

  removeEscalationSseClient277(clientId) {
    this._sseClients277.delete(clientId);
    return { ok: true, clientId };
  }

  startEscalationHeartbeat277() {
    if (this._heartbeatTimer277) return;
    this._heartbeatTimer277 = setInterval(() => {
      for (const res of this._sseClients277.values()) {
        try { res.write(': heartbeat\n\n'); } catch (_) {}
      }
    }, ESCALATION_SSE_HEARTBEAT_MS_277);
    if (this._heartbeatTimer277.unref) this._heartbeatTimer277.unref();
  }

  _broadcastEscalation277(eventType, data) {
    const payload = JSON.stringify({ eventType, data, ecosVersion: '277', ts: new Date().toISOString() });
    for (const res of this._sseClients277.values()) {
      try { this._sseWrite277(res, 'escalation', JSON.parse(payload)); } catch (_) {}
    }
  }

  _sseWrite277(res, event, data) {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (_) {}
  }

  // ── DB Persistence ─────────────────────────────────────────────────────────

  async _persistEscalation277(escalation) {
    if (!this._db277) return;
    try {
      await this._db277.query(
        `INSERT INTO credit_alert_escalations277
           (alert_id, escalated_to, escalated_by, priority, reason, escalated_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (alert_id) DO UPDATE
           SET escalated_to = EXCLUDED.escalated_to,
               escalated_by = EXCLUDED.escalated_by,
               priority     = EXCLUDED.priority,
               reason       = EXCLUDED.reason,
               escalated_at = EXCLUDED.escalated_at`,
        [
          escalation.alertId, escalation.escalatedTo, escalation.escalatedBy,
          escalation.priority, escalation.reason, escalation.escalatedAt,
        ]
      );
    } catch (_) { /* best-effort, never throw */ }
  }

  async _persistAssignment277(assignment) {
    if (!this._db277) return;
    try {
      await this._db277.query(
        `INSERT INTO credit_alert_assignments277
           (alert_id, assignee, assigned_by, note, assigned_at, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (alert_id) DO UPDATE
           SET assignee    = EXCLUDED.assignee,
               assigned_by = EXCLUDED.assigned_by,
               note        = EXCLUDED.note,
               assigned_at = EXCLUDED.assigned_at`,
        [
          assignment.alertId, assignment.assignee, assignment.assignedBy,
          assignment.note, assignment.assignedAt,
        ]
      );
    } catch (_) { /* best-effort, never throw */ }
  }

  // ── History / Status ───────────────────────────────────────────────────────

  getEventHistory277(opts = {}) {
    const { since, limit = 100 } = opts;
    let events = this._eventHistory277.slice();
    if (since) {
      const ts = new Date(since).getTime();
      events = events.filter(e => new Date(e.escalatedAt || e.assignedAt || e.ts || 0).getTime() >= ts);
    }
    return { ok: true, events: events.slice(-limit), total: events.length };
  }

  checkAlertEscalationHealth277() {
    return {
      ok: true,
      version:      ESCALATION_VERSION_277,
      escalations:  this._escalations277.size,
      assignments:  this._assignments277.size,
      assignees:    this._assigneeIndex277.size,
      sseClients:   this._sseClients277.size,
      eventHistory: this._eventHistory277.length,
    };
  }

  getStatus277() {
    return {
      ok: true,
      version:      ESCALATION_VERSION_277,
      escalations:  this._escalations277.size,
      assignments:  this._assignments277.size,
      assignees:    this._assigneeIndex277.size,
      sseClients:   this._sseClients277.size,
      eventHistory: this._eventHistory277.length,
    };
  }

  shutdown277() {
    if (this._heartbeatTimer277) {
      clearInterval(this._heartbeatTimer277);
      this._heartbeatTimer277 = null;
    }
    for (const res of this._sseClients277.values()) {
      try { res.end(); } catch (_) {}
    }
    this._sseClients277.clear();
    return { ok: true, shutdown: true };
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  _appendEventHistory277(record) {
    this._eventHistory277.push(record);
    if (this._eventHistory277.length > ESCALATION_HISTORY_MAX_277)
      this._eventHistory277.shift();
  }

  _log277(event, data) {
    if (this._logAdapter277 && typeof this._logAdapter277.log === 'function') {
      try { this._logAdapter277.log({ event, data, ts: new Date().toISOString() }); } catch (_) {}
    }
  }
}

// ── DB Schema Helpers ──────────────────────────────────────────────────────────

const CREDIT_ALERT_ESCALATIONS_TABLE_277 = `
CREATE TABLE IF NOT EXISTS credit_alert_escalations277 (
  alert_id     TEXT PRIMARY KEY,
  escalated_to TEXT,
  escalated_by TEXT,
  priority     TEXT NOT NULL DEFAULT 'HIGH',
  reason       TEXT,
  escalated_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
`;

const CREDIT_ALERT_ASSIGNMENTS_TABLE_277 = `
CREATE TABLE IF NOT EXISTS credit_alert_assignments277 (
  alert_id    TEXT PRIMARY KEY,
  assignee    TEXT NOT NULL,
  assigned_by TEXT,
  note        TEXT,
  assigned_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
`;

module.exports = {
  AlertEscalation277,
  ESCALATION_VERSION_277,
  ESCALATION_PRIORITY_HIGH_277,
  ESCALATION_PRIORITY_CRITICAL_277,
  ESCALATION_EVENT_ESCALATED_277,
  ESCALATION_EVENT_ASSIGNED_277,
  ESCALATION_EVENT_DEESCALATED_277,
  ESCALATION_EVENT_UNASSIGNED_277,
  ESCALATION_SSE_MAX_CLIENTS_277,
  CREDIT_ALERT_ESCALATIONS_TABLE_277,
  CREDIT_ALERT_ASSIGNMENTS_TABLE_277,
};
