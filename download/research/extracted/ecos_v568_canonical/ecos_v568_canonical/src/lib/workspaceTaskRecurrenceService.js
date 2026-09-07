/**
 * lib/workspaceTaskRecurrenceService.js — V162
 * =============================================
 * Task Recurrence Scheduling
 * תזמון חוזר לtasks — daily / weekly / monthly
 *
 * תכונות:
 *  - הגדרת recurrence rule (daily/weekly/monthly) לtask
 *  - auto-spawn: יצירת task חדש כשהנוכחי הושלם
 *  - listRecurring: כל ה-tasks עם recurrence rule פעיל
 *  - integration: emit audit event על כל spawn
 *  - DB: recurrence_rules + recurrence_instances
 *
 * Exports: WorkspaceTaskRecurrenceService, RecurrenceNotFoundError, RecurrenceRuleError
 * Sacred Files: lib/fiatLedger.js, lib/auditLog.js — UNTOUCHED
 * [V162-TASK-01]
 */

'use strict';

const crypto = require('crypto');

// ── Errors ────────────────────────────────────────────────────────────────
class RecurrenceNotFoundError extends Error {
  constructor(id) {
    super(`Recurrence rule not found: ${id}`);
    this.name = 'RecurrenceNotFoundError';
    this.code = 'RECURRENCE_NOT_FOUND';
    this.statusCode = 404;
  }
}

class RecurrenceRuleError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'RecurrenceRuleError';
    this.code = 'RECURRENCE_RULE_INVALID';
    this.statusCode = 400;
  }
}

// ── Supported frequencies ─────────────────────────────────────────────────
const VALID_FREQUENCIES = new Set(['daily', 'weekly', 'monthly']);
const VALID_WEEKDAYS    = new Set(['mon','tue','wed','thu','fri','sat','sun']);

// ── RecurrenceRule record ─────────────────────────────────────────────────
class RecurrenceRule {
  constructor(data) {
    this.id          = data.id          || `rec_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    this.workspaceId = data.workspaceId;
    this.taskId      = data.taskId;           // anchor / template task
    this.frequency   = data.frequency;         // 'daily' | 'weekly' | 'monthly'
    this.interval    = data.interval  || 1;    // every N days/weeks/months
    this.weekday     = data.weekday   || null; // for weekly: 'mon'..'sun'
    this.dayOfMonth  = data.dayOfMonth|| null; // for monthly: 1-31 (clamped)
    this.enabled     = data.enabled   !== false;
    this.spawnCount  = data.spawnCount || 0;
    this.lastSpawnAt = data.lastSpawnAt|| null;
    this.createdAt   = data.createdAt  || new Date().toISOString();
    this.updatedAt   = data.updatedAt  || new Date().toISOString();
  }

  toJSON() {
    return {
      id:          this.id,
      workspaceId: this.workspaceId,
      taskId:      this.taskId,
      frequency:   this.frequency,
      interval:    this.interval,
      weekday:     this.weekday,
      dayOfMonth:  this.dayOfMonth,
      enabled:     this.enabled,
      spawnCount:  this.spawnCount,
      lastSpawnAt: this.lastSpawnAt,
      createdAt:   this.createdAt,
      updatedAt:   this.updatedAt,
    };
  }
}

// ── RecurrenceInstance record (spawned child tasks) ───────────────────────
class RecurrenceInstance {
  constructor(data) {
    this.id          = data.id          || `rci_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    this.ruleId      = data.ruleId;
    this.workspaceId = data.workspaceId;
    this.parentTaskId= data.parentTaskId;
    this.childTaskId = data.childTaskId;
    this.spawnedAt   = data.spawnedAt   || new Date().toISOString();
  }

  toJSON() {
    return {
      id:           this.id,
      ruleId:       this.ruleId,
      workspaceId:  this.workspaceId,
      parentTaskId: this.parentTaskId,
      childTaskId:  this.childTaskId,
      spawnedAt:    this.spawnedAt,
    };
  }
}

// ── Service ───────────────────────────────────────────────────────────────
class WorkspaceTaskRecurrenceService {
  constructor() {
    /** @type {Map<string, RecurrenceRule>} id → rule */
    this._rules     = new Map();
    /** @type {Map<string, RecurrenceInstance>} id → instance */
    this._instances = new Map();
    /** @type {import('pg').Pool|null} */
    this._db  = null;
    this._log = { info: () => {}, warn: () => {} };
  }

  setDb(pool)    { this._db  = pool; }
  setLogger(log) { this._log = log;  }

  // ── Validation ────────────────────────────────────────────────────────
  _validateFrequency(freq) {
    if (!VALID_FREQUENCIES.has(freq))
      throw new RecurrenceRuleError(`frequency must be one of: ${[...VALID_FREQUENCIES].join(', ')}`);
  }

  _validateInterval(n) {
    const v = Number(n);
    if (!Number.isInteger(v) || v < 1 || v > 365)
      throw new RecurrenceRuleError('interval must be integer 1–365');
    return v;
  }

  _clampDayOfMonth(d) {
    const v = Number(d);
    if (!Number.isInteger(v) || v < 1) return 1;
    return Math.min(v, 28); // clamp to 28 to handle all months safely
  }

  // ── setRecurrence (create or update) ─────────────────────────────────
  async setRecurrence(workspaceId, taskId, opts = {}) {
    if (!workspaceId) throw new RecurrenceRuleError('workspaceId required');
    if (!taskId)      throw new RecurrenceRuleError('taskId required');

    const { frequency, interval = 1, weekday, dayOfMonth } = opts;
    this._validateFrequency(frequency);
    const iv = this._validateInterval(interval);

    if (frequency === 'weekly' && weekday && !VALID_WEEKDAYS.has(weekday.toLowerCase()))
      throw new RecurrenceRuleError(`weekday must be one of: ${[...VALID_WEEKDAYS].join(', ')}`);

    // Check if rule already exists for this task
    let existing = null;
    for (const r of this._rules.values())
      if (r.workspaceId === workspaceId && r.taskId === taskId) { existing = r; break; }

    if (existing) {
      existing.frequency  = frequency;
      existing.interval   = iv;
      existing.weekday    = frequency === 'weekly'  ? (weekday || null) : null;
      existing.dayOfMonth = frequency === 'monthly' ? this._clampDayOfMonth(dayOfMonth || 1) : null;
      existing.enabled    = true;
      existing.updatedAt  = new Date().toISOString();
      await this._dbUpsertRule(existing);
      return existing;
    }

    const rule = new RecurrenceRule({
      workspaceId,
      taskId,
      frequency,
      interval:    iv,
      weekday:     frequency === 'weekly'  ? (weekday || null) : null,
      dayOfMonth:  frequency === 'monthly' ? this._clampDayOfMonth(dayOfMonth || 1) : null,
    });

    this._rules.set(rule.id, rule);
    await this._dbUpsertRule(rule);
    this._log.info({ ruleId: rule.id, taskId, frequency }, 'recurrence rule created');
    return rule;
  }

  // ── deleteRecurrence ──────────────────────────────────────────────────
  async deleteRecurrence(workspaceId, taskId) {
    if (!workspaceId) throw new RecurrenceRuleError('workspaceId required');
    if (!taskId)      throw new RecurrenceRuleError('taskId required');

    let found = null;
    for (const r of this._rules.values())
      if (r.workspaceId === workspaceId && r.taskId === taskId) { found = r; break; }

    if (!found) throw new RecurrenceNotFoundError(taskId);
    this._rules.delete(found.id);
    await this._dbDeleteRule(found.id);
    return { deleted: true, ruleId: found.id, taskId };
  }

  // ── getRecurrence ─────────────────────────────────────────────────────
  async getRecurrence(workspaceId, taskId) {
    for (const r of this._rules.values())
      if (r.workspaceId === workspaceId && r.taskId === taskId) return r;
    throw new RecurrenceNotFoundError(taskId);
  }

  // ── listRecurring ─────────────────────────────────────────────────────
  async listRecurring(workspaceId, { enabledOnly = false } = {}) {
    if (!workspaceId) throw new RecurrenceRuleError('workspaceId required');
    const rules = [...this._rules.values()]
      .filter(r => r.workspaceId === workspaceId)
      .filter(r => !enabledOnly || r.enabled)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return rules;
  }

  // ── spawnNext (called when a task is completed) ───────────────────────
  /**
   * Spawns the next recurrence instance for a completed task.
   * Returns the new childTaskId (a generated ID; caller wires into TaskService).
   * Also emits audit if _auditTrail is injected.
   */
  async spawnNext(workspaceId, completedTaskId, { actorId, auditTrail } = {}) {
    if (!workspaceId)     throw new RecurrenceRuleError('workspaceId required');
    if (!completedTaskId) throw new RecurrenceRuleError('completedTaskId required');

    let rule = null;
    for (const r of this._rules.values())
      if (r.workspaceId === workspaceId && r.taskId === completedTaskId && r.enabled)
        { rule = r; break; }

    if (!rule) return null; // no recurrence — caller ignores

    const childTaskId = `task_rec_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const instance = new RecurrenceInstance({
      ruleId:       rule.id,
      workspaceId,
      parentTaskId: completedTaskId,
      childTaskId,
    });

    rule.spawnCount++;
    rule.lastSpawnAt = new Date().toISOString();
    rule.updatedAt   = new Date().toISOString();
    // Update template task to point to newest child
    rule.taskId = childTaskId;

    this._instances.set(instance.id, instance);
    await this._dbInsertInstance(instance);
    await this._dbUpsertRule(rule);

    if (auditTrail) {
      try {
        await auditTrail.record(workspaceId, 'task.recurrence.spawned', {
          actorId: actorId || 'system',
          targetId: childTaskId,
          targetType: 'task',
          payload: { parentTaskId: completedTaskId, ruleId: rule.id },
        });
      } catch (_) { /* non-fatal */ }
    }

    this._log.info({ ruleId: rule.id, childTaskId }, 'recurrence spawned');
    return { instance: instance.toJSON(), rule: rule.toJSON() };
  }

  // ── listInstances ─────────────────────────────────────────────────────
  async listInstances(workspaceId, { ruleId, limit = 50 } = {}) {
    let items = [...this._instances.values()]
      .filter(i => i.workspaceId === workspaceId)
      .filter(i => !ruleId || i.ruleId === ruleId)
      .sort((a, b) => b.spawnedAt.localeCompare(a.spawnedAt))
      .slice(0, limit);
    return items;
  }

  // ── stats ─────────────────────────────────────────────────────────────
  async stats(workspaceId) {
    const rules     = [...this._rules.values()].filter(r => r.workspaceId === workspaceId);
    const instances = [...this._instances.values()].filter(i => i.workspaceId === workspaceId);
    const byFreq    = { daily: 0, weekly: 0, monthly: 0 };
    for (const r of rules) byFreq[r.frequency] = (byFreq[r.frequency] || 0) + 1;
    return {
      workspaceId,
      totalRules:     rules.length,
      enabledRules:   rules.filter(r => r.enabled).length,
      totalInstances: instances.length,
      byFrequency:    byFreq,
    };
  }

  // ── DB helpers ────────────────────────────────────────────────────────
  async _dbUpsertRule(rule) {
    if (!this._db) return;
    try {
      await this._db.query(
        `INSERT INTO recurrence_rules
           (id,workspace_id,task_id,frequency,interval_n,weekday,day_of_month,enabled,spawn_count,last_spawn_at,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO UPDATE SET
           task_id=$3, frequency=$4, interval_n=$5, weekday=$6, day_of_month=$7,
           enabled=$8, spawn_count=$9, last_spawn_at=$10, updated_at=$12`,
        [rule.id, rule.workspaceId, rule.taskId, rule.frequency, rule.interval,
         rule.weekday, rule.dayOfMonth, rule.enabled, rule.spawnCount,
         rule.lastSpawnAt, rule.createdAt, rule.updatedAt]
      );
    } catch (e) { this._log.warn({ err: e.message }, 'DB upsert recurrence_rules failed'); }
  }

  async _dbDeleteRule(id) {
    if (!this._db) return;
    try {
      await this._db.query('DELETE FROM recurrence_rules WHERE id=$1', [id]);
    } catch (e) { this._log.warn({ err: e.message }, 'DB delete recurrence_rules failed'); }
  }

  async _dbInsertInstance(inst) {
    if (!this._db) return;
    try {
      await this._db.query(
        `INSERT INTO recurrence_instances (id,rule_id,workspace_id,parent_task_id,child_task_id,spawned_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [inst.id, inst.ruleId, inst.workspaceId, inst.parentTaskId, inst.childTaskId, inst.spawnedAt]
      );
    } catch (e) { this._log.warn({ err: e.message }, 'DB insert recurrence_instances failed'); }
  }
}

// ── Default singleton ─────────────────────────────────────────────────────
const _defaultRecurrenceService = new WorkspaceTaskRecurrenceService();

// ── Exports ───────────────────────────────────────────────────────────────
module.exports = {
  WorkspaceTaskRecurrenceService,
  RecurrenceNotFoundError,
  RecurrenceRuleError,
  VALID_FREQUENCIES,
};

if (process.env.NODE_ENV === 'test') {
  module.exports._recurrenceService = _defaultRecurrenceService;
}
