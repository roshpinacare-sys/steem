/**
 * lib/taskRecurrenceService.js — V169
 * =====================================
 * Task Recurrence Rules
 * הגדרת חוקי חזרה למשימות עם מפרט דמוי RRULE
 *
 * תכונות:
 *  - הגדרה, שליפה ומחיקה של חוק חזרה לכל משימה
 *  - תדירויות: daily / weekly / monthly
 *  - פרמטרים: interval (מרווח), until (תאריך סיום), count (מספר חזרות)
 *  - חישוב תאריך ה-occurrence הבא
 *  - In-memory + DB dual persistence
 *  - R8: NODE_ENV === 'test' export block
 *
 * Sacred Files: lib/fiatLedger.js, lib/auditLog.js — UNTOUCHED
 * [V169-T01]
 *
 * @version 169.0.0
 */

'use strict';

const crypto = require('crypto');

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_FREQUENCIES = Object.freeze(['daily', 'weekly', 'monthly']);
const MAX_COUNT         = 1000;
const MAX_INTERVAL      = 365;

// ── Errors ────────────────────────────────────────────────────────────────────

class RecurrenceValidationError extends Error {
  constructor(msg) {
    super(msg);
    this.name       = 'RecurrenceValidationError';
    this.code       = 'RECURRENCE_VALIDATION_ERROR';
    this.statusCode = 400;
  }
}

class RecurrenceNotFoundError extends Error {
  constructor(taskId) {
    super(`Recurrence rule not found for task: ${taskId}`);
    this.name       = 'RecurrenceNotFoundError';
    this.code       = 'RECURRENCE_NOT_FOUND';
    this.statusCode = 404;
  }
}

// ── Value Objects ─────────────────────────────────────────────────────────────

class RecurrenceRule {
  /**
   * @param {object} opts
   * @param {string} opts.id
   * @param {string} opts.workspaceId
   * @param {string} opts.taskId
   * @param {string} opts.frequency  — daily | weekly | monthly
   * @param {number} [opts.interval] — default 1
   * @param {string|null} [opts.until]   — ISO date string
   * @param {number|null} [opts.count]   — max occurrences
   * @param {string} opts.createdAt
   */
  constructor({ id, workspaceId, taskId, frequency, interval = 1, until = null, count = null, createdAt }) {
    this.id          = id;
    this.workspaceId = workspaceId;
    this.taskId      = taskId;
    this.frequency   = frequency;
    this.interval    = interval;
    this.until       = until;
    this.count       = count;
    this.createdAt   = createdAt;
  }

  /**
   * Compute the next occurrence date after `fromDate`.
   * @param {Date} [fromDate] — defaults to now
   * @returns {Date|null} next occurrence, or null if exhausted
   */
  nextOccurrence(fromDate = new Date()) {
    const d = new Date(fromDate);
    switch (this.frequency) {
      case 'daily':
        d.setDate(d.getDate() + this.interval);
        break;
      case 'weekly':
        d.setDate(d.getDate() + this.interval * 7);
        break;
      case 'monthly':
        d.setMonth(d.getMonth() + this.interval);
        break;
      default:
        return null;
    }
    if (this.until && d > new Date(this.until)) return null;
    return d;
  }

  toJSON() {
    return {
      id:          this.id,
      workspaceId: this.workspaceId,
      taskId:      this.taskId,
      frequency:   this.frequency,
      interval:    this.interval,
      until:       this.until,
      count:       this.count,
      createdAt:   this.createdAt,
    };
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

class TaskRecurrenceService {
  /**
   * @param {object} opts
   * @param {object|null} opts.pool      — pg Pool (null in test / in-memory mode)
   * @param {boolean}     opts.dbEnabled — false → in-memory only
   */
  constructor({ pool = null, dbEnabled = false } = {}) {
    this._pool      = pool;
    this._dbEnabled = dbEnabled;
    /** @type {Map<string, Map<string, RecurrenceRule>>} workspaceId → taskId → rule */
    this._store = new Map();
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  _wsMap(workspaceId) {
    if (!this._store.has(workspaceId)) this._store.set(workspaceId, new Map());
    return this._store.get(workspaceId);
  }

  _validate({ frequency, interval, until, count }) {
    if (!frequency || !VALID_FREQUENCIES.includes(frequency)) {
      throw new RecurrenceValidationError(`frequency must be one of: ${VALID_FREQUENCIES.join(', ')}`);
    }
    if (interval !== undefined && interval !== null) {
      if (!Number.isInteger(interval) || interval < 1 || interval > MAX_INTERVAL) {
        throw new RecurrenceValidationError(`interval must be an integer between 1 and ${MAX_INTERVAL}`);
      }
    }
    if (until !== undefined && until !== null) {
      if (typeof until !== 'string' || isNaN(Date.parse(until))) {
        throw new RecurrenceValidationError('until must be a valid ISO date string');
      }
    }
    if (count !== undefined && count !== null) {
      if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
        throw new RecurrenceValidationError(`count must be an integer between 1 and ${MAX_COUNT}`);
      }
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Set (create or replace) a recurrence rule for a task.
   * @param {string} workspaceId
   * @param {string} taskId
   * @param {object} opts
   * @param {string} opts.frequency
   * @param {number} [opts.interval]
   * @param {string|null} [opts.until]
   * @param {number|null} [opts.count]
   * @returns {Promise<RecurrenceRule>}
   * @version 169.0.0
   */
  async setRecurrence(workspaceId, taskId, { frequency, interval = 1, until = null, count = null } = {}) {
    if (!workspaceId) throw new RecurrenceValidationError('workspaceId required');
    if (!taskId)      throw new RecurrenceValidationError('taskId required');
    this._validate({ frequency, interval, until, count });

    const rule = new RecurrenceRule({
      id:          crypto.randomUUID(),
      workspaceId,
      taskId,
      frequency,
      interval,
      until,
      count,
      createdAt:   new Date().toISOString(),
    });

    this._wsMap(workspaceId).set(taskId, rule);

    if (this._dbEnabled && this._pool) {
      await this._pool.query(
        `INSERT INTO workspace_task_recurrence_rules
           (id, workspace_id, task_id, frequency, interval_val, until_date, max_count, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (workspace_id, task_id) DO UPDATE
           SET frequency=$4, interval_val=$5, until_date=$6, max_count=$7, created_at=$8`,
        [rule.id, workspaceId, taskId, frequency, interval, until, count, rule.createdAt],
      );
    }

    return rule;
  }

  /**
   * Retrieve the recurrence rule for a task.
   * @param {string} workspaceId
   * @param {string} taskId
   * @returns {Promise<RecurrenceRule>}
   * @version 169.0.0
   */
  async getRecurrence(workspaceId, taskId) {
    if (!workspaceId) throw new RecurrenceValidationError('workspaceId required');
    if (!taskId)      throw new RecurrenceValidationError('taskId required');

    const rule = this._wsMap(workspaceId).get(taskId);
    if (!rule) throw new RecurrenceNotFoundError(taskId);
    return rule;
  }

  /**
   * Delete the recurrence rule for a task.
   * @param {string} workspaceId
   * @param {string} taskId
   * @returns {Promise<{deleted: boolean}>}
   * @version 169.0.0
   */
  async deleteRecurrence(workspaceId, taskId) {
    if (!workspaceId) throw new RecurrenceValidationError('workspaceId required');
    if (!taskId)      throw new RecurrenceValidationError('taskId required');

    const map = this._wsMap(workspaceId);
    if (!map.has(taskId)) throw new RecurrenceNotFoundError(taskId);
    map.delete(taskId);

    if (this._dbEnabled && this._pool) {
      await this._pool.query(
        'DELETE FROM workspace_task_recurrence_rules WHERE workspace_id=$1 AND task_id=$2',
        [workspaceId, taskId],
      );
    }

    return { deleted: true };
  }

  /**
   * List all recurrence rules for a workspace.
   * @param {string} workspaceId
   * @returns {RecurrenceRule[]}
   * @version 169.0.0
   */
  listRecurrences(workspaceId) {
    return [...(this._wsMap(workspaceId).values())];
  }

  /**
   * Clear all rules for a workspace (test helper).
   * @param {string} workspaceId
   * @version 169.0.0
   */
  clearWorkspace(workspaceId) {
    this._store.delete(workspaceId);
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  TaskRecurrenceService,
  RecurrenceValidationError,
  RecurrenceNotFoundError,
  RecurrenceRule,
};
