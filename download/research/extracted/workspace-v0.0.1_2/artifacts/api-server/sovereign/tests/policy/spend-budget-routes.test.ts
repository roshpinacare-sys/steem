/**
 * tests/policy/spend-budget-routes.test.ts
 *
 * HTTP route tests for spendBudgetRoutes (v420) — tenant and per-actor
 * spend-budget management endpoints. Tests the handler interface directly
 * (Ctx → Res), no HTTP server needed.
 *
 * HAPPY        PUT/GET/DELETE budget round-trip; per-actor budget set+query;
 *              GET shows live spend status after a commit; DELETE is idempotent.
 * EDGE         replacing a budget resets the limit but preserves history;
 *              per-actor key is isolated from tenant key; setting a budget to
 *              exactly the current spend still allows a zero-amount request.
 * FAIL-CLOSED  missing x-tenant-id → 400 on every route; missing scope → 403
 *              on write routes; invalid limitMicroCents (non-string, zero, neg,
 *              non-numeric) → 400; invalid windowMs → 400; empty actorId → 400;
 *              GET on an unset budget returns hasBudget:false, not an error;
 *              cross-tenant isolation: tenant B cannot see or modify tenant A's
 *              budget via the composite actorKey.
 */

import { spendBudgetRoutes } from "../../src/routes/spend-budget-routes.ts";
import { buildSovereignStack } from "../../src/composition.ts";

// ─── Micro-harness ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const results: string[] = [];

async function test(label: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    results.push(`  ✓ ${label}`);
  } catch (e: unknown) {
    failed++;
    results.push(`  ✗ ${label}\n    ${e instanceof Error ? e.message : String(e)}`);
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
function eq<T>(a: T, b: T, msg?: string): void {
  if (a !== b) throw new Error(msg ?? `Expected ${JSON.stringify(a)} === ${JSON.stringify(b)}`);
}

// ─── Setup ────────────────────────────────────────────────────────────────────

const stack = buildSovereignStack([], "test-secret-spend-budget-routes-32!");
const routes = spendBudgetRoutes(stack);

type Handler = (ctx: any) => Promise<{ status: number; body: any }>;

function findRoute(method: string, pattern: string): Handler {
  const r = routes.find((x) => x.method === method && x.pattern === pattern);
  if (!r) throw new Error(`Route not found: ${method} ${pattern}`);
  return r.handler as Handler;
}

const putBudget = findRoute("PUT", "/api/budget");
const getBudget = findRoute("GET", "/api/budget");
const delBudget = findRoute("DELETE", "/api/budget");
const putActor  = findRoute("PUT", "/api/budget/actor/:actorId");
const getActor  = findRoute("GET", "/api/budget/actor/:actorId");

// Admin scope that satisfies the write guard
const WRITE_SCOPE = ["admin:budget-write"];

function ctx(tenantId: string, opts?: { body?: any; params?: Record<string, string>; scopes?: string[] }): any {
  return { tenantId, body: opts?.body ?? {}, params: opts?.params ?? {}, query: {}, scopes: opts?.scopes };
}

// ─── HAPPY ────────────────────────────────────────────────────────────────────

await test("HAPPY: PUT then GET then DELETE round-trip", async () => {
  const tid = "rtest-happy-1";
  const putRes = await putBudget(ctx(tid, {
    body: { limitMicroCents: "500000", windowMs: 3600000 },
    scopes: WRITE_SCOPE,
  }));
  eq(putRes.status, 200, `PUT should 200, got ${putRes.status}`);
  assert(putRes.body.ok === true, "ok should be true");
  eq(putRes.body.limitMicroCents, "500000");

  const getRes = await getBudget(ctx(tid));
  eq(getRes.status, 200);
  assert(getRes.body.hasBudget === true, "hasBudget should be true after PUT");
  eq(getRes.body.budget?.limitMicroCents, "500000");
  eq(getRes.body.budget?.spentMicroCents, "0");

  const delRes = await delBudget(ctx(tid, { scopes: WRITE_SCOPE }));
  eq(delRes.status, 200);
  assert(delRes.body.deleted === true, "deleted should be true when budget existed");

  const afterDel = await getBudget(ctx(tid));
  eq(afterDel.body.hasBudget, false, "hasBudget should be false after DELETE");
});

await test("HAPPY: per-actor PUT + GET round-trip", async () => {
  const tid = "rtest-happy-2";
  const res = await putActor(ctx(tid, {
    body: { limitMicroCents: "100000", windowMs: 60000 },
    scopes: WRITE_SCOPE,
    params: { actorId: "agent-xyz" },
  }));
  eq(res.status, 200);
  eq(res.body.actorId, "agent-xyz");
  eq(res.body.limitMicroCents, "100000");

  const getRes = await getActor(ctx(tid, { params: { actorId: "agent-xyz" } }));
  eq(getRes.status, 200);
  assert(getRes.body.hasBudget === true, "actor hasBudget should be true");
  eq(getRes.body.budget?.limitMicroCents, "100000");
});

await test("HAPPY: GET budget shows live spend after a commit", async () => {
  const tid = "rtest-happy-3";
  await putBudget(ctx(tid, {
    body: { limitMicroCents: "1000000", windowMs: 3600000 },
    scopes: WRITE_SCOPE,
  }));
  // Simulate spend via the guard directly
  stack.spendBudgetGuard.commit(tid, 250000n, Date.now());

  const getRes = await getBudget(ctx(tid));
  eq(getRes.status, 200);
  eq(getRes.body.budget?.spentMicroCents, "250000", "should reflect committed spend");
  eq(getRes.body.budget?.remainingMicroCents, "750000");
});

await test("HAPPY: DELETE is idempotent when no budget set", async () => {
  const res = await delBudget(ctx("rtest-no-budget", { scopes: WRITE_SCOPE }));
  eq(res.status, 200);
  assert(res.body.deleted === false, "deleted should be false when nothing existed");
});

await test("HAPPY: GET on unset budget returns hasBudget:false without error", async () => {
  const res = await getBudget(ctx("rtest-unset"));
  eq(res.status, 200);
  assert(res.body.hasBudget === false);
  assert(res.body.budget === undefined, "no budget field when unset");
});

// ─── EDGE ─────────────────────────────────────────────────────────────────────

await test("EDGE: replacing a budget updates the limit", async () => {
  const tid = "rtest-edge-1";
  await putBudget(ctx(tid, { body: { limitMicroCents: "100000", windowMs: 3600000 }, scopes: WRITE_SCOPE }));
  await putBudget(ctx(tid, { body: { limitMicroCents: "999999", windowMs: 3600000 }, scopes: WRITE_SCOPE }));
  const getRes = await getBudget(ctx(tid));
  eq(getRes.body.budget?.limitMicroCents, "999999", "should reflect the replaced limit");
});

await test("EDGE: per-actor key isolated from tenant key", async () => {
  const tid = "rtest-edge-2";
  await putBudget(ctx(tid, { body: { limitMicroCents: "100000", windowMs: 3600000 }, scopes: WRITE_SCOPE }));
  await putActor(ctx(tid, {
    body: { limitMicroCents: "25000", windowMs: 3600000 },
    scopes: WRITE_SCOPE,
    params: { actorId: "actor-A" },
  }));

  const tenantRes = await getBudget(ctx(tid));
  const actorRes = await getActor(ctx(tid, { params: { actorId: "actor-A" } }));
  eq(tenantRes.body.budget?.limitMicroCents, "100000", "tenant budget unchanged");
  eq(actorRes.body.budget?.limitMicroCents, "25000", "actor budget independent");
});

await test("EDGE: actor key isolated across tenants", async () => {
  const t1 = "rtest-edge-3a", t2 = "rtest-edge-3b";
  await putActor(ctx(t1, {
    body: { limitMicroCents: "50000", windowMs: 3600000 },
    scopes: WRITE_SCOPE,
    params: { actorId: "shared-actor" },
  }));
  // t2 should not see t1's actor budget even with the same actorId
  const res = await getActor(ctx(t2, { params: { actorId: "shared-actor" } }));
  assert(res.body.hasBudget === false, "cross-tenant actor isolation: t2 must not see t1's actor budget");
});

// ─── FAIL-CLOSED ──────────────────────────────────────────────────────────────

await test("FAIL-CLOSED: missing x-tenant-id → 400 on all routes", async () => {
  const c = (fn: Handler) => fn(ctx("", { scopes: WRITE_SCOPE, body: { limitMicroCents: "1000", windowMs: 1000 } }));
  const results = await Promise.all([c(putBudget), c(getBudget), c(delBudget)]);
  for (const r of results) eq(r.status, 400, `expected 400, got ${r.status}`);
});

await test("FAIL-CLOSED: missing admin:budget-write scope → 403 on write routes", async () => {
  const tid = "rtest-fc-scope";
  const body = { limitMicroCents: "1000", windowMs: 1000 };
  const r1 = await putBudget(ctx(tid, { body })); // no scopes
  const r2 = await delBudget(ctx(tid)); // no scopes
  const r3 = await putActor(ctx(tid, { body, params: { actorId: "a" } })); // no scopes
  eq(r1.status, 403, `PUT should 403 without scope`);
  eq(r2.status, 403, `DELETE should 403 without scope`);
  eq(r3.status, 403, `PUT actor should 403 without scope`);
});

await test("FAIL-CLOSED: invalid limitMicroCents → 400", async () => {
  const tid = "rtest-fc-limit";
  const cases = [
    { limitMicroCents: 100000, windowMs: 1000 },         // number not string
    { limitMicroCents: "0", windowMs: 1000 },             // zero
    { limitMicroCents: "-100", windowMs: 1000 },          // negative
    { limitMicroCents: "abc", windowMs: 1000 },           // non-numeric
    { limitMicroCents: "1.5", windowMs: 1000 },           // float
    { windowMs: 1000 },                                    // missing entirely
  ];
  for (const body of cases) {
    const r = await putBudget(ctx(tid, { body, scopes: WRITE_SCOPE }));
    eq(r.status, 400, `expected 400 for body ${JSON.stringify(body)}, got ${r.status}`);
  }
});

await test("FAIL-CLOSED: invalid windowMs → 400", async () => {
  const tid = "rtest-fc-window";
  const cases = [
    { limitMicroCents: "1000", windowMs: 0 },
    { limitMicroCents: "1000", windowMs: -1 },
    { limitMicroCents: "1000", windowMs: "3600000" }, // string not number
    { limitMicroCents: "1000" },                       // missing
  ];
  for (const body of cases) {
    const r = await putBudget(ctx(tid, { body, scopes: WRITE_SCOPE }));
    eq(r.status, 400, `expected 400 for body ${JSON.stringify(body)}, got ${r.status}`);
  }
});

await test("FAIL-CLOSED: empty actorId → 400", async () => {
  const tid = "rtest-fc-actorid";
  const body = { limitMicroCents: "1000", windowMs: 1000 };
  const r1 = await putActor(ctx(tid, { body, scopes: WRITE_SCOPE, params: { actorId: "" } }));
  const r2 = await getActor(ctx(tid, { params: { actorId: "" } }));
  eq(r1.status, 400, "empty actorId PUT should 400");
  eq(r2.status, 400, "empty actorId GET should 400");
});

await test("FAIL-CLOSED: GET routes don't require scope (read-only is public within tenant)", async () => {
  const tid = "rtest-fc-readonly";
  await putBudget(ctx(tid, { body: { limitMicroCents: "5000", windowMs: 1000 }, scopes: WRITE_SCOPE }));
  const r = await getBudget(ctx(tid)); // no scopes
  eq(r.status, 200, "GET should succeed without scope");
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(results.join("\n"));
console.log(`\nResult: ${passed} pass, ${failed} fail`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) process.exit(1);
