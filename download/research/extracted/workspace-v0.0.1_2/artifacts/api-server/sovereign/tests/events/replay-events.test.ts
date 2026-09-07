import "../_flush.mjs";
/**
 * tests/events/replay-events.test.ts
 *
 * Covers InMemoryOutbox.replayEvents — state reconstruction from the outbox.
 * Includes the canonical scenario: break in-memory state, rebuild from events.
 *
 * Target: Passed: 8 / Failed: 0
 */

import { test, assert, eq } from "../_harness.mjs";
import { InMemoryOutbox } from "../../lib/events/outbox.ts";

const T1 = "tenant-alpha";
const T2 = "tenant-beta";

/** Tiny projection: counts events per type. */
function makeCounter() {
  const counts = new Map<string, number>();
  const handler = async (ev: { type: string }) => {
    counts.set(ev.type, (counts.get(ev.type) ?? 0) + 1);
  };
  return { counts, handler };
}

// ── happy path: dispatch → break state → replay rebuilds it ───────────────────

test("replayEvents rebuilds projection state from dispatched events", async () => {
  const bus = new InMemoryOutbox();
  const proj = makeCounter();
  bus.subscribe("*", T1, proj.handler);

  bus.emit({ tenantId: T1, type: "auth.login", payload: null, source: "s" });
  bus.emit({ tenantId: T1, type: "auth.login", payload: null, source: "s" });
  bus.emit({ tenantId: T1, type: "billing.paid", payload: null, source: "s" });
  await bus.dispatch();
  eq(proj.counts.get("auth.login"), 2, "live dispatch counted logins");
  eq(proj.counts.get("billing.paid"), 1);

  // Simulate state loss (process restart, cache wipe).
  proj.counts.clear();
  eq(proj.counts.size, 0);

  const replayed = await bus.replayEvents(T1);
  eq(replayed, 3, "all 3 dispatched events replayed");
  eq(proj.counts.get("auth.login"), 2, "rebuilt logins");
  eq(proj.counts.get("billing.paid"), 1, "rebuilt billing");
});

// ── edge case: pattern filter limits replay ───────────────────────────────────

test("replayEvents respects typePattern filter", async () => {
  const bus = new InMemoryOutbox();
  const proj = makeCounter();
  bus.subscribe("*", T1, proj.handler);
  bus.emit({ tenantId: T1, type: "auth.login", payload: null, source: "s" });
  bus.emit({ tenantId: T1, type: "billing.paid", payload: null, source: "s" });
  await bus.dispatch();
  proj.counts.clear();

  const n = await bus.replayEvents(T1, { typePattern: "auth.*" });
  eq(n, 1, "only auth.* events replayed");
  eq(proj.counts.get("auth.login"), 1);
  eq(proj.counts.get("billing.paid"), undefined);
});

// ── edge case: sinceId cursor (resume replay) ─────────────────────────────────

test("replayEvents resumes after sinceId", async () => {
  const bus = new InMemoryOutbox();
  const proj = makeCounter();
  bus.subscribe("*", T1, proj.handler);
  const a = bus.emit({ tenantId: T1, type: "x", payload: null, source: "s" });
  await new Promise((r) => setTimeout(r, 2));
  bus.emit({ tenantId: T1, type: "y", payload: null, source: "s" });
  await new Promise((r) => setTimeout(r, 2));
  bus.emit({ tenantId: T1, type: "z", payload: null, source: "s" });
  await bus.dispatch();
  proj.counts.clear();

  const n = await bus.replayEvents(T1, { sinceId: a });
  eq(n, 2, "events after a replayed");
  eq(proj.counts.get("x"), undefined);
  eq(proj.counts.get("y"), 1);
  eq(proj.counts.get("z"), 1);
});

// ── tenant isolation ──────────────────────────────────────────────────────────

test("replayEvents only replays events for the requested tenant", async () => {
  const bus = new InMemoryOutbox();
  const p1 = makeCounter();
  const p2 = makeCounter();
  bus.subscribe("*", T1, p1.handler);
  bus.subscribe("*", T2, p2.handler);
  bus.emit({ tenantId: T1, type: "e", payload: null, source: "s" });
  bus.emit({ tenantId: T2, type: "e", payload: null, source: "s" });
  bus.emit({ tenantId: T2, type: "e", payload: null, source: "s" });
  await bus.dispatch();
  p1.counts.clear();
  p2.counts.clear();

  const n = await bus.replayEvents(T2);
  eq(n, 2, "only T2 events replayed");
  eq(p1.counts.get("e"), undefined, "T1 projection untouched");
  eq(p2.counts.get("e"), 2);
});

// ── replay does NOT mutate outbox state ───────────────────────────────────────

test("replayEvents leaves outbox status/history unchanged", async () => {
  const bus = new InMemoryOutbox();
  const proj = makeCounter();
  bus.subscribe("*", T1, proj.handler);
  const id = bus.emit({ tenantId: T1, type: "e", payload: null, source: "s" });
  await bus.dispatch();
  const before = JSON.parse(JSON.stringify(bus.allEntries(T1)));
  eq(before[0].status, "dispatched");
  const attemptsBefore = before[0].attempts;
  const histLen = before[0].history.length;

  await bus.replayEvents(T1);
  await bus.replayEvents(T1);

  const after = bus.allEntries(T1);
  eq(after[0].id, id);
  eq(after[0].status, "dispatched", "status unchanged");
  eq(after[0].attempts, attemptsBefore, "attempts unchanged");
  eq(after[0].history.length, histLen, "history unchanged");
});

// ── failure case: handler throws → replay aborts fail-closed ──────────────────

test("replayEvents aborts on first handler error (fail-closed)", async () => {
  const bus = new InMemoryOutbox();
  // First subscribe a benign handler so initial dispatch succeeds for all events.
  const benignSubId = bus.subscribe("*", T1, async () => {});
  bus.emit({ tenantId: T1, type: "a", payload: null, source: "s" });
  bus.emit({ tenantId: T1, type: "boom", payload: null, source: "s" });
  bus.emit({ tenantId: T1, type: "c", payload: null, source: "s" });
  await bus.dispatch();

  // Swap in a handler that throws on "boom" — simulates a buggy projection
  // discovered during state reconstruction.
  bus.unsubscribe(benignSubId);
  const seen: string[] = [];
  bus.subscribe("*", T1, async (ev: any) => {
    seen.push(ev.type);
    if (ev.type === "boom") throw new Error("kaboom");
  });

  let err: Error | null = null;
  try {
    await bus.replayEvents(T1);
  } catch (e) {
    err = e as Error;
  }
  assert(err !== null, "replay should throw");
  assert(/kaboom/.test(err!.message), "error propagates");
  // Stops after the failing event — 'c' never seen during replay.
  eq(seen.length, 2, "only events up to and including failure handled");
  eq(seen[0], "a");
  eq(seen[1], "boom");
});

// ── failure case: missing tenantId / wildcard rejected ────────────────────────

test("replayEvents rejects empty or wildcard tenantId", async () => {
  const bus = new InMemoryOutbox();
  let t1 = false, t2 = false;
  try { await bus.replayEvents(""); } catch { t1 = true; }
  try { await bus.replayEvents("*"); } catch { t2 = true; }
  assert(t1 && t2, "both rejected");
});

// ── pending entries are NOT replayed ──────────────────────────────────────────

test("replayEvents ignores pending (undispatched) entries", async () => {
  const bus = new InMemoryOutbox();
  const proj = makeCounter();
  bus.subscribe("*", T1, proj.handler);
  bus.emit({ tenantId: T1, type: "e", payload: null, source: "s" });
  // NOT calling dispatch — entry stays pending.
  proj.counts.clear();
  const n = await bus.replayEvents(T1);
  eq(n, 0, "no dispatched events to replay");
  eq(proj.counts.size, 0);
});
