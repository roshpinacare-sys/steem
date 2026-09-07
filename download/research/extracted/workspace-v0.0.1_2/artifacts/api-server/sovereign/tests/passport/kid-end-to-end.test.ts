/**
 * tests/passport/kid-end-to-end.test.ts — v203.
 * kid end-to-end in PassportClaim (M1 completion, task #1).
 *
 * Tests that `kid` is:
 *   (a) embedded in the claim body when `opts.kid` is supplied → covered by hash
 *   (b) verified via KeyRing when the verifier has `keys.keyRing`
 *   (c) rotation-proof: a claim signed BEFORE key rotation still verifies AFTER,
 *       because the retiring key stays in the ring
 *   (d) revocation-closed: a revoked key's claim stops verifying immediately
 *   (e) fall-through: claim with kid but no keyRing still verifies via legacy path
 *   (f) fail-closed: unknown kid → fail; tampered kid → fail; missing keyRing for
 *       kid-only claim → skipped (not fail, because keyRing is optional)
 *
 *   FEATURE      kid present in claim body and in PassportClaim object.
 *   MOAT         rotation end-to-end: old claim verifies after key rotation.
 *   REVOKE       revoked kid claim fails immediately.
 *   FALLBACK     kid + no keyRing → falls back to legacy hmac/ed25519 path.
 *   FAIL-CLOSED  unknown kid; tampered kid; tampered hash.
 */

import { test, assert, eq } from "../_harness.mjs";
import { KeyRing, computeKid } from "../../lib/passport/key-ring.ts";
import { Ed25519Signer, generateAuditKeyPair, HmacSigner } from "../../lib/orchestrator/signer.ts";
import { buildPassportClaim } from "../../lib/passport/claim.ts";
import { verifyPassportClaim } from "../../lib/passport/claim-verifier.ts";

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

function makeClaim(signer: Ed25519Signer, kid?: string) {
  return buildPassportClaim({
    issuer: "tfa-test",
    subject: "passport-001",
    scope: "passport.status",
    evidenceRefs: ["audit-1"],
    signer,
    kid,
  });
}

// ─── FEATURE: kid embedded in claim ──────────────────────────────────────────

test("buildPassportClaim: kid field present in body when supplied", () => {
  const { signer, kid } = makeEd25519();
  const claim = makeClaim(signer, kid);
  eq(claim.kid, kid, "kid carried on claim");
  // hash must cover kid: rebuilding without kid should give a different hash
  const claimNoKid = makeClaim(signer);
  assert(claimNoKid.kid === undefined, "no kid when not supplied");
  assert(claim.hash !== claimNoKid.hash, "hash differs when kid is included");
});

test("buildPassportClaim: kid NOT present when not supplied", () => {
  const { signer } = makeEd25519();
  const claim = makeClaim(signer);
  eq(claim.kid, undefined, "no kid field");
});

// ─── FEATURE: KeyRing path in verifier ───────────────────────────────────────

test("verifyPassportClaim: kid + keyRing → verifies via KeyRing", () => {
  const { signer, kid, entry } = makeEd25519();
  const ring = new KeyRing();
  ring.register(entry);
  const claim = makeClaim(signer, kid);
  const result = verifyPassportClaim(claim, { keyRing: ring });
  assert(result.ok, "claim verifies via keyRing");
  assert(result.checks.some((c) => c.name === "claim.signature.keyring" && c.status === "pass"),
    "keyring check passes");
});

// ─── MOAT: rotation-proof ────────────────────────────────────────────────────

test("MOAT: old claim (before rotation) still verifies AFTER key rotation via KeyRing", () => {
  const k1 = makeEd25519();
  const ring = new KeyRing();
  ring.register(k1.entry);

  // Step 1: sign a claim with key1 BEFORE rotation
  const oldClaim = makeClaim(k1.signer, k1.kid);
  const beforeRotation = verifyPassportClaim(oldClaim, { keyRing: ring });
  assert(beforeRotation.ok, "claim verifies before rotation");

  // Step 2: rotate — key1 becomes "retiring", key2 becomes "active"
  const k2 = makeEd25519();
  ring.rotate({ ...k2.entry, status: "active" });

  // Step 3: sign a NEW claim with key2
  const newClaim = makeClaim(k2.signer, k2.kid);

  // Step 4: BOTH claims still verify via the ring
  const oldAfterRotation = verifyPassportClaim(oldClaim, { keyRing: ring });
  const newAfterRotation = verifyPassportClaim(newClaim, { keyRing: ring });

  assert(oldAfterRotation.ok, "OLD claim still verifies after rotation (retiring key remains)");
  assert(newAfterRotation.ok, "NEW claim verifies against new active key");

  // The two claims have different kids
  assert(oldClaim.kid !== newClaim.kid, "old and new claims have different kids");
});

// ─── REVOKE: revoked key stops verifying ─────────────────────────────────────

test("verifyPassportClaim: revoked kid → fail immediately", () => {
  const { signer, kid, entry } = makeEd25519();
  const ring = new KeyRing();
  ring.register(entry);
  const claim = makeClaim(signer, kid);

  // Verify passes before revoke
  assert(verifyPassportClaim(claim, { keyRing: ring }).ok, "passes before revoke");

  // Revoke the key
  ring.revoke(kid);

  // Must fail after revoke, even for this historical claim
  const afterRevoke = verifyPassportClaim(claim, { keyRing: ring });
  assert(!afterRevoke.ok, "fails after revoke");
  assert(
    afterRevoke.checks.some((c) => c.name === "claim.signature.keyring" && c.status === "fail"),
    "keyring check fails"
  );
});

// ─── FALLBACK: kid present but no keyRing → legacy path ──────────────────────

test("verifyPassportClaim: claim has kid but no keyRing → falls back to publicKey path", () => {
  const { signer, kid, pair } = makeEd25519();
  const claim = makeClaim(signer, kid);
  // Provide publicKey directly (legacy path) instead of keyRing
  const result = verifyPassportClaim(claim, { publicKey: pair.publicKey });
  assert(result.ok, "legacy publicKey path works for kid-bearing claim");
  // The legacy ed25519 check should have run (not keyring)
  assert(result.checks.some((c) => c.name === "claim.signature.ed25519" && c.status === "pass"),
    "ed25519 check ran, not keyring");
});

test("verifyPassportClaim: HMAC claim without kid verifies normally (no regression)", () => {
  const secret = "test-secret-32-bytes-minimum-xyz";
  const hmacSigner = new HmacSigner(secret);
  const claim = buildPassportClaim({
    issuer: "tfa-test",
    subject: "pp-002",
    scope: "passport.status",
    signer: hmacSigner,
    // No kid
  });
  eq(claim.kid, undefined);
  const result = verifyPassportClaim(claim, { hmacSecret: secret });
  assert(result.ok, "HMAC claim without kid still verifies");
  assert(result.checks.some((c) => c.name === "claim.signature.hmac" && c.status === "pass"));
});

// ─── FAIL-CLOSED ─────────────────────────────────────────────────────────────

test("verifyPassportClaim: unknown kid in keyRing → fail", () => {
  const { signer, kid } = makeEd25519();
  // Ring is empty — kid is unknown
  const ring = new KeyRing();
  const claim = makeClaim(signer, kid);
  const result = verifyPassportClaim(claim, { keyRing: ring });
  assert(!result.ok, "unknown kid → fail");
  assert(result.checks.some((c) => c.name === "claim.signature.keyring" && c.status === "fail"));
});

test("verifyPassportClaim: tampered kid (swapped) → hash check fails", () => {
  const k1 = makeEd25519();
  const k2 = makeEd25519();
  const ring = new KeyRing();
  ring.register(k1.entry);
  ring.register(k2.entry);
  const claim = makeClaim(k1.signer, k1.kid);
  // Tamper: swap the kid to k2's kid
  const tampered = { ...claim, kid: k2.kid };
  const result = verifyPassportClaim(tampered, { keyRing: ring });
  // The hash covers k1.kid; switching to k2.kid makes hash check fail
  assert(!result.ok, "tampered kid → fail (hash mismatch)");
  assert(result.checks.some((c) => c.name === "claim.hash" && c.status === "fail"),
    "hash check fails on kid tampering");
});

test("verifyPassportClaim: wrong signature for correct kid → keyring fail", () => {
  const k1 = makeEd25519();
  const k2 = makeEd25519();
  const ring = new KeyRing();
  ring.register(k1.entry);
  // Sign the body with k1 correctly, but report k1.kid and then submit wrong sig
  const claim = makeClaim(k1.signer, k1.kid);
  // Tamper signature only (kid and hash are correct, sig is wrong)
  const wrongSig = makeClaim(k2.signer, k2.kid).signature;
  const tampered = { ...claim, signature: wrongSig };
  const result = verifyPassportClaim(tampered, { keyRing: ring });
  assert(!result.ok, "wrong signature → fail");
});
