/**
 * lib/workspaceTaskCommentService.js — V161
 * ===========================================
 * Workspace Task Comment System
 * תגובות על tasks עם threading, edit, soft-delete ו-reactions
 *
 * תכונות:
 *  - Thread של תגובות על task (workspaceId + taskId + commentId)
 *  - תמיכה ב-replies (parentCommentId)
 *  - Edit (מעדכן body + editedAt)
 *  - Soft-delete: deleted_at נשמר, body → "[deleted]"
 *  - Reactions: emoji counts ב-metadata
 *  - DB integration: workspace_task_comments
 *
 * Sacred Files: lib/fiatLedger.js, lib/auditLog.js — UNTOUCHED
 * [V161-TASK-02]
 */

'use strict';

const crypto = require('crypto');

// ── Errors ────────────────────────────────────────────────────────────────
class CommentNotFoundError extends Error {
  constructor(id) {
    super(`Comment not found: ${id}`);
    this.name  = 'CommentNotFoundError';
    this.code  = 'COMMENT_NOT_FOUND';
    this.statusCode = 404;
  }
}

class CommentPermissionError extends Error {
  constructor() {
    super('You do not have permission to modify this comment');
    this.name = 'CommentPermissionError';
    this.code = 'COMMENT_PERMISSION_DENIED';
    this.statusCode = 403;
  }
}

// ── Comment record ────────────────────────────────────────────────────────
class TaskComment {
  constructor(data) {
    this.id              = data.id              || `cmt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    this.workspaceId     = data.workspaceId;
    this.taskId          = data.taskId;
    this.parentCommentId = data.parentCommentId || null;
    this.body            = (data.body || '').slice(0, 10000);
    this.authorId        = data.authorId        || null;
    this.reactions       = data.reactions       || {};   // { '👍': 3, '🎉': 1 }
    this.createdAt       = data.createdAt       || new Date().toISOString();
    this.updatedAt       = data.updatedAt       || new Date().toISOString();
    this.editedAt        = data.editedAt        || null;
    this.deletedAt       = data.deletedAt       || null;
  }

  get isDeleted() { return this.deletedAt !== null; }

  toJSON() {
    return {
      id:              this.id,
      workspaceId:     this.workspaceId,
      taskId:          this.taskId,
      parentCommentId: this.parentCommentId,
      body:            this.isDeleted ? '[deleted]' : this.body,
      authorId:        this.authorId,
      reactions:       this.reactions,
      createdAt:       this.createdAt,
      updatedAt:       this.updatedAt,
      editedAt:        this.editedAt,
      deletedAt:       this.deletedAt,
      isDeleted:       this.isDeleted,
    };
  }
}

// ── WorkspaceTaskCommentService ───────────────────────────────────────────
class WorkspaceTaskCommentService {
  /**
   * @param {object} [opts]
   * @param {import('pg').Pool} [opts.db]
   * @param {object} [opts.logger]
   */
  constructor(opts = {}) {
    this._db       = opts.db  || null;
    this._log      = opts.logger || { info: () => {}, warn: () => {}, error: () => {} };
    this._comments = new Map(); // commentId → TaskComment
  }

  setDb(pool)    { this._db = pool; }
  setLogger(log) { this._log = log; }

  // ── CRUD ────────────────────────────────────────────────────────────────

  /**
   * Post a new comment on a task.
   * @param {string} workspaceId
   * @param {string} taskId
   * @param {{ body: string, authorId?: string, parentCommentId?: string }} data
   * @returns {Promise<TaskComment>}
   */
  async createComment(workspaceId, taskId, data) {
    if (!workspaceId) throw new Error('workspaceId is required');
    if (!taskId)      throw new Error('taskId is required');
    if (!data.body || !data.body.trim()) throw new Error('body is required');

    // Validate parentCommentId if supplied
    if (data.parentCommentId) {
      const parent = this._comments.get(data.parentCommentId);
      if (!parent || parent.workspaceId !== workspaceId || parent.taskId !== taskId) {
        throw new CommentNotFoundError(data.parentCommentId);
      }
    }

    const comment = new TaskComment({ ...data, workspaceId, taskId });
    this._comments.set(comment.id, comment);

    if (this._db) {
      try {
        await this._db.query(
          `INSERT INTO workspace_task_comments
             (id, workspace_id, task_id, parent_comment_id, body, author_id, reactions, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
          [comment.id, comment.workspaceId, comment.taskId, comment.parentCommentId,
           comment.body, comment.authorId, JSON.stringify(comment.reactions),
           comment.createdAt, comment.updatedAt]
        );
      } catch (e) { this._log.warn({ err: e }, 'taskComments.createComment DB error'); }
    }

    return comment;
  }

  /**
   * List all comments for a task (chronological, top-level + replies together).
   * @param {string} workspaceId
   * @param {string} taskId
   * @param {{ includeDeleted?: boolean, limit?: number, cursor?: string }} [opts]
   * @returns {Promise<{ comments: TaskComment[], total: number, hasMore: boolean }>}
   */
  async listComments(workspaceId, taskId, opts = {}) {
    const { includeDeleted = false, limit = 100, cursor } = opts;

    let items = [...this._comments.values()]
      .filter(c => c.workspaceId === workspaceId && c.taskId === taskId)
      .filter(c => includeDeleted || !c.isDeleted)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    if (cursor) {
      const idx = items.findIndex(c => c.id === cursor);
      if (idx >= 0) items = items.slice(idx + 1);
    }

    const total   = items.length;
    const page    = items.slice(0, limit);
    const hasMore = total > limit;
    return { comments: page, total, hasMore };
  }

  /**
   * Get a single comment.
   */
  async getComment(workspaceId, taskId, commentId) {
    const c = this._comments.get(commentId);
    if (c && c.workspaceId === workspaceId && c.taskId === taskId) return c;

    if (this._db) {
      try {
        const { rows } = await this._db.query(
          `SELECT * FROM workspace_task_comments WHERE id=$1 AND workspace_id=$2 AND task_id=$3`,
          [commentId, workspaceId, taskId]
        );
        if (rows.length) {
          const r = rows[0];
          const comment = new TaskComment({
            id: r.id, workspaceId: r.workspace_id, taskId: r.task_id,
            parentCommentId: r.parent_comment_id, body: r.body, authorId: r.author_id,
            reactions: typeof r.reactions === 'string' ? JSON.parse(r.reactions) : (r.reactions || {}),
            createdAt: r.created_at, updatedAt: r.updated_at,
            editedAt: r.edited_at, deletedAt: r.deleted_at,
          });
          this._comments.set(comment.id, comment);
          return comment;
        }
      } catch (e) { this._log.warn({ err: e }, 'taskComments.getComment DB error'); }
    }

    throw new CommentNotFoundError(commentId);
  }

  /**
   * Edit a comment body.
   * @param {string} workspaceId
   * @param {string} taskId
   * @param {string} commentId
   * @param {{ body: string, editorId?: string }} data
   */
  async editComment(workspaceId, taskId, commentId, data) {
    const comment = await this.getComment(workspaceId, taskId, commentId);
    if (comment.isDeleted) throw new Error('Cannot edit a deleted comment');
    if (data.editorId && comment.authorId && data.editorId !== comment.authorId) {
      throw new CommentPermissionError();
    }
    if (!data.body || !data.body.trim()) throw new Error('body is required');

    comment.body      = data.body.slice(0, 10000);
    comment.editedAt  = new Date().toISOString();
    comment.updatedAt = new Date().toISOString();
    this._comments.set(comment.id, comment);

    if (this._db) {
      try {
        await this._db.query(
          `UPDATE workspace_task_comments SET body=$1, edited_at=$2, updated_at=$3 WHERE id=$4`,
          [comment.body, comment.editedAt, comment.updatedAt, commentId]
        );
      } catch (e) { this._log.warn({ err: e }, 'taskComments.editComment DB error'); }
    }
    return comment;
  }

  /**
   * Soft-delete a comment.
   */
  async deleteComment(workspaceId, taskId, commentId, actorId) {
    const comment = await this.getComment(workspaceId, taskId, commentId);
    if (comment.isDeleted) return comment; // idempotent

    if (actorId && comment.authorId && actorId !== comment.authorId) {
      throw new CommentPermissionError();
    }

    comment.deletedAt = new Date().toISOString();
    comment.updatedAt = new Date().toISOString();
    this._comments.set(comment.id, comment);

    if (this._db) {
      try {
        await this._db.query(
          `UPDATE workspace_task_comments SET deleted_at=$1, updated_at=$2 WHERE id=$3`,
          [comment.deletedAt, comment.updatedAt, commentId]
        );
      } catch (e) { this._log.warn({ err: e }, 'taskComments.deleteComment DB error'); }
    }
    return comment;
  }

  // ── Reactions ────────────────────────────────────────────────────────────

  /**
   * Add or increment an emoji reaction on a comment.
   * @param {string} workspaceId
   * @param {string} taskId
   * @param {string} commentId
   * @param {string} emoji  — e.g. '👍'
   */
  async addReaction(workspaceId, taskId, commentId, emoji) {
    if (!emoji) throw new Error('emoji is required');
    const comment = await this.getComment(workspaceId, taskId, commentId);
    if (comment.isDeleted) throw new Error('Cannot react to a deleted comment');

    comment.reactions[emoji] = (comment.reactions[emoji] || 0) + 1;
    comment.updatedAt = new Date().toISOString();
    this._comments.set(comment.id, comment);

    if (this._db) {
      try {
        await this._db.query(
          `UPDATE workspace_task_comments SET reactions=$1, updated_at=$2 WHERE id=$3`,
          [JSON.stringify(comment.reactions), comment.updatedAt, commentId]
        );
      } catch (e) { this._log.warn({ err: e }, 'taskComments.addReaction DB error'); }
    }
    return comment;
  }

  /**
   * Remove (decrement) a reaction.
   */
  async removeReaction(workspaceId, taskId, commentId, emoji) {
    if (!emoji) throw new Error('emoji is required');
    const comment = await this.getComment(workspaceId, taskId, commentId);

    if (comment.reactions[emoji] > 1) {
      comment.reactions[emoji]--;
    } else {
      delete comment.reactions[emoji];
    }
    comment.updatedAt = new Date().toISOString();
    this._comments.set(comment.id, comment);

    if (this._db) {
      try {
        await this._db.query(
          `UPDATE workspace_task_comments SET reactions=$1, updated_at=$2 WHERE id=$3`,
          [JSON.stringify(comment.reactions), comment.updatedAt, commentId]
        );
      } catch (e) { this._log.warn({ err: e }, 'taskComments.removeReaction DB error'); }
    }
    return comment;
  }

  // ── Stats ─────────────────────────────────────────────────────────────

  /**
   * Comment statistics for a workspace.
   */
  stats(workspaceId) {
    const all     = [...this._comments.values()].filter(c => c.workspaceId === workspaceId);
    const active  = all.filter(c => !c.isDeleted);
    const replies = active.filter(c => c.parentCommentId !== null);
    return {
      total:    all.length,
      active:   active.length,
      deleted:  all.length - active.length,
      replies:  replies.length,
      toplevel: active.length - replies.length,
    };
  }
}

// ── Singleton ────────────────────────────────────────────────────────────
const defaultCommentService = new WorkspaceTaskCommentService();

module.exports = {
  WorkspaceTaskCommentService,
  defaultCommentService,
  CommentNotFoundError,
  CommentPermissionError,
};

if (process.env.NODE_ENV === 'test') {
  module.exports._comments      = defaultCommentService;
  module.exports.TaskComment    = TaskComment;
}
