/**
 * tests/track-record/billing-dispute-proof.test.ts
 *
 * Coverage: happy path · edge cases · fail-closed
 */

import { test, assert, eq } from "../../tests/_harness.mjs";
import {
  buildBillingDisputeProof,
  verifyBillingDisputeProof,
  billingDisputeProofSigningPayload,
  classifyDiscrepancy,
  BILLING_DISPUTE_PROOF_VERSION,
  BillingDisputeProofError,
} from "../../lib/track-record/billing-dispute-proof.ts";
import type { Signer } from "../../lib/orchestrator/types.ts";
import { createHmac } from "node:crypto";

// ── Minimal HMAC signer ───────────────────────────────────────────────────────

function makeSigner(secret: string): Signer {
  return {
    algorithm: "HS256",
    sign(payload: string): string {
      return createHmac("sha256", secret).update(payload).digest("base64");
    },
    verify(payload: string, sig: string): boolean {
      return createHmac("sha256", secret).update(payload).digest("base64") === sig;
    },
  };
}

const SIGNER = makeSigner("billing-dispute-test-key-32bytes!!");
const SIGNER2 = makeSigner("other-key-32bytes!!!!!!!!!!!!!!!");

const BASE = {
  tenantId: "tenant-A",
  intentId: "intent-001",
  authorizedMicrounits: 1000n,
  billedMicrounits: 1500n,
  decision: "allowed",
  signer: SIGNER,
  signerId: "key-1",
  issuedAt: "2025-01-01T00:00:00.000Z",
};

// ─── classifyDiscrepancy ──────────────────────────────────────────────────────

test("classifyDiscrepancy: billed > authorized → OVERCHARGE", () => {
  eq(classifyDiscrepancy(1000n, 1500n, "allowed"), "OVERCHARGE");
});

test("classifyDiscrepancy: decision=denied + billed > 0 → DENIED_BUT_BILLED", () => {
  eq(classifyDiscrepancy(0n, 500n, "denied"), "DENIED_BUT_BILLED");
});

test("classifyDiscrepancy: billed < authorized → AMOUNT_MISMATCH", () => {
  eq(classifyDiscrepancy(2000n, 1000n, "allowed"), "AMOUNT_MISMATCH");
});

test("classifyDiscrepancy: billed === authorized + allowed → throws NO_DISCREPANCY", () => {
  let threw = false;
  try {
    classifyDiscrepancy(1000n, 1000n, "allowed");
  } catch (e) {
    threw = true;
    assert(e instanceof BillingDisputeProofError, "should throw BillingDisputeProofError");
    eq((e as BillingDisputeProofError).code, "NO_DISCREPANCY");
  }
  assert(threw, "should throw when no discrepancy");
});

// ─── buildBillingDisputeProof — happy path ────────────────────────────────────

test("build: OVERCHARGE proof has correct fields and verifies", () => {
  const proof = buildBillingDisputeProof(BASE);
  eq(proof.version, BILLING_DISPUTE_PROOF_VERSION);
  eq(proof.tenantId, "tenant-A");
  eq(proof.intentId, "intent-001");
  eq(proof.authorizedMicrounits, "1000");
  eq(proof.billedMicrounits, "1500");
  eq(proof.decision, "allowed");
  eq(proof.discrepancyType, "OVERCHARGE");
  eq(proof.algorithm, "HS256");
  assert(typeof proof.signature === "string" && proof.signature.length > 0);
  assert(verifyBillingDisputeProof(proof, SIGNER));
});

test("build: DENIED_BUT_BILLED proof verifies correctly", () => {
  const proof = buildBillingDisputeProof({
    ...BASE,
    authorizedMicrounits: 0n,
    billedMicrounits: 500n,
    decision: "denied",
  });
  eq(proof.discrepancyType, "DENIED_BUT_BILLED");
  eq(proof.authorizedMicrounits, "0");
  assert(verifyBillingDisputeProof(proof, SIGNER));
});

test("build: AMOUNT_MISMATCH (undercharge) proof verifies correctly", () => {
  const proof = buildBillingDisputeProof({
    ...BASE,
    authorizedMicrounits: 2000n,
    billedMicrounits: 800n,
  });
  eq(proof.discrepancyType, "AMOUNT_MISMATCH");
  assert(verifyBillingDisputeProof(proof, SIGNER));
});

test("build: money stored as decimal strings — no float, arbitrary large values", () => {
  const big = 999_999_999_999_999n;
  const proof = buildBillingDisputeProof({ ...BASE, authorizedMicrounits: big, billedMicrounits: big + 1n });
  eq(proof.authorizedMicrounits, "999999999999999");
  eq(proof.billedMicrounits, "1000000000000000");
  assert(verifyBillingDisputeProof(proof, SIGNER));
});

test("build: two identical inputs produce the same proof (deterministic)", () => {
  const p1 = buildBillingDisputeProof(BASE);
  const p2 = buildBillingDisputeProof(BASE);
  eq(p1.signature, p2.signature);
});

// ─── billingDisputeProofSigningPayload — canonical form ───────────────────────

test("signingPayload: sorted keys, same bytes regardless of input key order", () => {
  const fields = {
    version: BILLING_DISPUTE_PROOF_VERSION,
    tenantId: "t", intentId: "i",
    authorizedMicrounits: "100", billedMicrounits: "200",
    decision: "allowed", discrepancyType: "OVERCHARGE" as const,
    issuedAt: "2025-01-01T00:00:00.000Z", signerId: "k",
  };
  const a = billingDisputeProofSigningPayload(fields);
  const b = billingDisputeProofSigningPayload({ ...fields });
  eq(a, b);
  // Must contain all signed fields
  assert(a.includes("authorizedMicrounits"), "payload includes authorizedMicrounits");
  assert(a.includes("billedMicrounits"), "payload includes billedMicrounits");
  assert(a.includes("discrepancyType"), "payload includes discrepancyType");
});

// ─── verifyBillingDisputeProof — fail-closed cases ───────────────────────────

test("verify: wrong signer → false", () => {
  const proof = buildBillingDisputeProof(BASE);
  assert(!verifyBillingDisputeProof(proof, SIGNER2));
});

test("verify: tampered authorizedMicrounits → false", () => {
  const proof = buildBillingDisputeProof(BASE);
  assert(!verifyBillingDisputeProof({ ...proof, authorizedMicrounits: "9999" }, SIGNER));
});

test("verify: tampered billedMicrounits → false", () => {
  const proof = buildBillingDisputeProof(BASE);
  assert(!verifyBillingDisputeProof({ ...proof, billedMicrounits: "9999" }, SIGNER));
});

test("verify: tampered discrepancyType (relabelled without changing amounts) → false", () => {
  const proof = buildBillingDisputeProof(BASE); // OVERCHARGE
  // Try to re-label as AMOUNT_MISMATCH — verifier re-derives type and rejects mismatch
  assert(!verifyBillingDisputeProof({ ...proof, discrepancyType: "AMOUNT_MISMATCH" }, SIGNER));
});

test("verify: tampered decision (denied→allowed on DENIED_BUT_BILLED proof) → false", () => {
  const proof = buildBillingDisputeProof({ ...BASE, authorizedMicrounits: 0n, billedMicrounits: 200n, decision: "denied" });
  // Changing decision to "allowed" causes classifyDiscrepancy to re-derive AMOUNT_MISMATCH,
  // which won't match "DENIED_BUT_BILLED" in the proof — AND the signature breaks.
  assert(!verifyBillingDisputeProof({ ...proof, decision: "allowed" }, SIGNER));
});

test("verify: tampered tenantId → false (signature mismatch)", () => {
  const proof = buildBillingDisputeProof(BASE);
  assert(!verifyBillingDisputeProof({ ...proof, tenantId: "attacker" }, SIGNER));
});

test("verify: tampered intentId → false (signature mismatch)", () => {
  const proof = buildBillingDisputeProof(BASE);
  assert(!verifyBillingDisputeProof({ ...proof, intentId: "intent-evil" }, SIGNER));
});

test("verify: null input → false, no throw", () => {
  assert(!verifyBillingDisputeProof(null, SIGNER));
});

test("verify: empty object → false, no throw", () => {
  assert(!verifyBillingDisputeProof({}, SIGNER));
});

test("verify: non-integer money string → false, no throw", () => {
  const proof = buildBillingDisputeProof(BASE);
  assert(!verifyBillingDisputeProof({ ...proof, billedMicrounits: "1500.50" }, SIGNER));
});

test("verify: zero billedMicrounits (would mean vendor didn't charge) → false", () => {
  const proof = buildBillingDisputeProof(BASE);
  assert(!verifyBillingDisputeProof({ ...proof, billedMicrounits: "0" }, SIGNER));
});

test("verify: negative authorizedMicrounits string → false", () => {
  const proof = buildBillingDisputeProof(BASE);
  assert(!verifyBillingDisputeProof({ ...proof, authorizedMicrounits: "-1" }, SIGNER));
});

// ─── buildBillingDisputeProof — fail-closed inputs ───────────────────────────

test("build: empty tenantId → throws BAD_INPUT", () => {
  let threw = false;
  try { buildBillingDisputeProof({ ...BASE, tenantId: "" }); }
  catch (e) { threw = true; eq((e as BillingDisputeProofError).code, "BAD_INPUT"); }
  assert(threw);
});

test("build: non-BigInt authorizedMicrounits → throws BAD_INPUT", () => {
  let threw = false;
  try { buildBillingDisputeProof({ ...BASE, authorizedMicrounits: 1000 as any }); }
  catch (e) { threw = true; eq((e as BillingDisputeProofError).code, "BAD_INPUT"); }
  assert(threw);
});

test("build: negative authorizedMicrounits → throws BAD_INPUT", () => {
  let threw = false;
  try { buildBillingDisputeProof({ ...BASE, authorizedMicrounits: -1n }); }
  catch (e) { threw = true; eq((e as BillingDisputeProofError).code, "BAD_INPUT"); }
  assert(threw);
});

test("build: zero billedMicrounits → throws BAD_INPUT (vendor didn't bill anything)", () => {
  let threw = false;
  try { buildBillingDisputeProof({ ...BASE, billedMicrounits: 0n }); }
  catch (e) { threw = true; eq((e as BillingDisputeProofError).code, "BAD_INPUT"); }
  assert(threw);
});

test("build: billed === authorized + allowed → throws NO_DISCREPANCY", () => {
  let threw = false;
  try { buildBillingDisputeProof({ ...BASE, authorizedMicrounits: 1000n, billedMicrounits: 1000n }); }
  catch (e) { threw = true; eq((e as BillingDisputeProofError).code, "NO_DISCREPANCY"); }
  assert(threw);
});
