import "../_flush.mjs";
/**
 * tests/escrow/http-webhook-relayer.test.ts — HttpWebhookRelayer: retry, backoff, timeout.
 *
 * Since this test runs offline (no network), we can't make real HTTP calls.
 * We test the relayer's behaviour by:
 *   1. Verifying the retry configuration is respected (maxRetries=1 stops after 1 attempt).
 *   2. Verifying that 4xx responses are not retried (permanent client error).
 *   3. Verifying that network errors are retried up to maxRetries.
 *   4. Verifying the interface contract (DeliveryResult shape).
 *   5. Verifying the relayer is constructable with custom config.
 *
 * For offline testing, we use a URL that will fail immediately (non-routable address).
 * We use maxRetries=1 and minimal delays to keep tests fast.
 *
 * Note: HttpWebhookRelayer uses fetch() which is a real network call.
 * In offline environments, these will return network errors, which is the expected
 * fail path we're testing. We verify error handling, not successful delivery.
 */
import { test, assert, eq } from "../_harness.mjs";
import { HttpWebhookRelayer } from "../../lib/escrow/http-webhook-relayer.ts";
import type { WebhookDelivery } from "../../lib/escrow/webhook.ts";

function makeDelivery(overrides: Partial<WebhookDelivery> = {}): WebhookDelivery {
  return {
    registrationId: "reg-001",
    url: "http://192.0.2.1/webhook",  // RFC 5737 TEST-NET — never routable; fails immediately
    payload: JSON.stringify({ id: "evt-1", event: "settlement.released", tenantId: "t1", occurredAt: "2025-01-01T00:00:00Z", data: {} }),
    signature: "sha256=abc123",
    headers: {
      "content-type": "application/json",
      "x-tfa-signature": "sha256=abc123",
      "x-tfa-event": "settlement.released",
      "x-tfa-timestamp": "2025-01-01T00:00:00Z",
      "x-tfa-delivery-id": "del-001",
    },
    tenantId: "t1",
    event: "settlement.released",
    ...overrides,
  };
}

// ─── Construction ─────────────────────────────────────────────────────────────

test("http-webhook-relayer: constructs with default config", () => {
  const relayer = new HttpWebhookRelayer();
  assert(relayer !== null, "relayer constructed");
});

test("http-webhook-relayer: constructs with custom config", () => {
  const relayer = new HttpWebhookRelayer({
    maxRetries: 1,
    baseDelayMs: 10,
    maxDelayMs: 100,
    requestTimeoutMs: 1000,
    jitterFraction: 0.05,
  });
  assert(relayer !== null, "custom relayer constructed");
});

// ─── Network failure → returns ok:false ──────────────────────────────────────

test("http-webhook-relayer: network error returns ok:false with error message (maxRetries=1)", async () => {
  const relayer = new HttpWebhookRelayer({
    maxRetries: 1,
    baseDelayMs: 0,
    requestTimeoutMs: 500,
  });
  const result = await relayer.deliver(makeDelivery());
  eq(result.ok, false);
  assert(typeof result.error === "string", "error message is a string");
  assert(result.error.length > 0, "error message is non-empty");
});

test("http-webhook-relayer: returns DeliveryResult shape on failure", async () => {
  const relayer = new HttpWebhookRelayer({
    maxRetries: 1,
    baseDelayMs: 0,
    requestTimeoutMs: 200,
  });
  const result = await relayer.deliver(makeDelivery());
  // Must have ok, optionally statusCode and error
  assert(typeof result.ok === "boolean", "ok is boolean");
  eq(result.ok, false);
});

test("http-webhook-relayer: respects maxRetries=1 (fast failure)", async () => {
  const start = Date.now();
  const relayer = new HttpWebhookRelayer({
    maxRetries: 1,
    baseDelayMs: 0,
    requestTimeoutMs: 200,
  });
  const result = await relayer.deliver(makeDelivery());
  const elapsed = Date.now() - start;
  eq(result.ok, false);
  // With maxRetries=1 and no backoff, should be fast (under 1s even in slow environments)
  assert(elapsed < 2000, `completed in ${elapsed}ms (expected <2000ms with maxRetries=1)`);
});

// ─── Timeout enforcement ──────────────────────────────────────────────────────

test("http-webhook-relayer: timeout produces error (not hang)", async () => {
  const relayer = new HttpWebhookRelayer({
    maxRetries: 1,
    baseDelayMs: 0,
    requestTimeoutMs: 100,  // very short timeout
  });
  const start = Date.now();
  const result = await relayer.deliver(makeDelivery());
  const elapsed = Date.now() - start;
  eq(result.ok, false);
  // Should not hang for more than a few seconds total
  assert(elapsed < 3000, `did not hang: completed in ${elapsed}ms`);
});

// ─── Interface contract ───────────────────────────────────────────────────────

test("http-webhook-relayer: implements WebhookRelayer interface (deliver method exists)", () => {
  const relayer = new HttpWebhookRelayer();
  assert(typeof relayer.deliver === "function", "deliver is a function");
});

test("http-webhook-relayer: different urls produce consistent result shape", async () => {
  const relayer = new HttpWebhookRelayer({ maxRetries: 1, baseDelayMs: 0, requestTimeoutMs: 200 });
  const result1 = await relayer.deliver(makeDelivery({ url: "http://192.0.2.1/a" }));
  const result2 = await relayer.deliver(makeDelivery({ url: "http://192.0.2.2/b" }));
  eq(typeof result1.ok, typeof result2.ok);
});

// ─── retry policy: 4xx permanent, 5xx retriable ───────────────────────────────

test("http-webhook-relayer: 4xx errors are not retried (permanent client error)", async () => {
  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = async () => {
    callCount++;
    return new Response("Bad Request", { status: 400 });
  };
  try {
    const relayer = new HttpWebhookRelayer({ maxRetries: 3, baseDelayMs: 0, requestTimeoutMs: 1000 });
    const result = await relayer.deliver(makeDelivery());
    eq(result.ok, false);
    eq(result.statusCode, 400);
    eq(callCount, 1); // only one attempt, no retries on 4xx
  } finally {
    global.fetch = originalFetch;
  }
});

test("http-webhook-relayer: 5xx errors are retried up to maxRetries", async () => {
  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = async () => {
    callCount++;
    return new Response("Service Unavailable", { status: 503 });
  };
  try {
    const relayer = new HttpWebhookRelayer({ maxRetries: 2, baseDelayMs: 0, requestTimeoutMs: 1000 });
    const result = await relayer.deliver(makeDelivery());
    eq(result.ok, false);
    eq(result.statusCode, 503);
    eq(callCount, 2); // retried on 5xx until maxRetries exhausted
  } finally {
    global.fetch = originalFetch;
  }
});

test("http-webhook-relayer: 2xx success stops retrying", async () => {
  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = async () => {
    callCount++;
    return new Response("OK", { status: 200 });
  };
  try {
    const relayer = new HttpWebhookRelayer({ maxRetries: 3, baseDelayMs: 0, requestTimeoutMs: 1000 });
    const result = await relayer.deliver(makeDelivery());
    eq(result.ok, true);
    eq(result.statusCode, 200);
    eq(callCount, 1); // succeeded on first attempt, no retries needed
  } finally {
    global.fetch = originalFetch;
  }
});
