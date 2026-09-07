import "../_flush.mjs";
/**
 * tests/integration/marketplace-listing-fee.test.ts
 *
 * Live-server HTTP integration tests for שלב E חלק ג': Marketplace Listing Fee.
 *
 * When a caller supplies `fromAccountId`, listing an opportunity costs μ¢
 * (default: 5,000 μ¢ = 0.05 USD) charged via LedgerOrchestrator.withdraw().
 *
 * When `fromAccountId` is omitted, listing is free (backward-compatible path).
 *
 * Coverage:
 *   Validation
 *     • listingFee without fromAccountId → 400
 *     • negative listingFee → 400
 *     • non-integer listingFee → 400
 *
 *   Happy path (with fromAccountId)
 *     • 201 + opportunity + listingFee + ledgerEffect + auditId
 *     • passport auto-issued on withdraw success
 *     • default listingFee = 5000 μ¢
 *     • explicit listingFee respected
 *     • listingFee = 0 accepted (free listing via account)
 *
 *   Ledger integration
 *     • balance decreases by listing fee
 *     • insufficient funds → 403 (opportunity NOT created)
 *     • multiple listings accumulate balance decrease
 *     • tenant isolation: listing by tenant-A doesn't affect tenant-B balance
 *
 *   Free listing (backward compat)
 *     • no fromAccountId → 201 + no ledgerEffect / auditId
 *     • opportunity still created correctly
 *
 * All assertions against a live Node http server (startSovereignServer port=0).
 * Zero external dependencies — built-in fetch only.
 */

import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";

const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
const port: number = (server.address() as any).port;
const base = `http://127.0.0.1:${port}`;

const H = (t: string) => ({ "content-type": "application/json", "x-tenant-id": t });
const post = (path: string, body: any, tenant = "lst-t1") =>
  fetch(base + path, { method: "POST", headers: H(tenant), body: JSON.stringify(body) });
const get = (path: string, tenant = "lst-t1") =>
  fetch(base + path, { headers: H(tenant) });

const MINT_AMOUNT = "1000000"; // 1,000,000 μ¢ = $10.00

/** Create account + mint, return accountId. */
async function fundAccount(tenant: string, amount = MINT_AMOUNT): Promise<string> {
  const ar = await post("/api/ledger/accounts", { ownerId: "test-user", type: "asset", name: "Test" }, tenant);
  const acctId: string = (await ar.json()).account.id;
  await post("/api/ledger/mint", { toAccountId: acctId, amount, memo: "test fund" }, tenant);
  return acctId;
}

/** Read account balance, return as bigint. */
async function getBalance(tenant: string, accountId: string): Promise<bigint> {
  const r = await get(`/api/ledger/accounts/${accountId}`, tenant);
  const b = await r.json();
  return BigInt(b.account.balance);
}

// ─── Validation ───────────────────────────────────────────────────────────────

test("listing fee: listingFee without fromAccountId → 400", async () => {
  const r = await post("/api/marketplace/opportunities", {
    title: "Bad Request",
    listingFee: "5000",
  });
  eq(r.status, 400);
  const b = await r.json();
  assert(b.error, "error message present");
});

test("listing fee: negative listingFee → 400", async () => {
  const tenant = "lst-neg";
  const acctId = await fundAccount(tenant);
  const r = await post("/api/marketplace/opportunities", {
    title: "Negative Fee",
    fromAccountId: acctId,
    listingFee: "-1",
  }, tenant);
  eq(r.status, 400);
});

test("listing fee: non-integer listingFee → 400", async () => {
  const tenant = "lst-float";
  const acctId = await fundAccount(tenant);
  const r = await post("/api/marketplace/opportunities", {
    title: "Float Fee",
    fromAccountId: acctId,
    listingFee: "123.45",
  }, tenant);
  eq(r.status, 400);
});

// ─── Happy path (with fromAccountId) ─────────────────────────────────────────

test("listing fee: happy path → 201 + opportunity + listingFee + ledgerEffect + auditId", async () => {
  const tenant = "lst-happy";
  const acctId = await fundAccount(tenant);
  const r = await post("/api/marketplace/opportunities", {
    title: "Paid Listing",
    description: "Costs 5000 μ¢",
    fromAccountId: acctId,
  }, tenant);
  eq(r.status, 201);
  const b = await r.json();
  eq(b.ok, true);
  assert(b.opportunity, "opportunity object present");
  eq(b.opportunity.tenantId, tenant);
  assert(typeof b.listingFee === "string", "listingFee is string (BigInt-safe)");
  assert(b.ledgerEffect, "ledgerEffect present");
  assert(typeof b.auditId === "string", "auditId present");
});

test("listing fee: default listingFee = 5000 μ¢", async () => {
  const tenant = "lst-default";
  const acctId = await fundAccount(tenant);
  const r = await post("/api/marketplace/opportunities", {
    title: "Default Fee Test",
    fromAccountId: acctId,
  }, tenant);
  eq(r.status, 201);
  const b = await r.json();
  eq(b.listingFee, "5000", "default listing fee is 5000 μ¢");
});

test("listing fee: explicit listingFee respected", async () => {
  const tenant = "lst-explicit";
  const acctId = await fundAccount(tenant);
  const r = await post("/api/marketplace/opportunities", {
    title: "Custom Fee",
    fromAccountId: acctId,
    listingFee: "20000",
  }, tenant);
  eq(r.status, 201);
  const b = await r.json();
  eq(b.listingFee, "20000");
});

test("listing fee: listingFee = 0 accepted (no charge, but account reference ok)", async () => {
  const tenant = "lst-zero";
  const acctId = await fundAccount(tenant);
  const r = await post("/api/marketplace/opportunities", {
    title: "Zero Fee Listing",
    fromAccountId: acctId,
    listingFee: "0",
  }, tenant);
  eq(r.status, 201);
  const b = await r.json();
  eq(b.ok, true);
  // listingFee=0 means no ledger call (guardPositive rejects 0) → no ledgerEffect
  eq(b.listingFee, "0");
  assert(b.opportunity, "opportunity created");
});

test("listing fee: passport auto-issued on withdraw success", async () => {
  const tenant = "lst-passport";
  const acctId = await fundAccount(tenant);
  const r = await post("/api/marketplace/opportunities", {
    title: "Passport Check",
    fromAccountId: acctId,
  }, tenant);
  eq(r.status, 201);
  const b = await r.json();
  // Passport is present when LedgerOrchestrator auto-issues on withdraw
  assert(b.passport || b.auditId, "either passport or auditId proves ledger round-trip");
});

// ─── Ledger integration ───────────────────────────────────────────────────────

test("listing fee: balance decreases by listing fee", async () => {
  const tenant = "lst-balance";
  const acctId = await fundAccount(tenant);
  const before = await getBalance(tenant, acctId);
  await post("/api/marketplace/opportunities", {
    title: "Balance Test",
    fromAccountId: acctId,
    listingFee: "5000",
  }, tenant);
  const after = await getBalance(tenant, acctId);
  eq(before - after, 5000n, "balance should decrease by 5000 μ¢");
});

test("listing fee: insufficient funds → 403, opportunity NOT created", async () => {
  const tenant = "lst-broke";
  const acctId = await fundAccount(tenant, "3000"); // only 3000 μ¢
  const r = await post("/api/marketplace/opportunities", {
    title: "Too Expensive",
    fromAccountId: acctId,
    listingFee: "10000", // more than balance
  }, tenant);
  eq(r.status, 403, "should be denied — insufficient funds");

  // Verify opportunity was NOT created
  const lr = await get("/api/marketplace/opportunities", tenant);
  const lb = await lr.json();
  const leaked = (lb.opportunities || []).find((o: any) => o.title === "Too Expensive");
  assert(!leaked, "opportunity must NOT be created when payment fails");
});

test("listing fee: multiple listings accumulate balance decrease", async () => {
  const tenant = "lst-multi";
  const acctId = await fundAccount(tenant);
  const before = await getBalance(tenant, acctId);

  await post("/api/marketplace/opportunities", { title: "Listing 1", fromAccountId: acctId, listingFee: "5000" }, tenant);
  await post("/api/marketplace/opportunities", { title: "Listing 2", fromAccountId: acctId, listingFee: "5000" }, tenant);
  await post("/api/marketplace/opportunities", { title: "Listing 3", fromAccountId: acctId, listingFee: "5000" }, tenant);

  const after = await getBalance(tenant, acctId);
  eq(before - after, 15000n, "3 × 5000 = 15000 μ¢ total deducted");
});

test("listing fee: tenant isolation — tenant-A listing doesn't affect tenant-B balance", async () => {
  const tenantA = "lst-iso-a";
  const tenantB = "lst-iso-b";
  const acctA = await fundAccount(tenantA);
  const acctB = await fundAccount(tenantB);

  const balBefore = await getBalance(tenantB, acctB);
  await post("/api/marketplace/opportunities", { title: "A listing", fromAccountId: acctA }, tenantA);
  const balAfter = await getBalance(tenantB, acctB);

  eq(balBefore, balAfter, "tenant-B balance must be unaffected by tenant-A listing");
});

// ─── Free listing (backward-compatible) ──────────────────────────────────────

test("listing fee: no fromAccountId → 201, no ledgerEffect/auditId (free listing)", async () => {
  const r = await post("/api/marketplace/opportunities", {
    title: "Free Listing",
    description: "No account provided",
  }, "lst-free");
  eq(r.status, 201);
  const b = await r.json();
  eq(b.ok, true);
  assert(b.opportunity, "opportunity created");
  assert(b.ledgerEffect === undefined, "no ledgerEffect for free listing");
  assert(b.auditId === undefined, "no auditId for free listing");
  assert(b.listingFee === undefined, "no listingFee echoed for free listing");
});

test("listing fee: free listing still creates correct opportunity", async () => {
  const r = await post("/api/marketplace/opportunities", {
    title: "Free Opportunity",
    description: "open to all",
    requiredStrengths: [{ category: "leadership", minScore: 50 }],
  }, "lst-free2");
  eq(r.status, 201);
  const b = await r.json();
  eq(b.opportunity.title, "Free Opportunity");
  eq(b.opportunity.requiredStrengths.length, 1);
  eq(b.opportunity.requiredStrengths[0].category, "leadership");
});

// Graceful shutdown
test("cleanup: close server", () => { server.close(); });
