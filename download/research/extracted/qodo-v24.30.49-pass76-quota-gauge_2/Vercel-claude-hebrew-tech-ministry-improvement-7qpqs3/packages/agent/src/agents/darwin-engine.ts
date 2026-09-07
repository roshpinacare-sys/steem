import { log } from "../services/logger.js";
import type { GitHubClient } from "../services/github-client.js";
import type { RedisState } from "../services/redis-state.js";
import type { Telemetry } from "../services/telemetry.js";

export interface RetryPattern {
  prNumber: number;
  title: string;
  coderRetries: number;
  errorSignatures: string[];
}

/** Stored after a mutation is merged so fitness can be measured later. */
export interface MutationBaseline {
  mutationId: string;
  mergedAt: string;
  baselineLatencyMs: number;
}

const REGRESSION_THRESHOLD = 0.2; // 20 % latency increase triggers revert PR

function baselineKey(owner: string, repo: string): string {
  return `darwin:baseline:${owner}:${repo}`;
}

/**
 * Record the current p50 pipeline latency as the baseline for a freshly
 * merged prompt mutation.  Call this immediately after the mutation PR merges.
 */
export async function recordMutationBaseline(
  mutationId: string,
  currentLatencyMs: number,
  owner: string,
  repo: string,
  state: RedisState,
  telemetry?: Telemetry,
): Promise<void> {
  const baseline: MutationBaseline = {
    mutationId,
    mergedAt: new Date().toISOString(),
    baselineLatencyMs: currentLatencyMs,
  };
  await state.setJSON(baselineKey(owner, repo), baseline);
  await telemetry?.decision("darwin-engine", "baseline-recorded", {
    mutationId,
    baselineLatencyMs: currentLatencyMs,
  });
}

/**
 * Compare the supplied current latency against the stored baseline.
 * If regression > 20 %, open a Revert PR automatically.
 *
 * @returns true if a revert PR was opened, false otherwise.
 */
export async function evaluateMutationFitness(
  currentLatencyMs: number,
  owner: string,
  repo: string,
  gh: GitHubClient,
  state: RedisState,
  telemetry?: Telemetry,
): Promise<boolean> {
  const baseline = await state.getJSON<MutationBaseline>(baselineKey(owner, repo));
  if (!baseline) {
    await telemetry?.decision("darwin-engine", "no-baseline", { owner, repo });
    return false;
  }

  // Guard against division by zero: a baseline of 0 ms is not a valid
  // reference point (e.g. first run latency was rounded to 0 or a clock
  // anomaly). Without this guard, delta = Infinity or NaN, both of which
  // bypass the "delta <= REGRESSION_THRESHOLD" early-return and cause a
  // spurious revert PR to be opened.
  if (baseline.baselineLatencyMs <= 0) {
    log.warn("darwin-engine: invalid baseline latency (<=0); skipping fitness evaluation", {
      mutationId: baseline.mutationId,
      baselineLatencyMs: baseline.baselineLatencyMs,
    });
    await telemetry?.decision("darwin-engine", "fitness-skipped-invalid-baseline", {
      mutationId: baseline.mutationId,
      baselineLatencyMs: baseline.baselineLatencyMs,
    });
    return false;
  }

  const delta = (currentLatencyMs - baseline.baselineLatencyMs) / baseline.baselineLatencyMs;

  await telemetry?.decision("darwin-engine", "fitness-evaluated", {
    mutationId: baseline.mutationId,
    baselineLatencyMs: baseline.baselineLatencyMs,
    currentLatencyMs,
    regressionPct: Math.round(delta * 100),
  });

  // A regression of exactly the threshold (>= 20 %) triggers the revert.
  if (delta < REGRESSION_THRESHOLD) {
    log.info("darwin-engine: fitness OK", { deltaPercent: Math.round(delta * 100), thresholdPercent: REGRESSION_THRESHOLD * 100 });
    return false;
  }

  // Regression detected — open a Revert PR.
  const title = `Revert: Prompt mutation ${baseline.mutationId} caused ${Math.round(delta * 100)}% latency regression`;
  const body = `## Darwin Engine — Auto Revert\n\n` +
    `Mutation \`${baseline.mutationId}\` (merged ${baseline.mergedAt}) introduced a **${Math.round(delta * 100)}% latency regression**.\n\n` +
    `| Metric | Value |\n|---|---|\n` +
    `| Baseline | ${baseline.baselineLatencyMs} ms |\n` +
    `| Current  | ${currentLatencyMs} ms |\n` +
    `| Threshold | ${REGRESSION_THRESHOLD * 100}% |\n\n` +
    `This PR was opened automatically by the Darwin Fitness Evaluator.`;

  const revertContent = `# Auto-Revert\n\n${body}\n`;
  // BUGFIX (V24 audit): must create the branch/PR FIRST — commitViaGitDB(pr, ...)
  // calls octokit pulls.get({pull_number: pr}) to resolve the head branch, so
  // calling it with pr=0 before any PR exists always throws a 404. Swapped order.
  const prNumber = await gh.createBranchAndPR(title);
  await gh.commitViaGitDB(
    prNumber,
    [{ path: ".qodo/darwin-revert.md", content: revertContent }],
    title,
  );

  await telemetry?.decision("darwin-engine", "revert-pr-opened", {
    mutationId: baseline.mutationId,
    prNumber,
    regressionPct: Math.round(delta * 100),
  });

  log.info("darwin-engine: revert PR opened", { prNumber, mutationId: baseline.mutationId });
  return true;
}

/**
 * Cron-mode evolution engine. It analyzes the last 20 merged PRs, identifies
 * those that required >2 Coder retries, and proactively generates a system
 * prompt mutation to prevent the recurring error pattern.
 */
export async function runDarwinEngine(
  gh: GitHubClient,
  owner: string,
  repo: string,
  state: RedisState,
  telemetry?: Telemetry,
): Promise<void> {
  const prs = await gh.listMergedPRs(20);
  const patterns: RetryPattern[] = [];

  for (const pr of prs) {
    const events = await state.getJSON<{ name: string; details: Record<string, unknown> }[]>(`telemetry:pr:${pr.number}`);
    if (!events) continue;
    const coderRetries = events.filter((e) => e.name === "coder" && e.details?.retry).length;
    if (coderRetries > 2) {
      const signatures = events
        .filter((e) => e.name === "coder" && e.details?.error)
        .map((e) => String(e.details.error).slice(0, 80));
      patterns.push({ prNumber: pr.number, title: pr.title, coderRetries, errorSignatures: [...new Set(signatures)] });
    }
  }

  await telemetry?.decision("darwin-engine", "analysis-complete", {
    prsAnalyzed: prs.length,
    patterns: patterns.length,
  });

  if (!patterns.length) {
    log.info("darwin-engine: no recurring error patterns found");
    return;
  }

  const mutation = generatePromptMutation(patterns);
  const evolutionTitle = "Evolution: Optimized Coder System Prompt";
  // BUGFIX (V24 audit): same ordering issue as evaluateMutationFitness above.
  const prNumber = await gh.createBranchAndPR(evolutionTitle);
  await gh.commitViaGitDB(
    prNumber,
    [{ path: ".qodo/coder-mutation.md", content: mutation }],
    evolutionTitle,
  );
  await telemetry?.decision("darwin-engine", "evolution-pr-opened", { prNumber });
}

function generatePromptMutation(patterns: RetryPattern[]): string {
  const commonErrors = patterns.flatMap((p) => p.errorSignatures);
  const unique = [...new Set(commonErrors)];
  return `# Coder System Prompt Mutation

Generated by Darwin Engine based on ${patterns.length} PRs with >2 Coder retries.

## Recurring error signatures
${unique.map((e) => `- ${e}`).join("\n")}

## Injected directive
"""
You are the CODER. Avoid the recurring failure modes observed in production,
listed under "Recurring error signatures" above.

Before emitting code, verify the fix does not reproduce any of the above patterns.
"""
`;
}
