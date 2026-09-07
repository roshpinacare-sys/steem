/**
 * lib/workspaceBulkOpsService.js — V162
 * ======================================
 * Workspace Bulk Operations
 * פעולות מרוכזות על tasks — status / assign / delete batch
 *
 * תכונות:
 *  - bulkStatus:  שינוי status עד 500 tasks בפעולה אחת
 *  - bulkAssign:  הקצאת validator עד 500 tasks
 *  - bulkDelete:  soft-delete batch של tasks
 *  - audit:       כל פעולה bulk מצמיחה audit events
 *  - דוח per-task: [{ taskId, ok, error }]
 *
 * Exports: WorkspaceBulkOpsService, BulkOpsLimitError, BulkOpsValidationError
 * Sacred Files: lib/fiatLedger.js, lib/auditLog.js — UNTOUCHED
 * [V162-TASK-02]
 */

'use strict';

const crypto = require('crypto');

// ── Constants ─────────────────────────────────────────────────────────────
const BULK_MAX = 500;
const VALID_STATUSES = new Set(['pending','in_progress','done','cancelled','archived']);

// ── Errors ────────────────────────────────────────────────────────────────
class BulkOpsLimitError extends Error {
  constructor(count) {
    super(`Bulk operation exceeds maximum of ${BULK_MAX} items (got ${count})`);
    this.name = 'BulkOpsLimitError';
    this.code = 'BULK_LIMIT_EXCEEDED';
    this.statusCode = 400;
  }
}

class BulkOpsValidationError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'BulkOpsValidationError';
    this.code = 'BULK_VALIDATION_ERROR';
    this.statusCode = 400;
  }
}

// ── BulkOpsLog record ─────────────────────────────────────────────────────
class BulkOpsLog {
  constructor(data) {
    this.id          = data.id          || `blk_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    this.workspaceId = data.workspaceId;
    this.operation   = data.operation;   // 'status' | 'assign' | 'delete'
    this.actorId     = data.actorId     || null;
    this.taskIds     = data.taskIds     || [];
    this.params      = data.params      || {};
    this.results     = data.results     || [];
    this.successCount= data.successCount|| 0;
    this.errorCount  = data.errorCount  || 0;
    this.createdAt   = data.createdAt   || new Date().toISOString();
  }

  toJSON() {
    return {
      id:           this.id,
      workspaceId:  this.workspaceId,
      operation:    this.operation,
      actorId:      this.actorId,
      taskIds:      this.taskIds,
      params:       this.params,
      results:      this.results,
      successCount: this.successCount,
      errorCount:   this.errorCount,
      createdAt:    this.createdAt,
    };
  }
}

// ── Service ───────────────────────────────────────────────────────────────
class WorkspaceBulkOpsService {
  constructor() {
    /** @type {Map<string, BulkOpsLog>} id → log */
    this._logs = new Map();
    /** @type {import('pg').Pool|null} */
    this._db   = null;
    this._log  = { info: () => {}, warn: () => {} };
    // Injected optional dependencies
    this._taskService  = null; // must implement updateTask, deleteTask, assignTask
    this._auditTrail   = null;
  }

  setDb(pool)            { this._db           = pool; }
  setLogger(log)         { this._log           = log; }
  setTaskService(svc)    { this._taskService   = svc; }
  setAuditTrail(svc)     { this._auditTrail    = svc; }

  // ── Internal: validate and deduplicate IDs ────────────────────────────
  _prepareIds(taskIds) {
    if (!Array.isArray(taskIds) || taskIds.length === 0)
      throw new BulkOpsValidationError('taskIds must be a non-empty array');
    const deduped = [...new Set(taskIds.map(id => String(id)).filter(Boolean))];
    if (deduped.length > BULK_MAX)
      throw new BulkOpsLimitError(deduped.length);
    return deduped;
  }

  // ── bulkStatus ────────────────────────────────────────────────────────
  async bulkStatus(workspaceId, { taskIds, status, actorId } = {}) {
    if (!workspaceId) throw new BulkOpsValidationError('workspaceId required');
    if (!status)      throw new BulkOpsValidationError('status required');
    if (!VALID_STATUSES.has(status))
      throw new BulkOpsValidationError(`status must be one of: ${[...VALID_STATUSES].join(', ')}`);

    const ids     = this._prepareIds(taskIds);
    const results = [];

    for (const taskId of ids) {
      try {
        if (this._taskService) {
          await this._taskService.updateTask(taskId, { status });
        }
        results.push({ taskId, ok: true });
      } catch (err) {
        results.push({ taskId, ok: false, error: err.message });
      }
    }

    return await this._saveLog(workspaceId, 'status', ids, { status }, results, actorId);
  }

  // ── bulkAssign ────────────────────────────────────────────────────────
  async bulkAssign(workspaceId, { taskIds, assigneeId, actorId } = {}) {
    if (!workspaceId) throw new BulkOpsValidationError('workspaceId required');
    if (!assigneeId)  throw new BulkOpsValidationError('assigneeId required');

    const ids     = this._prepareIds(taskIds);
    const results = [];

    for (const taskId of ids) {
      try {
        if (this._taskService && typeof this._taskService.assignTask === 'function') {
          await this._taskService.assignTask(taskId, assigneeId);
        } else if (this._taskService && typeof this._taskService.updateTask === 'function') {
          await this._taskService.updateTask(taskId, { assigneeId });
        }
        results.push({ taskId, ok: true });
      } catch (err) {
        results.push({ taskId, ok: false, error: err.message });
      }
    }

    return await this._saveLog(workspaceId, 'assign', ids, { assigneeId }, results, actorId);
  }

  // ── bulkDelete ────────────────────────────────────────────────────────
  async bulkDelete(workspaceId, { taskIds, actorId } = {}) {
    if (!workspaceId) throw new BulkOpsValidationError('workspaceId required');

    const ids     = this._prepareIds(taskIds);
    const results = [];

    for (const taskId of ids) {
      try {
        if (this._taskService && typeof this._taskService.deleteTask === 'function') {
          await this._taskService.deleteTask(taskId);
        }
        results.push({ taskId, ok: true });
      } catch (err) {
        results.push({ taskId, ok: false, error: err.message });
      }
    }

    return await this._saveLog(workspaceId, 'delete', ids, {}, results, actorId);
  }

  // ── _saveLog ──────────────────────────────────────────────────────────
  async _saveLog(workspaceId, operation, ids, params, results, actorId) {
    const successCount = results.filter(r => r.ok).length;
    const errorCount   = results.filter(r => !r.ok).length;

    const log = new BulkOpsLog({
      workspaceId,
      operation,
      actorId: actorId || null,
      taskIds: ids,
      params,
      results,
      successCount,
      errorCount,
    });

    this._logs.set(log.id, log);
    await this._dbInsertLog(log);

    if (this._auditTrail) {
      try {
        await this._auditTrail.record(workspaceId, `task.bulk.${operation}`, {
          actorId: actorId || 'system',
          targetId: workspaceId,
          targetType: 'workspace',
          payload: { count: ids.length, successCount, errorCount, params },
        });
      } catch (_) { /* non-fatal */ }
    }

    this._log.info({ op: operation, count: ids.length, successCount, errorCount }, 'bulk op complete');
    return log.toJSON();
  }

  // ── listLogs ──────────────────────────────────────────────────────────
  async listLogs(workspaceId, { operation, limit = 50 } = {}) {
    if (!workspaceId) throw new BulkOpsValidationError('workspaceId required');
    return [...this._logs.values()]
      .filter(l => l.workspaceId === workspaceId)
      .filter(l => !operation || l.operation === operation)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map(l => l.toJSON());
  }

  // ── stats ─────────────────────────────────────────────────────────────
  async stats(workspaceId) {
    const logs = [...this._logs.values()].filter(l => l.workspaceId === workspaceId);
    const byOp = {};
    for (const l of logs) byOp[l.operation] = (byOp[l.operation] || 0) + 1;
    return {
      workspaceId,
      totalOperations: logs.length,
      totalTasksProcessed: logs.reduce((s, l) => s + l.taskIds.length, 0),
      totalSuccess: logs.reduce((s, l) => s + l.successCount, 0),
      totalErrors:  logs.reduce((s, l) => s + l.errorCount,   0),
      byOperation:  byOp,
    };
  }

  // ── DB helpers ────────────────────────────────────────────────────────
  async _dbInsertLog(log) {
    if (!this._db) return;
    try {
      await this._db.query(
        `INSERT INTO bulk_ops_log
           (id,workspace_id,operation,actor_id,task_ids,params,results,success_count,error_count,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
        [log.id, log.workspaceId, log.operation, log.actorId,
         JSON.stringify(log.taskIds), JSON.stringify(log.params), JSON.stringify(log.results),
         log.successCount, log.errorCount, log.createdAt]
      );
    } catch (e) { this._log.warn({ err: e.message }, 'DB insert bulk_ops_log failed'); }
  }
}

// ── Default singleton ─────────────────────────────────────────────────────
const _defaultBulkOpsService = new WorkspaceBulkOpsService();

// ── Exports ───────────────────────────────────────────────────────────────
module.exports = {
  WorkspaceBulkOpsService,
  BulkOpsLimitError,
  BulkOpsValidationError,
  BULK_MAX,
  VALID_STATUSES,
};

if (process.env.NODE_ENV === 'test') {
  module.exports._bulkOpsService = _defaultBulkOpsService;
}
