/**
 * lib/taskWatcherService.js — ECOS V176
 * ═══════════════════════════════════════════════════════════════════════════
 * Task Watcher Service — in-memory + optional DB persistence
 *
 * Provides a testable service layer on top of the V159 DB-only watcher routes.
 * Users can subscribe to a task to receive notifications when it changes.
 *
 * Features:
 *  - Watch a task (POST)   — idempotent (re-watching is a no-op)
 *  - Unwatch a task (DELETE)
 *  - List watchers for a task (GET)
 *  - List tasks watched by a user (GET)
 *  - In-memory store (Map) + optional DB write-through (workspace_task_watchers)
 *  - NODE_ENV=test exports (R8)
 *
 * Sacred Files: lib/fiatLedger.js, lib/auditLog.js — UNTOUCHED
 * [V176-T01]
 *
 * @version 176.0.0
 */
'use strict';

const crypto = require('node:crypto');

// ── Constants ────────────────────────────────────────────────────────────────
const MAX_WATCHERS_PER_TASK = 500;
const MAX_TASKS_WATCHED_PER_USER = 1000;

// ── Errors ───────────────────────────────────────────────────────────────────
class WatcherValidationError extends Error {
  constructor(msg) {
    super(msg);
    this.name       = 'WatcherValidationError';
    this.code       = 'WATCHER_VALIDATION_ERROR';
    this.statusCode = 400;
  }
}

class WatcherLimitError extends Error {
  constructor(msg) {
    super(msg);
    this.name       = 'WatcherLimitError';
    this.code       = 'WATCHER_LIMIT_REACHED';
    this.statusCode = 429;
  }
}

// ── Domain object ─────────────────────────────────────────────────────────────
class TaskWatcher {
  /**
   * @param {object} opts
   * @param {string}  opts.taskId
   * @param {string}  opts.workspaceId
   * @param {string}  opts.userId
   * @param {string} [opts.watchedAt]
   */
  constructor(opts = {}) {
    this.taskId      = opts.taskId;
    this.workspaceId = opts.workspaceId;
    this.userId      = opts.userId;
    this.watchedAt   = opts.watchedAt || new Date().toISOString();
  }

  toJSON() {
    return {
      taskId:      this.taskId,
      workspaceId: this.workspaceId,
      userId:      this.userId,
      watchedAt:   this.watchedAt,
    };
  }
}

// ── Service ───────────────────────────────────────────────────────────────────
class TaskWatcherService {
  /**
   * @param {object}  opts
   * @param {object} [opts.pool]      — pg pool (optional; null → in-memory only)
   * @param {boolean} [opts.dbEnabled]
   * @param {object} [opts.logger]
   */
  constructor({ pool = null, dbEnabled = true, logger = null } = {}) {
    /**
     * In-memory store: Map<`${taskId}:${userId}`, TaskWatcher>
     * Key is composite to allow O(1) lookup for watch/unwatch.
     */
    this._store     = new Map();
    this._pool      = pool;
    this._dbEnabled = dbEnabled && pool !== null;
    this._log       = logger || { info: () => {}, warn: () => {}, error: () => {} };
    this._version   = 'V176';
  }

  /** @private */
  _key(taskId, userId) {
    return `${taskId}:${userId}`;
  }

  // ── watch ─────────────────────────────────────────────────────────────────
  /**
   * Add a watcher to a task. Idempotent — re-watching returns the existing record.
   *
   * @param {string} taskId
   * @param {string} workspaceId
   * @param {string} userId
   * @returns {Promise<{ watcher: TaskWatcher, created: boolean }>}
   */
  async watch(taskId, workspaceId, userId) {
    if (!taskId)      throw new WatcherValidationError('taskId required');
    if (!workspaceId) throw new WatcherValidationError('workspaceId required');
    if (!userId)      throw new WatcherValidationError('userId required');

    const key = this._key(taskId, userId);

    // Idempotency: already watching
    if (this._store.has(key)) {
      return { watcher: this._store.get(key), created: false };
    }

    // Enforce per-task limit
    const taskWatchers = [...this._store.values()].filter(w => w.taskId === taskId);
    if (taskWatchers.length >= MAX_WATCHERS_PER_TASK) {
      throw new WatcherLimitError(`Task ${taskId} has reached the maximum watcher limit (${MAX_WATCHERS_PER_TASK})`);
    }

    // Enforce per-user limit
    const userWatches = [...this._store.values()].filter(w => w.userId === userId);
    if (userWatches.length >= MAX_TASKS_WATCHED_PER_USER) {
      throw new WatcherLimitError(`User ${userId} is watching too many tasks (max ${MAX_TASKS_WATCHED_PER_USER})`);
    }

    const watcher = new TaskWatcher({ taskId, workspaceId, userId });
    this._store.set(key, watcher);

    // DB write-through (fire-and-forget, non-fatal)
    if (this._dbEnabled && this._pool) {
      this._pool.query(
        `INSERT INTO workspace_task_watchers (task_id, workspace_id, user_id, watched_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (task_id, user_id) DO NOTHING`,
        [taskId, workspaceId, userId, watcher.watchedAt]
      ).catch(err => this._log.warn({ err: err.message }, '[V176] DB watch insert failed (non-fatal)'));
    }

    this._log.info({ taskId, workspaceId, userId }, '[V176-T01] Task watcher added');
    return { watcher, created: true };
  }

  // ── unwatch ───────────────────────────────────────────────────────────────
  /**
   * Remove a watcher from a task. Idempotent — unwatching a non-watched task is OK.
   *
   * @param {string} taskId
   * @param {string} userId
   * @returns {Promise<{ removed: boolean }>}
   */
  async unwatch(taskId, userId) {
    if (!taskId)  throw new WatcherValidationError('taskId required');
    if (!userId)  throw new WatcherValidationError('userId required');

    const key = this._key(taskId, userId);
    const existed = this._store.delete(key);

    if (existed && this._dbEnabled && this._pool) {
      this._pool.query(
        'DELETE FROM workspace_task_watchers WHERE task_id=$1 AND user_id=$2',
        [taskId, userId]
      ).catch(err => this._log.warn({ err: err.message }, '[V176] DB unwatch delete failed (non-fatal)'));
    }

    if (existed) {
      this._log.info({ taskId, userId }, '[V176-T01] Task watcher removed');
    }
    return { removed: existed };
  }

  // ── listWatchers ──────────────────────────────────────────────────────────
  /**
   * List all watchers for a given task.
   *
   * @param {string} taskId
   * @returns {Promise<TaskWatcher[]>}
   */
  async listWatchers(taskId) {
    if (!taskId) throw new WatcherValidationError('taskId required');
    return [...this._store.values()]
      .filter(w => w.taskId === taskId)
      .sort((a, b) => a.watchedAt.localeCompare(b.watchedAt));
  }

  // ── listWatchedTasks ──────────────────────────────────────────────────────
  /**
   * List all tasks watched by a given user (optionally filtered by workspace).
   *
   * @param {string}  userId
   * @param {object} [opts]
   * @param {string} [opts.workspaceId]
   * @returns {Promise<TaskWatcher[]>}
   */
  async listWatchedTasks(userId, { workspaceId } = {}) {
    if (!userId) throw new WatcherValidationError('userId required');
    return [...this._store.values()]
      .filter(w => w.userId === userId && (!workspaceId || w.workspaceId === workspaceId))
      .sort((a, b) => a.watchedAt.localeCompare(b.watchedAt));
  }

  // ── isWatching ────────────────────────────────────────────────────────────
  /**
   * Check whether a user is watching a specific task.
   *
   * @param {string} taskId
   * @param {string} userId
   * @returns {boolean}
   */
  isWatching(taskId, userId) {
    return this._store.has(this._key(taskId, userId));
  }

  // ── stats ─────────────────────────────────────────────────────────────────
  /**
   * Return aggregate statistics.
   *
   * @returns {{ totalWatches: number, uniqueTasks: number, uniqueUsers: number }}
   */
  stats() {
    const watchers = [...this._store.values()];
    return {
      totalWatches: watchers.length,
      uniqueTasks:  new Set(watchers.map(w => w.taskId)).size,
      uniqueUsers:  new Set(watchers.map(w => w.userId)).size,
    };
  }

  /** @internal — for testing only */
  _clear() { this._store.clear(); }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
const defaultTaskWatcherService = new TaskWatcherService({ pool: null, dbEnabled: false });

module.exports = {
  TaskWatcherService,
  TaskWatcher,
  WatcherValidationError,
  WatcherLimitError,
  MAX_WATCHERS_PER_TASK,
  MAX_TASKS_WATCHED_PER_USER,
  defaultTaskWatcherService,
};

if (process.env.NODE_ENV === 'test') {
  module.exports._watchers = defaultTaskWatcherService;
}
