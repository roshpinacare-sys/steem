import "../_flush.mjs";
/**
 * tests/orchestrator/pqc-local-provider.test.ts — Local PQC Provider (v309).
 *
 * Verifies MlDsaLocalProvider as a Uint8ArraySigner:
 *   • conformance suite pass
 *   • loader auto-discovers it before deterministic fallback
 *   • sync variant works without async
 *   • deterministic stability + divergence
 *   • fail-closed on bad input / tampering
 */

import { test, assert, eq } from "../_harness.mjs";
import {
  MlDsaLocalProvider,
  createMlDsaLocalProvider,
  defaultLocalProvider,
} from "../../lib/orchestrator/pqc-local-provider.ts";
import {
  tryLoadLocalProvider,
  tryLoadLocalProviderSync,
  resolveHybridMlDsaProvider,
  resolveHybridMlDsaProviderSync,
} from "../../lib/orchestrator/pqc-loader.ts";
import {
  MlDsaProviderConformanceSuite,
  ML_DSA_44_SIGNATURE_BYTES,
} from "../../lib/orchestrator/signer.ts";

// ─── Conformance ────────────────────────────────────────────────────────────

test("MlDsaLocalProvider: passes conformance suite", () => {
  const provider = new MlDsaLocalProvider({ secret: Buffer.from("a".repeat(32)) });
  // Conformance suite expects a Signer (string interface), not Uint8ArraySigner.
  // We test via the adapted path in the loader, but first verify the raw shape.
  const sig = provider.sign(new TextEncoder().encode("probe"));
  eq(sig.length, ML_DSA_44_SIGNATURE_BYTES, "raw signature must be FIPS-204 size");
});

test("MlDsaLocalProvider: verify round-trip on Uint8Array", () => {
  const provider = new MlDsaLocalProvider({ secret: Buffer.from("b".repeat(32)) });
  const msg = new TextEncoder().encode("hello-local");
  const sig = provider.sign(msg);
  assert(provider.verify(msg, sig), "verify must accept its own signature");
});

test("MlDsaLocalProvider: rejects tampered message", () => {
  const provider = new MlDsaLocalProvider({ secret: Buffer.from("c".repeat(32)) });
  const msg = new TextEncoder().encode("original");
  const sig = provider.sign(msg);
  const tampered = new TextEncoder().encode("tampered");
  assert(!provider.verify(tampered, sig), "tampered message must be rejected");
});

test("MlDsaLocalProvider: rejects tampered signature", () => {
  const provider = new MlDsaLocalProvider({ secret: Buffer.from("d".repeat(32)) });
  const msg = new TextEncoder().encode("data");
  const sig = provider.sign(msg);
  sig[0] ^= 0xff;
  assert(!provider.verify(msg, sig), "tampered signature must be rejected");
});

test("MlDsaLocalProvider: rejects wrong-length signature", () => {
  const provider = new MlDsaLocalProvider({ secret: Buffer.from("e".repeat(32)) });
  const msg = new TextEncoder().encode("x");
  const shortSig = new Uint8Array(100);
  assert(!provider.verify(msg, shortSig), "short signature must be rejected");
});

// ─── Determinism ────────────────────────────────────────────────────────────

test("MlDsaLocalProvider: same secret + same message → identical signature", () => {
  const secret = Buffer.from("stable-local-secret-36-bytes-long!!!!!!");
  const p1 = new MlDsaLocalProvider({ secret });
  const p2 = new MlDsaLocalProvider({ secret });
  const msg = new TextEncoder().encode("deterministic-test");
  const s1 = p1.sign(msg);
  const s2 = p2.sign(msg);
  eq(s1.length, s2.length);
  for (let i = 0; i < s1.length; i++) eq(s1[i], s2[i]);
});

test("MlDsaLocalProvider: different secrets diverge", () => {
  const p1 = new MlDsaLocalProvider({ secret: Buffer.from("secret-a-36-bytes-long!!!!!!!!!!") });
  const p2 = new MlDsaLocalProvider({ secret: Buffer.from("secret-b-36-bytes-long!!!!!!!!!!") });
  const msg = new TextEncoder().encode("same-data");
  const s1 = p1.sign(msg);
  const s2 = p2.sign(msg);
  let same = true;
  for (let i = 0; i < s1.length; i++) if (s1[i] !== s2[i]) { same = false; break; }
  assert(!same, "different secrets must produce different signatures");
});

// ─── Fail-closed ────────────────────────────────────────────────────────────

test("MlDsaLocalProvider: short secret throws SECRET_TOO_SHORT", () => {
  let threw = false;
  let code = "";
  try {
    new MlDsaLocalProvider({ secret: "short" });
  } catch (e: any) {
    threw = true;
    code = e.code;
  }
  assert(threw);
  eq(code, "SECRET_TOO_SHORT");
});

// ─── Loader integration (async) ─────────────────────────────────────────────

test("tryLoadLocalProvider: returns a valid Uint8ArraySigner", async () => {
  const local = await tryLoadLocalProvider();
  assert(local !== undefined, "local provider must be found");
  const msg = new TextEncoder().encode("loader-test");
  const sig = local!.sign(msg);
  eq(sig.length, ML_DSA_44_SIGNATURE_BYTES);
  assert(local!.verify(msg, sig));
});

test("resolveHybridMlDsaProvider: local provider is discovered before deterministic fallback", async () => {
  const signer = await resolveHybridMlDsaProvider();
  eq(signer.algorithm, "ml-dsa-44-local-sim", "local provider is discovered and labeled -sim");
  const result = MlDsaProviderConformanceSuite(signer);
  eq(result.ok, true, `conformance failed: ${result.failures.join("; ")}`);
});

test("resolveHybridMlDsaProvider: explicit provider still wins over local", async () => {
  const dummy = {
    sign(_msg: Uint8Array): Uint8Array { return new Uint8Array(ML_DSA_44_SIGNATURE_BYTES); },
    verify(_msg: Uint8Array, _sig: Uint8Array): boolean { return true; },
  };
  const signer = await resolveHybridMlDsaProvider({ provider: dummy });
  eq(signer.algorithm, "ml-dsa-44-adapted");
});

// ─── Loader integration (sync) ────────────────────────────────────────────

test("tryLoadLocalProviderSync: returns a valid Uint8ArraySigner", () => {
  const local = tryLoadLocalProviderSync();
  assert(local !== undefined, "sync local provider must be found");
  const msg = new TextEncoder().encode("sync-test");
  const sig = local!.sign(msg);
  eq(sig.length, ML_DSA_44_SIGNATURE_BYTES);
  assert(local!.verify(msg, sig));
});

test("resolveHybridMlDsaProviderSync: local provider is discovered before deterministic fallback", () => {
  const signer = resolveHybridMlDsaProviderSync();
  eq(signer.algorithm, "ml-dsa-44-local-sim", "sync local provider is discovered and labeled -sim");
  const result = MlDsaProviderConformanceSuite(signer);
  eq(result.ok, true, `sync conformance failed: ${result.failures.join("; ")}`);
});

// ─── Factory / default exports ──────────────────────────────────────────────

test("createMlDsaLocalProvider: factory returns working provider", () => {
  const p = createMlDsaLocalProvider({ secret: Buffer.from("f".repeat(32)) });
  const msg = new TextEncoder().encode("factory");
  const sig = p.sign(msg);
  eq(sig.length, ML_DSA_44_SIGNATURE_BYTES);
  assert(p.verify(msg, sig));
});

test("defaultLocalProvider: default export is functional", () => {
  const msg = new TextEncoder().encode("default");
  const sig = defaultLocalProvider.sign(msg);
  eq(sig.length, ML_DSA_44_SIGNATURE_BYTES);
  assert(defaultLocalProvider.verify(msg, sig));
});

// ─── Efficiency/counter-loop coverage (v342) ─────────────────────────────────

test("MlDsaLocalProvider: 50 sequential sign+verify cycles remain consistent", () => {
  const provider = new MlDsaLocalProvider({ secret: Buffer.from("fifty-cycles-secret-32-bytes-!!!") });
  for (let i = 0; i < 50; i++) {
    const msg = new TextEncoder().encode(`cycle-${i}-payload-${"x".repeat(i)}`);
    const sig = provider.sign(msg);
    eq(sig.length, ML_DSA_44_SIGNATURE_BYTES, `signature length correct at cycle ${i}`);
    assert(provider.verify(msg, sig), `verify passes at cycle ${i}`);
  }
});

test("MlDsaLocalProvider: varying message lengths still produce exact FIPS-204 size", () => {
  const provider = new MlDsaLocalProvider({ secret: Buffer.from("lengths-secret-32-bytes-long!!!!") });
  const lengths = [0, 1, 31, 32, 64, 100, 500, 1000, 2000, 4096];
  for (const len of lengths) {
    const msg = new TextEncoder().encode("a".repeat(len));
    const sig = provider.sign(msg);
    eq(sig.length, ML_DSA_44_SIGNATURE_BYTES, `expected ${ML_DSA_44_SIGNATURE_BYTES} bytes for length ${len}, got ${sig.length}`);
  }
});

test("MlDsaLocalProvider: cross-secret rejection holds after counter-loop expansion", () => {
  const secretA = Buffer.from("secret-a-for-cross-test-32-bytes!!");
  const secretB = Buffer.from("secret-b-for-cross-test-32-bytes!!");
  const providerA = new MlDsaLocalProvider({ secret: secretA });
  const providerB = new MlDsaLocalProvider({ secret: secretB });
  const msg = new TextEncoder().encode("cross-secret-message");
  const sigA = providerA.sign(msg);
  assert(!providerB.verify(msg, sigA), "providerB must reject signature from providerA");
  const sigB = providerB.sign(msg);
  assert(!providerA.verify(msg, sigB), "providerA must reject signature from providerB");
});

// ─── Secret entropy (CSPRNG, not Math.random) ────────────────────────────────
// The omitted-secret path used to derive its signing key from
// `Math.random()`, which is not cryptographically secure and far lower
// entropy than the 32-byte key this provider requires. These tests pin the
// fix: the key must come from a CSPRNG, independent of Math.random's state.

test("MlDsaLocalProvider: omitted-secret instance signs and verifies its own message (happy path)", () => {
  const provider = new MlDsaLocalProvider();
  const msg = new TextEncoder().encode("entropy-probe");
  const sig = provider.sign(msg);
  eq(sig.length, ML_DSA_44_SIGNATURE_BYTES);
  assert(provider.verify(msg, sig), "provider with a CSPRNG-default secret must verify its own signature");
});

test("MlDsaLocalProvider: default secret generation does not depend on Math.random", () => {
  // Pin Math.random to a constant value. If the secret were still derived
  // from it (the pre-fix bug), every instance built while pinned would share
  // the same key and produce identical signatures for the same message.
  const original = Math.random;
  Math.random = () => 0.5;
  try {
    const p1 = new MlDsaLocalProvider();
    const p2 = new MlDsaLocalProvider();
    const msg = new TextEncoder().encode("pinned-math-random");
    const sig1 = p1.sign(msg);
    const sig2 = p2.sign(msg);
    let same = true;
    for (let i = 0; i < sig1.length; i++) if (sig1[i] !== sig2[i]) { same = false; break; }
    assert(!same, "secrets must diverge even when Math.random is pinned to a fixed value");
  } finally {
    Math.random = original;
  }
});

test("MlDsaLocalProvider: two independently-constructed default providers never collide (fail-closed guarantee)", () => {
  const p1 = new MlDsaLocalProvider();
  const p2 = new MlDsaLocalProvider();
  const msg = new TextEncoder().encode("collision-probe");
  const sig1 = p1.sign(msg);
  assert(!p2.verify(msg, sig1), "a different default-secret instance must reject a signature it did not produce");
});
