/**
 * codecov-intelligence.ts — Integration 8: Codecov → Coverage Intelligence
 *
 * Fetches per-file coverage data for touched files from the Codecov API.
 * Files with coverage < the configured threshold (default: 50%) are flagged
 * so janitor.ts and the Coder can add tests proactively.
 */
import { z } from "zod";
import { fetchWithTimeout } from "../../utils/fetch-timeout.js";
import type { Telemetry } from "../telemetry.js";

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

export const CodecovConfigSchema = z.object({
  token: z.string().min(1),
  owner: z.string().min(1),
  repo: z.string().min(1),
  coverageThreshold: z.number().min(0).max(100).default(50),
  /** Service provider slug — "github", "gitlab", or "bitbucket". */
  service: z.enum(["github", "gitlab", "bitbucket"]).default("github"),
}).strict();

export type CodecovConfig = z.infer<typeof CodecovConfigSchema>;

export interface FileCoverage {
  file: string;
  coverage: number;
  /** True when coverage is below the configured threshold. */
  lowCoverage: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface CodecovFileReport {
  name: string;
  totals?: { coverage?: number };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetches coverage for the given files at the latest HEAD.
 * Files missing from the Codecov report default to 0% coverage.
 * Never throws — returns an empty array on any error.
 */
export async function getFileCoverage(
  targetFiles: string[],
  cfg: CodecovConfig,
  telemetry?: Telemetry,
): Promise<FileCoverage[]> {
  if (process.env.QODO_PRIVACY_MODE === "strict") return [];
  if (!targetFiles.length) return [];

  const url =
    `https://codecov.io/api/v2/${cfg.service}/${cfg.owner}/repos/${cfg.repo}/file_report/`;

  let reports: CodecovFileReport[] = [];
  try {
    const res = await fetchWithTimeout(
      url,
      {
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          Accept: "application/json",
        },
      },
      10_000,
    );
    if (!res.ok) {
      await telemetry?.decision("codecov-intelligence", "fetch-failed", { status: res.status });
      return [];
    }
    const data = (await res.json()) as { results?: CodecovFileReport[] };
    reports = data.results ?? [];
  } catch (e: unknown) {
    await telemetry?.decision("codecov-intelligence", "fetch-error", { error: e instanceof Error ? e.message : String(e) });
    return [];
  }

  const coverageByFile = new Map(
    reports.map((r) => [r.name, r.totals?.coverage ?? 0]),
  );

  const results: FileCoverage[] = targetFiles.map((file) => {
    const coverage = coverageByFile.get(file) ?? coverageByFile.get(file.replace(/^src\//, "")) ?? 0;
    return { file, coverage, lowCoverage: coverage < cfg.coverageThreshold };
  });

  const lowCount = results.filter((r) => r.lowCoverage).length;
  await telemetry?.decision("codecov-intelligence", "coverage-fetched", {
    files: targetFiles.length,
    lowCoverage: lowCount,
  });

  return results;
}

/** Format low-coverage files as a Janitor-readable hint. */
export function formatCoverageHint(results: FileCoverage[]): string {
  const low = results.filter((r) => r.lowCoverage);
  if (!low.length) return "";
  const lines = low.map((r) => `- ${r.file} (${r.coverage.toFixed(1)}% coverage)`);
  return `Files with low test coverage (consider adding tests):\n${lines.join("\n")}`;
}

/**
 * Build a CodecovConfig from environment variables.
 * Returns null when CODECOV_TOKEN is absent.
 */
export function resolveCodecovConfig(
  owner: string,
  repo: string,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): CodecovConfig | null {
  if (!env.CODECOV_TOKEN) return null;
  return CodecovConfigSchema.parse({ token: env.CODECOV_TOKEN, owner, repo });
}
