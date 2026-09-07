import "../_flush.mjs";
/**
 * tests/jobs/queue.test.ts
 *
 * Tests for InMemoryQueue (JobQueue implementation).
 * Coverage: enqueue, claim (SKIP LOCKED), ack, nack/retry, fail-closed,
 *           tenant isolation, priority ordering, delayed jobs,
 *           visibility timeout / reapExpiredClaims, observability.
 *
 * Passed: 28 / Failed: 0  (target)
 */

import { test, assert, eq } from "../_harness.mjs";
import { InMemoryQueue } from "../../lib/jobs/queue.ts";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeQueue(opts?: { visibilityTimeoutMs?: number; defaultMaxAttempts?: number }) {
  return new InMemoryQueue(opts ?? {});
}

const T1 = "tenant-alpha";
const T2 = "tenant-beta";
const W1 = "worker-1";
const W2 = "worker-2";

// ─── enqueue ─────────────────────────────────────────────────────────────────

test("enqueue returns a non-empty string id", () => {
  const q = makeQueue();
  const id = q.enqueue(T1, "email.send", { to: "a@b.com" });
  assert(typeof id === "string" && id.length > 0, "should return non-empty id");
});

test("enqueue: missing tenantId throws", () => {
  const q = makeQueue();
  let threw = false;
  try { q.enqueue("", "x", null); }
  catch { threw = true; }
  assert(threw);
});

test("enqueue: missing type throws", () => {
  const q = makeQueue();
  let threw = false;
  try { q.enqueue(T1, "", null); }
  catch { threw = true; }
  assert(threw);
});

test("enqueue: undefined payload throws", () => {
  const q = makeQueue();
  let threw = false;
  try { q.enqueue(T1, "x", undefined as never); }
  catch { threw = true; }
  assert(threw);
});

test("enqueued job appears in listQueued", () => {
  const q = makeQueue();
  q.enqueue(T1, "x", null);
  const queued = q.listQueued(T1);
  eq(queued.length, 1);
  eq(queued[0].status, "queued");
});

test("counts reflects enqueued job", () => {
  const q = makeQueue();
  q.enqueue(T1, "x", null);
  const c = q.counts(T1);
  eq(c.queued, 1);
  eq(c.claimed, 0);
  eq(c.done, 0);
  eq(c.failed, 0);
});

// ─── claim (SKIP LOCKED semantics) ───────────────────────────────────────────

test("claim returns null when queue is empty", () => {
  const q = makeQueue();
  const result = q.claim(W1);
  eq(result, null);
});

test("claim returns a job from non-empty queue", () => {
  const q = makeQueue();
  q.enqueue(T1, "x", { n: 1 });
  const result = q.claim(W1);
  assert(result !== null, "should return a ClaimResult");
  eq(result!.job.status, "claimed");
  eq(result!.job.claimedBy, W1);
});

test("SKIP LOCKED: second worker cannot claim the same job", () => {
  const q = makeQueue();
  q.enqueue(T1, "x", null);
  const r1 = q.claim(W1);
  assert(r1 !== null, "worker 1 should claim");
  const r2 = q.claim(W2);
  eq(r2, null, "worker 2 should get nothing (job already claimed)");
});

test("claim: workerId is required", () => {
  const q = makeQueue();
  q.enqueue(T1, "x", null);
  let threw = false;
  try { q.claim(""); }
  catch { threw = true; }
  assert(threw);
});

test("claim respects tenantId filter", () => {
  const q = makeQueue();
  q.enqueue(T1, "x", null);
  q.enqueue(T2, "x", null);
  const r = q.claim(W1, { tenantId: T2 });
  assert(r !== null);
  eq(r!.job.tenantId, T2);
});

test("claim respects type filter", () => {
  const q = makeQueue();
  q.enqueue(T1, "email.send", null);
  q.enqueue(T1, "report.generate", null);
  const r = q.claim(W1, { type: "report.generate" });
  assert(r !== null);
  eq(r!.job.type, "report.generate");
});

// ─── priority ordering ────────────────────────────────────────────────────────

test("higher priority (lower number) job is claimed first", () => {
  const q = makeQueue();
  q.enqueue(T1, "low", null, { priority: 10 });
  q.enqueue(T1, "high", null, { priority: 1 });
  const r = q.claim(W1);
  eq(r!.job.type, "high", "priority 1 should be claimed before priority 10");
});

test("FIFO within same priority", () => {
  const q = makeQueue();
  q.enqueue(T1, "first", null, { priority: 5 });
  q.enqueue(T1, "second", null, { priority: 5 });
  const r = q.claim(W1);
  eq(r!.job.type, "first", "first-in should be first-out at same priority");
});

// ─── ack ─────────────────────────────────────────────────────────────────────

test("ack marks job done", () => {
  const q = makeQueue();
  q.enqueue(T1, "x", null);
  const r = q.claim(W1)!;
  r.ack();
  const c = q.counts(T1);
  eq(c.done, 1);
  eq(c.claimed, 0);
});

test("ack is idempotent (double-ack does not throw)", () => {
  const q = makeQueue();
  q.enqueue(T1, "x", null);
  const r = q.claim(W1)!;
  r.ack();
  r.ack(); // second ack — should be no-op
  eq(q.counts(T1).done, 1);
});

// ─── nack / retry ─────────────────────────────────────────────────────────────

test("nack re-queues job when attempts < maxAttempts", () => {
  const q = makeQueue({ defaultMaxAttempts: 3 });
  q.enqueue(T1, "x", null);
  const r = q.claim(W1)!;
  r.nack("transient error");
  const c = q.counts(T1);
  eq(c.queued, 1, "should be re-queued");
  eq(c.claimed, 0);
});

test("nack records last error", () => {
  const q = makeQueue({ defaultMaxAttempts: 3 });
  q.enqueue(T1, "x", null);
  const r = q.claim(W1)!;
  r.nack("my error message");
  const jobs = q.listQueued(T1);
  eq(jobs[0].lastError, "my error message");
});

test("nack permanently fails job when maxAttempts exhausted", () => {
  const q = makeQueue({ defaultMaxAttempts: 2 });
  q.enqueue(T1, "x", null);

  const r1 = q.claim(W1)!;
  r1.nack("fail 1");  // attempt 1, re-queued (1 < 2)

  const r2 = q.claim(W1)!;
  r2.nack("fail 2");  // attempt 2 = maxAttempts → permanently failed

  eq(q.counts(T1).failed, 1, "should be permanently failed");
  eq(q.counts(T1).queued, 0);
  eq(q.listFailed(T1).length, 1);
});

test("re-queued job can be claimed again by worker", () => {
  const q = makeQueue({ defaultMaxAttempts: 3 });
  q.enqueue(T1, "x", null);
  const r1 = q.claim(W1)!;
  r1.nack("retry");
  const r2 = q.claim(W2);
  assert(r2 !== null, "re-queued job should be claimable again");
  eq(r2!.job.attempts, 2);
});

// ─── visibility timeout / reap ────────────────────────────────────────────────

test("reapExpiredClaims recovers timed-out job back to queued", async () => {
  const q = new InMemoryQueue({ visibilityTimeoutMs: 10 }); // 10ms
  q.enqueue(T1, "x", null);
  q.claim(W1); // claimed — won't ack
  // Wait for timeout
  await new Promise((r) => setTimeout(r, 20));
  const reaped = q.reapExpiredClaims();
  eq(reaped, 1);
  eq(q.counts(T1).queued, 1);
  eq(q.counts(T1).claimed, 0);
});

test("reapExpiredClaims returns 0 when no expired claims", () => {
  const q = makeQueue({ visibilityTimeoutMs: 60_000 });
  q.enqueue(T1, "x", null);
  q.claim(W1);
  const reaped = q.reapExpiredClaims();
  eq(reaped, 0);
  eq(q.counts(T1).claimed, 1);
});

// ─── delayed jobs ─────────────────────────────────────────────────────────────

test("delayed job is not claimable before its delay expires", async () => {
  const q = makeQueue();
  q.enqueue(T1, "x", null, { delayMs: 200 });
  const r = q.claim(W1);
  eq(r, null, "delayed job should not be claimable immediately");
});

test("delayed job becomes claimable after delay", async () => {
  const q = makeQueue();
  q.enqueue(T1, "x", null, { delayMs: 20 });
  await new Promise((r) => setTimeout(r, 30));
  const result = q.claim(W1);
  assert(result !== null, "delayed job should be claimable after delay");
});

// ─── tenant isolation ─────────────────────────────────────────────────────────

test("listQueued(tenantId) isolates by tenant", () => {
  const q = makeQueue();
  q.enqueue(T1, "x", null);
  q.enqueue(T1, "x", null);
  q.enqueue(T2, "x", null);
  eq(q.listQueued(T1).length, 2);
  eq(q.listQueued(T2).length, 1);
  eq(q.listQueued().length, 3);
});

test("counts(tenantId) isolates by tenant", () => {
  const q = makeQueue();
  q.enqueue(T1, "x", null);
  q.enqueue(T2, "x", null);
  q.claim(W1, { tenantId: T1 })!.ack();
  eq(q.counts(T1).done, 1);
  eq(q.counts(T1).queued, 0);
  eq(q.counts(T2).queued, 1);
  eq(q.counts(T2).done, 0);
});

test("listFailed(tenantId) isolates by tenant", () => {
  const q = makeQueue({ defaultMaxAttempts: 1 });
  q.enqueue(T1, "x", null);
  q.enqueue(T2, "x", null);
  q.claim(W1, { tenantId: T1 })!.nack("err");
  eq(q.listFailed(T1).length, 1);
  eq(q.listFailed(T2).length, 0);
});

// ─── efficiency/min-find-claim ──────────────────────────────────────────────
// claim() was refactored from filter+sort+[0] (O(n log n)) to a single-pass
// min-find (O(n)). These tests pin the externally-observable ordering so the
// refactor can't silently change which job gets claimed.

test("min-find claim: lowest-priority job wins among many, regardless of insertion order", () => {
  const q = makeQueue();
  // Insert out of priority order, with the true minimum buried in the middle.
  const priorities = [9, 4, 7, 1, 8, 3, 6, 2, 5, 0];
  for (const p of priorities) q.enqueue(T1, `p${p}`, null, { priority: p });
  const r = q.claim(W1);
  eq(r!.job.type, "p0", "min-find should still surface the true minimum priority");
});

test("min-find claim: tenant/type filters are honored even when a lower-priority match is excluded", () => {
  const q = makeQueue();
  // The globally-lowest priority job belongs to a different tenant — it must
  // be skipped by the filter, not picked up by a buggy min-find that ignores
  // the predicate.
  q.enqueue(T2, "other-tenant", null, { priority: 0 });
  q.enqueue(T1, "wrong-type", null, { priority: 1 });
  q.enqueue(T1, "right", null, { priority: 5 });
  const r = q.claim(W1, { tenantId: T1, type: "right" });
  eq(r!.job.type, "right", "filters must apply before min comparison, not after");
});

test("min-find claim: regression — large pool, FIFO tie-break still holds at the winning priority", () => {
  const q = makeQueue();
  // 200 jobs at a higher priority, then two at the winning (lowest) priority
  // enqueued first-then-second — FIFO must break the tie correctly even
  // with a large pool of non-winning candidates interleaved.
  for (let i = 0; i < 200; i++) {
    q.enqueue(T1, `noise${i}`, null, { priority: 10 + (i % 5) });
  }
  const firstId = q.enqueue(T1, "winner-first", null, { priority: 0 });
  const secondId = q.enqueue(T1, "winner-second", null, { priority: 0 });
  assert(typeof firstId === "string" && typeof secondId === "string");
  const r = q.claim(W1);
  eq(r!.job.type, "winner-first", "FIFO tie-break at the minimum priority must survive the O(n) refactor");
});
