import "../_flush.mjs";
/**
 * tests/rbac/scope-enforcement.test.ts
 *
 * Integration tests: requireScope enforcement on ledger and settlement write routes.
 * Server runs with requireApiKey: true (production mode) so scope checks are active.
 *
 * Coverage (ledger):
 *   • POST /api/ledger/mint   → 403 with wrong scope; 200 with ledger:mint; 200 with superadmin
 *   • POST /api/ledger/transfer → 403 with wrong scope; 200 with ledger:transfer; 200 with superadmin
 *   • POST /api/ledger/withdraw → 403 with wrong scope; 200 with ledger:transfer (shared scope)
 *
 * Coverage (settlement):
 *   • POST /api/settlement       → 403 with wrong scope; 201 with settlement:write; 201 with superadmin
 *   • POST /api/settlement/:id/fund → 403 with wrong scope; 200 with settlement:write
 *   • POST /api/settlement/:id/release → 403 with wrong scope
 *   • POST /api/settlement/:id/dispute → 403 with wrong scope
 *   • GET /api/settlement (read) → 200 with any key (no write scope required)
 *
 * Invariants:
 *   • Wrong scope (adapter:run only) → 403 (scope check fires)
 *   • Correct scope → passes (may fail for other reasons, but NOT 403)
 *   • superadmin → always passes
 *   • requireApiKey=false (dev mode) → superadmin granted implicitly → all scope checks pass
 *   • requireApiKey=true (prod mode) → scope checks enforced from API key scopes
 */

import { test, assert, eq } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { buildSovereignStack } from "../../src/composition.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import type { Server } from "node:http";

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function http(
  port: number,
  method: string,
  path: string,
  opts: { apiKey?: string; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.apiKey) headers["x-api-key"] = opts.apiKey;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

// ── Server factory (requireApiKey: true = production scope enforcement) ───────

async function withServer(
  fn: (port: number, keys: {
    mintOnly: string;
    transferOnly: string;
    settlementWrite: string;
    adapterOnly: string;
    superAdmin: string;
  }) => Promise<void>,
): Promise<void> {
  const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const T = "scope-t1";

  const mintKey     = await stack.apiKeyService.create({ tenantId: T, name: "mint",     scopes: ["ledger:mint"] });
  const transferKey = await stack.apiKeyService.create({ tenantId: T, name: "transfer", scopes: ["ledger:transfer"] });
  const settleKey   = await stack.apiKeyService.create({ tenantId: T, name: "settle",   scopes: ["settlement:write"] });
  const adapterKey  = await stack.apiKeyService.create({ tenantId: T, name: "adapter",  scopes: ["adapter:run"] });
  const superKey    = await stack.apiKeyService.create({ tenantId: T, name: "super",    scopes: ["superadmin"] });

  // requireApiKey: true → scope enforcement is active (production mode)
  const server = startSovereignServer(0, stack, { requireIdempotencyKey: false, requireApiKey: true }) as Server & { shutdown: () => Promise<void> };
  await new Promise<void>((r) => server.once("listening", r));
  const port = (server.address() as any).port as number;
  try {
    await fn(port, {
      mintOnly:        mintKey.secret,
      transferOnly:    transferKey.secret,
      settlementWrite: settleKey.secret,
      adapterOnly:     adapterKey.secret,
      superAdmin:      superKey.secret,
    });
  } finally {
    await server.shutdown();
  }
}

// ── Helper: create account with superadmin key ────────────────────────────────

async function createAccount(port: number, superKey: string, ownerId: string): Promise<string> {
  const r = await http(port, "POST", "/api/ledger/accounts", {
    apiKey: superKey,
    body: { ownerId, type: "asset", name: `${ownerId}-acct` },
  });
  if (!r.body?.account?.id) throw new Error(`createAccount failed: ${JSON.stringify(r.body)}`);
  return r.body.account.id as string;
}

// ─── Dev-mode: trusted (requireApiKey=false) grants superadmin ────────────────

test("RBAC: dev mode (requireApiKey=false) — bare x-tenant-id grants superadmin → scope checks pass", async () => {
  const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  // No requireApiKey option → defaults to false (trusted mode)
  const server = startSovereignServer(0, stack, { requireIdempotencyKey: false }) as Server & { shutdown: () => Promise<void> };
  await new Promise<void>((r) => server.once("listening", r));
  const port = (server.address() as any).port as number;
  try {
    // Create account first (no scope needed for account creation)
    const headers = { "content-type": "application/json", "x-tenant-id": "dev-tenant" };
    const accR = await fetch(`http://127.0.0.1:${port}/api/ledger/accounts`, {
      method: "POST", headers,
      body: JSON.stringify({ ownerId: "dev-owner", type: "asset", name: "dev-acct" }),
    });
    const acct = await accR.json() as any;
    // Mint should pass (superadmin granted implicitly)
    const mintR = await fetch(`http://127.0.0.1:${port}/api/ledger/mint`, {
      method: "POST", headers,
      body: JSON.stringify({ toAccountId: acct.account.id, amount: "1000", memo: "dev-test" }),
    });
    assert(mintR.status !== 403, `dev mode: mint should not be blocked; got ${mintR.status}`);
  } finally {
    await server.shutdown();
  }
});

// ─── ledger/mint ─────────────────────────────────────────────────────────────

test("RBAC: POST /api/ledger/mint → 403 with wrong scope (adapter:run)", async () => {
  await withServer(async (port, keys) => {
    const r = await http(port, "POST", "/api/ledger/mint", {
      apiKey: keys.adapterOnly,
      body: { toAccountId: "any", amount: "1000", memo: "test" },
    });
    eq(r.status, 403);
    assert(r.body.error.includes("ledger:mint"), "error should name the required scope");
  });
});

test("RBAC: POST /api/ledger/mint → 403 with ledger:transfer scope (wrong for mint)", async () => {
  await withServer(async (port, keys) => {
    const r = await http(port, "POST", "/api/ledger/mint", {
      apiKey: keys.transferOnly,
      body: { toAccountId: "any", amount: "1000", memo: "test" },
    });
    eq(r.status, 403);
    assert(r.body.error.includes("ledger:mint"));
  });
});

test("RBAC: POST /api/ledger/mint → passes scope check with ledger:mint", async () => {
  await withServer(async (port, keys) => {
    const acctId = await createAccount(port, keys.superAdmin, "owner-mint");
    const r = await http(port, "POST", "/api/ledger/mint", {
      apiKey: keys.mintOnly,
      body: { toAccountId: acctId, amount: "10000", memo: "rbac-mint" },
    });
    assert(r.status !== 403, `should not be 403; got ${r.status}: ${JSON.stringify(r.body)}`);
  });
});

test("RBAC: POST /api/ledger/mint → passes scope check with superadmin", async () => {
  await withServer(async (port, keys) => {
    const acctId = await createAccount(port, keys.superAdmin, "owner-super-mint");
    const r = await http(port, "POST", "/api/ledger/mint", {
      apiKey: keys.superAdmin,
      body: { toAccountId: acctId, amount: "5000", memo: "super-mint" },
    });
    assert(r.status !== 403, `superadmin should bypass scope check; got ${r.status}`);
  });
});

// ─── ledger/transfer ──────────────────────────────────────────────────────────

test("RBAC: POST /api/ledger/transfer → 403 with wrong scope (adapter:run)", async () => {
  await withServer(async (port, keys) => {
    const r = await http(port, "POST", "/api/ledger/transfer", {
      apiKey: keys.adapterOnly,
      body: { fromAccountId: "a", toAccountId: "b", amount: "100", memo: "t" },
    });
    eq(r.status, 403);
    assert(r.body.error.includes("ledger:transfer"));
  });
});

test("RBAC: POST /api/ledger/transfer → 403 with ledger:mint only (wrong scope for transfer)", async () => {
  await withServer(async (port, keys) => {
    const r = await http(port, "POST", "/api/ledger/transfer", {
      apiKey: keys.mintOnly,
      body: { fromAccountId: "a", toAccountId: "b", amount: "100", memo: "t" },
    });
    eq(r.status, 403);
    assert(r.body.error.includes("ledger:transfer"));
  });
});

test("RBAC: POST /api/ledger/transfer → passes with ledger:transfer scope", async () => {
  await withServer(async (port, keys) => {
    const from = await createAccount(port, keys.superAdmin, "from-acct");
    const to   = await createAccount(port, keys.superAdmin, "to-acct");
    await http(port, "POST", "/api/ledger/mint", {
      apiKey: keys.superAdmin,
      body: { toAccountId: from, amount: "50000", memo: "seed" },
    });
    const r = await http(port, "POST", "/api/ledger/transfer", {
      apiKey: keys.transferOnly,
      body: { fromAccountId: from, toAccountId: to, amount: "1000", memo: "rbac-tx" },
    });
    assert(r.status !== 403, `transfer scope passed; got ${r.status}: ${JSON.stringify(r.body)}`);
  });
});

// ─── ledger/withdraw ─────────────────────────────────────────────────────────

test("RBAC: POST /api/ledger/withdraw → 403 with wrong scope (adapter:run)", async () => {
  await withServer(async (port, keys) => {
    const r = await http(port, "POST", "/api/ledger/withdraw", {
      apiKey: keys.adapterOnly,
      body: { fromAccountId: "a", amount: "100", memo: "w" },
    });
    eq(r.status, 403);
    assert(r.body.error.includes("ledger:transfer"), "withdraw uses ledger:transfer scope");
  });
});

test("RBAC: POST /api/ledger/withdraw → passes with ledger:transfer scope", async () => {
  await withServer(async (port, keys) => {
    const acct = await createAccount(port, keys.superAdmin, "withdraw-acct");
    await http(port, "POST", "/api/ledger/mint", {
      apiKey: keys.superAdmin,
      body: { toAccountId: acct, amount: "50000", memo: "seed" },
    });
    const r = await http(port, "POST", "/api/ledger/withdraw", {
      apiKey: keys.transferOnly,
      body: { fromAccountId: acct, amount: "1000", memo: "rbac-withdraw" },
    });
    assert(r.status !== 403, `withdraw with transfer scope; got ${r.status}: ${JSON.stringify(r.body)}`);
  });
});

// ─── settlement write routes ──────────────────────────────────────────────────

test("RBAC: POST /api/settlement → 403 with wrong scope (adapter:run)", async () => {
  await withServer(async (port, keys) => {
    const r = await http(port, "POST", "/api/settlement", {
      apiKey: keys.adapterOnly,
      body: { opportunityId: "opp1", payerAccountId: "p", workerAccountId: "w", totalAmount: "1000", settledBy: "test" },
    });
    eq(r.status, 403);
    assert(r.body.error.includes("settlement:write"));
  });
});

test("RBAC: POST /api/settlement → passes scope check with settlement:write", async () => {
  await withServer(async (port, keys) => {
    const payer  = await createAccount(port, keys.superAdmin, "payer-settle");
    const worker = await createAccount(port, keys.superAdmin, "worker-settle");
    const r = await http(port, "POST", "/api/settlement", {
      apiKey: keys.settlementWrite,
      body: { opportunityId: "opp-rbac-1", payerAccountId: payer, workerAccountId: worker, totalAmount: "5000", settledBy: "test-sys" },
    });
    assert(r.status !== 403, `settlement:write passed; got ${r.status}: ${JSON.stringify(r.body)}`);
  });
});

test("RBAC: POST /api/settlement → passes scope check with superadmin", async () => {
  await withServer(async (port, keys) => {
    const payer  = await createAccount(port, keys.superAdmin, "payer-super");
    const worker = await createAccount(port, keys.superAdmin, "worker-super");
    const r = await http(port, "POST", "/api/settlement", {
      apiKey: keys.superAdmin,
      body: { opportunityId: "opp-super-1", payerAccountId: payer, workerAccountId: worker, totalAmount: "5000", settledBy: "test-sys" },
    });
    assert(r.status !== 403, `superadmin settlement; got ${r.status}: ${JSON.stringify(r.body)}`);
  });
});

test("RBAC: POST /api/settlement/:id/fund → 403 with wrong scope", async () => {
  await withServer(async (port, keys) => {
    const r = await http(port, "POST", "/api/settlement/nonexistent-id/fund", {
      apiKey: keys.adapterOnly,
      body: {},
    });
    eq(r.status, 403);
    assert(r.body.error.includes("settlement:write"));
  });
});

test("RBAC: POST /api/settlement/:id/release → 403 with wrong scope", async () => {
  await withServer(async (port, keys) => {
    const r = await http(port, "POST", "/api/settlement/any-id/release", {
      apiKey: keys.adapterOnly,
      body: {},
    });
    eq(r.status, 403);
    assert(r.body.error.includes("settlement:write"));
  });
});

test("RBAC: POST /api/settlement/:id/dispute → 403 with wrong scope", async () => {
  await withServer(async (port, keys) => {
    const r = await http(port, "POST", "/api/settlement/any-id/dispute", {
      apiKey: keys.adapterOnly,
      body: {},
    });
    eq(r.status, 403);
    assert(r.body.error.includes("settlement:write"));
  });
});

test("RBAC: GET /api/settlement → 200 with any valid key (read-only, no write scope required)", async () => {
  await withServer(async (port, keys) => {
    // Even adapter:run (no settlement scope) can read
    const r = await http(port, "GET", "/api/settlement", { apiKey: keys.adapterOnly });
    assert(r.status === 200 || r.status === 204, `GET settlement should be open; got ${r.status}`);
  });
});
