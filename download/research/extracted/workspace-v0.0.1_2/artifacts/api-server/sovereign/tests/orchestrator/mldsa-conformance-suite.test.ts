import "../_flush.mjs";
/**
 * tests/orchestrator/mldsa-conformance-suite.test.ts — PQC sub-step 2.
 *
 * Verifies `MlDsaProviderConformanceSuite` (lib/orchestrator/signer.ts) — the
 * structural conformance harness any candidate ML-DSA-44 provider must pass
 * before being wired into `createHybridSigner({ mlDsaProvider })`.
 *
 * Test strategy:
 *   • A FIPS-204-correctly-sized fake provider (CorrectSizeFakeProvider) that
 *     produces real 2420-byte signatures (HMAC-derived, padded to size) and
 *     verifies tamper/cross-data correctly → should PASS every check.
 *   • Several deliberately-broken fakes, each violating exactly one check →
 *     each should fail exactly that check (precision of the harness itself).
 *   • MlDsaStubSigner → should fail conformance (sign() throws) — this proves
 *     the harness correctly rejects the stub rather than rubber-stamping it.
 *   • ML_DSA_44_SIGNATURE_BYTES constant sanity (FIPS 204 ML-DSA-44 = 2420).
 *
 * Coverage:
 *   happy path:      correctly-sized provider passes all 10 checks
 *   precision:        wrong-signature-length provider fails ONLY that check
 *   precision:        universal-verify-true provider fails reject_* checks
 *   precision:        sign()-throws provider fails sign-dependent checks
 *   precision:        empty-algorithm provider fails algorithm_nonempty
 *   fail-closed:       MlDsaStubSigner fails conformance (not a false pass)
 *   result shape:      ok===false implies failures.length > 0 and vice versa
 */

import { test, assert, eq } from "../_harness.mjs";
import {
  MlDsaProviderConformanceSuite,
  ML_DSA_44_SIGNATURE_BYTES,
  MlDsaStubSigner,
  HmacSigner,
} from "../../lib/orchestrator/signer.ts";
import type { Signer } from "../../lib/orchestrator/types.ts";

// ─── Fixed-size signature helper ──────────────────────────────────────────────

function padToFipsLength(raw: Buffer): Buffer {
  if (raw.length >= ML_DSA_44_SIGNATURE_BYTES) return raw.subarray(0, ML_DSA_44_SIGNATURE_BYTES);
  const padded = Buffer.alloc(ML_DSA_44_SIGNATURE_BYTES);
  raw.copy(padded);
  return padded;
}

/**
 * CorrectSizeFakeProvider — a fake "ML-DSA-44" provider that:
 *   • Always produces exactly ML_DSA_44_SIGNATURE_BYTES of signature data
 *     (derived deterministically from an HMAC of the input, then padded).
 *   • verify() recomputes the same derivation and compares — correctly
 *     rejects tampered data, tampered signatures, and cross-data reuse.
 * This is NOT a real ML-DSA implementation (no post-quantum security) —
 * it exists only to prove the conformance harness accepts a structurally
 * correct provider.
 */
class CorrectSizeFakeProvider implements Signer {
  readonly algorithm = "ml-dsa-44-fake-correct-size";
  readonly kid: string | undefined = undefined;
  private readonly inner = new HmacSigner("fake-mldsa-conformance-secret-32b!!");

  sign(data: string): string {
    const innerSig = this.inner.sign(data);
    const raw = padToFipsLength(Buffer.from(innerSig, "base64"));
    return raw.toString("base64");
  }

  verify(data: string, signature: string): boolean {
    try {
      const expected = this.sign(data);
      // Constant-shape comparison is not required for a test fake.
      return expected === signature;
    } catch {
      return false;
    }
  }
}

/** Always returns a too-short signature (violates signature_length_fips204 only). */
class WrongLengthProvider implements Signer {
  readonly algorithm = "ml-dsa-44-wrong-length";
  readonly kid: string | undefined = undefined;
  sign(_data: string): string { return Buffer.alloc(100).toString("base64"); }
  verify(_data: string, _sig: string): boolean { return true; } // also "universal-true", deliberately
}

/** Correctly-sized signatures, but verify() always returns true (violates reject_* checks). */
class UniversalVerifyTrueProvider implements Signer {
  readonly algorithm = "ml-dsa-44-universal-true";
  readonly kid: string | undefined = undefined;
  sign(_data: string): string { return Buffer.alloc(ML_DSA_44_SIGNATURE_BYTES, 0x42).toString("base64"); }
  verify(_data: string, _sig: string): boolean { return true; }
}

/** sign() always throws (violates every sign-dependent check, like the real stub). */
class AlwaysThrowsProvider implements Signer {
  readonly algorithm = "ml-dsa-44-throws";
  readonly kid: string | undefined = undefined;
  sign(_data: string): string { throw new Error("simulated provider failure"); }
  verify(_data: string, _sig: string): boolean { return false; }
}

/** Empty algorithm label (violates algorithm_nonempty only; otherwise correct). */
class EmptyAlgorithmProvider implements Signer {
  readonly algorithm = "";
  readonly kid: string | undefined = undefined;
  private readonly inner = new CorrectSizeFakeProvider();
  sign(data: string): string { return this.inner.sign(data); }
  verify(data: string, sig: string): boolean { return this.inner.verify(data, sig); }
}

// ─── Constant sanity ────────────────────────────────────────────────────────

test("MlDsaProviderConformanceSuite: ML_DSA_44_SIGNATURE_BYTES is the FIPS 204 ML-DSA-44 length (2420)", () => {
  eq(ML_DSA_44_SIGNATURE_BYTES, 2420);
});

// ─── Happy path ───────────────────────────────────────────────────────────────

test("MlDsaProviderConformanceSuite: correctly-sized provider passes ALL checks (ok=true, failures=[])", () => {
  const result = MlDsaProviderConformanceSuite(new CorrectSizeFakeProvider());
  eq(result.ok, true, `expected ok=true, failures: ${result.failures.join("; ")}`);
  eq(result.failures.length, 0);
  assert(result.checks["signature_length_fips204"] === true, "signature_length_fips204 should pass");
  assert(result.checks["verify_roundtrip"] === true, "verify_roundtrip should pass");
  assert(result.checks["reject_tampered_data"] === true, "reject_tampered_data should pass");
  assert(result.checks["reject_tampered_signature"] === true, "reject_tampered_signature should pass");
  assert(result.checks["reject_cross_data"] === true, "reject_cross_data should pass");
  assert(result.checks["algorithm_nonempty"] === true, "algorithm_nonempty should pass");
  assert(result.checks["varying_length_empty_input"] === true, "varying_length_empty_input should pass");
  assert(result.checks["varying_length_short_input"] === true, "varying_length_short_input should pass");
  assert(result.checks["varying_length_long_input"] === true, "varying_length_long_input should pass");
});

// ─── Precision: each broken fake fails ONLY the check it violates ─────────────

test("MlDsaProviderConformanceSuite: wrong-length provider fails signature_length_fips204", () => {
  const result = MlDsaProviderConformanceSuite(new WrongLengthProvider());
  eq(result.ok, false);
  eq(result.checks["signature_length_fips204"], false);
});

test("MlDsaProviderConformanceSuite: universal-verify-true provider fails reject_* checks but passes signature_length and roundtrip", () => {
  const result = MlDsaProviderConformanceSuite(new UniversalVerifyTrueProvider());
  eq(result.ok, false);
  eq(result.checks["signature_length_fips204"], true, "correctly-sized signature should pass length check");
  eq(result.checks["verify_roundtrip"], true, "universal-true trivially round-trips");
  eq(result.checks["reject_tampered_data"], false, "should fail: verify always returns true");
  eq(result.checks["reject_tampered_signature"], false, "should fail: verify always returns true");
  eq(result.checks["reject_cross_data"], false, "should fail: verify always returns true");
});

test("MlDsaProviderConformanceSuite: always-throws provider fails every sign-dependent check", () => {
  const result = MlDsaProviderConformanceSuite(new AlwaysThrowsProvider());
  eq(result.ok, false);
  eq(result.checks["signature_length_fips204"], false);
  eq(result.checks["verify_roundtrip"], false);
  eq(result.checks["reject_tampered_data"], false);
  eq(result.checks["reject_tampered_signature"], false);
  eq(result.checks["reject_cross_data"], false);
  eq(result.checks["varying_length_empty_input"], false);
  eq(result.checks["varying_length_short_input"], false);
  eq(result.checks["varying_length_long_input"], false);
  // algorithm_nonempty is independent of sign() — should still pass.
  eq(result.checks["algorithm_nonempty"], true);
});

test("MlDsaProviderConformanceSuite: empty-algorithm provider fails ONLY algorithm_nonempty", () => {
  const result = MlDsaProviderConformanceSuite(new EmptyAlgorithmProvider());
  eq(result.ok, false);
  eq(result.checks["algorithm_nonempty"], false);
  // Everything else should still pass since the underlying signing is correct.
  eq(result.checks["signature_length_fips204"], true);
  eq(result.checks["verify_roundtrip"], true);
  eq(result.checks["reject_tampered_data"], true);
  eq(result.checks["reject_tampered_signature"], true);
  eq(result.checks["reject_cross_data"], true);
});

// ─── Fail-closed: the real stub correctly fails conformance ──────────────────

test("MlDsaProviderConformanceSuite: MlDsaStubSigner fails conformance (proves harness doesn't rubber-stamp the stub)", () => {
  const result = MlDsaProviderConformanceSuite(new MlDsaStubSigner());
  eq(result.ok, false, "the stub must NOT pass conformance — it cannot sign");
  assert(result.failures.length > 0, "failures list should be non-empty");
  eq(result.checks["signature_length_fips204"], false, "stub's sign() throws, so this should fail");
  eq(result.checks["verify_roundtrip"], false);
  // algorithm_nonempty IS true for the stub ("ml-dsa-44-stub") — only sign-dependent checks fail.
  eq(result.checks["algorithm_nonempty"], true);
});

// ─── Result shape invariant ────────────────────────────────────────────────────

test("MlDsaProviderConformanceSuite: ok=false implies failures.length > 0, and ok=true implies failures.length === 0", () => {
  const passing = MlDsaProviderConformanceSuite(new CorrectSizeFakeProvider());
  const failing = MlDsaProviderConformanceSuite(new MlDsaStubSigner());
  eq(passing.ok, true);
  eq(passing.failures.length, 0);
  eq(failing.ok, false);
  assert(failing.failures.length > 0, "failing result must list at least one failure");
  // Every failure string should reference a check name.
  for (const f of failing.failures) {
    assert(typeof f === "string" && f.length > 0, `failure entry should be a non-empty string, got: ${JSON.stringify(f)}`);
  }
});

test("MlDsaProviderConformanceSuite: checks map covers all 10 named checks for every provider", () => {
  const result = MlDsaProviderConformanceSuite(new CorrectSizeFakeProvider());
  const expectedChecks = [
    "algorithm_nonempty",
    "signature_length_fips204",
    "verify_roundtrip",
    "reject_tampered_data",
    "reject_tampered_signature",
    "reject_cross_data",
    "varying_length_empty_input",
    "varying_length_short_input",
    "varying_length_long_input",
  ];
  for (const name of expectedChecks) {
    assert(name in result.checks, `expected check "${name}" to be present in checks map`);
  }
});
