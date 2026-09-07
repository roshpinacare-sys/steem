import "../_flush.mjs";
/**
 * tests/orchestrator/execution-supervisor.test.ts — v139.
 * Continuation of MANIFEST "החסר הבא" #1 (ExecutionWorkflow #2): the supervisor
 * connects retry-policy to the ExecutionStore via "re-lease + re-run after failed".
 *
 *   APPROVED   a failed workflow within maxAttempts gets a new linked `planned`
 *              workflow, leased to the worker.
 *   EDGE       attempts exhausted -> no retry workflow, lease released, final failure.
 *   FAIL-CLOSED  unknown workflow / cross-tenant / non-failed / empty workerId all throw.
 */
import { test, assert, eq } from "../_harness.mjs";
import { InMemoryExecutionStore, ExecutionError } from "../../lib/orchestrator/execution-workflow.ts";
import { superviseFailedWorkflow, DEFAULT_RETRY_LEASE_MS } from "../../lib/orchestrator/execution-supervisor.ts";

const CFG = { maxAttempts: 2, baseDelayMs: 1000, multiplier: 2, maxDelayMs: 60000, jitter: 0 };

function makeFailedWorkflow(store: InMemoryExecutionStore, tenantId = "t1", actionId = "act-1") {
  const wf = store.create({ tenantId, actionId, intentId: "intent-1", executionRef: "ref-1" });
  store.transition(wf.id, tenantId, "approved", "supervisor");
  store.transition(wf.id, tenantId, "running", "worker-1");
  store.lease(wf.id, tenantId, "worker-1", 30_000);
  return store.transition(wf.id, tenantId, "failed", "worker-1", "tool timeout");
}

// ── APPROVED: retry within maxAttempts creates a new leased planned workflow ──
test("superviseFailedWorkflow schedules a retry: new linked planned workflow, leased", () => {
  const store = new InMemoryExecutionStore();
  const failed = makeFailedWorkflow(store);

  const outcome = superviseFailedWorkflow(store, failed.id, "t1", "worker-2", CFG);
  eq(outcome.plan.retry, true);
  eq(outcome.plan.attempt, 1);
  eq(outcome.plan.delayMs, 1000);

  const retryWf = outcome.retryWorkflow;
  assert(retryWf !== null, "retry workflow created");
  eq(retryWf!.status, "planned");
  eq(retryWf!.tenantId, "t1");
  eq(retryWf!.actionId, "act-1");
  eq(retryWf!.intentId, "intent-1");
  eq(retryWf!.executionRef, "ref-1");
  eq(retryWf!.retryOfWorkflowId, failed.id);
  eq(retryWf!.claimedBy, "worker-2");
  assert(retryWf!.leaseExpiresAt !== null && retryWf!.leaseExpiresAt > Date.now(), "leased");

  // verify reads back from the store too (not just the in-call copy)
  const fromStore = store.get(retryWf!.id, "t1");
  eq(fromStore!.claimedBy, "worker-2");

  // The original failed workflow itself is untouched (terminal, immutable status).
  const originalAfter = store.get(failed.id, "t1");
  eq(originalAfter!.status, "failed");
});

// ── EDGE: retrying a retry forms a chain; each link derives attempt=1 from
// its OWN run-log (countFailures is per-workflow, since "failed" is terminal
// and a workflow's run-log can contain at most one "failed" entry) ──
test("superviseFailedWorkflow: retrying a retry forms a linked chain", () => {
  const store = new InMemoryExecutionStore();
  const wf0 = makeFailedWorkflow(store, "t1", "act-2");

  const r1 = superviseFailedWorkflow(store, wf0.id, "t1", "worker-2", CFG);
  eq(r1.plan.retry, true);
  eq(r1.plan.attempt, 1);
  eq(r1.plan.delayMs, 1000);
  const retry1 = r1.retryWorkflow!;
  eq(retry1.retryOfWorkflowId, wf0.id);

  // Drive retry1 to failed too, then supervise it.
  store.transition(retry1.id, "t1", "approved", "supervisor");
  store.transition(retry1.id, "t1", "running", "worker-2");
  const failed2 = store.transition(retry1.id, "t1", "failed", "worker-2", "tool timeout again");

  const r2 = superviseFailedWorkflow(store, failed2.id, "t1", "worker-3", CFG);
  eq(r2.plan.retry, true);
  eq(r2.plan.attempt, 1, "each link's own run-log has exactly one failed entry");
  const retry2 = r2.retryWorkflow!;
  eq(retry2.retryOfWorkflowId, failed2.id, "chain: retry2 -> failed2 -> retry1 -> wf0");
  eq(retry2.claimedBy, "worker-3");
});

// ── FAIL-CLOSED ──
test("superviseFailedWorkflow fails closed on bad input", () => {
  const store = new InMemoryExecutionStore();
  const failed = makeFailedWorkflow(store, "t1", "act-3");

  // unknown workflow id
  let threw = false;
  try { superviseFailedWorkflow(store, "no-such-id", "t1", "worker-2", CFG); }
  catch (e) { threw = true; assert(e instanceof ExecutionError, "ExecutionError"); eq((e as ExecutionError).code, "workflow_not_found"); }
  assert(threw, "unknown id throws");

  // cross-tenant access
  threw = false;
  try { superviseFailedWorkflow(store, failed.id, "t2", "worker-2", CFG); }
  catch (e) { threw = true; assert(e instanceof ExecutionError, "ExecutionError"); eq((e as ExecutionError).code, "workflow_not_found"); }
  assert(threw, "cross-tenant access throws (returns null from get -> not found)");

  // non-failed workflow (e.g. a fresh "planned" workflow)
  const planned = store.create({ tenantId: "t1", actionId: "act-4" });
  threw = false;
  try { superviseFailedWorkflow(store, planned.id, "t1", "worker-2", CFG); }
  catch (e) { threw = true; assert(e instanceof ExecutionError, "ExecutionError"); eq((e as ExecutionError).code, "invalid_retry_config"); }
  assert(threw, "non-failed workflow throws invalid_retry_config");

  // empty workerId when a retry would be scheduled
  threw = false;
  try { superviseFailedWorkflow(store, failed.id, "t1", "", CFG); }
  catch (e) { threw = true; assert(e instanceof ExecutionError, "ExecutionError"); eq((e as ExecutionError).code, "lease_denied"); }
  assert(threw, "empty workerId throws lease_denied");

  // default lease constant sanity
  eq(DEFAULT_RETRY_LEASE_MS, 30_000);
});
