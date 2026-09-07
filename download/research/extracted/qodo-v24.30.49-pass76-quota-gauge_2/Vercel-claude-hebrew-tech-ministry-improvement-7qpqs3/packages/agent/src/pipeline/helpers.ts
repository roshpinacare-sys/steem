/**
 * Shared helpers for the pipeline orchestrator and its phase handlers.
 * Extracted verbatim from cli.ts during the runPipeline decomposition —
 * behavior is unchanged; only the module boundary is new.
 */
import { GitHubClient } from "../services/github-client.js";
import { RedisState } from "../services/redis-state.js";
import { Telemetry } from "../services/telemetry.js";
import { appendAuditEntry } from "../services/audit-log.js";
import { resolveRelayLineage } from "./relay-lineage.js";
import { mutatePrompt, rollbackLastMutation } from "../agents/meta-agent.js";
import { AIContractError } from "../utils/schema-validator.js";
import { log } from "../services/logger.js";
import type { RunState, GateResult } from "../types/run-state.js";
import type { FragmentResult } from "../services/edge-fragment.js";
import type { RouterEnv } from "../services/ai-router.js";

// Workspace root defaults to the process cwd for all entry points;
// QODO_WORKSPACE_ROOT overrides it (containers running from /, tests
// isolating audit-log writes to a temp dir).
export const WORKSPACE_ROOT = process.env.QODO_WORKSPACE_ROOT || process.cwd();

/** Append an audit-log entry best-effort. Sync fs is acceptable because
 *  the entry is tiny and the file is append-only. `genesis` (task-56) only
 *  affects the very first entry ever written to this chain — a run with no
 *  `.relay-parent-receipt.json` resolves to the same all-zero constant this
 *  always used, so this line changes nothing for a standalone run. */
export function audit(runId: string, event: string, payload: Record<string, unknown> = {}): void {
  try {
    const { genesis } = resolveRelayLineage(WORKSPACE_ROOT);
    appendAuditEntry(WORKSPACE_ROOT, event, runId || "qodo-agent", payload, genesis);
  } catch {
    // Audit logging must never block the pipeline.
  }
}

export const EDGE_FRAGMENT_THRESHOLD = 50_000;

export function splitRepo(repoSlug?: string, fallbackRepo = ""): [string, string] {
  const [owner, repo] = (repoSlug || fallbackRepo || "/").split("/");
  return [owner || "", repo || ""];
}

function stateKey(owner: string, repo: string, prNumber: number): string {
  return `qodo:v24:run:${owner}:${repo}:${prNumber}`;
}

function freshState(runId: string, owner: string, repo: string, objective: string, prNumber: number, prSha: string): RunState {
  return {
    runId,
    objective,
    prNumber,
    prSha,
    owner,
    repo,
    phase: "idle",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** Convert an edge-fragment result into a compact file summary for the Coder. */
export function fragmentSummary(path: string, fragment: FragmentResult): string {
  return [
    `// [EDGE-FRAGMENT SUMMARY] ${path} (file too large for full inline context)`,
    "// Exports:", ...fragment.exports.map((e) => `//   - ${e}`),
    "// Imports:", ...fragment.imports.map((i) => `//   - ${i}`),
    "// Environment references:", ...fragment.envRefs.map((v) => `//   - ${v}`),
  ].join("\n");
}

export async function loadOrCreateState(
  state: RedisState,
  owner: string,
  repo: string,
  runId: string,
  objective: string,
  prNumber: number,
  prSha: string,
): Promise<RunState> {
  const existing = await state.getJSON<RunState>(stateKey(owner, repo, prNumber));
  if (existing) {
    log.info("resuming existing run", { runId: existing.runId, phase: existing.phase });
    return existing;
  }
  const s = freshState(runId, owner, repo, objective, prNumber, prSha);
  await state.setJSON(stateKey(owner, repo, prNumber), s);
  log.info("checkpoint saved", { phase: s.phase });
  return s;
}

export async function saveCheckpoint(owner: string, repo: string, prNumber: number, state: RedisState, s: RunState) {
  s.updatedAt = new Date().toISOString();
  await state.setJSON(stateKey(owner, repo, prNumber), s);
  log.info("checkpoint saved", { phase: s.phase });
}

export async function clearState(owner: string, repo: string, prNumber: number, state: RedisState) {
  await state.delete(stateKey(owner, repo, prNumber));
  log.info("run state cleared");
}

export async function runGuarded<T extends GateResult>(
  name: string,
  fn: () => Promise<T>,
  telemetry?: Telemetry,
): Promise<T> {
  try {
    const result = await fn();
    await telemetry?.decision("gate", `${name}-result`, { allowed: result.allowed });
    return result;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error(`validator threw`, { validator: name, error: msg });
    await telemetry?.decision("gate", `${name}-error`, { error: msg });
    return { allowed: false, error: msg } as unknown as T;
  }
}

export async function waitForMentorApproval(
  state: RedisState,
  owner: string,
  repo: string,
  prNumber: number,
  env: { QODO_MENTOR_MODE: string },
  telemetry: Telemetry | undefined,
  runId: string,
): Promise<void> {
  if (env.QODO_MENTOR_MODE !== "true") return;
  const key = `qodo:v24:mentor:${owner}:${repo}:${prNumber}`;
  const timeoutMs = 30 * 60 * 1000;
  const pollMs = 3000;
  const startedAt = Date.now();
  // owner/repo/prNumber ride along so a UI reading this event can construct
  // the decision (POST /mentor/decision on the telemetry proxy writes the
  // exact key polled below) — without them the approval loop is un-closable
  // from the outside.
  await telemetry?.decision("mentor", "pre-commit-pause", { status: "waiting", owner, repo, prNumber });
  while (Date.now() - startedAt < timeoutMs) {
    const decision = await state.getJSON<{ status: "approved" | "rejected"; reason?: string }>(key);
    if (decision?.status === "approved") {
      await telemetry?.decision("mentor", "pre-commit-approved", {});
      audit(runId, "mentor-pre-commit-approved", { owner, repo, prNumber });
      return;
    }
    if (decision?.status === "rejected") {
      await telemetry?.decision("mentor", "pre-commit-rejected", { reason: decision.reason });
      audit(runId, "mentor-pre-commit-rejected", { owner, repo, prNumber, reason: decision.reason });
      throw new Error(`Mentor rejected the Ghost Commit: ${decision.reason || "no reason"}`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error("Mentor approval timed out after 30 minutes");
}

export async function runWithMutationRetry<T>(
  agent: "architect" | "coder" | "reviewer",
  fn: () => Promise<T>,
  owner: string,
  repo: string,
  state: RedisState,
  telemetry: Telemetry | undefined,
  gh: GitHubClient, // V24 audit fix: threaded through so mutatePrompt can open its review PR
  env: RouterEnv,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AIContractError) {
      await mutatePrompt(agent, e.failure, state, telemetry, owner, repo, gh, env);
      try {
        return await fn();
      } catch (e2) {
        await rollbackLastMutation(agent, state, telemetry, owner, repo);
        throw e2;
      }
    }
    throw e;
  }
}
