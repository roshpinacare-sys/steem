/**
 * TFA Evolution Studio v28 — SLA Tracker
 *
 * Monitors cycle duration against budget and records SLA evidence.
 */

export interface SLABudget {
  maxDurationMs: number;
}

export function checkSLA(actualMs: number, budget: SLABudget): {
  withinBudget: boolean;
  overagePercent: number;
} {
  const withinBudget = actualMs <= budget.maxDurationMs;
  const overagePercent = withinBudget ? 0 : ((actualMs - budget.maxDurationMs) / budget.maxDurationMs) * 100;
  return { withinBudget, overagePercent };
}
