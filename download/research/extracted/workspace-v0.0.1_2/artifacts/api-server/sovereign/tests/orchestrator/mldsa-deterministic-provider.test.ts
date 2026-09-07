import "../_flush.mjs";
/**
 * tests/orchestrator/mldsa-deterministic-provider.test.ts — PQC sub-step 3.
 *
 * Verifies MlDsaDeterministicProvider (lib/orchestrator/signer.ts):
 *   • conformance (passes MlDsaProviderConformanceSuite)
 *   • deterministic output (same input + secret → same signature)
 *   • structural correctness (exactly 2420 bytes decoded)
 *   • hybrid integration (works as secondary signer in HybridSigner)
 *   • fail-closed (bad secret length, bad base64 verify, tampered data)
 *   • edge cases (empty string, unicode, long input)
 */

import { test, assert, eq } from "../_harness.mjs";
import {
  MlDsaDeterministicProvider,
  MlDsaProviderConformanceSuite,
  ML_DSA_44_SIGNATURE_BYTES,
  HybridSigner,
  Ed25519Signer,
  createHybridSigner,
  generateAuditKeyPair,
  SignerError,
} from "../../lib/orchestrator/signer.ts";

// ─── Conformance ──────────────────────────────────────────────────────────────

test("MlDsaDeterministicProvider passes MlDsaProviderConformanceSuite", () => {
  const provider = new MlDsaDeterministicProvider("a-very-long-secret-key-32-bytes-plus-extra!!");
  const result = MlDsaProviderConformanceSuite(provider);
  eq(result.ok, true, `conformance failed: ${result.failures.join("; ")}`);
  eq(result.failures.length, 0);
});

// ─── Structural correctness ─────────────────────────────────────────────────

test("MlDsaDeterministicProvider.sign() produces exactly ML_DSA_44_SIGNATURE_BYTES (2420) when decoded", () => {
  const provider = new MlDsaDeterministicProvider("secret-must-be-at-least-32-bytes-long!!");
  const sig = provider.sign("hello");
  const raw = Buffer.from(sig, "base64");
  eq(raw.length, ML_DSA_44_SIGNATURE_BYTES, `expected ${ML_DSA_44_SIGNATURE_BYTES} bytes, got ${raw.length}`);
});

test("MlDsaDeterministicProvider.algorithm is the expected simulation label", () => {
  const provider = new MlDsaDeterministicProvider("secret-must-be-at-least-32-bytes-long!!");
  eq(provider.algorithm, "ml-dsa-44-deterministic-sim");
});

test("MlDsaDeterministicProvider.kid is undefined", () => {
  const provider = new MlDsaDeterministicProvider("secret-must-be-at-least-32-bytes-long!!");
  eq(provider.kid, undefined);
});

// ─── Determinism ────────────────────────────────────────────────────────────

test("MlDsaDeterministicProvider is deterministic: same data + same secret → same signature", () => {
  const provider = new MlDsaDeterministicProvider("secret-must-be-at-least-32-bytes-long!!");
  const sig1 = provider.sign("same-payload");
  const sig2 = provider.sign("same-payload");
  eq(sig1, sig2);
});

test("MlDsaDeterministicProvider: different data → different signature", () => {
  const provider = new MlDsaDeterministicProvider("secret-must-be-at-least-32-bytes-long!!");
  const sig1 = provider.sign("data-a");
  const sig2 = provider.sign("data-b");
  assert(sig1 !== sig2, "different data should produce different signatures");
});

test("MlDsaDeterministicProvider: different secret → different signature for same data", () => {
  const p1 = new MlDsaDeterministicProvider("secret-alpha-must-be-32-bytes-long!!");
  const p2 = new MlDsaDeterministicProvider("secret-beta--must-be-32-bytes-long!!");
  const sig1 = p1.sign("shared-data");
  const sig2 = p2.sign("shared-data");
  assert(sig1 !== sig2, "different secrets should produce different signatures");
});

// ─── Verify behaviour ───────────────────────────────────────────────────────

test("MlDsaDeterministicProvider.verify() returns true for own signature", () => {
  const provider = new MlDsaDeterministicProvider("secret-must-be-at-least-32-bytes-long!!");
  const sig = provider.sign("verify-me");
  assert(provider.verify("verify-me", sig), "must verify own signature");
});

test("MlDsaDeterministicProvider.verify() returns false for tampered data", () => {
  const provider = new MlDsaDeterministicProvider("secret-must-be-at-least-32-bytes-long!!");
  const sig = provider.sign("original-data");
  assert(!provider.verify("tampered-data", sig), "must reject tampered data");
});

test("MlDsaDeterministicProvider.verify() returns false for tampered signature", () => {
  const provider = new MlDsaDeterministicProvider("secret-must-be-at-least-32-bytes-long!!");
  const sig = provider.sign("data");
  const raw = Buffer.from(sig, "base64");
  if (raw.length > 0) raw[0] = raw[0] ^ 0xff;
  const tampered = raw.toString("base64");
  assert(!provider.verify("data", tampered), "must reject tampered signature");
});

test("MlDsaDeterministicProvider.verify() returns false for cross-data reuse", () => {
  const provider = new MlDsaDeterministicProvider("secret-must-be-at-least-32-bytes-long!!");
  const sigA = provider.sign("data-a");
  assert(!provider.verify("data-b", sigA), "must reject signature from different data");
});

test("MlDsaDeterministicProvider.verify() returns false for malformed base64", () => {
  const provider = new MlDsaDeterministicProvider("secret-must-be-at-least-32-bytes-long!!");
  assert(!provider.verify("data", "not-valid-base64!!!"), "must reject malformed base64");
});

test("MlDsaDeterministicProvider.verify() returns false for empty signature string", () => {
  const provider = new MlDsaDeterministicProvider("secret-must-be-at-least-32-bytes-long!!");
  assert(!provider.verify("data", ""), "must reject empty signature");
});

// ─── Constructor validation ─────────────────────────────────────────────────

test("MlDsaDeterministicProvider constructor rejects secret shorter than 32 bytes", () => {
  let threw = false;
  try {
    new MlDsaDeterministicProvider("short");
  } catch (e: any) {
    threw = true;
    assert(e instanceof SignerError, "must throw SignerError");
    eq(e.code, "SECRET_TOO_SHORT");
  }
  assert(threw, "must throw for short secret");
});

test("MlDsaDeterministicProvider constructor accepts Buffer secret", () => {
  const provider = new MlDsaDeterministicProvider(Buffer.alloc(32, 0xAB));
  const sig = provider.sign("test");
  assert(typeof sig === "string" && sig.length > 0, "must sign with Buffer secret");
});

// ─── Edge cases ─────────────────────────────────────────────────────────────

test("MlDsaDeterministicProvider handles empty string input", () => {
  const provider = new MlDsaDeterministicProvider("secret-must-be-at-least-32-bytes-long!!");
  const sig = provider.sign("");
  const raw = Buffer.from(sig, "base64");
  eq(raw.length, ML_DSA_44_SIGNATURE_BYTES);
  assert(provider.verify("", sig), "must round-trip empty string");
});

test("MlDsaDeterministicProvider handles unicode input", () => {
  const provider = new MlDsaDeterministicProvider("secret-must-be-at-least-32-bytes-long!!");
  const data = "שלום עולם 🌍 מחרוזת יוניקוד";
  const sig = provider.sign(data);
  const raw = Buffer.from(sig, "base64");
  eq(raw.length, ML_DSA_44_SIGNATURE_BYTES);
  assert(provider.verify(data, sig), "must round-trip unicode");
});

test("MlDsaDeterministicProvider handles long input (4096 chars)", () => {
  const provider = new MlDsaDeterministicProvider("secret-must-be-at-least-32-bytes-long!!");
  const data = "x".repeat(4096);
  const sig = provider.sign(data);
  const raw = Buffer.from(sig, "base64");
  eq(raw.length, ML_DSA_44_SIGNATURE_BYTES);
  assert(provider.verify(data, sig), "must round-trip long input");
});

// ─── HybridSigner integration ─────────────────────────────────────────────────

test("MlDsaDeterministicProvider works as secondary in HybridSigner", () => {
  const pair = generateAuditKeyPair();
  const primary = new Ed25519Signer(pair.privateKey, pair.publicKey);
  const secondary = new MlDsaDeterministicProvider("secret-must-be-at-least-32-bytes-long!!");
  const hybrid = new HybridSigner(primary, secondary);

  const data = "hybrid-integration-test";
  const sig = hybrid.sign(data);
  assert(hybrid.verify(data, sig), "hybrid must verify with deterministic provider");
  assert(!hybrid.verify("tampered", sig), "hybrid must reject tampered data");
});

test("createHybridSigner with MlDsaDeterministicProvider signs and verifies", () => {
  const pair = generateAuditKeyPair();
  const hybrid = createHybridSigner({
    ed25519KeyPair: pair,
    mlDsaProvider: new MlDsaDeterministicProvider("secret-must-be-at-least-32-bytes-long!!"),
  });
  eq(hybrid.algorithm, "hybrid:ed25519+ml-dsa-44-deterministic-sim");
  const data = "trust-gate-canonical-hash";
  const sig = hybrid.sign(data);
  assert(hybrid.verify(data, sig), "must round-trip");
  assert(!hybrid.verify("different-data", sig), "must reject different data");
});

test("HybridSigner with MlDsaDeterministicProvider produces correct algorithm label", () => {
  const pair = generateAuditKeyPair();
  const hybrid = createHybridSigner({
    ed25519KeyPair: pair,
    mlDsaProvider: new MlDsaDeterministicProvider("secret-must-be-at-least-32-bytes-long!!"),
  });
  eq(hybrid.algorithm, "hybrid:ed25519+ml-dsa-44-deterministic-sim");
});
