'use strict';
/**
 * src/lib/safetyArmSync457.js — ECOS V457
 *
 * Safety Arm State Sync — חיבור executor safety.arm ל-_state440
 *
 * הבעיה: כשה-Diamond מפעיל safety.arm דרך diamondExecutors456, הוא קורא
 * ישירות ל-breaker.softPause(). כתוצאה מכך safetyAutoArm440._state440 לא
 * יודע שמצב arm הופעל — הוא ממשיך להציג autoArmed:false.
 *
 * הפתרון (V457): buildSafetyArmSync457 מחזיר executor מחודש לכלביה
 * 'safety.arm' שגם מפעיל את breaker.softPause וגם מעדכן _state440
 * ישירות עם action='arm', ומוסיף רשומת היסטוריה.
 *
 * שימוש:
 *   const { buildSafetyArmSync457 } = require('./safetyArmSync457.js');
 *   executors['safety.arm'] = buildSafetyArmSync457({ breaker, safetyAutoArm440, audit });
 *
 * R1: sacred files untouched. R2: all identifiers end in 457.
 * R3: zero new npm deps. R4: fail-closed (no breaker → throws).
 *
 * @module safetyArmSync457
 * @version 457
 */

const MODULE_ID457 = 'safetyArmSync457';

/**
 * buildSafetyArmSync457(deps)
 *
 * @param {{
 *   breaker:        object,    // userProtection401 CircuitBreaker instance — required
 *   safetyAutoArm:  object,    // safetyAutoArm440 module export — required for sync
 *   audit:          function,  // (action, data) => void — required
 * }} deps
 * @returns {function} — executor for 'safety.arm' capability
 */
function buildSafetyArmSync457(deps) {
  const { breaker, safetyAutoArm, audit } = deps || {};

  if (!breaker || typeof breaker.softPause !== 'function') {
    throw new Error('[' + MODULE_ID457 + '] breaker with softPause() is required — fail-closed');
  }
  if (typeof audit !== 'function') {
    throw new Error('[' + MODULE_ID457 + '] audit function is required — fail-closed');
  }

  // state440 reference — the shared mutable object from safetyAutoArm440
  const state440 = (safetyAutoArm && safetyAutoArm._state440) || null;

  /**
   * _syncArm457 — update _state440 to reflect that an arm occurred externally.
   * Called after breaker.softPause() succeeds.
   * @param {string} reason
   */
  function _syncArm457(reason) {
    if (!state440) { return; }
    try {
      const ts = Date.now();
      state440.autoArmed   = true;
      state440.lastCheckTs = ts;
      state440.lastReason  = 'diamond:safety.arm_synced_v457';

      // Push a history entry matching checkAndAutoArm440 format
      const entry457 = {
        ts:     ts,
        score:  state440.lastScore !== null ? state440.lastScore : 0,
        status: 'diamond_armed',
        action: 'arm',
        reason: 'diamond:safety.arm_v457(' + reason + ')',
      };
      if (Array.isArray(state440.history)) {
        state440.history.push(entry457);
        if (state440.history.length > (state440.maxHistory || 200)) {
          state440.history.shift();
        }
      }
    } catch (_) {
      // _syncArm457 must never throw — breaker pause already succeeded
    }
  }

  /**
   * The replacement safety.arm executor.
   * 1. Audits pre-action.
   * 2. Calls breaker.softPause().
   * 3. Syncs _state440 so safetyAutoArm440 knows the system is armed.
   * 4. Audits post-action with sync result.
   *
   * @param {object} [args]
   * @param {string} [args.reason]
   * @returns {{ ok: boolean, action: string, detail: object }}
   */
  function safetyArmExecutor457(args) {
    const reason = (args && args.reason) || 'diamond:safety_arm_v457';

    try { audit('diamond.executor.safety.arm.v457', { reason, phase: 'pre', module: MODULE_ID457 }); } catch (_) {}

    // 1. Engage circuit breaker (primary safety action — must succeed)
    const pauseResult = breaker.softPause('diamond:safety.arm_v457(' + reason + ')');

    // 2. Sync _state440 so safetyAutoArm440 tracks this arm
    const hadState = !!state440;
    _syncArm457(reason);

    try {
      audit('diamond.executor.safety.arm.v457', {
        reason,
        phase:        'post',
        pauseResult:  pauseResult,
        stateSynced:  hadState,
        module:       MODULE_ID457,
      });
    } catch (_) {}

    return {
      ok:     true,
      action: 'safety.arm',
      detail: {
        pauseResult:  pauseResult,
        stateSynced:  hadState,
        method:       'via_breaker_and_state440_sync_v457',
      },
    };
  }

  return safetyArmExecutor457;
}

/**
 * getSafetyArmSyncStatus457(safetyAutoArm440Module)
 * Convenience: returns current _state440 snapshot for introspection.
 * @param {object} safetyAutoArm440Module
 * @returns {{ ok: boolean, version: string, stateAvailable: boolean, state: object|null }}
 */
function getSafetyArmSyncStatus457(safetyAutoArm440Module) {
  const state = (safetyAutoArm440Module && safetyAutoArm440Module._state440) || null;
  return {
    ok:             true,
    version:        '457',
    module:         MODULE_ID457,
    stateAvailable: !!state,
    state:          state ? JSON.parse(JSON.stringify(state)) : null,
  };
}

module.exports = {
  buildSafetyArmSync457,
  getSafetyArmSyncStatus457,
  MODULE_ID457,
};
