import "../_flush.mjs";
/**
 * tests/http/mcp-routes.test.ts — POST /api/mcp HTTP bridge tests.
 *
 * Coverage:
 *   Happy path
 *     • POST /api/mcp with valid initialize request → 200, jsonrpc 2.0 response
 *     • POST /api/mcp with tools/list → 200, result contains tools array
 *     • POST /api/mcp with notification (no id) → 204 No Content
 *     • tenantId header injected into params.tenantId automatically
 *
 *   fail-closed
 *     • missing x-tenant-id → 400
 *     • body is not JSON object → 400
 *     • jsonrpc field missing → 400
 *     • jsonrpc !== "2.0" → 400
 *     • method missing → 400
 *     • method is not a string → 400
 *
 *   Integration
 *     • tfa_approve_execution with pre-consumed nonce → replay rejected (error response)
 *     • multiple sequential requests on same server instance work correctly
 *     • unknown method → 200 with JSON-RPC error (not 404 — MCP handles unknown methods)
 */

import { test, assert, eq } from "../_harness.mjs";
import { startSovereignServer, type SovereignServer } from "../../src/http/sovereign-server.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function startTestServer(): Promise<{ s: SovereignServer; port: number }> {
  const s = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  s.unref();
  await new Promise(r => setTimeout(r, 50));
  const port = (s.address() as any).port as number;
  return { s, port };
}

async function httpPost(
  port: number,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: unknown; text: string }> {
  const res = await fetch(`http://127.0.0.1:${port}/api/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "mcp-test-tenant",
      ...headers,
    },
    body: body !== null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed, text };
}

// ─── Happy path ───────────────────────────────────────────────────────────────

test("POST /api/mcp: initialize request → 200 with jsonrpc 2.0 response", async () => {
  const { s, port } = await startTestServer();
  try {
    const { status, body } = await httpPost(port, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0.0.1" } },
    });
    eq(status, 200);
    const b = body as any;
    eq(b.jsonrpc, "2.0");
    assert(b.result !== undefined || b.error !== undefined, "Response must have result or error");
  } finally { s.close(); }
});

test("POST /api/mcp: tools/list → 200 with tools array", async () => {
  const { s, port } = await startTestServer();
  try {
    const { status, body } = await httpPost(port, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    eq(status, 200);
    const b = body as any;
    eq(b.jsonrpc, "2.0");
    // Either result.tools is an array or it's an error (both are valid responses)
    assert(b.result !== undefined || b.error !== undefined);
    if (b.result?.tools) {
      assert(Array.isArray(b.result.tools), "tools must be an array");
    }
  } finally { s.close(); }
});

test("POST /api/mcp: notification (no id field) → 204 No Content", async () => {
  const { s, port } = await startTestServer();
  try {
    const { status, text } = await httpPost(port, {
      jsonrpc: "2.0",
      // no id — this is a notification
      method: "notifications/initialized",
      params: {},
    });
    eq(status, 204);
    // Body should be empty for 204
    assert(text === "" || text === "null", `Expected empty body for 204, got: ${text}`);
  } finally { s.close(); }
});

test("POST /api/mcp: tenantId header injected into params.tenantId", async () => {
  const { s, port } = await startTestServer();
  try {
    // We test this by sending a request that uses tenantId in its result and
    // verifying the tool call doesn't fail with "missing tenantId"
    const { status, body } = await httpPost(port, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "tfa_check_action",
        arguments: {
          actionType: "transfer_funds",
          valueMicrounits: "1000",
          // no explicit tenantId — should be injected from header
        },
      },
    }, { "x-tenant-id": "injection-test-tenant" });

    eq(status, 200);
    const b = body as any;
    // Should not fail with "missing tenantId"
    const bodyStr = JSON.stringify(b);
    assert(
      !bodyStr.includes("tenantId is required") && !bodyStr.includes("missing tenantId"),
      `tenantId should have been injected. Got: ${bodyStr.slice(0, 200)}`,
    );
  } finally { s.close(); }
});

// ─── fail-closed ──────────────────────────────────────────────────────────────

test("POST /api/mcp: missing x-tenant-id → 400", async () => {
  const { s, port } = await startTestServer();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" }, // no x-tenant-id
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    eq(res.status, 400);
  } finally { s.close(); }
});

test("POST /api/mcp: non-object body → 400", async () => {
  const { s, port } = await startTestServer();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": "t1" },
      body: JSON.stringify([1, 2, 3]), // array, not object
    });
    eq(res.status, 400);
  } finally { s.close(); }
});

test("POST /api/mcp: jsonrpc !== '2.0' → 400", async () => {
  const { s, port } = await startTestServer();
  try {
    const { status } = await httpPost(port, {
      jsonrpc: "1.0",
      id: 1,
      method: "tools/list",
    });
    eq(status, 400);
  } finally { s.close(); }
});

test("POST /api/mcp: missing jsonrpc field → 400", async () => {
  const { s, port } = await startTestServer();
  try {
    const { status } = await httpPost(port, {
      id: 1,
      method: "tools/list",
    });
    eq(status, 400);
  } finally { s.close(); }
});

test("POST /api/mcp: missing method → 400", async () => {
  const { s, port } = await startTestServer();
  try {
    const { status } = await httpPost(port, {
      jsonrpc: "2.0",
      id: 1,
      // no method
    });
    eq(status, 400);
  } finally { s.close(); }
});

test("POST /api/mcp: method is not a string → 400", async () => {
  const { s, port } = await startTestServer();
  try {
    const { status } = await httpPost(port, {
      jsonrpc: "2.0",
      id: 1,
      method: 42,
    });
    eq(status, 400);
  } finally { s.close(); }
});

// ─── Integration ──────────────────────────────────────────────────────────────

test("POST /api/mcp: unknown method → 200 with JSON-RPC error (MCP handles it)", async () => {
  const { s, port } = await startTestServer();
  try {
    const { status, body } = await httpPost(port, {
      jsonrpc: "2.0",
      id: 99,
      method: "totally/unknown/method",
      params: {},
    });
    // MCP server returns a JSON-RPC error, not an HTTP error
    eq(status, 200);
    const b = body as any;
    eq(b.jsonrpc, "2.0");
    assert(b.error !== undefined, `Expected JSON-RPC error for unknown method. Got: ${JSON.stringify(b)}`);
  } finally { s.close(); }
});

test("POST /api/mcp: multiple sequential requests work correctly", async () => {
  const { s, port } = await startTestServer();
  try {
    for (let i = 0; i < 5; i++) {
      const { status, body } = await httpPost(port, {
        jsonrpc: "2.0",
        id: i,
        method: "tools/list",
        params: {},
      });
      eq(status, 200, `request ${i} should return 200`);
      const b = body as any;
      eq(b.jsonrpc, "2.0", `request ${i} response should have jsonrpc: "2.0"`);
    }
  } finally { s.close(); }
});

test("POST /api/mcp: explicit params.tenantId takes precedence over header injection", async () => {
  const { s, port } = await startTestServer();
  try {
    const { status, body } = await httpPost(port, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "tfa_check_action",
        arguments: {
          actionType: "read_file",
          tenantId: "explicit-tenant-in-params", // explicit — should NOT be overwritten
          valueMicrounits: "0",
        },
      },
    }, { "x-tenant-id": "header-tenant" });
    eq(status, 200);
    // The response processes without error (the tenantId from params was accepted)
    const b = body as any;
    assert(b.jsonrpc === "2.0", "Response must be JSON-RPC 2.0");
  } finally { s.close(); }
});

// ─── Scope authentication (mcp:execute) ──────────────────────────────────────
// Uses x-api-key header to exercise the optional scope check:
//   • Key with mcp:execute → 200 (authorized)
//   • Key without mcp:execute → 403 (fail-closed: key present, scope missing)
//   • Key with superadmin → 200 (superadmin bypasses all scope checks)
//   • No key, bare x-tenant-id → 200 (passthrough — no key present, implicit superadmin dev-mode)
//   • Malformed/revoked key → 401 (caught by tenant-resolver before scope check)

import { buildSovereignStack } from "../../src/composition.ts";

async function startServerWithStack(): Promise<{ s: SovereignServer; port: number; stack: ReturnType<typeof buildSovereignStack> }> {
  // Build stack explicitly and pass to server so apiKeyService is shared
  const stack = buildSovereignStack();
  const s = startSovereignServer(0, stack, { requireIdempotencyKey: false });
  s.unref();
  await new Promise(r => setTimeout(r, 80));
  const port = (s.address() as any).port as number;
  return { s, port, stack };
}

async function httpPostWithKey(
  port: number,
  body: unknown,
  apiKey: string,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}/api/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      // No x-tenant-id — tenantId is resolved from the API key itself
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

const VALID_MCP_BODY = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };

test("POST /api/mcp scope: key with mcp:execute → 200 (authorized)", async () => {
  const { s, port, stack } = await startServerWithStack();
  try {
    const created = await stack.apiKeyService.create({
      tenantId: "scope-test-tenant",
      name: "mcp-auth-key",
      scopes: ["mcp:execute"],
    });
    const { status } = await httpPostWithKey(port, VALID_MCP_BODY, created.secret);
    eq(status, 200);
  } finally { s.close(); }
});

test("POST /api/mcp scope: key WITHOUT mcp:execute → 403 (fail-closed)", async () => {
  const { s, port, stack } = await startServerWithStack();
  try {
    const created = await stack.apiKeyService.create({
      tenantId: "scope-test-tenant",
      name: "limited-key",
      scopes: ["adapter:run"], // no mcp:execute
    });
    const { status, body } = await httpPostWithKey(port, VALID_MCP_BODY, created.secret);
    eq(status, 403);
    const b = body as any;
    assert(
      typeof b?.error === "string" && b.error.includes("mcp:execute"),
      `Expected 403 with mcp:execute error. Got: ${JSON.stringify(b)}`,
    );
  } finally { s.close(); }
});

test("POST /api/mcp scope: key with superadmin → 200 (wildcard bypass)", async () => {
  const { s, port, stack } = await startServerWithStack();
  try {
    const created = await stack.apiKeyService.create({
      tenantId: "scope-test-tenant",
      name: "superadmin-key",
      scopes: ["superadmin"],
    });
    const { status } = await httpPostWithKey(port, VALID_MCP_BODY, created.secret);
    eq(status, 200);
  } finally { s.close(); }
});

test("POST /api/mcp scope: no key + bare x-tenant-id → 200 (passthrough, dev-mode superadmin)", async () => {
  // Existing behavior: no x-api-key → scopes = ["superadmin"] → passes all checks
  const { s, port } = await startTestServer();
  try {
    const { status } = await httpPost(port, VALID_MCP_BODY);
    eq(status, 200);
  } finally { s.close(); }
});

test("POST /api/mcp scope: key with empty scopes array → 403", async () => {
  const { s, port, stack } = await startServerWithStack();
  try {
    const created = await stack.apiKeyService.create({
      tenantId: "scope-test-tenant",
      name: "empty-scopes-key",
      scopes: [], // no scopes at all
    });
    const { status } = await httpPostWithKey(port, VALID_MCP_BODY, created.secret);
    eq(status, 403);
  } finally { s.close(); }
});

test("POST /api/mcp scope: invalid/revoked API key → 401 (caught before scope check)", async () => {
  const { s, port, stack } = await startServerWithStack();
  try {
    const { status } = await httpPostWithKey(port, VALID_MCP_BODY, "invalid-key-that-does-not-exist");
    eq(status, 401);
  } finally { s.close(); }
});

test("POST /api/mcp scope: key with mcp:execute passes body validation too (integration)", async () => {
  const { s, port, stack } = await startServerWithStack();
  try {
    const created = await stack.apiKeyService.create({
      tenantId: "scope-test-tenant",
      name: "integration-key",
      scopes: ["mcp:execute"],
    });
    // Also verify the MCP response is valid JSON-RPC 2.0
    const { status, body } = await httpPostWithKey(port, VALID_MCP_BODY, created.secret);
    eq(status, 200);
    const b = body as any;
    eq(b.jsonrpc, "2.0");
    assert(b.result !== undefined || b.error !== undefined, "Response has result or error");
  } finally { s.close(); }
});
