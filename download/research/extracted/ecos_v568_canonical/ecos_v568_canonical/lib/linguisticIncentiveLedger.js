'use strict';

/**
 * ECOS Linguistic Incentive Ledger — V129
 *
 * Tracks every cross-lingual contribution and computes:
 *   1. LinguisticImpact score per user (used in collaboration leaderboard)
 *   2. LanguagePair economics (which bridges are most valuable)
 *   3. MultilinguistBadge milestones (feeds engagementEngine)
 *
 * Philosophy:
 *   Language is infrastructure. Users who bridge languages are
 *   infrastructure providers — they should be compensated like validators.
 *
 * Integration points:
 *   → languageBridge.js   — source of cross-lingual events
 *   → collaborationEngine — receives score deltas
 *   → engagementEngine    — receives badge triggers
 *   → creditSystem        — receives bonus credits (caller wires this)
 */

const crypto = require('node:crypto');

// ─── BADGE THRESHOLDS ─────────────────────────────────────────────────────────

const MULTILINGUIST_BADGES = Object.freeze([
  { id: 'first_bridge',   threshold: 1,    label: 'First Bridge',      description: 'Completed first cross-lingual session' },
  { id: 'bridge_5',       threshold: 5,    label: 'Bridge Builder',    description: '5 cross-lingual sessions' },
  { id: 'bridge_25',      threshold: 25,   label: 'Polyglot Network',  description: '25 cross-lingual sessions' },
  { id: 'bridge_100',     threshold: 100,  label: 'Language Sovereign', description: '100+ cross-lingual sessions; top-tier contributor' },
  { id: 'trilingual',     threshold: 0,    label: 'Trilingual Hub',    description: 'Bridged 3+ different language pairs', special: true },
  { id: 'rare_language',  threshold: 0,    label: 'Rare Tongue',       description: 'Bridged a rare language (Swahili, Ukrainian, Persian, etc.)', special: true },
]);

const RARE_LANGUAGES = new Set(['sw', 'uk', 'fa', 'hi', 'id', 'tr', 'pl', 'ko']);

// ─── LINGUISTIC CONTRIBUTION ──────────────────────────────────────────────────

class LinguisticContribution {
  constructor({ userId, sessionId, fromLang, toLang, messageCount, bonusMicro }) {
    this.contribId   = 'lc::' + crypto.randomBytes(6).toString('hex');
    this.userId      = userId;
    this.sessionId   = sessionId;
    this.fromLang    = fromLang;
    this.toLang      = toLang;
    this.pairKey     = [fromLang, toLang].sort().join(':');
    this.messageCount = messageCount;
    this.bonusMicro  = bonusMicro;    // BigInt
    this.impact      = messageCount * 10;   // base impact score units
    this.ts          = new Date().toISOString();
  }
}

// ─── USER LINGUISTIC PROFILE (incentive layer) ─────────────────────────────────

class UserLinguisticStats {
  constructor(userId) {
    this.userId         = userId;
    this.contributions  = [];
    this.totalBridged   = 0;          // total messages bridged
    this.totalSessions  = 0;          // total cross-lingual sessions
    this.pairsUsed      = new Set();  // language pair keys
    this.langsUsed      = new Set();  // individual languages touched
    this.impactScore    = 0;
    this.badges         = [];
    this.totalBonusMicro = BigInt(0);
  }

  addContribution(contrib) {
    this.contributions.push(contrib);
    this.totalBridged   += contrib.messageCount;
    this.totalSessions  += 1;
    this.pairsUsed.add(contrib.pairKey);
    this.langsUsed.add(contrib.fromLang);
    this.langsUsed.add(contrib.toLang);
    this.impactScore    += contrib.impact;
    this.totalBonusMicro += contrib.bonusMicro;
    this._checkBadges();
  }

  _checkBadges() {
    // Threshold badges (session count)
    for (const badge of MULTILINGUIST_BADGES.filter(b => !b.special)) {
      if (this.totalSessions >= badge.threshold && !this.badges.includes(badge.id)) {
        this.badges.push(badge.id);
      }
    }
    // Trilingual
    if (this.pairsUsed.size >= 3 && !this.badges.includes('trilingual')) {
      this.badges.push('trilingual');
    }
    // Rare language
    const usedRare = [...this.langsUsed].some(l => RARE_LANGUAGES.has(l));
    if (usedRare && !this.badges.includes('rare_language')) {
      this.badges.push('rare_language');
    }
  }

  toJSON() {
    return {
      userId:          this.userId,
      totalSessions:   this.totalSessions,
      totalBridged:    this.totalBridged,
      pairsUsed:       [...this.pairsUsed],
      langsUsed:       [...this.langsUsed],
      impactScore:     this.impactScore,
      badges:          this.badges,
      totalBonusMicro: this.totalBonusMicro.toString(),
    };
  }
}

// ─── LANGUAGE PAIR ANALYTICS ──────────────────────────────────────────────────

class LanguagePairAnalytics {
  constructor() {
    this._pairs = new Map();   // pairKey → { count, messages, users }
  }

  record({ pairKey, messageCount, userId }) {
    if (!this._pairs.has(pairKey)) {
      this._pairs.set(pairKey, { pairKey, count: 0, messages: 0, users: new Set() });
    }
    const entry = this._pairs.get(pairKey);
    entry.count++;
    entry.messages += messageCount;
    entry.users.add(userId);
  }

  topPairs(limit = 10) {
    return [...this._pairs.values()]
      .sort((a, b) => b.messages - a.messages)
      .slice(0, limit)
      .map(e => ({ ...e, users: e.users.size }));
  }

  pairStats(pairKey) {
    const e = this._pairs.get(pairKey);
    if (!e) return null;
    return { ...e, users: e.users.size };
  }
}

// ─── LINGUISTIC INCENTIVE LEDGER ──────────────────────────────────────────────

class LinguisticIncentiveLedger {
  constructor() {
    this._userStats   = new Map();      // userId → UserLinguisticStats
    this._pairAnalytics = new LanguagePairAnalytics();
    this._contributions = [];
    this._newBadges   = [];             // queue of { userId, badge } for engagementEngine
  }

  _ensureUser(userId) {
    if (!this._userStats.has(userId)) {
      this._userStats.set(userId, new UserLinguisticStats(userId));
    }
    return this._userStats.get(userId);
  }

  /**
   * Record a completed language bridge session.
   * Returns contributions created and any new badges unlocked.
   */
  recordBridge({ userId, sessionId, fromLang, toLang, messageCount, bonusMicro = BigInt(0) }) {
    const userStats = this._ensureUser(userId);
    const prevBadges = [...userStats.badges];

    const contrib = new LinguisticContribution({
      userId, sessionId, fromLang, toLang, messageCount, bonusMicro,
    });

    userStats.addContribution(contrib);
    this._contributions.push(contrib);
    this._pairAnalytics.record({ pairKey: contrib.pairKey, messageCount, userId });

    // Detect new badges
    const newBadges = userStats.badges.filter(b => !prevBadges.includes(b));
    for (const badge of newBadges) {
      this._newBadges.push({ userId, badge, ts: contrib.ts });
    }

    return { contrib, newBadges };
  }

  // ── Leaderboard ────────────────────────────────────────────────────────────

  leaderboard(limit = 20) {
    return [...this._userStats.values()]
      .sort((a, b) => b.impactScore - a.impactScore)
      .slice(0, limit)
      .map(s => s.toJSON());
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  globalStats() {
    const users = [...this._userStats.values()];
    const totalBridged = users.reduce((a, u) => a + u.totalBridged, 0);
    const totalBonus   = users.reduce((a, u) => a + u.totalBonusMicro, BigInt(0));
    return {
      totalUsers:         users.length,
      totalContributions: this._contributions.length,
      totalBridged,
      totalBonusMicro:    totalBonus.toString(),
      topPairs:           this._pairAnalytics.topPairs(5),
      badgesAwarded:      this._newBadges.length,
    };
  }

  userStats(userId) {
    const s = this._userStats.get(userId);
    return s ? s.toJSON() : null;
  }

  pendingBadges() {
    const q = [...this._newBadges];
    this._newBadges.length = 0;    // drain queue
    return q;
  }

  pairStats(langA, langB) {
    const key = [langA, langB].sort().join(':');
    return this._pairAnalytics.pairStats(key) || { pairKey: key, count: 0, messages: 0, users: 0 };
  }
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

const linguisticIncentiveLedger = new LinguisticIncentiveLedger();

module.exports = {
  LinguisticContribution,
  UserLinguisticStats,
  LanguagePairAnalytics,
  LinguisticIncentiveLedger,
  linguisticIncentiveLedger,    // singleton
  MULTILINGUIST_BADGES,
  RARE_LANGUAGES,
};
