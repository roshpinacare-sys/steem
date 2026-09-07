'use strict';
/**
 * lib/agentConsensusEngine208.js — ECOS V208 (Phase P97)
 *
 * Research source: BIM (Browser-native Inference Mesh) specification, Research PDF #2,
 * sections 7.1–7.3. "Tolerance-aware Consensus for Non-deterministic AI Outputs".
 *
 * CORE PROBLEM THIS SOLVES:
 * AI agent outputs are non-deterministic. The same prompt with slight temperature
 * variation produces different text. You cannot use binary equality (===) to verify
 * whether two agents produced "the same" output. Without this, automated payment
 * release requires expensive human review for EVERY task.
 *
 * WHAT BIM TEACHES US:
 * Use task-type-specific similarity metrics:
 *   • Code / structured text → Normalized Edit Distance (Levenshtein)
 *     Two agents writing the same function may differ in whitespace/variable names.
 *     If NED < threshold, outputs are "equivalent" → auto-approve.
 *   • Analytics / embeddings / vectors → Cosine Similarity
 *     Two agents analyzing the same dataset produce vectors pointing in the same
 *     direction if they agree. cos(θ) > threshold → auto-approve.
 *   • Natural language → Jaccard token overlap + length ratio
 *     More forgiving metric for prose outputs.
 *
 * THE 40/40/20 COMPUTE SPLIT (from BIM spec):
 *   Agent A (primary executor):    40%
 *   Agent B (parallel verifier):   40%  ← only paid if outputs agree
 *   Registry (protocol treasury):  20%
 *   Consensus arbiter (Node C):    Called only when A ≠ B.
 *     → Majority pair shares 80%. Minority gets 0 (slashing).
 *
 * HUMAN-IN-THE-LOOP THRESHOLD:
 * If consensus score is below HITL_THRESHOLD, do not auto-approve.
 * Escalate to human reviewer. This is the $20 guardrail in action.
 *
 * Pure module — no DB, no side effects.
 * @version 208.0.0
 */

// ── Constants ────────────────────────────────────────────────────────────────

/** NED threshold below which two code/text outputs are considered equivalent. */
const NED_APPROVAL_THRESHOLD_208 = 0.25;   // ≤25% normalized edit distance = agree

/** Cosine similarity threshold for vector/analytics outputs. */
const COSINE_APPROVAL_THRESHOLD_208 = 0.85; // ≥0.85 cosine similarity = agree

/** Jaccard overlap threshold for natural language outputs. */
const JACCARD_APPROVAL_THRESHOLD_208 = 0.60; // ≥60% token overlap = agree

/** Below this consensus score, escalate to human (HITL). */
const HITL_CONSENSUS_THRESHOLD_208 = 0.70;

/** Task types mapped to their verification strategy. */
const TASK_TYPE_STRATEGY_208 = {
  code:       'normalized_edit_distance',
  text:       'normalized_edit_distance',
  structured: 'normalized_edit_distance',
  vector:     'cosine_similarity',
  analytics:  'cosine_similarity',
  embedding:  'cosine_similarity',
  prose:      'jaccard_token',
  review:     'jaccard_token',
  default:    'jaccard_token',
};

// ── Error class ──────────────────────────────────────────────────────────────

class ConsensusError208 extends Error {
  constructor(msg, code = 'CONSENSUS_ERROR') {
    super(msg);
    this.name = 'ConsensusError208';
    this.code = code;
    this.statusCode = 400;
  }
}

// ── Metric 1: Normalized Edit Distance (Levenshtein) ─────────────────────────

/**
 * Compute normalized edit distance between two strings.
 * NED = editDistance(a, b) / max(|a|, |b|)
 * NED = 0 → identical. NED = 1 → completely different.
 *
 * Uses Wagner-Fischer DP algorithm. O(n×m) time, O(min(n,m)) space.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} — NED in [0, 1]
 */
function computeNED208(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    throw new ConsensusError208('Both inputs must be strings', 'INVALID_INPUT');
  }
  if (a === b) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return 1;

  // Normalize: lowercase, collapse whitespace (makes code comparison more fair)
  const na = a.toLowerCase().replace(/\s+/g, ' ').trim();
  const nb = b.toLowerCase().replace(/\s+/g, ' ').trim();
  if (na === nb) return 0;

  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 0;

  // Wagner-Fischer with two-row optimization
  const m = na.length, n = nb.length;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = na[i - 1] === nb[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return r4(prev[n] / maxLen);
}

// ── Metric 2: Cosine Similarity ───────────────────────────────────────────────

/**
 * Compute cosine similarity between two numeric vectors.
 * cos(θ) = (A·B) / (|A| × |B|)
 * Result: 1.0 = identical direction. 0 = orthogonal. -1 = opposite.
 *
 * @param {number[]} vecA
 * @param {number[]} vecB
 * @returns {number} — cosine similarity in [-1, 1]
 */
function computeCosineSimilarity208(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB)) {
    throw new ConsensusError208('Both inputs must be arrays', 'INVALID_INPUT');
  }
  if (vecA.length !== vecB.length) {
    throw new ConsensusError208(`Vector dimension mismatch: ${vecA.length} vs ${vecB.length}`, 'DIMENSION_MISMATCH');
  }
  if (vecA.length === 0) throw new ConsensusError208('Vectors must not be empty', 'EMPTY_VECTOR');

  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < vecA.length; i++) {
    const a = Number(vecA[i]) || 0;
    const b = Number(vecB[i]) || 0;
    dot  += a * b;
    magA += a * a;
    magB += b * b;
  }
  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);
  if (magA === 0 || magB === 0) return 0;
  return r4(dot / (magA * magB));
}

// ── Metric 3: Jaccard Token Overlap ──────────────────────────────────────────

/**
 * Compute Jaccard similarity over token sets for natural language outputs.
 * Jaccard = |A ∩ B| / |A ∪ B|
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} — Jaccard in [0, 1]
 */
function computeJaccardSimilarity208(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    throw new ConsensusError208('Both inputs must be strings', 'INVALID_INPUT');
  }
  const tokenize = s => new Set(s.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean));
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  const intersection = new Set([...setA].filter(t => setB.has(t)));
  const union = new Set([...setA, ...setB]);
  return r4(intersection.size / union.size);
}

// ── Master: compute consensus across N agent outputs ─────────────────────────

/**
 * Compute pairwise consensus across multiple agent outputs.
 * Returns an approval decision + the dominant output + split recommendation.
 *
 * BIM 40/40/20 split logic:
 *   2 agents agree  → both get paid (40/40/20)
 *   2 agents disagree → arbitrator (Node C) called
 *     → majority pair: 40+40 split, minority: 0 (slashing)
 *
 * @param {Object[]} agentOutputs — Array of { agentId, output, taskType? }
 * @param {Object}  [opts]
 * @param {string}   [opts.taskType]       — Override task type for all outputs
 * @param {number}   [opts.approvalThreshold] — Override threshold for approval
 * @returns {ConsensusResult208}
 */
function computeAgentConsensus208(agentOutputs, opts = {}) {
  if (!Array.isArray(agentOutputs) || agentOutputs.length < 2) {
    throw new ConsensusError208('At least 2 agent outputs required for consensus', 'INSUFFICIENT_AGENTS');
  }

  const taskType = opts.taskType || agentOutputs[0]?.taskType || 'default';
  const strategy = TASK_TYPE_STRATEGY_208[taskType] || TASK_TYPE_STRATEGY_208.default;

  // Compute pairwise similarity matrix
  const n = agentOutputs.length;
  const pairwiseScores = [];
  const similarityMatrix = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const outA = agentOutputs[i];
      const outB = agentOutputs[j];
      let score = 0;
      let method = strategy;
      let error = null;

      try {
        if (strategy === 'normalized_edit_distance') {
          const ned = computeNED208(String(outA.output), String(outB.output));
          score = 1 - ned; // Convert distance to similarity
        } else if (strategy === 'cosine_similarity') {
          const vecA = Array.isArray(outA.output) ? outA.output : JSON.parse(outA.output);
          const vecB = Array.isArray(outB.output) ? outB.output : JSON.parse(outB.output);
          score = computeCosineSimilarity208(vecA, vecB);
          score = Math.max(0, score); // floor at 0 for approval purposes
        } else {
          score = computeJaccardSimilarity208(String(outA.output), String(outB.output));
        }
      } catch (e) {
        error = e.message;
        score = 0;
      }

      similarityMatrix[i][j] = similarityMatrix[j][i] = score;
      pairwiseScores.push({
        agentA: outA.agentId || `agent_${i}`,
        agentB: outB.agentId || `agent_${j}`,
        score: r4(score),
        method,
        error: error || undefined,
      });
    }
  }

  // Find the output with highest average similarity to all others (consensus anchor)
  const avgSimilarities = agentOutputs.map((agent, i) => {
    const others = similarityMatrix[i].filter((_, j) => j !== i);
    const avg = others.length > 0 ? others.reduce((s, v) => s + v, 0) / others.length : 0;
    return { agentId: agent.agentId || `agent_${i}`, avgSimilarity: r4(avg), index: i };
  });
  avgSimilarities.sort((a, b) => b.avgSimilarity - a.avgSimilarity);
  const dominantAgent = avgSimilarities[0];
  const overallConsensusScore = r4(avgSimilarities.reduce((s, a) => s + a.avgSimilarity, 0) / n);

  // Determine threshold
  const approvalThreshold = opts.approvalThreshold !== undefined ? opts.approvalThreshold
    : strategy === 'normalized_edit_distance' ? (1 - NED_APPROVAL_THRESHOLD_208)
    : strategy === 'cosine_similarity'        ? COSINE_APPROVAL_THRESHOLD_208
    : JACCARD_APPROVAL_THRESHOLD_208;

  const autoApprove = overallConsensusScore >= approvalThreshold;
  const requiresHITL = overallConsensusScore < HITL_CONSENSUS_THRESHOLD_208;

  // BIM payment split recommendation
  const paymentSplit = buildPaymentSplit208(agentOutputs, avgSimilarities, approvalThreshold, similarityMatrix);

  return {
    autoApprove,
    requiresHITL,
    overallConsensusScore,
    approvalThreshold: r4(approvalThreshold),
    strategy,
    taskType,
    dominantOutput: {
      agentId: dominantAgent.agentId,
      avgSimilarity: dominantAgent.avgSimilarity,
      output: agentOutputs[dominantAgent.index].output,
    },
    pairwiseScores,
    agentRankings: avgSimilarities,
    paymentSplit,
    decision: autoApprove
      ? `AUTO_APPROVE — consensus score ${overallConsensusScore} ≥ threshold ${r4(approvalThreshold)}`
      : requiresHITL
      ? `ESCALATE_HUMAN — consensus score ${overallConsensusScore} < HITL threshold ${HITL_CONSENSUS_THRESHOLD_208}`
      : `REVIEW_NEEDED — consensus score ${overallConsensusScore} below approval threshold`,
    researchSource: 'BIM (Browser-native Inference Mesh) — tolerance-aware consensus for non-deterministic AI outputs',
    ecosVersion: 'V208',
  };
}

// ── BIM payment split builder ─────────────────────────────────────────────────

/**
 * Build the 40/40/20 payment split recommendation based on consensus.
 * BIM rule: agents that agree → both paid. Minority → slashed (0).
 */
function buildPaymentSplit208(agentOutputs, rankings, threshold, matrix) {
  const n = agentOutputs.length;
  if (n === 2) {
    const score = matrix[0][1];
    const agree = score >= threshold;
    return {
      model: '40/40/20 (BIM)',
      agentAPct: agree ? 40 : 0,
      agentBPct: agree ? 40 : 0,
      registryPct: 20,
      slashed: agree ? [] : [agentOutputs[0].agentId, agentOutputs[1].agentId],
      arbitrationRequired: !agree,
      note: agree
        ? 'Both agents agreed — full 40/40/20 split applied.'
        : 'Agents disagreed — arbitration (Node C) required. Both shares held in escrow.',
    };
  }
  // For N > 2: top-2 by similarity get 40/40, rest are minority (slashed)
  const top2 = rankings.slice(0, 2);
  const slashed = rankings.slice(2).map(r => r.agentId);
  return {
    model: `40/40/20 (BIM extended, N=${n})`,
    primaryAgentId: top2[0]?.agentId,
    primaryPct: 40,
    verifierAgentId: top2[1]?.agentId,
    verifierPct: 40,
    registryPct: 20,
    slashed,
    arbitrationRequired: false,
    note: `Top 2 agents by consensus similarity receive 40/40. ${slashed.length > 0 ? `Minority agents (${slashed.join(', ')}) slashed.` : ''}`,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function r4(n) { return Math.round(n * 10000) / 10000; }

// ── Module exports ────────────────────────────────────────────────────────────

module.exports = {
  computeNED208,
  computeCosineSimilarity208,
  computeJaccardSimilarity208,
  computeAgentConsensus208,
  ConsensusError208,
  NED_APPROVAL_THRESHOLD_208,
  COSINE_APPROVAL_THRESHOLD_208,
  JACCARD_APPROVAL_THRESHOLD_208,
  HITL_CONSENSUS_THRESHOLD_208,
  TASK_TYPE_STRATEGY_208,
};
