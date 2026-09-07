'use strict';
/**
 * lib/reputationDecayEngine208.js — ECOS V208 (Phase P97)
 *
 * Research source: Colony/Build Finance governance capture + rent-seeking analysis.
 * Core lesson: Without exponential reputation decay, early contributors hold perpetual
 * voting power and drain royalties without active contribution. "Past work ≠ current
 * rights" is the foundational invariant.
 *
 * DESIGN DECISIONS (from research synthesis):
 *  1. Exponential decay: R(t) = R₀ × e^(−λ × inactiveDays)
 *     — matches the natural "diminishing relevance" curve. Colony used linear, which
 *       decays too slowly at first then too fast. Exponential is self-regulating.
 *  2. Decay applies ONLY to inactive accounts (no recorded activity in window).
 *     Active accounts accumulate. Inactivity is the trigger, not time per se.
 *  3. Decay rate λ is configurable but defaults to 0.015/day (half-life ≈ 46 days).
 *     At this rate, 90 days idle = −74% effective rep. One month idle = −36%.
 *  4. Streak freeze (from workStreakEngine208) ALSO halts decay for the freeze period.
 *     This creates synergy between the two systems without coupling.
 *  5. Royalty entitlement uses EFFECTIVE reputation (post-decay), not historical peak.
 *     This directly addresses the rent-seeking failure mode.
 *  6. Governance voting power = sqrt(effectiveRep) to reduce plutocracy. (Gitcoin QF lesson)
 *
 * Pure module — no DB, no side effects. All state passed in, results returned.
 * @version 208.0.0
 */

// ── Constants ────────────────────────────────────────────────────────────────

/** Default exponential decay rate per day. Half-life = ln(2)/λ ≈ 46 days. */
const DEFAULT_DECAY_RATE_208 = 0.015;

/** Minimum effective reputation floor (prevents complete zeroing). */
const MIN_REP_FLOOR_208 = 1;

/** Days of inactivity before decay starts. Grace period (like Duolingo's streak freeze). */
const DECAY_GRACE_DAYS_208 = 3;

/** Max decay rate allowed (cap to prevent misconfiguration). */
const MAX_DECAY_RATE_208 = 0.1;

/** Governance voting power uses square root of effective rep (quadratic, anti-plutocracy). */
const GOVERNANCE_POWER_FN_208 = (rep) => Math.sqrt(Math.max(0, rep));

// ── Error class ──────────────────────────────────────────────────────────────

class DecayValidationError208 extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'DecayValidationError208';
    this.code = 'DECAY_VALIDATION';
    this.statusCode = 400;
  }
}

// ── Core decay computation ───────────────────────────────────────────────────

/**
 * Compute effective (post-decay) reputation for a single account.
 *
 * @param {Object} opts
 * @param {number}  opts.baseReputation       — Current stored reputation (pre-decay)
 * @param {string}  opts.lastActivityDate     — ISO date string of last recorded activity
 * @param {string}  [opts.asOfDate]           — Compute as of this date (ISO). Defaults to now.
 * @param {number}  [opts.decayRate]          — λ per day. Defaults to DEFAULT_DECAY_RATE_208.
 * @param {number}  [opts.graceDays]          — Days before decay starts. Defaults to DECAY_GRACE_DAYS_208.
 * @param {boolean} [opts.freezeActive]       — If true (streak freeze bought), decay paused.
 * @param {number}  [opts.freezeDaysRemaining]— Days of freeze remaining.
 * @returns {DecayResult208}
 */
function computeDecay208(opts = {}) {
  const {
    baseReputation,
    lastActivityDate,
    asOfDate,
    decayRate = DEFAULT_DECAY_RATE_208,
    graceDays = DECAY_GRACE_DAYS_208,
    freezeActive = false,
    freezeDaysRemaining = 0,
  } = opts;

  if (typeof baseReputation !== 'number' || !Number.isFinite(baseReputation) || baseReputation < 0) {
    throw new DecayValidationError208('baseReputation must be a non-negative finite number');
  }
  if (!lastActivityDate || typeof lastActivityDate !== 'string') {
    throw new DecayValidationError208('lastActivityDate must be an ISO date string');
  }
  if (decayRate <= 0 || decayRate > MAX_DECAY_RATE_208) {
    throw new DecayValidationError208(`decayRate must be between 0 and ${MAX_DECAY_RATE_208}`);
  }

  const lastActivity = new Date(lastActivityDate);
  if (isNaN(lastActivity.getTime())) {
    throw new DecayValidationError208('lastActivityDate is not a valid ISO date');
  }

  const asOf = asOfDate ? new Date(asOfDate) : new Date();
  if (isNaN(asOf.getTime())) {
    throw new DecayValidationError208('asOfDate is not a valid ISO date');
  }

  const daysSinceActivity = Math.max(0, (asOf - lastActivity) / 86_400_000);
  const effectiveInactiveDays = Math.max(0, daysSinceActivity - graceDays);

  // Freeze pauses decay for remaining freeze days
  const frozenDays = freezeActive ? Math.min(effectiveInactiveDays, Math.max(0, freezeDaysRemaining)) : 0;
  const decayableDays = Math.max(0, effectiveInactiveDays - frozenDays);

  // Exponential decay: R(t) = R₀ × e^(−λt)
  const decayFactor = decayableDays > 0 ? Math.exp(-decayRate * decayableDays) : 1;
  const rawEffective = baseReputation * decayFactor;
  const effectiveReputation = Math.max(MIN_REP_FLOOR_208, rawEffective);
  const decayedAmount = Math.max(0, baseReputation - effectiveReputation);
  const decayPercent = baseReputation > 0 ? (decayedAmount / baseReputation) * 100 : 0;

  // Governance power (quadratic anti-plutocracy)
  const governancePower = GOVERNANCE_POWER_FN_208(effectiveReputation);

  // Projections — useful for "decay-preview" endpoint
  const projections = [7, 30, 90].map((days) => {
    const projInactiveDays = Math.max(0, (daysSinceActivity + days) - graceDays);
    const projFrozenDays = freezeActive ? Math.min(projInactiveDays, Math.max(0, freezeDaysRemaining)) : 0;
    const projDecayDays = Math.max(0, projInactiveDays - projFrozenDays);
    const projFactor = projDecayDays > 0 ? Math.exp(-decayRate * projDecayDays) : 1;
    const projEffective = Math.max(MIN_REP_FLOOR_208, baseReputation * projFactor);
    return {
      daysFromNow: days,
      projectedEffectiveRep: round4(projEffective),
      projectedDecayPercent: round4(Math.max(0, (baseReputation - projEffective) / Math.max(1, baseReputation)) * 100),
      projectedGovernancePower: round4(GOVERNANCE_POWER_FN_208(projEffective)),
    };
  });

  return {
    baseReputation,
    effectiveReputation: round4(effectiveReputation),
    decayedAmount: round4(decayedAmount),
    decayPercent: round4(decayPercent),
    governancePower: round4(governancePower),
    daysSinceActivity: round4(daysSinceActivity),
    effectiveInactiveDays: round4(effectiveInactiveDays),
    decayableDays: round4(decayableDays),
    frozenDays: round4(frozenDays),
    decayFactor: round4(decayFactor),
    decayRate,
    graceDays,
    freezeActive,
    isDecaying: decayableDays > 0,
    isAtFloor: effectiveReputation <= MIN_REP_FLOOR_208 + 0.001,
    computedAt: asOf.toISOString(),
    projections,
  };
}

// ── Batch decay for system health computation ─────────────────────────────────

/**
 * Compute Reputation Inflation Index (RII) for a cohort.
 * RII = total reputation created in window / total reputation decayed in window.
 * RII > 2.5 over 14 days = red flag (research threshold: hollow tasks flooding in).
 *
 * @param {{ created: number, decayed: number }[]} activityWindows — daily buckets
 * @returns {{ rii: number, redFlag: boolean, windowCount: number }}
 */
function computeReputationInflationIndex208(activityWindows) {
  if (!Array.isArray(activityWindows)) {
    throw new DecayValidationError208('activityWindows must be an array');
  }
  let totalCreated = 0;
  let totalDecayed = 0;
  for (const w of activityWindows) {
    totalCreated += (w && typeof w.created === 'number') ? w.created : 0;
    totalDecayed += (w && typeof w.decayed === 'number') ? w.decayed : 0;
  }
  const rii = totalDecayed > 0 ? totalCreated / totalDecayed : (totalCreated > 0 ? Infinity : 1);
  return {
    rii: Number.isFinite(rii) ? round4(rii) : null,
    riiInfinite: !Number.isFinite(rii),
    totalCreated: round4(totalCreated),
    totalDecayed: round4(totalDecayed),
    windowCount: activityWindows.length,
    redFlag: rii > 2.5,
    redFlagThreshold: 2.5,
    interpretation: rii > 2.5
      ? 'Reputation created far exceeds decay — likely hollow task flooding or Sybil attack'
      : rii < 0.5
      ? 'Reputation decaying faster than created — ecosystem may be shrinking'
      : 'Balanced reputation economy',
  };
}

/**
 * Compute Gini coefficient for a distribution (reputation concentration).
 * Gini > 0.75 = governance capture risk (Build Finance lesson).
 *
 * @param {number[]} values — array of reputation values
 * @returns {{ gini: number, redFlag: boolean }}
 */
function computeGiniCoefficient208(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new DecayValidationError208('values must be a non-empty array');
  }
  const sorted = [...values].map(v => Math.max(0, Number(v) || 0)).sort((a, b) => a - b);
  const n = sorted.length;
  const total = sorted.reduce((s, v) => s + v, 0);
  if (total === 0) return { gini: 0, redFlag: false, redFlagThreshold: 0.75, n };
  let weightedSum = 0;
  for (let i = 0; i < n; i++) weightedSum += (2 * (i + 1) - n - 1) * sorted[i];
  const gini = weightedSum / (n * total);
  return {
    gini: round4(Math.max(0, Math.min(1, gini))),
    redFlag: gini > 0.75,
    redFlagThreshold: 0.75,
    n,
    interpretation: gini > 0.75
      ? 'High reputation concentration — governance capture risk (Build Finance pattern)'
      : gini > 0.5
      ? 'Moderate concentration — monitor trend'
      : 'Healthy reputation distribution',
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

// ── Module exports ────────────────────────────────────────────────────────────

module.exports = {
  computeDecay208,
  computeReputationInflationIndex208,
  computeGiniCoefficient208,
  DecayValidationError208,
  DEFAULT_DECAY_RATE_208,
  MIN_REP_FLOOR_208,
  DECAY_GRACE_DAYS_208,
  MAX_DECAY_RATE_208,
  GOVERNANCE_POWER_FN_208,
};
