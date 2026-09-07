/**
 * userRankSystem.js — ECOS V133
 * ─────────────────────────────────────────────────────────────────────────────
 * [V133-RANK] Tiered User Ranking & Reward Eligibility System
 *
 * The reward system is NOT open to all — only identified, ranked users
 * receive rewards. Rank is earned, not granted.
 *
 * Architecture:
 *   - Every user has a numeric score (0–∞) derived from their activity
 *   - Score maps to a Rank Tier (see RANK_TIERS)
 *   - Only tiers CONTRIBUTOR and above are eligible for rewards
 *   - Each user gets a unique RankToken (deterministic, non-transferable)
 *   - Communication access is gated by tier (COMM_ACCESS_LEVELS)
 *   - Anti-scam / anti-spam: reputation signals can DOWNRANK a user
 *
 * Sacred files: fiatLedger.js, auditLog.js — NOT modified.
 * All financial operations go through the existing creditSystem.
 */

'use strict';

const { createHash } = require('node:crypto');

// ─────────────────────────────────────────────────────────────────────────────
// RANK TIERS (ascending privilege)
// ─────────────────────────────────────────────────────────────────────────────
const RANK_TIERS = [
  {
    id:            'OBSERVER',
    label:         'Observer',
    emoji:         '👁️',
    minScore:      0,
    rewardEligible: false,
    commLevel:     0,
    description:   'Read-only access. No rewards. No communication channels.',
  },
  {
    id:            'MEMBER',
    label:         'Member',
    emoji:         '🌱',
    minScore:      50,
    rewardEligible: false,
    commLevel:     1,
    description:   'Basic participation. No rewards yet. Can submit tasks.',
  },
  {
    id:            'CONTRIBUTOR',
    label:         'Contributor',
    emoji:         '⚡',
    minScore:      200,
    rewardEligible: true,
    commLevel:     2,
    description:   'Reward-eligible. Access to contributor channels.',
  },
  {
    id:            'VALIDATOR',
    label:         'Validator',
    emoji:         '🔐',
    minScore:      600,
    rewardEligible: true,
    commLevel:     3,
    description:   'Can validate others. Higher reward multiplier (1.5×).',
  },
  {
    id:            'STEWARD',
    label:         'Steward',
    emoji:         '🏛️',
    minScore:      1500,
    rewardEligible: true,
    commLevel:     4,
    description:   'Governance rights. Reward multiplier 2×. Priority queue.',
  },
  {
    id:            'SOVEREIGN',
    label:         'Sovereign',
    emoji:         '👑',
    minScore:      5000,
    rewardEligible: true,
    commLevel:     5,
    description:   'Top tier. Reward multiplier 3×. Full system access.',
  },
];

// Communication access level descriptions
const COMM_ACCESS_LEVELS = {
  0: { label: 'None',       channels: [] },
  1: { label: 'Basic',      channels: ['public-announcements'] },
  2: { label: 'Community',  channels: ['public-announcements', 'community-general', 'contributor-hub'] },
  3: { label: 'Validator',  channels: ['public-announcements', 'community-general', 'contributor-hub', 'validator-channel'] },
  4: { label: 'Governance', channels: ['public-announcements', 'community-general', 'contributor-hub', 'validator-channel', 'governance-chamber'] },
  5: { label: 'Full',       channels: ['*'] },
};

// Reward multipliers by tier
const REWARD_MULTIPLIERS = {
  OBSERVER:    0,
  MEMBER:      0,
  CONTRIBUTOR: 1.0,
  VALIDATOR:   1.5,
  STEWARD:     2.0,
  SOVEREIGN:   3.0,
};

// Score events and their point values
const SCORE_EVENTS = {
  task_submitted:          10,
  task_approved:           25,
  validation_completed:    20,
  validation_correct:      15,    // bonus when validator was right
  patch_authored:          30,
  patch_earning_royalty:   50,
  referral_converted:      40,
  streak_7d:               20,
  streak_30d:              60,
  // Anti-spam / anti-scam downrank events
  spam_flag:              -80,
  scam_flag:             -200,
  false_validation:       -30,
  rate_limit_abuse:       -15,
};

// ─────────────────────────────────────────────────────────────────────────────
// RankToken — deterministic, non-transferable, unique per user
// ─────────────────────────────────────────────────────────────────────────────
function generateRankToken(userId, secret = 'ecos-rank-salt') {
  return 'RTK-' + createHash('sha256')
    .update(`${secret}:${userId}:rank-token`)
    .digest('hex')
    .slice(0, 32)
    .toUpperCase();
}

function verifyRankToken(userId, token, secret = 'ecos-rank-salt') {
  return generateRankToken(userId, secret) === token;
}

// ─────────────────────────────────────────────────────────────────────────────
// UserRankSystem — main class
// ─────────────────────────────────────────────────────────────────────────────
class UserRankSystem {
  /**
   * @param {object} opts
   * @param {object} opts.logger  - optional pino-style logger
   * @param {string} opts.secret  - HMAC secret for rank tokens (from env)
   */
  constructor(opts = {}) {
    this._logger = opts.logger || console;
    this._secret = opts.secret || process.env.ECOS_RANK_SECRET || 'ecos-rank-salt';
    // In-memory store; loaded from DB on init (V134)
    this._scores   = new Map(); // userId → { score, events, createdAt, updatedAt, flags }
    this._rankLog  = [];        // audit trail of rank changes
    // [V134-RI-02] Optional DB pool for persistence
    this._db = opts.dbPool || null;
    // [V136-NO-01] Optional tier-change hook: (userId, tierBefore, tierAfter, meta) => void
    // Invoked synchronously from recordEvent when a user crosses a tier boundary.
    // Wrapped in try/catch by the caller — must never break score recording.
    this._onTierChange = opts.onTierChange || null;
  }

  /**
   * [V134-RI-02] Load rank scores from DB into memory.
   * Call once at server startup. Non-fatal if DB is unavailable.
   */
  async loadFromDb() {
    if (!this._db) return { loaded: 0, source: 'in-memory' };
    try {
      const { rows } = await this._db.query(
        'SELECT user_id, score, flags, created_at, updated_at FROM rank_scores ORDER BY score DESC'
      );
      for (const row of rows) {
        this._scores.set(row.user_id, {
          score:     row.score,
          flags:     row.flags || 0,
          events:    [], // event details not reloaded (they're in rank_events table)
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
        });
      }
      this._logger.info && this._logger.info({ loaded: rows.length }, '[V134-RANK] Loaded rank scores from DB');
      return { loaded: rows.length, source: 'db' };
    } catch (err) {
      this._logger.warn && this._logger.warn({ err: err.message }, '[V134-RANK] DB load failed — using in-memory (non-fatal)');
      return { loaded: 0, source: 'in-memory', error: err.message };
    }
  }

  /**
   * [V134-RI-02] Persist a rank score update to DB (fire-and-forget).
   */
  _persistToDb(userId, state, eventType, delta, tierBefore, tierAfter, meta = {}) {
    if (!this._db) return;
    const refId = meta.refId || meta.approvalId || meta.taskId || meta.patchId || null;
    const source = meta.source || eventType;

    // Upsert rank_scores
    this._db.query(
      `INSERT INTO rank_scores (user_id, score, flags, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET score = EXCLUDED.score, flags = EXCLUDED.flags, updated_at = NOW()`,
      [userId, state.score, state.flags || 0, state.createdAt]
    ).catch(err => this._logger.warn && this._logger.warn({ err: err.message }, '[V134-RANK] rank_scores upsert failed'));

    // Append to rank_events
    this._db.query(
      `INSERT INTO rank_events (user_id, event_type, delta, score_after, tier_before, tier_after, source, ref_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, eventType, delta, state.score, tierBefore, tierAfter, source, refId]
    ).catch(err => this._logger.warn && this._logger.warn({ err: err.message }, '[V134-RANK] rank_events insert failed'));

    // Log tier change if applicable
    if (tierBefore !== tierAfter) {
      this._db.query(
        `INSERT INTO rank_tier_changes (user_id, tier_before, tier_after, score_at)
         VALUES ($1, $2, $3, $4)`,
        [userId, tierBefore, tierAfter, state.score]
      ).catch(err => this._logger.warn && this._logger.warn({ err: err.message }, '[V134-RANK] rank_tier_changes insert failed'));
    }
  }

  // ── Score management ────────────────────────────────────────────────────────

  /**
   * Record a score event for a user.
   * @param {string} userId
   * @param {string} eventType  - key from SCORE_EVENTS
   * @param {object} meta       - optional metadata
   * @returns {{ score, delta, tier, rewardEligible }}
   */
  recordEvent(userId, eventType, meta = {}) {
    if (!SCORE_EVENTS.hasOwnProperty(eventType)) {
      throw new Error(`Unknown score event: ${eventType}`);
    }
    const delta = SCORE_EVENTS[eventType];
    const prev  = this._getOrCreate(userId);
    const oldTier = this._tierFor(prev.score);

    // Apply delta (floor at 0)
    const newScore = Math.max(0, prev.score + delta);
    const newTier  = this._tierFor(newScore);

    prev.score     = newScore;
    prev.updatedAt = new Date().toISOString();
    prev.events.push({ eventType, delta, score: newScore, ts: prev.updatedAt, meta });

    // Track flags for anti-spam
    if (eventType === 'spam_flag' || eventType === 'scam_flag') {
      prev.flags = (prev.flags || 0) + 1;
    }

    // Log tier change
    if (oldTier.id !== newTier.id) {
      const logEntry = {
        userId, from: oldTier.id, to: newTier.id,
        score: newScore, ts: prev.updatedAt,
      };
      this._rankLog.push(logEntry);
      this._logger.info && this._logger.info(logEntry, '[V133-RANK] Tier change');

      // [V136-NO-01] Fire optional tier-change hook (e.g. rankNotifier). Non-fatal.
      if (this._onTierChange) {
        try {
          this._onTierChange(userId, oldTier.id, newTier.id, { score: newScore, eventType, ...meta });
        } catch (hookErr) {
          this._logger.warn && this._logger.warn({ err: hookErr.message }, '[V136-NO-01] onTierChange hook failed (non-fatal)');
        }
      }
    }

    // [V134-RI-02] Persist to DB (fire-and-forget, non-blocking)
    this._persistToDb(userId, prev, eventType, delta, oldTier.id, newTier.id, meta);

    return {
      userId,
      score:          newScore,
      delta,
      tier:           newTier,
      rewardEligible: newTier.rewardEligible,
    };
  }

  /**
   * Get the full rank profile for a user.
   */
  getProfile(userId) {
    const state   = this._getOrCreate(userId);
    const tier    = this._tierFor(state.score);
    const token   = generateRankToken(userId, this._secret);
    const commAcc = COMM_ACCESS_LEVELS[tier.commLevel];
    const nextTier = this._nextTier(tier);
    const pointsToNext = nextTier ? Math.max(0, nextTier.minScore - state.score) : null;

    return {
      userId,
      score:          state.score,
      tier,
      rankToken:      token,
      rewardEligible: tier.rewardEligible,
      rewardMultiplier: REWARD_MULTIPLIERS[tier.id],
      communication: {
        level:    tier.commLevel,
        label:    commAcc.label,
        channels: commAcc.channels,
      },
      progression: {
        nextTier:     nextTier || null,
        pointsToNext,
        pct: nextTier
          ? Math.min(100, Math.round(((state.score - tier.minScore) / (nextTier.minScore - tier.minScore)) * 100))
          : 100,
      },
      flags:     state.flags || 0,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
    };
  }

  /**
   * Verify a rank token for a user.
   */
  verifyToken(userId, token) {
    return verifyRankToken(userId, token, this._secret);
  }

  /**
   * Check if a user has access to a communication channel.
   */
  hasChannelAccess(userId, channelId) {
    const state  = this._getOrCreate(userId);
    const tier   = this._tierFor(state.score);
    const access = COMM_ACCESS_LEVELS[tier.commLevel];
    if (access.channels.includes('*')) return true;
    return access.channels.includes(channelId);
  }

  /**
   * Leaderboard — top N users by score.
   */
  leaderboard(limit = 20) {
    const entries = Array.from(this._scores.entries())
      .map(([userId, state]) => {
        const tier = this._tierFor(state.score);
        return { userId, score: state.score, tier: tier.id, tierEmoji: tier.emoji, rewardEligible: tier.rewardEligible };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return { leaderboard: entries, total: this._scores.size };
  }

  /**
   * Tier distribution stats.
   */
  stats() {
    const dist = {};
    for (const t of RANK_TIERS) dist[t.id] = 0;
    for (const [, state] of this._scores) {
      const tier = this._tierFor(state.score);
      dist[tier.id] = (dist[tier.id] || 0) + 1;
    }
    return {
      totalUsers:    this._scores.size,
      rewardEligible: Array.from(this._scores.values()).filter(s => this._tierFor(s.score).rewardEligible).length,
      tierDistribution: dist,
      rankLogEntries: this._rankLog.length,
      tiers: RANK_TIERS.map(t => ({
        id: t.id, label: t.label, emoji: t.emoji,
        minScore: t.minScore, rewardEligible: t.rewardEligible,
        count: dist[t.id] || 0,
      })),
    };
  }

  /**
   * Recent rank change log (last N entries).
   */
  rankLog(limit = 50) {
    return this._rankLog.slice(-limit).reverse();
  }

  /**
   * [V136-NO-03] Paginated per-user rank EVENT history (newest first).
   *
   * Reads the in-memory event list captured by recordEvent(). In production the
   * canonical source is the `rank_events` table; this in-memory view is always
   * available and is what the API serves when no DB is wired (and is used for
   * tests). Supports filtering by eventType.
   *
   * @param {string} userId
   * @param {object} [opts] { limit=20, offset=0, eventType=null }
   * @returns {{ userId, total, limit, offset, count, hasMore, events:object[] }}
   */
  history(userId, opts = {}) {
    const limit  = Math.min(100, Math.max(1, parseInt(opts.limit, 10) || 20));
    const offset = Math.max(0, parseInt(opts.offset, 10) || 0);
    const eventType = opts.eventType || null;

    const state = this._scores.get(userId);
    let events = state ? state.events.slice() : [];
    if (eventType) events = events.filter(e => e.eventType === eventType);

    // newest first
    events = events.slice().reverse();
    const total = events.length;
    const page  = events.slice(offset, offset + limit);

    return {
      userId,
      total,
      limit,
      offset,
      count: page.length,
      hasMore: offset + page.length < total,
      events: page,
    };
  }

  // ── Internal helpers ─────────────────────────────────────────────────────────

  _getOrCreate(userId) {
    if (!this._scores.has(userId)) {
      this._scores.set(userId, {
        score: 0, events: [], flags: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    return this._scores.get(userId);
  }

  _tierFor(score) {
    let tier = RANK_TIERS[0];
    for (const t of RANK_TIERS) {
      if (score >= t.minScore) tier = t;
    }
    return tier;
  }

  _nextTier(currentTier) {
    const idx = RANK_TIERS.findIndex(t => t.id === currentTier.id);
    return idx >= 0 && idx < RANK_TIERS.length - 1 ? RANK_TIERS[idx + 1] : null;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const defaultUserRankSystem = new UserRankSystem({
  secret: process.env.ECOS_RANK_SECRET || 'ecos-rank-salt',
});

module.exports = {
  UserRankSystem,
  defaultUserRankSystem,
  RANK_TIERS,
  COMM_ACCESS_LEVELS,
  REWARD_MULTIPLIERS,
  SCORE_EVENTS,
  generateRankToken,
  verifyRankToken,
};
