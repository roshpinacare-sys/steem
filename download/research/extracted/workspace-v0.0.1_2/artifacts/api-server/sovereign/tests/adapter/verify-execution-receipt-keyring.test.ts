/**
 * tests/adapter/verify-execution-receipt-keyring.test.ts — v231.
 * KeyRing end-to-end for ExecutionReceipt (kid end-to-end task, sub-step 1).
 *
 * Verifies that verifyExecutionReceipt resolves signing keys via KeyRing:
 *   • FEATURE: kid + keyRing → verifies via KeyRing
 *   • MOAT: old receipt (before rotation) still verifies AFTER rotation
 *   • REVOKE: revoked kid → fail immediately
 *   • FALLBACK: receipt has kid but no keyRing → falls back to legacy Signer path
 *   • HMAC: receipt without kid verifies normally via legacy Signer
 *   • FAIL-CLOSED: unknown kid; tampered kid; missing key material
 */

import { test, assert, eq } from "../_harness.mjs";
import { KeyRing, computeKid } from "../../lib/passport/key-ring.ts";
import { Ed25519Signer, generateAuditKeyPair, HmacSigner } from "../../lib/orchestrator/signer.ts";
import { runActionThroughTfa, verifyExecutionReceipt } from "../../lib/adapter/agent-adapter.ts";
import type { ActionIntent } from "../../lib/orchestrator/types.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEd25519() {
  const pair = generateAuditKeyPair();
  const signer = new Ed25519Signer(pair.privateKey, pair.publicKey);
  const kid = computeKid("ed25519", pair.publicKey);
  const entry = {
    kid,
    algorithm: "ed25519" as const,
    publicKey: pair.publicKey,
    status: "active" as const,
    createdAt: new Date().toISOString(),
  };
  return { signer, kid, entry, pair };
}

function makeIntent(over: Partial<ActionIntent> = {}): ActionIntent {
  return {
    actorId: "agent:test",
    toolId: "file.read",
    resourceRef: "res:doc-1",
    riskClass: "read_only",
    valueMicrounits: 0n,
    nonce: "nonce-" + Math.random().toString(36).slice(2),
    expiry: new Date(Date.now() + 60_000).toISOString(),
    tenantId: "tenant-kid-test",
    approvalPolicyRef: "default",
    privacyLevel: "internal",
    evidencePolicy: "default",
    provenance: "test",
    ...over,
  };
}

// ─── FEATURE: kid + keyRing verifies ─────────────────────────────────────────

test("verifyExecutionReceipt: kid + keyRing → verifies via KeyRing", async () => {
  const { signer, kid, entry } = makeEd25519();
  const ring = new KeyRing();
  ring.register(entry);
  const result = await runActionThroughTfa(makeIntent(), signer);
  const valid = verifyExecutionReceipt(result.receipt, { keyRing: ring });
  assert(valid, "receipt verifies via keyRing");
});

// ─── MOAT: rotation-proof ────────────────────────────────────────────────────

test("MOAT: old receipt (before rotation) still verifies AFTER key rotation", async () => {
  const k1 = makeEd25519();
  const ring = new KeyRing();
  ring.register(k1.entry);

  // Step 1: run action and get receipt BEFORE rotation
  const oldResult = await runActionThroughTfa(makeIntent(), k1.signer);
  const oldReceipt = oldResult.receipt;
  const beforeRotation = verifyExecutionReceipt(oldReceipt, { keyRing: ring });
  assert(beforeRotation, "receipt verifies before rotation");

  // Step 2: rotate — k1 becomes "retiring", k2 becomes "active"
  const k2 = makeEd25519();
  ring.rotate({ ...k2.entry, status: "active" });

  // Step 3: run a NEW action with k2
  const newResult = await runActionThroughTfa(makeIntent(), k2.signer);

  // Step 4: BOTH receipts still verify via the ring
  const oldAfterRotation = verifyExecutionReceipt(oldReceipt, { keyRing: ring });
  const newAfterRotation = verifyExecutionReceipt(newResult.receipt, { keyRing: ring });

  assert(oldAfterRotation, "OLD receipt still verifies after rotation (retiring key remains)");
  assert(newAfterRotation, "NEW receipt verifies against new active key");

  assert(oldReceipt.kid !== newResult.receipt.kid, "old and new receipts have different kids");
});

// ─── REVOKE: revoked key stops verifying ─────────────────────────────────────

test("verifyExecutionReceipt: revoked kid → fail immediately", async () => {
  const { signer, kid, entry } = makeEd25519();
  const ring = new KeyRing();
  ring.register(entry);
  const result = await runActionThroughTfa(makeIntent(), signer);

  // Verify passes before revoke
  assert(verifyExecutionReceipt(result.receipt, { keyRing: ring }), "passes before revoke");

  // Revoke the key
  ring.revoke(kid);

  // Must fail after revoke, even for this historical receipt
  const afterRevoke = verifyExecutionReceipt(result.receipt, { keyRing: ring });
  assert(!afterRevoke, "fails after revoke");
});

// ─── FALLBACK: kid present but no keyRing → legacy path ──────────────────────

test("verifyExecutionReceipt: claim has kid but no keyRing → falls back to signer path", async () => {
  const { signer, kid, pair } = makeEd25519();
  const result = await runActionThroughTfa(makeIntent(), signer);
  // Provide signer directly (legacy path) instead of keyRing
  const valid = verifyExecutionReceipt(result.receipt, signer);
  assert(valid, "legacy signer path works for kid-bearing receipt");
});

test("verifyExecutionReceipt: HMAC receipt without kid verifies normally (no regression)", async () => {
  const hmacSigner = new HmacSigner("test-secret-for-kid-tests-min32bytes!!");
  const result = await runActionThroughTfa(makeIntent(), hmacSigner);
  assert(result.receipt.kid === undefined, "HMAC receipt has no kid");
  const valid = verifyExecutionReceipt(result.receipt, hmacSigner);
  assert(valid, "HMAC receipt without kid still verifies");
});

// ─── FAIL-CLOSED ─────────────────────────────────────────────────────────────

test("verifyExecutionReceipt: unknown kid in keyRing → fail", async () => {
  const { signer, kid } = makeEd25519();
  // Ring is empty — kid is unknown
  const ring = new KeyRing();
  const result = await runActionThroughTfa(makeIntent(), signer);
  const valid = verifyExecutionReceipt(result.receipt, { keyRing: ring });
  assert(!valid, "unknown kid → fail");
});

test("verifyExecutionReceipt: tampered kid (swapped) → hash check fails", async () => {
  const k1 = makeEd25519();
  const k2 = makeEd25519();
  const ring = new KeyRing();
  ring.register(k1.entry);
  ring.register(k2.entry);
  const result = await runActionThroughTfa(makeIntent(), k1.signer);
  // Tamper: swap the kid to k2's kid
  const tampered = { ...result.receipt, kid: k2.kid };
  const valid = verifyExecutionReceipt(tampered, { keyRing: ring });
  assert(!valid, "tampered kid → fail (hash mismatch)");
});

test("verifyExecutionReceipt: no signer and no keyRing → fail-closed", async () => {
  const { signer } = makeEd25519();
  const result = await runActionThroughTfa(makeIntent(), signer);
  // Pass empty keys object — no signer, no keyRing
  const valid = verifyExecutionReceipt(result.receipt, {});
  assert(!valid, "no key material → fail-closed");
});
