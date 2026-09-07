'use strict';

/**
 * ECOS Language Bridge Intelligence — V129
 *
 * P20 — Linguistic Sovereignty
 *
 * Principle: Every user speaks in their language. The system bridges.
 * No user should be penalized economically or collaboratively for
 * not speaking a dominant language.
 *
 * Three systems:
 *
 *   1. LanguageProfile  — detects and stores each user's preferred language(s)
 *   2. BridgeSession    — wraps any collaboration session with transparent translation
 *   3. LinguisticReward — rewards users who contribute multilingual knowledge
 *
 * Economic hook:
 *   - Validators who bridge languages earn a LANGUAGE_BRIDGE_BONUS (default 15 μ¢)
 *   - Sessions that successfully cross a language barrier log a CrossLingual event
 *   - CrossLingual events feed into collaborationEngine for leaderboard credit
 *
 * Design constraints:
 *   - Zero external translation APIs required in MVP; stubs always resolve
 *   - Adapter pattern: real providers (DeepL, Google, local LLM) plug in via LanguageAdapter
 *   - Sacred files are never touched
 */

const crypto = require('node:crypto');

// ─── SUPPORTED LANGUAGES ─────────────────────────────────────────────────────

const SUPPORTED_LANGUAGES = Object.freeze({
  he:    { name: 'Hebrew',     rtl: true,  region: 'il' },
  ar:    { name: 'Arabic',     rtl: true,  region: 'mena' },
  en:    { name: 'English',    rtl: false, region: 'global' },
  es:    { name: 'Spanish',    rtl: false, region: 'latam' },
  fr:    { name: 'French',     rtl: false, region: 'eu' },
  de:    { name: 'German',     rtl: false, region: 'eu' },
  zh:    { name: 'Chinese',    rtl: false, region: 'apac' },
  ja:    { name: 'Japanese',   rtl: false, region: 'apac' },
  pt:    { name: 'Portuguese', rtl: false, region: 'latam' },
  ru:    { name: 'Russian',    rtl: false, region: 'eu' },
  hi:    { name: 'Hindi',      rtl: false, region: 'apac' },
  tr:    { name: 'Turkish',    rtl: false, region: 'mena' },
  ko:    { name: 'Korean',     rtl: false, region: 'apac' },
  it:    { name: 'Italian',    rtl: false, region: 'eu' },
  nl:    { name: 'Dutch',      rtl: false, region: 'eu' },
  pl:    { name: 'Polish',     rtl: false, region: 'eu' },
  uk:    { name: 'Ukrainian',  rtl: false, region: 'eu' },
  fa:    { name: 'Persian',    rtl: true,  region: 'mena' },
  id:    { name: 'Indonesian', rtl: false, region: 'apac' },
  sw:    { name: 'Swahili',    rtl: false, region: 'africa' },
});

// ─── LANGUAGE ADAPTER (pluggable) ────────────────────────────────────────────

class LanguageAdapter {
  /**
   * Override translate() with a real provider (DeepL, Google, local LLM).
   * Default stub returns the text with a [translated:{from}→{to}] tag —
   * this ensures the system is testable without external APIs.
   */
  async translate({ text, fromLang, toLang, context = {} }) {
    if (fromLang === toLang) return { text, translated: false, provider: 'passthrough' };
    // Stub — replace with real adapter in production:
    return {
      text:       `[${fromLang}→${toLang}] ${text}`,
      translated: true,
      provider:   'stub',
      fromLang,
      toLang,
    };
  }

  async detect(text) {
    // Stub: detect Hebrew/Arabic/Chinese heuristically, else default to 'en'
    if (/[\u0590-\u05FF]/.test(text)) return { lang: 'he', confidence: 0.95 };
    if (/[\u0600-\u06FF]/.test(text)) return { lang: 'ar', confidence: 0.95 };
    if (/[\u4E00-\u9FFF]/.test(text)) return { lang: 'zh', confidence: 0.90 };
    if (/[\u3040-\u30FF]/.test(text)) return { lang: 'ja', confidence: 0.90 };
    if (/[\uAC00-\uD7AF]/.test(text)) return { lang: 'ko', confidence: 0.90 };
    if (/[\u0400-\u04FF]/.test(text)) return { lang: 'ru', confidence: 0.85 };
    return { lang: 'en', confidence: 0.70 };
  }
}

// ─── LANGUAGE PROFILE ────────────────────────────────────────────────────────

class LanguageProfile {
  /**
   * Stores a user's language preferences and interaction history.
   * A user may have multiple languages; the first is primary.
   */
  constructor(userId, { primary = 'en', secondary = [] } = {}) {
    this.userId      = userId;
    this.primary     = primary;
    this.secondary   = secondary;                  // array of lang codes
    this.history     = [];                         // { text, detected, ts }
    this.bridgeCount = 0;                          // times this user was bridged
    this.createdAt   = new Date().toISOString();
  }

  addDetection({ text, detected, confidence }) {
    this.history.push({ text: text.slice(0, 50), detected, confidence, ts: new Date().toISOString() });
    // Auto-promote high-confidence detections
    if (confidence >= 0.9 && detected !== this.primary && !this.secondary.includes(detected)) {
      this.secondary.push(detected);
    }
  }

  speaks(lang) {
    return this.primary === lang || this.secondary.includes(lang);
  }

  toJSON() {
    return {
      userId:      this.userId,
      primary:     this.primary,
      secondary:   this.secondary,
      bridgeCount: this.bridgeCount,
      createdAt:   this.createdAt,
    };
  }
}

// ─── BRIDGE MESSAGE ──────────────────────────────────────────────────────────

class BridgeMessage {
  constructor({ fromUser, content, fromLang, toLang, translatedContent, provider }) {
    this.messageId         = 'msg::' + crypto.randomBytes(6).toString('hex');
    this.fromUser          = fromUser;
    this.originalContent   = content;
    this.fromLang          = fromLang;
    this.toLang            = toLang;
    this.translatedContent = translatedContent;
    this.provider          = provider;
    this.crossLingual      = (fromLang !== toLang);
    this.ts                = new Date().toISOString();
  }
}

// ─── LANGUAGE BRIDGE SESSION ─────────────────────────────────────────────────

class LanguageBridgeSession {
  /**
   * Wraps a collaboration session with automatic translation.
   * Each participant speaks in their language; the bridge translates
   * every message to all other participants' preferred languages.
   */
  constructor({ sessionId, participants, adapter = new LanguageAdapter() }) {
    this.sessionId    = sessionId || ('lbs::' + crypto.randomBytes(8).toString('hex'));
    this.participants = new Map();  // userId → LanguageProfile
    this.messages     = [];
    this.adapter      = adapter;
    this.bridgedCount = 0;         // messages that crossed language boundary
    this.createdAt    = new Date().toISOString();
    this.status       = 'active';

    for (const p of participants) {
      this.participants.set(p.userId, p);
    }
  }

  /**
   * Send a message; it is translated for each recipient who speaks a different language.
   * Returns an array of BridgeMessages (one per target language needed).
   */
  async sendMessage({ fromUserId, content, forceLang = null }) {
    const profile = this.participants.get(fromUserId);
    if (!profile) throw new Error(`User ${fromUserId} not in this session`);

    // Detect language if not forced
    const detected  = forceLang || (await this.adapter.detect(content)).lang;
    const fromLang  = detected;

    // Collect target languages (unique, excluding sender's own)
    const targetLangs = new Set();
    for (const [uid, prof] of this.participants) {
      if (uid !== fromUserId) targetLangs.add(prof.primary);
    }

    const messages = [];

    for (const toLang of targetLangs) {
      const result = await this.adapter.translate({ text: content, fromLang, toLang });
      const msg = new BridgeMessage({
        fromUser:          fromUserId,
        content,
        fromLang,
        toLang,
        translatedContent: result.text,
        provider:          result.provider,
      });
      messages.push(msg);
      if (msg.crossLingual) this.bridgedCount++;
    }

    this.messages.push(...messages);
    return messages;
  }

  summary() {
    return {
      sessionId:     this.sessionId,
      participants:  [...this.participants.values()].map(p => p.toJSON()),
      messageCount:  this.messages.length,
      bridgedCount:  this.bridgedCount,
      languagesUsed: [...new Set(this.messages.map(m => m.fromLang))],
      status:        this.status,
    };
  }

  close() {
    this.status = 'closed';
    return this.summary();
  }
}

// ─── LINGUISTIC REWARD ENGINE ────────────────────────────────────────────────

const LANGUAGE_BRIDGE_BONUS_MICRO = BigInt(15);   // 15 μ¢ per successful cross-lingual bridge
const MULTILINGUAL_MULTIPLIER     = 1.2;           // 20% score bonus in collaboration leaderboard

class LinguisticRewardEngine {
  /**
   * Called whenever a cross-lingual bridge session is completed.
   * Awards bonuses and updates leaderboard contributions.
   *
   * The actual credit ledger write is done via creditSystem.earn() which
   * the caller must pass in to keep this module dependency-free.
   *
   * Returns a reward record for audit logging.
   */
  computeReward({ session, validatorId }) {
    if (!session || session.bridgedCount === 0) {
      return { awarded: false, reason: 'no cross-lingual messages' };
    }

    const bonusMicro  = LANGUAGE_BRIDGE_BONUS_MICRO * BigInt(session.bridgedCount);
    const scoreBonus  = Math.round(session.bridgedCount * MULTILINGUAL_MULTIPLIER * 5);
    const languagesUsed = session.summary().languagesUsed;

    return {
      awarded:      true,
      validatorId,
      sessionId:    session.sessionId,
      bridgedCount: session.bridgedCount,
      bonusMicro,                  // BigInt — pass to creditSystem.earn()
      scoreBonus,                  // add to collaborationEngine score
      languagesUsed,
      rewardId:     'lrw::' + crypto.randomBytes(6).toString('hex'),
      ts:           new Date().toISOString(),
    };
  }
}

// ─── LANGUAGE BRIDGE NODE (singleton) ────────────────────────────────────────

class LanguageBridgeNode {
  constructor() {
    this._profiles = new Map();     // userId → LanguageProfile
    this._sessions = new Map();     // sessionId → LanguageBridgeSession
    this._rewards  = [];
    this._adapter  = new LanguageAdapter();
    this._rewardEngine = new LinguisticRewardEngine();
  }

  // ── Profile management ────────────────────────────────────────────────────

  setProfile(userId, { primary, secondary = [] } = {}) {
    if (!SUPPORTED_LANGUAGES[primary]) throw new Error(`Unsupported language: ${primary}`);
    const profile = new LanguageProfile(userId, { primary, secondary });
    this._profiles.set(userId, profile);
    return profile;
  }

  getProfile(userId) {
    return this._profiles.get(userId) || null;
  }

  async detectAndUpdateProfile(userId, text) {
    const detection = await this._adapter.detect(text);
    let profile = this._profiles.get(userId);
    if (!profile) {
      profile = new LanguageProfile(userId, { primary: detection.lang });
      this._profiles.set(userId, profile);
    }
    profile.addDetection({ text, detected: detection.lang, confidence: detection.confidence });
    return { profile, detection };
  }

  // ── Session management ────────────────────────────────────────────────────

  startSession({ participantIds, adapter = null }) {
    const participants = participantIds.map(uid => {
      return this._profiles.get(uid) || new LanguageProfile(uid, { primary: 'en' });
    });

    const session = new LanguageBridgeSession({
      participants,
      adapter: adapter || this._adapter,
    });

    this._sessions.set(session.sessionId, session);
    return session;
  }

  getSession(sessionId) {
    return this._sessions.get(sessionId) || null;
  }

  async sendMessage({ sessionId, fromUserId, content, forceLang = null }) {
    const session = this._sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    return session.sendMessage({ fromUserId, content, forceLang });
  }

  async closeSession(sessionId, validatorId = null) {
    const session = this._sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    const summary = session.close();

    // Compute reward if a validator closed
    let reward = null;
    if (validatorId && summary.bridgedCount > 0) {
      reward = this._rewardEngine.computeReward({ session, validatorId });
      this._rewards.push(reward);
      // Increment bridge count on all participant profiles
      for (const [uid] of session.participants) {
        const prof = this._profiles.get(uid);
        if (prof) prof.bridgeCount += summary.bridgedCount;
      }
    }

    return { summary, reward };
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  stats() {
    const sessions  = [...this._sessions.values()];
    const active    = sessions.filter(s => s.status === 'active').length;
    const closed    = sessions.filter(s => s.status === 'closed').length;
    const totalBridged = sessions.reduce((acc, s) => acc + s.bridgedCount, 0);
    const langFreq  = {};
    for (const [, prof] of this._profiles) {
      langFreq[prof.primary] = (langFreq[prof.primary] || 0) + 1;
    }

    return {
      profiles:     this._profiles.size,
      sessions:     { total: sessions.length, active, closed },
      totalBridged,
      rewardsPaid:  this._rewards.length,
      topLanguages: Object.entries(langFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([lang, count]) => ({ lang, name: SUPPORTED_LANGUAGES[lang]?.name || lang, count })),
    };
  }

  listSessions(userId) {
    return [...this._sessions.values()]
      .filter(s => s.participants.has(userId))
      .map(s => s.summary());
  }

  rewards(limit = 50) {
    return this._rewards.slice(-limit).reverse();
  }
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

const languageBridgeNode = new LanguageBridgeNode();

module.exports = {
  SUPPORTED_LANGUAGES,
  LanguageAdapter,
  LanguageProfile,
  BridgeMessage,
  LanguageBridgeSession,
  LinguisticRewardEngine,
  LanguageBridgeNode,
  languageBridgeNode,           // singleton
  LANGUAGE_BRIDGE_BONUS_MICRO,
  MULTILINGUAL_MULTIPLIER,
};
