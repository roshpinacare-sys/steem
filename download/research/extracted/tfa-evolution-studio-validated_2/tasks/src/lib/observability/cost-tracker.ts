/**
 * TFA Evolution Studio v28 — Cost Tracker
 *
 * Estimates and records token/spend budgets per cycle.
 */

export interface CostEstimate {
  tokens: number;
  estimatedSpend: number;
}

export function estimateCost(promptLength: number, model = "gpt-4o"): CostEstimate {
  // Simplified estimation
  const tokens = Math.ceil(promptLength / 4);
  const rate = model.includes("4o") ? 0.000005 : 0.000001;
  return { tokens, estimatedSpend: tokens * rate };
}
