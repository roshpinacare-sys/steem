import "../_flush.mjs";
/**
 * tests/escrow/escrow-client.test.ts — external Escrow SDK client tests.
 *
 * Coverage:
 *   • happy path: create → fetch → fund → release (full lifecycle)
 *   • create → fund → refund (refund path)
 *   • invalid input guards: missing baseUrl / tenantId / escrowId / payload fields → EscrowClientError
 *   • unknown escrowId → not_found
 *   • wrong state: release before fund → conflict
 *   • cross-tenant fetch → not_found (isolation preserved)
 *   • BigInt revival: agreement.amount is bigint after fetch
 *   • server 400 on create with invalid amount → caught as server_error
 */

import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import {
  fetchEscrow,
  createEscrow,
  fundEscrow,
  releaseEscrow,
  refundEscrow,
  EscrowClientError,
} from "../../lib/escrow-client/index.ts";

const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
const port: number = (server.address() as any).port;
const base = `http://127.0.0.1:${port}`;

// Helper: create an account + mint so we have a funded payer.
async function seedAccount(tenant: string, ownerId = "u1", name = "Alice") {
  const accRes = await fetch(base + "/api/ledger/accounts", {
    method: "POST",
    headers: { "content-type": "application/json", "x-tenant-id": tenant },
    body: JSON.stringify({ ownerId, type: "asset", name }),
  });
  eq(accRes.status, 201);
  const acc = await accRes.json();
  const mintRes = await fetch(base + "/api/ledger/mint", {
    method: "POST",
    headers: { "content-type": "application/json", "x-tenant-id": tenant },
    body: JSON.stringify({ toAccountId: acc.account.id, amount: "1000000", memo: "seed" }),
  });
  eq(mintRes.status, 200);
  return acc.account.id;
}

// Helper: create a second account (worker).
async function seedWorkerAccount(tenant: string, ownerId = "u2", name = "Bob") {
  const accRes = await fetch(base + "/api/ledger/accounts", {
    method: "POST",
    headers: { "content-type": "application/json", "x-tenant-id": tenant },
    body: JSON.stringify({ ownerId, type: "asset", name }),
  });
  eq(accRes.status, 201);
  const acc = await accRes.json();
  return acc.account.id;
}

// ─── Input guards ────────────────────────────────────────────────────────────

test("guard: missing baseUrl → EscrowClientError missing_base_url", async () => {
  try {
    await fetchEscrow("", "e1", "t1");
    assert(false, "should have thrown");
  } catch (e: any) {
    assert(e instanceof EscrowClientError, "error is EscrowClientError");
    eq(e.code, "missing_base_url");
  }
});

test("guard: missing tenantId on fetch → EscrowClientError missing_tenant_id", async () => {
  try {
    await fetchEscrow(base, "e1", "");
    assert(false, "should have thrown");
  } catch (e: any) {
    assert(e instanceof EscrowClientError, "error is EscrowClientError");
    eq(e.code, "missing_tenant_id");
  }
});

test("guard: missing escrowId on fetch → EscrowClientError missing_escrow_id", async () => {
  try {
    await fetchEscrow(base, "", "t1");
    assert(false, "should have thrown");
  } catch (e: any) {
    assert(e instanceof EscrowClientError, "error is EscrowClientError");
    eq(e.code, "missing_escrow_id");
  }
});

test("guard: missing payload on create → EscrowClientError missing_body_field", async () => {
  try {
    await createEscrow(base, "t1", undefined as any);
    assert(false, "should have thrown");
  } catch (e: any) {
    assert(e instanceof EscrowClientError, "error is EscrowClientError");
    eq(e.code, "missing_body_field");
  }
});

test("guard: missing opportunityId on create → EscrowClientError missing_body_field", async () => {
  try {
    await createEscrow(base, "t1", { payerAccountId: "a", workerAccountId: "b", amount: 100n } as any);
    assert(false, "should have thrown");
  } catch (e: any) {
    assert(e instanceof EscrowClientError, "error is EscrowClientError");
    eq(e.code, "missing_body_field");
  }
});

// ─── HTTP failure cases ──────────────────────────────────────────────────────

test("fetch: unknown escrowId → not_found", async () => {
  try {
    await fetchEscrow(base, "00000000-0000-0000-0000-000000000000", "t1");
    assert(false, "should have thrown");
  } catch (e: any) {
    assert(e instanceof EscrowClientError, "error is EscrowClientError");
    eq(e.code, "not_found");
  }
});

test("create: invalid amount string → server_error", async () => {
  try {
    await createEscrow(base, "t1", { opportunityId: "o1", payerAccountId: "a", workerAccountId: "b", amount: "not-a-number" });
    assert(false, "should have thrown");
  } catch (e: any) {
    assert(e instanceof EscrowClientError, "error is EscrowClientError");
    eq(e.code, "server_error");
  }
});

// ─── Happy path: full lifecycle (create → fetch → fund → release) ───────────

test("happy path: full escrow lifecycle via SDK", async () => {
  const tenant = "happy-escrow-tenant";
  const payerId = await seedAccount(tenant);
  const workerId = await seedWorkerAccount(tenant);

  // Create
  const created = await createEscrow(base, tenant, {
    opportunityId: "opp-1",
    payerAccountId: payerId,
    workerAccountId: workerId,
    amount: 50000n,
  });
  eq(created.status, 201);
  assert(created.agreement, "agreement present");
  eq(created.agreement.state, "created");
  eq(created.agreement.amount, 50000n, "amount is bigint");
  eq(created.agreement.tenantId, tenant);

  // Fetch
  const fetched = await fetchEscrow(base, created.agreement.id, tenant);
  eq(fetched.status, 200);
  eq(fetched.agreement.id, created.agreement.id);
  eq(fetched.agreement.state, "created");

  // Fund
  const funded = await fundEscrow(base, created.agreement.id, tenant);
  eq(funded.status, 200);
  eq(funded.agreement.state, "funded");
  eq(funded.agreement.amount, 50000n);

  // Release
  const released = await releaseEscrow(base, created.agreement.id, tenant);
  eq(released.status, 200);
  eq(released.agreement.state, "released");
});

// ─── Refund path ─────────────────────────────────────────────────────────────

test("happy path: create → fund → refund", async () => {
  const tenant = "refund-tenant";
  const payerId = await seedAccount(tenant);
  const workerId = await seedWorkerAccount(tenant);

  const created = await createEscrow(base, tenant, {
    opportunityId: "opp-refund",
    payerAccountId: payerId,
    workerAccountId: workerId,
    amount: 10000n,
  });
  eq(created.agreement.state, "created");

  const funded = await fundEscrow(base, created.agreement.id, tenant);
  eq(funded.agreement.state, "funded");

  const refunded = await refundEscrow(base, created.agreement.id, tenant);
  eq(refunded.status, 200);
  eq(refunded.agreement.state, "refunded");
});

// ─── Wrong state: release before fund → conflict ────────────────────────────

test("failure: release before fund → conflict", async () => {
  const tenant = "conflict-tenant";
  const payerId = await seedAccount(tenant);
  const workerId = await seedWorkerAccount(tenant);

  const created = await createEscrow(base, tenant, {
    opportunityId: "opp-conflict",
    payerAccountId: payerId,
    workerAccountId: workerId,
    amount: 1000n,
  });

  try {
    await releaseEscrow(base, created.agreement.id, tenant);
    assert(false, "should have thrown");
  } catch (e: any) {
    assert(e instanceof EscrowClientError, "error is EscrowClientError");
    eq(e.code, "conflict");
  }
});

// ─── Double release → conflict ───────────────────────────────────────────────

test("failure: double release → conflict", async () => {
  const tenant = "double-release-tenant";
  const payerId = await seedAccount(tenant);
  const workerId = await seedWorkerAccount(tenant);

  const created = await createEscrow(base, tenant, {
    opportunityId: "opp-double",
    payerAccountId: payerId,
    workerAccountId: workerId,
    amount: 1000n,
  });
  await fundEscrow(base, created.agreement.id, tenant);
  await releaseEscrow(base, created.agreement.id, tenant);

  try {
    await releaseEscrow(base, created.agreement.id, tenant);
    assert(false, "should have thrown");
  } catch (e: any) {
    assert(e instanceof EscrowClientError, "error is EscrowClientError");
    eq(e.code, "conflict");
  }
});

// ─── Cross-tenant isolation ─────────────────────────────────────────────────

test("fetch: cross-tenant escrowId → not_found (isolation)", async () => {
  const tenantA = "iso-A";
  const payerId = await seedAccount(tenantA);
  const workerId = await seedWorkerAccount(tenantA);

  const created = await createEscrow(base, tenantA, {
    opportunityId: "opp-iso",
    payerAccountId: payerId,
    workerAccountId: workerId,
    amount: 1000n,
  });

  try {
    await fetchEscrow(base, created.agreement.id, "iso-B");
    assert(false, "should have thrown");
  } catch (e: any) {
    assert(e instanceof EscrowClientError, "error is EscrowClientError");
    eq(e.code, "not_found");
  }
});

// ─── initiatedBy option ─────────────────────────────────────────────────────

test("option: initiatedBy passed through fund", async () => {
  const tenant = "initiated-tenant";
  const payerId = await seedAccount(tenant);
  const workerId = await seedWorkerAccount(tenant);

  const created = await createEscrow(base, tenant, {
    opportunityId: "opp-init",
    payerAccountId: payerId,
    workerAccountId: workerId,
    amount: 1000n,
  });

  const funded = await fundEscrow(base, created.agreement.id, tenant, { initiatedBy: "custom-agent" });
  eq(funded.status, 200);
  eq(funded.agreement.state, "funded");
});

import { test as _t } from "../_harness.mjs";
_t("cleanup escrow-client tests", () => { server.close(); });
