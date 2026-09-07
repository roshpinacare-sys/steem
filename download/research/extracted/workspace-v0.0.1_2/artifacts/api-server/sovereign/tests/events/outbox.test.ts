import "../_flush.mjs";
/**
 * tests/events/outbox.test.ts
 *
 * Tests for InMemoryOutbox (EventBus implementation).
 * Coverage: emit, dispatch, at-least-once, retry, fail-closed,
 *           tenant isolation, replay, pattern matching, observability.
 *
 * Passed: 30 / Failed: 0  (target)
 */

import { test, assert, eq } from "../_harness.mjs";
import { InMemoryOutbox } from "../../lib/events/outbox.ts";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeOutbox(maxAttempts = 3) {
  return new InMemoryOutbox({ maxAttempts });
}

const T1 = "tenant-alpha";
const T2 = "tenant-beta";

// ─── emit ────────────────────────────────────────────────────────────────────

test("emit returns a non-empty string id", () => {
  const bus = makeOutbox();
  const id = bus.emit({ tenantId: T1, type: "auth.login", payload: {}, source: "auth-svc" });
  assert(typeof id === "string" && id.length > 0, "id should be non-empty string");
});

test("emit with explicit id uses that id", () => {
  const bus = makeOutbox();
  const id = bus.emit({ id: "my-id", tenantId: T1, type: "x", payload: null, source: "s" });
  eq(id, "my-id");
});

test("emit: missing tenantId throws", () => {
  const bus = makeOutbox();
  let threw = false;
  try { bus.emit({ tenantId: "", type: "x", payload: null, source: "s" }); }
  catch { threw = true; }
  assert(threw, "should throw on empty tenantId");
});

test("emit: missing type throws", () => {
  const bus = makeOutbox();
  let threw = false;
  try { bus.emit({ tenantId: T1, type: "", payload: null, source: "s" }); }
  catch { threw = true; }
  assert(threw, "should throw on empty type");
});

test("emit: missing source throws", () => {
  const bus = makeOutbox();
  let threw = false;
  try { bus.emit({ tenantId: T1, type: "x", payload: null, source: "" }); }
  catch { threw = true; }
  assert(threw, "should throw on empty source");
});

test("emit: undefined payload throws (null is allowed)", () => {
  const bus = makeOutbox();
  let threw = false;
  try { bus.emit({ tenantId: T1, type: "x", payload: undefined as never, source: "s" }); }
  catch { threw = true; }
  assert(threw, "should throw on undefined payload");
});

test("emitted event is pending immediately", () => {
  const bus = makeOutbox();
  const id = bus.emit({ tenantId: T1, type: "x", payload: null, source: "s" });
  const entries = bus.allEntries(T1);
  eq(entries.length, 1);
  eq(entries[0].id, id);
  eq(entries[0].status, "pending");
});

// ─── dispatch: no subscribers ─────────────────────────────────────────────────

test("dispatch with no subscribers marks entry dispatched", async () => {
  const bus = makeOutbox();
  bus.emit({ tenantId: T1, type: "x", payload: null, source: "s" });
  const result = await bus.dispatch();
  eq(result.dispatched, 1);
  eq(result.failed, 0);
  eq(bus.pendingCount(), 0);
  const entries = bus.allEntries(T1);
  eq(entries[0].status, "dispatched");
});

// ─── dispatch: successful handler ────────────────────────────────────────────

test("dispatch calls matching handler and marks dispatched", async () => {
  const bus = makeOutbox();
  let called = false;
  bus.subscribe("auth.login", T1, async () => { called = true; });
  bus.emit({ tenantId: T1, type: "auth.login", payload: { userId: "u1" }, source: "auth" });
  await bus.dispatch();
  assert(called, "handler should have been called");
  eq(bus.pendingCount(), 0);
});

test("dispatch passes correct event payload to handler", async () => {
  const bus = makeOutbox();
  let received: unknown;
  bus.subscribe("order.placed", T1, async (ev) => { received = ev.payload; });
  bus.emit({ tenantId: T1, type: "order.placed", payload: { amount: 42 }, source: "order-svc" });
  await bus.dispatch();
  eq(JSON.stringify(received), JSON.stringify({ amount: 42 }));
});

test("dispatch records attempt in history", async () => {
  const bus = makeOutbox();
  bus.subscribe("x", T1, async () => {});
  const id = bus.emit({ tenantId: T1, type: "x", payload: null, source: "s" });
  await bus.dispatch();
  const entry = bus.allEntries(T1).find((e) => e.id === id)!;
  eq(entry.history.length, 1);
  assert(entry.history[0].success, "history entry should be success");
});

// ─── dispatch: failing handler / retry ───────────────────────────────────────

test("failing handler keeps entry pending for retry", async () => {
  const bus = makeOutbox(3);
  bus.subscribe("x", T1, async () => { throw new Error("boom"); });
  bus.emit({ tenantId: T1, type: "x", payload: null, source: "s" });
  await bus.dispatch();
  eq(bus.pendingCount(T1), 1, "should still be pending after 1 of 3 attempts");
});

test("entry fails permanently after maxAttempts", async () => {
  const bus = makeOutbox(2);
  bus.subscribe("x", T1, async () => { throw new Error("always fails"); });
  bus.emit({ tenantId: T1, type: "x", payload: null, source: "s" });
  await bus.dispatch(); // attempt 1 — still pending
  await bus.dispatch(); // attempt 2 — permanently failed
  eq(bus.pendingCount(T1), 0);
  eq(bus.failedEntries(T1).length, 1);
  eq(bus.failedEntries(T1)[0].status, "failed");
});

test("at-least-once: failed attempt count recorded in history", async () => {
  const bus = makeOutbox(2);
  bus.subscribe("x", T1, async () => { throw new Error("oops"); });
  const id = bus.emit({ tenantId: T1, type: "x", payload: null, source: "s" });
  await bus.dispatch();
  await bus.dispatch();
  const entry = bus.allEntries(T1).find((e) => e.id === id)!;
  eq(entry.history.length, 2);
  assert(!entry.history[0].success, "first attempt should be failure");
  assert(typeof entry.history[0].error === "string", "error message should be recorded");
});

// ─── pattern matching ─────────────────────────────────────────────────────────

test("wildcard '*' subscription receives all event types", async () => {
  const bus = makeOutbox();
  const types: string[] = [];
  bus.subscribe("*", T1, async (ev) => { types.push(ev.type); });
  bus.emit({ tenantId: T1, type: "auth.login", payload: null, source: "s" });
  bus.emit({ tenantId: T1, type: "billing.paid", payload: null, source: "s" });
  await bus.dispatch();
  assert(types.includes("auth.login") && types.includes("billing.paid"), "wildcard should match both");
});

test("prefix wildcard 'auth.*' matches auth events only", async () => {
  const bus = makeOutbox();
  const types: string[] = [];
  bus.subscribe("auth.*", T1, async (ev) => { types.push(ev.type); });
  bus.emit({ tenantId: T1, type: "auth.login", payload: null, source: "s" });
  bus.emit({ tenantId: T1, type: "auth.logout", payload: null, source: "s" });
  bus.emit({ tenantId: T1, type: "billing.paid", payload: null, source: "s" });
  await bus.dispatch();
  assert(types.includes("auth.login"), "should include auth.login");
  assert(types.includes("auth.logout"), "should include auth.logout");
  assert(!types.includes("billing.paid"), "should NOT include billing.paid");
});

test("exact type subscription matches only that type", async () => {
  const bus = makeOutbox();
  const calls: string[] = [];
  bus.subscribe("auth.login", T1, async () => { calls.push("login"); });
  bus.emit({ tenantId: T1, type: "auth.login", payload: null, source: "s" });
  bus.emit({ tenantId: T1, type: "auth.logout", payload: null, source: "s" });
  await bus.dispatch();
  eq(calls.length, 1);
  eq(calls[0], "login");
});

// ─── tenant isolation ─────────────────────────────────────────────────────────

test("handler subscribed to T1 does not receive T2 events", async () => {
  const bus = makeOutbox();
  const t1Events: string[] = [];
  bus.subscribe("*", T1, async (ev) => { t1Events.push(ev.tenantId); });
  bus.emit({ tenantId: T1, type: "x", payload: null, source: "s" });
  bus.emit({ tenantId: T2, type: "x", payload: null, source: "s" });
  await bus.dispatch();
  assert(t1Events.every((t) => t === T1), "T1 handler should only see T1 events");
  eq(t1Events.length, 1);
});

test("system-level subscription ('*' tenant) receives all tenants", async () => {
  const bus = makeOutbox();
  const tenants: string[] = [];
  bus.subscribe("*", "*", async (ev) => { tenants.push(ev.tenantId); });
  bus.emit({ tenantId: T1, type: "x", payload: null, source: "s" });
  bus.emit({ tenantId: T2, type: "x", payload: null, source: "s" });
  await bus.dispatch();
  assert(tenants.includes(T1) && tenants.includes(T2), "system handler should see both tenants");
});

test("pendingCount(tenantId) filters by tenant", () => {
  const bus = makeOutbox();
  bus.emit({ tenantId: T1, type: "x", payload: null, source: "s" });
  bus.emit({ tenantId: T1, type: "x", payload: null, source: "s" });
  bus.emit({ tenantId: T2, type: "x", payload: null, source: "s" });
  eq(bus.pendingCount(T1), 2);
  eq(bus.pendingCount(T2), 1);
  eq(bus.pendingCount(), 3);
});

test("allEntries(tenantId) isolates by tenant", () => {
  const bus = makeOutbox();
  bus.emit({ tenantId: T1, type: "x", payload: null, source: "s" });
  bus.emit({ tenantId: T2, type: "x", payload: null, source: "s" });
  eq(bus.allEntries(T1).length, 1);
  eq(bus.allEntries(T2).length, 1);
  eq(bus.allEntries().length, 2);
});

// ─── replay ──────────────────────────────────────────────────────────────────

test("replay resets failed entry to pending", async () => {
  const bus = makeOutbox(1);
  bus.subscribe("x", T1, async () => { throw new Error("fail"); });
  const id = bus.emit({ tenantId: T1, type: "x", payload: null, source: "s" });
  await bus.dispatch(); // exhausted — now failed
  eq(bus.failedEntries(T1).length, 1);
  bus.replay(T1, id);
  eq(bus.pendingCount(T1), 1, "should be pending after replay");
  eq(bus.failedEntries(T1).length, 0);
});

test("replay preserves attempt history (tamper-evident)", async () => {
  const bus = makeOutbox(1);
  bus.subscribe("x", T1, async () => { throw new Error("fail"); });
  const id = bus.emit({ tenantId: T1, type: "x", payload: null, source: "s" });
  await bus.dispatch();
  bus.replay(T1, id);
  const entry = bus.allEntries(T1).find((e) => e.id === id)!;
  eq(entry.history.length, 1, "history should still contain the failed attempt");
});

test("replay: cross-tenant isolation — throws on wrong tenant", async () => {
  const bus = makeOutbox(1);
  bus.subscribe("x", T1, async () => { throw new Error("fail"); });
  const id = bus.emit({ tenantId: T1, type: "x", payload: null, source: "s" });
  await bus.dispatch();
  let threw = false;
  try { bus.replay(T2, id); }
  catch { threw = true; }
  assert(threw, "replay with wrong tenant should throw");
});

test("replay: throws if entry not found", () => {
  const bus = makeOutbox();
  let threw = false;
  try { bus.replay(T1, "nonexistent"); }
  catch { threw = true; }
  assert(threw, "replay on nonexistent id should throw");
});

test("replay: throws if entry is not in failed status", () => {
  const bus = makeOutbox();
  const id = bus.emit({ tenantId: T1, type: "x", payload: null, source: "s" });
  let threw = false;
  try { bus.replay(T1, id); }
  catch { threw = true; }
  assert(threw, "replay on pending entry should throw");
});

// ─── unsubscribe ─────────────────────────────────────────────────────────────

test("unsubscribe removes handler — not called on next dispatch", async () => {
  const bus = makeOutbox();
  let count = 0;
  const subId = bus.subscribe("x", T1, async () => { count++; });
  bus.emit({ tenantId: T1, type: "x", payload: null, source: "s" });
  await bus.dispatch(); // count = 1
  bus.unsubscribe(subId);
  bus.emit({ tenantId: T1, type: "x", payload: null, source: "s" });
  await bus.dispatch(); // handler removed — dispatched vacuously
  eq(count, 1, "handler should only have been called once");
});

// ─── multiple handlers ────────────────────────────────────────────────────────

test("multiple handlers all called; partial failure leaves entry pending", async () => {
  const bus = makeOutbox(3);
  let aOk = false;
  bus.subscribe("x", T1, async () => { aOk = true; });
  bus.subscribe("x", T1, async () => { throw new Error("handler B fails"); });
  bus.emit({ tenantId: T1, type: "x", payload: null, source: "s" });
  await bus.dispatch();
  assert(aOk, "handler A should have been called");
  eq(bus.pendingCount(T1), 1, "entry should remain pending due to handler B failure");
});
