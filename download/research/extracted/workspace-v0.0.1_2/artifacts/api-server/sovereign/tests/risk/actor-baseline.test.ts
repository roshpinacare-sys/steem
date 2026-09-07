/**
 * tests/risk/actor-baseline.test.ts — v301 sub-step.
 *
 * ActorBaselineStore: deterministic moving-average per actor.
 * injectActorBaseline: GuardPolicy that feeds baseline + recent count into riskContext.
 *
 *   DETERMINISTIC   same history → same baseline.
 *   BOUNDED_MEMORY  only (baselineWindows + 1) entries per actor.
 *   ISOLATION       cross-tenant queries never leak.
 *   FAIL-CLOSED     store throws → GuardEvaluator treats as deny.
 *   ADDITIVE        merges with existing riskContext fields.
 */
import { test, assert, eq } from "../_harness.mjs";
import {
  InMemoryActorBaselineStore,
  injectActorBaseline,
} from "../../lib/risk/actor-baseline.ts";
import type { ActionContext } from "../../lib/orchestrator/types.ts";

// ─── InMemoryActorBaselineStore ───────────────────────────────────────────────

test("baseline is average of completed windows (current excluded)", () => {
  const store = new InMemoryActorBaselineStore({ windowMs: 1000, baselineWindows: 3 });
  const t = "t1";
  const a = "a1";
  const base = 100000;

  // Window -3: 2 actions
  store.recordAction(t, a, base - 3000);
  store.recordAction(t, a, base - 3000);
  // Window -2: 4 actions
  store.recordAction(t, a, base - 2000);
  store.recordAction(t, a, base - 2000);
  store.recordAction(t, a, base - 2000);
  store.recordAction(t, a, base - 2000);
  // Window -1: 6 actions
  store.recordAction(t, a, base - 1000);
  store.recordAction(t, a, base - 1000);
  store.recordAction(t, a, base - 1000);
  store.recordAction(t, a, base - 1000);
  store.recordAction(t, a, base - 1000);
  store.recordAction(t, a, base - 1000);

  // Current window: 1 action
  store.recordAction(t, a, base);

  eq(store.getRecentCount(t, a, base), 1);
  // Baseline = (2 + 4 + 6) / 3 = 4.0
  eq(store.getBaseline(t, a, base), 4);
});

test("recent count includes current action; baseline excludes it", () => {
  const store = new InMemoryActorBaselineStore({ windowMs: 1000, baselineWindows: 2 });
  const t = "t1";
  const a = "a1";
  const base = 5000;

  store.recordAction(t, a, base - 2000); // window idx 3
  store.recordAction(t, a, base - 1000); // window idx 4
  store.recordAction(t, a, base);        // window idx 5 (current)

  eq(store.getRecentCount(t, a, base), 1);
  // Baseline averages completed windows 3 and 4: (1 + 1) / 2 = 1.0
  eq(store.getBaseline(t, a, base), 1);
});

test("zero history → baseline 0, recent count 1 after first record", () => {
  const store = new InMemoryActorBaselineStore({ windowMs: 1000, baselineWindows: 2 });
  const t = "t1";
  const a = "a1";
  const now = 10000;

  store.recordAction(t, a, now);
  eq(store.getBaseline(t, a, now), 0);
  eq(store.getRecentCount(t, a, now), 1);
});

test("deterministic: same inputs → same outputs", () => {
  const store = new InMemoryActorBaselineStore({ windowMs: 1000, baselineWindows: 3 });
  const t = "t1";
  const a = "a1";
  for (let i = 0; i < 5; i++) store.recordAction(t, a, 5000 + i * 200);
  const b1 = store.getBaseline(t, a, 6000);
  const b2 = store.getBaseline(t, a, 6000);
  eq(b1, b2);
});

test("tenant isolation: cross-tenant get returns 0", () => {
  const store = new InMemoryActorBaselineStore({ windowMs: 1000, baselineWindows: 2 });
  store.recordAction("t1", "a1", 10000);
  store.recordAction("t1", "a1", 11000);
  eq(store.getBaseline("t2", "a1", 11000), 0);
  eq(store.getRecentCount("t2", "a1", 11000), 0);
});

test("actor isolation: different actors in same tenant are separate", () => {
  const store = new InMemoryActorBaselineStore({ windowMs: 1000, baselineWindows: 2 });
  store.recordAction("t1", "a1", 10000);
  store.recordAction("t1", "a2", 10000);
  store.recordAction("t1", "a2", 10000);
  eq(store.getRecentCount("t1", "a1", 10000), 1);
  eq(store.getRecentCount("t1", "a2", 10000), 2);
});

test("pruning removes old windows; baseline still correct", () => {
  const store = new InMemoryActorBaselineStore({ windowMs: 1000, baselineWindows: 2 });
  const t = "t1";
  const a = "a1";

  store.recordAction(t, a, 0);
  store.recordAction(t, a, 1000);
  store.recordAction(t, a, 2000);
  store.recordAction(t, a, 3000);

  // At 3000: windows 0,1,2,3. Completed: 0,1,2. Baseline = (1+1+1)/3?
  // Wait, baselineWindows=2, so only windows 1 and 2 are averaged.
  eq(store.getBaseline(t, a, 3000), 1); // (1+1)/2 = 1

  // Move far forward; old windows should be pruned.
  store.recordAction(t, a, 10000);
  eq(store.getBaseline(t, a, 10000), 0); // only window 10 exists, no completed history
});

test("empty tenant or actor returns 0 without error", () => {
  const store = new InMemoryActorBaselineStore();
  eq(store.getBaseline("", "a1", 1000), 0);
  eq(store.getRecentCount("t1", "", 1000), 0);
});

// ─── injectActorBaseline GuardPolicy ──────────────────────────────────────────

test("injects baseline and recent count into riskContext", async () => {
  const store = new InMemoryActorBaselineStore({ windowMs: 1000, baselineWindows: 2 });
  const policy = injectActorBaseline(store);

  const ctx: ActionContext = {
    action: { id: "act-1", tenantId: "t1", type: "test", payload: {}, source: "a1", isFinancial: false, isAutonomous: false, requestedAt: new Date().toISOString() },
    tenantId: "t1",
    timestamp: new Date().toISOString(),
  };

  const decision = await policy.evaluate(ctx);
  assert(decision.allow === true, "policy never denies");
  const rc = ctx.riskContext as Record<string, unknown>;
  assert(typeof rc.actorBaselineCount === "number", "baseline injected");
  assert(typeof rc.actorRecentCount === "number", "recent injected");
  eq(rc.actorBaselineCount, 0);
  eq(rc.actorRecentCount, 1);
});

test("injects into existing riskContext without overwriting unrelated fields", async () => {
  const store = new InMemoryActorBaselineStore({ windowMs: 1000, baselineWindows: 2 });
  const policy = injectActorBaseline(store);

  const ctx: ActionContext = {
    action: { id: "act-1", tenantId: "t1", type: "test", payload: {}, source: "a1", isFinancial: false, isAutonomous: false, requestedAt: new Date().toISOString() },
    tenantId: "t1",
    timestamp: new Date().toISOString(),
    riskContext: { valueMicrounits: 1000n, offHours: true },
  };

  await policy.evaluate(ctx);
  const rc = ctx.riskContext as Record<string, unknown>;
  eq(rc.valueMicrounits, 1000n);
  eq(rc.offHours, true);
  assert(typeof rc.actorBaselineCount === "number");
  assert(typeof rc.actorRecentCount === "number");
});

test("custom actorIdResolver is respected", async () => {
  const store = new InMemoryActorBaselineStore({ windowMs: 1000, baselineWindows: 2 });
  const policy = injectActorBaseline(store, {
    actorIdResolver: (ctx) => ctx.action.tenantId + "::" + ctx.action.source,
  });

  const ctx: ActionContext = {
    action: { id: "act-1", tenantId: "t1", type: "test", payload: {}, source: "a1", isFinancial: false, isAutonomous: false, requestedAt: new Date().toISOString() },
    tenantId: "t1",
    timestamp: new Date().toISOString(),
  };

  await policy.evaluate(ctx);
  // The resolver produced "t1::a1" — a different key than raw "a1".
  // A second call with the same resolver should hit the same key and show recent=2.
  await policy.evaluate(ctx);
  const rc = ctx.riskContext as Record<string, unknown>;
  eq(rc.actorRecentCount, 2);
});

test("tenant isolation via policy: actor in t2 does not see t1 baseline", async () => {
  const store = new InMemoryActorBaselineStore({ windowMs: 1000, baselineWindows: 2 });
  const policy = injectActorBaseline(store);

  const ctx1: ActionContext = {
    action: { id: "act-1", tenantId: "t1", type: "test", payload: {}, source: "a1", isFinancial: false, isAutonomous: false, requestedAt: new Date().toISOString() },
    tenantId: "t1",
    timestamp: new Date().toISOString(),
  };
  const ctx2: ActionContext = {
    action: { id: "act-2", tenantId: "t2", type: "test", payload: {}, source: "a1", isFinancial: false, isAutonomous: false, requestedAt: new Date().toISOString() },
    tenantId: "t2",
    timestamp: new Date().toISOString(),
  };

  // Seed t1 with 3 actions so baseline would be non-zero if leaked.
  store.recordAction("t1", "a1", 0);
  store.recordAction("t1", "a1", 1000);
  store.recordAction("t1", "a1", 2000);

  await policy.evaluate(ctx2);
  const rc = ctx2.riskContext as Record<string, unknown>;
  eq(rc.actorBaselineCount, 0);
  eq(rc.actorRecentCount, 1); // only this action in t2
});

test("velocity multiple detected after seeding history", async () => {
  const store = new InMemoryActorBaselineStore({ windowMs: 1000, baselineWindows: 2 });
  const policy = injectActorBaseline(store);

  const t = "t1";
  const a = "a1";
  const now = Date.now();
  const currentWindowStart = Math.floor(now / 1000) * 1000;

  // Seed history in completed windows so baseline is non-zero.
  store.recordAction(t, a, currentWindowStart - 2000);
  store.recordAction(t, a, currentWindowStart - 1000);

  const ctx: ActionContext = {
    action: { id: "act-1", tenantId: t, type: "test", payload: {}, source: a, isFinancial: false, isAutonomous: false, requestedAt: new Date().toISOString() },
    tenantId: t,
    timestamp: new Date().toISOString(),
  };

  // Burst: record many actions in current window before policy runs.
  for (let i = 0; i < 10; i++) store.recordAction(t, a, now);
  await policy.evaluate(ctx);

  const rc = ctx.riskContext as Record<string, unknown>;
  eq(rc.actorBaselineCount, 1);
  eq(rc.actorRecentCount, 11); // 10 seeded + 1 from policy
});

test("fail-closed: if store throws, GuardEvaluator would treat as deny", async () => {
  const badStore: import("../../lib/risk/actor-baseline.ts").ActorBaselineStore = {
    recordAction() { throw new Error("store down"); },
    getBaseline() { return 0; },
    getRecentCount() { return 0; },
  };
  const policy = injectActorBaseline(badStore);
  const ctx: ActionContext = {
    action: { id: "act-1", tenantId: "t1", type: "test", payload: {}, source: "a1", isFinancial: false, isAutonomous: false, requestedAt: new Date().toISOString() },
    tenantId: "t1",
    timestamp: new Date().toISOString(),
  };

  let threw = false;
  try {
    await policy.evaluate(ctx);
  } catch {
    threw = true;
  }
  assert(threw, "store throw propagates to GuardEvaluator");
});
