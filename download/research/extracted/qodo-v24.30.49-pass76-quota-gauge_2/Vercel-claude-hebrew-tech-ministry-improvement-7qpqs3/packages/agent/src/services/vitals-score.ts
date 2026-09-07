/**
 * Vitals Score (U4) — single composite repo health signal.
 *
 * Rolls up trend forecast, confidence calibration, open Sentry count,
 * SLO tracker, and recent gate outcomes into one 0–100 number and a
 * human-readable trend label. Displayed in Mission Control as the one
 * number a team lead can glance at.
 */
import { log } from "./logger.js";
import type { RedisState } from "./redis-state.js";
import type { Telemetry } from "./telemetry.js";

export interface VitalsInput {
  /** 0-100 confidence calibration score for the last 30 days. */
  calibrationScore?: number;
  /** Count of open Sentry issues. */
  openSentryIssues?: number;
  /** 0-1 SLO health ratio. */
  sloHealth?: number;
  /** Recent run success rate (0-1). */
  recentSuccessRate?: number;
  /** Trend label from code-health forecaster. */
  forecastTrend?: "improving" | "stable" | "degrading" | "unknown";
  /** Count of unresolved critical/high CVEs. */
  criticalCveCount?: number;
}

export interface VitalsScore {
  score: number; // 0-100
  trend: "improving" | "stable" | "degrading" | "unknown";
  label: "healthy" | "attention" | "critical";
  components: Record<string, number>;
  summary: string;
}

const WEIGHTS = {
  calibration: 0.25,
  sentry: 0.20,
  slo: 0.20,
  successRate: 0.20,
  forecast: 0.10,
  cve: 0.05,
};

function forecastScore(forecast?: VitalsInput["forecastTrend"]): number {
  switch (forecast) {
    case "improving": return 100;
    case "stable": return 60;
    case "degrading": return 40;
    default: return 55;
  }
}

function sentryScore(count: number): number {
  if (count === 0) return 100;
  if (count <= 2) return 85;
  if (count <= 5) return 70;
  if (count <= 10) return 50;
  return 30;
}

function cveScore(count: number): number {
  if (count === 0) return 100;
  if (count <= 2) return 80;
  if (count <= 5) return 60;
  return 30;
}

/** Compute a single vitals score from available signals. */
export function computeVitals(input: VitalsInput): VitalsScore {
  const calibration = Math.min(100, Math.max(0, input.calibrationScore ?? 70));
  const sentry = sentryScore(input.openSentryIssues ?? 0);
  const slo = Math.min(100, Math.max(0, (input.sloHealth ?? 1) * 100));
  const success = Math.min(100, Math.max(0, (input.recentSuccessRate ?? 0.8) * 100));
  const forecast = forecastScore(input.forecastTrend);
  const cve = cveScore(input.criticalCveCount ?? 0);

  const score = Math.round(
    calibration * WEIGHTS.calibration +
    sentry * WEIGHTS.sentry +
    slo * WEIGHTS.slo +
    success * WEIGHTS.successRate +
    forecast * WEIGHTS.forecast +
    cve * WEIGHTS.cve,
  );

  let trend: VitalsScore["trend"];
  if (input.forecastTrend) trend = input.forecastTrend;
  else if ((input.recentSuccessRate ?? 0) > 0.9) trend = "stable";
  else if ((input.recentSuccessRate ?? 0) < 0.6) trend = "degrading";
  else trend = "unknown";

  let label: VitalsScore["label"];
  if (score >= 80) label = "healthy";
  else if (score >= 55) label = "attention";
  else label = "critical";

  const summary = label === "healthy"
    ? `Repo vitals are healthy (${score}). Recent success rate and SLO health are strong.`
    : label === "attention"
      ? `Repo vitals need attention (${score}). Open Sentry issues or CVEs are weighing the score down.`
      : `Repo vitals are critical (${score}). Multiple risk signals are elevated; review recommended.`;

  return {
    score,
    trend,
    label,
    components: { calibration, sentry, slo, success, forecast, cve },
    summary,
  };
}

const VITALS_KEY_PREFIX = "qodo:v24:vitals-score";

function vitalsKey(owner: string, repo: string) {
  return `${VITALS_KEY_PREFIX}:${owner}:${repo}`;
}

/** Persist and emit telemetry for the vitals score. */
export async function recordVitals(
  owner: string,
  repo: string,
  input: VitalsInput,
  state: RedisState,
  telemetry?: Telemetry,
): Promise<VitalsScore> {
  const score = computeVitals(input);
  await state.setJSONWithTTL(vitalsKey(owner, repo), { ...score, recordedAt: new Date().toISOString() }, 7 * 24 * 60 * 60);
  log.info("vitals-score: recorded", { owner, repo, score: score.score, label: score.label });
  await telemetry?.decision("vitals-score", "recorded", {
    owner,
    repo,
    score: score.score,
    label: score.label,
    trend: score.trend,
  });
  return score;
}

/** Load the latest recorded vitals score. */
export async function loadVitals(owner: string, repo: string, state: RedisState): Promise<VitalsScore | null> {
  return state.getJSON<VitalsScore>(vitalsKey(owner, repo));
}
