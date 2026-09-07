import "../_flush.mjs";
/**
 * tests/http/express-adapter.test.ts — Unit tests for the Express 5 adapter.
 *
 * No Express dependency required.
 * mountSovereignRoutes is tested with a *mock router* — a plain object with
 * the same verb-method surface as an Express Router. This lets the test verify
 * route registration and handler dispatch logic without installing Express.
 */

import { test, assert, eq } from "../_harness.mjs";
import { buildSovereignStack } from "../../src/composition.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import {
  mountSovereignRoutes,
  sovereignRouteCount,
  listSovereignRoutes,
} from "../../src/http/express-adapter.ts";

// ─── Mock router ─────────────────────────────────────────────────────────────

type MockRegistration = { method: string; pattern: string; handler: Function };

function createMockRouter() {
  const registrations: MockRegistration[] = [];
  const router: Record<string, Function> = {};
  for (const m of ["get", "post", "put", "delete", "patch"]) {
    router[m] = (pattern: string, handler: Function) =>
      registrations.push({ method: m.toUpperCase(), pattern, handler });
  }
  return { router, registrations };
}

// ─── Mock Express req/res ────────────────────────────────────────────────────

function createMockReqRes(opts: {
  tenantId?: string; body?: unknown; params?: Record<string, string>;
  headers?: Record<string, string>;
  method?: string;
  path?: string;
} = {}) {
  const captured: { status?: number; body?: string; headers?: Record<string, string> } = {};
  const req = {
    headers: { "x-tenant-id": opts.tenantId ?? "", ...(opts.headers ?? {}) },
    body: opts.body ?? {},
    params: opts.params ?? {},
    method: opts.method ?? "GET",
    path: opts.path ?? "/",
  };
  const res = {
    _status: 0,
    status(code: number)   { captured.status = code; return res; },
    type(_t: string)       { return res; },
    send(body: string)     { captured.body = body; return res; },
    setHeader(k: string, v: string) { captured.headers = captured.headers ?? {}; captured.headers[k] = v; return res; },
    get captured()         { return captured; },
  };
  return { req, res };
}

// ─── Shared stack (one build; tests are read-only or use isolated stacks) ────

const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });

// ─── listSovereignRoutes ─────────────────────────────────────────────────────

test("listSovereignRoutes returns an array of {method,pattern} objects", () => {
  const routes = listSovereignRoutes(stack);
  assert(Array.isArray(routes), "expected array");
  assert(routes.length > 0, "expected non-empty routes");
  for (const r of routes) {
    eq(typeof r.method, "string", "method should be string");
    assert(r.pattern.startsWith("/api/") || r.pattern.startsWith("/auth/"), `pattern should start with /api/ or /auth/, got ${r.pattern}`);
  }
});

test("listSovereignRoutes includes transparency routes", () => {
  const patterns = listSovereignRoutes(stack).map((r) => r.pattern);
  assert(patterns.includes("/api/transparency/chain"), "missing /api/transparency/chain");
  assert(patterns.includes("/api/transparency/balances"), "missing /api/transparency/balances");
  assert(patterns.includes("/api/transparency/passports"), "missing /api/transparency/passports");
});

test("listSovereignRoutes includes ledger routes", () => {
  const patterns = listSovereignRoutes(stack).map((r) => r.pattern);
  assert(patterns.includes("/api/ledger/mint"), "missing /api/ledger/mint");
  assert(patterns.includes("/api/ledger/transfer"), "missing /api/ledger/transfer");
  assert(patterns.includes("/api/ledger/withdraw"), "missing /api/ledger/withdraw");
});

test("listSovereignRoutes includes passport route", () => {
  const patterns = listSovereignRoutes(stack).map((r) => r.pattern);
  assert(patterns.includes("/api/passport/:auditId"), "missing /api/passport/:auditId");
});

// ─── sovereignRouteCount ─────────────────────────────────────────────────────

test("sovereignRouteCount matches listSovereignRoutes length", () => {
  eq(sovereignRouteCount(stack), listSovereignRoutes(stack).length);
});

test("sovereignRouteCount is greater than 10", () => {
  assert(sovereignRouteCount(stack) > 10, `expected > 10 routes, got ${sovereignRouteCount(stack)}`);
});

// ─── mountSovereignRoutes — registration ─────────────────────────────────────

test("mountSovereignRoutes registers one handler per sovereign route", () => {
  const { router, registrations } = createMockRouter();
  mountSovereignRoutes(router as any, stack, { requireIdempotencyKey: false });
  eq(registrations.length, sovereignRouteCount(stack), "registration count mismatch");
});

test("mountSovereignRoutes uses lowercase HTTP methods", () => {
  const { router, registrations } = createMockRouter();
  mountSovereignRoutes(router as any, stack, { requireIdempotencyKey: false });
  const valid = new Set(["GET","POST","PUT","DELETE","PATCH"]);
  for (const reg of registrations) {
    assert(valid.has(reg.method), `unexpected method: ${reg.method}`);
  }
});

test("mountSovereignRoutes: all registered patterns start with /api/ or /auth/", () => {
  const { router, registrations } = createMockRouter();
  mountSovereignRoutes(router as any, stack, { requireIdempotencyKey: false });
  for (const reg of registrations) {
    assert(reg.pattern.startsWith("/api/") || reg.pattern.startsWith("/auth/"), `bad pattern: ${reg.pattern}`);
  }
});

// ─── Tenant isolation guard ───────────────────────────────────────────────────

test("handler returns 400 when x-tenant-id is missing", async () => {
  const { router, registrations } = createMockRouter();
  mountSovereignRoutes(router as any, stack, { requireIdempotencyKey: false });
  const reg = registrations.find((r) => r.pattern === "/api/transparency/chain");
  assert(!!reg, "chain route not found");
  const { req, res } = createMockReqRes({ tenantId: "" });
  await reg!.handler(req, res, () => {});
  eq(res.captured.status, 400, `expected 400 for missing tenant, got ${res.captured.status}`);
  const body = JSON.parse(res.captured.body!);
  assert(body.error.includes("x-tenant-id"), "error message should mention x-tenant-id");
});

// ─── Successful handler dispatch ─────────────────────────────────────────────

test("GET /api/transparency/chain returns 200 with chainIntact field", async () => {
  const { router, registrations } = createMockRouter();
  mountSovereignRoutes(router as any, stack, { requireIdempotencyKey: false });
  const reg = registrations.find((r) => r.pattern === "/api/transparency/chain")!;
  const { req, res } = createMockReqRes({ tenantId: "express-t1" });
  await reg.handler(req, res, () => {});
  eq(res.captured.status, 200);
  const body = JSON.parse(res.captured.body!);
  assert("chainIntact" in body, "missing chainIntact");
  assert(Array.isArray(body.records), "records should be array");
});

test("GET /api/transparency/balances returns 200 with solvencyOk field", async () => {
  const { router, registrations } = createMockRouter();
  mountSovereignRoutes(router as any, stack, { requireIdempotencyKey: false });
  const reg = registrations.find((r) => r.pattern === "/api/transparency/balances")!;
  const { req, res } = createMockReqRes({ tenantId: "express-t1" });
  await reg.handler(req, res, () => {});
  eq(res.captured.status, 200);
  const body = JSON.parse(res.captured.body!);
  assert("solvency" in body, "missing solvency field");
  assert("isSolvent" in body.solvency, "missing solvency.isSolvent");
  assert(Array.isArray(body.accounts), "accounts should be array");
});

test("GET /api/transparency/passports returns 200 with passports array", async () => {
  const { router, registrations } = createMockRouter();
  mountSovereignRoutes(router as any, stack, { requireIdempotencyKey: false });
  const reg = registrations.find((r) => r.pattern === "/api/transparency/passports")!;
  const { req, res } = createMockReqRes({ tenantId: "express-t1" });
  await reg.handler(req, res, () => {});
  eq(res.captured.status, 200);
  const body = JSON.parse(res.captured.body!);
  assert(Array.isArray(body.passports), "passports should be array");
});

test("POST /api/ledger/accounts returns 400 when required fields missing", async () => {
  const localStack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const { router, registrations } = createMockRouter();
  mountSovereignRoutes(router as any, localStack, { requireIdempotencyKey: false });
  const reg = registrations.find((r) => r.pattern === "/api/ledger/accounts")!;
  const { req, res } = createMockReqRes({ tenantId: "t1", body: { ownerId: "u1" } });
  await reg.handler(req, res, () => {});
  eq(res.captured.status, 400);
});

test("POST /api/ledger/accounts returns 201 with valid body", async () => {
  const localStack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const { router, registrations } = createMockRouter();
  mountSovereignRoutes(router as any, localStack, { requireIdempotencyKey: false });
  const reg = registrations.find((r) => r.pattern === "/api/ledger/accounts")!;
  const { req, res } = createMockReqRes({
    tenantId: "t1",
    body: { ownerId: "owner1", type: "asset", name: "Express Test Account" },
  });
  await reg.handler(req, res, () => {});
  eq(res.captured.status, 201);
  const body = JSON.parse(res.captured.body!);
  assert(!!body.account, "account should be defined");
});

// ─── BigInt serialisation ─────────────────────────────────────────────────────

test("BigInt amounts are serialised as decimal strings (no JSON.stringify error)", async () => {
  const localStack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const { router, registrations } = createMockRouter();
  mountSovereignRoutes(router as any, localStack, { requireIdempotencyKey: false });

  // Create account
  const createReg = registrations.find((r) => r.pattern === "/api/ledger/accounts")!;
  const { req: r1, res: rs1 } = createMockReqRes({
    tenantId: "bigint-t",
    body: { ownerId: "u1", type: "asset", name: "BigInt Account" },
  });
  await createReg.handler(r1, rs1, () => {});
  const { account } = JSON.parse(rs1.captured.body!);

  // Mint — this produces a BigInt amount internally
  const mintReg = registrations.find((r) => r.pattern === "/api/ledger/mint")!;
  const { req: r2, res: rs2 } = createMockReqRes({
    tenantId: "bigint-t",
    body: { toAccountId: account.id, amount: "5000000", memo: "seed", initiatedBy: "test" },
  });
  await mintReg.handler(r2, rs2, () => {});
  eq(rs2.captured.status, 200, `expected 200, got ${rs2.captured.status}: ${rs2.captured.body}`);
  // Must parse cleanly — BigInt was serialised as string
  const mintBody = JSON.parse(rs2.captured.body!);
  eq(mintBody.ok, true);
});

// ─── New endpoints (v93: OpenAPI full + sync) ─────────────────────────────────

test("listSovereignRoutes includes track-record, tenants, api-keys, and dispute routes", () => {
  const patterns = listSovereignRoutes(stack).map((r) => r.pattern);
  assert(patterns.includes("/api/track-record/:identityId"), "missing /api/track-record/:identityId");
  assert(patterns.includes("/api/tenants"), "missing /api/tenants");
  assert(patterns.includes("/api/auth/api-keys"), "missing /api/auth/api-keys");
  assert(patterns.includes("/api/auth/api-keys/:keyId"), "missing /api/auth/api-keys/:keyId");
  assert(patterns.includes("/api/escrow/:id/dispute"), "missing /api/escrow/:id/dispute");
  assert(patterns.includes("/api/escrow/:id/undispute"), "missing /api/escrow/:id/undispute");
});

test("GET /api/track-record/:identityId returns 400 when identityId is empty", async () => {
  const localStack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const { router, registrations } = createMockRouter();
  mountSovereignRoutes(router as any, localStack, { requireIdempotencyKey: false });
  const reg = registrations.find((r) => r.pattern === "/api/track-record/:identityId")!;
  const { req, res } = createMockReqRes({ tenantId: "tr-t1", params: { identityId: "" } });
  await reg.handler(req, res, () => {});
  eq(res.captured.status, 400);
  const body = JSON.parse(res.captured.body!);
  assert(body.error.includes("identityId"), "error should mention identityId");
});

test("GET /api/track-record/:identityId returns 200 for a known identity", async () => {
  const localStack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const { router, registrations } = createMockRouter();
  mountSovereignRoutes(router as any, localStack, { requireIdempotencyKey: false });
  // Seed identity
  const idReg = registrations.find((r) => r.pattern === "/api/ledger/accounts")!;
  const { req: r1, res: rs1 } = createMockReqRes({
    tenantId: "tr-t2",
    body: { ownerId: "human-root:tr-t2", type: "asset", name: "Seed Account" },
  });
  await idReg.handler(r1, rs1, () => {});

  const reg = registrations.find((r) => r.pattern === "/api/track-record/:identityId")!;
  const { req, res } = createMockReqRes({ tenantId: "tr-t2", params: { identityId: "human-root:tr-t2" } });
  await reg.handler(req, res, () => {});
  eq(res.captured.status, 200, `expected 200, got ${res.captured.status}: ${res.captured.body}`);
  const body = JSON.parse(res.captured.body!);
  eq(body.ok, true);
  assert(body.data && typeof body.data.score === "number", "track record should have a score");
});

test("POST /api/tenants returns 200/201 and creates root person + account", async () => {
  const localStack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const { router, registrations } = createMockRouter();
  mountSovereignRoutes(router as any, localStack, { requireIdempotencyKey: false });
  const reg = registrations.find((r) => r.pattern === "/api/tenants")!;
  const { req, res } = createMockReqRes({
    tenantId: "tenant-t1",
    body: { rootPersonName: "Root", accountType: "asset", accountName: "Main" },
  });
  await reg.handler(req, res, () => {});
  const status = res.captured.status;
  assert(status === 200 || status === 201, `expected 200 or 201, got ${status}`);
  const body = JSON.parse(res.captured.body!);
  eq(body.ok, true);
  eq(body.tenantId, "tenant-t1");
  assert(body.rootPerson, "rootPerson should be defined");
  assert(body.account, "account should be defined");
});

test("POST /api/tenants returns 400 when accountType is invalid", async () => {
  const localStack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const { router, registrations } = createMockRouter();
  mountSovereignRoutes(router as any, localStack, { requireIdempotencyKey: false });
  const reg = registrations.find((r) => r.pattern === "/api/tenants")!;
  const { req, res } = createMockReqRes({
    tenantId: "tenant-t2",
    body: { accountType: "invalid" },
  });
  await reg.handler(req, res, () => {});
  eq(res.captured.status, 400);
  const body = JSON.parse(res.captured.body!);
  assert(body.error.includes("invalid"), "error should mention invalid");
});

test("POST /api/escrow/:id/dispute returns 404 for non-existent escrow", async () => {
  const localStack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const { router, registrations } = createMockRouter();
  mountSovereignRoutes(router as any, localStack, { requireIdempotencyKey: false });
  const reg = registrations.find((r) => r.pattern === "/api/escrow/:id/dispute")!;
  const { req, res } = createMockReqRes({
    tenantId: "escrow-t1",
    params: { id: "no-such-escrow" },
    body: { initiatedBy: "tester" },
  });
  await reg.handler(req, res, () => {});
  eq(res.captured.status, 404);
  const body = JSON.parse(res.captured.body!);
  assert(body.error.includes("not found") || body.error.includes(" escrow"), `error should mention not found, got: ${body.error}`);
});

test("POST /api/escrow/:id/undispute returns 404 for non-existent escrow", async () => {
  const localStack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const { router, registrations } = createMockRouter();
  mountSovereignRoutes(router as any, localStack, { requireIdempotencyKey: false });
  const reg = registrations.find((r) => r.pattern === "/api/escrow/:id/undispute")!;
  const { req, res } = createMockReqRes({
    tenantId: "escrow-t2",
    params: { id: "no-such-escrow" },
    body: { initiatedBy: "tester" },
  });
  await reg.handler(req, res, () => {});
  eq(res.captured.status, 404);
  const body = JSON.parse(res.captured.body!);
  assert(body.error.includes("not found") || body.error.includes(" escrow"), `error should mention not found, got: ${body.error}`);
});

test("POST /auth/api-keys returns 201 and shows secret once", async () => {
  const localStack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const { router, registrations } = createMockRouter();
  mountSovereignRoutes(router as any, localStack, { requireIdempotencyKey: false });
  const reg = registrations.find((r) => r.pattern === "/api/auth/api-keys" && r.method === "POST")!;
  const { req, res } = createMockReqRes({
    tenantId: "apikey-t1",
    body: { name: "test-key" },
  });
  await reg.handler(req, res, () => {});
  eq(res.captured.status, 201);
  const body = JSON.parse(res.captured.body!);
  eq(body.ok, true);
  assert(body.key && body.key.keyId, "key should have keyId");
  assert(body.secret && typeof body.secret === "string", "secret should be a string");
});

test("DELETE /auth/api-keys/:keyId returns 404 for unknown key", async () => {
  const localStack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const { router, registrations } = createMockRouter();
  mountSovereignRoutes(router as any, localStack, { requireIdempotencyKey: false });
  const reg = registrations.find((r) => r.pattern === "/api/auth/api-keys/:keyId")!;
  const { req, res } = createMockReqRes({
    tenantId: "apikey-t2",
    params: { keyId: "no-such-key" },
  });
  await reg.handler(req, res, () => {});
  eq(res.captured.status, 404);
  const body = JSON.parse(res.captured.body!);
  assert(body.error.includes("not found"), "error should mention not found");
});

// ─── Request-ID middleware ───────────────────────────────────────────────────

test("handler sets x-request-id header on response", async () => {
  const { router, registrations } = createMockRouter();
  mountSovereignRoutes(router as any, stack, { requireIdempotencyKey: false });
  const reg = registrations.find((r) => r.pattern === "/api/transparency/chain")!;
  const { req, res } = createMockReqRes({ tenantId: "reqid-t1" });
  await reg.handler(req, res, () => {});
  assert(res.captured.headers && res.captured.headers["x-request-id"], "x-request-id header should be present");
  assert(/^[0-9a-f]{16}$/.test(res.captured.headers!["x-request-id"]), "x-request-id should be 16-char hex");
});

test("handler propagates existing x-request-id header", async () => {
  const { router, registrations } = createMockRouter();
  mountSovereignRoutes(router as any, stack, { requireIdempotencyKey: false });
  const reg = registrations.find((r) => r.pattern === "/api/transparency/chain")!;
  const { req, res } = createMockReqRes({ tenantId: "reqid-t2", headers: { "x-request-id": "abc-123" } });
  await reg.handler(req, res, () => {});
  eq(res.captured.headers?.["x-request-id"], "abc-123");
});

// ─── Rate-limit middleware ─────────────────────────────────────────────────────

test("handler sets x-ratelimit headers on a normal request", async () => {
  const { router, registrations } = createMockRouter();
  mountSovereignRoutes(router as any, stack, { requireIdempotencyKey: false });
  const reg = registrations.find((r) => r.pattern === "/api/transparency/chain")!;
  const { req, res } = createMockReqRes({ tenantId: "rl-t1" });
  await reg.handler(req, res, () => {});
  const h = res.captured.headers ?? {};
  assert("x-ratelimit-limit" in h, "missing x-ratelimit-limit");
  assert("x-ratelimit-remaining" in h, "missing x-ratelimit-remaining");
  assert("x-ratelimit-reset" in h, "missing x-ratelimit-reset");
});

test("handler returns 429 when rate limit is exceeded", async () => {
  const localStack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const { router, registrations } = createMockRouter();
  // Tight limit so we can trigger it quickly
  mountSovereignRoutes(router as any, localStack, { requireIdempotencyKey: false, rateLimit: { windowMs: 60_000, maxRequests: 1 } });
  const reg = registrations.find((r) => r.pattern === "/api/transparency/chain")!;
  // First request consumes the single token
  const { req: r1, res: rs1 } = createMockReqRes({ tenantId: "rl-block" });
  await reg.handler(r1, rs1, () => {});
  eq(rs1.captured.status, 200);
  // Second request from same tenant should be blocked
  const { req: r2, res: rs2 } = createMockReqRes({ tenantId: "rl-block" });
  await reg.handler(r2, rs2, () => {});
  eq(rs2.captured.status, 429);
  const body = JSON.parse(rs2.captured.body!);
  assert(body.error.includes("rate limit"), "error should mention rate limit");
  assert(rs2.captured.headers && rs2.captured.headers["x-ratelimit-remaining"] === "0", "remaining should be 0");
});

// ─── Structured logging ────────────────────────────────────────────────────────

test("logger sink receives one entry per request", async () => {
  const localStack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const { router, registrations } = createMockRouter();
  const logs: any[] = [];
  mountSovereignRoutes(router as any, localStack, { requireIdempotencyKey: false, logSink: (e) => logs.push(e) });
  const reg = registrations.find((r) => r.pattern === "/api/transparency/chain")!;
  const { req, res } = createMockReqRes({ tenantId: "log-t1" });
  await reg.handler(req, res, () => {});
  eq(logs.length, 1);
  eq(logs[0].method, "GET");
  eq(logs[0].tenantId, "log-t1");
  assert(typeof logs[0].durationMs === "number" && logs[0].durationMs >= 0, "durationMs should be a non-negative number");
  assert(/^[0-9a-f]{16}$/.test(logs[0].reqId), "reqId should be present");
});

test("logger captures 4xx responses at info level", async () => {
  const localStack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const { router, registrations } = createMockRouter();
  const logs: any[] = [];
  mountSovereignRoutes(router as any, localStack, { requireIdempotencyKey: false, logSink: (e) => logs.push(e) });
  const reg = registrations.find((r) => r.pattern === "/api/ledger/mint")!;
  const { req, res } = createMockReqRes({ tenantId: "log-err", body: {} });
  await reg.handler(req, res, () => {});
  const entry = logs.find((l) => l.tenantId === "log-err");
  assert(!!entry, "should have a log entry for the request");
  eq(entry.level, "info", "4xx responses are logged at info level");
  assert(entry.status >= 400, "status should be 4xx");
});

test("logger receives entry for tenant resolution failure", async () => {
  const localStack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const { router, registrations } = createMockRouter();
  const logs: any[] = [];
  mountSovereignRoutes(router as any, localStack, { requireIdempotencyKey: false, logSink: (e) => logs.push(e) });
  const reg = registrations.find((r) => r.pattern === "/api/transparency/chain")!;
  const { req, res } = createMockReqRes({ tenantId: "" }); // missing tenant
  await reg.handler(req, res, () => {});
  eq(logs.length, 1);
  eq(logs[0].status, 400);
  assert(!logs[0].tenantId, "tenantId should be absent when resolution fails");
  assert(/^[0-9a-f]{16}$/.test(logs[0].reqId), "reqId should still be present");
});

// ─── Idempotency middleware (v227) ───────────────────────────────────────────

test("POST with idempotency key executes once, second call replayed", async () => {
  const localStack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const { router, registrations } = createMockRouter();
  mountSovereignRoutes(router as any, localStack, { requireIdempotencyKey: false });

  const reg = registrations.find((r) => r.pattern === "/api/ledger/accounts")!;
  const headers = { "idempotency-key": "idem-post-1" };

  const { req: r1, res: rs1 } = createMockReqRes({ tenantId: "idem-ex-1", body: { ownerId: "u1", type: "asset", name: "Idem Account" }, headers, method: "POST", path: "/api/ledger/accounts" });
  await reg.handler(r1, rs1, () => {});
  eq(rs1.captured.status, 201, `first call should 201, got ${rs1.captured.body}`);

  const { req: r2, res: rs2 } = createMockReqRes({ tenantId: "idem-ex-1", body: { ownerId: "u1", type: "asset", name: "Idem Account" }, headers, method: "POST", path: "/api/ledger/accounts" });
  await reg.handler(r2, rs2, () => {});
  eq(rs2.captured.status, 201);
  eq(rs2.captured.headers?.["idempotency-replayed"], "true", "second call should be replayed");
});

test("DELETE with idempotency key executes once, second call replayed", async () => {
  const localStack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const { router, registrations } = createMockRouter();
  mountSovereignRoutes(router as any, localStack, { requireIdempotencyKey: false });

  // Create a key first
  const createReg = registrations.find((r) => r.pattern === "/api/auth/api-keys" && r.method === "POST")!;
  const { req: cr, res: crs } = createMockReqRes({ tenantId: "idem-del-1", body: { name: "test" }, method: "POST", path: "/api/auth/api-keys" });
  await createReg.handler(cr, crs, () => {});
  eq(crs.captured.status, 201);
  const keyId = JSON.parse(crs.captured.body!).key.keyId;

  // Delete with idempotency key
  const delReg = registrations.find((r) => r.pattern === "/api/auth/api-keys/:keyId")!;
  const headers = { "idempotency-key": "idem-del-1" };
  const { req: r1, res: rs1 } = createMockReqRes({ tenantId: "idem-del-1", params: { keyId }, headers, method: "DELETE", path: `/api/auth/api-keys/${keyId}` });
  await delReg.handler(r1, rs1, () => {});
  eq(rs1.captured.status, 204, `first delete should 204, got ${rs1.captured.body}`);

  const { req: r2, res: rs2 } = createMockReqRes({ tenantId: "idem-del-1", params: { keyId }, headers, method: "DELETE", path: `/api/auth/api-keys/${keyId}` });
  await delReg.handler(r2, rs2, () => {});
  eq(rs2.captured.status, 204);
  eq(rs2.captured.headers?.["idempotency-replayed"], "true", "second DELETE should be replayed");
});

test("idempotency key reused on different endpoint → 422", async () => {
  const localStack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const { router, registrations } = createMockRouter();
  mountSovereignRoutes(router as any, localStack, { requireIdempotencyKey: false });

  // POST to accounts with a key
  const accReg = registrations.find((r) => r.pattern === "/api/ledger/accounts")!;
  const headers = { "idempotency-key": "idem-reuse-ex" };
  const { req: r1, res: rs1 } = createMockReqRes({ tenantId: "idem-reuse-1", body: { ownerId: "u1", type: "asset", name: "A" }, headers, method: "POST", path: "/api/ledger/accounts" });
  await accReg.handler(r1, rs1, () => {});
  eq(rs1.captured.status, 201);

  // Reuse same key on a different POST endpoint
  const mintReg = registrations.find((r) => r.pattern === "/api/ledger/mint")!;
  const { req: r2, res: rs2 } = createMockReqRes({ tenantId: "idem-reuse-1", body: { toAccountId: "any", amount: "1", memo: "m", initiatedBy: "u" }, headers, method: "POST", path: "/api/ledger/mint" });
  await mintReg.handler(r2, rs2, () => {});
  eq(rs2.captured.status, 422, "key reuse on different endpoint should 422");
});

test("GET ignores idempotency key (no replay protection needed)", async () => {
  const localStack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const { router, registrations } = createMockRouter();
  mountSovereignRoutes(router as any, localStack, { requireIdempotencyKey: false });

  const reg = registrations.find((r) => r.pattern === "/api/transparency/chain")!;
  const headers = { "idempotency-key": "idem-get-1" };
  const { req: r1, res: rs1 } = createMockReqRes({ tenantId: "idem-get-1", headers, method: "GET", path: "/api/transparency/chain" });
  await reg.handler(r1, rs1, () => {});
  eq(rs1.captured.status, 200);
  assert(!rs1.captured.headers?.["idempotency-replayed"], "GET should never set idempotency-replayed");
});

// ─── Expanded route coverage (gap #5 sub-step 2: express-adapter matches sovereign-server) ───

test("listSovereignRoutes includes execution routes", () => {
  const patterns = listSovereignRoutes(stack).map((r) => r.pattern);
  assert(patterns.includes("/api/execution"), "missing /api/execution");
  assert(patterns.includes("/api/execution/:id/receipt"), "missing /api/execution/:id/receipt");
});

test("listSovereignRoutes includes settlement routes", () => {
  const patterns = listSovereignRoutes(stack).map((r) => r.pattern);
  assert(patterns.includes("/api/settlement"), "missing /api/settlement");
  assert(patterns.includes("/api/settlement/:id"), "missing /api/settlement/:id");
});

test("listSovereignRoutes includes eval routes", () => {
  const patterns = listSovereignRoutes(stack).map((r) => r.pattern);
  assert(patterns.includes("/api/eval/run"), "missing /api/eval/run");
});

test("listSovereignRoutes includes indexer routes", () => {
  const patterns = listSovereignRoutes(stack).map((r) => r.pattern);
  assert(patterns.includes("/api/index/executions"), "missing /api/index/executions");
});

test("listSovereignRoutes includes sovereignty routes", () => {
  const patterns = listSovereignRoutes(stack).map((r) => r.pattern);
  assert(patterns.includes("/api/sovereignty/export"), "missing /api/sovereignty/export");
});

test("listSovereignRoutes includes confidence routes", () => {
  const patterns = listSovereignRoutes(stack).map((r) => r.pattern);
  assert(patterns.includes("/api/confidence/evaluate"), "missing /api/confidence/evaluate");
});

test("listSovereignRoutes includes kill-switch routes", () => {
  const patterns = listSovereignRoutes(stack).map((r) => r.pattern);
  assert(patterns.includes("/api/admin/kill-switch/status"), "missing /api/admin/kill-switch/status");
});

test("listSovereignRoutes includes introduction routes", () => {
  const patterns = listSovereignRoutes(stack).map((r) => r.pattern);
  assert(patterns.includes("/api/introduction/request"), "missing /api/introduction/request");
});

test("mountSovereignRoutes registers all expanded route families", () => {
  const { router, registrations } = createMockRouter();
  mountSovereignRoutes(router as any, stack, { requireIdempotencyKey: false });
  const patterns = registrations.map((r) => r.pattern);
  assert(patterns.includes("/api/execution"), "missing execution route in registrations");
  assert(patterns.includes("/api/settlement"), "missing settlement route in registrations");
  assert(patterns.includes("/api/eval/run"), "missing eval route in registrations");
  assert(patterns.includes("/api/index/executions"), "missing indexer route in registrations");
  assert(patterns.includes("/api/sovereignty/export"), "missing sovereignty route in registrations");
  assert(patterns.includes("/api/confidence/evaluate"), "missing confidence route in registrations");
  assert(patterns.includes("/api/admin/kill-switch/status"), "missing kill-switch route in registrations");
  assert(patterns.includes("/api/introduction/request"), "missing introduction route in registrations");
});
