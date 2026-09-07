'use strict';
/**
 * src/lib/sovereignOperatorDiamond453.js — ECOS V453 (Phase P341) — Diamond 💎
 *
 * THE JEWEL: a sovereign autonomous operator that MANAGES THE WHOLE SYSTEM. It is not
 * a new silo — it is the conductor that reads every instrument already built and acts
 * through the SAFE orchestrator spine (V437), so every action it takes is bounded by
 * the unbreakable base: money-touching actions pass the V402 chokepoint, and every
 * decision + action is audit-chained. Genius in reach, bounded in power.
 *
 *   assessSystem453(signals)  — fuse all pillar signals into one "cognition": solvency,
 *                               safety-armed, economic guard, circuit breaker, chat
 *                               health, drift → a health score + ranked concerns.
 *   decide453(cognition)      — from cognition, derive a PRIORITISED list of bounded,
 *                               reversible, EXPLAINED governance actions (each a plan
 *                               the V437 orchestrator can run). Highest priority first.
 *   actAutonomously453(...)   — execute decisions THROUGH the orchestrator spine;
 *                               dry-run by default (proposes); high-impact actions
 *                               require authorisation. Everything audit-chained.
 *
 * Design principle (sublime, not reckless): the Diamond can SEE everything and PROPOSE
 * anything, but can only ACT within the same guards that bind every other actor. It
 * cannot mint unbacked credit, cannot trap a user, cannot bypass HITL. Its genius is
 * coherence — turning the whole system's state into safe, self-directed action.
 *
 * Pure JS, no new deps (R3/R6). Read-only over sacred. Version-suffixed (…453).
 *
 * @version 453.0.0
 */

const DIAMOND_VERSION_453 = '453.0.0';

const SEVERITY_453 = { CRITICAL: 3, HIGH: 2, MEDIUM: 1, INFO: 0 };

class DiamondError453 extends Error {
  constructor(msg, code) { super(msg); this.name = 'DiamondError453'; this.code = code || 'DIAMOND_ERROR'; this.statusCode = 400; }
}

/**
 * Fuse all pillar signals into a single system cognition.
 * @param {{
 *   solvency?:{solvent?:bool|null, surplusMicro?:string},
 *   safety?:{armed?:bool},
 *   economicGuard?:{healthy?:bool, blockedRecently?:number},
 *   circuitBreaker?:{softPaused?:bool, globalOutflowUsed?:string, globalOutflowCap?:string},
 *   chat?:{dissatisfaction?:number, totalFeedback?:number},
 *   drift?:{driftedModules?:number}
 * }} signals
 */
function assessSystem453(signals = {}) {
  const concerns = [];
  const s = signals || {};

  // ── solvency (protect users' money — highest weight) ──
  if (s.solvency) {
    if (s.solvency.solvent === false) concerns.push({ pillar: 'solvency', severity: 'CRITICAL', detail: 'reserve < liabilities — users not fully backed' });
    else if (s.solvency.solvent === null) concerns.push({ pillar: 'solvency', severity: 'HIGH', detail: 'solvency not provable (reserve unknown) — fail-closed posture' });
    else if (s.solvency.surplusMicro != null) {
      try { if (BigInt(s.solvency.surplusMicro) < 0n) concerns.push({ pillar: 'solvency', severity: 'CRITICAL', detail: 'negative surplus' }); } catch (_) {}
    }
  }
  // ── safety arm ──
  if (s.safety && s.safety.armed === false) concerns.push({ pillar: 'safety', severity: 'HIGH', detail: 'safety interlocks not armed' });
  // ── economic guard ──
  if (s.economicGuard && s.economicGuard.healthy === false) concerns.push({ pillar: 'economicGuard', severity: 'HIGH', detail: 'economic guard reporting unhealthy' });
  // ── circuit breaker / outflow pressure ──
  if (s.circuitBreaker) {
    if (s.circuitBreaker.softPaused) concerns.push({ pillar: 'circuitBreaker', severity: 'MEDIUM', detail: 'system soft-paused (outflow protection active)' });
    try {
      const used = BigInt(s.circuitBreaker.globalOutflowUsed || '0'), cap = BigInt(s.circuitBreaker.globalOutflowCap || '0');
      if (cap > 0n && used * 100n / cap >= 80n && !s.circuitBreaker.softPaused) concerns.push({ pillar: 'circuitBreaker', severity: 'MEDIUM', detail: 'outflow window >80% — approaching soft-pause' });
    } catch (_) {}
  }
  // ── chat health (the pilot's heart) ──
  if (s.chat && typeof s.chat.dissatisfaction === 'number' && (s.chat.totalFeedback || 0) >= 5 && s.chat.dissatisfaction > 0.3) {
    concerns.push({ pillar: 'chat', severity: 'MEDIUM', detail: 'chat correction/dissatisfaction rate high' });
  }
  // ── module drift ──
  if (s.drift && (s.drift.driftedModules || 0) > 0) concerns.push({ pillar: 'drift', severity: 'INFO', detail: s.drift.driftedModules + ' module(s) drifted from canonical' });

  concerns.sort((a, b) => SEVERITY_453[b.severity] - SEVERITY_453[a.severity]);
  const worst = concerns.length ? SEVERITY_453[concerns[0].severity] : -1;
  // health score 0..100: starts at 100, each concern subtracts by severity
  let score = 100;
  for (const c of concerns) score -= (SEVERITY_453[c.severity] + 1) * 8;
  score = Math.max(0, Math.min(100, score));

  return {
    version: DIAMOND_VERSION_453,
    at: new Date().toISOString(),
    healthScore: score,
    posture: worst >= SEVERITY_453.CRITICAL ? 'protect' : worst >= SEVERITY_453.HIGH ? 'guard' : worst >= SEVERITY_453.MEDIUM ? 'watch' : 'nominal',
    concerns,
    concernCount: concerns.length,
  };
}

/**
 * From cognition, derive bounded, reversible, EXPLAINED governance actions, ranked.
 * Each action is a plan-step the V437 orchestrator can run safely.
 */
function decide453(cognition) {
  if (!cognition || !Array.isArray(cognition.concerns)) throw new DiamondError453('invalid cognition', 'BAD_COGNITION');
  const actions = [];
  for (const c of cognition.concerns) {
    if (c.pillar === 'solvency' && (c.severity === 'CRITICAL' || c.severity === 'HIGH')) {
      actions.push({ priority: 'CRITICAL', pillar: 'solvency', capability: 'protection.softPause',
        reason: 'solvency at risk → soft-pause NEW exposure (users can still withdraw their normal quota — anti-Celsius)',
        reversible: true, impact: 'high', requiresAuth: false, args: { reason: 'diamond:solvency_protection' } });
    } else if (c.pillar === 'safety' && c.severity === 'HIGH') {
      actions.push({ priority: 'HIGH', pillar: 'safety', capability: 'safety.arm',
        reason: 'safety interlocks not armed → arm them', reversible: true, impact: 'medium', requiresAuth: false, args: {} });
    } else if (c.pillar === 'economicGuard' && c.severity === 'HIGH') {
      actions.push({ priority: 'HIGH', pillar: 'economicGuard', capability: 'economicGuard.inspect',
        reason: 'economic guard unhealthy → inspect + escalate', reversible: true, impact: 'low', requiresAuth: false, args: {} });
    } else if (c.pillar === 'chat' && c.severity === 'MEDIUM') {
      actions.push({ priority: 'MEDIUM', pillar: 'chat', capability: 'chat.raiseGroundingThresholds',
        reason: 'high correction rate → raise grounding/hedging thresholds (learn from usage)', reversible: true, impact: 'low', requiresAuth: false, args: {} });
    } else if (c.pillar === 'circuitBreaker' && c.detail.includes('approaching')) {
      actions.push({ priority: 'MEDIUM', pillar: 'circuitBreaker', capability: 'monitor.flag',
        reason: 'outflow approaching cap → flag for watch (no action yet)', reversible: true, impact: 'none', requiresAuth: false, args: {} });
    } else if (c.pillar === 'drift') {
      actions.push({ priority: 'LOW', pillar: 'drift', capability: 'monitor.flag',
        reason: 'module drift detected → flag for consolidation review', reversible: true, impact: 'none', requiresAuth: false, args: { detail: c.detail } });
    }
  }
  if (actions.length === 0) actions.push({ priority: 'INFO', pillar: 'system', capability: 'monitor.noop', reason: 'system nominal — no intervention needed', reversible: true, impact: 'none', requiresAuth: false, args: {} });
  const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
  actions.sort((a, b) => order[a.priority] - order[b.priority]);
  return { version: DIAMOND_VERSION_453, posture: cognition.posture, healthScore: cognition.healthScore, actions, actionCount: actions.length };
}

/**
 * Act on decisions THROUGH the V437 orchestrator spine. Dry-run by default (the Diamond
 * proposes); actions flagged requiresAuth, or any action when authorised:false, are
 * previewed not executed. Everything is audit-chained.
 * @param {object} decisions  from decide453
 * @param {{ orchestrator, guard?, breaker?, reserveStatus?, audit?, executors?, authorized?:bool, dryRun?:bool, hitlApproved?:bool }} ctx
 */
function actAutonomously453(decisions, ctx = {}) {
  if (!decisions || !Array.isArray(decisions.actions)) throw new DiamondError453('invalid decisions', 'BAD_DECISIONS');
  if (!ctx.orchestrator || typeof ctx.orchestrator.planFromIntent437 !== 'function') throw new DiamondError453('orchestrator (V437) required', 'NO_ORCHESTRATOR');
  const audit = typeof ctx.audit === 'function' ? ctx.audit : null;
  // Diamond is conservative: execute only when explicitly authorized AND not dry-run.
  const willExecute = ctx.authorized === true && ctx.dryRun === false;

  if (audit) { try { audit('diamond.cognition', { posture: decisions.posture, health: decisions.healthScore, actions: decisions.actionCount, willExecute }); } catch (_) {} }

  // Build a single orchestrator plan from the actions (skip pure monitor/noop steps).
  const steps = decisions.actions
    .filter(a => a.capability && !/^monitor\.(noop|flag)$/.test(a.capability))
    .map((a, i) => ({ id: 'diamond' + (i + 1), capability: a.capability, kind: /credit|ledger|mint|withdraw|payout|reserve/i.test(a.capability) ? 'money' : 'action', args: a.args || {} }));

  const proposals = decisions.actions.map(a => ({ priority: a.priority, capability: a.capability, reason: a.reason, impact: a.impact, reversible: a.reversible, requiresAuth: a.requiresAuth }));

  if (steps.length === 0) {
    if (audit) { try { audit('diamond.act', { executed: 0, mode: 'no-op' }); } catch (_) {} }
    return { version: DIAMOND_VERSION_453, mode: willExecute ? 'execute' : 'propose', executed: 0, proposals, orchestratorResult: null };
  }

  const plan = ctx.orchestrator.planFromIntent437({ steps });
  const result = ctx.orchestrator.executePlan437(plan, {
    guard: ctx.guard, breaker: ctx.breaker, reserveStatus: ctx.reserveStatus,
    audit, executors: ctx.executors || {}, hitlApproved: !!ctx.hitlApproved,
    dryRun: !willExecute,   // propose unless explicitly authorized to execute
  });
  if (audit) { try { audit('diamond.act', { mode: willExecute ? 'execute' : 'propose', executed: result.executed, halted: result.halted }); } catch (_) {} }
  return { version: DIAMOND_VERSION_453, mode: willExecute ? 'execute' : 'propose', proposals, orchestratorResult: result, executed: result.executed };
}

module.exports = {
  DIAMOND_VERSION_453, SEVERITY_453, DiamondError453,
  assessSystem453, decide453, actAutonomously453,
};
