import "../_flush.mjs";
/**
 * tests/integration/third-party-escrow-sdk.test.ts — proof that an external party can
 * drive the full TFA Sovereign Escrow lifecycle using ONLY the standalone, published
 * @tfa/escrow-client package (sdk/escrow-client/index.mjs) — no kernel imports.
 *
 * Mirrors tests/integration/third-party-sdk.test.ts (passport-client) for the escrow SDK.
 *
 * Coverage:
 *   • happy path: create → fund → release (full lifecycle, BigInt amount revival)
 *   • dispute path: create → fund → dispute → undispute → refund
 *   • edge case: getEscrow alias === fetchEscrow; fee-free amount round-trips exactly
 *   • fail-closed: unknown escrow id → not_found; release before fund → conflict;
 *     cross-tenant fetch → not_found; undispute by non-funder → unauthorized;
 *     missing required field on create → missing_body_field (client-side, no network)
 */

import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import {
  createEscrow,
  fetchEscrow,
  getEscrow,
  fundEscrow,
  releaseEscrow,
  refundEscrow,
  disputeEscrow,
  undisputeEscrow,
  EscrowClientError,
} from "../../sdk/escrow-client/index.mjs";

const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
const port: number = (server.address() as any).port;
const base = `http://127.0.0.1:${port}`;

// Helper: create + mint a ledger account so it can fund escrow.
async function seedFundedAccount(tenant: string, ownerId: string, name: string): Promise<string> {
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

async function seedAccount(tenant: string, ownerId: string, name: string): Promise<string> {
  const accRes = await fetch(base + "/api/ledger/accounts", {
    method: "POST",
    headers: { "content-type": "application/json", "x-tenant-id": tenant },
    body: JSON.stringify({ ownerId, type: "asset", name }),
  });
  eq(accRes.status, 201);
  const acc = await accRes.json();
  return acc.account.id;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ─── Happy path ───────────────────────────────────────────────────────────────

test("third-party escrow SDK [happy]: create → fund → release (full lifecycle)", async () => {
  const tenant = "ext-escrow-" + uid();
  const payer = await seedFundedAccount(tenant, "payer-1", "Payer");
  const worker = await seedAccount(tenant, "worker-1", "Worker");

  const created = await createEscrow(base, tenant, {
    opportunityId: "opp-" + uid(),
    payerAccountId: payer,
    workerAccountId: worker,
    amount: 12_345n,
  });
  eq(created.status, 201);
  eq(created.agreement.state, "created");
  eq(created.agreement.amount, 12_345n);
  assert(typeof created.agreement.amount === "bigint", "amount revived to bigint");

  const funded = await fundEscrow(base, created.agreement.id, tenant, { initiatedBy: payer });
  eq(funded.status, 200);
  eq(funded.agreement.state, "funded");
  eq(funded.agreement.fundedBy, payer);

  const released = await releaseEscrow(base, created.agreement.id, tenant, { initiatedBy: payer });
  eq(released.status, 200);
  eq(released.agreement.state, "released");
  eq(released.agreement.amount, 12_345n);
});

// ─── Dispute path ─────────────────────────────────────────────────────────────

test("third-party escrow SDK [dispute]: create → fund → dispute → undispute → refund", async () => {
  const tenant = "ext-escrow-" + uid();
  const payer = await seedFundedAccount(tenant, "payer-2", "Payer");
  const worker = await seedAccount(tenant, "worker-2", "Worker");

  const created = await createEscrow(base, tenant, {
    opportunityId: "opp-" + uid(),
    payerAccountId: payer,
    workerAccountId: worker,
    amount: 5_000n,
  });

  await fundEscrow(base, created.agreement.id, tenant, { initiatedBy: payer });

  const disputed = await disputeEscrow(base, created.agreement.id, tenant, {
    initiatedBy: worker,
    reason: "work not delivered yet",
  });
  eq(disputed.status, 200);
  eq(disputed.agreement.state, "disputed");
  eq(disputed.agreement.disputedBy, worker);
  eq(disputed.agreement.disputeReason, "work not delivered yet");

  const undisputed = await undisputeEscrow(base, created.agreement.id, tenant, { initiatedBy: payer });
  eq(undisputed.status, 200);
  eq(undisputed.agreement.state, "funded");

  const refunded = await refundEscrow(base, created.agreement.id, tenant, { initiatedBy: payer });
  eq(refunded.status, 200);
  eq(refunded.agreement.state, "refunded");
  eq(refunded.agreement.amount, 5_000n);
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

test("third-party escrow SDK [edge]: getEscrow is an alias of fetchEscrow", async () => {
  const tenant = "ext-escrow-" + uid();
  const payer = await seedFundedAccount(tenant, "payer-3", "Payer");
  const worker = await seedAccount(tenant, "worker-3", "Worker");

  const created = await createEscrow(base, tenant, {
    opportunityId: "opp-" + uid(),
    payerAccountId: payer,
    workerAccountId: worker,
    amount: 999n,
  });

  const viaFetch = await fetchEscrow(base, created.agreement.id, tenant);
  const viaGet = await getEscrow(base, created.agreement.id, tenant);
  eq(viaFetch.agreement.id, viaGet.agreement.id);
  eq(viaFetch.agreement.amount, viaGet.agreement.amount);
  eq(viaGet.agreement.amount, 999n);
});

// ─── Fail-closed ──────────────────────────────────────────────────────────────

test("third-party escrow SDK [fail-closed]: unknown escrow id → not_found", async () => {
  const tenant = "ext-escrow-" + uid();
  try {
    await fetchEscrow(base, "no-such-escrow", tenant);
    assert(false, "should have thrown");
  } catch (e: any) {
    assert(e instanceof EscrowClientError, "is EscrowClientError");
    eq(e.code, "not_found");
  }
});

test("third-party escrow SDK [fail-closed]: release before fund → conflict (409)", async () => {
  const tenant = "ext-escrow-" + uid();
  const payer = await seedFundedAccount(tenant, "payer-4", "Payer");
  const worker = await seedAccount(tenant, "worker-4", "Worker");

  const created = await createEscrow(base, tenant, {
    opportunityId: "opp-" + uid(),
    payerAccountId: payer,
    workerAccountId: worker,
    amount: 100n,
  });

  try {
    await releaseEscrow(base, created.agreement.id, tenant, { initiatedBy: payer });
    assert(false, "should have thrown");
  } catch (e: any) {
    assert(e instanceof EscrowClientError, "is EscrowClientError");
    eq(e.code, "conflict");
  }
});

test("third-party escrow SDK [fail-closed]: cross-tenant fetch → not_found (isolation)", async () => {
  const tenantA = "ext-escrow-a-" + uid();
  const tenantB = "ext-escrow-b-" + uid();
  const payer = await seedFundedAccount(tenantA, "payer-5", "Payer");
  const worker = await seedAccount(tenantA, "worker-5", "Worker");

  const created = await createEscrow(base, tenantA, {
    opportunityId: "opp-" + uid(),
    payerAccountId: payer,
    workerAccountId: worker,
    amount: 100n,
  });

  try {
    await fetchEscrow(base, created.agreement.id, tenantB);
    assert(false, "should have thrown");
  } catch (e: any) {
    assert(e instanceof EscrowClientError, "is EscrowClientError");
    eq(e.code, "not_found");
  }
});

test("third-party escrow SDK [fail-closed]: undispute by non-funder → unauthorized (403)", async () => {
  const tenant = "ext-escrow-" + uid();
  const payer = await seedFundedAccount(tenant, "payer-6", "Payer");
  const worker = await seedAccount(tenant, "worker-6", "Worker");

  const created = await createEscrow(base, tenant, {
    opportunityId: "opp-" + uid(),
    payerAccountId: payer,
    workerAccountId: worker,
    amount: 100n,
  });
  await fundEscrow(base, created.agreement.id, tenant, { initiatedBy: payer });
  await disputeEscrow(base, created.agreement.id, tenant, { initiatedBy: worker });

  try {
    // worker is not the funder — undispute must be denied
    await undisputeEscrow(base, created.agreement.id, tenant, { initiatedBy: worker });
    assert(false, "should have thrown");
  } catch (e: any) {
    assert(e instanceof EscrowClientError, "is EscrowClientError");
    eq(e.code, "unauthorized");
  }
});

test("third-party escrow SDK [fail-closed]: missing required field on create → missing_body_field (no network call)", async () => {
  const tenant = "ext-escrow-" + uid();
  try {
    await createEscrow(base, tenant, {
      opportunityId: "opp-x",
      payerAccountId: "p1",
      workerAccountId: "", // missing
      amount: 100n,
    } as any);
    assert(false, "should have thrown");
  } catch (e: any) {
    assert(e instanceof EscrowClientError, "is EscrowClientError");
    eq(e.code, "missing_body_field");
  }
});

test("cleanup third-party-escrow-sdk tests", () => { server.close(); });
