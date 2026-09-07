/**
 * tests/passport/key-ring.test.ts — v202.
 * KeyRing: KID-based verification key resolver — the portable-proof moat.
 *
 *   FEATURE        a proof signed with a key verifies when resolved by its kid.
 *   ROTATION       after rotate(), an OLD proof STILL verifies (retiring key) while
 *                  a NEW proof verifies against the new active key — portability survives.
 *   REVOKE         a revoked key's proofs stop verifying immediately, forever (fail-closed).
 *   FAIL-CLOSED    unknown kid, wrong signature, missing material → false (never throws).
 */
import { test, assert, eq } from "../_harness.mjs";
import { KeyRing, KeyRingError, computeKid } from "../../lib/passport/key-ring.ts";
import { Ed25519Signer, generateAuditKeyPair, HmacSigner } from "../../lib/orchestrator/signer.ts";

// Build an ed25519 signer + matching ring entry.
function ed25519Key(status: "active" | "retiring" | "revoked" = "active") {
  const pair = generateAuditKeyPair();
  const signer = new Ed25519Signer(pair.privateKey, pair.publicKey);
  const kid = computeKid("ed25519", pair.publicKey);
  return { signer, entry: { kid, algorithm: "ed25519" as const, publicKey: pair.publicKey, status, createdAt: "2026-01-01T00:00:00.000Z" } };
}

test("computeKid is deterministic and a proof verifies by kid", () => {
  const k = ed25519Key();
  eq(k.entry.kid, computeKid("ed25519", k.entry.publicKey), "kid stable for same key");
  const ring = new KeyRing();
  ring.register(k.entry);
  const payload = "proof-payload-1";
  const sig = k.signer.sign(payload);
  assert(ring.verify(payload, sig, k.entry.kid), "proof verifies via the ring");
  assert(!ring.verify("tampered", sig, k.entry.kid), "wrong payload fails");
});

test("MOAT: an old proof still verifies after key rotation", () => {
  const oldK = ed25519Key();
  const ring = new KeyRing();
  ring.register(oldK.entry);
  // sign a proof with the OLD key
  const oldProof = "old-proof";
  const oldSig = oldK.signer.sign(oldProof);
  assert(ring.verify(oldProof, oldSig, oldK.entry.kid), "old proof verifies before rotation");

  // rotate to a NEW active key
  const newK = ed25519Key();
  ring.rotate(newK.entry);
  eq(ring.active()!.kid, newK.entry.kid, "new key is active");
  eq(ring.resolve(oldK.entry.kid)!.status, "retiring", "old key is retiring");

  // the OLD proof STILL verifies (portability survives rotation) ...
  assert(ring.verify(oldProof, oldSig, oldK.entry.kid), "OLD proof still verifies after rotation");
  // ... and a NEW proof verifies against the new key
  const newProof = "new-proof";
  assert(ring.verify(newProof, newK.signer.sign(newProof), newK.entry.kid), "new proof verifies");
});

test("REVOKE: a revoked key's proofs stop verifying forever (fail-closed)", () => {
  const k = ed25519Key();
  const ring = new KeyRing();
  ring.register(k.entry);
  const proof = "compromised-proof";
  const sig = k.signer.sign(proof);
  assert(ring.verify(proof, sig, k.entry.kid), "verifies before revocation");
  ring.revoke(k.entry.kid);
  eq(ring.resolve(k.entry.kid)!.status, "revoked");
  assert(!ring.verify(proof, sig, k.entry.kid), "revoked key NEVER verifies (even valid signature)");
});

test("hmac entries verify symmetrically and fail-closed paths return false", () => {
  const secret = "key-ring-hmac-secret-0123456789";
  const signer = new HmacSigner(secret);
  const kid = computeKid("hmac-sha256", secret);
  const ring = new KeyRing();
  ring.register({ kid, algorithm: "hmac-sha256", secret, status: "active", createdAt: "2026-01-01T00:00:00.000Z" });
  const payload = "hmac-proof";
  assert(ring.verify(payload, signer.sign(payload), kid), "hmac proof verifies");

  // fail-closed paths (never throw)
  eq(ring.verify(payload, "AAAA", kid), false, "wrong signature → false");
  eq(ring.verify(payload, signer.sign(payload), "kid_unknown"), false, "unknown kid → false");
  eq(ring.resolve("nope"), null, "unknown kid resolves to null");
});

test("registration validates material fail-closed", () => {
  const ring = new KeyRing();
  const expectThrow = (fn: () => unknown, code: string) => {
    let e: any; try { fn(); } catch (x) { e = x; }
    assert(e instanceof KeyRingError, "throws KeyRingError");
    eq(e.code, code);
  };
  expectThrow(() => ring.register({ kid: "", algorithm: "ed25519", publicKey: "x", status: "active", createdAt: "" } as any), "invalid_kid");
  expectThrow(() => ring.register({ kid: "k1", algorithm: "ed25519", status: "active", createdAt: "" } as any), "missing_public_key");
  expectThrow(() => ring.register({ kid: "k2", algorithm: "hmac-sha256", status: "active", createdAt: "" } as any), "missing_secret");
  expectThrow(() => ring.revoke("nope"), "unknown_kid");
});
