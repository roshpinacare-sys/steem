/**
 * sentry-gate.ts — Integration 3: Sentry → Gate Intelligence (Gate 0)
 *
 * Before the agent acquires a lockfile it checks whether any of the target
 * files it intends to modify appear in unresolved Sentry stack traces.
 * A positive hit increases the blast-radius score and surfaces extra context
 * to the architect.
 */
import { z } from "zod";
import { fetchWithTimeout } from "../../utils/fetch-timeout.js";
import type { Telemetry } from "../telemetry.js";

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

export const SentryGateConfigSchema = z.object({
  authToken: z.string().min(1),
  org: z.string().min(1),
  project: z.string().min(1),
  apiBaseUrl: z.string().url().default("https://sentry.io/api/0"),
}).strict();

export type SentryGateConfig = z.infer<typeof SentryGateConfigSchema>;

export interface SentryGateResult {
  hasUnresolvedErrors: boolean;
  affectedFiles: string[];
  /** Extra blast-radius points to add (0 when no errors found). */
  riskBonus: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SentryIssue {
  id: string;
  title: string;
  culprit: string;
  metadata?: { filename?: string };
  entries?: Array<{ type: string; data: { values?: Array<{ stacktrace?: { frames?: Array<{ filename?: string; absPath?: string }> } }> } }>;
}

function extractFilePaths(issue: SentryIssue): string[] {
  const paths: Set<string> = new Set();
  if (issue.metadata?.filename) paths.add(normalizeFile(issue.metadata.filename));
  for (const entry of issue.entries ?? []) {
    if (entry.type !== "exception") continue;
    for (const value of entry.data?.values ?? []) {
      for (const frame of value?.stacktrace?.frames ?? []) {
        const p = frame.filename ?? frame.absPath;
        if (p) paths.add(normalizeFile(p));
      }
    }
  }
  return Array.from(paths);
}

function normalizeFile(p: string): string {
  // Strip leading repo root indicators like app:///src → src
  return p.replace(/^(app:\/\/\/|\/|\.\/|~\/)/, "");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Checks whether any `targetFiles` appear in unresolved Sentry issues.
 * Returns a risk signal with a `riskBonus` for blast-radius scoring.
 * Never throws — returns a zero-risk result on any error.
 */
export async function checkSentryRisk(
  targetFiles: string[],
  cfg: SentryGateConfig,
  telemetry?: Telemetry,
): Promise<SentryGateResult> {
  if (process.env.QODO_PRIVACY_MODE === "strict") {
    return { hasUnresolvedErrors: false, affectedFiles: [], riskBonus: 0 };
  }

  let issues: SentryIssue[];
  try {
    const res = await fetchWithTimeout(
      `${cfg.apiBaseUrl}/projects/${cfg.org}/${cfg.project}/issues/?query=is:unresolved&limit=100`,
      {
        headers: {
          Authorization: `Bearer ${cfg.authToken}`,
          Accept: "application/json",
        },
      },
      10_000,
    );
    if (!res.ok) {
      await telemetry?.decision("sentry-gate", "fetch-failed", { status: res.status });
      return { hasUnresolvedErrors: false, affectedFiles: [], riskBonus: 0 };
    }
    issues = (await res.json()) as SentryIssue[];
  } catch (e: unknown) {
    await telemetry?.decision("sentry-gate", "fetch-error", { error: e instanceof Error ? e.message : String(e) });
    return { hasUnresolvedErrors: false, affectedFiles: [], riskBonus: 0 };
  }

  const sentryFilePaths = new Set(issues.flatMap(extractFilePaths));
  const normalizedTargets = targetFiles.map(normalizeFile);
  const affectedFiles = normalizedTargets.filter((f) =>
    sentryFilePaths.has(f) || Array.from(sentryFilePaths).some((sp) => sp.includes(f) || f.includes(sp)),
  );

  const hasUnresolvedErrors = affectedFiles.length > 0;
  // 20-point risk bonus when touched files have open Sentry errors
  const riskBonus = hasUnresolvedErrors ? 20 : 0;

  await telemetry?.decision("sentry-gate", "checked", {
    sentryIssues: issues.length,
    affectedFiles: affectedFiles.length,
    riskBonus,
  });

  return { hasUnresolvedErrors, affectedFiles, riskBonus };
}

/**
 * Build a SentryGateConfig from environment variables.
 * Returns null when required vars are absent (Sentry integration opt-in).
 */
export function resolveSentryConfig(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): SentryGateConfig | null {
  if (!env.SENTRY_AUTH_TOKEN || !env.SENTRY_ORG || !env.SENTRY_PROJECT) return null;
  return SentryGateConfigSchema.parse({
    authToken: env.SENTRY_AUTH_TOKEN,
    org: env.SENTRY_ORG,
    project: env.SENTRY_PROJECT,
  });
}
