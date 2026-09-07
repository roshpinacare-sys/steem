import "../_flush.mjs";
/**
 * tests/sovereignty/break-glass-wireup-rotate-key.test.ts — v198 substep 2:
 * the break-glass enforcement chokepoint (v197) is now wired into the
 * rotate-key route as an opt-in alternative to `requireScope`.
 *
 * Coverage (8 tests):
 *   • happy: caller WITHOUT admin:key-rotation scope, but WITH a valid
 *     `x-break-glass-ticket` for that scope → 200 + key rotated + signed
 *     break-glass.consumed audit appended.
 *   • superadmin ticket covers admin:key-rotation → 200.
 *   • no ticket + no scope → 403 (RBAC path unchanged).
 *   • no ticket + scope present → 200 (RBAC path unchanged — no regression).
 *   • replay (same ticket twice) → second call 409 + ONE consumed audit.
 *   • ticket for wrong scope (ledger:transfer) → 403, route NOT executed
 *     (rotation count unchanged).
 *   • cross-tenant ticket (issued for t1, presented under t2) → 401.
 *   • malformed/garbage ticket header → 401 (does not fall through to RBAC).
 */

import { test, assert, eq } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { buildSovereignStack } from "../../src/composition.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import {
  issueBreakGlassTicket,
  encodeBreakGlassTicket,
} from "../../src/sovereignty/break-glass.ts";
import { BREAK_GLASS_CONSUMED_ACTION_TYPE } from "../../src/sovereignty/break-glass-middleware.ts";
import type { Server } from "node:http";

interface HttpOpts {
  tenantId?: string;
  apiKey?: string;
  ticket?: string;
  body?: unknown;
}

async function httpRequest(
  port: number,
  method: string,
  path: string,
  opts: HttpOpts = {},
): Promise<{ status: number; body: any }> {
  const url = `http://127.0.0.1:${port}${path}`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.apiKey) headers["x-api-key"] = opts.apiKey;
  else if (opts.tenantId) headers["x-tenant-id"] = opts.tenantId;
  if (opts.ticket) headers["x-break-glass-ticket"] = opts.ticket;
  const res = await fetch(url, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

async function withServer(
  fn: (port: number, stack: ReturnType<typeof buildSovereignStack>, keys: { admin: string; user: string }) => Promise<void>,
): Promise<void> {
  const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const admin = await stack.apiKeyService.create({ tenantId: "t1", name: "admin", scopes: ["admin:key-rotation"] });
  const user = await stack.apiKeyService.create({ tenantId: "t1", name: "user", scopes: ["adapter:run"] });
  const server = startSovereignServer(0, stack, { requireIdempotencyKey: false }) as Server & { shutdown: () => Promise<void> };
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as any).port as number;
  try {
    await fn(port, stack, { admin: admin.secret, user: user.secret });
  } finally {
    await server.shutdown();
  }
}

function issueTicket(stack: ReturnType<typeof buildSovereignStack>, opts: { tenantId: string; grantScope: string }): string {
  const ticket = issueBreakGlassTicket(
    {
      tenantId: opts.tenantId,
      grantScope: opts.grantScope,
      operator: "test-operator",
      reason: "wire-up integration test reason",
    },
    stack.signer,
  );
  return encodeBreakGlassTicket(ticket);
}

function countConsumed(stack: ReturnType<typeof buildSovereignStack>, tenantId: string): number {
  const chain = stack.auditStore.getChain(tenantId);
  return chain.filter((r: any) => r.actionType === BREAK_GLASS_CONSUMED_ACTION_TYPE).length;
}

// ─── tests ──────────────────────────────────────────────────────────────────

test("wire-up: valid break-glass ticket + scope-less api key → 200 + consumed audit", async () => {
  await withServer(async (port, stack, keys) => {
    const ticket = issueTicket(stack, { tenantId: "t1", grantScope: "admin:key-rotation" });
    eq(countConsumed(stack, "t1"), 0);
    const res = await httpRequest(port, "POST", "/api/sovereignty/rotate-key", {
      apiKey: keys.user, // NO admin:key-rotation scope
      ticket,
      body: { signerKind: "hmac", secret: "wire-up-secret-long-enough-32bytes!" },
    });
    eq(res.status, 200);
    eq(res.body.ok, true);
    eq(stack.signer.rotationCount, 1);
    eq(countConsumed(stack, "t1"), 1);
  });
});

test("wire-up: superadmin ticket covers admin:key-rotation → 200", async () => {
  await withServer(async (port, stack, keys) => {
    const ticket = issueTicket(stack, { tenantId: "t1", grantScope: "superadmin" });
    const res = await httpRequest(port, "POST", "/api/sovereignty/rotate-key", {
      apiKey: keys.user,
      ticket,
      body: { signerKind: "hmac", secret: "wire-up-secret-long-enough-32bytes!" },
    });
    eq(res.status, 200);
    eq(stack.signer.rotationCount, 1);
  });
});

test("wire-up: no ticket + no scope → 403 (RBAC fallback unchanged)", async () => {
  await withServer(async (port, stack, keys) => {
    const res = await httpRequest(port, "POST", "/api/sovereignty/rotate-key", {
      apiKey: keys.user,
      body: { signerKind: "hmac", secret: "wire-up-secret-long-enough-32bytes!" },
    });
    eq(res.status, 403);
    eq(stack.signer.rotationCount, 0);
    eq(countConsumed(stack, "t1"), 0);
  });
});

test("wire-up: no ticket + scope present → 200 (RBAC fallback unchanged, no regression)", async () => {
  await withServer(async (port, stack, keys) => {
    const res = await httpRequest(port, "POST", "/api/sovereignty/rotate-key", {
      apiKey: keys.admin,
      body: { signerKind: "hmac", secret: "wire-up-secret-long-enough-32bytes!" },
    });
    eq(res.status, 200);
    eq(stack.signer.rotationCount, 1);
    eq(countConsumed(stack, "t1"), 0); // RBAC path does not write the consumed-audit
  });
});

test("wire-up: replay (same ticket twice) → second call denied, exactly ONE consumed audit", async () => {
  await withServer(async (port, stack, keys) => {
    const ticket = issueTicket(stack, { tenantId: "t1", grantScope: "admin:key-rotation" });
    const a = await httpRequest(port, "POST", "/api/sovereignty/rotate-key", {
      apiKey: keys.user,
      ticket,
      body: { signerKind: "hmac", secret: "wire-up-secret-long-enough-32bytes!" },
    });
    eq(a.status, 200);
    const b = await httpRequest(port, "POST", "/api/sovereignty/rotate-key", {
      apiKey: keys.user,
      ticket,
      body: { signerKind: "hmac", secret: "second-secret-long-enough-32bytes!!" },
    });
    // For rotate-key specifically, the first call rotated the kernel signer,
    // so the replay fails signature verification (401) BEFORE the nonce
    // check (409) can fire. Either denial is correct fail-closed behavior;
    // the contract we hold is "second call denied + no second side effect".
    assert(b.status === 409 || b.status === 401, `replay denied (got ${b.status})`);
    eq(stack.signer.rotationCount, 1); // second call did NOT rotate
    eq(countConsumed(stack, "t1"), 1);
  });
});

test("wire-up: ticket for wrong scope → 403, route does NOT execute", async () => {
  await withServer(async (port, stack, keys) => {
    const ticket = issueTicket(stack, { tenantId: "t1", grantScope: "ledger:transfer" });
    const res = await httpRequest(port, "POST", "/api/sovereignty/rotate-key", {
      apiKey: keys.user,
      ticket,
      body: { signerKind: "hmac", secret: "wire-up-secret-long-enough-32bytes!" },
    });
    eq(res.status, 403);
    eq(stack.signer.rotationCount, 0);
    eq(countConsumed(stack, "t1"), 0); // denied before nonce/audit
  });
});

test("wire-up: cross-tenant ticket → 401, no rotation, no audit in either tenant", async () => {
  await withServer(async (port, stack, keys) => {
    const ticket = issueTicket(stack, { tenantId: "t-other", grantScope: "admin:key-rotation" });
    const res = await httpRequest(port, "POST", "/api/sovereignty/rotate-key", {
      apiKey: keys.user, // resolves to t1
      ticket,
      body: { signerKind: "hmac", secret: "wire-up-secret-long-enough-32bytes!" },
    });
    eq(res.status, 401);
    eq(stack.signer.rotationCount, 0);
    eq(countConsumed(stack, "t1"), 0);
    eq(countConsumed(stack, "t-other"), 0);
  });
});

test("wire-up: garbage ticket → 401 (does not fall through to RBAC)", async () => {
  await withServer(async (port, stack, keys) => {
    const res = await httpRequest(port, "POST", "/api/sovereignty/rotate-key", {
      apiKey: keys.admin, // has scope, but garbage ticket must short-circuit
      ticket: "!!!not-base64!!!",
      body: { signerKind: "hmac", secret: "wire-up-secret-long-enough-32bytes!" },
    });
    eq(res.status, 401);
    eq(stack.signer.rotationCount, 0);
  });
});
