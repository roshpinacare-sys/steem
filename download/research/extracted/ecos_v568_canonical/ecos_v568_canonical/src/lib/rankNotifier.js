/**
 * rankNotifier.js — ECOS V136
 * ─────────────────────────────────────────────────────────────────────────────
 * [V136-NO] Notification & Observability Layer (P26)
 *
 * A lightweight, in-app notification queue that sits on top of the existing
 * rank + comm + webhook infrastructure. It serves three deliverables:
 *
 *   [V136-NO-01] Tier promotion notifications
 *       When a user crosses a tier boundary (OBSERVER→MEMBER, …), enqueue a
 *       `tier_promotion` (or `tier_demotion`) notification. Wired via the
 *       UserRankSystem `onTierChange` hook (see userRankSystem.js).
 *
 *   [V136-NO-02] Streak reminder notifications
 *       runStreakReminderSweep() scans the engagement engine's streak store and
 *       enqueues a "don't break your streak" notification for any user with an
 *       active streak (≥ minStreak) who has NOT been active today. Designed to
 *       be called from a daily scheduled task.
 *
 *   [V136-NO-04] CommChannels broadcast
 *       broadcast() fans a STEWARD+ authored message out to every subscriber of
 *       a channel as a `channel_broadcast` notification, and persists it to the
 *       comm_messages table (DB hook, non-fatal).
 *
 * Design principles (consistent with the rest of ECOS):
 *   - Zero external dependencies — node builtins only.
 *   - In-memory store with an OPTIONAL Postgres pool for persistence.
 *     Everything degrades gracefully to in-memory when no DB is wired.
 *   - Every DB call is fire-and-forget and never throws.
 *   - The existing webhook `notificationService` is used for push delivery
 *     when an account webhook is registered; in-app queue is the source of truth.
 *   - Sacred files (fiatLedger.js, auditLog.js) are NOT touched.
 */

'use strict';

const { createHash } = require('node:crypto');

const QUEUE_MAX_PER_USER = 200; // ring-buffer cap per user to bound memory

// Tier ordering for promotion vs demotion classification (mirrors requireRank).
const TIER_ORDER = ['OBSERVER', 'MEMBER', 'CONTRIBUTOR', 'VALIDATOR', 'STEWARD', 'SOVEREIGN'];

function _tierIndex(tierId) {
  const i = TIER_ORDER.indexOf(tierId);
  return i === -1 ? 0 : i;
}

function _newId(parts) {
  return 'ntf_' + createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 20);
}

// ─────────────────────────────────────────────────────────────────────────────
class RankNotifier {
  /**
   * @param {object} opts
   * @param {import('./userRankSystem').UserRankSystem} [opts.rankSystem]
   * @param {import('./commChannelSystem').CommChannelSystem} [opts.commChannels]
   * @param {object} [opts.notificationService]  - webhook push (optional)
   * @param {object} [opts.dbPool]               - Postgres pool (optional)
   * @param {object} [opts.logger]
   * @param {number} [opts.minStreakForReminder] - default 3
   */
  constructor(opts = {}) {
    this._rank   = opts.rankSystem || null;
    this._comm   = opts.commChannels || null;
    this._notify = opts.notificationService || null;
    this._db     = opts.dbPool || null;
    this._log    = opts.logger || console;
    this._minStreak = opts.minStreakForReminder || 3;

    // [V137-NB] WebSocket hub for real-time push (NotificationWsHub, optional)
    this._wsHub  = opts.wsHub || null;
    // [V137-NC] Preferences store (NotificationPrefs, optional)
    this._prefs  = opts.prefs || null;
    // [V137-NE] i18n templates (notificationTemplates module, optional)
    this._tpl    = opts.templates || null;

    // Map<userId, Notification[]>  (newest last)
    this._queue = new Map();
    // Dedup guard so the daily sweep doesn't double-queue a reminder per day.
    // Map<`${userId}:${yyyy-mm-dd}`, true>
    this._reminderFired = new Map();
    // Monotonic counter for stable ordering within the same ms.
    this._seq = 0;

    // [V137-NF] Simple delivery counters for the metrics endpoint.
    this._deliveryStats = {
      wsSuccess:   0,
      wsFailed:    0,
      webhookSuccess: 0,
      webhookFailed:  0,
    };
  }

  // ── core enqueue ────────────────────────────────────────────────────────────

  /**
   * Enqueue a notification for a user. Returns the stored notification object.
   * Optionally pushes via webhook (fire-and-forget) when accountId is provided.
   */
  _enqueue(userId, type, title, body, meta = {}) {
    // [V137-NC] Pre-enqueue mute check — skip silently if muted or quiet hours active.
    if (this._prefs && this._prefs.isMuted(userId, type)) {
      return null; // muted — do not enqueue
    }

    // [V137-NE] Apply i18n template if a locale preference is cached.
    let localTitle = title, localBody = body;
    if (this._tpl && this._prefs) {
      const locale = this._prefs.getLocale(userId);
      if (locale && locale !== 'en') {
        try {
          const resolved = this._tpl.resolve(type, locale, {
            tier:    meta.tierAfter  || meta.tier    || '',
            from:    meta.tierBefore || '',
            to:      meta.tierAfter  || '',
            streak:  meta.streak     || '',
            channel: meta.channelId  || '',
            message: body,
          });
          if (resolved) { localTitle = resolved.title; localBody = resolved.body; }
        } catch (_) { /* non-fatal — fall back to English strings */ }
      }
    }

    const ts = new Date().toISOString();
    const id = _newId([userId, type, ts, String(++this._seq)]);
    const notification = {
      id, userId, type,
      title: localTitle,
      body:  localBody,
      meta, read: false, createdAt: ts,
    };

    if (!this._queue.has(userId)) this._queue.set(userId, []);
    const list = this._queue.get(userId);
    list.push(notification);
    if (list.length > QUEUE_MAX_PER_USER) list.shift();

    // Persist (non-fatal)
    this._persist(notification);

    // [V137-NB] Real-time push via WebSocket (fire-and-forget, non-fatal).
    if (this._wsHub) {
      try {
        const sent = this._wsHub.push(userId, notification);
        if (sent > 0) this._deliveryStats.wsSuccess++;
        else          this._deliveryStats.wsFailed++;
      } catch (_) {
        this._deliveryStats.wsFailed++;
      }
    }

    // Optional webhook push keyed by accountId (defaults to userId)
    const preferredChannel = this._prefs ? this._prefs.getChannel(userId) : 'ws';
    if (preferredChannel !== 'none' && this._notify && typeof this._notify.notify === 'function') {
      const accountId = meta.accountId || userId;
      const t0 = Date.now();
      try {
        // notify() is itself fire-and-forget / never-throws
        this._notify.notify(accountId, `rank.${type}`, { id, title: localTitle, body: localBody, meta });
        this._deliveryStats.webhookSuccess++;
        // [V138-ND01] Log successful webhook delivery
        this._logDelivery(id, userId, 'webhook', true, Date.now() - t0, null);
      } catch (webhookErr) {
        this._deliveryStats.webhookFailed++; /* non-fatal */
        // [V138-ND01] Log failed webhook delivery
        this._logDelivery(id, userId, 'webhook', false, Date.now() - t0, webhookErr && webhookErr.message);
      }
    }

    return notification;
  }

  _persist(n) {
    if (!this._db) return;
    this._db.query(
      `INSERT INTO rank_notifications (id, user_id, type, title, body, meta, read, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [n.id, n.userId, n.type, n.title, n.body, JSON.stringify(n.meta || {}), n.read, n.createdAt]
    ).catch(err => this._log.warn && this._log.warn({ err: err.message }, '[V136-NO] rank_notifications insert failed (non-fatal)'));
  }

  // ── [V138-ND01] Delivery log insert ──────────────────────────────────────────

  /**
   * Insert a row into notification_delivery_log (fire-and-forget, non-fatal).
   * Called from _enqueue() for webhook delivery and from NotificationWsHub.push() for WS.
   */
  _logDelivery(notificationId, userId, channel, success, latencyMs, errorMsg) {
    if (!this._db) return;
    const { createHash } = require('node:crypto');
    const ts = new Date().toISOString();
    const id = 'dl_' + createHash('sha256')
      .update([notificationId, userId, channel, ts, String(Math.random())].join(':'))
      .digest('hex').slice(0, 20);
    this._db.query(
      `INSERT INTO notification_delivery_log
         (id, notification_id, user_id, channel, success, latency_ms, error_msg, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO NOTHING`,
      [id, notificationId || '', userId, channel, success,
       latencyMs != null ? latencyMs : null, errorMsg || null, ts]
    ).catch(err =>
      this._log.warn && this._log.warn({ err: err.message }, '[V138-ND01] delivery_log insert failed (non-fatal)')
    );
  }

  // ── [V136-NO-01] tier change notifications ───────────────────────────────────

  /**
   * Called when a user's tier changes. Classifies promotion vs demotion and
   * enqueues an appropriate notification. No-op when tiers are equal.
   * @returns {object|null} the enqueued notification, or null if no change.
   */
  notifyTierChange(userId, tierBefore, tierAfter, meta = {}) {
    if (!tierBefore || !tierAfter || tierBefore === tierAfter) return null;
    const up = _tierIndex(tierAfter) > _tierIndex(tierBefore);
    const type  = up ? 'tier_promotion' : 'tier_demotion';
    const title = up
      ? `Promoted to ${tierAfter} 🎉`
      : `Rank changed to ${tierAfter}`;
    const body = up
      ? `Congratulations — you advanced from ${tierBefore} to ${tierAfter}. New privileges are now unlocked.`
      : `Your rank moved from ${tierBefore} to ${tierAfter}.`;
    return this._enqueue(userId, type, title, body, { ...meta, tierBefore, tierAfter, direction: up ? 'up' : 'down' });
  }

  // ── [V136-NO-02] streak reminder sweep ───────────────────────────────────────

  /**
   * Scan an engagement engine's streak store and enqueue reminders for users
   * with an active streak (>= minStreak) who have NOT been active today.
   *
   * The engagement engine exposes `_streakDb` (Map<userId,{current,lastDate}>).
   * To avoid reaching into private state in production code paths, callers may
   * instead pass an explicit `entries` array of { userId, current, lastDate }.
   *
   * @param {object} engagementEngine - object with a `_streakDb` Map (optional)
   * @param {object} [opts]
   * @param {string} [opts.today]     - yyyy-mm-dd (defaults to today UTC)
   * @param {Array}  [opts.entries]   - explicit streak entries (overrides engine)
   * @returns {{ scanned:number, reminded:number, skipped:number, reminders:object[] }}
   */
  runStreakReminderSweep(engagementEngine, opts = {}) {
    const today = opts.today || new Date().toISOString().slice(0, 10);

    let entries = opts.entries;
    if (!entries) {
      const db = engagementEngine && engagementEngine._streakDb;
      entries = db && typeof db.entries === 'function'
        ? Array.from(db.entries()).map(([userId, rec]) => ({
            userId, current: rec.current, lastDate: rec.lastDate,
          }))
        : [];
    }

    let reminded = 0, skipped = 0;
    const reminders = [];

    for (const e of entries) {
      const current = e.current || 0;
      // Active streak but not active today → at risk of breaking.
      if (current >= this._minStreak && e.lastDate !== today) {
        const key = `${e.userId}:${today}`;
        if (this._reminderFired.has(key)) { skipped++; continue; }
        this._reminderFired.set(key, true);
        const n = this._enqueue(
          e.userId,
          'streak_reminder',
          `Don't break your ${current}-day streak! 🔥`,
          `You're on a ${current}-day streak but haven't been active today. Complete an action to keep it alive.`,
          { streak: current, lastDate: e.lastDate || null, day: today }
        );
        reminders.push(n);
        reminded++;
      } else {
        skipped++;
      }
    }

    this._log.info && this._log.info(
      { component: 'rank-notifier', scanned: entries.length, reminded, skipped, day: today },
      '[V136-NO-02] Streak reminder sweep complete'
    );

    return { scanned: entries.length, reminded, skipped, reminders };
  }

  // ── [V136-NO-04] channel broadcast ───────────────────────────────────────────

  /**
   * Broadcast a message to all subscribers of a channel. The caller is
   * responsible for the STEWARD+ rank gate (the API layer uses requireRank).
   * Persists the message to comm_messages and enqueues a `channel_broadcast`
   * notification for every current subscriber.
   *
   * @param {string} channelId
   * @param {string} fromUserId
   * @param {string} message
   * @param {object} [meta]
   * @returns {{ ok:boolean, channelId?:string, messageId?:string, delivered?:number, error?:string, code?:string }}
   */
  broadcast(channelId, fromUserId, message, meta = {}) {
    if (!this._comm) {
      return { ok: false, error: 'CommChannelSystem not wired', code: 'NO_COMM_SYSTEM' };
    }
    if (!message || !String(message).trim()) {
      return { ok: false, error: 'message is required', code: 'EMPTY_MESSAGE' };
    }

    const subInfo = this._comm.channelSubscribers(channelId);
    if (!subInfo || subInfo.ok === false) {
      return { ok: false, error: `Channel '${channelId}' not found`, code: 'CHANNEL_NOT_FOUND' };
    }

    const ts = new Date().toISOString();
    const messageId = 'msg_' + createHash('sha256')
      .update([channelId, fromUserId, message, ts, String(++this._seq)].join(':'))
      .digest('hex').slice(0, 24);

    // Persist the broadcast message itself (non-fatal).
    if (this._db) {
      this._db.query(
        `INSERT INTO comm_messages (id, channel_id, from_user_id, body, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [messageId, channelId, fromUserId, String(message), ts]
      ).catch(err => this._log.warn && this._log.warn({ err: err.message }, '[V136-NO-04] comm_messages insert failed (non-fatal)'));
    }

    const subscribers = subInfo.subscribers || [];
    let delivered = 0;
    for (const subId of subscribers) {
      this._enqueue(
        subId,
        'channel_broadcast',
        `📡 ${channelId}`,
        String(message),
        { channelId, fromUserId, messageId, ...meta }
      );
      delivered++;
    }

    this._log.info && this._log.info(
      { component: 'rank-notifier', channelId, fromUserId, delivered, messageId },
      '[V136-NO-04] Channel broadcast delivered'
    );

    // [V138-ND03] Store in-memory for in-memory fallback pagination
    this._storeChannelMessage(channelId, {
      id: messageId, channelId, fromUserId, body: String(message), createdAt: ts,
    });

    return { ok: true, channelId, messageId, fromUserId, delivered, subscriberCount: subscribers.length, createdAt: ts };
  }

  // ── read / list API ──────────────────────────────────────────────────────────

  /**
   * List notifications for a user, newest first, with pagination + filtering.
   * @param {string} userId
   * @param {object} [opts] { limit=20, offset=0, unreadOnly=false, type=null }
   */
  list(userId, opts = {}) {
    const limit  = Math.min(100, Math.max(1, parseInt(opts.limit, 10) || 20));
    const offset = Math.max(0, parseInt(opts.offset, 10) || 0);
    const unreadOnly = opts.unreadOnly === true || opts.unreadOnly === 'true';
    const type = opts.type || null;

    let all = (this._queue.get(userId) || []).slice().reverse(); // newest first
    if (unreadOnly) all = all.filter(n => !n.read);
    if (type)       all = all.filter(n => n.type === type);

    const total  = all.length;
    const unread = (this._queue.get(userId) || []).filter(n => !n.read).length;
    const page   = all.slice(offset, offset + limit);

    return {
      userId,
      total,
      unread,
      limit,
      offset,
      count: page.length,
      hasMore: offset + page.length < total,
      notifications: page,
    };
  }

  /** Mark a single notification read. Returns { ok, notification? }. */
  markRead(userId, notificationId) {
    const list = this._queue.get(userId) || [];
    const n = list.find(x => x.id === notificationId);
    if (!n) return { ok: false, error: 'Notification not found', code: 'NOT_FOUND' };
    n.read = true;
    if (this._db) {
      this._db.query('UPDATE rank_notifications SET read = TRUE WHERE id = $1', [notificationId])
        .catch(err => this._log.warn && this._log.warn({ err: err.message }, '[V136-NO] markRead DB update failed (non-fatal)'));
    }
    return { ok: true, notification: n };
  }

  /** Mark all of a user's notifications read. Returns { ok, marked }. */
  markAllRead(userId) {
    const list = this._queue.get(userId) || [];
    let marked = 0;
    for (const n of list) { if (!n.read) { n.read = true; marked++; } }
    if (this._db && marked > 0) {
      this._db.query('UPDATE rank_notifications SET read = TRUE WHERE user_id = $1 AND read = FALSE', [userId])
        .catch(err => this._log.warn && this._log.warn({ err: err.message }, '[V136-NO] markAllRead DB update failed (non-fatal)'));
    }
    return { ok: true, marked };
  }

  // ── [V138-ND04] Notification Digest ─────────────────────────────────────────

  /**
   * Build a daily digest for a user: unread notifications grouped by type.
   * Suitable for an email-like summary (title counts, sample titles).
   * @param {string} userId
   * @returns {{ userId, total, unread, byType: Record<string,{count,samples}>, generatedAt }}
   */
  digest(userId) {
    const all = (this._queue.get(userId) || []).filter(n => !n.read).reverse();
    const byType = {};
    for (const n of all) {
      if (!byType[n.type]) byType[n.type] = { count: 0, samples: [] };
      byType[n.type].count++;
      if (byType[n.type].samples.length < 3) byType[n.type].samples.push(n.title);
    }
    return {
      userId,
      total:       all.length,
      unread:      all.length,
      byType,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Aggregate stats across all users (observability). */
  stats() {
    let totalNotifications = 0, totalUnread = 0;
    const byType = {};
    for (const [, list] of this._queue) {
      for (const n of list) {
        totalNotifications++;
        if (!n.read) totalUnread++;
        byType[n.type] = (byType[n.type] || 0) + 1;
      }
    }
    return {
      users: this._queue.size,
      totalNotifications,
      totalUnread,
      byType,
      minStreakForReminder: this._minStreak,
    };
  }

  // ── [V137-NF] Metrics ─────────────────────────────────────────────────────────

  /**
   * Extended metrics for the operator surface (Track F).
   * Includes delivery stats (WS + webhook success/failure counts).
   */
  metrics() {
    let totalNotifications = 0, totalUnread = 0;
    const byType = {};
    const byDay  = {};
    for (const [, list] of this._queue) {
      for (const n of list) {
        totalNotifications++;
        if (!n.read) totalUnread++;
        byType[n.type] = (byType[n.type] || 0) + 1;
        const day = (n.createdAt || '').slice(0, 10);
        if (day) byDay[day] = (byDay[day] || 0) + 1;
      }
    }

    const { wsSuccess, wsFailed, webhookSuccess, webhookFailed } = this._deliveryStats;
    const wsTotal      = wsSuccess + wsFailed;
    const webhookTotal = webhookSuccess + webhookFailed;

    return {
      users: this._queue.size,
      totalNotifications,
      totalUnread,
      unreadRate: totalNotifications > 0 ? +(totalUnread / totalNotifications).toFixed(4) : 0,
      byType,
      byDay,
      delivery: {
        ws:      { success: wsSuccess,      failed: wsFailed,      total: wsTotal,      successRate: wsTotal > 0 ? +(wsSuccess / wsTotal).toFixed(4) : null },
        webhook: { success: webhookSuccess, failed: webhookFailed, total: webhookTotal, successRate: webhookTotal > 0 ? +(webhookSuccess / webhookTotal).toFixed(4) : null },
      },
      wsClients: this._wsHub ? this._wsHub.connectedClients() : 0,
      wsUsers:   this._wsHub ? this._wsHub.connectedUsers()   : 0,
      minStreakForReminder: this._minStreak,
    };
  }

  // ── [V137-ND-02] Persistence & Recovery ──────────────────────────────────────

  /**
   * Load rank_notifications from DB into the in-memory queue.
   * Called once at server startup (non-fatal if DB unavailable).
   * Mirrors the UserRankSystem.loadFromDb() pattern from V134.
   *
   * Loads the most-recent QUEUE_MAX_PER_USER notifications per user so the
   * queue reflects reality after a restart.
   *
   * @returns {{ loaded: number, users: number, source: 'db'|'in-memory' }}
   */
  async loadFromDb() {
    if (!this._db) return { loaded: 0, users: 0, source: 'in-memory' };
    try {
      // Fetch all notifications ordered by user + creation time.
      // Limit to the last 10 000 rows to avoid pathological load times.
      const { rows } = await this._db.query(
        `SELECT id, user_id, type, title, body, meta, read, created_at
         FROM rank_notifications
         ORDER BY created_at DESC
         LIMIT 10000`
      );

      let loaded = 0;
      const seenUsers = new Set();

      for (const row of rows) {
        const userId = row.user_id;
        seenUsers.add(userId);

        if (!this._queue.has(userId)) this._queue.set(userId, []);
        const list = this._queue.get(userId);

        // Respect per-user ring-buffer cap.
        if (list.length >= QUEUE_MAX_PER_USER) continue;

        // Avoid duplicates if the server has already enqueued items since boot.
        if (list.some(n => n.id === row.id)) continue;

        const n = {
          id:        row.id,
          userId,
          type:      row.type,
          title:     row.title,
          body:      row.body,
          meta:      typeof row.meta === 'string' ? JSON.parse(row.meta) : (row.meta || {}),
          read:      row.read,
          createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        };
        // Prepend (oldest first) so the in-memory list stays chronological.
        list.unshift(n);
        loaded++;
      }

      this._log.info && this._log.info(
        { component: 'rank-notifier', loaded, users: seenUsers.size },
        '[V137-ND-02] Notifications loaded from DB'
      );
      return { loaded, users: seenUsers.size, source: 'db' };
    } catch (err) {
      this._log.warn && this._log.warn(
        { err: err.message },
        '[V137-ND-02] Notification DB load failed — using in-memory (non-fatal)'
      );
      return { loaded: 0, users: 0, source: 'in-memory', error: err.message };
    }
  }

  // ── [V137-ND-02] DB-backed list with pagination ───────────────────────────────

  /**
   * Extended list() that falls back to a DB query when no in-memory data is
   * available for the user and a DB pool is wired (real pagination from DB).
   *
   * @param {string} userId
   * @param {object} [opts] { limit, offset, unreadOnly, type }
   */
  async listFromDb(userId, opts = {}) {
    const limit      = Math.min(100, Math.max(1, parseInt(opts.limit,  10) || 20));
    const offset     = Math.max(0, parseInt(opts.offset, 10) || 0);
    const unreadOnly = opts.unreadOnly === true || opts.unreadOnly === 'true';
    const type       = opts.type || null;

    // If we have in-memory data, serve from there (fast path).
    if (this._queue.has(userId)) return this.list(userId, opts);

    // DB read path (if pool available).
    if (!this._db) return this.list(userId, opts);

    try {
      const params = [userId];
      let where = 'WHERE user_id = $1';
      if (unreadOnly) { params.push(false); where += ` AND read = $${params.length}`; }
      if (type)       { params.push(type);  where += ` AND type = $${params.length}`; }

      const countRes = await this._db.query(
        `SELECT COUNT(*) AS n FROM rank_notifications ${where}`, params
      );
      const total = parseInt(countRes.rows[0].n, 10) || 0;

      const unreadRes = await this._db.query(
        `SELECT COUNT(*) AS n FROM rank_notifications WHERE user_id = $1 AND read = FALSE`, [userId]
      );
      const unread = parseInt(unreadRes.rows[0].n, 10) || 0;

      params.push(limit, offset);
      const { rows } = await this._db.query(
        `SELECT id, user_id, type, title, body, meta, read, created_at
         FROM rank_notifications ${where}
         ORDER BY created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );

      const notifications = rows.map(r => ({
        id:        r.id,
        userId:    r.user_id,
        type:      r.type,
        title:     r.title,
        body:      r.body,
        meta:      typeof r.meta === 'string' ? JSON.parse(r.meta) : (r.meta || {}),
        read:      r.read,
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      }));

      return { userId, total, unread, limit, offset, count: notifications.length, hasMore: offset + notifications.length < total, notifications };
    } catch (err) {
      this._log.warn && this._log.warn({ err: err.message }, '[V137-ND-02] listFromDb failed — falling back to in-memory');
      return this.list(userId, opts);
    }
  }
  // ── [V138-ND03] Channel message store for in-memory fallback ────────────────────

  /**
   * Store a channel message in memory (called from broadcast()).
   * Kept as a fallback when DB is unavailable.
   */
  _storeChannelMessage(channelId, msg) {
    if (!this._channelMessages) this._channelMessages = new Map();
    if (!this._channelMessages.has(channelId)) this._channelMessages.set(channelId, []);
    const arr = this._channelMessages.get(channelId);
    arr.push(msg);
    if (arr.length > 500) arr.shift(); // ring-buffer per channel
  }

  /**
   * [V138-ND03] Retrieve channel messages from DB with cursor-based pagination.
   * Falls back to in-memory if DB unavailable.
   * @param {string} channelId
   * @param {object} [opts] { limit, before (ISO cursor), dbPool }
   * @returns {{ messages, hasMore, nextCursor }}
   */
  async getChannelMessagesFromDb(channelId, opts = {}) {
    const limit  = Math.min(100, Math.max(1, parseInt(opts.limit || '20', 10)));
    const before = opts.before || null; // ISO timestamp cursor
    const db     = opts.dbPool || this._db;

    if (db) {
      try {
        const params = [channelId, limit + 1];
        let cursor = '';
        if (before) {
          params.push(before);
          cursor = ` AND created_at < ${params.length}`;
        }
        const { rows } = await db.query(
          `SELECT id, channel_id, from_user_id, body, created_at
             FROM comm_messages
             WHERE channel_id = $1${cursor}
             ORDER BY created_at DESC
             LIMIT $2`,
          params
        );
        const hasMore = rows.length > limit;
        const page = rows.slice(0, limit);
        const messages = page.map(r => ({
          id:         r.id,
          channelId:  r.channel_id,
          fromUserId: r.from_user_id,
          body:       r.body,
          createdAt:  r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
        }));
        const nextCursor = hasMore && messages.length > 0
          ? messages[messages.length - 1].createdAt
          : null;
        return { messages, hasMore, nextCursor, total: messages.length, source: 'db' };
      } catch (err) {
        this._log.warn && this._log.warn({ err: err.message }, '[V138-ND03] comm_messages DB query failed — falling back to in-memory');
      }
    }

    // In-memory fallback
    const all = (this._channelMessages && this._channelMessages.get(channelId)) || [];
    let filtered = before
      ? all.filter(m => m.createdAt && m.createdAt < before)
      : all.slice();
    filtered = filtered.slice().reverse().slice(0, limit);
    return {
      messages:   filtered,
      hasMore:    false,
      nextCursor: null,
      total:      filtered.length,
      source:     'in-memory',
    };
  }

  /**
   * Synchronous in-memory channel message list (kept for backward compat).
   */
  getChannelMessages(channelId, opts = {}) {
    const limit  = Math.min(100, Math.max(1, parseInt(opts.limit || '20', 10)));
    const before = opts.before || null;
    const all    = (this._channelMessages && this._channelMessages.get(channelId)) || [];
    let filtered = before ? all.filter(m => m.createdAt && m.createdAt < before) : all.slice();
    filtered     = filtered.slice().reverse().slice(0, limit);
    return { messages: filtered, hasMore: false, nextCursor: null };
  }

}

// ── Singleton ─────────────────────────────────────────────────────────────────
let _instance = null;
function getRankNotifier(opts) {
  if (!_instance) _instance = new RankNotifier(opts || {});
  else if (opts) {
    // Allow late wiring of dependencies without replacing the instance/state.
    if (opts.rankSystem)          _instance._rank   = opts.rankSystem;
    if (opts.commChannels)        _instance._comm   = opts.commChannels;
    if (opts.notificationService) _instance._notify = opts.notificationService;
    if (opts.dbPool)              _instance._db     = opts.dbPool;
    if (opts.logger)              _instance._log    = opts.logger;
    // [V137] New wiring slots
    if (opts.wsHub)               _instance._wsHub  = opts.wsHub;
    if (opts.prefs)               _instance._prefs  = opts.prefs;
    if (opts.templates)           _instance._tpl    = opts.templates;
  }
  return _instance;
}

module.exports = { RankNotifier, getRankNotifier, QUEUE_MAX_PER_USER, TIER_ORDER };
