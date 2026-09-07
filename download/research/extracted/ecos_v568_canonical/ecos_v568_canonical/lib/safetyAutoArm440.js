'use strict';
/**
 * src/lib/safetyAutoArm440.js — ECOS V440
 *
 * Safety-Driven Circuit Breaker Auto-Arm
 * Connects unifiedSafetyDashboard439 → userProtection401 circuit breaker.
 * When the unified safety score drops to critical, automatically soft-pause
 * the circuit breaker to halt new exposure. When health recovers, auto-disarm.
 * Creates a closed protective loop: detection → dashboard → action.
 *
 * R1: sacred files untouched. R2: all identifiers end in 440. R3: no new npm deps.
 *
 * @version 440.0.0
 */

const SAFETY_AUTO_ARM_VERSION440 = '440.0.0';

const _state440 = {
  autoArmed: false,
  lastScore: null,
  lastCheckTs: null,
  lastReason: null,
  armThreshold: 85,
  disarmThreshold: 95,
  history: [],
  maxHistory: 200,
};

/**
 * checkAndAutoArm440(opts)
 * @param {object} [opts]
 * @param {object} [opts.dashboardInput] — forwarded to computeUnifiedSafetyDashboard439
 * @returns {{ok:boolean, armed:boolean, score:number, status:string, reason:string, action:string, thresholds:{arm:number,disarm:number}}}
 */
function checkAndAutoArm440(opts) {
  opts = opts || {};

  const dashboardMod = require('./unifiedSafetyDashboard439.js');
  const dashboard = dashboardMod.computeUnifiedSafetyDashboard439(opts.dashboardInput || {});
  const score = dashboard.overallScore;
  const status = dashboard.status;

  const breakerMod = require('./userProtection401.js');
  const breaker = (typeof breakerMod.defaultCircuitBreaker401 === 'function')
    ? breakerMod.defaultCircuitBreaker401()
    : null;

  let armed = _state440.autoArmed;
  let reason = null;
  let action = 'none';

  if (!breaker) {
    reason = 'no_breaker';
  } else if (score <= _state440.armThreshold && !armed) {
    breaker.softPause('auto-arm440:safety_critical(score=' + score + ')');
    armed = true;
    reason = 'safety_critical_auto_armed';
    action = 'arm';
  } else if (armed) {
    // For disarm, compute score as if the breaker were NOT manually paused,
    // because the pause is an artifact of our own arming — not a root cause.
    let disarmScore = score;
    let restored = false;
    try {
      if (breaker._manualSoftPause) {
        breaker._manualSoftPause = false;
        restored = true;
        const simDashboard = dashboardMod.computeUnifiedSafetyDashboard439(opts.dashboardInput || {});
        disarmScore = simDashboard.overallScore;
      }
    } catch (_) {}
    finally { if (restored) { breaker._manualSoftPause = true; } }

    if (disarmScore >= _state440.disarmThreshold) {
      breaker.unpause();
      armed = false;
      reason = 'safety_recovered_auto_disarmed';
      action = 'disarm';
    } else {
      reason = 'remains_armed';
    }
  } else {
    reason = 'remains_disarmed';
  }

  _state440.autoArmed = armed;
  _state440.lastScore = score;
  _state440.lastCheckTs = Date.now();
  _state440.lastReason = reason;
  _state440.history.push({ ts: Date.now(), score: score, status: status, action: action, reason: reason });
  if (_state440.history.length > _state440.maxHistory) { _state440.history.shift(); }

  return {
    ok: true,
    armed: armed,
    score: score,
    status: status,
    reason: reason,
    action: action,
    thresholds: { arm: _state440.armThreshold, disarm: _state440.disarmThreshold },
  };
}

/**
 * getAutoArmStatus440()
 * @returns {{ok:boolean, version:string, state:object}}
 */
function getAutoArmStatus440() {
  return {
    ok: true,
    version: SAFETY_AUTO_ARM_VERSION440,
    state: JSON.parse(JSON.stringify(_state440)),
  };
}

/**
 * wireSafetyAutoArm440(app)
 * @param {object} app — Express-like app with .get() and .post()
 */
function wireSafetyAutoArm440(app) {
  if (!app || typeof app.get !== 'function' || typeof app.post !== 'function') { return; }

  // V440-T01 POST /api/v1/safety/auto-arm/check
  app.post('/api/v1/safety/auto-arm/check', function(req, res) {
    try {
      var result = checkAndAutoArm440(req.body || {});
      res.json(Object.assign({ ok: true, ecosVersion: 'V440' }, result));
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V440' });
    }
  });

  // V440-T02 GET /api/v1/safety/auto-arm/status
  app.get('/api/v1/safety/auto-arm/status', function(_req, res) {
    try {
      var result = getAutoArmStatus440();
      res.json(Object.assign({ ok: true, ecosVersion: 'V440' }, result));
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V440' });
    }
  });

  // V440-T03 GET /api/v1/admin/summary/v440
  app.get('/api/v1/admin/summary/v440', function(_req, res) {
    res.json({
      ok: true,
      ecosVersion: 'V440',
      version: SAFETY_AUTO_ARM_VERSION440,
      feature: 'Safety-Driven Circuit Breaker Auto-Arm — connects unifiedSafetyDashboard439 → userProtection401',
      endpoints: [
        'POST /api/v1/safety/auto-arm/check [T01]',
        'GET /api/v1/safety/auto-arm/status [T02]',
        'GET /api/v1/admin/summary/v440 [T03]',
      ],
      state: JSON.parse(JSON.stringify(_state440)),
    });
  });
}

module.exports = {
  SAFETY_AUTO_ARM_VERSION440: SAFETY_AUTO_ARM_VERSION440,
  checkAndAutoArm440: checkAndAutoArm440,
  getAutoArmStatus440: getAutoArmStatus440,
  wireSafetyAutoArm440: wireSafetyAutoArm440,
  _state440: _state440,
};
