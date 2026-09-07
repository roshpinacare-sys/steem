import "../_flush.mjs";
/**
 * tests/integration/escrow-release-refund-get.test.ts — v67
 *
 * End-to-end escrow lifecycle with GET checkpoints at every state transition.
 *
 * All async setup runs at top level before any test() registration.
 * (_harness.mjs schedules _run() in setTimeout(0) — late registration misses the queue.)
 *
 * Coverage:
 *   RELEASE PATH
 *     create → GET("created") → fund → GET("funded"+fundAuditId) → release → GET("released")
 *     worker balance = AMOUNT after release; payer = 0; escrow account = 0
 *     double-release → 409
 *
 *   REFUND PATH
 *     fund → refund → GET("refunded")
 *     payer balance restored; worker = 0; escrow = 0
 *     double-refund → 409
 *
 *   GET VALIDATION
 *     agreement shape (all fields, BigInt-safe amount string)
 *     missing x-tenant-id → 400
 *     unknown id → 404
 *     cross-tenant → 404
 */

import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";

// ── Server ────────────────────────────────────────────────────────────────────

const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
const port: number = (server.address() as any).port;
const base = `http://127.0.0.1:${port}`;
const H  = (t: string) => ({ "content-type": "application/json", "x-tenant-id": t });

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function createAccount(tenantId: string, ownerId: string): Promise<string> {
  const r = await fetch(`${base}/api/ledger/accounts`, {
    method: "POST", headers: H(tenantId),
    body: JSON.stringify({ ownerId, type: "asset", name: ownerId }),
  });
  return ((await r.json()) as any).account.id;
}

async function mint(tenantId: string, toAccountId: string, amount: string): Promise<void> {
  await fetch(`${base}/api/ledger/mint`, {
    method: "POST", headers: H(tenantId),
    body: JSON.stringify({ toAccountId, amount, memo: "test-setup" }),
  });
}

async function balance(tenantId: string, accountId: string): Promise<bigint> {
  const r = await fetch(`${base}/api/ledger/accounts/${accountId}`, { headers: H(tenantId) });
  return BigInt(((await r.json()) as any).account.balance);
}

async function createEscrow(
  tenantId: string, payerAccountId: string, workerAccountId: string, amount: string,
): Promise<{ id: string; escrowAccountId: string }> {
  const r = await fetch(`${base}/api/escrow`, {
    method: "POST", headers: H(tenantId),
    body: JSON.stringify({ opportunityId: "opp-rg-1", payerAccountId, workerAccountId, amount }),
  });
  const d = (await r.json()) as any;
  assert(r.status === 201, `createEscrow expected 201, got ${r.status}: ${JSON.stringify(d)}`);
  return { id: d.agreement.id, escrowAccountId: d.agreement.escrowAccountId };
}

type HR = { status: number; body: any };
async function get(tenantId: string | null, id: string): Promise<HR> {
  const headers = tenantId
    ? H(tenantId)
    : { "content-type": "application/json" } as any;
  const r = await fetch(`${base}/api/escrow/${id}`, { headers });
  return { status: r.status, body: await r.json() };
}

async function fund(tenantId: string, id: string): Promise<HR> {
  const r = await fetch(`${base}/api/escrow/${id}/fund`, {
    method: "POST", headers: H(tenantId),
    body: JSON.stringify({ initiatedBy: "test-agent" }),
  });
  return { status: r.status, body: await r.json() };
}

async function release(tenantId: string, id: string): Promise<HR> {
  const r = await fetch(`${base}/api/escrow/${id}/release`, {
    method: "POST", headers: H(tenantId),
    body: JSON.stringify({ initiatedBy: "test-agent" }),
  });
  return { status: r.status, body: await r.json() };
}

async function refund(tenantId: string, id: string): Promise<HR> {
  const r = await fetch(`${base}/api/escrow/${id}/refund`, {
    method: "POST", headers: H(tenantId),
    body: JSON.stringify({ initiatedBy: "test-agent" }),
  });
  return { status: r.status, body: await r.json() };
}

// ─────────────────────────────────────────────────────────────────────────────
// ALL ASYNC SETUP — must complete before any test() registration
// ─────────────────────────────────────────────────────────────────────────────

const AMOUNT = "60000"; // 60,000 μ¢

// ── Release path (Tenant: erg-r) ──────────────────────────────────────────────
const T = "erg-r";
const payer  = await createAccount(T, "payer");
const worker = await createAccount(T, "worker");
await mint(T, payer, AMOUNT);
const es = await createEscrow(T, payer, worker, AMOUNT);

const getCreated = await get(T, es.id);          // → "created"
const fundRes    = await fund(T, es.id);
const getFunded  = await get(T, es.id);          // → "funded"

const payerMid  = await balance(T, payer);
const escrowMid = await balance(T, es.escrowAccountId);

const releaseRes = await release(T, es.id);
const getReleased = await get(T, es.id);         // → "released"

const workerFinal = await balance(T, worker);
const escrowFinal = await balance(T, es.escrowAccountId);

const dblRelease  = await release(T, es.id);     // → 409

// ── Refund path (Tenant: erg-rfd) ─────────────────────────────────────────────
const TR = "erg-rfd";
const payerR  = await createAccount(TR, "payer-r");
const workerR = await createAccount(TR, "worker-r");
await mint(TR, payerR, AMOUNT);
const esR = await createEscrow(TR, payerR, workerR, AMOUNT);
await fund(TR, esR.id);

const refundRes   = await refund(TR, esR.id);
const getRefunded = await get(TR, esR.id);       // → "refunded"

const payerRFinal  = await balance(TR, payerR);
const workerRFinal = await balance(TR, workerR);
const escrowRFinal = await balance(TR, esR.escrowAccountId);

const dblRefund = await refund(TR, esR.id);      // → 409

// ── Validation ────────────────────────────────────────────────────────────────
const getUnknown    = await get(T, "no-such-id");
const getCrossTenant = await get("other-tenant-xyz", es.id);
const getNoTenant   = await get(null, es.id);

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

// ── Release path ──────────────────────────────────────────────────────────────

test("escrow e2e: GET after create → state='created'", () => {
  eq(getCreated.status, 200);
  eq(getCreated.body.ok, true);
  eq(getCreated.body.agreement.state, "created");
});

test("escrow e2e: GET shape — id, state, amount(string), payerAccountId, workerAccountId, escrowAccountId", () => {
  const a = getCreated.body.agreement;
  eq(a.id, es.id);
  eq(typeof a.amount, "string", "amount is a string (BigInt-safe)");
  eq(a.amount, AMOUNT);
  assert("payerAccountId" in a);
  assert("workerAccountId" in a);
  assert("escrowAccountId" in a);
});

test("escrow e2e: fund → 200, ok=true", () => {
  eq(fundRes.status, 200);
  eq(fundRes.body.ok, true);
});

test("escrow e2e: GET after fund → state='funded' + fundAuditId", () => {
  eq(getFunded.status, 200);
  eq(getFunded.body.agreement.state, "funded");
  assert(getFunded.body.agreement.fundAuditId?.length > 0, "fundAuditId present");
});

test("escrow e2e: payer balance = 0 after fund (money held in escrow)", () => {
  eq(payerMid, 0n);
});

test("escrow e2e: escrow account balance = AMOUNT after fund", () => {
  eq(escrowMid, BigInt(AMOUNT));
});

test("escrow e2e: release → 200, ok=true", () => {
  eq(releaseRes.status, 200);
  eq(releaseRes.body.ok, true);
});

test("escrow e2e: GET after release → state='released'", () => {
  eq(getReleased.status, 200);
  eq(getReleased.body.agreement.state, "released");
});

test("escrow e2e: worker balance = AMOUNT after release", () => {
  eq(workerFinal, BigInt(AMOUNT), "worker received the escrow budget");
});

test("escrow e2e: escrow account = 0 after release (fully drained)", () => {
  eq(escrowFinal, 0n);
});

test("escrow e2e: double-release → 409", () => {
  eq(dblRelease.status, 409);
});

// ── Refund path ───────────────────────────────────────────────────────────────

test("escrow e2e: refund → 200, ok=true", () => {
  eq(refundRes.status, 200);
  eq(refundRes.body.ok, true);
});

test("escrow e2e: GET after refund → state='refunded'", () => {
  eq(getRefunded.status, 200);
  eq(getRefunded.body.agreement.state, "refunded");
});

test("escrow e2e: payer balance restored after refund", () => {
  eq(payerRFinal, BigInt(AMOUNT), "payer got full budget back");
});

test("escrow e2e: worker balance = 0 after refund (never received)", () => {
  eq(workerRFinal, 0n);
});

test("escrow e2e: escrow account = 0 after refund", () => {
  eq(escrowRFinal, 0n);
});

test("escrow e2e: double-refund → 409", () => {
  eq(dblRefund.status, 409);
});

// ── Validation ────────────────────────────────────────────────────────────────

test("escrow e2e: GET unknown id → 404", () => {
  eq(getUnknown.status, 404);
});

test("escrow e2e: GET cross-tenant → 404 (tenant isolation)", () => {
  eq(getCrossTenant.status, 404);
});

test("escrow e2e: GET missing x-tenant-id → 400", () => {
  eq(getNoTenant.status, 400);
});

test("cleanup: close server", () => { server.close(); });
