import "../_flush.mjs";
/**
 * tests/orchestrator/retry-policy.test.ts — v138.
 * First sub-step of ExecutionWorkflow retry handling: exponential-backoff policy.
 *
 *   BACKOFF       deterministic exponential growth, capped at maxDelayMs.
 *   DECISION      shouldRetry / nextRetry honor maxAttempts.
 *   EDGE          jitter is reproducible with an injected rng (and bounded).
 *   FAIL-CLOSED   invalid config / attempt / rng throw ExecutionError, never silent.
 *   DOMAIN        planRetryForWorkflow derives attempts from a real failed run-log.
 */
import { test, assert, eq } from "../_harness.mjs";
import {
  computeBackoffMs, shouldRetry, nextRetry, countFailures, planRetryForWorkflow,
  DEFAULT_RETRY_POLICY,
} from "../../lib/orchestrator/retry-policy.ts";
import { InMemoryExecutionStore, ExecutionError } from "../../lib/orchestrator/execution-workflow.ts";

const CFG = { maxAttempts: 5, baseDelayMs: 1000, multiplier: 2, maxDelayMs: 60000, jitter: 0 };

// ── BACKOFF: exponential, capped ──
test("computeBackoffMs grows exponentially and respects the cap", () => {
  eq(computeBackoffMs(1, CFG), 1000);
  eq(computeBackoffMs(2, CFG), 2000);
  eq(computeBackoffMs(3, CFG), 4000);
  eq(computeBackoffMs(4, CFG), 8000);
  eq(computeBackoffMs(5, CFG), 16000);
  eq(computeBackoffMs(10, CFG), 60000, "cap applies at maxDelayMs");
  // multiplier default is 2 when omitted
  eq(computeBackoffMs(3, { maxAttempts: 5, baseDelayMs: 1000 }), 4000);
});

// ── DECISION: maxAttempts boundary ──
test("shouldRetry / nextRetry honor maxAttempts", () => {
  eq(shouldRetry(0, CFG), true);
  eq(shouldRetry(4, CFG), true);
  eq(shouldRetry(5, CFG), false, "exhausted at maxAttempts");
  const p0 = nextRetry(0, CFG);
  eq(p0.retry, true); eq(p0.attempt, 1); eq(p0.delayMs, 1000);
  const p4 = nextRetry(4, CFG);
  eq(p4.retry, true); eq(p4.attempt, 5); eq(p4.delayMs, 16000);
  const p5 = nextRetry(5, CFG);
  eq(p5.retry, false); eq(p5.attempt, 6); eq(p5.delayMs, 0, "no delay when not retrying");
});

// ── EDGE: jitter is reproducible with injected rng and bounded by the cap ──
test("jitter scales deterministically with an injected rng", () => {
  const jcfg = { maxAttempts: 5, baseDelayMs: 1000, multiplier: 2, maxDelayMs: 60000, jitter: 0.5 };
  // rng=0.5 → neutral midpoint → no shift
  eq(computeBackoffMs(2, jcfg, () => 0.5), 2000);
  // rng=0 → lower bound: scale = 1 - 0.5 = 0.5 → 1000
  eq(computeBackoffMs(2, jcfg, () => 0), 1000);
  // rng=1 → upper bound: scale = 1 + 0.5 = 1.5 → 3000
  eq(computeBackoffMs(2, jcfg, () => 1), 3000);
  // jitter never exceeds the cap
  eq(computeBackoffMs(10, jcfg, () => 1), 60000);
});

// ── FAIL-CLOSED: invalid inputs throw ExecutionError ──
test("invalid config, attempt, or rng fail closed", () => {
  const expect = (fn: () => unknown, codeFragment: string) => {
    let threw = false;
    try { fn(); } catch (e) {
      threw = true;
      assert(e instanceof ExecutionError, "throws ExecutionError");
      eq((e as ExecutionError).code, "invalid_retry_config");
      assert((e as Error).message.includes(codeFragment), `message mentions ${codeFragment}`);
    }
    assert(threw, `must throw for ${codeFragment}`);
  };
  expect(() => computeBackoffMs(0, CFG), "attempt");
  expect(() => computeBackoffMs(1.5, CFG), "attempt");
  expect(() => computeBackoffMs(1, { maxAttempts: 0, baseDelayMs: 1000 }), "maxAttempts");
  expect(() => computeBackoffMs(1, { maxAttempts: 5, baseDelayMs: 0 }), "baseDelayMs");
  expect(() => computeBackoffMs(1, { maxAttempts: 5, baseDelayMs: 1000, multiplier: 0.5 }), "multiplier");
  expect(() => computeBackoffMs(1, { maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 100 }), "maxDelayMs");
  expect(() => computeBackoffMs(1, { maxAttempts: 5, baseDelayMs: 1000, jitter: 2 }), "jitter");
  expect(() => computeBackoffMs(2, { maxAttempts: 5, baseDelayMs: 1000, jitter: 0.5 }, () => 9), "rng");
  expect(() => shouldRetry(-1, CFG), "attemptsSoFar");
});

// ── DOMAIN: derive attempts from a real failed run-log ──
test("planRetryForWorkflow uses the failed workflow's run-log; non-failed is rejected", () => {
  const store = new InMemoryExecutionStore();
  const wf0 = store.create({ tenantId: "t1", actionId: "act-1" });
  eq(countFailures(wf0), 0);

  // Drive planned → approved → running → failed.
  store.transition(wf0.id, "t1", "approved", "supervisor");
  store.transition(wf0.id, "t1", "running", "worker-1");
  const failed = store.transition(wf0.id, "t1", "failed", "worker-1", "tool timeout");
  eq(failed.status, "failed");
  eq(countFailures(failed), 1);

  // First failure → attemptsSoFar=0 → attempt 1, delay = baseDelay.
  const plan = planRetryForWorkflow(failed, CFG);
  eq(plan.retry, true); eq(plan.attempt, 1); eq(plan.delayMs, 1000);

  // Default policy works too.
  const planDef = planRetryForWorkflow(failed);
  eq(planDef.attempt, 1); eq(planDef.delayMs, DEFAULT_RETRY_POLICY.baseDelayMs);

  // Fail-closed: a non-failed workflow cannot be retried.
  const wf1 = store.create({ tenantId: "t1", actionId: "act-2" });
  let threw = false;
  try { planRetryForWorkflow(wf1, CFG); } catch (e) {
    threw = true;
    assert(e instanceof ExecutionError, "throws ExecutionError");
    assert((e as Error).message.includes("failed workflow"), "explains the reason");
  }
  assert(threw, "planning a retry for a non-failed workflow must throw");
});
