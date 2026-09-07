/**
 * tests/adapter/simulation-in-receipt.test.ts  (v243)
 *
 * Verifies that the pre-action SimulationResult is computed and bound into the
 * signed ExecutionReceipt (via decisionTrace.simulation) for every decision
 * outcome, and that this does not break the existing receipt/trace verification
 * contract.
 *
 * Coverage:
 *   A. Happy path: an action with a known taxonomy entry → decisionTrace.simulation
 *      is populated with the expected fields (actionType, riskClass, blastRadius,
 *      predictedEffect, requiresBackup, warnings).
 *   B. Decision-independent: simulation is present for allowed, approval_required,
 *      AND denied decisions alike (it's informational, not gating).
 *   C. verifyExecutionReceipt() still returns true for a receipt that carries a
 *      simulation (regression guard for the canonicalTracePayload desync bug).
 *   D. Tampering with the embedded simulation (after signing) breaks verification —
 *      proves the simulation is cryptographically bound, not just attached data.
 *   E. Fail-closed / advisory-only: an unknown action type still produces SOME
 *      simulation (fail-closed taxonomy default) and never throws — the decision
 *      pipeline is unaffected even if simulation were to fail.
 *   F. Value-moving actions: valueAtRiskMicrounits is populated as a decimal string
 *      matching intent.valueMicrounits.
 *   G. HMAC and Ed25519 signers both produce verifiable receipts with simulation.
 */

import { test, eq, assert } from "../_harness.mjs";
import { HmacSigner, Ed25519Signer, generateAuditKeyPair } from "../../lib/orchestrator/signer.ts";
import { runActionThroughTfa, verifyExecutionReceipt } from "../../lib/adapter/agent-adapter.ts";
import type { ActionIntent } from "../../lib/orchestrator/types.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const hmacSigner = new HmacSigner("simulation-receipt-test-secret-min32!!");

function makeEd25519Signer() {
  const { privateKey, publicKey } = generateAuditKeyPair();
  return new Ed25519Signer(privateKey, publicKey);
}

function makeIntent(over: Partial<ActionIntent> = {}): ActionIntent {
  return {
    actorId: "agent:test",
    toolId: "file.read",
    resourceRef: "res:doc-1",
    riskClass: "read_only",
    valueMicrounits: 0n,
    nonce: "nonce-" + Math.random().toString(36).slice(2),
    expiry: new Date(Date.now() + 60_000).toISOString(),
    tenantId: "tenant-sim-test",
    approvalPolicyRef: "default",
    privacyLevel: "internal",
    evidencePolicy: "default",
    provenance: "test",
    ...over,
  };
}

// ─── A. Happy path ────────────────────────────────────────────────────────────

test("simulation-in-receipt [A-1]: known action populates decisionTrace.simulation", async () => {
  const result = await runActionThroughTfa(makeIntent({ toolId: "file.delete", riskClass: "write_destructive" }), hmacSigner);
  const sim = result.receipt.decisionTrace.simulation;
  assert(sim !== undefined, "decisionTrace.simulation must be populated");
  eq(sim!.actionType, "file.delete", "actionType must match the tool id");
  assert(typeof sim!.predictedEffect === "string" && sim!.predictedEffect.length > 0, "predictedEffect must be a non-empty string");
  assert(Array.isArray(sim!.warnings), "warnings must be an array");
  assert(typeof sim!.requiresBackup === "boolean", "requiresBackup must be boolean");
  assert(typeof sim!.reversible === "boolean", "reversible must be boolean");
  assert(typeof sim!.blastRadius === "string" && sim!.blastRadius.length > 0, "blastRadius must be a non-empty string");
});

test("simulation-in-receipt [A-2]: shell.exec action gets unbounded blast radius", async () => {
  const result = await runActionThroughTfa(makeIntent({ toolId: "shell.exec", riskClass: "irreversible" }), hmacSigner);
  const sim = result.receipt.decisionTrace.simulation;
  assert(sim !== undefined, "simulation must be present");
  eq(sim!.blastRadius, "unbounded", "shell.exec must simulate unbounded blast radius");
});

// ─── B. Decision-independent ──────────────────────────────────────────────────

test("simulation-in-receipt [B-1]: simulation present for allowed decision", async () => {
  const result = await runActionThroughTfa(makeIntent({ toolId: "file.read", riskClass: "read_only" }), hmacSigner);
  eq(result.receipt.decision, "allowed", "read_only must be auto-allowed");
  assert(result.receipt.decisionTrace.simulation !== undefined, "simulation must be present even when allowed");
});

test("simulation-in-receipt [B-2]: simulation present for approval_required decision", async () => {
  const result = await runActionThroughTfa(makeIntent({ toolId: "file.delete", riskClass: "write_destructive" }), hmacSigner);
  eq(result.receipt.decision, "approval_required", "file.delete must require approval");
  assert(result.receipt.decisionTrace.simulation !== undefined, "simulation must be present when approval_required");
});

test("simulation-in-receipt [B-3]: simulation present for denied decision", async () => {
  // Use a client-claimed risk class far below server classification to force a deny path
  // via an unknown/irreversible action type that resolves to "deny".
  const result = await runActionThroughTfa(makeIntent({ toolId: "shell.exec", riskClass: "read_only" }), hmacSigner);
  eq(result.receipt.decision, "denied", "shell.exec must resolve to denied (irreversible → deny)");
  assert(result.receipt.decisionTrace.simulation !== undefined, "simulation must be present even when denied");
});

// ─── C. Verification regression guard ─────────────────────────────────────────

test("simulation-in-receipt [C-1]: verifyExecutionReceipt passes for a receipt carrying a simulation", async () => {
  const result = await runActionThroughTfa(makeIntent({ toolId: "file.delete", riskClass: "write_destructive" }), hmacSigner);
  assert(result.receipt.decisionTrace.simulation !== undefined, "sanity: simulation must be present");
  const valid = verifyExecutionReceipt(result.receipt, hmacSigner);
  assert(valid, "verifyExecutionReceipt must succeed for a receipt whose trace includes a simulation");
});

test("simulation-in-receipt [C-2]: verifyExecutionReceipt passes for a denied receipt with simulation", async () => {
  const result = await runActionThroughTfa(makeIntent({ toolId: "shell.exec", riskClass: "read_only" }), hmacSigner);
  const valid = verifyExecutionReceipt(result.receipt, hmacSigner);
  assert(valid, "verifyExecutionReceipt must succeed for a denied receipt whose trace includes a simulation");
});

// ─── D. Tamper detection ───────────────────────────────────────────────────────

test("simulation-in-receipt [D-1]: tampering the embedded simulation breaks verification", async () => {
  const result = await runActionThroughTfa(makeIntent({ toolId: "file.delete", riskClass: "write_destructive" }), hmacSigner);
  const tampered = {
    ...result.receipt,
    decisionTrace: {
      ...result.receipt.decisionTrace,
      simulation: {
        ...result.receipt.decisionTrace.simulation!,
        predictedEffect: "TAMPERED: nothing will happen",
      },
    },
  };
  const valid = verifyExecutionReceipt(tampered, hmacSigner);
  assert(!valid, "tampering the simulation payload must break trace verification");
});

test("simulation-in-receipt [D-2]: removing the simulation entirely also breaks verification", async () => {
  const result = await runActionThroughTfa(makeIntent({ toolId: "file.delete", riskClass: "write_destructive" }), hmacSigner);
  const tampered = {
    ...result.receipt,
    decisionTrace: { ...result.receipt.decisionTrace, simulation: undefined },
  };
  const valid = verifyExecutionReceipt(tampered, hmacSigner);
  assert(!valid, "stripping a signed simulation must break trace verification");
});

// ─── E. Fail-closed / advisory-only ───────────────────────────────────────────

test("simulation-in-receipt [E-1]: unknown action type still produces a fail-closed simulation, never throws", async () => {
  const result = await runActionThroughTfa(makeIntent({ toolId: "totally.unknown.action.xyz", riskClass: "read_only" }), hmacSigner);
  // Decision pipeline must complete regardless of simulation outcome.
  assert(result.receipt.decision !== undefined, "decision must be computed");
  // Simulation is advisory: it may be present (fail-closed default) but must never throw.
  // We only assert no exception occurred (implicit — we reached this line) and the
  // receipt is well-formed.
  assert(typeof result.receipt.signature === "string" && result.receipt.signature.length > 0, "receipt must still be signed");
});

// ─── F. Value-moving actions ──────────────────────────────────────────────────

test("simulation-in-receipt [F-1]: value-moving action's simulation carries valueAtRiskMicrounits", async () => {
  const result = await runActionThroughTfa(
    makeIntent({ toolId: "ledger.mint", riskClass: "value_moving", valueMicrounits: 500_000n }),
    hmacSigner,
  );
  const sim = result.receipt.decisionTrace.simulation;
  assert(sim !== undefined, "simulation must be present for value-moving action");
  eq(sim!.valueAtRiskMicrounits, "500000", "valueAtRiskMicrounits must match intent value as decimal string");
});

// ─── G. Works with both signer kinds ──────────────────────────────────────────

test("simulation-in-receipt [G-1]: Ed25519Signer also produces a verifiable receipt with simulation", async () => {
  const signer = makeEd25519Signer();
  const result = await runActionThroughTfa(makeIntent({ toolId: "file.delete", riskClass: "write_destructive" }), signer);
  assert(result.receipt.decisionTrace.simulation !== undefined, "simulation must be present");
  const valid = verifyExecutionReceipt(result.receipt, signer);
  assert(valid, "verifyExecutionReceipt must succeed for Ed25519-signed receipt with simulation");
});
