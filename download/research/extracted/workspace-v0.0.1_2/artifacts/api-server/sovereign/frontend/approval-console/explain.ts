/**
 * frontend/approval-console/explain.ts — Risk-factor explainability formatter.
 *
 * Turns machine-readable risk assessments into human-readable console blocks.
 * Zero external dependencies.
 */

import type {
  ConsoleRiskAssessment,
  ConsoleRiskFactor,
  ExplainabilityOutput,
  Severity,
} from "./types.ts";

/**
 * Map a numeric contribution to a severity band.
 *
 * Positive contributions increase risk; negative ones (trusted actor)
 * are informational.  Thresholds chosen to match the behavioural
 * point system in lib/risk/risk-intelligence.ts.
 */
export function factorSeverity(contribution: number): Severity {
  if (contribution >= 25) return "critical";
  if (contribution >= 12) return "warn";
  return "info";
}

/**
 * Format a single risk factor for console display.
 */
export function formatFactor(f: ConsoleRiskFactor): ExplainabilityOutput["factors"][number] {
  return {
    factor: f.factor,
    contribution: f.contribution,
    detail: f.detail,
    severity: factorSeverity(f.contribution),
  };
}

/**
 * Format a complete risk assessment into a console-ready explainability block.
 *
 * fail-closed: unknown/missing input throws so bad data never renders as
 * a quiet green status.
 */
export function formatExplainability(assessment: ConsoleRiskAssessment): ExplainabilityOutput {
  if (!assessment || typeof assessment !== "object") {
    throw new Error("formatExplainability: assessment must be an object");
  }
  if (
    typeof assessment.riskScore !== "number" ||
    !Number.isFinite(assessment.riskScore)
  ) {
    throw new Error("formatExplainability: riskScore must be a finite number");
  }

  const status = assessment.escalated
    ? `${assessment.baseApprovalClass} → ${assessment.effectiveApprovalClass}`
    : assessment.effectiveApprovalClass;

  const headline = `Approval ${status} · risk score ${Math.round(assessment.riskScore)}/100`;

  const scoreLine = assessment.escalated
    ? `Escalated from ${assessment.baseApprovalClass} to ${assessment.effectiveApprovalClass}`
    : `No escalation — base class ${assessment.baseApprovalClass} stands`;

  const factors = assessment.factors.map(formatFactor);

  const criticalCount = factors.filter((f) => f.severity === "critical").length;
  const warnCount = factors.filter((f) => f.severity === "warn").length;

  let footer: string;
  if (criticalCount > 0) {
    footer = `${criticalCount} critical factor(s); immediate review recommended.`;
  } else if (warnCount > 0) {
    footer = `${warnCount} warning(s); monitor closely.`;
  } else {
    footer = "All clear — no risk signals triggered.";
  }

  return { headline, scoreLine, factors, footer };
}

/**
 * Pick a console-friendly status label and colour hint from an approval
 * assessment.  Uses the effective class as the source of truth.
 */
export function statusFromAssessment(
  assessment: ConsoleRiskAssessment,
): { label: string; severity: Severity } {
  const cls = assessment.effectiveApprovalClass;
  if (cls === "deny") return { label: "Denied", severity: "critical" };
  if (cls === "threshold_escrow") return { label: "Escalated", severity: "critical" };
  if (cls === "human") return { label: "Pending Review", severity: "warn" };
  if (cls === "opa_check") return { label: "OPA Check", severity: "info" };
  return { label: "Auto-Approved", severity: "info" };
}
