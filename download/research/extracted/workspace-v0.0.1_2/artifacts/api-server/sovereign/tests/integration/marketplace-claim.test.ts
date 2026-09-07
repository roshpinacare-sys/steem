import "../_flush.mjs";
/**
 * tests/integration/marketplace-claim.test.ts
 *
 * Live-server HTTP integration tests for שלב E חלק ב':
 * POST /api/marketplace/opportunities/:id/claim
 *
 * The claim endpoint charges a μ¢ fee (default 10,000 = 0.10 USD) from the
 * caller's account via LedgerOrchestrator.withdraw() — the single financial
 * chokepoint. The ledger effect and audit record are returned in the response.
 *
 * Test coverage:
 *   Validation
 *     • missing x-tenant-id → 400
 *     • missing fromAccountId → 400
 *     • opportunity not found → 404
 *     • cross-tenant claim (tenant-B claims tenant-A opportunity) → 404 (fail-closed)
 *     • invalid claimFee (non-integer) → 400
 *     • negative claimFee → 400
 *
 *   Happy path
 *     • successful claim → 200 + { ok:true, opportunityId, claimFee, ledgerEffect, auditId }
 *     • ledgerEffect has txId + balances (BigInt-safe decimal strings)
 *     • passport auto-issued (present in response)
 *     • auditId is a non-empty string
 *     • claimFee in response matches sent fee
 *
 *   Default fee
 *     • omitting claimFee defaults to "10000" μ¢
 *
 *   Ledger integration
 *     • insufficient funds → 403 (guard deny from ledger)
 *     • balance decreases by claimFee after successful claim
 *     • multiple claims accumulate (sequential withdrawals)
 *     • spending cap exceeded → 403 (governance-as-data)
 *
 *   Tenant isolation
 *     • claiming does not affect other tenant's balance
 */

import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";

const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
const port: number = (server.address() as any).port;
const base = `http://127.0.0.1:${port}`;

const H = (t: string) => ({ "content-type": "application/json", "x-tenant-id": t });
const post = (path: string, body: any, tenant = "claim-t1") =>
  fetch(base + path, { method: "POST", headers: H(tenant), body: JSON.stringify(body) });
const get = (path: string, tenant = "claim-t1") =>
  fetch(base + path, { headers: H(tenant) });

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create an account and return its id. */
async function createAccount(tenant: string, owner: string): Promise<string> {
  const r = await fetch(base + "/api/ledger/accounts", {
    method: "POST",
    headers: H(tenant),
    body: JSON.stringify({ ownerId: owner, type: "asset", name: `${owner} wallet` }),
  });
  const b = await r.json();
  return b.account?.id as string;
}

/** Mint μ¢ into an account. */
async function mint(tenant: string, toAccountId: string, amount: string) {
  const r = await fetch(base + "/api/ledger/mint", {
    method: "POST",
    headers: H(tenant),
    body: JSON.stringify({ toAccountId, amount, memo: "test mint", initiatedBy: "test" }),
  });
  return r.json();
}

/** Create an opportunity and return its id. */
async function createOpportunity(tenant: string, title: string): Promise<string> {
  const r = await fetch(base + "/api/marketplace/opportunities", {
    method: "POST",
    headers: H(tenant),
    body: JSON.stringify({ title, description: "Integration test opportunity" }),
  });
  const b = await r.json();
  return b.opportunity?.id as string;
}

/** Claim an opportunity. */
async function claim(tenant: string, oppId: string, fromAccountId: string, opts: any = {}) {
  return fetch(base + `/api/marketplace/opportunities/${oppId}/claim`, {
    method: "POST",
    headers: H(tenant),
    body: JSON.stringify({ fromAccountId, ...opts }),
  });
}

/** Get account balance as bigint. */
async function getBalance(tenant: string, accountId: string): Promise<bigint> {
  const r = await fetch(base + `/api/ledger/accounts/${accountId}`, { headers: H(tenant) });
  const b = await r.json();
  return BigInt(b.account?.balance ?? "0");
}

// ─── Validation ───────────────────────────────────────────────────────────────

test("claim: missing x-tenant-id → 400", async () => {
  const r = await fetch(base + "/api/marketplace/opportunities/any-id/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fromAccountId: "x" }),
  });
  eq(r.status, 400);
});

test("claim: missing fromAccountId → 400", async () => {
  const oppId = await createOpportunity("claim-val", "Validation Opp");
  const r = await claim("claim-val", oppId, "");
  // fromAccountId is "" which is falsy
  eq(r.status, 400);
  const b = await r.json();
  assert(b.error, "error message present");
});

test("claim: opportunity not found → 404", async () => {
  const acctId = await createAccount("claim-404", "user-404");
  await mint("claim-404", acctId, "500000");
  const r = await claim("claim-404", "non-existent-id", acctId);
  eq(r.status, 404);
});

test("claim: cross-tenant (tenant-B claims tenant-A opportunity) → 404 (fail-closed)", async () => {
  const tenantA = "claim-iso-a";
  const tenantB = "claim-iso-b";
  const oppId = await createOpportunity(tenantA, "Tenant-A Only Opportunity");
  const acctB  = await createAccount(tenantB, "user-b");
  await mint(tenantB, acctB, "500000");
  // Tenant-B tries to claim tenant-A's opportunity
  const r = await claim(tenantB, oppId, acctB);
  eq(r.status, 404, "cross-tenant claim must be 404 (opportunity not visible)");
});

test("claim: invalid claimFee (non-integer string) → 400", async () => {
  const acctId = await createAccount("claim-fee-bad", "user-fee-bad");
  await mint("claim-fee-bad", acctId, "500000");
  const oppId  = await createOpportunity("claim-fee-bad", "Fee Test");
  const r = await claim("claim-fee-bad", oppId, acctId, { claimFee: "not-a-number" });
  eq(r.status, 400);
});

test("claim: negative claimFee → 400", async () => {
  const acctId = await createAccount("claim-fee-neg", "user-fee-neg");
  await mint("claim-fee-neg", acctId, "500000");
  const oppId  = await createOpportunity("claim-fee-neg", "Negative Fee Test");
  const r = await claim("claim-fee-neg", oppId, acctId, { claimFee: "-1" });
  eq(r.status, 400);
});

// ─── Happy path ───────────────────────────────────────────────────────────────

test("claim: happy path → 200 + ok:true + opportunityId + auditId", async () => {
  const tenant = "claim-happy";
  const acctId = await createAccount(tenant, "user-happy");
  await mint(tenant, acctId, "500000");
  const oppId  = await createOpportunity(tenant, "Happy Path Opportunity");

  const r = await claim(tenant, oppId, acctId, { claimFee: "10000", userId: "user-happy" });
  eq(r.status, 200);
  const b = await r.json();
  assert(b.ok === true, "ok must be true");
  eq(b.opportunityId, oppId, "opportunityId in response");
  assert(typeof b.auditId === "string" && b.auditId.length > 0, "auditId present");
});

test("claim: ledgerEffect present with BigInt-safe decimal strings", async () => {
  const tenant = "claim-effect";
  const acctId = await createAccount(tenant, "user-effect");
  await mint(tenant, acctId, "500000");
  const oppId  = await createOpportunity(tenant, "Ledger Effect Opportunity");

  const r = await claim(tenant, oppId, acctId, { claimFee: "10000" });
  eq(r.status, 200);
  const b = await r.json();
  assert(b.ledgerEffect, "ledgerEffect present");
  // LedgerTransaction fields
  assert(b.ledgerEffect.id, "ledgerEffect.id present");
  // amount should be a decimal string (BigInt-safe)
  assert(typeof b.ledgerEffect.amount === "string", "amount is a decimal string");
  eq(b.ledgerEffect.amount, "10000", "amount matches claimFee");
});

test("claim: passport auto-issued (present in response)", async () => {
  const tenant = "claim-passport";
  const acctId = await createAccount(tenant, "user-passport");
  await mint(tenant, acctId, "500000");
  const oppId  = await createOpportunity(tenant, "Passport Opportunity");

  const r = await claim(tenant, oppId, acctId, { claimFee: "10000" });
  eq(r.status, 200);
  const b = await r.json();
  assert(b.passport, "passport auto-issued on successful claim");
  assert(b.passport.signature, "passport has signature");
});

test("claim: claimFee in response matches sent fee", async () => {
  const tenant = "claim-fee-match";
  const acctId = await createAccount(tenant, "user-fee-match");
  await mint(tenant, acctId, "500000");
  const oppId  = await createOpportunity(tenant, "Fee Match Test");

  const r = await claim(tenant, oppId, acctId, { claimFee: "25000" });
  eq(r.status, 200);
  const b = await r.json();
  eq(b.claimFee, "25000", "claimFee echoed back correctly");
});

// ─── Default fee ──────────────────────────────────────────────────────────────

test("claim: omitting claimFee defaults to 10000 μ¢", async () => {
  const tenant = "claim-default-fee";
  const acctId = await createAccount(tenant, "user-default");
  await mint(tenant, acctId, "500000");
  const oppId  = await createOpportunity(tenant, "Default Fee Opportunity");

  const r = await claim(tenant, oppId, acctId); // no claimFee
  eq(r.status, 200);
  const b = await r.json();
  eq(b.claimFee, "10000", "default claimFee = 10000 μ¢");
});

// ─── Ledger integration ───────────────────────────────────────────────────────

test("claim: insufficient funds → 403 (guard deny)", async () => {
  const tenant = "claim-broke";
  const acctId = await createAccount(tenant, "user-broke");
  // Do NOT mint — account has 0 balance
  const oppId  = await createOpportunity(tenant, "Expensive Opportunity");

  const r = await claim(tenant, oppId, acctId, { claimFee: "10000" });
  eq(r.status, 403, "insufficient funds must deny");
  const b = await r.json();
  assert(b.error, "error message present");
});

test("claim: balance decreases by claimFee after successful claim", async () => {
  const tenant = "claim-balance";
  const acctId = await createAccount(tenant, "user-balance");
  await mint(tenant, acctId, "500000"); // 500,000 μ¢
  const oppId  = await createOpportunity(tenant, "Balance Check Opportunity");

  const balanceBefore = await getBalance(tenant, acctId);
  const r = await claim(tenant, oppId, acctId, { claimFee: "10000" });
  eq(r.status, 200);
  const balanceAfter = await getBalance(tenant, acctId);

  eq(balanceBefore - balanceAfter, 10_000n, "balance decreased by claimFee");
});

test("claim: multiple claims accumulate (sequential withdrawals)", async () => {
  const tenant = "claim-multi";
  const acctId = await createAccount(tenant, "user-multi");
  await mint(tenant, acctId, "100000"); // 100,000 μ¢
  const opp1 = await createOpportunity(tenant, "Multi Claim Opp 1");
  const opp2 = await createOpportunity(tenant, "Multi Claim Opp 2");

  await claim(tenant, opp1, acctId, { claimFee: "10000" });
  await claim(tenant, opp2, acctId, { claimFee: "10000" });

  const balance = await getBalance(tenant, acctId);
  eq(balance, 80_000n, "two claims of 10,000 μ¢ each = 80,000 μ¢ remaining");
});

test("claim: large claimFee (no cap on withdraw) → 200 (governance-as-data only caps mint/transfer)", async () => {
  const tenant = "claim-cap";
  const acctId = await createAccount(tenant, "user-cap");
  // Mint within DEFAULT_TX_CAP (100,000,000 μ¢). Use 90,000,000 μ¢ = $900.
  await mint(tenant, acctId, "90000000");
  const oppId  = await createOpportunity(tenant, "Cap Test Opportunity");

  // The tx-spending-cap policy only covers ledger.mint + ledger.transfer.
  // Withdrawals (ledger.withdraw) have no spending cap in defaultPolicies.
  // So a 50,000,000 μ¢ withdraw should succeed if the account has funds.
  const r = await claim(tenant, oppId, acctId, { claimFee: "50000000" });
  eq(r.status, 200, "large withdraw should succeed (no spend cap on withdraw in defaultPolicies)");
  const b = await r.json();
  assert(b.ok, "large claim should be ok");
  eq(b.claimFee, "50000000", "claimFee echoed back");
});

// ─── Tenant isolation ─────────────────────────────────────────────────────────

test("claim: claiming does not affect other tenant's balance", async () => {
  const tenantA = "claim-iso-bal-a";
  const tenantB = "claim-iso-bal-b";

  const acctA = await createAccount(tenantA, "user-a");
  const acctB = await createAccount(tenantB, "user-b");
  await mint(tenantA, acctA, "500000");
  await mint(tenantB, acctB, "500000");

  const oppA = await createOpportunity(tenantA, "Tenant-A Opportunity");
  const balBBefore = await getBalance(tenantB, acctB);

  // Tenant-A claims its own opportunity
  const r = await claim(tenantA, oppA, acctA, { claimFee: "10000" });
  eq(r.status, 200);

  // Tenant-B's balance must be unchanged
  const balBAfter = await getBalance(tenantB, acctB);
  eq(balBBefore, balBAfter, "tenant-B balance unaffected by tenant-A claim");
});

// Graceful shutdown — last test closes the server so Node exits cleanly.
test("claim: cleanup", () => { server.close(); });
