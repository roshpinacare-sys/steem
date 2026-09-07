/**
 * messageThreading.js — ECOS V139
 * ─────────────────────────────────────────────────────────────────────────────
 * [V139-MT01] Message Threading — reply chains on channel messages.
 *
 * Provides the business logic for:
 *   - Posting a reply to an existing message (validates parent exists in same channel)
 *   - Fetching a thread (parent + all direct replies, ordered ASC)
 *   - Enriching a message list with thread stubs (replyCount, hasReplies)
 *
 * Design:
 *   - Zero external dependencies.
 *   - Primary store: Postgres comm_messages table (parent_id, reply_count columns).
 *   - In-memory fallback Map<msgId, Message[]> for environments without DB.
 *   - reply_count kept in sync by DB trigger (migration_phase22.sql).
 *     In-memory path counts manually.
 *   - Thread depth is capped at 1 level (flat threading, not recursive trees).
 *     This matches the product decision to keep UX simple.
 *   - Sacred files: fiatLedger.js, auditLog.js — NOT touched.
 *
 * [V139-MT01] Initial implementation
 */

'use strict';

const { createHash } = require('node:crypto');

const THREAD_DEPTH_MAX = 1; // flat threading only (no nested replies-to-replies)
const THREAD_PAGE_MAX  = 100;

function _msgId(channelId, userId, body, ts) {
  return 'msg_' + createHash('sha256')
    .update([channelId, userId, body, ts].join(':'))
    .digest('hex').slice(0, 24);
}

// ─────────────────────────────────────────────────────────────────────────────
class MessageThreading {
  /**
   * @param {object} opts
   * @param {object} [opts.dbPool]   - Postgres pool (optional; degrades gracefully)
   * @param {object} [opts.logger]
   */
  constructor(opts = {}) {
    this._db  = opts.dbPool || null;
    this._log = opts.logger || console;

    // Fallback in-memory store: Map<channelId, Map<msgId, message>>
    this._messages = new Map();
    // In-memory reply index: Map<parentId, msgId[]>
    this._replies  = new Map();
  }

  // ── postReply ─────────────────────────────────────────────────────────────

  /**
   * Post a reply to an existing message.
   *
   * @param {object} opts
   * @param {string} opts.channelId   - target channel
   * @param {string} opts.parentId    - id of the message being replied to
   * @param {string} opts.fromUserId  - author
   * @param {string} opts.body        - reply text
   * @returns {Promise<{ok:boolean, reply?:object, code?:string, error?:string}>}
   */
  async postReply({ channelId, parentId, fromUserId, body }) {
    if (!channelId || !parentId || !fromUserId || !body) {
      return { ok: false, code: 'MISSING_FIELDS', error: 'channelId, parentId, fromUserId and body are required' };
    }
    if (typeof body !== 'string' || body.trim().length === 0) {
      return { ok: false, code: 'EMPTY_BODY', error: 'body must be a non-empty string' };
    }

    const ts = new Date().toISOString();
    const id = _msgId(channelId, fromUserId, body, ts);

    // ── DB path ──────────────────────────────────────────────────────────────
    if (this._db) {
      try {
        // Validate parent exists and belongs to same channel
        const parentRow = await this._db.query(
          'SELECT id, channel_id, parent_id FROM comm_messages WHERE id = $1',
          [parentId]
        );
        if (parentRow.rowCount === 0) {
          return { ok: false, code: 'PARENT_NOT_FOUND', error: `Message ${parentId} not found` };
        }
        const parent = parentRow.rows[0];
        if (parent.channel_id !== channelId) {
          return { ok: false, code: 'CHANNEL_MISMATCH', error: 'Parent message is in a different channel' };
        }
        if (parent.parent_id !== null) {
          return { ok: false, code: 'DEPTH_EXCEEDED', error: 'Cannot reply to a reply (max depth 1)' };
        }

        await this._db.query(
          `INSERT INTO comm_messages (id, channel_id, from_user_id, body, parent_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO NOTHING`,
          [id, channelId, fromUserId, body.trim(), parentId, ts]
        );
        // reply_count incremented by trigger

        const reply = { id, channelId, parentId, fromUserId, body: body.trim(), createdAt: ts, replyCount: 0 };
        return { ok: true, reply };
      } catch (err) {
        this._log.error && this._log.error({ err: err.message }, '[MessageThreading] postReply DB error');
        return { ok: false, code: 'DB_ERROR', error: err.message };
      }
    }

    // ── In-memory path ───────────────────────────────────────────────────────
    const channelMap = this._messages.get(channelId);
    if (!channelMap || !channelMap.has(parentId)) {
      return { ok: false, code: 'PARENT_NOT_FOUND', error: `Message ${parentId} not found` };
    }
    const parent = channelMap.get(parentId);
    if (parent.parentId !== null && parent.parentId !== undefined) {
      return { ok: false, code: 'DEPTH_EXCEEDED', error: 'Cannot reply to a reply (max depth 1)' };
    }

    const reply = { id, channelId, parentId, fromUserId, body: body.trim(), createdAt: ts, replyCount: 0 };
    channelMap.set(id, reply);

    // Update reply index
    const replyList = this._replies.get(parentId) || [];
    replyList.push(id);
    this._replies.set(parentId, replyList);

    // Increment parent reply_count in memory
    parent.replyCount = (parent.replyCount || 0) + 1;

    return { ok: true, reply };
  }

  // ── getThread ─────────────────────────────────────────────────────────────

  /**
   * Fetch a thread: the parent message + its direct replies.
   *
   * @param {object} opts
   * @param {string} opts.channelId
   * @param {string} opts.parentId
   * @param {object} [opts.pagination]  - { limit, after } cursor-based
   * @returns {Promise<{ok, parent?, replies?, hasMore, nextCursor, total}>}
   */
  async getThread({ channelId, parentId, pagination = {} }) {
    if (!channelId || !parentId) {
      return { ok: false, code: 'MISSING_FIELDS', error: 'channelId and parentId are required' };
    }
    const limit  = Math.min(THREAD_PAGE_MAX, Math.max(1, parseInt(pagination.limit || 50, 10)));
    const after  = pagination.after || null; // ISO timestamp cursor

    // ── DB path ──────────────────────────────────────────────────────────────
    if (this._db) {
      try {
        // Fetch parent
        const parentRow = await this._db.query(
          'SELECT id, channel_id, from_user_id, body, parent_id, reply_count, created_at FROM comm_messages WHERE id = $1',
          [parentId]
        );
        if (parentRow.rowCount === 0) {
          return { ok: false, code: 'PARENT_NOT_FOUND', error: `Message ${parentId} not found` };
        }
        const parentMsg = this._formatRow(parentRow.rows[0]);
        if (parentMsg.channelId !== channelId) {
          return { ok: false, code: 'CHANNEL_MISMATCH', error: 'Message is in a different channel' };
        }

        // Fetch replies
        const params = [parentId, limit + 1];
        let whereExtra = '';
        if (after) {
          params.push(after);
          whereExtra = ` AND created_at > $${params.length}`;
        }
        const repliesRow = await this._db.query(
          `SELECT id, channel_id, from_user_id, body, parent_id, reply_count, created_at
           FROM comm_messages
           WHERE parent_id = $1${whereExtra}
           ORDER BY created_at ASC
           LIMIT $2`,
          params
        );
        const hasMore = repliesRow.rows.length > limit;
        const rows    = repliesRow.rows.slice(0, limit).map(r => this._formatRow(r));
        const nextCursor = hasMore ? rows[rows.length - 1].createdAt : null;

        return {
          ok: true,
          parent:      parentMsg,
          replies:     rows,
          total:       parentMsg.replyCount,
          hasMore,
          nextCursor,
        };
      } catch (err) {
        this._log.error && this._log.error({ err: err.message }, '[MessageThreading] getThread DB error');
        return { ok: false, code: 'DB_ERROR', error: err.message };
      }
    }

    // ── In-memory path ───────────────────────────────────────────────────────
    const channelMap = this._messages.get(channelId);
    if (!channelMap || !channelMap.has(parentId)) {
      return { ok: false, code: 'PARENT_NOT_FOUND', error: `Message ${parentId} not found` };
    }
    const parentMsg = channelMap.get(parentId);
    const replyIds  = this._replies.get(parentId) || [];
    let replies = replyIds.map(rid => channelMap.get(rid)).filter(Boolean);
    if (after) replies = replies.filter(r => r.createdAt > after);
    replies.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const hasMore = replies.length > limit;
    const paged   = replies.slice(0, limit);
    return {
      ok: true,
      parent:      parentMsg,
      replies:     paged,
      total:       replyIds.length,
      hasMore,
      nextCursor:  hasMore ? paged[paged.length - 1].createdAt : null,
    };
  }

  // ── registerMessage (in-memory seeding) ──────────────────────────────────

  /**
   * Register a message into the in-memory store (called by RankNotifier.broadcast
   * or the API when DB is unavailable, so threading can work offline).
   * @param {object} msg - { id, channelId, fromUserId, body, createdAt, parentId? }
   */
  registerMessage(msg) {
    if (!msg || !msg.id || !msg.channelId) return;
    const channelMap = this._messages.get(msg.channelId) || new Map();
    channelMap.set(msg.id, {
      id:         msg.id,
      channelId:  msg.channelId,
      fromUserId: msg.fromUserId || msg.from_user_id,
      body:       msg.body,
      parentId:   msg.parentId || null,
      replyCount: msg.replyCount || 0,
      createdAt:  msg.createdAt || new Date().toISOString(),
    });
    this._messages.set(msg.channelId, channelMap);
  }

  // ── enrichMessages ────────────────────────────────────────────────────────

  /**
   * Add replyCount + hasReplies to a list of top-level messages.
   * Used when serving the channel message list to give clients thread stubs.
   *
   * DB path: queries reply_count directly from comm_messages.
   * In-memory path: counts from internal reply index.
   *
   * @param {object[]} messages
   * @returns {Promise<object[]>}
   */
  async enrichMessages(messages) {
    if (!messages || messages.length === 0) return messages;

    const topLevel = messages.filter(m => !m.parentId);
    if (topLevel.length === 0) return messages;

    if (this._db) {
      try {
        const ids    = topLevel.map(m => m.id);
        const result = await this._db.query(
          `SELECT id, reply_count FROM comm_messages WHERE id = ANY($1::text[])`,
          [ids]
        );
        const countMap = {};
        for (const row of result.rows) countMap[row.id] = row.reply_count;
        return messages.map(m => ({
          ...m,
          replyCount: countMap[m.id] ?? m.replyCount ?? 0,
          hasReplies: (countMap[m.id] || 0) > 0,
        }));
      } catch (_) {
        // fall through to in-memory
      }
    }

    // In-memory
    return messages.map(m => {
      const replyIds  = this._replies.get(m.id) || [];
      return { ...m, replyCount: replyIds.length, hasReplies: replyIds.length > 0 };
    });
  }

  // ── stats ─────────────────────────────────────────────────────────────────

  stats() {
    let totalMsgs   = 0;
    let totalReplies = 0;
    for (const [, map] of this._messages) {
      for (const [, msg] of map) {
        if (msg.parentId) totalReplies++;
        else totalMsgs++;
      }
    }
    return {
      channels:     this._messages.size,
      topLevelMsgs: totalMsgs,
      replies:      totalReplies,
      dbBacked:     !!this._db,
    };
  }

  // ── private helpers ───────────────────────────────────────────────────────

  _formatRow(row) {
    return {
      id:         row.id,
      channelId:  row.channel_id,
      fromUserId: row.from_user_id,
      body:       row.body,
      parentId:   row.parent_id || null,
      replyCount: row.reply_count || 0,
      hasReplies: (row.reply_count || 0) > 0,
      createdAt:  row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    };
  }
}

// ── Default singleton ─────────────────────────────────────────────────────────

let _default = null;
function getDefaultMessageThreading(opts = {}) {
  if (!_default) _default = new MessageThreading(opts);
  return _default;
}

module.exports = { MessageThreading, getDefaultMessageThreading };
