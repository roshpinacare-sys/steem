/**
 * mission-priority.ts — I2: Priority-scored mission queue.
 *
 * Scores every queued objective by:
 *   score = (business_impact × urgency) / estimated_effort
 *
 * where:
 *   business_impact — derived from ticket priority label or PostHog funnel weight
 *   urgency         — derived from Sentry/Dependabot severity
 *   estimated_effort — derived from objective complexity classifier tier
 *
 * Objectives are processed in score order (highest first), not FIFO,
 * so a critical security fix never sits behind five cosmetic PRs.
 *
 * DESIGN INVARIANTS
 * - Pure scoring logic; no I/O except Redis queue operations.
 * - All inputs are optional/defaulted — always produces a valid score.
 * - Privacy mode: no external calls; scores are computed from local signals only.
 */

import type { RedisState } from "./redis-state.js";
import type { Telemetry } from "./telemetry.js";
import { log } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ComplexityTier = "cosmetic" | "low" | "medium" | "high" | "security" | "architecture";
export type UrgencyLevel   = "none" | "low" | "medium" | "high" | "critical";
export type ImpactLevel    = "none" | "low" | "medium" | "high" | "critical";

export interface MissionMeta {
  /** Unique mission identifier (e.g. `owner/repo#prNumber`). */
  id: string;
  /** The raw objective string. */
  objective: string;
  /** Assigned complexity tier (from objective classifier or heuristic). */
  complexity: ComplexityTier;
  /** Urgency derived from Sentry severity / Dependabot alert level. */
  urgency: UrgencyLevel;
  /** Business impact from ticket priority / PostHog funnel weight. */
  impact: ImpactLevel;
  /** ISO timestamp when the mission was enqueued. */
  enqueuedAt: string;
}

export interface ScoredMission extends MissionMeta {
  score: number;
}

// ---------------------------------------------------------------------------
// Scoring tables
// ---------------------------------------------------------------------------

const IMPACT_WEIGHT: Record<ImpactLevel, number> = {
  none:     1,
  low:      2,
  medium:   4,
  high:     8,
  critical: 16,
};

const URGENCY_WEIGHT: Record<UrgencyLevel, number> = {
  none:     1,
  low:      2,
  medium:   4,
  high:     8,
  critical: 16,
};

/** Effort estimate: higher tier → more effort → lower score. */
const EFFORT_WEIGHT: Record<ComplexityTier, number> = {
  cosmetic:     1,
  low:          2,
  medium:       4,
  high:         8,
  security:     6,   // security is high-value so partially offset effort
  architecture: 10,
};

const REDIS_QUEUE_KEY = "qodo:v24:mission-queue";

// ---------------------------------------------------------------------------
// Core scoring
// ---------------------------------------------------------------------------

/**
 * Compute a priority score for a mission.
 * Higher = process sooner.
 */
export function scoreMission(meta: MissionMeta): number {
  const impact  = IMPACT_WEIGHT[meta.impact]  ?? 1;
  const urgency = URGENCY_WEIGHT[meta.urgency] ?? 1;
  const effort  = EFFORT_WEIGHT[meta.complexity] ?? 4;
  return (impact * urgency) / effort;
}

// ---------------------------------------------------------------------------
// Queue operations (Redis-backed)
// ---------------------------------------------------------------------------

/**
 * Enqueue a mission. The queue is a Redis list of JSON-encoded ScoredMission
 * items; it is re-sorted on every read (list is short in practice — typically
 * < 100 items — so linear sort is fine).
 */
export async function enqueueMission(
  meta: MissionMeta,
  state: RedisState,
  telemetry?: Telemetry,
): Promise<ScoredMission> {
  const scored: ScoredMission = { ...meta, score: scoreMission(meta) };

  try {
    const queue = await loadQueue(state);
    // Replace if already present (idempotent re-enqueue)
    const filtered = queue.filter((m) => m.id !== meta.id);
    filtered.push(scored);
    await state.set(REDIS_QUEUE_KEY, JSON.stringify(filtered));
    await telemetry?.decision("mission-priority", "enqueued", { id: meta.id, score: scored.score, complexity: meta.complexity });
    log.info("mission-priority: enqueued", { id: meta.id, score: scored.score });
  } catch (e: unknown) {
    log.warn("mission-priority: failed to enqueue", { id: meta.id, error: e instanceof Error ? e.message : String(e) });
  }

  return scored;
}

/**
 * Dequeue the highest-priority mission and return it.
 * Returns null when the queue is empty.
 */
export async function dequeueMission(
  state: RedisState,
  telemetry?: Telemetry,
): Promise<ScoredMission | null> {
  try {
    const queue = await loadQueue(state);
    if (queue.length === 0) return null;

    // Sort descending by score, then FIFO by enqueuedAt on ties
    queue.sort((a, b) => b.score - a.score || a.enqueuedAt.localeCompare(b.enqueuedAt));
    const [top, ...rest] = queue;
    await state.set(REDIS_QUEUE_KEY, JSON.stringify(rest));
    await telemetry?.decision("mission-priority", "dequeued", { id: top.id, score: top.score });
    return top;
  } catch (e: unknown) {
    log.warn("mission-priority: failed to dequeue", { error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/**
 * Peek at the full sorted queue without modifying it.
 */
export async function peekQueue(state: RedisState): Promise<ScoredMission[]> {
  const queue = await loadQueue(state);
  return queue.sort((a, b) => b.score - a.score || a.enqueuedAt.localeCompare(b.enqueuedAt));
}

/**
 * Remove a mission by ID (e.g. after it has been started externally).
 */
export async function removeMission(id: string, state: RedisState): Promise<void> {
  try {
    const queue = await loadQueue(state);
    const filtered = queue.filter((m) => m.id !== id);
    await state.set(REDIS_QUEUE_KEY, JSON.stringify(filtered));
  } catch {
    // Best-effort
  }
}

// ---------------------------------------------------------------------------
// Complexity classifier heuristic
// ---------------------------------------------------------------------------

/**
 * Classify an objective string into a complexity tier using keyword heuristics.
 * The supervisor agent (I1) calls this before full pipeline dispatch.
 */
export function classifyObjectiveComplexity(objective: string): ComplexityTier {
  const lower = objective.toLowerCase();

  // Security patterns
  if (/\b(cve|vuln|security|auth|authz|authentication|authorization|xss|sqli|injection|secret|token|encrypt|credential)\b/.test(lower)) {
    return "security";
  }
  // Architecture patterns
  if (/\b(refactor|architect|schema|migration|database|infra|infrastructure|redesign|rearchitect|monorepo|microservice)\b/.test(lower)) {
    return "architecture";
  }
  // High-risk patterns
  if (/\b(api|endpoint|route|payment|billing|checkout|webhook|oauth|permission|role)\b/.test(lower)) {
    return "high";
  }
  // Medium patterns
  if (/\b(feature|implement|add|create|new|update|component|service|hook|util)\b/.test(lower)) {
    return "medium";
  }
  // Low-risk patterns
  if (/\b(bump|upgrade|dependency|dep|package|lock|devdep)\b/.test(lower)) {
    return "low";
  }
  // Cosmetic
  if (/\b(typo|comment|doc|readme|style|format|lint|whitespace|rename|move)\b/.test(lower)) {
    return "cosmetic";
  }

  return "medium"; // safe default
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadQueue(state: RedisState): Promise<ScoredMission[]> {
  try {
    const raw = await state.get(REDIS_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ScoredMission[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e: unknown) {
    log.warn("mission-priority: queue unreadable; treating as empty", {
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}
