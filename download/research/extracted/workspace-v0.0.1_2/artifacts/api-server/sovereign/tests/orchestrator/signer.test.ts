import "../_flush.mjs";
/**
 * tests/orchestrator/signer.test.ts — Audit signing primitives (HMAC + Ed25519).
 *
 * Coverage:
 *   HmacSigner
 *     • sign/verify roundtrip
 *     • tampered data fails verification
 *     • wrong secret produces different signature
 *     • empty signature fails verification
 *     • algorithm label is "hmac-sha256"
 *     • secret < 16 bytes throws SECRET_TOO_SHORT
 *
 *   Ed25519Signer
 *     • sign/verify roundtrip
 *     • tampered data fails verification
 *     • wrong public key fails verification
 *     • empty signature fails verification
 *     • algorithm label is "ed25519"
 *     • missing key throws MISSING_KEY
 *
 *   generateAuditKeyPair
 *     • returns distinct PEM strings
 *     • can be used to construct Ed25519Signer
 */

import { test, assert, eq } from "../_harness.mjs";
import {
  HmacSigner,
  Ed25519Signer,
  generateAuditKeyPair,
  SignerError,
} from "../../lib/orchestrator/signer.ts";

// ─── HmacSigner ───────────────────────────────────────────────────────────────

test("HmacSigner: sign/verify roundtrip", () => {
  const signer = new HmacSigner("super-secret-key-32bytes!!");
  const sig = signer.sign("hello-hash");
  assert(sig.length > 0, "signature must be non-empty");
  assert(signer.verify("hello-hash", sig), "must verify own signature");
});

test("HmacSigner: tampered data fails verification", () => {
  const signer = new HmacSigner("super-secret-key-32bytes!!");
  const sig = signer.sign("original-hash");
  assert(!signer.verify("tampered-hash", sig), "must reject tampered data");
});

test("HmacSigner: wrong secret produces different signature", () => {
  const signerA = new HmacSigner("secret-a-32bytes-long!!!");
  const signerB = new HmacSigner("secret-b-32bytes-long!!!");
  const sig = signerA.sign("same-data");
  assert(!signerB.verify("same-data", sig), "wrong secret must not verify");
});

test("HmacSigner: empty signature fails verification", () => {
  const signer = new HmacSigner("super-secret-key-32bytes!!");
  assert(!signer.verify("hello-hash", ""), "empty signature must fail");
});

test("HmacSigner: algorithm label", () => {
  const signer = new HmacSigner("super-secret-key-32bytes!!");
  eq(signer.algorithm, "hmac-sha256");
});

test("HmacSigner: short secret throws SECRET_TOO_SHORT", () => {
  try {
    new HmacSigner("short");
    assert(false, "expected throw");
  } catch (err) {
    assert(err instanceof SignerError, "must be SignerError");
    eq((err as SignerError).code, "SECRET_TOO_SHORT");
  }
});

// ─── Ed25519Signer ────────────────────────────────────────────────────────────

const TEST_KEYS = generateAuditKeyPair();

test("Ed25519Signer: sign/verify roundtrip", () => {
  const signer = new Ed25519Signer(TEST_KEYS.privateKey, TEST_KEYS.publicKey);
  const sig = signer.sign("hello-hash");
  assert(sig.length > 0, "signature must be non-empty");
  assert(signer.verify("hello-hash", sig), "must verify own signature");
});

test("Ed25519Signer: tampered data fails verification", () => {
  const signer = new Ed25519Signer(TEST_KEYS.privateKey, TEST_KEYS.publicKey);
  const sig = signer.sign("original-hash");
  assert(!signer.verify("tampered-hash", sig), "must reject tampered data");
});

test("Ed25519Signer: wrong public key fails verification", () => {
  const signer = new Ed25519Signer(TEST_KEYS.privateKey, TEST_KEYS.publicKey);
  const otherKeys = generateAuditKeyPair();
  const impostor = new Ed25519Signer(otherKeys.privateKey, otherKeys.publicKey);
  const sig = signer.sign("same-data");
  assert(!impostor.verify("same-data", sig), "wrong key must not verify");
});

test("Ed25519Signer: empty signature fails verification", () => {
  const signer = new Ed25519Signer(TEST_KEYS.privateKey, TEST_KEYS.publicKey);
  assert(!signer.verify("hello-hash", ""), "empty signature must fail");
});

test("Ed25519Signer: algorithm label", () => {
  const signer = new Ed25519Signer(TEST_KEYS.privateKey, TEST_KEYS.publicKey);
  eq(signer.algorithm, "ed25519");
});

test("Ed25519Signer: missing key throws MISSING_KEY", () => {
  try {
    new Ed25519Signer("", TEST_KEYS.publicKey);
    assert(false, "expected throw");
  } catch (err) {
    assert(err instanceof SignerError, "must be SignerError");
    eq((err as SignerError).code, "MISSING_KEY");
  }
});

// ─── generateAuditKeyPair ─────────────────────────────────────────────────────

test("generateAuditKeyPair returns distinct PEM strings", () => {
  const keys = generateAuditKeyPair();
  assert(keys.publicKey.includes("BEGIN PUBLIC KEY"), "public key must be PEM");
  assert(keys.privateKey.includes("BEGIN PRIVATE KEY"), "private key must be PEM");
  assert(keys.publicKey !== keys.privateKey, "keys must differ");
});

test("generateAuditKeyPair produces usable signer", () => {
  const keys = generateAuditKeyPair();
  const signer = new Ed25519Signer(keys.privateKey, keys.publicKey);
  const sig = signer.sign("audit-hash-123");
  assert(signer.verify("audit-hash-123", sig), "fresh keypair must work");
});
