/**
 * lib/workspaceCommentMentionService.js — V164
 * =============================================
 * Comment Mentions + Notification Events
 * פענוח @userId בגוף תגובות + שמירת רשומות mention + event notifications
 *
 * תכונות:
 *  - Parse @userId tokens from comment body (regex: /@([\w-]{1,64})/g)
 *  - Store mention records per comment (in-memory Map + DB)
 *  - Emit mention notification events
 *  - List mentions per comment, per task, per mentioned user
 *  - DB integration: workspace_comment_mentions
 *
 * Sacred Files: lib/fiatLedger.js, lib/auditLog.js — UNTOUCHED
 * [V164-T01]
 */

'use strict';

const crypto = require('crypto');

// ── Errors ─────────────────────────────────────────────────────────────────

class MentionNotFoundError extends Error {
  constructor(id) {
    super(`Mention not found: ${id}`);
    this.name = 'MentionNotFoundError';
    this.code = 'MENTION_NOT_FOUND';
    this.statusCode = 404;
  }
}

class MentionValidationError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'MentionValidationError';
    this.code = 'MENTION_VALIDATION_ERROR';
    this.statusCode = 400;
  }
}

// ── MentionRecord ──────────────────────────────────────────────────────────

class MentionRecord {
  /**
   * @param {object} data
   * @param {string} data.workspaceId
   * @param {string} data.taskId
   * @param {string} data.commentId
   * @param {string} data.mentionedUserId  — the @userId that was parsed
   * @param {string} [data.authorId]       — who wrote the comment
   * @param {string} [data.id]
   * @param {string} [data.createdAt]
   * @version V164
   */
  constructor(data) {
    this.id               = data.id              || `men_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    this.workspaceId      = data.workspaceId;
    this.taskId           = data.taskId;
    this.commentId        = data.commentId;
    this.mentionedUserId  = data.mentionedUserId;
    this.authorId         = data.authorId        || null;
    this.notified         = data.notified        || false;
    this.createdAt        = data.createdAt       || new Date().toISOString();
  }

  toJSON() {
    return {
      id:              this.id,
      workspaceId:     this.workspaceId,
      taskId:          this.taskId,
      commentId:       this.commentId,
      mentionedUserId: this.mentionedUserId,
      authorId:        this.authorId,
      notified:        this.notified,
      createdAt:       this.createdAt,
    };
  }
}

// ── WorkspaceCommentMentionService ─────────────────────────────────────────

class WorkspaceCommentMentionService {
  /**
   * @param {object} [opts]
   * @param {object} [opts.db]     — pg pool (optional)
   * @param {object} [opts.logger] — pino logger (optional)
   * @version V164
   */
  constructor(opts = {}) {
    // in-memory store: mentionId → MentionRecord
    this._store = new Map();
    // index: commentId → Set<mentionId>
    this._byComment = new Map();
    // index: workspaceId+userId → Set<mentionId>
    this._byUser = new Map();

    this._db  = opts.db     || null;
    this._log = opts.logger || { info: () => {}, warn: () => {}, error: () => {} };

    this._totalCreated = 0;
  }

  // ── Dependency injection ──────────────────────────────────────────────────

  setDb(db)         { this._db  = db; }
  setLogger(logger) { this._log = logger; }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Extract unique @userId tokens from comment body text.
   * @param {string} body
   * @returns {string[]} deduplicated list of userIds
   */
  static parseMentions(body) {
    if (!body || typeof body !== 'string') return [];
    const regex = /@([\w-]{1,64})/g;
    const found = new Set();
    let m;
    while ((m = regex.exec(body)) !== null) {
      found.add(m[1]);
    }
    return [...found];
  }

  _userKey(workspaceId, userId) {
    return `${workspaceId}::${userId}`;
  }

  _addToIndex(map, key, id) {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(id);
  }

  _storeInMemory(record) {
    this._store.set(record.id, record);
    this._addToIndex(this._byComment, record.commentId, record.id);
    this._addToIndex(this._byUser, this._userKey(record.workspaceId, record.mentionedUserId), record.id);
    this._totalCreated++;
  }

  // ── Core API ───────────────────────────────────────────────────────────────

  /**
   * Parse a comment body and record all @mentions found.
   * Called by the server when a comment is created.
   *
   * @param {string} workspaceId
   * @param {string} taskId
   * @param {string} commentId
   * @param {string} body         — raw comment text
   * @param {string} [authorId]   — comment author
   * @returns {{ mentions: object[], count: number }}
   * @version V164
   * [V164-T01]
   */
  async recordMentions(workspaceId, taskId, commentId, body, authorId = null) {
    if (!workspaceId) throw new MentionValidationError('workspaceId required');
    if (!taskId)      throw new MentionValidationError('taskId required');
    if (!commentId)   throw new MentionValidationError('commentId required');

    const userIds = WorkspaceCommentMentionService.parseMentions(body);
    const created = [];

    for (const mentionedUserId of userIds) {
      // Skip self-mention
      if (authorId && mentionedUserId === authorId) continue;

      const record = new MentionRecord({
        workspaceId, taskId, commentId, mentionedUserId, authorId,
      });

      this._storeInMemory(record);

      // DB persistence
      if (this._db) {
        try {
          await this._db.query(
            `INSERT INTO workspace_comment_mentions
               (id, workspace_id, task_id, comment_id, mentioned_user_id, author_id, notified, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT (id) DO NOTHING`,
            [record.id, record.workspaceId, record.taskId, record.commentId,
             record.mentionedUserId, record.authorId, record.notified, record.createdAt],
          );
        } catch (dbErr) {
          this._log.warn({ err: dbErr.message }, '[mentionService] DB insert failed');
        }
      }

      created.push(record.toJSON());
    }

    this._log.info({ workspaceId, taskId, commentId, count: created.length }, '[mentionService] mentions recorded');
    return { mentions: created, count: created.length };
  }

  /**
   * List all mentions for a specific comment.
   * @param {string} workspaceId
   * @param {string} commentId
   * @returns {{ mentions: object[], count: number }}
   * [V164-T02]
   */
  async listByComment(workspaceId, commentId) {
    if (!workspaceId) throw new MentionValidationError('workspaceId required');
    if (!commentId)   throw new MentionValidationError('commentId required');

    // Try DB
    if (this._db) {
      try {
        const r = await this._db.query(
          `SELECT * FROM workspace_comment_mentions
            WHERE workspace_id = $1 AND comment_id = $2
            ORDER BY created_at ASC`,
          [workspaceId, commentId],
        );
        const mentions = r.rows.map(row => ({
          id:              row.id,
          workspaceId:     row.workspace_id,
          taskId:          row.task_id,
          commentId:       row.comment_id,
          mentionedUserId: row.mentioned_user_id,
          authorId:        row.author_id,
          notified:        row.notified,
          createdAt:       row.created_at,
        }));
        return { mentions, count: mentions.length };
      } catch (dbErr) {
        this._log.warn({ err: dbErr.message }, '[mentionService] DB list failed, falling back');
      }
    }

    // In-memory fallback
    const ids = this._byComment.get(commentId) || new Set();
    const mentions = [...ids]
      .map(id => this._store.get(id))
      .filter(r => r && r.workspaceId === workspaceId)
      .map(r => r.toJSON());
    return { mentions, count: mentions.length };
  }

  /**
   * List all mentions of a specific user within a workspace.
   * @param {string} workspaceId
   * @param {string} userId
   * @param {object} [opts]
   * @param {number} [opts.limit=50]
   * @returns {{ mentions: object[], count: number }}
   * [V164-T03]
   */
  async listForUser(workspaceId, userId, opts = {}) {
    if (!workspaceId) throw new MentionValidationError('workspaceId required');
    if (!userId)      throw new MentionValidationError('userId required');
    const limit = Math.min(parseInt(opts.limit || 50, 10), 200);

    // Try DB
    if (this._db) {
      try {
        const r = await this._db.query(
          `SELECT * FROM workspace_comment_mentions
            WHERE workspace_id = $1 AND mentioned_user_id = $2
            ORDER BY created_at DESC LIMIT $3`,
          [workspaceId, userId, limit],
        );
        const mentions = r.rows.map(row => ({
          id:              row.id,
          workspaceId:     row.workspace_id,
          taskId:          row.task_id,
          commentId:       row.comment_id,
          mentionedUserId: row.mentioned_user_id,
          authorId:        row.author_id,
          notified:        row.notified,
          createdAt:       row.created_at,
        }));
        return { mentions, count: mentions.length };
      } catch (dbErr) {
        this._log.warn({ err: dbErr.message }, '[mentionService] DB listForUser failed');
      }
    }

    // In-memory fallback
    const key = this._userKey(workspaceId, userId);
    const ids = this._byUser.get(key) || new Set();
    const mentions = [...ids]
      .map(id => this._store.get(id))
      .filter(Boolean)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit)
      .map(r => r.toJSON());
    return { mentions, count: mentions.length };
  }

  /**
   * Mark mention(s) as notified.
   * @param {string} mentionId
   * @returns {{ ok: boolean }}
   * [V164-T04]
   */
  async markNotified(mentionId) {
    if (!mentionId) throw new MentionValidationError('mentionId required');

    const record = this._store.get(mentionId);
    if (record) {
      record.notified = true;
    }

    if (this._db) {
      try {
        await this._db.query(
          `UPDATE workspace_comment_mentions SET notified = true WHERE id = $1`,
          [mentionId],
        );
      } catch (dbErr) {
        this._log.warn({ err: dbErr.message }, '[mentionService] DB markNotified failed');
      }
    }

    return { ok: true, mentionId };
  }

  /**
   * Service stats for admin endpoint.
   * @returns {object}
   */
  stats() {
    return {
      totalMentions: this._store.size,
      totalCreated:  this._totalCreated,
      indexedComments: this._byComment.size,
      indexedUsers:    this._byUser.size,
    };
  }
}

// ── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  WorkspaceCommentMentionService,
  MentionRecord,
  MentionNotFoundError,
  MentionValidationError,
};

if (process.env.NODE_ENV === 'test') {
  module.exports._service = new WorkspaceCommentMentionService();
}
