/**
 * github-issues.ts — Integration 1: GitHub Issues → Architect Context
 *
 * Fetches open GitHub issues labelled bug/enhancement and returns those
 * whose title or body text is relevant to the current objective.
 * Used by architect.ts to enrich the planning prompt.
 */
import { z } from "zod";
import { fetchWithTimeout } from "../../utils/fetch-timeout.js";
import type { Telemetry } from "../telemetry.js";

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

export const GitHubIssuesConfigSchema = z.object({
  token: z.string().min(1),
  owner: z.string().min(1),
  repo: z.string().min(1),
  labels: z.array(z.string()).default(["bug", "enhancement"]),
}).strict();

export type GitHubIssuesConfig = z.infer<typeof GitHubIssuesConfigSchema>;

export interface GitHubIssueRecord {
  number: number;
  title: string;
  body: string;
  labels: string[];
  url: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns open GitHub issues relevant to the given objective.
 * Relevance is determined by simple keyword overlap (≥1 word from objective
 * appears in the issue title or body).  Falls back to returning all fetched
 * issues when objective is too short to be meaningful.
 *
 * Never throws — returns [] on any error so the architect pipeline continues.
 */
export async function fetchRelevantIssues(
  objective: string,
  cfg: GitHubIssuesConfig,
  telemetry?: Telemetry,
): Promise<GitHubIssueRecord[]> {
  if (process.env.QODO_PRIVACY_MODE === "strict") {
    await telemetry?.decision("github-issues", "skipped-privacy-mode", {});
    return [];
  }

  const labels = cfg.labels.join(",");
  const url =
    `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/issues` +
    `?state=open&labels=${encodeURIComponent(labels)}&per_page=50`;

  let raw: unknown[];
  try {
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
    if (!res.ok) {
      await telemetry?.decision("github-issues", "fetch-failed", { status: res.status });
      return [];
    }
    raw = (await res.json()) as unknown[];
  } catch (e: unknown) {
    await telemetry?.decision("github-issues", "fetch-error", { error: e instanceof Error ? e.message : String(e) });
    return [];
  }

  const issues: GitHubIssueRecord[] = raw.map((r: unknown) => {
    const item = r as Record<string, unknown>;
    return {
      number: item.number as number,
      title: String(item.title ?? ""),
      body: String(item.body ?? "").slice(0, 2000),
      labels: ((item.labels as { name: string }[]) ?? []).map((l) => l.name),
      url: String(item.html_url ?? ""),
    };
  });

  const keywords = objective
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 4);

  const relevant =
    keywords.length < 2
      ? issues.slice(0, 10)
      : issues.filter((issue) => {
          const haystack = `${issue.title} ${issue.body}`.toLowerCase();
          return keywords.some((kw) => haystack.includes(kw));
        });

  await telemetry?.decision("github-issues", "fetched", {
    total: issues.length,
    relevant: relevant.length,
  });

  return relevant.slice(0, 10);
}

/** Format issues as a compact context block for the architect prompt. */
export function formatIssuesContext(issues: GitHubIssueRecord[]): string {
  if (!issues.length) return "";
  const lines = issues.map(
    (i) => `- #${i.number} [${i.labels.join(",")}] ${i.title} — ${i.url}`,
  );
  return `Open GitHub Issues (relevant to objective):\n${lines.join("\n")}`;
}
