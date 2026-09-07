/**
 * tests/adapter/decision-integrity.test.ts — v260.
 * verifyDecisionIntegrity: prove the gate's classification + decision were CORRECT
 * (re-derived), not merely signed.
 *
 *   FEATURE       a genuine receipt from the adapter passes integrity re-derivation.
 *   CATCH-WRONG   a receipt with a tampered serverRiskClass/decision is caught.
 *   KILL-SWITCH   a kill-switch-forced deny is accepted as consistent.
 *   FAIL-CLOSED   missing toolId / malformed receipt → invalid (never throws).
 */
import { test, assert, eq } from "../_harness.mjs";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { InMemoryExecutionStore } from "../../lib/orchestrator/execution-workflow.ts";
import { runActionThroughTfa, verifyExecutionReceipt } from "../../lib/adapter/agent-adapter.ts";
import { verifyDecisionIntegrity } from "../../lib/adapter/decision-integrity.ts";

const signer = new HmacSigner("decision-integrity-test-secret");

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

test("genuine receipts pass both signature AND decision-integrity", () => {
  for (const tool of ["file.read", "file.delete", "infra.apply"]) {
    const r = receiptFor(tool);
    assert(verifyExecutionReceipt(r, signer), `${tool}: signature valid`);
    const di = verifyDecisionIntegrity(r);
    assert(di.valid, `${tool}: decision integrity valid — ${di.reasons.join("; ")}`);
  }
});

test("catches a tampered serverRiskClass (signed but wrong)", () => {
  const r = receiptFor("file.delete"); // → write_destructive → approval_required
  // an attacker downgrades the claimed risk to read_only on the receipt object
  const tampered = { ...r, serverRiskClass: "read_only" };
  const di = verifyDecisionIntegrity(tampered);
  eq(di.valid, false, "must catch the downgraded risk class");
  assert(di.reasons.some((x) => x.includes("serverRiskClass")), "reason names serverRiskClass");
  eq(di.expectedRiskClass, "write_destructive");
});

test("catches a tampered decision (allowed for a deny/approval action)", () => {
  const r = receiptFor("infra.apply");
  const tampered = { ...r, decision: "allowed" };
  const di = verifyDecisionIntegrity(tampered as any);
  eq(di.valid, false, "allowed is not what policy mandates for infra.apply");
  assert(di.reasons.some((x) => x.includes("decision") || x.includes("approvalClass")));
});

test("kill-switch forced deny is accepted as consistent", () => {
  const r = receiptFor("file.read"); // normally allowed
  const forced = { ...r, decision: "denied", killSwitchVerdict: { tripped: true, scope: "global", reason: "halt" } };
  const di = verifyDecisionIntegrity(forced as any);
  assert(di.valid, `kill-switch deny should be consistent — ${di.reasons.join("; ")}`);
  eq(di.expectedDecision, "denied");
});

test("fail-closed: malformed receipt / missing toolId → invalid, no throw", () => {
  eq(verifyDecisionIntegrity(null as any).valid, false);
  eq(verifyDecisionIntegrity({} as any).valid, false);
  const r = receiptFor("file.read");
  eq(verifyDecisionIntegrity({ ...r, toolId: "" } as any).valid, false);
});
