'use strict';
/**
 * src/lib/diamondCognitionEngine462.js — ECOS V462 (Phase P350) — Diamond Cognition Engine 💎🧠
 *
 * Makes the Diamond (V453) genuinely MORE intelligent: it stops merely REACTING to the
 * current snapshot and starts REASONING OVER TIME — foresight, memory, and learning,
 * all still bounded by the same safe spine (proactive actions flow through V453 →
 * V437 orchestrator → V402 money chokepoint → audit; nothing here can bypass the base).
 *
 *   ingestCognition462    — append each V453 cognition to a bounded rolling history.
 *   analyzeTrends462      — compute trajectories (health, solvency surplus, chat
 *                           dissatisfaction): slope, direction, and a PROJECTION of how
 *                           many readings until a danger threshold is breached.
 *   proactiveDecisions462 — when a metric is DEGRADING toward a threshold, propose a
 *                           PRE-EMPTIVE, bounded, reversible action BEFORE it breaches
 *                           (in the V453 decision format, so it runs through the spine).
 *   recordOutcome462 +    — remember what each intervention did to system health, and
 *   interventionEffectiveness462   learn which interventions actually help (self-tuning).
 *
 * This is foresight + memory + learning: the difference between a reflex and a mind.
 * Pure JS, no new deps (R3/R6). Read-only over sacred. Version-suffixed (…462).
 *
 * @version 462.0.0
 */

const COGNITION_ENGINE_VERSION_462 = '462.0.0';

class CognitionError462 extends Error {
  constructor(msg, code) { super(msg); this.name = 'CognitionError462'; this.code = code || 'COGNITION_ERROR'; this.statusCode = 400; }
}

// least-squares slope over y-values (x = 0..n-1). Positive = rising.
function _slope462(ys) {
  const n = ys.length;
  if (n < 2) return 0;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += ys[i]; sxy += i * ys[i]; sxx += i * i; }
  const denom = n * sxx - sx * sx;
  return denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
}
function _num462(v, dflt) { const n = Number(v); return Number.isFinite(n) ? n : dflt; }

class DiamondCognitionEngine462 {
  constructor(opts = {}) {
    this.maxHistory = opts.maxHistory || 200;
    this.history = [];                 // [{ at, healthScore, solvencySurplus, dissatisfaction, posture }]
    this.outcomes = [];                // [{ intervention, healthBefore, healthAfter, delta, at }]
    this.audit = typeof opts.audit === 'function' ? opts.audit : null;
  }

  /** Record one V453 cognition snapshot (extracts the metrics we track over time). */
  ingestCognition462(cognition) {
    if (!cognition || typeof cognition.healthScore !== 'number') throw new CognitionError462('valid V453 cognition required', 'BAD_COGNITION');
    let surplus = null;
    const sc = (cognition.concerns || []).find(c => c.pillar === 'solvency');
    // surplus is best-effort: callers may attach cognition.metrics.solvencySurplus
    if (cognition.metrics && cognition.metrics.solvencySurplus != null) surplus = _num462(cognition.metrics.solvencySurplus, null);
    const diss = cognition.metrics && cognition.metrics.dissatisfaction != null ? _num462(cognition.metrics.dissatisfaction, null) : null;
    const row = { at: cognition.at || new Date().toISOString(), healthScore: cognition.healthScore, solvencySurplus: surplus, dissatisfaction: diss, posture: cognition.posture };
    this.history.push(row);
    if (this.history.length > this.maxHistory) this.history.shift();
    return { ingested: true, historyLength: this.history.length };
  }

  /** Trajectories + projections of time-to-breach. */
  analyzeTrends462(opts = {}) {
    const window = opts.window || Math.min(this.history.length, 10);
    const recent = this.history.slice(-window);
    if (recent.length < 2) return { version: COGNITION_ENGINE_VERSION_462, ready: false, reason: 'need >=2 readings', readings: recent.length };

    const health = recent.map(r => r.healthScore);
    const healthSlope = _slope462(health);
    const lastHealth = health[health.length - 1];

    const earlyWarnings = [];
    // health degrading → project readings until it hits a danger floor (e.g., 40)
    if (healthSlope < -0.5) {
      const floor = opts.healthFloor || 40;
      const readingsToFloor = lastHealth > floor && healthSlope < 0 ? Math.ceil((lastHealth - floor) / -healthSlope) : 0;
      earlyWarnings.push({ metric: 'healthScore', direction: 'degrading', slope: Math.round(healthSlope * 100) / 100, projectionReadingsToDanger: readingsToFloor, detail: `health falling ~${Math.abs(Math.round(healthSlope))}/reading; ~${readingsToFloor} readings to floor ${floor}` });
    }
    // solvency surplus shrinking → project readings until it crosses zero
    const surplusVals = recent.map(r => r.solvencySurplus).filter(v => v != null);
    if (surplusVals.length >= 2) {
      const sSlope = _slope462(surplusVals); const lastS = surplusVals[surplusVals.length - 1];
      if (sSlope < 0 && lastS > 0) {
        const readingsToZero = Math.ceil(lastS / -sSlope);
        earlyWarnings.push({ metric: 'solvencySurplus', direction: 'degrading', slope: Math.round(sSlope), projectionReadingsToDanger: readingsToZero, detail: `reserve surplus shrinking; ~${readingsToZero} readings to insolvency if unchecked` });
      }
    }
    // dissatisfaction rising
    const dissVals = recent.map(r => r.dissatisfaction).filter(v => v != null);
    if (dissVals.length >= 2) {
      const dSlope = _slope462(dissVals);
      if (dSlope > 0.02) earlyWarnings.push({ metric: 'dissatisfaction', direction: 'rising', slope: Math.round(dSlope * 1000) / 1000, projectionReadingsToDanger: null, detail: 'chat dissatisfaction trending up' });
    }

    const trajectory = healthSlope > 0.5 ? 'improving' : healthSlope < -0.5 ? 'degrading' : 'stable';
    return {
      version: COGNITION_ENGINE_VERSION_462, ready: true, readings: recent.length,
      trajectory, healthSlope: Math.round(healthSlope * 100) / 100, currentHealth: lastHealth,
      earlyWarnings, foresight: earlyWarnings.length > 0,
    };
  }

  /**
   * Pre-emptive, bounded decisions from a DEGRADING trend — act BEFORE a breach.
   * Returns actions in the V453 format so they flow through actAutonomously453 → spine.
   */
  proactiveDecisions462(trends) {
    if (!trends || !trends.ready) return { version: COGNITION_ENGINE_VERSION_462, proactive: false, actions: [] };
    const actions = [];
    for (const w of (trends.earlyWarnings || [])) {
      if (w.metric === 'solvencySurplus' && w.projectionReadingsToDanger != null && w.projectionReadingsToDanger <= 5) {
        actions.push({ priority: 'HIGH', pillar: 'solvency', capability: 'protection.tightenMintCaps', preemptive: true,
          reason: `FORESIGHT: reserve surplus shrinking — ~${w.projectionReadingsToDanger} readings to insolvency. Tighten new-exposure caps NOW, before breach (reversible).`,
          reversible: true, impact: 'medium', requiresAuth: false, args: { reason: 'diamond:preemptive_solvency' } });
      } else if (w.metric === 'healthScore' && w.projectionReadingsToDanger != null && w.projectionReadingsToDanger <= 4) {
        actions.push({ priority: 'HIGH', pillar: 'system', capability: 'monitor.escalate', preemptive: true,
          reason: `FORESIGHT: system health degrading — ~${w.projectionReadingsToDanger} readings to danger floor. Escalate for review now.`,
          reversible: true, impact: 'low', requiresAuth: false, args: {} });
      } else if (w.metric === 'dissatisfaction') {
        actions.push({ priority: 'MEDIUM', pillar: 'chat', capability: 'chat.raiseGroundingThresholds', preemptive: true,
          reason: 'FORESIGHT: chat dissatisfaction trending up — raise grounding/hedging before users churn.',
          reversible: true, impact: 'low', requiresAuth: false, args: {} });
      }
    }
    return { version: COGNITION_ENGINE_VERSION_462, proactive: actions.length > 0, actions };
  }

  /** Learn: record how an intervention changed system health. */
  recordOutcome462(intervention, healthBefore, healthAfter) {
    if (!intervention) throw new CognitionError462('intervention required', 'BAD_ARGS');
    const before = _num462(healthBefore, null), after = _num462(healthAfter, null);
    if (before == null || after == null) throw new CognitionError462('healthBefore/After must be numbers', 'BAD_ARGS');
    const row = { intervention: String(intervention), healthBefore: before, healthAfter: after, delta: after - before, at: new Date().toISOString() };
    this.outcomes.push(row);
    if (this.audit) { try { this.audit('diamond.outcome', { intervention: row.intervention, delta: row.delta }); } catch (_) {} }
    return { recorded: true, delta: row.delta };
  }

  /** Which interventions actually help? (mean health delta per intervention type) */
  interventionEffectiveness462() {
    const agg = {};
    for (const o of this.outcomes) {
      agg[o.intervention] = agg[o.intervention] || { n: 0, totalDelta: 0 };
      agg[o.intervention].n++; agg[o.intervention].totalDelta += o.delta;
    }
    const ranked = Object.entries(agg).map(([k, v]) => ({ intervention: k, samples: v.n, avgHealthDelta: Math.round((v.totalDelta / v.n) * 100) / 100 }))
      .sort((a, b) => b.avgHealthDelta - a.avgHealthDelta);
    return { version: COGNITION_ENGINE_VERSION_462, totalOutcomes: this.outcomes.length, ranked,
      recommendation: ranked.length ? `most effective: ${ranked[0].intervention} (+${ranked[0].avgHealthDelta} avg health)` : 'no outcomes yet' };
  }
}

let _defaultEngine462 = null;
function defaultCognitionEngine462(opts) { if (!_defaultEngine462) _defaultEngine462 = new DiamondCognitionEngine462(opts); return _defaultEngine462; }

module.exports = {
  COGNITION_ENGINE_VERSION_462, CognitionError462,
  DiamondCognitionEngine462, defaultCognitionEngine462, _slope462,
};
