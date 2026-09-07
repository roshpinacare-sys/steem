/**
 * tests/mcp-server/tool-annotations.test.ts — MCP tool annotations.
 *
 * Verifies that getTfaMcpTools() returns all 17 tools with correct MCP 2025-03-26
 * annotations (readOnlyHint, destructiveHint, idempotentHint) DERIVED from
 * MCP_TOOL_RISK_MAP via deriveToolAnnotations().
 *
 * Safety contract:
 *   • read-only tools (check, get, verify, status, threshold, simulate, simulate_policy, get_execution):
 *       readOnlyHint=true, destructiveHint=false, idempotentHint=true
 *   • destructive tools (start, approve, dispute, fund, release, partial, reverse):
 *       readOnlyHint=false, destructiveHint=true, idempotentHint=false
 *   • neutral tools (create_settlement):
 *       readOnlyHint=false, destructiveHint=false, idempotentHint=false
 *
 * Coverage (22 tests):
 *   All 17 tools have annotations · read-only set correct · destructive set correct ·
 *   neutral set correct · no tool is both readOnly and destructive ·
 *   readOnlyHint=true tools all have idempotentHint=true ·
 *   tools/list response includes annotations in JSON-RPC 2.0 format ·
 *   annotations are plain objects (not undefined after JSON round-trip) ·
 *   tfa_check_action and tfa_simulate_action: spot-check with no side-effects contract ·
 *   deriveToolAnnotations direct coverage · MCP_TOOL_RISK_MAP has entry for every tool.
 */

import { test, assert, eq } from "../_harness.mjs";
import { getTfaMcpTools, TfaMcpServer, deriveToolAnnotations, MCP_TOOL_RISK_MAP } from "../../lib/mcp-server/mcp-server.ts";
import type { McpTool, McpToolAnnotations } from "../../lib/mcp-server/mcp-server.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { InMemoryExecutionStore } from "../../lib/orchestrator/execution-workflow.ts";
import { InMemoryNonceRegistry } from "../../lib/mcp-server/nonce-registry.ts";

// ─── Annotation classification ────────────────────────────────────────────────

const READ_ONLY_TOOLS = [
  "tfa_check_action",
  "tfa_assess_risk",
  "tfa_get_execution",
  "tfa_get_receipt",
  "tfa_verify_receipt",
  "tfa_settlement_status",
  "tfa_threshold_approval",
  "tfa_simulate_action",
];

const DESTRUCTIVE_TOOLS = [
  "tfa_start_execution",
  "tfa_approve_execution",
  "tfa_dispute_settlement",
  "tfa_fund_settlement",
  "tfa_release_settlement",
  "tfa_partial_release_settlement",
  "tfa_reverse_settlement",
];

const NEUTRAL_TOOLS = [
  "tfa_create_settlement",
];

function toolByName(name: string): McpTool {
  const tool = getTfaMcpTools().find(t => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

function ann(name: string): McpToolAnnotations {
  const t = toolByName(name);
  if (!t.annotations) throw new Error(`Tool ${name} has no annotations`);
  return t.annotations;
}

// ─── All tools have annotations ────────────────────────────────────────────────

test("annotations: all 18 tools have annotations object", () => {
  const tools = getTfaMcpTools();
  eq(tools.length, 18);
  for (const tool of tools) {
    assert(tool.annotations !== undefined, `${tool.name} missing annotations`);
  }
});

test("annotations: all 18 tools have readOnlyHint (boolean)", () => {
  for (const tool of getTfaMcpTools()) {
    assert(typeof tool.annotations!.readOnlyHint === "boolean",
      `${tool.name}.readOnlyHint is not boolean`);
  }
});

test("annotations: all 18 tools have destructiveHint (boolean)", () => {
  for (const tool of getTfaMcpTools()) {
    assert(typeof tool.annotations!.destructiveHint === "boolean",
      `${tool.name}.destructiveHint is not boolean`);
  }
});

test("annotations: all 18 tools have idempotentHint (boolean)", () => {
  for (const tool of getTfaMcpTools()) {
    assert(typeof tool.annotations!.idempotentHint === "boolean",
      `${tool.name}.idempotentHint is not boolean`);
  }
});

// ─── Read-only tools ──────────────────────────────────────────────────────────

test("annotations: read-only tools have readOnlyHint=true", () => {
  for (const name of READ_ONLY_TOOLS) {
    const a = ann(name);
    assert(a.readOnlyHint === true, `${name}: expected readOnlyHint=true, got ${a.readOnlyHint}`);
  }
});

test("annotations: read-only tools have destructiveHint=false", () => {
  for (const name of READ_ONLY_TOOLS) {
    const a = ann(name);
    assert(a.destructiveHint === false, `${name}: expected destructiveHint=false, got ${a.destructiveHint}`);
  }
});

test("annotations: read-only tools have idempotentHint=true", () => {
  for (const name of READ_ONLY_TOOLS) {
    const a = ann(name);
    assert(a.idempotentHint === true, `${name}: expected idempotentHint=true, got ${a.idempotentHint}`);
  }
});

// ─── Destructive tools ────────────────────────────────────────────────────────

test("annotations: destructive tools have destructiveHint=true", () => {
  for (const name of DESTRUCTIVE_TOOLS) {
    const a = ann(name);
    assert(a.destructiveHint === true, `${name}: expected destructiveHint=true, got ${a.destructiveHint}`);
  }
});

test("annotations: destructive tools have readOnlyHint=false", () => {
  for (const name of DESTRUCTIVE_TOOLS) {
    const a = ann(name);
    assert(a.readOnlyHint === false, `${name}: expected readOnlyHint=false, got ${a.readOnlyHint}`);
  }
});

test("annotations: destructive tools have idempotentHint=false (value-transfer)", () => {
  for (const name of DESTRUCTIVE_TOOLS) {
    const a = ann(name);
    assert(a.idempotentHint === false, `${name}: expected idempotentHint=false, got ${a.idempotentHint}`);
  }
});

// ─── Neutral tools ────────────────────────────────────────────────────────────

test("annotations: tfa_create_settlement — neutral (readOnly=false, destructive=false)", () => {
  const a = ann("tfa_create_settlement");
  assert(a.readOnlyHint === false, "readOnlyHint should be false");
  assert(a.destructiveHint === false, "destructiveHint should be false");
  assert(a.idempotentHint === false, "idempotentHint should be false");
});

// ─── Safety invariants ────────────────────────────────────────────────────────

test("annotations: no tool is simultaneously readOnly AND destructive", () => {
  for (const tool of getTfaMcpTools()) {
    const a = tool.annotations!;
    assert(
      !(a.readOnlyHint === true && a.destructiveHint === true),
      `${tool.name}: cannot be both readOnly and destructive`,
    );
  }
});

test("annotations: every readOnlyHint=true tool also has idempotentHint=true", () => {
  for (const tool of getTfaMcpTools()) {
    const a = tool.annotations!;
    if (a.readOnlyHint === true) {
      assert(a.idempotentHint === true,
        `${tool.name}: readOnly implies idempotent, but idempotentHint=${a.idempotentHint}`);
    }
  }
});

// ─── Spot-checks: key tools ───────────────────────────────────────────────────

test("annotations: tfa_check_action is readOnly+idempotent (safety contract: no side-effects)", () => {
  const a = ann("tfa_check_action");
  eq(a.readOnlyHint, true);
  eq(a.destructiveHint, false);
  eq(a.idempotentHint, true);
});

test("annotations: tfa_simulate_action is readOnly+idempotent (dry-run contract)", () => {
  const a = ann("tfa_simulate_action");
  eq(a.readOnlyHint, true);
  eq(a.destructiveHint, false);
  eq(a.idempotentHint, true);
});

test("annotations: tfa_start_execution is destructive+non-idempotent (opens workflow)", () => {
  const a = ann("tfa_start_execution");
  eq(a.readOnlyHint, false);
  eq(a.destructiveHint, true);
  eq(a.idempotentHint, false);
});

test("annotations: tfa_release_settlement is destructive (value transfer)", () => {
  const a = ann("tfa_release_settlement");
  eq(a.readOnlyHint, false);
  eq(a.destructiveHint, true);
});

// ─── Derivation coverage ──────────────────────────────────────────────────────

test("annotations: deriveToolAnnotations read_only → readOnly+idempotent", () => {
  const a = deriveToolAnnotations("read_only");
  eq(a.readOnlyHint, true);
  eq(a.destructiveHint, false);
  eq(a.idempotentHint, true);
});

test("annotations: deriveToolAnnotations privacy_sensitive → readOnly+idempotent", () => {
  const a = deriveToolAnnotations("privacy_sensitive");
  eq(a.readOnlyHint, true);
  eq(a.destructiveHint, false);
  eq(a.idempotentHint, true);
});

test("annotations: deriveToolAnnotations write_safe → neutral+non-idempotent", () => {
  const a = deriveToolAnnotations("write_safe");
  eq(a.readOnlyHint, false);
  eq(a.destructiveHint, false);
  eq(a.idempotentHint, false);
});

test("annotations: deriveToolAnnotations irreversible → destructive+non-idempotent", () => {
  const a = deriveToolAnnotations("irreversible");
  eq(a.readOnlyHint, false);
  eq(a.destructiveHint, true);
  eq(a.idempotentHint, false);
});

test("annotations: deriveToolAnnotations value_moving → destructive+non-idempotent", () => {
  const a = deriveToolAnnotations("value_moving");
  eq(a.readOnlyHint, false);
  eq(a.destructiveHint, true);
  eq(a.idempotentHint, false);
});

test("annotations: deriveToolAnnotations regulated → destructive+non-idempotent (fail-closed)", () => {
  const a = deriveToolAnnotations("regulated");
  eq(a.readOnlyHint, false);
  eq(a.destructiveHint, true);
  eq(a.idempotentHint, false);
});

test("annotations: MCP_TOOL_RISK_MAP has entry for every tool in getTfaMcpTools()", () => {
  for (const tool of getTfaMcpTools()) {
    assert(MCP_TOOL_RISK_MAP[tool.name] !== undefined,
      `${tool.name}: missing from MCP_TOOL_RISK_MAP`);
  }
});

test("annotations: every tool annotation matches deriveToolAnnotations(MCP_TOOL_RISK_MAP[name])", () => {
  for (const tool of getTfaMcpTools()) {
    const riskClass = MCP_TOOL_RISK_MAP[tool.name];
    const expected = deriveToolAnnotations(riskClass);
    const actual = tool.annotations!;
    eq(actual.readOnlyHint, expected.readOnlyHint);
    eq(actual.destructiveHint, expected.destructiveHint);
    eq(actual.idempotentHint, expected.idempotentHint);
  }
});

// ─── JSON-RPC tools/list includes annotations ─────────────────────────────────

test("annotations: tools/list JSON-RPC response includes annotations field", async () => {
  const signer = new HmacSigner("test-secret-long-enough-hmac-key-32!");
  const store = new InMemoryExecutionStore();
  const nonceRegistry = new InMemoryNonceRegistry();
  const server = new TfaMcpServer({ signer, executionStore: store, nonceRegistry });

  const response = await server.handleRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {},
  });

  assert(response.result !== undefined, "tools/list returned result");
  const { tools } = response.result as { tools: McpTool[] };
  eq(tools.length, 18);

  for (const tool of tools) {
    assert(tool.annotations !== undefined, `${tool.name}: annotations missing from tools/list`);
    assert(typeof tool.annotations!.readOnlyHint === "boolean",
      `${tool.name}: readOnlyHint not boolean in response`);
  }
});

test("annotations: annotations survive JSON round-trip (plain object, no undefined)", () => {
  const tools = getTfaMcpTools();
  const json = JSON.parse(JSON.stringify(tools)) as McpTool[];

  for (const tool of json) {
    assert(tool.annotations !== undefined, `${tool.name}: annotations lost in JSON round-trip`);
    // JSON.stringify drops undefined values — booleans must survive intact
    assert("readOnlyHint" in tool.annotations!, `${tool.name}: readOnlyHint lost in JSON`);
    assert("destructiveHint" in tool.annotations!, `${tool.name}: destructiveHint lost in JSON`);
    assert("idempotentHint" in tool.annotations!, `${tool.name}: idempotentHint lost in JSON`);
  }
});
