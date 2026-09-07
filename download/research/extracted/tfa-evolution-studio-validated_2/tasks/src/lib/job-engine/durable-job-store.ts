/**
 * TFA Evolution Studio v28 — Durable Job Store
 *
 * File-backed, append-then-compact NDJSON store for compiler jobs.
 * Survives process restarts; supports resume, replay, and idempotency.
 *
 * Design:
 *   - Each mutation appends a record to <workspace>/jobs/<projectId>.ndjson
 *   - On load, records are replayed in order: last write per job ID wins
 *   - Compaction rewrites the log to one record per job (triggered at threshold)
 *   - Idempotency: createJob() with an existing idempotencyKey returns the
 *     existing job rather than spawning a duplicate
 */

import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { ensureDir, WORKSPACE_ROOT } from "@/lib/paths";
import type { CompilerJob, EvidenceNode, JobCheckpoint, RetryPolicy } from "@/lib/types";

const JOBS_DIR = path.join(WORKSPACE_ROOT, "jobs");
const COMPACTION_THRESHOLD = 500; // compact after this many lines per file

// ── Internal helpers ───────────────────────────────────────────────────────

function getJobsFile(projectId: string): string {
  ensureDir(JOBS_DIR);
  return path.join(JOBS_DIR, `${projectId}.ndjson`);
}

function getGlobalIndexFile(): string {
  ensureDir(JOBS_DIR);
  return path.join(JOBS_DIR, "_index.ndjson");
}

function appendRecord(filePath: string, record: CompilerJob): void {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, JSON.stringify(record) + "\n");
}

function replayFile(filePath: string): Map<string, CompilerJob> {
  const map = new Map<string, CompilerJob>();
  if (!fs.existsSync(filePath)) return map;
  const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      const job = JSON.parse(line) as CompilerJob;
      map.set(job.id, job);
    } catch {
      // corrupted line — skip
    }
  }
  return map;
}

function compactIfNeeded(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
  if (lines.length < COMPACTION_THRESHOLD) return;
  const map = replayFile(filePath);
  const compact = Array.from(map.values()).map((j) => JSON.stringify(j)).join("\n") + "\n";
  fs.writeFileSync(filePath, compact);
}

// ── Index: projectId → job IDs (for cross-project listing) ────────────────

interface IndexEntry {
  jobId: string;
  projectId: string;
  createdAt: string;
}

function appendIndex(entry: IndexEntry): void {
  const filePath = getGlobalIndexFile();
  fs.appendFileSync(filePath, JSON.stringify(entry) + "\n");
}

function loadIndex(): IndexEntry[] {
  const filePath = getGlobalIndexFile();
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l) as IndexEntry; } catch { return null; }
  }).filter((x): x is IndexEntry => x !== null);
}

// ── Public API ─────────────────────────────────────────────────────────────

export function durableCreateJob(
  projectId: string,
  opts: {
    targetId?: string;
    idempotencyKey?: string;
    retryPolicy?: RetryPolicy;
  } = {}
): CompilerJob {
  // Idempotency: return existing job if key already used
  if (opts.idempotencyKey) {
    const existing = findJobByIdempotencyKey(projectId, opts.idempotencyKey);
    if (existing) return existing;
  }

  const job: CompilerJob = {
    id: uuidv4(),
    projectId,
    status: "queued",
    progress: 0,
    createdAt: new Date().toISOString(),
    targetId: opts.targetId,
    logs: [],
    evidence: [],
    idempotencyKey: opts.idempotencyKey,
    retryCount: 0,
    retryPolicy: opts.retryPolicy ?? { maxRetries: 2, baseDelayMs: 2000, maxDelayMs: 30000 },
    executionId: uuidv4(),
  };

  const filePath = getJobsFile(projectId);
  appendRecord(filePath, job);
  appendIndex({ jobId: job.id, projectId, createdAt: job.createdAt });
  return job;
}

export function durableGetJob(jobId: string, projectId: string): CompilerJob | undefined {
  return replayFile(getJobsFile(projectId)).get(jobId);
}

export function durableGetJobAnywhere(jobId: string): CompilerJob | undefined {
  // Use index to find the project, then load
  const index = loadIndex();
  const entry = index.find((e) => e.jobId === jobId);
  if (!entry) return undefined;
  return replayFile(getJobsFile(entry.projectId)).get(jobId);
}

export function durableListJobs(projectId: string): CompilerJob[] {
  return Array.from(replayFile(getJobsFile(projectId)).values())
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function durableUpdateJob(
  jobId: string,
  projectId: string,
  updates: Partial<CompilerJob>
): CompilerJob | undefined {
  const jobs = replayFile(getJobsFile(projectId));
  const existing = jobs.get(jobId);
  if (!existing) return undefined;

  // V24: always stamp updatedAt so stuck-job detection can compare timestamps
  const updated: CompilerJob = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  if (
    updates.status === "completed" ||
    updates.status === "failed" ||
    updates.status === "cancelled" ||
    updates.status === "interrupted"
  ) {
    updated.completedAt = updated.completedAt ?? new Date().toISOString();
  }

  const filePath = getJobsFile(projectId);
  appendRecord(filePath, updated);
  compactIfNeeded(filePath);
  return updated;
}

export function durableSaveCheckpoint(
  jobId: string,
  projectId: string,
  checkpoint: JobCheckpoint
): CompilerJob | undefined {
  return durableUpdateJob(jobId, projectId, { checkpoint });
}

export function durableRecordEvidence(
  jobId: string,
  projectId: string,
  node: EvidenceNode
): CompilerJob | undefined {
  const jobs = replayFile(getJobsFile(projectId));
  const existing = jobs.get(jobId);
  if (!existing) return undefined;
    // misidentified as stuck by findStuckJobs(). Previously this function
  // built `updated` directly without calling durableUpdateJob, meaning
  // a job that was only appending evidence nodes (no status transition)
  // would never advance its updatedAt timestamp and would be flagged as
  // stuck after the threshold window despite making real progress.
  const updated: CompilerJob = {
    ...existing,
    evidence: [...existing.evidence, node],
    updatedAt: new Date().toISOString(),
  };
  const filePath = getJobsFile(projectId);
  appendRecord(filePath, updated);
  compactIfNeeded(filePath);
  return updated;
}

export function durableAppendLog(
  jobId: string,
  projectId: string,
  message: string
): CompilerJob | undefined {
  const jobs = replayFile(getJobsFile(projectId));
  const existing = jobs.get(jobId);
  if (!existing) return undefined;
  const updated: CompilerJob = {
    ...existing,
    logs: [...existing.logs, `[${new Date().toISOString()}] ${message}`],
  };
  const filePath = getJobsFile(projectId);
  appendRecord(filePath, updated);
  return updated;
}

export function durableMarkInterrupted(jobId: string, projectId: string): CompilerJob | undefined {
  return durableUpdateJob(jobId, projectId, {
    status: "interrupted",
    interruptedAt: new Date().toISOString(),
  });
}

export function durableMarkRetrying(
  jobId: string,
  projectId: string
): CompilerJob | undefined {
  const jobs = replayFile(getJobsFile(projectId));
  const existing = jobs.get(jobId);
  if (!existing) return undefined;
  return durableUpdateJob(jobId, projectId, {
    status: "retrying",
    retryCount: existing.retryCount + 1,
    executionId: uuidv4(),
    resumedAt: new Date().toISOString(),
  });
}

export function durableCanRetry(jobId: string, projectId: string): boolean {
  const job = durableGetJob(jobId, projectId);
  if (!job) return false;
  const maxRetries = job.retryPolicy?.maxRetries ?? 0;
  return job.retryCount < maxRetries;
}

export function durableGetInterruptedJobs(projectId: string): CompilerJob[] {
  return durableListJobs(projectId).filter(
    (j) => j.status === "interrupted" || j.status === "retrying"
  );
}

export function findJobByIdempotencyKey(
  projectId: string,
  idempotencyKey: string
): CompilerJob | undefined {
  return durableListJobs(projectId).find((j) => j.idempotencyKey === idempotencyKey);
}

export function durableReplayJobs(projectId: string): CompilerJob[] {
  // Returns all jobs in creation order — useful for audit replay
  const filePath = getJobsFile(projectId);
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
  const seen = new Map<string, CompilerJob>();
  for (const line of lines) {
    try {
      const job = JSON.parse(line) as CompilerJob;
      seen.set(job.id, job);
    } catch { /* skip */ }
  }
  return Array.from(seen.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}
