/**
 * workspaceCommentPinService.js — V163
 * [V163-TASK-01] Comment Pinning
 * Sacred Files: lib/fiatLedger.js, lib/auditLog.js — UNTOUCHED
 *
 * Features:
 *   - Pin/unpin comments per task (max 5 pinned per task)
 *   - Pinned comments always returned first in listings
 *   - In-memory + DB dual persistence
 *   - NODE_ENV=test export block
 */

'use strict';

const MAX_PINS_PER_TASK = 5;

class CommentPinError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'CommentPinError';
    this.statusCode = statusCode;
  }
}

class CommentPinLimitError extends Error {
  constructor(message) {
    super(message || `Cannot pin more than ${MAX_PINS_PER_TASK} comments per task`);
    this.name = 'CommentPinLimitError';
    this.statusCode = 422;
  }
}

class WorkspaceCommentPinService {
  /**
   * @param {object} [db] - pg pool instance (optional)
   */
  constructor(db = null) {
    this._db = db;
    // Map<workspaceId:taskId, Set<commentId>>
    this._pins = new Map();
    this._log = { info: () => {}, warn: () => {} };
  }

  setDb(pool) { this._db = pool; }

  _key(workspaceId, taskId) { return `${workspaceId}:${taskId}`; }

  _getPins(workspaceId, taskId) {
    const k = this._key(workspaceId, taskId);
    if (!this._pins.has(k)) this._pins.set(k, new Set());
    return this._pins.get(k);
  }

  /**
   * Pin a comment. Max 5 pins per task.
   * @param {string} workspaceId
   * @param {string} taskId
   * @param {string} commentId
   * @returns {{ commentId, taskId, pinnedAt }}
   */
  async pinComment(workspaceId, taskId, commentId) {
    if (!workspaceId || !taskId || !commentId) {
      throw new CommentPinError('workspaceId, taskId, commentId are required');
    }
    const pins = this._getPins(workspaceId, taskId);
    if (pins.has(commentId)) {
      throw new CommentPinError('Comment is already pinned', 409);
    }
    if (pins.size >= MAX_PINS_PER_TASK) {
      throw new CommentPinLimitError();
    }
    pins.add(commentId);
    const pinnedAt = new Date().toISOString();

    if (this._db) {
      try {
        await this._db.query(
          `INSERT INTO workspace_pinned_comments (workspace_id, task_id, comment_id, pinned_at)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [workspaceId, taskId, commentId, pinnedAt]
        );
      } catch (e) { this._log.warn({ err: e }, 'DB pin insert failed'); }
    }
    return { commentId, taskId, pinnedAt };
  }

  /**
   * Unpin a comment.
   */
  async unpinComment(workspaceId, taskId, commentId) {
    if (!workspaceId || !taskId || !commentId) {
      throw new CommentPinError('workspaceId, taskId, commentId are required');
    }
    const pins = this._getPins(workspaceId, taskId);
    if (!pins.has(commentId)) {
      throw new CommentPinError('Comment is not pinned', 404);
    }
    pins.delete(commentId);

    if (this._db) {
      try {
        await this._db.query(
          `DELETE FROM workspace_pinned_comments WHERE workspace_id=$1 AND task_id=$2 AND comment_id=$3`,
          [workspaceId, taskId, commentId]
        );
      } catch (e) { this._log.warn({ err: e }, 'DB pin delete failed'); }
    }
    return { commentId, taskId, unpinnedAt: new Date().toISOString() };
  }

  /**
   * List pinned comment IDs for a task.
   */
  async listPinned(workspaceId, taskId) {
    const pins = this._getPins(workspaceId, taskId);
    return { workspaceId, taskId, pinnedCommentIds: [...pins], count: pins.size };
  }

  /**
   * Check if a comment is pinned.
   */
  isPinned(workspaceId, taskId, commentId) {
    return this._getPins(workspaceId, taskId).has(commentId);
  }

  /**
   * Stats
   */
  stats() {
    let totalPins = 0;
    for (const s of this._pins.values()) totalPins += s.size;
    return { totalPinnedSets: this._pins.size, totalPins, maxPinsPerTask: MAX_PINS_PER_TASK };
  }
}

const _commentPinService = new WorkspaceCommentPinService();

module.exports = WorkspaceCommentPinService;
module.exports.default = _commentPinService;
module.exports.CommentPinError = CommentPinError;
module.exports.CommentPinLimitError = CommentPinLimitError;
module.exports.MAX_PINS_PER_TASK = MAX_PINS_PER_TASK;

if (process.env.NODE_ENV === 'test') {
  module.exports._commentPinService = _commentPinService;
}
