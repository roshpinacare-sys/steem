import "../_flush.mjs";
/**
 * tests/integration/escrow-fund-failure-rollback.test.ts
 *
 * claim → escrow atomic v4: escrow.fund() failure rollback tests.
 *
 * Context (v63/v64):
 *   The claim route executes: withdraw(claimFee) → escrow.create() → escrow.fund().
 *   If ANY step after withdraw fails, the saga compensation kicks in:
 *     ledger.mint(payer, claimFee) to restore the deducted fee.
 *
 * The existing claim-auto-escrow.test.ts covers create() failure (payer === worker
 * triggers invalid_input at create() time, before fund() is called).
 *
 * This file covers fund() failure: escrow.create() SUCCEEDS, but escrow.fund()
 * is denied by the guard (spending cap). The spending-cap policy denies any
 * ledger.transfer > 100,000,000 μ¢ by default. We exploit this to force fund()
 * to fail while create() succeeds — no mocking needed, purely via HTTP.
 *
 * Scenarios tested:
 *   1. fund() fails (budget > 100M μ¢ spending cap) → 503
 *   2. balance unchanged after rollback (payer ends with what they started)
 *   3. rollbackAuditId present in 503 response body (compensation audit trail, v64)
 *   4. rollbackAuditId cross-references the audit chain
 *   5. create() failure (payer === worker) → 503 + rollbackAuditId (task 3, same code path)
 *   6. 503 body has error string mentioning "escrow failed"
 *   7. claim without escrow path unaffected (budget under cap → happy path)
 *   8. balance check: fund failure + refund → net zero change
 *
 * All tests against a live Node http server (startSovereignServer port=0).
 * Zero external dependencies — built-in fetch + governance-as-data (spending cap).
 */

import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";

const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
const port: number = (server.address() as any).port;
const base = `http://127.0.0.1:${port}`;
const H = (t: string) => ({ "content-type": "application/json", "x-tenant-id": t });

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createAccount(tenant: string, owner: string): Promise<string> {
  const r = await fetch(base + "/api/ledger/accounts", {
    method: "POST", headers: H(tenant),
    body: JSON.stringify({ ownerId: owner, type: "asset", name: `${owner} wallet` }),
  });
  return (await r.json()).account?.id as string;
}

/** Mint μ¢. Cap per call is 100,000,000 μ¢. */
async function mint(tenant: string, toAccountId: string, amount: string): Promise<void> {
  await fetch(base + "/api/ledger/mint", {
    method: "POST", headers: H(tenant),
    body: JSON.stringify({ toAccountId, amount, memo: "test-mint", initiatedBy: "test" }),
  });
}

async function getBalance(tenant: string, accountId: string): Promise<bigint> {
  const r = await fetch(base + `/api/ledger/accounts/${accountId}`, { headers: H(tenant) });
  return BigInt((await r.json()).account?.balance ?? "0");
}

async function createOpp(tenant: string, title: string, budget: string): Promise<string> {
  const r = await fetch(base + "/api/marketplace/opportunities", {
    method: "POST", headers: H(tenant),
    body: JSON.stringify({ title, description: "test", budget }),
  });
  return (await r.json()).opportunity?.id as string;
}

async function claim(tenant: string, oppId: string, fromAccountId: string, extra: any = {}) {
  return fetch(base + `/api/marketplace/opportunities/${oppId}/claim`, {
    method: "POST", headers: H(tenant),
    body: JSON.stringify({ fromAccountId, ...extra }),
  });
}

// ─── escrow.fund() failure: spending cap triggers denial ─────────────────────
//
// Strategy: create opportunity with budget = 150,000,000 μ¢ (> 100M spending cap).
// Pre-validation passes (payer has enough balance).
// withdraw(claimFee) succeeds.
// escrow.create() succeeds (no money moves).
// escrow.fund() → ledger.transfer(payer, escrow, 150,000,000) → DENIED by cap.
// Rollback: ledger.mint(payer, claimFee) restores the fee.
// ──────────────────────────────────────────────────────────────────────────────

/** Set up a payer with 200,000,000 μ¢ (2 × 99M mints, each under the 100M cap). */
async function fundedPayer(tenant: string, owner: string): Promise<string> {
  const acctId = await createAccount(tenant, owner);
  // Two mints of 99,000,000 μ¢ = 198,000,000 μ¢ total (each under 100M cap)
  await mint(tenant, acctId, "99000000");
  await mint(tenant, acctId, "99000000");
  return acctId;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("fund() failure: budget > spending cap → 503", async () => {
  const tenant = "ff-503";
  const payerAcct  = await fundedPayer(tenant, "user-payer");
  const workerAcct = await createAccount(tenant, "user-worker");
  // budget = 150,000,000 μ¢ > 100M cap → fund() will be denied
  const oppId = await createOpp(tenant, "Over-Cap Opportunity", "150000000");

  const r = await claim(tenant, oppId, payerAcct, {
    workerAccountId: workerAcct,
    claimFee: "10000",
    userId: "user-payer",
  });
  eq(r.status, 503, "fund() failure must return 503");
  const b = await r.json();
  assert(b.error, "error field present in 503 body");
  assert(b.error.includes("escrow failed"), "error mentions 'escrow failed'");
});

test("fund() failure: balance unchanged after rollback (payer net-zero)", async () => {
  const tenant = "ff-balance";
  const payerAcct  = await fundedPayer(tenant, "user-payer-bal");
  const workerAcct = await createAccount(tenant, "user-worker-bal");
  const oppId = await createOpp(tenant, "Balance Test Opportunity", "150000000");

  const balBefore = await getBalance(tenant, payerAcct);
  const r = await claim(tenant, oppId, payerAcct, {
    workerAccountId: workerAcct,
    claimFee: "10000",
  });
  eq(r.status, 503);
  const balAfter = await getBalance(tenant, payerAcct);
  // Rollback restored the claim fee → net change = 0
  eq(balBefore, balAfter, "balance unchanged after claim-fee rollback");
});

test("fund() failure: rollbackAuditId present in 503 response body (v64)", async () => {
  const tenant = "ff-auditid";
  const payerAcct  = await fundedPayer(tenant, "user-payer-audit");
  const workerAcct = await createAccount(tenant, "user-worker-audit");
  const oppId = await createOpp(tenant, "Audit Trail Opportunity", "150000000");

  const r = await claim(tenant, oppId, payerAcct, {
    workerAccountId: workerAcct,
    claimFee: "10000",
  });
  eq(r.status, 503);
  const b = await r.json();
  assert(typeof b.rollbackAuditId === "string" && b.rollbackAuditId.length > 0,
    "rollbackAuditId present in 503 body");
});

test("fund() failure: rollbackAuditId cross-references audit chain", async () => {
  const tenant = "ff-chain";
  const payerAcct  = await fundedPayer(tenant, "user-payer-chain");
  const workerAcct = await createAccount(tenant, "user-worker-chain");
  const oppId = await createOpp(tenant, "Chain Opportunity", "150000000");

  const r = await claim(tenant, oppId, payerAcct, {
    workerAccountId: workerAcct,
    claimFee: "10000",
  });
  eq(r.status, 503);
  const b = await r.json();
  assert(b.rollbackAuditId, "rollbackAuditId present");

  // Verify the auditId appears in the tenant's transparency chain
  const chainR = await fetch(base + "/api/transparency/chain", { headers: H(tenant) });
  const chainBody = await chainR.json();
  const chain: any[] = chainBody.records ?? [];
  const found = chain.some((rec: any) => rec.id === b.rollbackAuditId);
  assert(found, "rollbackAuditId found in audit chain");
});

test("fund() failure: error string mentions 'escrow failed' and 'refunded'", async () => {
  const tenant = "ff-msg";
  const payerAcct  = await fundedPayer(tenant, "user-payer-msg");
  const workerAcct = await createAccount(tenant, "user-worker-msg");
  const oppId = await createOpp(tenant, "Message Check Opportunity", "150000000");

  const r = await claim(tenant, oppId, payerAcct, {
    workerAccountId: workerAcct,
    claimFee: "10000",
  });
  eq(r.status, 503);
  const b = await r.json();
  assert(b.error.includes("escrow failed"), "error includes 'escrow failed'");
  assert(b.error.includes("refunded"), "error includes 'refunded' (rollback succeeded)");
});

// ─── create() failure path also has rollbackAuditId (same code path, v64) ───

test("create() failure (payer === worker) → 503 + rollbackAuditId present", async () => {
  const tenant = "cf-auditid";
  // Use a single account as both payer and worker → escrow.create() throws invalid_input
  const acctId = await createAccount(tenant, "user-same");
  await mint(tenant, acctId, "50000000"); // enough funds
  const oppId = await createOpp(tenant, "Same-Account Opportunity", "1000000");

  const r = await claim(tenant, oppId, acctId, {
    workerAccountId: acctId, // payer === worker → create() failure
    claimFee: "10000",
  });
  eq(r.status, 503, "payer===worker should return 503");
  const b = await r.json();
  // rollbackAuditId should be present since rollback (mint) succeeds
  assert(typeof b.rollbackAuditId === "string" && b.rollbackAuditId.length > 0,
    "rollbackAuditId present even on create() failure path");
});

// ─── Happy path unaffected (budget under cap) ─────────────────────────────────

test("budget under spending cap → happy path 200 (unaffected by fix)", async () => {
  const tenant = "ff-happy";
  const payerAcct  = await createAccount(tenant, "user-payer-happy");
  const workerAcct = await createAccount(tenant, "user-worker-happy");
  await mint(tenant, payerAcct, "5000000"); // 5M μ¢ — plenty

  // Budget = 1,000,000 μ¢ = well under 100M cap
  const oppId = await createOpp(tenant, "Happy Opportunity", "1000000");

  const r = await claim(tenant, oppId, payerAcct, {
    workerAccountId: workerAcct,
    claimFee: "10000",
  });
  eq(r.status, 200, "budget under cap should succeed");
  const b = await r.json();
  assert(b.ok, "ok:true");
  assert(b.escrow, "escrow present");
  eq(b.escrow.state, "funded", "escrow funded on happy path");
});

test("fund() failure: second claim on same opp succeeds (opp reusable after failed claim)", async () => {
  const tenant = "ff-retry";
  const payerAcct  = await fundedPayer(tenant, "user-payer-retry");
  const workerAcct = await createAccount(tenant, "user-worker-retry");

  // Opportunity with budget above cap → first claim will fail at fund()
  const oppId = await createOpp(tenant, "Retry Opportunity", "150000000");

  // First claim: fund() fails → 503
  const r1 = await claim(tenant, oppId, payerAcct, {
    workerAccountId: workerAcct, claimFee: "10000",
  });
  eq(r1.status, 503, "first claim: fund() failure → 503");

  // Second claim on same opportunity with no workerAccountId → fee only, should succeed
  const r2 = await claim(tenant, oppId, payerAcct, { claimFee: "10000" });
  eq(r2.status, 200, "second claim (fee only) should succeed on same opportunity");
  const b2 = await r2.json();
  assert(b2.ok, "ok:true on retry");
  assert(!b2.escrow, "no escrow on fee-only claim");
});

// ─── Cleanup ──────────────────────────────────────────────────────────────────

test("escrow-fund-failure-rollback: cleanup", () => { server.close(); });
