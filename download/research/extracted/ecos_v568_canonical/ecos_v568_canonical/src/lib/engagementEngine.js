'use strict';

/**
 * EngagementEngine — Community & psychology layer.
 * Turns ECOS from a tool into a community where users feel like OWNERS.
 *
 * Levels, badges, streaks, and the killer ownership snapshot.
 * V111 — Sovereign Economy
 */

const LEVEL_THRESHOLDS = [
  { level: 1, title: 'Observer',    minPoints: 0    },
  { level: 2, title: 'Contributor', minPoints: 10   },
  { level: 3, title: 'Validator',   minPoints: 50   },
  { level: 4, title: 'Steward',     minPoints: 200  },
  { level: 5, title: 'Architect',   minPoints: 1000 },
  { level: 6, title: 'Founder-tier',minPoints: 5000 },
];

const BADGE_RULES = [
  { id: 'first_validation',        label: 'First Validation',          check: u => u.validationsCompleted >= 1 },
  { id: '10_validations',          label: '10 Validations',            check: u => u.validationsCompleted >= 10 },
  { id: '100_validations',         label: '100 Validations',           check: u => u.validationsCompleted >= 100 },
  { id: 'first_patch',             label: 'First Patch',               check: u => u.patchesAuthored >= 1 },
  { id: 'patch_earning_royalties', label: 'Patch Earning Royalties',   check: u => (u.totalEarned || 0) > 0 && u.patchesAuthored >= 1 },
  { id: '7_day_streak',            label: '7-Day Streak',              check: u => (u.streak?.longest || 0) >= 7 },
  { id: '30_day_streak',           label: '30-Day Streak',             check: u => (u.streak?.longest || 0) >= 30 },
  { id: '100_credits_earned',      label: '100 Credits Earned',        check: u => (u.totalEarned || 0) >= 100 },
  { id: 'audit_verified',          label: 'Audit Verified',            check: u => (u.activityLog || []).some(a => a.type === 'audit_verify') },
];

class EngagementEngine {
  constructor({ ledger, validatorReputation, creditSystem, userStore } = {}) {
    this._ledger              = ledger;
    this._validatorReputation = validatorReputation || null;
    this._creditSystem        = creditSystem || null;
    this._userStore           = userStore || null; // UserAccountService or Map
    this._streakDb            = new Map(); // userId → { current, longest, lastDate }
    this._leaderboard         = new Map(); // userId → stats snapshot
    // [V135-RH-04] Rank system + DB pool for streak milestone rank events
    this._rankSystem          = null; // set externally after init
    this._db                  = null; // set externally after init (for streak_events dedup)
    this._streakMilestoneFired = new Map(); // userId → Set<milestone> (in-memory dedup)
  }

  // ── Levels ────────────────────────────────────────────────────────────────

  _pointsForUser(user) {
    const validations = (user.validationsCompleted || 0) * 5;
    const patches     = (user.patchesAuthored      || 0) * 10;
    const tasks       = (user.activityLog || []).filter(a => a.type === 'task').length;
    return validations + patches + tasks;
  }

  /**
   * @param {string} userId
   * @returns {{ level: number, title: string, progressToNext: number }}
   */
  async computeLevel(userId) {
    const user   = this._getUser(userId);
    const points = user ? this._pointsForUser(user) : 0;

    let current = LEVEL_THRESHOLDS[0];
    let next    = LEVEL_THRESHOLDS[1];

    for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
      if (points >= LEVEL_THRESHOLDS[i].minPoints) {
        current = LEVEL_THRESHOLDS[i];
        next    = LEVEL_THRESHOLDS[i + 1] || null;
        break;
      }
    }

    const progressToNext = next
      ? Math.min(1, (points - current.minPoints) / (next.minPoints - current.minPoints))
      : 1;

    return {
      level:         current.level,
      title:         current.title,
      points,
      progressToNext: Math.round(progressToNext * 100) / 100,
      nextLevel:     next ? next.title : null,
    };
  }

  // ── Badges ────────────────────────────────────────────────────────────────

  /**
   * @param {string} userId
   * @returns {string[]} newly earned badge ids
   */
  async checkBadges(userId) {
    const user = this._getUser(userId);
    if (!user) return [];

    const existing = new Set(user.badges || []);
    const earned   = [];

    for (const rule of BADGE_RULES) {
      if (!existing.has(rule.id) && rule.check(user)) {
        earned.push(rule.id);
        if (user.badges) user.badges.push(rule.id);
      }
    }

    return earned;
  }

  // ── Streaks ───────────────────────────────────────────────────────────────

  /**
   * @param {string} userId
   * @returns {{ current: number, longest: number, brokeToday: boolean }}
   */
  async updateStreak(userId) {
    const today    = new Date().toISOString().slice(0, 10);
    const existing = this._streakDb.get(userId) || { current: 0, longest: 0, lastDate: null };

    if (existing.lastDate === today) {
      // Already updated today
      return { current: existing.current, longest: existing.longest, brokeToday: false };
    }

    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    let   current;
    let   brokeToday = false;

    if (existing.lastDate === yesterday) {
      current = existing.current + 1;
    } else if (existing.lastDate === null) {
      current = 1;
    } else {
      current    = 1; // streak broken
      brokeToday = existing.current > 0;
    }

    const longest = Math.max(current, existing.longest);
    const rec     = { current, longest, lastDate: today };
    this._streakDb.set(userId, rec);

    // Sync back to user object if available
    const user = this._getUser(userId);
    if (user) user.streak = { current, longest, lastActiveDate: today };

    // [V135-RH-04] Fire streak milestone rank events (7d and 30d)
    // Non-fatal, deduped in-memory + DB to prevent double-fire on restart.
    if (this._rankSystem) {
      for (const milestone of [7, 30]) {
        if (current >= milestone) {
          const firedKey = `${userId}:${milestone}`;
          if (!this._streakMilestoneFired.has(firedKey)) {
            this._streakMilestoneFired.set(firedKey, true);
            const eventType = milestone === 7 ? 'streak_7d' : 'streak_30d';
            try {
              this._rankSystem.recordEvent(userId, eventType, {
                source: 'engagement_streak',
                refId: `streak_${milestone}d_${today}`,
              });
            } catch (e) { /* non-fatal */ }
            // Persist milestone to DB so dedup survives restart
            if (this._db) {
              this._db.query(
                `INSERT INTO streak_events (user_id, milestone, streak_value)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (user_id, milestone) DO NOTHING`,
                [userId, milestone, current]
              ).catch(() => { /* non-fatal */ });
            }
          }
        }
      }
    }

    return { current, longest, brokeToday };
  }

  // ── Ownership snapshot ────────────────────────────────────────────────────

  /**
   * The "you are a shareholder" view.
   * Returns ownership metrics that make users feel invested in ECOS.
   */
  async ownershipSnapshot(userId) {
    const user = this._getUser(userId);
    if (!user) throw new Error(`ownershipSnapshot: user not found: ${userId}`);

    const patchesAuthored       = user.patchesAuthored      || 0;
    const lifetimeRoyaltiesEarned = user.totalEarned        || 0;
    const allUsers              = this._getAllUsers();
    const totalPatches          = allUsers.reduce((s, u) => s + (u.patchesAuthored || 0), 0);
    const shareOfKnowledgeBase  = totalPatches > 0
      ? ((patchesAuthored / totalPatches) * 100).toFixed(2) + '%'
      : '0.00%';

    // Estimate royalties last 7 days (simplified: 1/52 of annual)
    const royaltiesLast7Days       = parseFloat((lifetimeRoyaltiesEarned / 52).toFixed(2));
    const estimatedAnnualRoyalties = parseFloat((royaltiesLast7Days * 52).toFixed(2));

    const timesReused = patchesAuthored * 10; // Placeholder metric

    return {
      patchesAuthored,
      lifetimeRoyaltiesEarned,
      royaltiesLast7Days,
      estimatedAnnualRoyalties,
      shareOfKnowledgeBase,
      message: patchesAuthored > 0
        ? `Your knowledge has been reused ${timesReused} times this week`
        : 'Author your first knowledge patch to start earning royalties',
    };
  }

  // ── Community leaderboard ─────────────────────────────────────────────────

  /**
   * @param {'royalties'|'validations'|'level'} sortBy
   * @returns {Array}
   */
  async communityLeaderboard(sortBy = 'royalties') {
    const allUsers = this._getAllUsers();

    const entries = await Promise.all(allUsers.map(async u => {
      const levelInfo = await this.computeLevel(u.userId);
      return {
        userId:               u.userId,
        displayName:          u.displayName,
        level:                levelInfo.level,
        levelTitle:           levelInfo.title,
        validationsCompleted: u.validationsCompleted || 0,
        totalEarned:          u.totalEarned || 0,
        patchesAuthored:      u.patchesAuthored || 0,
      };
    }));

    const sortFns = {
      royalties:   (a, b) => b.totalEarned          - a.totalEarned,
      validations: (a, b) => b.validationsCompleted  - a.validationsCompleted,
      level:       (a, b) => b.level                 - a.level,
    };

    return entries.sort(sortFns[sortBy] || sortFns.royalties);
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  _getUser(userId) {
    if (!this._userStore) return null;
    if (typeof this._userStore.getUser === 'function') return this._userStore.getUser(userId);
    if (this._userStore instanceof Map) return this._userStore.get(userId);
    return null;
  }

  _getAllUsers() {
    if (!this._userStore) return [];
    if (typeof this._userStore.getAllUsers === 'function') return this._userStore.getAllUsers();
    if (this._userStore instanceof Map) return Array.from(this._userStore.values());
    return [];
  }
}

module.exports = { EngagementEngine, LEVEL_THRESHOLDS, BADGE_RULES };
