/**
 * preflight-estimator.ts — Pass 22: Pre-flight cost + risk gate.
 *
 * Estimates the cost and risk tier of an objective *before* the architect
 * phase runs, posts a one-line summary as a PR comment, and optionally
 * pauses the pipeline for a human confirmation reply on high-cost/high-risk
 * objectives.
 *
 * DESIGN INVARIANTS
 * - Zero new infra: uses RedisState (history) and GitHubClient (PR comment).
 * - Best-effort only: failures never throw or block the pipeline.
 * - Privacy mode: PR comment is skipped when QODO_PRIVACY_MODE=strict.
 * - After each run, recordOutcome() must be called to keep stats current.
 * - Keyed by risk tier; swap getHistoricalStats() for embedding-nearest-
 *   neighbor against semantic-cache.ts once enough run history exists.
 */

import type { RedisState } from "./redis-state.js";
import type { GitHubClient } from "./github-client.js";
import type { Telemetry } from "./telemetry.js";
import { log } from "./logger.js";
import { getQuotaHealthReport, type QuotaProvider } from "./quota-guardian.js";

// task-47: primary free-tier providers worth surfacing in the preflight
// summary. Deliberately a short, fixed list (not every QuotaProvider) — a
// warning for a rarely-used fallback provider is noise, not signal, in a
// one-line PR comment.
const PRIMARY_QUOTA_PROVIDERS: QuotaProvider[] = ["groq", "openrouter"];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RiskTier = "cosmetic" | "low" | "medium" | "high";

export interface HistoricalStats {
  sampleSize: number;
  avgCostUsd: number;
  /** 0–1 fraction of runs that passed the gate. */
  gatePassRate: number;
}

export interface PreflightEstimate {
  objective: string;
  riskTier: RiskTier;
  estimatedCostUsd: number;
  /** null when fewer than minSampleSizeForConfidence runs have been recorded. */
  estimatedGatePassRate: number | null;
  historicalSampleSize: number;
  recommendation: "proceed" | "proceed_with_caution" | "confirm_before_proceeding";
  summaryLine: string;
  /** task-47: set when a primary provider is near its free-tier quota
   *  before the estimate goes out, so it appears "alongside the existing
   *  USD figures" rather than only surfacing as a mid-run 429. Absent
   *  (undefined) when no primary provider has known-recent quota data —
   *  never fabricated, only reported when quota-guardian actually has data. */
  quotaWarning?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HISTORY_KEY_PREFIX = "qodo:v24:preflight:history:";
const HISTORY_TTL_S = 90 * 24 * 60 * 60; // 90 days

const DEFAULT_COST_USD: Record<RiskTier, number> = {
  cosmetic: 0.05,
  low:      0.15,
  medium:   0.50,
  high:     1.20,
};

// ---------------------------------------------------------------------------
// Heuristic risk classifier
// ---------------------------------------------------------------------------

/**
 * Lightweight keyword classifier.  Replace the body with an ONNX-based
 * Objective Complexity Classifier once the model is bundled.
 */
export function classifyRiskTier(objective: string): RiskTier {
  const text = objective.toLowerCase();
  if (/security|auth|payment|encrypt|token|credential|secret|cve|vulnerability/.test(text)) return "high";
  if (/refactor|migrate|architect|schema|database|upgrade|dependency/.test(text))            return "medium";
  if (/typo|comment|rename|lint|format|whitespace|doc/.test(text))                           return "cosmetic";
  return "low";
}

// ---------------------------------------------------------------------------
// History helpers
// ---------------------------------------------------------------------------

async function getHistoricalStats(tier: RiskTier, state: RedisState): Promise<HistoricalStats> {
  try {
    const raw = await state.get(`${HISTORY_KEY_PREFIX}${tier}`);
    if (raw) return JSON.parse(raw) as HistoricalStats;
  } catch {
    // fall through to default
  }
  return { sampleSize: 0, avgCostUsd: DEFAULT_COST_USD[tier], gatePassRate: 0 };
}

/**
 * Call this in the `done` phase after every run completes, to keep the
 * rolling average cost and pass-rate up to date.
 */
export async function recordPreflightOutcome(
  tier: RiskTier,
  actualCostUsd: number,
  gatePassed: boolean,
  state: RedisState,
  telemetry?: Telemetry,
): Promise<void> {
  try {
    const existing     = await getHistoricalStats(tier, state);
    const n            = existing.sampleSize + 1;
    const newAvgCost   = (existing.avgCostUsd * existing.sampleSize + actualCostUsd) / n;
    const priorPasses  = existing.gatePassRate * existing.sampleSize;
    const newPassRate  = (priorPasses + (gatePassed ? 1 : 0)) / n;

    const updated: HistoricalStats = { sampleSize: n, avgCostUsd: newAvgCost, gatePassRate: newPassRate };
    await state.setWithTTL(`${HISTORY_KEY_PREFIX}${tier}`, JSON.stringify(updated), HISTORY_TTL_S);

    await telemetry?.decision("preflight-estimator", "outcome-recorded", {
      tier, actualCostUsd, gatePassed, sampleSize: n, newAvgCost, newPassRate,
    });
  } catch (e: unknown) {
    log.warn("preflight-estimator: recordOutcome failed (best-effort)", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

// ---------------------------------------------------------------------------
// Core estimation
// ---------------------------------------------------------------------------

const MIN_SAMPLE_SIZE_FOR_CONFIDENCE = 5;
const COST_CONFIRM_THRESHOLD_USD     = 1.00;

/**
 * Estimate cost + risk and decide whether to auto-proceed.
 */
export async function estimatePreflight(
  objective: string,
  state: RedisState,
  telemetry?: Telemetry,
): Promise<PreflightEstimate> {
  const riskTier = classifyRiskTier(objective);
  const stats    = await getHistoricalStats(riskTier, state);

  const hasConfidentData      = stats.sampleSize >= MIN_SAMPLE_SIZE_FOR_CONFIDENCE;
  const estimatedGatePassRate = hasConfidentData ? stats.gatePassRate : null;

  let recommendation: PreflightEstimate["recommendation"] = "proceed";
  if (stats.avgCostUsd >= COST_CONFIRM_THRESHOLD_USD || riskTier === "high") {
    recommendation = "confirm_before_proceeding";
  } else if (riskTier === "medium" || (hasConfidentData && stats.gatePassRate < 0.6)) {
    recommendation = "proceed_with_caution";
  }

  const passRateText = hasConfidentData
    ? `${Math.round(stats.gatePassRate * 100)}% gate pass rate (n=${stats.sampleSize})`
    : `no reliable history yet (n=${stats.sampleSize})`;

  // task-47: check quota headroom on the primary providers alongside the
  // existing USD estimate. Best-effort — a lookup failure or no data at
  // all just means no warning, never a thrown error or a blocked estimate.
  let quotaWarning: string | undefined;
  try {
    const health = await getQuotaHealthReport(PRIMARY_QUOTA_PROVIDERS, state);
    const near = health.filter((h) => h.nearExhaustion);
    if (near.length > 0) {
      quotaWarning = near
        .map((h) => `${h.provider} ${h.percentUsed}% of quota used`)
        .join(", ");
    }
  } catch (e: unknown) {
    log.warn("preflight-estimator: quota health check failed (best-effort)", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
  if (quotaWarning && recommendation === "proceed") {
    // Not urgent enough to demand human confirmation (ai-router.ts already
    // routes around an exhausted provider automatically), but worth a
    // "caution" flag rather than a silent "proceed" the owner never sees.
    recommendation = "proceed_with_caution";
  }

  const summaryLine =
    `Est. cost: $${stats.avgCostUsd.toFixed(2)} | Risk: ${riskTier} | ${passRateText}` +
    (quotaWarning ? ` | ⚠️ ${quotaWarning}` : "");

  const estimate: PreflightEstimate = {
    objective,
    riskTier,
    estimatedCostUsd: stats.avgCostUsd,
    estimatedGatePassRate,
    historicalSampleSize: stats.sampleSize,
    recommendation,
    summaryLine,
    ...(quotaWarning ? { quotaWarning } : {}),
  };

  await telemetry?.decision("preflight-estimator", "estimate-computed", {
    riskTier, recommendation, estimatedCostUsd: stats.avgCostUsd,
  });

  return estimate;
}

// ---------------------------------------------------------------------------
// PR comment
// ---------------------------------------------------------------------------

/**
 * Post a pre-flight estimate as a PR comment and return the estimate so
 * the caller can decide whether to gate on `confirm_before_proceeding`.
 *
 * Skipped silently when privacyMode is "strict" (no external API calls).
 */
export async function postPreflightComment(
  owner: string,
  repo: string,
  prNumber: number,
  objective: string,
  state: RedisState,
  gh: GitHubClient,
  telemetry?: Telemetry,
  privacyMode?: string,
): Promise<PreflightEstimate> {
  const estimate = await estimatePreflight(objective, state, telemetry);

  if (privacyMode === "strict") {
    log.info("preflight-estimator: skipping PR comment (privacy mode strict)");
    return estimate;
  }

  try {
    const emoji =
      estimate.recommendation === "confirm_before_proceeding" ? "⚠️"
      : estimate.recommendation === "proceed_with_caution"    ? "🟡"
      : "✅";

    const body =
      `${emoji} **Qodo pre-flight estimate**\n${estimate.summaryLine}\n\n` +
      (estimate.recommendation === "confirm_before_proceeding"
        ? "_This objective is above the cost/risk threshold for auto-proceed. " +
          "Reply \`/qodo proceed\` to continue, or \`/qodo cancel\` to stop before any LLM spend._"
        : "_Proceeding automatically._");

    await gh.comment(prNumber, body);
    await telemetry?.decision("preflight-estimator", "comment-posted", {
      prNumber, recommendation: estimate.recommendation,
    });
  } catch (e: unknown) {
    // Best-effort: never block the pipeline on a comment failure
    log.warn("preflight-estimator: failed to post PR comment (best-effort)", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return estimate;
}
