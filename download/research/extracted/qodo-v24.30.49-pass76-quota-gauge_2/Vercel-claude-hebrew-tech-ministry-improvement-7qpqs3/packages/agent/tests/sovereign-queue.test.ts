/**
 * sovereign-queue.test.ts — the ADR-005 resume-loop reliability contracts
 * (Invariant #12) proven against the SOVEREIGN filesystem substrate, not Redis.
 *
 * This is the guarantee that removing the Redis dependency changed nothing about
 * correctness: StoreTriggerQueue over FileDurableStore gives the same
 * no-loss-on-crash, no-duplicate-on-ack, poison→dead-letter behaviour that the
 * Redis path does. Runs entirely on a temp directory — zero external services.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StoreTriggerQueue, type TriggerTask } from "../src/services/trigger-queue.js";
import { FileDurableStore } from "../src/services/sovereign-store.js";
import { drainTriggerQueue } from "../src/pipeline/drain-trigger-queue.js";

function clock(startMs = 1_000_000) {
  let t = startMs;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

const STALE_MS = 15 * 60 * 1000;

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "qodo-sq-")); });
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

function makeQueue(now: () => number) {
  return new StoreTriggerQueue(new FileDurableStore(dir, now), now);
}

describe("sovereign resume loop — happy path", () => {
  it("pops, dispatches, and reaps to completion after ack", async () => {
    const c = clock();
    const queue = makeQueue(c.now);
    await queue.push({ owner: "o", repo: "r", prNumber: 7, trigger: "webhook:proceed", defaultBranch: "main" });

    const dispatched: TriggerTask[] = [];
    const s1 = await drainTriggerQueue({
      queue,
      dispatch: async (t) => { dispatched.push(t); await queue.ack(t.taskId); },
      staleMs: STALE_MS,
    });
    expect(s1.dispatched).toBe(1);
    expect(dispatched[0].prNumber).toBe(7);
    expect((await queue.depth()).processing).toBe(1); // acked but not yet reaped

    // Next tick reaps the acked item to completion; no requeue, no duplicate.
    c.advance(STALE_MS + 1);
    const s2 = await drainTriggerQueue({ queue, dispatch: async () => { throw new Error("no dispatch expected"); }, staleMs: STALE_MS, maxBatch: 0 });
    expect(s2.completed).toBe(1);
    expect(await queue.depth()).toEqual({ queued: 0, processing: 0, dead: 0 });
  });
});

describe("sovereign resume loop — crash before ack", () => {
  it("requeues a stale un-acked task for another attempt (no loss)", async () => {
    const c = clock();
    const queue = makeQueue(c.now);
    await queue.push({ owner: "o", repo: "r", prNumber: 1, trigger: "webhook:proceed" });

    // Dispatch succeeds but the run never acks (crash before checkpoint).
    await drainTriggerQueue({ queue, dispatch: async () => {}, staleMs: STALE_MS });
    expect((await queue.depth()).processing).toBe(1);

    // Before staleness: still in flight, not requeued.
    const early = await drainTriggerQueue({ queue, dispatch: async () => { throw new Error("x"); }, staleMs: STALE_MS, maxBatch: 0 });
    expect(early.requeued).toBe(0);

    // After staleness: reaper requeues it.
    c.advance(STALE_MS + 1);
    const late = await drainTriggerQueue({ queue, dispatch: async () => { throw new Error("x"); }, staleMs: STALE_MS, maxBatch: 0 });
    expect(late.requeued).toBe(1);
    expect((await queue.depth()).queued).toBe(1);
  });
});

describe("sovereign resume loop — crash after ack", () => {
  it("completes an acked task and never requeues it (no duplicate run)", async () => {
    const c = clock();
    const queue = makeQueue(c.now);
    const task = await queue.push({ owner: "o", repo: "r", prNumber: 2, trigger: "webhook:proceed" });
    await queue.pop();          // into processing
    await queue.ack(task.taskId); // the resumed run checkpointed, then "crashed"

    c.advance(STALE_MS + 1);
    const reaped = await queue.reap({ staleMs: STALE_MS, maxAttempts: 3 });
    expect(reaped.completed).toEqual([task.taskId]);
    expect(reaped.requeued).toEqual([]);
    expect(await queue.depth()).toEqual({ queued: 0, processing: 0, dead: 0 });
  });
});

describe("sovereign resume loop — poison message", () => {
  it("dead-letters a permanently-failing trigger after the attempt cap", async () => {
    const c = clock();
    const queue = makeQueue(c.now);
    await queue.push({ owner: "o", repo: "r", prNumber: 3, trigger: "webhook:proceed" });
    const failing = vi.fn(async () => { throw new Error("boom"); });

    // Each tick: dispatch fails → stays in processing → next stale tick requeues,
    // until attempts hit the cap and it is dead-lettered.
    for (let i = 0; i < 4; i++) {
      await drainTriggerQueue({ queue, dispatch: failing, staleMs: STALE_MS, maxAttempts: 3 });
      c.advance(STALE_MS + 1);
    }
    const depth = await queue.depth();
    expect(depth.dead).toBe(1);
    expect(depth.queued).toBe(0);
  });
});
