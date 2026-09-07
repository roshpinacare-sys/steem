/**
 * frontend/approval-console/types.ts — Approval console event model.
 *
 * Types for real-time approval events, risk explainability, and console state.
 * Zero runtime dependencies.
 */

/** Terminal states for an approval decision. */
export type ApprovalStatus =
  | "pending"
  | "approved"
  | "denied"
  | "escalated"
  | "error";

/** A single risk factor that contributed to the fused score. */
export interface ConsoleRiskFactor {
  factor: string;
  contribution: number;
  detail: string;
}

/** Normalised risk assessment produced by the intelligence engine. */
export interface ConsoleRiskAssessment {
  riskScore: number;
  baseApprovalClass: string;
  effectiveApprovalClass: string;
  escalated: boolean;
  factors: ConsoleRiskFactor[];
  explanation: string[];
}

/** One row in the real-time approval console. */
export interface ApprovalConsoleEvent {
  id: string;
  tenantId: string;
  timestamp: string;
  actorId: string;
  actionType: string;
  status: ApprovalStatus;
  assessment?: ConsoleRiskAssessment;
}

/** Severity band for UI styling (colour, icon, animation). */
export type Severity = "info" | "warn" | "critical";

/** Human-readable explainability block ready for console rendering. */
export interface ExplainabilityOutput {
  headline: string;
  scoreLine: string;
  factors: Array<{
    factor: string;
    contribution: number;
    detail: string;
    severity: Severity;
  }>;
  footer: string;
}
