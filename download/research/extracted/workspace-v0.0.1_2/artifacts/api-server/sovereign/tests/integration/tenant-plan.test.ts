import "../_flush.mjs";
/**
 * tests/integration/tenant-plan.test.ts — connect plan to tenant (v100 → 14b)
 *
 * v99 introduced `planPolicy("free"|"pro")` (policy-as-data) but it was only
 * composable globally — no per-tenant binding existed. This cycle closes that
 * gap:
 *
 *   • `TenantPlanRegistry` (src/composition.ts) — tenantId → "free"|"pro" map.
 *   • `buildSovereignStack` now ALWAYS installs a "tenant-plan-limit" guard that
 *     consults the registry per-request; tenants with no entry are unaffected
 *     (fail-soft, matches the documented "no provider → not enforced" pattern).
 *   • POST /api/tenants accepts an optional `plan` field: defaults new tenants
 *     to "free", validates "free"|"pro", allows upgrades on repeat calls, and
 *     leaves the plan untouched when omitted on a repeat call.
 *
 * Coverage:
 *   • TenantPlanRegistry: get/set, isValidPlan
 *   • buildSovereignStack installs "tenant-plan-limit" in stack.policies
 *   • guard: tenant with NO plan assigned → always allow (fail-soft)
 *   • guard: tenant on "free" → denied once usage reaches PLAN_LIMITS.free
 *   • guard: tenant on "pro" → same usage still allowed (higher cap)
 *   • guard: plan limits are tenant-isolated
 *   • POST /api/tenants: defaults new tenant to plan "free"
 *   • POST /api/tenants: explicit plan="pro" on creation
 *   • POST /api/tenants: invalid plan → 400
 *   • POST /api/tenants: repeat call without `plan` leaves it unchanged; with
 *     `plan` re-assigns (upgrade)
 *   • END-TO-END (HTTP): a tenant onboarded with plan="free" is denied a mint
 *     once its monthly usage reaches the free limit
 */
import { test, eq, assert } from "../_harness.mjs";
import { buildSovereignStack, defaultPolicies, TenantPlanRegistry, PLAN_LIMITS } from "../../src/composition.ts";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";

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

/** Append `n` "allowed ledger.mint" audit records for `tenantId`, dated now (current UTC month). */
function seedUsage(stack: ReturnType<typeof buildSovereignStack>, tenantId: string, n: number): void {
  const now = new Date().toISOString();
  for (let i = 0; i < n; i++) {
    stack.orchestrator.audit.append({
      id: `seed-${tenantId}-${i}`,
      tenantId,
      actionId: `seed-${i}`,
      actionType: "ledger.mint",
      source: "seed",
      outcome: "allowed",
      occurredAt: now,
    });
  }
}

// ─── TenantPlanRegistry ─────────────────────────────────────────────────────

test("TenantPlanRegistry: get returns undefined for unknown tenant", () => {
  const reg = new TenantPlanRegistry();
  eq(reg.get("nope"), undefined);
});

test("TenantPlanRegistry: set then get round-trips", () => {
  const reg = new TenantPlanRegistry();
  reg.set("tenant-x", "pro");
  eq(reg.get("tenant-x"), "pro");
  reg.set("tenant-x", "free");
  eq(reg.get("tenant-x"), "free");
});

test("TenantPlanRegistry.isValidPlan: accepts free/pro, rejects others", () => {
  assert(TenantPlanRegistry.isValidPlan("free"));
  assert(TenantPlanRegistry.isValidPlan("pro"));
  assert(!TenantPlanRegistry.isValidPlan("enterprise"));
  assert(!TenantPlanRegistry.isValidPlan(123));
  assert(!TenantPlanRegistry.isValidPlan(undefined));
});

// ─── buildSovereignStack: tenant-plan-limit guard installed ────────────────

test("buildSovereignStack: installs 'tenant-plan-limit' guard and exposes tenantPlans", () => {
  const stack = buildSovereignStack();
  assert(stack.tenantPlans instanceof TenantPlanRegistry, "tenantPlans is a TenantPlanRegistry");
  const guard = stack.policies.find((p) => p.name === "tenant-plan-limit");
  assert(guard, "tenant-plan-limit guard present in stack.policies");
});

test("tenant-plan-limit guard: tenant with no plan assigned → always allow", async () => {
  const stack = buildSovereignStack();
  const guard = stack.policies.find((p) => p.name === "tenant-plan-limit")!;
  // Heavy usage, but no plan registered for this tenant → fail-soft allow.
  seedUsage(stack, "no-plan-tenant", PLAN_LIMITS.free + 10);
  const d = await guard.evaluate(ctx({ tenantId: "no-plan-tenant" }));
  eq(d.allow, true, "no plan assigned → not enforced");
});

test("tenant-plan-limit guard: 'free' plan denies once usage reaches PLAN_LIMITS.free", async () => {
  const stack = buildSovereignStack();
  const guard = stack.policies.find((p) => p.name === "tenant-plan-limit")!;
  stack.tenantPlans.set("free-tenant", "free");

  seedUsage(stack, "free-tenant", PLAN_LIMITS.free - 1);
  const dUnder = await guard.evaluate(ctx({ tenantId: "free-tenant" }));
  eq(dUnder.allow, true, "below the free limit → allowed");

  seedUsage(stack, "free-tenant", 1); // now exactly at the limit
  const dAt = await guard.evaluate(ctx({ tenantId: "free-tenant" }));
  eq(dAt.allow, false, "at the free limit → denied");
  if (!dAt.allow) assert(dAt.reason?.includes("free"), `reason should mention "free", got: ${dAt.reason}`);
});

test("tenant-plan-limit guard: 'pro' plan allows the same usage that exhausts 'free'", async () => {
  const stack = buildSovereignStack();
  const guard = stack.policies.find((p) => p.name === "tenant-plan-limit")!;
  stack.tenantPlans.set("pro-tenant", "pro");

  seedUsage(stack, "pro-tenant", PLAN_LIMITS.free); // would exhaust "free", far below "pro"
  const d = await guard.evaluate(ctx({ tenantId: "pro-tenant" }));
  eq(d.allow, true, "pro's higher cap is unaffected by free-level usage");
});

test("tenant-plan-limit guard: plan limits are tenant-isolated", async () => {
  const stack = buildSovereignStack();
  const guard = stack.policies.find((p) => p.name === "tenant-plan-limit")!;
  stack.tenantPlans.set("free-busy", "free");
  stack.tenantPlans.set("free-fresh", "free");

  seedUsage(stack, "free-busy", PLAN_LIMITS.free);
  const busy = await guard.evaluate(ctx({ tenantId: "free-busy" }));
  eq(busy.allow, false, "busy tenant is over its free limit");

  const fresh = await guard.evaluate(ctx({ tenantId: "free-fresh" }));
  eq(fresh.allow, true, "fresh tenant on the same plan is unaffected");
});

// ─── POST /api/tenants: plan field ──────────────────────────────────────────

const planServer = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
const planPort: number = (planServer.address() as any).port;
const planBase = `http://127.0.0.1:${planPort}`;
const H = (t: string) => ({ "content-type": "application/json", "x-tenant-id": t });
const post = (p: string, body: any, t: string) =>
  fetch(planBase + p, { method: "POST", headers: H(t), body: JSON.stringify(body) });

test("POST /api/tenants: new tenant defaults to plan 'free'", async () => {
  const r = await post("/api/tenants", {}, "plan-t-default");
  eq(r.status, 201);
  const body = await r.json();
  eq(body.plan, "free");
});

test("POST /api/tenants: explicit plan='pro' on creation", async () => {
  const r = await post("/api/tenants", { plan: "pro" }, "plan-t-pro");
  eq(r.status, 201);
  const body = await r.json();
  eq(body.plan, "pro");
});

test("POST /api/tenants: invalid plan → 400", async () => {
  const r = await post("/api/tenants", { plan: "enterprise" }, "plan-t-bad");
  eq(r.status, 400);
});

test("POST /api/tenants: repeat call without plan leaves existing plan unchanged", async () => {
  const r1 = await post("/api/tenants", { plan: "pro" }, "plan-t-keep");
  eq((await r1.json()).plan, "pro");

  const r2 = await post("/api/tenants", { accountName: "x" }, "plan-t-keep");
  eq(r2.status, 200, "idempotent repeat call");
  eq((await r2.json()).plan, "pro", "plan untouched when omitted");
});

test("POST /api/tenants: repeat call with plan re-assigns (upgrade)", async () => {
  const r1 = await post("/api/tenants", {}, "plan-t-upgrade");
  eq((await r1.json()).plan, "free");

  const r2 = await post("/api/tenants", { plan: "pro" }, "plan-t-upgrade");
  eq(r2.status, 200);
  eq((await r2.json()).plan, "pro", "explicit plan upgrades on repeat call");
});

import { test as _t1 } from "../_harness.mjs";
_t1("PLAN onboarding: cleanup", () => { planServer.close(); });

// ─── END-TO-END (HTTP): onboarded "free" tenant is denied past its limit ───

const e2eStack = buildSovereignStack([...defaultPolicies()], { provider: new InMemoryLedger() });
const e2eServer = startSovereignServer(0, e2eStack, { requireIdempotencyKey: false });
const e2ePort: number = (e2eServer.address() as any).port;
const e2eBase = `http://127.0.0.1:${e2ePort}`;
const e2ePost = (p: string, body: any, t: string) =>
  fetch(e2eBase + p, { method: "POST", headers: H(t), body: JSON.stringify(body) });

test("END-TO-END: tenant onboarded with plan='free' is denied a mint once at PLAN_LIMITS.free", async () => {
  const tenantId = "plan-e2e-free";
  const onboard = await e2ePost("/api/tenants", { plan: "free" }, tenantId);
  eq(onboard.status, 201);
  const accountId = (await onboard.json()).account.id;

  // Pre-seed usage to exactly the limit via the real audit store, so the
  // count-at-check-time for the mint below is already >= PLAN_LIMITS.free.
  seedUsage(e2eStack, tenantId, PLAN_LIMITS.free);

  const r = await e2ePost("/api/ledger/mint", { toAccountId: accountId, amount: "100", memo: "m" }, tenantId);
  const body = await r.json();
  assert(!body.ok, `mint at the free limit should be denied, got: ${JSON.stringify(body)}`);
  assert(String(body.reason || body.error || "").includes("free"), `reason should mention "free", got: ${JSON.stringify(body)}`);
});

import { test as _t2 } from "../_harness.mjs";
_t2("PLAN e2e: cleanup", () => { e2eServer.close(); });
