/**
 * pr-reporter.ts — Structured, threaded PR reporting for Qodo V24.
 *
 * Replaces scattered `gh.comment()` calls in cli.ts with a single service
 * that:
 *  - Creates one "anchor" comment per run and threads all subsequent updates
 *    as edits (not new comments), keeping the PR timeline clean.
 *  - Renders structured Markdown sections: phase progress, gate results,
 *    cost summary, canary status, and error details.
 *  - Stores the anchor comment ID in Redis so it survives agent restarts
 *    (resume-on-crash continues editing the same comment).
 *  - Emits telemetry events for every update.
 */

import type { GitHubClient } from "./github-client.js";
import type { RedisState } from "./redis-state.js";
import type { Telemetry } from "./telemetry.js";
import type { RunState } from "../types/run-state.js";
import { log } from "./logger.js";

export interface GateResultSummary {
  lockCheck: { allowed: boolean };
  blast:     { allowed: boolean };
  dom:       { allowed: boolean };
  shadow:    { allowed: boolean };
  chaos:     { allowed: boolean };
  test:      { allowed: boolean };
}

export interface CostSummary {
  totalTokens: number;
  estimatedUsd: number;
  estimatedUsdCents?: number;
  breakdown: Record<string, { tokens: number; usd: number }>;
}

// ---------------------------------------------------------------------------
// Anchor comment key
// ---------------------------------------------------------------------------

function anchorKey(owner: string, repo: string, prNumber: number): string {
  return `qodo:v24:anchor-comment:${owner}:${repo}:${prNumber}`;
}

// ---------------------------------------------------------------------------
// Markdown builders
// ---------------------------------------------------------------------------

function phaseIcon(phase: string): string {
  const icons: Record<string, string> = {
    idle:      "⏳", architect: "🏗️",  coder: "💻",
    gate:      "🚦",  commit:    "📝",  astdoc: "📖",
    canary:    "🐦",  merge:     "🔀",  janitor: "🧹",
    darwin:    "🧬",  sre:       "📡",  done: "✅",
  };
  return icons[phase] ?? "🔄";
}

function renderPhaseProgress(s: RunState): string {
  const phases = ["architect", "coder", "gate", "commit", "astdoc", "canary", "merge", "done"];
  const currentIdx = phases.indexOf(s.phase);
  const rows = phases.map((p, i) => {
    const state = i < currentIdx ? "✅" : i === currentIdx ? phaseIcon(p) : "⬜";
    return `| ${state} | \`${p}\` |`;
  });
  return `### ${phaseIcon(s.phase)} Pipeline Progress\n\n| | Phase |\n|---|---|\n${rows.join("\n")}`;
}

function renderGate(gate: GateResultSummary): string {
  const rows = Object.entries(gate).map(([k, v]) => `| ${v.allowed ? "✅" : "❌"} | \`${k}\` |`);
  return `### 🚦 Gate Results\n\n| | Check |\n|---|---|\n${rows.join("\n")}`;
}

function renderCost(cost: CostSummary, alertThresholdCents = 0): string {
  const rows = Object.entries(cost.breakdown).map(
    ([p, v]) => `| \`${p}\` | ${v.tokens.toLocaleString()} | $${v.usd.toFixed(4)} |`
  );
  const cents = cost.estimatedUsdCents ?? Math.round(cost.estimatedUsd * 100);
  const alertLine =
    alertThresholdCents > 0 && cents > alertThresholdCents
      ? `\n> 🚨 **Cost Alert:** run cost ($${cost.estimatedUsd.toFixed(4)}) exceeded threshold ($${(alertThresholdCents / 100).toFixed(2)})`
      : "";
  return `### 💰 Cost Summary${alertLine}\n\n**Total tokens:** ${cost.totalTokens.toLocaleString()}  |  **Estimated cost:** $${cost.estimatedUsd.toFixed(4)}\n\n| Provider | Tokens | Est. USD |\n|---|---|---|\n${rows.join("\n")}`;
}

function buildBody(s: RunState, extras: ReporterExtras, alertThresholdCents = 0): string {
  const sections: string[] = [
    `## 🤖 Qodo V24 — Run \`${s.runId}\``,
    `> **Objective:** ${s.objective}`,
    "",
    renderPhaseProgress(s),
  ];

  if (extras.gate) sections.push("", renderGate(extras.gate));
  if (extras.cost) sections.push("", renderCost(extras.cost, alertThresholdCents));
  if (extras.canaryUrl) sections.push("", `### 🐦 Canary\n\nPreview deployed: [${extras.canaryUrl}](${extras.canaryUrl})`);
  if (extras.errorMsg) sections.push("", `### ❌ Error\n\n\`\`\`\n${extras.errorMsg}\n\`\`\``);

  sections.push("", `---\n*Updated ${new Date().toUTCString()} · [Qodo V24](https://github.com/qodo-v24)*`);
  return sections.join("\n");
}

interface ReporterExtras {
  gate?: GateResultSummary;
  cost?: CostSummary;
  canaryUrl?: string;
  errorMsg?: string;
}

// ---------------------------------------------------------------------------
// PrReporter
// ---------------------------------------------------------------------------

export class PrReporter {
  private readonly alertThresholdCents: number;

  constructor(
    private readonly gh: GitHubClient,
    private readonly state: RedisState,
    private readonly prNumber: number,
    private readonly owner: string,
    private readonly repo: string,
    private readonly telemetry?: Telemetry,
    alertThresholdCents = 0,
  ) {
    this.alertThresholdCents = alertThresholdCents;
  }

  /** Create or update the anchor comment to reflect current run state. */
  async report(runState: RunState, extras: ReporterExtras = {}): Promise<void> {
    const body = buildBody(runState, extras, this.alertThresholdCents);
    const key  = anchorKey(this.owner, this.repo, this.prNumber);

    try {
      const existing = await this.state.getJSON<{ commentId: number }>(key);
      if (existing?.commentId) {
        await this.gh.updateComment(this.prNumber, existing.commentId, body);
        log.info("[pr-reporter] anchor comment updated", { phase: runState.phase, commentId: existing.commentId });
      } else {
        const commentId = await this.gh.comment(this.prNumber, body);
        if (typeof commentId === "number") {
          await this.state.setJSON(key, { commentId }, 86_400); // 24h TTL
          log.info("[pr-reporter] anchor comment created", { phase: runState.phase, commentId });
        }
      }
      await this.telemetry?.push({ phase: runState.phase, decision: "pr-report-updated" });
    } catch (e: unknown) {
      // Reporting failures must never break the pipeline.
      log.warn("[pr-reporter] failed to update PR comment", { error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Post a fatal error comment (not threaded — standalone for visibility). */
  async fatal(message: string): Promise<void> {
    const body = `## ❌ Qodo V24 — Fatal Error\n\n\`\`\`\n${message}\n\`\`\`\n\n*${new Date().toUTCString()}*`;
    try {
      await this.gh.comment(this.prNumber, body);
    } catch { /* best-effort */ }
  }
}
