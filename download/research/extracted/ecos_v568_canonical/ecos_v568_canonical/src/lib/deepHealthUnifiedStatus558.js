'use strict';
/**
 * src/lib/deepHealthUnifiedStatus558.js — ECOS V558
 *
 * Unified deep-health status: combines trend seed + gate evaluate + policy.
 * Solves the trendAgreement=null problem: if trend is 'unknown' at call time,
 * performs a lazy boot-seed before evaluating, so callers always get a real result.
 *
 * CONNECTION: trendSeedBridge553 → gateEvaluateBridge554 → gatePolicyTrendBridge556
 *
 * Usage:
 *   const { getUnifiedStatus558 } = require('./deepHealthUnifiedStatus558.js');
 *   getUnifiedStatus558()  →  { ok, trend, trendAgreement, gateDecision, ... }
 *
 * fail-closed: any dependency missing → { ok: false, error, ... }
 * All identifiers end in 558. Zero npm deps.
 * @version 558.0.0
 */

const UNIFIED_VERSION_558 = '558.0.0';

// Lazy-loaded dependencies (loaded once on first call)
let _seed553_558   = null;
let _eval554_558   = null;
let _bridge556_558 = null;
let _policy546_558 = null;
let _loaded558     = false;

function _loadDeps558() {
  if (_loaded558) return;
  _loaded558 = true;
  try { _seed553_558   = require('./trendSeedBridge553.js');    } catch (_) {}
  try { _eval554_558   = require('./gateEvaluateBridge554.js'); } catch (_) {}
  try { _bridge556_558 = require('./gatePolicyTrendBridge556.js'); } catch (_) {}
  try { _policy546_558 = require('./deepHealthPolicy546.js');   } catch (_) {}
}

/**
 * _ensureSeed558() — if trend is unknown, fire a boot seed (non-fatal).
 * Returns the seed result or null.
 * @returns {object|null}
 */
function _ensureSeed558() {
  if (!_seed553_558) return null;
  try {
    const status558 = _seed553_558.getTrendStatus553();
    // If direction is unknown/undefined, fire a seed
    const dir558 = status558 && status558.direction;
    if (!dir558 || dir558 === 'unknown') {
      return _seed553_558.seedTrend553(10);
    }
    return null; // already seeded — no action
  } catch (_) {
    return null;
  }
}

/**
 * getUnifiedStatus558() — unified deep-health status with guaranteed trend.
 *
 * @returns {{
 *   ok:             boolean,
 *   version:        string,
 *   trend:          string,
 *   trendAgreement: boolean|null,
 *   gateDecision:   string,
 *   gateScore:      number|null,
 *   policyTrend:    string,
 *   seedFired:      boolean,
 *   seedResult:     object|null,
 *   enrichedBy:     string,
 *   error?:         string,
 * }}
 */
function getUnifiedStatus558() {
  _loadDeps558();

  if (!_eval554_558 || !_bridge556_558 || !_policy546_558) {
    return {
      ok:      false,
      version: UNIFIED_VERSION_558,
      error:   'missing_dependencies: gateEvaluateBridge554 / gatePolicyTrendBridge556 / deepHealthPolicy546',
    };
  }

  // 1. Ensure trend is seeded (lazy, non-fatal)
  const seedResult558 = _ensureSeed558();
  const seedFired558  = !!seedResult558;

  // 2. Build enriched eval (V556 logic: gate + policy trend agreement)
  let enriched558;
  try {
    enriched558 = _bridge556_558.buildEnrichedEval556({
      evalFn554:   () => _eval554_558.evaluateGate554(),
      policyFn546: () => _policy546_558.getPolicy546(),
    });
  } catch (e) {
    return { ok: false, version: UNIFIED_VERSION_558, error: e.message, seedFired: seedFired558 };
  }

  return {
    ok:             enriched558.ok !== false,
    version:        UNIFIED_VERSION_558,
    trend:          enriched558.gateTrend || enriched558.trend || 'unknown',
    trendAgreement: enriched558.trendAgreement,
    gateDecision:   enriched558.decision || 'unknown',
    gateScore:      enriched558.score != null ? enriched558.score : null,
    policyTrend:    enriched558.policyTrend || 'unknown',
    policyDecision: enriched558.policyDecision || 'unknown',
    seedFired:      seedFired558,
    seedResult:     seedResult558,
    enrichedBy:     enriched558.enrichedBy || 'V556+V558',
    trendSources:   enriched558.trendSources || null,
  };
}

module.exports = {
  UNIFIED_VERSION_558,
  getUnifiedStatus558,
  _ensureSeed558,
};
