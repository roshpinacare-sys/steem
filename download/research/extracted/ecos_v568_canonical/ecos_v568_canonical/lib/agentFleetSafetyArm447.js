'use strict';
/**
 * src/lib/agentFleetSafetyArm447.js — ECOS V447
 *
 * Agent Fleet Health → Safety Circuit Breaker Auto-Arm
 * Connects agentResultHealthBridge445 → userProtection401 circuit breaker.
 * When the agent fleet success ratio drops below a configurable threshold,
 * automatically soft-pauses new mint/deposit exposure to protect users from
 * committing funds while agents are failing. When fleet health recovers above
 * a higher threshold, auto-disarms. Integrates with adminWsHub and auditLog
 * for real-time visibility and permanent traceability.
 *
 * R1: sacred files untouched. R2: all identifiers end in 447. R3: no new npm deps.
 *
 * @version 447.0.0
 */

const AGENT_FLEET_SAFETY_ARM_VERSION447 = '447.0.0';

const _state447 = {
  enabled: true,
  autoArmed: false,
  armThreshold: 60,          // fleet success % below this triggers arm
  disarmThreshold: 85,     // fleet success % above this triggers disarm
  checkIntervalMs: 30_000,   // how often to evaluate fleet health
  intervalHandle: null,
  lastScore: null,
  lastCheckTs: null,
  lastReason: null,
  lastAction: null,
  armCount: 0,
  disarmCount: 0,
  history: [],
  maxHistory: 200,
};

function _nowIso447() {
  return new Date().toISOString();
}

function _pushHistory447(entry) {
  _state447.history.push(entry);
  if (_state447.history.length > _state447.maxHistory) _state447.history.shift();
}

function _getFleetRatio447() {
  try {
    const arhb = require('./agentResultHealthBridge445.js');
    const status = arhb.getHealthStatus445();
    if (!status || !status.fleetRatio) return { available: false, ratio: 100, reason: 'no_fleet_data' };
    return { available: true, ratio: status.fleetRatio.ratio, total: status.fleetRatio.total };
  } catch (e) {
    return { available: false, ratio: 100, reason: e.message };
  }
}

function _getBreaker447() {
  try {
    const up = require('./userProtection401.js');
    if (typeof up.defaultCircuitBreaker401 === 'function') {
      return up.defaultCircuitBreaker401();
    }
  } catch (_) {}
  return null;
}

function _broadcast447(event, data, hub) {
  if (hub && typeof hub.broadcast === 'function') {
    try { hub.broadcast(event, data); } catch (_) {}
  }
}

function _audit447(type, data, al) {
  if (al && typeof al.append === 'function') {
    try { al.append(type, data); } catch (_) {}
  }
}

/**
 * checkAndAutoArmFromFleet447(opts)
 * Reads the current fleet health ratio from V445 and decides whether to arm
 * or disarm the V401 circuit breaker.
 *
 * @param {object} [opts]
 * @param {object} [opts.adminWsHub]
 * @param {object} [opts.auditLog]
 * @returns {{ok:boolean, armed:boolean, ratio:number, action:string, reason:string}}
 */
function checkAndAutoArmFromFleet447(opts) {
  opts = opts || {};
  if (!_state447.enabled) {
    return { ok: true, armed: _state447.autoArmed, ratio: _state447.lastScore, action: 'none', reason: 'disabled' };
  }

  const fleet = _getFleetRatio447();
  const ratio = fleet.available ? fleet.ratio : 100;
  const breaker = _getBreaker447();

  let armed = _state447.autoArmed;
  let reason = null;
  let action = 'none';

  if (!breaker) {
    reason = 'no_breaker';
  } else if (ratio <= _state447.armThreshold && !armed) {
    if (fleet.available && fleet.total >= 3) {
      breaker.softPause('auto-arm447:fleet_critical(ratio=' + ratio + ')');
      armed = true;
      reason = 'fleet_critical_auto_armed';
      action = 'arm';
      _state447.armCount++;
      _broadcast447('safety.fleet.autoArm', {
        ratio: ratio,
        threshold: _state447.armThreshold,
        reason: reason,
        ts: _nowIso447(),
        ecosVersion: 'V447',
      }, opts.adminWsHub);
      _audit447('FLEET_SAFETY_AUTO_ARM', {
        ratio: ratio,
        threshold: _state447.armThreshold,
        reason: reason,
        ts: _nowIso447(),
      }, opts.auditLog);
    } else {
      reason = 'insufficient_samples_for_arm';
    }
  } else if (armed && ratio >= _state447.disarmThreshold) {
    breaker.unpause();
    armed = false;
    reason = 'fleet_recovered_auto_disarmed';
    action = 'disarm';
    _state447.disarmCount++;
    _broadcast447('safety.fleet.autoDisarm', {
      ratio: ratio,
      threshold: _state447.disarmThreshold,
      reason: reason,
      ts: _nowIso447(),
      ecosVersion: 'V447',
    }, opts.adminWsHub);
    _audit447('FLEET_SAFETY_AUTO_DISARM', {
      ratio: ratio,
      threshold: _state447.disarmThreshold,
      reason: reason,
      ts: _nowIso447(),
    }, opts.auditLog);
  } else if (armed) {
    reason = 'remains_armed';
  } else {
    reason = 'remains_disarmed';
  }

  _state447.autoArmed = armed;
  _state447.lastScore = ratio;
  _state447.lastCheckTs = Date.now();
  _state447.lastReason = reason;
  _state447.lastAction = action;
  _pushHistory447({
    ts: _state447.lastCheckTs,
    iso: _nowIso447(),
    ratio: ratio,
    action: action,
    reason: reason,
    fleetAvailable: fleet.available,
    fleetTotal: fleet.total,
  });

  return {
    ok: true,
    armed: armed,
    ratio: ratio,
    action: action,
    reason: reason,
    thresholds: { arm: _state447.armThreshold, disarm: _state447.disarmThreshold },
  };
}

/**
 * getFleetSafetyArmStatus447()
 * @returns {{ok:boolean, version:string, state:object, history:object[]}}
 */
function getFleetSafetyArmStatus447() {
  return {
    ok: true,
    version: AGENT_FLEET_SAFETY_ARM_VERSION447,
    state: {
      enabled: _state447.enabled,
      autoArmed: _state447.autoArmed,
      armThreshold: _state447.armThreshold,
      disarmThreshold: _state447.disarmThreshold,
      checkIntervalMs: _state447.checkIntervalMs,
      lastScore: _state447.lastScore,
      lastCheckTs: _state447.lastCheckTs,
      lastReason: _state447.lastReason,
      lastAction: _state447.lastAction,
      armCount: _state447.armCount,
      disarmCount: _state447.disarmCount,
      historySize: _state447.history.length,
    },
    history: _state447.history.slice(-20),
  };
}

/**
 * configureFleetSafetyArm447(opts)
 * @param {object} [opts]
 * @returns {{ok:boolean, config:object}}
 */
function configureFleetSafetyArm447(opts) {
  opts = opts || {};
  if (opts.enabled !== undefined) _state447.enabled = Boolean(opts.enabled);
  if (opts.armThreshold !== undefined) _state447.armThreshold = parseInt(opts.armThreshold, 10);
  if (opts.disarmThreshold !== undefined) _state447.disarmThreshold = parseInt(opts.disarmThreshold, 10);
  if (opts.checkIntervalMs !== undefined) _state447.checkIntervalMs = parseInt(opts.checkIntervalMs, 10);
  return {
    ok: true,
    config: {
      enabled: _state447.enabled,
      armThreshold: _state447.armThreshold,
      disarmThreshold: _state447.disarmThreshold,
      checkIntervalMs: _state447.checkIntervalMs,
    },
  };
}

/**
 * resetFleetSafetyArm447()
 * @returns {{ok:boolean}}
 */
function resetFleetSafetyArm447() {
  _state447.autoArmed = false;
  _state447.lastScore = null;
  _state447.lastCheckTs = null;
  _state447.lastReason = null;
  _state447.lastAction = null;
  _state447.armCount = 0;
  _state447.disarmCount = 0;
  _state447.history = [];
  return { ok: true };
}

/**
 * startPeriodicCheck447(opts)
 * Starts the background interval that evaluates fleet health and auto-arms/disarms.
 * @param {object} [opts]
 * @param {object} [opts.adminWsHub]
 * @param {object} [opts.auditLog]
 * @returns {{ok:boolean, started:boolean}}
 */
function startPeriodicCheck447(opts) {
  if (_state447.intervalHandle) {
    clearInterval(_state447.intervalHandle);
    _state447.intervalHandle = null;
  }
  _state447.intervalHandle = setInterval(function() {
    checkAndAutoArmFromFleet447(opts || {});
  }, _state447.checkIntervalMs);
  return { ok: true, started: true, intervalMs: _state447.checkIntervalMs };
}

/**
 * stopPeriodicCheck447()
 * @returns {{ok:boolean, stopped:boolean}}
 */
function stopPeriodicCheck447() {
  if (_state447.intervalHandle) {
    clearInterval(_state447.intervalHandle);
    _state447.intervalHandle = null;
    return { ok: true, stopped: true };
  }
  return { ok: true, stopped: false, note: 'not_running' };
}

/**
 * wireFleetSafetyArm447(app, opts)
 * @param {object} app — Express-like app
 * @param {object} [opts]
 */
function wireFleetSafetyArm447(app, opts) {
  if (!app || typeof app.get !== 'function') return;

  // V447-T01 GET /api/v1/admin/fleet-safety/status
  app.get('/api/v1/admin/fleet-safety/status', function(_req, res) {
    res.json(Object.assign({ ecosVersion: 'V447' }, getFleetSafetyArmStatus447()));
  });

  // V447-T02 POST /api/v1/admin/fleet-safety/configure
  app.post('/api/v1/admin/fleet-safety/configure', function(req, res) {
    const result = configureFleetSafetyArm447(req.body || {});
    res.json(Object.assign({ ok: true, ecosVersion: 'V447' }, result));
  });

  // V447-T03 POST /api/v1/admin/fleet-safety/reset
  app.post('/api/v1/admin/fleet-safety/reset', function(_req, res) {
    res.json(Object.assign({ ok: true, ecosVersion: 'V447' }, resetFleetSafetyArm447()));
  });

  // V447-T04 POST /api/v1/admin/fleet-safety/check-now
  app.post('/api/v1/admin/fleet-safety/check-now', function(_req, res) {
    const result = checkAndAutoArmFromFleet447(opts || {});
    res.json(Object.assign({ ok: true, ecosVersion: 'V447' }, result));
  });

  // V447-T05 GET /api/v1/admin/summary/v447
  app.get('/api/v1/admin/summary/v447', function(_req, res) {
    res.json({
      ok: true,
      ecosVersion: 'V447',
      feature: 'agent-fleet-health-to-safety-arm — connects agentResultHealthBridge445 fleet ratio → userProtection401 circuit breaker',
      version: AGENT_FLEET_SAFETY_ARM_VERSION447,
      status: getFleetSafetyArmStatus447(),
    });
  });
}

module.exports = {
  AGENT_FLEET_SAFETY_ARM_VERSION447,
  checkAndAutoArmFromFleet447,
  getFleetSafetyArmStatus447,
  configureFleetSafetyArm447,
  resetFleetSafetyArm447,
  startPeriodicCheck447,
  stopPeriodicCheck447,
  wireFleetSafetyArm447,
  _state447,
};
