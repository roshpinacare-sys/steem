'use strict';
/**
 * src/lib/diamondGovernanceCycle499.js — ECOS V499 (Phase P378) — Diamond Governance Cycle
 *
 * THE CAPSTONE. Until now the Diamond's parts ran separately: assessSystem453 (economic
 * cognition), diamondCodeHealthSignal498 (technical debt), decide453 (economic actions),
 * proposeCleanup498 (cleanup), actAutonomously453 (execution through the orchestrator). Each
 * had its own endpoint. This unifies them into ONE bounded autonomous governance cycle so the
 * sovereign operator manages the economy AND the codebase in a single audit-chained loop —
 * exactly the vision: an AI that manages everything, automatically, within the unbreakable base.
 *
 *   runGovernanceCycle499(signals, ctx) →
 *     1. cognition  = assessSystem453(signals)              (economy)
 *     2. cognition += code-health (augmentCognition498)     (codebase, bounded — never outranks money)
 *     3. decisions  = decide453(economic) ⊕ proposeCleanup498(codeHealth)   (one ranked plan)
 *     4. result     = actAutonomously453(decisions, …)      (through V437 → V402 → audit)
 *   Conservative by inheritance: proposes by default; executes only when authorized; cleanup
 *   actions stay proposal-only (chain flatten needs a human). Every cycle is audit-chained.
 *
 * Reuses V453 + V498 + V437 (no reinvention). Pure JS, no new deps (R3/R6).
 * Read-only over sacred. Version-suffixed (…499).
 *
 * @version 499.0.0
 */

const GOVERNANCE_VERSION_499 = '499.0.0';
let _D499 = null, _CH499 = null;
try { _D499 = require('./sovereignOperatorDiamond453.js'); } catch (_) {}
try { _CH499 = require('./diamondCodeHealthSignal498.js'); } catch (_) {}

class GovernanceError499 extends Error {
  constructor(msg, code) { super(msg); this.name = 'GovernanceError499'; this.code = code || 'GOVERNANCE_ERROR'; this.statusCode = 400; }
}

/**
 * Run one unified governance cycle: economy + code-health → ranked decisions → bounded action.
 * @param {object} signals  pillar signals for assessSystem453
 * @param {{ orchestrator, guard?, breaker?, reserveStatus?, audit?, executors?, authorized?:bool,
 *           dryRun?:bool, hitlApproved?:bool, codeHealth?:object, includeCleanup?:bool }} ctx
 */
function runGovernanceCycle499(signals = {}, ctx = {}) {
  if (!_D499 || typeof _D499.assessSystem453 !== 'function') throw new GovernanceError499('sovereignOperatorDiamond453 required', 'NO_DIAMOND');
  if (!ctx.orchestrator) throw new GovernanceError499('orchestrator (V437) required', 'NO_ORCHESTRATOR');
  const audit = typeof ctx.audit === 'function' ? ctx.audit : null;

  // 1+2: economic cognition, enriched with code-health (bounded — debt never outranks money/safety)
  let cognition = _D499.assessSystem453(signals);
  let codeHealth = ctx.codeHealth || null;
  if (_CH499 && _CH499.gatherCodeHealth498 && codeHealth == null) {
    try { codeHealth = _CH499.gatherCodeHealth498(ctx.codeHealthOpts || {}); } catch (_) { codeHealth = null; }
  }
  if (codeHealth && _CH499 && _CH499.augmentCognition498) {
    try { cognition = _CH499.augmentCognition498(cognition, codeHealth); } catch (_) {}
  }

  // 3: merged, ranked decisions — economic governance first, then code-health cleanup (proposal-only)
  const econ = _D499.decide453(cognition);
  let cleanup = { actions: [] };
  const includeCleanup = ctx.includeCleanup !== false;
  if (includeCleanup && codeHealth && _CH499 && _CH499.proposeCleanup498) {
    try { cleanup = _CH499.proposeCleanup498(codeHealth); } catch (_) { cleanup = { actions: [] }; }
  }
  // cleanup actions are advisory: force proposal-only (never auto-execute destructive cleanup)
  const cleanupActions = (cleanup.actions || []).filter(a => a.capability && a.capability !== 'monitor.noop')
    .map(a => Object.assign({}, a, { requiresAuth: true, advisory: true }));
  const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
  const mergedActions = (econ.actions || []).concat(cleanupActions).sort((a, b) => (order[a.priority] ?? 9) - (order[b.priority] ?? 9));
  const decisions = { version: GOVERNANCE_VERSION_499, posture: cognition.posture, healthScore: cognition.healthScore, actions: mergedActions, actionCount: mergedActions.length };

  if (audit) { try { audit('diamond.governance_cycle', { posture: cognition.posture, health: cognition.healthScore, econActions: (econ.actions || []).length, cleanupProposals: cleanupActions.length }); } catch (_) {} }

  // 4: act through the spine (proposes unless authorized; cleanup always proposal-only via requiresAuth)
  const result = _D499.actAutonomously453(decisions, {
    orchestrator: ctx.orchestrator, guard: ctx.guard, breaker: ctx.breaker, reserveStatus: ctx.reserveStatus,
    audit, executors: ctx.executors || {}, authorized: ctx.authorized === true,
    dryRun: ctx.authorized === true ? (ctx.dryRun !== false) : true, hitlApproved: !!ctx.hitlApproved,
  });

  return {
    version: GOVERNANCE_VERSION_499,
    cognition: { posture: cognition.posture, healthScore: cognition.healthScore, concerns: cognition.concerns, codeHealth: cognition.codeHealth || codeHealth },
    decisions, action: result,
    summary: `posture=${cognition.posture} health=${cognition.healthScore} · ${(econ.actions || []).length} economic + ${cleanupActions.length} cleanup proposal(s) · mode=${result.mode}`,
  };
}

module.exports = {
  GOVERNANCE_VERSION_499, GovernanceError499, runGovernanceCycle499,
};
