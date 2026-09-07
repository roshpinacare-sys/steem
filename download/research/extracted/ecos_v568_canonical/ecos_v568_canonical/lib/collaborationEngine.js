'use strict';

/**
 * ECOS Collaboration Engine — V128
 * 
 * P19 — Constructive Collaboration
 * 
 * Manages the lifecycle of constructive (non-destructive) collaboration between
 * users across the global ECOS network. Distinguishes between:
 * 
 *   CONSTRUCTIVE — adds value for both parties:
 *     + peer-review (validator reviews another validator's work)
 *     + knowledge-exchange (domain expertise shared)
 *     + co-validation (two validators jointly resolve a high-stakes mission)
 *     + template-collaboration (joint authorship of agent templates)
 *     + mentorship (senior validator guides junior)
 * 
 *   DESTRUCTIVE — signals to block / flag:
 *     - sybil rings (users gaming golden-task rewards together)
 *     - collusion (validators coordinating to approve fraudulent missions)
 *     - review-bombing (coordinated negative reviews of competitors)
 * 
 * The engine rewards constructive patterns and surfaces destructive ones
 * to the goldenTaskEngine and sybilResistance systems.
 */

const crypto = require('node:crypto');

const COLLABORATION_TYPES = Object.freeze({
  PEER_REVIEW:           'peer_review',
  KNOWLEDGE_EXCHANGE:    'knowledge_exchange',
  CO_VALIDATION:         'co_validation',
  TEMPLATE_COLLAB:       'template_collab',
  MENTORSHIP:            'mentorship',
});

const DESTRUCTIVE_SIGNALS = Object.freeze({
  SYBIL_RING:            'sybil_ring',
  COLLUSION:             'collusion',
  REVIEW_BOMBING:        'review_bombing',
  VOTE_MANIPULATION:     'vote_manipulation',
});

// ─── COLLABORATION EVENT ──────────────────────────────────────────────────────

class CollaborationEvent {
  constructor({ type, participants, outcome, context = {} }) {
    this.eventId      = 'cev::' + crypto.randomBytes(6).toString('hex');
    this.type         = type;
    this.participants = participants;   // [userId, ...]
    this.outcome      = outcome;        // 'constructive' | 'destructive' | 'neutral'
    this.context      = context;
    this.ts           = new Date().toISOString();
  }
}

// ─── COLLABORATION ENGINE ────────────────────────────────────────────────────

class CollaborationEngine {
  constructor() {
    this._events      = [];
    this._userStats   = new Map();   // userId → { constructive, destructive, signals }
    this._pairHistory = new Map();   // `${a}::${b}` → CollaborationEvent[]
  }

  _userKey(a, b) { return [a, b].sort().join('::'); }

  _ensureUser(userId) {
    if (!this._userStats.has(userId)) {
      this._userStats.set(userId, {
        userId,
        constructive: 0,
        destructive: 0,
        signals: [],
        score: 50,   // neutral start
      });
    }
    return this._userStats.get(userId);
  }

  /**
   * Record a collaboration event.
   * Returns updated scores for all participants.
   */
  record({ type, participants, outcome, context = {} }) {
    if (!Object.values(COLLABORATION_TYPES).includes(type)) {
      throw new Error(`Unknown collaboration type: ${type}`);
    }

    const event = new CollaborationEvent({ type, participants, outcome, context });
    this._events.push(event);

    // Pair tracking
    if (participants.length === 2) {
      const key = this._userKey(...participants);
      if (!this._pairHistory.has(key)) this._pairHistory.set(key, []);
      this._pairHistory.get(key).push(event);
    }

    // Score updates
    const updates = {};
    for (const userId of participants) {
      const user = this._ensureUser(userId);
      if (outcome === 'constructive') {
        user.constructive++;
        user.score = Math.min(100, user.score + 4);
      } else if (outcome === 'destructive') {
        user.destructive++;
        user.score = Math.max(0, user.score - 10);
      }
      updates[userId] = { score: user.score, constructive: user.constructive, destructive: user.destructive };
    }

    return { event, updates };
  }

  /**
   * Flag a destructive signal on one or more users.
   * Surfaces to sybilResistance for further action.
   */
  flagDestructive(userIds, signal, evidence = '') {
    if (!Object.values(DESTRUCTIVE_SIGNALS).includes(signal)) {
      throw new Error(`Unknown destructive signal: ${signal}`);
    }
    const flaggedAt = new Date().toISOString();
    for (const userId of userIds) {
      const user = this._ensureUser(userId);
      user.signals.push({ signal, evidence, flaggedAt });
      user.score = Math.max(0, user.score - 20);
    }
    return { flagged: userIds, signal, flaggedAt };
  }

  /**
   * Returns whether a collaboration pair looks healthy or suspicious.
   * Uses recency + diversity heuristic:
   *   - Healthy: varied types, neutral/constructive outcomes
   *   - Suspicious: always same type, high frequency, always same outcome
   */
  assessPair(userA, userB) {
    const key = this._userKey(userA, userB);
    const history = this._pairHistory.get(key) || [];
    if (history.length < 3) return { status: 'new', risk: 'low', history: history.length };

    const types = new Set(history.map(e => e.type));
    const destructiveCount = history.filter(e => e.outcome === 'destructive').length;
    const destructiveRatio = destructiveCount / history.length;

    const risk =
      destructiveRatio > 0.4 ? 'high' :
      destructiveRatio > 0.2 ? 'medium' : 'low';

    return {
      status: types.size >= 2 ? 'diverse' : 'narrow',
      risk,
      history: history.length,
      types: [...types],
      destructiveRatio: Math.round(destructiveRatio * 100) / 100,
    };
  }

  getUserStats(userId) {
    return this._ensureUser(userId);
  }

  /**
   * Global leaderboard of most constructive collaborators.
   */
  leaderboard(limit = 20) {
    return [...this._userStats.values()]
      .sort((a, b) => b.constructive - a.constructive || b.score - a.score)
      .slice(0, limit)
      .map(u => ({
        userId:       u.userId,
        score:        u.score,
        constructive: u.constructive,
        destructive:  u.destructive,
      }));
  }

  stats() {
    const users    = [...this._userStats.values()];
    return {
      totalEvents:       this._events.length,
      totalUsers:        users.length,
      constructiveEvents: this._events.filter(e => e.outcome === 'constructive').length,
      destructiveEvents:  this._events.filter(e => e.outcome === 'destructive').length,
      flaggedUsers:       users.filter(u => u.signals.length > 0).length,
      avgScore:           users.length
        ? Math.round(users.reduce((s, u) => s + u.score, 0) / users.length)
        : 0,
    };
  }
}

// ─── SINGLETON ───────────────────────────────────────────────────────────────

const collaborationEngine = new CollaborationEngine();

module.exports = {
  CollaborationEngine,
  CollaborationEvent,
  COLLABORATION_TYPES,
  DESTRUCTIVE_SIGNALS,
  collaborationEngine,
};
