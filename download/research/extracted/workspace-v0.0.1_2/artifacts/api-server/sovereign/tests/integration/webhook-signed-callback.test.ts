import "../_flush.mjs";
/**
 * tests/integration/webhook-signed-callback.test.ts — Signed webhook callbacks end-to-end.
 *
 * PURPOSE
 * -------
 * Closes the "Webhook HMAC signing מלא" gap by proving that settlement state
 * changes produce HMAC-signed webhook deliveries whose signatures are verifiable
 * by both the server verifier and the standalone SDK.
 *
 * Coverage:
 *   • create → settlement.created callback dispatched + signed
 *   • fund   → settlement.funded   callback dispatched + signed
 *   • release → settlement.released callback dispatched + signed
 *   • Server verifySignature accepts every production signature
 *   • SDK verifyWebhookSignature accepts every production signature
 *   • Tampered payload rejected by both server and SDK
 *   • Wrong secret rejected by both server and SDK
 *   • Cross-tenant: no webhook deliveries leak between tenants
 *   • Best-effort: failed relayer does not crash the settlement route
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
  const tenant = "wh-callback-tenant";

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

function assertSignatureRejected(secret: string, payload: string, signature: string, label: string) {
  const serverOk = WebhookService.verifySignature(secret, payload, signature);
  assert(!serverOk, `[${label}] server verifySignature rejected`);

  const sdkResult = verifyWebhookSignature(secret, payload, signature);
  assert(!sdkResult.ok, `[${label}] SDK verifyWebhookSignature rejected`);
}

// ─── End-to-end: settlement flow produces signed callbacks ──────────────────

test("signed-callback: create settlement dispatches settlement.created with verifiable signature", async () => {
  const { server, stack, payer, worker, call, tenant } = await setup();
  try {
    const secret = "secret-for-created-event-32-bytes";
    await call("POST", "/api/webhooks", { url: "https://hook.example.com", events: ["settlement.created"], secret });

    await call("POST", "/api/settlement", {
      opportunityId: "opp-created",
      payerAccountId: payer.id,
      workerAccountId: worker.id,
      totalAmount: "100000",
      settledBy: "auth-1",
    });

    const relayer = relayerOf(stack);
    const entry = lastDeliveryForEvent(relayer, "settlement.created");
    assert(entry, "delivery recorded for settlement.created");

    const sig = entry.delivery.headers["x-tfa-signature"];
    assert(sig, "x-tfa-signature header present");
    assert(sig.startsWith("sha256="), "signature starts with sha256=");

    assertSignatureValid(secret, entry.delivery.payload, sig, "created");
  } finally { server.close(); }
});

test("signed-callback: fund dispatches settlement.funded with verifiable signature", async () => {
  const { server, stack, payer, worker, call, tenant } = await setup();
  try {
    const secret = "secret-for-funded-event-32-bytes-ok";
    await call("POST", "/api/webhooks", { url: "https://hook.example.com", events: ["settlement.funded"], secret });

    const { body: c } = await call("POST", "/api/settlement", {
      opportunityId: "opp-funded",
      payerAccountId: payer.id,
      workerAccountId: worker.id,
      totalAmount: "200000",
      settledBy: "auth-1",
    });
    await call("POST", `/api/settlement/${c.agreement.id}/fund`, { initiatedBy: "auth-1" });

    const relayer = relayerOf(stack);
    const entry = lastDeliveryForEvent(relayer, "settlement.funded");
    assert(entry, "delivery recorded for settlement.funded");

    const sig = entry.delivery.headers["x-tfa-signature"];
    assert(sig, "signature header present");
    assertSignatureValid(secret, entry.delivery.payload, sig, "funded");
  } finally { server.close(); }
});

test("signed-callback: release dispatches settlement.released with verifiable signature", async () => {
  const { server, stack, payer, worker, call, tenant } = await setup();
  try {
    const secret = "secret-for-released-event-32-bytes";
    await call("POST", "/api/webhooks", { url: "https://hook.example.com", events: ["settlement.released"], secret });

    const { body: c } = await call("POST", "/api/settlement", {
      opportunityId: "opp-released",
      payerAccountId: payer.id,
      workerAccountId: worker.id,
      totalAmount: "300000",
      settledBy: "auth-1",
    });
    await call("POST", `/api/settlement/${c.agreement.id}/fund`, { initiatedBy: "auth-1" });
    await call("POST", `/api/settlement/${c.agreement.id}/release`, { initiatedBy: "auth-1" });

    const relayer = relayerOf(stack);
    const entry = lastDeliveryForEvent(relayer, "settlement.released");
    assert(entry, "delivery recorded for settlement.released");

    const sig = entry.delivery.headers["x-tfa-signature"];
    assert(sig, "signature header present");
    assertSignatureValid(secret, entry.delivery.payload, sig, "released");
  } finally { server.close(); }
});

// ─── Tamper detection ────────────────────────────────────────────────────────

test("signed-callback: tampered payload is rejected by server and SDK", async () => {
  const { server, stack, payer, worker, call } = await setup();
  try {
    const secret = "tamper-test-secret-32-bytes-ok";
    await call("POST", "/api/webhooks", { url: "https://hook.example.com", events: ["settlement.released"], secret });

    const { body: c } = await call("POST", "/api/settlement", {
      opportunityId: "opp-tamper",
      payerAccountId: payer.id,
      workerAccountId: worker.id,
      totalAmount: "150000",
      settledBy: "auth-1",
    });
    await call("POST", `/api/settlement/${c.agreement.id}/fund`, { initiatedBy: "auth-1" });
    await call("POST", `/api/settlement/${c.agreement.id}/release`, { initiatedBy: "auth-1" });

    const relayer = relayerOf(stack);
    const entry = lastDeliveryForEvent(relayer, "settlement.released");
    assert(entry, "delivery recorded");

    const sig = entry.delivery.headers["x-tfa-signature"];
    const originalPayload = entry.delivery.payload;
    const tamperedPayload = originalPayload.replace("released", "REPLACED");

    assertSignatureRejected(secret, tamperedPayload, sig, "tampered payload");
  } finally { server.close(); }
});

// ─── Wrong secret ─────────────────────────────────────────────────────────────

test("signed-callback: wrong secret rejects signature on both server and SDK", async () => {
  const { server, stack, payer, worker, call } = await setup();
  try {
    const secret = "right-secret-32-bytes-long-ok-ok";
    await call("POST", "/api/webhooks", { url: "https://hook.example.com", events: ["settlement.funded"], secret });

    const { body: c } = await call("POST", "/api/settlement", {
      opportunityId: "opp-wrong",
      payerAccountId: payer.id,
      workerAccountId: worker.id,
      totalAmount: "100000",
      settledBy: "auth-1",
    });
    await call("POST", `/api/settlement/${c.agreement.id}/fund`, { initiatedBy: "auth-1" });

    const relayer = relayerOf(stack);
    const entry = lastDeliveryForEvent(relayer, "settlement.funded");
    assert(entry, "delivery recorded");

    const sig = entry.delivery.headers["x-tfa-signature"];
    assertSignatureRejected("wrong-secret-32-bytes-long-ok-ok", entry.delivery.payload, sig, "wrong secret");
  } finally { server.close(); }
});

// ─── Tenant isolation ────────────────────────────────────────────────────────

test("signed-callback: webhooks do not leak across tenants", async () => {
  const { server, stack, call } = await setup();
  try {
    const secretA = "secret-a-32-bytes-long-ok-ok-ok";
    await call("POST", "/api/webhooks", { url: "https://a.example.com", events: ["settlement.released"], secret: secretA }, "tenant-a");

    // Create accounts for tenant-a (setup() creates them for the default tenant)
    const payerA = await stack.ledger.createAccount("tenant-a", "payer-a", "asset", "PayerA");
    const workerA = await stack.ledger.createAccount("tenant-a", "worker-a", "asset", "WorkerA");
    await stack.ledger.mint("tenant-a", payerA.id, 500_000n, "seed", "test", false);

    const { body: c } = await call("POST", "/api/settlement", {
      opportunityId: "opp-isol",
      payerAccountId: payerA.id,
      workerAccountId: workerA.id,
      totalAmount: "100000",
      settledBy: "auth-1",
    }, "tenant-a");
    await call("POST", `/api/settlement/${c.agreement.id}/fund`, { initiatedBy: "auth-1" }, "tenant-a");
    await call("POST", `/api/settlement/${c.agreement.id}/release`, { initiatedBy: "auth-1" }, "tenant-a");

    const relayer = relayerOf(stack);
    const deliveriesForA = relayer.deliveries.filter((d) => d.delivery.tenantId === "tenant-a");
    eq(deliveriesForA.length, 1, "exactly one delivery for tenant-a");

    const deliveriesForB = relayer.deliveries.filter((d) => d.delivery.tenantId === "tenant-b");
    eq(deliveriesForB.length, 0, "zero deliveries for tenant-b");
  } finally { server.close(); }
});

// ─── Best-effort: delivery failure must not crash route ────────────────────

test("signed-callback: delivery failure is swallowed, settlement route still 200", async () => {
  const { server, stack, payer, worker, call } = await setup();
  try {
    const secret = "fail-secret-32-bytes-long-ok-ok";
    await call("POST", "/api/webhooks", { url: "https://hook.example.com", events: ["settlement.released"], secret });

    // Force the next delivery to fail
    relayerOf(stack).setFailNext(10);

    const { body: c } = await call("POST", "/api/settlement", {
      opportunityId: "opp-fail",
      payerAccountId: payer.id,
      workerAccountId: worker.id,
      totalAmount: "100000",
      settledBy: "auth-1",
    });
    await call("POST", `/api/settlement/${c.agreement.id}/fund`, { initiatedBy: "auth-1" });

    const { status, body } = await call("POST", `/api/settlement/${c.agreement.id}/release`, { initiatedBy: "auth-1" });
    eq(status, 200, `release must succeed despite webhook failure: ${JSON.stringify(body)}`);
    eq(body.agreement.state, "released");
  } finally { server.close(); }
});

// ─── Headers consistency ─────────────────────────────────────────────────────

test("signed-callback: delivery includes required headers", async () => {
  const { server, stack, payer, worker, call } = await setup();
  try {
    const secret = "header-secret-32-bytes-long-ok";
    await call("POST", "/api/webhooks", { url: "https://hook.example.com", events: ["settlement.created"], secret });

    await call("POST", "/api/settlement", {
      opportunityId: "opp-headers",
      payerAccountId: payer.id,
      workerAccountId: worker.id,
      totalAmount: "100000",
      settledBy: "auth-1",
    });

    const relayer = relayerOf(stack);
    const entry = lastDeliveryForEvent(relayer, "settlement.created");
    assert(entry, "delivery recorded");

    const h = entry.delivery.headers;
    assert(h["content-type"] === "application/json", "content-type header");
    assert(h["x-tfa-signature"], "x-tfa-signature header");
    assert(h["x-tfa-event"] === "settlement.created", "x-tfa-event header");
    assert(h["x-tfa-timestamp"], "x-tfa-timestamp header");
    assert(h["x-tfa-delivery-id"], "x-tfa-delivery-id header");
  } finally { server.close(); }
});
