import "../_flush.mjs";
/**
 * tests/policy/pricing-limits.test.ts — Pricing & Limits as policy-as-data (v99)
 *
 * maxMonthlyActions lets a policy deny financial actions once a tenant's monthly
 * usage (counted from the audit chain via UsageCountProvider) reaches a cap.
 * Plans (free/pro) are DATA — planPolicy("free") / planPolicy("pro") — composed
 * alongside defaultPolicies(), never code branches.
 *
 * Coverage (compiler level):
 *   • deny once usage count >= maxMonthlyActions
 *   • allow while usage count < maxMonthlyActions
 *   • fail-soft when no UsageCountProvider configured (condition never matches → allowed)
 *   • validatePolicy rejects negative / non-integer maxMonthlyActions
 *   • combined condition: maxMonthlyActions AND actionType (both must match)
 *   • sync-path unaffected: policies without maxMonthlyActions still evaluate synchronously
 *
 * Coverage (composition / end-to-end level):
 *   • makeUsageCountProvider counts only allowed mint/withdraw/transfer in the current UTC month
 *   • makeUsageCountProvider ignores denied/errored records and other action types
 *   • full stack: tenant on "free" plan (limit=50) — exercise via a tiny limit so the
 *     test runs fast — denied once the cap is reached, with audit + fail-closed reason
 *   • plans are tenant-isolated: a different tenant's usage doesn't count against this one
 */
import { test, eq, assert } from "../_harness.mjs";
import { compilePolicy, compilePolicies, validatePolicy } from "../../lib/policy/index.ts";
import type { UsageCountProvider } from "../../lib/policy/index.ts";
import { buildSovereignStack, makeUsageCountProvider, planPolicy, defaultPolicies, PLAN_LIMITS } from "../../src/composition.ts";
import { InMemoryAuditStore } from "../../lib/orchestrator/audit.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";

function ctx(over: any = {}): any {
  return {
    action: {
      id: "a1",
      type: over.type || "ledger.mint",
      payload: { amount: over.amount ?? 100n },
      source: over.source ?? "agent-x",
      isFinancial: over.isFinancial ?? true,
      isAutonomous: over.isAutonomous ?? false,
      requestedAt: "t",
    },
    tenantId: over.tenantId || "t1",
    timestamp: "t",
  };
}

const makeUsage = (countMap: Record<string, number>): UsageCountProvider =>
  async (tenantId: string) => countMap[tenantId] ?? 0;

// ─── Compiler-level: core allow/deny ──────────────────────────────────────────

test("maxMonthlyActions: deny when usage count >= limit", async () => {
  const usage = makeUsage({ t1: 50 });
  const p = compilePolicy(
    { name: "plan-limit", rules: [{ if: { maxMonthlyActions: 50 }, then: "deny", reason: "limit reached" }], default: "allow" },
    { usageCountProvider: usage },
  );
  const d = await p.evaluate(ctx());
  eq(d.allow, false);
  if (!d.allow) eq(d.reason, "limit reached");
});

test("maxMonthlyActions: allow when usage count < limit", async () => {
  const usage = makeUsage({ t1: 49 });
  const p = compilePolicy(
    { name: "plan-limit", rules: [{ if: { maxMonthlyActions: 50 }, then: "deny", reason: "limit reached" }], default: "allow" },
    { usageCountProvider: usage },
  );
  const d = await p.evaluate(ctx());
  eq(d.allow, true);
});

test("maxMonthlyActions: usage count exceeding limit still denies (>=, not ==)", async () => {
  const usage = makeUsage({ t1: 999 });
  const p = compilePolicy(
    { name: "plan-limit", rules: [{ if: { maxMonthlyActions: 50 }, then: "deny", reason: "limit reached" }], default: "allow" },
    { usageCountProvider: usage },
  );
  const d = await p.evaluate(ctx());
  eq(d.allow, false);
});

test("maxMonthlyActions: no provider configured → condition never matches → falls to default allow", async () => {
  const p = compilePolicy(
    { name: "plan-limit", rules: [{ if: { maxMonthlyActions: 0 }, then: "deny", reason: "limit reached" }], default: "allow" },
    {}, // no usageCountProvider
  );
  const d = await p.evaluate(ctx());
  eq(d.allow, true, "without a provider the limit is not enforced (documented fail-soft)");
});

// ─── Validation ────────────────────────────────────────────────────────────────

test("validatePolicy: rejects negative maxMonthlyActions", () => {
  const v = validatePolicy({ name: "x", rules: [{ if: { maxMonthlyActions: -1 }, then: "deny", reason: "r" }], default: "allow" });
  eq(v.ok, false);
  assert(v.errors.some(e => e.includes("maxMonthlyActions")));
});

test("validatePolicy: rejects non-integer maxMonthlyActions", () => {
  const v = validatePolicy({ name: "x", rules: [{ if: { maxMonthlyActions: 1.5 }, then: "deny", reason: "r" }], default: "allow" });
  eq(v.ok, false);
  assert(v.errors.some(e => e.includes("maxMonthlyActions")));
});

test("validatePolicy: accepts maxMonthlyActions: 0", () => {
  const v = validatePolicy({ name: "x", rules: [{ if: { maxMonthlyActions: 0 }, then: "deny", reason: "r" }], default: "allow" });
  eq(v.ok, true);
});

// ─── Combined conditions ───────────────────────────────────────────────────────

test("maxMonthlyActions combined with actionType: both must match", async () => {
  const usage = makeUsage({ t1: 100 });
  const p = compilePolicy(
    { name: "plan-limit", rules: [{ if: { actionType: ["ledger.mint"], maxMonthlyActions: 50 }, then: "deny", reason: "limit" }], default: "allow" },
    { usageCountProvider: usage },
  );
  // matching actionType + over limit → deny
  const d1 = await p.evaluate(ctx({ type: "ledger.mint" }));
  eq(d1.allow, false);
  // non-matching actionType, even though over limit → allow (rule doesn't apply)
  const d2 = await p.evaluate(ctx({ type: "ledger.transfer" }));
  eq(d2.allow, true);
});

// ─── Sync path unaffected ──────────────────────────────────────────────────────

test("policies without maxMonthlyActions remain synchronous (no Promise needed)", () => {
  const p = compilePolicy({ name: "sync", rules: [{ if: { actionType: ["ledger.mint"] }, then: "allow" }], default: "deny" });
  const result = p.evaluate(ctx());
  assert(!(result instanceof Promise), "sync policies must not return a Promise");
});

test("compilePolicies forwards usageCountProvider to every compiled policy", async () => {
  const usage = makeUsage({ t1: 50 });
  const [p1, p2] = compilePolicies(
    [
      { name: "a", rules: [{ if: { maxMonthlyActions: 50 }, then: "deny", reason: "a-limit" }], default: "allow" },
      { name: "b", rules: [{ if: { maxMonthlyActions: 1000 }, then: "deny", reason: "b-limit" }], default: "allow" },
    ],
    { usageCountProvider: usage },
  );
  const d1 = await p1.evaluate(ctx());
  const d2 = await p2.evaluate(ctx());
  eq(d1.allow, false); // 50 >= 50
  eq(d2.allow, true);  // 50 < 1000
});

// ─── makeUsageCountProvider (composition-level) ────────────────────────────────

test("makeUsageCountProvider: counts only allowed financial actions this month", async () => {
  const signer = new HmacSigner("test-secret-32-chars-minimum-len!");
  const store = new InMemoryAuditStore(signer);
  const now = new Date().toISOString();

  store.append({ id: "r1", tenantId: "tu", actionId: "x1", actionType: "ledger.mint", source: "s", outcome: "allowed", occurredAt: now });
  store.append({ id: "r2", tenantId: "tu", actionId: "x2", actionType: "ledger.transfer", source: "s", outcome: "allowed", occurredAt: now });
  // denied → not counted
  store.append({ id: "r3", tenantId: "tu", actionId: "x3", actionType: "ledger.withdraw", source: "s", outcome: "denied", reason: "x", occurredAt: now });
  // non-financial action type → not counted
  store.append({ id: "r4", tenantId: "tu", actionId: "x4", actionType: "potential.map", source: "s", outcome: "allowed", occurredAt: now });

  const provider = makeUsageCountProvider(store);
  const count = await provider("tu");
  eq(count, 2, "only the 2 allowed mint/transfer records count");
});

test("makeUsageCountProvider: ignores records from previous months", async () => {
  const signer = new HmacSigner("test-secret-32-chars-minimum-len!");
  const store = new InMemoryAuditStore(signer);

  const lastYear = new Date();
  lastYear.setUTCFullYear(lastYear.getUTCFullYear() - 1);

  store.append({ id: "r1", tenantId: "tm", actionId: "x1", actionType: "ledger.mint", source: "s", outcome: "allowed", occurredAt: lastYear.toISOString() });
  store.append({ id: "r2", tenantId: "tm", actionId: "x2", actionType: "ledger.mint", source: "s", outcome: "allowed", occurredAt: new Date().toISOString() });

  const provider = makeUsageCountProvider(store);
  const count = await provider("tm");
  eq(count, 1, "only this month's record counts");
});

test("makeUsageCountProvider: tenant isolation — different tenants counted separately", async () => {
  const signer = new HmacSigner("test-secret-32-chars-minimum-len!");
  const store = new InMemoryAuditStore(signer);
  const now = new Date().toISOString();

  store.append({ id: "r1", tenantId: "tenant-A", actionId: "x1", actionType: "ledger.mint", source: "s", outcome: "allowed", occurredAt: now });
  store.append({ id: "r2", tenantId: "tenant-A", actionId: "x2", actionType: "ledger.mint", source: "s", outcome: "allowed", occurredAt: now });
  store.append({ id: "r3", tenantId: "tenant-B", actionId: "x3", actionType: "ledger.mint", source: "s", outcome: "allowed", occurredAt: now });

  const provider = makeUsageCountProvider(store);
  eq(await provider("tenant-A"), 2);
  eq(await provider("tenant-B"), 1);
  eq(await provider("tenant-C"), 0, "unknown tenant → 0 (no chain)");
});

// ─── planPolicy + full stack ───────────────────────────────────────────────────

test("planPolicy: shape and limits match PLAN_LIMITS", () => {
  const free = planPolicy("free");
  const pro = planPolicy("pro");
  eq(free.name, "plan-limit-free");
  eq(pro.name, "plan-limit-pro");
  eq(free.rules[0].if.maxMonthlyActions, PLAN_LIMITS.free);
  eq(pro.rules[0].if.maxMonthlyActions, PLAN_LIMITS.pro);
  eq(free.default, "allow");
});

test("END-TO-END: full stack denies mint once tenant hits a small plan limit (policy-as-data)", async () => {
  // Use a custom tiny-limit policy (not the real "free" 50) so the test stays fast.
  const tinyPlan = { name: "plan-limit-tiny", rules: [{ if: { actionType: ["ledger.mint", "ledger.withdraw", "ledger.transfer"], maxMonthlyActions: 2 }, then: "deny", reason: "monthly action limit reached for plan \"tiny\" (2/mo)" }], default: "allow" as const };
  const stack = buildSovereignStack([...defaultPolicies(), tinyPlan]);

  const acc = await stack.ledger.createAccount("tenant-e2e", "owner-1", "asset", "Wallet");

  // mint 1 and 2 succeed (usage 0 and 1 at time of check, both < 2)
  const r1 = await stack.ledger.mint("tenant-e2e", acc.id, 1000n, "m1", "user-1", false);
  assert(r1.ok, "first mint should be allowed");
  const r2 = await stack.ledger.mint("tenant-e2e", acc.id, 1000n, "m2", "user-1", false);
  assert(r2.ok, "second mint should be allowed");

  // mint 3: usage is now 2 (>= 2) → denied
  const r3 = await stack.ledger.mint("tenant-e2e", acc.id, 1000n, "m3", "user-1", false);
  assert(!r3.ok, "third mint should be denied by plan limit");
  if (!r3.ok) assert(r3.reason?.includes("limit"), `reason should mention the limit, got: ${r3.reason}`);
});

test("END-TO-END: plan limits are tenant-isolated — a busy tenant doesn't block a fresh one", async () => {
  const tinyPlan = { name: "plan-limit-tiny2", rules: [{ if: { actionType: ["ledger.mint", "ledger.withdraw", "ledger.transfer"], maxMonthlyActions: 1 }, then: "deny", reason: "limit reached (tiny2)" }], default: "allow" as const };
  const stack = buildSovereignStack([...defaultPolicies(), tinyPlan]);

  const accBusy = await stack.ledger.createAccount("tenant-busy", "owner-1", "asset", "Wallet");
  const accFresh = await stack.ledger.createAccount("tenant-fresh", "owner-1", "asset", "Wallet");

  // exhaust tenant-busy's limit
  await stack.ledger.mint("tenant-busy", accBusy.id, 1000n, "m1", "user-1", false);
  const busySecond = await stack.ledger.mint("tenant-busy", accBusy.id, 1000n, "m2", "user-1", false);
  assert(!busySecond.ok, "tenant-busy should be over its limit");

  // tenant-fresh's first mint must still be allowed
  const freshFirst = await stack.ledger.mint("tenant-fresh", accFresh.id, 1000n, "m1", "user-1", false);
  assert(freshFirst.ok, "tenant-fresh should be unaffected by tenant-busy's usage");
});
