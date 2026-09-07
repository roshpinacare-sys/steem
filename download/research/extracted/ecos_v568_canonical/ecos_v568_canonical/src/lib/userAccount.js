'use strict';

/**
 * UserAccountService — Onboarding + identity layer for ECOS V111.
 *
 * Extends V110 /api/v1/users with:
 *  - signup with free-tier credits and referral system
 *  - profile with level, badges, streak
 *  - activity recording for gamification
 *
 * V111 — Sovereign Economy
 */

const crypto = require('crypto');

class UserAccountService {
  constructor({ ledger, creditSystem, auditLog, engagementEngine } = {}) {
    if (!ledger)       throw new Error('UserAccountService requires a ledger');
    if (!creditSystem) throw new Error('UserAccountService requires a creditSystem');
    this._ledger           = ledger;
    this._creditSystem     = creditSystem;
    this._auditLog         = auditLog || null;
    this._engagement       = engagementEngine || null;

    // In-memory store (mirrors DB pattern from V110)
    this._users            = new Map(); // userId → user record
    this._emailIndex       = new Map(); // email → userId
    this._referralIndex    = new Map(); // referralCode → userId
    this._referralPending  = new Map(); // userId → referrerId (waiting for first action)

    this._pricing = this._loadPricing();
    // [V135-RH-03] Rank system — set externally after init (avoids circular dep)
    this._rankSystem = null;
  }

  _loadPricing() {
    try { return require('../config/pricing.json'); } catch (_) {
      return { freeTierGrant: 100.0, referralBonus: 25.0 };
    }
  }

  _generateReferralCode() {
    // 8-char uppercase alphanumeric
    return crypto.randomBytes(6).toString('base64url').toUpperCase().slice(0, 8);
  }

  /**
   * Sign up a new user. Grants free-tier credits. Applies referral if valid.
   * @returns {{ userId, accountId, credits, referralCode }}
   */
  async signup({ email, displayName, referralCode = null } = {}) {
    if (!email) throw new Error('signup: email is required');
    if (!displayName) throw new Error('signup: displayName is required');

    const normalEmail = email.trim().toLowerCase();
    if (this._emailIndex.has(normalEmail)) {
      throw new Error(`signup: email already registered: ${email}`);
    }

    const userId      = `user-${crypto.randomUUID()}`;
    const accountId   = `account-${userId}`;
    const myReferral  = this._generateReferralCode();

    const user = {
      userId,
      accountId,
      email:                normalEmail,
      displayName,
      referralCode:         myReferral,
      joinedAt:             new Date().toISOString(),
      level:                1,
      badges:               [],
      streak:               { current: 0, longest: 0, lastActiveDate: null },
      totalEarned:          0,
      patchesAuthored:      0,
      validationsCompleted: 0,
      activityLog:          [],
    };

    this._users.set(userId, user);
    this._emailIndex.set(normalEmail, userId);
    this._referralIndex.set(myReferral, userId);

    // Grant free-tier credits
    await this._creditSystem.grantFreeTier(accountId, { reason: 'signup' });

    // Record referral if valid (bonus held until first action)
    if (referralCode) {
      const referrerId = this._referralIndex.get(referralCode);
      if (referrerId && referrerId !== userId) {
        this._referralPending.set(userId, referrerId);
      }
    }

    return {
      userId,
      accountId,
      credits:      this._creditSystem.balanceCredits(accountId),
      referralCode: myReferral,
    };
  }

  /**
   * Get full user profile.
   */
  async getProfile(userId) {
    const user = this._users.get(userId);
    if (!user) throw new Error(`getProfile: user not found: ${userId}`);

    const credits = this._creditSystem.balanceCredits(user.accountId);
    const level   = this._engagement
      ? (await this._engagement.computeLevel(userId))
      : { level: user.level, title: 'Observer', progressToNext: 0 };
    const badges  = this._engagement
      ? (await this._engagement.checkBadges(userId))
      : user.badges;

    return {
      userId:               user.userId,
      displayName:          user.displayName,
      credits,
      level:                level.level,
      levelTitle:           level.title,
      progressToNext:       level.progressToNext,
      badges:               badges.length ? badges : user.badges,
      streak:               user.streak,
      totalEarned:          user.totalEarned,
      patchesAuthored:      user.patchesAuthored,
      validationsCompleted: user.validationsCompleted,
      joinedAt:             user.joinedAt,
      referralCode:         user.referralCode,
    };
  }

  /**
   * Record an activity for streaks and levels.
   * Triggers referral bonus if this is the referee's first real action.
   * @param {string} userId
   * @param {string} type 'task' | 'validation' | 'patch' | 'referral'
   */
  async recordActivity(userId, type) {
    const user = this._users.get(userId);
    if (!user) throw new Error(`recordActivity: user not found: ${userId}`);

    user.activityLog.push({ type, timestamp: new Date().toISOString() });

    if (type === 'validation') user.validationsCompleted++;
    if (type === 'patch')      user.patchesAuthored++;

    // Update streak
    if (this._engagement) {
      user.streak = await this._engagement.updateStreak(userId);
    }

    // Referral bonus: unlock after first real action (task or validation)
    if (['task', 'validation'].includes(type) && this._referralPending.has(userId)) {
      const referrerId  = this._referralPending.get(userId);
      const referrer    = this._users.get(referrerId);
      const bonusAmount = this._pricing.referralBonus || 25.0;

      if (referrer) {
        await this._creditSystem.earn(referrer.accountId, bonusAmount, { source: 'referral_bonus', ref: userId });
        await this._creditSystem.earn(user.accountId,    bonusAmount, { source: 'referral_bonus', ref: referrerId });
        referrer.totalEarned += bonusAmount;
        user.totalEarned     += bonusAmount;
      }
      this._referralPending.delete(userId);
      // [V135-RH-03] Fire referral_converted rank event for both parties
      if (this._rankSystem) {
        try {
          this._rankSystem.recordEvent(userId,     'referral_converted', { source: 'userAccount', refId: referrerId });
          this._rankSystem.recordEvent(referrerId, 'referral_converted', { source: 'userAccount', refId: userId });
        } catch (e) { /* non-fatal */ }
      }
    }

    return { ok: true, userId, type, streak: user.streak };
  }

  _getUserByReferral(code) {
    const uid = this._referralIndex.get(code);
    return uid ? this._users.get(uid) : null;
  }

  // ── Engagement helpers (delegated from engagement engine) ─────────────────

  getUser(userId) { return this._users.get(userId); }
  getAllUsers()   { return Array.from(this._users.values()); }
}

module.exports = { UserAccountService };
