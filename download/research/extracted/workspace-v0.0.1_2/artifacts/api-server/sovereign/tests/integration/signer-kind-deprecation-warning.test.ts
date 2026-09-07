/**
 * tests/integration/signer-kind-deprecation-warning.test.ts — updated v208
 *
 * Previously tested the DeprecationWarning emitted when the default was HMAC.
 * Now that the default is Ed25519 (M4 sub-step 3), the warning is gone.
 * This file now verifies:
 *   1. Default (no opts, no env) → Ed25519, non-null publicKey, NO warning.
 *   2. opts.signerKind="hmac" explicit → HMAC, no warning.
 *   3. opts.signerKind="ed25519" explicit → Ed25519, non-null publicKey, no warning.
 *   4. TFA_SIGNER_KIND=hmac → HMAC, no warning.
 *   5. TFA_SIGNER_KIND=ed25519 → Ed25519, non-null publicKey, no warning.
 *   6. Legacy string-arg form → HMAC (backward compat), no warning.
 *   7. Fail-closed: invalid TFA_SIGNER_KIND still throws.
 */

import { test, assert, eq } from "../_harness.mjs";
import { buildSovereignStack, defaultPolicies } from "../../src/composition.ts";

function captureStderr(fn: () => void): string {
  const chunks: string[] = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  (process.stderr as any).write = (chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  };
  try { fn(); } finally { (process.stderr as any).write = origWrite; }
  return chunks.join("");
}

function withEnv(key: string, value: string | undefined, fn: () => void): void {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try { fn(); } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

// 1. Default (no opts, no env) → Ed25519, no warning (DeprecationWarning is gone).
test("signer-kind: default (no opts, no env) is now Ed25519 — no DeprecationWarning", () => {
  withEnv("TFA_SIGNER_KIND", undefined, () => {
    const stderr = captureStderr(() => {
      const stack = buildSovereignStack();
      eq(stack.signer.algorithm, "ed25519", "default signer should be Ed25519");
      assert(typeof stack.publicKey === "string" && stack.publicKey.length > 0, "publicKey non-null for Ed25519");
    });
    assert(!stderr.includes("DeprecationWarning"),
      `DeprecationWarning removed in M4 sub-step 3, should not appear: ${JSON.stringify(stderr)}`);
  });
});

// 2. opts.signerKind="hmac" explicit → HMAC, no warning.
test("signer-kind: opts.signerKind='hmac' explicit → HMAC, publicKey=null", () => {
  withEnv("TFA_SIGNER_KIND", undefined, () => {
    const stderr = captureStderr(() => {
      const stack = buildSovereignStack(defaultPolicies(), { signerKind: "hmac" });
      eq(stack.signer.algorithm, "hmac-sha256");
      eq(stack.publicKey, null);
    });
    assert(!stderr.includes("DeprecationWarning"), `unexpected warning: ${JSON.stringify(stderr)}`);
  });
});

// 3. opts.signerKind="ed25519" explicit → Ed25519, non-null publicKey.
test("signer-kind: opts.signerKind='ed25519' explicit → Ed25519, non-null publicKey", () => {
  withEnv("TFA_SIGNER_KIND", undefined, () => {
    const stack = buildSovereignStack(defaultPolicies(), { signerKind: "ed25519" });
    eq(stack.signer.algorithm, "ed25519");
    assert(stack.publicKey !== null, "publicKey should be set for Ed25519");
  });
});

// 4. TFA_SIGNER_KIND=hmac in env → HMAC.
test("signer-kind: TFA_SIGNER_KIND=hmac env → HMAC, publicKey=null", () => {
  withEnv("TFA_SIGNER_KIND", "hmac", () => {
    const stack = buildSovereignStack();
    eq(stack.signer.algorithm, "hmac-sha256");
    eq(stack.publicKey, null);
  });
});

// 5. TFA_SIGNER_KIND=ed25519 in env → Ed25519.
test("signer-kind: TFA_SIGNER_KIND=ed25519 env → Ed25519, non-null publicKey", () => {
  withEnv("TFA_SIGNER_KIND", "ed25519", () => {
    const stack = buildSovereignStack();
    eq(stack.signer.algorithm, "ed25519");
    assert(stack.publicKey !== null, "publicKey should be set");
  });
});

// 6. Legacy string-arg form → HMAC (backward compat unchanged).
test("signer-kind: legacy string auditSecret arg → HMAC (backward compat)", () => {
  withEnv("TFA_SIGNER_KIND", undefined, () => {
    const stack = buildSovereignStack(defaultPolicies(), "my-legacy-secret-32bytes-long!!");
    eq(stack.signer.algorithm, "hmac-sha256");
    eq(stack.publicKey, null);
  });
});

// 7. Fail-closed: invalid TFA_SIGNER_KIND still throws.
test("signer-kind: invalid TFA_SIGNER_KIND still throws (fail-closed unchanged)", () => {
  withEnv("TFA_SIGNER_KIND", "rsa", () => {
    let threw = false;
    try { buildSovereignStack(); } catch (e: any) {
      threw = true;
      assert(e.message.includes("TFA_SIGNER_KIND"), "error should mention TFA_SIGNER_KIND");
      assert(e.message.includes("rsa"), "error should include the bad value");
    }
    assert(threw, "should have thrown for invalid TFA_SIGNER_KIND");
  });
});
