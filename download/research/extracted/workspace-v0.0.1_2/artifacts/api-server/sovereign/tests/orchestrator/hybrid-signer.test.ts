import "../_flush.mjs";
/**
 * tests/orchestrator/hybrid-signer.test.ts — v240 (PQC sub-step 1).
 *
 * Verifies HybridSigner, MlDsaStubSigner, parseHybridSignature, and
 * createHybridSigner from lib/orchestrator/signer.ts.
 *
 * Test strategy:
 *   • A deterministic TestMlDsaProvider (Signer implementation that uses
 *     HMAC-SHA256 internally to simulate ML-DSA) is injected as the secondary
 *     signer — this lets us verify the hybrid protocol (format, AND-semantics,
 *     tamper-detection) without needing a real PQC library.
 *   • MlDsaStubSigner tests verify its fail-closed contract independently.
 *   • createHybridSigner factory tests cover key-pair wiring and provider injection.
 *
 * Coverage:
 *   HybridSigner.sign()         — format: "<alg1>:<b64>|<alg2>:<b64>"
 *   HybridSigner.algorithm      — "hybrid:<primary.alg>+<secondary.alg>"
 *   HybridSigner.kid            — inherits from primary (Ed25519)
 *   HybridSigner.verify()       — AND semantics: both must be valid
 *   HybridSigner.verify()       — tamper: corrupted primary sig → false
 *   HybridSigner.verify()       — tamper: corrupted secondary sig → false
 *   HybridSigner.verify()       — tamper: corrupted data → false
 *   HybridSigner.verify()       — malformed signature string → false (fail-closed)
 *   MlDsaStubSigner.sign()      — throws SignerError("PROVIDER_REQUIRED")
 *   MlDsaStubSigner.verify()    — always false (fail-closed)
 *   MlDsaStubSigner.algorithm   — "ml-dsa-44-stub"
 *   parseHybridSignature()      — happy path + malformed inputs
 *   createHybridSigner()        — with and without custom mlDsaProvider
 *   createHybridSigner()        — stub secondary throws on sign (makes PQC gap explicit)
 */

import { test, assert, eq } from "../_harness.mjs";
import {
  HybridSigner,
  MlDsaStubSigner,
  Ed25519Signer,
  HmacSigner,
  SignerError,
  parseHybridSignature,
  createHybridSigner,
  generateAuditKeyPair,
} from "../../lib/orchestrator/signer.ts";
import type { Signer } from "../../lib/orchestrator/types.ts";

// ─── TestMlDsaProvider ────────────────────────────────────────────────────────
// Simulates an ML-DSA provider by wrapping HMAC-SHA256 so we can test the
// hybrid protocol without a real PQC library.

class TestMlDsaProvider implements Signer {
  readonly algorithm = "ml-dsa-44-test";
  readonly kid: string | undefined = undefined;
  private readonly inner = new HmacSigner("test-ml-dsa-secret-key-32-bytes!!");

  sign(data: string): string { return this.inner.sign(data); }
  verify(data: string, sig: string): boolean { return this.inner.verify(data, sig); }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeHybrid(): { signer: HybridSigner; pair: { publicKey: string; privateKey: string } } {
  const pair = generateAuditKeyPair();
  const primary = new Ed25519Signer(pair.privateKey, pair.publicKey);
  const secondary = new TestMlDsaProvider();
  return { signer: new HybridSigner(primary, secondary), pair };
}

// ─── HybridSigner ─────────────────────────────────────────────────────────────

test("HybridSigner: algorithm label is 'hybrid:<primary>+<secondary>'", () => {
  const { signer } = makeHybrid();
  eq(signer.algorithm, "hybrid:ed25519+ml-dsa-44-test");
});

test("HybridSigner: kid inherits from the primary (Ed25519) signer", () => {
  const pair = generateAuditKeyPair();
  const primary = new Ed25519Signer(pair.privateKey, pair.publicKey);
  const secondary = new TestMlDsaProvider();
  const hybrid = new HybridSigner(primary, secondary);
  eq(hybrid.kid, primary.kid);
  assert(hybrid.kid !== undefined, "Ed25519 primary should have a kid");
});

test("HybridSigner: secondaryKid is undefined when the PQC secondary has none (e.g. TestMlDsaProvider/MlDsaStubSigner)", () => {
  const { signer } = makeHybrid();
  eq(signer.secondaryKid, undefined);
  // The primary kid is unaffected by the secondary lacking one.
  assert(signer.kid !== undefined, "primary kid must still be present");
});

test("HybridSigner: secondaryKid surfaces the PQC secondary's own kid when it has one, without changing kid", () => {
  const pair = generateAuditKeyPair();
  const primary = new Ed25519Signer(pair.privateKey, pair.publicKey);
  const secondary: Signer = {
    algorithm: "ml-dsa-44-fake-real",
    kid: "pqc-kid-abc123",
    sign(_d: string): string { return "x"; },
    verify(_d: string, s: string): boolean { return s === "x"; },
  };
  const hybrid = new HybridSigner(primary, secondary);
  eq(hybrid.secondaryKid, "pqc-kid-abc123");
  eq(hybrid.kid, primary.kid, "kid must remain the classical (primary) id, unaffected by secondaryKid");
});

test("HybridSigner.sign() produces '<alg1>:<b64>|<alg2>:<b64>' format", () => {
  const { signer } = makeHybrid();
  const sig = signer.sign("test-data");
  // Must have exactly one | separating two colon-prefixed components.
  const pipeIdx = sig.indexOf("|");
  assert(pipeIdx > 0, "signature must contain a pipe separator");
  const part1 = sig.slice(0, pipeIdx);
  const part2 = sig.slice(pipeIdx + 1);
  assert(part1.startsWith("ed25519:"), "primary component must start with 'ed25519:'");
  assert(part2.startsWith("ml-dsa-44-test:"), "secondary component must start with 'ml-dsa-44-test:'");
  // Base64 chars only after the colon.
  const b64Regex = /^[A-Za-z0-9+/=]+$/;
  assert(b64Regex.test(part1.slice("ed25519:".length)), "primary sig must be base64");
  assert(b64Regex.test(part2.slice("ml-dsa-44-test:".length)), "secondary sig must be base64");
});

test("HybridSigner.verify() returns true when both components are valid", () => {
  const { signer } = makeHybrid();
  const data = "canonical-audit-hash";
  const sig = signer.sign(data);
  assert(signer.verify(data, sig), "valid signature must verify");
});

test("HybridSigner.verify() returns false when primary (Ed25519) sig is corrupted", () => {
  const { signer } = makeHybrid();
  const data = "canonical-audit-hash";
  const sig = signer.sign(data);
  // Corrupt just the primary base64 segment.
  const corrupted = sig.replace(/ed25519:([^|]+)/, "ed25519:AAAAAAAAAAAA==");
  assert(!signer.verify(data, corrupted), "corrupted primary sig must fail");
});

test("HybridSigner.verify() returns false when secondary (ML-DSA) sig is corrupted", () => {
  const { signer } = makeHybrid();
  const data = "canonical-audit-hash";
  const sig = signer.sign(data);
  // Corrupt just the secondary segment (after the pipe).
  const pipeIdx = sig.indexOf("|");
  const corrupted = sig.slice(0, pipeIdx + 1) + "ml-dsa-44-test:AAAAAAAAAAAA==";
  assert(!signer.verify(data, corrupted), "corrupted secondary sig must fail");
});

test("HybridSigner.verify() returns false when data is tampered (both sigs invalid)", () => {
  const { signer } = makeHybrid();
  const sig = signer.sign("original-data");
  assert(!signer.verify("tampered-data", sig), "tampered data must fail verification");
});

test("HybridSigner.verify() returns false for malformed signature (no pipe)", () => {
  const { signer } = makeHybrid();
  assert(!signer.verify("data", "no-pipe-at-all"), "no pipe → false");
});

test("HybridSigner.verify() returns false for malformed signature (missing alg label)", () => {
  const { signer } = makeHybrid();
  assert(!signer.verify("data", "nosep|nosep"), "missing colons → false");
});

test("HybridSigner.verify() returns false for empty string", () => {
  const { signer } = makeHybrid();
  assert(!signer.verify("data", ""), "empty signature → false");
});

test("HybridSigner: different data produces different signatures (non-deterministic Ed25519)", () => {
  const { signer } = makeHybrid();
  const sig1 = signer.sign("data-a");
  const sig2 = signer.sign("data-b");
  assert(sig1 !== sig2, "different data must produce different signatures");
});

// ─── MlDsaStubSigner ─────────────────────────────────────────────────────────

test("MlDsaStubSigner.algorithm is 'ml-dsa-44-stub'", () => {
  eq(new MlDsaStubSigner().algorithm, "ml-dsa-44-stub");
});

test("MlDsaStubSigner.kid is undefined", () => {
  eq(new MlDsaStubSigner().kid, undefined);
});

test("MlDsaStubSigner.sign() throws SignerError(PROVIDER_REQUIRED)", () => {
  const stub = new MlDsaStubSigner();
  try {
    stub.sign("data");
    assert(false, "should have thrown");
  } catch (e: any) {
    assert(e instanceof SignerError, "must throw SignerError");
    eq(e.code, "PROVIDER_REQUIRED");
    assert(/ML-DSA/i.test(e.message), "message should mention ML-DSA");
  }
});

test("MlDsaStubSigner.verify() always returns false (fail-closed)", () => {
  const stub = new MlDsaStubSigner();
  assert(!stub.verify("any-data", "any-sig"), "stub verify must always return false");
  assert(!stub.verify("", ""), "stub verify on empty inputs must return false");
});

// ─── parseHybridSignature ─────────────────────────────────────────────────────

test("parseHybridSignature() parses a valid hybrid signature", () => {
  const result = parseHybridSignature("ed25519:abc123==|ml-dsa-44:xyz789==");
  assert(result !== null, "must parse valid signature");
  eq(result!.alg1, "ed25519");
  eq(result!.sig1, "abc123==");
  eq(result!.alg2, "ml-dsa-44");
  eq(result!.sig2, "xyz789==");
});

test("parseHybridSignature() returns null when no pipe present", () => {
  eq(parseHybridSignature("ed25519:abc123"), null);
});

test("parseHybridSignature() returns null when first part has no colon", () => {
  eq(parseHybridSignature("no-colon|ed25519:abc"), null);
});

test("parseHybridSignature() returns null when second part has no colon", () => {
  eq(parseHybridSignature("ed25519:abc|no-colon"), null);
});

test("parseHybridSignature() returns null for empty string", () => {
  eq(parseHybridSignature(""), null);
});

test("parseHybridSignature() handles colons in base64 (takes first colon only)", () => {
  // Edge case: alg label must not contain a colon; sig may contain '=' but not ':'.
  // Parsing takes first colon as delimiter per spec — this is the expected behaviour.
  const result = parseHybridSignature("ed25519:sig==|ml-dsa:sig2==");
  assert(result !== null);
  eq(result!.alg1, "ed25519");
  eq(result!.sig1, "sig==");
});

// ─── createHybridSigner factory ──────────────────────────────────────────────

test("createHybridSigner() with only ed25519KeyPair uses MlDsaStubSigner as secondary", () => {
  const pair = generateAuditKeyPair();
  const hybrid = createHybridSigner({ ed25519KeyPair: pair });
  // algorithm reflects the stub label.
  eq(hybrid.algorithm, "hybrid:ed25519+ml-dsa-44-stub");
  // kid reflects the Ed25519 primary.
  const primary = new Ed25519Signer(pair.privateKey, pair.publicKey);
  eq(hybrid.kid, primary.kid);
});

test("createHybridSigner() with stub secondary throws on sign() (PQC gap explicit)", () => {
  const pair = generateAuditKeyPair();
  const hybrid = createHybridSigner({ ed25519KeyPair: pair });
  try {
    hybrid.sign("data");
    assert(false, "should have thrown because the PQC provider is a stub");
  } catch (e: any) {
    assert(e instanceof SignerError, "must throw SignerError from stub provider");
    eq(e.code, "PROVIDER_REQUIRED");
  }
});

test("createHybridSigner() with real mlDsaProvider signs and verifies", () => {
  const pair = generateAuditKeyPair();
  const hybrid = createHybridSigner({
    ed25519KeyPair: pair,
    mlDsaProvider: new TestMlDsaProvider(),
  });
  eq(hybrid.algorithm, "hybrid:ed25519+ml-dsa-44-test");
  const data = "trust-gate-canonical-hash";
  const sig = hybrid.sign(data);
  assert(hybrid.verify(data, sig), "hybrid with real provider must round-trip");
  assert(!hybrid.verify("different-data", sig), "must not verify against different data");
});

test("createHybridSigner() kid is inherited from the Ed25519 primary, not the PQC secondary", () => {
  const pair = generateAuditKeyPair();
  const hybrid = createHybridSigner({
    ed25519KeyPair: pair,
    mlDsaProvider: new TestMlDsaProvider(),
  });
  const primary = new Ed25519Signer(pair.privateKey, pair.publicKey);
  eq(hybrid.kid, primary.kid);
  assert(hybrid.kid !== undefined, "kid must be set (comes from Ed25519 primary)");
});

// ─── Integration: HybridSigner implements Signer interface ───────────────────

test("HybridSigner satisfies the Signer interface contract (algorithm+sign+verify)", () => {
  const pair = generateAuditKeyPair();
  const hybrid: Signer = createHybridSigner({
    ed25519KeyPair: pair,
    mlDsaProvider: new TestMlDsaProvider(),
  });
  assert(typeof hybrid.algorithm === "string" && hybrid.algorithm.length > 0, "algorithm must be non-empty string");
  const sig = hybrid.sign("hello");
  assert(typeof sig === "string" && sig.length > 0, "sign must return non-empty string");
  assert(hybrid.verify("hello", sig), "verify must return true for valid signature");
  assert(!hybrid.verify("world", sig), "verify must return false for wrong data");
});

// ─── efficiency/fail-fast-and ─────────────────────────────────────────────────
// verify() uses AND semantics (both signatures must be valid). A failed
// primary already determines the overall result, so the secondary (PQC)
// verify — which can be substantially more expensive — should be skipped
// entirely rather than always run. A call-counting stub signer makes the
// skip directly observable.

class CountingSigner implements Signer {
  readonly algorithm = "counting-stub";
  readonly kid: string | undefined = undefined;
  verifyCalls = 0;
  private readonly result: boolean;
  constructor(result: boolean) { this.result = result; }
  sign(_d: string): string { return "sig"; }
  verify(_d: string, _s: string): boolean {
    this.verifyCalls++;
    return this.result;
  }
}

test("efficiency/fail-fast-and: secondary.verify is NOT called when primary fails", () => {
  const pair = generateAuditKeyPair();
  const primary = new Ed25519Signer(pair.privateKey, pair.publicKey);
  const secondary = new CountingSigner(true); // would succeed if it were ever called
  const hybrid = new HybridSigner(primary, secondary);

  const data = "trust-gate-canonical-hash";
  const sig = hybrid.sign("a-totally-different-payload"); // sign data that won't match `data`
  const corrupted = sig.replace(/ed25519:([^|]+)/, "ed25519:AAAAAAAAAAAA=="); // force primary failure

  const ok = hybrid.verify(data, corrupted);
  eq(ok, false, "must still fail-closed when primary sig is invalid");
  eq(secondary.verifyCalls, 0, "secondary.verify must be skipped once primary already fails (fail-fast)");
});

test("efficiency/fail-fast-and: secondary.verify IS called (and AND-combined) when primary passes", () => {
  const pair = generateAuditKeyPair();
  const primary = new Ed25519Signer(pair.privateKey, pair.publicKey);
  const failingSecondary = new CountingSigner(false);
  const hybrid = new HybridSigner(primary, failingSecondary);

  const data = "trust-gate-canonical-hash";
  const sig = hybrid.sign(data); // primary half is genuinely valid for `data`

  const ok = hybrid.verify(data, sig);
  eq(ok, false, "AND semantics: secondary failing must still fail the overall verify");
  eq(failingSecondary.verifyCalls, 1, "secondary.verify must still run exactly once when primary succeeds");
});

test("efficiency/fail-fast-and: malformed signature (no pipe) never calls either verify", () => {
  const primary = new CountingSigner(true);
  const secondary = new CountingSigner(true);
  const hybrid = new HybridSigner(primary, secondary);

  const ok = hybrid.verify("data", "not-a-valid-hybrid-signature");
  eq(ok, false, "malformed signature must fail-closed");
  eq(primary.verifyCalls, 0, "primary.verify must not be reached for an unparseable signature");
  eq(secondary.verifyCalls, 0, "secondary.verify must not be reached for an unparseable signature");
});
