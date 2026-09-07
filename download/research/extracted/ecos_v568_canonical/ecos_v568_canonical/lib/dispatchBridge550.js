'use strict';
/**
 * src/lib/agentDispatchBridge550.js — ECOS V550 (Phase P268)
 * Agent Dispatch Bridge — gated executePlan437
 *
 * Problem: diamondAutonomousGuard467 and diamondOrchestratorBridge466 call
 * executePlan437 DIRECTLY, bypassing the policy gate stack (gate547→548→549).
 * Every autonomous action should pass through gatePlan549 for:
 *   • policy evaluation (deepHealthPolicy546)
 *   • decision logging (recordDecision548 / policyLog548)
 *   • structured gate result (ALLOWED / BLOCKED / DEGRADED)
 *
 * This module provides:
 *   dispatchPlan550(plan, ctx, opts) — drop-in gated wrapper for executePlan437.
 *     - If gate549 returns ALLOWED → runs executePlan437 and returns result.
 *     - If BLOCKED/DEGRADED → fails-closed (throws GateBlockedError550).
 *     - If gate unavailable → falls back to executePlan437 directly (degraded mode).
 *   getDispatchStats550() — live stats: calls, allowed, blocked, fallbacks.
 *
 * Usage (in future IIFEs that replace direct executePlan437 callers):
 *   const { dispatchPlan550 } = require('./agentDispatchBridge550.js');
 *   const result = dispatchPlan550(plan, ctx, { authorized: true, audit });
 *
 * All identifiers end in 550. Zero new npm deps. SACRED untouched.
 * @version 550.0.0
 */

const BRIDGE_DISPATCH_VERSION_550 = '550.0.0';

// ── runtime state ─────────────────────────────────────────────────────────────
const _stats550 = { calls: 0, allowed: 0, blocked: 0, fallback: 0, errors: 0 };

// ── lazy-load dependencies (fail-safe) ────────────────────────────────────────
let _gate549 = null, _orch437 = null, _loadErr550 = null;
function _loadDeps550() {
  if (_gate549 && _orch437) return true;
  try {
    _gate549 = require('./orchestratorPolicyGate549.js');
    _orch437 = require('./moduleOrchestrator437.js');
    return true;
  } catch (e) {
    _loadErr550 = e.message;
    return false;
  }
}

// ── error type ─────────────────────────────────────────────────────────────────
class GateBlockedError550 extends Error {
  constructor(msg, code, gateResult) {
    super(msg);
    this.name   = 'GateBlockedError550';
    this.code   = code || 'GATE_BLOCKED';
    this.gateResult = gateResult || null;
    this.statusCode = 403;
  }
}

/**
 * dispatchPlan550(plan, ctx, opts) — gated drop-in for executePlan437.
 *
 * @param {object} plan  — plan object (steps[])
 * @param {object} ctx   — execution context
 * @param {object} opts
 *   opts.authorized   {boolean} — must be true for execution (fail-closed otherwise)
 *   opts.audit        {function} — optional audit(type, payload)
 *   opts.allowFallback {boolean} — if true, fall back to direct executePlan437 when
 *                                  gate unavailable (default: true for backwards-compat)
 */
function dispatchPlan550(plan, ctx = {}, opts = {}) {
  _stats550.calls++;

  if (!plan || !Array.isArray(plan.steps)) {
    _stats550.errors++;
    throw new GateBlockedError550('dispatchPlan550: plan.steps must be an array', 'INVALID_PLAN');
  }

  const auditFn550 = typeof opts.audit === 'function' ? opts.audit : null;
  const allowFallback550 = opts.allowFallback !== false; // default true

  // ── load deps ────────────────────────────────────────────────────────────────
  const depsOk = _loadDeps550();

  if (!depsOk) {
    // Deps unavailable — fallback or fail-closed
    if (allowFallback550) {
      _stats550.fallback++;
      if (auditFn550) auditFn550('dispatch.fallback.nodeps', { version: '550', error: _loadErr550 });
      // Re-try direct load for executePlan437 only
      try {
        const orch = require('./moduleOrchestrator437.js');
        return orch.executePlan437(plan, ctx);
      } catch (e) {
        _stats550.errors++;
        throw new GateBlockedError550('agentDispatchBridge550: both gate and direct path unavailable: ' + e.message, 'DEPS_UNAVAILABLE');
      }
    }
    _stats550.blocked++;
    throw new GateBlockedError550('agentDispatchBridge550: gate deps unavailable and fallback disabled', 'DEPS_UNAVAILABLE');
  }

  // ── run through gate549 ───────────────────────────────────────────────────────
  const gateResult550 = _gate549.gatePlan549(plan, {
    ...ctx,
    authorized:   opts.authorized === true,
    audit:        auditFn550,
    dispatchedBy: 'agentDispatchBridge550',
  });

  if (gateResult550.status === 'ALLOWED') {
    _stats550.allowed++;
    // gatePlan549 already called executePlan437 internally; return its execution result
    return gateResult550.execution !== undefined
      ? gateResult550.execution
      : gateResult550; // gate returned the result directly
  }

  // BLOCKED or DEGRADED → fail-closed
  _stats550.blocked++;
  if (auditFn550) auditFn550('dispatch.blocked', { status: gateResult550.status, reason: gateResult550.reason, version: '550' });
  throw new GateBlockedError550(
    `dispatchPlan550: gate returned ${gateResult550.status} — ${gateResult550.reason || 'no reason'}`,
    'GATE_' + (gateResult550.status || 'BLOCKED'),
    gateResult550,
  );
}

/**
 * getDispatchStats550() — cumulative stats since process start.
 */
function getDispatchStats550() {
  return { ..._stats550, version: BRIDGE_DISPATCH_VERSION_550 };
}

module.exports = {
  BRIDGE_DISPATCH_VERSION_550,
  GateBlockedError550,
  dispatchPlan550,
  getDispatchStats550,
};
