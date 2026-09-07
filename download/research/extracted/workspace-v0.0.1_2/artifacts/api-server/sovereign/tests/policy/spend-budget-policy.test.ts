/**
 * tests/policy/spend-budget-policy.test.ts — SpendBudgetPolicy wired into the guard.
 *
 * Property under test: a value-bearing action is pre-authorized against the tenant's
 * cumulative budget before execution and committed after successful execution.
 * Non-financial actions are untouched. Over-budget actions are denied on the live path.
 */

import { test, assert, eq } from "../_harness.mjs";
import {
  SpendBudgetGuard,
  spendBudgetPolicy,
  extractValueMicrounits,
} from "../../lib/policy/index.ts";
import { TfaOrchestrator } from "../../lib/orchestrator/orchestrator.ts";
import { allowAll } from "../../lib/orchestrator/guard.ts";
import type { Action } from "../../lib/orchestrator/types.ts";

const HOUR = 3_600_000;
const DOLLAR = 100_000n;

function makeAction(overrides: Partial<Action> = {}): Action {
  return {
    id: "a1",
    tenantId: "acme",
    type: "billing.charge",
    payload: {},
    source: "test",
    isFinancial: true,
    isAutonomous: false,
    requestedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── extractValueMicrounits ────────────────────────────────────────────────────

test("extractValueMicrounits reads action.valueMicrounits first", () => {
  const action = makeAction({ valueMicrounits: 500n, payload: { amount: 300n } });
  eq(extractValueMicrounits(action).toString(), "500", "top-level wins");
});

test("extractValueMicrounits falls back to payload.amount", () => {
  const action = makeAction({ payload: { amount: 300n } });
  eq(extractValueMicrounits(action).toString(), "300", "payload.amount fallback");
});

test("extractValueMicrounits falls back to payload.valueMicrounits", () => {
  const action = makeAction({ payload: { valueMicrounits: 200n } });
  eq(extractValueMicrounits(action).toString(), "200", "payload.valueMicrounits fallback");
});

test("extractValueMicrounits defaults to 0n when nothing found", () => {
  const action = makeAction({ payload: {} });
  eq(extractValueMicrounits(action).toString(), "0", "default 0n");
});

// ─── HAPPY: financial action under budget → allow + commit ─────────────────────

test("HAPPY: financial action under budget is allowed and committed", async () => {
  const guard = new SpendBudgetGuard();
  guard.setBudget("acme", { limitMicroCents: 10n * DOLLAR, windowMs: HOUR });

  const policy = spendBudgetPolicy(guard);
  const orch = new TfaOrchestrator([allowAll(), policy], undefined, undefined, undefined, undefined, guard);

  const action = makeAction({ valueMicrounits: 3n * DOLLAR });
  const result = await orch.run(action, async () => "ok");

  assert(result.ok, "action allowed");
  eq(result.result, "ok", "executor result preserved");

  const auth = guard.authorize("acme", 0n, Date.now());
  eq(auth.spentMicroCents.toString(), (3n * DOLLAR).toString(), "committed spend recorded");
});

// ─── EDGE: non-financial action is untouched ───────────────────────────────────

test("EDGE: non-financial action bypasses spend check entirely", async () => {
  const guard = new SpendBudgetGuard();
  guard.setBudget("acme", { limitMicroCents: 100n, windowMs: HOUR });

  const policy = spendBudgetPolicy(guard);
  const orch = new TfaOrchestrator([allowAll(), policy], undefined, undefined, undefined, undefined, guard);

  const action = makeAction({ isFinancial: false, valueMicrounits: 999n * DOLLAR });
  const result = await orch.run(action, async () => "ok");

  assert(result.ok, "non-financial allowed regardless of huge value");

  const auth = guard.authorize("acme", 0n, Date.now());
  eq(auth.spentMicroCents.toString(), "0", "no spend committed for non-financial");
});

// ─── FAIL-CLOSED: over-budget financial action → deny on live path ────────────────

test("FAIL-CLOSED: over-budget financial action is denied with exact overage", async () => {
  const guard = new SpendBudgetGuard();
  guard.setBudget("acme", { limitMicroCents: 5n * DOLLAR, windowMs: HOUR });

  const policy = spendBudgetPolicy(guard);
  const orch = new TfaOrchestrator([allowAll(), policy], undefined, undefined, undefined, undefined, guard);

  // First action: spend $3
  const r1 = await orch.run(makeAction({ valueMicrounits: 3n * DOLLAR }), async () => "ok");
  assert(r1.ok, "first action allowed");

  // Second action: $3 more → total $6 > $5 budget → denied
  const r2 = await orch.run(makeAction({ valueMicrounits: 3n * DOLLAR }), async () => "ok");
  assert(!r2.ok, "second action denied");
  assert(r2.reason.includes("spend budget exceeded"), "denial reason mentions budget");
  assert(r2.reason.includes("overage"), "denial reason mentions overage");

  // Executor was NOT called for the second action (result is not "ok")
  eq(r2.result as any, undefined, "no result on denied action");
});

// ─── EDGE: no budget + requireBudget=false → allow ──────────────────────────────

test("EDGE: no budget with requireBudget=false allows financial action", async () => {
  const guard = new SpendBudgetGuard();
  const policy = spendBudgetPolicy(guard, { requireBudget: false });
  const orch = new TfaOrchestrator([allowAll(), policy], undefined, undefined, undefined, undefined, guard);

  const action = makeAction({ valueMicrounits: 5n * DOLLAR });
  const result = await orch.run(action, async () => "ok");

  assert(result.ok, "allowed when no budget and requireBudget=false");
});

// ─── FAIL-CLOSED: no budget + requireBudget=true → deny ─────────────────────────

test("FAIL-CLOSED: no budget with requireBudget=true denies financial action", async () => {
  const guard = new SpendBudgetGuard();
  const policy = spendBudgetPolicy(guard, { requireBudget: true });
  const orch = new TfaOrchestrator([allowAll(), policy], undefined, undefined, undefined, undefined, guard);

  const action = makeAction({ valueMicrounits: 1n * DOLLAR });
  const result = await orch.run(action, async () => "ok");

  assert(!result.ok, "denied when no budget and requireBudget=true");
  assert(result.reason.includes("no budget configured"), "reason mentions missing budget");
});

// ─── EDGE: executor throws → no commit recorded ─────────────────────────────────

test("EDGE: executor error does not commit spend", async () => {
  const guard = new SpendBudgetGuard();
  guard.setBudget("acme", { limitMicroCents: 10n * DOLLAR, windowMs: HOUR });

  const policy = spendBudgetPolicy(guard);
  const orch = new TfaOrchestrator([allowAll(), policy], undefined, undefined, undefined, undefined, guard);

  const action = makeAction({ valueMicrounits: 5n * DOLLAR });
  const result = await orch.run(action, async () => {
    throw new Error("boom");
  });

  assert(!result.ok, "executor error → orchestrator error");

  const auth = guard.authorize("acme", 0n, Date.now());
  eq(auth.spentMicroCents.toString(), "0", "no spend committed on executor failure");
});

// ─── EDGE: commit best-effort — no budget after allow does not break result ─────

test("EDGE: commit failure on missing budget is non-fatal when requireBudget=false", async () => {
  const guard = new SpendBudgetGuard();
  const policy = spendBudgetPolicy(guard, { requireBudget: false });
  const orch = new TfaOrchestrator([allowAll(), policy], undefined, undefined, undefined, undefined, guard);

  const action = makeAction({ valueMicrounits: 1n * DOLLAR });
  const result = await orch.run(action, async () => "ok");

  assert(result.ok, "orchestration succeeds even though commit threw (no budget)");
});
