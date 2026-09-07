import "../_flush.mjs";
/**
 * tests/sovereignty/break-glass-wireup-ledger-withdraw.test.ts — v201 substep 3
 * of "break-glass wire-up — המשך": the chokepoint (v197) and the wire-up
 * pattern established for rotate-key (v198), ledger/mint (v199) and
 * ledger/transfer (v200) is now extended to `POST /api/ledger/withdraw`.
 *
 * Scope: `ledger:transfer` (same scope as transfer — a single scope gates all
 * value-moving ledger operations: mint, transfer, withdraw).
 *
 * Coverage (8 tests) — symmetric to the ledger/transfer wire-up suite:
 *   • happy: caller WITHOUT ledger:transfer scope, but WITH a valid
 *     `x-break-glass-ticket` for that scope → 200 + withdraw executes +
 *     signed break-glass.consumed audit appended.
 *   • superadmin ticket covers ledger:transfer → 200.
 *   • no ticket + no scope → 403 (RBAC fallback unchanged).
 *   • no ticket + scope present → 200 (RBAC fallback unchanged — zero regression).
 *   • replay (same ticket twice) → second call 409 + exactly ONE consumed audit.
 *   • ticket for wrong scope (admin:key-rotation) → 403, withdraw NOT executed.
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
}

async function withServer(fn: (ctx: TestCtx) => Promise<void>): Promise<void> {
  const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  // admin key carries ledger:mint (for setup funding) + ledger:transfer (for
  // the RBAC-fallback positive test — same scope gates withdraw).
  // user key has adapter:run only — no ledger:transfer — proving that a
  // break-glass ticket, not RBAC scope, grants the withdrawal.
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
    // Pre-create a source account, then fund it via mint.
    // Withdraw drains from that account (unlike transfer it has no destination).
    const accRes = await httpRequest(port, "POST", "/api/ledger/accounts", {
      tenantId: "t1",
      body: { ownerId: "u1", type: "asset", name: "wire-up withdraw source" },
    });
    if (accRes.status !== 201) throw new Error(`setup createAccount failed: ${accRes.status}`);
    const fromAccountId = accRes.body.account.id as string;

    // Fund with 1_000_000 μ¢ — plenty for all the suite's small withdrawals.
    const fund = await httpRequest(port, "POST", "/api/ledger/mint", {
      apiKey: admin.secret,
      body: { toAccountId: fromAccountId, amount: "1000000", memo: "setup-fund", initiatedBy: "test-setup" },
    });
    if (fund.status !== 200) throw new Error(`setup mint failed: ${fund.status} ${JSON.stringify(fund.body)}`);

    await fn({ port, stack, keys: { admin: admin.secret, user: user.secret }, fromAccountId });
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
      reason: "ledger-withdraw wire-up integration test reason",
    },
    stack.signer,
  );
  return encodeBreakGlassTicket(ticket);
}

function countConsumed(stack: ReturnType<typeof buildSovereignStack>, tenantId: string): number {
  const chain = stack.auditStore.getChain(tenantId);
  return chain.filter((r: any) => r.actionType === BREAK_GLASS_CONSUMED_ACTION_TYPE).length;
}

function withdrawBody(fromId: string, amount: string): unknown {
  return { fromAccountId: fromId, amount, memo: "wire-up test withdraw", initiatedBy: "test" };
}

// ─── tests ──────────────────────────────────────────────────────────────────

test("wire-up withdraw: valid break-glass ticket + scope-less api key → 200 + consumed audit", async () => {
  await withServer(async ({ port, stack, keys, fromAccountId }) => {
    const ticket = issueTicket(stack, { tenantId: "t1", grantScope: "ledger:transfer" });
    const before = countConsumed(stack, "t1");
    const res = await httpRequest(port, "POST", "/api/ledger/withdraw", {
      apiKey: keys.user, // NO ledger:transfer scope
      ticket,
      body: withdrawBody(fromAccountId, "1000"),
    });
    eq(res.status, 200);
    eq(res.body.ok, true);
    eq(countConsumed(stack, "t1"), before + 1);
  });
});

test("wire-up withdraw: superadmin ticket covers ledger:transfer → 200", async () => {
  await withServer(async ({ port, stack, keys, fromAccountId }) => {
    const ticket = issueTicket(stack, { tenantId: "t1", grantScope: "superadmin" });
    const res = await httpRequest(port, "POST", "/api/ledger/withdraw", {
      apiKey: keys.user,
      ticket,
      body: withdrawBody(fromAccountId, "2000"),
    });
    eq(res.status, 200);
    eq(res.body.ok, true);
  });
});

test("wire-up withdraw: no ticket + no scope → 403 (RBAC fallback unchanged)", async () => {
  await withServer(async ({ port, keys, stack, fromAccountId }) => {
    const before = countConsumed(stack, "t1");
    const res = await httpRequest(port, "POST", "/api/ledger/withdraw", {
      apiKey: keys.user,
      body: withdrawBody(fromAccountId, "500"),
    });
    eq(res.status, 403);
    eq(countConsumed(stack, "t1"), before); // RBAC denial does NOT write consumed-audit
  });
});

test("wire-up withdraw: no ticket + scope present → 200 (RBAC fallback unchanged, no regression)", async () => {
  await withServer(async ({ port, keys, stack, fromAccountId }) => {
    const before = countConsumed(stack, "t1");
    const res = await httpRequest(port, "POST", "/api/ledger/withdraw", {
      apiKey: keys.admin,
      body: withdrawBody(fromAccountId, "750"),
    });
    eq(res.status, 200);
    eq(res.body.ok, true);
    eq(countConsumed(stack, "t1"), before); // RBAC path does not write consumed-audit
  });
});

test("wire-up withdraw: replay (same ticket twice) → second call 409, exactly ONE consumed audit", async () => {
  await withServer(async ({ port, stack, keys, fromAccountId }) => {
    const ticket = issueTicket(stack, { tenantId: "t1", grantScope: "ledger:transfer" });
    const before = countConsumed(stack, "t1");
    const a = await httpRequest(port, "POST", "/api/ledger/withdraw", {
      apiKey: keys.user,
      ticket,
      body: withdrawBody(fromAccountId, "100"),
    });
    eq(a.status, 200);
    const b = await httpRequest(port, "POST", "/api/ledger/withdraw", {
      apiKey: keys.user,
      ticket,
      body: withdrawBody(fromAccountId, "100"),
    });
    eq(b.status, 409);
    eq(countConsumed(stack, "t1"), before + 1);
  });
});

test("wire-up withdraw: ticket for wrong scope → 403, withdraw does NOT execute", async () => {
  await withServer(async ({ port, stack, keys, fromAccountId }) => {
    const ticket = issueTicket(stack, { tenantId: "t1", grantScope: "admin:key-rotation" });
    const before = countConsumed(stack, "t1");
    const res = await httpRequest(port, "POST", "/api/ledger/withdraw", {
      apiKey: keys.user,
      ticket,
      body: withdrawBody(fromAccountId, "100"),
    });
    eq(res.status, 403);
    eq(countConsumed(stack, "t1"), before); // denied before nonce/audit
  });
});

test("wire-up withdraw: cross-tenant ticket → 401, no consumed audit in either tenant", async () => {
  await withServer(async ({ port, stack, keys, fromAccountId }) => {
    const ticket = issueTicket(stack, { tenantId: "t-other", grantScope: "ledger:transfer" });
    const before = countConsumed(stack, "t1");
    const res = await httpRequest(port, "POST", "/api/ledger/withdraw", {
      apiKey: keys.user, // resolves to t1
      ticket,
      body: withdrawBody(fromAccountId, "100"),
    });
    eq(res.status, 401);
    eq(countConsumed(stack, "t1"), before);
    eq(countConsumed(stack, "t-other"), 0);
  });
});

test("wire-up withdraw: garbage ticket → 401 (does NOT fall through to RBAC)", async () => {
  await withServer(async ({ port, keys, fromAccountId }) => {
    const res = await httpRequest(port, "POST", "/api/ledger/withdraw", {
      apiKey: keys.admin, // has scope, but garbage ticket must short-circuit
      ticket: "!!!not-base64!!!",
      body: withdrawBody(fromAccountId, "100"),
    });
    eq(res.status, 401);
    assert(res.body.error !== undefined, "denial body present");
  });
});
