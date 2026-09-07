import "../_flush.mjs";
/**
 * tests/orchestrator/pqc-compiled-provider.test.ts — Compiled PQC Provider Wrappers (v311).
 *
 * Verifies that real compiled PQC module shapes (ml-dsa WASM, @noble/post-quantum,
 * OQS class bindings) are correctly detected and wrapped into `Uint8ArraySigner`:
 *   • shape detection (isMlDsaCompiledModule, isOqsSignatureClass)
 *   • wrapCompiledModule selects the right wrapper
 *   • round-trip sign + verify
 *   • tampered data / tampered signature rejection
 *   • cross-data check (sig for A does not verify for B)
 *   • pass `MlDsaProviderConformanceSuite`
 *   • fail-closed on malformed modules / bad key generation
 *   • naive Uint8ArraySigner still passes through unchanged
 */

import { test, assert, eq } from "../_harness.mjs";
import { createHash } from "node:crypto";
import {
  MlDsaCompiledProvider,
  MlDsaOqsClassProvider,
  wrapCompiledModule,
  isMlDsaCompiledModule,
  isOqsSignatureClass,
} from "../../lib/orchestrator/pqc-compiled-provider.ts";
import {
  MlDsaProviderConformanceSuite,
  ML_DSA_44_SIGNATURE_BYTES,
  SignerError,
} from "../../lib/orchestrator/signer.ts";
import { adaptPqcProvider } from "../../lib/orchestrator/pqc-adapter.ts";

// ─── Mock helpers ────────────────────────────────────────────────────────────

/** Deterministic mock key material. */
function makeMockKeys() {
  return {
    secretKey: new Uint8Array(Buffer.from("mock-secret-key-32-bytes-long!!").slice(0, 32)),
    publicKey: new Uint8Array(Buffer.from("mock-public-key-32-bytes-long!!").slice(0, 32)),
  };
}

/** Deterministic expander: given a seed and message, produce exactly 2420 bytes. */
function expandSignature(seed: Uint8Array, message: Uint8Array): Uint8Array {
  const sig = Buffer.alloc(ML_DSA_44_SIGNATURE_BYTES);
  const first = createHash("sha256").update(seed).update(message).digest();
  first.copy(sig);
  let offset = first.length; // 32
  let counter = 0;
  while (offset < ML_DSA_44_SIGNATURE_BYTES) {
    const chunk = createHash("sha256")
      .update(seed)
      .update(message)
      .update(Buffer.from([counter]))
      .digest();
    const remaining = ML_DSA_44_SIGNATURE_BYTES - offset;
    chunk.copy(sig, offset, 0, Math.min(chunk.length, remaining));
    offset += Math.min(chunk.length, remaining);
    counter++;
  }
  return new Uint8Array(sig);
}

/** Create a mock ml-dsa style module (keyGen + sign + verify). */
function makeMockMlDsaModule() {
  const keys = makeMockKeys();
  const sigMap = new Map<string, Uint8Array>();
  return {
    keyGen() {
      return {
        secretKey: keys.secretKey.slice(),
        publicKey: keys.publicKey.slice(),
      };
    },
    sign(message: Uint8Array, secretKey: Uint8Array) {
      const sig = expandSignature(secretKey, message);
      sigMap.set(Buffer.from(message).toString("hex"), new Uint8Array(sig));
      return new Uint8Array(sig);
    },
    verify(signature: Uint8Array, message: Uint8Array, _publicKey: Uint8Array) {
      const expected = sigMap.get(Buffer.from(message).toString("hex"));
      if (!expected || expected.length !== signature.length) return false;
      for (let i = 0; i < expected.length; i++) {
        if (expected[i] !== signature[i]) return false;
      }
      return true;
    },
  };
}

/** Create a mock @noble/post-quantum style module (keygen + sign + verify). */
function makeMockNobleModule() {
  const keys = makeMockKeys();
  const sigMap = new Map<string, Uint8Array>();
  return {
    keygen() {
      return {
        secretKey: keys.secretKey.slice(),
        publicKey: keys.publicKey.slice(),
      };
    },
    sign(message: Uint8Array, secretKey: Uint8Array) {
      const sig = expandSignature(secretKey, message);
      sigMap.set(Buffer.from(message).toString("hex"), new Uint8Array(sig));
      return new Uint8Array(sig);
    },
    verify(signature: Uint8Array, message: Uint8Array, _publicKey: Uint8Array) {
      const expected = sigMap.get(Buffer.from(message).toString("hex"));
      if (!expected || expected.length !== signature.length) return false;
      for (let i = 0; i < expected.length; i++) {
        if (expected[i] !== signature[i]) return false;
      }
      return true;
    },
  };
}

/** Create a mock OQS-style class. */
function makeMockOqsClass() {
  const keys = makeMockKeys();
  const sigMap = new Map<string, Uint8Array>();

  class MockSignature {
    keypair() {
      return {
        secretKey: keys.secretKey.slice(),
        publicKey: keys.publicKey.slice(),
      };
    }
    sign(message: Uint8Array, secretKey: Uint8Array) {
      const sig = expandSignature(secretKey, message);
      sigMap.set(Buffer.from(message).toString("hex"), new Uint8Array(sig));
      return new Uint8Array(sig);
    }
    verify(message: Uint8Array, signature: Uint8Array, _publicKey: Uint8Array) {
      const expected = sigMap.get(Buffer.from(message).toString("hex"));
      if (!expected || expected.length !== signature.length) return false;
      for (let i = 0; i < expected.length; i++) {
        if (expected[i] !== signature[i]) return false;
      }
      return true;
    }
  }

  return MockSignature;
}

/** Create a plain naive Uint8ArraySigner (no keyGen). */
function makeMockNaiveSigner(): { sign(msg: Uint8Array): Uint8Array; verify(msg: Uint8Array, sig: Uint8Array): boolean } {
  const state = new Map<string, Uint8Array>();
  return {
    sign(msg: Uint8Array): Uint8Array {
      const sig = Buffer.alloc(ML_DSA_44_SIGNATURE_BYTES);
      for (let i = 0; i < msg.length && i < ML_DSA_44_SIGNATURE_BYTES; i++) sig[i] = msg[i] ^ 0xab;
      state.set(Buffer.from(msg).toString("hex"), sig);
      return sig;
    },
    verify(msg: Uint8Array, sig: Uint8Array): boolean {
      const expected = state.get(Buffer.from(msg).toString("hex"));
      if (!expected || expected.length !== sig.length) return false;
      for (let i = 0; i < expected.length; i++) if (expected[i] !== sig[i]) return false;
      return true;
    },
  };
}

// ─── Shape detection ─────────────────────────────────────────────────────────

test("isMlDsaCompiledModule: true for ml-dsa style module", () => {
  assert(isMlDsaCompiledModule(makeMockMlDsaModule()));
});

test("isMlDsaCompiledModule: true for noble style module (keygen lowercase)", () => {
  assert(isMlDsaCompiledModule(makeMockNobleModule()));
});

test("isMlDsaCompiledModule: false for plain object", () => {
  assert(!isMlDsaCompiledModule({}));
});

test("isMlDsaCompiledModule: false for naive Uint8ArraySigner", () => {
  assert(!isMlDsaCompiledModule(makeMockNaiveSigner()));
});

test("isOqsSignatureClass: true for OQS class", () => {
  assert(isOqsSignatureClass(makeMockOqsClass()));
});

test("isOqsSignatureClass: false for plain object", () => {
  assert(!isOqsSignatureClass({}));
});

test("isOqsSignatureClass: false for function without required prototype methods", () => {
  function NoProto() {}
  assert(!isOqsSignatureClass(NoProto));
});

// ─── wrapCompiledModule selection ────────────────────────────────────────────

test("wrapCompiledModule: ml-dsa style → MlDsaCompiledProvider", () => {
  const mod = makeMockMlDsaModule();
  const signer = wrapCompiledModule(mod);
  assert(signer);
  eq(typeof signer.sign, "function");
  eq(typeof signer.verify, "function");
});

test("wrapCompiledModule: noble style → MlDsaCompiledProvider", () => {
  const mod = makeMockNobleModule();
  const signer = wrapCompiledModule(mod);
  assert(signer);
  const msg = new TextEncoder().encode("hello-noble");
  const sig = signer.sign(msg);
  assert(signer.verify(msg, sig));
});

test("wrapCompiledModule: OQS class → MlDsaOqsClassProvider", () => {
  const cls = makeMockOqsClass();
  const signer = wrapCompiledModule(cls);
  assert(signer);
  const msg = new TextEncoder().encode("hello-oqs");
  const sig = signer.sign(msg);
  assert(signer.verify(msg, sig));
});

test("wrapCompiledModule: naive Uint8ArraySigner → pass-through", () => {
  const raw = makeMockNaiveSigner();
  const signer = wrapCompiledModule(raw);
  assert(signer);
  eq(signer, raw, "naive signer must pass through unchanged");
});

test("wrapCompiledModule: garbage → undefined", () => {
  eq(wrapCompiledModule({}), undefined);
  eq(wrapCompiledModule(null), undefined);
  eq(wrapCompiledModule(42), undefined);
});

test("wrapCompiledModule: ml-dsa module with bad keyGen → undefined (fail-closed)", () => {
  const mod = {
    keyGen() {
      return { secretKey: "not-a-buffer", publicKey: new Uint8Array(32) };
    },
    sign() {
      return new Uint8Array(ML_DSA_44_SIGNATURE_BYTES);
    },
    verify() {
      return true;
    },
  };
  eq(wrapCompiledModule(mod), undefined);
});

// ─── MlDsaCompiledProvider behaviour ─────────────────────────────────────────

test("MlDsaCompiledProvider: round-trip sign + verify", () => {
  const provider = new MlDsaCompiledProvider(makeMockMlDsaModule() as any);
  const msg = new TextEncoder().encode("round-trip");
  const sig = provider.sign(msg);
  assert(provider.verify(msg, sig));
});

test("MlDsaCompiledProvider: rejects tampered message", () => {
  const provider = new MlDsaCompiledProvider(makeMockMlDsaModule() as any);
  const msg = new TextEncoder().encode("original");
  const sig = provider.sign(msg);
  const tampered = new TextEncoder().encode("tampered");
  assert(!provider.verify(tampered, sig));
});

test("MlDsaCompiledProvider: rejects tampered signature", () => {
  const provider = new MlDsaCompiledProvider(makeMockMlDsaModule() as any);
  const msg = new TextEncoder().encode("original");
  const sig = provider.sign(msg);
  sig[0] = sig[0] ^ 0xff;
  assert(!provider.verify(msg, sig));
});

test("MlDsaCompiledProvider: cross-data check fails", () => {
  const provider = new MlDsaCompiledProvider(makeMockMlDsaModule() as any);
  const msgA = new TextEncoder().encode("data-a");
  const sigA = provider.sign(msgA);
  const msgB = new TextEncoder().encode("data-b");
  assert(!provider.verify(msgB, sigA));
});

test("MlDsaCompiledProvider: passes conformance suite via adapter", () => {
  const raw = new MlDsaCompiledProvider(makeMockMlDsaModule() as any);
  const provider = adaptPqcProvider(raw);
  const result = MlDsaProviderConformanceSuite(provider);
  eq(result.ok, true, `conformance failed: ${result.failures.join("; ")}`);
});

test("MlDsaCompiledProvider: constructor throws on non-object", () => {
  let threw = false;
  try {
    new MlDsaCompiledProvider(42 as any);
  } catch (e: any) {
    threw = true;
    assert(e instanceof SignerError);
    eq(e.code, "PROVIDER_REQUIRED");
  }
  assert(threw);
});

// ─── MlDsaOqsClassProvider behaviour ─────────────────────────────────────────

test("MlDsaOqsClassProvider: round-trip sign + verify", () => {
  const provider = new MlDsaOqsClassProvider(makeMockOqsClass() as any);
  const msg = new TextEncoder().encode("oqs-round-trip");
  const sig = provider.sign(msg);
  assert(provider.verify(msg, sig));
});

test("MlDsaOqsClassProvider: rejects tampered message", () => {
  const provider = new MlDsaOqsClassProvider(makeMockOqsClass() as any);
  const msg = new TextEncoder().encode("oqs-original");
  const sig = provider.sign(msg);
  const tampered = new TextEncoder().encode("oqs-tampered");
  assert(!provider.verify(tampered, sig));
});

test("MlDsaOqsClassProvider: rejects tampered signature", () => {
  const provider = new MlDsaOqsClassProvider(makeMockOqsClass() as any);
  const msg = new TextEncoder().encode("oqs-original");
  const sig = provider.sign(msg);
  sig[0] = sig[0] ^ 0xff;
  assert(!provider.verify(msg, sig));
});

test("MlDsaOqsClassProvider: passes conformance suite via adapter", () => {
  const raw = new MlDsaOqsClassProvider(makeMockOqsClass() as any);
  const provider = adaptPqcProvider(raw);
  const result = MlDsaProviderConformanceSuite(provider);
  eq(result.ok, true, `conformance failed: ${result.failures.join("; ")}`);
});

test("MlDsaOqsClassProvider: constructor throws on non-constructor", () => {
  let threw = false;
  try {
    new MlDsaOqsClassProvider({} as any);
  } catch (e: any) {
    threw = true;
    assert(e instanceof SignerError);
    eq(e.code, "PROVIDER_REQUIRED");
  }
  assert(threw);
});

test("MlDsaOqsClassProvider: constructor throws when instantiation fails", () => {
  class BadClass {
    constructor() {
      throw new Error("always fails");
    }
    keypair() {
      return { secretKey: new Uint8Array(32), publicKey: new Uint8Array(32) };
    }
    sign() {
      return new Uint8Array(ML_DSA_44_SIGNATURE_BYTES);
    }
    verify() {
      return true;
    }
  }
  let threw = false;
  try {
    new MlDsaOqsClassProvider(BadClass as any);
  } catch (e: any) {
    threw = true;
    assert(e instanceof SignerError);
    eq(e.code, "PROVIDER_REQUIRED");
  }
  assert(threw);
});

// ─── Integration with loader resolution (explicit provider path) ─────────────

test("resolveHybridMlDsaProvider: explicit compiled provider via wrapCompiledModule works end-to-end", async () => {
  // We cannot mock dynamic import in this harness, but we can prove the
  // explicit-provider path accepts a wrapped compiled module and the full
  // adapter → conformance chain succeeds.
  const { resolveHybridMlDsaProvider } = await import("../../lib/orchestrator/pqc-loader.ts");
  const raw = wrapCompiledModule(makeMockMlDsaModule());
  assert(raw);
  const signer = await resolveHybridMlDsaProvider({ provider: raw });
  eq(signer.algorithm, "ml-dsa-44-adapted");
  const sig = signer.sign("compiled-provider-integration");
  assert(signer.verify("compiled-provider-integration", sig));
  const conf = MlDsaProviderConformanceSuite(signer);
  eq(conf.ok, true, `conformance failed: ${conf.failures.join("; ")}`);
});

// ─── publicKey exposure → kid derivation (PQC sub-step 5) ───────────────────
// Both compiled wrappers generate a REAL keypair on construction (this was
// already true before sub-step 5); this section verifies the public half is
// now exposed as `publicKey` so adaptPqcProvider can derive a stable `kid` —
// the secret key remains private and is never exposed.

test("MlDsaCompiledProvider: exposes the real publicKey from keyGen", () => {
  const keys = makeMockKeys();
  const provider = new MlDsaCompiledProvider(makeMockMlDsaModule() as any);
  eq(Buffer.from(provider.publicKey).toString("hex"), Buffer.from(keys.publicKey).toString("hex"));
});

test("MlDsaOqsClassProvider: exposes the real publicKey from keypair()", () => {
  const keys = makeMockKeys();
  const provider = new MlDsaOqsClassProvider(makeMockOqsClass() as any);
  eq(Buffer.from(provider.publicKey).toString("hex"), Buffer.from(keys.publicKey).toString("hex"));
});

test("adaptPqcProvider(MlDsaCompiledProvider): kid is derived from the real publicKey", () => {
  const provider = new MlDsaCompiledProvider(makeMockMlDsaModule() as any);
  const signer = adaptPqcProvider(provider);
  assert(signer.kid !== undefined, "kid should be derived once a real publicKey is present");
  eq(typeof signer.kid, "string");
  eq((signer.kid as string).length, 16);
});

test("adaptPqcProvider(MlDsaCompiledProvider): kid is stable across independently-constructed instances with the same keys", () => {
  // makeMockMlDsaModule() always returns the same publicKey (makeMockKeys is
  // deterministic), so two separately-constructed providers must agree.
  const signerA = adaptPqcProvider(new MlDsaCompiledProvider(makeMockMlDsaModule() as any));
  const signerB = adaptPqcProvider(new MlDsaCompiledProvider(makeMockMlDsaModule() as any));
  eq(signerA.kid, signerB.kid, "same public key bytes must yield the same kid");
});
