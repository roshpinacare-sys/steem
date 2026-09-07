/**
 * mentor.ts — the client half of the mentor-approval loop.
 *
 * The agent's waitForMentorApproval() (packages/agent/src/pipeline/helpers.ts)
 * pauses before the Ghost Commit and polls
 * `qodo:v24:mentor:{owner}:{repo}:{prNumber}` in Redis. Its
 * "pre-commit-pause" telemetry event carries that triple; this module finds
 * the pending pause in the event stream and answers it through the proxy's
 * POST /mentor/decision, which writes the exact key the agent polls.
 */
import type { TelemetryEvent } from "../types/telemetry.js";
import { fetchWithTimeout } from "./fetch-timeout.js";
import { getSessionToken } from "./session.js";

export interface PendingApproval {
  runId: string;
  owner: string;
  repo: string;
  prNumber: number;
  since: string; // ISO timestamp of the pause event
}

const WAIT_WINDOW_MS = 30 * 60 * 1000; // agent gives up after 30 minutes

/**
 * Find a mentor pause that is still waiting for an answer: a
 * "pre-commit-pause" with routing coordinates, newer than any
 * approved/rejected event for the same run, and within the agent's
 * 30-minute wait window.
 */
export function findPendingApproval(events: TelemetryEvent[]): PendingApproval | null {
  let pause: TelemetryEvent | null = null;
  let resolvedAt = 0;

  for (const e of events) {
    if (e.phase !== "mentor") continue;
    if (e.decision === "pre-commit-pause") {
      if (!pause || +new Date(e.timestamp) > +new Date(pause.timestamp)) pause = e;
    } else if (e.decision === "pre-commit-approved" || e.decision === "pre-commit-rejected") {
      resolvedAt = Math.max(resolvedAt, +new Date(e.timestamp));
    }
  }

  if (!pause) return null;
  const pausedAt = +new Date(pause.timestamp);
  if (resolvedAt >= pausedAt) return null;
  if (Date.now() - pausedAt > WAIT_WINDOW_MS) return null;

  const { owner, repo, prNumber } = pause as TelemetryEvent & {
    owner?: string;
    repo?: string;
    prNumber?: number;
  };
  if (!owner || !repo || typeof prNumber !== "number") return null; // pre-wiring agent build

  return { runId: pause.runId, owner, repo, prNumber, since: pause.timestamp };
}

/** Answer a pending approval. Resolves when the proxy has written Redis. */
export async function postMentorDecision(
  proxyUrl: string,
  approval: Pick<PendingApproval, "owner" | "repo" | "prNumber">,
  status: "approved" | "rejected",
  reason?: string,
): Promise<void> {
  const token = await getSessionToken(proxyUrl);
  const r = await fetchWithTimeout(
    `${proxyUrl}/mentor/decision`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Qodo-Session": token },
      body: JSON.stringify({
        owner: approval.owner,
        repo: approval.repo,
        prNumber: approval.prNumber,
        status,
        ...(reason ? { reason } : {}),
      }),
    },
    30_000,
  );
  if (!r.ok) {
    const data = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `mentor decision failed (${r.status})`);
  }
}
