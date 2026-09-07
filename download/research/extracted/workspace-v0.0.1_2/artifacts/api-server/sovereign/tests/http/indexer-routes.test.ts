import "../_flush.mjs";
/**
 * tests/http/indexer-routes.test.ts — HTTP integration tests for the Indexer API (Indexer #5).
 *
 * Coverage:
 *   GET /api/index/executions                        — empty list, list after project
 *   GET /api/index/executions?status=planned         — filter by status
 *   GET /api/index/executions?from=...&to=...        — date-range filter
 *   GET /api/index/executions?from=future&to=past    — invalid range → 400
 *   GET /api/index/executions/by-action/:actionId    — found, not found (404)
 *   GET /api/index/executions/:id                    — found, not found (404)
 *   GET /api/index/actors                            — empty, after project
 *   GET /api/index/actors/:actorId/summary           — found, not found (404)
 *   GET /api/index/escrows                           — empty list
 *   GET /api/index/escrows/:id                       — not found (404)
 *   GET /api/index/passports                         — empty list
 *   GET /api/index/passports/:id                     — not found (404)
 *   GET /api/index/approvals                         — empty list
 *   GET /api/index/approvals/:id                     — not found (404)
 *   GET /api/index/disputes                          — empty list
 *   GET /api/index/disputes/:id                      — not found (404)
 *   Missing x-tenant-id                             — 400 fail-closed
 *   Cross-tenant                                     — 404 (not 403)
 */

import { test, assert, eq } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { buildSovereignStack } from "../../src/composition.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import type { Server } from "node:http";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _counter = 0;
function uniqueTenant(): string {
  return `indexer-tenant-${++_counter}`;
}

const UNLIMITED = { windowMs: 60_000, maxRequests: 10_000 };

function makeServer(): { server: Server; port: number; stack: ReturnType<typeof buildSovereignStack> } {
  const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const server = startSovereignServer(0, stack, { requireIdempotencyKey: false, rateLimit: UNLIMITED });
  server.unref();
  const addr = server.address();
  if (!addr || typeof addr !== "object") throw new Error("Server did not bind");
  return { server, port: addr.port, stack };
}

async function httpGet(
  port: number,
  path: string,
  tenantId?: string,
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (tenantId !== undefined) headers["x-tenant-id"] = tenantId;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: "GET", headers });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

// ─── Executions ───────────────────────────────────────────────────────────────

test("indexer: GET /api/index/executions returns empty list initially", async () => {
  const { server, port } = makeServer();
  try {
    const tenant = uniqueTenant();
    const { status, body } = await httpGet(port, "/api/index/executions", tenant);
    eq(status, 200);
    assert(Array.isArray(body.executions), "body.executions should be array");
    eq(body.executions.length, 0);
  } finally { server.close(); }
});

test("indexer: GET /api/index/executions returns projected execution", async () => {
  const { server, port, stack } = makeServer();
  try {
    const tenant = uniqueTenant();
    // Project an execution directly into the read model
    const { InMemoryExecutionStore } = await import("../../lib/orchestrator/execution-workflow.ts");
    const s = new InMemoryExecutionStore();
    const wf = s.create({ tenantId: tenant, actionId: "action-test" });
    stack.readModelStore.projectExecution(wf);

    const { status, body } = await httpGet(port, "/api/index/executions", tenant);
    eq(status, 200);
    eq(body.executions.length, 1);
    eq(body.executions[0].actionId, "action-test");
  } finally { server.close(); }
});

test("indexer: GET /api/index/executions?status=planned filters correctly", async () => {
  const { server, port, stack } = makeServer();
  try {
    const tenant = uniqueTenant();
    const { InMemoryExecutionStore } = await import("../../lib/orchestrator/execution-workflow.ts");
    const s = new InMemoryExecutionStore();
    const wf = s.create({ tenantId: tenant, actionId: "action-x" });
    stack.readModelStore.projectExecution(wf);

    const { status, body } = await httpGet(port, "/api/index/executions?status=planned", tenant);
    eq(status, 200);
    eq(body.executions.length, 1);
    eq(body.executions[0].status, "planned");
  } finally { server.close(); }
});

test("indexer: GET /api/index/executions?status=settled returns empty", async () => {
  const { server, port, stack } = makeServer();
  try {
    const tenant = uniqueTenant();
    const { InMemoryExecutionStore } = await import("../../lib/orchestrator/execution-workflow.ts");
    const s = new InMemoryExecutionStore();
    stack.readModelStore.projectExecution(s.create({ tenantId: tenant, actionId: "a1" }));

    const { status, body } = await httpGet(port, "/api/index/executions?status=settled", tenant);
    eq(status, 200);
    eq(body.executions.length, 0);
  } finally { server.close(); }
});

test("indexer: GET /api/index/executions?from&to date-range returns matching", async () => {
  const { server, port, stack } = makeServer();
  try {
    const tenant = uniqueTenant();
    const { InMemoryExecutionStore } = await import("../../lib/orchestrator/execution-workflow.ts");
    const s = new InMemoryExecutionStore();
    stack.readModelStore.projectExecution(s.create({ tenantId: tenant, actionId: "a1" }));

    const from = "2020-01-01T00:00:00.000Z";
    const to = "2099-12-31T23:59:59.999Z";
    const { status, body } = await httpGet(port, `/api/index/executions?from=${from}&to=${to}`, tenant);
    eq(status, 200);
    eq(body.executions.length, 1);
  } finally { server.close(); }
});

test("indexer: GET /api/index/executions?from>to returns 400", async () => {
  const { server, port } = makeServer();
  try {
    const tenant = uniqueTenant();
    const { status } = await httpGet(
      port,
      "/api/index/executions?from=2099-01-01T00:00:00.000Z&to=2000-01-01T00:00:00.000Z",
      tenant,
    );
    eq(status, 400);
  } finally { server.close(); }
});

test("indexer: GET /api/index/executions/:id returns execution", async () => {
  const { server, port, stack } = makeServer();
  try {
    const tenant = uniqueTenant();
    const { InMemoryExecutionStore } = await import("../../lib/orchestrator/execution-workflow.ts");
    const s = new InMemoryExecutionStore();
    const wf = s.create({ tenantId: tenant, actionId: "a1" });
    stack.readModelStore.projectExecution(wf);

    const { status, body } = await httpGet(port, `/api/index/executions/${wf.id}`, tenant);
    eq(status, 200);
    eq(body.execution.id, wf.id);
  } finally { server.close(); }
});

test("indexer: GET /api/index/executions/:id returns 404 for unknown", async () => {
  const { server, port } = makeServer();
  try {
    const { status } = await httpGet(port, "/api/index/executions/no-such-id", uniqueTenant());
    eq(status, 404);
  } finally { server.close(); }
});

test("indexer: GET /api/index/executions/by-action/:actionId returns execution", async () => {
  const { server, port, stack } = makeServer();
  try {
    const tenant = uniqueTenant();
    const { InMemoryExecutionStore } = await import("../../lib/orchestrator/execution-workflow.ts");
    const s = new InMemoryExecutionStore();
    const wf = s.create({ tenantId: tenant, actionId: "my-action" });
    stack.readModelStore.projectExecution(wf);

    const { status, body } = await httpGet(port, "/api/index/executions/by-action/my-action", tenant);
    eq(status, 200);
    eq(body.execution.actionId, "my-action");
  } finally { server.close(); }
});

test("indexer: GET /api/index/executions/by-action/:actionId returns 404 for unknown", async () => {
  const { server, port } = makeServer();
  try {
    const { status } = await httpGet(port, "/api/index/executions/by-action/no-such", uniqueTenant());
    eq(status, 404);
  } finally { server.close(); }
});

// ─── Actors ───────────────────────────────────────────────────────────────────

test("indexer: GET /api/index/actors returns empty list initially", async () => {
  const { server, port } = makeServer();
  try {
    const { status, body } = await httpGet(port, "/api/index/actors", uniqueTenant());
    eq(status, 200);
    assert(Array.isArray(body.actors), "body.actors should be array");
    eq(body.actors.length, 0);
  } finally { server.close(); }
});

test("indexer: GET /api/index/actors returns projected actor", async () => {
  const { server, port, stack } = makeServer();
  try {
    const tenant = uniqueTenant();
    stack.readModelStore.projectActor({
      tenantId: tenant,
      actorId: "actor-1",
      actorType: "agent",
      timestamp: new Date().toISOString(),
    });
    const { status, body } = await httpGet(port, "/api/index/actors", tenant);
    eq(status, 200);
    eq(body.actors.length, 1);
    eq(body.actors[0].actorId, "actor-1");
    // BigInt field serialized as string
    eq(typeof body.actors[0].totalValueMovedMicrounits, "string");
  } finally { server.close(); }
});

test("indexer: GET /api/index/actors/:actorId/summary returns summary", async () => {
  const { server, port, stack } = makeServer();
  try {
    const tenant = uniqueTenant();
    stack.readModelStore.projectActor({
      tenantId: tenant,
      actorId: "actor-1",
      actorType: "human",
      timestamp: new Date().toISOString(),
    });
    const { status, body } = await httpGet(port, "/api/index/actors/actor-1/summary", tenant);
    eq(status, 200);
    eq(body.actor.actorId, "actor-1");
    eq(body.executionCount, 0);
  } finally { server.close(); }
});

test("indexer: GET /api/index/actors/:actorId/summary returns 404 for unknown", async () => {
  const { server, port } = makeServer();
  try {
    const { status } = await httpGet(port, "/api/index/actors/nobody/summary", uniqueTenant());
    eq(status, 404);
  } finally { server.close(); }
});

// ─── Escrows ──────────────────────────────────────────────────────────────────

test("indexer: GET /api/index/escrows returns empty list", async () => {
  const { server, port } = makeServer();
  try {
    const { status, body } = await httpGet(port, "/api/index/escrows", uniqueTenant());
    eq(status, 200);
    eq(body.escrows.length, 0);
  } finally { server.close(); }
});

test("indexer: GET /api/index/escrows/:id returns 404 for unknown", async () => {
  const { server, port } = makeServer();
  try {
    const { status } = await httpGet(port, "/api/index/escrows/no-such", uniqueTenant());
    eq(status, 404);
  } finally { server.close(); }
});

// ─── Passports ────────────────────────────────────────────────────────────────

test("indexer: GET /api/index/passports returns empty list", async () => {
  const { server, port } = makeServer();
  try {
    const { status, body } = await httpGet(port, "/api/index/passports", uniqueTenant());
    eq(status, 200);
    eq(body.passports.length, 0);
  } finally { server.close(); }
});

test("indexer: GET /api/index/passports/:id returns 404 for unknown", async () => {
  const { server, port } = makeServer();
  try {
    const { status } = await httpGet(port, "/api/index/passports/no-such", uniqueTenant());
    eq(status, 404);
  } finally { server.close(); }
});

// ─── Approvals ────────────────────────────────────────────────────────────────

test("indexer: GET /api/index/approvals returns empty list", async () => {
  const { server, port } = makeServer();
  try {
    const { status, body } = await httpGet(port, "/api/index/approvals", uniqueTenant());
    eq(status, 200);
    eq(body.approvals.length, 0);
  } finally { server.close(); }
});

test("indexer: GET /api/index/approvals/:id returns 404 for unknown", async () => {
  const { server, port } = makeServer();
  try {
    const { status } = await httpGet(port, "/api/index/approvals/no-such", uniqueTenant());
    eq(status, 404);
  } finally { server.close(); }
});

// ─── Disputes ─────────────────────────────────────────────────────────────────

test("indexer: GET /api/index/disputes returns empty list", async () => {
  const { server, port } = makeServer();
  try {
    const { status, body } = await httpGet(port, "/api/index/disputes", uniqueTenant());
    eq(status, 200);
    eq(body.disputes.length, 0);
  } finally { server.close(); }
});

test("indexer: GET /api/index/disputes/:id returns 404 for unknown", async () => {
  const { server, port } = makeServer();
  try {
    const { status } = await httpGet(port, "/api/index/disputes/no-such", uniqueTenant());
    eq(status, 404);
  } finally { server.close(); }
});

// ─── Fail-closed / tenant isolation ──────────────────────────────────────────

test("indexer: missing x-tenant-id returns 400 (fail-closed)", async () => {
  const { server, port } = makeServer();
  try {
    const { status } = await httpGet(port, "/api/index/executions");
    eq(status, 400);
  } finally { server.close(); }
});

test("indexer: cross-tenant execution lookup returns 404 (not 403)", async () => {
  const { server, port, stack } = makeServer();
  try {
    const tenantA = uniqueTenant();
    const tenantB = uniqueTenant();
    const { InMemoryExecutionStore } = await import("../../lib/orchestrator/execution-workflow.ts");
    const s = new InMemoryExecutionStore();
    const wf = s.create({ tenantId: tenantA, actionId: "a1" });
    stack.readModelStore.projectExecution(wf);

    const { status } = await httpGet(port, `/api/index/executions/${wf.id}`, tenantB);
    eq(status, 404);
  } finally { server.close(); }
});
