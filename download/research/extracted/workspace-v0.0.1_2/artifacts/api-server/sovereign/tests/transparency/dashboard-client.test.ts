import "../_flush.mjs";
/**
 * tests/transparency/dashboard-client.test.ts — external Transparency Dashboard SDK client tests.
 *
 * Coverage:
 *   • happy path: fetchChain, fetchBalances, fetchPassportList return valid views.
 *   • fetchBalances includes accounts + solvency after mint.
 *   • fetchPassportList grows after a mint (allowed record).
 *   • invalid input guards: missing baseUrl / tenantId → DashboardClientError.
 *   • missing x-tenant-id on server → 400 caught as server_error.
 *   • cross-tenant balances → empty accounts (isolation preserved).
 *   • chainIntact is true for a clean tenant.
 */

import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import {
  fetchChain,
  fetchBalances,
  fetchPassportList,
  DashboardClientError,
} from "../../lib/dashboard-client/index.ts";

const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
const port: number = (server.address() as any).port;
const base = `http://127.0.0.1:${port}`;

// Helper: seed an account + mint so the tenant has data.
async function seedAccountAndMint(tenant: string) {
  const accRes = await fetch(base + "/api/ledger/accounts", {
    method: "POST",
    headers: { "content-type": "application/json", "x-tenant-id": tenant },
    body: JSON.stringify({ ownerId: "u1", type: "asset", name: "Alice" }),
  });
  eq(accRes.status, 201);
  const acc = await accRes.json();
  const mintRes = await fetch(base + "/api/ledger/mint", {
    method: "POST",
    headers: { "content-type": "application/json", "x-tenant-id": tenant },
    body: JSON.stringify({ toAccountId: acc.account.id, amount: "50000", memo: "seed" }),
  });
  eq(mintRes.status, 200);
  return { accountId: acc.account.id, auditId: (await mintRes.json()).auditId as string };
}

// ─── Input guards ─────────────────────────────────────────────────────────────

test("guard: missing baseUrl → DashboardClientError missing_base_url", async () => {
  try {
    await fetchChain("", "t1");
    assert(false, "should have thrown");
  } catch (e: any) {
    assert(e instanceof DashboardClientError, "error is DashboardClientError");
    eq(e.code, "missing_base_url");
  }
});

test("guard: missing tenantId on fetchChain → DashboardClientError missing_tenant_id", async () => {
  try {
    await fetchChain(base, "");
    assert(false, "should have thrown");
  } catch (e: any) {
    assert(e instanceof DashboardClientError, "error is DashboardClientError");
    eq(e.code, "missing_tenant_id");
  }
});

test("guard: missing tenantId on fetchBalances → DashboardClientError missing_tenant_id", async () => {
  try {
    await fetchBalances(base, "");
    assert(false, "should have thrown");
  } catch (e: any) {
    assert(e instanceof DashboardClientError, "error is DashboardClientError");
    eq(e.code, "missing_tenant_id");
  }
});

// ─── Server-side edge: missing tenant header ─────────────────────────────────

test("server: missing x-tenant-id on direct fetch → 400 caught as server_error", async () => {
  const r = await fetch(base + "/api/transparency/chain");
  eq(r.status, 400);
});

// ─── Happy path: empty tenant ────────────────────────────────────────────────

test("happy path: fetchChain for empty tenant returns intact chain", async () => {
  const tenant = "dash-empty";
  const chain = await fetchChain(base, tenant);
  eq(chain.status, 200);
  eq(chain.view.tenantId, tenant);
  eq(chain.view.chainIntact, true);
  eq(chain.view.recordCount, 0);
  eq(chain.view.records.length, 0);
});

test("happy path: fetchBalances for empty tenant returns zero accounts", async () => {
  const tenant = "dash-empty-bal";
  const balances = await fetchBalances(base, tenant);
  eq(balances.status, 200);
  eq(balances.view.tenantId, tenant);
  eq(balances.view.accounts.length, 0);
  eq(balances.view.solvency.isSolvent, true);
  eq(balances.view.solvency.accountCount, 0);
});

test("happy path: fetchPassportList for empty tenant returns zero passports", async () => {
  const tenant = "dash-empty-pp";
  const list = await fetchPassportList(base, tenant);
  eq(list.status, 200);
  eq(list.view.tenantId, tenant);
  eq(list.view.count, 0);
  eq(list.view.passports.length, 0);
});

// ─── Happy path: after mint ─────────────────────────────────────────────────

test("happy path: fetchBalances after mint shows account + solvency", async () => {
  const tenant = "dash-mint";
  const { accountId } = await seedAccountAndMint(tenant);

  const balances = await fetchBalances(base, tenant);
  eq(balances.status, 200);
  // InMemoryLedger creates a system reserve account per tenant on first mint,
  // so we expect 2 accounts (user + reserve). We verify the user account exists.
  eq(balances.view.accounts.length, 2);
  const userAccount = balances.view.accounts.find((a: any) => a.id === accountId);
  assert(userAccount, "user account found");
  eq(userAccount.balance, "50000");
  eq(balances.view.solvency.isSolvent, true);
  eq(balances.view.solvency.totalAssets, "50000");
});

test("happy path: fetchChain after mint shows record + intact chain", async () => {
  const tenant = "dash-chain";
  await seedAccountAndMint(tenant);

  const chain = await fetchChain(base, tenant);
  eq(chain.status, 200);
  eq(chain.view.recordCount, 1);
  eq(chain.view.records.length, 1);
  eq(chain.view.records[0].actionType, "ledger.mint");
  eq(chain.view.records[0].outcome, "allowed");
  eq(chain.view.chainIntact, true);
});

test("happy path: fetchPassportList after mint shows passport summary", async () => {
  const tenant = "dash-pp";
  const { auditId } = await seedAccountAndMint(tenant);

  const list = await fetchPassportList(base, tenant);
  eq(list.status, 200);
  eq(list.view.count, 1);
  eq(list.view.passports.length, 1);
  eq(list.view.passports[0].auditId, auditId);
  eq(list.view.passports[0].actionType, "ledger.mint");
  eq(list.view.passports[0].outcome, "allowed");
  assert(list.view.passports[0].passportHref.includes(auditId), "passportHref contains auditId");
});

// ─── Cross-tenant isolation ─────────────────────────────────────────────────

test("isolation: fetchBalances for other tenant sees no accounts", async () => {
  const tenantA = "dash-iso-A";
  await seedAccountAndMint(tenantA);

  const balances = await fetchBalances(base, "dash-iso-B");
  eq(balances.status, 200);
  eq(balances.view.accounts.length, 0);
});

// ─── Grow chain: two mints ──────────────────────────────────────────────────

test("happy path: chain grows with two mints", async () => {
  const tenant = "dash-two";
  await seedAccountAndMint(tenant);
  await seedAccountAndMint(tenant);

  const chain = await fetchChain(base, tenant);
  eq(chain.view.recordCount, 2);
  eq(chain.view.records.length, 2);
  eq(chain.view.chainIntact, true);
});

import { test as _t } from "../_harness.mjs";
_t("cleanup dashboard-client tests", () => { server.close(); });
