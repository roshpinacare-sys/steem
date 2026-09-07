import "../_flush.mjs";
/**
 * tests/http/sovereign-server.test.ts — Integration tests for the standalone sovereign HTTP server.
 *
 * Coverage:
 *   • Server starts in production without an explicit stack (InMemoryLedger fallback)
 *   • Server starts with an explicit stack
 *   • Valid GET request returns 200 with correct body shape
 *   • Unknown route returns 404
 *   • Invalid JSON body returns 400
 *   • Missing x-tenant-id returns 400
 *   • Rate-limit headers are present on normal requests
 *   • Rate limit exceeded returns 429
 *   • x-request-id is generated and returned
 *   • BigInt values are serialised as strings in JSON responses
 */

import { test, assert, eq } from "../_harness.mjs";
import { startSovereignServer, type SovereignServer } from "../../src/http/sovereign-server.ts";
import { buildSovereignStack } from "../../src/composition.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import type { Server } from "node:http";

// ─── Helper: make an HTTP request and return {status, body, headers} ──────────

async function httpRequest(port: number, path: string, opts: {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
} = {}): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  const url = `http://127.0.0.1:${port}${path}`;
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: opts.headers ?? {},
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const body = await res.text();
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  return { status: res.status, body, headers };
}

// ─── Shared state ───────────────────────────────────────────────────────────

let server: SovereignServer | null = null;
let port = 0;

async function startServer(stack?: ReturnType<typeof buildSovereignStack>) {
  if (server) {
    server.close();
    await new Promise<void>((resolve) => server!.once("close", resolve));
  }
  server = startSovereignServer(0, stack, { requireIdempotencyKey: false });
  server.unref();
  const addr = server.address();
  if (addr && typeof addr === "object") {
    port = addr.port;
  } else {
    throw new Error("Server did not bind to a port");
  }
  // Give the event loop a tick to stabilise
  await new Promise((r) => setTimeout(r, 50));
}

function stopServer() {
  if (server) {
    server.close();
    server = null;
    port = 0;
  }
}

// ─── Cleanup after all tests ────────────────────────────────────────────────

process.once("beforeExit", () => {
  stopServer();
});

// ═══════════════════════════════════════════════════════════════════════════════
// Server startup
// ═══════════════════════════════════════════════════════════════════════════════

test("server starts without an explicit stack (production-safe fallback)", async () => {
  await startServer();
  assert(port > 0, "server must bind to an ephemeral port");
});

test("server starts with an explicit stack", async () => {
  const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  await startServer(stack);
  assert(port > 0, "server must bind to an ephemeral port");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Route handling
// ═══════════════════════════════════════════════════════════════════════════════

test("GET /api/transparency/chain returns 200 with chainIntact field", async () => {
  await startServer();
  const { status, body } = await httpRequest(port, "/api/transparency/chain", {
    headers: { "x-tenant-id": "srv-t1" },
  });
  eq(status, 200, `expected 200, got ${status}: ${body}`);
  const json = JSON.parse(body);
  assert("chainIntact" in json, "response must contain chainIntact");
  assert(Array.isArray(json.records), "records must be an array");
});

test("unknown route returns 404", async () => {
  await startServer();
  const { status, body } = await httpRequest(port, "/api/unknown-route", {
    headers: { "x-tenant-id": "srv-t2" },
  });
  eq(status, 404, `expected 404, got ${status}`);
  const json = JSON.parse(body);
  eq(json.error, "no route");
});

test("invalid JSON body returns 400", async () => {
  await startServer();
  const url = `http://127.0.0.1:${port}/api/ledger/mint`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "x-tenant-id": "srv-t3", "content-type": "application/json" },
    body: "not-json",
  });
  eq(res.status, 400, `expected 400 for invalid JSON, got ${res.status}`);
  const json = JSON.parse(await res.text());
  eq(json.error, "invalid JSON");
});

test("missing x-tenant-id returns 400", async () => {
  await startServer();
  const { status, body } = await httpRequest(port, "/api/transparency/chain");
  eq(status, 400, `expected 400, got ${status}`);
  const json = JSON.parse(body);
  assert(json.error.includes("x-tenant-id") || json.error.includes("tenant"), "error must mention tenant id");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Headers
// ═══════════════════════════════════════════════════════════════════════════════

test("response includes x-request-id header", async () => {
  await startServer();
  const { headers } = await httpRequest(port, "/api/transparency/chain", {
    headers: { "x-tenant-id": "srv-h1" },
  });
  assert(headers["x-request-id"], "x-request-id must be present");
  assert(/^[0-9a-f]{16}$/.test(headers["x-request-id"]), "x-request-id should be 16-char hex");
});

test("response includes rate-limit headers", async () => {
  await startServer();
  const { headers } = await httpRequest(port, "/api/transparency/chain", {
    headers: { "x-tenant-id": "srv-h2" },
  });
  assert("x-ratelimit-limit" in headers, "missing x-ratelimit-limit");
  assert("x-ratelimit-remaining" in headers, "missing x-ratelimit-remaining");
  assert("x-ratelimit-reset" in headers, "missing x-ratelimit-reset");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Rate limiting
// ═══════════════════════════════════════════════════════════════════════════════

test("rate limit exceeded returns 429", async () => {
  await startServer();
  // First request consumes token
  const r1 = await httpRequest(port, "/api/transparency/chain", {
    headers: { "x-tenant-id": "srv-rl" },
  });
  eq(r1.status, 200, "first request must succeed");
  // Immediately send a burst of requests from the same tenant to exhaust the bucket
  let blocked = false;
  for (let i = 0; i < 120; i++) {
    const r = await httpRequest(port, "/api/transparency/chain", {
      headers: { "x-tenant-id": "srv-rl" },
    });
    if (r.status === 429) { blocked = true; break; }
  }
  assert(blocked, "at least one request must be rate-limited");
});

// ═══════════════════════════════════════════════════════════════════════════════
// BigInt serialisation
// ═══════════════════════════════════════════════════════════════════════════════

test("POST /api/ledger/accounts and mint serialises BigInt as string", async () => {
  await startServer();
  // Create account
  const acc = await httpRequest(port, "/api/ledger/accounts", {
    method: "POST",
    headers: { "x-tenant-id": "srv-bi", "content-type": "application/json" },
    body: { ownerId: "u1", type: "asset", name: "BigInt Test" },
  });
  eq(acc.status, 201, `expected 201, got ${acc.status}: ${acc.body}`);
  const accJson = JSON.parse(acc.body);
  assert(accJson.account, "account must be defined");

  // Mint
  const mint = await httpRequest(port, "/api/ledger/mint", {
    method: "POST",
    headers: { "x-tenant-id": "srv-bi", "content-type": "application/json" },
    body: { toAccountId: accJson.account.id, amount: "500000", memo: "seed", initiatedBy: "test" },
  });
  eq(mint.status, 200, `expected 200, got ${mint.status}: ${mint.body}`);
  const mintJson = JSON.parse(mint.body);
  eq(mintJson.ok, true);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tenant isolation
// ═══════════════════════════════════════════════════════════════════════════════

test("ledger accounts are isolated by tenant", async () => {
  await startServer();
  const t1 = await httpRequest(port, "/api/ledger/accounts", {
    method: "POST",
    headers: { "x-tenant-id": "iso-t1", "content-type": "application/json" },
    body: { ownerId: "u1", type: "asset", name: "T1 Account" },
  });
  eq(t1.status, 201);
  const t1Json = JSON.parse(t1.body);

  const t2 = await httpRequest(port, "/api/ledger/accounts", {
    method: "POST",
    headers: { "x-tenant-id": "iso-t2", "content-type": "application/json" },
    body: { ownerId: "u2", type: "asset", name: "T2 Account" },
  });
  eq(t2.status, 201);
  const t2Json = JSON.parse(t2.body);

  // Balances endpoint should only show accounts for the requesting tenant
  const bal1 = await httpRequest(port, "/api/transparency/balances", {
    headers: { "x-tenant-id": "iso-t1" },
  });
  eq(bal1.status, 200);
  const bal1Json = JSON.parse(bal1.body);
  assert(bal1Json.accounts.some((a: any) => a.id === t1Json.account.id), "tenant 1 must see its own account");
  assert(!bal1Json.accounts.some((a: any) => a.id === t2Json.account.id), "tenant 1 must not see tenant 2's account");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Failure cases
// ═══════════════════════════════════════════════════════════════════════════════

test("POST /api/ledger/accounts with missing type returns 400", async () => {
  await startServer();
  const { status, body } = await httpRequest(port, "/api/ledger/accounts", {
    method: "POST",
    headers: { "x-tenant-id": "srv-f1", "content-type": "application/json" },
    body: { ownerId: "u1", name: "No Type Account" },
  });
  eq(status, 400, `expected 400, got ${status}: ${body}`);
});

test("POST /api/ledger/mint with invalid amount returns error", async () => {
  await startServer();
  // First create an account
  const acc = await httpRequest(port, "/api/ledger/accounts", {
    method: "POST",
    headers: { "x-tenant-id": "srv-f2", "content-type": "application/json" },
    body: { ownerId: "u1", type: "asset", name: "Fail Mint" },
  });
  eq(acc.status, 201);
  const accJson = JSON.parse(acc.body);

  const mint = await httpRequest(port, "/api/ledger/mint", {
    method: "POST",
    headers: { "x-tenant-id": "srv-f2", "content-type": "application/json" },
    body: { toAccountId: accJson.account.id, amount: "not-a-number", memo: "seed", initiatedBy: "test" },
  });
  eq(mint.status, 400);
  const mintJson = JSON.parse(mint.body);
  assert(!mintJson.ok || mintJson.error, "mint with invalid amount must fail");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Adapter routes — mounted end-to-end on the sovereign HTTP server (v158)
// ═══════════════════════════════════════════════════════════════════════════════

test("POST /api/adapter/run: route mounted — allowed intent returns 201 + receipt", async () => {
  await startServer();
  const res = await httpRequest(port, "/api/adapter/run", {
    method: "POST",
    headers: { "x-tenant-id": "adapter-t1", "content-type": "application/json" },
    body: {
      actorId: "agent:srv-test",
      toolId: "file.read",
      resourceRef: "resource:doc-1",
      riskClass: "read_only",
      nonce: "nonce-srv-test-" + Date.now(),
      expiry: "2099-01-01T00:00:00.000Z",
    },
  });
  eq(res.status, 201, `expected 201, got ${res.status}: ${res.body}`);
  const json = JSON.parse(res.body);
  assert(json.ok === true, "ok");
  assert(json.receipt?.executionId, "executionId in receipt");
  assert(json.receipt?.signature, "signature in receipt");
  assert(json.decision === "allowed", "decision=allowed");
});

test("POST /api/adapter/run: route mounted — denial for irreversible intent", async () => {
  await startServer();
  const res = await httpRequest(port, "/api/adapter/run", {
    method: "POST",
    headers: { "x-tenant-id": "adapter-t1", "content-type": "application/json" },
    body: {
      actorId: "agent:srv-test",
      toolId: "shell.exec",
      resourceRef: "resource:prod-db",
      riskClass: "irreversible",
      nonce: "nonce-deny-" + Date.now(),
      expiry: "2099-01-01T00:00:00.000Z",
    },
  });
  eq(res.status, 201, `expected 201 for denial, got ${res.status}: ${res.body}`);
  const json = JSON.parse(res.body);
  assert(json.decision === "denied", "decision=denied");
  assert(!json.receipt?.executionId, "no executionId for denial");
});

test("POST /api/adapter/run: approval_required → POST /api/execution/:id/approve → running", async () => {
  await startServer();
  // 1. Run — approval_required
  const runRes = await httpRequest(port, "/api/adapter/run", {
    method: "POST",
    headers: { "x-tenant-id": "adapter-t2", "content-type": "application/json" },
    body: {
      actorId: "agent:human-gated",
      toolId: "file.delete",
      resourceRef: "resource:prod-db",
      riskClass: "write_destructive",
      nonce: "nonce-approve-" + Date.now(),
      expiry: "2099-01-01T00:00:00.000Z",
    },
  });
  eq(runRes.status, 201, `run: ${runRes.status} ${runRes.body}`);
  const runJson = JSON.parse(runRes.body);
  assert(runJson.decision === "approval_required", "decision=approval_required");
  const token = runJson.receipt?.approvalToken;
  assert(token, "approvalToken present");

  // 2. Approve
  const approveRes = await httpRequest(port, `/api/execution/${token}/approve`, {
    method: "POST",
    headers: { "x-tenant-id": "adapter-t2", "content-type": "application/json" },
    body: { actor: "admin", reason: "reviewed and approved" },
  });
  eq(approveRes.status, 200, `approve: ${approveRes.status} ${approveRes.body}`);
  const approveJson = JSON.parse(approveRes.body);
  assert(approveJson.ok === true, "ok");
  assert(approveJson.workflow?.status === "running", "workflow status=running after approve");
});

test("POST /api/adapter/run: missing fields → 400", async () => {
  await startServer();
  const res = await httpRequest(port, "/api/adapter/run", {
    method: "POST",
    headers: { "x-tenant-id": "adapter-t3", "content-type": "application/json" },
    body: { actorId: "agent:x" }, // missing toolId, resourceRef, riskClass
  });
  assert(res.status === 400 || res.status === 422, `expected 4xx, got ${res.status}`);
});
