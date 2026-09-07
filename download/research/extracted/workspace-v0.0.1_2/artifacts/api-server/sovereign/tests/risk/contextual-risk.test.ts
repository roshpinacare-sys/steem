/**
 * tests/risk/contextual-risk.test.ts — v285.
 * scoreContextualRisk: context-aware, MONOTONIC risk escalation (intelligence upgrade).
 *
 *   MONOTONIC     never downgrades; no signals → base class stands.
 *   VELOCITY      acting far above the actor's baseline escalates (human → escrow).
 *   VALUE/SENS    large value → threshold_escrow; critical resource → human.
 *   COMBINE       multiple signals take the MOST restrictive (max join).
 *   FAIL-CLOSED   bad base class → deny; non-BigInt money throws.
 */
import { test, assert, eq } from "../_harness.mjs";
import { scoreContextualRisk, maxApproval } from "../../lib/risk/contextual-risk.ts";

test("monotonic: no context → base class unchanged, not escalated", () => {
  const r = scoreContextualRisk("auto", {});
  eq(r.effectiveApprovalClass, "auto");
  eq(r.escalated, false);
  // escalation never downgrades a high base
  const r2 = scoreContextualRisk("threshold_escrow", { resourceSensitivity: "sensitive" });
  eq(r2.effectiveApprovalClass, "threshold_escrow", "sensitive (opa_check) cannot downgrade escrow");
  eq(r2.escalated, false);
});

test("velocity vs baseline escalates auto → human → escrow", () => {
  const elevated = scoreContextualRisk("auto", { actorRecentCount: 30, actorBaselineCount: 10 }); // 3×
  eq(elevated.effectiveApprovalClass, "human");
  assert(elevated.signals.some((s) => s.signal === "velocity_elevated"));

  const extreme = scoreContextualRisk("auto", { actorRecentCount: 100, actorBaselineCount: 10 }); // 10×
  eq(extreme.effectiveApprovalClass, "threshold_escrow");
  assert(extreme.signals.some((s) => s.signal === "velocity_extreme"));
});

test("large value → threshold_escrow; critical resource → human", () => {
  const v = scoreContextualRisk("auto", { valueMicrounits: 5_000_000n, valueEscalationThreshold: 1_000_000n });
  eq(v.effectiveApprovalClass, "threshold_escrow");
  const c = scoreContextualRisk("auto", { resourceSensitivity: "critical" });
  eq(c.effectiveApprovalClass, "human");
  // below threshold → no value escalation
  const small = scoreContextualRisk("auto", { valueMicrounits: 500n, valueEscalationThreshold: 1_000_000n });
  eq(small.escalated, false);
});

test("multiple signals → most restrictive wins (max join)", () => {
  const r = scoreContextualRisk("auto", {
    offHours: true,                       // → human
    valueMicrounits: 9_000_000n,          // → threshold_escrow
    valueEscalationThreshold: 1_000_000n,
    novelForActor: true,                  // → human
  });
  eq(r.effectiveApprovalClass, "threshold_escrow", "escrow is the most restrictive signal");
  assert(r.signals.length >= 3, "all signals recorded for audit");
  assert(r.explanation.length > 1, "explanation lists the signals");
  eq(maxApproval("human", "deny"), "deny");
  eq(maxApproval("auto", "opa_check"), "opa_check");
});

test("fail-closed: bad base class → deny; non-BigInt money throws", () => {
  eq(scoreContextualRisk("nonsense" as any, {}).baseApprovalClass, "deny");
  let threw = false;
  try { scoreContextualRisk("auto", { valueMicrounits: 5 as any }); } catch { threw = true; }
  assert(threw, "number value throws (must be BigInt μ¢)");
});

// ─── efficiency/rank-map (v340) ────────────────────────────────────────────
// Three tests covering the O(1) LADDER_RANK Map that replaced LADDER.indexOf().

test("rank-map happy-path: all five ladder classes resolve in the correct order", () => {
  // maxApproval relies on rank(); verify the full ordering is preserved.
  const ladder: Array<import("../../lib/orchestrator/types.ts").ApprovalClass> =
    ["auto", "opa_check", "human", "threshold_escrow", "deny"];
  for (let i = 0; i < ladder.length - 1; i++) {
    eq(maxApproval(ladder[i], ladder[i + 1]), ladder[i + 1],
      `${ladder[i + 1]} must dominate ${ladder[i]}`);
    eq(maxApproval(ladder[i + 1], ladder[i]), ladder[i + 1],
      `commutative: ${ladder[i + 1]} still dominates`);
  }
});

test("rank-map edge-case: unknown class in maxApproval is treated as deny (fail-closed)", () => {
  // The Map path returns LADDER_MAX_RANK (4) for unknown classes — same as before.
  // An unknown class on either side must never be weaker than deny.
  eq(maxApproval("unknown_class" as any, "auto"), "unknown_class" as any,
    "unknown class has max rank so it wins over auto");
  // Combined with a known class: the known class must never win over an unknown
  // because unknown is treated as the most restrictive (deny-level).
  const result = scoreContextualRisk("unknown_class" as any, {});
  eq(result.baseApprovalClass, "deny",
    "unknown base class collapses to deny via LADDER_RANK.has() check");
  eq(result.effectiveApprovalClass, "deny");
});

test("rank-map regression: off-hours + velocity extreme still escalates to threshold_escrow", () => {
  // Full hot-path exercise: multiple maxApproval() calls via Map lookups, no regression.
  const r = scoreContextualRisk("opa_check", {
    offHours: true,                          // → human (above opa_check)
    actorRecentCount: 50, actorBaselineCount: 5, // 10× → threshold_escrow
  });
  eq(r.effectiveApprovalClass, "threshold_escrow");
  eq(r.escalated, true);
  assert(r.signals.length === 2, "both signals recorded");
});
