import "../_flush.mjs";
/**
 * tests/integration/escrow-state-after-fund-failure.test.ts
 *
 * Verifies escrow agreement stays in "created" state after fund() failure,
 * that no money moves on failure, and that the agreement is retryable.
 *
 * All async setup runs before any test() registration so _harness.mjs
 * sees a complete queue before _run() fires.
 *
 * Coverage:
 *   FUND FAILURE (0 balance)     — 403, state="created", no fundAuditId, balances unchanged
 *   FUND FAILURE (spending cap)  — 403, state="created", balances unchanged
 *   RETRY AFTER FAILURE          — mint → fund succeeds, state="funded", fundAuditId set
 *   TENANT ISOLATION             — other tenant GET → 404
 *   WRONG STATE                  — second fund on funded → 409, state unchanged
 */

import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";

// ── Server ────────────────────────────────────────────────────────────────────

const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
const port: number = (server.address() as any).port;
const base = `http://127.0.0.1:${port}`;
const H = (t: string) => ({ "content-type": "application/json", "x-tenant-id": t });

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function createAccount(tenantId: string, ownerId: string): Promise<string> {
  const r = await fetch(`${base}/api/ledger/accounts`, {
    method: "POST", headers: H(tenantId),
    body: JSON.stringify({ ownerId, type: "asset", name: ownerId }),
  });
  const d = await r.json() as any;
  return d.account.id;
}

async function mint(tenantId: string, toAccountId: string, amount: string): Promise<void> {
  await fetch(`${base}/api/ledger/mint`, {
    method: "POST", headers: H(tenantId),
    body: JSON.stringify({ toAccountId, amount, memo: "test-setup" }),
  });
}

async function balance(tenantId: string, accountId: string): Promise<bigint> {
  const r = await fetch(`${base}/api/ledger/accounts/${accountId}`, { headers: H(tenantId) });
  const d = await r.json() as any;
  return BigInt(d.account.balance);
}

async function createEscrow(
  tenantId: string, payerAccountId: string, workerAccountId: string, amount: string,
): Promise<{ id: string; escrowAccountId: string }> {
  const r = await fetch(`${base}/api/escrow`, {
    method: "POST", headers: H(tenantId),
    body: JSON.stringify({ opportunityId: "opp-test-1", payerAccountId, workerAccountId, amount }),
  });
  const d = await r.json() as any;
  assert(r.status === 201, `createEscrow expected 201, got ${r.status}: ${JSON.stringify(d)}`);
  return { id: d.agreement.id, escrowAccountId: d.agreement.escrowAccountId };
}

async function getEscrow(tenantId: string, id: string): Promise<{ status: number; body: any }> {
  const r = await fetch(`${base}/api/escrow/${id}`, { headers: H(tenantId) });
  return { status: r.status, body: await r.json() };
}

async function fund(tenantId: string, id: string): Promise<{ status: number; body: any }> {
  const r = await fetch(`${base}/api/escrow/${id}/fund`, {
    method: "POST", headers: H(tenantId),
    body: JSON.stringify({ initiatedBy: "test-agent" }),
  });
  return { status: r.status, body: await r.json() };
}

// ─────────────────────────────────────────────────────────────────────────────
// ALL ASYNC SETUP — must complete before any test() registration
// ─────────────────────────────────────────────────────────────────────────────

// ── Scenario A: insufficient balance (0 μ¢) ──────────────────────────────────
const T_INS = "esf-ins";
const payerIns  = await createAccount(T_INS, "payer-ins");
const workerIns = await createAccount(T_INS, "worker-ins");
const esIns     = await createEscrow(T_INS, payerIns, workerIns, "10000");
const fundInsResult  = await fund(T_INS, esIns.id);          // expect 403
const getAfterIns    = await getEscrow(T_INS, esIns.id);
const escrowBalIns   = await balance(T_INS, esIns.escrowAccountId);
const payerBalIns    = await balance(T_INS, payerIns);

// ── Scenario B: spending-cap exceeded (150M > 100M cap) ──────────────────────
const T_CAP = "esf-cap";
const payerCap  = await createAccount(T_CAP, "payer-cap");
const workerCap = await createAccount(T_CAP, "worker-cap");
await mint(T_CAP, payerCap, "100000000");
await mint(T_CAP, payerCap, "100000000");   // total 200M, under cap per-tx
const esCap         = await createEscrow(T_CAP, payerCap, workerCap, "150000000");
const fundCapResult = await fund(T_CAP, esCap.id);           // expect 403 (150M > 100M cap)
const getAfterCap   = await getEscrow(T_CAP, esCap.id);
const escrowBalCap  = await balance(T_CAP, esCap.escrowAccountId);
const payerBalCap   = await balance(T_CAP, payerCap);

// ── Scenario C: retry after failure ──────────────────────────────────────────
const T_RT = "esf-rt";
const payerRt  = await createAccount(T_RT, "payer-rt");
const workerRt = await createAccount(T_RT, "worker-rt");
const esRt        = await createEscrow(T_RT, payerRt, workerRt, "50000");
const firstFund   = await fund(T_RT, esRt.id);               // expect 403 (no balance)
await mint(T_RT, payerRt, "50000");
const secondFund  = await fund(T_RT, esRt.id);               // expect 200
const getAfterRt  = await getEscrow(T_RT, esRt.id);
const escrowBalRt = await balance(T_RT, esRt.escrowAccountId);
const payerBalRt  = await balance(T_RT, payerRt);

// ── Scenario D: wrong state (double-fund) ────────────────────────────────────
const thirdFund    = await fund(T_RT, esRt.id);              // expect 409 (already funded)
const getAfterDbl  = await getEscrow(T_RT, esRt.id);

// ── Scenario E: tenant isolation ─────────────────────────────────────────────
const crossGet = await getEscrow("completely-other-tenant", esIns.id);

// ─────────────────────────────────────────────────────────────────────────────
// TEST REGISTRATIONS — all setup is done above
// ─────────────────────────────────────────────────────────────────────────────

// ── A: insufficient balance ───────────────────────────────────────────────────
test("FUND FAILURE (0 balance): POST /api/escrow/:id/fund returns 403", async () => {
  eq(fundInsResult.status, 403);
});
test("FUND FAILURE (0 balance): GET /api/escrow/:id state is still 'created'", async () => {
  eq(getAfterIns.status, 200);
  eq(getAfterIns.body.agreement.state, "created");
});
test("FUND FAILURE (0 balance): fundAuditId absent after failure", async () => {
  const fa = getAfterIns.body.agreement.fundAuditId;
  assert(fa === undefined || fa === null, `expected no fundAuditId, got: ${fa}`);
});
test("FUND FAILURE (0 balance): escrow account balance = 0 (no money moved)", async () => {
  eq(escrowBalIns, 0n);
});
test("FUND FAILURE (0 balance): payer balance unchanged after failure", async () => {
  eq(payerBalIns, 0n);
});

// ── B: spending cap ───────────────────────────────────────────────────────────
test("FUND FAILURE (spending cap): POST /api/escrow/:id/fund returns 403", async () => {
  eq(fundCapResult.status, 403);
});
test("FUND FAILURE (spending cap): state stays 'created' after cap denial", async () => {
  eq(getAfterCap.status, 200);
  eq(getAfterCap.body.agreement.state, "created");
});
test("FUND FAILURE (spending cap): escrow account balance = 0", async () => {
  eq(escrowBalCap, 0n);
});
test("FUND FAILURE (spending cap): payer balance unchanged (still 200M)", async () => {
  eq(payerBalCap, 200000000n);
});

// ── C: retry after failure ────────────────────────────────────────────────────
test("RETRY AFTER FAILURE: initial fund fails with 403 (no balance)", async () => {
  eq(firstFund.status, 403);
});
test("RETRY AFTER FAILURE: fund after mint returns 200", async () => {
  eq(secondFund.status, 200);
});
test("RETRY AFTER FAILURE: state is 'funded' after successful retry", async () => {
  eq(getAfterRt.status, 200);
  eq(getAfterRt.body.agreement.state, "funded");
});
test("RETRY AFTER FAILURE: fundAuditId present after successful retry", async () => {
  const fa = getAfterRt.body.agreement.fundAuditId;
  assert(typeof fa === "string" && fa.length > 0, `expected fundAuditId string, got: ${fa}`);
});
test("RETRY AFTER FAILURE: escrow account balance = amount after retry", async () => {
  eq(escrowBalRt, 50000n);
});
test("RETRY AFTER FAILURE: payer balance = 0 after funding", async () => {
  eq(payerBalRt, 0n);
});

// ── D: wrong state (double-fund) ──────────────────────────────────────────────
test("WRONG STATE: second fund on already-funded agreement → 409", async () => {
  eq(thirdFund.status, 409);
});
test("WRONG STATE: state stays 'funded' after rejected second fund", async () => {
  eq(getAfterDbl.status, 200);
  eq(getAfterDbl.body.agreement.state, "funded");
});

// ── E: tenant isolation ───────────────────────────────────────────────────────
test("TENANT ISOLATION: different tenant GET after fund failure → 404", async () => {
  eq(crossGet.status, 404);
});

test("cleanup: close server", () => { server.close(); });
