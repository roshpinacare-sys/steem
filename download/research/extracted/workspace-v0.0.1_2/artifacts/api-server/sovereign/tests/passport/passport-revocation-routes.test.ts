/**
 * tests/passport/passport-revocation-routes.test.ts
 *
 * HTTP route tests for passportRevocationRoutes (v382).
 * All tests use the framework-agnostic handler interface (Ctx → Res) directly —
 * no HTTP server needed, matching the pattern of transparency-log-routes tests.
 *
 * Coverage: happy path, edge cases, fail-closed invariants.
 */

import { passportRevocationRoutes } from "../../src/routes/passport-revocation-routes.ts";
import { PassportRevocationList } from "../../lib/passport/passport-revocation-list.ts";
import { buildSovereignStack } from "../../src/composition.ts";

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

// ─── Build a minimal stack with default policies ──────────────────────────────

const stack = buildSovereignStack([], "test-secret-for-routes");
const routes = passportRevocationRoutes(stack);

type Handler = (ctx: any) => Promise<{ status: number; body: any }>;

function findRoute(method: string, rawPattern: string): Handler {
  const r = routes.find((x) => x.method === method && x.pattern === rawPattern);
  if (!r) throw new Error(`Route not found: ${method} ${rawPattern}`);
  return r.handler as Handler;
}

const revokeHandler = findRoute("POST", "/api/passports/revoke");
const checkHandler = findRoute("GET", "/api/passports/:passportId/revocation");
const listHandler = findRoute("GET", "/api/passports/revocations");

function ctx(tenantId: string, body?: any, params?: Record<string, string>): any {
  return { tenantId, body: body ?? {}, params: params ?? {}, query: {}, headers: {} };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

// Happy: revoke a passport and get the entry back
await test("POST /revoke: revokes a passport, returns entry", async () => {
  const res = await revokeHandler(ctx("t1", { passportId: "pp-aaa", reason: "fraudulent_transfer" }));
  assertEqual(res.status, 200, `status should be 200, got ${res.status}`);
  assert(res.body.ok === true, "body.ok should be true");
  assert(res.body.entry !== null, "entry should not be null");
  assertEqual(res.body.entry.passportId, "pp-aaa");
  assertEqual(res.body.entry.tenantId, "t1");
  assertEqual(res.body.entry.reason, "fraudulent_transfer");
  assert(typeof res.body.entry.revokedAt === "string", "revokedAt should be a string");
});

// Happy: GET check returns revoked=true after revocation
await test("GET /revocation: returns revoked=true for a revoked passport", async () => {
  await revokeHandler(ctx("t2", { passportId: "pp-bbb", reason: "policy_violation" }));
  const res = await checkHandler(ctx("t2", {}, { passportId: "pp-bbb" }));
  assertEqual(res.status, 200);
  assert(res.body.ok === true);
  assert(res.body.revoked === true, "revoked should be true");
  assert(res.body.entry !== null, "entry should be present");
  assertEqual(res.body.entry.passportId, "pp-bbb");
});

// Happy: GET check returns revoked=false for an unknown passport
await test("GET /revocation: returns revoked=false for an unknown passport", async () => {
  const res = await checkHandler(ctx("t3", {}, { passportId: "pp-unknown" }));
  assertEqual(res.status, 200);
  assert(res.body.revoked === false, "revoked should be false");
  assert(res.body.entry === null, "entry should be null");
});

// Happy: GET list returns all revocations for tenant
await test("GET /revocations: lists all revocations for tenant", async () => {
  await revokeHandler(ctx("t4", { passportId: "pp-c1" }));
  await revokeHandler(ctx("t4", { passportId: "pp-c2", reason: "expired" }));
  const res = await listHandler(ctx("t4"));
  assertEqual(res.status, 200);
  assert(res.body.ok === true);
  assert(Array.isArray(res.body.revocations), "revocations should be array");
  assertEqual(res.body.total, 2, "total should be 2");
  assert(res.body.revocations.some((e: any) => e.passportId === "pp-c1"), "should include pp-c1");
  assert(res.body.revocations.some((e: any) => e.passportId === "pp-c2"), "should include pp-c2");
});

// Happy: GET list returns empty for tenant with no revocations
await test("GET /revocations: returns empty list for tenant with no revocations", async () => {
  const res = await listHandler(ctx("tenant-no-revocations"));
  assertEqual(res.status, 200);
  assert(res.body.ok === true);
  assertEqual(res.body.total, 0);
  assert(Array.isArray(res.body.revocations) && res.body.revocations.length === 0);
});

// Idempotency: re-revoking returns 200 with the original entry (not an error)
await test("POST /revoke: idempotent — re-revoke returns 200, original entry preserved", async () => {
  await revokeHandler(ctx("t5", { passportId: "pp-idem", reason: "original_reason" }));
  const res = await revokeHandler(ctx("t5", { passportId: "pp-idem", reason: "new_reason" }));
  assertEqual(res.status, 200);
  // Original reason must be preserved (idempotent, not overwritten)
  assertEqual(res.body.entry.reason, "original_reason", "original reason must be preserved on re-revoke");
});

// Fail-closed: missing passportId in body → 400
await test("POST /revoke: missing passportId → 400", async () => {
  const res = await revokeHandler(ctx("t6", { reason: "test" }));
  assertEqual(res.status, 400);
  assert(typeof res.body.error === "string");
});

// Fail-closed: empty passportId in body → 400
await test("POST /revoke: empty passportId → 400", async () => {
  const res = await revokeHandler(ctx("t6", { passportId: "" }));
  assertEqual(res.status, 400);
});

// Fail-closed: missing x-tenant-id on POST /revoke → 400
await test("POST /revoke: missing x-tenant-id → 400", async () => {
  const res = await revokeHandler(ctx("", { passportId: "pp-x" }));
  assertEqual(res.status, 400);
  assert(res.body.error.includes("x-tenant-id"), "error should mention x-tenant-id");
});

// Fail-closed: missing x-tenant-id on GET check → 400
await test("GET /revocation: missing x-tenant-id → 400", async () => {
  const res = await checkHandler(ctx("", {}, { passportId: "pp-x" }));
  assertEqual(res.status, 400);
  assert(res.body.error.includes("x-tenant-id"));
});

// Fail-closed: missing x-tenant-id on GET list → 400
await test("GET /revocations: missing x-tenant-id → 400", async () => {
  const res = await listHandler(ctx(""));
  assertEqual(res.status, 400);
  assert(res.body.error.includes("x-tenant-id"));
});

// Cross-tenant isolation: tenant B cannot see tenant A's revocation
await test("GET /revocation: cross-tenant — different tenant gets revoked=false", async () => {
  await revokeHandler(ctx("tenant-a-iso", { passportId: "pp-iso-1" }));
  const res = await checkHandler(ctx("tenant-b-iso", {}, { passportId: "pp-iso-1" }));
  assertEqual(res.status, 200);
  assert(res.body.revoked === false, "cross-tenant should always return false");
  assert(res.body.entry === null, "cross-tenant entry should be null");
});

// Cross-tenant isolation: GET list for tenant B does not include tenant A's revocations
await test("GET /revocations: cross-tenant — other tenant's revocations not visible", async () => {
  await revokeHandler(ctx("tenant-a-list", { passportId: "pp-list-leak" }));
  const res = await listHandler(ctx("tenant-b-list"));
  assertEqual(res.status, 200);
  assert(res.body.revocations.every((e: any) => e.tenantId !== "tenant-a-list"), "tenant B must not see tenant A's entries");
});

// revoke() with no reason uses default "revoked"
await test("POST /revoke: omitting reason defaults to 'revoked'", async () => {
  const res = await revokeHandler(ctx("t7", { passportId: "pp-no-reason" }));
  assertEqual(res.status, 200);
  assertEqual(res.body.entry.reason, "revoked");
});

// Stack integration: stack.revocationList is the same instance routes use
await test("stack.revocationList is shared with the route handlers", async () => {
  // Revoke via stack directly, then check via HTTP route
  stack.revocationList.revoke("pp-direct", "stack-direct-tenant", "direct");
  const res = await checkHandler(ctx("stack-direct-tenant", {}, { passportId: "pp-direct" }));
  assert(res.body.revoked === true, "route should see revocation made via stack.revocationList");
});

// requiresIdempotencyKey is declared on POST /revoke
await test("POST /revoke route declares requiresIdempotencyKey: true", () => {
  const route = routes.find((r) => r.method === "POST" && r.pattern === "/api/passports/revoke");
  assert(route !== undefined, "route should exist");
  assert(route!.requiresIdempotencyKey === true, "requiresIdempotencyKey must be true");
});

// ─── Report ───────────────────────────────────────────────────────────────────

console.log(results.join("\n"));
console.log(`\nResult: ${passed} pass, ${failed} fail`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) process.exit(1);
