/**
 * actions.ts — the mobile app's single write path. Routes every action to
 * the sandbox engine or the live proxy based on the active mode, and
 * registers the sandbox-aware telemetry source. Imported only by the
 * mobile bundle — the desktop cockpit keeps its direct utils.
 */
import { httpTelemetryFetcher, setTelemetryFetcher } from "../context/TelemetryContext.js";
import { postDispatch } from "../utils/dispatch.js";
import { postMentorDecision, type PendingApproval } from "../utils/mentor.js";
import { getProxyUrl } from "../utils/proxy-config.js";
import { isSandboxActive } from "./sandbox/mode.js";
import { sandboxDecide, sandboxDispatch, sandboxGetEvents } from "./sandbox/engine.js";

// Register the mobile telemetry source once, at module import.
setTelemetryFetcher(async (limit) => {
  if (isSandboxActive()) return sandboxGetEvents().slice(0, limit);
  return httpTelemetryFetcher(limit);
});

/** Dispatch a mission — simulated in sandbox, workflow_dispatch when live. */
export async function dispatchMission(objective: string, repo: string): Promise<{ sandbox: boolean }> {
  if (isSandboxActive()) {
    sandboxDispatch(objective.trim(), repo.trim());
    return { sandbox: true };
  }
  await postDispatch(getProxyUrl(), objective, repo);
  return { sandbox: false };
}

/** Answer a mentor gate — engine in sandbox, Redis (via proxy) when live. */
export async function decideMentor(
  approval: PendingApproval,
  status: "approved" | "rejected",
  reason?: string,
): Promise<void> {
  if (isSandboxActive()) {
    sandboxDecide(approval.runId, status, reason);
    return;
  }
  await postMentorDecision(getProxyUrl(), approval, status, reason);
}
