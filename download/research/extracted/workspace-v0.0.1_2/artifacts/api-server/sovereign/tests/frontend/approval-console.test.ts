/**
 * tests/frontend/approval-console.test.ts — Approval console signals + explainability.
 *
 * HAPPY     signal creation/subscription/updates; explainability formatting.
 * EDGE      no subscribers, same-value suppression, empty factors, boundary scores.
 * FAIL-CLOSED  bad assessment input throws; unsubscribed listener never called.
 */

import "../_flush.mjs";
import { test, assert, eq, deepEq } from "../_harness.mjs";
import {
  createSignal,
  createComputed,
} from "../../frontend/approval-console/signals.ts";
import {
  factorSeverity,
  formatExplainability,
  statusFromAssessment,
} from "../../frontend/approval-console/explain.ts";
import type {
  ConsoleRiskAssessment,
  ConsoleRiskFactor,
} from "../../frontend/approval-console/types.ts";

// ─── Fixtures ───────────────────────────────────────────────────────────────

function factor(f: Partial<ConsoleRiskFactor> & { factor: string }): ConsoleRiskFactor {
  return { contribution: 10, detail: "test detail", ...f };
}

function assessment(p: Partial<ConsoleRiskAssessment> = {}): ConsoleRiskAssessment {
  return {
    riskScore: 30,
    baseApprovalClass: "auto",
    effectiveApprovalClass: "auto",
    escalated: false,
    factors: [],
    explanation: [],
    ...p,
  };
}

// ─── Signals — happy path ───────────────────────────────────────────────────

test("createSignal returns current value", () => {
  const s = createSignal(42);
  eq(s(), 42, "signal initial value");
});

test("signal set updates value", () => {
  const s = createSignal("a");
  s.set("b");
  eq(s(), "b", "signal set updates value");
});

test("subscriber receives updates", () => {
  const s = createSignal(1);
  const values: number[] = [];
  s.subscribe((v) => values.push(v));
  s.set(2);
  s.set(3);
  eq(values.length, 2, "subscriber receives two updates");
  eq(values[0], 2, "first update");
  eq(values[1], 3, "second update");
});

test("multiple subscribers all notified", () => {
  const s = createSignal(0);
  const a: number[] = [];
  const b: number[] = [];
  s.subscribe((v) => a.push(v));
  s.subscribe((v) => b.push(v));
  s.set(99);
  eq(a.length, 1, "subscriber a notified");
  eq(b.length, 1, "subscriber b notified");
  eq(a[0], 99, "subscriber a value");
  eq(b[0], 99, "subscriber b value");
});

test("createComputed caches initial value", () => {
  const source = createSignal(5);
  let calls = 0;
  const c = createComputed(() => {
    calls++;
    return source() * 2;
  });
  eq(c(), 10, "computed initial value");
  eq(calls, 1, "computed factory called once");
});

// ─── Signals — edge cases ───────────────────────────────────────────────────

test("set without subscribers works", () => {
  const s = createSignal(0);
  s.set(1);
  eq(s(), 1, "set without subscribers works");
});

test("same value suppressed (Object.is)", () => {
  const s = createSignal(7);
  const values: number[] = [];
  s.subscribe((v) => values.push(v));
  s.set(7);
  s.set(7);
  eq(values.length, 0, "same value suppressed");
  s.set(8);
  eq(values.length, 1, "different value notified");
});

test("NaN same-value suppressed (Object.is semantics)", () => {
  const s = createSignal(NaN);
  const values: number[] = [];
  s.subscribe((v) => values.push(v));
  s.set(NaN);
  eq(values.length, 0, "NaN same-value suppressed");
});

test("unsubscribe stops notifications", () => {
  const s = createSignal(0);
  const values: number[] = [];
  const off = s.subscribe((v) => values.push(v));
  s.set(1);
  off();
  s.set(2);
  eq(values.length, 1, "unsubscribe stops notifications");
  eq(values[0], 1, "only pre-unsubscribe value received");
});

test("computed refresh updates derived value", () => {
  const source = createSignal(3);
  const c = createComputed(() => source() * 3);
  eq(c(), 9, "computed before refresh");
  source.set(4);
  (c as any).refresh();
  eq(c(), 12, "computed after refresh");
});

// ─── Explainability — happy path ──────────────────────────────────────────

test("simple auto-approved (no escalation)", () => {
  const a = assessment({ riskScore: 10, effectiveApprovalClass: "auto" });
  const out = formatExplainability(a);
  eq(out.headline.includes("auto"), true, "headline mentions auto");
  eq(out.scoreLine.includes("No escalation"), true, "score line mentions no escalation");
  eq(out.factors.length, 0, "no factors");
  eq(out.footer, "All clear — no risk signals triggered.", "clear footer");
});

test("escalated with factors", () => {
  const a = assessment({
    riskScore: 55,
    baseApprovalClass: "auto",
    effectiveApprovalClass: "human",
    escalated: true,
    factors: [
      factor({ factor: "velocity_elevated", contribution: 15, detail: "3.0× baseline" }),
      factor({ factor: "off_hours", contribution: 12, detail: "outside hours" }),
    ],
  });
  const out = formatExplainability(a);
  eq(out.headline.includes("auto → human"), true, "headline shows escalation");
  eq(out.scoreLine.includes("Escalated"), true, "score line shows escalation");
  eq(out.factors.length, 2, "two factors");
  eq(out.factors[0].severity, "warn", "first factor severity");
  eq(out.factors[1].severity, "warn", "second factor severity");
  eq(out.footer.includes("warning(s)"), true, "footer warns");
});

test("critical factor", () => {
  const a = assessment({
    riskScore: 85,
    baseApprovalClass: "human",
    effectiveApprovalClass: "threshold_escrow",
    escalated: true,
    factors: [
      factor({ factor: "value_large", contribution: 25, detail: "≥ threshold" }),
    ],
  });
  const out = formatExplainability(a);
  eq(out.factors[0].severity, "critical", "critical severity");
  eq(out.footer.includes("critical factor"), true, "footer critical");
});

test("trusted actor (negative contribution)", () => {
  const a = assessment({
    riskScore: 20,
    baseApprovalClass: "auto",
    effectiveApprovalClass: "auto",
    escalated: false,
    factors: [
      factor({ factor: "reputation:trusted", contribution: -10, detail: "established trust" }),
    ],
  });
  const out = formatExplainability(a);
  eq(out.factors[0].severity, "info", "negative contribution is info");
});

test("statusFromAssessment mappings", () => {
  eq(statusFromAssessment(assessment({ effectiveApprovalClass: "deny" })).label, "Denied", "deny label");
  eq(statusFromAssessment(assessment({ effectiveApprovalClass: "deny" })).severity, "critical", "deny severity");
  eq(statusFromAssessment(assessment({ effectiveApprovalClass: "threshold_escrow" })).label, "Escalated", "threshold label");
  eq(statusFromAssessment(assessment({ effectiveApprovalClass: "human" })).label, "Pending Review", "human label");
  eq(statusFromAssessment(assessment({ effectiveApprovalClass: "opa_check" })).label, "OPA Check", "opa label");
  eq(statusFromAssessment(assessment({ effectiveApprovalClass: "auto" })).label, "Auto-Approved", "auto label");
});

// ─── Explainability — edge cases ────────────────────────────────────────────

test("empty factors with escalation still works", () => {
  const a = assessment({
    riskScore: 55,
    baseApprovalClass: "auto",
    effectiveApprovalClass: "human",
    escalated: true,
    factors: [],
  });
  const out = formatExplainability(a);
  eq(out.factors.length, 0, "empty factors");
  eq(out.footer, "All clear — no risk signals triggered.", "clear footer despite escalation");
});

test("boundary scores (0 and 100)", () => {
  const out0 = formatExplainability(assessment({ riskScore: 0 }));
  eq(out0.headline.includes("0/100"), true, "zero score");
  const out100 = formatExplainability(assessment({ riskScore: 100 }));
  eq(out100.headline.includes("100/100"), true, "max score");
});

test("unknown effective class maps to auto-approved label", () => {
  const s = statusFromAssessment(assessment({ effectiveApprovalClass: "unknown" }));
  eq(s.label, "Auto-Approved", "unknown class defaults to auto");
  eq(s.severity, "info", "unknown class severity info");
});

// ─── Fail-closed ────────────────────────────────────────────────────────────

test("null assessment throws", () => {
  let threw = false;
  try {
    formatExplainability(null as any);
  } catch {
    threw = true;
  }
  eq(threw, true, "null assessment throws");
});

test("undefined assessment throws", () => {
  let threw = false;
  try {
    formatExplainability(undefined as any);
  } catch {
    threw = true;
  }
  eq(threw, true, "undefined assessment throws");
});

test("NaN riskScore throws", () => {
  let threw = false;
  try {
    formatExplainability(assessment({ riskScore: NaN }));
  } catch {
    threw = true;
  }
  eq(threw, true, "NaN riskScore throws");
});

test("Infinity riskScore throws", () => {
  let threw = false;
  try {
    formatExplainability(assessment({ riskScore: Infinity }));
  } catch {
    threw = true;
  }
  eq(threw, true, "Infinity riskScore throws");
});

test("same object reference suppressed", () => {
  const obj = { x: 1 };
  const s = createSignal(obj);
  const values: typeof obj[] = [];
  s.subscribe((v) => values.push(v));
  s.set(obj);
  eq(values.length, 0, "same object reference suppressed");
});

test("computed with complex derivation", () => {
  const a = createSignal(2);
  const b = createSignal(3);
  const sum = createComputed(() => a() + b());
  eq(sum(), 5, "computed sum initial");
  a.set(10);
  (sum as any).refresh();
  eq(sum(), 13, "computed sum after refresh");
});
