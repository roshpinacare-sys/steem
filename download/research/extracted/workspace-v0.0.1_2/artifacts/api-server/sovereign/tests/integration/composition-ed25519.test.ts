import "../_flush.mjs";
/**
 * tests/integration/composition-ed25519.test.ts — v30 B.6.5 (first sub-step).
 *
 * Verifies the new `signerKind` flag on `buildSovereignStack`:
 *   • signerKind: "ed25519" → kernel uses Ed25519Signer, publicKey is exposed.
 *   • Passports issued by the stack are signed with Ed25519 (algorithm="ed25519").
 *   • The standalone verifier (`scripts/verify-passport.mjs::verifyPassport`)
 *     accepts the passport when given the public key (proves an external
 *     auditor can verify with `--public-key-file` without the signing key).
 *   • Edge: HMAC default still works (backward compat, publicKey === null).
 *   • Fail: tampered passport hash is rejected by the external verifier.
 *   • Backward compat: legacy string-arg form `buildSovereignStack(p, "secret")`
 *     still produces an HMAC stack with a working passport.
 */

import { test, assert, eq } from "../_harness.mjs";
import { buildSovereignStack, defaultPolicies } from "../../src/composition.ts";
import { Ed25519Signer, generateAuditKeyPair } from "../../lib/orchestrator/signer.ts";
// @ts-ignore — JS module, no .d.ts shipped; library mode is documented.
import { verifyPassport } from "../../scripts/verify-passport.mjs";

async function mintAndGetPassport(stack: ReturnType<typeof buildSovereignStack>) {
  const acc = await stack.ledger.createAccount("t-ed25519", "u1", "asset", "wallet");
  const r = await stack.ledger.mint("t-ed25519", acc.id, 500_000n, "starter", "system");
  assert(r.ok, "mint should succeed");
  if (!r.ok) throw new Error("mint failed");
  assert(r.passport, "auto-passport must be attached");
  return r.passport!;
}

// 1. Happy path — Ed25519 kernel signs passport; external verifier accepts via public key.
test("composition.ed25519: signerKind='ed25519' produces Ed25519-signed passport verifiable by scripts/verify-passport.mjs --public-key-file", async () => {
  const stack = buildSovereignStack(defaultPolicies(), { signerKind: "ed25519" });
  assert(stack.publicKey, "publicKey must be exposed when signerKind=ed25519");
  assert(stack.publicKey!.includes("BEGIN PUBLIC KEY"), "publicKey is SPKI PEM");
  eq(stack.signer.algorithm, "ed25519");

  const passport = await mintAndGetPassport(stack);
  eq(passport.algorithm, "ed25519");
  eq(passport.tenantId, "t-ed25519");

  // External verifier (the standalone script) MUST accept it with only the public key.
  const result = verifyPassport(passport, { publicKey: stack.publicKey });
  assert(
    result.ok,
    "external verifier should accept Ed25519 passport with public key. checks=" +
      JSON.stringify(result.checks),
  );
  const sigCheck = result.checks.find((c: any) => c.name === "passport.signature.ed25519");
  assert(sigCheck && sigCheck.status === "pass", "ed25519 signature check must pass");
});

// 2. Edge — caller can inject a pre-generated Ed25519 key pair (production path).
test("composition.ed25519: caller-supplied ed25519KeyPair is wired into the stack", async () => {
  const pair = generateAuditKeyPair();
  const stack = buildSovereignStack(defaultPolicies(), {
    signerKind: "ed25519",
    ed25519KeyPair: pair,
  });
  eq(stack.publicKey, pair.publicKey);
  const passport = await mintAndGetPassport(stack);
  // The exposed public key MUST verify a signature produced by the stack signer.
  const external = new Ed25519Signer(pair.privateKey, pair.publicKey);
  assert(
    external.verify(passport.hash, passport.signature),
    "an externally-constructed Ed25519Signer with the same key pair must verify",
  );
});

// 3. Fail-closed — tampering with the passport body breaks external verification.
test("composition.ed25519: tampered passport body is rejected by the external verifier", async () => {
  const stack = buildSovereignStack(defaultPolicies(), { signerKind: "ed25519" });
  const passport = await mintAndGetPassport(stack);
  // Mutate a field WITHOUT recomputing hash/signature.
  const tampered = { ...passport, tenantId: "t-attacker" };
  const result = verifyPassport(tampered, { publicKey: stack.publicKey });
  assert(!result.ok, "tampered passport must be rejected");
  // Body hash recomputation must catch the mutation BEFORE the signature step.
  const hashCheck = result.checks.find((c: any) => c.name === "passport.hash");
  assert(hashCheck && hashCheck.status === "fail", "passport.hash must fail on tampering");
});

// 4. Default (no opts) now produces Ed25519, publicKey non-null, passport works.
test("composition.ed25519: default stack is now Ed25519 with non-null publicKey (M4 sub-step 3)", async () => {
  const stack = buildSovereignStack();
  eq(stack.signer.algorithm, "ed25519");
  assert(typeof stack.publicKey === "string" && stack.publicKey.length > 0, "publicKey must be non-null string");
  const passport = await mintAndGetPassport(stack);
  eq(passport.algorithm, "ed25519");
});

// 5. Backward compat — legacy 2nd-arg-as-string form (auditSecret) still works.
test("composition.ed25519: legacy string auditSecret arg still works (HMAC path)", async () => {
  const SECRET = "legacy-string-secret-32bytes-long!!";
  const stack = buildSovereignStack(defaultPolicies(), SECRET);
  eq(stack.signer.algorithm, "hmac-sha256");
  eq(stack.publicKey, null);
  const passport = await mintAndGetPassport(stack);
  // Independently sign with the same secret — must match.
  assert(stack.signer.verify(passport.hash, passport.signature), "legacy HMAC passport verifies");
});
