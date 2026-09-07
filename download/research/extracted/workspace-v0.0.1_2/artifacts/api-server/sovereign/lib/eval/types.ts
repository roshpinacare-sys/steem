/**
 * lib/eval/types.ts — Eval Harness: canonical types for TFA-native evaluation.
 *
 * The eval harness measures "did the system act correctly, verifiably, and safely"
 * through five scorecards over golden tasks (canonical scenarios).
 *
 * Zero external dependencies.
 */

// ─── Scorecard taxonomy ─────────────────────────────────────────────────────

/** The canonical scorecard dimensions. */
export type ScorecardName =
  | "PlanFidelity"
  | "ApprovalPrecision"
  | "EvidenceCompleteness"
  | "ReplayDeterminism"
  | "EconomicInvariantScore"
  | "SafetyScore";

/** Result of evaluating a single scorecard. */
export interface ScorecardResult {
  /** Score between 0.0 and 1.0 (inclusive). */
  score: number;
  /** True if score === 1.0 (all checks passed). */
  passed: boolean;
  /** Human-readable details of passes / failures. */
  details: string[];
}

/** Result of running a single golden task through the eval harness. */
export interface EvalRunResult {
  /** Unique task identifier. */
  taskId: string;
  /** Human-readable task name. */
  taskName: string;
  /** ISO-8601 timestamp of evaluation. */
  evaluatedAt: string;
  /** Overall score: arithmetic mean of all scorecard scores. */
  overallScore: number;
  /** Per-scorecard breakdown. */
  scorecards: Record<ScorecardName, ScorecardResult>;
}

/** A golden task is a canonical scenario with a known expected outcome. */
export interface GoldenTask {
  id: string;
  name: string;
  description: string;
  run(): Promise<EvalRunResult>;
}

// ─── Scorecard inputs ─────────────────────────────────────────────────────────

/** Input for PlanFidelity scorecard. */
export interface PlanFidelityInput {
  /** The actual status path taken (e.g. ["planned","approved","running"]). */
  actualPath: string[];
  /** The expected status path for this golden task. */
  expectedPath: string[];
  /** Terminal state that the workflow should end in. */
  expectedTerminal: string;
  /** The actual final status. */
  actualTerminal: string;
}

/** Input for ApprovalPrecision scorecard. */
export interface ApprovalPrecisionInput {
  /** The risk class that was classified. */
  riskClass: string;
  /** The approval class that was resolved. */
  approvalClass: string;
  /** The decision trace string (if present). */
  decisionTrace?: string;
  /** The signer used to create the trace (for verification). */
  signer?: { algorithm: string; sign(data: string): string; verify(data: string, signature: string): boolean };
}

/** Input for EvidenceCompleteness scorecard. */
export interface EvidenceCompletenessInput {
  /** Evidence references actually collected. */
  evidenceRefs: string[];
  /** Minimum number of evidence items required for this task type. */
  requiredCount: number;
  /** Whether the action was financial (value-moving actions need more evidence). */
  isFinancial: boolean;
}

/** Input for ReplayDeterminism scorecard. */
export interface ReplayDeterminismInput {
  /** First replay invocation log (ordered entry hashes). */
  firstRun: string[];
  /** Second replay invocation log (ordered entry hashes). */
  secondRun: string[];
}

/** Account snapshot for economic invariant checks. */
export interface AccountSnapshot {
  id: string;
  balance: bigint;
  type: string;
}

/** Input for EconomicInvariantScore scorecard. */
export interface EconomicInvariantInput {
  /** Tenant being evaluated. */
  tenantId: string;
  /** Snapshots before the operation. */
  before: AccountSnapshot[];
  /** Snapshots after the operation. */
  after: AccountSnapshot[];
  /** Total amount that should have moved (for conservation checks). */
  movedAmount?: bigint;
}

/**
 * Input for SafetyScore scorecard — "did the system avoid unsafe autonomy?"
 * Measures the safety axis emphasized by NIST AI RMF / OWASP Agentic Security:
 * no false-allow (a deny / required-approval bypassed), no unbounded blast
 * radius (irreversible auto-approved, cross-tenant), and no needless false-deny.
 */
export interface SafetyScoreInput {
  /** The classified risk class of the action (e.g. "value_moving"). */
  riskClass: string;
  /** The resolved approval class (e.g. "threshold_escrow"). */
  approvalClass: string;
  /** What actually happened to the action. */
  outcome: "allowed" | "denied" | "error";
  /** Whether the required human/threshold approval was actually obtained. */
  approvalSatisfied?: boolean;
  /** True if the action touched data outside its tenant — always a safety breach. */
  crossTenant?: boolean;
}
