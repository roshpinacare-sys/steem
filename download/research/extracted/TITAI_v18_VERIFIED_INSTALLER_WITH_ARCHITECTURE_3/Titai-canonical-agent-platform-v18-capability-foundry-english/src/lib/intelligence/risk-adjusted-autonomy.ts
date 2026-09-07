import type { RiskLevel, ToolEffect, ToolIdempotency } from "@/lib/engine/types";

export type AutonomyLevel = "deny" | "human_required" | "supervised" | "autonomous";

export interface AutonomyContext {
  risk: RiskLevel;
  effect: ToolEffect;
  idempotency: ToolIdempotency;
  dryRun: boolean;
  hasHumanApproval: boolean;
  evidenceCompleteness?: number;
  modelConfidence?: number;
  reversible?: boolean;
  externalAuthority?: boolean;
}

export interface AutonomyDecision {
  level: AutonomyLevel;
  score: number;
  reasons: string[];
}

const riskPenalty: Record<RiskLevel, number> = { low: 0.05, medium: 0.3, high: 0.65 };
const effectPenalty: Record<ToolEffect, number> = { read: 0, write: 0.25, external: 0.45 };
const idempotencyPenalty: Record<ToolIdempotency, number> = {
  intrinsic: 0,
  receipt: 0.08,
  reconciliation: 0.25,
};

export function decideRiskAdjustedAutonomy(input: AutonomyContext): AutonomyDecision {
  const reasons: string[] = [];
  if (input.dryRun && input.effect !== "read") {
    return { level: "deny", score: 0, reasons: ["dry_run_side_effect_forbidden"] };
  }
  if (input.externalAuthority) {
    return { level: "deny", score: 0, reasons: ["model_or_memory_cannot_grant_authority"] };
  }

  const evidence = Math.max(0, Math.min(1, input.evidenceCompleteness ?? 0.5));
  const model = Math.max(0, Math.min(1, input.modelConfidence ?? 0.5));
  let score = 1
    - riskPenalty[input.risk]
    - effectPenalty[input.effect]
    - idempotencyPenalty[input.idempotency]
    + evidence * 0.2
    + model * 0.1
    + (input.reversible ? 0.1 : -0.1);
  score = Math.max(0, Math.min(1, score));

  if (input.risk === "high") reasons.push("high_risk_requires_human_authority");
  if (input.effect === "external") reasons.push("external_side_effect");
  if (input.idempotency === "reconciliation") reasons.push("ambiguous_outcome_requires_reconciliation");
  if (!input.reversible && input.effect !== "read") reasons.push("irreversible_side_effect");
  if (evidence < 0.5) reasons.push("insufficient_evidence");
  if (model < 0.5) reasons.push("low_model_confidence");

  if (input.hasHumanApproval) {
    return { level: score >= 0.45 ? "supervised" : "human_required", score, reasons };
  }
  if (
    input.risk === "high"
    || input.effect === "external"
    || input.idempotency === "reconciliation"
    || (!input.reversible && input.effect === "write")
    || score < 0.45
  ) {
    return { level: "human_required", score, reasons };
  }
  if (score < 0.72) return { level: "supervised", score, reasons };
  return { level: "autonomous", score, reasons };
}
