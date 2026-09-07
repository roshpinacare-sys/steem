/**
 * Uncertainty Sampling (S1) — active-learning review routing.
 *
 * Decides whether an objective should auto-proceed or be routed to Mentor Mode
 * based on signals the agent itself exposes about its own uncertainty:
 *
 * - Multi-model consensus (disagreement among racing providers)
 * - Historical calibration reliability for this category
 * - Confidence score variance across gate validators
 * - Objective complexity / trust-ledger probation status
 *
 * This concentrates human attention where the agent's judgment is least
 * reliable, instead of relying on a flat global threshold.
 */
import { log } from "./logger.js";
import type { Telemetry } from "./telemetry.js";
import type { RedisState } from "./redis-state.js";
import type { TrustCategory } from "./trust-ledger.js";

export interface ModelVote {
  provider: string;
  answer: string; // e.g. "yes" | "no" | JSON-normalized string
  confidence: number; // 0-100
}

export interface UncertaintyInput {
  objective: string;
  category: TrustCategory;
  confidenceScore: number; // 0-100 from confidence-scorer
  modelVotes?: ModelVote[]; // from multi-provider racing
  historicalReliability?: number; // 0-1 for this category
  redTeamHighSeverity?: boolean;
  trustBondScore?: number; // 0-100
}

export interface UncertaintyDecision {
  route: "auto-proceed" | "mentor-mode";
  uncertainty: number; // 0-1
  reason: string;
}

const HISTORICAL_WEIGHT = 0.30;
const CONFIDENCE_WEIGHT = 0.25;
const CONSENSUS_WEIGHT  = 0.25;
const RED_TEAM_WEIGHT   = 0.15;
const TRUST_WEIGHT      = 0.05;

function normalizedAgreement(votes: ModelVote[] | undefined): number {
  if (!votes || votes.length < 2) return 0.5; // unknown = neutral
  const groups = new Map<string, number>();
  for (const v of votes) {
    const key = v.answer.trim().toLowerCase();
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  const maxCount = Math.max(...groups.values());
  return maxCount / votes.length; // 1 = perfect consensus
}

function normalizedConfidenceVariance(votes: ModelVote[] | undefined): number {
  if (!votes || votes.length < 2) return 0;
  const mean = votes.reduce((s, v) => s + v.confidence, 0) / votes.length;
  const variance = votes.reduce((s, v) => s + Math.pow(v.confidence - mean, 2), 0) / votes.length;
  return Math.min(1, variance / 2500); // scaled so 50pt variance ≈ 1.0
}

function consensusUncertainty(votes: ModelVote[] | undefined): number {
  // High when answers disagree OR confidences spread widely.
  const agreement = normalizedAgreement(votes);
  const variance = normalizedConfidenceVariance(votes);
  return (1 - agreement) * 0.7 + variance * 0.3;
}

/**
 * Compute uncertainty and route decision.
 * Higher uncertainty → mentor-mode.
 */
export function sampleUncertainty(input: UncertaintyInput): UncertaintyDecision {
  const historicalReliability = Math.min(1, Math.max(0, input.historicalReliability ?? 0.5));
  const confidenceScore = Math.min(100, Math.max(0, input.confidenceScore));
  const trustBondScore = Math.min(100, Math.max(0, input.trustBondScore ?? 50));

  const historicalUncertainty = 1 - historicalReliability;
  const confidenceUncertainty = 1 - confidenceScore / 100;
  const consensusUncertaintyScore = consensusUncertainty(input.modelVotes);
  const redTeamUncertainty = input.redTeamHighSeverity ? 1.0 : 0.0;
  const trustUncertainty = 1 - trustBondScore / 100;

  const uncertainty =
    historicalUncertainty * HISTORICAL_WEIGHT +
    confidenceUncertainty * CONFIDENCE_WEIGHT +
    consensusUncertaintyScore * CONSENSUS_WEIGHT +
    redTeamUncertainty * RED_TEAM_WEIGHT +
    trustUncertainty * TRUST_WEIGHT;

  const clamped = Math.min(1, Math.max(0, uncertainty));

  // Threshold tuned so genuine model disagreement or red-team findings
  // route to mentor-mode while strong-consensus, high-confidence inputs
  // still auto-proceed.
  if (clamped >= 0.3) {
    return {
      route: "mentor-mode",
      uncertainty: clamped,
      reason: `high uncertainty (${(clamped * 100).toFixed(0)}%): active-learning routing to Mentor Mode`,
    };
  }

  return {
    route: "auto-proceed",
    uncertainty: clamped,
    reason: `low uncertainty (${(clamped * 100).toFixed(0)}%): auto-proceed permitted`,
  };
}

/**
 * Async wrapper that optionally fetches historical reliability from D1 history.
 * Falls back to neutral (0.5) when no history exists.
 */
export async function sampleUncertaintyAsync(
  input: UncertaintyInput,
  state: RedisState,
  telemetry?: Telemetry,
): Promise<UncertaintyDecision> {
  // If historical reliability wasn't provided, try to compute it from
  // the D1 history index for this category.
  if (input.historicalReliability === undefined) {
    try {
      const { queryHistory } = await import("./d1-history.js");
      const runs = await queryHistory("*", "*", { limit: 100 }, state);
      if (runs.length >= 5) {
        const successes = runs.filter((r) => r.outcome === "success").length;
        input.historicalReliability = successes / runs.length;
      }
    } catch {
      // best-effort
    }
  }

  const decision = sampleUncertainty(input);
  log.info("uncertainty-sampling: decision", {
    route: decision.route,
    uncertainty: decision.uncertainty,
    category: input.category,
  });
  await telemetry?.decision("uncertainty-sampling", decision.route, {
    uncertainty: decision.uncertainty,
    category: input.category,
    confidenceScore: input.confidenceScore,
  });
  return decision;
}
