/**
 * lib/workspaceNotificationService.js — V171
 * ============================================
 * Workspace In-App Notification Center
 *
 * Features:
 *  - Create notifications for a user in a workspace
 *  - List notifications (with unread count)
 *  - Mark individual notification as read
 *  - Delete (dismiss) notification
 *  - In-memory + DB dual persistence (R7)
 *  - NODE_ENV=test export block (R8)
 *
 * Sacred Files: lib/fiatLedger.js, lib/auditLog.js — UNTOUCHED
 * [V171-T05]
 *
 * @version 171.0.0
 */

'use strict';

const crypto = require('crypto');

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_NOTIFICATION_TYPES = ['info', 'warning', 'success', 'error', 'mention', 'assignment', 'system'];
const MAX_NOTIFICATIONS_PER_USER = 500;
const TITLE_MAX_LEN  = 200;
const BODY_MAX_LEN   = 2000;

// ── Errors ────────────────────────────────────────────────────────────────────

class NotificationValidationError extends Error {
  constructor(msg) {
    super(msg);
    this.name       = 'NotificationValidationError';
    this.code       = 'NOTIFICATION_VALIDATION_ERROR';
    this.statusCode = 400;
  }
}

class NotificationNotFoundError extends Error {
  constructor(notifId) {
    super(`Notification not found: ${notifId}`);
    this.name       = 'NotificationNotFoundError';
    this.code       = 'NOTIFICATION_NOT_FOUND';
    this.statusCode = 404;
  }
}

class NotificationLimitError extends Error {
  constructor(userId) {
    super(`Notification limit reached for user ${userId} (max ${MAX_NOTIFICATIONS_PER_USER})`);
    this.name       = 'NotificationLimitError';
    this.code       = 'NOTIFICATION_LIMIT_REACHED';
    this.statusCode = 429;
  }
}

// ── Domain object ─────────────────────────────────────────────────────────────

class WorkspaceNotification {
  /**
   * @param {object} opts
   * @param {string}  [opts.id]
   * @param {string}   opts.workspaceId
   * @param {string}   opts.userId      — recipient
   * @param {string}   opts.title
   * @param {string}  [opts.body]
   * @param {string}  [opts.type]       — one of VALID_NOTIFICATION_TYPES
   * @param {object}  [opts.meta]       — free-form JSON metadata
   * @param {boolean} [opts.read]
   * @param {Date}    [opts.readAt]
   * @param {Date}    [opts.createdAt]
   * @param {string}  [opts.createdBy]  — actor who triggered it
   */
  constructor(opts = {}) {
    this.id          = opts.id          || crypto.randomUUID();
    this.workspaceId = opts.workspaceId;
    this.userId      = opts.userId;
    this.title       = opts.title;
    this.body        = opts.body        || null;
    this.type        = opts.type        || 'info';
    this.meta        = opts.meta        || {};
    this.read        = opts.read        !== undefined ? opts.read : false;
    this.readAt      = opts.readAt      || null;
    this.createdAt   = opts.createdAt   || new Date().toISOString();
    this.createdBy   = opts.createdBy   || null;
  }

  toJSON() {
    return {
      id:          this.id,
      workspaceId: this.workspaceId,
      userId:      this.userId,
      title:       this.title,
      body:        this.body,
      type:        this.type,
      meta:        this.meta,
      read:        this.read,
      readAt:      this.readAt,
      createdAt:   this.createdAt,
      createdBy:   this.createdBy,
    };
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

class WorkspaceNotificationService {
  /**
   * @param {object}  opts
   * @param {object} [opts.pool]      — pg pool (optional; null → in-memory only)
   * @param {boolean} [opts.dbEnabled]
   * @param {object} [opts.logger]
   */
  constructor({ pool = null, dbEnabled = true, logger = null } = {}) {
    /** @type {Map<string, WorkspaceNotification>} id → notification */
    this._store    = new Map();
    this._pool     = pool;
    this._dbEnabled = dbEnabled && pool !== null;
    this._log      = logger || { info: () => {}, warn: () => {} };
    this._version  = 'V171';
  }

  // ── create ────────────────────────────────────────────────────────────────

  /**
   * Create a new notification for a user in a workspace.
   * @param {string} workspaceId
   * @param {object} opts
   * @param {string}  opts.userId
   * @param {string}  opts.title
   * @param {string} [opts.body]
   * @param {string} [opts.type]
   * @param {object} [opts.meta]
   * @param {string} [opts.createdBy]
   * @returns {Promise<WorkspaceNotification>}
   */
  async createNotification(workspaceId, opts = {}) {
    const { userId, title, body, type, meta, createdBy } = opts;

    if (!workspaceId) throw new NotificationValidationError('workspaceId required');
    if (!userId)      throw new NotificationValidationError('userId required');
    if (!title)       throw new NotificationValidationError('title required');
    if (title.length > TITLE_MAX_LEN)
      throw new NotificationValidationError(`title must be ≤${TITLE_MAX_LEN} chars`);
    if (body && body.length > BODY_MAX_LEN)
      throw new NotificationValidationError(`body must be ≤${BODY_MAX_LEN} chars`);
    if (type && !VALID_NOTIFICATION_TYPES.includes(type))
      throw new NotificationValidationError(
        `type must be one of: ${VALID_NOTIFICATION_TYPES.join(', ')}`
      );

    // Enforce per-user limit
    const userCount = [...this._store.values()].filter(
      n => n.workspaceId === workspaceId && n.userId === userId
    ).length;
    if (userCount >= MAX_NOTIFICATIONS_PER_USER)
      throw new NotificationLimitError(userId);

    const notif = new WorkspaceNotification({
      workspaceId,
      userId,
      title:     title.trim(),
      body:      body   || null,
      type:      type   || 'info',
      meta:      meta   || {},
      createdBy: createdBy || null,
    });

    this._store.set(notif.id, notif);

    if (this._dbEnabled) {
      try {
        await this._pool.query(
          `INSERT INTO workspace_notifications
             (id, workspace_id, user_id, title, body, type, meta, read, read_at, created_by, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (id) DO NOTHING`,
          [
            notif.id, notif.workspaceId, notif.userId, notif.title,
            notif.body, notif.type, JSON.stringify(notif.meta),
            notif.read, notif.readAt, notif.createdBy, notif.createdAt,
          ]
        );
      } catch (err) {
        this._log.warn({ err: err.message }, '[notifService] DB insert failed (in-memory persisted)');
      }
    }

    this._log.info({ id: notif.id, userId, workspaceId }, '[notifService] notification created');
    return notif;
  }

  // ── list ──────────────────────────────────────────────────────────────────

  /**
   * List notifications for a user in a workspace.
   * @param {string} workspaceId
   * @param {string} userId
   * @param {object} [opts]
   * @param {boolean} [opts.unreadOnly]
   * @param {number}  [opts.limit]    — default 50
   * @param {number}  [opts.offset]   — default 0
   * @returns {Promise<{notifications: WorkspaceNotification[], total: number, unreadCount: number}>}
   */
  async listNotifications(workspaceId, userId, opts = {}) {
    if (!workspaceId) throw new NotificationValidationError('workspaceId required');
    if (!userId)      throw new NotificationValidationError('userId required');

    await this._loadFromDb(workspaceId, userId);

    const limit    = opts.limit    ?? 50;
    const offset   = opts.offset   ?? 0;
    const unreadOnly = opts.unreadOnly ?? false;

    let all = [...this._store.values()]
      .filter(n => n.workspaceId === workspaceId && n.userId === userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const unreadCount = all.filter(n => !n.read).length;

    if (unreadOnly) all = all.filter(n => !n.read);

    const total         = all.length;
    const notifications = all.slice(offset, offset + limit).map(n => n.toJSON());

    return { notifications, total, unreadCount };
  }

  // ── mark read ─────────────────────────────────────────────────────────────

  /**
   * Mark a specific notification as read.
   * @param {string} workspaceId
   * @param {string} userId
   * @param {string} notifId
   * @returns {Promise<WorkspaceNotification>}
   */
  async markRead(workspaceId, userId, notifId) {
    const notif = this._getOwned(workspaceId, userId, notifId);

    if (notif.read) return notif; // idempotent

    notif.read   = true;
    notif.readAt = new Date().toISOString();

    if (this._dbEnabled) {
      try {
        await this._pool.query(
          `UPDATE workspace_notifications SET read=true, read_at=$1
           WHERE id=$2 AND workspace_id=$3 AND user_id=$4`,
          [notif.readAt, notifId, workspaceId, userId]
        );
      } catch (err) {
        this._log.warn({ err: err.message }, '[notifService] DB markRead failed');
      }
    }

    return notif;
  }

  // ── mark all read ─────────────────────────────────────────────────────────

  /**
   * Mark all notifications for a user as read.
   * @param {string} workspaceId
   * @param {string} userId
   * @returns {Promise<{markedCount: number}>}
   */
  async markAllRead(workspaceId, userId) {
    if (!workspaceId) throw new NotificationValidationError('workspaceId required');
    if (!userId)      throw new NotificationValidationError('userId required');

    const now     = new Date().toISOString();
    let   count   = 0;

    for (const notif of this._store.values()) {
      if (notif.workspaceId === workspaceId && notif.userId === userId && !notif.read) {
        notif.read   = true;
        notif.readAt = now;
        count++;
      }
    }

    if (this._dbEnabled && count > 0) {
      try {
        await this._pool.query(
          `UPDATE workspace_notifications SET read=true, read_at=$1
           WHERE workspace_id=$2 AND user_id=$3 AND read=false`,
          [now, workspaceId, userId]
        );
      } catch (err) {
        this._log.warn({ err: err.message }, '[notifService] DB markAllRead failed');
      }
    }

    return { markedCount: count };
  }

  // ── delete ────────────────────────────────────────────────────────────────

  /**
   * Delete (dismiss) a specific notification.
   * @param {string} workspaceId
   * @param {string} userId
   * @param {string} notifId
   * @returns {Promise<{deleted: boolean, notifId: string}>}
   */
  async deleteNotification(workspaceId, userId, notifId) {
    const notif = this._getOwned(workspaceId, userId, notifId);

    this._store.delete(notifId);

    if (this._dbEnabled) {
      try {
        await this._pool.query(
          `DELETE FROM workspace_notifications
           WHERE id=$1 AND workspace_id=$2 AND user_id=$3`,
          [notifId, workspaceId, userId]
        );
      } catch (err) {
        this._log.warn({ err: err.message }, '[notifService] DB delete failed');
      }
    }

    this._log.info({ notifId, userId, workspaceId }, '[notifService] notification deleted');
    return { deleted: true, notifId, title: notif.title };
  }

  // ── stats ─────────────────────────────────────────────────────────────────

  /**
   * @param {string} [workspaceId]
   * @returns {{ total: number, unread: number, byType: object, version: string }}
   */
  stats(workspaceId = null) {
    let all = [...this._store.values()];
    if (workspaceId) all = all.filter(n => n.workspaceId === workspaceId);
    const byType = {};
    for (const n of all) byType[n.type] = (byType[n.type] || 0) + 1;
    return {
      total:   all.length,
      unread:  all.filter(n => !n.read).length,
      byType,
      version: this._version,
    };
  }

  // ── private helpers ───────────────────────────────────────────────────────

  _getOwned(workspaceId, userId, notifId) {
    const notif = this._store.get(notifId);
    if (!notif || notif.workspaceId !== workspaceId || notif.userId !== userId)
      throw new NotificationNotFoundError(notifId);
    return notif;
  }

  async _loadFromDb(workspaceId, userId) {
    if (!this._dbEnabled) return;
    try {
      const r = await this._pool.query(
        `SELECT * FROM workspace_notifications
         WHERE workspace_id=$1 AND user_id=$2`,
        [workspaceId, userId]
      );
      for (const row of r.rows) {
        if (!this._store.has(row.id)) {
          this._store.set(row.id, new WorkspaceNotification({
            id:          row.id,
            workspaceId: row.workspace_id,
            userId:      row.user_id,
            title:       row.title,
            body:        row.body,
            type:        row.type,
            meta:        typeof row.meta === 'string' ? JSON.parse(row.meta) : (row.meta || {}),
            read:        row.read,
            readAt:      row.read_at,
            createdBy:   row.created_by,
            createdAt:   row.created_at,
          }));
        }
      }
    } catch (err) {
      this._log.warn({ err: err.message }, '[notifService] DB load failed, using in-memory');
    }
  }
}

// ── R8: NODE_ENV=test exports ─────────────────────────────────────────────────

if (process.env.NODE_ENV === 'test') {
  module.exports = {
    WorkspaceNotificationService,
    WorkspaceNotification,
    NotificationValidationError,
    NotificationNotFoundError,
    NotificationLimitError,
    VALID_NOTIFICATION_TYPES,
    MAX_NOTIFICATIONS_PER_USER,
  };
} else {
  module.exports = {
    WorkspaceNotificationService,
    WorkspaceNotification,
    NotificationValidationError,
    NotificationNotFoundError,
    NotificationLimitError,
    VALID_NOTIFICATION_TYPES,
    MAX_NOTIFICATIONS_PER_USER,
  };
}
