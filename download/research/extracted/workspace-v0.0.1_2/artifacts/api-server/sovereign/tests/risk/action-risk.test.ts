import "../_flush.mjs";
/**
 * tests/risk/action-risk.test.ts — v128.
 * First sub-step of ActionRiskClass + ApprovalPolicy: taxonomy + map + classifier + guard.
 *
 *   COVERAGE     every KNOWN action type (all three enums) has an explicit class.
 *   CLASSIFY     known types map to the expected class (money=value_moving, reads=read_only…).
 *   EDGE         a destructive write maps distinctly (marketplace.delete → write_destructive).
 *   FAIL-CLOSED  an unknown / empty type ⇒ the most-restrictive class (never low-risk).
 *   GUARD        injectRiskClass annotates ctx.riskClass and always allows, mutating nothing else.
 */
import { test, assert, eq } from "../_harness.mjs";
import {
  ACTION_RISK_MAP, RISK_CLASSES, MOST_RESTRICTIVE_RISK_CLASS,
  classifyRisk, isClassified, injectRiskClass,
} from "../../lib/risk/action-risk.ts";
import { LEDGER_ACTION_TYPES } from "../../lib/ledger-orchestrator/types.ts";
import { POTENTIAL_ACTION_TYPES } from "../../lib/potential/types.ts";
import { MARKETPLACE_ACTION_TYPES } from "../../lib/marketplace/types.ts";

const ALL_KNOWN_TYPES = [
  ...Object.values(LEDGER_ACTION_TYPES),
  ...Object.values(POTENTIAL_ACTION_TYPES),
  ...Object.values(MARKETPLACE_ACTION_TYPES),
] as string[];

// ── COVERAGE: every known action type is classified, to a valid class ──
test("every known action type is explicitly mapped to a valid risk class", () => {
  const valid = new Set<string>(RISK_CLASSES as readonly string[]);
  for (const t of ALL_KNOWN_TYPES) {
    assert(isClassified(t), `action type "${t}" must have an explicit risk class (no fail-closed fallback)`);
    const cls = ACTION_RISK_MAP[t];
    assert(valid.has(cls), `"${t}" maps to a valid ActionRiskClass (got "${cls}")`);
    eq(classifyRisk(t), cls, `classifyRisk("${t}") matches the map`);
  }
  // The map must not contain stray entries for types that don't exist.
  for (const t of Object.keys(ACTION_RISK_MAP)) {
    assert(ALL_KNOWN_TYPES.includes(t), `map entry "${t}" corresponds to a real action type`);
  }
});

// ── CLASSIFY: representative classifications ──
test("money moves are value_moving and pure reads are read_only", () => {
  eq(classifyRisk(LEDGER_ACTION_TYPES.MINT), "value_moving");
  eq(classifyRisk(LEDGER_ACTION_TYPES.WITHDRAW), "value_moving");
  eq(classifyRisk(LEDGER_ACTION_TYPES.TRANSFER), "value_moving");
  eq(classifyRisk(LEDGER_ACTION_TYPES.SOLVENCY_CHECK), "read_only");
  eq(classifyRisk(POTENTIAL_ACTION_TYPES.ANALYZE), "read_only");
  eq(classifyRisk(MARKETPLACE_ACTION_TYPES.CLAIM), "value_moving");
});

// ── EDGE: a destructive write is distinct from a safe write ──
test("destructive vs safe writes are distinguished", () => {
  eq(classifyRisk(MARKETPLACE_ACTION_TYPES.DELETE), "write_destructive");
  eq(classifyRisk(MARKETPLACE_ACTION_TYPES.CREATE), "write_safe");
});

// ── FAIL-CLOSED: unknown / empty / non-string ⇒ most-restrictive ──
test("unknown or invalid action types fail closed to the most-restrictive class", () => {
  eq(MOST_RESTRICTIVE_RISK_CLASS, "irreversible");
  eq(classifyRisk("totally.unknown.action"), "irreversible");
  eq(classifyRisk(""), "irreversible");
  eq(classifyRisk(undefined as any), "irreversible");
  eq(classifyRisk(null as any), "irreversible");
  assert(!isClassified("totally.unknown.action"), "unknown type reports as unclassified");
});

// ── GUARD: injectRiskClass annotates ctx.riskClass and always allows ──
test("injectRiskClass sets ctx.riskClass, allows, and leaves other fields intact", () => {
  const guard = injectRiskClass();
  eq(guard.name, "inject-risk-class");
  const ctx: any = {
    action: { type: LEDGER_ACTION_TYPES.MINT, tenantId: "t1", id: "a1", source: "s", isFinancial: true, isAutonomous: false, payload: {} },
    tenantId: "t1",
    timestamp: "2026-01-01T00:00:00.000Z",
  };
  const d = guard.evaluate(ctx) as { allow: boolean };
  assert(d.allow, "classification never denies");
  eq(ctx.riskClass, "value_moving", "riskClass injected from the action type");
  eq(ctx.tenantId, "t1", "tenantId untouched");
  eq(ctx.timestamp, "2026-01-01T00:00:00.000Z", "timestamp untouched");

  // An unknown type still gets the fail-closed class injected.
  const ctx2: any = { action: { type: "x.unknown", tenantId: "t1" }, tenantId: "t1", timestamp: "t" };
  guard.evaluate(ctx2);
  eq(ctx2.riskClass, "irreversible", "fail-closed class injected for unknown type");
});
