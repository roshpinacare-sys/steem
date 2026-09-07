/**
 * lib/jobs/types.ts — TFA Resilient Job-Queue: shared types.
 *
 * Multi-instance safe: the claim() operation is atomic (SELECT FOR UPDATE
 * SKIP LOCKED semantics). Only one worker instance can claim a job at a time.
 * Other workers skip locked jobs rather than wait — no thundering herd.
 *
 * At-least-once delivery: a claimed job that is never acked or nacked will
 * be re-queued after a visibility timeout (like SQS). Workers must be
 * idempotent.
 *
 * Tenant isolation: every job carries tenantId; workers can filter by tenant.
 */

/** ISO-8601 timestamp string. */
export type ISOTimestamp = string;

/** Unique job id. */
export type JobId = string;

export type JobStatus =
  | "queued"      // Waiting to be claimed
  | "claimed"     // Currently being processed by a worker
  | "done"        // Successfully completed (acked)
  | "failed";     // Permanently failed (max retries exhausted or explicit nack)

/** Priority: lower number = higher priority. Default 5. */
export type JobPriority = number;

/**
 * Job<T> — a unit of work.
 * T is the payload type; the queue is opaque to payload structure.
 */
export interface Job<T = unknown> {
  id: JobId;
  tenantId: string;
  /** Hierarchical dot-notation type, e.g. "email.welcome", "billing.invoice.generate". */
  type: string;
  payload: T;
  priority: JobPriority;
  /** Max attempts before the job is permanently failed. */
  maxAttempts: number;
  /** Attempts made so far (including current if claimed). */
  attempts: number;
  status: JobStatus;
  /** Which worker instance currently holds this job. Null if not claimed. */
  claimedBy: string | null;
  /** When the claim expires (unix ms). After this, the job can be re-claimed. */
  claimExpiresAt: number | null;
  /** Human-readable error from the last failure. */
  lastError: string | null;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
  /** When the job became done/failed. */
  completedAt: ISOTimestamp | null;
}

// ─── JobQueue interface ───────────────────────────────────────────────────────

export interface EnqueueOptions {
  priority?: JobPriority;
  maxAttempts?: number;
  /** Delay claim availability by N milliseconds (schedule in the future). */
  delayMs?: number;
}

export interface ClaimResult<T = unknown> {
  job: Job<T>;
  /** Call this when the job completes successfully. */
  ack: () => void;
  /** Call this when the job fails. Increments attempt count; may re-queue. */
  nack: (error?: string) => void;
}

/**
 * JobQueue — the single interface all services use to enqueue and process jobs.
 *
 * Contract:
 * - `enqueue` writes atomically (no external side effects).
 * - `claim` is the atomic SELECT FOR UPDATE SKIP LOCKED equivalent:
 *   returns ONE unclaimed job for the given worker, or null if none available.
 *   Claimed jobs are locked for `visibilityTimeoutMs`; other callers skip them.
 * - `ack` marks job done. `nack` records failure and either re-queues or fails.
 * - `reapExpiredClaims` recovers jobs whose claim timeout has passed (simulates
 *   the visibility timeout of SQS / a cron job in Postgres).
 */
export interface JobQueue {
  /** Enqueue a new job. Returns the job id. */
  enqueue<T>(
    tenantId: string,
    type: string,
    payload: T,
    options?: EnqueueOptions,
  ): string;

  /**
   * Claim one job — atomic, SKIP LOCKED semantics.
   * Returns null if no unclaimed jobs are available for the given filter.
   * `workerId` identifies the claiming worker instance (for observability).
   */
  claim<T = unknown>(
    workerId: string,
    options?: {
      tenantId?: string;
      type?: string;
    },
  ): ClaimResult<T> | null;

  /** Count of jobs by status, optionally filtered by tenantId. */
  counts(tenantId?: string): Record<JobStatus, number>;

  /** Peek at queued jobs without claiming them. */
  listQueued(tenantId?: string, limit?: number): Job[];

  /** All permanently failed jobs. */
  listFailed(tenantId?: string): Job[];

  /**
   * Recover jobs whose visibility timeout has expired.
   * In production this is run periodically by a cron worker.
   * Returns the number of jobs recovered back to "queued".
   */
  reapExpiredClaims(): number;
}
