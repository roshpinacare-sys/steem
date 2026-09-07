/**
 * tests/adapter/ap2-mandate-link.test.ts — v250.
 * AP2 mandate linkage: bind a TFA ExecutionReceipt to a Google AP2 mandate chain.
 *
 *   FEATURE       link a real receipt to intent/cart/payment mandates → verifies.
 *   ORDER         mandates are canonicalized intent→cart→payment; verify rejects re-order.
 *   BINDING       linkage binds THIS receipt (signature+intentId); a different receipt fails.
 *   ROTATION      verifies via KeyRing by kid (rotation-safe) when signed by Ed25519.
 *   FAIL-CLOSED   unsigned receipt / empty mandates throw; tampered payload → invalid.
 */
import { test, assert, eq } from "../_harness.mjs";
import { HmacSigner, Ed25519Signer, generateAuditKeyPair } from "../../lib/orchestrator/signer.ts";
import { InMemoryExecutionStore } from "../../lib/orchestrator/execution-workflow.ts";
import { runActionThroughTfa } from "../../lib/adapter/agent-adapter.ts";
import { linkReceiptToMandates, verifyMandateLinkage, MandateLinkError } from "../../lib/adapter/ap2-mandate-link.ts";
import { KeyRing, computeKid } from "../../lib/passport/key-ring.ts";

const signer = new HmacSigner("ap2-link-test-secret");

function makeReceipt(over = {}) {
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
  { type: "payment" as const, id: "urn:ap2:payment:abc" },
  { type: "intent" as const, id: "urn:ap2:intent:xyz" },
  { type: "cart" as const, id: "urn:ap2:cart:123" },
];

test("links a receipt to an AP2 mandate chain and verifies", () => {
  const receipt = makeReceipt();
  const link = linkReceiptToMandates(receipt, mandates, signer, "2026-06-16T00:00:00.000Z");
  eq(link.version, "tfa-ap2-link-v1");
  // canonical order: intent → cart → payment
  eq(link.mandates.map((m) => m.type).join(","), "intent,cart,payment");
  const v = verifyMandateLinkage(link, signer, { receipt });
  assert(v.valid, `should verify: ${v.reason}`);
});

test("binding: a linkage does not verify against a different receipt", () => {
  const r1 = makeReceipt();
  const r2 = makeReceipt();
  const link = linkReceiptToMandates(r1, mandates, signer);
  assert(verifyMandateLinkage(link, signer, { receipt: r1 }).valid, "binds r1");
  eq(verifyMandateLinkage(link, signer, { receipt: r2 }).valid, false, "must not bind r2");
});

test("tamper: altering mandates or order invalidates the linkage", () => {
  const receipt = makeReceipt();
  const link = linkReceiptToMandates(receipt, mandates, signer);
  // tamper: swap a mandate id
  const tampered = { ...link, mandates: link.mandates.map((m, i) => i === 0 ? { ...m, id: "urn:ap2:intent:EVIL" } : m) };
  eq(verifyMandateLinkage(tampered, signer).valid, false, "tampered mandate id fails");
  // tamper: reorder out of canonical order
  const reordered = { ...link, mandates: [link.mandates[2], link.mandates[1], link.mandates[0]] };
  eq(verifyMandateLinkage(reordered, signer).valid, false, "non-canonical order fails");
});

test("rotation-safe: Ed25519 linkage verifies via KeyRing by kid after rotation", () => {
  const pair = generateAuditKeyPair();
  const ed = new Ed25519Signer(pair.privateKey, pair.publicKey);
  const receipt = makeReceipt();
  const link = linkReceiptToMandates(receipt, mandates, ed);
  assert(link.kid && link.kid.length > 0, "Ed25519 linkage carries a kid");

  const ring = new KeyRing();
  const kid = computeKid("ed25519", pair.publicKey);
  ring.register({ kid, algorithm: "ed25519", publicKey: pair.publicKey, status: "active", createdAt: "2026-01-01T00:00:00.000Z" });
  // rotate to a new active key; the old key becomes retiring but still verifies
  const pair2 = generateAuditKeyPair();
  ring.rotate({ kid: computeKid("ed25519", pair2.publicKey), algorithm: "ed25519", publicKey: pair2.publicKey, status: "active", createdAt: "2026-02-01T00:00:00.000Z" });
  // align the linkage kid with the ring's kid derivation
  const linkForRing = { ...link, kid };
  assert(verifyMandateLinkage(linkForRing, ring).valid, "verifies via KeyRing after rotation");
});

test("fail-closed: unsigned receipt and empty mandates throw", () => {
  const receipt = makeReceipt();
  let t1 = false; try { linkReceiptToMandates({ ...receipt, signature: "" }, mandates, signer); } catch (e) { t1 = e instanceof MandateLinkError; }
  assert(t1, "unsigned receipt throws");
  let t2 = false; try { linkReceiptToMandates(receipt, [], signer); } catch (e) { t2 = e instanceof MandateLinkError; }
  assert(t2, "empty mandates throws");
  let t3 = false; try { linkReceiptToMandates(receipt, [{ type: "bogus", id: "x" } as any], signer); } catch (e) { t3 = e instanceof MandateLinkError; }
  assert(t3, "bad mandate type throws");
});
