import "../_flush.mjs";
/**
 * tests/integration/passport-dispute-webhook-dispatch.test.ts —
 * passport.issued and dispute.opened events dispatch HMAC-signed webhooks.
 *
 * Covers the "החסר הבא #1" sub-step: ensure ALL specified callbacks
 * (escrow.released, dispute.opened, passport.issued) are HMAC-signed.
 *
 * Coverage:
 *   • GET /api/passport/:auditId → passport.issued callback dispatched + signed
 *   • POST /api/escrow/:id/dispute → dispute.opened callback dispatched + signed
 *   • Server verifySignature + SDK verifyWebhookSignature accept production signatures
 *   • Cross-tenant: no webhook deliveries leak between tenants
 *   • Best-effort: failed relayer does not crash the route
 */

import { test, assert, eq } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { buildSovereignStack } from "../../src/composition.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import { WebhookService, InMemoryWebhookRelayer } from "../../lib/escrow/webhook.ts";
import { verifyWebhookSignature } from "../../sdk/escrow-client/verify-webhook.mjs";
import type { AddressInfo } from "node:net";

// ─── Setup ────────────────────────────────────────────────────────────────────

async function setup() {
  const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const server = startSovereignServer(0, stack, { requireIdempotencyKey: false } as any);
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const tenant = "pd-wh-tenant";

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function relayerOf(stack: ReturnType<typeof buildSovereignStack>): InMemoryWebhookRelayer {
  return stack.webhookRelayer as InMemoryWebhookRelayer;
}

function lastDeliveryForEvent(relayer: InMemoryWebhookRelayer, eventType: string) {
  const found = relayer.deliveries
    .slice()
    .reverse()
    .find((d) => d.delivery.event === eventType);
  return found ?? null;
}

function assertSignatureValid(secret: string, payload: string, signature: string, label: string) {
  const serverOk = WebhookService.verifySignature(secret, payload, signature);
  assert(serverOk, `[${label}] server verifySignature accepted`);

  const sdkResult = verifyWebhookSignature(secret, payload, signature);
  assert(sdkResult.ok, `[${label}] SDK verifyWebhookSignature accepted: ${sdkResult.reason ?? ""}`);
}

// ─── passport.issued webhook dispatch ────────────────────────────────────────

test("passport-webhook: GET /api/passport/:auditId dispatches passport.issued with verifiable signature", async () => {
  const { server, stack, payer, call, tenant } = await setup();
  try {
    const secret = "secret-passport-32-bytes-long-ok";
    await call("POST", "/api/webhooks", { url: "https://hook.example.com", events: ["passport.issued"], secret });

    // Perform a mint to generate an audit record
    const mintRes = await call("POST", "/api/ledger/mint", { toAccountId: payer.id, amount: "100000", memo: "test", initiatedBy: "api" });
    eq(mintRes.status, 200, `mint failed: ${JSON.stringify(mintRes.body)}`);
    const auditId = mintRes.body.auditId;
    assert(auditId, "auditId present in mint response");

    // Issue passport — this triggers passport.issued webhook
    const passportRes = await call("GET", `/api/passport/${auditId}`);
    eq(passportRes.status, 200, `passport issuance failed: ${JSON.stringify(passportRes.body)}`);
    assert(passportRes.body.passport, "passport present in response");

    const relayer = relayerOf(stack);
    const entry = lastDeliveryForEvent(relayer, "passport.issued");
    assert(entry, "delivery recorded for passport.issued");

    const sig = entry.delivery.headers["x-tfa-signature"];
    assert(sig, "x-tfa-signature header present");
    assert(sig.startsWith("sha256="), "signature starts with sha256=");

    assertSignatureValid(secret, entry.delivery.payload, sig, "passport.issued");

    // Payload must contain the passport
    const parsed = JSON.parse(entry.delivery.payload);
    assert(parsed.data?.passport, "payload contains passport");
    eq(parsed.data.passport.passportId, passportRes.body.passport.passportId, "passportId matches");
  } finally { server.close(); }
});

// ─── dispute.opened webhook dispatch ─────────────────────────────────────────

test("dispute-webhook: POST /api/escrow/:id/dispute dispatches dispute.opened with verifiable signature", async () => {
  const { server, stack, payer, worker, call, tenant } = await setup();
  try {
    const secret = "secret-dispute-32-bytes-long-ok";
    await call("POST", "/api/webhooks", { url: "https://hook.example.com", events: ["dispute.opened"], secret });

    const { body: c } = await call("POST", "/api/escrow", {
      opportunityId: "opp-dispute",
      payerAccountId: payer.id,
      workerAccountId: worker.id,
      amount: "300000",
    });
    await call("POST", `/api/escrow/${c.agreement.id}/fund`, { initiatedBy: "payer" });
    await call("POST", `/api/escrow/${c.agreement.id}/dispute`, { initiatedBy: "worker", reason: "deliverable incomplete" });

    const relayer = relayerOf(stack);
    const entry = lastDeliveryForEvent(relayer, "dispute.opened");
    assert(entry, "delivery recorded for dispute.opened");

    const sig = entry.delivery.headers["x-tfa-signature"];
    assert(sig, "signature header present");
    assertSignatureValid(secret, entry.delivery.payload, sig, "dispute.opened");

    // Payload must contain the agreement
    const parsed = JSON.parse(entry.delivery.payload);
    assert(parsed.data?.amount, "payload contains agreement amount");
    eq(parsed.data.state, "disputed", "agreement state is disputed");
  } finally { server.close(); }
});

// ─── Tenant isolation ──────────────────────────────────────────────────────────

test("passport-dispute-webhook: webhooks do not leak across tenants", async () => {
  const { server, stack, payer, call } = await setup();
  try {
    const secretA = "secret-a-32-bytes-long-ok-ok-ok";
    await call("POST", "/api/webhooks", { url: "https://a.example.com", events: ["passport.issued", "dispute.opened"], secret: secretA }, "tenant-a");

    const payerA = await stack.ledger.createAccount("tenant-a", "payer-a", "asset", "PayerA");
    await stack.ledger.mint("tenant-a", payerA.id, 500_000n, "seed", "test", false);

    const mintRes = await call("POST", "/api/ledger/mint", { toAccountId: payerA.id, amount: "100000", memo: "test", initiatedBy: "api" }, "tenant-a");
    eq(mintRes.status, 200);
    const auditId = mintRes.body.auditId;
    await call("GET", `/api/passport/${auditId}`, undefined, "tenant-a");

    const relayer = relayerOf(stack);
    const deliveriesForA = relayer.deliveries.filter((d) => d.delivery.tenantId === "tenant-a");
    eq(deliveriesForA.length, 1, "exactly one delivery for tenant-a");

    const deliveriesForB = relayer.deliveries.filter((d) => d.delivery.tenantId === "tenant-b");
    eq(deliveriesForB.length, 0, "zero deliveries for tenant-b");
  } finally { server.close(); }
});

// ─── Best-effort: delivery failure must not crash route ────────────────────

test("passport-webhook: delivery failure is swallowed, passport route still 200", async () => {
  const { server, stack, payer, call } = await setup();
  try {
    const secret = "fail-secret-32-bytes-long-ok-ok";
    await call("POST", "/api/webhooks", { url: "https://hook.example.com", events: ["passport.issued"], secret });

    relayerOf(stack).setFailNext(10);

    const mintRes = await call("POST", "/api/ledger/mint", { toAccountId: payer.id, amount: "100000", memo: "test", initiatedBy: "api" });
    eq(mintRes.status, 200);
    const auditId = mintRes.body.auditId;

    const { status, body } = await call("GET", `/api/passport/${auditId}`);
    eq(status, 200, `passport route must succeed despite webhook delivery failure: ${JSON.stringify(body)}`);
    assert(body.passport, "passport returned");
  } finally { server.close(); }
});

test("dispute-webhook: delivery failure is swallowed, dispute route still 200", async () => {
  const { server, stack, payer, worker, call } = await setup();
  try {
    const secret = "fail-secret-32-bytes-long-ok-ok";
    await call("POST", "/api/webhooks", { url: "https://hook.example.com", events: ["dispute.opened"], secret });

    relayerOf(stack).setFailNext(10);

    const { body: c } = await call("POST", "/api/escrow", {
      opportunityId: "opp-fail",
      payerAccountId: payer.id,
      workerAccountId: worker.id,
      amount: "200000",
    });
    await call("POST", `/api/escrow/${c.agreement.id}/fund`, { initiatedBy: "payer" });

    const { status, body } = await call("POST", `/api/escrow/${c.agreement.id}/dispute`, { initiatedBy: "worker", reason: "delay" });
    eq(status, 200, `dispute route must succeed despite webhook delivery failure: ${JSON.stringify(body)}`);
    assert(body.ok, "dispute ok");
  } finally { server.close(); }
});
