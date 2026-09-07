/**
 * blame-sentry-bridge.ts — Bridge 1: Sentry issues × Git Blame → "Who owns this bug, live"
 *
 * Before the Coder runs on any file with an open Sentry error, this bridge:
 *   1. Fetches unresolved Sentry issues for the target files (via sentry-gate.ts).
 *   2. Fetches the git blame history for those exact files (via git-blame-risk.ts).
 *   3. Correlates: which commit / author introduced the code path that is erroring?
 *   4. Returns enriched context injected into the Coder's prompt as "known bad pattern".
 *
 * DESIGN INVARIANTS
 * - Never throws; returns an empty result on any error.
 * - Privacy mode: skips all external calls, returns empty result.
 * - Only runs when BOTH sentry-gate and git-blame-risk are configured.
 */

import {
  checkSentryRisk,
  resolveSentryConfig,
  type SentryGateResult,
} from "./sentry-gate.js";
import {
  computeGitBlameRisk,
  resolveGitBlameConfig,
  type FileRiskBonus,
} from "./git-blame-risk.js";
import type { Telemetry } from "../telemetry.js";
import { log } from "../logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BlameContext {
  /** Source file the context refers to. */
  file: string;
  /** Sentry issue titles referencing this file. */
  sentryIssues: string[];
  /** Number of unique authors who recently modified this file. */
  authorCount: number;
  /** Churn count (commits in lookback window). */
  churn: number;
  /**
   * Formatted context string ready to prepend to the Coder's system prompt.
   * Empty string when no Sentry issues affect this file.
   */
  promptFragment: string;
}

export interface BlameSentryResult {
  /** True when at least one target file has both an open Sentry error and blame data. */
  hasEnrichedContext: boolean;
  contexts: BlameContext[];
}

const EMPTY: BlameSentryResult = { hasEnrichedContext: false, contexts: [] };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the Sentry × Git-Blame bridge for the supplied target files.
 *
 * @param targetFiles  Files the Coder is about to modify.
 * @param owner        GitHub repo owner.
 * @param repo         GitHub repo name.
 * @param telemetry    Optional telemetry service.
 * @returns            Enriched blame+sentry context per affected file.
 */
export async function runBlameSentryBridge(
  targetFiles: string[],
  owner: string,
  repo: string,
  telemetry?: Telemetry,
): Promise<BlameSentryResult> {
  if (process.env.QODO_PRIVACY_MODE === "strict") {
    await telemetry?.decision("blame-sentry-bridge", "skipped-privacy-mode", {});
    return EMPTY;
  }

  if (targetFiles.length === 0) return EMPTY;

  // ── Resolve configs; bail if either integration is not configured ────────
  const sentryCfg   = resolveSentryConfig();
  const gitBlameCfg = resolveGitBlameConfig(owner, repo);

  if (!sentryCfg || !gitBlameCfg) {
    await telemetry?.decision("blame-sentry-bridge", "skipped-missing-config", {
      hasSentry:   !!sentryCfg,
      hasGitBlame: !!gitBlameCfg,
    });
    return EMPTY;
  }

  // ── Fetch Sentry risk + Git blame in parallel ────────────────────────────
  let sentryResult: SentryGateResult;
  let blameEntries: FileRiskBonus[];

  try {
    [sentryResult, blameEntries] = await Promise.all([
      checkSentryRisk(targetFiles, sentryCfg, telemetry),
      computeGitBlameRisk(targetFiles, gitBlameCfg, telemetry),
    ]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn("blame-sentry-bridge: fetch error", { error: msg });
    await telemetry?.decision("blame-sentry-bridge", "fetch-error", { error: msg });
    return EMPTY;
  }

  if (!sentryResult.hasUnresolvedErrors) {
    await telemetry?.decision("blame-sentry-bridge", "no-sentry-issues", {});
    return EMPTY;
  }

  // ── Correlate per-file ───────────────────────────────────────────────────
  const blameByFile = new Map(blameEntries.map((e) => [e.file, e]));
  const contexts: BlameContext[] = [];

  for (const file of sentryResult.affectedFiles) {
    const blame = blameByFile.get(file);
    const sentryIssues = [`Unresolved Sentry error references: ${file}`];
    const promptFragment = buildPromptFragment(file, sentryIssues, blame);
    contexts.push({
      file,
      sentryIssues,
      authorCount: blame?.authorCount ?? 0,
      churn: blame?.churn ?? 0,
      promptFragment,
    });
  }

  const hasEnrichedContext = contexts.length > 0;
  await telemetry?.decision("blame-sentry-bridge", "bridge-complete", {
    affectedFiles: contexts.map((c) => c.file),
    hasEnrichedContext,
  });

  if (hasEnrichedContext) {
    log.info("blame-sentry-bridge: enriched context produced", {
      files: contexts.map((c) => c.file),
    });
  }

  return { hasEnrichedContext, contexts };
}

/**
 * Merge all blame-sentry context fragments into a single string suitable
 * for prepending to the Coder's system prompt.
 */
export function formatBridgeContext(result: BlameSentryResult): string {
  if (!result.hasEnrichedContext) return "";
  return [
    "## ⚠️ BLAME-SENTRY CONTEXT — known bad patterns in target files",
    "(Do NOT reproduce these patterns — they are already causing production errors.)",
    "",
    ...result.contexts.map((c) => c.promptFragment),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildPromptFragment(
  file: string,
  sentryIssues: string[],
  blame: FileRiskBonus | undefined,
): string {
  const lines = [
    `### File: \`${file}\``,
    `**Open Sentry errors:** ${sentryIssues.join("; ")}`,
  ];
  if (blame) {
    lines.push(`**Churn (last 90 days):** ${blame.churn} commits across ${blame.authorCount} author(s) — risk bonus: ${blame.riskBonus.toFixed(1)}`);
  }
  lines.push("**Action:** Review these error patterns before writing any code touching this file.");
  return lines.join("\n");
}
