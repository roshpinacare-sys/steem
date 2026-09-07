/**
 * tests/frontend/policy-visualizer.test.ts
 *
 * Tests for frontend/policy-visualizer/ — visual policy tree + dry-run display.
 *
 * Coverage: happy-path (8), edge-cases (7), fail-closed (7) = 22 assertions.
 */

import { buildPolicyTree, classifyBranch, diffPolicies } from "../../frontend/policy-visualizer/tree.ts";
import { formatDryRunReport, deltaSeverity, formatBranchLabel } from "../../frontend/policy-visualizer/format.ts";
import type {
  DeclarativePolicyShape,
  PolicyDryRunReportShape,
} from "../../frontend/policy-visualizer/types.ts";

// ── helpers ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

function assertThrows(label: string, fn: () => unknown): void {
  try {
    fn();
    console.error(`  ✗ ${label} (expected throw, got none)`);
    failed++;
  } catch {
    console.log(`  ✓ ${label}`);
    passed++;
  }
}

// ── fixtures ──────────────────────────────────────────────────────────────────

const TENANT = "t-vis-01";

const fullPolicy: DeclarativePolicyShape = {
  name: "test-policy",
  rules: [
    { if: { actionType: ["read_file"] }, then: "allow" },                                      // auto
    { if: { isAutonomous: true }, then: "allow" },                                             // human
    { if: { isFinancial: true }, then: "allow" },                                              // human
    { if: { amountAbove: "10000000" }, then: "deny", reason: "over limit" },                  // threshold-escrow → deny
    { if: { amountAtMost: "10000000" }, then: "allow" },                                      // threshold-escrow → allow
    { if: { actionType: ["db_migration"] }, then: "deny", reason: "blocked action type" },    // deny
  ],
  default: "deny",
};

function makeDryRunReport(overrides: Partial<PolicyDryRunReportShape> = {}): PolicyDryRunReportShape {
  return {
    tenantId: TENANT,
    total: 10,
    counts: { unchanged: 6, escalated: 2, relaxed: 1, newly_denied: 1, newly_allowed: 0 },
    changed: [
      { recordId: "r1", recordedDecision: "allowed", replayedDecision: "approval_required", delta: "escalated", summary: "allowed → approval_required (escalated)" },
      { recordId: "r2", recordedDecision: "allowed", replayedDecision: "denied", delta: "newly_denied", summary: "allowed → denied (newly_denied)" },
      { recordId: "r3", recordedDecision: "approval_required", replayedDecision: "allowed", delta: "newly_allowed", summary: "approval_required → allowed (newly_allowed)" },
      { recordId: "r4", recordedDecision: "denied", replayedDecision: "approval_required", delta: "relaxed", summary: "denied → approval_required (relaxed)" },
    ],
    records: [],
    headline: "3 of 10 actions would have escalated (1 newly denied); 2 would have relaxed.",
    ...overrides,
  };
}

// ── happy-path ────────────────────────────────────────────────────────────────

console.log("\n=== happy-path ===");

{
  const tree = buildPolicyTree(fullPolicy);

  assert(
    "buildPolicyTree: returns nodes for all rules + default",
    tree.length === fullPolicy.rules.length + 1
  );

  assert(
    "buildPolicyTree: read_file rule is 'auto' branch",
    tree[0].branch === "auto" && tree[0].effect === "allow"
  );

  assert(
    "buildPolicyTree: isAutonomous allow rule is 'human' branch",
    tree[1].branch === "human" && tree[1].effect === "allow"
  );

  assert(
    "buildPolicyTree: isFinancial allow rule is 'human' branch",
    tree[2].branch === "human"
  );

  assert(
    "buildPolicyTree: amountAbove deny rule is 'threshold-escrow' branch",
    tree[3].branch === "threshold-escrow" && tree[3].effect === "deny"
  );

  assert(
    "buildPolicyTree: amountAtMost allow rule is 'threshold-escrow' branch",
    tree[4].branch === "threshold-escrow" && tree[4].effect === "allow"
  );

  assert(
    "buildPolicyTree: explicit deny rule is 'deny' branch",
    tree[5].branch === "deny" && tree[5].effect === "deny" && tree[5].reason === "blocked action type"
  );

  const defaultNode = tree[tree.length - 1];
  assert(
    "buildPolicyTree: default node is deny branch and isDefault=true",
    defaultNode.isDefault === true && defaultNode.branch === "deny" && defaultNode.ruleIndex === "default"
  );
}

{
  const report = formatDryRunReport(makeDryRunReport());

  assert(
    "formatDryRunReport: returns correct total",
    report.total === 10
  );

  assert(
    "formatDryRunReport: bars cover all 5 delta kinds",
    report.bars.length === 5
  );

  const unchangedBar = report.bars.find((b) => b.kind === "unchanged")!;
  assert(
    "formatDryRunReport: unchanged bar has correct count+percentage",
    unchangedBar.count === 6 && unchangedBar.percentage === 60
  );

  assert(
    "formatDryRunReport: changedRecords contains 4 entries",
    report.changedRecords.length === 4
  );

  const escalatedRec = report.changedRecords.find((r) => r.delta === "escalated")!;
  assert(
    "formatDryRunReport: escalated record severity is warn",
    escalatedRec.severity === "warn"
  );

  const deniedRec = report.changedRecords.find((r) => r.delta === "newly_denied")!;
  assert(
    "formatDryRunReport: newly_denied record severity is critical",
    deniedRec.severity === "critical"
  );

  assert(
    "formatDryRunReport: hasNewDenials=true and hasRelaxations=true",
    report.hasNewDenials === true && report.hasRelaxations === true
  );

  assert(
    "formatDryRunReport: allUnchanged=false when changes exist",
    report.allUnchanged === false
  );
}

{
  const beforePolicy: DeclarativePolicyShape = {
    name: "policy-v1",
    rules: [
      { if: { actionType: ["read"] }, then: "allow" },
      { if: { isAutonomous: true }, then: "deny", reason: "no auto" },
    ],
    default: "deny",
  };
  const afterPolicy: DeclarativePolicyShape = {
    name: "policy-v1",
    rules: [
      { if: { actionType: ["read"] }, then: "allow" },
      { if: { isAutonomous: true, amountAbove: "5000" }, then: "deny", reason: "no auto big" },
      { if: { actionType: ["write"] }, then: "deny", reason: "new deny" },
    ],
    default: "deny",
  };

  const diff = diffPolicies(beforePolicy, afterPolicy);

  assert(
    "diffPolicies: unchanged rule detected correctly",
    diff.ruleDiffs[0].kind === "unchanged"
  );

  assert(
    "diffPolicies: changed rule detected correctly",
    diff.ruleDiffs[1].kind === "changed" && diff.changed === 1
  );

  assert(
    "diffPolicies: added rule detected correctly",
    diff.ruleDiffs[2].kind === "added" && diff.added === 1
  );

  assert(
    "diffPolicies: summary mentions added and changed",
    diff.summary.includes("1 added") && diff.summary.includes("1 changed")
  );
}

// ── edge-cases ────────────────────────────────────────────────────────────────

console.log("\n=== edge-cases ===");

{
  const emptyPolicy: DeclarativePolicyShape = {
    name: "empty",
    rules: [],
    default: "allow",
  };
  const tree = buildPolicyTree(emptyPolicy);
  assert(
    "empty rules: tree has only the default node",
    tree.length === 1 && tree[0].isDefault === true
  );
  assert(
    "empty rules: default=allow → auto branch",
    tree[0].branch === "auto"
  );
}

{
  const zeroReport = formatDryRunReport(makeDryRunReport({
    total: 0,
    counts: { unchanged: 0, escalated: 0, relaxed: 0, newly_denied: 0, newly_allowed: 0 },
    changed: [],
    headline: "no history to replay",
  }));
  assert(
    "zero history: all bars have 0% and allUnchanged=false (total=0)",
    zeroReport.bars.every((b) => b.percentage === 0) && zeroReport.allUnchanged === false
  );
}

{
  const allUnchangedReport = formatDryRunReport(makeDryRunReport({
    total: 5,
    counts: { unchanged: 5, escalated: 0, relaxed: 0, newly_denied: 0, newly_allowed: 0 },
    changed: [],
    headline: "0 of 5 actions would have changed.",
  }));
  assert(
    "all-unchanged report: allUnchanged=true, no denials, no relaxations",
    allUnchangedReport.allUnchanged === true &&
    allUnchangedReport.hasNewDenials === false &&
    allUnchangedReport.hasRelaxations === false
  );
}

{
  const diff = diffPolicies(
    { name: "p", rules: [{ if: { actionType: ["read"] }, then: "allow" }], default: "deny" },
    { name: "p", rules: [{ if: { actionType: ["read"] }, then: "allow" }], default: "deny" }
  );
  assert("identical policies: diff reports no changes", diff.summary === "No changes detected.");
}

{
  assert("deltaSeverity: newly_denied → critical", deltaSeverity("newly_denied") === "critical");
  assert("deltaSeverity: escalated → warn", deltaSeverity("escalated") === "warn");
  assert("deltaSeverity: relaxed → info", deltaSeverity("relaxed") === "info");
  assert("deltaSeverity: unchanged → info", deltaSeverity("unchanged") === "info");
}

{
  assert(
    "formatBranchLabel: maps all four branches",
    formatBranchLabel("auto") === "Auto-approved" &&
    formatBranchLabel("human") === "Human review" &&
    formatBranchLabel("threshold-escrow") === "Threshold / Escrow" &&
    formatBranchLabel("deny") === "Denied"
  );
}

{
  const defaultDenyDiff = diffPolicies(
    { name: "p", rules: [], default: "allow" },
    { name: "p", rules: [], default: "deny" }
  );
  assert(
    "diffPolicies: default change flagged correctly",
    defaultDenyDiff.defaultChanged === true &&
    defaultDenyDiff.beforeDefault === "allow" &&
    defaultDenyDiff.afterDefault === "deny" &&
    defaultDenyDiff.summary.includes("default allow")
  );
}

// ── fail-closed ───────────────────────────────────────────────────────────────

console.log("\n=== fail-closed ===");

assertThrows("buildPolicyTree: null input throws", () => buildPolicyTree(null));
assertThrows("buildPolicyTree: missing name throws", () =>
  buildPolicyTree({ name: "", rules: [] })
);
assertThrows("buildPolicyTree: non-array rules throws", () =>
  buildPolicyTree({ name: "x", rules: "bad" })
);
assertThrows("buildPolicyTree: malformed rule throws", () =>
  buildPolicyTree({ name: "x", rules: [null] })
);
assertThrows("formatDryRunReport: null input throws", () => formatDryRunReport(null));
assertThrows("formatDryRunReport: non-finite total throws", () =>
  formatDryRunReport({ total: NaN, counts: {}, changed: [], headline: "x", tenantId: "t", records: [] })
);
assertThrows("formatDryRunReport: missing counts throws", () =>
  formatDryRunReport({ total: 1, counts: null, changed: [], headline: "x", tenantId: "t", records: [] })
);
assertThrows("diffPolicies: null before throws", () => diffPolicies(null, { name: "x", rules: [] }));
assertThrows("diffPolicies: null after throws", () => diffPolicies({ name: "x", rules: [] }, null));

// ── result ────────────────────────────────────────────────────────────────────

console.log(`\nResult: ${passed} pass, ${failed} fail`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) process.exit(1);
