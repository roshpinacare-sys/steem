import "../_flush.mjs";
/**
 * tests/integration/escrow-webhook-dispatch.test.ts — Escrow routes dispatch HMAC-signed webhooks.
 *
 * PURPOSE
 * -------
 * Closes the "החסר הבא #3" gap: escrow routes (sovereign-routes.ts) now dispatch
 * webhook events on state changes (created, funded, released, refunded, disputed,
 * undisputed) — same HMAC-SHA256 signing infrastructure as settlement routes.
 *
 * Coverage:
 *   • create → escrow.created callback dispatched + signed
 *   • fund   → escrow.funded   callback dispatched + signed
 *   • release → escrow.released callback dispatched + signed
 *   • refund → escrow.refunded callback dispatched + signed
 *   • dispute → escrow.disputed callback dispatched + signed
 *   • undispute → escrow.undisputed callback dispatched + signed
 *   • Server verifySignature accepts every production signature
 *   • SDK verifyWebhookSignature accepts every production signature
 *   • Cross-tenant: no webhook deliveries leak between tenants
 *   • Best-effort: failed relayer does not crash the escrow route
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
  const tenant = "escrow-wh-tenant";

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

// ─── End-to-end: escrow flow produces signed callbacks ──────────────────────

test("escrow-webhook: create dispatches escrow.created with verifiable signature", async () => {
  const { server, stack, payer, worker, call, tenant } = await setup();
  try {
    const secret = "secret-created-32-bytes-long-ok-ok";
    await call("POST", "/api/webhooks", { url: "https://hook.example.com", events: ["escrow.created"], secret });

    await call("POST", "/api/escrow", {
      opportunityId: "opp-created",
      payerAccountId: payer.id,
      workerAccountId: worker.id,
      amount: "100000",
    });

    const relayer = relayerOf(stack);
    const entry = lastDeliveryForEvent(relayer, "escrow.created");
    assert(entry, "delivery recorded for escrow.created");

    const sig = entry.delivery.headers["x-tfa-signature"];
    assert(sig, "x-tfa-signature header present");
    assert(sig.startsWith("sha256="), "signature starts with sha256=");

    assertSignatureValid(secret, entry.delivery.payload, sig, "created");
  } finally { server.close(); }
});

test("escrow-webhook: fund dispatches escrow.funded with verifiable signature", async () => {
  const { server, stack, payer, worker, call, tenant } = await setup();
  try {
    const secret = "secret-funded-32-bytes-long-ok-ok";
    await call("POST", "/api/webhooks", { url: "https://hook.example.com", events: ["escrow.funded"], secret });

    const { body: c } = await call("POST", "/api/escrow", {
      opportunityId: "opp-funded",
      payerAccountId: payer.id,
      workerAccountId: worker.id,
      amount: "200000",
    });
    await call("POST", `/api/escrow/${c.agreement.id}/fund`, { initiatedBy: "payer" });

    const relayer = relayerOf(stack);
    const entry = lastDeliveryForEvent(relayer, "escrow.funded");
    assert(entry, "delivery recorded for escrow.funded");

    const sig = entry.delivery.headers["x-tfa-signature"];
    assert(sig, "signature header present");
    assertSignatureValid(secret, entry.delivery.payload, sig, "funded");
  } finally { server.close(); }
});

test("escrow-webhook: release dispatches escrow.released with verifiable signature", async () => {
  const { server, stack, payer, worker, call, tenant } = await setup();
  try {
    const secret = "secret-released-32-bytes-long-ok";
    await call("POST", "/api/webhooks", { url: "https://hook.example.com", events: ["escrow.released"], secret });

    const { body: c } = await call("POST", "/api/escrow", {
      opportunityId: "opp-released",
      payerAccountId: payer.id,
      workerAccountId: worker.id,
      amount: "300000",
    });
    await call("POST", `/api/escrow/${c.agreement.id}/fund`, { initiatedBy: "payer" });
    await call("POST", `/api/escrow/${c.agreement.id}/release`, { initiatedBy: "payer" });

    const relayer = relayerOf(stack);
    const entry = lastDeliveryForEvent(relayer, "escrow.released");
    assert(entry, "delivery recorded for escrow.released");

    const sig = entry.delivery.headers["x-tfa-signature"];
    assert(sig, "signature header present");
    assertSignatureValid(secret, entry.delivery.payload, sig, "released");
  } finally { server.close(); }
});

test("escrow-webhook: refund dispatches escrow.refunded with verifiable signature", async () => {
  const { server, stack, payer, worker, call, tenant } = await setup();
  try {
    const secret = "secret-refunded-32-bytes-long-ok";
    await call("POST", "/api/webhooks", { url: "https://hook.example.com", events: ["escrow.refunded"], secret });

    const { body: c } = await call("POST", "/api/escrow", {
      opportunityId: "opp-refunded",
      payerAccountId: payer.id,
      workerAccountId: worker.id,
      amount: "400000",
    });
    await call("POST", `/api/escrow/${c.agreement.id}/fund`, { initiatedBy: "payer" });
    await call("POST", `/api/escrow/${c.agreement.id}/refund`, { initiatedBy: "payer" });

    const relayer = relayerOf(stack);
    const entry = lastDeliveryForEvent(relayer, "escrow.refunded");
    assert(entry, "delivery recorded for escrow.refunded");

    const sig = entry.delivery.headers["x-tfa-signature"];
    assert(sig, "signature header present");
    assertSignatureValid(secret, entry.delivery.payload, sig, "refunded");
  } finally { server.close(); }
});

test("escrow-webhook: dispute dispatches escrow.disputed with verifiable signature", async () => {
  const { server, stack, payer, worker, call, tenant } = await setup();
  try {
    const secret = "secret-disputed-32-bytes-long-ok";
    await call("POST", "/api/webhooks", { url: "https://hook.example.com", events: ["escrow.disputed"], secret });

    const { body: c } = await call("POST", "/api/escrow", {
      opportunityId: "opp-disputed",
      payerAccountId: payer.id,
      workerAccountId: worker.id,
      amount: "500000",
    });
    await call("POST", `/api/escrow/${c.agreement.id}/fund`, { initiatedBy: "payer" });
    await call("POST", `/api/escrow/${c.agreement.id}/dispute`, { initiatedBy: "worker", reason: "deliverable incomplete" });

    const relayer = relayerOf(stack);
    const entry = lastDeliveryForEvent(relayer, "escrow.disputed");
    assert(entry, "delivery recorded for escrow.disputed");

    const sig = entry.delivery.headers["x-tfa-signature"];
    assert(sig, "signature header present");
    assertSignatureValid(secret, entry.delivery.payload, sig, "disputed");
  } finally { server.close(); }
});

test("escrow-webhook: undispute dispatches escrow.undisputed with verifiable signature", async () => {
  const { server, stack, payer, worker, call, tenant } = await setup();
  try {
    const secret = "secret-undisputed-32-bytes-long-ok";
    await call("POST", "/api/webhooks", { url: "https://hook.example.com", events: ["escrow.undisputed"], secret });

    const { body: c } = await call("POST", "/api/escrow", {
      opportunityId: "opp-undisputed",
      payerAccountId: payer.id,
      workerAccountId: worker.id,
      amount: "600000",
    });
    await call("POST", `/api/escrow/${c.agreement.id}/fund`, { initiatedBy: "payer" });
    await call("POST", `/api/escrow/${c.agreement.id}/dispute`, { initiatedBy: "worker", reason: "delay" });
    await call("POST", `/api/escrow/${c.agreement.id}/undispute`, { initiatedBy: "payer" });

    const relayer = relayerOf(stack);
    const entry = lastDeliveryForEvent(relayer, "escrow.undisputed");
    assert(entry, "delivery recorded for escrow.undisputed");

    const sig = entry.delivery.headers["x-tfa-signature"];
    assert(sig, "signature header present");
    assertSignatureValid(secret, entry.delivery.payload, sig, "undisputed");
  } finally { server.close(); }
});

// ─── Tenant isolation ────────────────────────────────────────────────────────

test("escrow-webhook: webhooks do not leak across tenants", async () => {
  const { server, stack, call } = await setup();
  try {
    const secretA = "secret-a-32-bytes-long-ok-ok-ok";
    await call("POST", "/api/webhooks", { url: "https://a.example.com", events: ["escrow.released"], secret: secretA }, "tenant-a");

    const payerA = await stack.ledger.createAccount("tenant-a", "payer-a", "asset", "PayerA");
    const workerA = await stack.ledger.createAccount("tenant-a", "worker-a", "asset", "WorkerA");
    await stack.ledger.mint("tenant-a", payerA.id, 500_000n, "seed", "test", false);

    const { body: c } = await call("POST", "/api/escrow", {
      opportunityId: "opp-isol",
      payerAccountId: payerA.id,
      workerAccountId: workerA.id,
      amount: "100000",
    }, "tenant-a");
    await call("POST", `/api/escrow/${c.agreement.id}/fund`, { initiatedBy: "payer" }, "tenant-a");
    await call("POST", `/api/escrow/${c.agreement.id}/release`, { initiatedBy: "payer" }, "tenant-a");

    const relayer = relayerOf(stack);
    const deliveriesForA = relayer.deliveries.filter((d) => d.delivery.tenantId === "tenant-a");
    eq(deliveriesForA.length, 1, "exactly one delivery for tenant-a");

    const deliveriesForB = relayer.deliveries.filter((d) => d.delivery.tenantId === "tenant-b");
    eq(deliveriesForB.length, 0, "zero deliveries for tenant-b");
  } finally { server.close(); }
});

// ─── Best-effort: delivery failure must not crash route ────────────────────

test("escrow-webhook: delivery failure is swallowed, escrow route still 200", async () => {
  const { server, stack, payer, worker, call } = await setup();
  try {
    const secret = "fail-secret-32-bytes-long-ok-ok";
    await call("POST", "/api/webhooks", { url: "https://hook.example.com", events: ["escrow.released"], secret });

    relayerOf(stack).setFailNext(10);

    const { body: c } = await call("POST", "/api/escrow", {
      opportunityId: "opp-fail",
      payerAccountId: payer.id,
      workerAccountId: worker.id,
      amount: "100000",
    });
    await call("POST", `/api/escrow/${c.agreement.id}/fund`, { initiatedBy: "payer" });

    const { status, body } = await call("POST", `/api/escrow/${c.agreement.id}/release`, { initiatedBy: "payer" });
    eq(status, 200, `release must succeed despite webhook failure: ${JSON.stringify(body)}`);
    eq(body.agreement.state, "released");
  } finally { server.close(); }
});

// ─── Headers consistency ─────────────────────────────────────────────────────

test("escrow-webhook: delivery includes required headers", async () => {
  const { server, stack, payer, worker, call } = await setup();
  try {
    const secret = "header-secret-32-bytes-long-ok";
    await call("POST", "/api/webhooks", { url: "https://hook.example.com", events: ["escrow.created"], secret });

    await call("POST", "/api/escrow", {
      opportunityId: "opp-headers",
      payerAccountId: payer.id,
      workerAccountId: worker.id,
      amount: "100000",
    });

    const relayer = relayerOf(stack);
    const entry = lastDeliveryForEvent(relayer, "escrow.created");
    assert(entry, "delivery recorded");

    const h = entry.delivery.headers;
    assert(h["content-type"] === "application/json", "content-type header");
    assert(h["x-tfa-signature"], "x-tfa-signature header");
    assert(h["x-tfa-event"] === "escrow.created", "x-tfa-event header");
    assert(h["x-tfa-timestamp"], "x-tfa-timestamp header");
    assert(h["x-tfa-delivery-id"], "x-tfa-delivery-id header");
  } finally { server.close(); }
});
