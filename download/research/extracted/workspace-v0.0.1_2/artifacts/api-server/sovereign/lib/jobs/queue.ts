/**
 * lib/jobs/queue.ts — InMemoryQueue: JobQueue implementation.
 *
 * SKIP LOCKED semantics:
 *   claim() iterates the store in priority+FIFO order and returns the first
 *   job that is "queued" and available (not locked). It atomically sets
 *   claimedBy and claimExpiresAt before returning — so a concurrent call
 *   from another "worker" will skip it. Because Node is single-threaded,
 *   claim() is already atomic in-process. For multi-process deployments,
 *   the production implementation uses:
 *       SELECT id FROM jobs
 *       WHERE status='queued' AND available_at <= NOW()
 *       ORDER BY priority, created_at
 *       LIMIT 1
 *       FOR UPDATE SKIP LOCKED
 *   — the interface is identical, only the backing store changes.
 *
 * Visibility timeout:
 *   If a worker claims a job but never acks/nacks (crashes), the claim
 *   expires after visibilityTimeoutMs. reapExpiredClaims() returns those
 *   jobs to "queued" for another worker to pick up.
 */

import type {
  Job,
  JobId,
  JobStatus,
  JobQueue,
  EnqueueOptions,
  ClaimResult,
} from "./types.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function nowMs(): number {
  return Date.now();
}

function generateId(): string {
  return crypto.randomUUID();
}

// ─── Internal job record (extends Job with scheduling metadata) ───────────────

interface InternalJob<T = unknown> extends Job<T> {
  /** Earliest time (unix ms) when this job can be claimed. */
  availableAt: number;
}

// ─── InMemoryQueue ────────────────────────────────────────────────────────────

export class InMemoryQueue implements JobQueue {
  /** job id → InternalJob */
  private readonly store = new Map<JobId, InternalJob>();

  /** How long (ms) a claimed job is locked before it can be re-claimed. */
  private readonly visibilityTimeoutMs: number;

  /** Default max attempts for new jobs. */
  private readonly defaultMaxAttempts: number;

  /** Default priority for new jobs. */
  private readonly defaultPriority: number;

  constructor(
    options: {
      visibilityTimeoutMs?: number;
      defaultMaxAttempts?: number;
      defaultPriority?: number;
    } = {},
  ) {
    this.visibilityTimeoutMs = options.visibilityTimeoutMs ?? 30_000; // 30 s
    this.defaultMaxAttempts = options.defaultMaxAttempts ?? 3;
    this.defaultPriority = options.defaultPriority ?? 5;
  }

  // ── enqueue ─────────────────────────────────────────────────────────────────

  enqueue<T>(
    tenantId: string,
    type: string,
    payload: T,
    options: EnqueueOptions = {},
  ): string {
    if (!tenantId) throw new Error("JobQueue.enqueue: tenantId is required");
    if (!type) throw new Error("JobQueue.enqueue: type is required");
    if (payload === undefined) {
      throw new Error("JobQueue.enqueue: payload is required (use null for empty payload)");
    }

    const id = generateId();
    const ts = now();
    const availableAt = nowMs() + (options.delayMs ?? 0);

    const job: InternalJob<T> = {
      id,
      tenantId,
      type,
      payload,
      priority: options.priority ?? this.defaultPriority,
      maxAttempts: options.maxAttempts ?? this.defaultMaxAttempts,
      attempts: 0,
      status: "queued",
      claimedBy: null,
      claimExpiresAt: null,
      lastError: null,
      createdAt: ts,
      updatedAt: ts,
      completedAt: null,
      availableAt,
    };

    this.store.set(id, job as InternalJob);
    return id;
  }

  // ── claim (SKIP LOCKED) ─────────────────────────────────────────────────────

  claim<T = unknown>(
    workerId: string,
    options: { tenantId?: string; type?: string } = {},
  ): ClaimResult<T> | null {
    if (!workerId) throw new Error("JobQueue.claim: workerId is required");

    const ms = nowMs();

    // Single-pass min-find: priority ASC (lower = higher priority), then
    // createdAt ASC (FIFO) — equivalent ordering to filter+sort+[0], but
    // O(n) instead of O(n log n) and without materializing a candidates
    // array. claim() runs on every worker poll, so this stays a hot path.
    let best: InternalJob | null = null;
    for (const j of this.store.values()) {
      if (j.status !== "queued") continue;
      if (j.availableAt > ms) continue;                               // delayed
      if (options.tenantId && j.tenantId !== options.tenantId) continue;
      if (options.type && j.type !== options.type) continue;
      if (
        best === null ||
        j.priority < best.priority ||
        (j.priority === best.priority && j.createdAt < best.createdAt)
      ) {
        best = j;
      }
    }

    if (best === null) return null;

    // SKIP LOCKED: take the best available (already filtered to only "queued").
    // The atomic update happens here — before returning to the caller.
    const job = best as InternalJob<T>;
    job.status = "claimed";
    job.claimedBy = workerId;
    job.claimExpiresAt = ms + this.visibilityTimeoutMs;
    job.attempts += 1;
    job.updatedAt = now();

    // Capture the id for closure — safe even if the map entry is mutated later.
    const jobId = job.id;

    const ack = (): void => {
      const j = this.store.get(jobId);
      if (!j || j.status !== "claimed") return; // already completed or reaped
      j.status = "done";
      j.claimedBy = null;
      j.claimExpiresAt = null;
      j.updatedAt = now();
      j.completedAt = now();
    };

    const nack = (error?: string): void => {
      const j = this.store.get(jobId);
      if (!j || j.status !== "claimed") return;
      j.claimedBy = null;
      j.claimExpiresAt = null;
      j.lastError = error ?? "nacked";
      j.updatedAt = now();

      if (j.attempts >= j.maxAttempts) {
        j.status = "failed";
        j.completedAt = now();
      } else {
        // Re-queue for retry.
        j.status = "queued";
      }
    };

    return { job: { ...job } as Job<T>, ack, nack };
  }

  // ── counts ──────────────────────────────────────────────────────────────────

  counts(tenantId?: string): Record<JobStatus, number> {
    const result: Record<JobStatus, number> = {
      queued: 0,
      claimed: 0,
      done: 0,
      failed: 0,
    };
    for (const j of this.store.values()) {
      if (tenantId && j.tenantId !== tenantId) continue;
      result[j.status] += 1;
    }
    return result;
  }

  // ── listQueued ───────────────────────────────────────────────────────────────

  listQueued(tenantId?: string, limit = 50): Job[] {
    const result: Job[] = [];
    for (const j of this.store.values()) {
      if (j.status !== "queued") continue;
      if (tenantId && j.tenantId !== tenantId) continue;
      result.push({ ...j });
      if (result.length >= limit) break;
    }
    return result;
  }

  // ── listFailed ───────────────────────────────────────────────────────────────

  listFailed(tenantId?: string): Job[] {
    const result: Job[] = [];
    for (const j of this.store.values()) {
      if (j.status !== "failed") continue;
      if (tenantId && j.tenantId !== tenantId) continue;
      result.push({ ...j });
    }
    return result;
  }

  // ── reapExpiredClaims ────────────────────────────────────────────────────────

  reapExpiredClaims(): number {
    const ms = nowMs();
    let reaped = 0;
    for (const j of this.store.values()) {
      if (j.status === "claimed" && j.claimExpiresAt !== null && j.claimExpiresAt <= ms) {
        j.status = "queued";
        j.claimedBy = null;
        j.claimExpiresAt = null;
        j.updatedAt = now();
        reaped++;
      }
    }
    return reaped;
  }
}
