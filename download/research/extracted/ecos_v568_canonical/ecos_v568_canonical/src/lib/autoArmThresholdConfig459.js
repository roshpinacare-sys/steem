'use strict';
/**
 * src/lib/autoArmThresholdConfig459.js — ECOS V459
 *
 * Auto-Arm Threshold Configuration
 * מאפשר עדכון מדויק של `armThreshold` ו-`disarmThreshold` ב-_state440
 * של safetyAutoArm440, עם HITL gate + audit trail.
 *
 * חוקי בטיחות:
 *  - armThreshold ו-disarmThreshold חייבים להיות מספרים בטווח [0, 100]
 *  - disarmThreshold חייב להיות גדול מ-armThreshold (hysteresis)
 *  - דורש authorized:true + hitlApproved:true (fail-closed)
 *
 * @version 459.0.0
 */

const AUTO_ARM_THRESHOLD_CONFIG_VERSION459 = '459.0.0';

/**
 * configureAutoArmThresholds459(opts)
 * @param {object} opts
 * @param {number}   opts.armThreshold     — סף ה-arm החדש (0-100)
 * @param {number}   opts.disarmThreshold  — סף ה-disarm החדש (0-100, > armThreshold)
 * @param {boolean}  opts.authorized       — חובה true
 * @param {boolean}  opts.hitlApproved     — חובה true (HITL gate)
 * @param {object}   opts.safetyAutoArm    — מופע safetyAutoArm440 עם _state440
 * @param {function} opts.audit            — audit(action, payload) function
 * @returns {{ ok:boolean, prevArm:number, prevDisarm:number, newArm:number, newDisarm:number }}
 */
function configureAutoArmThresholds459(opts) {
  opts = opts || {};

  // HITL gate — fail-closed
  if (opts.authorized !== true) {
    const e = new Error('UNAUTHORIZED: authorized:true required');
    e.code = 'UNAUTHORIZED';
    e.statusCode = 401;
    throw e;
  }
  if (opts.hitlApproved !== true) {
    const e = new Error('HITL_REQUIRED: hitlApproved:true required for threshold changes');
    e.code = 'HITL_REQUIRED';
    e.statusCode = 403;
    throw e;
  }

  const armT    = opts.armThreshold;
  const disarmT = opts.disarmThreshold;

  // Validate both provided
  if (armT === undefined || armT === null || disarmT === undefined || disarmT === null) {
    const e = new Error('INVALID_PARAMS: both armThreshold and disarmThreshold are required');
    e.code = 'INVALID_PARAMS';
    e.statusCode = 400;
    throw e;
  }

  // Validate numeric
  if (typeof armT !== 'number' || typeof disarmT !== 'number' ||
      !isFinite(armT) || !isFinite(disarmT)) {
    const e = new Error('INVALID_PARAMS: armThreshold and disarmThreshold must be finite numbers');
    e.code = 'INVALID_PARAMS';
    e.statusCode = 400;
    throw e;
  }

  // Validate range [0, 100]
  if (armT < 0 || armT > 100 || disarmT < 0 || disarmT > 100) {
    const e = new Error('INVALID_PARAMS: thresholds must be in range [0, 100]');
    e.code = 'INVALID_PARAMS';
    e.statusCode = 400;
    throw e;
  }

  // Validate hysteresis: disarmThreshold > armThreshold
  if (disarmT <= armT) {
    const e = new Error(
      'INVALID_PARAMS: disarmThreshold (' + disarmT +
      ') must be greater than armThreshold (' + armT + ') for proper hysteresis'
    );
    e.code = 'INVALID_PARAMS';
    e.statusCode = 400;
    throw e;
  }

  // safetyAutoArm must have _state440
  if (!opts.safetyAutoArm || !opts.safetyAutoArm._state440) {
    const e = new Error('CONFIG_ERROR: safetyAutoArm module with _state440 required');
    e.code = 'CONFIG_ERROR';
    e.statusCode = 500;
    throw e;
  }

  const state = opts.safetyAutoArm._state440;
  const prevArm    = state.armThreshold;
  const prevDisarm = state.disarmThreshold;

  // Apply
  state.armThreshold    = armT;
  state.disarmThreshold = disarmT;

  // Audit trail
  if (typeof opts.audit === 'function') {
    try {
      opts.audit('auto_arm_threshold_configure459', {
        prevArm, prevDisarm, newArm: armT, newDisarm: disarmT,
        hitlApproved: true, ts: new Date().toISOString(),
      });
    } catch (_) {}
  }

  // History entry
  if (Array.isArray(state.history)) {
    state.history.push({
      ts:          new Date().toISOString(),
      event:       'threshold_configure459',
      prevArm,
      prevDisarm,
      newArm:      armT,
      newDisarm:   disarmT,
      hitlApproved: true,
    });
    const maxH = state.maxHistory || 200;
    if (state.history.length > maxH) state.history.splice(0, state.history.length - maxH);
  }

  return {
    ok:         true,
    prevArm,
    prevDisarm,
    newArm:     armT,
    newDisarm:  disarmT,
    version:    AUTO_ARM_THRESHOLD_CONFIG_VERSION459,
  };
}

/**
 * getAutoArmThresholdConfig459(safetyAutoArm)
 * @returns {{ armThreshold:number, disarmThreshold:number, autoArmed:boolean, lastScore:any }}
 */
function getAutoArmThresholdConfig459(safetyAutoArm) {
  if (!safetyAutoArm || !safetyAutoArm._state440) {
    return {
      armThreshold:    null,
      disarmThreshold: null,
      autoArmed:       null,
      lastScore:       null,
      error:           'safetyAutoArm._state440 not available',
      version:         AUTO_ARM_THRESHOLD_CONFIG_VERSION459,
    };
  }
  const s = safetyAutoArm._state440;
  return {
    armThreshold:    s.armThreshold,
    disarmThreshold: s.disarmThreshold,
    autoArmed:       s.autoArmed,
    lastScore:       s.lastScore,
    version:         AUTO_ARM_THRESHOLD_CONFIG_VERSION459,
  };
}

module.exports = {
  configureAutoArmThresholds459,
  getAutoArmThresholdConfig459,
  AUTO_ARM_THRESHOLD_CONFIG_VERSION459,
};
