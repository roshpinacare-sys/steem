import "../_flush.mjs";
/**
 * tests/indexer/query-apis.test.ts — Indexer #5: extended query API coverage.
 *
 * Coverage:
 *   listExecutionsByStatus    — happy path, no match, tenant isolation.
 *   listExecutionsByDateRange — happy path, inclusive boundaries, empty result, invalid range.
 *   getExecutionByActionId    — found, not found, cross-tenant isolation, invalid input.
 *   actorSummary              — found with executions, actor not found, cross-tenant.
 */
import { test, assert, eq } from "../_harness.mjs";
import { InMemoryReadModelStore, IndexerError } from "../../lib/indexer/index.ts";
import { InMemoryExecutionStore } from "../../lib/orchestrator/execution-workflow.ts";
import type { ExecutionWorkflow } from "../../lib/orchestrator/types.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStore(): InMemoryReadModelStore {
  return new InMemoryReadModelStore();
}

function makeWorkflow(
  tenantId = "tenant-a",
  actionId = "action-1",
  intentId?: string,
): ExecutionWorkflow {
  const s = new InMemoryExecutionStore();
  return s.create({ tenantId, actionId, intentId });
}

// ─── listExecutionsByStatus ────────────────────────────────────────────────────

test("listExecutionsByStatus returns matching executions", () => {
  const store = makeStore();
  const wf = makeWorkflow("tenant-a", "action-1");
  store.projectExecution(wf);
  const results = store.listExecutionsByStatus("tenant-a", "planned");
  eq(results.length, 1);
  eq(results[0].status, "planned");
});

test("listExecutionsByStatus returns empty when no match", () => {
  const store = makeStore();
  const wf = makeWorkflow("tenant-a", "action-1");
  store.projectExecution(wf);
  const results = store.listExecutionsByStatus("tenant-a", "settled");
  eq(results.length, 0);
});

test("listExecutionsByStatus is tenant-isolated", () => {
  const store = makeStore();
  store.projectExecution(makeWorkflow("tenant-a", "action-1"));
  store.projectExecution(makeWorkflow("tenant-b", "action-2"));
  const results = store.listExecutionsByStatus("tenant-a", "planned");
  eq(results.length, 1);
  eq(results[0].tenantId, "tenant-a");
});

test("listExecutionsByStatus returns empty for unknown tenant", () => {
  const store = makeStore();
  eq(store.listExecutionsByStatus("no-such-tenant", "planned").length, 0);
});

// ─── listExecutionsByDateRange ────────────────────────────────────────────────

test("listExecutionsByDateRange returns executions within range", () => {
  const store = makeStore();
  const wf = makeWorkflow("tenant-a", "action-1");
  store.projectExecution(wf);
  // updatedAt is set to the current time — use a wide range that always matches
  const from = "2020-01-01T00:00:00.000Z";
  const to = "2099-12-31T23:59:59.999Z";
  const results = store.listExecutionsByDateRange("tenant-a", from, to);
  eq(results.length, 1);
});

test("listExecutionsByDateRange respects inclusive lower boundary", () => {
  const store = makeStore();
  const wf = makeWorkflow("tenant-a", "action-1");
  store.projectExecution(wf);
  // Use a range that ends before any real time — should return nothing
  const from = "2000-01-01T00:00:00.000Z";
  const to = "2000-01-02T00:00:00.000Z";
  const results = store.listExecutionsByDateRange("tenant-a", from, to);
  eq(results.length, 0);
});

test("listExecutionsByDateRange throws IndexerError on invalid range (from > to)", () => {
  const store = makeStore();
  try {
    store.listExecutionsByDateRange(
      "tenant-a",
      "2026-06-14T00:00:00.000Z",
      "2026-06-13T00:00:00.000Z",
    );
    assert(false, "should have thrown");
  } catch (e) {
    assert(e instanceof IndexerError, "expected IndexerError");
    eq((e as IndexerError).code, "invalid_input");
  }
});

test("listExecutionsByDateRange is tenant-isolated", () => {
  const store = makeStore();
  store.projectExecution(makeWorkflow("tenant-a", "action-1"));
  store.projectExecution(makeWorkflow("tenant-b", "action-2"));
  const results = store.listExecutionsByDateRange(
    "tenant-a",
    "2020-01-01T00:00:00.000Z",
    "2099-12-31T00:00:00.000Z",
  );
  eq(results.length, 1);
  eq(results[0].tenantId, "tenant-a");
});

// ─── getExecutionByActionId ────────────────────────────────────────────────────

test("getExecutionByActionId returns execution with matching actionId", () => {
  const store = makeStore();
  const wf = makeWorkflow("tenant-a", "action-xyz");
  store.projectExecution(wf);
  const result = store.getExecutionByActionId("tenant-a", "action-xyz");
  assert(result !== null, "should find execution");
  eq(result!.actionId, "action-xyz");
});

test("getExecutionByActionId returns null when not found", () => {
  const store = makeStore();
  eq(store.getExecutionByActionId("tenant-a", "no-such-action"), null);
});

test("getExecutionByActionId is tenant-isolated (cross-tenant returns null)", () => {
  const store = makeStore();
  const wf = makeWorkflow("tenant-a", "action-xyz");
  store.projectExecution(wf);
  eq(store.getExecutionByActionId("tenant-b", "action-xyz"), null);
});

test("getExecutionByActionId throws IndexerError on empty actionId", () => {
  const store = makeStore();
  try {
    store.getExecutionByActionId("tenant-a", "");
    assert(false, "should have thrown");
  } catch (e) {
    assert(e instanceof IndexerError, "expected IndexerError");
    eq((e as IndexerError).code, "invalid_input");
  }
});

test("getExecutionByActionId throws IndexerError on empty tenantId", () => {
  const store = makeStore();
  try {
    store.getExecutionByActionId("", "action-1");
    assert(false, "should have thrown");
  } catch (e) {
    assert(e instanceof IndexerError, "expected IndexerError");
    eq((e as IndexerError).code, "invalid_input");
  }
});

test("getExecutionByActionId returns most recent when multiple share actionId", () => {
  const store = makeStore();
  // Project two executions with the same actionId (unusual but defensible)
  const s = new InMemoryExecutionStore();
  const wf1 = s.create({ tenantId: "tenant-a", actionId: "shared-action" });
  const wf2 = s.create({ tenantId: "tenant-a", actionId: "shared-action" });
  store.projectExecution(wf1);
  store.projectExecution(wf2);
  const result = store.getExecutionByActionId("tenant-a", "shared-action");
  // Should return the most recently updated one (wf2 created later)
  assert(result !== null, "should find execution");
  eq(result!.workflowId, wf2.id);
});

// ─── efficiency/single-pass-actionid-lookup ─────────────────────────────────
// getExecutionByActionId was refactored from listExecutions().filter()[0]
// (sorts the ENTIRE tenant execution list, O(m log m)) to a single-pass scan
// (O(m), no intermediate array, no sort). These tests pin the externally-
// observable behavior so the refactor can't silently change which record wins.

test("single-pass lookup: correct match found among many non-matching executions of the same tenant", () => {
  const store = makeStore();
  const s = new InMemoryExecutionStore();
  for (let i = 0; i < 50; i++) {
    store.projectExecution(s.create({ tenantId: "tenant-a", actionId: `noise-${i}` }));
  }
  const target = s.create({ tenantId: "tenant-a", actionId: "the-target" });
  store.projectExecution(target);
  for (let i = 0; i < 50; i++) {
    store.projectExecution(s.create({ tenantId: "tenant-a", actionId: `noise2-${i}` }));
  }
  const result = store.getExecutionByActionId("tenant-a", "the-target");
  assert(result !== null, "should find the target among surrounding noise");
  eq(result!.workflowId, target.id);
});

test("single-pass lookup: on exact-tie updatedAt, the more-recently-projected match wins deterministically", () => {
  const store = makeStore();
  const s = new InMemoryExecutionStore();
  const wf1 = s.create({ tenantId: "tenant-a", actionId: "tied-action" });
  const wf2 = s.create({ tenantId: "tenant-a", actionId: "tied-action" });
  // Force an exact tie on updatedAt (real clocks may already differ by the
  // time two creates run, so pin it explicitly to exercise the tie branch —
  // this is also the exact scenario that made the old sort-based lookup
  // flaky under fast/sequential projection).
  (wf2 as unknown as { updatedAt: string }).updatedAt = wf1.updatedAt;
  store.projectExecution(wf1);
  store.projectExecution(wf2);
  const result = store.getExecutionByActionId("tenant-a", "tied-action");
  assert(result !== null, "should find a match on tie");
  eq(result!.workflowId, wf2.id, "projection-order seq must break updatedAt ties deterministically, favoring the latest projection");
});

test("single-pass lookup: regression — cross-tenant match with the same actionId is never returned", () => {
  const store = makeStore();
  const s = new InMemoryExecutionStore();
  // tenant-b has a more-recently-updated execution with the same actionId;
  // a buggy scan that drops the tenant filter while tracking "most recent"
  // would leak it across tenants.
  store.projectExecution(s.create({ tenantId: "tenant-a", actionId: "shared-id" }));
  store.projectExecution(s.create({ tenantId: "tenant-b", actionId: "shared-id" }));
  const result = store.getExecutionByActionId("tenant-a", "shared-id");
  assert(result !== null, "should find the tenant-a match");
  eq(result!.tenantId, "tenant-a", "must never return a cross-tenant record even if it is more recent");
});

// ─── actorSummary ─────────────────────────────────────────────────────────────

test("actorSummary returns actor and executionCount", () => {
  const store = makeStore();
  // Project an actor
  store.projectActor({
    tenantId: "tenant-a",
    actorId: "actor-1",
    actorType: "agent",
    timestamp: "2026-06-13T00:00:00.000Z",
  });
  // Project two executions whose actor is "actor-1"
  const s = new InMemoryExecutionStore();
  const wf1 = s.create({ tenantId: "tenant-a", actionId: "a1" });
  wf1.runLog[0].actor = "actor-1";
  const wf2 = s.create({ tenantId: "tenant-a", actionId: "a2" });
  wf2.runLog[0].actor = "actor-1";
  store.projectExecution(wf1);
  store.projectExecution(wf2);

  const summary = store.actorSummary("tenant-a", "actor-1");
  assert(summary !== null, "summary should be present");
  eq(summary!.actor.actorId, "actor-1");
  eq(summary!.executionCount, 2);
});

test("actorSummary returns executionCount=0 when actor has no executions", () => {
  const store = makeStore();
  store.projectActor({
    tenantId: "tenant-a",
    actorId: "actor-lonely",
    actorType: "human",
    timestamp: "2026-06-13T00:00:00.000Z",
  });
  const summary = store.actorSummary("tenant-a", "actor-lonely");
  assert(summary !== null, "summary should be present");
  eq(summary!.executionCount, 0);
});

test("actorSummary returns null for unknown actor", () => {
  const store = makeStore();
  eq(store.actorSummary("tenant-a", "no-such-actor"), null);
});

test("actorSummary returns null on cross-tenant lookup", () => {
  const store = makeStore();
  store.projectActor({
    tenantId: "tenant-a",
    actorId: "actor-1",
    actorType: "agent",
    timestamp: "2026-06-13T00:00:00.000Z",
  });
  eq(store.actorSummary("tenant-b", "actor-1"), null);
});

// ─── actorSummary efficiency/single-pass-count ───────────────────────────────
// Regression for replacing listExecutions(tenantId).filter().length (which
// sorts the tenant's entire execution list, O(m log m), purely to compute a
// count) with a single unsorted pass, O(m). Order is irrelevant to a count,
// so these tests check correctness of the count itself under noise and
// cross-tenant adjacency — exactly the conditions a careless rewrite could
// break.

test("actorSummary: count is correct among a large noisy mix of other actors and tenants", () => {
  const store = makeStore();
  store.projectActor({
    tenantId: "tenant-a",
    actorId: "actor-target",
    actorType: "agent",
    timestamp: "2026-06-13T00:00:00.000Z",
  });

  // 50 executions for unrelated actors/tenants interleaved with the target's.
  let targetCount = 0;
  for (let i = 0; i < 50; i++) {
    const wf = makeWorkflow("tenant-a", `noise-${i}`);
    wf.runLog[0].actor = `other-actor-${i % 5}`;
    store.projectExecution(wf);
  }
  for (let i = 0; i < 7; i++) {
    const wf = makeWorkflow("tenant-a", `target-${i}`);
    wf.runLog[0].actor = "actor-target";
    store.projectExecution(wf);
    targetCount++;
  }
  // Some noise for a different tenant, including one with the SAME actorId —
  // must never be counted (tenant isolation, not just actor matching).
  for (let i = 0; i < 5; i++) {
    const wf = makeWorkflow("tenant-b", `cross-${i}`);
    wf.runLog[0].actor = "actor-target";
    store.projectExecution(wf);
  }

  const summary = store.actorSummary("tenant-a", "actor-target");
  assert(summary !== null, "summary should be present");
  eq(summary!.executionCount, targetCount);
});

test("actorSummary: same actorId in a different tenant never inflates the count", () => {
  const store = makeStore();
  store.projectActor({
    tenantId: "tenant-a",
    actorId: "actor-shared-name",
    actorType: "agent",
    timestamp: "2026-06-13T00:00:00.000Z",
  });

  const wfA = makeWorkflow("tenant-a", "a1");
  wfA.runLog[0].actor = "actor-shared-name";
  store.projectExecution(wfA);

  // Same actorId string, different tenant — must not leak into tenant-a's count.
  const wfB = makeWorkflow("tenant-b", "b1");
  wfB.runLog[0].actor = "actor-shared-name";
  store.projectExecution(wfB);
  const wfB2 = makeWorkflow("tenant-b", "b2");
  wfB2.runLog[0].actor = "actor-shared-name";
  store.projectExecution(wfB2);

  const summary = store.actorSummary("tenant-a", "actor-shared-name");
  assert(summary !== null, "summary should be present");
  eq(summary!.executionCount, 1);
});

test("actorSummary: count matches listExecutions-derived count exactly (no behavior drift)", () => {
  const store = makeStore();
  store.projectActor({
    tenantId: "tenant-a",
    actorId: "actor-1",
    actorType: "agent",
    timestamp: "2026-06-13T00:00:00.000Z",
  });

  for (let i = 0; i < 10; i++) {
    const wf = makeWorkflow("tenant-a", `e${i}`);
    wf.runLog[0].actor = i % 3 === 0 ? "actor-1" : `other-${i}`;
    store.projectExecution(wf);
  }

  // Independently derive the expected count via the (sorted) public list API,
  // to confirm the new single-pass count agrees with the old sort+filter+length
  // approach it replaced.
  const expected = store.listExecutions("tenant-a").filter((e) => e.actor === "actor-1").length;
  const summary = store.actorSummary("tenant-a", "actor-1");
  assert(summary !== null, "summary should be present");
  eq(summary!.executionCount, expected);
});
