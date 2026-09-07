/**
 * frontend/policy-visualizer/types.ts — Visual policy tree and dry-run display types.
 *
 * Zero runtime dependencies. All shapes are frontend-facing re-declarations
 * of the engine types so this package stays self-contained.
 */

/** The four visual branches of a policy decision tree. */
export type PolicyBranch = "auto" | "human" | "threshold-escrow" | "deny";

/** Frontend-facing re-declaration of a policy condition (no engine deps). */
export interface PolicyConditionShape {
  actionType?: string[];
  actionTypeNotIn?: string[];
  amountAbove?: string;
  amountAtMost?: string;
  isAutonomous?: boolean;
  isFinancial?: boolean;
  source?: string[];
  tenantId?: string[];
  minTrustScore?: number;
  maxMonthlyActions?: number;
}

/** Frontend-facing re-declaration of a policy rule. */
export interface PolicyRuleShape {
  if: PolicyConditionShape;
  then: "allow" | "deny";
  reason?: string;
}

/** Frontend-facing re-declaration of a declarative policy. */
export interface DeclarativePolicyShape {
  name: string;
  rules: PolicyRuleShape[];
  default?: "allow" | "deny";
}

/** A single node in the visual policy tree (one rule or the default case). */
export interface PolicyTreeNode {
  /** Rule index (0-based) or "default" for the catch-all case. */
  ruleIndex: number | "default";
  /** The visual branch this node belongs to. */
  branch: PolicyBranch;
  /** The compiled effect this rule applies. */
  effect: "allow" | "deny";
  /** Human-readable label for the condition. */
  conditionLabel: string;
  /** Human-readable label for the outcome. */
  outcomeLabel: string;
  /** Deny reason, if applicable. */
  reason?: string;
  /** True when this is the default catch-all rule. */
  isDefault: boolean;
}

/** How a single rule changed between two policy versions. */
export type DiffChangeKind = "added" | "removed" | "changed" | "unchanged";

export interface PolicyRuleDiff {
  ruleIndex: number;
  kind: DiffChangeKind;
  description: string;
  before?: PolicyRuleShape;
  after?: PolicyRuleShape;
}

/** Structured diff between two policy versions. */
export interface PolicyDiff {
  nameChanged: boolean;
  defaultChanged: boolean;
  beforeDefault: "allow" | "deny";
  afterDefault: "allow" | "deny";
  ruleDiffs: PolicyRuleDiff[];
  added: number;
  removed: number;
  changed: number;
  summary: string;
}

/** Delta kinds (mirrors lib/risk/policy-dryrun.ts DeltaKind). */
export type DeltaKind =
  | "unchanged"
  | "escalated"
  | "relaxed"
  | "newly_denied"
  | "newly_allowed";

/** One formatted changed record for display. */
export interface DryRunRecordDisplay {
  recordId?: string;
  before: string;
  after: string;
  delta: DeltaKind;
  label: string;
  severity: "info" | "warn" | "critical";
}

/** Bar chart entry for one delta kind. */
export interface DeltaBar {
  kind: DeltaKind;
  count: number;
  percentage: number;
  label: string;
}

/** Fully formatted dry-run report ready for frontend rendering. */
export interface DryRunDisplayReport {
  headline: string;
  total: number;
  bars: DeltaBar[];
  changedRecords: DryRunRecordDisplay[];
  allUnchanged: boolean;
  hasNewDenials: boolean;
  hasRelaxations: boolean;
}

/**
 * Input shape for formatDryRunReport.
 * Mirrors PolicyDryRunReport from lib/risk/policy-dryrun.ts so this module
 * stays zero-dep and can be used without importing the engine.
 */
export interface PolicyDryRunReportShape {
  tenantId: string;
  total: number;
  counts: Record<DeltaKind, number>;
  changed: Array<{
    recordId?: string;
    recordedDecision: string;
    replayedDecision: string;
    delta: DeltaKind;
    summary: string;
  }>;
  records: Array<{
    recordId?: string;
    recordedDecision: string;
    replayedDecision: string;
    delta: DeltaKind;
    summary: string;
  }>;
  headline: string;
}
