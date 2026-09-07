'use strict';
/**
 * lib/diversityRouter208.js — ECOS V208 (Phase P97)
 *
 * Research source: BIM specification, Research PDF #2, section 7.2.
 * "Diversity-aware Routing — Preventing Collusion and Sybil Review Fraud".
 *
 * CORE PROBLEM THIS SOLVES:
 * A sophisticated attacker can register as BOTH executor AND reviewer for the same
 * task ecosystem. By routing their own tasks to themselves for review, they drain
 * escrow without doing real work. This is the "Coordinape circle-voting" attack
 * at the infrastructure level.
 *
 * BIM SOLUTION — WEIGHTED RENDEZVOUS HASHING WITH DIVERSITY CONSTRAINTS:
 * Hard rule: a task review assignment is BLOCKED if the candidate reviewer shares
 * ANY of these with the executor:
 *   1. Same ISP/ASN (Autonomous System Number)
 *   2. Same IP /24 subnet (same network block)
 *   3. Same OS profile
 *   4. Same hardware fingerprint
 *   5. Same geographic coordinates (within ~1km radius)
 *   6. Same account creation cohort (within 24h — suggests coordinated farm creation)
 *
 * RENDEZVOUS HASHING (Highest Random Weight):
 * Each candidate reviewer is scored as: hash(taskId + reviewerId) × qualityWeight.
 * The candidate with highest score that ALSO passes all diversity constraints wins.
 * This provides deterministic routing (no central coordinator needed) while
 * distributing load proportionally to quality weights.
 *
 * ANTI-COLLUSION SCORE:
 * Measures how likely a set of assignments is to be colluded. Used by the
 * economic health monitor as a supplementary signal alongside Hollow Task Rate.
 *
 * Pure module — no DB, no side effects.
 * @version 208.0.0
 */

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum same-cohort age difference in hours before flagging as coordinated farm. */
const MAX_COHORT_AGE_DIFF_HOURS_208 = 24;

/** Geographic proximity threshold in km (within = same-location flag). */
const GEO_PROXIMITY_KM_208 = 1.0;

/** Anti-collusion score threshold — above this = suspicious routing. */
const COLLUSION_SCORE_THRESHOLD_208 = 0.65;

/** Rendezvous hash uses FNV-1a for its speed and good distribution. */
const FNV_PRIME = 0x01000193n;
const FNV_OFFSET = 0x811c9dc5n;
const UINT32_MAX = 0xFFFFFFFFn;

// ── Error class ──────────────────────────────────────────────────────────────

class DiversityRouterError208 extends Error {
  constructor(msg, code = 'ROUTING_ERROR') {
    super(msg);
    this.name = 'DiversityRouterError208';
    this.code = code;
    this.statusCode = 400;
  }
}

// ── FNV-1a hash (deterministic, no external deps) ────────────────────────────

/**
 * FNV-1a 32-bit hash of a string. Deterministic, fast, no crypto needed.
 * @param {string} s
 * @returns {number} — 32-bit unsigned integer
 */
function fnv1a32(s) {
  let hash = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) {
    hash = BigInt(s.charCodeAt(i)) ^ hash;
    hash = (hash * FNV_PRIME) & UINT32_MAX;
  }
  return Number(hash);
}

// ── Diversity constraint checker ──────────────────────────────────────────────

/**
 * Check whether an executor/reviewer pair violates diversity constraints.
 * ANY violation → blocked (hard constraint, not soft).
 *
 * @param {Object} executor — { id, asn?, subnet24?, osProfile?, hwFingerprint?, geoLat?, geoLon?, createdAt? }
 * @param {Object} reviewer — same shape
 * @returns {{ blocked: boolean, violations: string[] }}
 */
function checkDiversityConstraints208(executor, reviewer) {
  if (!executor || !reviewer) throw new DiversityRouterError208('executor and reviewer must be objects');
  const violations = [];

  // Rule 1: Same ASN (ISP/Autonomous System)
  if (executor.asn && reviewer.asn && executor.asn === reviewer.asn) {
    violations.push(`Same ASN: ${executor.asn} — likely same network provider, collusion risk`);
  }

  // Rule 2: Same /24 subnet (first 3 octets of IPv4)
  if (executor.subnet24 && reviewer.subnet24 && executor.subnet24 === reviewer.subnet24) {
    violations.push(`Same /24 subnet: ${executor.subnet24} — same local network block`);
  }

  // Rule 3: Same OS profile
  if (executor.osProfile && reviewer.osProfile &&
      executor.osProfile.toLowerCase() === reviewer.osProfile.toLowerCase()) {
    violations.push(`Same OS profile: ${executor.osProfile} — hardware farm indicator`);
  }

  // Rule 4: Same hardware fingerprint
  if (executor.hwFingerprint && reviewer.hwFingerprint && executor.hwFingerprint === reviewer.hwFingerprint) {
    violations.push(`Same hardware fingerprint — same physical or virtual machine`);
  }

  // Rule 5: Geographic proximity (Haversine distance)
  if (executor.geoLat !== undefined && executor.geoLon !== undefined &&
      reviewer.geoLat !== undefined && reviewer.geoLon !== undefined) {
    const distKm = haversineKm(executor.geoLat, executor.geoLon, reviewer.geoLat, reviewer.geoLon);
    if (distKm < GEO_PROXIMITY_KM_208) {
      violations.push(`Geographic proximity: ${distKm.toFixed(2)}km — within ${GEO_PROXIMITY_KM_208}km radius`);
    }
  }

  // Rule 6: Same account-creation cohort (coordinated farm creation)
  if (executor.createdAt && reviewer.createdAt) {
    const diffHours = Math.abs(new Date(executor.createdAt) - new Date(reviewer.createdAt)) / 3_600_000;
    if (diffHours <= MAX_COHORT_AGE_DIFF_HOURS_208) {
      violations.push(`Same creation cohort: accounts created ${diffHours.toFixed(1)}h apart — possible coordinated farm`);
    }
  }

  // Rule 7: Same account ID (self-review)
  if (executor.id && reviewer.id && executor.id === reviewer.id) {
    violations.push('Self-review: executor and reviewer are the same account');
  }

  return {
    blocked: violations.length > 0,
    violations,
    diversityScore: r4(1 - Math.min(violations.length / 7, 1)), // 0=fully blocked, 1=fully diverse
  };
}

// ── Rendezvous hashing (HRW) ─────────────────────────────────────────────────

/**
 * Weighted Rendezvous Hashing (Highest Random Weight) assignment.
 * Each candidate gets score = hash(taskId + reviewerId) × qualityWeight.
 * Winner = highest score that also passes diversity constraints.
 *
 * @param {string}   taskId         — Unique task identifier
 * @param {Object}   executor       — Executor profile (for diversity check)
 * @param {Object[]} reviewerPool   — Array of reviewer profiles: { id, qualityWeight?, ...diversityFields }
 * @returns {RendezvousResult208}
 */
function selectReviewerByRendezvous208(taskId, executor, reviewerPool) {
  if (!taskId || typeof taskId !== 'string') throw new DiversityRouterError208('taskId must be a string');
  if (!executor || typeof executor !== 'object') throw new DiversityRouterError208('executor must be an object');
  if (!Array.isArray(reviewerPool) || reviewerPool.length === 0) {
    throw new DiversityRouterError208('reviewerPool must be a non-empty array');
  }

  const scored = [];
  const blocked = [];

  for (const reviewer of reviewerPool) {
    const { blocked: isBlocked, violations, diversityScore } = checkDiversityConstraints208(executor, reviewer);
    if (isBlocked) {
      blocked.push({ id: reviewer.id, violations });
      continue;
    }
    // Rendezvous score = hash(taskId:reviewerId) × qualityWeight
    const hashKey = `${taskId}:${reviewer.id || ''}`;
    const rawHash = fnv1a32(hashKey);
    const normalizedHash = rawHash / 0xFFFFFFFF; // [0, 1]
    const qualityWeight = typeof reviewer.qualityWeight === 'number' ? Math.max(0.01, reviewer.qualityWeight) : 1.0;
    const rendezvousScore = normalizedHash * qualityWeight;

    scored.push({
      id: reviewer.id,
      rendezvousScore: r4(rendezvousScore),
      rawHash,
      qualityWeight,
      diversityScore,
      profile: reviewer,
    });
  }

  scored.sort((a, b) => b.rendezvousScore - a.rendezvousScore);
  const selected = scored[0] || null;

  return {
    taskId,
    executorId: executor.id,
    selected: selected ? {
      reviewerId: selected.id,
      rendezvousScore: selected.rendezvousScore,
      qualityWeight: selected.qualityWeight,
    } : null,
    fallbackAvailable: scored.length > 1,
    alternates: scored.slice(1, 3).map(s => ({ reviewerId: s.id, rendezvousScore: s.rendezvousScore })),
    blockedReviewers: blocked,
    poolSize: reviewerPool.length,
    eligibleCount: scored.length,
    blockedCount: blocked.length,
    success: selected !== null,
    failReason: selected ? null : `All ${reviewerPool.length} reviewers blocked by diversity constraints`,
    researchSource: 'BIM Weighted Rendezvous Hashing — diversity-aware routing prevents same-infrastructure collusion',
    ecosVersion: 'V208',
  };
}

// ── Anti-collusion scoring ─────────────────────────────────────────────────────

/**
 * Score a batch of task assignments for collusion risk.
 * High score = suspicious = needs investigation.
 *
 * @param {{ executorId: string, reviewerId: string, taskId: string }[]} assignments
 * @param {Object} [identityMap] — { [id]: { asn, subnet24, ... } }
 * @returns {CollusionReport208}
 */
function computeCollusionScore208(assignments, identityMap = {}) {
  if (!Array.isArray(assignments)) throw new DiversityRouterError208('assignments must be array');

  const flags = [];
  let totalViolations = 0;

  for (const assignment of assignments) {
    const executor = identityMap[assignment.executorId] || { id: assignment.executorId };
    const reviewer = identityMap[assignment.reviewerId] || { id: assignment.reviewerId };
    const { violations } = checkDiversityConstraints208(executor, reviewer);
    if (violations.length > 0) {
      flags.push({ taskId: assignment.taskId, executorId: assignment.executorId, reviewerId: assignment.reviewerId, violations });
      totalViolations += violations.length;
    }
  }

  const flagRate = assignments.length > 0 ? flags.length / assignments.length : 0;
  const collusionScore = r4(Math.min(1, flagRate * 1.5 + (totalViolations / Math.max(1, assignments.length * 7)) * 0.5));
  const suspicious = collusionScore >= COLLUSION_SCORE_THRESHOLD_208;

  return {
    collusionScore,
    suspicious,
    threshold: COLLUSION_SCORE_THRESHOLD_208,
    flaggedAssignments: flags.length,
    totalAssignments: assignments.length,
    flagRate: r4(flagRate),
    flags,
    interpretation: suspicious
      ? `Collusion score ${collusionScore} ≥ ${COLLUSION_SCORE_THRESHOLD_208} — review routing integrity immediately (Coordinape/BIM pattern)`
      : `Collusion score ${collusionScore} — routing appears diverse and independent`,
    researchSource: 'Coordinape circle-voting + BIM diversity constraints — network-level collusion prevention',
    ecosVersion: 'V208',
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Haversine distance between two lat/lon points in kilometers.
 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function toRad(deg) { return deg * Math.PI / 180; }
function r4(n) { return Math.round(n * 10000) / 10000; }

// ── Module exports ────────────────────────────────────────────────────────────

module.exports = {
  checkDiversityConstraints208,
  selectReviewerByRendezvous208,
  computeCollusionScore208,
  fnv1a32,
  DiversityRouterError208,
  MAX_COHORT_AGE_DIFF_HOURS_208,
  GEO_PROXIMITY_KM_208,
  COLLUSION_SCORE_THRESHOLD_208,
};
