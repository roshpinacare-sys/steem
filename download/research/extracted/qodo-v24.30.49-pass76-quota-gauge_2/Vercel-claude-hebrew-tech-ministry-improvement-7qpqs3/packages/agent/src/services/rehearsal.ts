/**
 * rehearsal.ts — the $0 pre-flight. Before a real (paid, destructive) run,
 * execute the ENTIRE real pipeline in-process against the deterministic
 * offline LLM simulator and in-memory adapters — the same machinery as
 * `--eval` — and distill a compact, timestamp-free ENVELOPE of what the
 * mission is expected to do: phases walked, gate verdict, files predicted.
 *
 * The envelope's sha256 is embedded in the run's Verifiable Autonomy Receipt,
 * binding "we simulated first" to the delivery evidence. Rehearsal audit
 * entries land on the SAME chain as the real run — deliberately: the
 * rehearsal is part of the run's recorded history.
 *
 * Env vars mutated for the simulator are snapshotted and restored so the
 * real run that follows sees exactly the operator's environment.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createLocalDeps, type LocalGitHubClient } from "./local/in-memory-adapters.js";
import { runPipeline } from "../pipeline/run-pipeline.js";
import { WORKSPACE_ROOT } from "../pipeline/helpers.js";
import { costTracker } from "./ai-router.js";
import { log } from "./logger.js";
import { canonicalJson, sha256Hex, type RehearsalEnvelope } from "./receipt.js";

/**
 * Audit event → pipeline phase, for the envelope's phase trace. Mentor events
 * are deliberately EXCLUDED: approval provenance already lives in the receipt
 * controls, and its audit timing is not deterministic across identical
 * rehearsals — the envelope must hash stably.
 */
const EVENT_PHASE: Record<string, string> = {
  "run-started": "start",
  "architect-plan-generated": "architect",
  "coder-patch-generated": "coder",
  "gate-evaluated": "gate",
  "commit-created": "commit",
  "budget-halt": "budget-halt",
  "run-done": "done",
  "run-fatal-error": "error",
};

function auditLineCount(): number {
  const p = resolve(WORKSPACE_ROOT, ".audit-log.ndjson");
  if (!existsSync(p)) return 0;
  return readFileSync(p, "utf8").trim().split("\n").filter(Boolean).length;
}

function auditSlice(from: number): Array<{ event: string; payload: Record<string, unknown> }> {
  const p = resolve(WORKSPACE_ROOT, ".audit-log.ndjson");
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, "utf8").trim().split("\n").filter(Boolean).slice(from);
  const out: Array<{ event: string; payload: Record<string, unknown> }> = [];
  for (const line of lines) {
    try { out.push(JSON.parse(line) as { event: string; payload: Record<string, unknown> }); } catch { /* tail */ }
  }
  return out;
}

const MUTATED_ENVS = [
  "QODO_LLM_SIM", "GITHUB_TOKEN", "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN", "REPO", "OBJECTIVE",
] as const;

export async function runRehearsal(
  owner: string,
  repo: string,
  objective: string,
): Promise<RehearsalEnvelope & { envelopeSha256: string }> {
  const saved = new Map<string, string | undefined>();
  for (const k of MUTATED_ENVS) saved.set(k, process.env[k]);

  const llmPath: "simulation" | "ollama" = process.env.OLLAMA_BASE_URL ? "ollama" : "simulation";
  try {
    process.env.QODO_LLM_SIM = llmPath === "ollama" ? "false" : "true";
    process.env.GITHUB_TOKEN ||= "rehearsal-local-token-placeholder";
    process.env.UPSTASH_REDIS_REST_URL ||= "https://rehearsal.local";
    process.env.UPSTASH_REDIS_REST_TOKEN ||= "rehearsal-local-token-placeholder";
    process.env.REPO ||= `${owner}/${repo}`;
    process.env.OBJECTIVE = objective;

    const deps = createLocalDeps(owner, repo, process.cwd());
    // Headless: pre-approve the mentor gate so mentor/manual policies rehearse
    // end-to-end instead of blocking. Recorded in the audit chain as usual.
    await deps.state.setJSON(`qodo:v24:mentor:${owner}:${repo}:1`, {
      status: "approved",
      reason: "rehearsal: automatic pre-approval (simulation only)",
    });

    log.info("rehearsal: starting $0 pre-flight", { owner, repo, objective, llmPath });
    const auditBefore = auditLineCount();
    try {
      await runPipeline({ owner, repo, objective, prNumber: 1, prSha: "rehearsal-sha", ...deps });
    } catch (e: unknown) {
      log.warn("rehearsal: simulated pipeline errored", { error: e instanceof Error ? e.message : String(e) });
    }

    // Distill the envelope from what the rehearsal actually recorded — its
    // own slice of the audit chain plus the in-memory commit log. No
    // timestamps, no runIds: identical rehearsals hash identically.
    const gh = deps.gh as LocalGitHubClient;
    const slice = auditSlice(auditBefore);
    const phasesWalked: string[] = [];
    for (const e of slice) {
      const phase = EVENT_PHASE[e.event];
      if (phase && !phasesWalked.includes(phase)) phasesWalked.push(phase);
    }
    const gateEvent = [...slice].reverse().find((e) => e.event === "gate-evaluated");
    // The CODER patch (the ghost commit) is the prediction. Later commits
    // (astdoc diagrams) embed runId timestamps and are derived artifacts, not
    // predicted change content — including them would break determinism.
    const filesPredicted = [...new Set((gh.committed[0]?.files ?? []).map((f) => f.path))].sort();

    const envelope: RehearsalEnvelope = {
      phasesWalked,
      gateOpen: Boolean((gateEvent?.payload as { gateOpen?: unknown } | undefined)?.gateOpen ?? false),
      filesPredicted,
      llmPath,
    };
    const envelopeSha256 = await sha256Hex(canonicalJson(envelope));
    log.info("rehearsal: envelope distilled", { envelopeSha256, gateOpen: envelope.gateOpen, files: filesPredicted.length });
    return { ...envelope, envelopeSha256 };
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    // The rehearsal spent simulated tokens; the real run must start clean.
    costTracker.reset();
  }
}
