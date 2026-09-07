import "../_flush.mjs";
/**
 * tests/orchestrator/execution-orchestrator.test.ts — v141.
 * ExecutionWorkflow #2: orchestrator integration.
 *
 * Verifies that TfaOrchestrator with an executionStore wired automatically
 * creates and advances ExecutionWorkflows for autonomous/financial actions.
 *
 *   ALLOWED   action succeeds → workflow reaches `proved`
 *   DENIED    guard denies → workflow reaches `rejected` (planned→rejected)
 *   ERROR     executor throws → workflow reaches `failed` (running→failed)
 *   SKIP      read-only (not autonomous, not financial) → no workflow created
 *   FAIL-CLOSED  store.create throws → action denied, audit written, no executor call
 */
import { test, assert, eq } from "../_harness.mjs";
import { TfaOrchestrator } from "../../lib/orchestrator/orchestrator.ts";
import { InMemoryExecutionStore } from "../../lib/orchestrator/execution-workflow.ts";
import { allowAll, denyAll } from "../../lib/orchestrator/guard.ts";
import type { Action } from "../../lib/orchestrator/types.ts";

function makeAction(overrides: Partial<Action> = {}): Action {
  return {
    id: `act-${Math.random().toString(36).slice(2)}`,
    type: "ledger.transfer",
    tenantId: "t1",
    source: "test",
    payload: {},
    isFinancial: true,
    isAutonomous: false,
    ...overrides,
  };
}

// ── ALLOWED: guard passes, executor succeeds → workflow = proved ──────────
test("orchestrator+executionStore: successful action creates proved workflow", async () => {
  const store = new InMemoryExecutionStore();
  const orch = new TfaOrchestrator([allowAll()], undefined, undefined, store);
  const action = makeAction({ isFinancial: true });
  const result = await orch.run(action, async () => "ok");
  assert(result.ok, "result should be ok");
  const all = store.list("t1");
  eq(all.length, 1);
  eq(all[0].status, "proved");
  eq(all[0].actionId, action.id);
});

// ── DENIED: guard denies → workflow reaches `rejected` ────────────────────
test("orchestrator+executionStore: denied action creates rejected workflow", async () => {
  const store = new InMemoryExecutionStore();
  const orch = new TfaOrchestrator([denyAll()], undefined, undefined, store);
  const action = makeAction({ isFinancial: true });
  const result = await orch.run(action, async () => "nope");
  assert(!result.ok, "result should not be ok");
  const all = store.list("t1");
  eq(all.length, 1);
  eq(all[0].status, "rejected");
});

// ── ERROR: executor throws → workflow reaches `failed` ────────────────────
test("orchestrator+executionStore: executor error creates failed workflow", async () => {
  const store = new InMemoryExecutionStore();
  const orch = new TfaOrchestrator([allowAll()], undefined, undefined, store);
  const action = makeAction({ isAutonomous: true, isFinancial: false });
  const result = await orch.run(action, async () => { throw new Error("timeout"); });
  assert(!result.ok, "result should not be ok");
  eq(result.reason, "timeout");
  const all = store.list("t1");
  eq(all.length, 1);
  eq(all[0].status, "failed");
});

// ── SKIP: non-financial, non-autonomous action → no workflow ───────────────
test("orchestrator+executionStore: read-only action does not create workflow", async () => {
  const store = new InMemoryExecutionStore();
  const orch = new TfaOrchestrator([allowAll()], undefined, undefined, store);
  const action = makeAction({ isFinancial: false, isAutonomous: false });
  const result = await orch.run(action, async () => "read");
  assert(result.ok);
  const all = store.list("t1");
  eq(all.length, 0, "no workflow should be created for read-only actions");
});

// ── No executionStore: backward compat, works without store ───────────────
test("orchestrator without executionStore: backward compatible", async () => {
  const orch = new TfaOrchestrator([allowAll()]);
  const action = makeAction({ isFinancial: true });
  const result = await orch.run(action, async () => 42);
  assert(result.ok);
  eq((result as any).result, 42);
});

// ── Workflow run-log integrity: entries reflect state transitions ──────────
test("orchestrator+executionStore: proved workflow has correct log structure", async () => {
  const store = new InMemoryExecutionStore();
  const orch = new TfaOrchestrator([allowAll()], undefined, undefined, store);
  const action = makeAction({ isFinancial: true });
  await orch.run(action, async () => "done");
  const wf = store.list("t1")[0];
  const statuses = wf.runLog.map((e: any) => e.toStatus);
  // planned → approved → running → evidence_collected → settled → proved
  assert(statuses.includes("approved"), "should pass through approved");
  assert(statuses.includes("running"), "should pass through running");
  assert(statuses.includes("proved"), "should end in proved");
});

// ── Tenant isolation: multiple tenants create separate workflows ──────────
test("orchestrator+executionStore: tenant isolation", async () => {
  const store = new InMemoryExecutionStore();
  const orch = new TfaOrchestrator([allowAll()], undefined, undefined, store);
  const a1 = makeAction({ tenantId: "tenant-A", isFinancial: true });
  const a2 = makeAction({ tenantId: "tenant-B", isFinancial: true });
  await orch.run(a1, async () => "a");
  await orch.run(a2, async () => "b");
  eq(store.list("tenant-A").length, 1);
  eq(store.list("tenant-B").length, 1);
  eq(store.list("tenant-A")[0].tenantId, "tenant-A");
  eq(store.list("tenant-B")[0].tenantId, "tenant-B");
});

// ── FAIL-CLOSED: store.create throws → action denied, executor not called ──
test("orchestrator+executionStore: store failure denies action (fail-closed)", async () => {
  // Use a broken store whose create() always throws
  const brokenStore = {
    create: () => { throw new Error("DB down"); },
    get: () => null,
    list: () => [],
    transition: () => { throw new Error("DB down"); },
    verifyChain: () => true,
    replay: () => 0,
    lease: () => false,
    releaseLease: () => false,
  };
  const orch = new TfaOrchestrator([allowAll()], undefined, undefined, brokenStore as any);
  let executorCalled = false;
  const action = makeAction({ isFinancial: true });
  const result = await orch.run(action, async () => { executorCalled = true; return "nope"; });
  assert(!result.ok, "should be denied when store fails");
  assert(!executorCalled, "executor must not be called when workflow creation fails");
});
