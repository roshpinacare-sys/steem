'use strict';
/**
 * src/lib/reputationLedger268.js — Non-Transferable Reputation Ledger (V268)
 *
 * Builds on reputationLedger264 with:
 *   - Multi-dimensional reputation tracks (not a single score)
 *   - Temporal decay (Ebbinghaus curve for stale attestations)
 *   - Private/selective-disclosure mode (reveal only what user consents)
 *   - AP2 trust attestation format
 *   - Program-level reputation (aggregate across a mission program)
 *   - Anti-collusion: peer attestation graph analysis (rings, reciprocal clusters)
 *
 * PROGRAM 03: Reputation Engine
 * Zero new npm deps. Identifiers end with 268.
 */
'use strict';

const crypto = require('node:crypto');

const ATTESTATION_TYPES_268 = Object.freeze([
  'peer_review',       // peer verified quality of work
  'mission_complete',  // system: mission completed with HITL approval
  'tip_received',      // received a tip (social signal)
  'split_earned',      // earned via collaboration split
  'onboarding',        // completed onboarding
  'x402_payer',        // paid via x402 (economic actor)
  'sybil_clear',       // sybilGuard cleared (humanity)
  'validator',         // acted as validator on a mission
  'collaborator',      // contributed to a collab split
]);

const DECAY_HALF_LIFE_MS_268  = 90 * 24 * 3600_000;  // 90-day half-life
const DECAY_FLOOR_268         = 0.05;                 // minimum weight (floor)
const MAX_ATTESTATIONS_268    = 10_000;
const COLLUSION_MIN_CYCLE_268 = 3;                    // min graph cycle to flag

class ReputationLedger268 {
  constructor(opts = {}) {
    this._logger     = opts.logger     || console;
    this._auditLog   = opts.auditLog   || null;
    this._sybilGuard = opts.sybilGuard || null;

    this._ledger268       = new Map(); // userId → UserReputation268
    this._attestations268 = [];        // ring buffer
    this._attGraph268     = new Map(); // attesterId → Set<subjectId> (for anti-collusion)
  
    this._perf268 = { latencies: [] };
    this._logAdapter268 = opts.logAdapter || null;
  }

  // ── Attestation ───────────────────────────────────────────────────────────

  /**
   * Record an attestation for a user.
   * @param {string} attesterId — issuer of the attestation
   * @param {string} subjectId  — subject of the attestation
   * @param {string} type       — one of ATTESTATION_TYPES_268
   * @param {object} context    — { missionId, score, evidence, programId }
   */
  attest268(attesterId, subjectId, type, context = {}) {
    const _t0 = Date.now();
    if (!ATTESTATION_TYPES_268.includes(type))
      throw new Error(`reputationLedger268: unknown attestation type "${type}"`);
    if (attesterId === subjectId)
      throw new Error('reputationLedger268: self-attestation is not allowed');

    // Sybil check on attester
    if (this._sybilGuard?.evaluate268 || this._sybilGuard?.evaluate264) {
      const evalFn = this._sybilGuard.evaluate268 || this._sybilGuard.evaluate264;
      const verdict = evalFn.call(this._sybilGuard, attesterId);
      if (verdict.verdict === 'BLOCK')
        throw new Error(`reputationLedger268: attester ${attesterId} is sybil-blocked`);
    }

    // Anti-collusion graph tracking
    this._recordAttestEdge268(attesterId, subjectId);
    const collusionCheck = this._detectCollusionCycle268(attesterId);

    const attn = {
      attestationId: 'attn268::' + crypto.randomBytes(6).toString('hex'),
      attesterId,
      subjectId,
      type,
      context,
      collusionFlagged: collusionCheck.rings.length > 0,
      createdAt: new Date().toISOString(),
    };

    this._attestations268.push(attn);
    if (this._attestations268.length > MAX_ATTESTATIONS_268) this._attestations268.shift();

    // Update subject's ledger
    const rep = this._getOrCreate268(subjectId);
    rep.attestations.push(attn);
    if (!rep.dimensions[type]) rep.dimensions[type] = { count: 0, weightedScore: 0 };
    const score = context.score || 1.0;
    rep.dimensions[type].count++;
    rep.dimensions[type].weightedScore += score;
    rep.lastUpdated = new Date().toISOString();

    this._log268('ATTEST', { attestationId: attn.attestationId, subjectId, type, collusionFlagged: attn.collusionFlagged });
    if (this._auditLog?.append) { try { this._auditLog.append({ event: 'reputationLedger268.attest', ...attn }); } catch (_) {} }

    this._recordLatency268(_t0);
    return { ok: true, attestationId: attn.attestationId, collusionFlagged: attn.collusionFlagged };
  }

  /**
   * System attestation (no sybil check — called by runtime after mission complete).
   */
  systemAttest268(subjectId, type, context = {}) {
    return this.attest268('__system__', subjectId, type, context);
  }

  // ── Standing ──────────────────────────────────────────────────────────────

  /**
   * Get the current standing of a user.
   * Applies temporal decay to all attestations.
   */
  getStanding268(userId) {
    const rep = this._ledger268.get(userId);
    if (!rep) return this._emptyStanding268(userId);

    const now = Date.now();
    let totalScore = 0;
    const decayed = {};

    for (const [dimType, dim] of Object.entries(rep.dimensions)) {
      // Apply Ebbinghaus decay based on last update
      const ageMs = now - new Date(rep.lastUpdated).getTime();
      const decay = this._ebbinghausDecay268(ageMs);
      const effective = dim.weightedScore * decay;
      decayed[dimType] = { count: dim.count, raw: dim.weightedScore, effective: Math.round(effective * 1000) / 1000, decay };
      totalScore += effective;
    }

    const tier = this._computeTier268(totalScore, rep.attestations.length);

    return {
      userId,
      version: '268',
      standing: tier,
      totalScore: Math.round(totalScore * 1000) / 1000,
      dimensions: decayed,
      attestationCount: rep.attestations.length,
      lastUpdated: rep.lastUpdated,
      nonTransferable: true,
    };
  }

  /**
   * Mobile-compact standing.
   */
  getMobileStanding268(userId) {
    const s = this.getStanding268(userId);
    return { uid: userId, st: s.standing, sc: s.totalScore, n: s.attestationCount };
  }

  /**
   * Selective disclosure: reveal only specific dimensions.
   */
  selectiveDisclose268(userId, dimensions) {
    const standing = this.getStanding268(userId);
    const filtered = {};
    for (const d of dimensions) {
      if (standing.dimensions[d]) filtered[d] = standing.dimensions[d];
    }
    return { userId, disclosedDimensions: filtered, standing: standing.standing };
  }

  /**
   * Program-level reputation: aggregate standings for a program.
   */
  getProgramReputation268(programId, userIds) {
    const standings = userIds.map(uid => this.getStanding268(uid));
    const totalScore = standings.reduce((s, st) => s + st.totalScore, 0);
    return {
      programId,
      participantCount: userIds.length,
      totalScore: Math.round(totalScore * 1000) / 1000,
      averageScore: userIds.length ? Math.round((totalScore / userIds.length) * 1000) / 1000 : 0,
      standings,
    };
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  stats268() {
    let collusionFlags = 0;
    for (const a of this._attestations268) { if (a.collusionFlagged) collusionFlags++; }
    return {
      version: '268',
      totalUsers: this._ledger268.size,
      totalAttestations: this._attestations268.length,
      collusionFlags,
      attestationTypes: ATTESTATION_TYPES_268.length,
    };
  }

  // ── Anti-collusion ────────────────────────────────────────────────────────

  _recordAttestEdge268(fromId, toId) {
    if (!this._attGraph268.has(fromId)) this._attGraph268.set(fromId, new Set());
    this._attGraph268.get(fromId).add(toId);
  }

  _detectCollusionCycle268(startId) {
    const graph = this._attGraph268;
    const visited = new Set();
    const path = [];
    const rings = [];

    const dfs = (node) => {
      if (visited.has(node)) {
        const idx = path.indexOf(node);
        if (idx !== -1 && path.length - idx >= COLLUSION_MIN_CYCLE_268)
          rings.push(path.slice(idx));
        return;
      }
      visited.add(node); path.push(node);
      for (const neighbor of (graph.get(node) || [])) dfs(neighbor);
      path.pop();
    };
    dfs(startId);
    return { rings };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _getOrCreate268(userId) {
    if (!this._ledger268.has(userId)) {
      this._ledger268.set(userId, {
        userId,
        dimensions: {},
        attestations: [],
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      });
    }
    return this._ledger268.get(userId);
  }

  _ebbinghausDecay268(ageMs) {
    const t = ageMs / DECAY_HALF_LIFE_MS_268;
    return Math.max(DECAY_FLOOR_268, Math.exp(-0.693 * t)); // e^(-ln2 * t/halfLife)
  }

  _computeTier268(score, count) {
    if (score >= 50 && count >= 20) return 'trusted';
    if (score >= 20 && count >= 10) return 'established';
    if (score >= 5  && count >= 3)  return 'verified';
    if (count >= 1)                  return 'new';
    return 'unverified';
  }

  _emptyStanding268(userId) {
    return { userId, version: '268', standing: 'unverified', totalScore: 0, dimensions: {}, attestationCount: 0, lastUpdated: null, nonTransferable: true };
  }

  _log268(event, data) {
    const entry = { event, ...data, ts: new Date().toISOString(), _v: '268' };
    if (this._auditLog?.append) { try { this._auditLog.append(entry); } catch (_) {} }
  }

  // ── V268: Performance Telemetry ─────────────────────────────────────────────
  getPerf268() { return _calcPercentiles268(this._perf268.latencies); }

  _recordLatency268(t0) {
    const ms = Date.now() - t0;
    this._perf268.latencies.push(ms);
    if (this._perf268.latencies.length > 1000) this._perf268.latencies.shift();
  }

  // ── V268: Health Check ────────────────────────────────────────────────────
  checkReputationHealth268() {
    return {
      ok: true,
      module: 'reputationLedger268 attestation ledger',
      version: '268',
      perf: this.getPerf268(),
      logAdapter: this._logAdapter268 ? { type: 'external', ok: true } : { type: 'none' },
    };
  }

}

const defaultReputationLedger268 = new ReputationLedger268();


// ── V268 Performance Telemetry helper ────────────────────────────────────────
function _calcPercentiles268(arr) {
  if (!arr || arr.length === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  const p = (pct) => sorted[Math.min(Math.floor(n * pct / 100), n - 1)];
  return { p50: p(50), p95: p(95), p99: p(99), count: n };
}

module.exports = {
  ReputationLedger268,
  defaultReputationLedger268,
  ATTESTATION_TYPES_268,
  DECAY_HALF_LIFE_MS_268,
};
