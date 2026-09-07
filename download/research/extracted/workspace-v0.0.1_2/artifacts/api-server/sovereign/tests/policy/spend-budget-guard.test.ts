/**
 * tests/policy/spend-budget-guard.test.ts — cumulative spend cap.
 *
 * The property under test: a runaway sequence of individually-small actions is
 * stopped at the exact budget boundary, the window resets spend over time, and
 * tenants are isolated — with everything fail-closed.
 *
 * HAPPY        actions under budget are allowed; running totals are exact.
 * EDGE         exact-limit boundary; rolling-window reset; tenant isolation;
 *              zero-amount authorize; authorizeAndCommit only records when allowed.
 * FAIL-CLOSED  unknown budget → deny; negative/non-bigint amount → throw;
 *              invalid config/tenant → throw; commit without budget → throw;
 *              the runaway-bill scenario is blocked with the exact overage.
 */

import { test, assert, eq } from "../_harness.mjs";
import {
  SpendBudgetGuard,
  SpendBudgetError,
} from "../../lib/policy/spend-budget-guard.ts";

const HOUR = 3_600_000;
const DOLLAR = 100_000n; // $1.00 in micro-cents

function freshGuard(limit: bigint, windowMs = HOUR): SpendBudgetGuard {
  const g = new SpendBudgetGuard();
  g.setBudget("acme", { limitMicroCents: limit, windowMs });
  return g;
}

// ─── HAPPY ─────────────────────────────────────────────────────────────────────

test("HAPPY: actions under budget are allowed and totals are exact", () => {
  const g = freshGuard(10n * DOLLAR); // $10
  const a = g.authorizeAndCommit("acme", 3n * DOLLAR, 1000); // $3
  assert(a.allowed, "first $3 allowed");
  eq(a.spentMicroCents.toString(), (3n * DOLLAR).toString(), "spent = $3");
  eq(a.remainingMicroCents.toString(), (7n * DOLLAR).toString(), "remaining = $7");

  const b = g.authorizeAndCommit("acme", 4n * DOLLAR, 2000); // $4 → $7 total
  assert(b.allowed, "next $4 allowed");
  eq(b.spentMicroCents.toString(), (7n * DOLLAR).toString(), "spent = $7");
  eq(b.remainingMicroCents.toString(), (3n * DOLLAR).toString(), "remaining = $3");
});

// ─── FAIL-CLOSED: the runaway-bill scenario (the whole point) ──────────────────

test("FAIL-CLOSED: a runaway of small actions is stopped at the budget boundary", () => {
  const g = freshGuard(10n * DOLLAR); // $10 budget
  const each = 12_000n; // $0.012 per action
  let allowed = 0;
  let denial = null as ReturnType<SpendBudgetGuard["authorize"]> | null;
  for (let i = 0; i < 5000; i++) {
    const auth = g.authorizeAndCommit("acme", each, 1000 + i);
    if (auth.allowed) allowed++;
    else { denial = auth; break; }
  }
  // floor(1_000_000 / 12_000) = 83 actions fit; the 84th is denied.
  eq(allowed, 83, "exactly 83 actions fit under $10 at $0.012 each");
  assert(denial && !denial.allowed, "the next action is denied");
  eq(denial!.spentMicroCents.toString(), (83n * 12_000n).toString(), "spent = 83 × $0.012");
  eq(denial!.overageMicroCents.toString(), (83n * 12_000n + 12_000n - 1_000_000n).toString(), "exact overage reported");
  assert(denial!.overageMicroCents > 0n, "overage is positive");
});

// ─── EDGE ──────────────────────────────────────────────────────────────────────

test("EDGE: exact-limit boundary — fits exactly, next μ¢ denied", () => {
  const g = freshGuard(100n);
  const exact = g.authorizeAndCommit("acme", 100n, 0);
  assert(exact.allowed, "exactly at limit is allowed");
  eq(exact.remainingMicroCents.toString(), "0", "nothing remaining");
  const over = g.authorize("acme", 1n, 0);
  assert(!over.allowed, "one more μ¢ denied");
  eq(over.overageMicroCents.toString(), "1", "overage is exactly 1");
});

test("EDGE: rolling window resets spend after it ages out", () => {
  const g = freshGuard(10n * DOLLAR, HOUR);
  g.authorizeAndCommit("acme", 10n * DOLLAR, 1_000_000); // fully spent
  assert(!g.authorize("acme", 1n, 1_000_000).allowed, "blocked while spend is in window");
  // jump just past the window → aged out
  const after = g.authorize("acme", 10n * DOLLAR, 1_000_000 + HOUR + 1);
  assert(after.allowed, "budget fresh after the window");
  eq(after.spentMicroCents.toString(), "0", "spend aged out to 0");
});

test("EDGE: tenants are isolated — one tenant's spend never counts against another", () => {
  const g = new SpendBudgetGuard();
  g.setBudget("a", { limitMicroCents: 5n * DOLLAR, windowMs: HOUR });
  g.setBudget("b", { limitMicroCents: 5n * DOLLAR, windowMs: HOUR });
  g.authorizeAndCommit("a", 5n * DOLLAR, 0); // a fully spent
  assert(!g.authorize("a", 1n, 0).allowed, "a is capped");
  const bAuth = g.authorize("b", 5n * DOLLAR, 0);
  assert(bAuth.allowed, "b is untouched by a's spend");
  eq(bAuth.spentMicroCents.toString(), "0", "b has spent nothing");
});

test("EDGE: authorizeAndCommit does NOT record when the action is denied", () => {
  const g = freshGuard(100n);
  const denied = g.authorizeAndCommit("acme", 101n, 0); // over budget
  assert(!denied.allowed, "over-budget denied");
  eq(denied.spentMicroCents.toString(), "0", "denied action did not inflate the total");
  // budget is still fully available
  assert(g.authorize("acme", 100n, 0).allowed, "full budget still available after a denial");
});

test("EDGE: zero-amount authorize is allowed and is a pure read", () => {
  const g = freshGuard(100n);
  g.authorizeAndCommit("acme", 40n, 0);
  const z = g.authorize("acme", 0n, 0);
  assert(z.allowed, "zero amount always fits");
  eq(z.spentMicroCents.toString(), "40", "reports current spend");
  eq(z.remainingMicroCents.toString(), "60", "reports remaining");
});

// ─── FAIL-CLOSED: input validation ─────────────────────────────────────────────

test("FAIL-CLOSED: an unknown budget denies (no spend allowed by default)", () => {
  const g = new SpendBudgetGuard();
  const auth = g.authorize("ghost", 1n, 0);
  assert(!auth.allowed, "unknown tenant denied");
  eq(auth.limitMicroCents.toString(), "0", "no limit");
  eq(auth.overageMicroCents.toString(), "1", "full amount is overage");
});

test("FAIL-CLOSED: negative or non-bigint amounts throw", () => {
  const g = freshGuard(100n);
  let a = false, b = false;
  try { g.authorize("acme", -1n, 0); } catch (e) { a = e instanceof SpendBudgetError; }
  try { g.authorize("acme", 5 as unknown as bigint, 0); } catch (e) { b = e instanceof SpendBudgetError; }
  assert(a, "negative amount throws");
  assert(b, "number (non-bigint) amount throws");
});

test("FAIL-CLOSED: invalid config and tenant throw", () => {
  const g = new SpendBudgetGuard();
  let a = false, b = false, c = false;
  try { g.setBudget("t", { limitMicroCents: 0n, windowMs: HOUR }); } catch (e) { a = e instanceof SpendBudgetError; }
  try { g.setBudget("t", { limitMicroCents: 100n, windowMs: 0 }); } catch (e) { b = e instanceof SpendBudgetError; }
  try { g.setBudget("", { limitMicroCents: 100n, windowMs: HOUR }); } catch (e) { c = e instanceof SpendBudgetError; }
  assert(a, "limit 0 throws");
  assert(b, "windowMs 0 throws");
  assert(c, "empty tenantId throws");
});

test("FAIL-CLOSED: commit without a budget throws", () => {
  const g = new SpendBudgetGuard();
  let threw = false;
  try { g.commit("no-budget", 1n, 0); } catch (e) { threw = e instanceof SpendBudgetError; }
  assert(threw, "committing without a budget throws");
});

test("EDGE: deleteBudget removes the budget and returns true; second call returns false (idempotent)", () => {
  const g = new SpendBudgetGuard();
  g.setBudget("del-tenant", { limitMicroCents: 100n, windowMs: 1000 });
  g.commit("del-tenant", 50n, 0);
  const first = g.deleteBudget("del-tenant");
  assert(first === true, "should return true when budget existed");
  assert(!g.hasBudget("del-tenant"), "hasBudget should be false after delete");
  // authorize after delete: no budget → fail-closed deny
  const auth = g.authorize("del-tenant", 1n, 0);
  assert(!auth.allowed, "authorize after delete should deny (fail-closed)");
  const second = g.deleteBudget("del-tenant");
  assert(second === false, "second delete should return false (idempotent)");
});
