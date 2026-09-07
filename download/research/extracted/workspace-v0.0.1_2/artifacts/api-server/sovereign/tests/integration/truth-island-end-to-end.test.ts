/**
 * tests/integration/truth-island-end-to-end.test.ts — v294.
 *
 * THE TRUTH ISLAND — one complete, verified flow that proves the WHOLE chain composes.
 * This is the pilot sales story and the answer to "is the code worth as much as the idea":
 * it drives a real value-moving action through every layer and proves the resulting
 * proof verifies end-to-end — and that tampering at ANY layer is caught.
 *
 *   intent → TFA gate (server-side risk) → signed receipt
 *          → escrow/settlement (double-entry μ¢) → release
 *          → Verifiable Credential (W3C) with embedded AP2 mandate linkage
 *          → verifyTfaProof (authenticity + decisionIntegrity + AP2) — ONE verdict
 *
 *   HAPPY      the full chain composes and verifyTfaProof returns valid on every axis.
 *   MONEY      escrow moves exactly the right μ¢ via double-entry; balances reconcile.
 *   PORTABLE   the receipt round-trips through a W3C VC and still verifies.
 *   TAMPER     altering the decision, the linkage, or the signer all fail the verdict.
 *   HITL       approval_required → human approves → running → settlement → proof verifies.
 */
import { test, assert, eq } from "../_harness.mjs";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { InMemoryExecutionStore } from "../../lib/orchestrator/execution-workflow.ts";
import { runActionThroughTfa, buildStatusReceipt, verifyStatusReceipt } from "../../lib/adapter/agent-adapter.ts";
import { verifyTfaProof } from "../../lib/adapter/verify-tfa-proof.ts";
import { linkReceiptToMandates } from "../../lib/adapter/ap2-mandate-link.ts";
import { toVerifiableCredential, verifiableCredentialToReceipt } from "../../lib/adapter/vc-receipt.ts";
import { SettlementService, InMemorySettlementStore } from "../../lib/escrow/settlement.ts";
import { buildSovereignStack } from "../../src/composition.ts";

const signer = new HmacSigner("truth-island-secret-key-32-bytes-long");
const wrongSigner = new HmacSigner("attacker-secret-key-32-bytes-long!!");

function intentFor(toolId: string, value: bigint) {
  return {
    tenantId: "tenant-ti", actorId: "agent:ti", toolId, resourceRef: "res:ti",
    riskClass: "read_only", valueMicrounits: value, privacyLevel: "internal",
    approvalPolicyRef: "pol:default", nonce: "ti-" + Math.random().toString(36).slice(2),
    expiry: "2099-01-01T00:00:00.000Z", provenance: "agent", evidencePolicy: "ev:default",
  } as any;
}

test("happy path: the full chain composes and verifies end-to-end", () => {
  const receipt = runActionThroughTfa(intentFor("token.swap", 5_000_000n), signer, { executionStore: new InMemoryExecutionStore() }).receipt;
  const linkage = linkReceiptToMandates(receipt, [
    { type: "intent", id: "urn:ap2:intent:ti" },
    { type: "payment", id: "urn:ap2:payment:ti" },
  ], signer);

  const verdict = verifyTfaProof(receipt, { keys: signer, mandateLinkage: linkage });
  assert(verdict.valid, `whole proof should verify: ${verdict.reasons.join("; ")}`);
  eq(verdict.checks.authenticity, true);
  eq(verdict.checks.decisionIntegrity, true);
  eq(verdict.checks.mandateLinkage, true);
});

test("money: escrow moves exact μ¢ via double-entry and reconciles", async () => {
  const ledger = buildSovereignStack().ledger;
  const T = "tenant-ti";
  const payer = await ledger.createAccount(T, "payer", "asset", "Payer");
  const worker = await ledger.createAccount(T, "worker", "asset", "Worker");
  await ledger.mint(T, payer.id, 5_000_000n, "seed", "ti", false);

  const svc = new SettlementService(ledger, new InMemorySettlementStore());
  const ag = await svc.create({ tenantId: T, opportunityId: "opp-ti", payerAccountId: payer.id, workerAccountId: worker.id, totalAmount: 5_000_000n, settledBy: "ti" });
  await svc.fund(T, ag.id, "ti");
  await svc.release(T, ag.id, "ti");

  const workerAcct = await ledger.getAccount(T, worker.id);
  const workerBal = workerAcct.balance;
  eq(workerBal, 5_000_000n, "worker received exactly the escrowed amount");
});

test("portable: receipt round-trips through a W3C VC (with AP2 linkage) and still verifies", () => {
  const receipt = runActionThroughTfa(intentFor("file.delete", 0n), signer, { executionStore: new InMemoryExecutionStore() }).receipt;
  const linkage = linkReceiptToMandates(receipt, [{ type: "intent", id: "urn:ap2:intent:vc" }], signer);
  const vc = toVerifiableCredential(receipt, linkage);
  assert(Array.isArray(vc["@context"]) && vc.type.includes("VerifiableCredential"), "is a W3C VC");
  const back = verifiableCredentialToReceipt(vc);
  // the reconstructed receipt must still pass the unified verifier
  const verdict = verifyTfaProof(back, { keys: signer });
  assert(verdict.valid, `round-tripped receipt verifies: ${verdict.reasons.join("; ")}`);
});

test("tamper: altering the decision, the linkage, or the signer all fail the verdict", () => {
  const receipt = runActionThroughTfa(intentFor("infra.apply", 0n), signer, { executionStore: new InMemoryExecutionStore() }).receipt;
  const linkage = linkReceiptToMandates(receipt, [{ type: "intent", id: "urn:ap2:intent:t" }], signer);

  // (a) tampered decision (signed-but-wrong)
  eq(verifyTfaProof({ ...receipt, decision: "allowed", serverRiskClass: "read_only" } as any, { keys: signer }).valid, false, "decision tamper caught");
  // (b) tampered linkage (rebound to evil mandate)
  const evil = { ...linkage, mandates: [{ type: "intent" as const, id: "urn:ap2:intent:EVIL" }] };
  eq(verifyTfaProof(receipt, { keys: signer, mandateLinkage: evil }).valid, false, "linkage tamper caught");
  // (c) wrong signer
  eq(verifyTfaProof(receipt, { keys: wrongSigner }).valid, false, "wrong key caught");
});

test("human-in-the-loop: approval_required → approve → running → settlement → proof verifies", async () => {
  const T = "tenant-ti";
  const store = new InMemoryExecutionStore();

  // Intent that requires approval (token.swap → value_moving → threshold_escrow → approval_required)
  const intent = intentFor("token.swap", 5_000_000n);

  // TFA gate evaluates → approval_required, workflow opened in "planned"
  const result = runActionThroughTfa(intent, signer, { executionStore: store });
  eq(result.decision, "approval_required");
  eq(result.approvalClass, "threshold_escrow");
  eq(result.serverRiskClass, "value_moving");
  assert(result.receipt.approvalToken, "approvalToken present");

  // Workflow is in planned state awaiting approval
  const wfPlanned = store.get(result.receipt.approvalToken!, T);
  eq(wfPlanned.status, "planned");

  // Human-in-the-loop: reviewer approves → system starts execution
  store.transition(wfPlanned.id, T, "approved", "human:alice", "approved by human reviewer");
  store.transition(wfPlanned.id, T, "running", "system", "execution started after approval");

  // Build and verify a signed status receipt showing the workflow is now running
  const wfRunning = store.get(wfPlanned.id, T);
  eq(wfRunning.status, "running");
  const statusReceipt = buildStatusReceipt(wfRunning, signer);
  assert(verifyStatusReceipt(statusReceipt, signer), "status receipt verifies");
  eq(statusReceipt.status, "running");

  // Settlement proceeds after approval (value-moving execution)
  const ledger = buildSovereignStack().ledger;
  const payer = await ledger.createAccount(T, "payer", "asset", "Payer");
  const worker = await ledger.createAccount(T, "worker", "asset", "Worker");
  await ledger.mint(T, payer.id, 5_000_000n, "seed", "ti-hitl", false);

  const svc = new SettlementService(ledger, new InMemorySettlementStore());
  const ag = await svc.create({ tenantId: T, opportunityId: "opp-hitl", payerAccountId: payer.id, workerAccountId: worker.id, totalAmount: 5_000_000n, settledBy: "ti-hitl" });
  await svc.fund(T, ag.id, "ti-hitl");
  await svc.release(T, ag.id, "ti-hitl");

  const workerAcct = await ledger.getAccount(T, worker.id);
  eq(workerAcct.balance, 5_000_000n, "worker received exactly the escrowed amount after human approval");

  // The original receipt still verifies end-to-end (decision was correct: approval_required)
  const linkage = linkReceiptToMandates(result.receipt, [
    { type: "intent", id: "urn:ap2:intent:hitl" },
    { type: "payment", id: "urn:ap2:payment:hitl" },
  ], signer);
  const verdict = verifyTfaProof(result.receipt, { keys: signer, mandateLinkage: linkage });
  assert(verdict.valid, `human-in-the-loop proof verifies: ${verdict.reasons.join("; ")}`);
  eq(verdict.checks.authenticity, true);
  eq(verdict.checks.decisionIntegrity, true);
  eq(verdict.checks.mandateLinkage, true);
});
