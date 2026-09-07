import "../_flush.mjs";
/**
 * tests/integration/composition-signer-kind-env.test.ts — v206 (M4 sub-step 1).
 *
 * Verifies the new `TFA_SIGNER_KIND` environment-variable fallback for
 * `buildSovereignStack`'s signer selection — the first sub-step toward making
 * Ed25519 the default signer ("Ed25519-first" per MANIFEST החסר הבא #4).
 *
 * Precedence (highest to lowest):
 *   1. `opts.signerKind` (explicit, including the legacy string-arg form which
 *      normalizes to `{ signerKind: "hmac", auditSecret: opts }`)
 *   2. `process.env.TFA_SIGNER_KIND` (must be exactly "ed25519" or "hmac")
 *   3. "hmac" (unchanged backward-compat default)
 *
 *   HAPPY      TFA_SIGNER_KIND=ed25519 with no opts ⇒ Ed25519 stack, publicKey set.
 *   HAPPY      TFA_SIGNER_KIND=hmac with no opts ⇒ HMAC stack, publicKey=null.
 *   PRECEDENCE explicit opts.signerKind="hmac" overrides TFA_SIGNER_KIND=ed25519.
 *   PRECEDENCE explicit opts.signerKind="ed25519" overrides TFA_SIGNER_KIND=hmac.
 *   PRECEDENCE legacy string-arg form (signerKind="hmac" implicitly) overrides
 *              TFA_SIGNER_KIND=ed25519.
 *   EDGE       unset TFA_SIGNER_KIND ⇒ unchanged default ("hmac", publicKey=null) —
 *              proves this change is backward-compatible for every existing caller.
 *   FAIL-CLOSED TFA_SIGNER_KIND="bogus" ⇒ buildSovereignStack throws (does not
 *              silently fall back to hmac or ed25519).
 *
 * All tests save/restore process.env.TFA_SIGNER_KIND so they cannot leak state
 * to other test files (each test file runs in its own process anyway, but this
 * also protects later tests within this same file).
 */

import { test, assert, eq } from "../_harness.mjs";
import { buildSovereignStack, defaultPolicies } from "../../src/composition.ts";

async function withEnv(value: string | undefined, fn: () => void | Promise<void>) {
  const proc = (globalThis as any).process;
  const prev = proc.env.TFA_SIGNER_KIND;
  if (value === undefined) delete proc.env.TFA_SIGNER_KIND;
  else proc.env.TFA_SIGNER_KIND = value;
  try {
    await fn();
  } finally {
    if (prev === undefined) delete proc.env.TFA_SIGNER_KIND;
    else proc.env.TFA_SIGNER_KIND = prev;
  }
}

// ─── Happy path ─────────────────────────────────────────────────────────────

test("composition.signer-kind-env: TFA_SIGNER_KIND=ed25519 with no opts produces Ed25519 stack", async () => {
  await withEnv("ed25519", () => {
    const stack = buildSovereignStack();
    eq(stack.signer.algorithm, "ed25519");
    assert(stack.publicKey !== null, "publicKey must be exposed when TFA_SIGNER_KIND=ed25519");
    assert(stack.publicKey!.includes("BEGIN PUBLIC KEY"), "publicKey is SPKI PEM");
  });
});

test("composition.signer-kind-env: TFA_SIGNER_KIND=hmac with no opts produces HMAC stack", async () => {
  await withEnv("hmac", () => {
    const stack = buildSovereignStack();
    eq(stack.signer.algorithm, "hmac-sha256");
    eq(stack.publicKey, null);
  });
});

// ─── Precedence: explicit opts always win ──────────────────────────────────

test("composition.signer-kind-env: explicit opts.signerKind='hmac' overrides TFA_SIGNER_KIND=ed25519", async () => {
  await withEnv("ed25519", () => {
    const stack = buildSovereignStack(defaultPolicies(), { signerKind: "hmac" });
    eq(stack.signer.algorithm, "hmac-sha256");
    eq(stack.publicKey, null);
  });
});

test("composition.signer-kind-env: explicit opts.signerKind='ed25519' overrides TFA_SIGNER_KIND=hmac", async () => {
  await withEnv("hmac", () => {
    const stack = buildSovereignStack(defaultPolicies(), { signerKind: "ed25519" });
    eq(stack.signer.algorithm, "ed25519");
    assert(stack.publicKey !== null, "publicKey must be exposed");
  });
});

test("composition.signer-kind-env: legacy string-arg form overrides TFA_SIGNER_KIND=ed25519 (still HMAC)", async () => {
  await withEnv("ed25519", () => {
    const stack = buildSovereignStack(defaultPolicies(), "my-secret-at-least-16-bytes");
    eq(stack.signer.algorithm, "hmac-sha256");
    eq(stack.publicKey, null);
  });
});

// ─── Backward compat: unset env now gives Ed25519 (new default) ───────────

test("composition.signer-kind-env: unset TFA_SIGNER_KIND gives Ed25519 default (M4 sub-step 3)", async () => {
  await withEnv(undefined, () => {
    const stack = buildSovereignStack();
    eq(stack.signer.algorithm, "ed25519");
    assert(stack.publicKey !== null, "publicKey must be non-null for Ed25519 default");
  });
});

// ─── Fail-closed on invalid env value ──────────────────────────────────────

test("composition.signer-kind-env: TFA_SIGNER_KIND='bogus' throws (fail-closed, no silent fallback)", async () => {
  await withEnv("bogus", () => {
    let threw = false;
    try {
      buildSovereignStack();
    } catch (e: any) {
      threw = true;
      assert(/TFA_SIGNER_KIND/.test(e.message), "error message should mention TFA_SIGNER_KIND");
      assert(/bogus/.test(e.message), "error message should echo the bad value");
    }
    assert(threw, "buildSovereignStack() must throw on an invalid TFA_SIGNER_KIND value");
  });
});

test("composition.signer-kind-env: TFA_SIGNER_KIND='bogus' throws even when opts are provided but signerKind is omitted", async () => {
  await withEnv("bogus", () => {
    let threw = false;
    try {
      buildSovereignStack(defaultPolicies(), { auditSecret: "x" });
    } catch (e: any) {
      threw = true;
      assert(/TFA_SIGNER_KIND/.test(e.message));
    }
    assert(threw, "buildSovereignStack() must throw on an invalid TFA_SIGNER_KIND value even with other opts set");
  });
});

test("composition.signer-kind-env: TFA_SIGNER_KIND='bogus' throws even if opts.signerKind is explicit (env var is validated unconditionally, like TFA_PERSIST)", async () => {
  await withEnv("bogus", () => {
    let threw = false;
    try {
      buildSovereignStack(defaultPolicies(), { signerKind: "hmac" });
    } catch (e: any) {
      threw = true;
      assert(/TFA_SIGNER_KIND/.test(e.message));
    }
    assert(threw, "an invalid TFA_SIGNER_KIND must be rejected even if currently shadowed by explicit opts — a misconfigured deployment should fail loudly, not silently work by accident");
  });
});

// ─── End-to-end: Ed25519-via-env stack signs & verifies passports ─────────

test("composition.signer-kind-env: TFA_SIGNER_KIND=ed25519 stack issues a verifiable Ed25519 passport", async () => {
  await withEnv("ed25519", async () => {
    const stack = buildSovereignStack(defaultPolicies());
    const acc = await stack.ledger.createAccount("t-env-ed25519", "u1", "asset", "wallet");
    const r = await stack.ledger.mint("t-env-ed25519", acc.id, 100_000n, "starter", "system");
    assert(r.ok, "mint should succeed");
    if (!r.ok) return;
    assert(r.passport, "auto-passport must be attached");
    eq(r.passport!.algorithm, "ed25519");
  });
});
