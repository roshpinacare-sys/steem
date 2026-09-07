/**
 * tests/mcp-server/get-execution-tool.test.ts — tfa_get_execution MCP tool.
 *
 * Coverage:
 *   • Happy path: fetch existing workflow by id
 *   • Tenant isolation: wrong tenant → not-found
 *   • Missing params: tenantId / executionId required
 *   • tools/list includes tfa_get_execution with correct annotations
 */

import { test, assert, eq } from "../_harness.mjs";
import { TfaMcpServer, getTfaMcpTools } from "../../lib/mcp-server/mcp-server.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { InMemoryExecutionStore } from "../../lib/orchestrator/execution-workflow.ts";
import { InMemoryNonceRegistry } from "../../lib/mcp-server/nonce-registry.ts";

const signer = new HmacSigner("mcp-test-secret-key");

function makeServer() {
  const store = new InMemoryExecutionStore();
  const server = new TfaMcpServer({
    signer,
    executionStore: store,
    serverVersion: "1.0.0",
    nonceRegistry: new InMemoryNonceRegistry(),
  });
  return { server, store };
}

function req(method: string, params?: unknown, id = 1) {
  return { jsonrpc: "2.0" as const, id, method, params };
}

// ─── Happy path ──────────────────────────────────────────────────────────────

test("tfa_get_execution returns workflow by id", async () => {
  const { server, store } = makeServer();
  const wf = store.create({ tenantId: "t1", actionId: "a1" });

  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_get_execution",
    arguments: { tenantId: "t1", executionId: wf.id },
  }));

  eq(r!.error, undefined);
  const result = JSON.parse((r!.result as any).content[0].text);
  eq(result.ok, true);
  eq(result.workflow.id, wf.id);
  eq(result.workflow.tenantId, "t1");
  eq(result.workflow.status, "planned");
});

// ─── Tenant isolation ────────────────────────────────────────────────────────

test("tfa_get_execution wrong tenant returns not found", async () => {
  const { server, store } = makeServer();
  const wf = store.create({ tenantId: "t1", actionId: "a1" });

  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_get_execution",
    arguments: { tenantId: "t2", executionId: wf.id },
  }));

  eq(r!.error, undefined);
  const result = JSON.parse((r!.result as any).content[0].text);
  eq(result.ok, false);
  eq(result.error, "workflow not found");
});

// ─── Missing params ───────────────────────────────────────────────────────────

test("tfa_get_execution missing tenantId returns error", async () => {
  const { server } = makeServer();
  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_get_execution",
    arguments: { executionId: "x1" },
  }));

  assert(r!.error !== undefined, "expected error for missing tenantId");
  assert((r!.error as any).message.includes("tenantId"), "error should mention tenantId");
});

test("tfa_get_execution missing executionId returns error", async () => {
  const { server } = makeServer();
  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_get_execution",
    arguments: { tenantId: "t1" },
  }));

  assert(r!.error !== undefined, "expected error for missing executionId");
  assert((r!.error as any).message.includes("executionId"), "error should mention executionId");
});

// ─── tools/list includes the new tool ─────────────────────────────────────────

test("tfa_get_execution appears in tools/list with readOnly annotations", () => {
  const tools = getTfaMcpTools();
  const tool = tools.find(t => t.name === "tfa_get_execution");
  assert(tool !== undefined, "tfa_get_execution not found in getTfaMcpTools()");
  eq(tool!.annotations!.readOnlyHint, true);
  eq(tool!.annotations!.destructiveHint, false);
  eq(tool!.annotations!.idempotentHint, true);
});
