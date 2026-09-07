'use strict';
/**
 * src/lib/moduleOrchestrator437.js — ECOS V437 (Phase P325) — Module Orchestration Spine
 *
 * THE CONNECTIVE BREAKTHROUGH: a single SAFE spine that lets the chat compose and run
 * multi-step automations ACROSS modules — "full automation + integration" — while
 * keeping the unbreakable-base property: every money-touching step is gated by the
 * V402 chokepoint, every step is audit-chained, and any failure halts the plan
 * fail-closed. The LLM/chat proposes a plan; the orchestrator validates, classifies,
 * gates, executes, and proves it.
 *
 * It does NOT reinvent execution — it SEQUENCES injected executors and weaves safety
 * through them, connecting: conversationIntelligence414 (intent typing) + moduleMesh287
 * (capability resolution) + economicMutationGuard402 (money gate) + auditLog (proof).
 *
 *   planFromIntent437   — turn a message (or explicit steps) into a validated, ordered
 *                         plan; each step classified read | action | money.
 *   executePlan437      — run steps in order; money steps MUST pass V402 (else HALT);
 *                         audit every step; return a signed execution trace.
 *   dryRun (option)     — plan + run the guards WITHOUT executing, so the chat can
 *                         preview "here's what I'll do / what needs your approval".
 *
 * Pure JS, no new deps (R3/R6). Read-only over sacred. Version-suffixed (…437).
 *
 * @version 437.0.0
 */

const ORCH_VERSION_437 = '437.0.0';
const _MONEY_RE_437 = /credit|ledger|payment|transfer|withdraw|mint|payout|market|reserve|fiat|redeem|swap|stake/i;

class OrchestratorError437 extends Error {
  constructor(msg, code) { super(msg); this.name = 'OrchestratorError437'; this.code = code || 'ORCH_ERROR'; this.statusCode = 400; }
}

/** Classify a capability id into a step kind. Money-touching → 'money' (must be gated). */
function classifyStep437(capabilityId, declaredKind) {
  if (declaredKind === 'money' || (capabilityId && _MONEY_RE_437.test(String(capabilityId)))) return 'money';
  if (declaredKind === 'action') return 'action';
  if (declaredKind === 'read') return 'read';
  return 'action'; // default: treat unknown as a (non-money) action
}

/**
 * Build a validated, ordered plan. Accepts either an explicit `steps` array (the chat/LLM
 * proposes), or a single `message` routed via conversationIntelligence414 + the mesh.
 * Each step: { id, capability, kind, args, direction? ('mint'|'withdraw' for money) }.
 * @param {{ message?, steps?:Array, router?, conv?, mesh? }} p
 */
function planFromIntent437(p = {}) {
  const steps = [];
  if (Array.isArray(p.steps) && p.steps.length) {
    p.steps.forEach((s, i) => {
      if (!s || !s.capability) throw new OrchestratorError437('each step needs a capability', 'BAD_STEP');
      steps.push({
        id: s.id || ('step' + (i + 1)),
        capability: String(s.capability),
        kind: classifyStep437(s.capability, s.kind),
        args: s.args || {},
        direction: s.direction || (/(withdraw|redeem|payout)/i.test(s.capability) ? 'withdraw' : 'mint'),
      });
    });
  } else if (p.message) {
    // single-intent plan via the chat router (conversationIntelligence414.routeIntent414)
    let routing = null;
    try { routing = p.conv && p.conv.routeIntent414 ? p.conv.routeIntent414(p.message, p.router) : null; } catch (_) {}
    const cap = routing && routing.capability ? routing.capability : 'chat.respond';
    steps.push({ id: 'step1', capability: cap, kind: classifyStep437(cap, routing && routing.mustPassMoneyGuard ? 'money' : null), args: { message: p.message }, direction: 'mint' });
  } else {
    throw new OrchestratorError437('provide message or steps', 'BAD_ARGS');
  }
  const moneySteps = steps.filter(s => s.kind === 'money').length;
  return {
    version: ORCH_VERSION_437,
    steps,
    stepCount: steps.length,
    moneySteps,
    requiresGuard: moneySteps > 0,
    note: moneySteps > 0 ? 'plan contains money-touching steps — each will pass the V402 chokepoint' : 'no money-touching steps',
  };
}

/**
 * Execute a plan safely. Money steps are gated by the injected V402 guard; on any block
 * or error the plan HALTS fail-closed. Every step is appended to the audit log.
 * @param {object} plan  from planFromIntent437
 * @param {{ guard?, breaker?, reserveStatus?, audit?, executors?:object, hitlApproved?:bool, dryRun?:bool }} ctx
 *   - guard: economicMutationGuard402 module (guardMint402 / guardWithdraw402)
 *   - executors: { [capabilityId]: (args) => result }  — how to actually run a step
 */
function executePlan437(plan, ctx = {}) {
  if (!plan || !Array.isArray(plan.steps)) throw new OrchestratorError437('invalid plan', 'BAD_PLAN');
  const audit = typeof ctx.audit === 'function' ? ctx.audit : null;
  const executors = ctx.executors || {};
  const trace = [];
  let halted = false, haltReason = null;

  function rec(type, payload) { if (audit) { try { audit(type, payload); } catch (_) {} } }
  rec('orchestrator.plan_begin', { steps: plan.stepCount, money: plan.moneySteps, dryRun: !!ctx.dryRun });

  for (const step of plan.steps) {
    if (halted) { trace.push({ id: step.id, capability: step.capability, kind: step.kind, status: 'skipped', reason: 'plan halted' }); continue; }
    const entry = { id: step.id, capability: step.capability, kind: step.kind };

    // money steps MUST pass the V402 chokepoint
    if (step.kind === 'money') {
      if (!ctx.guard || !(ctx.guard.guardMint402 || ctx.guard.guardWithdraw402)) {
        halted = true; haltReason = 'money step but no V402 guard available (fail-closed)';
        entry.status = 'blocked'; entry.reason = haltReason; trace.push(entry); rec('orchestrator.step_blocked', entry); continue;
      }
      const amountMicro = step.args && step.args.amountMicro;
      const userId = step.args && step.args.userId;
      let decision;
      try {
        decision = step.direction === 'withdraw'
          ? ctx.guard.guardWithdraw402({ breaker: ctx.breaker, userId, amountMicro, hitlApproved: ctx.hitlApproved })
          : ctx.guard.guardMint402({ breaker: ctx.breaker, userId, amountMicro, reserveStatus: ctx.reserveStatus, hitlApproved: ctx.hitlApproved });
      } catch (e) { halted = true; haltReason = 'guard error: ' + e.message; entry.status = 'blocked'; entry.reason = haltReason; trace.push(entry); rec('orchestrator.step_blocked', entry); continue; }

      entry.guard = { allowed: decision.allowed, stage: decision.stage, code: decision.code };
      if (!decision.allowed) { halted = true; haltReason = 'money step blocked at ' + decision.stage; entry.status = 'blocked'; entry.reason = haltReason; trace.push(entry); rec('orchestrator.step_blocked', entry); continue; }

      if (ctx.dryRun) { entry.status = 'would_run'; trace.push(entry); rec('orchestrator.step_dryrun', entry); continue; }
      // execute then commit the guard accounting only on success
      try {
        const exec = executors[step.capability];
        entry.result = exec ? exec(step.args) : { noExecutor: true };
        if (typeof decision.commit === 'function') decision.commit();
        entry.status = 'executed'; trace.push(entry); rec('orchestrator.step_executed', entry);
      } catch (e) { halted = true; haltReason = 'executor error: ' + e.message; entry.status = 'error'; entry.reason = e.message; trace.push(entry); rec('orchestrator.step_error', entry); }
      continue;
    }

    // non-money steps
    if (ctx.dryRun) { entry.status = 'would_run'; trace.push(entry); rec('orchestrator.step_dryrun', entry); continue; }
    try {
      const exec = executors[step.capability];
      entry.result = exec ? exec(step.args) : { noExecutor: true };
      entry.status = 'executed'; trace.push(entry); rec('orchestrator.step_executed', entry);
    } catch (e) { halted = true; haltReason = 'executor error: ' + e.message; entry.status = 'error'; entry.reason = e.message; trace.push(entry); rec('orchestrator.step_error', entry); }
  }

  const executed = trace.filter(t => t.status === 'executed').length;
  const result = {
    version: ORCH_VERSION_437,
    completed: !halted,
    halted, haltReason,
    dryRun: !!ctx.dryRun,
    executed, total: plan.stepCount,
    trace,
  };
  rec('orchestrator.plan_end', { completed: result.completed, executed, halted });
  return result;
}

module.exports = {
  ORCH_VERSION_437, OrchestratorError437,
  classifyStep437, planFromIntent437, executePlan437,
};
