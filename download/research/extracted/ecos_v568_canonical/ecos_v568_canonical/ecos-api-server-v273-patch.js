'use strict';
/**
 * ecos-api-server-v273-patch.js — ECOS V273 Canonical API Patch
 *
 * Additive upgrade over V268 patch. V273 introduces:
 *   - /api/v273/health              — full health + credit-health directives
 *   - /api/v273/perf                — aggregate perf telemetry (all modules + CHM)
 *   - /api/v273/providers/validate  — 23-contract validation
 *   - /api/v273/credit-health/check     — run live credit health check
 *   - /api/v273/credit-health/metrics   — last cached metrics
 *   - /api/v273/credit-health/directives — current halt/pause directives
 *   - /api/v273/credit-health/override  — operator manual override
 *   - /api/v273/credit-health/sybil-event — record sybil eval result
 *   - /api/v273/credit-health/tip-event   — record tip event
 *   - All V268 routes preserved (backward compatible)
 *
 * Zero new npm deps. Identifiers end with 273.
 */

const { CreditHealthMonitor273, CREDIT_HEALTH_THRESHOLDS_273 } = require('./src/lib/creditHealthMonitor273');
const { validateAllProviders273, PROVIDER_CONTRACTS_273 }        = require('./src/lib/providerAdapters273');

// Re-use V268 for all its modules
const {
  createV268State,
  registerEcosV268Routes,
} = require('./ecos-api-server-v268-patch.js');

// ── State factory ─────────────────────────────────────────────────────────────

function createV273State(deps = {}) {
  const base = createV268State(deps);

  // Wire creditHealthMonitor to live data sources from v268 state
  const chm = new CreditHealthMonitor273({
    creditReserve: base.credits  || deps.creditReserve || null,
    tipModule:     base.tips     || deps.tipModule     || null,
    sybilGuard:    base.sybil    || deps.sybilGuard    || null,
    logger:        deps.logger   || null,
    logAdapter:    deps.logAdapter || null,
  });

  return {
    ...base,
    creditHealthMonitor: chm,
    modules: {
      ...base.modules,
      creditHealthMonitor: 'CreditHealthMonitor273',
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function jsonHandler273(fn) {
  return (req, res) => {
    try { res.json(fn(req)); }
    catch (e) { res.status(500).json({ ok: false, error: e.message, ecosVersion: '273' }); }
  };
}

function asyncHandler273(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) { res.status(500).json({ ok: false, error: e.message, ecosVersion: '273' }); }
  };
}

// ── Route registration ────────────────────────────────────────────────────────

function registerEcosV273Routes(app, deps = {}) {
  if (!app || typeof app.get !== 'function' || typeof app.post !== 'function')
    throw new Error('registerEcosV273Routes: Express-like app with get/post required');

  const state = createV273State(deps);
  const chm   = state.creditHealthMonitor;

  // ── Meta ──────────────────────────────────────────────────────────────────

  app.get('/api/v273/health', jsonHandler273(() => {
    const health273 = chm.checkCreditHealthMonitorHealth273();
    return {
      ok:          true,
      version:     '273',
      modules:     Object.keys(state.modules),
      creditHealth: health273,
      directives:  {
        halt_issuance: health273.haltIssuance,
        pause_rewards: health273.pauseRewards,
      },
    };
  }));

  app.get('/api/v273/perf', jsonHandler273(() => {
    const base = state.credits?.getPerf268?.()     || null;
    const tips  = state.tips?.getPerf268?.()        || null;
    const sybil = state.sybil?.getPerf268?.()       || null;
    return {
      ok:      true,
      version: '273',
      perf: {
        creditReserve: base,
        tipModule:     tips,
        sybilGuard:    sybil,
        creditHealthMonitor: chm.getPerf273(),
      },
    };
  }));

  app.post('/api/v273/providers/validate', jsonHandler273((req) => {
    const result = validateAllProviders273(req.body || {});
    return { ok: result.ok, ecosVersion: '273', ...result };
  }));

  app.get('/api/v273/providers/contracts', jsonHandler273(() => ({
    ok: true, ecosVersion: '273', contracts: PROVIDER_CONTRACTS_273,
    count: Object.keys(PROVIDER_CONTRACTS_273).length,
  })));

  // ── Credit Health Monitor ─────────────────────────────────────────────────

  /**
   * POST /api/v273/credit-health/check
   * Runs a live credit health check, enforces directives, returns full metrics.
   */
  app.post('/api/v273/credit-health/check', jsonHandler273(() => {
    return chm.checkHealth273();
  }));

  app.get('/api/v273/credit-health/check', jsonHandler273(() => {
    return chm.checkHealth273();
  }));

  /**
   * GET /api/v273/credit-health/metrics
   * Returns last cached metrics snapshot (no recompute).
   */
  app.get('/api/v273/credit-health/metrics', jsonHandler273(() => {
    return chm.getMetrics273();
  }));

  /**
   * GET /api/v273/credit-health/directives
   * Returns current halt_issuance / pause_rewards state.
   */
  app.get('/api/v273/credit-health/directives', jsonHandler273(() => {
    const ia = chm.issuanceAllowed273();
    const ra = chm.rewardsAllowed273();
    return {
      ok:              true,
      version:         '273',
      halt_issuance:   !ia.allowed,
      pause_rewards:   !ra.allowed,
      haltReason:      ia.reason,
      pauseReason:     ra.reason,
      issuanceAllowed: ia.allowed,
      rewardsAllowed:  ra.allowed,
    };
  }));

  /**
   * POST /api/v273/credit-health/override
   * Body: { directive: 'halt_issuance'|'pause_rewards', value: bool, reason: string }
   * Operator manual override (escape hatch).
   */
  app.post('/api/v273/credit-health/override', jsonHandler273((req) => {
    const { directive, value, reason } = req.body || {};
    if (!directive) return { ok: false, error: 'directive required', ecosVersion: '273' };
    return { ...chm.manualOverride273(directive, !!value, reason), ecosVersion: '273' };
  }));

  /**
   * POST /api/v273/credit-health/sybil-event
   * Body: { userId: string, passed: bool }
   * Feeds a sybil evaluation result into the rolling window.
   */
  app.post('/api/v273/credit-health/sybil-event', jsonHandler273((req) => {
    const { userId, passed } = req.body || {};
    if (!userId) return { ok: false, error: 'userId required', ecosVersion: '273' };
    chm.recordSybilEval273(userId, !!passed);
    return { ok: true, ecosVersion: '273', recorded: { userId, passed: !!passed } };
  }));

  /**
   * POST /api/v273/credit-health/tip-event
   * Body: { fromUserId, toUserId, amountMicro: string (BigInt-parseable) }
   * Feeds a tip into the rolling circularity window.
   */
  app.post('/api/v273/credit-health/tip-event', jsonHandler273((req) => {
    const { fromUserId, toUserId, amountMicro } = req.body || {};
    if (!fromUserId || !toUserId) return { ok: false, error: 'fromUserId and toUserId required', ecosVersion: '273' };
    chm.recordTip273(fromUserId, toUserId, amountMicro ? BigInt(amountMicro) : 0n);
    return { ok: true, ecosVersion: '273', recorded: { fromUserId, toUserId } };
  }));

  /**
   * GET /api/v273/credit-health/thresholds
   * Returns the current threshold constants for dashboard display.
   */
  app.get('/api/v273/credit-health/thresholds', jsonHandler273(() => ({
    ok: true, ecosVersion: '273', thresholds: CREDIT_HEALTH_THRESHOLDS_273,
  })));

  // ── V268 routes (preserved) ───────────────────────────────────────────────
  registerEcosV268Routes(app, deps);

  return state;
}

module.exports = {
  createV273State,
  registerEcosV273Routes,
  CreditHealthMonitor273,
  CREDIT_HEALTH_THRESHOLDS_273,
};

if (process.env.NODE_ENV === 'test') {
  module.exports._createV273State = createV273State;
}
