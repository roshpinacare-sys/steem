'use strict';
/**
 * src/lib/unifiedSafetyArmStatus452.js — ECOS V452
 *
 * Unified Safety Arm Status V2
 * Extends V450 unified dashboard to include agentControlCascadeSafetyArm451.
 * Operators now see at a glance *who* armed the circuit breaker:
 * fleet degradation, economic pressure, control cascade cancellation burst,
 * manual action, or none. Changes broadcast to adminWsHub and auditLog.
 *
 * R1: sacred files untouched. R2: all identifiers end in 452. R3: no new npm deps.
 *
 * @version 452.0.0
 */

const UNIFIED_SAFETY_ARM_STATUS_VERSION452 = '452.0.0';

const _state452 = {
  enabled: true,
  intervalMs: 30_000,
  intervalHandle: null,
  lastStatus: null,
  lastWhoArmed: null,
  lastCheckTs: null,
  changeCount: 0,
  broadcastCount: 0,
  auditCount: 0,
  history: [],
  maxHistory: 200,
};

function _nowIso452() {
  return new Date().toISOString();
}

function _pushHistory452(entry) {
  _state452.history.push(entry);
  if (_state452.history.length > _state452.maxHistory) _state452.history.shift();
}

function _broadcast452(event, data, hub) {
  if (hub && typeof hub.broadcast === 'function') {
    try { hub.broadcast(event, data); } catch (_) {}
  }
}

function _audit452(type, data, al) {
  if (al && typeof al.append === 'function') {
    try { al.append(type, data); } catch (_) {}
  }
}

function _getFleetStatus452() {
  try {
    const fsa = require('./agentFleetSafetyArm447.js');
    return fsa.getFleetSafetyArmStatus447();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function _getEconomicStatus452() {
  try {
    const egsa = require('./economicGuardSafetyArm449.js');
    return egsa.getEconomicSafetyArmStatus449();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function _getControlCascadeStatus452() {
  try {
    const ccsa = require('./agentControlCascadeSafetyArm451.js');
    return ccsa.getControlCascadeSafetyArmStatus451();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function _getBreakerStatus452() {
  try {
    const up = require('./userProtection401.js');
    const breaker = up.defaultCircuitBreaker401();
    if (!breaker) return { available: false, isSoftPaused: false, manualSoftPause: false };
    return {
      available: true,
      isSoftPaused: breaker.isSoftPaused(),
      manualSoftPause: breaker._manualSoftPause || false,
    };
  } catch (e) {
    return { available: false, isSoftPaused: false, manualSoftPause: false, error: e.message };
  }
}

function _determineWhoArmed452(fleetArmed, economicArmed, controlCascadeArmed, breakerManual, breakerPaused) {
  const fleet = !!fleetArmed;
  const economic = !!economicArmed;
  const control = !!controlCascadeArmed;
  const manual = !!breakerManual;

  if (manual) return 'manual';
  if (fleet && economic && control) return 'all_three';
  if (fleet && economic) return 'both';
  if (fleet && control) return 'fleet_control';
  if (economic && control) return 'economic_control';
  if (fleet) return 'fleet';
  if (economic) return 'economic';
  if (control) return 'control_cascade';
  if (breakerPaused) return 'unknown_paused';
  return 'none';
}

function _determineOverall452(whoArmed, breakerPaused) {
  if (whoArmed === 'manual') return { status: 'manual_pause', severity: 'warning', recommendation: 'investigate_manual_pause' };
  if (whoArmed === 'all_three') return { status: 'critical_all_sources', severity: 'critical', recommendation: 'halt_new_exposure_investigate_all_sources' };
  if (whoArmed === 'both') return { status: 'critical', severity: 'critical', recommendation: 'halt_new_exposure_investigate_fleet_and_economy' };
  if (whoArmed === 'fleet_control') return { status: 'critical_fleet_control', severity: 'critical', recommendation: 'halt_new_exposure_investigate_fleet_and_control_cascade' };
  if (whoArmed === 'economic_control') return { status: 'critical_economic_control', severity: 'critical', recommendation: 'halt_new_exposure_investigate_economic_and_control_cascade' };
  if (whoArmed === 'fleet') return { status: 'fleet_armed', severity: 'warning', recommendation: 'investigate_agent_failures' };
  if (whoArmed === 'economic') return { status: 'economic_armed', severity: 'warning', recommendation: 'investigate_economic_pressure' };
  if (whoArmed === 'control_cascade') return { status: 'control_cascade_armed', severity: 'warning', recommendation: 'investigate_control_cascade' };
  if (whoArmed === 'unknown_paused') return { status: 'unknown_pause', severity: 'warning', recommendation: 'investigate_pause_source' };
  return { status: 'healthy', severity: 'ok', recommendation: 'no_action' };
}

/**
 * checkAndBroadcast452(opts)
 * @param {object} [opts]
 * @param {object} [opts.adminWsHub] — instance with .broadcast(type, data)
 * @param {object} [opts.auditLog]   — instance with .append(type, payload)
 * @returns {{ok:boolean, changed:boolean, previousWhoArmed:string|null, currentWhoArmed:string, overall:object}}
 */
function checkAndBroadcast452(opts) {
  opts = opts || {};

  if (!_state452.enabled) {
    return { ok: true, changed: false, previousWhoArmed: _state452.lastWhoArmed, currentWhoArmed: _state452.lastWhoArmed, overall: null, reason: 'disabled' };
  }

  const fleetSt = _getFleetStatus452();
  const economicSt = _getEconomicStatus452();
  const controlSt = _getControlCascadeStatus452();
  const breakerSt = _getBreakerStatus452();

  const fleetArmed = fleetSt.ok && fleetSt.state && fleetSt.state.autoArmed;
  const economicArmed = economicSt.ok && economicSt.state && economicSt.state.autoArmed;
  const controlArmed = controlSt.ok && controlSt.state && controlSt.state.autoArmed;
  const breakerManual = breakerSt.available ? breakerSt.manualSoftPause : false;
  const breakerPaused = breakerSt.available ? breakerSt.isSoftPaused : false;

  const whoArmed = _determineWhoArmed452(fleetArmed, economicArmed, controlArmed, breakerManual, breakerPaused);
  const overall = _determineOverall452(whoArmed, breakerPaused);

  const previousWhoArmed = _state452.lastWhoArmed;
  const changed = previousWhoArmed !== whoArmed;

  _state452.lastWhoArmed = whoArmed;
  _state452.lastStatus = overall.status;
  _state452.lastCheckTs = _nowIso452();

  let broadcast = false;
  let audited = false;

  if (changed) {
    _state452.changeCount++;
    _pushHistory452({
      ts: _state452.lastCheckTs,
      from: previousWhoArmed,
      to: whoArmed,
      status: overall.status,
      severity: overall.severity,
    });

    _broadcast452('unified.safety.arm.v452', {
      previousWhoArmed,
      currentWhoArmed: whoArmed,
      status: overall.status,
      severity: overall.severity,
      recommendation: overall.recommendation,
      fleetArmed,
      economicArmed,
      controlCascadeArmed: controlArmed,
      breakerPaused,
      ts: _state452.lastCheckTs,
      ecosVersion: 'V452',
    }, opts.adminWsHub);
    broadcast = true;
    _state452.broadcastCount++;

    _audit452('UNIFIED_SAFETY_ARM_CHANGE_V452', {
      previousWhoArmed,
      currentWhoArmed: whoArmed,
      status: overall.status,
      severity: overall.severity,
      recommendation: overall.recommendation,
      ts: _state452.lastCheckTs,
    }, opts.auditLog);
    audited = true;
    _state452.auditCount++;
  }

  return {
    ok: true,
    changed,
    previousWhoArmed,
    currentWhoArmed: whoArmed,
    overall,
    fleetArmed,
    economicArmed,
    controlCascadeArmed: controlArmed,
    breakerPaused,
    broadcast,
    audited,
  };
}

/**
 * getUnifiedSafetyArmStatus452()
 * @returns {{ok:boolean, version:string, state:object, history:object[]}}
 */
function getUnifiedSafetyArmStatus452() {
  const fleetSt = _getFleetStatus452();
  const economicSt = _getEconomicStatus452();
  const controlSt = _getControlCascadeStatus452();
  const breakerSt = _getBreakerStatus452();

  const fleetArmed = fleetSt.ok && fleetSt.state && fleetSt.state.autoArmed;
  const economicArmed = economicSt.ok && economicSt.state && economicSt.state.autoArmed;
  const controlArmed = controlSt.ok && controlSt.state && controlSt.state.autoArmed;
  const breakerManual = breakerSt.available ? breakerSt.manualSoftPause : false;
  const breakerPaused = breakerSt.available ? breakerSt.isSoftPaused : false;

  const whoArmed = _determineWhoArmed452(fleetArmed, economicArmed, controlArmed, breakerManual, breakerPaused);
  const overall = _determineOverall452(whoArmed, breakerPaused);

  return {
    ok: true,
    version: UNIFIED_SAFETY_ARM_STATUS_VERSION452,
    state: {
      enabled: _state452.enabled,
      intervalMs: _state452.intervalMs,
      lastCheckTs: _state452.lastCheckTs,
      lastWhoArmed: _state452.lastWhoArmed,
      lastStatus: _state452.lastStatus,
      changeCount: _state452.changeCount,
      broadcastCount: _state452.broadcastCount,
      auditCount: _state452.auditCount,
      whoArmed,
      overall,
      fleet: {
        available: fleetSt.ok,
        armed: !!fleetArmed,
        score: fleetSt.ok && fleetSt.state ? fleetSt.state.lastScore : null,
        lastReason: fleetSt.ok && fleetSt.state ? fleetSt.state.lastReason : null,
      },
      economic: {
        available: economicSt.ok,
        armed: !!economicArmed,
        score: economicSt.ok && economicSt.state ? economicSt.state.lastScore : null,
        lastReason: economicSt.ok && economicSt.state ? economicSt.state.lastReason : null,
      },
      controlCascade: {
        available: controlSt.ok,
        armed: !!controlArmed,
        score: controlSt.ok && controlSt.state ? controlSt.state.lastScore : null,
        lastReason: controlSt.ok && controlSt.state ? controlSt.state.lastReason : null,
      },
      breaker: {
        available: breakerSt.available,
        isSoftPaused: breakerSt.available ? breakerSt.isSoftPaused : null,
        manualSoftPause: breakerSt.available ? breakerSt.manualSoftPause : null,
      },
    },
    history: _state452.history.slice(),
  };
}

/**
 * configureUnifiedSafetyArm452(opts)
 * @param {object} opts
 * @returns {{ok:boolean, previous:object, current:object}}
 */
function configureUnifiedSafetyArm452(opts) {
  opts = opts || {};
  const previous = {
    enabled: _state452.enabled,
    intervalMs: _state452.intervalMs,
  };
  if (typeof opts.enabled === 'boolean') _state452.enabled = opts.enabled;
  if (typeof opts.intervalMs === 'number' && opts.intervalMs >= 1000) _state452.intervalMs = opts.intervalMs;
  return {
    ok: true,
    previous,
    current: {
      enabled: _state452.enabled,
      intervalMs: _state452.intervalMs,
    },
  };
}

/**
 * resetUnifiedSafetyArm452()
 * @returns {{ok:boolean, version:string}}
 */
function resetUnifiedSafetyArm452() {
  _state452.lastStatus = null;
  _state452.lastWhoArmed = null;
  _state452.lastCheckTs = null;
  _state452.changeCount = 0;
  _state452.broadcastCount = 0;
  _state452.auditCount = 0;
  _state452.history = [];
  return { ok: true, version: UNIFIED_SAFETY_ARM_STATUS_VERSION452 };
}

/**
 * startPolling452(opts)
 * @param {object} [opts]
 * @param {object} [opts.adminWsHub]
 * @param {object} [opts.auditLog]
 */
function startPolling452(opts) {
  opts = opts || {};
  stopPolling452();
  _state452.intervalHandle = setInterval(function() {
    try { checkAndBroadcast452(opts); } catch (_) {}
  }, _state452.intervalMs);
  if (_state452.intervalHandle && typeof _state452.intervalHandle.unref === 'function') {
    _state452.intervalHandle.unref();
  }
}

/**
 * stopPolling452()
 */
function stopPolling452() {
  if (_state452.intervalHandle) {
    clearInterval(_state452.intervalHandle);
    _state452.intervalHandle = null;
  }
}

/**
 * wireUnifiedSafetyArmStatus452(app, opts)
 * @param {object} app — express-like app
 * @param {object} [opts]
 * @param {object} [opts.adminWsHub]
 * @param {object} [opts.auditLog]
 */
function wireUnifiedSafetyArmStatus452(app, opts) {
  if (!app || typeof app.get !== 'function') return;

  // V452-T01 GET /api/v1/admin/unified-safety-arm/status/v452
  app.get('/api/v1/admin/unified-safety-arm/status/v452', function(_req, res) {
    res.json(Object.assign({ ecosVersion: 'V452' }, getUnifiedSafetyArmStatus452()));
  });

  // V452-T02 POST /api/v1/admin/unified-safety-arm/configure/v452
  app.post('/api/v1/admin/unified-safety-arm/configure/v452', function(req, res) {
    const result = configureUnifiedSafetyArm452(req.body || {});
    res.json(Object.assign({ ok: true, ecosVersion: 'V452' }, result));
  });

  // V452-T03 POST /api/v1/admin/unified-safety-arm/reset/v452
  app.post('/api/v1/admin/unified-safety-arm/reset/v452', function(_req, res) {
    res.json(Object.assign({ ok: true, ecosVersion: 'V452' }, resetUnifiedSafetyArm452()));
  });

  // V452-T04 GET /api/v1/admin/summary/v452
  app.get('/api/v1/admin/summary/v452', function(_req, res) {
    res.json({
      ok: true,
      ecosVersion: 'V452',
      feature: 'unified-safety-arm-status-v2 — connects agentFleetSafetyArm447 + economicGuardSafetyArm449 + agentControlCascadeSafetyArm451 + userProtection401 into a single operator dashboard',
      version: UNIFIED_SAFETY_ARM_STATUS_VERSION452,
      status: getUnifiedSafetyArmStatus452(),
    });
  });
}

module.exports = {
  UNIFIED_SAFETY_ARM_STATUS_VERSION452,
  checkAndBroadcast452,
  getUnifiedSafetyArmStatus452,
  configureUnifiedSafetyArm452,
  resetUnifiedSafetyArm452,
  startPolling452,
  stopPolling452,
  wireUnifiedSafetyArmStatus452,
  _state452,
};
