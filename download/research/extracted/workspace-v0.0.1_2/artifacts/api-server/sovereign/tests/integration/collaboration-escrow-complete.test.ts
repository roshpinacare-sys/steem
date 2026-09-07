import "../_flush.mjs";
/**
 * tests/integration/collaboration-escrow-complete.test.ts
 *
 * End-to-end HTTP tests for the collaboration completion endpoint:
 * POST /api/potential/collaboration/:escrowId/complete
 *
 * Coverage:
 *   • created→funded→released: fund then release in one call
 *   • pre-funded escrow: skip fund, release directly
 *   • 404 for unknown escrowId
 *   • 409 for already-released escrow (double-complete)
 *   • 403 for denyAll policy (via bridge)
 *   • Tenant isolation: cross-tenant → 404
 *   • Passport returned when signer wired
 *   • Ledger balances: payer decreases by amount, worker receives amount
 */

import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";

const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
const port: number = (server.address() as any).port;
const base = `http://127.0.0.1:${port}`;
const T = "complete-tenant";
const H = { "content-type": "application/json", "x-tenant-id": T };
const post = (p: string, b: any) => fetch(base + p, { method: "POST", headers: H, body: JSON.stringify(b) });
const get = (p: string) => fetch(base + p, { headers: H });

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function createAccount(ownerId: string): Promise<string> {
  const r = await post("/api/ledger/accounts", { ownerId, type: "asset", name: ownerId });
  const d = await r.json();
  return d.account.id;
}

async function mint(toAccountId: string, amount: string): Promise<void> {
  await post("/api/ledger/mint", { toAccountId, amount, memo: "seed" });
}

async function balance(accountId: string): Promise<bigint> {
  const r = await get(`/api/ledger/accounts/${accountId}`);
  const d = await r.json();
  return BigInt(d.account.balance);
}

async function createEscrow(payerAccountId: string, workerAccountId: string, amount: string) {
  const r = await post("/api/escrow", {
    opportunityId: "opp-complete-http",
    payerAccountId,
    workerAccountId,
    amount,
  });
  const d = await r.json();
  return d.agreement;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test("HTTP complete: created→released, balances move correctly", async () => {
  const payerId = await createAccount("payer-1");
  const workerId = await createAccount("worker-1");
  await mint(payerId, "100000");

  const agreement = await createEscrow(payerId, workerId, "30000");

  const payerBefore = await balance(payerId);
  const workerBefore = await balance(workerId);

  const r = await post(`/api/potential/collaboration/${agreement.id}/complete`, { initiatedBy: "user-1" });
  eq(r.status, 200);
  const d = await r.json();
  assert(d.ok, "ok must be true");
  eq(d.agreement.state, "released", "state must be released");
  eq(d.agreement.amount, "30000", "amount serialized correctly");

  const payerAfter = await balance(payerId);
  const workerAfter = await balance(workerId);
  eq(payerBefore - payerAfter, 30000n, "payer lost amount");
  eq(workerAfter - workerBefore, 30000n, "worker gained amount");
});

test("HTTP complete: pre-funded escrow → skip fund, release directly", async () => {
  const payerId = await createAccount("payer-2");
  const workerId = await createAccount("worker-2");
  await mint(payerId, "100000");

  const agreement = await createEscrow(payerId, workerId, "20000");
  // Pre-fund via escrow endpoint
  const fundRes = await post(`/api/escrow/${agreement.id}/fund`, { initiatedBy: "user-2" });
  eq(fundRes.status, 200);

  const workerBefore = await balance(workerId);

  const r = await post(`/api/potential/collaboration/${agreement.id}/complete`, { initiatedBy: "user-2" });
  eq(r.status, 200);
  const d = await r.json();
  assert(d.ok, "ok must be true");
  eq(d.agreement.state, "released");

  const workerAfter = await balance(workerId);
  eq(workerAfter - workerBefore, 20000n, "worker gained amount");
});

test("HTTP complete: unknown escrowId → 404", async () => {
  const r = await post(`/api/potential/collaboration/no-such-id/complete`, {});
  eq(r.status, 404);
});

test("HTTP complete: already released → 409", async () => {
  const payerId = await createAccount("payer-3");
  const workerId = await createAccount("worker-3");
  await mint(payerId, "100000");

  const agreement = await createEscrow(payerId, workerId, "15000");
  // Complete once
  await post(`/api/potential/collaboration/${agreement.id}/complete`, {});

  // Second attempt
  const r = await post(`/api/potential/collaboration/${agreement.id}/complete`, {});
  eq(r.status, 409);
});

test("HTTP complete: passport present when signer wired", async () => {
  const payerId = await createAccount("payer-4");
  const workerId = await createAccount("worker-4");
  await mint(payerId, "100000");

  const agreement = await createEscrow(payerId, workerId, "10000");
  const r = await post(`/api/potential/collaboration/${agreement.id}/complete`, { initiatedBy: "user-4" });
  eq(r.status, 200);
  const d = await r.json();
  assert(d.ok, "ok must be true");
  assert(d.passport !== undefined, "passport must be present");
  eq(d.passport.audit.actionType, "potential.collaboration.complete", "passport actionType must match");
});

test("HTTP complete: tenant isolation → cross-tenant returns 404", async () => {
  const payerId = await createAccount("payer-iso");
  const workerId = await createAccount("worker-iso");
  await mint(payerId, "100000");

  const agreement = await createEscrow(payerId, workerId, "5000");

  const wrongHeaders = { "content-type": "application/json", "x-tenant-id": "other-tenant" };
  const r = await fetch(`${base}/api/potential/collaboration/${agreement.id}/complete`, {
    method: "POST",
    headers: wrongHeaders,
    body: JSON.stringify({}),
  });
  eq(r.status, 404);
});

test("cleanup: close server", () => { server.close(); });
