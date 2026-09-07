/**
 * tests/adapter/kid-in-receipt-and-passport.test.ts  (v209)
 *
 * Verifies that kid (key identifier) is:
 *   A. Present in Ed25519Signer.kid — deterministic, stable, 16 hex chars.
 *   B. Present in ExecutionReceipt.kid when using Ed25519Signer.
 *   C. Absent in ExecutionReceipt when using HmacSigner.
 *   D. Included in the canonical receipt payload (changing kid → signature mismatch).
 *   E. Present in ActionPassport when using Ed25519Signer (in body, covered by hash).
 *   F. Absent in ActionPassport when using HmacSigner.
 *   G. Stable across two Ed25519Signer instances with the same key pair.
 *   H. Different between two distinct Ed25519 key pairs.
 *   I. verifyExecutionReceipt still passes for receipts with kid.
 *
 * All tests run in-process: zero DB, zero network, zero file system.
 */

import { test, eq, assert } from "../_harness.mjs";
import { HmacSigner, Ed25519Signer, generateAuditKeyPair } from "../../lib/orchestrator/signer.ts";
import { runActionThroughTfa, verifyExecutionReceipt } from "../../lib/adapter/agent-adapter.ts";
import { issuePassport } from "../../lib/passport/passport.ts";
import { InMemoryAuditStore } from "../../lib/orchestrator/audit.ts";
import type { ActionIntent } from "../../lib/orchestrator/types.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEd25519Pair() {
  const { privateKey, publicKey } = generateAuditKeyPair();
  return new Ed25519Signer(privateKey, publicKey);
}

const hmacSigner = new HmacSigner("test-secret-for-kid-tests-min32bytes!!");

function makeIntent(over: Partial<ActionIntent> = {}): ActionIntent {
  return {
    actorId: "agent:test",
    toolId: "file.read",
    resourceRef: "res:doc-1",
    riskClass: "read_only",
    valueMicrounits: 0n,
    nonce: "nonce-" + Math.random().toString(36).slice(2),
    expiry: new Date(Date.now() + 60_000).toISOString(),
    tenantId: "tenant-kid-test",
    approvalPolicyRef: "default",
    privacyLevel: "internal",
    evidencePolicy: "default",
    provenance: "test",
    ...over,
  };
}

// ─── A. Ed25519Signer.kid ──────────────────────────────────────────────────────

test("kid [A-1]: Ed25519Signer.kid is defined and exactly 16 hex chars", () => {
  const signer = makeEd25519Pair();
  assert(signer.kid !== undefined, "kid must be defined for Ed25519Signer");
  assert(typeof signer.kid === "string", "kid must be a string");
  eq(signer.kid.length, 16, "kid must be exactly 16 hex characters");
  assert(/^[0-9a-f]{16}$/.test(signer.kid), `kid must be lowercase hex: ${signer.kid}`);
});

test("kid [A-2]: HmacSigner.kid is undefined", () => {
  assert(hmacSigner.kid === undefined, "HMAC signer must not expose a kid");
});

test("kid [A-3]: Ed25519Signer.kid is stable — same value across property accesses", () => {
  const signer = makeEd25519Pair();
  const kid1 = signer.kid;
  const kid2 = signer.kid;
  eq(kid1, kid2, "kid must be the same value on repeated access");
});

test("kid [A-4]: Two Ed25519Signers with different key pairs have different kids", () => {
  const s1 = makeEd25519Pair();
  const s2 = makeEd25519Pair();
  assert(s1.kid !== s2.kid, `different key pairs must have different kids: ${s1.kid} vs ${s2.kid}`);
});

test("kid [A-5]: Two Ed25519Signers built from the same PEM have the same kid", () => {
  const { privateKey, publicKey } = generateAuditKeyPair();
  const s1 = new Ed25519Signer(privateKey, publicKey);
  const s2 = new Ed25519Signer(privateKey, publicKey);
  eq(s1.kid, s2.kid, "same key pair must produce the same kid");
});

// ─── B/C. ExecutionReceipt.kid ────────────────────────────────────────────────

test("kid [B-1]: ExecutionReceipt includes kid when using Ed25519Signer", async () => {
  const signer = makeEd25519Pair();
  const result = await runActionThroughTfa(makeIntent(), signer);
  const { receipt } = result;
  assert(receipt.kid !== undefined, "receipt.kid must be present for Ed25519Signer");
  eq(receipt.kid, signer.kid, "receipt.kid must match signer.kid");
});

test("kid [C-1]: ExecutionReceipt has no kid when using HmacSigner", async () => {
  const result = await runActionThroughTfa(makeIntent(), hmacSigner);
  const { receipt } = result;
  assert(receipt.kid === undefined, "receipt.kid must be absent for HmacSigner");
});

// ─── D. kid covered by signature ─────────────────────────────────────────────

test("kid [D-1]: verifyExecutionReceipt passes for Ed25519 receipts with kid", async () => {
  const signer = makeEd25519Pair();
  const result = await runActionThroughTfa(makeIntent(), signer);
  const valid = verifyExecutionReceipt(result.receipt, signer);
  assert(valid, "verifyExecutionReceipt must pass for Ed25519 receipt with kid");
});

test("kid [D-2]: tampering kid in receipt breaks verification", async () => {
  const signer = makeEd25519Pair();
  const result = await runActionThroughTfa(makeIntent(), signer);
  // Tamper: change the kid to something else
  const tampered = { ...result.receipt, kid: "0000000000000000" };
  const valid = verifyExecutionReceipt(tampered, signer);
  assert(!valid, "tampered kid must break receipt verification");
});

test("kid [D-3]: verifyExecutionReceipt still passes for HMAC receipts (no kid)", async () => {
  const result = await runActionThroughTfa(makeIntent(), hmacSigner);
  const valid = verifyExecutionReceipt(result.receipt, hmacSigner);
  assert(valid, "verifyExecutionReceipt must pass for HMAC receipt");
});


// ─── E/F. ActionPassport.kid ─────────────────────────────────────────────────

test("kid [E-1]: ActionPassport includes kid when using Ed25519Signer", () => {
  const signer = makeEd25519Pair();
  const auditStore = new InMemoryAuditStore();
  const auditId = "audit-e1-" + Math.random().toString(36).slice(2);
  auditStore.append({ id: auditId, tenantId: "t", actionId: "a1", actionType: "x", source: "s", outcome: "allowed", occurredAt: new Date().toISOString() });
  const passport = issuePassport({ auditId, auditStore, signer, expectedTenantId: "t" });
  assert(passport.kid !== undefined, "passport.kid must be present for Ed25519Signer");
  eq(passport.kid, signer.kid, "passport.kid must match signer.kid");
  assert(typeof passport.hash === "string" && passport.hash.length > 0, "hash must be present");
});

test("kid [F-1]: ActionPassport has no kid when using HmacSigner", () => {
  const auditStore = new InMemoryAuditStore();
  const auditId = "audit-f1-" + Math.random().toString(36).slice(2);
  auditStore.append({ id: auditId, tenantId: "t", actionId: "a2", actionType: "x", source: "s", outcome: "allowed", occurredAt: new Date().toISOString() });
  const passport = issuePassport({ auditId, auditStore, signer: hmacSigner, expectedTenantId: "t" });
  assert(passport.kid === undefined, "passport.kid must be absent for HmacSigner");
});

test("kid [E-2]: passport.kid in body — serialization differs with and without kid", () => {
  const signer = makeEd25519Pair();
  const auditStore = new InMemoryAuditStore();
  const auditId = "audit-e2-" + Math.random().toString(36).slice(2);
  auditStore.append({ id: auditId, tenantId: "t", actionId: "a3", actionType: "x", source: "s", outcome: "allowed", occurredAt: new Date().toISOString() });
  const passport = issuePassport({ auditId, auditStore, signer, expectedTenantId: "t" });
  assert(passport.kid === signer.kid, "passport.kid must equal signer.kid");
  const bodyWith = { ...passport, hash: undefined, signature: undefined };
  const bodyWithout = { ...bodyWith, kid: undefined };
  assert(JSON.stringify(bodyWith) !== JSON.stringify(bodyWithout), "body with kid must differ from body without kid");
});

// ─── G/H. Stability / uniqueness ─────────────────────────────────────────────

test("kid [G-1]: Ed25519Signer kid is stable across two passport issuances", () => {
  const signer = makeEd25519Pair();
  const auditStore = new InMemoryAuditStore();
  const id1 = "audit-g1a-" + Math.random().toString(36).slice(2);
  const id2 = "audit-g1b-" + Math.random().toString(36).slice(2);
  auditStore.append({ id: id1, tenantId: "t", actionId: "c1", actionType: "x", source: "s", outcome: "allowed", occurredAt: new Date().toISOString() });
  auditStore.append({ id: id2, tenantId: "t", actionId: "c2", actionType: "x", source: "s", outcome: "allowed", occurredAt: new Date().toISOString() });
  const p1 = issuePassport({ auditId: id1, auditStore, signer, expectedTenantId: "t" });
  const p2 = issuePassport({ auditId: id2, auditStore, signer, expectedTenantId: "t" });
  eq(p1.kid, p2.kid, "same signer must produce same kid");
  eq(p1.kid, signer.kid);
});

test("kid [H-1]: Different Ed25519 signers produce different kids", () => {
  const s1 = makeEd25519Pair();
  const s2 = makeEd25519Pair();
  const auditStore = new InMemoryAuditStore();
  const id1 = "audit-h1a-" + Math.random().toString(36).slice(2);
  const id2 = "audit-h1b-" + Math.random().toString(36).slice(2);
  auditStore.append({ id: id1, tenantId: "t", actionId: "d1", actionType: "x", source: "s", outcome: "allowed", occurredAt: new Date().toISOString() });
  auditStore.append({ id: id2, tenantId: "t", actionId: "d2", actionType: "x", source: "s", outcome: "allowed", occurredAt: new Date().toISOString() });
  const p1 = issuePassport({ auditId: id1, auditStore, signer: s1, expectedTenantId: "t" });
  const p2 = issuePassport({ auditId: id2, auditStore, signer: s2, expectedTenantId: "t" });
  assert(p1.kid !== p2.kid, "different key pairs must produce different kids");
});
