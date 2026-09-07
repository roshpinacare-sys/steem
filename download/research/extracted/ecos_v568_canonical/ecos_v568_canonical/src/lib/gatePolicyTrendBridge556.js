'use strict';
/**
 * src/lib/gatePolicyTrendBridge556.js — ECOS V556
 *
 * Enriches the gate/evaluate response with policyTrend and trendAgreement.
 *
 * After V555 fixed deepHealthPolicy546._readTrend546, policy546.getPolicy546()
 * is now a reliable second source of truth for trend. This bridge compares:
 *   - gateTrend:   evaluateGate554().trend   (reads getTrend542().direction directly)
 *   - policyTrend: getPolicy546().trend       (now also reads .direction after V555 fix)
 *
 * They should agree. If they don't → trendAgreement=false signals something is wrong.
 *
 * Usage:
 *   const { enrichWithPolicyTrend556 } = require('./gatePolicyTrendBridge556.js');
 *   const result = enrichWithPolicyTrend556(evaluateGate554(), getPolicy546());
 *
 * Output adds to gate result:
 *   policyTrend:     string    — policy546.trend
 *   policyDecision:  string    — policy546.decision
 *   trendAgreement:  bool      — gateTrend === policyTrend
 *   trendSources:    object    — { gate: '554', policy: '546' }
 *   enrichedBy:      'V556'
 *
 * All identifiers end in 556. Zero new npm deps. SACRED untouched.
 * @version 556.0.0
 */

const ENRICH_VERSION_556 = 'V556';

/**
 * Enrich a gate evaluation result with policy trend data.
 *
 * @param {object} gateResult   — return value of evaluateGate554()
 * @param {object} policyResult — return value of getPolicy546()
 * @returns {object} enriched result
 */
function enrichWithPolicyTrend556(gateResult, policyResult) {
  if (!gateResult || typeof gateResult !== 'object') {
    throw new Error('[V556] gateResult must be an object');
  }

  const gateTrend    = gateResult.trend   || 'unknown';
  const policyTrend  = (policyResult && policyResult.trend)    || 'unknown';
  const policyDecision = (policyResult && policyResult.decision) || 'unknown';
  const trendAgreement = (gateTrend !== 'unknown' && policyTrend !== 'unknown')
    ? gateTrend === policyTrend
    : null;   // null = cannot compare (one or both unknown)

  return Object.assign({}, gateResult, {
    policyTrend,
    policyDecision,
    trendAgreement,
    trendSources:  { gate: '554', policy: '546' },
    enrichedBy:    ENRICH_VERSION_556,
  });
}

/**
 * Build a full enriched evaluate result by calling both sources.
 * Soft-fails if either source throws — never propagates.
 *
 * @param {{
 *   evalFn554:   function,  // () => evaluateGate554()
 *   policyFn546: function,  // () => getPolicy546()
 * }} fns
 * @returns {object}
 */
function buildEnrichedEval556(fns) {
  const { evalFn554, policyFn546 } = fns || {};

  let gateResult   = null;
  let policyResult = null;

  try { gateResult   = evalFn554   ? evalFn554()   : null; } catch (e) {
    gateResult = { ok: false, error: e.message, trend: 'unknown', decision: 'MANUAL', score: 0, version: '554.0.0' };
  }
  try { policyResult = policyFn546 ? policyFn546() : null; } catch (e) {
    policyResult = { ok: false, error: e.message, trend: 'unknown', decision: 'MANUAL' };
  }

  if (!gateResult) {
    return {
      ok: false, trend: 'unknown', decision: 'MANUAL', score: 0,
      policyTrend: 'unknown', policyDecision: 'unknown',
      trendAgreement: null,
      trendSources: { gate: '554', policy: '546' },
      enrichedBy: ENRICH_VERSION_556,
      error: 'evalFn554 unavailable',
    };
  }

  return enrichWithPolicyTrend556(gateResult, policyResult);
}

module.exports = {
  enrichWithPolicyTrend556,
  buildEnrichedEval556,
  ENRICH_VERSION_556,
};
