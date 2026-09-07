import "../_flush.mjs";
/**
 * tests/indexer/event-bus-wiring.test.ts — v148
 *
 * Coverage (Indexer #5 — wiring IndexerEventBus to production side-effects):
 *   • POST /api/execution            → execution.updated projected automatically
 *   • POST /api/execution/:id/transition → re-projected with new status
 *   • POST /api/settlement/:id/fund  → escrow.updated projected (state "held")
 *   • POST /api/settlement/:id/release → escrow.updated projected (state "released")
 *   • GET  /api/passport/:auditId    → passport.issued projected into readModelStore
 *   • Fail-closed: a broken indexerEventBus (throwing store) never breaks the
 *     underlying HTTP route — the API call still succeeds with 200/201.
 */

import { test, assert, eq } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { buildSovereignStack } from "../../src/composition.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import type { Server } from "node:http";

let _counter = 0;
function uniqueTenant(): string {
  return `wire-tenant-${++_counter}`;
}

const UNLIMITED = { windowMs: 60_000, maxRequests: 10_000 };

function makeServer() {
  const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const server = startSovereignServer(0, stack, { requireIdempotencyKey: false, rateLimit: UNLIMITED });
  server.unref();
  const addr = server.address();
  if (!addr || typeof addr !== "object") throw new Error("Server did not bind");
  return { server, port: addr.port, stack };
}

async function httpRequest(port: number, path: string, opts: {
  method?: string;
  tenantId: string;
  body?: unknown;
}): Promise<{ status: number; body: any }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: opts.method ?? "GET",
    headers: { "x-tenant-id": opts.tenantId, "content-type": "application/json" },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test("event-bus wiring: POST /api/execution auto-projects execution.updated", async () => {
  const { server, port, stack } = makeServer();
  try {
    const tenant = uniqueTenant();
    const { status, body } = await httpRequest(port, "/api/execution", {
      method: "POST",
      tenantId: tenant,
      body: { actionId: "action-wire-1" },
    });
    eq(status, 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);
    const wfId = body.workflow.id;

    const projected = stack.readModelStore.getExecution(tenant, wfId);
    assert(projected, "execution should be auto-projected into the read model");
    eq(projected!.actionId, "action-wire-1");
    eq(projected!.status, "planned");
  } finally { server.close(); }
});

test("event-bus wiring: POST /api/execution/:id/transition re-projects with new status", async () => {
  const { server, port, stack } = makeServer();
  try {
    const tenant = uniqueTenant();
    const created = await httpRequest(port, "/api/execution", {
      method: "POST",
      tenantId: tenant,
      body: { actionId: "action-wire-2" },
    });
    eq(created.status, 201);
    const wfId = created.body.workflow.id;

    const transitioned = await httpRequest(port, `/api/execution/${wfId}/transition`, {
      method: "POST",
      tenantId: tenant,
      body: { toStatus: "approved", actor: "test-actor", reason: "wiring test" },
    });
    eq(transitioned.status, 200, `expected 200, got ${transitioned.status}: ${JSON.stringify(transitioned.body)}`);

    const projected = stack.readModelStore.getExecution(tenant, wfId);
    assert(projected, "execution should remain projected after transition");
    eq(projected!.status, "approved", "projection should reflect the new status");
  } finally { server.close(); }
});

test("event-bus wiring: settlement fund/release auto-project escrow.updated", async () => {
  const { server, port, stack } = makeServer();
  try {
    const tenant = uniqueTenant();

    // Set up two accounts and fund the payer so escrow funding succeeds.
    const payer = await httpRequest(port, "/api/ledger/accounts", {
      method: "POST", tenantId: tenant, body: { ownerId: "payer", type: "asset", name: "Payer" },
    });
    eq(payer.status, 201, JSON.stringify(payer.body));
    const worker = await httpRequest(port, "/api/ledger/accounts", {
      method: "POST", tenantId: tenant, body: { ownerId: "worker", type: "asset", name: "Worker" },
    });
    eq(worker.status, 201, JSON.stringify(worker.body));

    const mint = await httpRequest(port, "/api/ledger/mint", {
      method: "POST", tenantId: tenant,
      body: { toAccountId: payer.body.account.id, amount: "1000000", memo: "seed", initiatedBy: "test" },
    });
    eq(mint.status, 200, JSON.stringify(mint.body));

    const created = await httpRequest(port, "/api/settlement", {
      method: "POST", tenantId: tenant,
      body: {
        opportunityId: "opp-wire-1",
        payerAccountId: payer.body.account.id,
        workerAccountId: worker.body.account.id,
        totalAmount: "500000",
        settledBy: "test",
      },
    });
    eq(created.status, 201, JSON.stringify(created.body));
    const settlementId = created.body.agreement.id;

    // No projection yet from create (escrow.updated fires, but state is "created" — still projected)
    let projected = stack.readModelStore.getEscrow(tenant, settlementId);
    assert(projected, "escrow should be projected after create");
    eq(projected!.state, "created");

    const funded = await httpRequest(port, `/api/settlement/${settlementId}/fund`, {
      method: "POST", tenantId: tenant, body: { initiatedBy: "test" },
    });
    eq(funded.status, 200, JSON.stringify(funded.body));

    projected = stack.readModelStore.getEscrow(tenant, settlementId);
    assert(projected, "escrow should be projected after fund");
    eq(projected!.state, "held", "projection should reflect funded state");

    const released = await httpRequest(port, `/api/settlement/${settlementId}/release`, {
      method: "POST", tenantId: tenant, body: { initiatedBy: "test" },
    });
    eq(released.status, 200, JSON.stringify(released.body));

    projected = stack.readModelStore.getEscrow(tenant, settlementId);
    assert(projected, "escrow should be projected after release");
    eq(projected!.state, "released", "projection should reflect released state");
  } finally { server.close(); }
});

test("event-bus wiring: GET /api/passport/:auditId auto-projects passport.issued", async () => {
  const { server, port, stack } = makeServer();
  try {
    const tenant = uniqueTenant();

    const acct = await httpRequest(port, "/api/ledger/accounts", {
      method: "POST", tenantId: tenant, body: { ownerId: "u1", type: "asset", name: "Acct" },
    });
    eq(acct.status, 201, JSON.stringify(acct.body));

    const mint = await httpRequest(port, "/api/ledger/mint", {
      method: "POST", tenantId: tenant,
      body: { toAccountId: acct.body.account.id, amount: "100000", memo: "seed", initiatedBy: "test" },
    });
    eq(mint.status, 200, JSON.stringify(mint.body));
    const auditId = mint.body.auditId;
    assert(auditId, "mint must return an auditId");

    const passportRes = await httpRequest(port, `/api/passport/${auditId}`, {
      method: "GET", tenantId: tenant,
    });
    eq(passportRes.status, 200, JSON.stringify(passportRes.body));
    const passportId = passportRes.body.passport.passportId;

    const projected = stack.readModelStore.getPassport(tenant, passportId);
    assert(projected, "passport should be auto-projected into the read model");
    eq(projected!.tenantId, tenant);
  } finally { server.close(); }
});

test("event-bus wiring: fail-closed — broken projection store never breaks the HTTP route", async () => {
  const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  // Swap in a store whose projectExecution always throws.
  const brokenStore: any = {
    ...stack.readModelStore,
    projectExecution: () => { throw new Error("boom"); },
    projectActor: () => { throw new Error("boom"); },
  };
  (stack as any).indexerEventBus = new (stack.indexerEventBus.constructor as any)(brokenStore, () => {});

  const server = startSovereignServer(0, stack, { requireIdempotencyKey: false, rateLimit: UNLIMITED });
  server.unref();
  const addr = server.address();
  if (!addr || typeof addr !== "object") throw new Error("Server did not bind");
  const port = addr.port;

  try {
    const tenant = uniqueTenant();
    const { status, body } = await httpRequest(port, "/api/execution", {
      method: "POST",
      tenantId: tenant,
      body: { actionId: "action-wire-broken" },
    });
    eq(status, 201, `route must succeed despite broken projection store, got ${status}: ${JSON.stringify(body)}`);
    assert(body.workflow?.id, "workflow must still be created");
  } finally { server.close(); }
});

// ─── approval.decided wiring (v149) ──────────────────────────────────────────

test("event-bus wiring: POST /api/execution with approvalId emits approval.decided", async () => {
  const { server, stack, port } = makeServer();
  try {
    const tenant = uniqueTenant();
    const { status, body } = await httpRequest(port, "/api/execution", {
      method: "POST",
      tenantId: tenant,
      body: {
        actionId: "action-with-approval",
        approvalId: "appr-existing",
        riskClass: "write_safe",
        approvalClass: "auto",
        approvalOutcome: "allowed",
      },
    });
    eq(status, 201, JSON.stringify(body));

    const wfId = body.workflow.id;
    // approval should be projected into the read model
    const projected = stack.readModelStore.getApproval(tenant, "appr-existing");
    assert(projected !== null, "approval should be auto-projected");
    eq(projected!.tenantId, tenant);
    eq(projected!.actionId, "action-with-approval");
    eq(projected!.outcome, "allowed");
    eq(projected!.executionId, wfId);
  } finally { server.close(); }
});

test("event-bus wiring: POST /api/execution without approvalId does not emit approval.decided", async () => {
  const { server, stack, port } = makeServer();
  try {
    const tenant = uniqueTenant();
    const { status, body } = await httpRequest(port, "/api/execution", {
      method: "POST",
      tenantId: tenant,
      body: { actionId: "action-no-approval" },
    });
    eq(status, 201, JSON.stringify(body));

    // no approval projected (no approvalId in the request)
    const approvals = stack.readModelStore.listApprovals
      ? stack.readModelStore.listApprovals(tenant)
      : null;
    // safe check: no approval projected for this tenant
    if (Array.isArray(approvals)) {
      const forTenant = approvals.filter((a: any) => a.tenantId === tenant);
      eq(forTenant.length, 0);
    }
  } finally { server.close(); }
});
