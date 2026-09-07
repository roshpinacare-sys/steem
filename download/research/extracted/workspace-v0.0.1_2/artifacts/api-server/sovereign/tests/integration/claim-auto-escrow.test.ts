import "../_flush.mjs";
/**
 * tests/integration/claim-auto-escrow.test.ts
 *
 * Live-server HTTP integration tests for:
 *
 *   POST /api/marketplace/opportunities  — budget field (new)
 *   POST /api/marketplace/opportunities/:id/claim — auto-escrow when budget present
 *
 * Coverage:
 *
 *  Budget field on opportunity creation:
 *   • POST with budget → opportunity.budget echoed as decimal string (BigInt-safe)
 *   • POST without budget → opportunity has no budget field
 *   • negative budget → 400
 *   • float budget → 400
 *   • GET list includes budget as decimal string
 *
 *  Claim with auto-escrow (opportunity has budget + body has workerAccountId):
 *   • Happy path: 200 + claimFee + ledgerEffect + escrow (state=funded, amount=budget string)
 *   • escrow.payerAccountId = fromAccountId
 *   • escrow.workerAccountId matches request
 *   • escrow.opportunityId = opportunityId
 *   • escrow.amount = opportunity.budget (as decimal string)
 *   • escrow is retrievable via GET /api/escrow/:id
 *   • worker can release escrow → state=released, worker receives funds
 *
 *  Claim without auto-escrow (no workerAccountId or no budget):
 *   • no workerAccountId → 200 without escrow field (fee only)
 *   • opportunity without budget + workerAccountId → 200 without escrow field (fee only)
 *
 *  Fail-closed:
 *   • insufficient funds for claimFee → 403 (no escrow created)
 *   • payer == worker → 503 + claim fee atomically refunded (saga compensation, v63)
 *   • balance unchanged after atomic rollback
 *   • old escrowError behaviour removed — replaced by 503
 *
 *  Tenant isolation:
 *   • escrow created by tenant-A not visible from tenant-B
 *
 * All tests against a live Node http server (startSovereignServer port=0).
 * Zero external dependencies.
 */

import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";

const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
const port: number = (server.address() as any).port;
const base = `http://127.0.0.1:${port}`;
const H = (t: string) => ({ "content-type": "application/json", "x-tenant-id": t });
const post = (p: string, body: any, t = "ae-t1") =>
  fetch(base + p, { method: "POST", headers: H(t), body: JSON.stringify(body) });
const get = (p: string, t = "ae-t1") =>
  fetch(base + p, { headers: H(t) });
const del = (p: string, t = "ae-t1") =>
  fetch(base + p, { method: "DELETE", headers: H(t) });

// ─── Shared setup: accounts with funds ───────────────────────────────────────

let payerAccountId: string;   // funds the claim fee + escrow
let workerAccountId: string;  // receives the escrow release
let oppIdWithBudget: string;
let oppIdNoBudget: string;
const BUDGET = "500000";       // 5.00 USD in μ¢
const MINT_AMOUNT = "2000000"; // 20.00 USD — enough for fee + escrow

test("SETUP: create payer + worker accounts with funds", async () => {
  const payer = await (await post("/api/ledger/accounts", { ownerId: "ae-payer", type: "asset", name: "Payer" })).json();
  assert(payer.account?.id, "payer account created");
  payerAccountId = payer.account.id;

  const worker = await (await post("/api/ledger/accounts", { ownerId: "ae-worker", type: "asset", name: "Worker" })).json();
  assert(worker.account?.id, "worker account created");
  workerAccountId = worker.account.id;

  const mintR = await post("/api/ledger/mint", { toAccountId: payerAccountId, amount: MINT_AMOUNT, memo: "seed" });
  eq(mintR.status, 200, "payer funded");
});

// ─── Budget field on opportunity creation ─────────────────────────────────────

test("CREATE OPP with budget → budget echoed as decimal string", async () => {
  const r = await post("/api/marketplace/opportunities", {
    title: "Build a widget",
    description: "Build it well",
    budget: BUDGET,
  });
  eq(r.status, 201);
  const body = await r.json();
  assert(body.ok, "ok:true");
  assert(body.opportunity, "opportunity in response");
  eq(body.opportunity.budget, BUDGET, "budget echoed as decimal string");
  oppIdWithBudget = body.opportunity.id;
  assert(oppIdWithBudget, "opportunity id present");
});

test("CREATE OPP without budget → no budget field", async () => {
  const r = await post("/api/marketplace/opportunities", {
    title: "Free opportunity",
    description: "No budget attached",
  });
  eq(r.status, 201);
  const body = await r.json();
  eq(body.opportunity.budget, undefined, "no budget field when not supplied");
  oppIdNoBudget = body.opportunity.id;
});

test("CREATE OPP negative budget → 400", async () => {
  const r = await post("/api/marketplace/opportunities", {
    title: "Negative budget test",
    description: "should fail",
    budget: "-1000",
  });
  eq(r.status, 400);
});

test("CREATE OPP float budget → 400", async () => {
  const r = await post("/api/marketplace/opportunities", {
    title: "Float budget test",
    description: "should fail",
    budget: "999.99",
  });
  eq(r.status, 400);
});

test("LIST opps includes budget as decimal string", async () => {
  const r = await get("/api/marketplace/opportunities");
  eq(r.status, 200);
  const body = await r.json();
  assert(Array.isArray(body.opportunities), "opportunities array");
  const withBudget = body.opportunities.find((o: any) => o.id === oppIdWithBudget);
  assert(withBudget, "budgeted opp appears in list");
  eq(withBudget.budget, BUDGET, "budget in list is decimal string");
  const noBudget = body.opportunities.find((o: any) => o.id === oppIdNoBudget);
  assert(noBudget, "no-budget opp in list");
  eq(noBudget.budget, undefined, "no budget field on no-budget opp");
});

// ─── Claim without auto-escrow (baseline) ────────────────────────────────────

test("CLAIM no-budget opp with workerAccountId → 200, no escrow", async () => {
  const r = await post(`/api/marketplace/opportunities/${oppIdNoBudget}/claim`, {
    fromAccountId: payerAccountId,
    workerAccountId,
  });
  eq(r.status, 200);
  const body = await r.json();
  eq(body.ok, true);
  assert(body.claimFee, "claimFee present");
  eq(body.escrow, undefined, "no escrow when opportunity has no budget");
});

test("CLAIM budget opp without workerAccountId → 200, no escrow", async () => {
  const r = await post(`/api/marketplace/opportunities/${oppIdWithBudget}/claim`, {
    fromAccountId: payerAccountId,
    // no workerAccountId
  });
  eq(r.status, 200);
  const body = await r.json();
  eq(body.ok, true);
  eq(body.escrow, undefined, "no escrow without workerAccountId");
});

// ─── Happy path: claim + auto-escrow ─────────────────────────────────────────

let escrowId: string;

test("CLAIM budget opp + workerAccountId → 200 + escrow (funded)", async () => {
  // Create a fresh budgeted opportunity for the escrow happy path
  const opp = await (await post("/api/marketplace/opportunities", {
    title: "Escrow opp",
    description: "Pays on completion",
    budget: BUDGET,
  })).json();
  const oppId = opp.opportunity.id;

  // Mint more so payer can cover both the claim fee AND the budget transfer
  await post("/api/ledger/mint", { toAccountId: payerAccountId, amount: MINT_AMOUNT, memo: "extra" });

  const r = await post(`/api/marketplace/opportunities/${oppId}/claim`, {
    fromAccountId: payerAccountId,
    workerAccountId,
    initiatedBy: "ae-payer",
  });
  eq(r.status, 200);
  const body = await r.json();
  eq(body.ok, true);
  assert(body.claimFee, "claimFee present");
  assert(body.ledgerEffect, "ledgerEffect present (claim fee)");
  assert(body.auditId, "auditId present");

  // Escrow shape
  assert(body.escrow, "escrow present in response");
  const esc = body.escrow;
  eq(esc.state, "funded", "escrow state is funded");
  eq(esc.amount, BUDGET, "escrow amount = opportunity budget (decimal string)");
  eq(esc.payerAccountId, payerAccountId, "payer = fromAccountId");
  eq(esc.workerAccountId, workerAccountId, "worker matches request");
  eq(esc.opportunityId, oppId, "opportunityId matches");
  assert(esc.id, "escrow id present");
  assert(esc.fundAuditId, "fundAuditId recorded (provable trail)");

  escrowId = esc.id;
});

test("ESCROW: funded agreement retrievable via GET /api/escrow/:id", async () => {
  assert(escrowId, "escrowId set from previous test");
  const r = await get(`/api/escrow/${escrowId}`);
  eq(r.status, 200);
  const body = await r.json();
  assert(body.agreement || body.escrow, "agreement in response");
  const esc = body.agreement ?? body.escrow;
  eq(esc.state, "funded");
  eq(esc.amount, BUDGET);
});

test("ESCROW: worker can release → state=released, funds reach worker", async () => {
  assert(escrowId, "escrowId set from previous test");

  // Balance worker before release
  const balBefore = await (await get("/api/transparency/balances")).json();
  const workerBefore = balBefore.accounts.find((a: any) => a.id === workerAccountId);
  const workerBalBefore = BigInt(workerBefore?.balance ?? "0");

  const r = await post(`/api/escrow/${escrowId}/release`, { initiatedBy: "ae-payer" });
  eq(r.status, 200);
  const body = await r.json();
  const esc = body.agreement ?? body.escrow ?? body.data;
  assert(esc?.state === "released" || body.ok, "escrow released");

  // Worker balance increased by BUDGET
  const balAfter = await (await get("/api/transparency/balances")).json();
  const workerAfter = balAfter.accounts.find((a: any) => a.id === workerAccountId);
  const workerBalAfter = BigInt(workerAfter?.balance ?? "0");
  eq(workerBalAfter - workerBalBefore, BigInt(BUDGET), "worker received budget on release");
});

// ─── Fail-closed ──────────────────────────────────────────────────────────────

test("CLAIM: insufficient funds → 403, no escrow created", async () => {
  // Create a broke account
  const broke = await (await post("/api/ledger/accounts", { ownerId: "ae-broke", type: "asset", name: "Broke" })).json();
  const brokeId = broke.account.id;

  // Don't mint anything — balance = 0, claim fee > 0

  const opp = await (await post("/api/marketplace/opportunities", {
    title: "Expensive opp",
    description: "Requires funds",
    budget: BUDGET,
  })).json();

  const r = await post(`/api/marketplace/opportunities/${opp.opportunity.id}/claim`, {
    fromAccountId: brokeId,
    workerAccountId,
  });
  eq(r.status, 403, "insufficient funds → 403 fail-closed");
  const body = await r.json();
  assert(!body.escrow, "no escrow on failed claim");
});

test("CLAIM: payer == worker → escrow fails, claim fee atomically refunded → 503 + balance unchanged", async () => {
  // v63: atomic rollback. EscrowService.create() throws (payer===worker).
  // The claim fee must be refunded; payer balance must be unchanged.
  const tenant = "ae-atomic-rollback";
  const acctId = `atomic-payer-${Date.now()}`;

  // Create account first, then seed
  const acctResp = await (await post("/api/ledger/accounts",
    { ownerId: acctId, type: "asset", name: "Atomic Payer" }, tenant)).json();
  const realAcctId = acctResp.account?.id ?? acctId;
  await post("/api/ledger/mint", { toAccountId: realAcctId, amount: "50000", memo: "seed" }, tenant);
  const opp = await (await post("/api/marketplace/opportunities", {
    title: "Atomic test opp",
    description: "Rollback test",
    budget: "10000",
  }, tenant)).json();

  // Record balance before
  const balBefore = await (await fetch(base + `/api/ledger/accounts/${realAcctId}`,
    { headers: H(tenant) })).json();
  const before = BigInt(balBefore.account.balance);

  // Attempt claim with payer === worker → escrow.create() will throw
  const r = await post(`/api/marketplace/opportunities/${opp.opportunity.id}/claim`, {
    fromAccountId: realAcctId,
    workerAccountId: realAcctId, // same → EscrowService throws invalid_input
    claimFee: "5000",
  }, tenant);

  // Must be 503 — claim failed atomically
  eq(r.status, 503);
  const body = await r.json();
  assert(body.error, "error message present");
  assert(body.error.includes("escrow failed"), `error mentions escrow: ${body.error}`);
  assert(body.error.includes("claim fee refunded") || body.error.includes("refunded"),
    `error mentions refund: ${body.error}`);

  // Balance must be unchanged — rollback succeeded
  const balAfter = await (await fetch(base + `/api/ledger/accounts/${realAcctId}`,
    { headers: H(tenant) })).json();
  const after = BigInt(balAfter.account.balance);
  eq(after, before, `balance must be unchanged: before=${before}, after=${after}`);
});

test("CLAIM: escrow create fails → legacy test updated: status is now 503 not 200", async () => {
  // Confirm old behaviour (200 + escrowError) is replaced by 503 + atomic rollback.
  const opp = await (await post("/api/marketplace/opportunities", {
    title: "Same person opp (legacy check)",
    description: "Edge case",
    budget: "1000",
  })).json();

  await post("/api/ledger/mint", { toAccountId: payerAccountId, amount: "100000", memo: "fee-seed-legacy" });

  const r = await post(`/api/marketplace/opportunities/${opp.opportunity.id}/claim`, {
    fromAccountId: payerAccountId,
    workerAccountId: payerAccountId, // same account → throws in escrow.create
  });
  eq(r.status, 503, "v63: escrow failure returns 503 (atomic rollback)");
  const body = await r.json();
  assert(body.error, "error field present");
  assert(!body.escrowError, "no old-style escrowError field (it is now a 503)");
});

// ─── Tenant isolation ─────────────────────────────────────────────────────────

test("TENANT ISOLATION: escrow from tenant-A not visible from tenant-B", async () => {
  // Create opportunity + accounts in tenant iso-A
  const oppA = await (await post("/api/marketplace/opportunities", {
    title: "Iso opp",
    description: "Tenant isolation test",
    budget: "10000",
  }, "ae-iso-A")).json();

  const payerA = await (await post("/api/ledger/accounts", { ownerId: "iso-payer", type: "asset", name: "PayerA" }, "ae-iso-A")).json();
  const workerA = await (await post("/api/ledger/accounts", { ownerId: "iso-worker", type: "asset", name: "WorkerA" }, "ae-iso-A")).json();
  await post("/api/ledger/mint", { toAccountId: payerA.account.id, amount: "1000000", memo: "seed" }, "ae-iso-A");

  const claimR = await post(
    `/api/marketplace/opportunities/${oppA.opportunity.id}/claim`,
    { fromAccountId: payerA.account.id, workerAccountId: workerA.account.id },
    "ae-iso-A",
  );
  eq(claimR.status, 200);
  const claimBody = await claimR.json();
  const isoEscrowId = claimBody.escrow?.id;
  assert(isoEscrowId, "escrow created in iso-A");

  // Tenant B cannot see this escrow
  const r = await get(`/api/escrow/${isoEscrowId}`, "ae-iso-B");
  eq(r.status, 404, "escrow from tenant-A not visible to tenant-B");
});

// ─── Cleanup ──────────────────────────────────────────────────────────────────

import { test as _t } from "../_harness.mjs";
_t("CLAIM-AUTO-ESCROW: cleanup", () => { server.close(); });
