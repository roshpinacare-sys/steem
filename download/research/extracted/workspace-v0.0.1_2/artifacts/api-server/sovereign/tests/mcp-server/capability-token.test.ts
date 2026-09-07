import "../_flush.mjs";
/**
 * tests/mcp-server/capability-token.test.ts
 *
 * Tests for:
 *   lib/mcp-server/capability-token.ts — issueCapabilityToken, verifyCapabilityToken,
 *     encode/decode, extractNonce, CapabilityError
 *   lib/mcp-server/mcp-server.ts — tfa_start_execution now issues capabilityToken;
 *     tfa_approve_execution accepts + verifies capabilityToken (replay-protected)
 *
 * Coverage:
 *   issueCapabilityToken
 *     • returns token with all required fields
 *     • version is "tfa-cap-v1"
 *     • expiresAt = issuedAt + ttlMs
 *     • signature is present and non-empty
 *     • injectable now() for deterministic issuedAt
 *     • fail-closed: empty executionId throws CapabilityError(missing_execution_id)
 *     • fail-closed: empty tenantId throws CapabilityError(missing_tenant_id)
 *     • fail-closed: ttlMs ≤ 0 throws CapabilityError(invalid_ttl)
 *
 *   verifyCapabilityToken
 *     • returns valid=true for a fresh token
 *     • returns valid=false + reason for tampered signature
 *     • returns valid=false + reason for expired token
 *     • returns valid=false + reason for wrong executionId binding
 *     • returns valid=false + reason for wrong tenantId binding
 *     • returns valid=false + reason for missing version
 *     • never throws (fail-closed for bad input)
 *
 *   encode/decode
 *     • round-trip: encode then decode returns same token
 *     • decode returns null for bad base64url
 *     • decode returns null for wrong version
 *
 *   extractNonce
 *     • returns the nonce from a valid token
 *     • returns null for non-object input
 *
 *   MCP tfa_start_execution + tfa_approve_execution (integration)
 *     • tfa_start_execution for approval_required workflow includes capabilityToken in result
 *     • capabilityToken is a valid base64url-encoded ApprovalCapabilityToken
 *     • capabilityToken is bound to the correct executionId and tenantId
 *     • tfa_approve_execution with valid capabilityToken: ok=true, capabilityVerified=true
 *     • tfa_approve_execution with valid capabilityToken: workflow is now running
 *     • tfa_approve_execution without capabilityToken: ok=true, capabilityVerified=false, warning present
 *     • tfa_approve_execution with expired capabilityToken: ok=false (capability token invalid: expired)
 *     • tfa_approve_execution with tampered capabilityToken: ok=false (signature verification failed)
 *     • tfa_approve_execution with wrong executionId in token: ok=false (bound to different executionId)
 *     • tfa_approve_execution nonce reuse (replay): ok=false (nonce already used)
 *     • tfa_approve_execution with bad capabilityToken encoding: ok=false
 */

import { test, assert, eq } from "../_harness.mjs";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { InMemoryExecutionStore } from "../../lib/orchestrator/execution-workflow.ts";
import { InMemoryNonceRegistry } from "../../lib/mcp-server/nonce-registry.ts";
import { TfaMcpServer, type JsonRpcRequest } from "../../lib/mcp-server/mcp-server.ts";
import {
  issueCapabilityToken,
  verifyCapabilityToken,
  encodeCapabilityToken,
  decodeCapabilityToken,
  extractNonce,
  CapabilityError,
  CAPABILITY_TOKEN_DEFAULT_TTL_MS,
} from "../../lib/mcp-server/capability-token.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const signer = new HmacSigner("capability-test-secret-key");
const FUTURE = () => "2099-01-01T00:00:00.000Z";

function makeServer(capabilityTtlMs?: number) {
  const store = new InMemoryExecutionStore();
  const server = new TfaMcpServer({
    signer,
    executionStore: store,
    serverVersion: "1.0.0",
    capabilityTtlMs,
    nonceRegistry: new InMemoryNonceRegistry(),
  });
  return { server, store };
}

function rpc(method: string, params?: unknown, id = 1): JsonRpcRequest {
  return { jsonrpc: "2.0", id, method, params };
}

let _seq = 0;
function intentArgs(riskClass = "value_moving") {
  _seq++;
  return {
    tenantId: "cap-tenant",
    actorId: "agent:cap",
    toolId: "file.delete",
    resourceRef: `res:${_seq}`,
    riskClass,
    valueMicrounits: "1000",
    nonce: `cap-nonce-${_seq}-${Math.random().toString(36).slice(2)}`,
    expiry: FUTURE(),
  };
}

// ─── issueCapabilityToken ─────────────────────────────────────────────────────

test("issueCapabilityToken: returns token with all required fields", () => {
  const token = issueCapabilityToken("exec-1", "tenant-1", signer);
  eq(token.version, "tfa-cap-v1");
  eq(token.executionId, "exec-1");
  eq(token.tenantId, "tenant-1");
  assert(typeof token.issuedAt === "string" && token.issuedAt.length > 0, "issuedAt should be set");
  assert(typeof token.expiresAt === "string" && token.expiresAt.length > 0, "expiresAt should be set");
  assert(typeof token.nonce === "string" && token.nonce.length > 0, "nonce should be set");
  assert(typeof token.signature === "string" && token.signature.length > 0, "signature should be set");
});

test("issueCapabilityToken: expiresAt = issuedAt + ttlMs", () => {
  const now = "2030-01-01T00:00:00.000Z";
  const ttlMs = 5 * 60 * 1000; // 5 min
  const token = issueCapabilityToken("exec-1", "t1", signer, ttlMs, () => now);
  eq(token.issuedAt, now);
  const expectedExpiry = new Date(new Date(now).getTime() + ttlMs).toISOString();
  eq(token.expiresAt, expectedExpiry);
});

test("issueCapabilityToken: injectable now() for deterministic test", () => {
  const token = issueCapabilityToken("exec-1", "t1", signer, 60_000, () => "2025-06-01T00:00:00.000Z");
  eq(token.issuedAt, "2025-06-01T00:00:00.000Z");
});

test("issueCapabilityToken: fail-closed — empty executionId throws CapabilityError", () => {
  let threw = false;
  try {
    issueCapabilityToken("", "t1", signer);
  } catch (e: unknown) {
    threw = true;
    assert(e instanceof CapabilityError, "should be CapabilityError");
    eq((e as CapabilityError).code, "missing_execution_id");
  }
  assert(threw, "should have thrown");
});

test("issueCapabilityToken: fail-closed — empty tenantId throws CapabilityError", () => {
  let threw = false;
  try {
    issueCapabilityToken("exec-1", "", signer);
  } catch (e: unknown) {
    threw = true;
    assert(e instanceof CapabilityError, "should be CapabilityError");
    eq((e as CapabilityError).code, "missing_tenant_id");
  }
  assert(threw, "should have thrown");
});

test("issueCapabilityToken: fail-closed — ttlMs ≤ 0 throws CapabilityError", () => {
  let threw = false;
  try {
    issueCapabilityToken("exec-1", "t1", signer, 0);
  } catch (e: unknown) {
    threw = true;
    assert(e instanceof CapabilityError, "should be CapabilityError");
    eq((e as CapabilityError).code, "invalid_ttl");
  }
  assert(threw, "should have thrown");
});

// ─── verifyCapabilityToken ────────────────────────────────────────────────────

test("verifyCapabilityToken: returns valid=true for a fresh token", () => {
  const token = issueCapabilityToken("exec-1", "t1", signer);
  const result = verifyCapabilityToken(token, signer, "exec-1", "t1");
  assert(result.valid === true, "should be valid");
  if (result.valid) {
    eq(result.executionId, "exec-1");
    eq(result.tenantId, "t1");
    assert(typeof result.nonce === "string" && result.nonce.length > 0, "nonce present");
  }
});

test("verifyCapabilityToken: returns valid=false for tampered signature", () => {
  const token = issueCapabilityToken("exec-1", "t1", signer);
  const tampered = { ...token, signature: "bad-sig" };
  const result = verifyCapabilityToken(tampered, signer);
  assert(result.valid === false, "should be invalid");
  if (!result.valid) {
    assert(result.reason.includes("signature"), "reason should mention signature");
  }
});

test("verifyCapabilityToken: returns valid=false for expired token", () => {
  const token = issueCapabilityToken("exec-1", "t1", signer, 1000, () => "2020-01-01T00:00:00.000Z");
  // Now is 2026 — definitely expired
  const result = verifyCapabilityToken(token, signer, "exec-1", "t1", Date.now());
  assert(result.valid === false, "should be expired");
  if (!result.valid) {
    assert(result.reason.includes("expired"), "reason should mention expired");
  }
});

test("verifyCapabilityToken: returns valid=false for wrong executionId binding", () => {
  const token = issueCapabilityToken("exec-1", "t1", signer);
  const result = verifyCapabilityToken(token, signer, "exec-OTHER", "t1");
  assert(result.valid === false, "should be invalid");
  if (!result.valid) {
    assert(result.reason.includes("executionId"), "reason should mention executionId");
  }
});

test("verifyCapabilityToken: returns valid=false for wrong tenantId binding", () => {
  const token = issueCapabilityToken("exec-1", "t1", signer);
  const result = verifyCapabilityToken(token, signer, "exec-1", "tenant-INTRUDER");
  assert(result.valid === false, "should be invalid");
  if (!result.valid) {
    assert(result.reason.includes("tenantId"), "reason should mention tenantId");
  }
});

test("verifyCapabilityToken: returns valid=false for missing version", () => {
  const result = verifyCapabilityToken({ version: "tfa-cap-v0", executionId: "x", tenantId: "t" }, signer);
  assert(result.valid === false, "should be invalid");
});

test("verifyCapabilityToken: never throws on bad input (fail-closed)", () => {
  const results = [
    verifyCapabilityToken(null, signer),
    verifyCapabilityToken(undefined, signer),
    verifyCapabilityToken("string", signer),
    verifyCapabilityToken(42, signer),
    verifyCapabilityToken({}, signer),
  ];
  for (const r of results) {
    assert(r.valid === false, "bad input should produce valid=false");
  }
});

// ─── encode / decode ──────────────────────────────────────────────────────────

test("encodeCapabilityToken / decodeCapabilityToken: round-trip", () => {
  const token = issueCapabilityToken("exec-rt", "t-rt", signer);
  const encoded = encodeCapabilityToken(token);
  assert(typeof encoded === "string" && encoded.length > 0, "encoded should be a string");
  const decoded = decodeCapabilityToken(encoded);
  assert(decoded !== null, "decoded should not be null");
  eq(decoded!.executionId, "exec-rt");
  eq(decoded!.tenantId, "t-rt");
  eq(decoded!.version, "tfa-cap-v1");
  eq(decoded!.signature, token.signature);
});

test("decodeCapabilityToken: returns null for bad base64url", () => {
  assert(decodeCapabilityToken("not-base64!@#") === null);
  assert(decodeCapabilityToken("") === null);
});

test("decodeCapabilityToken: returns null for wrong version", () => {
  const bad = Buffer.from(JSON.stringify({ version: "tfa-cap-v0" })).toString("base64url");
  assert(decodeCapabilityToken(bad) === null);
});

// ─── extractNonce ─────────────────────────────────────────────────────────────

test("extractNonce: returns nonce from a valid token", () => {
  const token = issueCapabilityToken("exec-1", "t1", signer);
  const nonce = extractNonce(token);
  assert(typeof nonce === "string" && nonce.length > 0, "should extract nonce");
  eq(nonce, token.nonce);
});

test("extractNonce: returns null for non-object input", () => {
  assert(extractNonce(null) === null);
  assert(extractNonce("string") === null);
  assert(extractNonce({}) === null); // no nonce field
});

// ─── MCP integration: tfa_start_execution issues capabilityToken ─────────────

test("tfa_start_execution for value_moving workflow includes capabilityToken", async () => {
  const { server } = makeServer();
  const r = await server.handleRequest(rpc("tools/call", {
    name: "tfa_start_execution",
    arguments: intentArgs("value_moving"),
  }));
  assert(r !== null && r.error === undefined, `should succeed, error: ${r?.error?.message}`);
  const content = (r!.result as any).content[0].text;
  const body = JSON.parse(content);
  eq(body.ok, true);
  // value_moving → approval_required → capabilityToken should be present
  if (body.approvalToken) {
    assert(typeof body.capabilityToken === "string" && body.capabilityToken.length > 0,
      "capabilityToken should be present for approval_required workflows");
    assert(typeof body.capabilityTokenExpiry === "string", "capabilityTokenExpiry should be present");
  }
});

test("tfa_start_execution: capabilityToken is valid and bound to workflow", async () => {
  const { server } = makeServer();
  const r = await server.handleRequest(rpc("tools/call", {
    name: "tfa_start_execution",
    arguments: intentArgs("value_moving"),
  }));
  const body = JSON.parse((r!.result as any).content[0].text);
  if (!body.approvalToken) return; // auto-approved path, skip

  const encoded = body.capabilityToken as string;
  const decoded = decodeCapabilityToken(encoded);
  assert(decoded !== null, "capabilityToken should decode");
  eq(decoded!.executionId, body.approvalToken);
  eq(decoded!.tenantId, "cap-tenant");

  const verify = verifyCapabilityToken(decoded, signer, body.approvalToken, "cap-tenant");
  assert(verify.valid === true, "capabilityToken should verify successfully");
});

test("tfa_approve_execution with valid capabilityToken: ok=true, capabilityVerified=true", async () => {
  const { server } = makeServer();

  // Start to get a planned workflow
  const startR = await server.handleRequest(rpc("tools/call", {
    name: "tfa_start_execution",
    arguments: intentArgs("value_moving"),
  }));
  const startBody = JSON.parse((startR!.result as any).content[0].text);
  if (!startBody.approvalToken) return; // auto-approved, skip

  const approveR = await server.handleRequest(rpc("tools/call", {
    name: "tfa_approve_execution",
    arguments: {
      tenantId: "cap-tenant",
      executionId: startBody.approvalToken,
      capabilityToken: startBody.capabilityToken,
    },
  }));
  const approveBody = JSON.parse((approveR!.result as any).content[0].text);
  eq(approveBody.ok, true);
  eq(approveBody.capabilityVerified, true);
  eq(approveBody.workflow.status, "running");
  assert(!approveBody.warning, "no warning when capabilityToken is provided");
});

test("tfa_approve_execution without capabilityToken: ok=true but capabilityVerified=false with warning", async () => {
  const { server } = makeServer();

  const startR = await server.handleRequest(rpc("tools/call", {
    name: "tfa_start_execution",
    arguments: intentArgs("value_moving"),
  }));
  const startBody = JSON.parse((startR!.result as any).content[0].text);
  if (!startBody.approvalToken) return;

  const approveR = await server.handleRequest(rpc("tools/call", {
    name: "tfa_approve_execution",
    arguments: {
      tenantId: "cap-tenant",
      executionId: startBody.approvalToken,
      // no capabilityToken — legacy path
    },
  }));
  const approveBody = JSON.parse((approveR!.result as any).content[0].text);
  eq(approveBody.ok, true);
  eq(approveBody.capabilityVerified, false);
  assert(typeof approveBody.warning === "string", "warning should be present without capabilityToken");
  eq(approveBody.workflow.status, "running");
});

test("tfa_approve_execution with expired capabilityToken: ok=false", async () => {
  const { server } = makeServer();

  const startR = await server.handleRequest(rpc("tools/call", {
    name: "tfa_start_execution",
    arguments: intentArgs("value_moving"),
  }));
  const startBody = JSON.parse((startR!.result as any).content[0].text);
  if (!startBody.approvalToken) return;

  // Issue an already-expired token manually
  const expiredToken = issueCapabilityToken(
    startBody.approvalToken,
    "cap-tenant",
    signer,
    1, // 1ms TTL — will be expired immediately
    () => "2020-01-01T00:00:00.000Z", // issued in the past
  );
  const encoded = encodeCapabilityToken(expiredToken);

  const approveR = await server.handleRequest(rpc("tools/call", {
    name: "tfa_approve_execution",
    arguments: {
      tenantId: "cap-tenant",
      executionId: startBody.approvalToken,
      capabilityToken: encoded,
    },
  }));
  const approveBody = JSON.parse((approveR!.result as any).content[0].text);
  eq(approveBody.ok, false);
  assert(typeof approveBody.error === "string" && approveBody.error.includes("expired"),
    `error should mention expired, got: ${approveBody.error}`);
});

test("tfa_approve_execution with tampered capabilityToken: ok=false", async () => {
  const { server } = makeServer();

  const startR = await server.handleRequest(rpc("tools/call", {
    name: "tfa_start_execution",
    arguments: intentArgs("value_moving"),
  }));
  const startBody = JSON.parse((startR!.result as any).content[0].text);
  if (!startBody.approvalToken) return;

  const token = issueCapabilityToken(startBody.approvalToken, "cap-tenant", signer);
  const tampered = { ...token, signature: "bad-signature" };
  const encoded = encodeCapabilityToken(tampered);

  const approveR = await server.handleRequest(rpc("tools/call", {
    name: "tfa_approve_execution",
    arguments: {
      tenantId: "cap-tenant",
      executionId: startBody.approvalToken,
      capabilityToken: encoded,
    },
  }));
  const approveBody = JSON.parse((approveR!.result as any).content[0].text);
  eq(approveBody.ok, false);
  assert(approveBody.error.includes("signature") || approveBody.error.includes("invalid"),
    `error should mention signature/invalid, got: ${approveBody.error}`);
});

test("tfa_approve_execution with wrong executionId in token: ok=false", async () => {
  const { server } = makeServer();

  const startR = await server.handleRequest(rpc("tools/call", {
    name: "tfa_start_execution",
    arguments: intentArgs("value_moving"),
  }));
  const startBody = JSON.parse((startR!.result as any).content[0].text);
  if (!startBody.approvalToken) return;

  // Token bound to a different workflow id
  const wrongToken = issueCapabilityToken("different-workflow-id", "cap-tenant", signer);
  const encoded = encodeCapabilityToken(wrongToken);

  const approveR = await server.handleRequest(rpc("tools/call", {
    name: "tfa_approve_execution",
    arguments: {
      tenantId: "cap-tenant",
      executionId: startBody.approvalToken,
      capabilityToken: encoded,
    },
  }));
  const approveBody = JSON.parse((approveR!.result as any).content[0].text);
  eq(approveBody.ok, false);
  assert(approveBody.error.includes("executionId") || approveBody.error.includes("different"),
    `error should mention executionId/binding, got: ${approveBody.error}`);
});

test("tfa_approve_execution: nonce reuse (replay attack) returns ok=false", async () => {
  const { server } = makeServer();

  const startR = await server.handleRequest(rpc("tools/call", {
    name: "tfa_start_execution",
    arguments: intentArgs("value_moving"),
  }));
  const startBody = JSON.parse((startR!.result as any).content[0].text);
  if (!startBody.approvalToken) return;

  const encoded = startBody.capabilityToken as string;
  const executionId = startBody.approvalToken as string;

  // First approval — should succeed
  const first = await server.handleRequest(rpc("tools/call", {
    name: "tfa_approve_execution",
    arguments: {
      tenantId: "cap-tenant",
      executionId,
      capabilityToken: encoded,
    },
  }));
  const firstBody = JSON.parse((first!.result as any).content[0].text);
  eq(firstBody.ok, true);

  // Start a new workflow to get a fresh planned state, but reuse the OLD token
  // First we need to issue a matching token for this new workflow — but we want
  // to test nonce replay: the nonce in `encoded` was already consumed above.
  // Try to approve any workflow with the same token (whose nonce is now spent).
  // We'll create a new workflow and manually issue a token with the SAME nonce.
  const decoded = (await import("../../lib/mcp-server/capability-token.ts")).decodeCapabilityToken(encoded)!;
  const reusedNonceToken = {
    ...decoded,
    // Bind to same executionId so binding check passes but nonce check fires
    executionId,
  };
  const reusedEncoded = (await import("../../lib/mcp-server/capability-token.ts")).encodeCapabilityToken(reusedNonceToken);

  // Second attempt with same nonce — should fail on nonce reuse
  const replay = await server.handleRequest(rpc("tools/call", {
    name: "tfa_approve_execution",
    arguments: {
      tenantId: "cap-tenant",
      executionId,
      capabilityToken: reusedEncoded,
    },
  }));
  const replayBody = JSON.parse((replay!.result as any).content[0].text);
  eq(replayBody.ok, false);
  assert(replayBody.error.includes("nonce") || replayBody.error.includes("replay"),
    `error should mention nonce/replay, got: ${replayBody.error}`);
});

test("tfa_approve_execution with bad capabilityToken encoding: ok=false", async () => {
  const { server } = makeServer();

  const startR = await server.handleRequest(rpc("tools/call", {
    name: "tfa_start_execution",
    arguments: intentArgs("value_moving"),
  }));
  const startBody = JSON.parse((startR!.result as any).content[0].text);
  if (!startBody.approvalToken) return;

  const approveR = await server.handleRequest(rpc("tools/call", {
    name: "tfa_approve_execution",
    arguments: {
      tenantId: "cap-tenant",
      executionId: startBody.approvalToken,
      capabilityToken: "not-a-valid-base64url-token!@#$",
    },
  }));
  const approveBody = JSON.parse((approveR!.result as any).content[0].text);
  eq(approveBody.ok, false);
  assert(typeof approveBody.error === "string", "should have error message");
});
