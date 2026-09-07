import "../_flush.mjs";
/**
 * tests/sovereignty/break-glass-wireup-ledger-transfer.test.ts — v200 substep 2
 * of "break-glass wire-up — המשך": the chokepoint (v197) and the wire-up
 * pattern established for rotate-key (v198) and ledger/mint (v199) is now
 * extended to `POST /api/ledger/transfer`.
 *
 * Coverage (8 tests) — symmetric to the ledger/mint wire-up suite:
 *   • happy: caller WITHOUT ledger:transfer scope, but WITH a valid
 *     `x-break-glass-ticket` for that scope → 200 + transfer executes +
 *     signed break-glass.consumed audit appended.
 *   • superadmin ticket covers ledger:transfer → 200.
 *   • no ticket + no scope → 403 (RBAC fallback unchanged).
 *   • no ticket + scope present → 200 (RBAC fallback unchanged — zero regression).
 *   • replay (same ticket twice) → second call 409 + exactly ONE consumed audit.
 *   • ticket for wrong scope (admin:key-rotation) → 403, transfer NOT executed.
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
  fromAccountId: string;
  toAccountId: string;
}

async function withServer(fn: (ctx: TestCtx) => Promise<void>): Promise<void> {
  const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  // Admin key carries BOTH ledger:mint (for setup funding) and ledger:transfer
  // (for the RBAC-fallback positive test). user key has neither — it's the
  // "scope-less" caller used to prove break-glass actually grants access.
  const admin = await stack.apiKeyService.create({
    tenantId: "t1",
    name: "admin",
    scopes: ["ledger:mint", "ledger:transfer"],
  });
  const user = await stack.apiKeyService.create({ tenantId: "t1", name: "user", scopes: ["adapter:run"] });
  const server = startSovereignServer(0, stack, { requireIdempotencyKey: false }) as Server & { shutdown: () => Promise<void> };
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as any).port as number;
  try {
    // Pre-create source + destination accounts under t1, then fund source
    // with a mint (admin key has ledger:mint). Each test does small transfers
    // well within the funded balance; no test exercises insufficient funds —
    // that's a ledger concern, not a wire-up concern.
    const accFrom = await httpRequest(port, "POST", "/api/ledger/accounts", {
      tenantId: "t1",
      body: { ownerId: "u1", type: "asset", name: "wire-up transfer source" },
    });
    if (accFrom.status !== 201) throw new Error(`setup createAccount(from) failed: ${accFrom.status}`);
    const accTo = await httpRequest(port, "POST", "/api/ledger/accounts", {
      tenantId: "t1",
      body: { ownerId: "u2", type: "asset", name: "wire-up transfer dest" },
    });
    if (accTo.status !== 201) throw new Error(`setup createAccount(to) failed: ${accTo.status}`);
    const fromAccountId = accFrom.body.account.id as string;
    const toAccountId = accTo.body.account.id as string;
    // Fund the source: 1_000_000 μ¢ is plenty for the suite's small transfers.
    const fund = await httpRequest(port, "POST", "/api/ledger/mint", {
      apiKey: admin.secret,
      body: { toAccountId: fromAccountId, amount: "1000000", memo: "setup-fund", initiatedBy: "test-setup" },
    });
    if (fund.status !== 200) throw new Error(`setup mint failed: ${fund.status} ${JSON.stringify(fund.body)}`);
    await fn({ port, stack, keys: { admin: admin.secret, user: user.secret }, fromAccountId, toAccountId });
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
      reason: "ledger-transfer wire-up integration test reason",
    },
    stack.signer,
  );
  return encodeBreakGlassTicket(ticket);
}

function countConsumed(stack: ReturnType<typeof buildSovereignStack>, tenantId: string): number {
  const chain = stack.auditStore.getChain(tenantId);
  return chain.filter((r: any) => r.actionType === BREAK_GLASS_CONSUMED_ACTION_TYPE).length;
}

function transferBody(fromId: string, toId: string, amount: string): unknown {
  return { fromAccountId: fromId, toAccountId: toId, amount, memo: "wire-up test transfer", initiatedBy: "test" };
}

// ─── tests ──────────────────────────────────────────────────────────────────

test("wire-up transfer: valid break-glass ticket + scope-less api key → 200 + consumed audit", async () => {
  await withServer(async ({ port, stack, keys, fromAccountId, toAccountId }) => {
    const ticket = issueTicket(stack, { tenantId: "t1", grantScope: "ledger:transfer" });
    const before = countConsumed(stack, "t1");
    const res = await httpRequest(port, "POST", "/api/ledger/transfer", {
      apiKey: keys.user, // NO ledger:transfer scope
      ticket,
      body: transferBody(fromAccountId, toAccountId, "1000"),
    });
    eq(res.status, 200);
    eq(res.body.ok, true);
    eq(countConsumed(stack, "t1"), before + 1);
  });
});

test("wire-up transfer: superadmin ticket covers ledger:transfer → 200", async () => {
  await withServer(async ({ port, stack, keys, fromAccountId, toAccountId }) => {
    const ticket = issueTicket(stack, { tenantId: "t1", grantScope: "superadmin" });
    const res = await httpRequest(port, "POST", "/api/ledger/transfer", {
      apiKey: keys.user,
      ticket,
      body: transferBody(fromAccountId, toAccountId, "2000"),
    });
    eq(res.status, 200);
    eq(res.body.ok, true);
  });
});

test("wire-up transfer: no ticket + no scope → 403 (RBAC fallback unchanged)", async () => {
  await withServer(async ({ port, stack, keys, fromAccountId, toAccountId }) => {
    const before = countConsumed(stack, "t1");
    const res = await httpRequest(port, "POST", "/api/ledger/transfer", {
      apiKey: keys.user,
      body: transferBody(fromAccountId, toAccountId, "500"),
    });
    eq(res.status, 403);
    eq(countConsumed(stack, "t1"), before); // RBAC denial does NOT write the consumed-audit
  });
});

test("wire-up transfer: no ticket + scope present → 200 (RBAC fallback unchanged, no regression)", async () => {
  await withServer(async ({ port, stack, keys, fromAccountId, toAccountId }) => {
    const before = countConsumed(stack, "t1");
    const res = await httpRequest(port, "POST", "/api/ledger/transfer", {
      apiKey: keys.admin,
      body: transferBody(fromAccountId, toAccountId, "750"),
    });
    eq(res.status, 200);
    eq(res.body.ok, true);
    eq(countConsumed(stack, "t1"), before); // RBAC path does not write the consumed-audit
  });
});

test("wire-up transfer: replay (same ticket twice) → second call 409, exactly ONE consumed audit", async () => {
  await withServer(async ({ port, stack, keys, fromAccountId, toAccountId }) => {
    const ticket = issueTicket(stack, { tenantId: "t1", grantScope: "ledger:transfer" });
    const before = countConsumed(stack, "t1");
    const a = await httpRequest(port, "POST", "/api/ledger/transfer", {
      apiKey: keys.user,
      ticket,
      body: transferBody(fromAccountId, toAccountId, "100"),
    });
    eq(a.status, 200);
    const b = await httpRequest(port, "POST", "/api/ledger/transfer", {
      apiKey: keys.user,
      ticket,
      body: transferBody(fromAccountId, toAccountId, "100"),
    });
    // transfer does NOT rotate the kernel signer, so the ticket signature
    // stays valid and the nonce-replay branch fires deterministically.
    eq(b.status, 409);
    eq(countConsumed(stack, "t1"), before + 1);
  });
});

test("wire-up transfer: ticket for wrong scope → 403, transfer does NOT execute", async () => {
  await withServer(async ({ port, stack, keys, fromAccountId, toAccountId }) => {
    const ticket = issueTicket(stack, { tenantId: "t1", grantScope: "admin:key-rotation" });
    const before = countConsumed(stack, "t1");
    const res = await httpRequest(port, "POST", "/api/ledger/transfer", {
      apiKey: keys.user,
      ticket,
      body: transferBody(fromAccountId, toAccountId, "100"),
    });
    eq(res.status, 403);
    eq(countConsumed(stack, "t1"), before); // denied before nonce/audit
  });
});

test("wire-up transfer: cross-tenant ticket → 401, no consumed audit in either tenant", async () => {
  await withServer(async ({ port, stack, keys, fromAccountId, toAccountId }) => {
    const ticket = issueTicket(stack, { tenantId: "t-other", grantScope: "ledger:transfer" });
    const before = countConsumed(stack, "t1");
    const res = await httpRequest(port, "POST", "/api/ledger/transfer", {
      apiKey: keys.user, // resolves to t1
      ticket,
      body: transferBody(fromAccountId, toAccountId, "100"),
    });
    eq(res.status, 401);
    eq(countConsumed(stack, "t1"), before);
    eq(countConsumed(stack, "t-other"), 0);
  });
});

test("wire-up transfer: garbage ticket → 401 (does NOT fall through to RBAC)", async () => {
  await withServer(async ({ port, stack, keys, fromAccountId, toAccountId }) => {
    const res = await httpRequest(port, "POST", "/api/ledger/transfer", {
      apiKey: keys.admin, // has scope, but garbage ticket must short-circuit
      ticket: "!!!not-base64!!!",
      body: transferBody(fromAccountId, toAccountId, "100"),
    });
    eq(res.status, 401);
    assert(res.body.error || res.body.error === "", "denial body present");
  });
});
