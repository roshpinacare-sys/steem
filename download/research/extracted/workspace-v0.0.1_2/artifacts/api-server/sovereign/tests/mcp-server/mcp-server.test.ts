import "../_flush.mjs";
/**
 * tests/mcp-server/mcp-server.test.ts — TFA MCP Server (wedge #1) tests.
 *
 * FEATURE    14 כלי MCP כולל check_action, start_execution, approve_execution, get_receipt,
 *            verify_receipt (עם verifyTfaProof מאוחד + mandateLinkage אופציונלי).
 * EDGE       תשובות JSON-RPC 2.0 תקינות; initialize + tools/list + tools/call.
 * FAIL-CLOSED קלט חסר → שגיאה; tenant mismatch → not-found; receipt מזויף → verify נכשל.
 */
import { test, assert, eq } from "../_harness.mjs";
import { TfaMcpServer, getTfaMcpTools, type JsonRpcRequest } from "../../lib/mcp-server/index.ts";
import { InMemoryNonceRegistry } from "../../lib/mcp-server/nonce-registry.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { InMemoryExecutionStore } from "../../lib/orchestrator/execution-workflow.ts";
import { verifyExecutionReceipt } from "../../lib/adapter/agent-adapter.ts";
import { linkReceiptToMandates } from "../../lib/adapter/ap2-mandate-link.ts";

const signer = new HmacSigner("mcp-test-secret-key");
const FIXED_NOW = () => "2099-01-01T00:00:00.000Z";

function makeServer() {
  const store = new InMemoryExecutionStore();
  const server = new TfaMcpServer({ signer, executionStore: store, serverVersion: "1.0.0", nonceRegistry: new InMemoryNonceRegistry() });
  return { server, store };
}

function req(method: string, params?: unknown, id = 1): JsonRpcRequest {
  return { jsonrpc: "2.0", id, method, params };
}

function intentArgs(over: Record<string, unknown> = {}) {
  return {
    tenantId: "t1",
    actorId: "agent:1",
    toolId: "file.read",
    resourceRef: "res:1",
    riskClass: "read_only",
    valueMicrounits: "0",
    nonce: "n-" + Math.random().toString(36).slice(2),
    expiry: FIXED_NOW(),
    ...over,
  };
}

// ── MCP lifecycle ──

test("initialize returns correct protocolVersion and serverInfo", async () => {
  const { server } = makeServer();
  const r = await server.handleRequest(req("initialize", { protocolVersion: "2024-11-05" }));
  eq(r!.error, undefined);
  eq(r!.result!.protocolVersion, "2024-11-05");
  eq(r!.result!.serverInfo.name, "tfa-mcp-server");
  eq(r!.result!.capabilities.tools.listChanged, false);
});

test("tools/list returns exactly 18 TFA tools", async () => {
  const { server } = makeServer();
  const r = await server.handleRequest(req("tools/list"));
  eq(r!.error, undefined);
  const tools = r!.result!.tools as Array<{ name: string }>;
  eq(tools.length, 18);
  eq(tools[0].name, "tfa_check_action");
  eq(tools[1].name, "tfa_assess_risk");
  eq(tools[2].name, "tfa_start_execution");
  eq(tools[3].name, "tfa_approve_execution");
  eq(tools[4].name, "tfa_get_execution");
  eq(tools[5].name, "tfa_get_receipt");
  eq(tools[6].name, "tfa_verify_receipt");
  eq(tools[7].name, "tfa_verify_ard_agent");
  eq(tools[8].name, "tfa_settlement_status");
  eq(tools[9].name, "tfa_dispute_settlement");
  eq(tools[10].name, "tfa_create_settlement");
  eq(tools[11].name, "tfa_fund_settlement");
  eq(tools[12].name, "tfa_release_settlement");
  eq(tools[13].name, "tfa_partial_release_settlement");
  eq(tools[14].name, "tfa_reverse_settlement");
  eq(tools[15].name, "tfa_threshold_approval");
  eq(tools[16].name, "tfa_simulate_action");
  eq(tools[17].name, "tfa_simulate_policy");
});

test("notifications/initialized returns null", async () => {
  const { server } = makeServer();
  const r = await server.handleRequest(req("notifications/initialized"));
  eq(r, null);
});

// ── tfa_check_action ──

test("tfa_check_action returns server-side classification for coding taxonomy", async () => {
  const { server } = makeServer();
  const args = intentArgs({ toolId: "shell.exec", riskClass: "read_only" });
  const r = await server.handleRequest(req("tools/call", { name: "tfa_check_action", arguments: args }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.decision, "denied");
  eq(text.serverRiskClass, "irreversible");
  eq(text.clientClaimedRiskClass, "read_only");
  eq(text.riskSource, "coding_taxonomy");
  eq(text.approvalClass, "deny");
  assert(text.metadata.description.length > 0, "metadata present");
});

test("tfa_check_action returns general_taxonomy for ledger.mint", async () => {
  const { server } = makeServer();
  const args = intentArgs({ toolId: "ledger.mint", riskClass: "read_only", valueMicrounits: "100000" });
  const r = await server.handleRequest(req("tools/call", { name: "tfa_check_action", arguments: args }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.decision, "approval_required");
  eq(text.serverRiskClass, "value_moving");
  eq(text.riskSource, "general_taxonomy");
});

test("tfa_check_action fail-closed: unknown toolId → irreversible + denied", async () => {
  const { server } = makeServer();
  const args = intentArgs({ toolId: "unknown.thing", riskClass: "read_only" });
  const r = await server.handleRequest(req("tools/call", { name: "tfa_check_action", arguments: args }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.decision, "denied");
  eq(text.serverRiskClass, "irreversible");
  eq(text.riskSource, "fail_closed_default");
});

test("tfa_check_action fail-closed: missing tenantId → error", async () => {
  const { server } = makeServer();
  const args = { actorId: "a1", toolId: "file.read", resourceRef: "r1", nonce: "n1", expiry: FIXED_NOW() };
  const r = await server.handleRequest(req("tools/call", { name: "tfa_check_action", arguments: args }));
  eq(r!.error!.code, -32603);
  assert(r!.error!.message.includes("tenantId"), "error mentions tenantId");
});

// ── tfa_start_execution ──

test("tfa_start_execution allowed → opens workflow and returns executionId", async () => {
  const { server, store } = makeServer();
  const args = intentArgs({ toolId: "file.read" });
  const r = await server.handleRequest(req("tools/call", { name: "tfa_start_execution", arguments: args }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.ok, true);
  eq(text.decision, "allowed");
  assert(text.receipt.signature.length > 0, "receipt signed");
  assert(text.executionId, "executionId present");
  eq(text.workflow!.status, "running");

  // verify receipt
  assert(verifyExecutionReceipt(text.receipt, signer), "receipt self-verifies");
});

test("tfa_start_execution approval_required → returns approvalToken", async () => {
  const { server, store } = makeServer();
  const args = intentArgs({ toolId: "file.delete", riskClass: "write_destructive" });
  const r = await server.handleRequest(req("tools/call", { name: "tfa_start_execution", arguments: args }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.ok, true);
  eq(text.decision, "approval_required");
  assert(text.approvalToken, "approvalToken present");
  eq(text.workflow!.status, "planned");
});

test("tfa_start_execution denied → no workflow opened", async () => {
  const { server, store } = makeServer();
  const args = intentArgs({ toolId: "shell.exec", riskClass: "read_only" });
  const r = await server.handleRequest(req("tools/call", { name: "tfa_start_execution", arguments: args }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.ok, true);
  eq(text.decision, "denied");
  eq(text.executionId, undefined);
  eq(text.approvalToken, undefined);
  eq(text.workflow, undefined);
});

// ── tfa_approve_execution ──

test("tfa_approve_execution advances planned → running", async () => {
  const { server, store } = makeServer();
  // open a workflow needing approval
  const startArgs = intentArgs({ toolId: "file.delete", riskClass: "write_destructive" });
  const startRes = await server.handleRequest(req("tools/call", { name: "tfa_start_execution", arguments: startArgs }));
  const startText = JSON.parse(startRes!.result!.content[0].text);
  const token = startText.approvalToken as string;

  // approve
  const approveArgs = { tenantId: "t1", executionId: token, actor: "human-1", reason: "looks safe" };
  const approveRes = await server.handleRequest(req("tools/call", { name: "tfa_approve_execution", arguments: approveArgs }));
  eq(approveRes!.error, undefined);
  const approveText = JSON.parse(approveRes!.result!.content[0].text);
  eq(approveText.ok, true);
  eq(approveText.workflow.status, "running");
});

test("tfa_approve_execution fail-closed: wrong tenant → not found", async () => {
  const { server, store } = makeServer();
  const startArgs = intentArgs({ toolId: "file.delete", riskClass: "write_destructive" });
  const startRes = await server.handleRequest(req("tools/call", { name: "tfa_start_execution", arguments: startArgs }));
  const token = JSON.parse(startRes!.result!.content[0].text).approvalToken as string;

  const approveArgs = { tenantId: "t2", executionId: token };
  const approveRes = await server.handleRequest(req("tools/call", { name: "tfa_approve_execution", arguments: approveArgs }));
  eq(approveRes!.error, undefined);
  const approveText = JSON.parse(approveRes!.result!.content[0].text);
  eq(approveText.ok, false);
  eq(approveText.error, "workflow not found");
});

test("tfa_approve_execution fail-closed: already running → error", async () => {
  const { server, store } = makeServer();
  const startArgs = intentArgs({ toolId: "file.read" });
  const startRes = await server.handleRequest(req("tools/call", { name: "tfa_start_execution", arguments: startArgs }));
  const execId = JSON.parse(startRes!.result!.content[0].text).executionId as string;

  const approveArgs = { tenantId: "t1", executionId: execId };
  const approveRes = await server.handleRequest(req("tools/call", { name: "tfa_approve_execution", arguments: approveArgs }));
  eq(approveRes!.error, undefined);
  const approveText = JSON.parse(approveRes!.result!.content[0].text);
  eq(approveText.ok, false);
  assert(approveText.error.includes("planned"), "error mentions planned");
});

// ── tfa_get_receipt ──

test("tfa_get_receipt returns signed status receipt for a workflow", async () => {
  const { server, store } = makeServer();
  const startArgs = intentArgs({ toolId: "file.read" });
  const startRes = await server.handleRequest(req("tools/call", { name: "tfa_start_execution", arguments: startArgs }));
  const execId = JSON.parse(startRes!.result!.content[0].text).executionId as string;

  const getArgs = { tenantId: "t1", executionId: execId };
  const getRes = await server.handleRequest(req("tools/call", { name: "tfa_get_receipt", arguments: getArgs }));
  eq(getRes!.error, undefined);
  const getText = JSON.parse(getRes!.result!.content[0].text);
  eq(getText.ok, true);
  eq(getText.receipt.version, "tfa-status-receipt-v1");
  eq(getText.receipt.executionId, execId);
  assert(getText.receipt.signature.length > 0, "status receipt signed");
  eq(getText.workflow.status, "running");
});

test("tfa_get_receipt fail-closed: unknown id → not found", async () => {
  const { server } = makeServer();
  const getArgs = { tenantId: "t1", executionId: "no-such-id" };
  const getRes = await server.handleRequest(req("tools/call", { name: "tfa_get_receipt", arguments: getArgs }));
  eq(getRes!.error, undefined);
  const getText = JSON.parse(getRes!.result!.content[0].text);
  eq(getText.ok, false);
  eq(getText.error, "workflow not found");
});

// ── tfa_verify_receipt ──

test("tfa_verify_receipt returns valid=true for a genuine receipt", async () => {
  const { server } = makeServer();
  const startArgs = intentArgs({ toolId: "file.read" });
  const startRes = await server.handleRequest(req("tools/call", { name: "tfa_start_execution", arguments: startArgs }));
  const receipt = JSON.parse(startRes!.result!.content[0].text).receipt;

  const verifyArgs = { receipt };
  const verifyRes = await server.handleRequest(req("tools/call", { name: "tfa_verify_receipt", arguments: verifyArgs }));
  eq(verifyRes!.error, undefined);
  const verifyText = JSON.parse(verifyRes!.result!.content[0].text);
  eq(verifyText.ok, true);
  eq(verifyText.valid, true);
  eq(verifyText.signatureValid, true);
  eq(verifyText.decisionValid, true);
  eq(verifyText.reasons.length, 0);
});

test("tfa_verify_receipt returns valid=false for a tampered receipt (signature broken, decision still sound)", async () => {
  const { server } = makeServer();
  const startArgs = intentArgs({ toolId: "file.read" });
  const startRes = await server.handleRequest(req("tools/call", { name: "tfa_start_execution", arguments: startArgs }));
  const receipt = JSON.parse(startRes!.result!.content[0].text).receipt;
  receipt.tenantId = "tampered"; // breaks signature, but decision fields are unchanged

  const verifyArgs = { receipt };
  const verifyRes = await server.handleRequest(req("tools/call", { name: "tfa_verify_receipt", arguments: verifyArgs }));
  eq(verifyRes!.error, undefined);
  const verifyText = JSON.parse(verifyRes!.result!.content[0].text);
  eq(verifyText.ok, true);
  eq(verifyText.valid, false);
  eq(verifyText.signatureValid, false);
  eq(verifyText.decisionValid, true); // tenantId tampering does not affect policy re-derivation
  eq(verifyText.reasons.length, 1);
  assert(verifyText.reasons.some((r: string) => r.includes("authenticity") || r.includes("signature")), "tampered receipt must report authenticity reason");
});

test("tfa_verify_receipt catches tampered decision (decision integrity fails)", async () => {
  const { server } = makeServer();
  const startArgs = intentArgs({ toolId: "file.delete" });
  const startRes = await server.handleRequest(req("tools/call", { name: "tfa_start_execution", arguments: startArgs }));
  const receipt = JSON.parse(startRes!.result!.content[0].text).receipt;
  receipt.decision = "allowed"; // wrong decision for file.delete

  const verifyArgs = { receipt };
  const verifyRes = await server.handleRequest(req("tools/call", { name: "tfa_verify_receipt", arguments: verifyArgs }));
  eq(verifyRes!.error, undefined);
  const verifyText = JSON.parse(verifyRes!.result!.content[0].text);
  eq(verifyText.ok, true);
  eq(verifyText.valid, false);
  eq(verifyText.signatureValid, false); // decision is part of signed payload
  eq(verifyText.decisionValid, false);
  assert(verifyText.reasons.length > 0, "tampered decision must produce reasons");
});

test("tfa_verify_receipt fail-closed: missing receipt → error", async () => {
  const { server } = makeServer();
  const verifyRes = await server.handleRequest(req("tools/call", { name: "tfa_verify_receipt", arguments: {} }));
  eq(verifyRes!.error, undefined);
  const verifyText = JSON.parse(verifyRes!.result!.content[0].text);
  eq(verifyText.ok, false);
  eq(verifyText.error, "receipt must be an object");
});

// ── v274: MCP tfa_verify_receipt → verifyTfaProof מאוחד עם AP2 mandateLinkage ──

test("tfa_verify_receipt with valid AP2 mandateLinkage → mandateLinkageValid=true, overall valid", async () => {
  const { server } = makeServer();
  const startArgs = intentArgs({ toolId: "token.swap" });
  const startRes = await server.handleRequest(req("tools/call", { name: "tfa_start_execution", arguments: startArgs }));
  const receipt = JSON.parse(startRes!.result!.content[0].text).receipt;
  const linkage = linkReceiptToMandates(receipt, [{ type: "intent", id: "urn:ap2:intent:mcp-1" }], signer);

  const verifyRes = await server.handleRequest(req("tools/call", { name: "tfa_verify_receipt", arguments: { receipt, mandateLinkage: linkage } }));
  eq(verifyRes!.error, undefined);
  const verifyText = JSON.parse(verifyRes!.result!.content[0].text);
  eq(verifyText.ok, true);
  eq(verifyText.valid, true);
  eq(verifyText.signatureValid, true);
  eq(verifyText.decisionValid, true);
  eq(verifyText.mandateLinkageValid, true);
  eq(verifyText.reasons.length, 0);
});

test("tfa_verify_receipt with tampered AP2 mandateLinkage → mandateLinkageValid=false, overall invalid", async () => {
  const { server } = makeServer();
  const startArgs = intentArgs({ toolId: "token.swap" });
  const startRes = await server.handleRequest(req("tools/call", { name: "tfa_start_execution", arguments: startArgs }));
  const receipt = JSON.parse(startRes!.result!.content[0].text).receipt;
  const linkage = linkReceiptToMandates(receipt, [{ type: "intent", id: "urn:ap2:intent:mcp-2" }], signer);
  const tampered = { ...linkage, mandates: [{ type: "intent", id: "urn:ap2:intent:EVIL" }] };

  const verifyRes = await server.handleRequest(req("tools/call", { name: "tfa_verify_receipt", arguments: { receipt, mandateLinkage: tampered } }));
  eq(verifyRes!.error, undefined);
  const verifyText = JSON.parse(verifyRes!.result!.content[0].text);
  eq(verifyText.ok, true);
  eq(verifyText.valid, false);
  eq(verifyText.mandateLinkageValid, false);
  assert(verifyText.reasons.some((r: string) => r.includes("mandateLinkage")), "tampered linkage must produce mandateLinkage reason");
});

test("tfa_verify_receipt without mandateLinkage → field absent (additive, no breakage)", async () => {
  const { server } = makeServer();
  const startArgs = intentArgs({ toolId: "file.read" });
  const startRes = await server.handleRequest(req("tools/call", { name: "tfa_start_execution", arguments: startArgs }));
  const receipt = JSON.parse(startRes!.result!.content[0].text).receipt;

  const verifyRes = await server.handleRequest(req("tools/call", { name: "tfa_verify_receipt", arguments: { receipt } }));
  eq(verifyRes!.error, undefined);
  const verifyText = JSON.parse(verifyRes!.result!.content[0].text);
  eq(verifyText.ok, true);
  eq(verifyText.valid, true);
  eq(verifyText.signatureValid, true);
  eq(verifyText.decisionValid, true);
  eq(verifyText.mandateLinkageValid, undefined);
  eq(verifyText.reasons.length, 0);
});

// ── tfa_verify_ard_agent ──

async function makeArdTrustManifest(identity: string, signer: any, extra: any = {}) {
  const { canonicalizeJson, createDetachedJws } = await import("../../lib/adapter/ard-publisher.ts");
  const payload = { identity, identityType: "did" as const, ...extra };
  const canonical = canonicalizeJson(payload);
  const signature = createDetachedJws(canonical, signer);
  return { ...payload, signature };
}

test("tfa_verify_ard_agent returns valid=true for matching did:web + valid JWS", async () => {
  const { server } = makeServer();
  const tm = await makeArdTrustManifest("did:web:example.com", server.cfg.signer, {
    attestations: [{ type: "TFA", uri: "https://tfa.dev/verify/1", digest: "abc123" }],
  });
  const r = await server.handleRequest(req("tools/call", { name: "tfa_verify_ard_agent", arguments: { urn: "urn:ai:example.com:ns:agent", trustManifest: tm } }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.ok, true);
  eq(text.valid, true);
  eq(text.checks.urnWellFormed, true);
  eq(text.checks.domainAlignment, true);
  eq(text.checks.jwsValid, true);
  eq(text.checks.attestationsResolvable, true);
});

test("tfa_verify_ard_agent returns valid=false for domain mismatch", async () => {
  const { server } = makeServer();
  const tm = await makeArdTrustManifest("did:web:evil.com", server.cfg.signer);
  const r = await server.handleRequest(req("tools/call", { name: "tfa_verify_ard_agent", arguments: { urn: "urn:ai:example.com:ns:agent", trustManifest: tm } }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.ok, true);
  eq(text.valid, false);
  eq(text.checks.domainAlignment, false);
});

test("tfa_verify_ard_agent fail-closed: missing urn → error", async () => {
  const { server } = makeServer();
  const tm = await makeArdTrustManifest("did:web:example.com", server.cfg.signer);
  const r = await server.handleRequest(req("tools/call", { name: "tfa_verify_ard_agent", arguments: { trustManifest: tm } }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.ok, false);
  eq(text.error, "urn is required and must be a string");
});

// ── JSON-RPC edge cases ──

test("invalid jsonrpc version returns error", async () => {
  const { server } = makeServer();
  const r = await server.handleRequest({ jsonrpc: "1.0", id: 1, method: "initialize" } as any);
  eq(r!.error!.code, -32600);
});

test("unknown method returns error", async () => {
  const { server } = makeServer();
  const r = await server.handleRequest(req("unknown/method"));
  eq(r!.error!.code, -32601);
});
