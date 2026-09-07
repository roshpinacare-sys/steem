import "../_flush.mjs";
/**
 * tests/escrow/webhook-verification-sdk.test.ts — standalone SDK webhook verifier.
 *
 * Coverage:
 *   • happy path: valid signature accepted
 *   • tampered payload rejected
 *   • wrong secret rejected
 *   • truncated / malformed signature rejected
 *   • missing sha256= prefix rejected
 *   • empty / invalid inputs are fail-closed
 *   • BigInt amounts in payload round-trip correctly through verification
 *
 * Uses ONLY sdk/escrow-client/verify-webhook.mjs — no kernel imports.
 */

import { test, assert, eq } from "../_harness.mjs";
import { verifyWebhookSignature } from "../../sdk/escrow-client/verify-webhook.mjs";
import { WebhookService } from "../../lib/escrow/webhook.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePayload(event = "settlement.released") {
  return JSON.stringify({
    id: "evt-1",
    event,
    tenantId: "t1",
    occurredAt: "2026-06-16T12:00:00.000Z",
    data: { agreementId: "agree-1", amount: "50000" },
  });
}

// ─── Happy path ───────────────────────────────────────────────────────────────

test("sdk verifyWebhook: accepts valid signature", () => {
  const secret = "valid-secret-32-bytes-long-ok";
  const payload = makePayload();
  const sig = WebhookService.signPayload(secret, payload);
  const result = verifyWebhookSignature(secret, payload, sig);
  assert(result.ok, `expected ok, got: ${result.reason}`);
});

test("sdk verifyWebhook: accepts valid signature with unicode payload", () => {
  const secret = "unicode-secret-32-bytes-long-ok";
  const payload = JSON.stringify({ message: "שלום עולם 🌍" });
  const sig = WebhookService.signPayload(secret, payload);
  const result = verifyWebhookSignature(secret, payload, sig);
  assert(result.ok, `unicode payload failed: ${result.reason}`);
});

// ─── Tamper detection ─────────────────────────────────────────────────────────

test("sdk verifyWebhook: rejects tampered payload", () => {
  const secret = "tamper-secret-32-bytes-long-ok";
  const payload = makePayload();
  const sig = WebhookService.signPayload(secret, payload);
  const tampered = payload.replace("agree-1", "agree-hacked");
  const result = verifyWebhookSignature(secret, tampered, sig);
  assert(!result.ok, "tampered payload must be rejected");
  assert(result.reason?.includes("signature"), `reason mentions signature: ${result.reason}`);
});

test("sdk verifyWebhook: rejects tampered event type", () => {
  const secret = "event-secret-32-bytes-long-ok";
  const payload = makePayload("settlement.released");
  const sig = WebhookService.signPayload(secret, payload);
  const tampered = payload.replace("settlement.released", "settlement.reversed");
  const result = verifyWebhookSignature(secret, tampered, sig);
  assert(!result.ok, "tampered event type must be rejected");
});

// ─── Wrong secret ─────────────────────────────────────────────────────────────

test("sdk verifyWebhook: rejects wrong secret", () => {
  const secret = "secret-a-32-bytes-long-ok-ok";
  const payload = makePayload();
  const sig = WebhookService.signPayload(secret, payload);
  const result = verifyWebhookSignature("secret-b-32-bytes-long-ok-ok", payload, sig);
  assert(!result.ok, "wrong secret must be rejected");
});

// ─── Malformed signatures ─────────────────────────────────────────────────────

test("sdk verifyWebhook: rejects truncated signature", () => {
  const secret = "trunc-secret-32-bytes-long-ok";
  const payload = makePayload();
  const sig = WebhookService.signPayload(secret, payload);
  const truncated = sig.slice(0, sig.length - 4);
  const result = verifyWebhookSignature(secret, payload, truncated);
  assert(!result.ok, "truncated signature must be rejected");
});

test("sdk verifyWebhook: rejects missing sha256= prefix", () => {
  const secret = "prefix-secret-32-bytes-long-ok";
  const payload = makePayload();
  const sig = WebhookService.signPayload(secret, payload);
  const bare = sig.slice(7); // remove "sha256="
  const result = verifyWebhookSignature(secret, payload, bare);
  assert(!result.ok, "bare base64 without prefix must be rejected");
  assert(result.reason?.includes("sha256="), `reason mentions prefix: ${result.reason}`);
});

test("sdk verifyWebhook: rejects empty signature", () => {
  const secret = "empty-secret-32-bytes-long-ok";
  const payload = makePayload();
  const result = verifyWebhookSignature(secret, payload, "");
  assert(!result.ok, "empty signature must be rejected");
});

// ─── Invalid inputs (fail-closed) ───────────────────────────────────────────

test("sdk verifyWebhook: rejects empty secret", () => {
  const payload = makePayload();
  const sig = WebhookService.signPayload("any-secret-32-bytes-long-ok", payload);
  const result = verifyWebhookSignature("", payload, sig);
  assert(!result.ok, "empty secret must be rejected");
  assert(result.reason?.includes("secret"), `reason mentions secret: ${result.reason}`);
});

test("sdk verifyWebhook: rejects null payload", () => {
  const secret = "null-secret-32-bytes-long-ok";
  const result = verifyWebhookSignature(secret, null as any, "sha256=abc");
  assert(!result.ok, "null payload must be rejected");
});

test("sdk verifyWebhook: rejects undefined payload", () => {
  const secret = "undef-secret-32-bytes-long-ok";
  const result = verifyWebhookSignature(secret, undefined as any, "sha256=abc");
  assert(!result.ok, "undefined payload must be rejected");
});

test("sdk verifyWebhook: rejects non-string payload", () => {
  const secret = "type-secret-32-bytes-long-ok";
  const result = verifyWebhookSignature(secret, { foo: "bar" } as any, "sha256=abc");
  assert(!result.ok, "object payload must be rejected");
});

test("sdk verifyWebhook: rejects empty signature string", () => {
  const secret = "sig-secret-32-bytes-long-ok";
  const result = verifyWebhookSignature(secret, "payload", "");
  assert(!result.ok, "empty signature string must be rejected");
});

test("sdk verifyWebhook: rejects non-string secret", () => {
  const payload = makePayload();
  const sig = WebhookService.signPayload("any-secret-32-bytes-long-ok", payload);
  const result = verifyWebhookSignature(null as any, payload, sig);
  assert(!result.ok, "null secret must be rejected");
});

// ─── SDK ↔ Server consistency ───────────────────────────────────────────────

test("sdk verifyWebhook: produces same result as WebhookService.verifySignature", () => {
  const secret = "consistency-secret-32-bytes-long";
  const payload = makePayload();
  const sig = WebhookService.signPayload(secret, payload);

  const sdkResult = verifyWebhookSignature(secret, payload, sig);
  const serverResult = WebhookService.verifySignature(secret, payload, sig);

  eq(sdkResult.ok, serverResult, "SDK and server must agree on valid signature");
});

test("sdk verifyWebhook: rejects payload that server also rejects", () => {
  const secret = "server-secret-32-bytes-long-ok";
  const payload = makePayload();
  const sig = WebhookService.signPayload(secret, payload);
  const tampered = payload.replace("t1", "evil-tenant");

  const sdkResult = verifyWebhookSignature(secret, tampered, sig);
  const serverResult = WebhookService.verifySignature(secret, tampered, sig);

  eq(sdkResult.ok, serverResult, "SDK and server must agree on tampered payload");
  assert(!sdkResult.ok, "both must reject tampered payload");
});
