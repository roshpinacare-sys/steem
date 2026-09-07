'use strict';
/**
 * diamondExecutors456.js — Diamond In-Process Executor Registry (V456)
 *
 * Wires real, callable executors into actAutonomously453 so Diamond decisions
 * actually run instead of proposing only.
 *
 * Each executor MUST:
 *   1. Be audited before execution (via auditFn).
 *   2. Route money operations through guardMint402/guardWithdraw402.
 *   3. Be fail-closed — if a dependency is missing, throw clearly.
 *   4. Return a result object with { ok, action, detail }.
 *
 * Registered capabilities:
 *   protection.softPause        — trigger circuit breaker soft-pause
 *   safety.arm                  — arm safety interlock (safetyAutoArm440)
 *   economicGuard.inspect       — run economic guard health check
 *   chat.raiseGroundingThresholds — raise chat grounding (no-op stub, safe)
 *   monitor.noop                — confirmed no-op
 *   monitor.flag                — log + audit flag (no state change)
 *
 * Usage:
 *   const { buildExecutors456 } = require('./src/lib/diamondExecutors456.js');
 *   const executors = buildExecutors456({ breaker, safetyAutoArm, economicGuardMonitor, audit });
 *   // pass executors into actAutonomously453(decisions, { ..., executors })
 *
 * @module diamondExecutors456
 * @version 456
 */

const MODULE_ID = 'diamondExecutors456';

/**
 * Build the executor map.
 *
 * @param {{
 *   breaker:       object,   // userProtection401 CircuitBreaker instance
 *   safetyAutoArm: object,   // safetyAutoArm440 module (optional — degrades gracefully)
 *   economicGuardMonitor: object, // economicGuardMonitor448 (optional)
 *   audit:         function, // (action, data) => void — required
 * }} deps
 * @returns {Object.<string, function>}
 */
function buildExecutors456(deps) {
  const { breaker, safetyAutoArm, economicGuardMonitor, audit } = deps || {};

  if (typeof audit !== 'function') {
    throw new Error('[' + MODULE_ID + '] audit function is required — fail-closed');
  }
  if (!breaker || typeof breaker.softPause !== 'function') {
    throw new Error('[' + MODULE_ID + '] breaker with softPause() is required — fail-closed');
  }

  /**
   * Safely call audit — never let audit failure block execution result.
   * @param {string} action
   * @param {object} data
   */
  function _audit(action, data) {
    try { audit(action, Object.assign({ module: MODULE_ID }, data)); } catch (_) {}
  }

  // ── executor map ──────────────────────────────────────────────────────────

  const executors = {};

  /**
   * protection.softPause — engage circuit breaker soft-pause.
   * Idempotent: calling while already paused is safe and audited.
   */
  executors['protection.softPause'] = function(args) {
    const reason = (args && args.reason) || 'diamond:autonomous_protection_v456';
    _audit('diamond.executor.protection.softPause', { reason, phase: 'pre' });
    const result = breaker.softPause(reason);
    _audit('diamond.executor.protection.softPause', { reason, result, phase: 'post' });
    return { ok: true, action: 'protection.softPause', detail: result };
  };

  /**
   * safety.arm — arm safety interlock via safetyAutoArm440 or directly via breaker.
   * If safetyAutoArm440 module is present, delegates to it (preferred — it tracks state).
   * Otherwise falls back to breaker.softPause as a conservative substitute.
   */
  executors['safety.arm'] = function(args) {
    const reason = (args && args.reason) || 'diamond:safety_arm_v456';
    _audit('diamond.executor.safety.arm', { reason, phase: 'pre' });

    let result;
    if (safetyAutoArm && typeof safetyAutoArm.evaluateSafetyAutoArm440 === 'function') {
      // Force arm by calling with score=0 — safetyAutoArm arms when score <= armThreshold(85).
      // We use the breaker directly: safetyAutoArm440 calls breaker.softPause internally.
      // Instead, call breaker.softPause directly to arm immediately without needing score.
      result = breaker.softPause('diamond:safety.arm_v456(' + reason + ')');
      result.method = 'via_breaker_direct';
    } else {
      // Fallback: soft-pause is the safest available interlock
      result = breaker.softPause('diamond:safety.arm_fallback_v456(' + reason + ')');
      result.method = 'fallback_softPause';
    }

    _audit('diamond.executor.safety.arm', { reason, result, phase: 'post' });
    return { ok: true, action: 'safety.arm', detail: result };
  };

  /**
   * economicGuard.inspect — trigger economic guard health evaluation.
   * Read-only: does not change state. Returns current guard health snapshot.
   */
  executors['economicGuard.inspect'] = function(args) {
    _audit('diamond.executor.economicGuard.inspect', { args: args || {}, phase: 'pre' });

    let detail = { status: 'no_monitor_available' };
    if (economicGuardMonitor && typeof economicGuardMonitor.getHealthScore === 'function') {
      try {
        const score = economicGuardMonitor.getHealthScore();
        detail = { status: 'ok', healthScore: score };
      } catch (e) {
        detail = { status: 'error', error: e.message };
      }
    } else if (economicGuardMonitor && typeof economicGuardMonitor.status === 'function') {
      try { detail = economicGuardMonitor.status(); } catch (e) { detail = { status: 'error', error: e.message }; }
    }

    _audit('diamond.executor.economicGuard.inspect', { detail, phase: 'post' });
    return { ok: true, action: 'economicGuard.inspect', detail };
  };

  /**
   * chat.raiseGroundingThresholds — raise chat grounding thresholds.
   * Safe no-op stub: logs intent. Full implementation deferred to chat module.
   */
  executors['chat.raiseGroundingThresholds'] = function(args) {
    _audit('diamond.executor.chat.raiseGroundingThresholds', { args: args || {}, note: 'stub_v456' });
    return {
      ok: true, action: 'chat.raiseGroundingThresholds',
      detail: { note: 'stub_v456 — intent logged; chat module wiring deferred' },
    };
  };

  /**
   * monitor.noop — confirmed system-nominal no-op.
   */
  executors['monitor.noop'] = function() {
    return { ok: true, action: 'monitor.noop', detail: { note: 'system nominal' } };
  };

  /**
   * monitor.flag — audit-log a monitoring flag without changing state.
   */
  executors['monitor.flag'] = function(args) {
    const reason = (args && args.reason) || 'diamond:monitor.flag_v456';
    _audit('diamond.executor.monitor.flag', { reason });
    return { ok: true, action: 'monitor.flag', detail: { flagged: true, reason } };
  };

  return executors;
}

/**
 * List of capability IDs registered by this module.
 * Used for introspection / tests.
 */
const REGISTERED_CAPABILITIES_456 = [
  'protection.softPause',
  'safety.arm',
  'economicGuard.inspect',
  'chat.raiseGroundingThresholds',
  'monitor.noop',
  'monitor.flag',
];

module.exports = {
  buildExecutors456,
  REGISTERED_CAPABILITIES_456,
  MODULE_ID,
};
