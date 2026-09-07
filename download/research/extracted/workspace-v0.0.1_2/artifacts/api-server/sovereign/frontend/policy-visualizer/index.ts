/**
 * TFA Frontend Policy Visualizer — visual tree and dry-run display layer.
 *
 * Zero runtime dependencies.
 */

export type {
  PolicyBranch,
  PolicyConditionShape,
  PolicyRuleShape,
  DeclarativePolicyShape,
  PolicyTreeNode,
  DiffChangeKind,
  PolicyRuleDiff,
  PolicyDiff,
  DeltaKind,
  DryRunRecordDisplay,
  DeltaBar,
  DryRunDisplayReport,
  PolicyDryRunReportShape,
} from "./types.ts";

export { classifyBranch, buildPolicyTree, diffPolicies } from "./tree.ts";

export { deltaSeverity, formatDryRunReport, formatBranchLabel } from "./format.ts";
