/**
 * d1-history.ts — C1: Structured, queryable run history.
 *
 * Every pipeline run produces a compact summary record stored in Redis
 * (hot, 90-day TTL) and mirrored to R2 as newline-delimited JSON (cold,
 * indefinite retention).  Consumers like the Darwin engine and the Janitor
 * use `queryHistory` to ask questions like:
 *   - "Which objectives needed >2 Coder retries in the last 30 days?"
 *   - "What is the p50/p95 pipeline latency per complexity tier this week?"
 *   - "Which files appear in blast-radius entries most often?"
 *
 * DESIGN INVARIANTS
 * - Writes are best-effort: never block the pipeline.
 * - Privacy mode: R2 mirroring skipped; Redis writes still occur.
 * - The index key is a JSON array of record IDs sorted by recordedAt desc.
 *   Max index size is capped at MAX_INDEX_ENTRIES to bound Redis memory.
 * - Queries run client-side over the in-memory fetched records — no DB.
 */

import type { RedisState } from "./redis-state.js";
import type { R2Storage } from "./r2-storage.js";
import type { Telemetry } from "./telemetry.js";
import { log } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RunOutcome = "success" | "failure" | "aborted" | "canary-rollback";
export type RunComplexity = "cosmetic" | "low" | "medium" | "high" | "security" | "architecture";

export interface RunRecord {
  /** `{owner}/{repo}/{runId}` */
  id: string;
  runId: string;
  owner: string;
  repo: string;
  objective: string;
  complexity: RunComplexity;
  outcome: RunOutcome;
  /** Total wall-clock time for the full pipeline (ms). */
  durationMs: number;
  /** Number of times the Coder phase was retried before success/failure. */
  coderRetries: number;
  /** Warden rejection count for this run (0 if none). */
  wardenRejections: number;
  /** Confidence score at gate time (0-100). */
  gateConfidence: number;
  /** Files touched by the Coder. */
  targetFiles: string[];
  /** ISO timestamp. */
  recordedAt: string;
  /** Optional error summary for failure/aborted runs. */
  errorSummary?: string;
}

export interface HistoryQueryOptions {
  /** Filter by outcome. */
  outcome?: RunOutcome;
  /** Filter by complexity. */
  complexity?: RunComplexity;
  /** Only include records newer than this ISO date string. */
  since?: string;
  /** Maximum records to return (default 50). */
  limit?: number;
  /** Only include runs with coderRetries > this threshold. */
  minCoderRetries?: number;
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

const MAX_INDEX_ENTRIES = 500;
const REDIS_TTL_S       = 90 * 24 * 60 * 60; // 90 days
const R2_PREFIX         = "run-history/";

function indexKey(owner: string, repo: string): string {
  return `qodo:v24:history-index:${owner}:${repo}`;
}

function recordKey(owner: string, repo: string, runId: string): string {
  return `qodo:v24:history:${owner}:${repo}:${runId}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Persist a completed run record to Redis and optionally R2.
 * Best-effort: never throws.
 */
export async function saveRunRecord(
  record: RunRecord,
  state: RedisState,
  storage?: R2Storage,
  telemetry?: Telemetry,
): Promise<void> {
  try {
    // Write record
    const rKey = recordKey(record.owner, record.repo, record.runId);
    await state.setWithTTL(rKey, JSON.stringify(record), REDIS_TTL_S);

    // Update index (prepend, cap at MAX_INDEX_ENTRIES)
    const idxKey  = indexKey(record.owner, record.repo);
    const rawIdx  = await state.get(idxKey).catch(() => null);
    const idx: string[] = rawIdx ? (JSON.parse(rawIdx) as string[]) : [];
    const filtered = idx.filter((id) => id !== record.id);
    filtered.unshift(record.id);
    if (filtered.length > MAX_INDEX_ENTRIES) filtered.length = MAX_INDEX_ENTRIES;
    await state.setWithTTL(idxKey, JSON.stringify(filtered), REDIS_TTL_S);

    // R2 mirror (skip in privacy-strict mode)
    if (storage && process.env.QODO_PRIVACY_MODE !== "strict") {
      const r2Key = `${R2_PREFIX}${record.owner}/${record.repo}/${record.runId}.json`;
      await storage.putText(r2Key, JSON.stringify(record)).catch((e: unknown) => {
        log.warn("d1-history: R2 write failed (non-fatal)", { r2Key, error: e instanceof Error ? e.message : String(e) });
      });
    }

    await telemetry?.decision("d1-history", "record-saved", {
      runId: record.runId,
      outcome: record.outcome,
      durationMs: record.durationMs,
      coderRetries: record.coderRetries,
    });
  } catch (e: unknown) {
    log.warn("d1-history: saveRunRecord failed (non-fatal)", {
      runId: record.runId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Fetch and filter run history for a repo.
 * Returns records newest-first.
 */
export async function queryHistory(
  owner: string,
  repo: string,
  opts: HistoryQueryOptions,
  state: RedisState,
): Promise<RunRecord[]> {
  const { outcome, complexity, since, limit = 50, minCoderRetries } = opts;
  const sinceMs = since ? Date.parse(since) : 0;

  try {
    const idxKey = indexKey(owner, repo);
    const rawIdx = await state.get(idxKey).catch(() => null);
    if (!rawIdx) return [];

    const ids = JSON.parse(rawIdx) as string[];

    // Fetch in batches; stop once we have enough matching records
    const results: RunRecord[] = [];
    for (const id of ids) {
      if (results.length >= limit) break;

      // id = "{owner}/{repo}/{runId}"
      const parts = id.split("/");
      const runId = parts[2];
      if (!runId) continue;

      const raw = await state.get(recordKey(owner, repo, runId)).catch(() => null);
      if (!raw) continue;

      let rec: RunRecord;
      try {
        rec = JSON.parse(raw) as RunRecord;
      } catch {
        log.warn("d1-history: corrupted run record skipped", { owner, repo, runId });
        continue;
      }

      // Apply filters
      if (outcome     && rec.outcome     !== outcome)     continue;
      if (complexity  && rec.complexity  !== complexity)  continue;
      if (sinceMs     && Date.parse(rec.recordedAt) < sinceMs) continue;
      if (minCoderRetries !== undefined && rec.coderRetries <= minCoderRetries) continue;

      results.push(rec);
    }

    return results;
  } catch (e: unknown) {
    log.warn("d1-history: queryHistory failed", { owner, repo, error: e instanceof Error ? e.message : String(e) });
    return [];
  }
}

/**
 * Compute p50 / p95 pipeline latency (ms) from the last `sampleSize` runs.
 * Returns null when insufficient data is available.
 */
export async function computeLatencyPercentiles(
  owner: string,
  repo: string,
  sampleSize: number,
  state: RedisState,
): Promise<{ p50: number; p95: number } | null> {
  const records = await queryHistory(owner, repo, { limit: sampleSize }, state);
  if (records.length < 5) return null;

  const sorted = records.map((r) => r.durationMs).sort((a, b) => a - b);
  const p50idx  = Math.floor(sorted.length * 0.5);
  const p95idx  = Math.floor(sorted.length * 0.95);
  return { p50: sorted[p50idx], p95: sorted[p95idx] };
}
