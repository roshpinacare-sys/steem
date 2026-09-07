'use strict';
/**
 * lib/safetyUnpauseSync458.js — ECOS V458
 *
 * Safety Unpause Sync — executor לפריקת soft-pause עם סינכרון _state440
 *
 * הבעיה: אחרי safety.arm (V457), המערכת נמצאת ב-soft-pause ו-_state440.autoArmed=true.
 * אין executor מוגדר ל-protection.unpause ב-Diamond — כך שמחזור ARM→RECOVER→UNPAUSE
 * לא היה שלם. הסוכן לא יכול היה לשחרר את המצב בצורה מאומתת.
 *
 * הפתרון (V458): buildSafetyUnpauseSync458 מחזיר executor ל-'protection.unpause':
 *   1. דורש hitlApproved=true (fail-closed אם חסר)
 *   2. קורא ל-breaker.unpause()
 *   3. מסנכרן _state440.autoArmed=false + מוסיף היסטוריה
 *   4. מבצע audit
 *
 * שימוש:
 *   const { buildSafetyUnpauseSync458 } = require('./safetyUnpauseSync458.js');
 *   executors['protection.unpause'] = buildSafetyUnpauseSync458({ breaker, safetyAutoArm, audit });
 *   // לאחר מכן: POST /diamond/act/v458 {authorized:true, hitlApproved:true}
 *   //            → Diamond מחליט protection.unpause → _state440.autoArmed=false
 *
 * R1: sacred files untouched. R2: all identifiers end in 458.
 * R3: zero new npm deps. R4: fail-closed (hitlApproved required, no breaker → throws).
 *
 * @module safetyUnpauseSync458
 * @version 458
 */

const MODULE_ID458 = 'safetyUnpauseSync458';

/**
 * buildSafetyUnpauseSync458(deps)
 *
 * @param {{
 *   breaker:       object,    // userProtection401 CircuitBreaker — required, must have unpause()
 *   safetyAutoArm: object,    // safetyAutoArm440 module export — for _state440 sync (optional)
 *   audit:         function,  // (action, data) => void — required
 * }} deps
 * @returns {function} — executor for 'protection.unpause' capability
 */
function buildSafetyUnpauseSync458(deps) {
  const { breaker, safetyAutoArm, audit } = deps || {};

  if (!breaker || typeof breaker.unpause !== 'function') {
    throw new Error('[' + MODULE_ID458 + '] breaker with unpause() is required — fail-closed');
  }
  if (typeof audit !== 'function') {
    throw new Error('[' + MODULE_ID458 + '] audit function is required — fail-closed');
  }

  // _state440 reference — shared mutable object from safetyAutoArm440
  const state440 = (safetyAutoArm && safetyAutoArm._state440) || null;

  /**
   * _syncUnpause458 — update _state440 to reflect that system was unpaused.
   * Called after breaker.unpause() succeeds.
   * @param {string} reason
   */
  function _syncUnpause458(reason) {
    if (!state440) { return; }
    try {
      const ts = Date.now();
      state440.autoArmed = false;
      if (Array.isArray(state440.history)) {
        state440.history.push({
          action:    'unpause',
          source:    MODULE_ID458,
          reason:    reason || 'diamond:protection.unpause_v458',
          ts:        ts,
          autoArmed: false,
        });
        // שמור היסטוריה מוגבלת (100 רשומות מקסימום)
        if (state440.history.length > 100) {
          state440.history = state440.history.slice(-100);
        }
      }
    } catch (_) {
      // never block executor on sync failure
    }
  }

  /**
   * executor458 — the actual executor function for 'protection.unpause'.
   *
   * HITL gate: hitlApproved must be true, otherwise fail-closed.
   *
   * @param {object} args - { reason, hitlApproved }
   * @returns {{ ok:boolean, action:string, detail:object }}
   */
  function executor458(args) {
    const reason       = (args && args.reason)       || 'diamond:protection.unpause_v458';
    const hitlApproved = (args && args.hitlApproved) === true;

    audit('diamond.executor.protection.unpause', {
      module: MODULE_ID458,
      reason,
      hitlApproved,
      phase: 'pre',
    });

    // HITL gate — fail-closed: unpause requires explicit human approval
    if (!hitlApproved) {
      const err = new Error('[' + MODULE_ID458 + '] protection.unpause requires hitlApproved=true — BLOCKED');
      err.code = 'HITL_REQUIRED';
      err.statusCode = 403;
      throw err;
    }

    // Perform unpause
    const result = breaker.unpause();

    // Sync _state440
    _syncUnpause458(reason);

    audit('diamond.executor.protection.unpause', {
      module: MODULE_ID458,
      reason,
      result,
      phase: 'post',
    });

    return {
      ok:     true,
      action: 'protection.unpause',
      detail: Object.assign({ hitlApproved: true, reason }, result || {}),
    };
  }

  return executor458;
}

/**
 * getSafetyUnpauseStatus458(safetyAutoArm)
 * מחזיר snapshot של מצב ה-unpause הנוכחי — לשימוש endpoint סטטוס.
 *
 * @param {object|null} safetyAutoArm
 * @returns {{ autoArmed:boolean|null, lastUnpause:object|null, historyCount:number }}
 */
function getSafetyUnpauseStatus458(safetyAutoArm) {
  const state440 = (safetyAutoArm && safetyAutoArm._state440) || null;
  if (!state440) {
    return { autoArmed: null, lastUnpause: null, historyCount: 0 };
  }

  let lastUnpause = null;
  if (Array.isArray(state440.history)) {
    // מצא את רשומת ה-unpause האחרונה
    for (let i = state440.history.length - 1; i >= 0; i--) {
      if (state440.history[i].action === 'unpause') {
        lastUnpause = state440.history[i];
        break;
      }
    }
  }

  return {
    autoArmed:    state440.autoArmed,
    lastScore:    state440.lastScore || null,
    lastUnpause:  lastUnpause,
    historyCount: Array.isArray(state440.history) ? state440.history.length : 0,
  };
}

module.exports = {
  buildSafetyUnpauseSync458,
  getSafetyUnpauseStatus458,
  MODULE_ID458,
};
