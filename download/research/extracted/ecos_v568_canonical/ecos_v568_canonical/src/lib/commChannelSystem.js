/**
 * commChannelSystem.js — ECOS V134
 * ─────────────────────────────────────────────────────────────────────────────
 * [V134-RI-05] Communication Channel Subscription System
 *
 * Users join channels matching their rank tier.
 * POST /api/v1/comm/channels/:id/subscribe — gated by rank.
 *
 * Architecture:
 *   - Channels are pre-defined (from COMM_ACCESS_LEVELS in userRankSystem)
 *   - Subscription is gated: user must have commLevel >= channel.minLevel
 *   - In-memory store (Map) with DB persistence hook (dbPool optional)
 *   - Subscriptions are idempotent — subscribing twice is a no-op
 *
 * Sacred files: fiatLedger.js, auditLog.js — NOT modified.
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Channel definitions (mirrors COMM_ACCESS_LEVELS in userRankSystem.js)
// ─────────────────────────────────────────────────────────────────────────────
const CHANNELS = [
  {
    id:          'public-announcements',
    label:       'Public Announcements',
    description: 'Read-only broadcast channel for all users',
    minLevel:    1,
    minTier:     'MEMBER',
    readOnly:    true,
  },
  {
    id:          'community-general',
    label:       'Community General',
    description: 'Open discussion for contributors and above',
    minLevel:    2,
    minTier:     'CONTRIBUTOR',
    readOnly:    false,
  },
  {
    id:          'contributor-hub',
    label:       'Contributor Hub',
    description: 'Coordination channel for active contributors',
    minLevel:    2,
    minTier:     'CONTRIBUTOR',
    readOnly:    false,
  },
  {
    id:          'validator-channel',
    label:       'Validator Channel',
    description: 'Private channel for certified validators',
    minLevel:    3,
    minTier:     'VALIDATOR',
    readOnly:    false,
  },
  {
    id:          'governance-chamber',
    label:       'Governance Chamber',
    description: 'Steward-level governance discussions',
    minLevel:    4,
    minTier:     'STEWARD',
    readOnly:    false,
  },
  {
    id:          'sovereign-council',
    label:       'Sovereign Council',
    description: 'Exclusive channel for Sovereigns only',
    minLevel:    5,
    minTier:     'SOVEREIGN',
    readOnly:    false,
  },
];

const CHANNEL_MAP = new Map(CHANNELS.map(c => [c.id, c]));

// ─────────────────────────────────────────────────────────────────────────────
class CommChannelSystem {
  /**
   * @param {object} opts
   * @param {import('./userRankSystem').UserRankSystem} opts.rankSystem
   * @param {object} [opts.dbPool]  - Postgres pool (optional; in-memory fallback)
   * @param {object} [opts.logger]
   */
  constructor({ rankSystem, dbPool = null, logger = console }) {
    this._rank   = rankSystem;
    this._db     = dbPool;
    this._log    = logger;
    // Map<channelId, Set<userId>>
    this._subs   = new Map(CHANNELS.map(c => [c.id, new Set()]));
    // Map<userId, Set<channelId>>
    this._userSubs = new Map();
  }

  /**
   * Subscribe a user to a channel.
   * Returns { ok, channelId, userId, alreadySubscribed } or throws.
   */
  async subscribe(userId, channelId) {
    const channel = CHANNEL_MAP.get(channelId);
    if (!channel) {
      return { ok: false, error: `Channel '${channelId}' does not exist`, code: 'CHANNEL_NOT_FOUND' };
    }

    // Check rank
    const profile = this._rank.getProfile(userId);
    if (profile.communication.level < channel.minLevel) {
      return {
        ok:      false,
        error:   `Rank insufficient for channel '${channelId}'. Required tier: ${channel.minTier}, your tier: ${profile.tier.id}`,
        code:    'RANK_INSUFFICIENT',
        required: channel.minTier,
        current:  profile.tier.id,
      };
    }

    // Idempotent subscribe
    const chanSubs = this._subs.get(channelId);
    const alreadySubscribed = chanSubs.has(userId);

    if (!alreadySubscribed) {
      chanSubs.add(userId);
      if (!this._userSubs.has(userId)) this._userSubs.set(userId, new Set());
      this._userSubs.get(userId).add(channelId);

      // Persist to DB if available
      if (this._db) {
        try {
          await this._db.query(
            `INSERT INTO comm_subscriptions (user_id, channel_id, subscribed_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (user_id, channel_id) DO NOTHING`,
            [userId, channelId]
          );
        } catch (err) {
          this._log.warn({ err: err.message }, '[CommChannel] DB persist failed (non-fatal)');
        }
      }
    }

    return {
      ok: true,
      channelId,
      userId,
      alreadySubscribed,
      channel: _safeChannel(channel),
      commLevel: profile.communication.level,
    };
  }

  /**
   * Unsubscribe a user from a channel.
   */
  async unsubscribe(userId, channelId) {
    const channel = CHANNEL_MAP.get(channelId);
    if (!channel) return { ok: false, error: 'Channel not found', code: 'CHANNEL_NOT_FOUND' };

    const chanSubs = this._subs.get(channelId);
    const wasSub = chanSubs.has(userId);
    chanSubs.delete(userId);
    if (this._userSubs.has(userId)) this._userSubs.get(userId).delete(channelId);

    if (this._db && wasSub) {
      try {
        await this._db.query(
          'DELETE FROM comm_subscriptions WHERE user_id = $1 AND channel_id = $2',
          [userId, channelId]
        );
      } catch (err) {
        this._log.warn({ err: err.message }, '[CommChannel] DB unsubscribe failed (non-fatal)');
      }
    }

    return { ok: true, channelId, userId, wasSub };
  }

  /**
   * List channels a user is subscribed to.
   */
  userSubscriptions(userId) {
    const subs = this._userSubs.get(userId) || new Set();
    return Array.from(subs).map(cid => _safeChannel(CHANNEL_MAP.get(cid)));
  }

  /**
   * List all subscribers of a channel (with rank info).
   */
  channelSubscribers(channelId) {
    const chanSubs = this._subs.get(channelId);
    if (!chanSubs) return { ok: false, error: 'Channel not found' };
    return {
      ok: true,
      channelId,
      count: chanSubs.size,
      subscribers: Array.from(chanSubs),
    };
  }

  /**
   * List all channels accessible by a user (based on rank), with subscription status.
   */
  accessibleChannels(userId) {
    const profile = this._rank.getProfile(userId);
    const userLevel = profile.communication.level;
    const userSubs = this._userSubs.get(userId) || new Set();

    // Sovereign has '*' = all channels
    const allAccess = profile.communication.channels.includes('*');

    return CHANNELS
      .filter(c => allAccess || userLevel >= c.minLevel)
      .map(c => ({
        ..._safeChannel(c),
        subscribed: userSubs.has(c.id),
        subscriberCount: this._subs.get(c.id)?.size || 0,
      }));
  }

  /**
   * System stats.
   */
  stats() {
    const totalSubs = Array.from(this._subs.values()).reduce((n, s) => n + s.size, 0);
    return {
      channels: CHANNELS.map(c => ({
        id: c.id, label: c.label, minTier: c.minTier,
        subscriberCount: this._subs.get(c.id)?.size || 0,
      })),
      totalSubscriptions: totalSubs,
      uniqueSubscribers:  this._userSubs.size,
    };
  }

  /**
   * All channel definitions.
   */
  static get CHANNELS() { return CHANNELS; }
  static get CHANNEL_MAP() { return CHANNEL_MAP; }
}

function _safeChannel(c) {
  if (!c) return null;
  return { id: c.id, label: c.label, description: c.description, minTier: c.minTier, minLevel: c.minLevel, readOnly: c.readOnly };
}

// Singleton
let _instance = null;
function getCommChannelSystem(opts) {
  if (!_instance && opts) _instance = new CommChannelSystem(opts);
  return _instance;
}

module.exports = { CommChannelSystem, getCommChannelSystem, CHANNELS, CHANNEL_MAP };
