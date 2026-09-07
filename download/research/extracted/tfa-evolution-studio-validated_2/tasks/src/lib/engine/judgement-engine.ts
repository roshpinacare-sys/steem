/**
 * TFA Evolution Studio v29 — Judgement Engine
 *
 * WS2: Multi-dimensional scoring for cycle quality.
 *
 * V29 adds two dimensions to capture long-term platform health:
 *   architecturalPayoff   — structural improvement value [0–1]
 *   maintainabilityPayoff — reduction in future maintenance burden [0–1]
 *
 * All 11 dimensions and their weights:
 *   impact (0.18), leverage (0.13), confidence (0.10),
 *   architectural_value (0.08), architecturalPayoff (0.09),
 *   maintainabilityPayoff (0.08), reuse_value (0.06),
 *   risk (0.10), cost (0.08), regression_probability (0.05),
 *   maintainability_cost (0.05)  — sum = 1.00
 */

// Weights sum to 1.00
const WEIGHTS = {
  impact: 0.18,
  leverage: 0.13,
  confidence: 0.10,
  architectural_value: 0.08,
  architecturalPayoff: 0.09,
  maintainabilityPayoff: 0.08,
  reuse_value: 0.06,
  risk: 0.10,
  cost: 0.08,
  regression_probability: 0.05,
  maintainability_cost: 0.05,
};

export interface JudgementInput {
  impact: number;               // 0–1
  leverage: number;             // 0–1
  risk: number;                 // 0–1 (lower is better, inverted)
  cost: number;                 // 0–1 (lower is better, inverted)
  confidence: number;           // 0–1
  architectural_value: number;
  reuse_value: number;
  regression_probability: number;
  maintainability_cost: number;
  /** V29: Long-term structural improvement value [0–1]. */
  architecturalPayoff?: number;
  /** V29: Reduction in future maintenance burden [0–1]. */
  maintainabilityPayoff?: number;
}

export interface JudgementResult {
  score: number;
  verdict: "proceed" | "caution" | "block";
  breakdown: Record<string, number>;
}

export function judgeCycle(input: JudgementInput): JudgementResult {
  const breakdown = {
    impact:                input.impact                             * WEIGHTS.impact,
    leverage:              input.leverage                           * WEIGHTS.leverage,
    confidence:            input.confidence                         * WEIGHTS.confidence,
    architectural_value:   input.architectural_value                * WEIGHTS.architectural_value,
    architecturalPayoff:   (input.architecturalPayoff ?? 0.5)       * WEIGHTS.architecturalPayoff,
    maintainabilityPayoff: (input.maintainabilityPayoff ?? 0.5)     * WEIGHTS.maintainabilityPayoff,
    reuse_value:           input.reuse_value                        * WEIGHTS.reuse_value,
    risk:                  (1 - input.risk)                         * WEIGHTS.risk,
    cost:                  (1 - input.cost)                         * WEIGHTS.cost,
    regression_probability:(1 - input.regression_probability)       * WEIGHTS.regression_probability,
    maintainability_cost:  (1 - input.maintainability_cost)         * WEIGHTS.maintainability_cost,
  };

  const score = Object.values(breakdown).reduce((sum, v) => sum + v, 0);

  let verdict: JudgementResult["verdict"] = "proceed";
  if (score < 0.5) verdict = "block";
  else if (score < 0.75) verdict = "caution";

  return { score, verdict, breakdown };
}
