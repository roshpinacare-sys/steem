'use strict';
/**
 * src/lib/agentControlCascadeSafetyArm451.js — ECOS V451
 *
 * Agent Control Cascade → Safety Circuit Breaker Auto-Arm
 * Connects agentControlAuditBridge446 cancel-burst detection → userProtection401
 * circuit breaker. When a runaway cancellation cascade is detected (cancels in
 * window exceeding threshold), automatically soft-pauses new mint/deposit exposure
 * to protect users from committing funds while the system is unstable. When the
 * cancel rate drops below threshold, auto-disarms. Integrates with adminWsHub
 * and auditLog for real-time visibility and permanent traceability.
 *
 * R1: sacred files untouched. R2: all identifiers end in 451. R3: no new npm deps.
 *
 * @version 451.0.0
 */

const AGENT_CONTROL_CASCADE_SAFETY_ARM_VERSION451 = '451.0.0';

const _state451 = {
  enabled: true,
  autoArmed: false,
  armThreshold: 1,          // new alerts triggered >= this triggers arm
  disarmThreshold: 0,     // no recent alert within windowMs triggers disarm
  checkIntervalMs: 20_000,  // how often to evaluate control cascade health
  intervalHandle: null,
  lastScore: null,
  lastCheckTs: null,
  lastReason: null,
  lastAction: null,
  lastKnownAlerts: 0,
  armCount: 0,
  disarmCount: 0,
  history: [],
  maxHistory: 200,
};

function _nowIso451() {
  return new Date().toISOString();
}

function _pushHistory451(entry) {
  _state451.history.push(entry);
  if (_state451.history.length > _state451.maxHistory) _state451.history.shift();
}

function _getCancelBurstStatus451() {
  try {
    const acab = require('./agentControlAuditBridge446.js');
    const status = acab.getControlStatus446();
    if (!status || !status.state) return { available: false, cancels: 0, threshold: 0, alertsTriggered: 0, lastAlertTs: null, reason: 'no_control_data' };
    return {
      available: true,
      cancels: status.state.cancelsInWindow || 0,
      threshold: status.state.cancelBurstThreshold || 3,
      windowSize: status.state.windowSize || 0,
      alertsTriggered: status.state.alertsTriggered || 0,
      lastAlertTs: status.state.lastAlertTs || null,
      windowMs: status.state.windowMs || 60_000,
    };
  } catch (e) {
    return { available: false, cancels: 0, threshold: 0, alertsTriggered: 0, lastAlertTs: null, reason: e.message };
  }
}

function _getBreaker451() {
  try {
    const up = require('./userProtection401.js');
    if (typeof up.defaultCircuitBreaker401 === 'function') {
      return up.defaultCircuitBreaker401();
    }
  } catch (_) {}
  return null;
}

function _broadcast451(event, data, hub) {
  if (hub && typeof hub.broadcast === 'function') {
    try { hub.broadcast(event, data); } catch (_) {}
  }
}

function _audit451(type, data, al) {
  if (al && typeof al.append === 'function') {
    try { al.append(type, data); } catch (_) {}
  }
}

/**
 * checkAndAutoArmFromControlCascade451(opts)
 * Reads the current cancel-burst status from V446 and decides whether to arm
 * or disarm the V401 circuit breaker.
 *
 * @param {object} [opts]
 * @param {object} [opts.adminWsHub]
 * @param {object} [opts.auditLog]
 * @returns {{ok:boolean, armed:boolean, cancels:number, action:string, reason:string}}
 */
function _isRecentAlert451(lastAlertTs, windowMs) {
  if (!lastAlertTs) return false;
  try {
    const ts = new Date(lastAlertTs).getTime();
    return (Date.now() - ts) < (windowMs || 60_000);
  } catch (_) {
    return false;
  }
}

function checkAndAutoArmFromControlCascade451(opts) {
  opts = opts || {};
  if (!_state451.enabled) {
    return { ok: true, armed: _state451.autoArmed, cancels: _state451.lastScore, action: 'none', reason: 'disabled' };
  }

  const control = _getCancelBurstStatus451();
  const cancels = control.available ? control.cancels : 0;
  const currentAlerts = control.available ? control.alertsTriggered : 0;
  const newAlert = currentAlerts > _state451.lastKnownAlerts;
  const recentAlert = control.available ? _isRecentAlert451(control.lastAlertTs, control.windowMs) : false;
  const breaker = _getBreaker451();

  let armed = _state451.autoArmed;
  let reason = null;
  let action = 'none';

  if (!breaker) {
    reason = 'no_breaker';
  } else if ((newAlert || recentAlert) && !armed) {
    breaker.softPause('auto-arm451:control_cascade(alerts=' + currentAlerts + ',newAlert=' + newAlert + ',recentAlert=' + recentAlert + ')');
    armed = true;
    reason = 'control_cascade_auto_armed';
    action = 'arm';
    _state451.armCount++;
    _broadcast451('safety.control.autoArm', {
      alertsTriggered: currentAlerts,
      newAlert: newAlert,
      recentAlert: recentAlert,
      reason: reason,
      ts: _nowIso451(),
      ecosVersion: 'V451',
    }, opts.adminWsHub);
    _audit451('CONTROL_CASCADE_SAFETY_AUTO_ARM', {
      alertsTriggered: currentAlerts,
      newAlert: newAlert,
      recentAlert: recentAlert,
      reason: reason,
      ts: _nowIso451(),
    }, opts.auditLog);
  } else if (armed && !newAlert && !recentAlert) {
    breaker.unpause();
    armed = false;
    reason = 'control_cascade_recovered_auto_disarmed';
    action = 'disarm';
    _state451.disarmCount++;
    _broadcast451('safety.control.autoDisarm', {
      alertsTriggered: currentAlerts,
      newAlert: newAlert,
      recentAlert: recentAlert,
      reason: reason,
      ts: _nowIso451(),
      ecosVersion: 'V451',
    }, opts.adminWsHub);
    _audit451('CONTROL_CASCADE_SAFETY_AUTO_DISARM', {
      alertsTriggered: currentAlerts,
      newAlert: newAlert,
      recentAlert: recentAlert,
      reason: reason,
      ts: _nowIso451(),
    }, opts.auditLog);
  } else if (armed) {
    reason = 'remains_armed';
  } else {
    reason = 'remains_disarmed';
  }

  _state451.autoArmed = armed;
  _state451.lastScore = cancels;
  _state451.lastKnownAlerts = currentAlerts;
  _state451.lastCheckTs = Date.now();
  _state451.lastReason = reason;
  _state451.lastAction = action;
  _pushHistory451({
    ts: _state451.lastCheckTs,
    iso: _nowIso451(),
    cancels: cancels,
    alertsTriggered: currentAlerts,
    newAlert: newAlert,
    recentAlert: recentAlert,
    action: action,
    reason: reason,
    controlAvailable: control.available,
    controlWindowSize: control.windowSize,
  });

  return {
    ok: true,
    armed: armed,
    cancels: cancels,
    action: action,
    reason: reason,
    thresholds: { arm: _state451.armThreshold, disarm: _state451.disarmThreshold },
  };
}

/**
 * getControlCascadeSafetyArmStatus451()
 * @returns {{ok:boolean, version:string, state:object, history:object[]}}
 */
function getControlCascadeSafetyArmStatus451() {
  return {
    ok: true,
    version: AGENT_CONTROL_CASCADE_SAFETY_ARM_VERSION451,
    state: {
      enabled: _state451.enabled,
      autoArmed: _state451.autoArmed,
      armThreshold: _state451.armThreshold,
      disarmThreshold: _state451.disarmThreshold,
      checkIntervalMs: _state451.checkIntervalMs,
      lastScore: _state451.lastScore,
      lastCheckTs: _state451.lastCheckTs,
      lastReason: _state451.lastReason,
      lastAction: _state451.lastAction,
      armCount: _state451.armCount,
      disarmCount: _state451.disarmCount,
      historySize: _state451.history.length,
    },
    history: _state451.history.slice(-20),
  };
}

/**
 * configureControlCascadeSafetyArm451(opts)
 * @param {object} [opts]
 * @returns {{ok:boolean, config:object}}
 */
function configureControlCascadeSafetyArm451(opts) {
  opts = opts || {};
  if (opts.enabled !== undefined) _state451.enabled = Boolean(opts.enabled);
  if (opts.armThreshold !== undefined) _state451.armThreshold = parseInt(opts.armThreshold, 10);
  if (opts.disarmThreshold !== undefined) _state451.disarmThreshold = parseInt(opts.disarmThreshold, 10);
  if (opts.checkIntervalMs !== undefined) _state451.checkIntervalMs = parseInt(opts.checkIntervalMs, 10);
  return {
    ok: true,
    config: {
      enabled: _state451.enabled,
      armThreshold: _state451.armThreshold,
      disarmThreshold: _state451.disarmThreshold,
      checkIntervalMs: _state451.checkIntervalMs,
    },
  };
}

/**
 * resetControlCascadeSafetyArm451()
 * @returns {{ok:boolean}}
 */
function resetControlCascadeSafetyArm451() {
  _state451.autoArmed = false;
  _state451.lastScore = null;
  _state451.lastCheckTs = null;
  _state451.lastReason = null;
  _state451.lastAction = null;
  _state451.armCount = 0;
  _state451.disarmCount = 0;
  _state451.history = [];
  return { ok: true };
}

/**
 * startPeriodicCheck451(opts)
 * Starts the background interval that evaluates control cascade health and auto-arms/disarms.
 * @param {object} [opts]
 * @param {object} [opts.adminWsHub]
 * @param {object} [opts.auditLog]
 * @returns {{ok:boolean, started:boolean}}
 */
function startPeriodicCheck451(opts) {
  if (_state451.intervalHandle) {
    clearInterval(_state451.intervalHandle);
    _state451.intervalHandle = null;
  }
  _state451.intervalHandle = setInterval(function() {
    checkAndAutoArmFromControlCascade451(opts || {});
  }, _state451.checkIntervalMs);
  return { ok: true, started: true, intervalMs: _state451.checkIntervalMs };
}

/**
 * stopPeriodicCheck451()
 * @returns {{ok:boolean, stopped:boolean}}
 */
function stopPeriodicCheck451() {
  if (_state451.intervalHandle) {
    clearInterval(_state451.intervalHandle);
    _state451.intervalHandle = null;
    return { ok: true, stopped: true };
  }
  return { ok: true, stopped: false, note: 'not_running' };
}

/**
 * wireControlCascadeSafetyArm451(app, opts)
 * @param {object} app — Express-like app
 * @param {object} [opts]
 */
function wireControlCascadeSafetyArm451(app, opts) {
  if (!app || typeof app.get !== 'function') return;

  // V451-T01 GET /api/v1/admin/control-cascade-safety/status
  app.get('/api/v1/admin/control-cascade-safety/status', function(_req, res) {
    res.json(Object.assign({ ecosVersion: 'V451' }, getControlCascadeSafetyArmStatus451()));
  });

  // V451-T02 POST /api/v1/admin/control-cascade-safety/configure
  app.post('/api/v1/admin/control-cascade-safety/configure', function(req, res) {
    const result = configureControlCascadeSafetyArm451(req.body || {});
    res.json(Object.assign({ ok: true, ecosVersion: 'V451' }, result));
  });

  // V451-T03 POST /api/v1/admin/control-cascade-safety/reset
  app.post('/api/v1/admin/control-cascade-safety/reset', function(_req, res) {
    res.json(Object.assign({ ok: true, ecosVersion: 'V451' }, resetControlCascadeSafetyArm451()));
  });

  // V451-T04 POST /api/v1/admin/control-cascade-safety/check-now
  app.post('/api/v1/admin/control-cascade-safety/check-now', function(_req, res) {
    const result = checkAndAutoArmFromControlCascade451(opts || {});
    res.json(Object.assign({ ok: true, ecosVersion: 'V451' }, result));
  });

  // V451-T05 GET /api/v1/admin/summary/v451
  app.get('/api/v1/admin/summary/v451', function(_req, res) {
    res.json({
      ok: true,
      ecosVersion: 'V451',
      feature: 'agent-control-cascade-to-safety-arm — connects agentControlAuditBridge446 cancel-burst detection → userProtection401 circuit breaker',
      version: AGENT_CONTROL_CASCADE_SAFETY_ARM_VERSION451,
      status: getControlCascadeSafetyArmStatus451(),
    });
  });
}

module.exports = {
  AGENT_CONTROL_CASCADE_SAFETY_ARM_VERSION451,
  checkAndAutoArmFromControlCascade451,
  getControlCascadeSafetyArmStatus451,
  configureControlCascadeSafetyArm451,
  resetControlCascadeSafetyArm451,
  startPeriodicCheck451,
  stopPeriodicCheck451,
  wireControlCascadeSafetyArm451,
  _state451,
};
