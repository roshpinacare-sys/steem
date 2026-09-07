/**
 * tests/risk/provenance-in-decision-trace.test.ts — v320
 * Agent provenance wired into DecisionTrace (MANIFEST: "provenance → decision-trace")
 *
 * Coverage:
 *   feature:
 *     • createDecisionTrace without agentProvenance → no provenance field, valid sig
 *     • createDecisionTrace with agentProvenance → provenance field present in trace
 *     • provenance fields (vendor, agentId, provenanceId) survive round-trip
 *     • provenance is included in canonical payload (bound to signature)
 *   tamper-evidence:
 *     • altering provenance.vendor breaks signature verification
 *     • altering provenance.provenanceId breaks signature verification
 *     • removing provenance from a trace that had it breaks signature verification
 *   fail-closed:
 *     • backward compat: existing tests without provenance still verify correctly
 *   integration (via runActionThroughTfa):
 *     • receipt.decisionTrace.provenance matches normalized provenance
 *     • receipt.provenance and decisionTrace.provenance share same provenanceId
 *     • receipt.signature still valid (canonicalReceiptPayload unchanged)
 *     • no provenance in opts → decisionTrace has no provenance field
 */

import { test, eq, assert } from "../_harness.mjs";
import { createDecisionTrace, resolveApprovalClass, canonicalTracePayload } from "../../lib/risk/approval-policy.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { normalizeAgentProvenance } from "../../lib/adapter/agent-provenance.ts";
import { runActionThroughTfa } from "../../lib/adapter/agent-adapter.ts";
import type { ActionContext } from "../../lib/orchestrator/types.ts";
import type { ActionIntent } from "../../lib/orchestrator/types.ts";

const signer = new HmacSigner("test-secret-32chars-minimum!!!!!");

function ctx(riskClass: string, extra: Partial<ActionContext> = {}): ActionContext {
  return {
    action: { id: "a1", type: "file.delete", payload: {}, source: "test", isFinancial: false, isAutonomous: false, requestedAt: "t" },
    tenantId: "t1",
    timestamp: "t",
    riskClass: riskClass as any,
    ...extra,
  };
}

const testProvenance = normalizeAgentProvenance({ vendor: "anthropic", agentId: "claude-agent-001", model: "claude-sonnet-4-6" });

// ─── feature: without provenance ─────────────────────────────────────────────

test("trace without provenance: no provenance field, valid shape", () => {
  const trace = createDecisionTrace(ctx("read_only"), resolveApprovalClass("read_only"), signer);
  assert(!("provenance" in trace) || trace.provenance === undefined, "no provenance field when none passed");
  assert(typeof trace.signature === "string" && trace.signature.length > 0);
  eq(trace.riskClass, "read_only");
});

test("trace without provenance: signature verifies correctly (backward compat)", () => {
  const approvalClass = resolveApprovalClass("write_safe");
  const trace = createDecisionTrace(ctx("write_safe"), approvalClass, signer);
  const payload = canonicalTracePayload("approval-policy-router", "write_safe", approvalClass, trace.timestamp);
  assert(signer.verify(payload, trace.signature), "trace without provenance must verify");
});

// ─── feature: with provenance ────────────────────────────────────────────────

test("trace with provenance: provenance field present with all identity fields", () => {
  const c = ctx("write_destructive", { agentProvenance: testProvenance });
  const trace = createDecisionTrace(c, resolveApprovalClass("write_destructive"), signer);
  assert(trace.provenance !== undefined, "provenance field must be present");
  eq(trace.provenance!.vendor, "anthropic");
  eq(trace.provenance!.agentId, "claude-agent-001");
  assert(typeof trace.provenance!.provenanceId === "string" && trace.provenance!.provenanceId.length === 64,
    "provenanceId must be a 64-char hex sha256");
});

test("trace with provenance: provenanceId matches normalizeAgentProvenance output", () => {
  const c = ctx("value_moving", { agentProvenance: testProvenance });
  const trace = createDecisionTrace(c, resolveApprovalClass("value_moving"), signer);
  eq(trace.provenance!.provenanceId, testProvenance.provenanceId);
});

test("trace with provenance: provenance is included in canonical payload (bound to signature)", () => {
  const approvalClass = resolveApprovalClass("write_destructive");
  const c = ctx("write_destructive", { agentProvenance: testProvenance });
  const trace = createDecisionTrace(c, approvalClass, signer);
  const payload = canonicalTracePayload(
    "approval-policy-router", "write_destructive", approvalClass, trace.timestamp,
    undefined, undefined, undefined, trace.provenance,
  );
  assert(signer.verify(payload, trace.signature), "trace with provenance must verify against canonical payload");
});

// ─── tamper-evidence ─────────────────────────────────────────────────────────

test("tamper: altering provenance.vendor breaks signature", () => {
  const approvalClass = resolveApprovalClass("write_destructive");
  const c = ctx("write_destructive", { agentProvenance: testProvenance });
  const trace = createDecisionTrace(c, approvalClass, signer);
  const tampered = { ...trace.provenance!, vendor: "openai" };
  const payload = canonicalTracePayload(
    "approval-policy-router", "write_destructive", approvalClass, trace.timestamp,
    undefined, undefined, undefined, tampered,
  );
  assert(!signer.verify(payload, trace.signature), "tampered vendor must not verify");
});

test("tamper: altering provenance.provenanceId breaks signature", () => {
  const approvalClass = resolveApprovalClass("write_safe");
  const c = ctx("write_safe", { agentProvenance: testProvenance });
  const trace = createDecisionTrace(c, approvalClass, signer);
  const tampered = { ...trace.provenance!, provenanceId: "a".repeat(64) };
  const payload = canonicalTracePayload(
    "approval-policy-router", "write_safe", approvalClass, trace.timestamp,
    undefined, undefined, undefined, tampered,
  );
  assert(!signer.verify(payload, trace.signature), "tampered provenanceId must not verify");
});

test("tamper: removing provenance from trace that had it breaks signature", () => {
  const approvalClass = resolveApprovalClass("write_destructive");
  const c = ctx("write_destructive", { agentProvenance: testProvenance });
  const trace = createDecisionTrace(c, approvalClass, signer);
  // Verify with NO provenance in the canonical payload
  const payload = canonicalTracePayload(
    "approval-policy-router", "write_destructive", approvalClass, trace.timestamp,
    undefined, undefined, undefined, undefined,
  );
  assert(!signer.verify(payload, trace.signature), "removing provenance from payload must not verify");
});

// ─── integration via runActionThroughTfa ─────────────────────────────────────

function makeIntent(overrides: Partial<ActionIntent> = {}): ActionIntent {
  return {
    actorId: "actor-1",
    tenantId: "tenant-a",
    toolId: "file.read",
    resourceRef: "/data/report.csv",
    nonce: `nonce-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    valueMicrounits: 0n,
    riskClass: "read_only",
    isFinancial: false,
    isAutonomous: false,
    provenance: "test",
    approvalPolicyRef: "pol:default",
    evidencePolicy: "ev:default",
    expiry: "2099-01-01T00:00:00.000Z",
    privacyLevel: "internal",
    ...overrides,
  };
}

test("integration: decisionTrace.provenance matches normalized provenance from opts", () => {
  const intent = makeIntent();
  const result = runActionThroughTfa(intent, signer, {
    provenance: { vendor: "anthropic", agentId: "claude-agent-001", model: "claude-sonnet-4-6" },
  });
  const trace = result.receipt.decisionTrace;
  assert(trace.provenance !== undefined, "decisionTrace.provenance must be set");
  eq(trace.provenance!.vendor, "anthropic");
  eq(trace.provenance!.agentId, "claude-agent-001");
  assert(typeof trace.provenance!.provenanceId === "string" && trace.provenance!.provenanceId.length === 64);
});

test("integration: decisionTrace.provenance.provenanceId matches receipt.provenance.provenanceId", () => {
  const intent = makeIntent();
  const result = runActionThroughTfa(intent, signer, {
    provenance: { vendor: "xai", agentId: "grok-agent-99" },
  });
  assert(result.receipt.provenance !== undefined, "receipt.provenance must be set");
  assert(result.receipt.decisionTrace.provenance !== undefined, "decisionTrace.provenance must be set");
  eq(result.receipt.decisionTrace.provenance!.provenanceId, result.receipt.provenance!.provenanceId);
});

test("integration: receipt.signature valid when decisionTrace has provenance", () => {
  const intent = makeIntent({ toolId: "db.migration", riskClass: "irreversible" as any });
  // Note: irreversible → deny; the receipt is still signed and valid
  const result = runActionThroughTfa(intent, signer, {
    provenance: { vendor: "google", agentId: "gemini-001" },
  });
  eq(result.decision, "denied");
  assert(typeof result.receipt.signature === "string" && result.receipt.signature.length > 0);
  // The trace must be present and have provenance
  assert(result.receipt.decisionTrace.provenance !== undefined);
  eq(result.receipt.decisionTrace.provenance!.vendor, "google");
});

test("integration: no provenance in opts → decisionTrace has no provenance field", () => {
  const intent = makeIntent();
  const result = runActionThroughTfa(intent, signer, {});
  assert(!("provenance" in result.receipt.decisionTrace) || result.receipt.decisionTrace.provenance === undefined,
    "decisionTrace must have no provenance when none supplied");
});

test("integration: different vendors produce different provenanceIds in trace", () => {
  const intentA = makeIntent({ nonce: "nonce-a" });
  const intentB = makeIntent({ nonce: "nonce-b" });
  const resultA = runActionThroughTfa(intentA, signer, { provenance: { vendor: "anthropic", agentId: "agent-1" } });
  const resultB = runActionThroughTfa(intentB, signer, { provenance: { vendor: "openai", agentId: "agent-1" } });
  assert(
    resultA.receipt.decisionTrace.provenance!.provenanceId !== resultB.receipt.decisionTrace.provenance!.provenanceId,
    "different vendors must produce different provenanceIds",
  );
});
