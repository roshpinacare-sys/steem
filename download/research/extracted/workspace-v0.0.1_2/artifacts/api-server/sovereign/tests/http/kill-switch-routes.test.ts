import "../_flush.mjs";
/**
 * tests/http/kill-switch-routes.test.ts — v225.
 * Admin endpoints for KillSwitch: engage, disengage, status.
 */
import { test, assert, eq } from "../_harness.mjs";
import { startSovereignServer, type SovereignServer } from "../../src/http/sovereign-server.ts";
import { buildSovereignStack } from "../../src/composition.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";

let server: SovereignServer | null = null;
let port = 0;

async function start() {
  if (server) {
    server.close();
    await new Promise<void>((resolve) => server!.once("close", resolve));
  }
  const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  server = startSovereignServer(0, stack, { requireIdempotencyKey: false });
  server.unref();
  const addr = server.address();
  if (addr && typeof addr === "object") port = addr.port;
  else throw new Error("Server did not bind to a port");
  return stack;
}

async function req(path: string, opts: {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
} = {}) {
  const url = `http://127.0.0.1:${port}${path}`;
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: opts.headers ?? {},
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const body = await res.text();
  return { status: res.status, body: body ? JSON.parse(body) : null };
}

test("GET /api/admin/kill-switch/status without tenant → 400", async () => {
  await start();
  const r = await req("/api/admin/kill-switch/status", {
    headers: {},
  });
  eq(r.status, 400);
  assert(r.body.error.includes("x-tenant-id") || r.body.error.includes("x-api-key"), "must complain about missing tenant/auth header");
});

test("GET /api/admin/kill-switch/status with tenant → 200, armed false", async () => {
  const r = await req("/api/admin/kill-switch/status", {
    headers: { "x-tenant-id": "t1" },
  });
  eq(r.status, 200);
  eq(r.body.ok, true);
  eq(r.body.armed, false);
});

test("POST /api/admin/kill-switch/engage global → 200 + audit", async () => {
  const stack = await start();
  const r = await req("/api/admin/kill-switch/engage", {
    method: "POST",
    headers: { "x-tenant-id": "t1" },
    body: { scope: "global", reason: "incident-2026-06" },
  });
  eq(r.status, 200);
  eq(r.body.ok, true);
  eq(r.body.scope, "global");

  // Verify armed
  const status = await req("/api/admin/kill-switch/status", {
    headers: { "x-tenant-id": "t1" },
  });
  eq(status.body.armed, true);
  eq(status.body.snapshot.global, "incident-2026-06");

  // Verify audit record
  const chain = stack.auditStore.getChain("t1");
  const ksRecord = chain.find((rec) => rec.actionType === "kill-switch.engage.global");
  assert(ksRecord, "audit record for engage must exist");
  eq(ksRecord.outcome, "allowed");
  assert(ksRecord.reason.includes("incident-2026-06"));
});

test("POST /api/admin/kill-switch/disengage global → 200, armed false", async () => {
  const stack = await start();
  // First engage
  await req("/api/admin/kill-switch/engage", {
    method: "POST",
    headers: { "x-tenant-id": "t1" },
    body: { scope: "global", reason: "incident" },
  });

  const r = await req("/api/admin/kill-switch/disengage", {
    method: "POST",
    headers: { "x-tenant-id": "t1" },
    body: { scope: "global" },
  });
  eq(r.status, 200);
  eq(r.body.ok, true);

  const status = await req("/api/admin/kill-switch/status", {
    headers: { "x-tenant-id": "t1" },
  });
  eq(status.body.armed, false);

  const chain = stack.auditStore.getChain("t1");
  const disRecord = chain.find((rec) => rec.actionType === "kill-switch.disengage.global");
  assert(disRecord, "audit record for disengage must exist");
});

test("engage tenant scope without tenantId → 400", async () => {
  await start();
  const r = await req("/api/admin/kill-switch/engage", {
    method: "POST",
    headers: { "x-tenant-id": "t1" },
    body: { scope: "tenant", reason: "bad" },
  });
  eq(r.status, 400);
  eq(r.body.error, "tenantId (non-empty string) is required for tenant scope");
});

test("engage with empty reason → 400", async () => {
  await start();
  const r = await req("/api/admin/kill-switch/engage", {
    method: "POST",
    headers: { "x-tenant-id": "t1" },
    body: { scope: "global", reason: "" },
  });
  eq(r.status, 400);
  eq(r.body.error, "reason (non-empty string) is required");
});

test("kill-switch engaged blocks adapter run → denied", async () => {
  const stack = await start();
  await req("/api/admin/kill-switch/engage", {
    method: "POST",
    headers: { "x-tenant-id": "t1" },
    body: { scope: "tenant", tenantId: "t1", reason: "halt" },
  });

  const r = await req("/api/adapter/run", {
    method: "POST",
    headers: { "x-tenant-id": "t1" },
    body: {
      actorId: "agent:1",
      toolId: "file.read",
      resourceRef: "res:1",
      riskClass: "read_only",
      valueMicrounits: 0,
      nonce: "n-" + Math.random().toString(36).slice(2),
      expiry: "2099-01-01T00:00:00.000Z",
    },
  });
  eq(r.status, 201);
  eq(r.body.decision, "denied");
  assert(r.body.receipt.killSwitchVerdict?.tripped);
});

// Cleanup
test("_cleanup", async () => {
  if (server) {
    server.close();
    await new Promise<void>((resolve) => server!.once("close", resolve));
    server = null;
  }
});
