import "../_flush.mjs";
/**
 * tests/adapter/agent-adapter.test.ts — v155.
 * TFA Agent Adapter (minimal): runActionThroughTfa → decision + signed receipt.
 *
 *   FEATURE       each risk class maps to the right decision (allowed/approval_required/denied).
 *   RECEIPT       the receipt is signed, self-verifying, and binds the intent + trace.
 *   EDGE          tampering with any receipt field breaks verification.
 *   FAIL-CLOSED   an invalid / expired intent throws; an unknown risk class → denied.
 */
import { test, assert, eq } from "../_harness.mjs";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import {
  runActionThroughTfa, verifyExecutionReceipt, decisionForApprovalClass,
} from "../../lib/adapter/agent-adapter.ts";
import { normalizeAgentProvenance } from "../../lib/adapter/agent-provenance.ts";

const signer = new HmacSigner("adapter-test-secret");
const FIXED = () => "2026-01-01T00:00:00.000Z";

function intent(over: Record<string, unknown> = {}) {
  return {
    tenantId: "t1", actorId: "agent:1", toolId: "file.read", resourceRef: "res:1",
    riskClass: "read_only", valueMicrounits: 0n, privacyLevel: "internal",
    approvalPolicyRef: "pol:default", nonce: "nonce-" + Math.random().toString(36).slice(2),
    expiry: "2099-01-01T00:00:00.000Z", provenance: "agent", evidencePolicy: "ev:default",
    ...over,
  } as any;
}

// ── FEATURE: server-side risk classification → decision ──
// The adapter overrides any client-supplied riskClass based on toolId.
test("server-side classification drives decision: coding + general taxonomy", () => {
  // coding taxonomy
  eq(runActionThroughTfa(intent({ toolId: "file.read" }), signer).decision, "allowed");           // read_only
  eq(runActionThroughTfa(intent({ toolId: "git.commit" }), signer).decision, "allowed");         // write_safe
  eq(runActionThroughTfa(intent({ toolId: "file.delete" }), signer).decision, "approval_required"); // write_destructive
  eq(runActionThroughTfa(intent({ toolId: "env.read" }), signer).decision, "approval_required");  // privacy_sensitive
  eq(runActionThroughTfa(intent({ toolId: "shell.exec" }), signer).decision, "denied");          // irreversible
  // general taxonomy
  eq(runActionThroughTfa(intent({ toolId: "ledger.mint", valueMicrounits: 500000n }), signer).decision, "approval_required"); // value_moving
  // fail-closed default
  eq(runActionThroughTfa(intent({ toolId: "unknown.action" }), signer).decision, "denied");       // fail_closed_default → irreversible
  // pure mapping helper
  eq(decisionForApprovalClass("auto"), "allowed");
  eq(decisionForApprovalClass("deny"), "denied");
  eq(decisionForApprovalClass("threshold_escrow"), "approval_required");
});

// ── RECEIPT: signed, self-verifying, binds intent + money as μ¢ string ──
test("the receipt is signed, self-verifying, and carries the intent + trace", () => {
  const r = runActionThroughTfa(intent({ toolId: "ledger.mint", riskClass: "value_moving", valueMicrounits: 1234567n, nonce: "n-abc" }), signer, { now: FIXED });
  const { receipt } = r;
  eq(receipt.version, "tfa-receipt-v1");
  eq(receipt.intentId, "n-abc");
  eq(receipt.approvalClass, "threshold_escrow");
  eq(receipt.decision, "approval_required");
  eq(receipt.valueMicrounits, "1234567", "money is a μ¢ decimal string");
  eq(receipt.issuedAt, "2026-01-01T00:00:00.000Z");
  eq(receipt.serverRiskClass, "value_moving");
  eq(receipt.clientClaimedRiskClass, "value_moving");
  eq(receipt.riskSource, "general_taxonomy");
  assert(receipt.signature.length > 0, "receipt is signed");
  assert(receipt.decisionTrace.signature.length > 0, "embedded decision trace is signed");
  assert(verifyExecutionReceipt(receipt, signer), "a fresh receipt verifies");
});

// ── EDGE: tampering breaks verification ──
test("tampering with any receipt field breaks verification", () => {
  const { receipt } = runActionThroughTfa(intent({ toolId: "file.read" }), signer, { now: FIXED });
  assert(verifyExecutionReceipt(receipt, signer), "baseline verifies");
  assert(!verifyExecutionReceipt({ ...receipt, decision: "allowed" === receipt.decision ? "denied" : "allowed" } as any, signer), "flipped decision fails");
  assert(!verifyExecutionReceipt({ ...receipt, valueMicrounits: "999" }, signer), "changed amount fails");
  assert(!verifyExecutionReceipt({ ...receipt, tenantId: "other" }, signer), "changed tenant fails");
  assert(!verifyExecutionReceipt({ ...receipt, signature: "AAAA" }, signer), "forged signature fails");
  // tampering the new server-side fields also breaks verification
  assert(!verifyExecutionReceipt({ ...receipt, serverRiskClass: "irreversible" } as any, signer), "tampered serverRiskClass fails");
  assert(!verifyExecutionReceipt({ ...receipt, clientClaimedRiskClass: "write_destructive" } as any, signer), "tampered clientClaimedRiskClass fails");
  assert(!verifyExecutionReceipt({ ...receipt, riskSource: "fail_closed_default" } as any, signer), "tampered riskSource fails");
  // tampering the embedded trace fails too
  assert(!verifyExecutionReceipt({ ...receipt, decisionTrace: { ...receipt.decisionTrace, approvalClass: "deny" } } as any, signer), "tampered trace fails");
  // a different signer cannot verify
  assert(!verifyExecutionReceipt(receipt, new HmacSigner("a-totally-different-secret-key")), "wrong signer fails");
});

// ── FAIL-CLOSED: invalid / expired intent throws ──
test("invalid or expired intents fail closed", () => {
  const expectThrow = (over: Record<string, unknown>, label: string) => {
    let threw = false;
    try { runActionThroughTfa(intent(over), signer); } catch { threw = true; }
    assert(threw, `${label} must throw`);
  };
  expectThrow({ tenantId: "" }, "empty tenantId");
  expectThrow({ valueMicrounits: -5n }, "negative money");
  expectThrow({ expiry: "2000-01-01T00:00:00.000Z" }, "expired intent");
  expectThrow({ riskClass: "not_a_class" }, "invalid risk class");
  // verify rejects malformed receipts without throwing
  eq(verifyExecutionReceipt(null as any, signer), false);
  eq(verifyExecutionReceipt({ version: "wrong" } as any, signer), false);
});

// ── SERVER-SIDE OVERRIDE: client claim is ignored, server classifies by toolId ──
test("server-side override: client claims read_only for shell.exec → server returns irreversible + denied", () => {
  const r = runActionThroughTfa(
    intent({ toolId: "shell.exec", riskClass: "read_only" }),
    signer,
    { now: FIXED },
  );
  eq(r.decision, "denied", "shell.exec must be denied regardless of client claim");
  eq(r.serverRiskClass, "irreversible");
  eq(r.clientClaimedRiskClass, "read_only");
  eq(r.riskSource, "coding_taxonomy");
  eq(r.receipt.serverRiskClass, "irreversible");
  eq(r.receipt.clientClaimedRiskClass, "read_only");
  eq(r.receipt.riskSource, "coding_taxonomy");
  assert(verifyExecutionReceipt(r.receipt, signer), "override receipt must self-verify");
});

test("server-side override: client claims write_safe for db.migration → server returns irreversible", () => {
  const r = runActionThroughTfa(
    intent({ toolId: "db.migration", riskClass: "write_safe" }),
    signer,
  );
  eq(r.decision, "denied");
  eq(r.serverRiskClass, "irreversible");
  eq(r.clientClaimedRiskClass, "write_safe");
  eq(r.riskSource, "coding_taxonomy");
});

test("server-side override: client underclaims ledger.mint as read_only → server returns value_moving", () => {
  const r = runActionThroughTfa(
    intent({ toolId: "ledger.mint", riskClass: "read_only", valueMicrounits: 100000n }),
    signer,
  );
  eq(r.decision, "approval_required");
  eq(r.serverRiskClass, "value_moving");
  eq(r.clientClaimedRiskClass, "read_only");
  eq(r.riskSource, "general_taxonomy");
  assert(verifyExecutionReceipt(r.receipt, signer), "general taxonomy receipt must self-verify");
});

// ── PROVENANCE (v313): vendor-neutral agent identity bound into receipt ──
test("receipt carries normalized provenance when provided, and verification binds it", () => {
  const provInput = { vendor: "Claude", agentId: "agent-42", model: "claude-opus-4.8" };
  const { receipt } = runActionThroughTfa(
    intent({ toolId: "file.read" }),
    signer,
    { now: FIXED, provenance: provInput },
  );
  assert(receipt.provenance !== undefined, "provenance present");
  eq(receipt.provenance!.vendor, "anthropic", "normalized to canonical vendor");
  eq(receipt.provenance!.agentId, "agent-42");
  eq(receipt.provenance!.model, "claude-opus-4.8");
  assert(receipt.provenance!.provenanceId.length > 0, "fingerprint present");
  assert(verifyExecutionReceipt(receipt, signer), "receipt with provenance self-verifies");
  // tampering with the bound provenance fingerprint breaks verification
  const tampered = { ...receipt, provenance: { ...receipt.provenance!, provenanceId: "tampered" } };
  assert(!verifyExecutionReceipt(tampered as any, signer), "tampered provenanceId fails verification");
});

test("receipt omits provenance field when not provided", () => {
  const { receipt } = runActionThroughTfa(intent({ toolId: "file.read" }), signer, { now: FIXED });
  eq(receipt.provenance, undefined, "no provenance when absent");
  assert(verifyExecutionReceipt(receipt, signer), "receipt without provenance still verifies");
});
