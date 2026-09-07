'use strict';
/**
 * src/lib/safetySovereignGuard442.js — ECOS V442
 *
 * Safety-Aware Sovereign Guard
 * Connects unifiedSafetyDashboard439 → sovereignModelServer416.
 * When safety is critical, forces local-only model routing and blocks
 * external backends even if the caller passes allowExternal=true.
 * When degraded, restricts external to explicit opt-in with caution banner.
 * When healthy, passes through normally.
 *
 * R1: sacred files untouched. R2: all identifiers end in 442. R3: no new npm deps.
 *
 * @version 442.0.0
 */

const SAFETY_SOVEREIGN_GUARD_VERSION442 = '442.0.0';

const _thresholds442 = {
  critical: 50,
  degraded: 80,
};

const _state442 = {
  lastMode: null,
  lastScore: null,
  lastCheckTs: null,
  queryCount: 0,
  blockedExternalCount: 0,
};

/**
 * getSovereignSafetyMode442()
 * Reads the unified safety dashboard and returns a sovereign-safety mode.
 * @returns {{ok:boolean, mode:string, score:number, thresholds:object}}
 */
function getSovereignSafetyMode442() {
  const dashboardMod = require('./unifiedSafetyDashboard439.js');
  const dashboard = dashboardMod.computeUnifiedSafetyDashboard439({});
  const score = dashboard.overallScore;
  const mode = score <= _thresholds442.critical ? 'critical'
    : (score <= _thresholds442.degraded ? 'degraded' : 'healthy');

  _state442.lastMode = mode;
  _state442.lastScore = score;
  _state442.lastCheckTs = Date.now();

  return { ok: true, mode, score, thresholds: _thresholds442, dashboardStatus: dashboard.status };
}

/**
 * runSafetyAwareQuery442(opts)
 * Wraps sovereignModelServer416.query416 with safety-aware enforcement.
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {string} opts.userId
 * @param {boolean} [opts.allowExternal]
 * @param {string} [opts.preferBackendId]
 * @returns {object}
 */
function runSafetyAwareQuery442(opts) {
  opts = opts || {};
  const safety = getSovereignSafetyMode442();
  const mode = safety.mode;
  const score = safety.score;

  const routerMod = require('./sovereignModelServer416.js');
  const router = routerMod.defaultSovereignRouter416();

  let allowExternal = Boolean(opts.allowExternal);
  let policyAction = 'pass';
  let safetyBanner = null;

  if (mode === 'critical') {
    allowExternal = false;
    policyAction = 'blocked_external';
    safetyBanner = 'Safety status is CRITICAL. External model routing is blocked. Only local sovereign backends are permitted.';
  } else if (mode === 'degraded') {
    policyAction = 'caution';
    safetyBanner = 'Safety status is DEGRADED. External model routing requires explicit opt-in and is subject to audit.';
    // keep allowExternal as caller specified, but the banner warns
  }

  const result = router.query416({
    prompt: opts.prompt,
    userId: opts.userId,
    allowExternal: allowExternal,
    preferBackendId: opts.preferBackendId || null,
  });

  _state442.queryCount++;
  if (mode === 'critical' && opts.allowExternal) {
    _state442.blockedExternalCount++;
  }

  return {
    ok: result.ok,
    queryId: result.queryId,
    userId: result.userId,
    backend: result.backend || null,
    prompt: result.prompt,
    response: result.response,
    secretsScrubbed: result.secretsScrubbed,
    sovereignVersion: result.sovereignVersion,
    safety: {
      mode: mode,
      score: score,
      policyAction: policyAction,
      safetyBanner: safetyBanner,
      allowExternalOriginal: Boolean(opts.allowExternal),
      allowExternalEffective: allowExternal,
    },
    guardVersion: SAFETY_SOVEREIGN_GUARD_VERSION442,
  };
}

/**
 * getSovereignGuardStatus442()
 * @returns {{ok:boolean, version:string, state:object, thresholds:object}}
 */
function getSovereignGuardStatus442() {
  return {
    ok: true,
    version: SAFETY_SOVEREIGN_GUARD_VERSION442,
    state: JSON.parse(JSON.stringify(_state442)),
    thresholds: JSON.parse(JSON.stringify(_thresholds442)),
  };
}

/**
 * wireSafetySovereignGuard442(app)
 * Wires V442 endpoints to the Express app.
 * @param {object} app
 */
function wireSafetySovereignGuard442(app) {
  if (!app || typeof app.post !== 'function' || typeof app.get !== 'function') {
    return;
  }

  // V442-T01 POST /api/v1/sovereign/safe-query
  app.post('/api/v1/sovereign/safe-query', function(req, res) {
    try {
      const b = req.body || {};
      if (!b.prompt) {
        return res.status(400).json({ ok: false, error: 'prompt required', ecosVersion: 'V442' });
      }
      if (!b.userId) {
        return res.status(400).json({ ok: false, error: 'userId required', ecosVersion: 'V442' });
      }
      const result = runSafetyAwareQuery442({
        prompt: b.prompt,
        userId: b.userId,
        allowExternal: Boolean(b.allowExternal),
        preferBackendId: b.preferBackendId || null,
      });
      res.json(Object.assign({ ecosVersion: 'V442' }, result));
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V442' });
    }
  });

  // V442-T02 GET /api/v1/sovereign/safety/status
  app.get('/api/v1/sovereign/safety/status', function(_req, res) {
    try {
      const status = getSovereignGuardStatus442();
      res.json(Object.assign({ ecosVersion: 'V442' }, status));
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V442' });
    }
  });

  // V442-T03 GET /api/v1/admin/summary/v442
  app.get('/api/v1/admin/summary/v442', function(_req, res) {
    res.json({
      ok: true,
      ecosVersion: 'V442',
      version: SAFETY_SOVEREIGN_GUARD_VERSION442,
      feature: 'Safety-Aware Sovereign Guard — connects unifiedSafetyDashboard439 → sovereignModelServer416',
      endpoints: [
        'POST /api/v1/sovereign/safe-query [T01]',
        'GET /api/v1/sovereign/safety/status [T02]',
        'GET /api/v1/admin/summary/v442 [T03]',
      ],
      state: JSON.parse(JSON.stringify(_state442)),
    });
  });
}

module.exports = {
  SAFETY_SOVEREIGN_GUARD_VERSION442: SAFETY_SOVEREIGN_GUARD_VERSION442,
  getSovereignSafetyMode442: getSovereignSafetyMode442,
  runSafetyAwareQuery442: runSafetyAwareQuery442,
  getSovereignGuardStatus442: getSovereignGuardStatus442,
  wireSafetySovereignGuard442: wireSafetySovereignGuard442,
  _state442: _state442,
};
