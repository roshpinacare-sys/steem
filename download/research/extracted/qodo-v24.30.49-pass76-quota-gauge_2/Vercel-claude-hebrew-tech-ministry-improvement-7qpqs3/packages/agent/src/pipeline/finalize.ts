import { costTracker } from "../services/ai-router.js";
import { log } from "../services/logger.js";
import { recordOutcome } from "../services/trust-ledger.js";
import { classifyRiskTier, recordPreflightOutcome } from "../services/preflight-estimator.js";
import { saveRunRecord, type RunRecord } from "../services/d1-history.js";
import { recordCost, closeLedger } from "../services/cost-ledger.js";
import { recordVitals } from "../services/vitals-score.js";
import { audit, clearState, saveCheckpoint } from "./helpers.js";
import type { PhaseContext } from "./context.js";

/**
 * Success-path bookkeeping after the reviewer phase: R2-degradation notice,
 * confidence calibration, trust bond, preflight stats, run record, cost
 * ledger, vitals, terminal telemetry, final PR comment, state cleanup.
 */
export async function finalizeRun(ctx: PhaseContext, pipelineStart: number): Promise<void> {
  const { s, objective, owner, repo, prNumber, runId, runLog, gh, state, storage, telemetry, reporter, supervisorDecision, ledgerCategory } = ctx;

  // Bug fix (Pass 3): R2Storage.isDegraded() existed but was never called
  // anywhere in the codebase. On an ephemeral GitHub Actions runner, a
  // degraded-to-local-disk fallback does not survive past this job — so a
  // transient R2 outage silently drops that run's hive-cache, quarantine,
  // and vector-skill-exchange writes with only a console.warn buried in
  // job logs. Surface it somewhere a human will actually see it.
  if (storage.isDegraded()) {
    await telemetry?.decision("r2-storage", "degraded-fallback-used", {
      note: "R2 was unavailable this run; writes fell back to the runner's local disk and will not exist on the next run.",
    });
    await gh.comment(
      prNumber,
      "⚠️ R2 storage was unavailable during this run. Hive-mind cache, quarantine, and vector-skill-exchange writes fell back to the runner's local disk — since GitHub Actions runners are ephemeral, that data will not exist on the next run. Check `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` if this persists.",
    );
  }

  s.phase = "done";
  await saveCheckpoint(owner, repo, prNumber, state, s);

  // J1: Confidence Calibration — record predicted confidence vs actual outcome
  // so the scorer can measure its own accuracy over time.
  const gateConf = (s.gate?.blast as { score?: number } | undefined)?.score ?? 0;
  await telemetry?.decision("confidence-calibration", "run-outcome", {
    runId,
    predictedConfidence: gateConf,
    actualOutcome: "success",
    complexity: supervisorDecision.complexity,
  });

  // V1: Update per-category trust bond on success.
  await recordOutcome(owner, repo, ledgerCategory, true, gateConf * 100, state, telemetry).catch((e: unknown) =>
    log.error("ledger-write-failed", { op: "recordOutcome", runId, outcome: "success", err: e instanceof Error ? e.message : String(e) }),
  );

  // Pass 22 — Record preflight outcome so rolling avg cost + pass-rate stays current.
  await recordPreflightOutcome(
    classifyRiskTier(objective), costTracker.toTelemetryPayload().estimatedUsdCents as number / 100,
    true, state, telemetry,
  ).catch(() => {});

  // C1: Persist structured run record for Darwin / Janitor querying
  const runDuration = Date.now() - pipelineStart;
  const runRecord: RunRecord = {
    id: `${owner}/${repo}/${runId}`,
    runId,
    owner,
    repo,
    objective,
    complexity: supervisorDecision.complexity as import("../services/d1-history.js").RunComplexity,
    outcome: "success",
    durationMs: runDuration,
    coderRetries: 0, // placeholder; real value wired from coder retry count
    wardenRejections: 0,
    gateConfidence: gateConf,
    targetFiles: s.patch?.files.map((f) => f.path) ?? [],
    recordedAt: new Date().toISOString(),
  };
  await saveRunRecord(runRecord, state, storage, telemetry);

  // P1: Close the per-objective cost ledger, copying all recorded costs.
  for (const entry of costTracker.breakdown()) {
    await recordCost(owner, repo, runId, entry, state).catch((e: unknown) =>
      log.error("ledger-write-failed", { op: "recordCost", runId, provider: entry.provider, model: entry.model, err: e instanceof Error ? e.message : String(e) }),
    );
  }
  await closeLedger(owner, repo, runId, state, storage, telemetry).catch((e: unknown) =>
    log.error("ledger-write-failed", { op: "closeLedger", runId, outcome: "success", err: e instanceof Error ? e.message : String(e) }),
  );

  // U4: Record a single composite vitals score for Mission Control.
  try {
    const recent = await import("../services/d1-history.js").then((m) =>
      m.queryHistory(owner, repo, { limit: 30 }, state),
    );
    const successRate = recent.length ? recent.filter((r) => r.outcome === "success").length / recent.length : 0.8;
    await recordVitals(
      owner,
      repo,
      {
        calibrationScore: gateConf * 100,
        recentSuccessRate: successRate,
        forecastTrend: successRate > 0.9 ? "stable" : successRate < 0.6 ? "degrading" : "unknown",
      },
      state,
      telemetry,
    );
  } catch {
    // best-effort
  }

  // Bug fix: `s.phase = "done"` above only updates the Redis-persisted
  // RunState checkpoint — it was never pushed to the telemetry event
  // stream that Mission Control's RunHistory/DecisionTimeline panels
  // actually read. Without this, no run could ever be observed completing
  // successfully in the UI; every run appeared stuck at "in-progress"
  // forever regardless of outcome. This is the one terminal signal the
  // frontend needs to tell "finished" apart from "still running".
  await telemetry.decision("run", "done", { prNumber, commitSha: s.commitSha });
  audit(runId, "run-done", { prNumber, commitSha: s.commitSha, durationMs: Date.now() - pipelineStart });

  // Emit cost-summary telemetry so Mission Control RunHistory can display
  // token usage and estimated cost for this run.
  await telemetry.push({ phase: "cost-summary", ...costTracker.toTelemetryPayload() });

  // Final threaded PR comment with cost summary
  const costPayload = costTracker.toTelemetryPayload();
  await reporter.report(s, {
    cost: {
      totalTokens:  (costPayload.totalTokens  as number) ?? 0,
      estimatedUsd: ((costPayload.estimatedUsdCents as number) ?? 0) / 100,
      breakdown:    {} as Record<string, { tokens: number; usd: number }>,
    },
  });

  await clearState(owner, repo, prNumber, state);
  runLog.info("pipeline complete", { phase: "done", prNumber });
}
