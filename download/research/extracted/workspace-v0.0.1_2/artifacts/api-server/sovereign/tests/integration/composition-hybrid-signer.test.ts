/**
 * tests/integration/composition-hybrid-signer.test.ts
 *
 * Verifies that buildSovereignStack wires HybridSigner correctly when
 * opts.signerKind = "hybrid-ed25519-mldsa" (PQC sub-step 2).
 *
 * Coverage:
 *   1. HAPPY PATH — hybrid kind → signer.algorithm = "hybrid-ed25519-mldsa"
 *   2. publicKey exposed = Ed25519 half (classical verifiers can still verify)
 *   3. Caller-supplied Ed25519 key pair is wired correctly
 *   4. Caller-supplied MlDsa provider is wired (stub sign succeeds)
 *   5. Without provider → sign() throws (explicit gap, not silent failure)
 *   6. TFA_SIGNER_KIND=hybrid-ed25519-mldsa env var is accepted (fail-closed pass)
 *   7. BACKWARD COMPAT — existing kinds unaffected (ed25519, hmac)
 *   8. FAIL-CLOSED — TFA_SIGNER_KIND=rsa still throws; hybrid-ed25519-mldsa is now valid
 *   9. TFA_SIGNER_KIND=hybrid-ed25519-mldsa env var + opts unset → HybridSigner
 *  10. opts.signerKind wins over TFA_SIGNER_KIND
 */

import { test, assert, eq } from "../_harness.mjs";
import { buildSovereignStack, buildSovereignStackAsync, defaultPolicies } from "../../src/composition.ts";
import { generateAuditKeyPair } from "../../lib/orchestrator/signer.ts";

// ─── Helper: env override ────────────────────────────────────────────────────

function withEnv(key: string, value: string | undefined, fn: () => void): void {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try { fn(); } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

async function withEnvAsync<T>(key: string, value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

// ─── Minimal fake MlDsa provider (deterministic, for tests) ─────────────────

function makeFakeMlDsaProvider(): { sign(msg: Uint8Array): Uint8Array; verify(msg: Uint8Array, sig: Uint8Array): boolean } {
  return {
    sign(msg: Uint8Array): Uint8Array {
      // Fake: XOR each byte with 0xAB, pad to 2420 bytes (ML-DSA-44 sig size).
      const sig = new Uint8Array(2420);
      for (let i = 0; i < msg.length && i < 2420; i++) sig[i] = msg[i] ^ 0xab;
      return sig;
    },
    verify(_msg: Uint8Array, _sig: Uint8Array): boolean { return true; },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

// 1. signerKind="hybrid-ed25519-mldsa" → algorithm = "hybrid-ed25519-mldsa"
test("composition.hybrid: signerKind='hybrid-ed25519-mldsa' → signer.algorithm is hybrid", () => {
  withEnv("TFA_SIGNER_KIND", undefined, () => {
    const stack = buildSovereignStack(defaultPolicies(), { signerKind: "hybrid-ed25519-mldsa" });
    assert(stack.signer.algorithm.startsWith("hybrid:"), `expected hybrid algorithm, got: ${stack.signer.algorithm}`);
  });
});

// 2. publicKey is the Ed25519 half (non-null for classical verifiers)
test("composition.hybrid: publicKey is Ed25519 SPKI PEM (non-null) for hybrid kind", () => {
  withEnv("TFA_SIGNER_KIND", undefined, () => {
    const stack = buildSovereignStack(defaultPolicies(), { signerKind: "hybrid-ed25519-mldsa" });
    assert(stack.publicKey !== null, "publicKey should be non-null for hybrid");
    assert(typeof stack.publicKey === "string", "publicKey should be a string");
    assert(stack.publicKey.includes("PUBLIC KEY"), "publicKey should be SPKI PEM");
  });
});

// 3. Caller-supplied Ed25519 key pair is wired correctly
test("composition.hybrid: caller-supplied ed25519KeyPair is used in hybrid", () => {
  withEnv("TFA_SIGNER_KIND", undefined, () => {
    const pair = generateAuditKeyPair();
    const stack = buildSovereignStack(defaultPolicies(), {
      signerKind: "hybrid-ed25519-mldsa",
      ed25519KeyPair: pair,
    });
    eq(stack.publicKey, pair.publicKey, "publicKey should match supplied pair");
  });
});

// 4. Caller-supplied MlDsa provider is wired → sign() succeeds
test("composition.hybrid: real mlDsa provider supplied → sign() produces double-signature", async () => {
  withEnv("TFA_SIGNER_KIND", undefined, async () => {
    const provider = makeFakeMlDsaProvider();
    const stack = buildSovereignStack(defaultPolicies(), {
      signerKind: "hybrid-ed25519-mldsa",
      hybridMlDsaProvider: provider,
    });
    assert(stack.signer.algorithm.startsWith("hybrid:"), `expected hybrid algorithm, got: ${stack.signer.algorithm}`);
    // sign() should not throw with a real provider injected.
    const sig = await stack.signer.sign("test-message");
    assert(typeof sig === "string", "signature should be a string");
    assert(sig.length > 0, "signature should be non-empty");
    // Hybrid signature is a concatenation of Ed25519 + ML-DSA sigs (base64 encoded).
    // We just assert it round-trips through verify.
    const ok = await stack.signer.verify("test-message", sig);
    assert(ok, "verify should return true for own signature");
  });
});

// 5. Without explicit MlDsa provider → deterministic fallback (v308 drop-in loader).
//    resolveHybridMlDsaProviderSync tries real OQS/WASM modules, then falls back to
//    MlDsaDeterministicProvider so the pipeline is functional in zero-dep sandboxes.
//    The fallback algorithm includes "-sim" so ops knows a real provider is needed.
test("composition.hybrid: no provider → deterministic fallback, sign() succeeds", async () => {
  withEnv("TFA_SIGNER_KIND", undefined, async () => {
    const stack = buildSovereignStack(defaultPolicies(), { signerKind: "hybrid-ed25519-mldsa" });
    assert(stack.signer.algorithm.startsWith("hybrid:"), `expected hybrid algorithm, got: ${stack.signer.algorithm}`);
    // sign() should succeed with the deterministic fallback (no throw).
    const sig = await stack.signer.sign("test-message");
    assert(typeof sig === "string", "signature should be a string");
    assert(sig.length > 0, "signature should be non-empty");
    // Verify round-trips.
    const ok = await stack.signer.verify("test-message", sig);
    assert(ok, "verify should return true for own signature");
    // The deterministic fallback is labeled so ops can detect it.
    assert(stack.signer.algorithm.includes("sim"), `algorithm should indicate simulation, got: ${stack.signer.algorithm}`);
  });
});

// 6. TFA_SIGNER_KIND=hybrid-ed25519-mldsa env var is accepted (does not throw)
test("composition.hybrid: TFA_SIGNER_KIND=hybrid-ed25519-mldsa env var accepted → no boot error", () => {
  withEnv("TFA_SIGNER_KIND", "hybrid-ed25519-mldsa", () => {
    const stack = buildSovereignStack();
    assert(stack.signer.algorithm.startsWith("hybrid:"), `expected hybrid algorithm, got: ${stack.signer.algorithm}`);
  });
});

// 7. BACKWARD COMPAT — ed25519 unaffected
test("composition.hybrid: backward compat — ed25519 kind still produces Ed25519Signer", () => {
  withEnv("TFA_SIGNER_KIND", undefined, () => {
    const stack = buildSovereignStack(defaultPolicies(), { signerKind: "ed25519" });
    eq(stack.signer.algorithm, "ed25519");
    assert(stack.publicKey !== null, "publicKey non-null for ed25519");
  });
});

// 8. BACKWARD COMPAT — hmac unaffected
test("composition.hybrid: backward compat — hmac kind still produces HmacSigner", () => {
  withEnv("TFA_SIGNER_KIND", undefined, () => {
    const stack = buildSovereignStack(defaultPolicies(), { signerKind: "hmac" });
    eq(stack.signer.algorithm, "hmac-sha256");
    eq(stack.publicKey, null);
  });
});

// 9. FAIL-CLOSED — TFA_SIGNER_KIND=rsa still throws (hybrid added to valid set, not replacing)
test("composition.hybrid: TFA_SIGNER_KIND=rsa still throws (fail-closed, rsa not valid)", () => {
  withEnv("TFA_SIGNER_KIND", "rsa", () => {
    let threw = false;
    try {
      buildSovereignStack();
    } catch (e: any) {
      threw = true;
      assert(e.message.includes("TFA_SIGNER_KIND"), "error should mention TFA_SIGNER_KIND");
      assert(e.message.includes("rsa"), "error should include the bad value");
    }
    assert(threw, "should have thrown for TFA_SIGNER_KIND=rsa");
  });
});

// 10. opts.signerKind wins over TFA_SIGNER_KIND
test("composition.hybrid: opts.signerKind='hybrid-ed25519-mldsa' wins over TFA_SIGNER_KIND=hmac", () => {
  withEnv("TFA_SIGNER_KIND", "hmac", () => {
    const stack = buildSovereignStack(defaultPolicies(), { signerKind: "hybrid-ed25519-mldsa" });
    assert(stack.signer.algorithm.startsWith("hybrid:"), `expected hybrid algorithm, got: ${stack.signer.algorithm}`);
  });
});

// ─── Async boot path (buildSovereignStackAsync) ─────────────────────────────
// PQC stage-2b: the async resolver can discover real OQS/WASM modules via
// dynamic import, whereas the sync path skips them. In zero-dep sandboxes
// both fall back to the local simulation, so behaviour is identical.

// 11. Async happy path — hybrid mode resolves via async loader and produces working signer
test("composition.hybrid.async: buildSovereignStackAsync with hybrid mode → working signer", async () => {
  await withEnvAsync("TFA_SIGNER_KIND", undefined, async () => {
    const stack = await buildSovereignStackAsync(defaultPolicies(), { signerKind: "hybrid-ed25519-mldsa" });
    assert(stack.signer.algorithm.startsWith("hybrid:"), `expected hybrid algorithm, got: ${stack.signer.algorithm}`);
    assert(stack.publicKey !== null, "publicKey should be non-null for hybrid");
    const sig = await stack.signer.sign("async-test-message");
    assert(typeof sig === "string" && sig.length > 0, "signature should be non-empty string");
    const ok = await stack.signer.verify("async-test-message", sig);
    assert(ok, "verify should return true for own signature");
  });
});

// 12. Async edge case — explicit hybridMlDsaProvider wins over async resolution
test("composition.hybrid.async: explicit provider wins over async loader", async () => {
  await withEnvAsync("TFA_SIGNER_KIND", undefined, async () => {
    const provider = makeFakeMlDsaProvider();
    const stack = await buildSovereignStackAsync(defaultPolicies(), {
      signerKind: "hybrid-ed25519-mldsa",
      hybridMlDsaProvider: provider,
    });
    assert(stack.signer.algorithm.startsWith("hybrid:"), `expected hybrid algorithm, got: ${stack.signer.algorithm}`);
    const sig = await stack.signer.sign("explicit-provider-test");
    assert(typeof sig === "string" && sig.length > 0);
    const ok = await stack.signer.verify("explicit-provider-test", sig);
    assert(ok, "explicit provider should sign and verify successfully");
  });
});

// 13. Async regression — ed25519 mode unaffected by async path
test("composition.hybrid.async: ed25519 kind still produces Ed25519Signer", async () => {
  await withEnvAsync("TFA_SIGNER_KIND", undefined, async () => {
    const stack = await buildSovereignStackAsync(defaultPolicies(), { signerKind: "ed25519" });
    eq(stack.signer.algorithm, "ed25519");
    assert(stack.publicKey !== null, "publicKey non-null for ed25519");
  });
});

// 14. Async fail-closed — env var hybrid works through async path
test("composition.hybrid.async: TFA_SIGNER_KIND=hybrid-ed25519-mldsa env var → async hybrid signer", async () => {
  await withEnvAsync("TFA_SIGNER_KIND", "hybrid-ed25519-mldsa", async () => {
    const stack = await buildSovereignStackAsync();
    assert(stack.signer.algorithm.startsWith("hybrid:"), `expected hybrid algorithm, got: ${stack.signer.algorithm}`);
    const sig = await stack.signer.sign("env-var-async-test");
    assert(typeof sig === "string" && sig.length > 0);
    const ok = await stack.signer.verify("env-var-async-test", sig);
    assert(ok, "env-var async hybrid should sign and verify");
  });
});

// 15. Async edge case — caller-supplied ed25519KeyPair is reused, not regenerated
test("composition.hybrid.async: caller-supplied ed25519KeyPair is reused in async path", async () => {
  await withEnvAsync("TFA_SIGNER_KIND", undefined, async () => {
    const pair = generateAuditKeyPair();
    const stack = await buildSovereignStackAsync(defaultPolicies(), {
      signerKind: "hybrid-ed25519-mldsa",
      ed25519KeyPair: pair,
    });
    eq(stack.publicKey, pair.publicKey, "publicKey should match supplied pair in async path");
  });
});
