/**
 * tests/passport/verify-action-passport-keyring.test.ts — v231.
 * KeyRing end-to-end for ActionPassport (kid end-to-end task, sub-step 2).
 *
 * Verifies that verifyActionPassport resolves signing keys via KeyRing:
 *   • FEATURE: kid + keyRing → verifies via KeyRing
 *   • MOAT: old passport (before rotation) still verifies AFTER rotation
 *   • REVOKE: revoked kid → fail immediately
 *   • FALLBACK: passport has kid but no keyRing → falls back to publicKey path
 *   • HMAC: passport without kid verifies normally via hmacSecret
 *   • FAIL-CLOSED: unknown kid; tampered kid; missing key material
 */

import { test, assert, eq } from "../_harness.mjs";
import { KeyRing, computeKid } from "../../lib/passport/key-ring.ts";
import { Ed25519Signer, generateAuditKeyPair, HmacSigner } from "../../lib/orchestrator/signer.ts";
import { issuePassport } from "../../lib/passport/passport.ts";
import { verifyActionPassport } from "../../lib/passport/passport-verifier.ts";
import { InMemoryAuditStore } from "../../lib/orchestrator/audit.ts";

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

function makePassport(signer: Ed25519Signer | HmacSigner, auditId?: string) {
  const id = auditId || "audit-" + Math.random().toString(36).slice(2);
  const auditStore = new InMemoryAuditStore();
  auditStore.append({
    id,
    tenantId: "t",
    actionId: "a1",
    actionType: "x",
    source: "s",
    outcome: "allowed",
    occurredAt: new Date().toISOString(),
  });
  return issuePassport({ auditId: id, auditStore, signer, expectedTenantId: "t" });
}

// ─── FEATURE: kid + keyRing verifies ─────────────────────────────────────────

test("verifyActionPassport: kid + keyRing → verifies via KeyRing", () => {
  const { signer, kid, entry } = makeEd25519();
  const ring = new KeyRing();
  ring.register(entry);
  const passport = makePassport(signer);
  const result = verifyActionPassport(passport, { keyRing: ring });
  assert(result.ok, "passport verifies via keyRing");
  assert(result.checks.some((c) => c.name === "passport.signature.keyring" && c.status === "pass"),
    "keyring check passes");
});

// ─── MOAT: rotation-proof ────────────────────────────────────────────────────

test("MOAT: old passport (before rotation) still verifies AFTER key rotation via KeyRing", () => {
  const k1 = makeEd25519();
  const ring = new KeyRing();
  ring.register(k1.entry);

  // Step 1: issue a passport with key1 BEFORE rotation
  const oldPassport = makePassport(k1.signer);
  const beforeRotation = verifyActionPassport(oldPassport, { keyRing: ring });
  assert(beforeRotation.ok, "passport verifies before rotation");

  // Step 2: rotate — k1 becomes "retiring", k2 becomes "active"
  const k2 = makeEd25519();
  ring.rotate({ ...k2.entry, status: "active" });

  // Step 3: issue a NEW passport with k2
  const newPassport = makePassport(k2.signer);

  // Step 4: BOTH passports still verify via the ring
  const oldAfterRotation = verifyActionPassport(oldPassport, { keyRing: ring });
  const newAfterRotation = verifyActionPassport(newPassport, { keyRing: ring });

  assert(oldAfterRotation.ok, "OLD passport still verifies after rotation (retiring key remains)");
  assert(newAfterRotation.ok, "NEW passport verifies against new active key");

  assert(oldPassport.kid !== newPassport.kid, "old and new passports have different kids");
});

// ─── REVOKE: revoked key stops verifying ─────────────────────────────────────

test("verifyActionPassport: revoked kid → fail immediately", () => {
  const { signer, kid, entry } = makeEd25519();
  const ring = new KeyRing();
  ring.register(entry);
  const passport = makePassport(signer);

  // Verify passes before revoke
  assert(verifyActionPassport(passport, { keyRing: ring }).ok, "passes before revoke");

  // Revoke the key
  ring.revoke(kid);

  // Must fail after revoke, even for this historical passport
  const afterRevoke = verifyActionPassport(passport, { keyRing: ring });
  assert(!afterRevoke.ok, "fails after revoke");
  assert(
    afterRevoke.checks.some((c) => c.name === "passport.signature.keyring" && c.status === "fail"),
    "keyring check fails"
  );
});

// ─── FALLBACK: kid present but no keyRing → legacy path ──────────────────────

test("verifyActionPassport: passport has kid but no keyRing → falls back to publicKey path", () => {
  const { signer, kid, pair } = makeEd25519();
  const passport = makePassport(signer);
  // Provide publicKey directly (legacy path) instead of keyRing
  const result = verifyActionPassport(passport, { publicKey: pair.publicKey });
  assert(result.ok, "legacy publicKey path works for kid-bearing passport");
  assert(result.checks.some((c) => c.name === "passport.signature.ed25519" && c.status === "pass"),
    "ed25519 check ran, not keyring");
});

test("verifyActionPassport: HMAC passport without kid verifies normally (no regression)", () => {
  const secret = "test-secret-32-bytes-minimum-xyz";
  const hmacSigner = new HmacSigner(secret);
  const passport = makePassport(hmacSigner);
  eq(passport.kid, undefined);
  const result = verifyActionPassport(passport, { hmacSecret: secret });
  assert(result.ok, "HMAC passport without kid still verifies");
  assert(result.checks.some((c) => c.name === "passport.signature.hmac" && c.status === "pass"));
});

// ─── FAIL-CLOSED ─────────────────────────────────────────────────────────────

test("verifyActionPassport: unknown kid in keyRing → fail", () => {
  const { signer, kid } = makeEd25519();
  // Ring is empty — kid is unknown
  const ring = new KeyRing();
  const passport = makePassport(signer);
  const result = verifyActionPassport(passport, { keyRing: ring });
  assert(!result.ok, "unknown kid → fail");
  assert(result.checks.some((c) => c.name === "passport.signature.keyring" && c.status === "fail"));
});

test("verifyActionPassport: tampered kid (swapped) → hash check fails", () => {
  const k1 = makeEd25519();
  const k2 = makeEd25519();
  const ring = new KeyRing();
  ring.register(k1.entry);
  ring.register(k2.entry);
  const passport = makePassport(k1.signer);
  // Tamper: swap the kid to k2's kid
  const tampered = { ...passport, kid: k2.kid };
  const result = verifyActionPassport(tampered, { keyRing: ring });
  assert(!result.ok, "tampered kid → fail (hash mismatch)");
  assert(result.checks.some((c) => c.name === "passport.hash" && c.status === "fail"),
    "hash check fails on kid tampering");
});

test("verifyActionPassport: no keys provided → signature skipped (not strict)", () => {
  const { signer } = makeEd25519();
  const passport = makePassport(signer);
  const result = verifyActionPassport(passport, {});
  // Without strict mode, skipped signature check does not fail the overall result
  // (hash and audit checks still pass). This matches the standalone verifier behavior.
  assert(result.ok, "hash checks pass even when signature key is missing");
  assert(result.checks.some((c) => c.name === "passport.signature.ed25519" && c.status === "skipped"),
    "signature check is skipped when no key material provided");
});

test("verifyActionPassport: no keys provided + strict → fail-closed", () => {
  const { signer } = makeEd25519();
  const passport = makePassport(signer);
  const result = verifyActionPassport(passport, {}, { strict: true });
  assert(!result.ok, "strict mode: skipped signature check causes failure");
});
