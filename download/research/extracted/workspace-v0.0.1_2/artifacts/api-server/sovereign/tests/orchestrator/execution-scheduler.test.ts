import "../_flush.mjs";
/**
 * tests/orchestrator/execution-scheduler.test.ts — v141.
 * ExecutionWorkflow #2 continuation: ExecutionScheduler + superviseFailedWorkflowAsync
 * + countChainFailures (chain-aware exhaustion fix).
 *
 *   APPROVED   scheduler picks up `failed` workflows, creates retry, advances planned→running
 *   CHAIN      countChainFailures traverses retryOfWorkflowId ancestors (exhaustion fix)
 *   EXHAUSTED  when chainFailures >= maxAttempts, no retry is created
 *   ASYNC      superviseFailedWorkflowAsync works like the sync supervisor on an InMemoryStore
 *   STATUS     getStatus() returns accurate running/tenant/counter fields
 *   FAIL-CLOSED  unknown/cross-tenant/non-failed/empty-workerId all throw
 */
import { test, assert, eq } from "../_harness.mjs";
import { InMemoryExecutionStore, ExecutionError } from "../../lib/orchestrator/execution-workflow.ts";
import {
  ExecutionScheduler,
  superviseFailedWorkflowAsync,
  countChainFailures,
  SCHEDULER_ACTOR,
  SCHEDULER_LEASE_MS,
} from "../../lib/orchestrator/execution-scheduler.ts";

// baseDelayMs must be > 0 (retry-policy enforces this via resolve(); 0 throws invalid_retry_config)
const CFG = { maxAttempts: 3, baseDelayMs: 1, multiplier: 1, maxDelayMs: 1, jitter: 0 };
const CFG2 = { maxAttempts: 2, baseDelayMs: 1000, multiplier: 2, maxDelayMs: 60_000, jitter: 0 };

function makeFailed(store: InMemoryExecutionStore, tenantId = "t1", actionId = "act-1", retryOf?: string) {
  const wf = store.create({ tenantId, actionId, retryOfWorkflowId: retryOf });
  store.transition(wf.id, tenantId, "approved", "test");
  store.transition(wf.id, tenantId, "running", "test");
  return store.transition(wf.id, tenantId, "failed", "test", "timeout");
}

// ── superviseFailedWorkflowAsync: happy path ───────────────────────────────
test("superviseFailedWorkflowAsync: creates retry workflow for failed", async () => {
  const store = new InMemoryExecutionStore();
  const failed = makeFailed(store);
  const outcome = await superviseFailedWorkflowAsync(store, failed.id, "t1", "worker-1", CFG2);
  assert(outcome.plan.retry, "plan.retry should be true on first attempt");
  assert(outcome.retryWorkflow !== null, "retryWorkflow should be created");
  eq(outcome.retryWorkflow!.status, "planned");
  eq(outcome.retryWorkflow!.retryOfWorkflowId, failed.id);
  eq(outcome.retryWorkflow!.tenantId, "t1");
  eq(outcome.retryWorkflow!.actionId, "act-1");
  eq(outcome.original.id, failed.id);
});

// ── superviseFailedWorkflowAsync: exhaustion ──────────────────────────────
test("superviseFailedWorkflowAsync: exhausted when chainFailures >= maxAttempts", async () => {
  const store = new InMemoryExecutionStore();
  // Build a chain: fail0 → fail1 (retry of fail0)
  const fail0 = makeFailed(store, "t1", "act-2");
  const fail1 = makeFailed(store, "t1", "act-2", fail0.id);
  // CFG2.maxAttempts = 2; chain has 2 failures → exhausted
  const outcome = await superviseFailedWorkflowAsync(store, fail1.id, "t1", "worker-1", CFG2);
  assert(!outcome.plan.retry, "plan.retry should be false when exhausted");
  eq(outcome.retryWorkflow, null);
});

// ── countChainFailures: traverses retryOfWorkflowId chain ────────────────
test("countChainFailures: sums failures across chain depth", async () => {
  const store = new InMemoryExecutionStore();
  const f0 = makeFailed(store, "t1", "act-3");
  const f1 = makeFailed(store, "t1", "act-3", f0.id);
  const f2 = makeFailed(store, "t1", "act-3", f1.id);
  const total = await countChainFailures(store, f2, "t1");
  eq(total, 3);
});

test("countChainFailures: single workflow with no chain = 1", async () => {
  const store = new InMemoryExecutionStore();
  const f = makeFailed(store, "t1", "act-4");
  const total = await countChainFailures(store, f, "t1");
  eq(total, 1);
});

test("countChainFailures: planned workflow with no failures = 0", async () => {
  const store = new InMemoryExecutionStore();
  const wf = store.create({ tenantId: "t1", actionId: "act-5" });
  const total = await countChainFailures(store, wf, "t1");
  eq(total, 0);
});

// ── superviseFailedWorkflowAsync: fail-closed ────────────────────────────
test("superviseFailedWorkflowAsync: unknown id throws workflow_not_found", async () => {
  const store = new InMemoryExecutionStore();
  let threw = false;
  try { await superviseFailedWorkflowAsync(store, "no-such", "t1", "w1", CFG2); }
  catch (e) { threw = true; assert(e instanceof ExecutionError); eq((e as ExecutionError).code, "workflow_not_found"); }
  assert(threw, "should throw for unknown id");
});

test("superviseFailedWorkflowAsync: cross-tenant throws workflow_not_found", async () => {
  const store = new InMemoryExecutionStore();
  const f = makeFailed(store, "t1");
  let threw = false;
  try { await superviseFailedWorkflowAsync(store, f.id, "t2", "w1", CFG2); }
  catch (e) { threw = true; assert(e instanceof ExecutionError); eq((e as ExecutionError).code, "workflow_not_found"); }
  assert(threw, "cross-tenant access should throw");
});

test("superviseFailedWorkflowAsync: non-failed workflow throws invalid_retry_config", async () => {
  const store = new InMemoryExecutionStore();
  const planned = store.create({ tenantId: "t1", actionId: "act-6" });
  let threw = false;
  try { await superviseFailedWorkflowAsync(store, planned.id, "t1", "w1", CFG2); }
  catch (e) { threw = true; assert(e instanceof ExecutionError); eq((e as ExecutionError).code, "invalid_retry_config"); }
  assert(threw, "non-failed workflow should throw");
});

test("superviseFailedWorkflowAsync: empty workerId throws lease_denied", async () => {
  const store = new InMemoryExecutionStore();
  const f = makeFailed(store);
  let threw = false;
  try { await superviseFailedWorkflowAsync(store, f.id, "t1", "", CFG2); }
  catch (e) { threw = true; assert(e instanceof ExecutionError); eq((e as ExecutionError).code, "lease_denied"); }
  assert(threw, "empty workerId should throw");
});

// ── ExecutionScheduler: start/stop/status ────────────────────────────────
test("ExecutionScheduler: initial status is not running", () => {
  const store = new InMemoryExecutionStore();
  const sched = new ExecutionScheduler(store, CFG, 60_000);
  const status = sched.getStatus();
  assert(!status.running, "should not be running before start");
  eq(status.tenants.length, 0);
  eq(status.totalRuns, 0);
});

test("ExecutionScheduler: start/stop toggle running flag", () => {
  const store = new InMemoryExecutionStore();
  const sched = new ExecutionScheduler(store, CFG, 60_000);
  sched.start();
  assert(sched.getStatus().running, "should be running after start");
  sched.stop();
  assert(!sched.getStatus().running, "should not be running after stop");
});

test("ExecutionScheduler: second start() is no-op", () => {
  const store = new InMemoryExecutionStore();
  const sched = new ExecutionScheduler(store, CFG, 60_000);
  sched.start();
  sched.start(); // no-op
  assert(sched.getStatus().running);
  sched.stop();
});

test("ExecutionScheduler: registerTenant appears in status.tenants", () => {
  const store = new InMemoryExecutionStore();
  const sched = new ExecutionScheduler(store, CFG, 60_000);
  sched.registerTenant("tenant-A");
  sched.registerTenant("tenant-B");
  sched.registerTenant("tenant-A"); // idempotent
  const { tenants } = sched.getStatus();
  eq(tenants.length, 2);
  assert(tenants.includes("tenant-A"));
  assert(tenants.includes("tenant-B"));
});

// ── ExecutionScheduler: scanTenant retries failed workflows ───────────────
test("ExecutionScheduler.scanTenant: retries a failed workflow", async () => {
  const store = new InMemoryExecutionStore();
  const sched = new ExecutionScheduler(store, CFG, 60_000);
  const f = makeFailed(store, "t1", "act-10");
  await sched.scanTenant("t1");
  // After scan, a retry workflow should exist in planned/approved/running
  const all = store.list("t1");
  const retry = all.find((wf) => wf.retryOfWorkflowId === f.id);
  assert(retry !== undefined, "retry workflow should have been created");
  eq(sched.getStatus().totalRetries, 1);
});

test("ExecutionScheduler.scanTenant: exhausted chain increments totalExhausted", async () => {
  const store = new InMemoryExecutionStore();
  // CFG.maxAttempts = 3; create 3-deep chain
  const f0 = makeFailed(store, "t1", "act-11");
  const f1 = makeFailed(store, "t1", "act-11", f0.id);
  const f2 = makeFailed(store, "t1", "act-11", f1.id);
  const sched = new ExecutionScheduler(store, CFG, 60_000);
  await sched.scanTenant("t1");
  // f0 (1 chain failure), f1 (2 chain), f2 (3 chain, exhausted)
  // f0 and f1 should produce retries; f2 should be exhausted
  const status = sched.getStatus();
  assert(status.totalExhausted >= 1, `expected ≥1 exhausted, got ${status.totalExhausted}`);
});

test("ExecutionScheduler.scanTenant: ignores non-failed workflows", async () => {
  const store = new InMemoryExecutionStore();
  const sched = new ExecutionScheduler(store, CFG, 60_000);
  store.create({ tenantId: "t1", actionId: "act-12" }); // planned
  await sched.scanTenant("t1");
  eq(sched.getStatus().totalRetries, 0);
  eq(sched.getStatus().totalExhausted, 0);
});

// ── ExecutionScheduler: runAll covers registered tenants ─────────────────
test("ExecutionScheduler.runAll: scans all registered tenants", async () => {
  const store = new InMemoryExecutionStore();
  makeFailed(store, "tenA", "act-20");
  makeFailed(store, "tenB", "act-21");
  const sched = new ExecutionScheduler(store, CFG, 60_000);
  sched.registerTenant("tenA");
  sched.registerTenant("tenB");
  await sched.runAll();
  eq(sched.getStatus().totalRetries, 2);
  eq(sched.getStatus().totalRuns, 1);
});

// ── SCHEDULER_ACTOR + SCHEDULER_LEASE_MS constants ──────────────────────
test("SCHEDULER_ACTOR and SCHEDULER_LEASE_MS are exported constants", () => {
  eq(typeof SCHEDULER_ACTOR, "string");
  assert(SCHEDULER_ACTOR.length > 0);
  eq(typeof SCHEDULER_LEASE_MS, "number");
  assert(SCHEDULER_LEASE_MS > 0);
});
