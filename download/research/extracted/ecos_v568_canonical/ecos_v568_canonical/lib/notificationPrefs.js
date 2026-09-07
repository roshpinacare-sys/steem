/**
 * notificationPrefs.js — ECOS V137
 * ─────────────────────────────────────────────────────────────────────────────
 * [V137-NC] Notification Preferences & Rate Control
 *
 * Stores per-user notification preferences:
 *   - muted: string[]      — notification types that are silenced
 *   - quietHours: { start: number, end: number } | null
 *                           — UTC hours [0-23]; during this window notifications
 *                             are enqueued but NOT pushed via WS/webhook
 *   - channel: 'ws' | 'webhook' | 'none'
 *                           — preferred delivery channel (does not affect queue)
 *   - locale: string        — preferred locale for i18n templates (default 'en')
 *
 * Architecture:
 *   - In-memory Map<userId, prefs> as primary store (fast synchronous reads).
 *   - Optional Postgres pool for persistence (non-fatal if unavailable).
 *   - `isMuted(userId, type)` is synchronous — used in the hot path of _enqueue().
 *   - `get(userId)` is async (may hit DB on first access).
 *   - `set(userId, updates)` is async (merges + persists; non-fatal on DB error).
 *
 * Sacred files: fiatLedger.js, auditLog.js — NOT touched.
 */

'use strict';

const VALID_CHANNELS = new Set(['ws', 'webhook', 'none']);

class NotificationPrefs {
  /**
   * @param {object} opts
   * @param {object} [opts.dbPool]   - Postgres pool (optional)
   * @param {object} [opts.logger]
   */
  constructor(opts = {}) {
    this._db     = opts.dbPool || null;
    this._logger = opts.logger || console;
    // Map<userId, {locale, muted, quietHours, channel}>
    this._store  = new Map();
  }

  _defaults() {
    return { locale: 'en', muted: [], quietHours: null, channel: 'ws' };
  }

  _validate(prefs) {
    const out = { ...this._defaults(), ...prefs };
    if (!Array.isArray(out.muted))                  out.muted       = [];
    if (!VALID_CHANNELS.has(out.channel))           out.channel     = 'ws';
    if (typeof out.locale !== 'string')             out.locale      = 'en';
    if (out.quietHours !== null && out.quietHours !== undefined) {
      const qh = out.quietHours;
      if (typeof qh !== 'object' || typeof qh.start !== 'number' || typeof qh.end !== 'number') {
        out.quietHours = null;
      } else {
        out.quietHours = { start: Math.max(0, Math.min(23, qh.start)), end: Math.max(0, Math.min(23, qh.end)) };
      }
    } else {
      out.quietHours = null;
    }
    return out;
  }

  /**
   * Get preferences for a user. Async — may hit DB on first access.
   * Returns a merged object (defaults + stored).
   */
  async get(userId) {
    if (this._store.has(userId)) return { ...this._defaults(), ...this._store.get(userId) };

    if (this._db) {
      try {
        const { rows } = await this._db.query(
          'SELECT prefs FROM notification_prefs WHERE user_id = $1', [userId]
        );
        if (rows.length) {
          const raw   = rows[0].prefs;
          const prefs = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
          this._store.set(userId, prefs);
          return this._validate(prefs);
        }
      } catch (err) {
        this._logger.warn && this._logger.warn(
          { err: err.message, userId }, '[V137-NC] prefs DB read failed (non-fatal)'
        );
      }
    }

    return this._defaults();
  }

  /**
   * Update preferences for a user. Async.
   * Merges `updates` into the current prefs and persists.
   * Returns the validated merged prefs object.
   */
  async set(userId, updates) {
    const current = await this.get(userId);
    const merged  = this._validate({ ...current, ...updates });
    this._store.set(userId, merged);

    if (this._db) {
      this._db.query(
        `INSERT INTO notification_prefs (user_id, prefs, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id) DO UPDATE
           SET prefs = $2::jsonb, updated_at = NOW()`,
        [userId, JSON.stringify(merged)]
      ).catch(err => this._logger.warn && this._logger.warn(
        { err: err.message, userId }, '[V137-NC] prefs DB write failed (non-fatal)'
      ));
    }

    return merged;
  }

  /**
   * Synchronous mute check — used in the hot path of RankNotifier._enqueue().
   * Returns true if the notification should be suppressed (type muted OR quiet hours active).
   *
   * NOTE: only reflects the in-memory cache. Call `get(userId)` first to warm
   * the cache from DB if needed (the route handlers do this for prefs endpoints;
   * for the enqueue hot path we accept stale reads to keep it synchronous).
   */
  isMuted(userId, type) {
    const prefs = this._store.get(userId) || this._defaults();

    // Type-level mute
    if (Array.isArray(prefs.muted) && prefs.muted.includes(type)) return true;

    // Quiet hours (UTC)
    if (prefs.quietHours) {
      const hour  = new Date().getUTCHours();
      const { start, end } = prefs.quietHours;
      if (typeof start === 'number' && typeof end === 'number') {
        if (start <= end) {
          if (hour >= start && hour < end) return true;
        } else {
          // wraps midnight: e.g. start=22, end=6
          if (hour >= start || hour < end) return true;
        }
      }
    }

    return false;
  }

  /**
   * Get the preferred delivery channel for a user (synchronous, from cache).
   * Returns 'ws' if no preference is cached.
   */
  getChannel(userId) {
    const prefs = this._store.get(userId) || this._defaults();
    return prefs.channel || 'ws';
  }

  /**
   * Get the preferred locale for a user (synchronous, from cache).
   * Returns 'en' if no preference is cached.
   */
  getLocale(userId) {
    const prefs = this._store.get(userId) || this._defaults();
    return typeof prefs.locale === 'string' && prefs.locale ? prefs.locale : 'en';
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
let _instance = null;
function getNotificationPrefs(opts) {
  if (!_instance) _instance = new NotificationPrefs(opts || {});
  else if (opts) {
    if (opts.dbPool) _instance._db     = opts.dbPool;
    if (opts.logger) _instance._logger = opts.logger;
  }
  return _instance;
}

module.exports = { NotificationPrefs, getNotificationPrefs };
