/**
 * examples/verify-webhook.mjs — zero-trust webhook callback verification demo.
 *
 * Simulates an EXTERNAL PARTY (tenant / partner) receiving a TFA webhook
 * callback and verifying its HMAC-SHA256 signature without trusting the server.
 *
 * The only information the external party uses:
 *   • Their own webhook registration secret (shared only at setup time)
 *   • The raw HTTP body and x-tfa-signature header from the callback
 *
 * Run: node examples/verify-webhook.mjs
 *
 * This uses ONLY sdk/escrow-client/verify-webhook.mjs — zero kernel imports.
 */

import { createHmac } from "node:crypto";
import { verifyWebhookSignature } from "../sdk/escrow-client/verify-webhook.mjs";

const ok  = (m) => console.log("  ✓", m);
const bad = (m) => console.error("  ✗", m);

async function run() {
  console.log("\n=== TFA — Webhook Callback Verification Demo ===\n");

  // ── 1. Setup: a tenant registers a webhook and receives a secret ────────
  const secret = "demo-webhook-secret-32-bytes-long-ok";
  console.log("[ step 1 ] Tenant has a webhook secret (shown for demo only):");
  ok(`secret length = ${secret.length} chars`);

  // ── 2. TFA server sends a callback (simulated) ─────────────────────────
  const event = {
    id: "evt-demo-001",
    event: "settlement.released",
    tenantId: "acme-corp",
    occurredAt: new Date().toISOString(),
    data: {
      agreementId: "agree-123",
      state: "released",
      amount: "50000",
    },
  };
  const payload = JSON.stringify(event);

  // Simulate the server's signing (in reality this happens inside TFA)
  const mac = createHmac("sha256", Buffer.from(secret, "utf8"))
    .update(payload, "utf8")
    .digest("base64");
  const signature = `sha256=${mac}`;

  console.log("\n[ step 2 ] TFA sends a webhook callback:");
  ok(`event = ${event.event}`);
  ok(`x-tfa-signature = ${signature.slice(0, 20)}...`);

  // ── 3. Consumer verifies independently ───────────────────────────────────
  console.log("\n[ step 3 ] Consumer verifies signature offline...");
  const result = verifyWebhookSignature(secret, payload, signature);

  if (result.ok) {
    ok("signature VALID — callback is authentic");
  } else {
    bad(`signature INVALID: ${result.reason}`);
    process.exitCode = 1;
    return;
  }

  // ── 4. Demonstrate fail-closed: tampered payload ────────────────────────
  console.log("\n[ step 4 ] Demonstrate fail-closed: tampered payload...");
  const tamperedPayload = payload.replace("released", "reversed");
  const tampered = verifyWebhookSignature(secret, tamperedPayload, signature);
  if (!tampered.ok) {
    ok(`tampered payload detected → ${tampered.reason}`);
  } else {
    bad("tampered payload was accepted (BUG)");
    process.exitCode = 1;
    return;
  }

  // ── 5. Wrong secret ─────────────────────────────────────────────────────
  console.log("\n[ step 5 ] Wrong secret rejected...");
  const wrongSecret = verifyWebhookSignature("wrong-secret-32-bytes-long-ok", payload, signature);
  if (!wrongSecret.ok) {
    ok(`wrong secret rejected → ${wrongSecret.reason}`);
  } else {
    bad("wrong secret was accepted (BUG)");
    process.exitCode = 1;
    return;
  }

  // ── 6. Missing sha256= prefix ───────────────────────────────────────────
  console.log("\n[ step 6 ] Malformed signature header rejected...");
  const malformed = verifyWebhookSignature(secret, payload, mac); // missing "sha256="
  if (!malformed.ok) {
    ok(`malformed header rejected → ${malformed.reason}`);
  } else {
    bad("malformed header was accepted (BUG)");
    process.exitCode = 1;
    return;
  }

  console.log("\n✅ Webhook verification demo complete.\n");
}

run().catch((e) => { console.error("\n✗ Demo failed:", e.message); process.exitCode = 1; });
