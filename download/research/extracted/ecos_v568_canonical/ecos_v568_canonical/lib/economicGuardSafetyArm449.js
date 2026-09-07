'use strict';
/**
 * src/lib/economicGuardSafetyArm449.js — ECOS V449
 *
 * Economic Guard Health -> Safety Circuit Breaker Auto-Arm
 * Connects economicGuardMonitor448 -> userProtection401 circuit breaker.
 * When the V402 economic health score drops below a configurable threshold
 * (indicating reserve-invariant rejections or high rejection rate), automatically
 * soft-pauses new mint/deposit exposure to protect users from committing funds
 * while the economic guard is under pressure. When the score recovers above a
 * higher threshold, auto-disarms. Integrates with adminWsHub and auditLog for
 * real-time visibility and permanent traceability.
 *
 * R1: sacred files untouched. R2: all identifiers end in 449. R3: no new npm deps.
 *
 * @version 449.0.0
 */

const ECONOMIC_GUARD_SAFETY_ARM_VERSION449 = '449.0.0';

const _state449 = {
  enabled: true,
  autoArmed: false,
  armThreshold: 40,          // economic health score <= this triggers arm
  disarmThreshold: 80,       // economic health score >= this triggers disarm
  checkIntervalMs: 30_000,   // how often to evaluate economic health
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

function _nowIso449() {
  return new Date().toISOString();
}

function _pushHistory449(entry) {
  _state449.history.push(entry);
  if (_state449.history.length > _state449.maxHistory) _state449.history.shift();
}

function _getEconomicScore449() {
  try {
    const egm = require('./economicGuardMonitor448.js');
    const status = egm.getHealthStatus448();
    if (!status || !status.stats) return { available: false, score: 100, reason: 'no_economic_data' };
    return { available: true, score: status.stats.score, stats: status.stats };
  } catch (e) {
    return { available: false, score: 100, reason: e.message };
  }
}

function _getBreaker449() {
  try {
    const up = require('./userProtection401.js');
    if (typeof up.defaultCircuitBreaker401 === 'function') {
      return up.defaultCircuitBreaker401();
    }
  } catch (_) {}
  return null;
}

function _broadcast449(event, data, hub) {
  if (hub && typeof hub.broadcast === 'function') {
    try { hub.broadcast(event, data); } catch (_) {}
  }
}

function _audit449(type, data, al) {
  if (al && typeof al.append === 'function') {
    try { al.append(type, data); } catch (_) {}
  }
}

/**
 * checkAndAutoArmFromEconomic449(opts)
 * Reads the current economic health score from V448 and decides whether to arm
 * or disarm the V401 circuit breaker.
 *
 * @param {object} [opts]
 * @param {object} [opts.adminWsHub]
 * @param {object} [opts.auditLog]
 * @returns {{ok:boolean, armed:boolean, score:number, action:string, reason:string}}
 */
function checkAndAutoArmFromEconomic449(opts) {
  opts = opts || {};
  if (!_state449.enabled) {
    return { ok: true, armed: _state449.autoArmed, score: _state449.lastScore, action: 'none', reason: 'disabled' };
  }

  const econ = _getEconomicScore449();
  const score = econ.available ? econ.score : 100;
  const breaker = _getBreaker449();

  let armed = _state449.autoArmed;
  let reason = null;
  let action = 'none';

  if (!breaker) {
    reason = 'no_breaker';
  } else if (score <= _state449.armThreshold && !armed) {
    if (econ.available && econ.stats && econ.stats.total >= 1) {
      breaker.softPause('auto-arm449:economic_critical(score=' + score + ')');
      armed = true;
      reason = 'economic_critical_auto_armed';
      action = 'arm';
      _state449.armCount++;
      _broadcast449('safety.economic.autoArm', {
        score: score,
        threshold: _state449.armThreshold,
        reason: reason,
        ts: _nowIso449(),
        ecosVersion: 'V449',
      }, opts.adminWsHub);
      _audit449('ECONOMIC_SAFETY_AUTO_ARM', {
        score: score,
        threshold: _state449.armThreshold,
        reason: reason,
        ts: _nowIso449(),
      }, opts.auditLog);
    } else {
      reason = 'insufficient_samples_for_arm';
    }
  } else if (armed && score >= _state449.disarmThreshold) {
    breaker.unpause();
    armed = false;
    reason = 'economic_recovered_auto_disarmed';
    action = 'disarm';
    _state449.disarmCount++;
    _broadcast449('safety.economic.autoDisarm', {
      score: score,
      threshold: _state449.disarmThreshold,
      reason: reason,
      ts: _nowIso449(),
      ecosVersion: 'V449',
    }, opts.adminWsHub);
    _audit449('ECONOMIC_SAFETY_AUTO_DISARM', {
      score: score,
      threshold: _state449.disarmThreshold,
      reason: reason,
      ts: _nowIso449(),
    }, opts.auditLog);
  } else if (armed) {
    reason = 'remains_armed';
  } else {
    reason = 'remains_disarmed';
  }

  _state449.autoArmed = armed;
  _state449.lastScore = score;
  _state449.lastCheckTs = Date.now();
  _state449.lastReason = reason;
  _state449.lastAction = action;
  _pushHistory449({
    ts: _state449.lastCheckTs,
    iso: _nowIso449(),
    score: score,
    action: action,
    reason: reason,
    econAvailable: econ.available,
    econTotal: econ.stats ? econ.stats.total : 0,
  });

  return {
    ok: true,
    armed: armed,
    score: score,
    action: action,
    reason: reason,
    thresholds: { arm: _state449.armThreshold, disarm: _state449.disarmThreshold },
  };
}

/**
 * getEconomicSafetyArmStatus449()
 * @returns {{ok:boolean, version:string, state:object, history:object[]}}
 */
function getEconomicSafetyArmStatus449() {
  return {
    ok: true,
    version: ECONOMIC_GUARD_SAFETY_ARM_VERSION449,
    state: {
      enabled: _state449.enabled,
      autoArmed: _state449.autoArmed,
      armThreshold: _state449.armThreshold,
      disarmThreshold: _state449.disarmThreshold,
      checkIntervalMs: _state449.checkIntervalMs,
      lastScore: _state449.lastScore,
      lastCheckTs: _state449.lastCheckTs,
      lastReason: _state449.lastReason,
      lastAction: _state449.lastAction,
      armCount: _state449.armCount,
      disarmCount: _state449.disarmCount,
      historySize: _state449.history.length,
    },
    history: _state449.history.slice(-20),
  };
}

/**
 * configureEconomicSafetyArm449(opts)
 * @param {object} [opts]
 * @returns {{ok:boolean, config:object}}
 */
function configureEconomicSafetyArm449(opts) {
  opts = opts || {};
  if (opts.enabled !== undefined) _state449.enabled = Boolean(opts.enabled);
  if (opts.armThreshold !== undefined) _state449.armThreshold = parseInt(opts.armThreshold, 10);
  if (opts.disarmThreshold !== undefined) _state449.disarmThreshold = parseInt(opts.disarmThreshold, 10);
  if (opts.checkIntervalMs !== undefined) _state449.checkIntervalMs = parseInt(opts.checkIntervalMs, 10);
  return {
    ok: true,
    config: {
      enabled: _state449.enabled,
      armThreshold: _state449.armThreshold,
      disarmThreshold: _state449.disarmThreshold,
      checkIntervalMs: _state449.checkIntervalMs,
    },
  };
}

/**
 * resetEconomicSafetyArm449()
 * @returns {{ok:boolean}}
 */
function resetEconomicSafetyArm449() {
  _state449.autoArmed = false;
  _state449.lastScore = null;
  _state449.lastCheckTs = null;
  _state449.lastReason = null;
  _state449.lastAction = null;
  _state449.armCount = 0;
  _state449.disarmCount = 0;
  _state449.history = [];
  return { ok: true };
}

/**
 * startPeriodicCheck449(opts)
 * Starts the background interval that evaluates economic health and auto-arms/disarms.
 * @param {object} [opts]
 * @param {object} [opts.adminWsHub]
 * @param {object} [opts.auditLog]
 * @returns {{ok:boolean, started:boolean}}
 */
function startPeriodicCheck449(opts) {
  if (_state449.intervalHandle) {
    clearInterval(_state449.intervalHandle);
    _state449.intervalHandle = null;
  }
  _state449.intervalHandle = setInterval(function() {
    checkAndAutoArmFromEconomic449(opts || {});
  }, _state449.checkIntervalMs);
  return { ok: true, started: true, intervalMs: _state449.checkIntervalMs };
}

/**
 * stopPeriodicCheck449()
 * @returns {{ok:boolean, stopped:boolean}}
 */
function stopPeriodicCheck449() {
  if (_state449.intervalHandle) {
    clearInterval(_state449.intervalHandle);
    _state449.intervalHandle = null;
    return { ok: true, stopped: true };
  }
  return { ok: true, stopped: false, note: 'not_running' };
}

/**
 * wireEconomicGuardSafetyArm449(app, opts)
 * @param {object} app — Express-like app
 * @param {object} [opts]
 */
function wireEconomicGuardSafetyArm449(app, opts) {
  if (!app || typeof app.get !== 'function') return;

  // V449-T01 GET /api/v1/admin/economic-safety/status
  app.get('/api/v1/admin/economic-safety/status', function(_req, res) {
    res.json(Object.assign({ ecosVersion: 'V449' }, getEconomicSafetyArmStatus449()));
  });

  // V449-T02 POST /api/v1/admin/economic-safety/configure
  app.post('/api/v1/admin/economic-safety/configure', function(req, res) {
    const result = configureEconomicSafetyArm449(req.body || {});
    res.json(Object.assign({ ok: true, ecosVersion: 'V449' }, result));
  });

  // V449-T03 POST /api/v1/admin/economic-safety/reset
  app.post('/api/v1/admin/economic-safety/reset', function(_req, res) {
    res.json(Object.assign({ ok: true, ecosVersion: 'V449' }, resetEconomicSafetyArm449()));
  });

  // V449-T04 POST /api/v1/admin/economic-safety/check-now
  app.post('/api/v1/admin/economic-safety/check-now', function(_req, res) {
    const result = checkAndAutoArmFromEconomic449(opts || {});
    res.json(Object.assign({ ok: true, ecosVersion: 'V449' }, result));
  });

  // V449-T05 GET /api/v1/admin/summary/v449
  app.get('/api/v1/admin/summary/v449', function(_req, res) {
    res.json({
      ok: true,
      ecosVersion: 'V449',
      feature: 'economic-guard-health-to-safety-arm — connects economicGuardMonitor448 health score -> userProtection401 circuit breaker',
      version: ECONOMIC_GUARD_SAFETY_ARM_VERSION449,
      status: getEconomicSafetyArmStatus449(),
    });
  });
}

module.exports = {
  ECONOMIC_GUARD_SAFETY_ARM_VERSION449,
  checkAndAutoArmFromEconomic449,
  getEconomicSafetyArmStatus449,
  configureEconomicSafetyArm449,
  resetEconomicSafetyArm449,
  startPeriodicCheck449,
  stopPeriodicCheck449,
  wireEconomicGuardSafetyArm449,
  _state449,
};
