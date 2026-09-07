import "../_flush.mjs";
/**
 * tests/integration/escrow-api.test.ts — Sovereign Escrow HTTP endpoints
 *
 * Coverage:
 *   CREATE:  missing fields → 400, payer=worker → 400, bad amount → 400, happy path 201
 *   GET:     missing tenant → 400, unknown id → 404, happy path 200 shape
 *   FUND:    unknown id → 404, wrong state (already funded) → 409, happy path
 *   RELEASE: wrong state (created, not funded) → 409, happy path funded→released
 *   REFUND:  wrong state (created) → 409, happy path funded→refunded
 *   DOUBLE:  release after release → 409 (double-release impossible)
 *   LEDGER:  fund moves μ¢ from payer; release moves μ¢ to worker; refund returns μ¢ to payer
 *   TENANT:  cross-tenant GET → 404; cross-tenant fund → 404
 */

import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";

// ─── Server setup ─────────────────────────────────────────────────────────────

const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
const port: number = (server.address() as any).port;
const base = `http://127.0.0.1:${port}`;
const H = (t: string) => ({ "content-type": "application/json", "x-tenant-id": t });

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function createAccount(tenantId: string, ownerId: string): Promise<string> {
  const r = await fetch(`${base}/api/ledger/accounts`, {
    method: "POST", headers: H(tenantId),
    body: JSON.stringify({ ownerId, type: "asset", name: ownerId }),
  });
  const d = await r.json();
  return d.account.id;
}

async function mint(tenantId: string, toAccountId: string, amount: string): Promise<void> {
  await fetch(`${base}/api/ledger/mint`, {
    method: "POST", headers: H(tenantId),
    body: JSON.stringify({ toAccountId, amount, memo: "test setup" }),
  });
}

async function balance(tenantId: string, accountId: string): Promise<bigint> {
  const r = await fetch(`${base}/api/ledger/accounts/${accountId}`, { headers: H(tenantId) });
  const d = await r.json();
  return BigInt(d.account.balance);
}

async function createEscrow(
  tenantId: string,
  payerAccountId: string,
  workerAccountId: string,
  amount = "50000",
): Promise<{ id: string; escrowAccountId: string }> {
  const r = await fetch(`${base}/api/escrow`, {
    method: "POST", headers: H(tenantId),
    body: JSON.stringify({ opportunityId: "opp-1", payerAccountId, workerAccountId, amount }),
  });
  const d = await r.json();
  return { id: d.agreement.id, escrowAccountId: d.agreement.escrowAccountId };
}

// ─── CREATE ───────────────────────────────────────────────────────────────────

test("ESCROW CREATE: missing x-tenant-id → 400", async () => {
  const r = await fetch(`${base}/api/escrow`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  eq(r.status, 400);
});

test("ESCROW CREATE: missing opportunityId → 400", async () => {
  const r = await fetch(`${base}/api/escrow`, {
    method: "POST", headers: H("t1"),
    body: JSON.stringify({ payerAccountId: "a", workerAccountId: "b", amount: "1000" }),
  });
  eq(r.status, 400);
});

test("ESCROW CREATE: missing payerAccountId → 400", async () => {
  const r = await fetch(`${base}/api/escrow`, {
    method: "POST", headers: H("t1"),
    body: JSON.stringify({ opportunityId: "o1", workerAccountId: "b", amount: "1000" }),
  });
  eq(r.status, 400);
});

test("ESCROW CREATE: missing amount → 400", async () => {
  const r = await fetch(`${base}/api/escrow`, {
    method: "POST", headers: H("t1"),
    body: JSON.stringify({ opportunityId: "o1", payerAccountId: "a", workerAccountId: "b" }),
  });
  eq(r.status, 400);
});

test("ESCROW CREATE: negative amount → 400", async () => {
  const r = await fetch(`${base}/api/escrow`, {
    method: "POST", headers: H("t1"),
    body: JSON.stringify({ opportunityId: "o1", payerAccountId: "a", workerAccountId: "b", amount: "-100" }),
  });
  eq(r.status, 400);
});

test("ESCROW CREATE: zero amount → 400", async () => {
  const r = await fetch(`${base}/api/escrow`, {
    method: "POST", headers: H("t1"),
    body: JSON.stringify({ opportunityId: "o1", payerAccountId: "a", workerAccountId: "b", amount: "0" }),
  });
  eq(r.status, 400);
});

test("ESCROW CREATE: payer === worker → 400", async () => {
  const r = await fetch(`${base}/api/escrow`, {
    method: "POST", headers: H("t1"),
    body: JSON.stringify({ opportunityId: "o1", payerAccountId: "same", workerAccountId: "same", amount: "1000" }),
  });
  eq(r.status, 400);
});

test("ESCROW CREATE: happy path → 201 + agreement shape", async () => {
  const payerId = await createAccount("tc", "payer-create");
  const workerId = await createAccount("tc", "worker-create");
  const r = await fetch(`${base}/api/escrow`, {
    method: "POST", headers: H("tc"),
    body: JSON.stringify({ opportunityId: "opp-create", payerAccountId: payerId, workerAccountId: workerId, amount: "10000" }),
  });
  eq(r.status, 201);
  const d = await r.json();
  assert(d.ok, "ok must be true");
  const ag = d.agreement;
  assert(typeof ag.id === "string" && ag.id.length > 0, "id present");
  eq(ag.tenantId, "tc");
  eq(ag.state, "created");
  eq(ag.amount, "10000");
  assert(typeof ag.escrowAccountId === "string", "escrowAccountId present");
  assert(typeof ag.createdAt === "string", "createdAt present");
});

// ─── GET ─────────────────────────────────────────────────────────────────────

test("ESCROW GET: unknown id → 404", async () => {
  const r = await fetch(`${base}/api/escrow/no-such-id`, { headers: H("t1") });
  eq(r.status, 404);
});

test("ESCROW GET: happy path → 200 + agreement", async () => {
  const payerId = await createAccount("tg", "payer-get");
  const workerId = await createAccount("tg", "worker-get");
  const { id } = await createEscrow("tg", payerId, workerId);
  const r = await fetch(`${base}/api/escrow/${id}`, { headers: H("tg") });
  eq(r.status, 200);
  const d = await r.json();
  assert(d.ok);
  eq(d.agreement.id, id);
  eq(d.agreement.state, "created");
});

// ─── FUND ─────────────────────────────────────────────────────────────────────

test("ESCROW FUND: unknown id → 404", async () => {
  const r = await fetch(`${base}/api/escrow/no-such/fund`, {
    method: "POST", headers: H("t1"), body: "{}",
  });
  eq(r.status, 404);
});

test("ESCROW FUND: happy path — moves μ¢ from payer to escrow, state→funded", async () => {
  const payerId = await createAccount("tf", "payer-fund");
  const workerId = await createAccount("tf", "worker-fund");
  await mint("tf", payerId, "100000");

  const { id, escrowAccountId } = await createEscrow("tf", payerId, workerId, "30000");

  const payerBefore = await balance("tf", payerId);
  const escrowBefore = await balance("tf", escrowAccountId);

  const r = await fetch(`${base}/api/escrow/${id}/fund`, {
    method: "POST", headers: H("tf"), body: JSON.stringify({ initiatedBy: "user-1" }),
  });
  eq(r.status, 200);
  const d = await r.json();
  assert(d.ok);
  eq(d.agreement.state, "funded");
  assert(typeof d.agreement.fundAuditId === "string", "fundAuditId present");

  const payerAfter = await balance("tf", payerId);
  const escrowAfter = await balance("tf", escrowAccountId);
  eq(payerBefore - payerAfter, 30000n, "payer balance decreased by amount");
  eq(escrowAfter - escrowBefore, 30000n, "escrow balance increased by amount");
});

test("ESCROW FUND: double-fund → 409 wrong state", async () => {
  const payerId = await createAccount("tff", "payer-dbl");
  const workerId = await createAccount("tff", "worker-dbl");
  await mint("tff", payerId, "200000");
  const { id } = await createEscrow("tff", payerId, workerId, "10000");

  // first fund succeeds
  await fetch(`${base}/api/escrow/${id}/fund`, {
    method: "POST", headers: H("tff"), body: "{}",
  });

  // second fund must fail
  const r = await fetch(`${base}/api/escrow/${id}/fund`, {
    method: "POST", headers: H("tff"), body: "{}",
  });
  eq(r.status, 409);
});

// ─── RELEASE ─────────────────────────────────────────────────────────────────

test("ESCROW RELEASE: release unfunded (created state) → 409", async () => {
  const payerId = await createAccount("trl", "payer-rel-bad");
  const workerId = await createAccount("trl", "worker-rel-bad");
  const { id } = await createEscrow("trl", payerId, workerId, "5000");

  const r = await fetch(`${base}/api/escrow/${id}/release`, {
    method: "POST", headers: H("trl"), body: "{}",
  });
  eq(r.status, 409);
});

test("ESCROW RELEASE: happy path — moves μ¢ from escrow to worker, state→released", async () => {
  const payerId = await createAccount("tr", "payer-rel");
  const workerId = await createAccount("tr", "worker-rel");
  await mint("tr", payerId, "100000");

  const { id, escrowAccountId } = await createEscrow("tr", payerId, workerId, "40000");
  await fetch(`${base}/api/escrow/${id}/fund`, { method: "POST", headers: H("tr"), body: JSON.stringify({ initiatedBy: "requester-1" }) });

  const workerBefore = await balance("tr", workerId);
  const escrowBefore = await balance("tr", escrowAccountId);

  const r = await fetch(`${base}/api/escrow/${id}/release`, {
    method: "POST", headers: H("tr"), body: JSON.stringify({ initiatedBy: "requester-1" }),
  });
  eq(r.status, 200);
  const d = await r.json();
  assert(d.ok);
  eq(d.agreement.state, "released");
  assert(typeof d.agreement.settleAuditId === "string", "settleAuditId present");

  const workerAfter = await balance("tr", workerId);
  const escrowAfter = await balance("tr", escrowAccountId);
  eq(workerAfter - workerBefore, 40000n, "worker received amount");
  eq(escrowBefore - escrowAfter, 40000n, "escrow drained");
});

test("ESCROW RELEASE: double-release → 409 (fail-closed)", async () => {
  const payerId = await createAccount("tdr", "payer-double-rel");
  const workerId = await createAccount("tdr", "worker-double-rel");
  await mint("tdr", payerId, "100000");
  const { id } = await createEscrow("tdr", payerId, workerId, "20000");
  await fetch(`${base}/api/escrow/${id}/fund`, { method: "POST", headers: H("tdr"), body: "{}" });
  await fetch(`${base}/api/escrow/${id}/release`, { method: "POST", headers: H("tdr"), body: "{}" });

  const r = await fetch(`${base}/api/escrow/${id}/release`, { method: "POST", headers: H("tdr"), body: "{}" });
  eq(r.status, 409);
});

// ─── REFUND ───────────────────────────────────────────────────────────────────

test("ESCROW REFUND: refund unfunded (created state) → 409", async () => {
  const payerId = await createAccount("trf", "payer-ref-bad");
  const workerId = await createAccount("trf", "worker-ref-bad");
  const { id } = await createEscrow("trf", payerId, workerId, "5000");

  const r = await fetch(`${base}/api/escrow/${id}/refund`, {
    method: "POST", headers: H("trf"), body: "{}",
  });
  eq(r.status, 409);
});

test("ESCROW REFUND: happy path — moves μ¢ from escrow back to payer, state→refunded", async () => {
  const payerId = await createAccount("trefund", "payer-refund");
  const workerId = await createAccount("trefund", "worker-refund");
  await mint("trefund", payerId, "100000");

  const { id, escrowAccountId } = await createEscrow("trefund", payerId, workerId, "35000");
  await fetch(`${base}/api/escrow/${id}/fund`, { method: "POST", headers: H("trefund"), body: "{}" });

  const payerAfterFund = await balance("trefund", payerId);

  const r = await fetch(`${base}/api/escrow/${id}/refund`, {
    method: "POST", headers: H("trefund"), body: "{}",
  });
  eq(r.status, 200);
  const d = await r.json();
  assert(d.ok);
  eq(d.agreement.state, "refunded");
  assert(typeof d.agreement.settleAuditId === "string", "settleAuditId present");

  const payerAfterRefund = await balance("trefund", payerId);
  const escrowAfterRefund = await balance("trefund", escrowAccountId);
  eq(payerAfterRefund - payerAfterFund, 35000n, "payer got refund");
  eq(escrowAfterRefund, 0n, "escrow drained");
});

// ─── Tenant isolation ─────────────────────────────────────────────────────────

test("ESCROW TENANT: cross-tenant GET → 404", async () => {
  const payerId = await createAccount("tenant-A", "payer-iso");
  const workerId = await createAccount("tenant-A", "worker-iso");
  const { id } = await createEscrow("tenant-A", payerId, workerId, "1000");

  // tenant-B must not see tenant-A's escrow
  const r = await fetch(`${base}/api/escrow/${id}`, { headers: H("tenant-B") });
  eq(r.status, 404);
});

test("ESCROW TENANT: cross-tenant fund → 404", async () => {
  const payerId = await createAccount("tenant-C", "payer-iso2");
  const workerId = await createAccount("tenant-C", "worker-iso2");
  const { id } = await createEscrow("tenant-C", payerId, workerId, "1000");

  const r = await fetch(`${base}/api/escrow/${id}/fund`, {
    method: "POST", headers: H("tenant-D"), body: "{}",
  });
  eq(r.status, 404);
});

// ─── Cleanup ─────────────────────────────────────────────────────────────────

test("cleanup: close server", () => { server.close(); });
