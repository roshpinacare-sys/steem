/**
 * tests/transparency-log/witness-routes.test.ts
 *
 * HTTP route tests for witnessRoutes (v388) — exposes the v387 witness
 * core over HTTP. Uses the framework-agnostic handler interface (Ctx → Res)
 * directly — no HTTP server needed, matching the pattern of
 * passport-revocation-routes.test.ts / transparency-log-routes tests.
 *
 * Coverage: happy path, edge cases, fail-closed invariants.
 */

import { witnessRoutes } from "../../src/routes/witness-routes.ts";
import { buildSovereignStack } from "../../src/composition.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { signTreeHead, type TreeHeadObservation } from "../../lib/transparency-log/witness.ts";
import { createHash } from "node:crypto";

// ─── Harness helpers ─────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const results: string[] = [];

function test(label: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { passed++; results.push(`  ✓ ${label}`); })
    .catch((e: unknown) => {
      failed++;
      results.push(`  ✗ ${label}\n    ${e instanceof Error ? e.message : String(e)}`);
    });
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
function assertEqual<T>(a: T, b: T, msg?: string): void {
  if (a !== b) throw new Error(msg ?? `Expected ${JSON.stringify(a)} === ${JSON.stringify(b)}`);
}

// ─── Build a stack + routes ────────────────────────────────────────────────────

const stack = buildSovereignStack([], "test-secret-for-witness-routes");
const routes = witnessRoutes(stack);

type Handler = (ctx: any) => Promise<{ status: number; body: any }>;

function findRoute(method: string, rawPattern: string): Handler {
  const r = routes.find((x) => x.method === method && x.pattern === rawPattern);
  if (!r) throw new Error(`Route not found: ${method} ${rawPattern}`);
  return r.handler as Handler;
}

const submitHandler = findRoute("POST", "/api/transparency-log/witness");
const quorumHandler = findRoute("GET", "/api/transparency-log/witness/quorum");
const statementsHandler = findRoute("GET", "/api/transparency-log/witness/statements");

function ctx(tenantId: string, body?: any, query?: Record<string, string>): any {
  return { tenantId, body: body ?? {}, params: {}, query: query ?? {}, headers: {} };
}

const root = (s: string): string => createHash("sha256").update(s).digest("hex");
const R8 = root("routes-tree-at-8");
const R8_FORK = root("routes-tree-at-8-fork");

const wA = new HmacSigner("route-witness-A-secret-32chars-min!");
const wB = new HmacSigner("route-witness-B-secret-32chars-min!");
const wEvil = new HmacSigner("route-evil-impersonator-32-chars-x!");

function obs(witnessId: string, r = R8, treeSize = 8, logId = "route-log"): TreeHeadObservation {
  return { logId, root: r, treeSize, observedAt: "2026-06-20T00:00:00.000Z", witnessId };
}

// Provision witnesses for the "rt1" tenant used across the happy/edge tests.
stack.witnessRegistry.registerWitness("rt1", "wA", wA);
stack.witnessRegistry.registerWitness("rt1", "wB", wB);

// ─── HAPPY ───────────────────────────────────────────────────────────────────

await test("POST /witness: a registered witness's statement is accepted and stored", async () => {
  const st = signTreeHead(wA, obs("wA"));
  const res = await submitHandler(ctx("rt1", st));
  assertEqual(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert(res.body.ok === true, "body.ok should be true");
  assertEqual(res.body.statement.witnessId, "wA");
});

await test("GET /witness/quorum: reaches with 2 distinct registered witnesses", async () => {
  await submitHandler(ctx("rt1", signTreeHead(wA, obs("wA"))));
  await submitHandler(ctx("rt1", signTreeHead(wB, obs("wB"))));
  const res = await quorumHandler(
    ctx("rt1", undefined, { logId: "route-log", root: R8, treeSize: "8", threshold: "2" }),
  );
  assertEqual(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert(res.body.result.reached === true, "quorum of 2 should be reached");
  assertEqual(res.body.result.distinctWitnesses, 2);
});

await test("GET /witness/statements: lists submitted statements for the tenant", async () => {
  const res = await statementsHandler(ctx("rt1"));
  assertEqual(res.status, 200);
  assert(res.body.total >= 2, "should include at least the 2 statements submitted above");
  assert(Array.isArray(res.body.statements), "statements should be an array");
});

// ─── EDGE ────────────────────────────────────────────────────────────────────

await test("EDGE: GET /witness/statements filters by logId and treeSize", async () => {
  stack.witnessRegistry.registerWitness("rt-edge", "wA", wA);
  await submitHandler(ctx("rt-edge", signTreeHead(wA, obs("wA", R8, 8, "log-x"))));
  await submitHandler(ctx("rt-edge", signTreeHead(wA, obs("wA", root("other"), 9, "log-y"))));
  const filtered = await statementsHandler(ctx("rt-edge", undefined, { logId: "log-x" }));
  assertEqual(filtered.body.total, 1, "should only return the log-x statement");
  assertEqual(filtered.body.statements[0].logId, "log-x");
});

await test("EDGE: duplicate-witness POST does not break quorum counting (still counts once)", async () => {
  stack.witnessRegistry.registerWitness("rt-dup", "wA", wA);
  const st = signTreeHead(wA, obs("wA", R8, 8, "log-dup"));
  await submitHandler(ctx("rt-dup", st));
  await submitHandler(ctx("rt-dup", st)); // re-submit identical statement
  const res = await quorumHandler(
    ctx("rt-dup", undefined, { logId: "log-dup", root: R8, treeSize: "8", threshold: "1" }),
  );
  assertEqual(res.body.result.distinctWitnesses, 1, "same witnessId twice should still count as 1 distinct witness");
});

await test("EDGE: threshold boundary — quorum not reached one short", async () => {
  stack.witnessRegistry.registerWitness("rt-boundary", "wA", wA);
  await submitHandler(ctx("rt-boundary", signTreeHead(wA, obs("wA", R8, 8, "log-boundary"))));
  const res = await quorumHandler(
    ctx("rt-boundary", undefined, { logId: "log-boundary", root: R8, treeSize: "8", threshold: "2" }),
  );
  assertEqual(res.body.result.reached, false, "1 witness should not satisfy threshold 2");
});

// ─── FAIL-CLOSED ─────────────────────────────────────────────────────────────

await test("FAIL-CLOSED: POST /witness without x-tenant-id → 400", async () => {
  const res = await submitHandler(ctx("", signTreeHead(wA, obs("wA"))));
  assertEqual(res.status, 400);
});

await test("FAIL-CLOSED: POST /witness with malformed body → 400", async () => {
  const res = await submitHandler(ctx("rt1", { logId: "x" })); // missing required fields
  assertEqual(res.status, 400);
});

await test("FAIL-CLOSED: POST /witness from an unregistered witness → 403, not stored", async () => {
  const forged = signTreeHead(wEvil, obs("wEvil"));
  const res = await submitHandler(ctx("rt1", forged));
  assertEqual(res.status, 403, `expected 403, got ${res.status}`);
  const after = await statementsHandler(ctx("rt1"));
  assert(
    !after.body.statements.some((s: any) => s.witnessId === "wEvil"),
    "unregistered witness statement must not appear in the store",
  );
});

await test("FAIL-CLOSED: POST /witness impersonation (wrong key, claimed registered id) → 403", async () => {
  const impersonated = signTreeHead(wEvil, obs("wA")); // wEvil signs, claims to be wA
  const res = await submitHandler(ctx("rt1", impersonated));
  assertEqual(res.status, 403, `expected 403, got ${res.status}`);
});

await test("FAIL-CLOSED: GET /witness/quorum without x-tenant-id → 400", async () => {
  const res = await quorumHandler(ctx("", undefined, { logId: "x", root: R8, treeSize: "8", threshold: "1" }));
  assertEqual(res.status, 400);
});

await test("FAIL-CLOSED: GET /witness/quorum with missing/invalid query params → 400", async () => {
  const r1 = await quorumHandler(ctx("rt1", undefined, { root: R8, treeSize: "8", threshold: "1" })); // no logId
  const r2 = await quorumHandler(ctx("rt1", undefined, { logId: "x", root: "not-hex", treeSize: "8", threshold: "1" }));
  const r3 = await quorumHandler(ctx("rt1", undefined, { logId: "x", root: R8, treeSize: "abc", threshold: "1" }));
  const r4 = await quorumHandler(ctx("rt1", undefined, { logId: "x", root: R8, treeSize: "8", threshold: "0" }));
  assertEqual(r1.status, 400, "missing logId should 400");
  assertEqual(r2.status, 400, "invalid root should 400");
  assertEqual(r3.status, 400, "non-integer treeSize should 400");
  assertEqual(r4.status, 400, "threshold below 1 should 400");
});

await test("FAIL-CLOSED: GET /witness/quorum surfaces SplitViewError as 409, not a silent 200", async () => {
  stack.witnessRegistry.registerWitness("rt-split", "wA", wA);
  stack.witnessRegistry.registerWitness("rt-split", "wB", wB);
  await submitHandler(ctx("rt-split", signTreeHead(wA, obs("wA", R8, 8, "log-split"))));
  await submitHandler(ctx("rt-split", signTreeHead(wB, obs("wB", R8_FORK, 8, "log-split"))));
  const res = await quorumHandler(
    ctx("rt-split", undefined, { logId: "log-split", root: R8, treeSize: "8", threshold: "1" }),
  );
  assertEqual(res.status, 409, `expected 409 split-view alarm, got ${res.status}`);
  assertEqual(res.body.code, "SPLIT_VIEW");
  assert(Array.isArray(res.body.roots) && res.body.roots.length >= 2, "roots should list the conflicting roots");
});

await test("FAIL-CLOSED: cross-tenant isolation — tenant B cannot see/use tenant A's witnesses or statements", async () => {
  // rt1 has wA/wB registered; "rt-other" does not.
  const st = signTreeHead(wA, obs("wA", R8, 8, "log-cross"));
  const res = await submitHandler(ctx("rt-other", st)); // wA not registered for rt-other
  assertEqual(res.status, 403, "wA is not registered for rt-other, must be rejected");

  await submitHandler(ctx("rt1", signTreeHead(wA, obs("wA", R8, 8, "log-cross"))));
  const otherTenantList = await statementsHandler(ctx("rt-other", undefined, { logId: "log-cross" }));
  assertEqual(otherTenantList.body.total, 0, "rt-other must not see rt1's statements");
});

await test("POST /witness route declares requiresIdempotencyKey: true", () => {
  const route = routes.find((r) => r.method === "POST" && r.pattern === "/api/transparency-log/witness");
  assert(route !== undefined, "route should exist");
  assert(route!.requiresIdempotencyKey === true, "requiresIdempotencyKey must be true");
});

// ─── Report ───────────────────────────────────────────────────────────────────

console.log(results.join("\n"));
console.log(`\nResult: ${passed} pass, ${failed} fail`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) process.exit(1);
