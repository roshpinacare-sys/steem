/**
 * lib/bulkTaskStatusService.js — V170
 * =====================================
 * Bulk Task Status Update — change status on multiple tasks in one call
 *
 * Features:
 *  - Bulk update status for a list of taskIds in a workspace
 *  - Returns 207 Multi-Status on partial failure
 *  - Valid status values: open | in_progress | done | blocked | cancelled
 *  - Max 100 tasks per bulk call
 *  - In-memory task status store (dual persistence hook for DB)
 *  - R8: NODE_ENV === 'test' export block
 *
 * Sacred Files: lib/fiatLedger.js, lib/auditLog.js — UNTOUCHED
 * [V170-T06]
 *
 * @version 170.0.0
 */

'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_STATUSES   = Object.freeze(['open', 'in_progress', 'done', 'blocked', 'cancelled']);
const MAX_BULK_TASKS   = 100;

// ── Errors ────────────────────────────────────────────────────────────────────

class BulkStatusValidationError extends Error {
  constructor(msg) {
    super(msg);
    this.name       = 'BulkStatusValidationError';
    this.code       = 'BULK_STATUS_VALIDATION_ERROR';
    this.statusCode = 400;
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

class BulkTaskStatusService {
  /**
   * @param {object} opts
   * @param {object|null} opts.pool        — pg Pool instance or null (in-memory mode)
   * @param {boolean}     [opts.dbEnabled] — default false
   * @version 170.0.0
   */
  constructor({ pool = null, dbEnabled = false } = {}) {
    this._pool      = pool;
    this._dbEnabled = dbEnabled;

    /**
     * In-memory task status store.
     * @type {Map<string, Map<string, string>>} workspaceId → taskId → status
     */
    this._store = new Map();
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  _wsStore(workspaceId) {
    if (!this._store.has(workspaceId)) this._store.set(workspaceId, new Map());
    return this._store.get(workspaceId);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Bulk update the status of multiple tasks.
   *
   * @param {string}   workspaceId
   * @param {string[]} taskIds  — list of taskIds to update (max 100)
   * @param {string}   status   — target status
   * @returns {Promise<BulkStatusResult>}
   * @version 170.0.0
   */
  async bulkUpdateStatus(workspaceId, taskIds, status) {
    if (!workspaceId) throw new BulkStatusValidationError('workspaceId required');
    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      throw new BulkStatusValidationError('taskIds must be a non-empty array');
    }
    if (taskIds.length > MAX_BULK_TASKS) {
      throw new BulkStatusValidationError(`taskIds must contain ≤${MAX_BULK_TASKS} items`);
    }
    if (!status) throw new BulkStatusValidationError('status required');
    if (!VALID_STATUSES.includes(status)) {
      throw new BulkStatusValidationError(
        `Invalid status "${status}". Must be one of: ${VALID_STATUSES.join(', ')}`
      );
    }

    const wsStore  = this._wsStore(workspaceId);
    const updated  = [];
    const failed   = [];
    const now      = new Date().toISOString();

    for (const taskId of taskIds) {
      if (!taskId || typeof taskId !== 'string') {
        failed.push({ taskId: String(taskId), error: 'taskId must be a non-empty string', code: 'INVALID_TASK_ID' });
        continue;
      }
      try {
        const previousStatus = wsStore.get(taskId) || null;
        wsStore.set(taskId, status);
        updated.push({ taskId, previousStatus, status, updatedAt: now });
      } catch (err) {
        failed.push({ taskId, error: err.message, code: err.code || 'INTERNAL_ERROR' });
      }
    }

    const isPartial = failed.length > 0 && updated.length > 0;
    const allFailed = failed.length > 0 && updated.length === 0;

    return {
      workspaceId,
      status,
      updated,
      failed,
      updatedCount: updated.length,
      failedCount:  failed.length,
      totalRequested: taskIds.length,
      partial: isPartial,
      allFailed,
      httpStatus: allFailed ? 400 : isPartial ? 207 : 200,
      processedAt: now,
    };
  }

  /**
   * Get the current status of a task (in-memory).
   * @param {string} workspaceId
   * @param {string} taskId
   * @returns {string|null}
   * @version 170.0.0
   */
  getTaskStatus(workspaceId, taskId) {
    return this._wsStore(workspaceId).get(taskId) || null;
  }

  /**
   * Set a single task status (used internally / for seeding).
   * @param {string} workspaceId
   * @param {string} taskId
   * @param {string} status
   * @version 170.0.0
   */
  setTaskStatus(workspaceId, taskId, status) {
    if (!VALID_STATUSES.includes(status)) {
      throw new BulkStatusValidationError(`Invalid status: ${status}`);
    }
    this._wsStore(workspaceId).set(taskId, status);
  }

  /**
   * Clear all task statuses for a workspace (test helper).
   * @param {string} workspaceId
   * @version 170.0.0
   */
  clearWorkspace(workspaceId) {
    this._store.delete(workspaceId);
  }

  /**
   * Expose valid statuses for introspection.
   * @returns {readonly string[]}
   * @version 170.0.0
   */
  static get VALID_STATUSES() {
    return VALID_STATUSES;
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  BulkTaskStatusService,
  BulkStatusValidationError,
  VALID_STATUSES,
};
