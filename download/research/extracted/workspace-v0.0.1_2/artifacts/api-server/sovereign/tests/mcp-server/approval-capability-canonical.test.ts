import "../_flush.mjs";
/**
 * tests/mcp-server/approval-capability-canonical.test.ts — v196
 *
 * approvalToken migration — substep 3 (MCP consumer):
 *
 * The MCP tool `tfa_approve_execution` must accept the capability token under
 * its canonical receipt-field name (`approvalCapabilityToken`) in addition to
 * the legacy `capabilityToken` alias. Verification (signature + tenant binding
 * + executionId binding + TTL + nonce-replay) runs BEFORE the planned→approved
 * transition (fail-closed). Bare-executionId approval is DEPRECATED and emits
 * `deprecated:true` + a migration-warning string.
 *
 * Covers:
 *   • HAPPY     tfa_start_execution exposes `approvalCapabilityToken` mirror
 *               (identical to legacy `capabilityToken`), and the receipt itself
 *               carries `approvalCapabilityToken`.
 *   • HAPPY     approve using only `approvalCapabilityToken` → ok=true,
 *               capabilityVerified=true, no deprecation warning.
 *   • HAPPY     approve using only `capabilityToken` (legacy alias) → ok=true,
 *               capabilityVerified=true (backward-compatible).
 *   • EDGE      both fields supplied & identical → ok=true; differing → ok=false
 *               (workflow stays planned).
 *   • FAIL-CLOSED  invalid `approvalCapabilityToken` (wrong tenant) → ok=false,
 *               workflow stays planned.
 *   • FAIL-CLOSED  non-string `approvalCapabilityToken` → ok=false, planned.
 *   • DEPRECATION  bare-executionId approval → ok=true, deprecated=true, warning
 *               mentions DEPRECATED + approvalCapabilityToken.
 *
 * Zero external dependencies.
 */

import { test, assert, eq } from "../_harness.mjs";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { InMemoryExecutionStore } from "../../lib/orchestrator/execution-workflow.ts";
import { TfaMcpServer, type JsonRpcRequest } from "../../lib/mcp-server/mcp-server.ts";
import { InMemoryNonceRegistry } from "../../lib/mcp-server/nonce-registry.ts";
import {
  encodeCapabilityToken,
  issueCapabilityToken,
} from "../../lib/mcp-server/capability-token.ts";

const signer = new HmacSigner("mcp-approval-canonical-test-secret");

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

function rpc(method: string, params?: unknown, id = 1): JsonRpcRequest {
  return { jsonrpc: "2.0", id, method, params };
}

let _seq = 0;
function intentArgs() {
  _seq++;
  return {
    tenantId: "mcp-cap-canon",
    actorId: "agent:cap",
    toolId: "file.delete",
    resourceRef: `res:${_seq}`,
    riskClass: "value_moving",
    valueMicrounits: "1000",
    nonce: `cap-nonce-${_seq}-${Math.random().toString(36).slice(2)}`,
    expiry: "2099-01-01T00:00:00.000Z",
  };
}

function bodyOf(resp: any): any {
  return JSON.parse((resp!.result as any).content[0].text);
}

async function startPlanned(server: TfaMcpServer) {
  const r = await server.handleRequest(rpc("tools/call", {
    name: "tfa_start_execution",
    arguments: intentArgs(),
  }));
  const b = bodyOf(r);
  assert(b.approvalToken, "test precondition: start must yield a planned approvalToken");
  return b;
}

// ─── HAPPY: start_execution mirrors canonical name ───────────────────────────

test("tfa_start_execution exposes approvalCapabilityToken mirror + receipt carries it", async () => {
  const { server } = makeServer();
  const b = await startPlanned(server);
  assert(typeof b.capabilityToken === "string" && b.capabilityToken.length > 0,
    "legacy capabilityToken present");
  assert(typeof b.approvalCapabilityToken === "string" && b.approvalCapabilityToken.length > 0,
    "canonical approvalCapabilityToken present on body");
  eq(b.approvalCapabilityToken, b.capabilityToken);
  // Receipt itself carries approvalCapabilityToken (source of truth).
  assert(typeof b.receipt.approvalCapabilityToken === "string",
    "receipt.approvalCapabilityToken present");
});

// ─── HAPPY: approve with only approvalCapabilityToken ────────────────────────

test("tfa_approve_execution with approvalCapabilityToken only → ok, verified, no deprecation", async () => {
  const { server } = makeServer();
  const start = await startPlanned(server);

  const r = await server.handleRequest(rpc("tools/call", {
    name: "tfa_approve_execution",
    arguments: {
      tenantId: "mcp-cap-canon",
      executionId: start.approvalToken,
      approvalCapabilityToken: start.receipt.approvalCapabilityToken,
    },
  }));
  const b = bodyOf(r);
  eq(b.ok, true);
  eq(b.capabilityVerified, true);
  eq(b.workflow.status, "running");
  assert(!b.warning, "no warning when canonical token provided");
  assert(!b.deprecated, "not deprecated when canonical token provided");
});

// ─── HAPPY: approve with only legacy capabilityToken (backcompat) ────────────

test("tfa_approve_execution with legacy capabilityToken only still works", async () => {
  const { server } = makeServer();
  const start = await startPlanned(server);

  const r = await server.handleRequest(rpc("tools/call", {
    name: "tfa_approve_execution",
    arguments: {
      tenantId: "mcp-cap-canon",
      executionId: start.approvalToken,
      capabilityToken: start.capabilityToken,
    },
  }));
  const b = bodyOf(r);
  eq(b.ok, true);
  eq(b.capabilityVerified, true);
  assert(!b.deprecated, "alias path is not deprecated (cap-verified)");
});

// ─── EDGE: both supplied identical → ok; differing → ok=false, planned ───────

test("both approvalCapabilityToken & capabilityToken — identical → ok", async () => {
  const { server } = makeServer();
  const start = await startPlanned(server);
  const tok = start.receipt.approvalCapabilityToken as string;

  const r = await server.handleRequest(rpc("tools/call", {
    name: "tfa_approve_execution",
    arguments: {
      tenantId: "mcp-cap-canon",
      executionId: start.approvalToken,
      approvalCapabilityToken: tok,
      capabilityToken: tok,
    },
  }));
  const b = bodyOf(r);
  eq(b.ok, true);
  eq(b.capabilityVerified, true);
});

test("both supplied but differing → ok=false; workflow stays planned", async () => {
  const { server, store } = makeServer();
  const start = await startPlanned(server);
  const id = start.approvalToken as string;
  const tokA = start.receipt.approvalCapabilityToken as string;
  // Mint a second, structurally-valid token bound to the same execution but
  // with a fresh nonce — guaranteed to differ from tokA byte-for-byte.
  const tokB = encodeCapabilityToken(issueCapabilityToken(id, "mcp-cap-canon", signer));
  assert(tokA !== tokB, "two issuances must differ (distinct nonces)");

  const r = await server.handleRequest(rpc("tools/call", {
    name: "tfa_approve_execution",
    arguments: {
      tenantId: "mcp-cap-canon",
      executionId: id,
      approvalCapabilityToken: tokA,
      capabilityToken: tokB,
    },
  }));
  const b = bodyOf(r);
  eq(b.ok, false);
  assert(/disagree|conflict/i.test(String(b.error)),
    `expected conflict error, got: ${b.error}`);
  const wf = await store.get(id, "mcp-cap-canon");
  eq(wf!.status, "planned");
});

// ─── FAIL-CLOSED: wrong-tenant token under canonical name → planned ──────────

test("approvalCapabilityToken bound to wrong tenant → ok=false, planned", async () => {
  const { server, store } = makeServer();
  const start = await startPlanned(server);
  const id = start.approvalToken as string;
  const foreign = encodeCapabilityToken(issueCapabilityToken(id, "tenant-other", signer));

  const r = await server.handleRequest(rpc("tools/call", {
    name: "tfa_approve_execution",
    arguments: {
      tenantId: "mcp-cap-canon",
      executionId: id,
      approvalCapabilityToken: foreign,
    },
  }));
  const b = bodyOf(r);
  eq(b.ok, false);
  assert(/tenant/i.test(String(b.error)),
    `expected tenant binding error, got: ${b.error}`);
  const wf = await store.get(id, "mcp-cap-canon");
  eq(wf!.status, "planned");
});

// ─── FAIL-CLOSED: non-string approvalCapabilityToken → planned ───────────────

test("non-string approvalCapabilityToken → ok=false, planned", async () => {
  const { server, store } = makeServer();
  const start = await startPlanned(server);
  const id = start.approvalToken as string;

  const r = await server.handleRequest(rpc("tools/call", {
    name: "tfa_approve_execution",
    arguments: {
      tenantId: "mcp-cap-canon",
      executionId: id,
      approvalCapabilityToken: 12345,
    },
  }));
  const b = bodyOf(r);
  eq(b.ok, false);
  assert(/non-empty string|must be/i.test(String(b.error)),
    `expected type error, got: ${b.error}`);
  const wf = await store.get(id, "mcp-cap-canon");
  eq(wf!.status, "planned");
});

// ─── DEPRECATION: bare-executionId approval surfaces deprecated:true ─────────

test("bare-executionId approval (no token) → ok, deprecated=true, DEPRECATED warning", async () => {
  const { server } = makeServer();
  const start = await startPlanned(server);

  const r = await server.handleRequest(rpc("tools/call", {
    name: "tfa_approve_execution",
    arguments: {
      tenantId: "mcp-cap-canon",
      executionId: start.approvalToken,
      // no token at all — legacy path
    },
  }));
  const b = bodyOf(r);
  eq(b.ok, true);
  eq(b.capabilityVerified, false);
  eq(b.deprecated, true);
  assert(typeof b.warning === "string", "warning should be present");
  assert(/DEPRECATED/.test(String(b.warning)),
    `warning should mention DEPRECATED, got: ${b.warning}`);
  assert(/approvalCapabilityToken/.test(String(b.warning)),
    `warning should reference approvalCapabilityToken, got: ${b.warning}`);
});
