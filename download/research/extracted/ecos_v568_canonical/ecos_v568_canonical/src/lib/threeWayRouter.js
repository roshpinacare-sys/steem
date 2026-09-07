'use strict';

/**
 * ThreeWayRouter -- V114 Research Integration
 * -------------------------------------------------------------------------
 * Extends the two-way confidence gate (AUTO_FLOW | HITL_QUEUE) to a three-way
 * router distinguishing beginner and senior validator paths.
 *
 * Research finding: "progressive disclosure as architecture" --
 *   - Simple tasks -> beginners with AI scaffolding + senior review
 *   - Complex/high-stakes tasks -> senior validators with full tooling + quorum
 *   - High-confidence tasks -> deterministic auto-settlement
 *
 * Routing (DETERMINISTIC -- no LLM):
 *   confidence >= AUTO_THRESHOLD (0.70)                       -> AUTO_FLOW
 *   confidence in [0.50, 0.70) AND non-high-stakes domain    -> BEGINNER_QUEUE
 *   confidence in [0.50, 0.70) AND high-stakes domain        -> SENIOR_QUEUE
 *   confidence < HITL_THRESHOLD (0.50)                       -> SENIOR_QUEUE + quorum
 *   confidence is NaN / null                                  -> SENIOR_QUEUE + quorum
 *
 * High-stakes domains (EU AI Act Annex III aligned):
 *   healthcare, medical, clinical, legal, law, contract, compliance,
 *   finance, financial, credit, employment, hiring, hr, education,
 *   biometric, surveillance, public-service, government, insurance, claims, housing
 */

const AUTO_THRESHOLD  = 0.70;
const HITL_THRESHOLD  = 0.50;

const HIGH_STAKES_DOMAINS = new Set([
  'healthcare', 'medical', 'clinical',
  'legal', 'law', 'contract', 'compliance',
  'finance', 'financial', 'credit', 'credit-scoring',
  'employment', 'hiring', 'hr',
  'education', 'academic',
  'biometric', 'surveillance',
  'public-service', 'government',
  'insurance', 'claims',
  'housing', 'eviction',
]);

/**
 * Route a task to the appropriate handler.
 * @param {{ confidence: number, domain?: string, taskType?: string, quorumRequired?: boolean }} params
 * @returns {{ verdict: 'AUTO_FLOW'|'BEGINNER_QUEUE'|'SENIOR_QUEUE', reason: string, requiresQuorum: boolean }}
 */
function routeTask({ confidence, domain = '', taskType = '', quorumRequired = false }) {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) {
    return { verdict: 'SENIOR_QUEUE', reason: 'confidence_null_or_nan', requiresQuorum: true };
  }

  if (quorumRequired) {
    return { verdict: 'SENIOR_QUEUE', reason: 'quorum_required_explicit', requiresQuorum: true };
  }

  if (confidence >= AUTO_THRESHOLD) {
    return {
      verdict: 'AUTO_FLOW',
      reason: `confidence_${confidence.toFixed(3)}_gte_auto_threshold_${AUTO_THRESHOLD}`,
      requiresQuorum: false,
    };
  }

  const domainLower = String(domain || taskType || '').toLowerCase();
  const isHighStakes = [...HIGH_STAKES_DOMAINS].some(d => domainLower.includes(d));

  if (confidence < HITL_THRESHOLD || isHighStakes) {
    return {
      verdict: 'SENIOR_QUEUE',
      reason: confidence < HITL_THRESHOLD
        ? `confidence_${confidence.toFixed(3)}_below_hitl_threshold_${HITL_THRESHOLD}`
        : `high_stakes_domain_${domainLower || 'unknown'}`,
      requiresQuorum: confidence < HITL_THRESHOLD,
    };
  }

  return {
    verdict: 'BEGINNER_QUEUE',
    reason: `confidence_${confidence.toFixed(3)}_beginner_band_non_high_stakes`,
    requiresQuorum: false,
  };
}

/** @returns {boolean} */
function isHighStakesDomain(domain) {
  const lower = String(domain || '').toLowerCase();
  return [...HIGH_STAKES_DOMAINS].some(d => lower.includes(d));
}

module.exports = { routeTask, isHighStakesDomain, HIGH_STAKES_DOMAINS, AUTO_THRESHOLD, HITL_THRESHOLD };
