import { estimatePreflight, postPreflightComment } from "../../services/preflight-estimator.js";
import type { RunState } from "../../types/run-state.js";
import { saveCheckpoint } from "../helpers.js";
import type { PhaseContext, PhaseOutcome } from "../context.js";

/**
 * Pass 22 — Pre-flight estimate: post cost + risk summary before any LLM spend.
 * On high-cost/high-risk objectives, this posts a "confirm before proceeding"
 * comment; the pipeline pauses and waits for a "/qodo proceed" webhook event.
 * For all other objectives it auto-proceeds and logs the estimate.
 */
export async function runPreflightPhase(ctx: PhaseContext): Promise<PhaseOutcome> {
  const { s, env, objective, owner, repo, prNumber, runLog, gh, state, telemetry } = ctx;

  if (s.phase === "idle") {
    const preflightEstimate = await postPreflightComment(
      owner, repo, prNumber, objective, state, gh, telemetry, env.QODO_PRIVACY_MODE,
    ).catch(async () =>
      // Best-effort: fall back to a silent in-memory estimate if the comment fails
      estimatePreflight(objective, state, telemetry).catch(() => null),
    );
    if (preflightEstimate?.recommendation === "confirm_before_proceeding") {
      runLog.info("preflight: pausing pipeline for human confirmation", {
        summaryLine: preflightEstimate.summaryLine,
      });
      // Persist phase so the pipeline can resume via a "/qodo proceed" webhook.
      s.phase = "preflight_hold" as RunState["phase"];
      await saveCheckpoint(owner, repo, prNumber, state, s);
      return "halt";
    }
  }
  // If we are resuming after a preflight hold, reset to idle before architect.
  if ((s.phase as string) === "preflight_hold") {
    s.phase = "idle";
  }
  return "continue";
}
