import "../_flush.mjs";
/**
 * tests/integration/rollback-failure-reconciliation.test.ts
 *
 * "Manual reconciliation needed" — tests for the path where BOTH the escrow
 * AND the compensating rollback-mint fail.
 *
 * Background (v63/v64 — saga compensation):
 *   Claim route: withdraw(claimFee) → escrow.create() → escrow.fund().
 *   If escrow fails, a compensating ledger.mint(claimFee) rolls back the fee.
 *   Two compensation failure modes:
 *
 *   Mode A — guard deny  (rb.ok === false):
 *     → "refund denied by guard: ...  Manual reconciliation needed. claimFee: N μ¢"
 *     → rollbackAuditId ABSENT in 503 body
 *     → payer balance permanently decreased
 *
 *   Mode B — exception  (rb throws):
 *     → "refund failed: ...  Manual reconciliation needed. claimFee: N μ¢"
 *     → rollbackAuditId ABSENT
 *     → payer balance permanently decreased
 *
 * Simulation strategy (zero external deps):
 *
 *   Mode A — HTTP-only:
 *     claimFee = 150M > DEFAULT_TX_CAP(100M).
 *     Pre-validation requires claimFee+budget ≤ balance → fund payer with 200M.
 *     ledger.withdraw(150M) NOT capped → succeeds.
 *     escrow.create() fails (payer===worker → EscrowError "invalid_input").
 *     Rollback ledger.mint(150M) IS capped → denied → rb.ok===false.
 *     → "refund denied by guard" + "Manual reconciliation needed" + NO rollbackAuditId.
 *
 *   Mode B — patched stack:
 *     Monkey-patch LedgerOrchestrator.mint to throw on memo starting with "rollback:".
 *     Normal setup mints (memo="setup-mint") pass through unchanged.
 *     On claim → escrow.create() fails → rollback-mint throws → "refund failed:" path.
 *
 * Coverage (8 tests):
 *   Mode A: 503, "refund denied by guard", "Manual reconciliation needed",
 *           claimFee in error, rollbackAuditId absent, balance permanently decreased.
 *   Mode B: 503, "refund failed:" + "Manual reconciliation needed",
 *           rollbackAuditId absent, balance permanently decreased.
 */

import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { buildSovereignStack } from "../../src/composition.ts";

// ─── Server A: default stack (Mode A — guard deny) ───────────────────────────

const serverA = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
const portA: number = (serverA.address() as any).port;
const baseA = `http://127.0.0.1:${portA}`;

// ─── Server B: patched stack (Mode B — mint throws) ──────────────────────────

const patchedStack = buildSovereignStack();
// Intercept mint: throw when memo starts with "rollback:".
// All other mints (setup / normal operations) are forwarded unchanged.
const _origMint = patchedStack.ledger.mint.bind(patchedStack.ledger);
(patchedStack.ledger as any).mint = async (
  tenantId: string,
  toAccountId: string,
  amount: bigint,
  memo: string,
  initiatedBy: string,
  isAutonomous?: boolean,
) => {
  if (typeof memo === "string" && memo.startsWith("rollback:")) {
    throw new Error("ledger connection lost during rollback");
  }
  return _origMint(tenantId, toAccountId, amount, memo, initiatedBy, isAutonomous ?? false);
};

const serverB = startSovereignServer(0, patchedStack, { requireIdempotencyKey: false });
const portB: number = (serverB.address() as any).port;
const baseB = `http://127.0.0.1:${portB}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function H(t: string) {
  return { "content-type": "application/json", "x-tenant-id": t };
}

async function createAccount(base: string, tenant: string, owner: string): Promise<string> {
  const r = await fetch(base + "/api/ledger/accounts", {
    method: "POST", headers: H(tenant),
    body: JSON.stringify({ ownerId: owner, type: "asset", name: `${owner} wallet` }),
  });
  return (await r.json()).account?.id as string;
}

async function mintFunds(base: string, tenant: string, toAccountId: string, amount: string): Promise<void> {
  await fetch(base + "/api/ledger/mint", {
    method: "POST", headers: H(tenant),
    body: JSON.stringify({ toAccountId, amount, memo: "setup-mint", initiatedBy: "test" }),
  });
}

async function getBalance(base: string, tenant: string, accountId: string): Promise<bigint> {
  const r = await fetch(base + `/api/ledger/accounts/${accountId}`, { headers: H(tenant) });
  return BigInt((await r.json()).account?.balance ?? "0");
}

async function createOpp(base: string, tenant: string, title: string, budget: string): Promise<string> {
  const r = await fetch(base + "/api/marketplace/opportunities", {
    method: "POST", headers: H(tenant),
    body: JSON.stringify({ title, description: "test", budget }),
  });
  return (await r.json()).opportunity?.id as string;
}

async function doClaim(base: string, tenant: string, oppId: string, body: Record<string, unknown>) {
  return fetch(base + `/api/marketplace/opportunities/${oppId}/claim`, {
    method: "POST", headers: H(tenant),
    body: JSON.stringify(body),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode A — rollback DENIED by spending cap (rb.ok === false)
//
// Setup:
//   payer balance = 200M (2 × 100M mints, each under cap)
//   claimFee = 150M (> cap → rollback mint denied)
//   budget = 1M (budget < claimFee; pre-validation: 150M+1M=151M ≤ 200M → OK)
//   payer === worker → escrow.create() throws EscrowError("invalid_input")
//
// We run ONE claim and share the result across all Mode A assertions.
// ─────────────────────────────────────────────────────────────────────────────

const TENANT_A  = "rc-mode-a";
const CLAIM_FEE = "150000000"; // 150M μ¢ — above DEFAULT_TX_CAP(100M)
const BUDGET_A  = "1000000";   // 1M μ¢ — small budget so pre-val (151M ≤ 200M) passes

// Mode A shared result — populated in first test, reused in subsequent ones.
let modeABody: any;
let modeAStatus: number;
let payerAcctA: string;
let balAfterA: bigint;

test("mode A: rollback denied by guard → 503", async () => {
  // ── Setup ──
  payerAcctA = await createAccount(baseA, TENANT_A, "payer-a");
  await mintFunds(baseA, TENANT_A, payerAcctA, "100000000"); // 100M
  await mintFunds(baseA, TENANT_A, payerAcctA, "100000000"); // 100M → 200M total
  const oppId = await createOpp(baseA, TENANT_A, "Deny-Rollback Opp", BUDGET_A);

  const balBefore = await getBalance(baseA, TENANT_A, payerAcctA);

  // ── Claim (single call — shared across Mode A tests) ──
  const r = await doClaim(baseA, TENANT_A, oppId, {
    fromAccountId: payerAcctA,
    workerAccountId: payerAcctA, // payer === worker → escrow.create() fails
    claimFee: CLAIM_FEE,
  });
  modeAStatus = r.status;
  modeABody   = await r.json();
  balAfterA   = await getBalance(baseA, TENANT_A, payerAcctA);

  eq(modeAStatus, 503, "should return 503 when rollback is denied");
  // sanity: balance should have decreased (withdraw succeeded, rollback denied)
  assert(balAfterA < balBefore, `payer balance should have decreased; before=${balBefore}, after=${balAfterA}`);
});

test("mode A: error body mentions 'refund denied by guard'", () => {
  assert(
    typeof modeABody.error === "string" && modeABody.error.includes("refund denied by guard"),
    `error should mention 'refund denied by guard', got: ${modeABody.error}`,
  );
});

test("mode A: error body mentions 'Manual reconciliation needed'", () => {
  assert(
    typeof modeABody.error === "string" && modeABody.error.includes("Manual reconciliation needed"),
    `error should mention 'Manual reconciliation needed', got: ${modeABody.error}`,
  );
});

test("mode A: error body includes the claimFee amount (μ¢)", () => {
  assert(
    typeof modeABody.error === "string" && modeABody.error.includes("150000000"),
    `error should include claimFee=150000000 μ¢, got: ${modeABody.error}`,
  );
});

test("mode A: rollbackAuditId ABSENT in 503 body (no compensation audit trail)", () => {
  assert(
    modeABody.rollbackAuditId === undefined,
    "rollbackAuditId must be absent when rollback is denied",
  );
});

test("mode A: payer balance permanently decreased by claimFee (rollback failed)", () => {
  // balAfterA captured in first test
  // balance decreased = 150M (claimFee) since withdraw succeeded and rollback was denied
  assert(balAfterA !== undefined, "balance captured");
  const diff = 200_000_000n - balAfterA; // started with 200M
  eq(diff, 150_000_000n, `balance should be permanently short 150M μ¢ (got diff=${diff})`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Mode B — rollback THROWS (patched LedgerOrchestrator.mint)
//
// payer balance = 50M, claimFee = 10K (well under cap).
// escrow.create() fails (payer === worker).
// Rollback: patched mint throws "ledger connection lost during rollback".
// ─────────────────────────────────────────────────────────────────────────────

test("mode B: mint throws during rollback → 503 + 'refund failed' + 'Manual reconciliation' + no rollbackAuditId + balance decreased", async () => {
  const tenant    = "rc-mode-b";
  const claimFee  = "10000"; // 10K μ¢ — under cap; only memo-patched path fails
  const payerAcct = await createAccount(baseB, tenant, "payer-b");
  // memo="setup-mint" → NOT intercepted by patch → succeeds
  await mintFunds(baseB, tenant, payerAcct, "50000000"); // 50M

  const oppId   = await createOpp(baseB, tenant, "Throw-Rollback Opp", "1000000");
  const balBefore = await getBalance(baseB, tenant, payerAcct);

  const r = await doClaim(baseB, tenant, oppId, {
    fromAccountId: payerAcct,
    workerAccountId: payerAcct, // payer === worker → escrow.create() fails → rollback triggered
    claimFee,
  });
  eq(r.status, 503, "should return 503 when rollback throws");

  const b = await r.json();

  // "refund failed:" path (throw, not deny)
  assert(
    typeof b.error === "string" && b.error.includes("refund failed:"),
    `error should mention 'refund failed:', got: ${b.error}`,
  );
  assert(
    b.error.includes("Manual reconciliation needed"),
    `error should mention 'Manual reconciliation needed', got: ${b.error}`,
  );
  assert(
    b.rollbackAuditId === undefined,
    "rollbackAuditId must be absent when rollback throws",
  );

  // Balance permanently decreased by claimFee (rollback threw → not restored)
  const balAfter = await getBalance(baseB, tenant, payerAcct);
  const diff = balBefore - balAfter;
  eq(diff, BigInt(claimFee), `balance should be permanently short ${claimFee} μ¢, diff=${diff}`);
});

// ─── Cleanup ──────────────────────────────────────────────────────────────────

test("rollback-failure-reconciliation: cleanup", () => {
  serverA.close();
  serverB.close();
});
