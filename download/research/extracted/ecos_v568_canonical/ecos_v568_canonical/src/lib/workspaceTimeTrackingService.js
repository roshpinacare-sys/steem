/**
 * lib/workspaceTimeTrackingService.js — V162
 * ===========================================
 * Task Time Tracking
 * מעקב זמן לtasks — start/stop timer + manual log
 *
 * תכונות:
 *  - startTimer / stopTimer: מדידת זמן ריאלי per task
 *  - logManual: רישום זמן ידני (שעות)
 *  - getTaskTotal: סה״כ שעות לtask
 *  - workspaceLeaderboard: top מדווחי שעות ב-workspace
 *  - DB: workspace_time_entries
 *
 * Exports: WorkspaceTimeTrackingService, TimeEntryNotFoundError, TimerAlreadyRunningError, TimerNotRunningError
 * Sacred Files: lib/fiatLedger.js, lib/auditLog.js — UNTOUCHED
 * [V162-TASK-03]
 */

'use strict';

const crypto = require('crypto');

// ── Errors ────────────────────────────────────────────────────────────────
class TimeEntryNotFoundError extends Error {
  constructor(id) {
    super(`Time entry not found: ${id}`);
    this.name = 'TimeEntryNotFoundError';
    this.code = 'TIME_ENTRY_NOT_FOUND';
    this.statusCode = 404;
  }
}

class TimerAlreadyRunningError extends Error {
  constructor(taskId) {
    super(`Timer already running for task ${taskId}`);
    this.name = 'TimerAlreadyRunningError';
    this.code = 'TIMER_ALREADY_RUNNING';
    this.statusCode = 409;
  }
}

class TimerNotRunningError extends Error {
  constructor(taskId) {
    super(`No active timer for task ${taskId}`);
    this.name = 'TimerNotRunningError';
    this.code = 'TIMER_NOT_RUNNING';
    this.statusCode = 409;
  }
}

class TimeTrackingValidationError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'TimeTrackingValidationError';
    this.code = 'TIME_TRACKING_VALIDATION';
    this.statusCode = 400;
  }
}

// ── TimeEntry record ──────────────────────────────────────────────────────
class TimeEntry {
  constructor(data) {
    this.id          = data.id          || `te_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    this.workspaceId = data.workspaceId;
    this.taskId      = data.taskId;
    this.userId      = data.userId      || null;
    this.type        = data.type        || 'manual'; // 'manual' | 'timer'
    this.startedAt   = data.startedAt   || null;
    this.stoppedAt   = data.stoppedAt   || null;
    this.durationSec = data.durationSec || 0; // computed or provided
    this.note        = data.note        || '';
    this.createdAt   = data.createdAt   || new Date().toISOString();
    this._running    = data._running    || false; // in-memory only
  }

  get isRunning() { return this._running; }

  /** Duration in seconds, updated on stop */
  computeDuration(nowIso) {
    if (!this.startedAt) return 0;
    const start = new Date(this.startedAt).getTime();
    const end   = nowIso ? new Date(nowIso).getTime() : Date.now();
    return Math.max(0, Math.floor((end - start) / 1000));
  }

  toJSON() {
    return {
      id:          this.id,
      workspaceId: this.workspaceId,
      taskId:      this.taskId,
      userId:      this.userId,
      type:        this.type,
      startedAt:   this.startedAt,
      stoppedAt:   this.stoppedAt,
      durationSec: this.durationSec,
      durationMin: +(this.durationSec / 60).toFixed(2),
      durationHrs: +(this.durationSec / 3600).toFixed(4),
      isRunning:   this._running,
      note:        this.note,
      createdAt:   this.createdAt,
    };
  }
}

// ── Service ───────────────────────────────────────────────────────────────
class WorkspaceTimeTrackingService {
  constructor() {
    /** @type {Map<string, TimeEntry>} id → entry */
    this._entries = new Map();
    /**
     * Active timers: "workspaceId:taskId:userId" → entryId
     * @type {Map<string, string>}
     */
    this._active  = new Map();
    /** @type {import('pg').Pool|null} */
    this._db   = null;
    this._log  = { info: () => {}, warn: () => {} };
  }

  setDb(pool)    { this._db  = pool; }
  setLogger(log) { this._log = log;  }

  _timerKey(workspaceId, taskId, userId) {
    return `${workspaceId}:${taskId}:${userId || '__anon__'}`;
  }

  // ── startTimer ────────────────────────────────────────────────────────
  async startTimer(workspaceId, taskId, { userId, note } = {}) {
    if (!workspaceId) throw new TimeTrackingValidationError('workspaceId required');
    if (!taskId)      throw new TimeTrackingValidationError('taskId required');

    const key = this._timerKey(workspaceId, taskId, userId);
    if (this._active.has(key)) throw new TimerAlreadyRunningError(taskId);

    const entry = new TimeEntry({
      workspaceId,
      taskId,
      userId:    userId  || null,
      type:      'timer',
      startedAt: new Date().toISOString(),
      note:      note || '',
      _running:  true,
    });

    this._entries.set(entry.id, entry);
    this._active.set(key, entry.id);
    this._log.info({ entryId: entry.id, taskId, userId }, 'timer started');
    return entry;
  }

  // ── stopTimer ─────────────────────────────────────────────────────────
  async stopTimer(workspaceId, taskId, { userId, note } = {}) {
    if (!workspaceId) throw new TimeTrackingValidationError('workspaceId required');
    if (!taskId)      throw new TimeTrackingValidationError('taskId required');

    const key     = this._timerKey(workspaceId, taskId, userId);
    const entryId = this._active.get(key);
    if (!entryId) throw new TimerNotRunningError(taskId);

    const entry     = this._entries.get(entryId);
    const stoppedAt = new Date().toISOString();
    entry.stoppedAt  = stoppedAt;
    entry.durationSec= entry.computeDuration(stoppedAt);
    entry._running   = false;
    if (note) entry.note = note;

    this._active.delete(key);
    await this._dbUpsertEntry(entry);
    this._log.info({ entryId: entry.id, durationSec: entry.durationSec }, 'timer stopped');
    return entry;
  }

  // ── logManual ─────────────────────────────────────────────────────────
  async logManual(workspaceId, taskId, { userId, durationMin, durationHrs, note } = {}) {
    if (!workspaceId) throw new TimeTrackingValidationError('workspaceId required');
    if (!taskId)      throw new TimeTrackingValidationError('taskId required');

    // Accept either durationMin or durationHrs
    let totalSec = 0;
    if (durationMin  != null) totalSec = Math.round(Number(durationMin)  * 60);
    if (durationHrs  != null) totalSec = Math.round(Number(durationHrs)  * 3600);
    if (totalSec <= 0) throw new TimeTrackingValidationError('duration must be positive (provide durationMin or durationHrs)');
    if (totalSec > 86400 * 30) throw new TimeTrackingValidationError('duration cannot exceed 30 days');

    const now   = new Date().toISOString();
    const entry = new TimeEntry({
      workspaceId,
      taskId,
      userId:      userId || null,
      type:        'manual',
      startedAt:   now,
      stoppedAt:   now,
      durationSec: totalSec,
      note:        note || '',
    });

    this._entries.set(entry.id, entry);
    await this._dbUpsertEntry(entry);
    this._log.info({ entryId: entry.id, totalSec }, 'manual time logged');
    return entry;
  }

  // ── getEntry ──────────────────────────────────────────────────────────
  async getEntry(entryId) {
    const e = this._entries.get(entryId);
    if (!e) throw new TimeEntryNotFoundError(entryId);
    return e;
  }

  // ── listEntries ───────────────────────────────────────────────────────
  async listEntries(workspaceId, { taskId, userId, type, limit = 100 } = {}) {
    if (!workspaceId) throw new TimeTrackingValidationError('workspaceId required');
    return [...this._entries.values()]
      .filter(e => e.workspaceId === workspaceId)
      .filter(e => !taskId || e.taskId   === taskId)
      .filter(e => !userId || e.userId   === userId)
      .filter(e => !type   || e.type     === type)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map(e => e.toJSON());
  }

  // ── getTaskTotal ──────────────────────────────────────────────────────
  async getTaskTotal(workspaceId, taskId) {
    if (!workspaceId) throw new TimeTrackingValidationError('workspaceId required');
    if (!taskId)      throw new TimeTrackingValidationError('taskId required');
    const entries = [...this._entries.values()]
      .filter(e => e.workspaceId === workspaceId && e.taskId === taskId && !e._running);
    const totalSec = entries.reduce((s, e) => s + e.durationSec, 0);
    return {
      workspaceId, taskId,
      totalSec,
      totalMin: +(totalSec / 60).toFixed(2),
      totalHrs: +(totalSec / 3600).toFixed(4),
      entryCount: entries.length,
    };
  }

  // ── leaderboard ───────────────────────────────────────────────────────
  async leaderboard(workspaceId, { limit = 10 } = {}) {
    if (!workspaceId) throw new TimeTrackingValidationError('workspaceId required');
    const byUser = {};
    for (const e of this._entries.values()) {
      if (e.workspaceId !== workspaceId || e._running) continue;
      const uid = e.userId || 'anonymous';
      byUser[uid] = (byUser[uid] || 0) + e.durationSec;
    }
    const ranked = Object.entries(byUser)
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit)
      .map(([userId, totalSec], idx) => ({
        rank: idx + 1,
        userId,
        totalSec,
        totalHrs: +(totalSec / 3600).toFixed(4),
      }));
    return { workspaceId, leaderboard: ranked, asOf: new Date().toISOString() };
  }

  // ── stats ─────────────────────────────────────────────────────────────
  async stats(workspaceId) {
    if (!workspaceId) throw new TimeTrackingValidationError('workspaceId required');
    const entries     = [...this._entries.values()].filter(e => e.workspaceId === workspaceId);
    const completed   = entries.filter(e => !e._running);
    const totalSec    = completed.reduce((s, e) => s + e.durationSec, 0);
    const activeCount = [...this._active.keys()].filter(k => k.startsWith(workspaceId + ':')).length;
    return {
      workspaceId,
      totalEntries:   entries.length,
      activeTimers:   activeCount,
      completedEntries: completed.length,
      totalSec,
      totalHrs: +(totalSec / 3600).toFixed(4),
      manualEntries: completed.filter(e => e.type === 'manual').length,
      timerEntries:  completed.filter(e => e.type === 'timer').length,
    };
  }

  // ── DB helpers ────────────────────────────────────────────────────────
  async _dbUpsertEntry(entry) {
    if (!this._db) return;
    try {
      await this._db.query(
        `INSERT INTO workspace_time_entries
           (id,workspace_id,task_id,user_id,type,started_at,stopped_at,duration_sec,note,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET
           stopped_at=$7, duration_sec=$8, note=$9`,
        [entry.id, entry.workspaceId, entry.taskId, entry.userId,
         entry.type, entry.startedAt, entry.stoppedAt, entry.durationSec, entry.note, entry.createdAt]
      );
    } catch (e) { this._log.warn({ err: e.message }, 'DB upsert workspace_time_entries failed'); }
  }
}

// ── Default singleton ─────────────────────────────────────────────────────
const _defaultTimeTrackingService = new WorkspaceTimeTrackingService();

// ── Exports ───────────────────────────────────────────────────────────────
module.exports = {
  WorkspaceTimeTrackingService,
  TimeEntryNotFoundError,
  TimerAlreadyRunningError,
  TimerNotRunningError,
  TimeTrackingValidationError,
};

if (process.env.NODE_ENV === 'test') {
  module.exports._timeTrackingService = _defaultTimeTrackingService;
}
