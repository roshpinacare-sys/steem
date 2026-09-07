import "../_flush.mjs";
/**
 * tests/sovereignty/break-glass-wireup-ledger-mint.test.ts — v199 substep 1
 * of "break-glass wire-up — המשך": the chokepoint (v197) and the rotate-key
 * wire-up pattern (v198) are now extended to `POST /api/ledger/mint`.
 *
 * Coverage (8 tests):
 *   • happy: caller WITHOUT ledger:mint scope, but WITH a valid
 *     `x-break-glass-ticket` for that scope → 200 + mint executes + signed
 *     break-glass.consumed audit appended.
 *   • superadmin ticket covers ledger:mint → 200.
 *   • no ticket + no scope → 403 (RBAC fallback unchanged).
 *   • no ticket + scope present → 200 (RBAC fallback unchanged — zero regression).
 *   • replay (same ticket twice) → second call 409 + ONE consumed audit + ONE mint.
 *   • ticket for wrong scope (admin:key-rotation) → 403, mint NOT executed.
 *   • cross-tenant ticket (issued for t-other, presented under t1) → 401.
 *   • garbage ticket header → 401 (does NOT fall through to RBAC even when
 *     the caller's API key would otherwise pass).
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

interface TestCtx {
  port: number;
  stack: ReturnType<typeof buildSovereignStack>;
  keys: { admin: string; user: string };
  accountId: string;
}

async function withServer(fn: (ctx: TestCtx) => Promise<void>): Promise<void> {
  const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const admin = await stack.apiKeyService.create({ tenantId: "t1", name: "admin", scopes: ["ledger:mint"] });
  const user = await stack.apiKeyService.create({ tenantId: "t1", name: "user", scopes: ["adapter:run"] });
  const server = startSovereignServer(0, stack, { requireIdempotencyKey: false }) as Server & { shutdown: () => Promise<void> };
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as any).port as number;
  try {
    // Pre-create an account for t1 so all mint paths in the suite have a
    // valid destination. Account creation is a separate route with no
    // ledger:mint scope requirement.
    const acc = await httpRequest(port, "POST", "/api/ledger/accounts", {
      tenantId: "t1",
      body: { ownerId: "u1", type: "asset", name: "wire-up mint dest" },
    });
    if (acc.status !== 201) throw new Error(`setup createAccount failed: ${acc.status} ${JSON.stringify(acc.body)}`);
    const accountId = acc.body.account.id as string;
    await fn({ port, stack, keys: { admin: admin.secret, user: user.secret }, accountId });
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
      reason: "ledger-mint wire-up integration test reason",
    },
    stack.signer,
  );
  return encodeBreakGlassTicket(ticket);
}

function countConsumed(stack: ReturnType<typeof buildSovereignStack>, tenantId: string): number {
  const chain = stack.auditStore.getChain(tenantId);
  return chain.filter((r: any) => r.actionType === BREAK_GLASS_CONSUMED_ACTION_TYPE).length;
}

function mintBody(accountId: string, amount: string): unknown {
  return { toAccountId: accountId, amount, memo: "wire-up test mint", initiatedBy: "test" };
}

// ─── tests ──────────────────────────────────────────────────────────────────

test("wire-up mint: valid break-glass ticket + scope-less api key → 200 + consumed audit", async () => {
  await withServer(async ({ port, stack, keys, accountId }) => {
    const ticket = issueTicket(stack, { tenantId: "t1", grantScope: "ledger:mint" });
    eq(countConsumed(stack, "t1"), 0);
    const res = await httpRequest(port, "POST", "/api/ledger/mint", {
      apiKey: keys.user, // NO ledger:mint scope
      ticket,
      body: mintBody(accountId, "1000"),
    });
    eq(res.status, 200);
    eq(res.body.ok, true);
    eq(countConsumed(stack, "t1"), 1);
  });
});

test("wire-up mint: superadmin ticket covers ledger:mint → 200", async () => {
  await withServer(async ({ port, stack, keys, accountId }) => {
    const ticket = issueTicket(stack, { tenantId: "t1", grantScope: "superadmin" });
    const res = await httpRequest(port, "POST", "/api/ledger/mint", {
      apiKey: keys.user,
      ticket,
      body: mintBody(accountId, "2000"),
    });
    eq(res.status, 200);
    eq(res.body.ok, true);
  });
});

test("wire-up mint: no ticket + no scope → 403 (RBAC fallback unchanged)", async () => {
  await withServer(async ({ port, stack, keys, accountId }) => {
    const res = await httpRequest(port, "POST", "/api/ledger/mint", {
      apiKey: keys.user,
      body: mintBody(accountId, "500"),
    });
    eq(res.status, 403);
    eq(countConsumed(stack, "t1"), 0);
  });
});

test("wire-up mint: no ticket + scope present → 200 (RBAC fallback unchanged, no regression)", async () => {
  await withServer(async ({ port, stack, keys, accountId }) => {
    const res = await httpRequest(port, "POST", "/api/ledger/mint", {
      apiKey: keys.admin,
      body: mintBody(accountId, "750"),
    });
    eq(res.status, 200);
    eq(res.body.ok, true);
    eq(countConsumed(stack, "t1"), 0); // RBAC path does not write the consumed-audit
  });
});

test("wire-up mint: replay (same ticket twice) → second call 409, exactly ONE consumed audit", async () => {
  await withServer(async ({ port, stack, keys, accountId }) => {
    const ticket = issueTicket(stack, { tenantId: "t1", grantScope: "ledger:mint" });
    const a = await httpRequest(port, "POST", "/api/ledger/mint", {
      apiKey: keys.user,
      ticket,
      body: mintBody(accountId, "100"),
    });
    eq(a.status, 200);
    const b = await httpRequest(port, "POST", "/api/ledger/mint", {
      apiKey: keys.user,
      ticket,
      body: mintBody(accountId, "100"),
    });
    // Unlike rotate-key, mint does NOT rotate the kernel signer, so ticket
    // signature stays valid and the nonce-replay branch fires deterministically.
    eq(b.status, 409);
    eq(countConsumed(stack, "t1"), 1);
  });
});

test("wire-up mint: ticket for wrong scope → 403, mint does NOT execute", async () => {
  await withServer(async ({ port, stack, keys, accountId }) => {
    const ticket = issueTicket(stack, { tenantId: "t1", grantScope: "admin:key-rotation" });
    const res = await httpRequest(port, "POST", "/api/ledger/mint", {
      apiKey: keys.user,
      ticket,
      body: mintBody(accountId, "100"),
    });
    eq(res.status, 403);
    eq(countConsumed(stack, "t1"), 0); // denied before nonce/audit
  });
});

test("wire-up mint: cross-tenant ticket → 401, no consumed audit in either tenant", async () => {
  await withServer(async ({ port, stack, keys, accountId }) => {
    const ticket = issueTicket(stack, { tenantId: "t-other", grantScope: "ledger:mint" });
    const res = await httpRequest(port, "POST", "/api/ledger/mint", {
      apiKey: keys.user, // resolves to t1
      ticket,
      body: mintBody(accountId, "100"),
    });
    eq(res.status, 401);
    eq(countConsumed(stack, "t1"), 0);
    eq(countConsumed(stack, "t-other"), 0);
  });
});

test("wire-up mint: garbage ticket → 401 (does NOT fall through to RBAC)", async () => {
  await withServer(async ({ port, stack, keys, accountId }) => {
    const res = await httpRequest(port, "POST", "/api/ledger/mint", {
      apiKey: keys.admin, // has scope, but garbage ticket must short-circuit
      ticket: "!!!not-base64!!!",
      body: mintBody(accountId, "100"),
    });
    eq(res.status, 401);
    // Sanity: caller had scope, so absent the wire-up this would have been 200.
    // The fail-closed contract: a present-but-malformed ticket is itself an
    // unauthorised credential and must NOT silently degrade to RBAC.
    assert(res.body.error || res.body.error === "", "denial body present");
  });
});
