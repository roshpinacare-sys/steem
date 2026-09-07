/**
 * tests/frontend/risk-intelligence.test.ts — Factor-attribution engine + compliance narrative.
 *
 * HAPPY     percentage allocation, ranking, top-factor extraction, narrative generation.
 * EDGE      empty factors, single factor, all-negative contributions, zero total,
 *           contextual signal counting, reputation band passthrough.
 * FAIL-CLOSED null/missing input throws; bad riskScore throws.
 */

import "../_flush.mjs";
import { test, assert, eq, deepEq } from "../_harness.mjs";
import {
  factorSeverity,
  computeFactorAttribution,
  buildComplianceNarrative,
} from "../../frontend/risk-intelligence/attribution.ts";
import type { AttributionReport, FactorAttribution } from "../../frontend/risk-intelligence/types.ts";

// ─── Fixtures ───────────────────────────────────────────────────────────────

function mkFactor(factor: string, contribution: number, detail = "test"): { factor: string; contribution: number; detail: string } {
  return { factor, contribution, detail };
}

function mkAssessment(p: Partial<{
  riskScore: number;
  baseApprovalClass: string;
  effectiveApprovalClass: string;
  escalated: boolean;
  factors: Array<{ factor: string; contribution: number; detail: string }>;
  reputationBand: string;
}> = {}): Record<string, unknown> {
  return {
    riskScore: 45,
    baseApprovalClass: "auto",
    effectiveApprovalClass: "human",
    escalated: true,
    factors: [
      mkFactor("static_floor", 10),
      mkFactor("behavioural:velocity_elevated", 25),
      mkFactor("reputation:new", 12),
    ],
    reputationBand: "new",
    ...p,
  };
}

// ─── factorSeverity ───────────────────────────────────────────────────────

test("factorSeverity: critical at >=25", () => {
  eq(factorSeverity(25), "critical", "boundary 25 is critical");
  eq(factorSeverity(30), "critical", "above 25 is critical");
});

test("factorSeverity: warn at >=12", () => {
  eq(factorSeverity(12), "warn", "boundary 12 is warn");
  eq(factorSeverity(24), "warn", "below 25 is warn");
});

test("factorSeverity: info below 12", () => {
  eq(factorSeverity(0), "info", "zero is info");
  eq(factorSeverity(11), "info", "below 12 is info");
});

// ─── computeFactorAttribution — happy path ──────────────────────────────────

test("attribution: percentages sum to 100 % for positive contributions", () => {
  const report = computeFactorAttribution(mkAssessment());
  const sum = report.factors.reduce((s, f) => s + f.percentage, 0);
  eq(sum, 100, "percentages sum to 100");
});

test("attribution: factors ranked by absolute contribution descending", () => {
  const report = computeFactorAttribution(mkAssessment());
  eq(report.factors[0].factor, "behavioural:velocity_elevated", "largest abs contribution first");
  eq(report.factors[0].rank, 1, "rank 1 for top factor");
  eq(report.factors[1].factor, "reputation:new", "second largest second");
  eq(report.factors[1].rank, 2, "rank 2");
  eq(report.factors[2].factor, "static_floor", "smallest last");
  eq(report.factors[2].rank, 3, "rank 3");
});

test("attribution: topFactor matches highest-ranked factor", () => {
  const report = computeFactorAttribution(mkAssessment());
  assert(report.topFactor !== null, "topFactor exists");
  eq(report.topFactor!.factor, "behavioural:velocity_elevated", "topFactor is velocity");
});

test("attribution: contextual signals counted", () => {
  const report = computeFactorAttribution(mkAssessment());
  eq(report.contextualCount, 1, "one behavioural signal counted");
});

test("attribution: reputation band passed through", () => {
  const report = computeFactorAttribution(mkAssessment());
  eq(report.reputationBand, "new", "reputation band preserved");
});

test("attribution: negative contributions use abs for percentage", () => {
  const report = computeFactorAttribution(mkAssessment({
    factors: [
      mkFactor("static_floor", 10),
      mkFactor("reputation:trusted", -10),
    ],
  }));
  eq(report.factors.length, 2, "both factors present");
  const trusted = report.factors.find((f) => f.factor === "reputation:trusted")!;
  eq(trusted.absContribution, 10, "abs contribution positive");
  eq(trusted.percentage, 50, "equal share when abs values match");
  eq(trusted.contribution, -10, "raw contribution preserved");
});

// ─── computeFactorAttribution — edge cases ──────────────────────────────────

test("attribution: empty factors → zero total and null topFactor", () => {
  const report = computeFactorAttribution(mkAssessment({ factors: [] }));
  eq(report.totalAbsContribution, 0, "total abs is 0");
  eq(report.factors.length, 0, "no factors");
  eq(report.topFactor, null, "topFactor is null");
  eq(report.contextualCount, 0, "no contextual signals");
});

test("attribution: single factor → 100 %", () => {
  const report = computeFactorAttribution(mkAssessment({
    factors: [mkFactor("static_floor", 55)],
  }));
  eq(report.factors.length, 1, "one factor");
  eq(report.factors[0].percentage, 100, "single factor gets 100 %");
  eq(report.topFactor!.factor, "static_floor", "topFactor correct");
});

test("attribution: missing reputationBand → null", () => {
  const a = mkAssessment();
  delete a.reputationBand;
  const report = computeFactorAttribution(a);
  eq(report.reputationBand, null, "null when missing");
});

test("attribution: non-string reputationBand → null", () => {
  const report = computeFactorAttribution(mkAssessment({ reputationBand: 42 as unknown as string }));
  eq(report.reputationBand, null, "null when non-string");
});

test("attribution: non-array factors → empty", () => {
  const a = mkAssessment();
  a.factors = "bad" as unknown as Array<{ factor: string; contribution: number; detail: string }>;
  const report = computeFactorAttribution(a);
  eq(report.factors.length, 0, "coerces non-array to empty");
});

test("attribution: malformed factor objects are skipped", () => {
  const a = mkAssessment({
    factors: [
      mkFactor("good", 10),
      { contribution: 5, detail: "missing name" } as unknown as ReturnType<typeof mkFactor>,
      null as unknown as ReturnType<typeof mkFactor>,
    ],
  });
  const report = computeFactorAttribution(a);
  eq(report.factors.length, 1, "only valid factor kept");
  eq(report.factors[0].factor, "good", "valid factor retained");
});

// ─── buildComplianceNarrative — happy path ─────────────────────────────────

test("narrative: escalated path with top factor cited", () => {
  const report = computeFactorAttribution(mkAssessment());
  const narrative = buildComplianceNarrative(report);
  assert(narrative.summary.includes("Escalated"), "summary mentions escalation");
  assert(narrative.whyRisky.includes("Primary driver"), "whyRisky cites top factor");
  assert(narrative.citations.includes("behavioural:velocity_elevated"), "citations list top factor");
  assert(narrative.recommendedAction.includes("human reviewer"), "recommends human review");
});

test("narrative: auto-approved path", () => {
  const report = computeFactorAttribution(mkAssessment({
    effectiveApprovalClass: "auto",
    escalated: false,
    factors: [mkFactor("static_floor", 10)],
  }));
  const narrative = buildComplianceNarrative(report);
  assert(narrative.summary.includes("No escalation"), "summary says no escalation");
  assert(narrative.recommendedAction.includes("automated processing"), "recommends auto processing");
});

test("narrative: deny path", () => {
  const report = computeFactorAttribution(mkAssessment({
    effectiveApprovalClass: "deny",
    escalated: true,
    factors: [mkFactor("static_floor", 100)],
  }));
  const narrative = buildComplianceNarrative(report);
  assert(narrative.recommendedAction.includes("Deny"), "recommends denial");
});

test("narrative: threshold_escrow path", () => {
  const report = computeFactorAttribution(mkAssessment({
    effectiveApprovalClass: "threshold_escrow",
    escalated: true,
    factors: [mkFactor("behavioural:value_large", 80)],
  }));
  const narrative = buildComplianceNarrative(report);
  assert(narrative.recommendedAction.includes("multi-party threshold"), "recommends threshold");
});

test("narrative: empty factors → no-risk wording", () => {
  const report = computeFactorAttribution(mkAssessment({ factors: [], reputationBand: "trusted" }));
  const narrative = buildComplianceNarrative(report);
  assert(narrative.whyRisky.includes("No risk factors"), "states no factors");
  assert(narrative.citations.length === 0, "no citations when empty");
});

// ─── buildComplianceNarrative — edge cases ─────────────────────────────────

test("narrative: trusted reputation band does not add risk wording", () => {
  const report = computeFactorAttribution(mkAssessment({
    reputationBand: "trusted",
    factors: [mkFactor("reputation:trusted", -10)],
  }));
  const narrative = buildComplianceNarrative(report);
  assert(!narrative.whyRisky.includes('"trusted"'), "trusted band not flagged as risky");
});

test("narrative: normal reputation band does not add risk wording", () => {
  const report = computeFactorAttribution(mkAssessment({
    reputationBand: "normal",
    factors: [mkFactor("static_floor", 10)],
  }));
  const narrative = buildComplianceNarrative(report);
  assert(!narrative.whyRisky.includes('"normal"'), "normal band not flagged as risky");
});

// ─── Fail-closed ────────────────────────────────────────────────────────────

test("fail-closed: null input throws", () => {
  let threw = false;
  try {
    computeFactorAttribution(null);
  } catch (e) {
    threw = true;
    assert(String(e).includes("must be an object"), "mentions object requirement");
  }
  assert(threw, "throws on null");
});

test("fail-closed: undefined input throws", () => {
  let threw = false;
  try {
    computeFactorAttribution(undefined);
  } catch (e) {
    threw = true;
  }
  assert(threw, "throws on undefined");
});

test("fail-closed: missing riskScore throws", () => {
  let threw = false;
  try {
    computeFactorAttribution({ baseApprovalClass: "auto" });
  } catch (e) {
    threw = true;
    assert(String(e).includes("riskScore"), "mentions riskScore");
  }
  assert(threw, "throws when riskScore missing");
});

test("fail-closed: NaN riskScore throws", () => {
  let threw = false;
  try {
    computeFactorAttribution({ riskScore: NaN, factors: [] });
  } catch (e) {
    threw = true;
  }
  assert(threw, "throws on NaN riskScore");
});

test("fail-closed: Infinity riskScore throws", () => {
  let threw = false;
  try {
    computeFactorAttribution({ riskScore: Infinity, factors: [] });
  } catch (e) {
    threw = true;
  }
  assert(threw, "throws on Infinity riskScore");
});

test("fail-closed: null report to buildComplianceNarrative throws", () => {
  let threw = false;
  try {
    buildComplianceNarrative(null as unknown as AttributionReport);
  } catch (e) {
    threw = true;
    assert(String(e).includes("must be an object"), "mentions object requirement");
  }
  assert(threw, "throws on null report");
});
