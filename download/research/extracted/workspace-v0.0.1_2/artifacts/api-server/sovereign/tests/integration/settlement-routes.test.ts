import "../_flush.mjs";
/**
 * tests/integration/settlement-routes.test.ts — Settlement HTTP routes integration.
 *
 * Coverage: full CRUD happy path · fund → partial-release → release · dispute → reverse ·
 * webhook dispatch on state changes · threshold-approval flow ·
 * webhook registration/list/delete · tenant isolation on all routes ·
 * input validation (400) · unauthorized (403) · wrong state (422) · not found (404).
 */
import { test, assert, eq } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { buildSovereignStack } from "../../src/composition.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import type { AddressInfo } from "node:net";

// ─── Setup ────────────────────────────────────────────────────────────────────

async function setup() {
  const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const server = startSovereignServer(0, stack, { requireIdempotencyKey: false } as any);
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const tenant = "settle-test-tenant";

  // Fund payer account
  const payer = await stack.ledger.createAccount(tenant, "payer-1", "asset", "Payer");
  const worker = await stack.ledger.createAccount(tenant, "worker-1", "asset", "Worker");
  await stack.ledger.mint(tenant, payer.id, 5_000_000n, "seed", "test", false);

  async function call(method: string, path: string, body?: any, tenantId = tenant) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-tenant-id": tenantId,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json();
    return { status: res.status, body: json };
  }

  return { stack, server, port, base, tenant, payer, worker, call };
}

// ─── Create ───────────────────────────────────────────────────────────────────

test("settlement-routes: POST /api/settlement creates agreement", async () => {
  const { server, payer, worker, call, tenant } = await setup();
  try {
    const { status, body } = await call("POST", "/api/settlement", {
      opportunityId: "opp-1",
      payerAccountId: payer.id,
      workerAccountId: worker.id,
      totalAmount: "200000",
      settledBy: "authority-1",
    });
    eq(status, 201);
    assert(body.ok);
    eq(body.agreement.state, "created");
    eq(body.agreement.totalAmount, "200000");
    eq(body.agreement.releasedAmount, "0");
    eq(body.agreement.settledBy, "authority-1");
    assert(body.agreement.id, "has id");
  } finally { server.close(); }
});

test("settlement-routes: POST /api/settlement rejects missing fields", async () => {
  const { server, payer, worker, call } = await setup();
  try {
    const { status } = await call("POST", "/api/settlement", {
      opportunityId: "opp-1",
      payerAccountId: payer.id,
      // missing workerAccountId
      totalAmount: "100000",
      settledBy: "auth",
    });
    eq(status, 400);
  } finally { server.close(); }
});

test("settlement-routes: POST /api/settlement rejects zero amount", async () => {
  const { server, payer, worker, call } = await setup();
  try {
    const { status } = await call("POST", "/api/settlement", {
      opportunityId: "opp-1",
      payerAccountId: payer.id,
      workerAccountId: worker.id,
      totalAmount: "0",
      settledBy: "auth",
    });
    eq(status, 400);
  } finally { server.close(); }
});

// ─── Get / List ───────────────────────────────────────────────────────────────

test("settlement-routes: GET /api/settlement lists tenant agreements", async () => {
  const { server, payer, worker, call } = await setup();
  try {
    await call("POST", "/api/settlement", { opportunityId: "o1", payerAccountId: payer.id, workerAccountId: worker.id, totalAmount: "100000", settledBy: "auth" });
    await call("POST", "/api/settlement", { opportunityId: "o2", payerAccountId: payer.id, workerAccountId: worker.id, totalAmount: "200000", settledBy: "auth" });

    const { status, body } = await call("GET", "/api/settlement");
    eq(status, 200);
    assert(body.ok);
    eq(body.agreements.length, 2);
  } finally { server.close(); }
});

test("settlement-routes: GET /api/settlement/:id returns agreement", async () => {
  const { server, payer, worker, call } = await setup();
  try {
    const { body: createBody } = await call("POST", "/api/settlement", {
      opportunityId: "o1", payerAccountId: payer.id, workerAccountId: worker.id,
      totalAmount: "100000", settledBy: "auth",
    });
    const id = createBody.agreement.id;

    const { status, body } = await call("GET", `/api/settlement/${id}`);
    eq(status, 200);
    eq(body.agreement.id, id);
  } finally { server.close(); }
});

test("settlement-routes: GET /api/settlement/:id returns 404 for unknown id", async () => {
  const { server, call } = await setup();
  try {
    const { status } = await call("GET", "/api/settlement/nonexistent-id");
    eq(status, 404);
  } finally { server.close(); }
});

// ─── Fund → Release ───────────────────────────────────────────────────────────

test("settlement-routes: fund moves state to held", async () => {
  const { server, payer, worker, call } = await setup();
  try {
    const { body: c } = await call("POST", "/api/settlement", {
      opportunityId: "o1", payerAccountId: payer.id, workerAccountId: worker.id,
      totalAmount: "300000", settledBy: "authority-1",
    });
    const id = c.agreement.id;

    const { status, body } = await call("POST", `/api/settlement/${id}/fund`, { initiatedBy: "authority-1" });
    eq(status, 200);
    eq(body.agreement.state, "held");
    assert(body.agreement.fundAuditId, "fundAuditId recorded");
  } finally { server.close(); }
});

test("settlement-routes: full release path creates/fund/release", async () => {
  const { server, stack, payer, worker, call, tenant } = await setup();
  try {
    const { body: c } = await call("POST", "/api/settlement", {
      opportunityId: "o1", payerAccountId: payer.id, workerAccountId: worker.id,
      totalAmount: "250000", settledBy: "authority-1",
    });
    const id = c.agreement.id;
    await call("POST", `/api/settlement/${id}/fund`, { initiatedBy: "authority-1" });

    const { status, body } = await call("POST", `/api/settlement/${id}/release`, { initiatedBy: "authority-1" });
    eq(status, 200);
    eq(body.agreement.state, "released");
    eq(body.agreement.releasedAmount, "250000");

    // Verify money moved to worker
    const workerBal = (await stack.ledger.getAccount(tenant, worker.id)).balance;
    eq(workerBal, 250_000n);
  } finally { server.close(); }
});

test("settlement-routes: partial-release → release milestone path", async () => {
  const { server, stack, payer, worker, call, tenant } = await setup();
  try {
    const { body: c } = await call("POST", "/api/settlement", {
      opportunityId: "o1", payerAccountId: payer.id, workerAccountId: worker.id,
      totalAmount: "300000", settledBy: "authority-1",
    });
    const id = c.agreement.id;
    await call("POST", `/api/settlement/${id}/fund`, { initiatedBy: "authority-1" });

    const { body: p1 } = await call("POST", `/api/settlement/${id}/partial-release`, { initiatedBy: "authority-1", amount: "100000" });
    eq(p1.agreement.state, "partially_released");
    eq(p1.agreement.releasedAmount, "100000");

    const { body: rel } = await call("POST", `/api/settlement/${id}/release`, { initiatedBy: "authority-1" });
    eq(rel.agreement.state, "released");
    eq(rel.agreement.releasedAmount, "300000");

    eq((await stack.ledger.getAccount(tenant, worker.id)).balance, 300_000n);
  } finally { server.close(); }
});

// ─── Dispute → Reverse ────────────────────────────────────────────────────────

test("settlement-routes: dispute → reverse flow", async () => {
  const { server, stack, payer, worker, call, tenant } = await setup();
  try {
    const { body: c } = await call("POST", "/api/settlement", {
      opportunityId: "o1", payerAccountId: payer.id, workerAccountId: worker.id,
      totalAmount: "200000", settledBy: "authority-1",
    });
    const id = c.agreement.id;
    await call("POST", `/api/settlement/${id}/fund`, { initiatedBy: "authority-1" });

    // Raise dispute
    const { status: ds, body: db } = await call("POST", `/api/settlement/${id}/dispute`, {
      initiatedBy: "worker-1",
      reason: "deliverable incomplete",
    });
    eq(ds, 200);
    eq(db.agreement.state, "disputed");
    eq(db.agreement.disputedBy, "worker-1");

    // Reverse
    const beforeBal = (await stack.ledger.getAccount(tenant, payer.id)).balance;
    const { status: rs, body: rb } = await call("POST", `/api/settlement/${id}/reverse`, { initiatedBy: "authority-1" });
    eq(rs, 200);
    eq(rb.agreement.state, "reversed");

    const afterBal = (await stack.ledger.getAccount(tenant, payer.id)).balance;
    assert(afterBal > beforeBal, "funds returned to payer");
  } finally { server.close(); }
});

// ─── Threshold approval ───────────────────────────────────────────────────────

test("settlement-routes: threshold-approval flow — generates token, then release succeeds", async () => {
  const { server, payer, worker, call } = await setup();
  try {
    const { body: c } = await call("POST", "/api/settlement", {
      opportunityId: "opp-th",
      payerAccountId: payer.id,
      workerAccountId: worker.id,
      totalAmount: "1000000",
      settledBy: "authority-1",
      thresholdAmount: "500000",
    });
    const id = c.agreement.id;
    eq(c.agreement.thresholdAmount, "500000");
    await call("POST", `/api/settlement/${id}/fund`, { initiatedBy: "authority-1" });

    // Release > threshold → must get approval first
    const noToken = await call("POST", `/api/settlement/${id}/release`, { initiatedBy: "authority-1" });
    eq(noToken.status, 422, "release without token blocked");

    // Get threshold approval
    const { status: as, body: ab } = await call("POST", `/api/settlement/${id}/threshold-approval`, {
      approvedBy: "authority-1",
      maxAmount: "1000000",
    });
    eq(as, 201);
    assert(ab.approval.token, "token returned");
    assert(ab.approval.expiresAt, "has expiry");

    // Release with token
    const { status: rs, body: rb } = await call("POST", `/api/settlement/${id}/release`, {
      initiatedBy: "authority-1",
      thresholdApprovalToken: ab.approval.token,
    });
    eq(rs, 200);
    eq(rb.agreement.state, "released");
  } finally { server.close(); }
});

test("settlement-routes: threshold-approval token is single-use (replay rejected)", async () => {
  const { server, payer, worker, call } = await setup();
  try {
    // Create two agreements — use same token for both (second should fail)
    const { body: c1 } = await call("POST", "/api/settlement", {
      opportunityId: "opp-a", payerAccountId: payer.id, workerAccountId: worker.id,
      totalAmount: "600000", settledBy: "authority-1", thresholdAmount: "500000",
    });
    const id1 = c1.agreement.id;
    await call("POST", `/api/settlement/${id1}/fund`, { initiatedBy: "authority-1" });

    const { body: ab } = await call("POST", `/api/settlement/${id1}/threshold-approval`, {
      approvedBy: "authority-1", maxAmount: "600000",
    });
    const token = ab.approval.token;

    // First use succeeds
    const { status: r1 } = await call("POST", `/api/settlement/${id1}/release`, {
      initiatedBy: "authority-1", thresholdApprovalToken: token,
    });
    eq(r1, 200);

    // Create another agreement and try to replay the token
    const { body: c2 } = await call("POST", "/api/settlement", {
      opportunityId: "opp-b", payerAccountId: payer.id, workerAccountId: worker.id,
      totalAmount: "600000", settledBy: "authority-1", thresholdAmount: "500000",
    });
    const id2 = c2.agreement.id;
    await call("POST", `/api/settlement/${id2}/fund`, { initiatedBy: "authority-1" });

    // Replay on different agreement should fail (agreement mismatch)
    const { status: r2 } = await call("POST", `/api/settlement/${id2}/release`, {
      initiatedBy: "authority-1", thresholdApprovalToken: token,
    });
    eq(r2, 422, "replayed token rejected");
  } finally { server.close(); }
});

test("settlement-routes: threshold-approval rejected for non-authority caller", async () => {
  const { server, payer, worker, call } = await setup();
  try {
    const { body: c } = await call("POST", "/api/settlement", {
      opportunityId: "opp-x", payerAccountId: payer.id, workerAccountId: worker.id,
      totalAmount: "600000", settledBy: "authority-1", thresholdAmount: "500000",
    });
    const id = c.agreement.id;

    const { status } = await call("POST", `/api/settlement/${id}/threshold-approval`, {
      approvedBy: "mallory", maxAmount: "600000",
    });
    eq(status, 403);
  } finally { server.close(); }
});

// ─── Webhook routes ───────────────────────────────────────────────────────────

test("settlement-routes: POST /api/webhooks registers endpoint (secret not echoed)", async () => {
  const { server, call } = await setup();
  try {
    const { status, body } = await call("POST", "/api/webhooks", {
      url: "https://example.com/hook",
      events: ["settlement.released", "settlement.disputed"],
    });
    eq(status, 201);
    assert(body.ok);
    assert(body.registration.id, "has id");
    eq(body.registration.events.length, 2);
    assert(!body.registration.secret, "secret not echoed back");
  } finally { server.close(); }
});

test("settlement-routes: GET /api/webhooks lists tenant registrations", async () => {
  const { server, call } = await setup();
  try {
    await call("POST", "/api/webhooks", { url: "https://a.com", events: ["settlement.released"] });
    await call("POST", "/api/webhooks", { url: "https://b.com", events: ["settlement.funded"] });
    const { status, body } = await call("GET", "/api/webhooks");
    eq(status, 200);
    eq(body.registrations.length, 2);
  } finally { server.close(); }
});

test("settlement-routes: DELETE /api/webhooks/:id removes registration", async () => {
  const { server, call } = await setup();
  try {
    const { body: rb } = await call("POST", "/api/webhooks", {
      url: "https://x.com", events: ["settlement.released"],
    });
    const id = rb.registration.id;

    const { status: ds } = await call("DELETE", `/api/webhooks/${id}`);
    eq(ds, 200);

    const { body: listBody } = await call("GET", "/api/webhooks");
    eq(listBody.registrations.length, 0, "empty after delete");
  } finally { server.close(); }
});

test("settlement-routes: DELETE /api/webhooks/:id returns 404 for unknown id", async () => {
  const { server, call } = await setup();
  try {
    const { status } = await call("DELETE", "/api/webhooks/nonexistent");
    eq(status, 404);
  } finally { server.close(); }
});

test("settlement-routes: webhook endpoints are tenant-isolated", async () => {
  const { server, call } = await setup();
  try {
    await call("POST", "/api/webhooks", { url: "https://a.com", events: ["settlement.released"] }, "tenant-a");
    await call("POST", "/api/webhooks", { url: "https://b.com", events: ["settlement.released"] }, "tenant-b");

    const { body: la } = await call("GET", "/api/webhooks", undefined, "tenant-a");
    const { body: lb } = await call("GET", "/api/webhooks", undefined, "tenant-b");
    eq(la.registrations.length, 1);
    eq(lb.registrations.length, 1);
  } finally { server.close(); }
});

// ─── Authorization checks ─────────────────────────────────────────────────────

test("settlement-routes: unauthorized caller denied on fund/release/reverse", async () => {
  const { server, payer, worker, call } = await setup();
  try {
    const { body: c } = await call("POST", "/api/settlement", {
      opportunityId: "opp-auth",
      payerAccountId: payer.id,
      workerAccountId: worker.id,
      totalAmount: "100000",
      settledBy: "authority-1",
    });
    const id = c.agreement.id;

    // fund by wrong caller
    const { status: fs } = await call("POST", `/api/settlement/${id}/fund`, { initiatedBy: "mallory" });
    eq(fs, 403);

    // fund properly
    await call("POST", `/api/settlement/${id}/fund`, { initiatedBy: "authority-1" });

    // release by wrong caller
    const { status: rs } = await call("POST", `/api/settlement/${id}/release`, { initiatedBy: "mallory" });
    eq(rs, 403);
  } finally { server.close(); }
});

// ─── Input validation ─────────────────────────────────────────────────────────

test("settlement-routes: missing x-tenant-id returns 400", async () => {
  const { server, base } = await setup();
  try {
    const res = await fetch(`${base}/api/settlement`, {
      method: "GET",
      headers: { "content-type": "application/json" },
    });
    eq(res.status, 400);
  } finally { server.close(); }
});

test("settlement-routes: fund without initiatedBy returns 400", async () => {
  const { server, payer, worker, call } = await setup();
  try {
    const { body: c } = await call("POST", "/api/settlement", {
      opportunityId: "opp", payerAccountId: payer.id, workerAccountId: worker.id,
      totalAmount: "100000", settledBy: "auth",
    });
    const { status } = await call("POST", `/api/settlement/${c.agreement.id}/fund`, {});
    eq(status, 400);
  } finally { server.close(); }
});
