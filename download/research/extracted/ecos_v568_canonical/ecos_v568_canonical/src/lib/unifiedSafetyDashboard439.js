'use strict';
/**
 * src/lib/unifiedSafetyDashboard439.js — ECOS V439
 *
 * Unified Safety Dashboard: aggregates safety signals from V401 (circuit breakers),
 * V402 (economic guards), V403 (proof-of-solvency), V437 (health escalation),
 * and V438 (solvency escalation) into a single operator score and breakdown.
 *
 * R1: sacred files untouched. R2: all identifiers end in 439. R3: no new npm deps.
 *
 * @version 439.0.0
 */

const UNIFIED_SAFETY_DASHBOARD_VERSION439 = '439.0.0';

function _moduleHealth439(name, requirePath, versionKey, healthFn) {
  try {
    const mod = require(requirePath);
    const version = mod[versionKey] || 'unknown';
    const health = typeof healthFn === 'function' ? healthFn(mod) : { ok: true };
    return { available: true, version, ...health };
  } catch (e) {
    return { available: false, error: e.message };
  }
}

function computeUnifiedSafetyDashboard439(opts) {
  opts = opts || {};

  // V401 circuit breaker status
  const v401 = _moduleHealth439('userProtection401', './userProtection401.js', 'PROTECT_VERSION_401', function(mod) {
    const breaker = (typeof mod.defaultCircuitBreaker401 === 'function') ? mod.defaultCircuitBreaker401() : null;
    if (!breaker || typeof breaker.status !== 'function') return { ok: false, reason: 'no breaker' };
    const st = breaker.status();
    const score = st.softPaused ? 0 : 100;
    return { ok: true, score, softPaused: st.softPaused, globalOutflowUsed: st.globalOutflowUsed, globalOutflowCap: st.globalOutflowCap };
  });

  // V402 economic guard status — now real via V448 if present
  const v402 = _moduleHealth439('economicMutationGuard402', './economicMutationGuard402.js', 'GUARD_VERSION_402', function() {
    try {
      const m448 = require('./economicGuardMonitor448.js');
      if (m448 && typeof m448.getHealthStatus448 === 'function') {
        const h = m448.getHealthStatus448();
        return { ok: true, score: h.stats.score, monitored: true, stats: h.stats, version: h.version };
      }
    } catch (_) {}
    return { ok: true, score: 100, monitored: false };
  });

  // V403 proof of solvency
  const v403 = _moduleHealth439('proofOfSolvency403', './proofOfSolvency403.js', 'SOLVENCY_VERSION_403', function(mod) {
    const balances = Array.isArray(opts.balances) ? opts.balances : [];
    const reserveMicro = opts.reserveMicro != null ? String(opts.reserveMicro) : null;
    const assessment = (typeof mod.assessSolvency403 === 'function')
      ? mod.assessSolvency403({ balances: balances, reserveMicro: reserveMicro })
      : null;
    if (!assessment) return { ok: false, reason: 'no assessSolvency403' };
    const score = assessment.solvent === true ? 100 : (assessment.solvent === false ? 0 : 50);
    return { ok: true, score, solvent: assessment.solvent, totalLiabilities: assessment.totalLiabilities, reserveMicro: assessment.reserveMicro };
  });

  // V437 health escalation
  const v437 = _moduleHealth439('healthDrivenEscalation437', './healthDrivenEscalation437.js', 'HEALTH_DRIVEN_ESCALATION_VERSION437', function(mod) {
    const log = mod._escalationLog437 || [];
    const recent = log.filter(function(e) { return e.escalated; });
    const score = recent.length === 0 ? 100 : 0;
    return { ok: true, score, recentEscalations: recent.length, logSize: log.length };
  });

  // V438 solvency escalation
  const v438 = _moduleHealth439('solvencyEscalationBridge438', './solvencyEscalationBridge438.js', 'SOLVENCY_ESCALATION_BRIDGE_VERSION438', function(mod) {
    const log = mod._solvencyLog438 || [];
    const recent = log.filter(function(e) { return e.escalated; });
    const score = recent.length === 0 ? 100 : 0;
    return { ok: true, score, recentEscalations: recent.length, logSize: log.length };
  });

  // Compute overall score as average of available module scores
  var modules = [v401, v402, v403, v437, v438];
  var availableModules = modules.filter(function(m) { return m.available && typeof m.score === 'number'; });
  var overallScore = availableModules.length
    ? Math.round(availableModules.reduce(function(s, m) { return s + m.score; }, 0) / availableModules.length)
    : 50;

  var status = overallScore >= 80 ? 'healthy' : (overallScore >= 50 ? 'degraded' : 'critical');

  return {
    version: UNIFIED_SAFETY_DASHBOARD_VERSION439,
    generatedAt: new Date().toISOString(),
    overallScore: overallScore,
    status: status,
    modules: {
      userProtection401: v401,
      economicMutationGuard402: v402,
      proofOfSolvency403: v403,
      healthDrivenEscalation437: v437,
      solvencyEscalationBridge438: v438,
    },
  };
}

function wireUnifiedSafetyDashboard439(app) {
  if (!app) return;

  // V439-T01 GET /api/v1/admin/safety/dashboard
  app.get('/api/v1/admin/safety/dashboard', function(req, res) {
    try {
      const result = computeUnifiedSafetyDashboard439(req.query || {});
      res.json({ ok: true, ecosVersion: 'V439', ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V439' });
    }
  });

  // V439-T02 GET /api/v1/admin/summary/v439
  app.get('/api/v1/admin/summary/v439', function(_req, res) {
    res.json({
      ok: true,
      ecosVersion: 'V439',
      version: UNIFIED_SAFETY_DASHBOARD_VERSION439,
      feature: 'unified-safety-dashboard — aggregates V401+V402+V403+V437+V438 into a single operator safety score',
      endpoints: ['GET /api/v1/admin/safety/dashboard [T01]', 'GET /api/v1/admin/summary/v439 [T02]'],
    });
  });
}

module.exports = {
  UNIFIED_SAFETY_DASHBOARD_VERSION439,
  computeUnifiedSafetyDashboard439,
  wireUnifiedSafetyDashboard439,
};
