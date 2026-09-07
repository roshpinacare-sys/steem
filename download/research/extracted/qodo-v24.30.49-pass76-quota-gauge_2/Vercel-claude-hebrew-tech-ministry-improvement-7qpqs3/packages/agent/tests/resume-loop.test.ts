/**
 * resume-loop.test.ts — end-to-end coverage of the ADR-005 resume loop
 * (NEXT-STEP IR8), exercised entirely offline against InMemoryTriggerQueue
 * with a mocked dispatch (workflow_dispatch stand-in).
 *
 * Covers the four reliability contracts from Invariant #12:
 *   - happy path: a queued trigger is popped, dispatched with the right
 *     inputs, acked by the (simulated) resumed run, and reaped to completion.
 *   - crash-before-ack: consumer dispatches but the run never acks; the task
 *     stays in processing and the reaper requeues it once stale.
 *   - crash-after-ack: the run acked; the reaper completes it and never
 *     requeues (no duplicate run).
 *   - poison message: a permanently-failing trigger is dead-lettered after the
 *     attempt cap instead of looping forever.
 */
import { describe, it, expect, vi } from "vitest";
import {
  InMemoryTriggerQueue,
  RedisTriggerQueue,
  type RedisListOps,
  type TriggerTask,
} from "../src/services/trigger-queue.js";
import { drainTriggerQueue } from "../src/pipeline/drain-trigger-queue.js";

/** A controllable clock so staleness is deterministic. */
function clock(startMs = 1_000_000) {
  let t = startMs;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const STALE_MS = 15 * 60 * 1000;

describe("resume loop — happy path", () => {
  it("pops, dispatches with pr_number + task_id, then reaps to completion after ack", async () => {
    const c = clock();
    const queue = new InMemoryTriggerQueue(c.now);
    const task = await queue.push({
      owner: "haran4-cpu",
      repo: "Vercel",
      prNumber: 128,
      objective: "Resume PR #128",
      trigger: "webhook:issue_comment:proceed",
    });

    const dispatched: TriggerTask[] = [];
    const dispatch = vi.fn(async (t: TriggerTask) => {
      dispatched.push(t);
    });

    const s1 = await drainTriggerQueue({ queue, dispatch, staleMs: STALE_MS });
    expect(s1.dispatched).toBe(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatched[0].prNumber).toBe(128);
    expect(dispatched[0].taskId).toBe(task.taskId);
    expect(dispatched[0].trigger).toBe("webhook:issue_comment:proceed");

    // In-flight: still in processing, not yet completed.
    expect((await queue.depth()).processing).toBe(1);

    // The resumed run writes its ack key at first checkpoint.
    await queue.ack(task.taskId);

    // Next drain tick reconciles: acked → completed, removed from processing.
    const s2 = await drainTriggerQueue({ queue, dispatch, staleMs: STALE_MS });
    expect(s2.completed).toBe(1);
    const depth = await queue.depth();
    expect(depth.processing).toBe(0);
    expect(depth.queued).toBe(0);
    expect(depth.dead).toBe(0);
  });
});

describe("resume loop — crash before ack", () => {
  it("keeps the task in processing and the reaper requeues it once stale", async () => {
    const c = clock();
    const queue = new InMemoryTriggerQueue(c.now);
    const task = await queue.push({ owner: "o", repo: "r", prNumber: 7, trigger: "webhook" });

    // Dispatch happens but the run crashes before acking.
    await drainTriggerQueue({ queue, dispatch: async () => {}, staleMs: STALE_MS });
    expect((await queue.depth()).processing).toBe(1);

    // Before the stale window elapses, the reaper leaves it alone.
    const early = await queue.reap({ staleMs: STALE_MS, maxAttempts: 3 });
    expect(early.requeued).toHaveLength(0);
    expect((await queue.depth()).processing).toBe(1);

    // After the stale window, the reaper requeues it (attempts incremented).
    c.advance(STALE_MS + 1);
    const reaped = await queue.reap({ staleMs: STALE_MS, maxAttempts: 3 });
    expect(reaped.requeued).toEqual([task.taskId]);
    const depth = await queue.depth();
    expect(depth.processing).toBe(0);
    expect(depth.queued).toBe(1);

    const requeued = await queue.pop();
    expect(requeued?.taskId).toBe(task.taskId);
    expect(requeued?.attempts).toBe(1);
  });
});

describe("resume loop — crash after ack", () => {
  it("completes the acked task and never requeues it (no duplicate run)", async () => {
    const c = clock();
    const queue = new InMemoryTriggerQueue(c.now);
    const task = await queue.push({ owner: "o", repo: "r", prNumber: 9, trigger: "webhook" });

    await drainTriggerQueue({ queue, dispatch: async () => {}, staleMs: STALE_MS });
    // The run acked before "crashing".
    await queue.ack(task.taskId);

    // Even long past the stale window, an acked item is completed, not requeued.
    c.advance(STALE_MS * 10);
    const reaped = await queue.reap({ staleMs: STALE_MS, maxAttempts: 3 });
    expect(reaped.completed).toEqual([task.taskId]);
    expect(reaped.requeued).toHaveLength(0);
    const depth = await queue.depth();
    expect(depth.processing).toBe(0);
    expect(depth.queued).toBe(0);
  });
});

describe("resume loop — drain tunables", () => {
  it("respects maxBatch, dispatching at most N tasks per invocation", async () => {
    const c = clock();
    const queue = new InMemoryTriggerQueue(c.now);
    for (let i = 0; i < 5; i++) await queue.push({ owner: "o", repo: "r", prNumber: i, trigger: "webhook" });

    const dispatch = vi.fn(async () => {});
    const summary = await drainTriggerQueue({ queue, dispatch, staleMs: STALE_MS, maxBatch: 2 });

    expect(summary.dispatched).toBe(2);
    expect(dispatch).toHaveBeenCalledTimes(2);
    const depth = await queue.depth();
    expect(depth.queued).toBe(3); // remainder stays queued for the next tick
    expect(depth.processing).toBe(2);
  });

  it("reap-only (maxBatch: 0) reconciles without dispatching", async () => {
    const c = clock();
    const queue = new InMemoryTriggerQueue(c.now);
    const task = await queue.push({ owner: "o", repo: "r", prNumber: 1, trigger: "webhook" });
    // Simulate a prior in-flight, already-acked item.
    await queue.pop();
    await queue.ack(task.taskId);

    const dispatch = vi.fn(async () => {});
    const summary = await drainTriggerQueue({ queue, dispatch, staleMs: STALE_MS, maxBatch: 0 });

    expect(dispatch).not.toHaveBeenCalled();
    expect(summary.dispatched).toBe(0);
    expect(summary.completed).toBe(1); // reaper still completed the acked item
    expect((await queue.depth()).processing).toBe(0);
  });

  it("a stale window longer than the wait keeps a legitimately slow run in flight", async () => {
    const c = clock();
    const queue = new InMemoryTriggerQueue(c.now);
    const task = await queue.push({ owner: "o", repo: "r", prNumber: 3, trigger: "webhook" });
    await drainTriggerQueue({ queue, dispatch: async () => {}, staleMs: STALE_MS });

    // Advance less than the (large) stale window: the slow-to-start run is NOT
    // requeued, so no duplicate dispatch — the timing-contract guarantee.
    c.advance(STALE_MS - 1);
    const reaped = await queue.reap({ staleMs: STALE_MS, maxAttempts: 3 });
    expect(reaped.requeued).toHaveLength(0);
    expect((await queue.depth()).processing).toBe(1);

    // Once it finally acks, the next reap completes it (no duplicate ever sent).
    await queue.ack(task.taskId);
    const reaped2 = await queue.reap({ staleMs: STALE_MS, maxAttempts: 3 });
    expect(reaped2.completed).toEqual([task.taskId]);
  });
});

describe("resume loop — poison message", () => {
  it("dead-letters a permanently un-acked task after the attempt cap", async () => {
    const c = clock();
    const queue = new InMemoryTriggerQueue(c.now);
    const task = await queue.push({ owner: "o", repo: "r", prNumber: 13, trigger: "webhook" });

    // Attempt 1 → stale → requeue (attempts=1)
    await queue.pop();
    c.advance(STALE_MS + 1);
    let r = await queue.reap({ staleMs: STALE_MS, maxAttempts: 3 });
    expect(r.requeued).toEqual([task.taskId]);

    // Attempt 2 → stale → requeue (attempts=2)
    await queue.pop();
    c.advance(STALE_MS + 1);
    r = await queue.reap({ staleMs: STALE_MS, maxAttempts: 3 });
    expect(r.requeued).toEqual([task.taskId]);

    // Attempt 3 → stale → dead-letter (attempts+1 >= 3)
    await queue.pop();
    c.advance(STALE_MS + 1);
    r = await queue.reap({ staleMs: STALE_MS, maxAttempts: 3 });
    expect(r.dead).toEqual([task.taskId]);

    const depth = await queue.depth();
    expect(depth.dead).toBe(1);
    expect(depth.queued).toBe(0);
    expect(depth.processing).toBe(0);
  });
});

// ── RedisTriggerQueue against a fake Redis, proving the same contract holds
//    over the real command sequence (LMOVE / LREM / LRANGE / SET / EXISTS). ──

class FakeRedis implements RedisListOps {
  lists = new Map<string, string[]>(); // index 0 = leftmost (head)
  kv = new Map<string, string>();
  private list(k: string) {
    if (!this.lists.has(k)) this.lists.set(k, []);
    return this.lists.get(k)!;
  }
  async lpush(key: string, value: string) {
    this.list(key).unshift(value);
  }
  async lmove(source: string, dest: string, from: "LEFT" | "RIGHT", to: "LEFT" | "RIGHT") {
    const src = this.list(source);
    if (src.length === 0) return null;
    const val = from === "LEFT" ? src.shift()! : src.pop()!;
    const d = this.list(dest);
    if (to === "LEFT") d.unshift(val);
    else d.push(val);
    return val;
  }
  async lrem(key: string, count: number, value: string) {
    const l = this.list(key);
    let removed = 0;
    for (let i = l.length - 1; i >= 0 && (count === 0 || removed < count); i--) {
      if (l[i] === value) {
        l.splice(i, 1);
        removed++;
      }
    }
    return removed;
  }
  async lrange(key: string, start: number, stop: number) {
    const l = this.list(key);
    const end = stop === -1 ? l.length - 1 : stop;
    return l.slice(start, end + 1);
  }
  async llen(key: string) {
    return this.list(key).length;
  }
  async exists(key: string) {
    return this.kv.has(key);
  }
  async setWithTTL(key: string, value: string) {
    this.kv.set(key, value);
  }
}

describe("RedisTriggerQueue over a fake Redis", () => {
  it("round-trips push → pop(LMOVE) → ack → reap(complete)", async () => {
    const c = clock();
    const redis = new FakeRedis();
    const queue = new RedisTriggerQueue(redis, c.now);

    const task = await queue.push({ owner: "o", repo: "r", prNumber: 42, trigger: "webhook:proceed" });
    expect((await queue.depth()).queued).toBe(1);

    const popped = await queue.pop();
    expect(popped?.taskId).toBe(task.taskId);
    expect(popped?.prNumber).toBe(42);
    expect((await queue.depth()).processing).toBe(1);
    expect((await queue.depth()).queued).toBe(0);

    expect(await queue.isAcked(task.taskId)).toBe(false);
    await queue.ack(task.taskId);
    expect(await queue.isAcked(task.taskId)).toBe(true);

    const reaped = await queue.reap({ staleMs: STALE_MS, maxAttempts: 3 });
    expect(reaped.completed).toEqual([task.taskId]);
    expect((await queue.depth()).processing).toBe(0);
  });

  it("requeues a stale un-acked item and dead-letters after the cap", async () => {
    const c = clock();
    const redis = new FakeRedis();
    const queue = new RedisTriggerQueue(redis, c.now);
    const task = await queue.push({ owner: "o", repo: "r", prNumber: 5, trigger: "webhook" });

    for (let attempt = 1; attempt <= 2; attempt++) {
      await queue.pop();
      c.advance(STALE_MS + 1);
      const r = await queue.reap({ staleMs: STALE_MS, maxAttempts: 3 });
      expect(r.requeued).toEqual([task.taskId]);
    }
    await queue.pop();
    c.advance(STALE_MS + 1);
    const r = await queue.reap({ staleMs: STALE_MS, maxAttempts: 3 });
    expect(r.dead).toEqual([task.taskId]);
    expect((await queue.depth()).dead).toBe(1);
  });

  it("tolerates a legacy bare webhook payload with no adapter metadata", async () => {
    const c = clock();
    const redis = new FakeRedis();
    const queue = new RedisTriggerQueue(redis, c.now);
    // Simulate the old webhook shape (no taskId/attempts/enqueuedAt).
    await redis.lpush("qodo:trigger:queue", JSON.stringify({ owner: "o", repo: "r", prNumber: 3, trigger: "webhook" }));

    const popped = await queue.pop();
    expect(popped).not.toBeNull();
    expect(popped?.prNumber).toBe(3);
    expect(popped?.attempts).toBe(0);
    expect(popped?.taskId).toMatch(/^trig-/);
  });
});
