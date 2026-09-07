/**
 * git-blame-risk.ts — Integration 6: Git Blame Risk Amplifier
 *
 * For every file the agent intends to touch, fetches recent commit history
 * from the GitHub API and computes a data-driven risk bonus based on:
 *   - Churn: number of commits in the lookback window
 *   - Author count: unique committers in the lookback window
 *
 * riskBonus = (churn * 0.5) + (authorCount * 2)
 * The bonus is added to the blast-radius score in blast-radius.ts.
 */
import { z } from "zod";
import { fetchWithTimeout } from "../../utils/fetch-timeout.js";
import type { Telemetry } from "../telemetry.js";

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

export const GitBlameRiskConfigSchema = z.object({
  token: z.string().min(1),
  owner: z.string().min(1),
  repo: z.string().min(1),
  lookbackDays: z.number().int().positive().default(90),
}).strict();

export type GitBlameRiskConfig = z.infer<typeof GitBlameRiskConfigSchema>;

export interface FileRiskBonus {
  file: string;
  churn: number;
  authorCount: number;
  riskBonus: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface GitHubCommit {
  commit: { author: { date: string; email?: string } };
  author?: { login?: string } | null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Computes git-blame risk for each target file.
 * Files that fail individually are given a zero bonus rather than blocking
 * the whole batch.
 */
export async function computeGitBlameRisk(
  targetFiles: string[],
  cfg: GitBlameRiskConfig,
  telemetry?: Telemetry,
): Promise<FileRiskBonus[]> {
  if (process.env.QODO_PRIVACY_MODE === "strict") return targetFiles.map((f) => zero(f));

  const since = new Date(Date.now() - cfg.lookbackDays * 24 * 3600 * 1000).toISOString();
  const results: FileRiskBonus[] = [];

  for (const file of targetFiles) {
    try {
      const url =
        `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/commits` +
        `?path=${encodeURIComponent(file)}&per_page=20&since=${encodeURIComponent(since)}`;
      const res = await fetchWithTimeout(
        url,
        {
          headers: {
            Authorization: `Bearer ${cfg.token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
        10_000,
      );
      if (!res.ok) { results.push(zero(file)); continue; }

      const commits = (await res.json()) as GitHubCommit[];
      const churn = commits.length;
      const authorSet = new Set(commits.map((c) => c.author?.login ?? c.commit.author.email ?? "unknown"));
      const authorCount = authorSet.size;
      const riskBonus = churn * 0.5 + authorCount * 2;
      results.push({ file, churn, authorCount, riskBonus });
    } catch {
      results.push(zero(file));
    }
  }

  const totalBonus = results.reduce((s, r) => s + r.riskBonus, 0);
  await telemetry?.decision("git-blame-risk", "computed", { files: targetFiles.length, totalBonus });
  return results;
}

/** Sum of all individual file risk bonuses (scalar for blast-radius). */
export function totalRiskBonus(bonuses: FileRiskBonus[]): number {
  return bonuses.reduce((s, b) => s + b.riskBonus, 0);
}

function zero(file: string): FileRiskBonus {
  return { file, churn: 0, authorCount: 0, riskBonus: 0 };
}

/**
 * Build a GitBlameRiskConfig from environment variables.
 * Returns null when required vars are absent.
 */
export function resolveGitBlameConfig(
  owner: string,
  repo: string,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): GitBlameRiskConfig | null {
  if (!env.GITHUB_TOKEN) return null;
  return GitBlameRiskConfigSchema.parse({ token: env.GITHUB_TOKEN, owner, repo });
}
