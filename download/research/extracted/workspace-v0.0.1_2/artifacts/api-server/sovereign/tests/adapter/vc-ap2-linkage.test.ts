/**
 * tests/adapter/vc-ap2-linkage.test.ts — v251.
 * AP2 linkage sub-step 1: embedding `MandateLinkage` as W3C VC evidence.
 *
 * `toVerifiableCredential(receipt, linkage?)` now accepts an optional AP2
 * `MandateLinkage` and carries it as `vc.linkage` — additive VC evidence that
 * the receipt fulfilled a specific Google AP2 mandate chain.
 *
 *   FEATURE      linkage embedded verbatim in vc.linkage when supplied.
 *   BACKWARD     omitting linkage produces a VC identical to before (no field).
 *   ROUND-TRIP   verifiableCredentialToReceipt + verifyExecutionReceipt unaffected
 *                by linkage presence (linkage is not part of the receipt's own
 *                canonical signature).
 *   VALIDATE     validateVCSchema accepts a well-formed linkage and rejects a
 *                malformed one (missing version/receiptSignature/mandates/signature).
 *   INDEPENDENT  verifyMandateLinkage still validates vc.linkage on its own terms
 *                (tamper-evident independently of the VC's own proof).
 */

import { test, assert, eq } from "../_harness.mjs";
import { HmacSigner, Ed25519Signer, generateAuditKeyPair } from "../../lib/orchestrator/signer.ts";
import { InMemoryExecutionStore } from "../../lib/orchestrator/execution-workflow.ts";
import { runActionThroughTfa, verifyExecutionReceipt } from "../../lib/adapter/agent-adapter.ts";
import { linkReceiptToMandates, verifyMandateLinkage } from "../../lib/adapter/ap2-mandate-link.ts";
import {
  toVerifiableCredential, verifiableCredentialToReceipt, validateVCSchema,
} from "../../lib/adapter/vc-receipt.ts";

const signer = new HmacSigner("vc-ap2-link-test-secret-32-bytes!!");

function makeReceipt(over: Record<string, unknown> = {}) {
  const store = new InMemoryExecutionStore();
  const intent = {
    tenantId: "t1", actorId: "agent:1", toolId: "token.swap", resourceRef: "res:1",
    riskClass: "read_only", valueMicrounits: 5_000_000n, privacyLevel: "internal",
    approvalPolicyRef: "pol:default", nonce: "nonce-" + Math.random().toString(36).slice(2),
    expiry: "2099-01-01T00:00:00.000Z", provenance: "agent", evidencePolicy: "ev:default", ...over,
  } as any;
  return runActionThroughTfa(intent, signer, { executionStore: store }).receipt;
}

const mandates = [
  { type: "intent" as const, id: "urn:ap2:intent:xyz" },
  { type: "cart" as const, id: "urn:ap2:cart:123" },
  { type: "payment" as const, id: "urn:ap2:payment:abc" },
];

// ─── FEATURE ──────────────────────────────────────────────────────────────────

test("toVerifiableCredential(receipt, linkage): vc.linkage carries the MandateLinkage verbatim", () => {
  const receipt = makeReceipt();
  const linkage = linkReceiptToMandates(receipt, mandates, signer, "2026-06-16T00:00:00.000Z");
  const vc = toVerifiableCredential(receipt, linkage);
  assert(vc.linkage !== undefined, "linkage present on VC");
  eq(vc.linkage!.version, "tfa-ap2-link-v1");
  eq(vc.linkage!.receiptSignature, receipt.signature);
  eq(vc.linkage!.receiptIntentId, receipt.intentId);
  eq(vc.linkage!.mandates.length, 3);
  eq(vc.linkage!.signature, linkage.signature);
});

// ─── BACKWARD COMPAT ──────────────────────────────────────────────────────────

test("toVerifiableCredential(receipt): omitting linkage produces no linkage field (unchanged behavior)", () => {
  const receipt = makeReceipt();
  const vc = toVerifiableCredential(receipt);
  eq(vc.linkage, undefined, "no linkage field when not supplied");
  // Sanity: rest of the VC is unaffected
  assert(vc.credentialSubject.id.includes(receipt.actorId));
});

// ─── ROUND-TRIP (linkage does not affect receipt recovery or its own verify) ──

test("ROUND-TRIP: verifiableCredentialToReceipt + verifyExecutionReceipt unaffected by linkage", () => {
  const receipt = makeReceipt({ nonce: "roundtrip-with-linkage" });
  const linkage = linkReceiptToMandates(receipt, mandates, signer, "2026-06-16T00:00:00.000Z");
  const vc = toVerifiableCredential(receipt, linkage);
  const recovered = verifiableCredentialToReceipt(vc);
  assert(verifyExecutionReceipt(recovered, signer), "receipt verify unaffected by linkage presence");
  eq(recovered.signature, receipt.signature);
});

test("ROUND-TRIP: VC without linkage round-trips identically (no regression)", () => {
  const receipt = makeReceipt({ nonce: "roundtrip-no-linkage" });
  const vc = toVerifiableCredential(receipt);
  const recovered = verifiableCredentialToReceipt(vc);
  assert(verifyExecutionReceipt(recovered, signer));
  eq(recovered.signature, receipt.signature);
});

// ─── VALIDATE ─────────────────────────────────────────────────────────────────

test("VALIDATE OK: validateVCSchema accepts a VC with a well-formed linkage", () => {
  const receipt = makeReceipt({ nonce: "validate-ok-linkage" });
  const linkage = linkReceiptToMandates(receipt, mandates, signer, "2026-06-16T00:00:00.000Z");
  const vc = toVerifiableCredential(receipt, linkage);
  const r = validateVCSchema(vc);
  assert(r.ok, `schema valid with linkage; errors: ${r.errors.join(", ")}`);
});

test("VALIDATE OK: validateVCSchema accepts a VC with no linkage (optional field)", () => {
  const receipt = makeReceipt({ nonce: "validate-ok-no-linkage" });
  const vc = toVerifiableCredential(receipt);
  const r = validateVCSchema(vc);
  assert(r.ok, "linkage is optional; absence is valid");
});

test("VALIDATE FAIL: linkage missing version → error", () => {
  const receipt = makeReceipt({ nonce: "validate-fail-version" });
  const linkage = linkReceiptToMandates(receipt, mandates, signer, "2026-06-16T00:00:00.000Z");
  const vc = toVerifiableCredential(receipt, linkage) as any;
  vc.linkage = { ...vc.linkage, version: "wrong-version" };
  const r = validateVCSchema(vc);
  eq(r.ok, false);
  assert(r.errors.some((e: string) => e.includes("linkage.version")));
});

test("VALIDATE FAIL: linkage missing mandates array → error", () => {
  const receipt = makeReceipt({ nonce: "validate-fail-mandates" });
  const linkage = linkReceiptToMandates(receipt, mandates, signer, "2026-06-16T00:00:00.000Z");
  const vc = toVerifiableCredential(receipt, linkage) as any;
  vc.linkage = { ...vc.linkage, mandates: [] };
  const r = validateVCSchema(vc);
  eq(r.ok, false);
  assert(r.errors.some((e: string) => e.includes("linkage.mandates")));
});

test("VALIDATE FAIL: linkage missing signature → error", () => {
  const receipt = makeReceipt({ nonce: "validate-fail-sig" });
  const linkage = linkReceiptToMandates(receipt, mandates, signer, "2026-06-16T00:00:00.000Z");
  const vc = toVerifiableCredential(receipt, linkage) as any;
  vc.linkage = { ...vc.linkage, signature: "" };
  const r = validateVCSchema(vc);
  eq(r.ok, false);
  assert(r.errors.some((e: string) => e.includes("linkage.signature")));
});

test("VALIDATE FAIL: linkage not an object → error", () => {
  const receipt = makeReceipt({ nonce: "validate-fail-notobject" });
  const vc = toVerifiableCredential(receipt) as any;
  vc.linkage = "not-an-object";
  const r = validateVCSchema(vc);
  eq(r.ok, false);
  assert(r.errors.some((e: string) => e.includes("linkage must be an object")));
});

// ─── INDEPENDENT VERIFICATION (rotation-safe via KeyRing) ────────────────────

test("verifyMandateLinkage still validates vc.linkage independently, including via KeyRing", () => {
  const pair = generateAuditKeyPair();
  const ed25519Signer = new Ed25519Signer(pair.privateKey, pair.publicKey);
  const receipt = makeReceipt({ nonce: "independent-verify-ed25519" });
  // Re-sign receipt with Ed25519 isn't needed — linkage uses its own signer.
  const linkage = linkReceiptToMandates(receipt, mandates, ed25519Signer, "2026-06-16T00:00:00.000Z");
  const vc = toVerifiableCredential(receipt, linkage);

  const result = verifyMandateLinkage(vc.linkage!, ed25519Signer, { receipt });
  assert(result.valid, `linkage embedded in VC verifies independently: ${result.reason ?? ""}`);
});

test("verifyMandateLinkage rejects a tampered linkage extracted from the VC", () => {
  const receipt = makeReceipt({ nonce: "tamper-test" });
  const linkage = linkReceiptToMandates(receipt, mandates, signer, "2026-06-16T00:00:00.000Z");
  const vc = toVerifiableCredential(receipt, linkage) as any;
  // Tamper: swap a mandate id after embedding
  vc.linkage.mandates = [...vc.linkage.mandates];
  vc.linkage.mandates[0] = { ...vc.linkage.mandates[0], id: "urn:ap2:intent:SWAPPED" };
  const result = verifyMandateLinkage(vc.linkage, signer, { receipt });
  assert(!result.valid, "tampered linkage embedded in VC fails verification");
});
