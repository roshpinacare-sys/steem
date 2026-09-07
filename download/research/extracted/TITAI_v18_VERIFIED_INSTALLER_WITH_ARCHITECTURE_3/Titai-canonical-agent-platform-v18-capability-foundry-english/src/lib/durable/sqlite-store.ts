import "server-only";
import { and, asc, eq, gt, inArray, lte, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type {
  DurableCheckpoint,
  DurableJob,
  DurableSnapshot,
  DurableStore,
  SideEffectReceipt,
} from "./types";

function toJob(row: typeof schema.durableJobs.$inferSelect): DurableJob {
  const lease = row.leaseOwner && row.leaseAcquiredAt && row.leaseExpiresAt && row.leaseHeartbeatAt
    ? {
        owner: row.leaseOwner,
        token: row.leaseToken,
        acquiredAt: row.leaseAcquiredAt.toISOString(),
        expiresAt: row.leaseExpiresAt.toISOString(),
        heartbeatAt: row.leaseHeartbeatAt.toISOString(),
      }
    : undefined;
  return {
    id: row.id,
    tenantId: row.tenantId ?? undefined,
    workspaceId: row.workspaceId ?? undefined,
    workflowName: row.workflowName,
    payload: structuredClone(row.payload),
    status: row.status,
    checkpoint: structuredClone(row.checkpoint),
    result: structuredClone(row.result),
    error: row.error ?? undefined,
    attempt: row.attempt,
    maxAttempts: row.maxAttempts,
    availableAt: row.availableAt.toISOString(),
    lease,
    createdAt: row.createdAt?.toISOString() ?? row.updatedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toReceipt(row: typeof schema.durableReceipts.$inferSelect): SideEffectReceipt {
  return {
    key: row.key,
    tenantId: row.tenantId ?? undefined,
    workspaceId: row.workspaceId ?? undefined,
    jobId: row.jobId,
    stepId: row.stepId,
    operation: row.operation,
    inputHash: row.inputHash,
    status: row.status,
    output: structuredClone(row.output),
    error: row.error ?? undefined,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString(),
    workerId: row.workerId,
  };
}

function assertLiveLease(
  row: typeof schema.durableJobs.$inferSelect,
  workerId: string,
  leaseToken: number,
  now: Date,
): void {
  if (row.status !== "leased" || row.leaseOwner !== workerId || row.leaseToken !== leaseToken) {
    throw new Error(`lease_not_owned:${row.id}`);
  }
  if (!row.leaseExpiresAt || row.leaseExpiresAt.getTime() <= now.getTime()) {
    throw new Error(`lease_expired:${row.id}`);
  }
}

/**
 * SQLite-backed durable store. Mutations use BEGIN IMMEDIATE through the
 * underlying better-sqlite3 client so lease and revision checks are serialized
 * across processes that share the same database file.
 */
export class SqliteDurableStore implements DurableStore {
  async createJob<TPayload>(job: DurableJob<TPayload>): Promise<void> {
    db.insert(schema.durableJobs)
      .values({
        id: job.id,
        tenantId: job.tenantId ?? null,
        workspaceId: job.workspaceId ?? null,
        workflowName: job.workflowName,
        payload: structuredClone(job.payload),
        status: job.status,
        checkpoint: structuredClone(job.checkpoint),
        result: structuredClone(job.result),
        error: job.error ?? null,
        attempt: job.attempt,
        maxAttempts: job.maxAttempts,
        availableAt: new Date(job.availableAt),
        leaseOwner: job.lease?.owner ?? null,
        leaseToken: job.lease?.token ?? 0,
        leaseAcquiredAt: job.lease ? new Date(job.lease.acquiredAt) : null,
        leaseExpiresAt: job.lease ? new Date(job.lease.expiresAt) : null,
        leaseHeartbeatAt: job.lease ? new Date(job.lease.heartbeatAt) : null,
        version: 0,
        createdAt: new Date(job.createdAt),
        updatedAt: new Date(job.updatedAt),
      })
      .run();
  }

  async getJob<TPayload = unknown, TResult = unknown>(
    jobId: string,
  ): Promise<DurableJob<TPayload, TResult> | undefined> {
    const row = db
      .select()
      .from(schema.durableJobs)
      .where(eq(schema.durableJobs.id, jobId))
      .get();
    return row ? (toJob(row) as DurableJob<TPayload, TResult>) : undefined;
  }

  async listJobs(): Promise<DurableJob[]> {
    return db
      .select()
      .from(schema.durableJobs)
      .orderBy(asc(schema.durableJobs.availableAt), asc(schema.durableJobs.createdAt))
      .all()
      .map(toJob);
  }

  async claimJob(
    jobId: string,
    workerId: string,
    now: Date,
    leaseMs: number,
  ): Promise<DurableJob | undefined> {
    const claim = db.$client.transaction(() => {
      const row = db
        .select()
        .from(schema.durableJobs)
        .where(eq(schema.durableJobs.id, jobId))
        .get();
      if (!row) return undefined;
      if (["completed", "failed", "cancelled", "needs_reconciliation"].includes(row.status)) {
        return undefined;
      }
      if (row.availableAt.getTime() > now.getTime()) return undefined;
      const leaseLive = !!row.leaseExpiresAt && row.leaseExpiresAt.getTime() > now.getTime();
      if (leaseLive && row.leaseOwner !== workerId) return undefined;

      const acquiredAt = leaseLive && row.leaseOwner === workerId && row.leaseAcquiredAt
        ? row.leaseAcquiredAt
        : now;
      const updated = db
        .update(schema.durableJobs)
        .set({
          status: "leased",
          attempt: row.attempt + 1,
          leaseOwner: workerId,
          leaseToken: row.leaseToken + 1,
          leaseAcquiredAt: acquiredAt,
          leaseHeartbeatAt: now,
          leaseExpiresAt: new Date(now.getTime() + leaseMs),
          updatedAt: now,
          version: row.version + 1,
        })
        .where(
          and(
            eq(schema.durableJobs.id, jobId),
            eq(schema.durableJobs.version, row.version),
          ),
        )
        .returning()
        .get();
      return updated ? toJob(updated) : undefined;
    });
    return claim.immediate();
  }

  async heartbeat(
    jobId: string,
    workerId: string,
    leaseToken: number,
    now: Date,
    leaseMs: number,
  ): Promise<boolean> {
    const tx = db.$client.transaction(() => {
      const row = db
        .select()
        .from(schema.durableJobs)
        .where(eq(schema.durableJobs.id, jobId))
        .get();
      if (!row) return false;
      try {
        assertLiveLease(row, workerId, leaseToken, now);
      } catch {
        return false;
      }
      const result = db
        .update(schema.durableJobs)
        .set({
          leaseHeartbeatAt: now,
          leaseExpiresAt: new Date(now.getTime() + leaseMs),
          updatedAt: now,
          version: row.version + 1,
        })
        .where(
          and(
            eq(schema.durableJobs.id, jobId),
            eq(schema.durableJobs.version, row.version),
          ),
        )
        .run();
      return result.changes === 1;
    });
    return tx.immediate();
  }

  async updateCheckpoint(
    jobId: string,
    workerId: string,
    leaseToken: number,
    checkpoint: DurableCheckpoint,
    now: Date,
  ): Promise<void> {
    const tx = db.$client.transaction(() => {
      const row = this.requireRow(jobId);
      assertLiveLease(row, workerId, leaseToken, now);
      if (checkpoint.revision !== row.checkpoint.revision + 1) {
        throw new Error(
          `checkpoint_revision_conflict:${jobId}:${row.checkpoint.revision}:${checkpoint.revision}`,
        );
      }
      const result = db
        .update(schema.durableJobs)
        .set({ checkpoint: structuredClone(checkpoint), updatedAt: now, version: row.version + 1 })
        .where(and(eq(schema.durableJobs.id, jobId), eq(schema.durableJobs.version, row.version)))
        .run();
      if (result.changes !== 1) throw new Error(`job_version_conflict:${jobId}`);
    });
    tx.immediate();
  }

  async completeJob(jobId: string, workerId: string, leaseToken: number, result: unknown, now: Date): Promise<void> {
    this.finishJob(jobId, workerId, leaseToken, now, {
      status: "completed",
      result: structuredClone(result),
      error: null,
    });
  }

  async failJob(jobId: string, workerId: string, leaseToken: number, error: string, now: Date): Promise<void> {
    this.finishJob(jobId, workerId, leaseToken, now, { status: "failed", error, result: null });
  }

  async markNeedsReconciliation(
    jobId: string,
    workerId: string,
    leaseToken: number,
    error: string,
    now: Date,
  ): Promise<void> {
    this.finishJob(jobId, workerId, leaseToken, now, {
      status: "needs_reconciliation",
      error,
      result: null,
    });
  }

  async releaseJob(jobId: string, workerId: string, leaseToken: number, now: Date, delayMs = 0): Promise<void> {
    const tx = db.$client.transaction(() => {
      const row = this.requireRow(jobId);
      assertLiveLease(row, workerId, leaseToken, now);
      const result = db
        .update(schema.durableJobs)
        .set({
          status: "queued",
          availableAt: new Date(now.getTime() + delayMs),
          leaseOwner: null,
          leaseAcquiredAt: null,
          leaseExpiresAt: null,
          leaseHeartbeatAt: null,
          updatedAt: now,
          version: row.version + 1,
        })
        .where(and(eq(schema.durableJobs.id, jobId), eq(schema.durableJobs.version, row.version)))
        .run();
      if (result.changes !== 1) throw new Error(`job_version_conflict:${jobId}`);
    });
    tx.immediate();
  }

  async getReceipt(key: string): Promise<SideEffectReceipt | undefined> {
    const row = db
      .select()
      .from(schema.durableReceipts)
      .where(eq(schema.durableReceipts.key, key))
      .get();
    return row ? toReceipt(row) : undefined;
  }

  async startReceipt(receipt: SideEffectReceipt): Promise<"created" | "exists"> {
    const result = db
      .insert(schema.durableReceipts)
      .values({
        key: receipt.key,
        tenantId: receipt.tenantId ?? null,
        workspaceId: receipt.workspaceId ?? null,
        jobId: receipt.jobId,
        stepId: receipt.stepId,
        operation: receipt.operation,
        inputHash: receipt.inputHash,
        status: receipt.status,
        output: structuredClone(receipt.output),
        error: receipt.error ?? null,
        startedAt: new Date(receipt.startedAt),
        completedAt: receipt.completedAt ? new Date(receipt.completedAt) : null,
        workerId: receipt.workerId,
      })
      .onConflictDoNothing({ target: schema.durableReceipts.key })
      .run();
    return result.changes === 1 ? "created" : "exists";
  }

  async completeReceipt(key: string, output: unknown, now: Date): Promise<void> {
    const result = db
      .update(schema.durableReceipts)
      .set({ status: "completed", output: structuredClone(output), error: null, completedAt: now })
      .where(and(eq(schema.durableReceipts.key, key), eq(schema.durableReceipts.status, "started")))
      .run();
    if (result.changes !== 1) throw new Error(`receipt_not_started:${key}`);
  }

  async failReceipt(key: string, error: string, now: Date): Promise<void> {
    const result = db
      .update(schema.durableReceipts)
      .set({ status: "failed", error, completedAt: now })
      .where(and(eq(schema.durableReceipts.key, key), eq(schema.durableReceipts.status, "started")))
      .run();
    if (result.changes !== 1) throw new Error(`receipt_not_started:${key}`);
  }

  async snapshot(now = new Date()): Promise<DurableSnapshot> {
    return {
      schemaVersion: 1,
      exportedAt: now.toISOString(),
      jobs: await this.listJobs(),
      receipts: db.select().from(schema.durableReceipts).all().map(toReceipt),
    };
  }

  async restore(snapshot: DurableSnapshot): Promise<void> {
    if (snapshot.schemaVersion !== 1) {
      throw new Error(`unsupported_snapshot_version:${snapshot.schemaVersion}`);
    }
    const jobIds = new Set<string>();
    for (const job of snapshot.jobs) {
      if (jobIds.has(job.id)) throw new Error(`duplicate_job_in_snapshot:${job.id}`);
      jobIds.add(job.id);
    }
    const receiptKeys = new Set<string>();
    for (const receipt of snapshot.receipts) {
      if (receiptKeys.has(receipt.key)) throw new Error(`duplicate_receipt_in_snapshot:${receipt.key}`);
      if (!jobIds.has(receipt.jobId)) throw new Error(`orphan_receipt_in_snapshot:${receipt.key}`);
      receiptKeys.add(receipt.key);
    }

    const restoreTx = db.$client.transaction(() => {
      db.delete(schema.durableReceipts).run();
      db.delete(schema.durableJobs).run();
      for (const job of snapshot.jobs) {
        db.insert(schema.durableJobs)
          .values({
            id: job.id,
            tenantId: job.tenantId ?? null,
            workspaceId: job.workspaceId ?? null,
            workflowName: job.workflowName,
            payload: structuredClone(job.payload),
            status: job.status,
            checkpoint: structuredClone(job.checkpoint),
            result: structuredClone(job.result),
            error: job.error ?? null,
            attempt: job.attempt,
            maxAttempts: job.maxAttempts,
            availableAt: new Date(job.availableAt),
            leaseOwner: job.lease?.owner ?? null,
            leaseToken: job.lease?.token ?? 0,
            leaseAcquiredAt: job.lease ? new Date(job.lease.acquiredAt) : null,
            leaseExpiresAt: job.lease ? new Date(job.lease.expiresAt) : null,
            leaseHeartbeatAt: job.lease ? new Date(job.lease.heartbeatAt) : null,
            version: job.checkpoint.revision,
            createdAt: new Date(job.createdAt),
            updatedAt: new Date(job.updatedAt),
          })
          .run();
      }
      for (const receipt of snapshot.receipts) {
        db.insert(schema.durableReceipts)
          .values({
            key: receipt.key,
            jobId: receipt.jobId,
            tenantId: receipt.tenantId ?? null,
            workspaceId: receipt.workspaceId ?? null,
            stepId: receipt.stepId,
            operation: receipt.operation,
            inputHash: receipt.inputHash,
            status: receipt.status,
            output: structuredClone(receipt.output),
            error: receipt.error ?? null,
            startedAt: new Date(receipt.startedAt),
            completedAt: receipt.completedAt ? new Date(receipt.completedAt) : null,
            workerId: receipt.workerId,
          })
          .run();
      }
    });
    restoreTx.immediate();
  }

  private finishJob(
    jobId: string,
    workerId: string,
    leaseToken: number,
    now: Date,
    patch: { status: "completed" | "failed" | "needs_reconciliation"; result: unknown; error: string | null },
  ): void {
    const tx = db.$client.transaction(() => {
      const row = this.requireRow(jobId);
      assertLiveLease(row, workerId, leaseToken, now);
      const result = db
        .update(schema.durableJobs)
        .set({
          ...patch,
          leaseOwner: null,
          leaseAcquiredAt: null,
          leaseExpiresAt: null,
          leaseHeartbeatAt: null,
          updatedAt: now,
          version: row.version + 1,
        })
        .where(and(eq(schema.durableJobs.id, jobId), eq(schema.durableJobs.version, row.version)))
        .run();
      if (result.changes !== 1) throw new Error(`job_version_conflict:${jobId}`);
    });
    tx.immediate();
  }

  private requireRow(jobId: string): typeof schema.durableJobs.$inferSelect {
    const row = db
      .select()
      .from(schema.durableJobs)
      .where(eq(schema.durableJobs.id, jobId))
      .get();
    if (!row) throw new Error(`job_not_found:${jobId}`);
    return row;
  }
}
