/**
 * frontend/risk-intelligence/types.ts — Factor-attribution types for compliance explainability.
 *
 * Zero runtime dependencies.
 */

/** Severity band for UI styling and compliance prioritisation. */
export type Severity = "info" | "warn" | "critical";

/** One factor with its computed attribution share. */
export interface FactorAttribution {
  factor: string;
  /** Signed contribution to the fused risk score (positive = riskier). */
  contribution: number;
  /** Absolute contribution used for percentage allocation. */
  absContribution: number;
  /** Share of total absolute contribution, rounded to one decimal. */
  percentage: number;
  /** Rank by absolute contribution (1 = largest). */
  rank: number;
  severity: Severity;
  detail: string;
}

/** Complete attribution report over a fused risk assessment. */
export interface AttributionReport {
  riskScore: number;
  baseApprovalClass: string;
  effectiveApprovalClass: string;
  escalated: boolean;
  /** Sum of absolute contributions across all factors. */
  totalAbsContribution: number;
  /** Factors ranked by absolute impact. */
  factors: FactorAttribution[];
  /** The single largest-impact factor, or null when no factors exist. */
  topFactor: FactorAttribution | null;
  /** Number of behavioural (contextual) signals present. */
  contextualCount: number;
  /** Reputation band if known. */
  reputationBand: string | null;
}

/** Compliance-ready narrative answering "why was this risky?". */
export interface ComplianceNarrative {
  /** One-sentence decision summary. */
  summary: string;
  /** Paragraph explaining risk drivers with citations. */
  whyRisky: string;
  /** Recommended compliance action. */
  recommendedAction: string;
  /** List of factor identifiers cited in the narrative. */
  citations: string[];
}
