/**
 * tests/mcp-server/simulate-action-tool.test.ts — v279.
 * tfa_simulate_action MCP tool: pre-action dry-run exposed to AI agents (Claude Code/Cursor).
 *
 *   LISTED        the tool appears in tools/list with an actionType schema.
 *   FEATURE       a destructive action returns irreversible + correct blast radius.
 *   VALUE         a value-moving action returns valueAtRiskMicrounits as a μ¢ string.
 *   FAIL-CLOSED   missing/empty actionType → JSON-RPC error; unknown action → worst-case.
 */
import { test, assert, eq } from "../_harness.mjs";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { InMemoryExecutionStore } from "../../lib/orchestrator/execution-workflow.ts";
import { TfaMcpServer, type JsonRpcRequest } from "../../lib/mcp-server/mcp-server.ts";
import { InMemoryNonceRegistry } from "../../lib/mcp-server/nonce-registry.ts";

const signer = new HmacSigner("mcp-simulate-test-secret");
function makeServer() {
  return new TfaMcpServer({ signer, executionStore: new InMemoryExecutionStore(), serverVersion: "1.0.0", nonceRegistry: new InMemoryNonceRegistry() });
}
function rpc(method: string, params?: unknown, id = 1): JsonRpcRequest { return { jsonrpc: "2.0", id, method, params }; }
function payload(res: any) { return JSON.parse(res.result.content[0].text); }

test("tfa_simulate_action is listed in tools/list", async () => {
  const server = makeServer();
  const res: any = await server.handleRequest(rpc("tools/list", {}, 1));
  const names = res.result.tools.map((t: any) => t.name);
  assert(names.includes("tfa_simulate_action"), "tool is advertised");
  const tool = res.result.tools.find((t: any) => t.name === "tfa_simulate_action");
  assert(tool.inputSchema.required.includes("actionType"), "requires actionType");
});

test("destructive action → irreversible + correct blast radius", async () => {
  const server = makeServer();
  const res: any = await server.handleRequest(rpc("tools/call", { name: "tfa_simulate_action", arguments: { actionType: "db.migration" } }, 2));
  const p = payload(res);
  eq(p.reversible, false);
  eq(p.blastRadius, "datastore");
  eq(p.requiresBackup, true);
  assert(Array.isArray(p.warnings) && p.warnings.length > 0, "carries warnings");
});

test("value-moving action → valueAtRiskMicrounits as μ¢ string", async () => {
  const server = makeServer();
  const res: any = await server.handleRequest(rpc("tools/call", { name: "tfa_simulate_action", arguments: { actionType: "token.swap", valueMicrounits: "5000000" } }, 3));
  const p = payload(res);
  eq(p.blastRadius, "funds");
  eq(p.valueAtRiskMicrounits, "5000000", "BigInt serialized as decimal string");
});

test("fail-closed: missing actionType errors; unknown action → worst-case", async () => {
  const server = makeServer();
  const bad: any = await server.handleRequest(rpc("tools/call", { name: "tfa_simulate_action", arguments: {} }, 4));
  assert(bad.error, "missing actionType → JSON-RPC error");
  const unknown: any = await server.handleRequest(rpc("tools/call", { name: "tfa_simulate_action", arguments: { actionType: "totally.made.up" } }, 5));
  const p = payload(unknown);
  eq(p.reversible, false, "unknown → irreversible (worst-case)");
  eq(p.blastRadius, "unknown");
  eq(p.riskSource, "fail_closed_default");
});
