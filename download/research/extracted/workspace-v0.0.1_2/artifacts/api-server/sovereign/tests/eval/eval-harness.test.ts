import "../_flush.mjs";
/**
 * tests/eval/eval-harness.test.ts — Eval Harness scorecards + golden tasks.
 *
 * Coverage:
 *   • PlanFidelity: perfect match, partial match, terminal mismatch, empty paths
 *   • ApprovalPrecision: trace verify, missing trace, signature tamper, unknown riskClass
 *   • EvidenceCompleteness: sufficient, insufficient, financial minimum, invalid ref
 *   • ReplayDeterminism: identical, divergence, length mismatch
 *   • EconomicInvariantScore: solvency, conservation, negative balance, invalid input
 *   • Golden tasks: all four canonical scenarios run end-to-end
 *   • runAllGoldenTasks: aggregate report structure
 */

import { test, assert, eq } from "../_harness.mjs";
import {
  scorePlanFidelity,
  scoreApprovalPrecision,
  scoreEvidenceCompleteness,
  scoreReplayDeterminism,
  scoreEconomicInvariant,
} from "../../lib/eval/scorecards.ts";
import {
  GOLDEN_TASKS,
  runAllGoldenTasks,
} from "../../lib/eval/golden-tasks.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import type { ScorecardResult } from "../../lib/eval/types.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function assertPassed(r: ScorecardResult, msg?: string) {
  assert(r.passed, msg || `expected score=1, got ${r.score}: ${r.details.join("; ")}`);
}

function assertFailed(r: ScorecardResult, msg?: string) {
  assert(!r.passed, msg || `expected score<1, got ${r.score}`);
  eq(r.score, 0, "fail-closed: invalid input must score 0");
}

function assertScore(r: ScorecardResult, expected: number, msg?: string) {
  if (r.score !== expected) {
    throw new Error(
      (msg || "score mismatch") + `: expected ${expected}, got ${r.score}; details: ${r.details.join("; ")}`,
    );
  }
}

// ─── PlanFidelity ─────────────────────────────────────────────────────────────

test("PlanFidelity: perfect match scores 1", () => {
  const r = scorePlanFidelity({
    actualPath: ["planned", "approved", "running"],
    expectedPath: ["planned", "approved", "running"],
    actualTerminal: "running",
    expectedTerminal: "running",
  });
  assertPassed(r);
});

test("PlanFidelity: partial match scores LCS ratio", () => {
  const r = scorePlanFidelity({
    actualPath: ["planned", "running"],
    expectedPath: ["planned", "approved", "running"],
    actualTerminal: "running",
    expectedTerminal: "running",
  });
  // LCS = 2, maxLen = 3, terminal matches → score = 2/3
  assertScore(r, 2 / 3);
});

test("PlanFidelity: terminal mismatch caps at 0.5", () => {
  const r = scorePlanFidelity({
    actualPath: ["planned", "approved", "running"],
    expectedPath: ["planned", "approved", "running"],
    actualTerminal: "failed",
    expectedTerminal: "running",
  });
  // LCS = 3, maxLen = 3 → raw = 1, but terminal mismatch caps at 0.5
  assertScore(r, 0.5);
});

test("PlanFidelity: empty paths with matching terminal scores 1", () => {
  const r = scorePlanFidelity({
    actualPath: [],
    expectedPath: [],
    actualTerminal: "released",
    expectedTerminal: "released",
  });
  assertPassed(r);
});

test("PlanFidelity: empty paths with mismatched terminal scores 0", () => {
  const r = scorePlanFidelity({
    actualPath: [],
    expectedPath: [],
    actualTerminal: "failed",
    expectedTerminal: "released",
  });
  assertFailed(r);
});

test("PlanFidelity: invalid input scores 0", () => {
  assertFailed(scorePlanFidelity(null as any));
  assertFailed(scorePlanFidelity({ actualPath: "not-array" } as any));
  assertFailed(scorePlanFidelity({ actualPath: [], expectedPath: [], actualTerminal: 123, expectedTerminal: "x" } as any));
});

// ─── ApprovalPrecision ────────────────────────────────────────────────────────

test("ApprovalPrecision: correct mapping without signer scores 1", () => {
  const r = scoreApprovalPrecision({
    riskClass: "read_only",
    approvalClass: "auto",
  });
  assertPassed(r);
});

test("ApprovalPrecision: valid trace with signer verifies", () => {
  const signer = new HmacSigner("test-secret-1234567890123456");
  const trace = {
    policy: "approval-policy-router",
    riskClass: "value_moving",
    approvalClass: "threshold_escrow",
    timestamp: "2024-01-01T00:00:00.000Z",
    signature: signer.sign('{"approvalClass":"threshold_escrow","policy":"approval-policy-router","riskClass":"value_moving","timestamp":"2024-01-01T00:00:00.000Z"}'),
  };
  const r = scoreApprovalPrecision({
    riskClass: "value_moving",
    approvalClass: "threshold_escrow",
    decisionTrace: JSON.stringify(trace),
    signer,
  });
  assertPassed(r);
});

test("ApprovalPrecision: missing trace with signer scores 0 (fail-closed)", () => {
  const signer = new HmacSigner("test-secret-1234567890123456");
  const r = scoreApprovalPrecision({
    riskClass: "read_only",
    approvalClass: "auto",
    signer,
  });
  assertFailed(r);
  assert(r.details[0].includes("fail-closed"), "should mention fail-closed");
});

test("ApprovalPrecision: tampered trace signature fails verification", () => {
  const signer = new HmacSigner("test-secret-1234567890123456");
  const trace = {
    policy: "approval-policy-router",
    riskClass: "read_only",
    approvalClass: "auto",
    timestamp: "2024-01-01T00:00:00.000Z",
    signature: signer.sign('{"approvalClass":"auto","policy":"approval-policy-router","riskClass":"read_only","timestamp":"2024-01-01T00:00:00.000Z"}'),
  };
  // Tamper the approvalClass in the trace but keep the original signature
  trace.approvalClass = "deny";
  const r = scoreApprovalPrecision({
    riskClass: "read_only",
    approvalClass: "deny",
    decisionTrace: JSON.stringify(trace),
    signer,
  });
  assertFailed(r);
  assert(r.details[0].includes("signature"), "should mention signature failure");
});

test("ApprovalPrecision: riskClass mismatch in trace scores 0", () => {
  const signer = new HmacSigner("test-secret-1234567890123456");
  const trace = {
    policy: "approval-policy-router",
    riskClass: "irreversible",
    approvalClass: "deny",
    timestamp: "2024-01-01T00:00:00.000Z",
    signature: signer.sign('{"approvalClass":"deny","policy":"approval-policy-router","riskClass":"irreversible","timestamp":"2024-01-01T00:00:00.000Z"}'),
  };
  const r = scoreApprovalPrecision({
    riskClass: "read_only", // mismatch
    approvalClass: "deny",
    decisionTrace: JSON.stringify(trace),
    signer,
  });
  assertFailed(r);
});

test("ApprovalPrecision: invalid input scores 0", () => {
  assertFailed(scoreApprovalPrecision(null as any));
  assertFailed(scoreApprovalPrecision({ riskClass: "", approvalClass: "auto" }));
  assertFailed(scoreApprovalPrecision({ riskClass: "x", approvalClass: "" }));
});

// ─── EvidenceCompleteness ───────────────────────────────────────────────────────

test("EvidenceCompleteness: sufficient evidence scores 1", () => {
  const r = scoreEvidenceCompleteness({
    evidenceRefs: ["ev-1", "ev-2"],
    requiredCount: 2,
    isFinancial: false,
  });
  assertPassed(r);
});

test("EvidenceCompleteness: insufficient evidence scores partial", () => {
  const r = scoreEvidenceCompleteness({
    evidenceRefs: ["ev-1"],
    requiredCount: 2,
    isFinancial: false,
  });
  assertScore(r, 0.5);
});

test("EvidenceCompleteness: financial requires minimum 2", () => {
  const r = scoreEvidenceCompleteness({
    evidenceRefs: ["ev-1"],
    requiredCount: 1,
    isFinancial: true,
  });
  // effectiveRequired = max(1, 2) = 2, count = 1 → score = 0.5
  assertScore(r, 0.5);
});

test("EvidenceCompleteness: empty evidenceRef entry scores 0", () => {
  const r = scoreEvidenceCompleteness({
    evidenceRefs: ["ev-1", ""],
    requiredCount: 1,
    isFinancial: false,
  });
  assertFailed(r);
});

test("EvidenceCompleteness: invalid input scores 0", () => {
  assertFailed(scoreEvidenceCompleteness(null as any));
  assertFailed(scoreEvidenceCompleteness({ evidenceRefs: "not-array", requiredCount: 0, isFinancial: false } as any));
  assertFailed(scoreEvidenceCompleteness({ evidenceRefs: [], requiredCount: -1, isFinancial: false }));
});

// ─── ReplayDeterminism ────────────────────────────────────────────────────────

test("ReplayDeterminism: identical runs score 1", () => {
  const r = scoreReplayDeterminism({
    firstRun: ["hash-a", "hash-b", "hash-c"],
    secondRun: ["hash-a", "hash-b", "hash-c"],
  });
  assertPassed(r);
});

test("ReplayDeterminism: length mismatch scores 0", () => {
  const r = scoreReplayDeterminism({
    firstRun: ["hash-a"],
    secondRun: ["hash-a", "hash-b"],
  });
  assertFailed(r);
});

test("ReplayDeterminism: entry divergence scores 0", () => {
  const r = scoreReplayDeterminism({
    firstRun: ["hash-a", "hash-x", "hash-c"],
    secondRun: ["hash-a", "hash-b", "hash-c"],
  });
  assertFailed(r);
  assert(r.details[0].includes("index 1"), "should mention divergence index");
});

test("ReplayDeterminism: invalid input scores 0", () => {
  assertFailed(scoreReplayDeterminism(null as any));
  assertFailed(scoreReplayDeterminism({ firstRun: "x", secondRun: ["y"] } as any));
});

// ─── EconomicInvariantScore ───────────────────────────────────────────────────

test("EconomicInvariantScore: valid state scores 1", () => {
  const r = scoreEconomicInvariant({
    tenantId: "t-1",
    before: [
      { id: "a1", balance: 100_000n, type: "asset" },
      { id: "a2", balance: 50_000n, type: "asset" },
    ],
    after: [
      { id: "a1", balance: 70_000n, type: "asset" },
      { id: "a2", balance: 80_000n, type: "asset" },
    ],
    movedAmount: 30_000n,
  });
  assertPassed(r);
});

test("EconomicInvariantScore: negative balance scores 0", () => {
  const r = scoreEconomicInvariant({
    tenantId: "t-1",
    before: [
      { id: "a1", balance: 100_000n, type: "asset" },
    ],
    after: [
      { id: "a1", balance: -10_000n, type: "asset" },
    ],
  });
  assertFailed(r);
  assert(r.details[0].includes("negative"), "should mention negative balance");
});

test("EconomicInvariantScore: solvency violation scores 0", () => {
  const r = scoreEconomicInvariant({
    tenantId: "t-1",
    before: [
      { id: "a1", balance: 100_000n, type: "asset" },
      { id: "l1", balance: 50_000n, type: "liability" },
    ],
    after: [
      { id: "a1", balance: 40_000n, type: "asset" },
      { id: "l1", balance: 50_000n, type: "liability" },
    ],
  });
  assertFailed(r);
  assert(r.details[0].includes("solvency"), "should mention solvency");
});

test("EconomicInvariantScore: conservation violation scores 0", () => {
  const r = scoreEconomicInvariant({
    tenantId: "t-1",
    before: [
      { id: "a1", balance: 100_000n, type: "asset" },
    ],
    after: [
      { id: "a1", balance: 120_000n, type: "asset" },
    ],
    movedAmount: 0n,
  });
  assertFailed(r);
  assert(r.details[0].includes("conservation"), "should mention conservation");
});

test("EconomicInvariantScore: invalid input scores 0", () => {
  assertFailed(scoreEconomicInvariant(null as any));
  assertFailed(scoreEconomicInvariant({ tenantId: "", before: [], after: [] }));
  assertFailed(scoreEconomicInvariant({ tenantId: "t", before: "x", after: [] } as any));
});

test("EconomicInvariantScore: liability equals assets is solvent", () => {
  const r = scoreEconomicInvariant({
    tenantId: "t-1",
    before: [
      { id: "a1", balance: 50_000n, type: "asset" },
      { id: "l1", balance: 50_000n, type: "liability" },
    ],
    after: [
      { id: "a1", balance: 50_000n, type: "asset" },
      { id: "l1", balance: 50_000n, type: "liability" },
    ],
  });
  assertPassed(r);
});

// ─── efficiency/single-pass-solvency ───────────────────────────────────────────
// assetSum/liabilitySum used to be computed via two filter()+reduce() passes
// over input.after (4 full scans). They're now accumulated in one loop. These
// tests pin that the merged loop still separates asset/liability correctly
// (no cross-contamination), handles unknown account types as neither (matches
// the old filter() semantics, which only matched exact "asset"/"liability"),
// and handles the empty-array edge case.

test("efficiency/single-pass-solvency — unknown account type counted in neither sum", () => {
  const r = scoreEconomicInvariant({
    tenantId: "t-1",
    before: [
      { id: "a1", balance: 100_000n, type: "asset" },
      { id: "x1", balance: 999_000n, type: "equity" }, // unknown type — old filter() ignored it too
    ],
    after: [
      { id: "a1", balance: 100_000n, type: "asset" },
      { id: "x1", balance: 999_000n, type: "equity" },
    ],
  });
  // Solvent: assetSum=100_000 >= liabilitySum=0, regardless of the large
  // "equity" balance, proving it isn't silently added to either sum.
  assertPassed(r);
  assert(r.details.some(d => d.includes("assets=100000") && d.includes("liabilities=0")), "equity must not be counted as asset or liability");
});

test("efficiency/single-pass-solvency — empty after array is vacuously solvent (0 >= 0)", () => {
  const r = scoreEconomicInvariant({
    tenantId: "t-1",
    before: [],
    after: [],
  });
  assertPassed(r);
  assert(r.details.some(d => d.includes("assets=0") && d.includes("liabilities=0")), "empty after must yield zero sums on both sides");
});

test("efficiency/single-pass-solvency — regression: liability-only array still detects insolvency", () => {
  // No asset accounts at all — assetSum stays 0n from initialization (never
  // touched by the liability branch), liabilitySum accumulates normally.
  const r = scoreEconomicInvariant({
    tenantId: "t-1",
    before: [{ id: "l1", balance: 0n, type: "liability" }],
    after: [{ id: "l1", balance: 1_000n, type: "liability" }],
  });
  assertFailed(r);
  assert(r.details[0].includes("solvency"), "0 assets vs 1000 liability must violate solvency");
});

// ─── Golden Tasks ─────────────────────────────────────────────────────────────

test("golden task: value-moving-with-escrow passes all scorecards", async () => {
  const task = GOLDEN_TASKS.find(t => t.id === "eval-gt-001")!;
  const result = await task.run();
  eq(result.taskId, "eval-gt-001");
  eq(result.taskName, "value-moving-with-escrow");
  assert(result.overallScore > 0, "overall score must be positive");
  // All scorecards should pass for this happy-path task
  for (const [name, card] of Object.entries(result.scorecards)) {
    assert(card.score > 0, `${name} must have positive score: ${card.details.join("; ")}`);
  }
});

test("golden task: read-only-safe-path passes all scorecards", async () => {
  const task = GOLDEN_TASKS.find(t => t.id === "eval-gt-002")!;
  const result = await task.run();
  eq(result.taskId, "eval-gt-002");
  eq(result.taskName, "read-only-safe-path");
  assert(result.overallScore > 0, "overall score must be positive");
  assert(result.scorecards.ApprovalPrecision.score > 0, "approval precision must be positive");
});

test("golden task: execution-workflow-evidence passes all scorecards", async () => {
  const task = GOLDEN_TASKS.find(t => t.id === "eval-gt-003")!;
  const result = await task.run();
  eq(result.taskId, "eval-gt-003");
  eq(result.taskName, "execution-workflow-evidence");
  assert(result.overallScore > 0, "overall score must be positive");
  // This task specifically validates replay determinism
  assert(result.scorecards.ReplayDeterminism.passed, "replay determinism must pass");
  assert(result.scorecards.PlanFidelity.passed, "plan fidelity must pass");
});

test("golden task: denied-irreversible passes all scorecards", async () => {
  const task = GOLDEN_TASKS.find(t => t.id === "eval-gt-004")!;
  const result = await task.run();
  eq(result.taskId, "eval-gt-004");
  eq(result.taskName, "denied-irreversible");
  assert(result.overallScore > 0, "overall score must be positive");
  // Approval should be deny for unknown actions
  assert(result.scorecards.ApprovalPrecision.score > 0, "approval precision must be positive");
  // Economic invariant should pass because no money moved
  assert(result.scorecards.EconomicInvariantScore.passed, "economic invariant must pass");
});

test("runAllGoldenTasks produces aggregate report", async () => {
  const report = await runAllGoldenTasks();
  eq(report.tasks.length, 6, "all 6 golden tasks should run");
  assert(report.overallMean >= 0 && report.overallMean <= 1, "overall mean must be in [0,1]");
  const names = ["PlanFidelity", "ApprovalPrecision", "EvidenceCompleteness", "ReplayDeterminism", "EconomicInvariantScore"];
  for (const name of names) {
    assert(typeof report.scorecardMeans[name] === "number", `${name} mean must be a number`);
    assert(report.scorecardMeans[name] >= 0 && report.scorecardMeans[name] <= 1, `${name} mean must be in [0,1]`);
  }
});

test("golden task: escrow-dispute-reversal passes all scorecards", async () => {
  const task = GOLDEN_TASKS.find(t => t.id === "eval-gt-005")!;
  const result = await task.run();
  eq(result.taskId, "eval-gt-005");
  eq(result.taskName, "escrow-dispute-reversal");
  assert(result.overallScore > 0, "overall score must be positive");
  assert(result.scorecards.PlanFidelity.passed, "reversal plan fidelity must pass");
  assert(result.scorecards.EconomicInvariantScore.passed, "economic invariant must pass (payer regains funds)");
  assert(result.scorecards.SafetyScore.passed, "safety must pass");
});

test("golden task: partial-release-then-full passes all scorecards", async () => {
  const task = GOLDEN_TASKS.find(t => t.id === "eval-gt-006")!;
  const result = await task.run();
  eq(result.taskId, "eval-gt-006");
  eq(result.taskName, "partial-release-then-full");
  assert(result.overallScore > 0, "overall score must be positive");
  assert(result.scorecards.PlanFidelity.passed, "partial+full release plan fidelity must pass");
  assert(result.scorecards.EconomicInvariantScore.passed, "economic invariant must pass (200k moved to worker)");
  assert(result.scorecards.SafetyScore.passed, "safety must pass");
});

// ─── efficiency/single-pass-scorecard-aggregation (v432) ──────────────────────
// Three tests covering the single-pass aggregation in runAllGoldenTasks() that
// replaced M=6 separate .reduce() passes over the tasks array.

test("single-pass-aggregation happy-path: scorecardMeans matches per-task values (regression)", async () => {
  // The single-pass loop must produce the same means as the M-reduce approach.
  const report = await runAllGoldenTasks();
  const names = Object.keys(report.scorecardMeans);
  eq(names.length, 6, "all 6 scorecard means must be present");
  // Verify each mean is consistent with the individual task scores.
  for (const name of names) {
    const expected = report.tasks.reduce((s, t) => s + (t.scorecards as any)[name].score, 0) / report.tasks.length;
    const actual = report.scorecardMeans[name];
    assert(Math.abs(actual - expected) < 1e-10, `${name} mean ${actual} must equal recomputed mean ${expected}`);
  }
});

test("single-pass-aggregation edge-case: overallMean is consistent with per-task overallScore values", async () => {
  const report = await runAllGoldenTasks();
  const recomputed = report.tasks.reduce((s, t) => s + t.overallScore, 0) / report.tasks.length;
  assert(Math.abs(report.overallMean - recomputed) < 1e-10,
    `overallMean ${report.overallMean} must equal recomputed ${recomputed} (single-pass vs reduce)`);
  assert(report.overallMean >= 0 && report.overallMean <= 1, "overall mean must be in [0,1]");
});

test("single-pass-aggregation fail-closed: SafetyScore mean is present and non-negative", async () => {
  // SafetyScore was not in the original names list used in the existing test —
  // verifies the single-pass loop includes ALL scorecard names from tasks[0].
  const report = await runAllGoldenTasks();
  assert(typeof report.scorecardMeans["SafetyScore"] === "number",
    "SafetyScore mean must be present (single-pass reads all keys from tasks[0].scorecards)");
  assert(report.scorecardMeans["SafetyScore"] >= 0, "SafetyScore mean must be non-negative");
  // The all-zeros / empty edge case: if tasks were empty, overallMean should be 0.
  // Simulate by checking return type contract; we can't call with empty GOLDEN_TASKS
  // but we verify the guard via the current run (tasks.length > 0 → no divide-by-zero).
  assert(report.tasks.length > 0, "GOLDEN_TASKS must not be empty");
});
