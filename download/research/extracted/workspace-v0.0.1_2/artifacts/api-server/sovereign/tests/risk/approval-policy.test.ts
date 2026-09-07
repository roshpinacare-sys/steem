import "../_flush.mjs";
/**
 * tests/risk/approval-policy.test.ts — ApprovalPolicy router (sub-step 2 of #1).
 *
 * Coverage:
 *   MAP      every ActionRiskClass maps to a valid ApprovalClass (no gaps, no extras).
 *   RESOLVE  known risk classes resolve to the expected approval class.
 *   FAIL     undefined / unknown risk class → "deny" (fail-closed).
 *   GUARD    auto/opa_check/human/threshold_escrow → allow + trace on ctx.
 *   GUARD    deny → deny + trace in reason and on ctx.
 *   TRACE    signature is valid and verifiable with the same signer.
 *   AUDIT    allowed action → audit record.reason contains the signed trace.
 *   AUDIT    denied action → audit record.reason contains the trace.
 */
import { test, assert, eq } from "../_harness.mjs";
import {
  RISK_TO_APPROVAL_MAP,
  APPROVAL_CLASSES,
  resolveApprovalClass,
  createDecisionTrace,
  approvalPolicyRouter,
  canonicalTracePayload,
} from "../../lib/risk/approval-policy.ts";
import { RISK_CLASSES } from "../../lib/risk/action-risk.ts";
import type { ActionRiskClass, ActionContext, Action } from "../../lib/orchestrator/types.ts";
import { TfaOrchestrator } from "../../lib/orchestrator/orchestrator.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";

const ALL_RISK_CLASSES = RISK_CLASSES as readonly string[];
const ALL_APPROVAL_CLASSES = APPROVAL_CLASSES as readonly string[];

function makeSigner(): HmacSigner {
  return new HmacSigner("test-secret-for-approval-policy-32b");
}

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

function makeCtx(riskClass?: ActionRiskClass): ActionContext {
  return {
    action: makeAction(),
    tenantId: "t1",
    timestamp: "2026-01-01T00:00:00.000Z",
    riskClass,
  };
}

// ── MAP: every risk class is mapped to a valid approval class ──
test("every risk class is explicitly mapped to a valid approval class", () => {
  const valid = new Set<string>(ALL_APPROVAL_CLASSES);
  for (const rc of ALL_RISK_CLASSES) {
    assert(rc in RISK_TO_APPROVAL_MAP, `risk class "${rc}" must have an approval mapping`);
    const ac = RISK_TO_APPROVAL_MAP[rc as ActionRiskClass];
    assert(valid.has(ac), `"${rc}" maps to a valid ApprovalClass (got "${ac}")`);
  }
  // No stray entries in the map.
  for (const rc of Object.keys(RISK_TO_APPROVAL_MAP)) {
    assert(ALL_RISK_CLASSES.includes(rc), `map entry "${rc}" corresponds to a real risk class`);
  }
});

// ── RESOLVE: representative mappings ──
test("resolveApprovalClass returns expected approval classes", () => {
  eq(resolveApprovalClass("read_only"), "auto");
  eq(resolveApprovalClass("write_safe"), "auto");
  eq(resolveApprovalClass("write_destructive"), "human");
  eq(resolveApprovalClass("value_moving"), "threshold_escrow");
  eq(resolveApprovalClass("irreversible"), "deny");
  eq(resolveApprovalClass("privacy_sensitive"), "opa_check");
  eq(resolveApprovalClass("regulated"), "deny");
});

// ── FAIL-CLOSED: undefined / unknown / empty → deny ──
test("unmapped or missing risk class resolves to deny (fail-closed)", () => {
  eq(resolveApprovalClass(undefined), "deny");
  eq(resolveApprovalClass("unknown" as ActionRiskClass), "deny");
  eq(resolveApprovalClass("" as ActionRiskClass), "deny");
});

// ── GUARD: allowed classes → allow + trace on ctx ──
test("approvalPolicyRouter allows auto, opa_check, human, threshold_escrow", () => {
  const signer = makeSigner();
  const guard = approvalPolicyRouter(signer);
  eq(guard.name, "approval-policy-router");

  for (const cls of ["auto", "opa_check", "human", "threshold_escrow"] as const) {
    // Find a risk class that maps to this approval class.
    const riskCls = Object.entries(RISK_TO_APPROVAL_MAP).find(([, v]) => v === cls)![0] as ActionRiskClass;
    const ctx = makeCtx(riskCls);
    // v298: reputationScore 70 (trusted) keeps the base class unchanged (monotonic).
    // Without a reputationScore the band would be "new" and auto would escalate to opa_check.
    ctx.reputationScore = 70;
    const d = guard.evaluate(ctx);
    assert(d.allow, `approval class "${cls}" should allow`);
    assert(ctx.approvalTrace !== undefined, `trace should be stored on ctx for "${cls}"`);

    const trace = JSON.parse(ctx.approvalTrace!);
    eq(trace.policy, "approval-policy-router");
    eq(trace.riskClass, riskCls);
    eq(trace.approvalClass, cls);
    assert(typeof trace.timestamp === "string");
    assert(typeof trace.signature === "string");
    // v298: trace should carry riskIntelligence when assessRisk is wired.
    assert(trace.riskIntelligence !== undefined, `trace should carry riskIntelligence for "${cls}"`);
    eq(trace.riskIntelligence.effectiveApprovalClass, cls);
    eq(trace.riskIntelligence.reputationBand, "trusted");
  }
});

// ── GUARD: deny class → deny + trace in reason and on ctx ──
test("approvalPolicyRouter denies when approval class is deny", () => {
  const signer = makeSigner();
  const guard = approvalPolicyRouter(signer);
  const ctx = makeCtx("irreversible");
  const d = guard.evaluate(ctx);
  assert(!d.allow, "irreversible should deny");
  assert(d.reason!.includes("effective=deny"), "reason should mention effective deny");
  assert(ctx.approvalTrace !== undefined, "trace should be on ctx");
  assert(d.reason!.includes(ctx.approvalTrace!), "reason should contain the trace");
});

// ── GUARD: missing riskClass → deny (fail-closed) ──
test("approvalPolicyRouter denies when ctx.riskClass is missing", () => {
  const signer = makeSigner();
  const guard = approvalPolicyRouter(signer);
  const ctx = makeCtx(undefined);
  const d = guard.evaluate(ctx);
  assert(!d.allow, "missing riskClass should deny (fail-closed)");
  assert(d.reason!.includes("unknown"), "reason should mention unknown");
  assert(ctx.approvalTrace !== undefined, "trace should still be stored");
  const trace = JSON.parse(ctx.approvalTrace!);
  eq(trace.riskClass, "unknown");
  eq(trace.approvalClass, "deny");
});

// ── TRACE: signature is valid and verifiable ──
test("decision trace signature is valid and verifiable", () => {
  const signer = makeSigner();
  const ctx = makeCtx("value_moving");
  const trace = createDecisionTrace(ctx, "threshold_escrow", signer);
  eq(trace.policy, "approval-policy-router");
  eq(trace.riskClass, "value_moving");
  eq(trace.approvalClass, "threshold_escrow");
  assert(typeof trace.timestamp === "string");
  assert(typeof trace.signature === "string");

  // Recompute the canonical payload and verify the signature.
  const payload = JSON.stringify({
    approvalClass: "threshold_escrow",
    policy: "approval-policy-router",
    riskClass: "value_moving",
    timestamp: trace.timestamp,
  });
  assert(signer.verify(payload, trace.signature), "signature must verify against canonical payload");
});

// ── AUDIT: allowed action → trace enters audit record ──
test("allowed action's audit record contains the signed trace", async () => {
  const signer = makeSigner();
  const guard = approvalPolicyRouter(signer);
  const orch = new TfaOrchestrator([guard]);
  const action = makeAction("ledger.solvency_check", { isFinancial: true });
  // Note: injectRiskClass is not wired here, so ctx.riskClass is undefined.
  // approvalPolicyRouter will see undefined → deny. We need a mock injectRiskClass
  // or set the riskClass manually. Let's use injectRiskClass.
  const { injectRiskClass } = await import("../../lib/risk/action-risk.ts");
  // v298: inject a trusted reputationScore so the base class (auto) is preserved.
  const injectRep: import("../../lib/orchestrator/types.ts").GuardPolicy = {
    name: "inject-reputation",
    evaluate: (c: any) => {
      c.reputationScore = 70;
      return { allow: true };
    },
  };
  const orch2 = new TfaOrchestrator([injectRiskClass(), injectRep, guard]);
  const result = await orch2.run(action, async () => "ok");
  assert(result.ok, "should be allowed after risk injection");
  const rec = orch2.audit.getRecord(result.auditId);
  assert(rec !== null);
  eq(rec!.outcome, "allowed");
  assert(rec!.reason !== undefined, "audit record should have reason (the trace)");
  const trace = JSON.parse(rec!.reason!);
  eq(trace.policy, "approval-policy-router");
  eq(trace.riskClass, "read_only");
  eq(trace.approvalClass, "auto");
  assert(typeof trace.signature === "string");
  // Verify the trace signature using canonicalTracePayload (includes simulation, contextualRisk and riskIntelligence if present).
  const payload = canonicalTracePayload(
    trace.policy,
    trace.riskClass,
    trace.approvalClass,
    trace.timestamp,
    trace.simulation,
    trace.contextualRisk,
    trace.riskIntelligence,
  );
  assert(signer.verify(payload, trace.signature), "audit trace signature must verify");
});

// ── AUDIT: denied action → trace enters audit record via reason ──
test("denied action's audit record contains the trace in reason", async () => {
  const signer = makeSigner();
  const guard = approvalPolicyRouter(signer);
  const orch = new TfaOrchestrator([guard]);
  // Use an action whose risk class is deny (irreversible).
  const action = makeAction("marketplace.unknown", { isFinancial: true });
  // Without injectRiskClass, ctx.riskClass is undefined → deny.
  // But we want to test a real deny from the map. Let's wire injectRiskClass
  // and use a type that maps to irreversible. Currently no known type maps to
  // irreversible in ACTION_RISK_MAP, so injectRiskClass won't set it.
  // We'll manually create a guard that injects a riskClass then the router.
  const inject: import("../../lib/orchestrator/types.ts").GuardPolicy = {
    name: "inject-irreversible",
    evaluate: (ctx: any) => {
      ctx.riskClass = "irreversible";
      return { allow: true };
    },
  };
  const orch2 = new TfaOrchestrator([inject, guard]);
  const result = await orch2.run(action, async () => "ok");
  assert(!result.ok, "should be denied");
  const rec = orch2.audit.getRecord(result.auditId);
  assert(rec !== null);
  eq(rec!.outcome, "denied");
  assert(rec!.reason !== undefined);
  assert(rec!.reason!.includes("effective=deny"), "reason should contain effective deny message");
  assert(rec!.reason!.includes("trace="), "reason should contain trace marker");
  // Extract and verify the trace portion.
  const traceMatch = rec!.reason!.match(/trace=(.+)/);
  assert(traceMatch !== null, "should find trace JSON in reason");
  const trace = JSON.parse(traceMatch![1]);
  eq(trace.approvalClass, "deny");
  eq(trace.riskClass, "irreversible");
  assert(typeof trace.signature === "string");
  const payload = canonicalTracePayload(
    trace.policy,
    trace.riskClass,
    trace.approvalClass,
    trace.timestamp,
    trace.simulation,
    trace.contextualRisk,
    trace.riskIntelligence,
  );
  assert(signer.verify(payload, trace.signature), "denied trace signature must verify");
});

// ── v298: assessRisk wired into approvalPolicyRouter ──

test("approvalPolicyRouter reads reputationScore from ctx and fuses it into trace", () => {
  const signer = makeSigner();
  const guard = approvalPolicyRouter(signer);

  // Trusted actor (70) — base class preserved.
  const ctxTrusted = makeCtx("read_only");
  ctxTrusted.reputationScore = 70;
  const dTrusted = guard.evaluate(ctxTrusted);
  assert(dTrusted.allow, "trusted actor should allow");
  const traceTrusted = JSON.parse(ctxTrusted.approvalTrace!);
  eq(traceTrusted.approvalClass, "auto");
  assert(traceTrusted.riskIntelligence !== undefined, "trace should carry riskIntelligence");
  eq(traceTrusted.riskIntelligence.riskScore, 0); // auto floor 10 + trusted (-10) = 0, clamped to 0
  eq(traceTrusted.riskIntelligence.reputationBand, "trusted");
  assert(Array.isArray(traceTrusted.riskIntelligence.factors));

  // New actor (reputationScore 40 → "new" band) — auto escalates to opa_check.
  const ctxNew = makeCtx("read_only");
  ctxNew.reputationScore = 40;
  const dNew = guard.evaluate(ctxNew);
  assert(dNew.allow, "new actor should still allow (opa_check)");
  const traceNew = JSON.parse(ctxNew.approvalTrace!);
  eq(traceNew.approvalClass, "opa_check");
  assert(traceNew.riskIntelligence !== undefined);
  eq(traceNew.riskIntelligence.reputationBand, "new");
  eq(traceNew.riskIntelligence.effectiveApprovalClass, "opa_check");

  // Untrusted actor (10) — auto escalates to human.
  const ctxBad = makeCtx("read_only");
  ctxBad.reputationScore = 10;
  const dBad = guard.evaluate(ctxBad);
  assert(dBad.allow, "untrusted actor should allow (human review)");
  const traceBad = JSON.parse(ctxBad.approvalTrace!);
  eq(traceBad.approvalClass, "human");
  eq(traceBad.riskIntelligence.reputationBand, "untrusted");
});

test("approvalPolicyRouter fail-closed on invalid reputationScore", () => {
  const signer = makeSigner();
  const guard = approvalPolicyRouter(signer);
  const ctx = makeCtx("read_only");
  ctx.reputationScore = 150; // out of range
  const d = guard.evaluate(ctx);
  assert(!d.allow, "invalid reputationScore should deny (fail-closed)");
  const trace = JSON.parse(ctx.approvalTrace!);
  eq(trace.approvalClass, "deny");
  assert(trace.riskIntelligence !== undefined, "trace should still carry riskIntelligence");
  eq(trace.riskIntelligence.reputationBand, "new"); // fallback band
  assert(
    trace.riskIntelligence.factors.some((f: any) => f.factor === "contextual_risk_error"),
    "trace should record contextual_risk_error factor",
  );
});

test("riskIntelligence is included in signed trace payload", () => {
  const signer = makeSigner();
  const guard = approvalPolicyRouter(signer);
  const ctx = makeCtx("write_safe");
  ctx.reputationScore = 90;
  guard.evaluate(ctx);
  const trace = JSON.parse(ctx.approvalTrace!);
  assert(trace.riskIntelligence !== undefined);

  // Recompute payload INCLUDING riskIntelligence and verify signature.
  const payload = canonicalTracePayload(
    trace.policy,
    trace.riskClass,
    trace.approvalClass,
    trace.timestamp,
    trace.simulation,
    trace.contextualRisk,
    trace.riskIntelligence,
  );
  assert(signer.verify(payload, trace.signature), "signature must verify with riskIntelligence included");
});

// ─── canonicalTracePayload: sort-order correctness ───────────────────────────
// These tests lock in the pre-sorted key order so any future edit that
// accidentally breaks lexicographic ordering is caught immediately.

test("efficiency/sort: canonicalTracePayload keys are in lexicographic order (mandatory fields only)", () => {
  const payload = canonicalTracePayload("pol", "read_only", "auto", "2025-01-01T00:00:00.000Z");
  const parsed = JSON.parse(payload);
  const keys = Object.keys(parsed);
  const sorted = [...keys].sort();
  eq(JSON.stringify(keys), JSON.stringify(sorted), `keys not sorted: ${JSON.stringify(keys)}`);
  // Mandatory set
  eq(keys.length, 4);
  assert(keys.includes("approvalClass") && keys.includes("policy") && keys.includes("riskClass") && keys.includes("timestamp"));
});

test("efficiency/sort: canonicalTracePayload keys are in lexicographic order (all optional fields present)", () => {
  const sim = { actionType: "file.read", riskClass: "read_only" as const, riskSource: "server" as const,
    reversible: true, blastRadius: "none" as const, predictedEffect: "none", requiresBackup: false, warnings: [] };
  const ctxRisk = { score: 0.1, factors: [], timestamp: "t" };
  const ri = { riskScore: 0, effectiveApprovalClass: "auto" as const, factors: [], reputationBand: "trusted" as const };
  const prov = { actorId: "a", tenantId: "t", requestedAt: "t", source: "sdk" as const };
  const payload = canonicalTracePayload("pol", "read_only", "auto", "2025-01-01T00:00:00.000Z", sim, ctxRisk, ri, prov);
  const keys = Object.keys(JSON.parse(payload));
  const sorted = [...keys].sort();
  eq(JSON.stringify(keys), JSON.stringify(sorted), `keys not sorted: ${JSON.stringify(keys)}`);
  eq(keys.length, 8, `expected 8 keys, got ${keys.length}: ${JSON.stringify(keys)}`);
});

test("efficiency/sort: canonicalTracePayload output is stable and identical to sort-then-stringify", () => {
  // Cross-check: output must equal a reference produced by the old sort-based approach.
  const policy = "test-policy";
  const riskClass = "write_destructive" as const;
  const approvalClass = "human" as const;
  const timestamp = "2025-06-01T12:00:00.000Z";
  const ctxRisk = { score: 0.5, factors: [{ factor: "rate", weight: 1 }], timestamp };

  // Reference: build object in any order, sort keys, stringify.
  const ref: Record<string, unknown> = { policy, riskClass, approvalClass, timestamp, contextualRisk: ctxRisk };
  const refOrdered: Record<string, unknown> = {};
  for (const k of Object.keys(ref).sort()) refOrdered[k] = ref[k];
  const reference = JSON.stringify(refOrdered);

  const result = canonicalTracePayload(policy, riskClass, approvalClass, timestamp, undefined, ctxRisk);
  eq(result, reference, "pre-sorted output must match sort-then-stringify reference");
});
