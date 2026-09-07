/**
 * supervisor.ts — I1: Mission Supervisor Agent (fast-path router).
 *
 * Every incoming objective passes through the Supervisor before any LLM call.
 * It classifies the objective, consults the priority queue (I2) and quota
 * guardian (H1), then routes to one of two pipeline variants:
 *
 *   FAST PATH  (cosmetic / low)   — skip heavy validators, cheaper LLM tier
 *   FULL PATH  (medium+)          — standard 11-phase pipeline
 *   MENTOR PATH (security / arch) — full pipeline + mandatory Mentor Mode pause
 *
 * DESIGN INVARIANTS
 * - Supervisor never changes the objective string or plan — routing only.
 * - Privacy mode: no external calls; all decisions are local.
 * - All outputs are typed; no `any`.
 */

import type { RedisState } from "../services/redis-state.js";
import type { Telemetry } from "../services/telemetry.js";
import { log } from "../services/logger.js";
import {
  classifyObjectiveComplexity,
  type ComplexityTier,
  type UrgencyLevel,
  type ImpactLevel,
} from "../services/mission-priority.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PipelineVariant = "fast" | "full" | "mentor";

export interface SupervisorDecision {
  /** Which pipeline variant to run. */
  variant: PipelineVariant;
  /** Complexity tier the classifier assigned. */
  complexity: ComplexityTier;
  /**
   * Whether to skip the heavy validators (dom-xray, shadow-traffic)
   * on the fast path to shorten wall-clock time.
   */
  skipHeavyValidators: boolean;
  /**
   * LLM tier override: "fast" forces cheap/local tier for the coder phase;
   * null means use the router's default heuristic.
   */
  coderTierOverride: "fast" | null;
  /** Whether the pipeline should pause at Mentor gate regardless of env flag. */
  forceMentorMode: boolean;
  /** Human-readable rationale (written to rationale bank / telemetry). */
  rationale: string;
}

export interface SupervisorInput {
  objective: string;
  /** Optional urgency hint from Sentry/Dependabot severity. */
  urgency?: UrgencyLevel;
  /** Optional impact hint from ticket priority. */
  impact?: ImpactLevel;
  /** Whether QODO_MENTOR_MODE is already enabled in env. */
  mentorModeEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// Core decision logic
// ---------------------------------------------------------------------------

/**
 * Classify the objective and return a routing decision.
 * No I/O — purely synchronous classification.
 */
export function supervisorDecide(input: SupervisorInput): SupervisorDecision {
  const complexity = classifyObjectiveComplexity(input.objective);

  // Security and architecture objectives always route through the full pipeline
  // and force Mentor Mode to ensure a human reviews the plan.
  if (complexity === "security" || complexity === "architecture") {
    return {
      variant: "mentor",
      complexity,
      skipHeavyValidators: false,
      coderTierOverride: null,
      forceMentorMode: true,
      rationale: `Objective classified as '${complexity}' — full pipeline + mandatory Mentor Mode to prevent unchecked high-risk changes.`,
    };
  }

  // High-impact or high-urgency objectives run the full pipeline.
  if (
    complexity === "high" ||
    input.urgency === "critical" ||
    input.urgency === "high" ||
    input.impact  === "critical" ||
    input.impact  === "high"
  ) {
    return {
      variant: "full",
      complexity,
      skipHeavyValidators: false,
      coderTierOverride: null,
      forceMentorMode: input.mentorModeEnabled ?? false,
      rationale: `Objective classified as '${complexity}' (urgency=${input.urgency ?? "none"}, impact=${input.impact ?? "none"}) — full 11-phase pipeline.`,
    };
  }

  // Cosmetic and low-risk objectives run the fast path.
  if (complexity === "cosmetic" || complexity === "low") {
    return {
      variant: "fast",
      complexity,
      skipHeavyValidators: true,
      coderTierOverride: "fast",
      forceMentorMode: false,
      rationale: `Objective classified as '${complexity}' — fast path: skip heavy validators, use cheap LLM tier.`,
    };
  }

  // Medium: full pipeline, no Mentor override.
  return {
    variant: "full",
    complexity,
    skipHeavyValidators: false,
    coderTierOverride: null,
    forceMentorMode: input.mentorModeEnabled ?? false,
    rationale: `Objective classified as '${complexity}' — standard full pipeline.`,
  };
}

// ---------------------------------------------------------------------------
// Supervisor run (with telemetry + logging)
// ---------------------------------------------------------------------------

/**
 * Run the supervisor for an incoming objective, emitting telemetry and
 * logging the routing decision.  The returned decision is passed into
 * `runPipeline` to gate validator and LLM tier selection.
 */
export async function runSupervisor(
  input: SupervisorInput,
  _state: RedisState,
  telemetry?: Telemetry,
): Promise<SupervisorDecision> {
  const decision = supervisorDecide(input);

  log.info("supervisor: routing decision", {
    variant: decision.variant,
    complexity: decision.complexity,
    forceMentorMode: decision.forceMentorMode,
    skipHeavyValidators: decision.skipHeavyValidators,
  });

  await telemetry?.decision("supervisor", "routing-decision", {
    variant: decision.variant,
    complexity: decision.complexity,
    urgency: input.urgency ?? "none",
    impact:  input.impact  ?? "none",
    skipHeavyValidators: decision.skipHeavyValidators,
    forceMentorMode: decision.forceMentorMode,
    rationale: decision.rationale,
  });

  return decision;
}
