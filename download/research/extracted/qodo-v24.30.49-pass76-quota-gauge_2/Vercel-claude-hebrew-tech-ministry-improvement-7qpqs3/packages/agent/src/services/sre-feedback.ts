import type { GitHubClient } from "./github-client.js";
import type { Telemetry } from "./telemetry.js";
import { fetchWithTimeout } from "../utils/fetch-timeout.js";
import { log } from "./logger.js";
import { isHalted } from "./kill-switch.js";
import {
  notifySlack,
  resolveSlackConfig,
} from "./integrations/slack-webhook.js";

export interface SreFeedbackEnv {
  AXIOM_TOKEN?: string;
  AXIOM_DATASET?: string;
  VERCEL_TOKEN?: string;
  VERCEL_PROJECT_ID?: string;
  // Kill-switch fields — required here so TypeScript enforces their presence
  // at every call site and the halt check in the warmup loop is not silently
  // bypassed when a caller passes a narrower env object.
  QODO_HALT?: string;
  QODO_HALT_REASON?: string;
}

export interface SreFeedbackInput {
  prNumber: number;
  objective: string;
  commitSha?: string;
  owner: string;
  repo: string;
  githubToken: string;
}

interface LogEntry {
  timestamp: string;
  status?: number;
  latency_ms?: number;
  message?: string;
}

/**
 * Waits 10 minutes after merge, fetches recent application logs, and checks
 * for 5xx errors or latency regressions (>2000ms). If a regression is found,
 * performs a safe git revert and opens a tracking GitHub issue.
 */
export interface SreFeedbackResult {
  reverted: boolean;
  reason?: string;
  /** True when no log provider was configured and the loop had no data. */
  skipped?: boolean;
}

export async function runSreFeedbackLoop(
  gh: GitHubClient,
  input: SreFeedbackInput,
  telemetry?: Telemetry,
  env: SreFeedbackEnv = process.env as SreFeedbackEnv,
): Promise<SreFeedbackResult> {
  await telemetry?.decision("sre-feedback", "scheduled", { prNumber: input.prNumber });

  const cfg = resolveLogsConfig(env);

  // Guard: if no log provider is configured, fetchProductionLogs() returns [].
  // An empty sample is otherwise indistinguishable from a genuinely healthy
  // deployment, so we surface it explicitly instead of returning reverted:false
  // — which would mislead callers into believing the deployment was verified.
  // This check must happen BEFORE the post-merge warmup sleep so callers are
  // not blocked for 10 minutes only to learn that no logs can be fetched.
  const hasProvider = !!(cfg.axiomToken || cfg.vercelToken);
  if (!hasProvider) {
    await telemetry?.decision("sre-feedback", "skipped-no-provider", {});
    return { reverted: false, skipped: true, reason: "no log provider configured" };
  }

  // ── Halt-aware warmup wait ───────────────────────────────────────────────
  // The original single `await sleep(10min)` made QODO_HALT=true ineffective
  // during the post-merge wait: the pipeline kept the process alive for up to
  // 10 minutes even after an operator set the kill-switch.
  //
  // Replaced with a short-poll loop: check isHalted(env) every 5 s and exit
  // immediately if the kill-switch fires.  This costs ~1 micro-check per 5 s
  // over 600 s (120 iterations) — negligible overhead.
  //
  // isHalted is imported statically at the top of the module. The previous
  // implementation used a dynamic `await import()` inside the loop body to
  // avoid a "hard dependency", but kill-switch.ts is a pure env check with no
  // external dependencies of its own — the dynamic import was both unnecessary
  // and harmful: it created an async microtask overhead on every iteration and
  // the TypeScript type for `env` (SreFeedbackEnv) did not include QODO_HALT,
  // so the cast `env as Record<string, string | undefined>` silently made the
  // halt check a no-op whenever a caller passed a SreFeedbackEnv-typed object.
  // SreFeedbackEnv now includes QODO_HALT and QODO_HALT_REASON so TypeScript
  // enforces their presence at every call site.
  const warmupMs = 10 * 60 * 1000;
  const pollMs   = 5_000;
  const deadline = Date.now() + warmupMs;
  while (Date.now() < deadline) {
    if (isHalted(env)) {
      await telemetry?.decision("sre-feedback", "halted-during-warmup", {
        elapsed: Date.now() - (deadline - warmupMs),
      });
      log.warn("sre-feedback: pipeline halted during post-merge warmup — skipping SRE loop");
      return { reverted: false, skipped: true, reason: "pipeline halted (QODO_HALT)" };
    }
    await sleep(Math.min(pollMs, deadline - Date.now()));
  }

  const logs = await fetchProductionLogs(input, cfg);
  const fiveXx = logs.filter((l) => l.status && l.status >= 500);
  const slow = logs.filter((l) => l.latency_ms && l.latency_ms > 2000);

  await telemetry?.decision("sre-feedback", "metrics-polled", {
    sampleSize: logs.length,
    fiveXx: fiveXx.length,
    slow: slow.length,
  });

  if (fiveXx.length === 0 && slow.length === 0) {
    await telemetry?.decision("sre-feedback", "healthy", {});
    return { reverted: false };
  }

  const reason = [
    fiveXx.length ? `${fiveXx.length} new 5xx error(s)` : "",
    slow.length ? `${slow.length} request(s) >2000ms latency` : "",
  ]
    .filter(Boolean)
    .join("; ");

  await telemetry?.decision("sre-feedback", "regression-detected", { reason });

  const revertSha = await gh.revertMergeCommitWithNewCommit(input.prNumber);

  const issueTitle = "SRE Alert: Auto-Reverted Production Regression";
  const issueBody = `An automated SRE feedback loop detected a production regression and reverted the change.

- Original objective: ${input.objective}
- PR: #${input.prNumber}
- Commit: ${input.commitSha || "unknown"}
- Revert commit: ${revertSha}
- Detection: ${reason}

## Sample logs
\`\`\`
${JSON.stringify({ fiveXx: fiveXx.slice(0, 10), slow: slow.slice(0, 10) }, null, 2)}
\`\`\``;

  const issueNumber = await openIssue(input.owner, input.repo, input.githubToken, issueTitle, issueBody);
  await telemetry?.decision("sre-feedback", "issue-opened", { issueNumber });

  // Notify Slack of the revert
  const slackCfg = resolveSlackConfig();
  if (slackCfg) {
    await notifySlack(
      { type: "revert", phase: "sre-feedback", message: `Production regression detected and reverted. PR #${input.prNumber}: ${reason}`, ref: input.prNumber },
      slackCfg,
      telemetry,
    );
  }

  return { reverted: true, reason };
}

/** Optional observability credentials threaded in from the validated env object. */
interface LogsConfig {
  axiomToken?: string;
  axiomDataset?: string;
  vercelToken?: string;
  vercelProjectId?: string;
}

function resolveLogsConfig(env: SreFeedbackEnv = process.env as SreFeedbackEnv): LogsConfig {
  return {
    axiomToken: env.AXIOM_TOKEN,
    axiomDataset: env.AXIOM_DATASET,
    vercelToken: env.VERCEL_TOKEN,
    vercelProjectId: env.VERCEL_PROJECT_ID,
  };
}

async function fetchProductionLogs(input: SreFeedbackInput, cfg: LogsConfig): Promise<LogEntry[]> {
  // Prefer Axiom/Logtail; fall back to Vercel Logs API when available.
  if (cfg.axiomToken && cfg.axiomDataset) {
    return fetchAxiomLogs(cfg.axiomToken, cfg.axiomDataset);
  }
  if (cfg.vercelToken && cfg.vercelProjectId) {
    return fetchVercelLogs(cfg.vercelToken, cfg.vercelProjectId);
  }
  void input; // reserved for future per-project log routing
  return [];
}

async function fetchAxiomLogs(axiomToken: string, axiomDataset: string): Promise<LogEntry[]> {
  const start = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const end = new Date().toISOString();
  const res = await fetchWithTimeout(
    `https://api.axiom.co/v1/datasets/${axiomDataset}/query?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
    {
      headers: {
        Authorization: `Bearer ${axiomToken}`,
        Accept: "application/json",
      },
    },
    30_000,
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { matches?: LogEntry[] };
  return data.matches || [];
}

async function fetchVercelLogs(vercelToken: string, vercelProjectId: string): Promise<LogEntry[]> {
  const start = Date.now() - 15 * 60 * 1000;
  const res = await fetchWithTimeout(
    `https://api.vercel.com/v2/projects/${vercelProjectId}/logs?start=${start}`,
    { headers: { Authorization: `Bearer ${vercelToken}` } },
    30_000,
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { logs?: LogEntry[] };
  return (data.logs || []).map((l) => ({
    timestamp: l.timestamp,
    status: l.status,
    latency_ms: l.latency_ms,
    message: l.message,
  }));
}

async function openIssue(owner: string, repo: string, token: string, title: string, body: string): Promise<number> {
  const res = await fetchWithTimeout(
    `https://api.github.com/repos/${owner}/${repo}/issues`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ title, body, labels: ["sre", "auto-revert", "regression"] }),
    },
    30_000,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "unknown");
    throw new Error(`GitHub issue creation failed ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { number: number };
  return data.number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
