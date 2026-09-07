'use strict';
/**
 * src/lib/unifiedSafetyArmStatus450.js — ECOS V450
 *
 * Unified Safety Arm Status
 * Connects agentFleetSafetyArm447 + economicGuardSafetyArm449 + userProtection401
 * into a single unified dashboard. Operators can see at a glance *who* armed the
 * circuit breaker (fleet degradation, economic pressure, manual action, or none).
 * Changes are broadcast to adminWsHub and logged to auditLog for traceability.
 *
 * R1: sacred files untouched. R2: all identifiers end in 450. R3: no new npm deps.
 *
 * @version 450.0.0
 */

const UNIFIED_SAFETY_ARM_STATUS_VERSION450 = '450.0.0';

const _state450 = {
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

function _nowIso450() {
  return new Date().toISOString();
}

function _pushHistory450(entry) {
  _state450.history.push(entry);
  if (_state450.history.length > _state450.maxHistory) _state450.history.shift();
}

function _broadcast450(event, data, hub) {
  if (hub && typeof hub.broadcast === 'function') {
    try { hub.broadcast(event, data); } catch (_) {}
  }
}

function _audit450(type, data, al) {
  if (al && typeof al.append === 'function') {
    try { al.append(type, data); } catch (_) {}
  }
}

function _getFleetStatus450() {
  try {
    const fsa = require('./agentFleetSafetyArm447.js');
    return fsa.getFleetSafetyArmStatus447();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function _getEconomicStatus450() {
  try {
    const egsa = require('./economicGuardSafetyArm449.js');
    return egsa.getEconomicSafetyArmStatus449();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function _getBreakerStatus450() {
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
    return { available: false, isSoftPaused: false, error: e.message };
  }
}

function _determineWhoArmed450(fleetArmed, economicArmed, breakerManual, breakerPaused) {
  const fleet = !!fleetArmed;
  const economic = !!economicArmed;
  const manual = !!breakerManual;

  if (manual) return 'manual';
  if (fleet && economic) return 'both';
  if (fleet) return 'fleet';
  if (economic) return 'economic';
  if (breakerPaused) return 'unknown_paused';
  return 'none';
}

function _determineOverall450(whoArmed, breakerPaused) {
  if (whoArmed === 'manual') return { status: 'manual_pause', severity: 'warning', recommendation: 'investigate_manual_pause' };
  if (whoArmed === 'both') return { status: 'critical', severity: 'critical', recommendation: 'halt_new_exposure_investigate_fleet_and_economy' };
  if (whoArmed === 'fleet') return { status: 'fleet_armed', severity: 'warning', recommendation: 'investigate_agent_failures' };
  if (whoArmed === 'economic') return { status: 'economic_armed', severity: 'warning', recommendation: 'investigate_economic_pressure' };
  if (whoArmed === 'unknown_paused') return { status: 'unknown_pause', severity: 'warning', recommendation: 'investigate_pause_source' };
  return { status: 'healthy', severity: 'ok', recommendation: 'no_action' };
}

/**
 * checkAndBroadcast450(opts)
 * @param {object} [opts]
 * @param {object} [opts.adminWsHub] — instance with .broadcast(type, data)
 * @param {object} [opts.auditLog]   — instance with .append(type, payload)
 * @returns {{ok:boolean, changed:boolean, previousWhoArmed:string|null, currentWhoArmed:string, overall:object}}
 */
function checkAndBroadcast450(opts) {
  opts = opts || {};

  if (!_state450.enabled) {
    return { ok: true, changed: false, previousWhoArmed: _state450.lastWhoArmed, currentWhoArmed: _state450.lastWhoArmed, overall: null, reason: 'disabled' };
  }

  const fleetSt = _getFleetStatus450();
  const economicSt = _getEconomicStatus450();
  const breakerSt = _getBreakerStatus450();

  const fleetArmed = fleetSt.ok && fleetSt.state && fleetSt.state.autoArmed;
  const economicArmed = economicSt.ok && economicSt.state && economicSt.state.autoArmed;
  const breakerManual = breakerSt.available ? breakerSt.manualSoftPause : false;
  const breakerPaused = breakerSt.available ? breakerSt.isSoftPaused : false;

  const whoArmed = _determineWhoArmed450(fleetArmed, economicArmed, breakerManual, breakerPaused);
  const overall = _determineOverall450(whoArmed, breakerPaused);

  const previousWhoArmed = _state450.lastWhoArmed;
  const changed = previousWhoArmed !== whoArmed;

  _state450.lastWhoArmed = whoArmed;
  _state450.lastStatus = overall.status;
  _state450.lastCheckTs = _nowIso450();

  let broadcast = false;
  let audited = false;

  if (changed) {
    _state450.changeCount++;
    _pushHistory450({
      ts: _state450.lastCheckTs,
      from: previousWhoArmed,
      to: whoArmed,
      status: overall.status,
      severity: overall.severity,
    });

    _broadcast450('unified.safety.arm', {
      previousWhoArmed,
      currentWhoArmed: whoArmed,
      status: overall.status,
      severity: overall.severity,
      recommendation: overall.recommendation,
      fleetArmed,
      economicArmed,
      breakerPaused,
      ts: _state450.lastCheckTs,
      ecosVersion: 'V450',
    }, opts.adminWsHub);
    broadcast = true;
    _state450.broadcastCount++;

    _audit450('UNIFIED_SAFETY_ARM_CHANGE', {
      previousWhoArmed,
      currentWhoArmed: whoArmed,
      status: overall.status,
      severity: overall.severity,
      recommendation: overall.recommendation,
      ts: _state450.lastCheckTs,
    }, opts.auditLog);
    audited = true;
    _state450.auditCount++;
  }

  return {
    ok: true,
    changed,
    previousWhoArmed,
    currentWhoArmed: whoArmed,
    overall,
    fleetArmed,
    economicArmed,
    breakerPaused,
    broadcast,
    audited,
  };
}

/**
 * getUnifiedSafetyArmStatus450()
 * @returns {{ok:boolean, version:string, state:object, history:object[]}}
 */
function getUnifiedSafetyArmStatus450() {
  const fleetSt = _getFleetStatus450();
  const economicSt = _getEconomicStatus450();
  const breakerSt = _getBreakerStatus450();

  const fleetArmed = fleetSt.ok && fleetSt.state && fleetSt.state.autoArmed;
  const economicArmed = economicSt.ok && economicSt.state && economicSt.state.autoArmed;
  const breakerManual = breakerSt.available ? breakerSt.manualSoftPause : false;
  const breakerPaused = breakerSt.available ? breakerSt.isSoftPaused : false;

  const whoArmed = _determineWhoArmed450(fleetArmed, economicArmed, breakerManual, breakerPaused);
  const overall = _determineOverall450(whoArmed, breakerPaused);

  return {
    ok: true,
    version: UNIFIED_SAFETY_ARM_STATUS_VERSION450,
    state: {
      enabled: _state450.enabled,
      intervalMs: _state450.intervalMs,
      lastCheckTs: _state450.lastCheckTs,
      lastWhoArmed: _state450.lastWhoArmed,
      lastStatus: _state450.lastStatus,
      changeCount: _state450.changeCount,
      broadcastCount: _state450.broadcastCount,
      auditCount: _state450.auditCount,
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
      breaker: {
        available: breakerSt.available,
        isSoftPaused: breakerSt.available ? breakerSt.isSoftPaused : null,
        manualSoftPause: breakerSt.available ? breakerSt.manualSoftPause : null,
      },
    },
    history: _state450.history.slice(),
  };
}

/**
 * configureUnifiedSafetyArm450(opts)
 * @param {object} opts
 * @returns {{ok:boolean, previous:object, current:object}}
 */
function configureUnifiedSafetyArm450(opts) {
  opts = opts || {};
  const previous = {
    enabled: _state450.enabled,
    intervalMs: _state450.intervalMs,
  };
  if (typeof opts.enabled === 'boolean') _state450.enabled = opts.enabled;
  if (typeof opts.intervalMs === 'number' && opts.intervalMs >= 1000) _state450.intervalMs = opts.intervalMs;
  return {
    ok: true,
    previous,
    current: {
      enabled: _state450.enabled,
      intervalMs: _state450.intervalMs,
    },
  };
}

/**
 * resetUnifiedSafetyArm450()
 * @returns {{ok:boolean, version:string}}
 */
function resetUnifiedSafetyArm450() {
  _state450.lastStatus = null;
  _state450.lastWhoArmed = null;
  _state450.lastCheckTs = null;
  _state450.changeCount = 0;
  _state450.broadcastCount = 0;
  _state450.auditCount = 0;
  _state450.history = [];
  return { ok: true, version: UNIFIED_SAFETY_ARM_STATUS_VERSION450 };
}

/**
 * startPolling450(opts)
 * @param {object} [opts]
 * @param {object} [opts.adminWsHub]
 * @param {object} [opts.auditLog]
 */
function startPolling450(opts) {
  opts = opts || {};
  stopPolling450();
  _state450.intervalHandle = setInterval(function() {
    try { checkAndBroadcast450(opts); } catch (_) {}
  }, _state450.intervalMs);
  if (_state450.intervalHandle && typeof _state450.intervalHandle.unref === 'function') {
    _state450.intervalHandle.unref();
  }
}

/**
 * stopPolling450()
 */
function stopPolling450() {
  if (_state450.intervalHandle) {
    clearInterval(_state450.intervalHandle);
    _state450.intervalHandle = null;
  }
}

/**
 * wireUnifiedSafetyArmStatus450(app, opts)
 * @param {object} app — express-like app
 * @param {object} [opts]
 * @param {object} [opts.adminWsHub]
 * @param {object} [opts.auditLog]
 */
function wireUnifiedSafetyArmStatus450(app, opts) {
  if (!app || typeof app.get !== 'function') return;

  // V450-T01 GET /api/v1/admin/unified-safety-arm/status
  app.get('/api/v1/admin/unified-safety-arm/status', function(_req, res) {
    res.json(Object.assign({ ecosVersion: 'V450' }, getUnifiedSafetyArmStatus450()));
  });

  // V450-T02 POST /api/v1/admin/unified-safety-arm/configure
  app.post('/api/v1/admin/unified-safety-arm/configure', function(req, res) {
    const result = configureUnifiedSafetyArm450(req.body || {});
    res.json(Object.assign({ ok: true, ecosVersion: 'V450' }, result));
  });

  // V450-T03 POST /api/v1/admin/unified-safety-arm/reset
  app.post('/api/v1/admin/unified-safety-arm/reset', function(_req, res) {
    res.json(Object.assign({ ok: true, ecosVersion: 'V450' }, resetUnifiedSafetyArm450()));
  });

  // V450-T04 GET /api/v1/admin/summary/v450
  app.get('/api/v1/admin/summary/v450', function(_req, res) {
    res.json({
      ok: true,
      ecosVersion: 'V450',
      feature: 'unified-safety-arm-status — connects agentFleetSafetyArm447 + economicGuardSafetyArm449 + userProtection401 into a single operator dashboard',
      version: UNIFIED_SAFETY_ARM_STATUS_VERSION450,
      status: getUnifiedSafetyArmStatus450(),
    });
  });
}

module.exports = {
  UNIFIED_SAFETY_ARM_STATUS_VERSION450,
  checkAndBroadcast450,
  getUnifiedSafetyArmStatus450,
  configureUnifiedSafetyArm450,
  resetUnifiedSafetyArm450,
  startPolling450,
  stopPolling450,
  wireUnifiedSafetyArmStatus450,
  _state450,
};
