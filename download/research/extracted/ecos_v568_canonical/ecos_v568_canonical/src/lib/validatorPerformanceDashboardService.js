/**
 * lib/validatorPerformanceDashboardService.js — V168
 * ====================================================
 * Validator Performance Dashboard
 * סטטיסטיקות ביצועים משולבות (SLA + time-tracking) לכל ולידטור
 *
 * תכונות:
 *  - מדדים: tasks_completed, avg_resolution_time, sla_breach_rate
 *  - תמיכה בטווח תאריכים (since/until)
 *  - In-memory dual persistence
 *  - DB: workspace_validator_perf_snapshots (טבלה חדשה Phase 42)
 *
 * Sacred Files: lib/fiatLedger.js, lib/auditLog.js — UNTOUCHED
 * [V168-T03]
 *
 * @version 168.0.0
 */

'use strict';

const crypto = require('crypto');

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_LOOKBACK_DAYS = 30;
const MAX_LOOKBACK_DAYS     = 365;

// ── Errors ────────────────────────────────────────────────────────────────────

class ValidatorPerfValidationError extends Error {
  constructor(msg) {
    super(msg);
    this.name       = 'ValidatorPerfValidationError';
    this.code       = 'VALIDATOR_PERF_VALIDATION_ERROR';
    this.statusCode = 400;
  }
}

class ValidatorNotFoundError extends Error {
  constructor(id) {
    super(`Validator not found: ${id}`);
    this.name       = 'ValidatorNotFoundError';
    this.code       = 'VALIDATOR_NOT_FOUND';
    this.statusCode = 404;
  }
}

// ── Value Objects ─────────────────────────────────────────────────────────────

class TaskRecord {
  /**
   * @param {object} data
   * @param {string} data.taskId
   * @param {string} data.workspaceId
   * @param {string} data.validatorId
   * @param {string} data.completedAt      — ISO string
   * @param {number} [data.resolutionMs]   — time from assignment to completion in ms
   * @param {boolean} [data.slaBreached]
   */
  constructor(data) {
    this.id            = data.id            || `tr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    this.taskId        = data.taskId;
    this.workspaceId   = data.workspaceId;
    this.validatorId   = data.validatorId;
    this.completedAt   = data.completedAt   || new Date().toISOString();
    this.resolutionMs  = typeof data.resolutionMs === 'number' ? data.resolutionMs : null;
    this.slaBreached   = !!data.slaBreached;
  }

  toJSON() {
    return {
      id:           this.id,
      taskId:       this.taskId,
      workspaceId:  this.workspaceId,
      validatorId:  this.validatorId,
      completedAt:  this.completedAt,
      resolutionMs: this.resolutionMs,
      slaBreached:  this.slaBreached,
    };
  }
}

class ValidatorPerfSummary {
  /**
   * @param {string} workspaceId
   * @param {string} validatorId
   * @param {object} stats
   */
  constructor(workspaceId, validatorId, stats) {
    this.workspaceId        = workspaceId;
    this.validatorId        = validatorId;
    this.tasksCompleted     = stats.tasksCompleted;
    this.avgResolutionMs    = stats.avgResolutionMs;
    this.avgResolutionHours = stats.avgResolutionMs != null
      ? Math.round((stats.avgResolutionMs / 3_600_000) * 10) / 10
      : null;
    this.slaBreachRate      = stats.slaBreachRate;   // 0–1 float
    this.slaBreachCount     = stats.slaBreachCount;
    this.since              = stats.since;
    this.until              = stats.until;
    this.generatedAt        = new Date().toISOString();
  }

  toJSON() {
    return {
      workspaceId:        this.workspaceId,
      validatorId:        this.validatorId,
      tasksCompleted:     this.tasksCompleted,
      avgResolutionMs:    this.avgResolutionMs,
      avgResolutionHours: this.avgResolutionHours,
      slaBreachRate:      this.slaBreachRate,
      slaBreachCount:     this.slaBreachCount,
      since:              this.since,
      until:              this.until,
      generatedAt:        this.generatedAt,
    };
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

class ValidatorPerformanceDashboardService {
  /**
   * @param {object} opts
   * @param {object|null} opts.pool        - pg Pool (null → in-memory only)
   * @param {boolean}     [opts.dbEnabled] - default true when pool provided
   * @version 168.0.0
   */
  constructor({ pool, dbEnabled }) {
    this._pool      = pool;
    this._dbEnabled = dbEnabled !== false && pool != null;

    /**
     * in-memory store: Map<workspaceId, Map<validatorId, TaskRecord[]>>
     */
    this._records = new Map();
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  _wsValidatorRecords(workspaceId, validatorId) {
    if (!this._records.has(workspaceId)) this._records.set(workspaceId, new Map());
    const ws = this._records.get(workspaceId);
    if (!ws.has(validatorId)) ws.set(validatorId, []);
    return ws.get(validatorId);
  }

  _hasValidator(workspaceId, validatorId) {
    return this._records.has(workspaceId) &&
           this._records.get(workspaceId).has(validatorId);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Record a completed task for a validator.
   *
   * @param {string} workspaceId
   * @param {string} validatorId
   * @param {object} data
   * @param {string} data.taskId
   * @param {number} [data.resolutionMs]
   * @param {boolean} [data.slaBreached]
   * @param {string} [data.completedAt]
   * @returns {TaskRecord}
   * @version 168.0.0
   */
  async recordCompletion(workspaceId, validatorId, data) {
    if (!workspaceId)  throw new ValidatorPerfValidationError('workspaceId required');
    if (!validatorId)  throw new ValidatorPerfValidationError('validatorId required');
    if (!data.taskId)  throw new ValidatorPerfValidationError('taskId required');

    if (data.resolutionMs !== undefined && data.resolutionMs !== null) {
      if (typeof data.resolutionMs !== 'number' || data.resolutionMs < 0)
        throw new ValidatorPerfValidationError('resolutionMs must be a non-negative number');
    }

    const record = new TaskRecord({ ...data, workspaceId, validatorId });
    this._wsValidatorRecords(workspaceId, validatorId).push(record);

    if (this._dbEnabled && this._pool) {
      await this._pool.query(
        `INSERT INTO workspace_validator_perf_snapshots
           (id, workspace_id, validator_id, task_id, completed_at, resolution_ms, sla_breached)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO NOTHING`,
        [record.id, workspaceId, validatorId, record.taskId,
         record.completedAt,
         record.resolutionMs,
         record.slaBreached],
      );
    }

    return record;
  }

  /**
   * Get performance summary for a validator.
   *
   * @param {string} workspaceId
   * @param {string} validatorId
   * @param {object} [opts]
   * @param {string} [opts.since]  — ISO date (default: 30 days ago)
   * @param {string} [opts.until]  — ISO date (default: now)
   * @returns {ValidatorPerfSummary}
   * @version 168.0.0
   */
  async getPerformance(workspaceId, validatorId, opts = {}) {
    if (!workspaceId) throw new ValidatorPerfValidationError('workspaceId required');
    if (!validatorId) throw new ValidatorPerfValidationError('validatorId required');

    const now      = new Date();
    const sinceStr = opts.since || new Date(now - DEFAULT_LOOKBACK_DAYS * 86_400_000).toISOString();
    const untilStr = opts.until || now.toISOString();

    const sinceDate = new Date(sinceStr);
    const untilDate = new Date(untilStr);

    if (isNaN(sinceDate.getTime())) throw new ValidatorPerfValidationError('since must be a valid ISO date');
    if (isNaN(untilDate.getTime())) throw new ValidatorPerfValidationError('until must be a valid ISO date');
    if (sinceDate > untilDate)      throw new ValidatorPerfValidationError('since must be before until');

    // Check validator exists
    if (!this._hasValidator(workspaceId, validatorId)) {
      if (this._dbEnabled && this._pool) {
        // try DB
        const { rows } = await this._pool.query(
          `SELECT COUNT(*)::int AS cnt FROM workspace_validator_perf_snapshots
           WHERE workspace_id=$1 AND validator_id=$2`,
          [workspaceId, validatorId],
        );
        if (!rows[0] || rows[0].cnt === 0) throw new ValidatorNotFoundError(validatorId);
      } else {
        throw new ValidatorNotFoundError(validatorId);
      }
    }

    let records = this._wsValidatorRecords(workspaceId, validatorId);

    // Filter by date range
    records = records.filter(r => {
      const d = new Date(r.completedAt);
      return d >= sinceDate && d <= untilDate;
    });

    const tasksCompleted = records.length;
    let avgResolutionMs  = null;
    let slaBreachCount   = 0;

    if (tasksCompleted > 0) {
      const withResolution = records.filter(r => r.resolutionMs != null);
      if (withResolution.length > 0) {
        avgResolutionMs = Math.round(
          withResolution.reduce((s, r) => s + r.resolutionMs, 0) / withResolution.length
        );
      }
      slaBreachCount = records.filter(r => r.slaBreached).length;
    }

    const slaBreachRate = tasksCompleted > 0
      ? Math.round((slaBreachCount / tasksCompleted) * 1000) / 1000
      : 0;

    return new ValidatorPerfSummary(workspaceId, validatorId, {
      tasksCompleted,
      avgResolutionMs,
      slaBreachRate,
      slaBreachCount,
      since:  sinceDate.toISOString(),
      until:  untilDate.toISOString(),
    });
  }

  /**
   * List all validatorIds known in this workspace.
   * @param {string} workspaceId
   * @returns {string[]}
   */
  listValidators(workspaceId) {
    if (!this._records.has(workspaceId)) return [];
    return Array.from(this._records.get(workspaceId).keys());
  }

  /**
   * Clear all records for a workspace (test helper).
   */
  clearWorkspace(workspaceId) {
    this._records.delete(workspaceId);
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  ValidatorPerformanceDashboardService,
  ValidatorPerfValidationError,
  ValidatorNotFoundError,
  TaskRecord,
  ValidatorPerfSummary,
  DEFAULT_LOOKBACK_DAYS,
  MAX_LOOKBACK_DAYS,
};

if (process.env.NODE_ENV === 'test') {
  module.exports._test = true;
}
