/**
 * frontend/risk-intelligence/attribution.ts — Factor-attribution engine over the fusion risk model.
 *
 * Converts raw signed contributions into ranked, percentage-based attribution
 * so compliance and ops can read *why* a score was assigned. Deterministic,
 * pure, zero external dependencies.
 */

import type { FactorAttribution, AttributionReport, ComplianceNarrative, Severity } from "./types.ts";

/** Thresholds aligned with the behavioural point system in lib/risk/risk-intelligence.ts. */
export function factorSeverity(absContribution: number): Severity {
  if (absContribution >= 25) return "critical";
  if (absContribution >= 12) return "warn";
  return "info";
}

/**
 * Compute ranked factor attribution from a fused risk assessment.
 *
 * Each factor's percentage is its share of the *total absolute* contribution,
 * so positive (risk-adding) and negative (trust-reducing) factors both receive
 * visible weight and the report always sums to 100 %.
 *
 * fail-closed: null / non-object input throws; missing or malformed riskScore throws.
 */
export function computeFactorAttribution(input: unknown): AttributionReport {
  if (!input || typeof input !== "object") {
    throw new Error("computeFactorAttribution: input must be an object");
  }
  const obj = input as Record<string, unknown>;

  if (
    typeof obj.riskScore !== "number" ||
    !Number.isFinite(obj.riskScore)
  ) {
    throw new Error("computeFactorAttribution: riskScore must be a finite number");
  }

  const rawFactors = Array.isArray(obj.factors) ? obj.factors : [];
  const validatedFactors: Array<{ factor: string; contribution: number; detail: string }> = [];
  for (const f of rawFactors) {
    if (f && typeof f === "object" && typeof (f as Record<string, unknown>).factor === "string") {
      validatedFactors.push({
        factor: String((f as Record<string, unknown>).factor),
        contribution: Number((f as Record<string, unknown>).contribution ?? 0),
        detail: String((f as Record<string, unknown>).detail ?? ""),
      });
    }
  }

  const totalAbs = validatedFactors.reduce((sum, f) => sum + Math.abs(f.contribution), 0);

  const ranked: FactorAttribution[] = validatedFactors
    .map((f) => ({
      factor: f.factor,
      contribution: f.contribution,
      absContribution: Math.abs(f.contribution),
      percentage: totalAbs > 0 ? Math.round((Math.abs(f.contribution) / totalAbs) * 1000) / 10 : 0,
      rank: 0,
      severity: factorSeverity(Math.abs(f.contribution)),
      detail: f.detail,
    }))
    .sort((a, b) => b.absContribution - a.absContribution)
    .map((f, i) => ({ ...f, rank: i + 1 }));

  const contextualCount = ranked.filter((f) => f.factor.startsWith("behavioural:")).length;
  const reputationBand =
    typeof obj.reputationBand === "string" ? obj.reputationBand : null;

  return {
    riskScore: obj.riskScore,
    baseApprovalClass: String(obj.baseApprovalClass ?? ""),
    effectiveApprovalClass: String(obj.effectiveApprovalClass ?? ""),
    escalated: Boolean(obj.escalated),
    totalAbsContribution: totalAbs,
    factors: ranked,
    topFactor: ranked[0] ?? null,
    contextualCount,
    reputationBand,
  };
}

/**
 * Build a compliance-ready narrative from an attribution report.
 *
 * Answers: "What happened?" "Why was it risky?" "What should we do?"
 */
export function buildComplianceNarrative(report: AttributionReport): ComplianceNarrative {
  if (!report || typeof report !== "object") {
    throw new Error("buildComplianceNarrative: report must be an object");
  }

  const { escalated, effectiveApprovalClass, baseApprovalClass, riskScore, topFactor, factors, contextualCount, reputationBand } = report;

  // Summary
  let summary: string;
  if (escalated) {
    summary = `Escalated from ${baseApprovalClass} to ${effectiveApprovalClass} with risk score ${Math.round(riskScore)}/100.`;
  } else {
    summary = `No escalation — ${effectiveApprovalClass} with risk score ${Math.round(riskScore)}/100.`;
  }

  // Why risky
  const citations: string[] = [];
  const parts: string[] = [];

  if (topFactor) {
    citations.push(topFactor.factor);
    parts.push(`Primary driver: ${topFactor.factor} (${topFactor.percentage} % impact, ${topFactor.severity}).`);
  }

  if (contextualCount > 0) {
    parts.push(`${contextualCount} contextual signal(s) elevated the behavioural score.`);
  }

  if (reputationBand && reputationBand !== "trusted" && reputationBand !== "normal") {
    parts.push(`Actor reputation band is "${reputationBand}", adding review overhead.`);
    citations.push(`reputation:${reputationBand}`);
  }

  if (factors.length === 0) {
    parts.push("No risk factors were recorded for this assessment.");
  }

  const whyRisky = parts.join(" ") || "No risk drivers identified.";

  // Recommended action
  let recommendedAction: string;
  if (effectiveApprovalClass === "deny") {
    recommendedAction = "Deny the action and file a security review.";
  } else if (effectiveApprovalClass === "threshold_escrow") {
    recommendedAction = "Require multi-party threshold approval before release.";
  } else if (effectiveApprovalClass === "human" || effectiveApprovalClass === "opa_check") {
    recommendedAction = "Route to human reviewer with attached factor citation sheet.";
  } else {
    recommendedAction = "Standard automated processing; retain attribution record for audit.";
  }

  return { summary, whyRisky, recommendedAction, citations };
}
