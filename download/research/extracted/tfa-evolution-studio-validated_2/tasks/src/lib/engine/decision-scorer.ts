/**
 * TFA Evolution Studio v29 — Decision Scorer
 *
 * WS2: Evidence-backed, history-aware decision scoring.
 *
 * Scores any proposed work item across 8 dimensions:
 *   impact               — expected value delivered
 *   risk                 — probability of harm (inverted)
 *   confidence           — certainty of the outcome estimate
 *   leverage             — force-multiplier over future work
 *   reuseValue           — reusability of artifacts produced
 *   regressionProbability — likelihood of breaking existing functionality (inverted)
 *   architecturalPayoff  — long-term structural improvement
 *   maintainabilityPayoff — reduction in future maintenance burden
 *
 * Decision priors (historical success rates from distillation-intelligence)
 * are wired in to adjust raw estimates with empirical evidence so the scorer
 * improves automatically as the platform accumulates cycles.
 *
 * Verdict thresholds:
 *   >= 0.80 → proceed       (high confidence + high value)
 *   >= 0.60 → caution       (proceed with evidence gate)
 *    < 0.60 → block         (insufficient case — gather more evidence first)
 */

import { getDecisionPrior } from "@/lib/distillation/distillation-intelligence";

// ── Weights ────────────────────────────────────────────────────────────────
// Must sum to 1.0 for a normalised [0,1] output score.

const WEIGHTS = {
  impact:                 0.20,
  confidence:             0.15,
  leverage:               0.12,
  architecturalPayoff:    0.12,
  risk:                   0.10,
  regressionProbability:  0.10,
  reuseValue:             0.10,
  maintainabilityPayoff:  0.11,
} as const;

// Sum check (compile-time assertion via const arithmetic):
// 0.20+0.15+0.12+0.12+0.10+0.10+0.10+0.11 = 1.00 ✓

// ── Types ──────────────────────────────────────────────────────────────────

export interface DecisionInput {
  /** Label used to look up historical decision priors for this class. */
  decisionClass: string;

  /** Raw estimates: all values in [0, 1]. */
  impact: number;
  risk: number;               // 0 = no risk, 1 = maximum risk
  confidence: number;
  leverage: number;
  reuseValue: number;
  regressionProbability: number;  // 0 = no regression risk, 1 = certain regression
  architecturalPayoff: number;
  maintainabilityPayoff: number;
}

export interface DecisionScore {
  /** Normalised composite score [0, 1]. */
  score: number;
  verdict: "proceed" | "caution" | "block";
  /** Per-dimension weighted contributions. */
  breakdown: Record<keyof typeof WEIGHTS, number>;
  /** Historical prior applied (null = no prior available). */
  priorApplied: { successRate: number; observations: number } | null;
  /** Adjustment applied from prior (positive = uplifted, negative = penalised). */
  priorAdjustment: number;
  rationale: string;
}

export interface RankedDecision {
  decisionClass: string;
  score: DecisionScore;
}

// ── Core scoring ───────────────────────────────────────────────────────────

/**
 * Score a single decision input.
 *
 * Prior adjustment: if a decision prior exists for this class, the raw score
 * is adjusted by ±0.10 × (successRate - 0.5) so a 90% historical success
 * rate adds +0.04 and a 10% rate subtracts 0.04. This keeps the prior
 * influential but non-dominating.
 */
export function scoreDecision(input: DecisionInput): DecisionScore {
  const raw = computeRawBreakdown(input);
  const rawScore = Object.values(raw).reduce((s, v) => s + v, 0);

  const prior = getDecisionPrior(input.decisionClass);
  const priorAdjustment = prior
    ? 0.10 * (prior.successRate - 0.5)
    : 0;
  const score = Math.max(0, Math.min(1, rawScore + priorAdjustment));

  const verdict: DecisionScore["verdict"] =
    score >= 0.80 ? "proceed" :
    score >= 0.60 ? "caution" :
    "block";

  const rationale = buildRationale(input, score, verdict, prior, priorAdjustment);

  return {
    score: parseFloat(score.toFixed(4)),
    verdict,
    breakdown: raw,
    priorApplied: prior
      ? { successRate: prior.successRate, observations: prior.totalObservations }
      : null,
    priorAdjustment: parseFloat(priorAdjustment.toFixed(4)),
    rationale,
  };
}

/**
 * Score multiple decisions and rank them by composite score descending.
 * The top-ranked decision is the platform's recommendation for what to work
 * on next — this is how WS2 directly influences execution order.
 */
export function rankDecisions(inputs: DecisionInput[]): RankedDecision[] {
  return inputs
    .map(i => ({ decisionClass: i.decisionClass, score: scoreDecision(i) }))
    .sort((a, b) => b.score.score - a.score.score);
}

/**
 * Return the highest-scoring decision from a candidate list.
 * Falls back to the first candidate if all scores are equal.
 */
export function selectBestDecision(inputs: DecisionInput[]): DecisionInput | null {
  if (inputs.length === 0) return null;
  const ranked = rankDecisions(inputs);
  return inputs.find(i => i.decisionClass === ranked[0].decisionClass) ?? inputs[0];
}

// ── Private helpers ────────────────────────────────────────────────────────

function computeRawBreakdown(input: DecisionInput): Record<keyof typeof WEIGHTS, number> {
  return {
    impact:                 input.impact                * WEIGHTS.impact,
    confidence:             input.confidence            * WEIGHTS.confidence,
    leverage:               input.leverage              * WEIGHTS.leverage,
    architecturalPayoff:    input.architecturalPayoff   * WEIGHTS.architecturalPayoff,
    risk:                   (1 - input.risk)            * WEIGHTS.risk,
    regressionProbability:  (1 - input.regressionProbability) * WEIGHTS.regressionProbability,
    reuseValue:             input.reuseValue            * WEIGHTS.reuseValue,
    maintainabilityPayoff:  input.maintainabilityPayoff * WEIGHTS.maintainabilityPayoff,
  };
}

function buildRationale(
  input: DecisionInput,
  score: number,
  verdict: DecisionScore["verdict"],
  prior: ReturnType<typeof getDecisionPrior>,
  priorAdj: number,
): string {
  const parts: string[] = [
    `score=${score.toFixed(3)} verdict=${verdict}`,
    `impact=${input.impact.toFixed(2)} leverage=${input.leverage.toFixed(2)} confidence=${input.confidence.toFixed(2)}`,
    `architecturalPayoff=${input.architecturalPayoff.toFixed(2)} maintainabilityPayoff=${input.maintainabilityPayoff.toFixed(2)}`,
    `risk=${input.risk.toFixed(2)} regressionProbability=${input.regressionProbability.toFixed(2)} reuseValue=${input.reuseValue.toFixed(2)}`,
  ];
  if (prior) {
    parts.push(
      `prior[${input.decisionClass}]: successRate=${prior.successRate.toFixed(2)} n=${prior.totalObservations} adjustment=${priorAdj >= 0 ? "+" : ""}${priorAdj.toFixed(3)}`
    );
  } else {
    parts.push(`prior[${input.decisionClass}]: none (no historical data)`);
  }
  if (verdict === "block") parts.push("BLOCKED — gather more evidence or reduce risk before proceeding");
  if (verdict === "caution") parts.push("CAUTION — proceed only after passing evidence gate");
  return parts.join(" | ");
}
