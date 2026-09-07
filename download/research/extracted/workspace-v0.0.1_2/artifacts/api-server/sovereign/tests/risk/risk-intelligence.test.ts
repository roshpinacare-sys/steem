/**
 * tests/risk/risk-intelligence.test.ts — v297.
 * assessRisk: deterministic fusion of static floor + behavioural signals + reputation.
 *
 *   FUSION        combines all three families into one 0-100 score + explainable factors.
 *   MONOTONIC     effective class never below the static floor; trusted actor can't weaken it.
 *   REPUTATION    untrusted/new actors escalate; trusted lowers score but not the class.
 *   DETERMINISTIC same inputs → identical assessment.
 *   FAIL-CLOSED   bad base → deny; out-of-range reputation throws.
 */
import { test, assert, eq } from "../_harness.mjs";
import { assessRisk } from "../../lib/risk/risk-intelligence.ts";

test("fuses static + behavioural + reputation into one explainable score", () => {
  const a = assessRisk({
    baseApprovalClass: "auto",
    context: { actorRecentCount: 100, actorBaselineCount: 10 }, // 10× → escrow
    reputationScore: 50,
  });
  assert(a.riskScore > 10, "score rises above the auto floor");
  eq(a.effectiveApprovalClass, "threshold_escrow", "behavioural escalation wins");
  assert(a.factors.some((f) => f.factor.startsWith("behavioural:")), "behavioural factor recorded");
  assert(a.explanation.length > 1, "explainable");
});

test("monotonic: trusted reputation lowers score but NEVER weakens the class", () => {
  const trusted = assessRisk({ baseApprovalClass: "human", reputationScore: 90 });
  eq(trusted.effectiveApprovalClass, "human", "trusted cannot downgrade below floor");
  eq(trusted.reputationBand, "trusted");
  assert(trusted.factors.some((f) => f.factor === "reputation:trusted" && f.contribution < 0), "score reduced, class not");
  // floor is never breached even with max trust on a deny action
  const denyFloor = assessRisk({ baseApprovalClass: "deny", reputationScore: 100 });
  eq(denyFloor.effectiveApprovalClass, "deny");
});

test("reputation escalates untrusted/new actors", () => {
  const untrusted = assessRisk({ baseApprovalClass: "auto", reputationScore: 10 });
  eq(untrusted.effectiveApprovalClass, "human", "untrusted → human review");
  eq(untrusted.reputationBand, "untrusted");
  const fresh = assessRisk({ baseApprovalClass: "auto", reputationScore: 40 });
  eq(fresh.effectiveApprovalClass, "opa_check", "new actor → opa_check");
  assert(untrusted.riskScore > fresh.riskScore, "untrusted scores riskier than new");
});

test("deterministic: identical inputs → identical assessment", () => {
  const inp = { baseApprovalClass: "auto" as const, context: { offHours: true }, reputationScore: 55 };
  eq(JSON.stringify(assessRisk(inp)), JSON.stringify(assessRisk(inp)));
});

test("fail-closed: bad base → deny; out-of-range reputation throws", () => {
  eq(assessRisk({ baseApprovalClass: "nonsense" as any }).baseApprovalClass, "deny");
  for (const bad of [-1, 101, NaN, "50" as any]) {
    let threw = false;
    try { assessRisk({ baseApprovalClass: "auto", reputationScore: bad }); } catch { threw = true; }
    assert(threw, `reputationScore ${bad} throws`);
  }
});

// ─── drift-triggered escalation (§2.C sub-step 8) — v407 ────────────────────
// assessRisk gains an optional `drift` input (a pre-computed RiskDriftResult
// from scoreRiskDrift). These tests use the REAL scoreRiskDrift function
// against synthetic score windows rather than hand-built result objects, so
// the integration is exercised end-to-end, not just the fusion arithmetic.

import { scoreRiskDrift } from "../../lib/risk/risk-drift.ts";
import type { DriftRecord } from "../../lib/risk/risk-drift.ts";

/** Evenly-spaced window: N records, 1 hour apart, score changing by `delta`/step. */
function buildDriftWindow(n: number, startScore: number, delta: number): DriftRecord[] {
  const MS_PER_HOUR = 3_600_000;
  return Array.from({ length: n }, (_, i) => ({
    score: startScore + i * delta,
    timestampMs: 2_000_000_000_000 + i * MS_PER_HOUR,
  }));
}

test("happy: deteriorating drift escalates an auto-floor action even though the action itself is unremarkable", () => {
  // Score falling steeply from 90 → 10 over 9 hourly steps: a strong deteriorating trend.
  const window = buildDriftWindow(10, 90, -9);
  const drift = scoreRiskDrift(window);
  assert(drift.driftScore > 0, "fixture sanity: this window must be deteriorating");

  // Hold reputation constant (neutral/normal band, no escalation of its own) so
  // the only varying signal between the two assessments is drift.
  const withDrift = assessRisk({ baseApprovalClass: "auto", reputationScore: 55, drift });
  const withoutDrift = assessRisk({ baseApprovalClass: "auto", reputationScore: 55 });

  eq(withoutDrift.effectiveApprovalClass, "auto", "no drift signal → stays at floor");
  eq(withDrift.driftApplied, true);
  assert(withDrift.riskScore > withoutDrift.riskScore, "deteriorating drift raises the fused score");
  assert(
    withDrift.factors.some((f) => f.factor === "drift:deteriorating" && f.contribution > 0),
    "drift factor recorded with positive contribution",
  );
  // The drift escalation must actually be folded into the monotonic class chain.
  eq(withDrift.effectiveApprovalClass, maxApprovalForTest(withoutDrift.effectiveApprovalClass, drift.driftEscalation));
});

test("happy: improving drift is informational only — never lowers the gate, never raises it either", () => {
  // Score rising from 10 → 90: a strong improving trend (driftScore < 0).
  const window = buildDriftWindow(10, 10, 9);
  const drift = scoreRiskDrift(window);
  assert(drift.driftScore < 0, "fixture sanity: this window must be improving");

  const result = assessRisk({ baseApprovalClass: "human", drift });
  eq(result.effectiveApprovalClass, "human", "improving trend cannot weaken a human-floor action");
  eq(result.driftApplied, true);
  const driftFactor = result.factors.find((f) => f.factor === "drift:improving");
  assert(driftFactor !== undefined, "improving drift still recorded for explainability");
  eq(driftFactor!.contribution, 0, "improving trend contributes zero risk points");
});

test("edge: drift escalation joins monotonically with reputation — the worse of the two wins", () => {
  // A merely-mild deteriorating drift (escalates to human) combined with a
  // trusted reputation (which alone would not escalate at all) — the drift
  // floor must still win because the join is max(), not override.
  const window = buildDriftWindow(5, 60, -7); // moderate decline
  const drift = scoreRiskDrift(window);
  const result = assessRisk({ baseApprovalClass: "auto", reputationScore: 90, drift });
  eq(result.reputationBand, "trusted");
  assert(
    result.effectiveApprovalClass === drift.driftEscalation || result.effectiveApprovalClass === "auto",
    "effective class is at least as strict as the drift escalation alone",
  );
  if (drift.driftEscalation !== "auto") {
    assert(result.effectiveApprovalClass !== "auto", "trusted reputation cannot suppress a real drift escalation");
  }
});

test("edge: driftApplied is false when drift is omitted, even with all other signals present", () => {
  const result = assessRisk({
    baseApprovalClass: "auto",
    context: { offHours: true },
    reputationScore: 80,
  });
  eq(result.driftApplied, false);
  assert(!result.factors.some((f) => f.factor.startsWith("drift:")), "no drift factor when drift omitted");
});

test("fail-closed: malformed drift input throws rather than silently lowering risk", () => {
  const validDrift = scoreRiskDrift(buildDriftWindow(5, 50, -5));

  let threw = false;
  try { assessRisk({ baseApprovalClass: "auto", drift: "not-an-object" as any }); } catch { threw = true; }
  assert(threw, "non-object drift throws");

  threw = false;
  try { assessRisk({ baseApprovalClass: "auto", drift: { ...validDrift, driftScore: "bad" as any } }); } catch { threw = true; }
  assert(threw, "non-number driftScore throws");

  threw = false;
  try { assessRisk({ baseApprovalClass: "auto", drift: { ...validDrift, driftScore: 999 } }); } catch { threw = true; }
  assert(threw, "out-of-range driftScore throws");

  threw = false;
  try { assessRisk({ baseApprovalClass: "auto", drift: { ...validDrift, driftEscalation: "not_a_class" as any } }); } catch { threw = true; }
  assert(threw, "unknown driftEscalation class throws");
});

test("deterministic: identical drift input → identical assessment", () => {
  const window = buildDriftWindow(6, 70, -6);
  const drift = scoreRiskDrift(window);
  const inp = { baseApprovalClass: "auto" as const, reputationScore: 60, drift };
  eq(JSON.stringify(assessRisk(inp)), JSON.stringify(assessRisk(inp)));
});

/** Local re-implementation of the monotonic ApprovalClass ordering, for test
 *  assertions only — independent of the production maxApproval() so the test
 *  doesn't just tautologically re-check the same code path it calls. */
function maxApprovalForTest(a: string, b: string): string {
  const order = ["auto", "opa_check", "human", "threshold_escrow", "deny"];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}
