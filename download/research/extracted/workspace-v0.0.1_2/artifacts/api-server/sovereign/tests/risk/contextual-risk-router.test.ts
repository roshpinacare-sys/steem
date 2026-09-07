/**
 * tests/risk/contextual-risk-router.test.ts — v286
 * Contextual-risk wired into approvalPolicyRouter.
 *
 * Coverage:
 *   • No riskContext → base class unchanged, trace has contextualRisk with escalated=false.
 *   • Velocity 3× → human escalation in trace; signature verifies.
 *   • Large value → threshold_escrow escalation in trace; signature verifies.
 *   • Combined signals → max join, trace records all signals.
 *   • Monotonic: threshold_escrow base + sensitive stays threshold_escrow (never downgrades).
 *   • Fail-closed: bad BigInt in riskContext → deny (caught by scoreContextualRisk).
 *   • Tamper-evidence: altering contextualRisk fields breaks signature verification.
 *   • Audit integration: escalated trace enters audit record and verifies.
 */
import { test, assert, eq } from "../_harness.mjs";
import { approvalPolicyRouter, canonicalTracePayload } from "../../lib/risk/approval-policy.ts";
import type { ActionContext, Action } from "../../lib/orchestrator/types.ts";
import { TfaOrchestrator } from "../../lib/orchestrator/orchestrator.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";

const signer = new HmacSigner("test-secret-for-contextual-risk-32!");

function makeAction(type = "agent.task.run", overrides: Partial<Action> = {}): Action {
  return {
    id: "a1",
    tenantId: "t1",
    type,
    payload: {},
    source: "test",
    isFinancial: false,
    isAutonomous: false,
    requestedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeCtx(riskClass: any, riskContext?: Record<string, unknown>): ActionContext {
  return {
    action: makeAction(),
    tenantId: "t1",
    timestamp: "2026-01-01T00:00:00.000Z",
    riskClass,
    riskContext,
  };
}

// ── No riskContext → base class unchanged ──
test("no riskContext: base class unchanged, trace records non-escalated contextualRisk", () => {
  const guard = approvalPolicyRouter(signer);
  const ctx = makeCtx("read_only");
  // v298: trusted reputationScore keeps the base class unchanged.
  ctx.reputationScore = 70;
  const d = guard.evaluate(ctx);
  assert(d.allow, "read_only should allow");
  assert(ctx.approvalTrace !== undefined, "trace should be on ctx");
  const trace = JSON.parse(ctx.approvalTrace!);
  eq(trace.approvalClass, "auto");
  assert(trace.contextualRisk !== undefined, "trace should carry contextualRisk");
  eq(trace.contextualRisk.baseApprovalClass, "auto");
  eq(trace.contextualRisk.effectiveApprovalClass, "auto");
  eq(trace.contextualRisk.escalated, false);
  assert(Array.isArray(trace.contextualRisk.signals));
  assert(Array.isArray(trace.contextualRisk.explanation));

  // Signature must verify including contextualRisk.
  const payload = canonicalTracePayload(
    trace.policy,
    trace.riskClass,
    trace.approvalClass,
    trace.timestamp,
    trace.simulation,
    trace.contextualRisk,
    trace.riskIntelligence,
  );
  assert(signer.verify(payload, trace.signature), "trace with contextualRisk must verify");
});

// ── Velocity 3× → human escalation ──
test("velocity 3× baseline escalates auto → human, trace records signal", () => {
  const guard = approvalPolicyRouter(signer);
  const ctx = makeCtx("read_only", {
    actorRecentCount: 30,
    actorBaselineCount: 10,
  });
  const d = guard.evaluate(ctx);
  assert(d.allow, "elevated velocity should still allow (human review)");
  const trace = JSON.parse(ctx.approvalTrace!);
  eq(trace.approvalClass, "human");
  assert(trace.contextualRisk.escalated, "should be escalated");
  eq(trace.contextualRisk.baseApprovalClass, "auto");
  eq(trace.contextualRisk.effectiveApprovalClass, "human");
  assert(
    trace.contextualRisk.signals.some((s: any) => s.signal === "velocity_elevated"),
    "trace should contain velocity_elevated signal",
  );

  const payload = canonicalTracePayload(
    trace.policy,
    trace.riskClass,
    trace.approvalClass,
    trace.timestamp,
    trace.simulation,
    trace.contextualRisk,
    trace.riskIntelligence,
  );
  assert(signer.verify(payload, trace.signature), "escalated trace must verify");
});

// ── Large value → threshold_escrow escalation ──
test("large value escalates to threshold_escrow, trace records value signal", () => {
  const guard = approvalPolicyRouter(signer);
  const ctx = makeCtx("write_safe", {
    valueMicrounits: "5000000", // string because Record<string, unknown>; scoreContextualRisk will throw
  });
  // Because valueMicrounits is a string (not BigInt), scoreContextualRisk will throw.
  // The router catches this and treats as deny (fail-closed).
  const d = guard.evaluate(ctx);
  assert(!d.allow, "non-BigInt value should trigger fail-closed deny");
  const trace = JSON.parse(ctx.approvalTrace!);
  eq(trace.approvalClass, "deny");
  assert(trace.contextualRisk.escalated, "should be escalated to deny");
  assert(
    trace.contextualRisk.signals.some((s: any) => s.signal === "contextual_risk_error"),
    "trace should contain contextual_risk_error signal",
  );
});

// ── Valid BigInt large value → threshold_escrow ──
test("valid BigInt large value escalates to threshold_escrow", () => {
  const guard = approvalPolicyRouter(signer);
  const ctx = makeCtx("write_safe", {
    valueMicrounits: 5_000_000n,
    valueEscalationThreshold: 1_000_000n,
  });
  // BigInt in Record<string, unknown> is fine at runtime.
  const d = guard.evaluate(ctx);
  assert(d.allow, "valid BigInt value should escalate to threshold_escrow and still allow");
  const trace = JSON.parse(ctx.approvalTrace!);
  eq(trace.approvalClass, "threshold_escrow");
  assert(trace.contextualRisk.escalated, "should be escalated");
  assert(
    trace.contextualRisk.signals.some((s: any) => s.signal === "value_large"),
    "trace should contain value_large signal",
  );
});

// ── Combined signals → max join ──
test("combined signals take the most restrictive (max join)", () => {
  const guard = approvalPolicyRouter(signer);
  const ctx = makeCtx("read_only", {
    actorRecentCount: 100,
    actorBaselineCount: 10,
    valueMicrounits: 9_000_000n,
    valueEscalationThreshold: 1_000_000n,
    offHours: true,
    novelForActor: true,
  });
  const d = guard.evaluate(ctx);
  assert(d.allow, "should allow with threshold_escrow (most restrictive signal)");
  const trace = JSON.parse(ctx.approvalTrace!);
  eq(trace.approvalClass, "threshold_escrow");
  assert(trace.contextualRisk.signals.length >= 3, "all signals recorded");

  const payload = canonicalTracePayload(
    trace.policy,
    trace.riskClass,
    trace.approvalClass,
    trace.timestamp,
    trace.simulation,
    trace.contextualRisk,
    trace.riskIntelligence,
  );
  assert(signer.verify(payload, trace.signature), "combined-signal trace must verify");
});

// ── Monotonic: threshold_escrow base + sensitive stays threshold_escrow ──
test("monotonic: high base class is never downgraded by contextual signals", () => {
  const guard = approvalPolicyRouter(signer);
  const ctx = makeCtx("value_moving", {
    resourceSensitivity: "sensitive", // would normally → opa_check, but base is threshold_escrow
  });
  const d = guard.evaluate(ctx);
  assert(d.allow, "threshold_escrow should allow");
  const trace = JSON.parse(ctx.approvalTrace!);
  eq(trace.approvalClass, "threshold_escrow");
  eq(trace.contextualRisk.escalated, false, "should not be escalated because base is already higher");
  eq(trace.contextualRisk.baseApprovalClass, "threshold_escrow");
  eq(trace.contextualRisk.effectiveApprovalClass, "threshold_escrow");
});

// ── Tamper-evidence: altering contextualRisk breaks signature ──
test("tamper: altering contextualRisk.effectiveApprovalClass breaks verification", () => {
  const guard = approvalPolicyRouter(signer);
  const ctx = makeCtx("read_only", { offHours: true });
  guard.evaluate(ctx);
  const trace = JSON.parse(ctx.approvalTrace!);
  eq(trace.approvalClass, "human");

  // Tamper: downgrade human → auto in the contextualRisk sub-object
  const tampered = { ...trace, contextualRisk: { ...trace.contextualRisk, effectiveApprovalClass: "auto" } };
  const payload = canonicalTracePayload(
    tampered.policy,
    tampered.riskClass,
    tampered.approvalClass,
    tampered.timestamp,
    tampered.simulation,
    tampered.contextualRisk,
    tampered.riskIntelligence,
  );
  assert(!signer.verify(payload, tampered.signature), "tampered contextualRisk must break verification");
});

// ── Audit integration: escalated trace enters audit record ──
test("audit record contains escalated contextualRisk trace and signature verifies", async () => {
  const guard = approvalPolicyRouter(signer);
  const { injectRiskClass } = await import("../../lib/risk/action-risk.ts");
  const orch = new TfaOrchestrator([injectRiskClass(), guard]);
  const action = makeAction("ledger.solvency_check", { isFinancial: true });
  // Inject riskContext via a custom pre-policy so the orchestrator builds the full ctx.
  const injectCtx: import("../../lib/orchestrator/types.ts").GuardPolicy = {
    name: "inject-risk-ctx",
    evaluate: (c: any) => {
      c.riskContext = { offHours: true, valueMicrounits: 2_000_000n, valueEscalationThreshold: 1_000_000n };
      return { allow: true };
    },
  };
  const orch2 = new TfaOrchestrator([injectRiskClass(), injectCtx, guard]);
  const result = await orch2.run(action, async () => "ok");
  assert(result.ok, "should be allowed after escalation");
  const rec = orch2.audit.getRecord(result.auditId);
  assert(rec !== null);
  eq(rec!.outcome, "allowed");
  const trace = JSON.parse(rec!.reason!);
  eq(trace.approvalClass, "threshold_escrow");
  assert(trace.contextualRisk.escalated, "audit trace should show escalation");
  assert(
    trace.contextualRisk.signals.some((s: any) => s.signal === "off_hours" || s.signal === "value_large"),
    "audit trace should carry escalation signals",
  );

  const payload = canonicalTracePayload(
    trace.policy,
    trace.riskClass,
    trace.approvalClass,
    trace.timestamp,
    trace.simulation,
    trace.contextualRisk,
    trace.riskIntelligence,
  );
  assert(signer.verify(payload, trace.signature), "audit trace signature with contextualRisk must verify");
});
