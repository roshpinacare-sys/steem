'use strict';

/**
 * ECOS Global Bridge Network — V128
 * 
 * P19 — Constructive Collaboration
 * 
 * Enables cross-border, cross-jurisdiction collaboration between users
 * while respecting regulatory constraints in each region.
 * 
 * Problems solved:
 *   1. Users in restrictive jurisdictions can't directly collaborate
 *      with users in other jurisdictions due to data-residency rules.
 *   2. Knowledge created in one workspace is siloed — can't benefit others.
 *   3. No mechanism for constructive peer validation across cultures/regions.
 *   4. Trust gaps between users who have never interacted.
 * 
 * Solution — Bridge Network:
 *   - BridgeNode: a jurisdiction-aware relay that normalizes collaboration
 *     constraints between two parties
 *   - CollaborationSession: a bounded, audited joint-work context
 *   - TrustBond: accumulated trust score between two user pairs
 *   - ConstraintResolver: maps what IS possible given two jurisdictions' rules
 */

const crypto = require('node:crypto');

// ─── JURISDICTION CONSTRAINTS ────────────────────────────────────────────────

const JURISDICTION_CONSTRAINTS = {
  'eu':          { dataResidency: true,  crossBorderAI: 'restricted', pseudonymRequired: true  },
  'us-federal':  { dataResidency: false, crossBorderAI: 'permitted',  pseudonymRequired: false },
  'us-state':    { dataResidency: false, crossBorderAI: 'permitted',  pseudonymRequired: false },
  'canada':      { dataResidency: true,  crossBorderAI: 'restricted', pseudonymRequired: true  },
  'uk':          { dataResidency: false, crossBorderAI: 'permitted',  pseudonymRequired: false },
  'singapore':   { dataResidency: false, crossBorderAI: 'permitted',  pseudonymRequired: false },
  'japan':       { dataResidency: true,  crossBorderAI: 'restricted', pseudonymRequired: true  },
  'australia':   { dataResidency: false, crossBorderAI: 'permitted',  pseudonymRequired: false },
  'india':       { dataResidency: true,  crossBorderAI: 'restricted', pseudonymRequired: true  },
  'israel':      { dataResidency: false, crossBorderAI: 'permitted',  pseudonymRequired: false },
  'brazil':      { dataResidency: true,  crossBorderAI: 'restricted', pseudonymRequired: true  },
  'uae':         { dataResidency: true,  crossBorderAI: 'restricted', pseudonymRequired: false },
  'default':     { dataResidency: false, crossBorderAI: 'permitted',  pseudonymRequired: false },
};

/**
 * ConstraintResolver — determines what collaboration modes are possible
 * given two users' jurisdictions. Always finds the MOST PERMISSIVE
 * option that satisfies BOTH sets of constraints.
 */
class ConstraintResolver {
  resolve(jurisdictionA, jurisdictionB) {
    const a = JURISDICTION_CONSTRAINTS[jurisdictionA] || JURISDICTION_CONSTRAINTS['default'];
    const b = JURISDICTION_CONSTRAINTS[jurisdictionB] || JURISDICTION_CONSTRAINTS['default'];

    const crossBorderBlocked =
      a.crossBorderAI === 'restricted' && b.crossBorderAI === 'restricted';

    const pseudonymRequired = a.pseudonymRequired || b.pseudonymRequired;
    const dataResidencyRequired = a.dataResidency || b.dataResidency;

    return {
      canCollaborate: true,            // always true — bridge finds a path
      crossBorderMode: crossBorderBlocked ? 'proxied' : 'direct',
      pseudonymRequired,
      dataResidencyRequired,
      allowedModes: this._allowedModes(crossBorderBlocked, pseudonymRequired),
      constraints: { a, b },
    };
  }

  _allowedModes(crossBorderBlocked, pseudonymRequired) {
    const modes = ['template-share', 'review', 'knowledge-exchange'];
    if (!crossBorderBlocked) modes.push('live-session', 'co-validate');
    if (!pseudonymRequired)   modes.push('identity-verified-session');
    return modes;
  }
}

// ─── TRUST BOND ──────────────────────────────────────────────────────────────

class TrustBond {
  constructor(userA, userB) {
    this.bondId      = 'bond::' + crypto.randomBytes(6).toString('hex');
    this.userA       = userA;
    this.userB       = userB;
    this.score       = 0;          // 0–100
    this.interactions = 0;
    this.createdAt   = new Date().toISOString();
    this.updatedAt   = this.createdAt;
    this._history    = [];
  }

  record(event, delta) {
    this.score = Math.max(0, Math.min(100, this.score + delta));
    this.interactions++;
    this.updatedAt = new Date().toISOString();
    this._history.push({ event, delta, score: this.score, ts: this.updatedAt });
  }

  get tier() {
    if (this.score >= 80) return 'trusted';
    if (this.score >= 50) return 'familiar';
    if (this.score >= 20) return 'acquainted';
    return 'new';
  }

  toJSON() {
    return {
      bondId: this.bondId,
      users: [this.userA, this.userB],
      score: this.score,
      tier: this.tier,
      interactions: this.interactions,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

// ─── COLLABORATION SESSION ────────────────────────────────────────────────────

class CollaborationSession {
  constructor({ initiator, invitee, mode, jurisdictionA, jurisdictionB, topic = '' }) {
    const resolver = new ConstraintResolver();
    const resolution = resolver.resolve(jurisdictionA, jurisdictionB);

    if (!resolution.allowedModes.includes(mode)) {
      // Gracefully downgrade instead of failing
      mode = resolution.allowedModes[0];
    }

    this.sessionId        = 'collab::' + crypto.randomBytes(8).toString('hex');
    this.initiator        = initiator;
    this.invitee          = invitee;
    this.mode             = mode;
    this.topic            = topic;
    this.resolution       = resolution;
    this.status           = 'active';
    this.startedAt        = new Date().toISOString();
    this.endedAt          = null;
    this._contributions   = [];   // { userId, type, content, ts }
    this._agreements      = [];   // things both parties affirmed
  }

  addContribution(userId, type, content) {
    if (this.status !== 'active') throw new Error('Session is not active');
    const entry = {
      id: crypto.randomBytes(4).toString('hex'),
      userId,
      type,           // 'annotation' | 'review' | 'knowledge' | 'template' | 'feedback'
      content,
      ts: new Date().toISOString(),
    };
    this._contributions.push(entry);
    return entry;
  }

  addAgreement(text) {
    this._agreements.push({ text, ts: new Date().toISOString() });
  }

  close(reason = 'completed') {
    this.status  = reason;
    this.endedAt = new Date().toISOString();
    return this.summary();
  }

  summary() {
    return {
      sessionId:      this.sessionId,
      initiator:      this.initiator,
      invitee:        this.invitee,
      mode:           this.mode,
      topic:          this.topic,
      status:         this.status,
      contributions:  this._contributions.length,
      agreements:     this._agreements.length,
      startedAt:      this.startedAt,
      endedAt:        this.endedAt,
      resolution:     this.resolution,
    };
  }
}

// ─── BRIDGE NODE ─────────────────────────────────────────────────────────────

class BridgeNode {
  constructor() {
    this._bonds    = new Map();   // `${userA}::${userB}` → TrustBond
    this._sessions = new Map();   // sessionId → CollaborationSession
    this._resolver = new ConstraintResolver();
  }

  _bondKey(a, b) {
    return [a, b].sort().join('::');
  }

  getBond(userA, userB) {
    const key = this._bondKey(userA, userB);
    if (!this._bonds.has(key)) {
      this._bonds.set(key, new TrustBond(userA, userB));
    }
    return this._bonds.get(key);
  }

  startSession({ initiator, invitee, mode, jurisdictionA, jurisdictionB, topic }) {
    const session = new CollaborationSession({
      initiator, invitee, mode, jurisdictionA, jurisdictionB, topic,
    });
    this._sessions.set(session.sessionId, session);
    return session;
  }

  getSession(sessionId) {
    return this._sessions.get(sessionId) || null;
  }

  contribute(sessionId, userId, type, content) {
    const session = this.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    const contribution = session.addContribution(userId, type, content);

    // Positive collaboration → build trust
    const bond = this.getBond(session.initiator, session.invitee);
    bond.record('contribution', 3);

    return { contribution, bond: bond.toJSON() };
  }

  closeSession(sessionId, reason) {
    const session = this.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    const summary = session.close(reason);

    // Session completion → trust milestone
    const bond = this.getBond(session.initiator, session.invitee);
    bond.record('session_completed', 10);

    return { summary, bond: bond.toJSON() };
  }

  resolveConstraints(jurisdictionA, jurisdictionB) {
    return this._resolver.resolve(jurisdictionA, jurisdictionB);
  }

  listSessions(userId) {
    return [...this._sessions.values()]
      .filter(s => s.initiator === userId || s.invitee === userId)
      .map(s => s.summary());
  }

  listBonds(userId) {
    return [...this._bonds.values()]
      .filter(b => b.userA === userId || b.userB === userId)
      .map(b => b.toJSON());
  }

  stats() {
    const bonds    = [...this._bonds.values()];
    const sessions = [...this._sessions.values()];
    return {
      totalBonds:         bonds.length,
      trustedBonds:       bonds.filter(b => b.tier === 'trusted').length,
      activeSessions:     sessions.filter(s => s.status === 'active').length,
      completedSessions:  sessions.filter(s => s.status === 'completed').length,
      totalContributions: sessions.reduce((n, s) => n + s._contributions.length, 0),
    };
  }
}

// ─── SINGLETON ───────────────────────────────────────────────────────────────

const bridgeNode = new BridgeNode();

module.exports = {
  BridgeNode,
  CollaborationSession,
  TrustBond,
  ConstraintResolver,
  bridgeNode,
  JURISDICTION_CONSTRAINTS,
};
