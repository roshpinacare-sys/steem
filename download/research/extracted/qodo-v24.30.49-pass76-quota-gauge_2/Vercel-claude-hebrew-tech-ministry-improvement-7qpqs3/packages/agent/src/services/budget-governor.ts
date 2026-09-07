/**
 * budget-governor.ts — a hard per-run spend cap enforced against the live
 * cost tracker. Distinct from `QODO_COST_ALERT_USD_CENTS`, which only *warns*:
 * this HALTS the pipeline before the next expensive or destructive step once
 * estimated spend reaches the cap set in `.qodo/policy.yml`
 * (`budget.maxUsdCents`). Runaway-spend protection is the single biggest fear
 * of running an autonomous agent; this makes the ceiling explicit and owned by
 * the repo, not the operator's global env.
 *
 * Module-level state (one run per process, like the dry-run + kill-switch
 * guards). `initBudget` is called once at run start; `budgetStatus` is polled
 * at phase boundaries.
 */
import { costTracker } from "./ai-router.js";

let capCents = 0; // 0 = disabled

/** Arm the governor. A non-positive cap disables it (no behavior change). */
export function initBudget(maxUsdCents: number | undefined | null): void {
  capCents = typeof maxUsdCents === "number" && maxUsdCents > 0 ? maxUsdCents : 0;
}

export interface BudgetStatus {
  /** The configured cap in cents (0 = disabled). */
  capCents: number;
  /** Estimated spend so far in cents. */
  spentCents: number;
  /** True once spend has reached or passed an enabled cap. */
  exceeded: boolean;
}

export function budgetStatus(): BudgetStatus {
  // When no cap is set (the default), don't even read the tracker — there is
  // nothing to enforce, and the guard must stay a no-op for runs that never
  // opted in to a budget.
  if (capCents <= 0) return { capCents: 0, spentCents: 0, exceeded: false };
  const spentCents = costTracker.totals().estimatedUsdCents;
  return { capCents, spentCents, exceeded: spentCents >= capCents };
}

/** Test/reset hook. */
export function _resetBudget(): void {
  capCents = 0;
}
