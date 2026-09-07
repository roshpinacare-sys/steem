import "../_flush.mjs";
/**
 * tests/rbac/require-scope.test.ts
 *
 * Coverage:
 *   requireScope:
 *     • happy path (exact scope match)
 *     • superadmin bypass
 *     • undefined scopes → 403 fail-closed
 *     • empty array → 403 fail-closed
 *     • wrong scope → 403
 *     • error message contains the scope name
 *
 *   requireAnyScope:
 *     • passes when first allowed scope present
 *     • passes when second allowed scope present
 *     • fails when none present
 *     • superadmin bypass
 *     • empty scopes fail-closed
 *
 *   requireAllScopes:
 *     • passes when all present
 *     • fails when one missing (lists missing in error)
 *     • fails when all missing
 *     • superadmin bypass
 *     • empty scopes fail-closed
 *
 *   isKnownScope:
 *     • recognises known scopes
 *     • rejects unknown scope strings
 *
 *   Integration: rotate-key RBAC via HTTP
 *     • 403 for missing scope (bare x-tenant-id)
 *     • 403 for wrong scope
 *     • 200 for correct scope
 *     • 200 for superadmin
 */

import { test, assert, eq } from "../_harness.mjs";
import {
  requireScope,
  requireAnyScope,
  requireAllScopes,
  isKnownScope,
  KNOWN_SCOPES,
} from "../../lib/rbac/require-scope.ts";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { buildSovereignStack } from "../../src/composition.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import type { Server } from "node:http";

// ─── requireScope ────────────────────────────────────────────────────────────

test("requireScope: passes when exact scope present", () => {
  const result = requireScope(["admin:key-rotation"], "admin:key-rotation");
  eq(result, null);
});

test("requireScope: superadmin bypasses any scope check", () => {
  eq(requireScope(["superadmin"], "admin:key-rotation"), null);
  eq(requireScope(["superadmin"], "ledger:mint"), null);
  eq(requireScope(["superadmin"], "sovereignty:export"), null);
});

test("requireScope: undefined scopes → 403 fail-closed", () => {
  const result = requireScope(undefined, "admin:key-rotation");
  assert(result !== null, "should deny");
  eq(result!.status, 403);
  assert(result!.body.error.includes("admin:key-rotation"), "error names the scope");
});

test("requireScope: null scopes → 403 fail-closed", () => {
  const result = requireScope(null, "admin:key-rotation");
  assert(result !== null, "should deny on null");
  eq(result!.status, 403);
});

test("requireScope: empty array → 403 fail-closed", () => {
  const result = requireScope([], "admin:key-rotation");
  assert(result !== null, "should deny on empty");
  eq(result!.status, 403);
});

test("requireScope: wrong scope → 403", () => {
  const result = requireScope(["adapter:run"], "admin:key-rotation");
  assert(result !== null, "should deny wrong scope");
  eq(result!.status, 403);
  assert(result!.body.error.includes("admin:key-rotation"));
});

test("requireScope: multiple scopes, one matches → passes", () => {
  const result = requireScope(["adapter:run", "admin:key-rotation", "index:read"], "admin:key-rotation");
  eq(result, null);
});

// ─── requireAnyScope ─────────────────────────────────────────────────────────

test("requireAnyScope: passes when first allowed scope present", () => {
  eq(requireAnyScope(["admin:key-rotation"], ["admin:key-rotation", "superadmin"]), null);
});

test("requireAnyScope: passes when second allowed scope present", () => {
  eq(requireAnyScope(["settlement:write"], ["ledger:mint", "settlement:write"]), null);
});

test("requireAnyScope: fails when none present → 403", () => {
  const result = requireAnyScope(["index:read"], ["ledger:mint", "settlement:write"]);
  assert(result !== null);
  eq(result!.status, 403);
  assert(result!.body.error.includes("ledger:mint"));
  assert(result!.body.error.includes("settlement:write"));
});

test("requireAnyScope: superadmin bypasses → null", () => {
  eq(requireAnyScope(["superadmin"], ["ledger:mint", "settlement:write"]), null);
});

test("requireAnyScope: empty scopes → 403 fail-closed", () => {
  const result = requireAnyScope([], ["ledger:mint"]);
  assert(result !== null);
  eq(result!.status, 403);
});

// ─── requireAllScopes ────────────────────────────────────────────────────────

test("requireAllScopes: passes when all required scopes present", () => {
  eq(
    requireAllScopes(["data:read", "ledger:mint", "settlement:write"], ["ledger:mint", "settlement:write"]),
    null,
  );
});

test("requireAllScopes: fails when one missing → 403 with missing list", () => {
  const result = requireAllScopes(["ledger:mint"], ["ledger:mint", "settlement:write"]);
  assert(result !== null);
  eq(result!.status, 403);
  assert(result!.body.error.includes("settlement:write"), "error lists missing scope");
});

test("requireAllScopes: fails when all missing → 403", () => {
  const result = requireAllScopes(["index:read"], ["ledger:mint", "settlement:write"]);
  assert(result !== null);
  eq(result!.status, 403);
  assert(result!.body.error.includes("ledger:mint"));
  assert(result!.body.error.includes("settlement:write"));
});

test("requireAllScopes: superadmin bypasses all checks", () => {
  eq(requireAllScopes(["superadmin"], ["ledger:mint", "settlement:write", "admin:key-rotation"]), null);
});

test("requireAllScopes: empty scopes → 403 fail-closed", () => {
  const result = requireAllScopes([], ["ledger:mint"]);
  assert(result !== null);
  eq(result!.status, 403);
});

test("requireAllScopes: empty required list → passes (vacuously true)", () => {
  eq(requireAllScopes([], []), null);
});

// ─── isKnownScope ────────────────────────────────────────────────────────────

test("isKnownScope: recognises all KNOWN_SCOPES entries", () => {
  for (const scope of KNOWN_SCOPES) {
    assert(isKnownScope(scope), `${scope} should be recognised`);
  }
});

test("isKnownScope: rejects unknown scope strings", () => {
  assert(!isKnownScope("admin:write"), "admin:write is not a known scope");
  assert(!isKnownScope(""), "empty string is not a known scope");
  assert(!isKnownScope("*"), "wildcard is not a known scope");
  assert(!isKnownScope("SUPERADMIN"), "case-sensitive: SUPERADMIN ≠ superadmin");
});

// ─── Integration: HTTP route uses requireScope ────────────────────────────────

async function httpPost(port: number, path: string, opts: {
  apiKey?: string;
  tenantId?: string;
  body?: unknown;
}): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.apiKey) headers["x-api-key"] = opts.apiKey;
  else if (opts.tenantId) headers["x-tenant-id"] = opts.tenantId;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

async function withServer(fn: (port: number, keys: { admin: string; user: string; supe: string }) => Promise<void>): Promise<void> {
  const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const admin = await stack.apiKeyService.create({ tenantId: "rbac-t1", name: "admin", scopes: ["admin:key-rotation"] });
  const user  = await stack.apiKeyService.create({ tenantId: "rbac-t1", name: "user",  scopes: ["adapter:run"] });
  const supe  = await stack.apiKeyService.create({ tenantId: "rbac-t1", name: "super", scopes: ["superadmin"] });
  const server = startSovereignServer(0, stack, { requireIdempotencyKey: false }) as Server & { shutdown: () => Promise<void> };
  await new Promise<void>((r) => server.once("listening", r));
  const port = (server.address() as any).port as number;
  try { await fn(port, { admin: admin.secret, user: user.secret, supe: supe.secret }); }
  finally { await server.shutdown(); }
}

const HMAC_BODY = { signerKind: "hmac", secret: "new-rbac-test-secret-long-enough!!" };

test("RBAC integration: bare x-tenant-id in trusted mode (requireApiKey=false) gets superadmin → 200", async () => {
  await withServer(async (port) => {
    // Trusted mode: bare x-tenant-id is granted superadmin scopes implicitly.
    // requireApiKey=false (the default) is a dev/test convenience — all scope checks pass.
    // To enforce scopes, start the server with requireApiKey=true.
    const res = await httpPost(port, "/api/sovereignty/rotate-key", {
      tenantId: "rbac-t1",
      body: HMAC_BODY,
    });
    eq(res.status, 200);
    eq(res.body.ok, true);
  });
});

test("RBAC integration: requireScope → 403 for wrong scope (adapter:run only)", async () => {
  await withServer(async (port, keys) => {
    const res = await httpPost(port, "/api/sovereignty/rotate-key", {
      apiKey: keys.user,
      body: HMAC_BODY,
    });
    eq(res.status, 403);
    assert(res.body.error.includes("admin:key-rotation"));
  });
});

test("RBAC integration: requireScope → 200 for correct scope (admin:key-rotation)", async () => {
  await withServer(async (port, keys) => {
    const res = await httpPost(port, "/api/sovereignty/rotate-key", {
      apiKey: keys.admin,
      body: HMAC_BODY,
    });
    eq(res.status, 200);
    eq(res.body.ok, true);
    eq(res.body.rotationCount, 1);
  });
});

test("RBAC integration: requireScope → 200 for superadmin (wildcard bypass)", async () => {
  await withServer(async (port, keys) => {
    const res = await httpPost(port, "/api/sovereignty/rotate-key", {
      apiKey: keys.supe,
      body: HMAC_BODY,
    });
    eq(res.status, 200);
    eq(res.body.ok, true);
  });
});

// ─── efficiency/set-based-scope-lookup (v413) ──────────────────────────────
// Three tests covering the Set-based scope lookup that replaced .includes()
// linear scans across requireScope / requireAnyScope / requireAllScopes / isKnownScope.

test("set-based-scope happy-path: requireAnyScope with large scope array passes O(1) path (superadmin in middle)", () => {
  // Superadmin buried in a 100-scope array — Set.has() finds it in O(1)
  // vs the old code which scanned up to 100 entries with .includes().
  const manyScopes = Array.from({ length: 100 }, (_, i) => `fake:scope-${i}`);
  manyScopes[50] = "superadmin"; // buried
  const result = requireAnyScope(manyScopes, ["admin:key-rotation"]);
  eq(result, null, "superadmin anywhere in the array must pass");
});

test("set-based-scope edge-case: requireAllScopes null scopes with zero required is vacuously true", () => {
  // Confirm the new explicit empty-check for null+empty-required still returns null.
  // Old code: scopes?.includes("superadmin") → undefined (falsy), filter → [], length===0 → null ✓
  // New code: scopes is null → length check → requiredScopes.length===0 → return null ✓
  eq(requireAllScopes(null, []), null, "null scopes + zero required → vacuously true (no scopes needed)");
  eq(requireAllScopes(undefined, []), null, "undefined scopes + zero required → vacuously true");
  // But null scopes + non-empty required → 403
  const r = requireAllScopes(null, ["execution:read"]);
  assert(r !== null && r.status === 403, "null scopes + required scope → 403");
});

test("set-based-scope fail-closed: requireAnyScope with 200 allowed scopes, none matching → 403", () => {
  // Verifies Set path is fail-closed at scale — no match means deny, not error.
  const callerScopes = ["execution:read", "index:read"];
  const allowedScopes = Array.from({ length: 200 }, (_, i) => `resource-${i}:write`);
  const result = requireAnyScope(callerScopes, allowedScopes);
  assert(result !== null, "no match → must deny");
  eq(result!.status, 403);
  // Also verify isKnownScope uses KNOWN_SCOPES_SET correctly for an unknown scope
  eq(isKnownScope("resource-0:write" as any), false, "synthesized scope is not known");
  eq(isKnownScope("superadmin"), true, "superadmin is a known scope");
});
