/**
 * reactionNotifier.js — ECOS V139
 * ─────────────────────────────────────────────────────────────────────────────
 * [V139-RN01] Reaction Notifications — fires a `reaction_received` notification
 * to a message author when another user reacts to their message.
 *
 * Design:
 *   - Wraps `RankNotifier.push()` to enqueue `reaction_received` notifications.
 *   - Looks up the message author from comm_messages (DB) or an in-memory registry.
 *   - Anti-spam: ignores self-reactions (reactor === author).
 *   - Dedup: within a configurable window (default 60s), only one notification
 *     per reactor+emoji+message is enqueued (to prevent double-fire on retry).
 *   - Rate cap: max RATE_CAP reaction notifications per message author per minute.
 *   - Zero external dependencies; sacred files untouched.
 *
 * Integration:
 *   - Called from POST /api/v1/comm/channels/:cid/messages/:mid/reactions
 *     AFTER the reaction is written to DB.
 *
 * [V139-RN01] Initial implementation
 */

'use strict';

const { createHash } = require('node:crypto');

const DEDUP_WINDOW_MS = 60_000;    // 1 minute dedup window
const RATE_CAP        = 10;        // max reaction notifications per author per minute
const RATE_WINDOW_MS  = 60_000;

class ReactionNotifier {
  /**
   * @param {object} opts
   * @param {object} opts.rankNotifier    - RankNotifier instance (required for push)
   * @param {object} [opts.dbPool]        - Postgres pool for message author lookup
   * @param {object} [opts.messageOwners] - fallback Map<msgId, userId> for in-memory
   * @param {object} [opts.logger]
   */
  constructor(opts = {}) {
    this._notifier = opts.rankNotifier || null;
    this._db       = opts.dbPool || null;
    this._owners   = opts.messageOwners || new Map(); // in-memory fallback
    this._log      = opts.logger || console;

    // Dedup: Map<dedupKey, expiryTimestamp>
    this._dedup    = new Map();
    // Rate tracking: Map<authorId, { count, windowStart }>
    this._rate     = new Map();
  }

  // ── notify ────────────────────────────────────────────────────────────────

  /**
   * Fire a reaction_received notification to the message author.
   *
   * @param {object} opts
   * @param {string} opts.messageId   - the message that was reacted to
   * @param {string} opts.channelId
   * @param {string} opts.reactorId   - who added the reaction
   * @param {string} opts.emoji       - the reaction emoji/code
   * @returns {Promise<{ok, code?, reason?}>}
   */
  async notify({ messageId, channelId, reactorId, emoji }) {
    if (!messageId || !reactorId || !emoji) {
      return { ok: false, code: 'MISSING_FIELDS', reason: 'messageId, reactorId and emoji are required' };
    }

    // 1. Resolve message author
    const authorId = await this._resolveAuthor(messageId);
    if (!authorId) {
      return { ok: false, code: 'AUTHOR_NOT_FOUND', reason: `Cannot resolve author of message ${messageId}` };
    }

    // 2. Ignore self-reactions
    if (authorId === reactorId) {
      return { ok: true, code: 'SELF_REACTION', reason: 'Self-reactions are not notified' };
    }

    // 3. Dedup check
    const dedupKey = this._dedupKey(messageId, reactorId, emoji);
    const now = Date.now();
    if (this._dedup.has(dedupKey) && this._dedup.get(dedupKey) > now) {
      return { ok: true, code: 'DEDUPED', reason: 'Notification already sent within dedup window' };
    }

    // 4. Rate cap check
    if (this._isRateLimited(authorId, now)) {
      return { ok: false, code: 'RATE_LIMITED', reason: `Author ${authorId} is receiving too many reaction notifications` };
    }

    // 5. Enqueue notification
    if (!this._notifier) {
      return { ok: false, code: 'NO_NOTIFIER', reason: 'RankNotifier not available' };
    }

    const emojiDisplay = emoji.length <= 8 ? emoji : emoji.slice(0, 8);
    const title = `${reactorId} reacted ${emojiDisplay} to your message`;
    const body  = `In channel ${channelId}: "${emojiDisplay}" — tap to view the thread.`;

    const notification = this._notifier.push
      ? this._notifier.push(authorId, 'reaction_received', title, body, {
          messageId,
          channelId,
          reactorId,
          emoji,
          messageIdShort: messageId.slice(0, 12),
        })
      : null;

    // 6. Record dedup + rate
    this._dedup.set(dedupKey, now + DEDUP_WINDOW_MS);
    this._recordRate(authorId, now);

    // Sweep stale dedup entries periodically (every ~50 calls)
    if (Math.random() < 0.02) this._sweepDedup(now);

    return { ok: true, notification: notification || null };
  }

  // ── registerOwner (in-memory fallback) ────────────────────────────────────

  /**
   * Register a message-to-author mapping in the in-memory fallback store.
   * Called by the broadcast handler when writing a new message.
   * @param {string} messageId
   * @param {string} authorId
   */
  registerOwner(messageId, authorId) {
    this._owners.set(messageId, authorId);
  }

  // ── stats ─────────────────────────────────────────────────────────────────

  stats() {
    return {
      dedupEntries: this._dedup.size,
      rateEntries:  this._rate.size,
      dbBacked:     !!this._db,
      notifierAvailable: !!this._notifier,
    };
  }

  // ── private helpers ───────────────────────────────────────────────────────

  async _resolveAuthor(messageId) {
    // DB path
    if (this._db) {
      try {
        const row = await this._db.query(
          'SELECT from_user_id FROM comm_messages WHERE id = $1',
          [messageId]
        );
        if (row.rowCount > 0) return row.rows[0].from_user_id;
      } catch (err) {
        this._log.error && this._log.error({ err: err.message }, '[ReactionNotifier] DB author lookup failed');
      }
    }
    // In-memory fallback
    return this._owners.get(messageId) || null;
  }

  _dedupKey(messageId, reactorId, emoji) {
    return createHash('sha256')
      .update([messageId, reactorId, emoji].join(':'))
      .digest('hex').slice(0, 24);
  }

  _isRateLimited(authorId, now) {
    const entry = this._rate.get(authorId);
    if (!entry || now - entry.windowStart > RATE_WINDOW_MS) return false;
    return entry.count >= RATE_CAP;
  }

  _recordRate(authorId, now) {
    const entry = this._rate.get(authorId);
    if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
      this._rate.set(authorId, { count: 1, windowStart: now });
    } else {
      entry.count++;
    }
  }

  _sweepDedup(now) {
    for (const [key, expiry] of this._dedup) {
      if (expiry <= now) this._dedup.delete(key);
    }
  }
}

// ── Default singleton ─────────────────────────────────────────────────────────

let _default = null;
function getDefaultReactionNotifier(opts = {}) {
  if (!_default) _default = new ReactionNotifier(opts);
  return _default;
}

module.exports = { ReactionNotifier, getDefaultReactionNotifier };
