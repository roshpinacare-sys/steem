import "../_flush.mjs";
/**
 * tests/contract/ledger-escrow-flow-live.test.ts
 *
 * Hand-written, STATEFUL contract verification for the ledger + escrow flow.
 * Deliberately NOT named `*.contract.test.ts` so auto-generated tooling does
 * not count it in COVERAGE_REPORT.json (see adapter-flow-live.test.ts for the
 * same convention and rationale).
 *
 * Covered operations (spec path → method → declared status, required fields):
 *   POST /ledger/accounts           (createLedgerAccount)  → 201, no required (description-only)
 *   GET  /ledger/accounts/{id}      (getLedgerAccount)     → 200, [account]
 *   POST /ledger/mint               (ledgerMint)           → 200, [ok, auditId]
 *   POST /ledger/transfer           (ledgerTransfer)       → 200, [ok, auditId]
 *   GET  /ledger/solvency           (ledgerSolvency)       → 200, [ok, auditId, data]
 *   POST /escrow                    (createEscrow)         → 201, [ok, agreement]
 *   GET  /escrow/{id}               (getEscrow)            → 200, [ok, agreement]
 *   POST /escrow/{id}/fund          (fundEscrow)           → 200, [ok, agreement]
 *   POST /escrow/{id}/release       (releaseEscrow)        → 200, [ok, agreement]
 *   POST /escrow/{id}/dispute       (disputeEscrow)        → 200, [ok, agreement]
 *   POST /escrow/{id}/undispute     (undisputeEscrow)      → 200, [ok, agreement]
 *   POST /escrow/{id}/refund        (refundEscrow)         → 200, [ok, agreement]
 *   GET  /index/escrows             (indexListEscrows)     → 200, [escrows]
 *   GET  /index/escrows/{id}        (indexGetEscrow)       → 200, [escrow]
 *
 * Flows exercised:
 *   A. HAPPY PATH (create→fund→release):
 *      createAccounts → mint payer → createEscrow → getEscrow →
 *      fundEscrow → releaseEscrow → solvency → indexListEscrows → indexGetEscrow
 *   B. DISPUTE PATH (create→fund→dispute→undispute→refund):
 *      createAccounts → mint payer → createEscrow → fundEscrow →
 *      disputeEscrow → undisputeEscrow → refundEscrow
 *   C. TRANSFER path (createAccounts → mint → transfer):
 *      separate tenant, validates ledger transfer
 *
 * Fail-closed:
 *   - getEscrow with unknown id → 404
 *   - getEscrow cross-tenant → 404
 *   - fundEscrow wrong state (already funded) → 409
 *   - indexGetEscrow with unknown id → 404
 */

import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function call(
  base: string,
  method: string,
  path: string,
  tenantId: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const res = await fetch(base + "/api" + path, {
    method,
    headers: { "x-tenant-id": tenantId, "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { parsed = { _raw: text }; }
  return { status: res.status, body: parsed };
}

function assertRequiredFields(obj: any, fields: string[], label: string): void {
  for (const f of fields) {
    assert(f in obj, `[${label}] missing required field "${f}" in: ${JSON.stringify(obj)}`);
  }
}

// ─── FLOW A: create → fund → release ─────────────────────────────────────────

test("contract ledger-escrow [flow-A]: POST /ledger/accounts → 201 (createLedgerAccount)", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = "le-flow-a-" + uid();
  try {
    const payer = await call(base, "POST", "/ledger/accounts", tenant, {
      ownerId: "payer-" + uid(), type: "personal", name: "Payer",
    });
    eq(payer.status, 201);
    assert("account" in payer.body, "createLedgerAccount response should have account field");

    const worker = await call(base, "POST", "/ledger/accounts", tenant, {
      ownerId: "worker-" + uid(), type: "personal", name: "Worker",
    });
    eq(worker.status, 201);
  } finally { server.close(); }
});

test("contract ledger-escrow [flow-A]: GET /ledger/accounts/{id} → 200, [account] (getLedgerAccount)", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = "le-flow-a-" + uid();
  try {
    const payer = await call(base, "POST", "/ledger/accounts", tenant, {
      ownerId: "payer-" + uid(), type: "personal", name: "Payer",
    });
    eq(payer.status, 201);
    const payerAcctId = payer.body.account.id;

    const get = await call(base, "GET", `/ledger/accounts/${payerAcctId}`, tenant);
    eq(get.status, 200);
    assertRequiredFields(get.body, ["account"], "getLedgerAccount");
    eq(get.body.account.id, payerAcctId);
  } finally { server.close(); }
});

test("contract ledger-escrow [flow-A]: POST /ledger/mint → 200, [ok, auditId] (ledgerMint)", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = "le-flow-a-" + uid();
  try {
    const payer = await call(base, "POST", "/ledger/accounts", tenant, {
      ownerId: "payer-" + uid(), type: "personal", name: "Payer",
    });
    eq(payer.status, 201);
    const payerAcctId = payer.body.account.id;

    const mint = await call(base, "POST", "/ledger/mint", tenant, {
      toAccountId: payerAcctId, amount: "1000000", memo: "initial funding",
    });
    eq(mint.status, 200);
    assertRequiredFields(mint.body, ["ok", "auditId"], "ledgerMint");
    eq(mint.body.ok, true);
    assert(typeof mint.body.auditId === "string", "auditId should be a string");
  } finally { server.close(); }
});

test("contract ledger-escrow [flow-A]: POST /escrow → 201, [ok, agreement] (createEscrow)", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = "le-flow-a-" + uid();
  try {
    const [payer, worker] = await Promise.all([
      call(base, "POST", "/ledger/accounts", tenant, { ownerId: "payer-" + uid(), type: "personal", name: "Payer" }),
      call(base, "POST", "/ledger/accounts", tenant, { ownerId: "worker-" + uid(), type: "personal", name: "Worker" }),
    ]);
    eq(payer.status, 201); eq(worker.status, 201);
    await call(base, "POST", "/ledger/mint", tenant, { toAccountId: payer.body.account.id, amount: "1000000", memo: "mint" });

    const opp = "opp-" + uid();
    const esc = await call(base, "POST", "/escrow", tenant, {
      opportunityId: opp,
      payerAccountId: payer.body.account.id,
      workerAccountId: worker.body.account.id,
      amount: "500000",
    });
    eq(esc.status, 201);
    assertRequiredFields(esc.body, ["ok", "agreement"], "createEscrow");
    eq(esc.body.ok, true);
    assert(typeof esc.body.agreement.id === "string", "agreement.id should be a string");
    eq(esc.body.agreement.state, "created");
  } finally { server.close(); }
});

test("contract ledger-escrow [flow-A]: GET /escrow/{id} → 200, [ok, agreement] (getEscrow)", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = "le-flow-a-" + uid();
  try {
    const [payer, worker] = await Promise.all([
      call(base, "POST", "/ledger/accounts", tenant, { ownerId: "payer-" + uid(), type: "personal", name: "Payer" }),
      call(base, "POST", "/ledger/accounts", tenant, { ownerId: "worker-" + uid(), type: "personal", name: "Worker" }),
    ]);
    await call(base, "POST", "/ledger/mint", tenant, { toAccountId: payer.body.account.id, amount: "1000000", memo: "mint" });

    const esc = await call(base, "POST", "/escrow", tenant, {
      opportunityId: "opp-" + uid(),
      payerAccountId: payer.body.account.id,
      workerAccountId: worker.body.account.id,
      amount: "500000",
    });
    eq(esc.status, 201);
    const escrowId = esc.body.agreement.id;

    const get = await call(base, "GET", `/escrow/${escrowId}`, tenant);
    eq(get.status, 200);
    assertRequiredFields(get.body, ["ok", "agreement"], "getEscrow");
    eq(get.body.agreement.id, escrowId);
    eq(get.body.agreement.state, "created");
  } finally { server.close(); }
});

test("contract ledger-escrow [flow-A]: POST /escrow/{id}/fund → 200, [ok, agreement] (fundEscrow)", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = "le-flow-a-" + uid();
  try {
    const [payer, worker] = await Promise.all([
      call(base, "POST", "/ledger/accounts", tenant, { ownerId: "payer-" + uid(), type: "personal", name: "Payer" }),
      call(base, "POST", "/ledger/accounts", tenant, { ownerId: "worker-" + uid(), type: "personal", name: "Worker" }),
    ]);
    await call(base, "POST", "/ledger/mint", tenant, { toAccountId: payer.body.account.id, amount: "1000000", memo: "mint" });

    const esc = await call(base, "POST", "/escrow", tenant, {
      opportunityId: "opp-" + uid(),
      payerAccountId: payer.body.account.id,
      workerAccountId: worker.body.account.id,
      amount: "500000",
    });
    eq(esc.status, 201);
    const escrowId = esc.body.agreement.id;

    const fund = await call(base, "POST", `/escrow/${escrowId}/fund`, tenant, { initiatedBy: "payer" });
    eq(fund.status, 200);
    assertRequiredFields(fund.body, ["ok", "agreement"], "fundEscrow");
    eq(fund.body.agreement.state, "funded");
  } finally { server.close(); }
});

test("contract ledger-escrow [flow-A]: POST /escrow/{id}/release → 200, [ok, agreement] state=released (releaseEscrow)", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = "le-flow-a-" + uid();
  try {
    const [payer, worker] = await Promise.all([
      call(base, "POST", "/ledger/accounts", tenant, { ownerId: "payer-" + uid(), type: "personal", name: "Payer" }),
      call(base, "POST", "/ledger/accounts", tenant, { ownerId: "worker-" + uid(), type: "personal", name: "Worker" }),
    ]);
    await call(base, "POST", "/ledger/mint", tenant, { toAccountId: payer.body.account.id, amount: "1000000", memo: "mint" });

    const esc = await call(base, "POST", "/escrow", tenant, {
      opportunityId: "opp-" + uid(),
      payerAccountId: payer.body.account.id,
      workerAccountId: worker.body.account.id,
      amount: "500000",
    });
    const escrowId = esc.body.agreement.id;
    await call(base, "POST", `/escrow/${escrowId}/fund`, tenant, { initiatedBy: "payer" });

    const rel = await call(base, "POST", `/escrow/${escrowId}/release`, tenant, { initiatedBy: "payer" });
    eq(rel.status, 200);
    assertRequiredFields(rel.body, ["ok", "agreement"], "releaseEscrow");
    eq(rel.body.agreement.state, "released");
  } finally { server.close(); }
});

test("contract ledger-escrow [flow-A]: GET /ledger/solvency → 200, [ok, auditId, data] (ledgerSolvency)", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = "le-solvency-" + uid();
  try {
    const sol = await call(base, "GET", "/ledger/solvency", tenant);
    eq(sol.status, 200);
    assertRequiredFields(sol.body, ["ok", "auditId", "data"], "ledgerSolvency");
    eq(sol.body.ok, true);
  } finally { server.close(); }
});

test("contract ledger-escrow [flow-A]: GET /index/escrows → 200, [escrows] after create+fund (indexListEscrows)", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = "le-flow-a-" + uid();
  try {
    const [payer, worker] = await Promise.all([
      call(base, "POST", "/ledger/accounts", tenant, { ownerId: "payer-" + uid(), type: "personal", name: "Payer" }),
      call(base, "POST", "/ledger/accounts", tenant, { ownerId: "worker-" + uid(), type: "personal", name: "Worker" }),
    ]);
    await call(base, "POST", "/ledger/mint", tenant, { toAccountId: payer.body.account.id, amount: "1000000", memo: "mint" });

    const esc = await call(base, "POST", "/escrow", tenant, {
      opportunityId: "opp-" + uid(),
      payerAccountId: payer.body.account.id,
      workerAccountId: worker.body.account.id,
      amount: "500000",
    });
    eq(esc.status, 201);
    await call(base, "POST", `/escrow/${esc.body.agreement.id}/fund`, tenant, { initiatedBy: "payer" });

    const list = await call(base, "GET", "/index/escrows", tenant);
    eq(list.status, 200);
    assertRequiredFields(list.body, ["escrows"], "indexListEscrows");
    assert(Array.isArray(list.body.escrows), "escrows should be an array");
    assert(list.body.escrows.length >= 1, "at least one escrow should be projected");
  } finally { server.close(); }
});

test("contract ledger-escrow [flow-A]: GET /index/escrows/{id} → 200, [escrow] (indexGetEscrow)", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = "le-flow-a-" + uid();
  try {
    const [payer, worker] = await Promise.all([
      call(base, "POST", "/ledger/accounts", tenant, { ownerId: "payer-" + uid(), type: "personal", name: "Payer" }),
      call(base, "POST", "/ledger/accounts", tenant, { ownerId: "worker-" + uid(), type: "personal", name: "Worker" }),
    ]);
    await call(base, "POST", "/ledger/mint", tenant, { toAccountId: payer.body.account.id, amount: "1000000", memo: "mint" });

    const esc = await call(base, "POST", "/escrow", tenant, {
      opportunityId: "opp-" + uid(),
      payerAccountId: payer.body.account.id,
      workerAccountId: worker.body.account.id,
      amount: "500000",
    });
    eq(esc.status, 201);
    const escrowId = esc.body.agreement.id;
    await call(base, "POST", `/escrow/${escrowId}/fund`, tenant, { initiatedBy: "payer" });

    const get = await call(base, "GET", `/index/escrows/${escrowId}`, tenant);
    eq(get.status, 200);
    assertRequiredFields(get.body, ["escrow"], "indexGetEscrow");
    eq(get.body.escrow.agreementId, escrowId);
  } finally { server.close(); }
});

// ─── FLOW B: create → fund → dispute → undispute → refund ────────────────────

test("contract ledger-escrow [flow-B]: POST /escrow/{id}/dispute → 200, [ok, agreement] state=disputed (disputeEscrow)", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = "le-flow-b-" + uid();
  try {
    const [payer, worker] = await Promise.all([
      call(base, "POST", "/ledger/accounts", tenant, { ownerId: "payer-" + uid(), type: "personal", name: "Payer" }),
      call(base, "POST", "/ledger/accounts", tenant, { ownerId: "worker-" + uid(), type: "personal", name: "Worker" }),
    ]);
    await call(base, "POST", "/ledger/mint", tenant, { toAccountId: payer.body.account.id, amount: "1000000", memo: "mint" });

    const esc = await call(base, "POST", "/escrow", tenant, {
      opportunityId: "opp-" + uid(),
      payerAccountId: payer.body.account.id,
      workerAccountId: worker.body.account.id,
      amount: "500000",
    });
    const escrowId = esc.body.agreement.id;
    await call(base, "POST", `/escrow/${escrowId}/fund`, tenant, { initiatedBy: "payer" });

    const dispute = await call(base, "POST", `/escrow/${escrowId}/dispute`, tenant, { initiatedBy: "payer", reason: "work incomplete" });
    eq(dispute.status, 200);
    assertRequiredFields(dispute.body, ["ok", "agreement"], "disputeEscrow");
    eq(dispute.body.agreement.state, "disputed");
  } finally { server.close(); }
});

test("contract ledger-escrow [flow-B]: POST /escrow/{id}/undispute → 200, [ok, agreement] state=funded (undisputeEscrow)", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = "le-flow-b-" + uid();
  try {
    const [payer, worker] = await Promise.all([
      call(base, "POST", "/ledger/accounts", tenant, { ownerId: "payer-" + uid(), type: "personal", name: "Payer" }),
      call(base, "POST", "/ledger/accounts", tenant, { ownerId: "worker-" + uid(), type: "personal", name: "Worker" }),
    ]);
    await call(base, "POST", "/ledger/mint", tenant, { toAccountId: payer.body.account.id, amount: "1000000", memo: "mint" });

    const esc = await call(base, "POST", "/escrow", tenant, {
      opportunityId: "opp-" + uid(),
      payerAccountId: payer.body.account.id,
      workerAccountId: worker.body.account.id,
      amount: "500000",
    });
    const escrowId = esc.body.agreement.id;
    await call(base, "POST", `/escrow/${escrowId}/fund`, tenant, { initiatedBy: "payer" });
    await call(base, "POST", `/escrow/${escrowId}/dispute`, tenant, { initiatedBy: "payer" });

    const undispute = await call(base, "POST", `/escrow/${escrowId}/undispute`, tenant, { initiatedBy: "payer" });
    eq(undispute.status, 200);
    assertRequiredFields(undispute.body, ["ok", "agreement"], "undisputeEscrow");
    eq(undispute.body.agreement.state, "funded");
  } finally { server.close(); }
});

test("contract ledger-escrow [flow-B]: POST /escrow/{id}/refund → 200, [ok, agreement] state=refunded (refundEscrow)", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = "le-flow-b-" + uid();
  try {
    const [payer, worker] = await Promise.all([
      call(base, "POST", "/ledger/accounts", tenant, { ownerId: "payer-" + uid(), type: "personal", name: "Payer" }),
      call(base, "POST", "/ledger/accounts", tenant, { ownerId: "worker-" + uid(), type: "personal", name: "Worker" }),
    ]);
    await call(base, "POST", "/ledger/mint", tenant, { toAccountId: payer.body.account.id, amount: "1000000", memo: "mint" });

    const esc = await call(base, "POST", "/escrow", tenant, {
      opportunityId: "opp-" + uid(),
      payerAccountId: payer.body.account.id,
      workerAccountId: worker.body.account.id,
      amount: "500000",
    });
    const escrowId = esc.body.agreement.id;
    await call(base, "POST", `/escrow/${escrowId}/fund`, tenant, { initiatedBy: "payer" });

    const refund = await call(base, "POST", `/escrow/${escrowId}/refund`, tenant, { initiatedBy: "payer" });
    eq(refund.status, 200);
    assertRequiredFields(refund.body, ["ok", "agreement"], "refundEscrow");
    eq(refund.body.agreement.state, "refunded");
  } finally { server.close(); }
});

// ─── FLOW C: transfer ─────────────────────────────────────────────────────────

test("contract ledger-escrow [flow-C]: POST /ledger/transfer → 200, [ok, auditId] (ledgerTransfer)", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = "le-flow-c-" + uid();
  try {
    const [acctA, acctB] = await Promise.all([
      call(base, "POST", "/ledger/accounts", tenant, { ownerId: "user-a-" + uid(), type: "personal", name: "A" }),
      call(base, "POST", "/ledger/accounts", tenant, { ownerId: "user-b-" + uid(), type: "personal", name: "B" }),
    ]);
    eq(acctA.status, 201); eq(acctB.status, 201);
    await call(base, "POST", "/ledger/mint", tenant, { toAccountId: acctA.body.account.id, amount: "500000", memo: "mint" });

    const transfer = await call(base, "POST", "/ledger/transfer", tenant, {
      fromAccountId: acctA.body.account.id,
      toAccountId: acctB.body.account.id,
      amount: "100000",
      memo: "payment",
    });
    eq(transfer.status, 200);
    assertRequiredFields(transfer.body, ["ok", "auditId"], "ledgerTransfer");
    eq(transfer.body.ok, true);
  } finally { server.close(); }
});

// ─── Fail-closed ──────────────────────────────────────────────────────────────

test("contract ledger-escrow [fail-closed]: GET /escrow/{id} unknown id → 404", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  try {
    const { status } = await call(base, "GET", "/escrow/no-such-id-" + uid(), "le-fc-" + uid());
    eq(status, 404);
  } finally { server.close(); }
});

test("contract ledger-escrow [fail-closed]: GET /escrow/{id} cross-tenant → 404", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenantA = "le-fc-tenant-a-" + uid();
  const tenantB = "le-fc-tenant-b-" + uid();
  try {
    const [payer, worker] = await Promise.all([
      call(base, "POST", "/ledger/accounts", tenantA, { ownerId: "payer-" + uid(), type: "personal", name: "Payer" }),
      call(base, "POST", "/ledger/accounts", tenantA, { ownerId: "worker-" + uid(), type: "personal", name: "Worker" }),
    ]);
    await call(base, "POST", "/ledger/mint", tenantA, { toAccountId: payer.body.account.id, amount: "1000000", memo: "mint" });

    const esc = await call(base, "POST", "/escrow", tenantA, {
      opportunityId: "opp-" + uid(),
      payerAccountId: payer.body.account.id,
      workerAccountId: worker.body.account.id,
      amount: "500000",
    });
    const escrowId = esc.body.agreement.id;

    const { status } = await call(base, "GET", `/escrow/${escrowId}`, tenantB);
    eq(status, 404);
  } finally { server.close(); }
});

test("contract ledger-escrow [fail-closed]: POST /escrow/{id}/fund wrong state (already funded) → 409", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = "le-fc-" + uid();
  try {
    const [payer, worker] = await Promise.all([
      call(base, "POST", "/ledger/accounts", tenant, { ownerId: "payer-" + uid(), type: "personal", name: "Payer" }),
      call(base, "POST", "/ledger/accounts", tenant, { ownerId: "worker-" + uid(), type: "personal", name: "Worker" }),
    ]);
    await call(base, "POST", "/ledger/mint", tenant, { toAccountId: payer.body.account.id, amount: "1000000", memo: "mint" });

    const esc = await call(base, "POST", "/escrow", tenant, {
      opportunityId: "opp-" + uid(),
      payerAccountId: payer.body.account.id,
      workerAccountId: worker.body.account.id,
      amount: "500000",
    });
    const escrowId = esc.body.agreement.id;
    await call(base, "POST", `/escrow/${escrowId}/fund`, tenant, { initiatedBy: "payer" });

    const { status } = await call(base, "POST", `/escrow/${escrowId}/fund`, tenant, { initiatedBy: "payer" });
    eq(status, 409);
  } finally { server.close(); }
});

test("contract ledger-escrow [fail-closed]: GET /index/escrows/{id} unknown id → 404", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  try {
    const { status } = await call(base, "GET", "/index/escrows/no-such-id-" + uid(), "le-fc-" + uid());
    eq(status, 404);
  } finally { server.close(); }
});

test("contract ledger-escrow [fail-closed]: POST /escrow missing required fields → 400", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  try {
    const { status } = await call(base, "POST", "/escrow", "le-fc-" + uid(), { opportunityId: "opp-x" });
    eq(status, 400);
  } finally { server.close(); }
});

test("contract ledger-escrow [fail-closed]: POST /ledger/mint missing toAccountId → 400", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  try {
    const { status } = await call(base, "POST", "/ledger/mint", "le-fc-" + uid(), { amount: "1000" });
    eq(status, 400);
  } finally { server.close(); }
});
