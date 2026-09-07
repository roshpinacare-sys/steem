/**
 * tests/orchestrator/actor-baseline-orchestrator.test.ts — v302 sub-step.
 *
 * TfaOrchestrator wires injectActorBaseline as a default policy and updates the
 * ActorBaselineStore only after successful execution. Baseline learns approved ops.
 *
 *   APPROVED_PATH   successful action → baseline store updated + riskContext injected.
 *   DENY_PATH       guard-denied action → baseline store NOT updated.
 *   ERROR_PATH      executor throws → baseline store NOT updated.
 *   FAIL_CLOSED     store throw during post-success record does NOT break result.
 */
import { test, assert, eq } from "../_harness.mjs";
import { TfaOrchestrator } from "../../lib/orchestrator/orchestrator.ts";
import { InMemoryAuditStore } from "../../lib/orchestrator/audit.ts";
import {
  InMemoryActorBaselineStore,
  injectActorBaseline,
} from "../../lib/risk/actor-baseline.ts";
import type { ActorBaselineStore } from "../../lib/risk/actor-baseline.ts";
import type { Action, GuardPolicy } from "../../lib/orchestrator/types.ts";

function makeAction(overrides?: Partial<Action>): Action {
  return {
    id: "act-1",
    tenantId: "t1",
    type: "test.action",
    payload: {},
    source: "a1",
    isFinancial: false,
    isAutonomous: false,
    requestedAt: new Date().toISOString(),
    ...overrides,
  } as Action;
}

// ─── Approved path ────────────────────────────────────────────────────────────

test("orchestrator records approved action into baseline store post-success", async () => {
  const store = new InMemoryActorBaselineStore({ windowMs: 1000, baselineWindows: 2 });
  const allowPolicy: GuardPolicy = {
    name: "always-allow",
    evaluate: async () => ({ allow: true }),
  };
  const orch = new TfaOrchestrator(
    [injectActorBaseline(store, { recordDuringEvaluate: false }), allowPolicy],
    new InMemoryAuditStore(),
    undefined,
    undefined,
    store,
  );

  const action = makeAction();
  const result = await orch.run(action, async () => "ok");

  assert(result.ok === true, "action succeeded");
  eq(store.getRecentCount("t1", "a1"), 1);
});

test("orchestrator injects baseline into riskContext during guard evaluation", async () => {
  const store = new InMemoryActorBaselineStore({ windowMs: 1000, baselineWindows: 2 });
  let capturedRiskContext: Record<string, unknown> | undefined;

  const inspectPolicy: GuardPolicy = {
    name: "inspect-risk-context",
    evaluate: async (ctx) => {
      capturedRiskContext = ctx.riskContext as Record<string, unknown>;
      return { allow: true };
    },
  };

  // Seed history so baseline is non-zero.
  store.recordAction("t1", "a1", 0);
  store.recordAction("t1", "a1", 1000);

  const orch = new TfaOrchestrator(
    [injectActorBaseline(store, { recordDuringEvaluate: false }), inspectPolicy],
    new InMemoryAuditStore(),
    undefined,
    undefined,
    store,
  );

  await orch.run(makeAction(), async () => "ok");

  assert(capturedRiskContext !== undefined, "riskContext captured");
  eq(typeof capturedRiskContext!.actorBaselineCount, "number");
  eq(typeof capturedRiskContext!.actorRecentCount, "number");
});

// ─── Deny path ──────────────────────────────────────────────────────────────────

test("denied action does NOT update baseline store", async () => {
  const store = new InMemoryActorBaselineStore({ windowMs: 1000, baselineWindows: 2 });
  const denyPolicy: GuardPolicy = {
    name: "always-deny",
    evaluate: async () => ({ allow: false, reason: "deny-for-test" }),
  };
  const orch = new TfaOrchestrator(
    [injectActorBaseline(store, { recordDuringEvaluate: false }), denyPolicy],
    new InMemoryAuditStore(),
    undefined,
    undefined,
    store,
  );

  const action = makeAction();
  const result = await orch.run(action, async () => "should-not-run");

  assert(result.ok === false, "action denied");
  eq(store.getRecentCount("t1", "a1"), 0);
});

// ─── Error path ─────────────────────────────────────────────────────────────────

test("executor throw does NOT update baseline store", async () => {
  const store = new InMemoryActorBaselineStore({ windowMs: 1000, baselineWindows: 2 });
  const allowPolicy: GuardPolicy = {
    name: "always-allow",
    evaluate: async () => ({ allow: true }),
  };
  const orch = new TfaOrchestrator(
    [injectActorBaseline(store, { recordDuringEvaluate: false }), allowPolicy],
    new InMemoryAuditStore(),
    undefined,
    undefined,
    store,
  );

  const action = makeAction();
  const result = await orch.run(action, async () => {
    throw new Error("boom");
  });

  assert(result.ok === false, "action errored");
  eq(store.getRecentCount("t1", "a1"), 0);
});

// ─── Fail-closed: store throw post-success must not break result ──────────────

test("baseline store throw post-success does NOT break orchestration result", async () => {
  const goodStore = new InMemoryActorBaselineStore({ windowMs: 1000, baselineWindows: 2 });
  const badStore: ActorBaselineStore = {
    recordAction() { throw new Error("post-success store down"); },
    getBaseline() { return 0; },
    getRecentCount() { return 0; },
  };
  const allowPolicy: GuardPolicy = {
    name: "always-allow",
    evaluate: async () => ({ allow: true }),
  };
  const orch = new TfaOrchestrator(
    [injectActorBaseline(goodStore, { recordDuringEvaluate: false }), allowPolicy],
    new InMemoryAuditStore(),
    undefined,
    undefined,
    badStore,
  );

  const action = makeAction();
  const result = await orch.run(action, async () => "ok");

  assert(result.ok === true, "result still ok despite store throw");
  eq(result.result, "ok");
});

// ─── Tenant / actor isolation through orchestrator ─────────────────────────────

test("orchestrator maintains tenant isolation in baseline store", async () => {
  const store = new InMemoryActorBaselineStore({ windowMs: 1000, baselineWindows: 2 });
  const allowPolicy: GuardPolicy = {
    name: "always-allow",
    evaluate: async () => ({ allow: true }),
  };
  const orch = new TfaOrchestrator(
    [injectActorBaseline(store, { recordDuringEvaluate: false }), allowPolicy],
    new InMemoryAuditStore(),
    undefined,
    undefined,
    store,
  );

  await orch.run(makeAction({ tenantId: "t1", source: "a1" }), async () => "ok");
  await orch.run(makeAction({ tenantId: "t2", source: "a1" }), async () => "ok");

  eq(store.getRecentCount("t1", "a1"), 1);
  eq(store.getRecentCount("t2", "a1"), 1);
  eq(store.getRecentCount("t1", "a2"), 0);
});
