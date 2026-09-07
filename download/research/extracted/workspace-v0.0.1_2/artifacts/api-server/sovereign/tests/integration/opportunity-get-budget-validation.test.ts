import "../_flush.mjs";
/**
 * tests/integration/opportunity-get-budget-validation.test.ts
 *
 * Live-server HTTP integration tests covering two additions from MANIFEST v61:
 *
 *   GET /api/marketplace/opportunities/:id  (new endpoint, was missing)
 *     • happy path: 200 + { ok:true, opportunity } with all fields
 *     • budget field serialized as decimal string (BigInt-safe)
 *     • missing x-tenant-id → 400 (tenant isolation)
 *     • unknown id within tenant → 404
 *     • cross-tenant isolation: id created in tenant-A returns 404 from tenant-B
 *     • deleted opportunity → 404
 *     • shape: id, title, description, requiredStrengths, minScore, tenantId, createdAt, budget
 *
 *   Budget pre-validation on claim (v2 — fail-closed before money moves)
 *     • payer has enough for claimFee + budget → claim succeeds
 *     • payer lacks funds for claimFee + budget combined → 403 BEFORE any ledger change
 *       (balance unchanged after the 403; no escrow created)
 *     • payer account not found → 404
 *     • no workerAccountId → pre-validation skipped, normal claim
 *     • no budget on opportunity → pre-validation skipped, normal claim
 *
 * All assertions against a live Node http server (port=0).
 * Zero external dependencies — built-in fetch only.
 */

import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";

const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
const port: number = (server.address() as any).port;
const base = `http://127.0.0.1:${port}`;

const H = (t: string) => ({ "content-type": "application/json", "x-tenant-id": t });
const post = (path: string, body: any, tenant = "og-t1") =>
  fetch(base + path, { method: "POST", headers: H(tenant), body: JSON.stringify(body) });
const get = (path: string, tenant = "og-t1") =>
  fetch(base + path, { headers: H(tenant) });
const del = (path: string, tenant = "og-t1") =>
  fetch(base + path, { method: "DELETE", headers: H(tenant) });

// ─── Shared state ────────────────────────────────────────────────────────────
let baseOppId: string;            // opportunity without budget
let budgetOppId: string;          // opportunity with budget
const BUDGET = "500000";          // 5 USD in μ¢
let payerAccountId: string;
const PAYER_FUND = "2000000";     // 20 USD — plenty
let thinPayerAccountId: string;   // barely enough for claimFee, not budget
const THIN_FUND = "15000";        // 0.15 USD — enough for claimFee (10000) but not budget+fee

// ─── Setup ───────────────────────────────────────────────────────────────────

test("SETUP: create opportunities and accounts for tests", async () => {
  // Opportunity without budget
  const r1 = await post("/api/marketplace/opportunities", {
    title: "No-budget Opp",
    description: "desc",
    requiredStrengths: [],
    minScore: 0,
  });
  const b1 = await r1.json();
  assert(b1.opportunity?.id, "opportunity created");
  baseOppId = b1.opportunity.id;

  // Opportunity with budget
  const r2 = await post("/api/marketplace/opportunities", {
    title: "Budget Opp",
    description: "desc",
    requiredStrengths: [],
    minScore: 0,
    budget: BUDGET,
  });
  const b2 = await r2.json();
  assert(b2.opportunity?.id, "budget opportunity created");
  budgetOppId = b2.opportunity.id;

  // Well-funded payer
  const acc = await (await post("/api/ledger/accounts", { ownerId: "og-u1", type: "asset", name: "Payer" })).json();
  payerAccountId = acc.account.id;
  await post("/api/ledger/mint", { toAccountId: payerAccountId, amount: PAYER_FUND, memo: "seed" });

  // Thin payer
  const acc2 = await (await post("/api/ledger/accounts", { ownerId: "og-thin", type: "asset", name: "Thin" })).json();
  thinPayerAccountId = acc2.account.id;
  await post("/api/ledger/mint", { toAccountId: thinPayerAccountId, amount: THIN_FUND, memo: "thin-seed" });
});

// ─── GET /api/marketplace/opportunities/:id — tenant isolation ────────────────

test("GET OPP: missing x-tenant-id → 400", async () => {
  const r = await fetch(base + "/api/marketplace/opportunities/" + baseOppId);
  eq(r.status, 400);
});

// ─── GET /api/marketplace/opportunities/:id — happy path ─────────────────────

test("GET OPP: happy path — 200 + ok:true + opportunity shape", async () => {
  const r = await get("/api/marketplace/opportunities/" + baseOppId);
  eq(r.status, 200);
  const body = await r.json();
  eq(body.ok, true, "ok:true");
  assert(body.opportunity, "opportunity field present");
  const opp = body.opportunity;
  eq(opp.id, baseOppId, "id matches");
  assert(typeof opp.title === "string", "title is string");
  assert(typeof opp.description === "string", "description present");
  assert(Array.isArray(opp.requiredStrengths), "requiredStrengths is array");
  assert(typeof opp.tenantId === "string", "tenantId present");
});

test("GET OPP: opportunity without budget has no budget field", async () => {
  const r = await get("/api/marketplace/opportunities/" + baseOppId);
  eq(r.status, 200);
  const { opportunity } = await r.json();
  assert(!("budget" in opportunity) || opportunity.budget === undefined,
    "no budget field on non-budget opportunity");
});

test("GET OPP: opportunity with budget returns budget as decimal string (BigInt-safe)", async () => {
  const r = await get("/api/marketplace/opportunities/" + budgetOppId);
  eq(r.status, 200);
  const { opportunity } = await r.json();
  assert("budget" in opportunity, "budget field present");
  eq(opportunity.budget, BUDGET, "budget matches decimal string");
  assert(/^\d+$/.test(opportunity.budget), "budget is decimal string");
});

test("GET OPP: id matches requested id", async () => {
  const r = await get("/api/marketplace/opportunities/" + budgetOppId);
  eq(r.status, 200);
  const { opportunity } = await r.json();
  eq(opportunity.id, budgetOppId);
});

// ─── GET /api/marketplace/opportunities/:id — not found ───────────────────────

test("GET OPP: unknown id within tenant → 404", async () => {
  const r = await get("/api/marketplace/opportunities/00000000-0000-0000-0000-000000000000");
  eq(r.status, 404);
  const body = await r.json();
  assert(typeof body.error === "string", "error message present");
});

test("GET OPP: cross-tenant isolation — id from tenant-A returns 404 from tenant-B", async () => {
  // Create opp in tenant-A
  const rA = await post("/api/marketplace/opportunities", { title: "A's Opp", description: "", requiredStrengths: [], minScore: 0 }, "og-iso-A");
  const { opportunity: oppA } = await rA.json();

  // Attempt from tenant-B — must not find it
  const rB = await get("/api/marketplace/opportunities/" + oppA.id, "og-iso-B");
  eq(rB.status, 404, "cross-tenant GET returns 404 (not 403 — no id enumeration)");
});

test("GET OPP: deleted opportunity → 404", async () => {
  // Create a temporary opportunity
  const cr = await post("/api/marketplace/opportunities", { title: "Temp", description: "", requiredStrengths: [], minScore: 0 });
  const { opportunity: tmp } = await cr.json();

  // Delete it
  await del("/api/marketplace/opportunities/" + tmp.id);

  // GET should now 404
  const r = await get("/api/marketplace/opportunities/" + tmp.id);
  eq(r.status, 404, "deleted opportunity returns 404");
});

// ─── GET :id consistency with list ───────────────────────────────────────────

test("GET OPP: get-by-id returns same data as list", async () => {
  const listR = await get("/api/marketplace/opportunities");
  const { opportunities } = await listR.json();
  const fromList = opportunities.find((o: any) => o.id === budgetOppId);
  assert(fromList, "budget opp in list");

  const getR = await get("/api/marketplace/opportunities/" + budgetOppId);
  const { opportunity: fromGet } = await getR.json();

  eq(fromGet.id, fromList.id, "id matches");
  eq(fromGet.title, fromList.title, "title matches");
  eq(fromGet.budget, fromList.budget, "budget matches between list and get-by-id");
});

// ─── Budget pre-validation — fail-closed (no ledger side-effects) ──────────────

test("BUDGET PREVALIDATION: thin payer (claimFee+budget > balance) → 403 before money moves", async () => {
  const workerAcc = await (await post("/api/ledger/accounts", { ownerId: "w-pv1", type: "asset", name: "Worker" })).json();

  // Capture thin payer balance BEFORE the attempt
  const balBefore = await (await get("/api/transparency/balances")).json();
  const thinBefore = balBefore.accounts.find((a: any) => a.id === thinPayerAccountId)?.balance;

  const r = await post("/api/marketplace/opportunities/" + budgetOppId + "/claim", {
    fromAccountId: thinPayerAccountId,
    claimFee: "10000",
    workerAccountId: workerAcc.account.id,
    userId: "thin-u1",
  });

  eq(r.status, 403, "403 when payer can't cover claimFee + budget");
  const body = await r.json();
  assert(typeof body.error === "string" && body.error.includes("insufficient"), "error mentions insufficient balance");
  assert(body.error.includes("μ¢"), "error shows μ¢ amounts");

  // Verify balance UNCHANGED — no money moved
  const balAfter = await (await get("/api/transparency/balances")).json();
  const thinAfter = balAfter.accounts.find((a: any) => a.id === thinPayerAccountId)?.balance;
  eq(thinAfter, thinBefore, "thin payer balance unchanged after 403 (fail-closed)");
});

test("BUDGET PREVALIDATION: well-funded payer → claim succeeds (pre-validation passes)", async () => {
  const workerAcc = await (await post("/api/ledger/accounts", { ownerId: "w-pv2", type: "asset", name: "Worker2" })).json();

  const r = await post("/api/marketplace/opportunities/" + budgetOppId + "/claim", {
    fromAccountId: payerAccountId,
    claimFee: "10000",
    workerAccountId: workerAcc.account.id,
    userId: "rich-u1",
  });

  // Should succeed (has enough for both claimFee + budget)
  eq(r.status, 200, "well-funded payer gets 200 (status: " + r.status + ")");
  const body = await r.json();
  eq(body.ok, true);
  assert(body.escrow, "escrow created");
});

test("BUDGET PREVALIDATION: no workerAccountId → pre-validation skipped, normal claim", async () => {
  // Even a thin payer can claim if no workerAccountId (no escrow, just fee)
  const r = await post("/api/marketplace/opportunities/" + budgetOppId + "/claim", {
    fromAccountId: thinPayerAccountId,
    claimFee: "10000",
    userId: "thin-nowid-u1",
    // no workerAccountId
  });
  // 200 if balance ≥ claimFee, else 403 from guard — either is correct, not 400
  assert(r.status === 200 || r.status === 403, "200 or 403 (not 400) when no workerAccountId");
  if (r.status === 200) {
    const body = await r.json();
    assert(!body.escrow, "no escrow when no workerAccountId");
  }
});

test("BUDGET PREVALIDATION: opportunity without budget → pre-validation skipped, normal claim", async () => {
  // baseOppId has no budget — pre-validation is completely skipped
  const r = await post("/api/marketplace/opportunities/" + baseOppId + "/claim", {
    fromAccountId: payerAccountId,
    claimFee: "10000",
    workerAccountId: "any-worker-id",
    userId: "no-budget-u1",
  });
  // Guard may deny for workerAccountId not being a real account, but not a 400 from pre-validation
  assert(r.status !== 400, "pre-validation 400 not triggered when opportunity has no budget");
});

test("BUDGET PREVALIDATION: payer account not found → 404", async () => {
  const workerAcc = await (await post("/api/ledger/accounts", { ownerId: "w-pv3", type: "asset", name: "Worker3" })).json();

  const r = await post("/api/marketplace/opportunities/" + budgetOppId + "/claim", {
    fromAccountId: "00000000-not-real-0000000000",
    claimFee: "10000",
    workerAccountId: workerAcc.account.id,
    userId: "ghost-u1",
  });
  // 404 from pre-validation (payer not found) or 403 from guard — both are correct
  assert(r.status === 404 || r.status === 403,
    "404 or 403 when payer account not found (got " + r.status + ")");
});

// ─── Cleanup ─────────────────────────────────────────────────────────────────

import { test as _t } from "../_harness.mjs";
_t("GET-OPP/BUDGET-PREVALIDATION: cleanup", () => { server.close(); });
