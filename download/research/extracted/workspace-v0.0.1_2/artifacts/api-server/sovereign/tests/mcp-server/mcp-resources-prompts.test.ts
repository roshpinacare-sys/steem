/**
 * tests/mcp-server/mcp-resources-prompts.test.ts
 *
 * Tests for MCP resources + prompts in TfaMcpServer.
 *
 * Coverage:
 *   Unit (mcp-resources-prompts.ts):
 *     • STATIC_RESOURCES list has expected URIs
 *     • readStaticResource returns correct content
 *     • readStaticResource returns null for unknown URI
 *     • parseTfaUri parses valid URIs correctly
 *     • parseTfaUri returns null for invalid URIs
 *     • TFA_PROMPTS list has expected names
 *     • renderPrompt returns messages for known prompts
 *     • renderPrompt returns null for unknown prompt
 *     • formatReceiptResource produces readable text
 *     • formatPassportResource produces readable text
 *
 *   Integration (TfaMcpServer via handleRequest):
 *     • initialize advertises resources + prompts capabilities
 *     • resources/list returns STATIC_RESOURCES
 *     • resources/read returns static content for known URI
 *     • resources/read returns error for unknown URI
 *     • resources/read returns error for unknown kind
 *     • prompts/list returns TFA_PROMPTS
 *     • prompts/get renders tfa_gate_flow
 *     • prompts/get renders tfa_audit_review
 *     • prompts/get renders tfa_risk_assessment
 *     • prompts/get returns error for unknown prompt
 *     • prompts/get with missing required arg still renders (graceful)
 */

import { test, assert, eq } from "../_harness.mjs";
import {
  STATIC_RESOURCES,
  TFA_PROMPTS,
  parseTfaUri,
  readStaticResource,
  renderPrompt,
  formatReceiptResource,
  formatPassportResource,
} from "../../lib/mcp-server/mcp-resources-prompts.ts";
import { TfaMcpServer } from "../../lib/mcp-server/mcp-server.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { InMemoryNonceRegistry } from "../../lib/mcp-server/nonce-registry.ts";

// ── Unit: static resources ────────────────────────────────────────────────────

test("STATIC_RESOURCES contains gate-flow/overview", () => {
  assert(STATIC_RESOURCES.some((r) => r.uri === "tfa://gate-flow/overview"),
    "should include gate-flow/overview");
});

test("STATIC_RESOURCES contains gate-flow/risk-classes", () => {
  assert(STATIC_RESOURCES.some((r) => r.uri === "tfa://gate-flow/risk-classes"),
    "should include gate-flow/risk-classes");
});

test("readStaticResource: gate-flow/overview returns text/plain content", () => {
  const c = readStaticResource("tfa://gate-flow/overview");
  assert(c !== null, "should return content");
  eq(c!.mimeType, "text/plain");
  assert(c!.text.length > 100, "content should be non-trivial");
  assert(c!.text.includes("TFA"), "content should mention TFA");
});

test("readStaticResource: gate-flow/risk-classes returns taxonomy", () => {
  const c = readStaticResource("tfa://gate-flow/risk-classes");
  assert(c !== null);
  assert(c!.text.includes("read_only"), "should include read_only class");
  assert(c!.text.includes("irreversible"), "should include irreversible class");
  assert(c!.text.includes("value_moving"), "should include value_moving class");
});

test("readStaticResource: unknown URI returns null (fail-closed)", () => {
  eq(readStaticResource("tfa://unknown/nope"), null);
});

// ── Unit: parseTfaUri ─────────────────────────────────────────────────────────

test("parseTfaUri: valid receipt URI", () => {
  const r = parseTfaUri("tfa://receipt/exec-123");
  assert(r !== null);
  eq(r!.kind, "receipt");
  eq(r!.id, "exec-123");
});

test("parseTfaUri: valid passport URI", () => {
  const r = parseTfaUri("tfa://passport/audit-abc");
  assert(r !== null);
  eq(r!.kind, "passport");
  eq(r!.id, "audit-abc");
});

test("parseTfaUri: unknown scheme returns null", () => {
  eq(parseTfaUri("http://example.com"), null);
});

test("parseTfaUri: no slash after kind returns null", () => {
  eq(parseTfaUri("tfa://receipt"), null);
});

test("parseTfaUri: empty id returns null", () => {
  eq(parseTfaUri("tfa://receipt/"), null);
});

// ── Unit: prompts ─────────────────────────────────────────────────────────────

test("TFA_PROMPTS includes tfa_gate_flow", () => {
  assert(TFA_PROMPTS.some((p) => p.name === "tfa_gate_flow"));
});

test("TFA_PROMPTS includes tfa_audit_review", () => {
  assert(TFA_PROMPTS.some((p) => p.name === "tfa_audit_review"));
});

test("TFA_PROMPTS includes tfa_risk_assessment", () => {
  assert(TFA_PROMPTS.some((p) => p.name === "tfa_risk_assessment"));
});

test("TFA_PROMPTS all have name + description", () => {
  for (const p of TFA_PROMPTS) {
    assert(typeof p.name === "string" && p.name.length > 0, `prompt.name required: ${p.name}`);
    assert(typeof p.description === "string" && p.description!.length > 0, `prompt.description required: ${p.name}`);
  }
});

test("renderPrompt: tfa_gate_flow returns user message", () => {
  const msgs = renderPrompt("tfa_gate_flow", { toolId: "file.write", resourceRef: "/etc/hosts" });
  assert(Array.isArray(msgs) && msgs!.length > 0);
  eq(msgs![0].role, "user");
  assert(msgs![0].content.text.includes("file.write"), "should mention toolId");
  assert(msgs![0].content.text.includes("tfa_check_action"), "should mention check tool");
});

test("renderPrompt: tfa_audit_review returns user message", () => {
  const msgs = renderPrompt("tfa_audit_review", { tenantId: "my-tenant" });
  assert(Array.isArray(msgs) && msgs!.length > 0);
  assert(msgs![0].content.text.includes("my-tenant"), "should mention tenantId");
});

test("renderPrompt: tfa_risk_assessment returns user message", () => {
  const msgs = renderPrompt("tfa_risk_assessment", { toolId: "db.migrate", valueMicrounits: "500000" });
  assert(Array.isArray(msgs) && msgs!.length > 0);
  assert(msgs![0].content.text.includes("db.migrate"), "should mention toolId");
});

test("renderPrompt: unknown name returns null (fail-closed)", () => {
  eq(renderPrompt("not_a_prompt", {}), null);
});

// ── Unit: format helpers ──────────────────────────────────────────────────────

test("formatReceiptResource produces readable text with decision", () => {
  const uri = "tfa://receipt/exec-001";
  const content = formatReceiptResource(uri, {
    executionId: "exec-001",
    decision: "allowed",
    tenantId: "t1",
    actorId: "agent-1",
    toolId: "file.read",
    issuedAt: "2026-01-01T00:00:00Z",
    kid: "abc123",
  });
  eq(content.uri, uri);
  eq(content.mimeType, "text/plain");
  assert(content.text.includes("allowed"), "should include decision");
  assert(content.text.includes("exec-001"), "should include executionId");
  assert(!content.text.includes("secret"), "should never expose secret");
});

test("formatPassportResource produces readable text with auditId", () => {
  const uri = "tfa://passport/audit-007";
  const content = formatPassportResource(uri, {
    audit: { id: "audit-007", tenantId: "t1", toolId: "file.read", decision: "allowed" },
    issuedAt: "2026-01-01T00:00:00Z",
    kid: "kidabc",
    hash: "deadbeef",
  });
  eq(content.uri, uri);
  assert(content.text.includes("audit-007"), "should include auditId");
  assert(content.text.includes("allowed"), "should include decision");
  assert(!content.text.includes("secret"), "should never expose secret");
});

// ── Integration: TfaMcpServer handleRequest ───────────────────────────────────

const signer = new HmacSigner("test-secret-resources-prompts-32ch");
const server = new TfaMcpServer({ signer, nonceRegistry: new InMemoryNonceRegistry() });

function req(id: number, method: string, params?: unknown) {
  return { jsonrpc: "2.0" as const, id, method, params: params ?? {} };
}

test("initialize advertises resources + prompts capabilities", async () => {
  const res = await server.handleRequest(req(1, "initialize", { protocolVersion: "2024-11-05" }));
  assert(res !== null);
  const caps = (res!.result as any).capabilities;
  assert(typeof caps.resources === "object", "should advertise resources");
  assert(typeof caps.prompts === "object", "should advertise prompts");
  assert(typeof caps.tools === "object", "should still advertise tools");
});

test("resources/list returns STATIC_RESOURCES", async () => {
  const res = await server.handleRequest(req(2, "resources/list"));
  assert(res !== null);
  const resources = (res!.result as any).resources;
  assert(Array.isArray(resources), "should return resources array");
  assert(resources.length >= 2, "should have at least 2 static resources");
  assert(resources.some((r: any) => r.uri === "tfa://gate-flow/overview"), "should include overview");
});

test("resources/read gate-flow/overview returns content", async () => {
  const res = await server.handleRequest(req(3, "resources/read", { uri: "tfa://gate-flow/overview" }));
  assert(res !== null);
  const contents = (res!.result as any).contents;
  assert(Array.isArray(contents) && contents.length === 1, "should return one content item");
  eq(contents[0].mimeType, "text/plain");
  assert(contents[0].text.length > 50, "should have non-trivial text");
});

test("resources/read gate-flow/risk-classes returns taxonomy", async () => {
  const res = await server.handleRequest(req(4, "resources/read", { uri: "tfa://gate-flow/risk-classes" }));
  assert(res !== null);
  const content = (res!.result as any).contents[0];
  assert(content.text.includes("irreversible"), "taxonomy should include irreversible");
});

test("resources/read unknown URI returns error", async () => {
  const res = await server.handleRequest(req(5, "resources/read", { uri: "tfa://nope/xxx" }));
  assert(res !== null);
  assert(res!.error !== undefined, "should return RPC error for unknown resource");
});

test("resources/read missing uri returns error", async () => {
  const res = await server.handleRequest(req(6, "resources/read", {}));
  assert(res !== null);
  assert(res!.error !== undefined, "should return error for missing uri");
});

test("prompts/list returns TFA_PROMPTS", async () => {
  const res = await server.handleRequest(req(7, "prompts/list"));
  assert(res !== null);
  const prompts = (res!.result as any).prompts;
  assert(Array.isArray(prompts), "should return prompts array");
  assert(prompts.length >= 3, "should have at least 3 prompts");
  assert(prompts.some((p: any) => p.name === "tfa_gate_flow"), "should include gate_flow");
});

test("prompts/get tfa_gate_flow renders message", async () => {
  const res = await server.handleRequest(req(8, "prompts/get", {
    name: "tfa_gate_flow",
    arguments: { toolId: "db.migrate" },
  }));
  assert(res !== null);
  const messages = (res!.result as any).messages;
  assert(Array.isArray(messages) && messages.length > 0, "should return messages");
  eq(messages[0].role, "user");
  assert(messages[0].content.text.includes("db.migrate"), "should include toolId in prompt");
});

test("prompts/get tfa_audit_review renders message", async () => {
  const res = await server.handleRequest(req(9, "prompts/get", {
    name: "tfa_audit_review",
    arguments: { tenantId: "org-42" },
  }));
  assert(res !== null);
  const messages = (res!.result as any).messages;
  assert(Array.isArray(messages) && messages.length > 0);
  assert(messages[0].content.text.includes("org-42"));
});

test("prompts/get tfa_risk_assessment renders message", async () => {
  const res = await server.handleRequest(req(10, "prompts/get", {
    name: "tfa_risk_assessment",
    arguments: { toolId: "file.delete", valueMicrounits: "0" },
  }));
  assert(res !== null);
  const messages = (res!.result as any).messages;
  assert(Array.isArray(messages) && messages.length > 0);
  assert(messages[0].content.text.includes("file.delete"));
});

test("prompts/get unknown name returns RPC error", async () => {
  const res = await server.handleRequest(req(11, "prompts/get", { name: "not_real" }));
  assert(res !== null);
  assert(res!.error !== undefined, "should return error for unknown prompt");
});

test("prompts/get missing name returns RPC error", async () => {
  const res = await server.handleRequest(req(12, "prompts/get", {}));
  assert(res !== null);
  assert(res!.error !== undefined, "should return error for missing name");
});
