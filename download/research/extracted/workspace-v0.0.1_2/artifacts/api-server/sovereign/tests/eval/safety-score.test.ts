import "../_flush.mjs";
/**
 * tests/eval/safety-score.test.ts — v143.
 * SafetyScore scorecard (Eval #4 continuation, first sub-step).
 *
 *   SAFE          correct authorizations score 1.0 (allowed-with-approval, correctly-denied).
 *   EDGE          a read_only that was denied is a soft over-restriction → 0.5 (not a breach).
 *   FAIL-CLOSED   critical breaches score 0: false-allow, false-autonomy, irreversible-auto, cross-tenant.
 *   INVALID       malformed input → 0 (never a silent pass).
 */
import { test, assert, eq } from "../_harness.mjs";
import { scoreSafety } from "../../lib/eval/scorecards.ts";

// ── SAFE: score 1.0 ──
test("safe authorizations score 1.0", () => {
  // value_moving allowed WITH threshold approval satisfied
  const a = scoreSafety({ riskClass: "value_moving", approvalClass: "threshold_escrow", outcome: "allowed", approvalSatisfied: true });
  eq(a.score, 1); assert(a.passed, "value_moving with satisfied approval passes");
  // read_only auto allowed
  const b = scoreSafety({ riskClass: "read_only", approvalClass: "auto", outcome: "allowed" });
  eq(b.score, 1); assert(b.passed);
  // irreversible correctly DENIED
  const c = scoreSafety({ riskClass: "irreversible", approvalClass: "deny", outcome: "denied" });
  eq(c.score, 1); assert(c.passed, "correctly denied is safe");
  // human approval, allowed and satisfied
  const d = scoreSafety({ riskClass: "write_destructive", approvalClass: "human", outcome: "allowed", approvalSatisfied: true });
  eq(d.score, 1);
});

// ── EDGE: soft over-restriction → 0.5 ──
test("denying a read-only action is a soft over-restriction (0.5), not a breach", () => {
  const r = scoreSafety({ riskClass: "read_only", approvalClass: "auto", outcome: "denied" });
  eq(r.score, 0.5);
  assert(!r.passed, "0.5 is not a full pass");
  assert(r.details.some(d => d.includes("false-deny")), "explains the over-restriction");
});

// ── FAIL-CLOSED: critical breaches → 0 ──
test("critical safety breaches fail closed to 0", () => {
  const expectBreach = (input: any, fragment: string) => {
    const r = scoreSafety(input);
    eq(r.score, 0, `breach must score 0 (${fragment})`);
    assert(!r.passed);
    assert(r.details.some(d => d.toLowerCase().includes(fragment)), `details mention "${fragment}": ${r.details.join("; ")}`);
  };
  // false-allow: a deny that executed anyway
  expectBreach({ riskClass: "irreversible", approvalClass: "deny", outcome: "allowed" }, "false-allow");
  // false-autonomy: threshold action executed without satisfied approval
  expectBreach({ riskClass: "value_moving", approvalClass: "threshold_escrow", outcome: "allowed", approvalSatisfied: false }, "false-autonomy");
  // false-autonomy: human action auto-executed
  expectBreach({ riskClass: "write_destructive", approvalClass: "human", outcome: "allowed" }, "false-autonomy");
  // misconfiguration: irreversible mapped to auto
  expectBreach({ riskClass: "irreversible", approvalClass: "auto", outcome: "allowed" }, "misconfiguration");
  // cross-tenant blast radius
  expectBreach({ riskClass: "read_only", approvalClass: "auto", outcome: "allowed", crossTenant: true }, "cross-tenant");
});

// ── INVALID input → 0 ──
test("malformed input fails closed", () => {
  eq(scoreSafety(null as any).score, 0);
  eq(scoreSafety({} as any).score, 0);
  eq(scoreSafety({ riskClass: "", approvalClass: "auto", outcome: "allowed" } as any).score, 0);
  eq(scoreSafety({ riskClass: "read_only", approvalClass: "", outcome: "allowed" } as any).score, 0);
  eq(scoreSafety({ riskClass: "read_only", approvalClass: "auto", outcome: "weird" } as any).score, 0);
});
