/**
 * github-actions-flaky.ts — Integration 5: GitHub Actions → Flaky Test Memory
 *
 * Fetches recently failed CI runs, extracts test names and their associated
 * source files from job logs, and maintains a Redis-backed flaky-test index
 * (TTL: 24 hours, namespace: qodo:v24:flaky-tests).
 *
 * Gate phase uses this index to distinguish real regressions from noise.
 */
import { z } from "zod";
import { fetchWithTimeout } from "../../utils/fetch-timeout.js";
import type { Telemetry } from "../telemetry.js";
import type { RedisState } from "../redis-state.js";
import { log as logger } from "../logger.js";

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

export const GitHubActionsFlakyConfigSchema = z.object({
  token: z.string().min(1),
  owner: z.string().min(1),
  repo: z.string().min(1),
  lookbackRuns: z.number().int().positive().default(100),
}).strict();

export type GitHubActionsFlakyConfig = z.infer<typeof GitHubActionsFlakyConfigSchema>;

export interface FlakyTestEntry {
  testName: string;
  failureCount: number;
  associatedFiles: string[];
  lastFailedAt: string;
}

const REDIS_KEY = "qodo:v24:flaky-tests:index";
const REDIS_TTL = 86_400; // 24 h

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Naïve extraction of "FAIL src/foo.test.ts" patterns from log text. */
function extractFailedFilesFromLog(log: string): string[] {
  const matches = log.match(/(?:FAIL|✗|×)\s+([\w/.\-]+\.(?:test|spec)\.[tj]sx?)/g) ?? [];
  return [...new Set(matches.map((m) => m.replace(/^(?:FAIL|✗|×)\s+/, "").trim()))];
}

/**
 * Derive the likely source file from a test file path.
 * E.g. "src/services/foo.test.ts" → "src/services/foo.ts"
 * Falls back to the test path itself when no match is found.
 */
function deriveSourceFile(testPath: string): string {
  // Strip .test.ts / .spec.ts → .ts  (also handles .js, .tsx, .jsx)
  return testPath.replace(/\.(test|spec)(\.[tj]sx?)$/, "$2");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds or refreshes the flaky-test index from the last N failed CI runs.
 * Stores the result in Redis with a 24-hour TTL.
 */
export async function buildFlakyTestIndex(
  cfg: GitHubActionsFlakyConfig,
  state: RedisState,
  telemetry?: Telemetry,
): Promise<FlakyTestEntry[]> {
  if (process.env.QODO_PRIVACY_MODE === "strict") return [];

  let runsRaw: unknown;
  try {
    const res = await fetchWithTimeout(
      `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/actions/runs?status=failure&per_page=${cfg.lookbackRuns}`,
      {
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
      15_000,
    );
    if (!res.ok) {
      await telemetry?.decision("github-actions-flaky", "runs-fetch-failed", { status: res.status });
      return [];
    }
    runsRaw = (await res.json()) as { workflow_runs?: unknown[] };
  } catch (e: unknown) {
    await telemetry?.decision("github-actions-flaky", "runs-fetch-error", { error: e instanceof Error ? e.message : String(e) });
    return [];
  }

  const runs = ((runsRaw as { workflow_runs?: unknown[] }).workflow_runs ?? []) as Array<{ id: number; logs_url: string; run_started_at: string }>;

  const failureCounts = new Map<string, { count: number; files: Set<string>; lastAt: string }>();

  // Sample first 20 runs to keep API calls bounded
  for (const run of runs.slice(0, 20)) {
    try {
      const logsRes = await fetchWithTimeout(
        `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/actions/runs/${run.id}/logs`,
        {
          headers: {
            Authorization: `Bearer ${cfg.token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
        15_000,
      );
      if (!logsRes.ok) continue;
      const text = await logsRes.text();
      const files = extractFailedFilesFromLog(text);
      for (const f of files) {
        const sourceFile = deriveSourceFile(f);
        const existing = failureCounts.get(f) ?? { count: 0, files: new Set<string>(), lastAt: run.run_started_at };
        existing.count += 1;
        // Pass 19 fix: record the derived *source* file so matchFlakyTests can
        // correlate against agent target files, not the test file itself.
        existing.files.add(sourceFile);
        existing.lastAt = run.run_started_at;
        failureCounts.set(f, existing);
      }
    } catch {
      // skip individual log failures
    }
  }

  const entries: FlakyTestEntry[] = Array.from(failureCounts.entries())
    .filter(([, v]) => v.count >= 2)
    .map(([testName, v]) => ({
      testName,
      failureCount: v.count,
      associatedFiles: Array.from(v.files),
      lastFailedAt: v.lastAt,
    }));

  // Persist to Redis
  await state.setWithTTL(REDIS_KEY, JSON.stringify(entries), REDIS_TTL);

  await telemetry?.decision("github-actions-flaky", "index-built", { entries: entries.length });
  return entries;
}

/**
 * Loads the flaky-test index from Redis.
 * Returns [] when the key is absent or unreadable.
 */
export async function loadFlakyTestIndex(state: RedisState): Promise<FlakyTestEntry[]> {
  try {
    const raw = await state.get(REDIS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as FlakyTestEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e: unknown) {
    logger.warn("github-actions-flaky: index unreadable; treating as empty", {
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

/**
 * Given a set of target files, returns flaky test entries that reference
 * any of those files (or whose testName path overlaps).
 */
export function matchFlakyTests(
  targetFiles: string[],
  index: FlakyTestEntry[],
): FlakyTestEntry[] {
  return index.filter((entry) =>
    entry.associatedFiles.some((af) =>
      targetFiles.some((tf) => af.includes(tf) || tf.includes(af)),
    ),
  );
}
