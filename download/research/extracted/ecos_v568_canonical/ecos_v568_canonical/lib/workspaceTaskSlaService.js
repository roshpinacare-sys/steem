/**
 * lib/workspaceTaskSlaService.js — V161
 * ========================================
 * Workspace Task SLA (Service-Level Agreement) Tracking
 * ניהול SLA policies, breach detection ו-escalation rules
 *
 * תכונות:
 *  - הגדרת SLA policy: priority → max resolution hours
 *  - SLA breach detection: task age > SLA hours for its priority
 *  - Escalation rules: breachCount → level (warn / alert / critical)
 *  - Bulk SLA check: כל ה-tasks הפרוצים ב-workspace
 *  - SLA events log (immutable per breach)
 *  - DB: workspace_sla_policies + workspace_sla_events
 *
 * Sacred Files: lib/fiatLedger.js, lib/auditLog.js — UNTOUCHED
 * [V161-TASK-03]
 */

'use strict';

const crypto = require('crypto');

// ── Constants ─────────────────────────────────────────────────────────────
const DEFAULT_SLA_HOURS = {
  critical: 4,
  high:     24,
  medium:   72,
  low:      168,  // 1 week
};

const ESCALATION_LEVELS = ['none', 'warn', 'alert', 'critical'];

// ── Errors ────────────────────────────────────────────────────────────────
class SlaNotFoundError extends Error {
  constructor(id) {
    super(`SLA policy not found: ${id}`);
    this.name = 'SlaNotFoundError';
    this.code = 'SLA_NOT_FOUND';
    this.statusCode = 404;
  }
}

// ── SLA Policy record ─────────────────────────────────────────────────────
class SlaPolicy {
  constructor(data) {
    this.id          = data.id          || `sla_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    this.workspaceId = data.workspaceId;
    this.name        = (data.name       || '').trim().slice(0, 200);
    this.description = (data.description|| '').slice(0, 1000);
    this.isDefault   = data.isDefault   || false;
    this.hours       = {
      critical: typeof data.hours?.critical === 'number' ? data.hours.critical : DEFAULT_SLA_HOURS.critical,
      high:     typeof data.hours?.high     === 'number' ? data.hours.high     : DEFAULT_SLA_HOURS.high,
      medium:   typeof data.hours?.medium   === 'number' ? data.hours.medium   : DEFAULT_SLA_HOURS.medium,
      low:      typeof data.hours?.low      === 'number' ? data.hours.low      : DEFAULT_SLA_HOURS.low,
    };
    // escalation: hours past breach → escalation level
    this.escalation  = {
      warnMultiplier:     data.escalation?.warnMultiplier     ?? 0.8,  // 80% of SLA → warn
      alertMultiplier:    data.escalation?.alertMultiplier    ?? 1.0,  // 100% (at breach) → alert
      criticalMultiplier: data.escalation?.criticalMultiplier ?? 1.5,  // 150% → critical
    };
    this.createdBy   = data.createdBy   || null;
    this.createdAt   = data.createdAt   || new Date().toISOString();
    this.updatedAt   = data.updatedAt   || new Date().toISOString();
  }

  /**
   * Compute the SLA status for a task given its priority and creation time.
   * @param {string} priority
   * @param {string} createdAt  ISO timestamp
   * @param {string} [now]      ISO timestamp (default: Date.now())
   * @returns {{ ageHours: number, slaHours: number, breached: boolean, escalationLevel: string, overagePercent: number }}
   */
  checkTask(priority, createdAt, now) {
    const maxHours  = this.hours[priority] ?? DEFAULT_SLA_HOURS.medium;
    const nowMs     = now ? new Date(now).getTime() : Date.now();
    const ageMs     = nowMs - new Date(createdAt).getTime();
    const ageHours  = ageMs / 3600000;
    const ratio     = ageHours / maxHours;
    const overagePercent = Math.max(0, (ratio - 1) * 100);

    let escalationLevel = 'none';
    if (ratio >= this.escalation.criticalMultiplier) escalationLevel = 'critical';
    else if (ratio >= this.escalation.alertMultiplier)    escalationLevel = 'alert';
    else if (ratio >= this.escalation.warnMultiplier)     escalationLevel = 'warn';

    return {
      ageHours:        parseFloat(ageHours.toFixed(2)),
      slaHours:        maxHours,
      breached:        ratio >= this.escalation.alertMultiplier,
      nearBreach:      ratio >= this.escalation.warnMultiplier,
      escalationLevel,
      overagePercent:  parseFloat(overagePercent.toFixed(1)),
    };
  }

  toJSON() {
    return {
      id: this.id, workspaceId: this.workspaceId, name: this.name,
      description: this.description, isDefault: this.isDefault,
      hours: this.hours, escalation: this.escalation,
      createdBy: this.createdBy, createdAt: this.createdAt, updatedAt: this.updatedAt,
    };
  }
}

// ── SLA Event record (immutable breach log) ───────────────────────────────
class SlaEvent {
  constructor(data) {
    this.id              = data.id              || `slae_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    this.workspaceId     = data.workspaceId;
    this.taskId          = data.taskId;
    this.policyId        = data.policyId;
    this.priority        = data.priority;
    this.escalationLevel = data.escalationLevel;
    this.ageHours        = data.ageHours;
    this.slaHours        = data.slaHours;
    this.overagePercent  = data.overagePercent;
    this.detectedAt      = data.detectedAt      || new Date().toISOString();
    this.resolvedAt      = data.resolvedAt      || null;
  }

  toJSON() {
    return {
      id: this.id, workspaceId: this.workspaceId, taskId: this.taskId,
      policyId: this.policyId, priority: this.priority,
      escalationLevel: this.escalationLevel, ageHours: this.ageHours,
      slaHours: this.slaHours, overagePercent: this.overagePercent,
      detectedAt: this.detectedAt, resolvedAt: this.resolvedAt,
    };
  }
}

// ── WorkspaceTaskSlaService ───────────────────────────────────────────────
class WorkspaceTaskSlaService {
  constructor(opts = {}) {
    this._db       = opts.db     || null;
    this._log      = opts.logger || { info: () => {}, warn: () => {}, error: () => {} };
    this._policies = new Map();  // policyId → SlaPolicy
    this._events   = new Map();  // eventId  → SlaEvent
    this._wsDefault = new Map(); // workspaceId → policyId (default policy per ws)
  }

  setDb(pool)    { this._db = pool; }
  setLogger(log) { this._log = log; }

  // ── Policy CRUD ──────────────────────────────────────────────────────────

  async createPolicy(workspaceId, data) {
    if (!workspaceId) throw new Error('workspaceId is required');
    const policy = new SlaPolicy({ ...data, workspaceId });
    this._policies.set(policy.id, policy);

    if (policy.isDefault) this._wsDefault.set(workspaceId, policy.id);

    if (this._db) {
      try {
        await this._db.query(
          `INSERT INTO workspace_sla_policies
             (id, workspace_id, name, description, is_default, hours_critical, hours_high, hours_medium, hours_low,
              warn_multiplier, alert_multiplier, critical_multiplier, created_by, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT (id) DO NOTHING`,
          [policy.id, workspaceId, policy.name, policy.description, policy.isDefault,
           policy.hours.critical, policy.hours.high, policy.hours.medium, policy.hours.low,
           policy.escalation.warnMultiplier, policy.escalation.alertMultiplier,
           policy.escalation.criticalMultiplier, policy.createdBy, policy.createdAt, policy.updatedAt]
        );
      } catch (e) { this._log.warn({ err: e }, 'slaService.createPolicy DB error'); }
    }
    return policy;
  }

  async listPolicies(workspaceId) {
    if (!workspaceId) throw new Error('workspaceId is required');
    return [...this._policies.values()]
      .filter(p => p.workspaceId === workspaceId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getPolicy(workspaceId, policyId) {
    const p = this._policies.get(policyId);
    if (p && p.workspaceId === workspaceId) return p;
    throw new SlaNotFoundError(policyId);
  }

  async updatePolicy(workspaceId, policyId, updates) {
    const policy = await this.getPolicy(workspaceId, policyId);
    if (updates.name        !== undefined) policy.name        = (updates.name || '').trim().slice(0, 200);
    if (updates.description !== undefined) policy.description = (updates.description || '').slice(0, 1000);
    if (updates.isDefault   !== undefined) {
      policy.isDefault = !!updates.isDefault;
      if (policy.isDefault) this._wsDefault.set(workspaceId, policyId);
    }
    if (updates.hours) {
      for (const p of ['critical', 'high', 'medium', 'low']) {
        if (typeof updates.hours[p] === 'number') policy.hours[p] = updates.hours[p];
      }
    }
    if (updates.escalation) {
      for (const k of ['warnMultiplier', 'alertMultiplier', 'criticalMultiplier']) {
        if (typeof updates.escalation[k] === 'number') policy.escalation[k] = updates.escalation[k];
      }
    }
    policy.updatedAt = new Date().toISOString();
    this._policies.set(policy.id, policy);
    return policy;
  }

  async deletePolicy(workspaceId, policyId) {
    const policy = await this.getPolicy(workspaceId, policyId);
    this._policies.delete(policy.id);
    if (this._wsDefault.get(workspaceId) === policyId) this._wsDefault.delete(workspaceId);
    return { deleted: true, policyId };
  }

  // ── SLA Check ────────────────────────────────────────────────────────────

  /**
   * Check SLA status for a single task.
   * @param {string} workspaceId
   * @param {{ id: string, priority: string, createdAt: string, status: string }} task
   * @param {string} [policyId]  — if omitted, uses workspace default
   * @param {string} [now]
   */
  checkTaskSla(workspaceId, task, policyId, now) {
    let policy;
    if (policyId) {
      policy = this._policies.get(policyId);
    } else {
      const defId = this._wsDefault.get(workspaceId);
      policy = defId ? this._policies.get(defId) : null;
    }
    if (!policy) {
      // use built-in defaults
      policy = new SlaPolicy({ workspaceId, name: '__default__', hours: DEFAULT_SLA_HOURS });
    }
    const result = policy.checkTask(task.priority || 'medium', task.createdAt, now);
    return { taskId: task.id, policyId: policy.id, ...result };
  }

  /**
   * Run bulk SLA check across a list of tasks.
   * @param {string} workspaceId
   * @param {Array<{ id: string, priority: string, createdAt: string, status: string }>} tasks
   * @param {{ onlyBreached?: boolean, now?: string }} [opts]
   */
  bulkCheck(workspaceId, tasks, opts = {}) {
    const { onlyBreached = false, now } = opts;
    const results = tasks
      .filter(t => !['done', 'cancelled', 'closed'].includes(t.status))
      .map(t => this.checkTaskSla(workspaceId, t, undefined, now));

    const filtered = onlyBreached ? results.filter(r => r.breached) : results;
    const breached = results.filter(r => r.breached);
    const nearBreach = results.filter(r => r.nearBreach && !r.breached);

    return {
      checked:       results.length,
      breached:      breached.length,
      nearBreach:    nearBreach.length,
      healthy:       results.length - breached.length - nearBreach.length,
      results:       filtered,
    };
  }

  // ── SLA Events ────────────────────────────────────────────────────────────

  /**
   * Record an SLA breach event (called by breach detection or manual trigger).
   */
  async recordEvent(workspaceId, taskId, eventData) {
    const evt = new SlaEvent({ ...eventData, workspaceId, taskId });
    this._events.set(evt.id, evt);

    if (this._db) {
      try {
        await this._db.query(
          `INSERT INTO workspace_sla_events
             (id, workspace_id, task_id, policy_id, priority, escalation_level, age_hours, sla_hours, overage_percent, detected_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
          [evt.id, workspaceId, taskId, evt.policyId, evt.priority, evt.escalationLevel,
           evt.ageHours, evt.slaHours, evt.overagePercent, evt.detectedAt]
        );
      } catch (e) { this._log.warn({ err: e }, 'slaService.recordEvent DB error'); }
    }
    return evt;
  }

  /**
   * List SLA events for a workspace.
   * @param {string} workspaceId
   * @param {{ taskId?: string, level?: string, limit?: number }} [opts]
   */
  listEvents(workspaceId, opts = {}) {
    const { taskId, level, limit = 100 } = opts;
    let evts = [...this._events.values()].filter(e => e.workspaceId === workspaceId);
    if (taskId) evts = evts.filter(e => e.taskId === taskId);
    if (level)  evts = evts.filter(e => e.escalationLevel === level);
    evts.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
    return evts.slice(0, limit);
  }

  stats(workspaceId) {
    const policies = [...this._policies.values()].filter(p => p.workspaceId === workspaceId);
    const events   = [...this._events.values()].filter(e => e.workspaceId === workspaceId);
    const byCritical = events.filter(e => e.escalationLevel === 'critical').length;
    const byAlert    = events.filter(e => e.escalationLevel === 'alert').length;
    const byWarn     = events.filter(e => e.escalationLevel === 'warn').length;
    return { totalPolicies: policies.length, totalEvents: events.length, byCritical, byAlert, byWarn };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────
const defaultSlaService = new WorkspaceTaskSlaService();

module.exports = {
  WorkspaceTaskSlaService,
  defaultSlaService,
  SlaPolicy,
  SlaEvent,
  SlaNotFoundError,
  DEFAULT_SLA_HOURS,
};

if (process.env.NODE_ENV === 'test') {
  module.exports._sla = defaultSlaService;
}
