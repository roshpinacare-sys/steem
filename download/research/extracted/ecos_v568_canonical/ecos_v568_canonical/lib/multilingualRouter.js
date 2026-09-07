'use strict';

/**
 * ECOS Multilingual Collaboration Router — V129
 *
 * The smart layer between users and collaboration sessions.
 * Detects that two users speak different languages → auto-wraps
 * their GlobalBridgeNetwork session with a LanguageBridgeSession.
 *
 * Flow:
 *   1. User A (Hebrew) wants to collaborate with User B (Arabic)
 *   2. Router detects language mismatch via LanguageBridgeNode profiles
 *   3. Router starts BOTH a bridge session (V128) AND a language bridge session (V129)
 *   4. All messages are auto-translated; contributions earn linguistic rewards
 *   5. Session close computes both collaboration score AND linguistic bonus
 *
 * Also exposes:
 *   - LanguageMatchmaker: suggest collaborators by language affinity
 *   - CrossLingualValidator: flag validators who can bridge specific language pairs
 */

const crypto = require('node:crypto');
const { languageBridgeNode, SUPPORTED_LANGUAGES } = require('./languageBridge');
const { linguisticIncentiveLedger, LANGUAGE_BRIDGE_BONUS_MICRO } = require('./linguisticIncentiveLedger');

// ─── ROUTING DECISION ─────────────────────────────────────────────────────────

const ROUTING_MODES = Object.freeze({
  SAME_LANGUAGE:   'same_language',     // no translation needed; pass-through
  AUTO_BRIDGE:     'auto_bridge',       // different languages; auto-translate
  VALIDATOR_RELAY: 'validator_relay',   // rare pair; route via human validator
});

class RoutingDecision {
  constructor({ userA, userB, langA, langB, mode, sessionId }) {
    this.decisionId = 'rd::' + crypto.randomBytes(6).toString('hex');
    this.userA      = userA;
    this.userB      = userB;
    this.langA      = langA;
    this.langB      = langB;
    this.mode       = mode;
    this.sessionId  = sessionId;
    this.ts         = new Date().toISOString();
  }
}

// ─── CROSS-LINGUAL VALIDATOR REGISTRY ────────────────────────────────────────

class CrossLingualValidatorRegistry {
  /**
   * Tracks which validators can relay between specific language pairs.
   * A validator earns 'cross_lingual_validator' status after bridging
   * 10+ sessions in a given pair.
   */
  constructor() {
    this._validators = new Map();   // validatorId → { pairs: Map<pairKey, count> }
  }

  recordBridge(validatorId, langA, langB) {
    if (!this._validators.has(validatorId)) {
      this._validators.set(validatorId, { validatorId, pairs: new Map() });
    }
    const v = this._validators.get(validatorId);
    const key = [langA, langB].sort().join(':');
    v.pairs.set(key, (v.pairs.get(key) || 0) + 1);
  }

  findValidators(langA, langB) {
    const key = [langA, langB].sort().join(':');
    return [...this._validators.entries()]
      .filter(([, v]) => (v.pairs.get(key) || 0) >= 1)
      .map(([id, v]) => ({ validatorId: id, bridgeCount: v.pairs.get(key) || 0 }))
      .sort((a, b) => b.bridgeCount - a.bridgeCount);
  }

  isCertified(validatorId, langA, langB) {
    const key = [langA, langB].sort().join(':');
    const v   = this._validators.get(validatorId);
    return v ? (v.pairs.get(key) || 0) >= 10 : false;
  }

  stats() {
    return {
      totalValidators: this._validators.size,
      registrations: [...this._validators.values()].map(v => ({
        validatorId: v.validatorId,
        pairCount:   v.pairs.size,
        totalBridges: [...v.pairs.values()].reduce((a, b) => a + b, 0),
      })),
    };
  }
}

// ─── LANGUAGE MATCHMAKER ──────────────────────────────────────────────────────

class LanguageMatchmaker {
  /**
   * Given a user, find potential collaborators who:
   *   a) speak a different (and compatible) language
   *   b) have existing bridge experience with that language
   *
   * Score = (shared language overlap) + (past bridge familiarity) + (trust bond)
   */
  constructor({ profiles, bonds = new Map() }) {
    this._profiles = profiles;   // Map<userId, LanguageProfile>
    this._bonds    = bonds;      // Map<pairKey, trustScore>
  }

  suggest({ userId, limit = 5 }) {
    const me = this._profiles.get(userId);
    if (!me) return [];

    const candidates = [];
    for (const [uid, prof] of this._profiles) {
      if (uid === userId) continue;

      // Compute compatibility
      const speaks     = new Set([prof.primary, ...prof.secondary]);
      const myLanguages = new Set([me.primary, ...me.secondary]);
      const overlap    = [...speaks].filter(l => myLanguages.has(l)).length;
      const different  = prof.primary !== me.primary;    // at least one language differs

      if (!different) continue;    // same primary language — not a bridge opportunity

      const bondKey   = [userId, uid].sort().join('::');
      const bondScore = this._bonds.get(bondKey) || 0;

      candidates.push({
        userId:      uid,
        primaryLang: prof.primary,
        langName:    SUPPORTED_LANGUAGES[prof.primary]?.name || prof.primary,
        overlap,
        bondScore,
        score: overlap * 10 + bondScore + (different ? 5 : 0),
      });
    }

    return candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

// ─── MULTILINGUAL COLLABORATION ROUTER ────────────────────────────────────────

class MultilingualCollaborationRouter {
  constructor() {
    this._decisions  = [];
    this._validatorRegistry = new CrossLingualValidatorRegistry();
  }

  /**
   * Main entry point: decide how two users should collaborate given their languages.
   * Creates or joins a language bridge session automatically.
   */
  async route({ userA, userB, topic = '', preferredMode = 'auto' }) {
    // Ensure profiles exist
    let profileA = languageBridgeNode.getProfile(userA);
    let profileB = languageBridgeNode.getProfile(userB);

    if (!profileA) profileA = languageBridgeNode.setProfile(userA, { primary: 'en' });
    if (!profileB) profileB = languageBridgeNode.setProfile(userB, { primary: 'en' });

    const langA = profileA.primary;
    const langB = profileB.primary;

    let mode;
    if (langA === langB) {
      mode = ROUTING_MODES.SAME_LANGUAGE;
    } else {
      mode = ROUTING_MODES.AUTO_BRIDGE;
    }

    // Start language bridge session
    const session = languageBridgeNode.startSession({
      participantIds: [userA, userB],
    });

    const decision = new RoutingDecision({
      userA, userB, langA, langB, mode, sessionId: session.sessionId,
    });
    this._decisions.push(decision);

    return {
      decision,
      session,
      langA,
      langB,
      bridgeRequired: mode === ROUTING_MODES.AUTO_BRIDGE,
      topic,
    };
  }

  /**
   * Close a routed session, compute rewards, update incentive ledger.
   */
  async closeRoute({ sessionId, validatorId = null }) {
    const { summary, reward } = await languageBridgeNode.closeSession(sessionId, validatorId);

    // Update linguistic incentive ledger for all participants
    const ledgerEntries = [];
    for (const p of summary.participants) {
      if (summary.bridgedCount > 0) {
        const langs = summary.languagesUsed;
        const fromLang = langs[0] || 'en';
        const toLang   = langs[1] || 'en';
        const entry = linguisticIncentiveLedger.recordBridge({
          userId:       p.userId,
          sessionId:    summary.sessionId,
          fromLang,
          toLang,
          messageCount: summary.bridgedCount,
          bonusMicro:   reward ? reward.bonusMicro / BigInt(summary.participants.length) : BigInt(0),
        });
        ledgerEntries.push(entry);

        // Update validator registry
        if (validatorId) {
          this._validatorRegistry.recordBridge(validatorId, fromLang, toLang);
        }
      }
    }

    // Drain any new badges for engagementEngine
    const newBadges = linguisticIncentiveLedger.pendingBadges();

    return { summary, reward, ledgerEntries, newBadges };
  }

  // ── Matchmaking ────────────────────────────────────────────────────────────

  suggestCollaborators({ userId, limit = 5 }) {
    const profiles = languageBridgeNode._profiles;
    const matchmaker = new LanguageMatchmaker({ profiles });
    return matchmaker.suggest({ userId, limit });
  }

  // ── Cross-lingual validators ───────────────────────────────────────────────

  findValidatorsForPair(langA, langB) {
    return this._validatorRegistry.findValidators(langA, langB);
  }

  isValidatorCertified(validatorId, langA, langB) {
    return this._validatorRegistry.isCertified(validatorId, langA, langB);
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  stats() {
    return {
      totalDecisions:  this._decisions.length,
      byMode:          this._decisions.reduce((acc, d) => {
        acc[d.mode] = (acc[d.mode] || 0) + 1;
        return acc;
      }, {}),
      validatorRegistry: this._validatorRegistry.stats(),
      incentiveLedger:   linguisticIncentiveLedger.globalStats(),
    };
  }

  decisions(limit = 20) {
    return this._decisions.slice(-limit).reverse();
  }
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

const multilingualRouter = new MultilingualCollaborationRouter();

module.exports = {
  ROUTING_MODES,
  RoutingDecision,
  CrossLingualValidatorRegistry,
  LanguageMatchmaker,
  MultilingualCollaborationRouter,
  multilingualRouter,           // singleton
};
