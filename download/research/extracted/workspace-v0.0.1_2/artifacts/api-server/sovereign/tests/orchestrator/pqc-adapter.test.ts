import "../_flush.mjs";
/**
 * tests/orchestrator/pqc-adapter.test.ts — PQC Adapter (sub-step 4).
 *
 * Verifies MlDsaOqsProvider and adaptPqcProvider:
 *   • fail-closed when module is missing or malformed
 *   • conformance suite pass with a mock Uint8Array signer
 *   • correct string ↔ Uint8Array bridging (base64 round-trip)
 *   • tamper detection (data + signature corruption)
 *   • integration with HybridSigner end-to-end
 */

import { test, assert, eq } from "../_harness.mjs";
import {
  MlDsaOqsProvider,
  adaptPqcProvider,
  derivePqcKid,
} from "../../lib/orchestrator/pqc-adapter.ts";
import {
  MlDsaProviderConformanceSuite,
  ML_DSA_44_SIGNATURE_BYTES,
  HybridSigner,
  Ed25519Signer,
  generateAuditKeyPair,
  SignerError,
} from "../../lib/orchestrator/signer.ts";
import type { Signer } from "../../lib/orchestrator/types.ts";

// ─── Mock Uint8Array signers ─────────────────────────────────────────────────

function makeMockOqs(opts?: { verifyAlwaysTrue?: boolean; wrongSize?: boolean }): {
  sign(msg: Uint8Array): Uint8Array;
  verify(msg: Uint8Array, sig: Uint8Array): boolean;
} {
  return {
    sign(msg: Uint8Array): Uint8Array {
      const size = opts?.wrongSize ? 100 : ML_DSA_44_SIGNATURE_BYTES;
      const sig = new Uint8Array(size);
      // Deterministic: XOR each byte with 0xAB
      for (let i = 0; i < msg.length && i < size; i++) sig[i] = msg[i] ^ 0xab;
      return sig;
    },
    verify(msg: Uint8Array, sig: Uint8Array): boolean {
      if (opts?.verifyAlwaysTrue) return true;
      // Real verification: re-derive expected signature
      const expected = this.sign(msg);
      if (expected.length !== sig.length) return false;
      for (let i = 0; i < expected.length; i++) {
        if (expected[i] !== sig[i]) return false;
      }
      return true;
    },
  };
}

function makeRealVerifyMock(): {
  sign(msg: Uint8Array): Uint8Array;
  verify(msg: Uint8Array, sig: Uint8Array): boolean;
} {
  const state = new Map<string, Uint8Array>();
  return {
    sign(msg: Uint8Array): Uint8Array {
      const sig = new Uint8Array(ML_DSA_44_SIGNATURE_BYTES);
      for (let i = 0; i < msg.length && i < ML_DSA_44_SIGNATURE_BYTES; i++) sig[i] = msg[i] ^ 0xab;
      state.set(Buffer.from(msg).toString("hex"), sig);
      return sig;
    },
    verify(msg: Uint8Array, sig: Uint8Array): boolean {
      const expected = state.get(Buffer.from(msg).toString("hex"));
      if (!expected || expected.length !== sig.length) return false;
      for (let i = 0; i < expected.length; i++) {
        if (expected[i] !== sig[i]) return false;
      }
      return true;
    },
  };
}

// ─── MlDsaOqsProvider ────────────────────────────────────────────────────────

test("MlDsaOqsProvider: missing module → throws PROVIDER_REQUIRED", () => {
  let threw = false;
  let code = "";
  try {
    new MlDsaOqsProvider();
  } catch (e: any) {
    threw = true;
    code = e.code;
  }
  assert(threw, "constructor should throw when module is absent");
  eq(code, "PROVIDER_REQUIRED");
});

test("MlDsaOqsProvider: malformed module (no sign) → throws PROVIDER_REQUIRED", () => {
  let threw = false;
  try {
    new MlDsaOqsProvider({ verify: () => true } as any);
  } catch (e: any) {
    threw = true;
    eq(e.code, "PROVIDER_REQUIRED");
  }
  assert(threw, "constructor should throw when module lacks sign()");
});

test("MlDsaOqsProvider: passes conformance suite with mock OQS module", () => {
  const mock = makeRealVerifyMock();
  const provider = new MlDsaOqsProvider(mock);
  const result = MlDsaProviderConformanceSuite(provider);
  eq(result.ok, true, `conformance failed: ${result.failures.join("; ")}`);
  eq(result.failures.length, 0);
});

test("MlDsaOqsProvider: sign produces base64 string", () => {
  const mock = makeMockOqs();
  const provider = new MlDsaOqsProvider(mock);
  const sig = provider.sign("hello");
  assert(typeof sig === "string", "signature should be a base64 string");
  const raw = Buffer.from(sig, "base64");
  eq(raw.length, ML_DSA_44_SIGNATURE_BYTES, `expected ${ML_DSA_44_SIGNATURE_BYTES} bytes, got ${raw.length}`);
});

test("MlDsaOqsProvider: verify round-trip with real-verify mock", () => {
  const mock = makeRealVerifyMock();
  const provider = new MlDsaOqsProvider(mock);
  const sig = provider.sign("round-trip-data");
  const ok = provider.verify("round-trip-data", sig);
  assert(ok, "verify should accept its own signature");
});

test("MlDsaOqsProvider: verify rejects tampered data", () => {
  const mock = makeRealVerifyMock();
  const provider = new MlDsaOqsProvider(mock);
  const sig = provider.sign("original-data");
  const ok = provider.verify("tampered-data", sig);
  assert(!ok, "verify should reject signature over different data");
});

test("MlDsaOqsProvider: verify rejects tampered signature", () => {
  const mock = makeRealVerifyMock();
  const provider = new MlDsaOqsProvider(mock);
  const sig = provider.sign("original-data");
  const raw = Buffer.from(sig, "base64");
  if (raw.length > 0) raw[0] = raw[0] ^ 0xff;
  const badSig = raw.toString("base64");
  const ok = provider.verify("original-data", badSig);
  assert(!ok, "verify should reject corrupted signature");
});

// ─── adaptPqcProvider ────────────────────────────────────────────────────────

test("adaptPqcProvider: returns a Signer from Uint8Array-based raw object", () => {
  const raw = makeMockOqs();
  const signer = adaptPqcProvider(raw);
  assert(typeof signer.algorithm === "string", "should have algorithm string");
  assert(typeof signer.sign === "function", "should have sign()");
  assert(typeof signer.verify === "function", "should have verify()");
});

test("adaptPqcProvider: sign returns base64, verify round-trips", () => {
  const raw = makeRealVerifyMock();
  const signer = adaptPqcProvider(raw);
  const sig = signer.sign("adapt-test");
  assert(typeof sig === "string");
  const ok = signer.verify("adapt-test", sig);
  assert(ok, "round-trip verify should succeed");
});

test("adaptPqcProvider: fail-closed verify returns false on tampered data", () => {
  const raw = makeRealVerifyMock();
  const signer = adaptPqcProvider(raw);
  const sig = signer.sign("data-a");
  const ok = signer.verify("data-b", sig);
  assert(!ok, "should reject cross-data signature");
});

test("adaptPqcProvider: fail-closed verify returns false on corrupted signature", () => {
  const raw = makeRealVerifyMock();
  const signer = adaptPqcProvider(raw);
  const sig = signer.sign("data");
  const rawBuf = Buffer.from(sig, "base64");
  if (rawBuf.length > 0) rawBuf[0] = rawBuf[0] ^ 0xff;
  const bad = rawBuf.toString("base64");
  const ok = signer.verify("data", bad);
  assert(!ok, "should reject corrupted signature");
});

test("adaptPqcProvider: verify returns false when raw.verify throws", () => {
  const raw = {
    sign(msg: Uint8Array): Uint8Array {
      return new Uint8Array(ML_DSA_44_SIGNATURE_BYTES);
    },
    verify(_msg: Uint8Array, _sig: Uint8Array): boolean {
      throw new Error("wasm trap");
    },
  };
  const signer = adaptPqcProvider(raw);
  const sig = signer.sign("anything");
  const ok = signer.verify("anything", sig);
  assert(!ok, "should return false when raw verify throws (fail-closed)");
});

// ─── HybridSigner integration ────────────────────────────────────────────────

test("adaptPqcProvider + HybridSigner end-to-end: sign and verify", () => {
  const pair = generateAuditKeyPair();
  const primary = new Ed25519Signer(pair.privateKey, pair.publicKey);
  const secondary = adaptPqcProvider(makeRealVerifyMock());
  const hybrid = new HybridSigner(primary, secondary);
  const sig = hybrid.sign("hybrid-payload");
  const ok = hybrid.verify("hybrid-payload", sig);
  assert(ok, "hybrid should verify its own signature");
});

test("adaptPqcProvider + HybridSigner: tampered secondary sig → verify false", () => {
  const pair = generateAuditKeyPair();
  const primary = new Ed25519Signer(pair.privateKey, pair.publicKey);
  const secondary = adaptPqcProvider(makeRealVerifyMock());
  const hybrid = new HybridSigner(primary, secondary);
  const sig = hybrid.sign("payload");
  // Corrupt the secondary portion of the hybrid signature
  // Format: ed25519:<sig1>|ml-dsa-44-adapted:<sig2>
  const parts = sig.split("|");
  assert(parts.length === 2, "hybrid signature should have two parts");
  const secondaryPart = parts[1];
  const colonIdx = secondaryPart.indexOf(":");
  assert(colonIdx !== -1, "secondary part should have colon");
  const corruptedSecondary = secondaryPart.slice(0, colonIdx + 1) + "AA" + secondaryPart.slice(colonIdx + 1);
  const corrupted = parts[0] + "|" + corruptedSecondary;
  const ok = hybrid.verify("payload", corrupted);
  assert(!ok, "hybrid should reject corrupted secondary signature");
});

test("adaptPqcProvider + HybridSigner: tampered data → verify false", () => {
  const pair = generateAuditKeyPair();
  const primary = new Ed25519Signer(pair.privateKey, pair.publicKey);
  const secondary = adaptPqcProvider(makeRealVerifyMock());
  const hybrid = new HybridSigner(primary, secondary);
  const sig = hybrid.sign("original");
  const ok = hybrid.verify("tampered", sig);
  assert(!ok, "hybrid should reject signature over tampered data");
});

// ─── kid derivation (PQC sub-step 5) ─────────────────────────────────────────

test("derivePqcKid: undefined publicKey → undefined kid (never fabricated)", () => {
  eq(derivePqcKid(undefined), undefined);
  eq(derivePqcKid(new Uint8Array(0)), undefined);
});

test("derivePqcKid: stable and deterministic for the same public key", () => {
  const pk = new Uint8Array([1, 2, 3, 4, 5]);
  const kid1 = derivePqcKid(pk);
  const kid2 = derivePqcKid(new Uint8Array([1, 2, 3, 4, 5]));
  assert(typeof kid1 === "string" && kid1.length === 16, "kid should be a 16-char hex string (64 bits)");
  eq(kid1, kid2, "same public key bytes must yield the same kid");
});

test("derivePqcKid: different public keys diverge", () => {
  const kidA = derivePqcKid(new Uint8Array([1, 2, 3]));
  const kidB = derivePqcKid(new Uint8Array([4, 5, 6]));
  assert(kidA !== kidB, "different public keys must yield different kids");
});

test("adaptPqcProvider: kid is undefined when raw has no publicKey (back-compat)", () => {
  const signer = adaptPqcProvider(makeRealVerifyMock());
  eq(signer.kid, undefined);
});

test("adaptPqcProvider: kid is derived when raw exposes a publicKey", () => {
  const raw = { ...makeRealVerifyMock(), publicKey: new Uint8Array([9, 8, 7, 6]) };
  const signer = adaptPqcProvider(raw);
  eq(signer.kid, derivePqcKid(new Uint8Array([9, 8, 7, 6])));
  assert(signer.kid !== undefined);
});

test("MlDsaOqsProvider: kid is undefined when the module has no publicKey (back-compat)", () => {
  const provider = new MlDsaOqsProvider(makeRealVerifyMock());
  eq(provider.kid, undefined);
});

test("MlDsaOqsProvider: kid is derived when the module exposes a publicKey", () => {
  const mod = { ...makeRealVerifyMock(), publicKey: new Uint8Array([1, 1, 2, 3, 5, 8]) };
  const provider = new MlDsaOqsProvider(mod);
  eq(provider.kid, derivePqcKid(new Uint8Array([1, 1, 2, 3, 5, 8])));
  assert(provider.kid !== undefined);
});
