/**
 * tests/adapter/verify-tfa-proof.test.ts — v272.
 * verifyTfaProof: the single authoritative, fail-closed proof verifier.
 *
 *   FEATURE       a genuine receipt passes authenticity + decisionIntegrity in one call.
 *   COMPOSE-AP2   when a valid mandate linkage is supplied it must bind this receipt.
 *   CATCH         a signed-but-wrong receipt fails the unified verdict (footgun closed).
 *   FAIL-CLOSED   wrong key, missing keys, malformed receipt → valid:false, no throw.
 */
import { test, assert, eq } from "../_harness.mjs";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { InMemoryExecutionStore } from "../../lib/orchestrator/execution-workflow.ts";
import { runActionThroughTfa } from "../../lib/adapter/agent-adapter.ts";
import { verifyTfaProof } from "../../lib/adapter/verify-tfa-proof.ts";
import { linkReceiptToMandates } from "../../lib/adapter/ap2-mandate-link.ts";

const signer = new HmacSigner("verify-tfa-proof-secret");
const wrongSigner = new HmacSigner("a-totally-different-secret");

function receiptFor(toolId: string) {
  const store = new InMemoryExecutionStore();
  const intent = {
    tenantId: "t1", actorId: "agent:1", toolId, resourceRef: "res:1",
    riskClass: "read_only", valueMicrounits: 0n, privacyLevel: "internal",
    approvalPolicyRef: "pol:default", nonce: "n-" + Math.random().toString(36).slice(2),
    expiry: "2099-01-01T00:00:00.000Z", provenance: "agent", evidencePolicy: "ev:default",
  } as any;
  return runActionThroughTfa(intent, signer, { executionStore: store }).receipt;
}

test("a genuine receipt passes authenticity + decisionIntegrity in one call", () => {
  const r = receiptFor("file.delete");
  const v = verifyTfaProof(r, { keys: signer });
  assert(v.valid, `should be valid: ${v.reasons.join("; ")}`);
  eq(v.checks.authenticity, true);
  eq(v.checks.decisionIntegrity, true);
  eq(v.checks.mandateLinkage, undefined, "no linkage supplied");
});

test("composes AP2 linkage: valid linkage binds, the whole verdict holds", () => {
  const r = receiptFor("token.swap");
  const linkage = linkReceiptToMandates(r, [{ type: "intent", id: "urn:ap2:intent:1" }], signer);
  const v = verifyTfaProof(r, { keys: signer, mandateLinkage: linkage });
  assert(v.valid, `should be valid with linkage: ${v.reasons.join("; ")}`);
  eq(v.checks.mandateLinkage, true);

  // a linkage that binds a DIFFERENT receipt must fail the unified verdict
  const other = receiptFor("token.swap");
  const v2 = verifyTfaProof(other, { keys: signer, mandateLinkage: linkage });
  eq(v2.valid, false, "linkage does not bind 'other' → whole proof invalid");
  eq(v2.checks.mandateLinkage, false);
});

test("catches the footgun: signed-but-wrong decision fails the unified verdict", () => {
  const r = receiptFor("file.delete"); // approval_required
  const tampered = { ...r, decision: "allowed", serverRiskClass: "read_only" } as any;
  // signature no longer matches (fields changed) AND decision is wrong — both catch it
  const v = verifyTfaProof(tampered, { keys: signer });
  eq(v.valid, false, "tampered proof must be invalid");
  assert(v.reasons.length > 0, "reasons explain why");
});

test("fail-closed: wrong key, missing keys, malformed receipt", () => {
  const r = receiptFor("file.read");
  eq(verifyTfaProof(r, { keys: wrongSigner }).valid, false, "wrong key → invalid");
  eq(verifyTfaProof(r, {} as any).valid, false, "missing keys → invalid");
  eq(verifyTfaProof(null as any, { keys: signer }).valid, false, "null receipt → invalid");
  // requireDecisionIntegrity:false still requires authenticity
  eq(verifyTfaProof(r, { keys: wrongSigner, requireDecisionIntegrity: false }).valid, false);
});
