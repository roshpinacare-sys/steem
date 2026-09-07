/**
 * rationale-bank.ts — J4: Decision Rationale Bank.
 *
 * Logs the *reasoning* behind every non-obvious judgment call made by
 * Architect, Coder, and Reviewer — not just the output.  Stored in Redis
 * (short-term) and optionally written to R2 as structured JSON blobs for
 * long-term querying.
 *
 * Six months from now, when a human or the agent asks "why did we do it this
 * way?", there is an actual answer instead of just the code.
 *
 * DESIGN INVARIANTS
 * - Storage is best-effort: failures never block the pipeline.
 * - Privacy mode: skips external storage writes (R2); Redis writes still
 *   happen as they are local to the operator's infra.
 * - All entries are indexed by `{owner}/{repo}/{runId}/{agent}` for fast lookup.
 */

import type { RedisState } from "./redis-state.js";
import type { R2Storage } from "./r2-storage.js";
import type { Telemetry } from "./telemetry.js";
import { log } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RationaleAgent = "architect" | "coder" | "reviewer" | "supervisor" | "darwin" | "red-team";

export interface RationaleEntry {
  /** Monotonic ID: `{runId}:{agent}:{sequenceN}` */
  id: string;
  runId: string;
  owner: string;
  repo: string;
  agent: RationaleAgent;
  /** Short label for the decision point (e.g. "approach-selection", "risk-acceptance"). */
  decisionPoint: string;
  /** Free-text reasoning — the "why", not the "what". */
  reasoning: string;
  /** Optional structured context (alternatives considered, constraints). */
  context?: Record<string, unknown>;
  recordedAt: string;
}

const REDIS_TTL_S = 30 * 24 * 60 * 60; // 30 days
const R2_PREFIX   = "rationale-bank/";
const REDIS_INDEX_TTL_S = 90 * 24 * 60 * 60; // 90 days for the index

function redisEntryKey(owner: string, repo: string, runId: string, agent: string, n: number): string {
  return `qodo:v24:rationale:${owner}:${repo}:${runId}:${agent}:${n}`;
}

function redisIndexKey(owner: string, repo: string): string {
  return `qodo:v24:rationale-index:${owner}:${repo}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record a decision rationale entry.  The sequence number is derived from
 * the current index length so entries are ordered within a run.
 */
export async function recordRationale(
  entry: Omit<RationaleEntry, "id" | "recordedAt">,
  state: RedisState,
  storage?: R2Storage,
  telemetry?: Telemetry,
): Promise<void> {
  try {
    const index = await loadIndex(entry.owner, entry.repo, state);
    const n = index.length;
    const id = `${entry.runId}:${entry.agent}:${n}`;
    const full: RationaleEntry = {
      ...entry,
      id,
      recordedAt: new Date().toISOString(),
    };

    // Write entry to Redis
    const entryKey = redisEntryKey(entry.owner, entry.repo, entry.runId, entry.agent, n);
    await state.setWithTTL(entryKey, JSON.stringify(full), REDIS_TTL_S);

    // Append to index
    index.push({ id, key: entryKey, agent: entry.agent, decisionPoint: entry.decisionPoint, runId: entry.runId, recordedAt: full.recordedAt });
    const idxKey = redisIndexKey(entry.owner, entry.repo);
    await state.setWithTTL(idxKey, JSON.stringify(index), REDIS_INDEX_TTL_S);

    // Mirror to R2 for long-term retention (optional, privacy-checked)
    if (storage && process.env.QODO_PRIVACY_MODE !== "strict") {
      const r2Key = `${R2_PREFIX}${entry.owner}/${entry.repo}/${entry.runId}/${entry.agent}/${n}.json`;
      await storage.putText(r2Key, JSON.stringify(full, null, 2)).catch((e: unknown) => {
        log.warn("rationale-bank: R2 write failed (non-fatal)", { key: r2Key, error: e instanceof Error ? e.message : String(e) });
      });
    }

    await telemetry?.decision("rationale-bank", "recorded", {
      id,
      agent: entry.agent,
      decisionPoint: entry.decisionPoint,
    });
  } catch (e: unknown) {
    log.warn("rationale-bank: write failed (non-fatal)", {
      agent: entry.agent,
      runId: entry.runId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Load all rationale entries for a given run.
 * Returns [] on any error.
 */
export async function loadRunRationale(
  owner: string,
  repo: string,
  runId: string,
  state: RedisState,
): Promise<RationaleEntry[]> {
  try {
    const index = await loadIndex(owner, repo, state);
    const runEntries = index.filter((i) => i.runId === runId);
    const results = await Promise.all(
      runEntries.map(async (idx) => {
        const raw = await state.get(idx.key).catch(() => null);
        if (!raw) return null;
        try { return JSON.parse(raw) as RationaleEntry; } catch { return null; }
      }),
    );
    return results.filter((r): r is RationaleEntry => r !== null);
  } catch (e: unknown) {
    log.warn("rationale-bank: history read failed; returning empty", {
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface IndexEntry {
  id: string;
  key: string;
  agent: string;
  decisionPoint: string;
  runId: string;
  recordedAt: string;
}

async function loadIndex(owner: string, repo: string, state: RedisState): Promise<IndexEntry[]> {
  try {
    const raw = await state.get(redisIndexKey(owner, repo));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as IndexEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
