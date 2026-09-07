'use strict';
/**
 * diamondAutonomousGuard467.js — Diamond Autonomous Financial Action Guard V467
 *
 * Extends V466 (Diamond↔Orchestrator sync) with autonomous money-touching steps.
 * When the Diamond Heartbeat detects urgency >= 3 (from proactiveDecisions462),
 * this module generates a preemptive money plan, routes it through the V402 guard
 * (guardMint402 / guardWithdraw402), and executes via the V437 Orchestrator.
 *
 * Rules:
 *  - No new npm deps.
 *  - All identifiers end in 467.
 *  - Fail-closed: missing heartbeat, missing guard, or blocked guard → NO execution.
 *  - Every action is audited via auditLog.
 *  - The agent/diamond never holds keys.
 *  - Money steps are symbolic/preemptive only (small bounded amounts).
 */

const AUTONOMOUS_GUARD_VERSION_467 = '467';

class AutonomousGuardError467 extends Error {
  constructor(msg, code) {
    super(msg);
    this.name = 'AutonomousGuardError467';
    this.code = code || 'GUARD467_ERROR';
    this.statusCode = 500;
  }
}

/* Lazy requires — fail-closed if modules missing */
function _req467(path) { try { return require(path); } catch (_) { return null; } }

function _auditLog467() {
  const mod = _req467('./auditLog.js');
  if (!mod || !mod.defaultAuditLog) return null;
  return (type, payload) => {
    try { mod.defaultAuditLog.append(type, payload); } catch (_) {}
  };
}

function _heartbeat467(opts) {
  if (opts && opts.heartbeat) return opts.heartbeat;
  const mod = _req467('./diamondHeartbeat465.js');
  if (!mod) return null;
  const hb = mod.defaultDiamondHeartbeat465 ? mod.defaultDiamondHeartbeat465() : null;
  if (!hb && opts && opts.create) {
    try {
      const engineMod = _req467('./diamondCognitionEngine462.js');
      const engine = engineMod && engineMod.defaultCognitionEngine462
        ? engineMod.defaultCognitionEngine462({})
        : null;
      return new mod.DiamondHeartbeat465({ cognitionEngine: engine });
    } catch (_) { return null; }
  }
  return hb;
}

function _orchestrator467() {
  const mod = _req467('./moduleOrchestrator437.js');
  return mod || null;
}

function _guard467() {
  const mod = _req467('./economicMutationGuard402.js');
  return mod || null;
}

function _circuitBreaker467() {
  const mod = _req467('./userProtection401.js');
  return (mod && mod.defaultCircuitBreaker401) ? mod.defaultCircuitBreaker401() : null;
}

/**
 * Compute urgency score from the latest heartbeat beat record.
 * Higher = more urgent. Fail-closed: bad data → 0 urgency.
 */
function _computeUrgency467(beat) {
  if (!beat || !beat.trends || !beat.proactive) return { urgency: 0, reason: 'no beat data' };
  let urgency = 0;
  const warnings = beat.trends.earlyWarnings || [];
  // Each early warning with projectionReadingsToDanger <= 2 adds urgency
  for (const w of warnings) {
    if (w.projectionReadingsToDanger != null && w.projectionReadingsToDanger <= 2) {
      urgency += (5 - w.projectionReadingsToDanger);
    }
  }
  // 3+ early warnings is automatically urgent
  if (warnings.length >= 3) urgency = Math.max(urgency, 3);
  // High-priority proactive actions add urgency
  const actions = (beat.proactive.actions || []);
  for (const a of actions) {
    if (a.priority === 'HIGH') urgency += 2;
    else if (a.priority === 'MEDIUM') urgency += 1;
  }
  return { urgency, warningsCount: warnings.length, actionsCount: actions.length };
}

/**
 * Build a preemptive money plan based on urgency and the beat state.
 * Symbolic/preemptive only — small bounded amounts.
 */
function _buildPreemptivePlan467(beat, urgency) {
  const steps = [];
  const state = beat && beat.state ? beat.state : {};
  const solvency = state.solvencySurplus != null ? Number(state.solvencySurplus) : null;

  // If solvency surplus is low or negative, generate a reserve-tightening withdraw step
  if (solvency != null && solvency <= 0) {
    steps.push({
      id: 'preemptive-tighten-467',
      capability: 'diamond.preemptive_tighten',
      kind: 'money',
      args: { userId: 'diamond-autonomous-467', amountMicro: '50000', reason: 'urgency=' + urgency + ': solvency <= 0' },
      direction: 'withdraw',
    });
  }

  // If health is degraded, generate a health-mint step (small, bounded)
  const health = state.healthScore != null ? Number(state.healthScore) : null;
  if (health != null && health < 60) {
    steps.push({
      id: 'preemptive-health-467',
      capability: 'diamond.preemptive_health_inject',
      kind: 'money',
      args: { userId: 'diamond-autonomous-467', amountMicro: '10000', reason: 'urgency=' + urgency + ': health < 60' },
      direction: 'mint',
    });
  }

  // Default: at least one symbolic money step if urgency is high but no specific trigger
  if (steps.length === 0) {
    steps.push({
      id: 'preemptive-default-467',
      capability: 'diamond.preemptive_guard_test',
      kind: 'money',
      args: { userId: 'diamond-autonomous-467', amountMicro: '1000', reason: 'urgency=' + urgency + ': default symbolic step' },
      direction: 'withdraw',
    });
  }

  return { steps };
}

/**
 * Execute autonomous financial action when urgency >= threshold.
 *
 * @param {object} opts
 *   heartbeat — optional injected heartbeat instance
 *   threshold — urgency threshold (default 3)
 *   dryRun    — if true, plan and guard check but do NOT execute ledger mutation
 *   reserveStatus — optional { outstandingMicro, reserveMicro }
 *   hitlApproved  — optional boolean (default false for autonomous)
 * @returns {object} { ok, urgency, plan, execution, version }
 */
function actWithGuard467(opts = {}) {
  const audit = _auditLog467();
  const threshold = typeof opts.threshold === 'number' ? opts.threshold : 3;
  const dryRun = !!opts.dryRun;
  const hitlApproved = !!opts.hitlApproved;

  const hb = _heartbeat467(opts);
  const orch = _orchestrator467();
  const guard = _guard467();

  if (!orch) {
    const err = new AutonomousGuardError467('ModuleOrchestrator437 not available', 'ORCH_MISSING');
    if (audit) audit('guard467.act_error', { code: err.code, error: err.message });
    return { ok: false, error: err.message, code: err.code, version: AUTONOMOUS_GUARD_VERSION_467 };
  }

  if (!guard || !(guard.guardMint402 || guard.guardWithdraw402)) {
    const err = new AutonomousGuardError467('V402 economic guard not available', 'GUARD_MISSING');
    if (audit) audit('guard467.act_error', { code: err.code, error: err.message });
    return { ok: false, error: err.message, code: err.code, version: AUTONOMOUS_GUARD_VERSION_467 };
  }

  if (!hb) {
    const err = new AutonomousGuardError467('DiamondHeartbeat465 not initialized', 'HEARTBEAT_MISSING');
    if (audit) audit('guard467.act_error', { code: err.code, error: err.message });
    return { ok: false, error: err.message, code: err.code, version: AUTONOMOUS_GUARD_VERSION_467 };
  }

  const st = hb.status465 ? hb.status465() : null;
  const beat = st && st.lastBeat ? st.lastBeat : null;
  if (!beat) {
    const err = new AutonomousGuardError467('No heartbeat beat record available', 'BEAT_MISSING');
    if (audit) audit('guard467.act_error', { code: err.code, error: err.message });
    return { ok: false, error: err.message, code: err.code, version: AUTONOMOUS_GUARD_VERSION_467 };
  }

  const urgencyInfo = _computeUrgency467(beat);
  const urgency = urgencyInfo.urgency;

  if (urgency < threshold) {
    if (audit) audit('guard467.act_skipped', { urgency, threshold, reason: 'below threshold' });
    return {
      ok: true,
      acted: false,
      urgency,
      threshold,
      reason: 'urgency below threshold (' + threshold + ')',
      version: AUTONOMOUS_GUARD_VERSION_467,
    };
  }

  // Build preemptive money plan
  let plan;
  try {
    const preemptive = _buildPreemptivePlan467(beat, urgency);
    plan = orch.planFromIntent437({ steps: preemptive.steps });
  } catch (e) {
    const err = new AutonomousGuardError467('planFromIntent437 failed: ' + e.message, 'PLAN_REJECTED');
    if (audit) audit('guard467.act_error', { code: err.code, error: err.message, urgency });
    return { ok: false, error: err.message, code: err.code, version: AUTONOMOUS_GUARD_VERSION_467 };
  }

  // Symbolic executors (no real ledger mutation in this module)
  const executors = {
    'diamond.preemptive_tighten': (args) => ({ ok: true, symbolic: true, action: 'tighten', args }),
    'diamond.preemptive_health_inject': (args) => ({ ok: true, symbolic: true, action: 'health_inject', args }),
    'diamond.preemptive_guard_test': (args) => ({ ok: true, symbolic: true, action: 'guard_test', args }),
  };

  const breaker = _circuitBreaker467();
  const reserveStatus = opts.reserveStatus || null;

  const ctx = {
    audit,
    executors,
    guard,
    breaker,
    reserveStatus,
    hitlApproved,
    dryRun,
  };

  let execution;
  try {
    execution = orch.executePlan437(plan, ctx);
  } catch (e) {
    const err = new AutonomousGuardError467('executePlan437 failed: ' + e.message, 'EXEC_ERROR');
    if (audit) audit('guard467.act_error', { code: err.code, error: err.message, plan, urgency });
    return { ok: false, error: err.message, code: err.code, version: AUTONOMOUS_GUARD_VERSION_467 };
  }

  if (audit) {
    audit('guard467.act_ok', {
      version: AUTONOMOUS_GUARD_VERSION_467,
      urgency,
      threshold,
      planSteps: plan.stepCount,
      moneySteps: plan.moneySteps,
      completed: execution.completed,
      halted: execution.halted,
      executed: execution.executed,
      dryRun,
    });
  }

  return {
    ok: true,
    acted: true,
    version: AUTONOMOUS_GUARD_VERSION_467,
    urgency,
    threshold,
    plan: {
      stepCount: plan.stepCount,
      moneySteps: plan.moneySteps,
      requiresGuard: plan.requiresGuard,
    },
    execution: {
      completed: execution.completed,
      halted: execution.halted,
      haltReason: execution.haltReason,
      executed: execution.executed,
      total: execution.total,
    },
    beatSnapshot: {
      at: beat.at,
      ok: beat.ok,
      healthScore: beat.state && beat.state.healthScore,
      solvencySurplus: beat.state && beat.state.solvencySurplus,
      earlyWarningsCount: beat.trends ? beat.trends.earlyWarningsCount : 0,
    },
  };
}

module.exports = {
  AUTONOMOUS_GUARD_VERSION_467,
  AutonomousGuardError467,
  actWithGuard467,
  _computeUrgency467,
  _buildPreemptivePlan467,
};
