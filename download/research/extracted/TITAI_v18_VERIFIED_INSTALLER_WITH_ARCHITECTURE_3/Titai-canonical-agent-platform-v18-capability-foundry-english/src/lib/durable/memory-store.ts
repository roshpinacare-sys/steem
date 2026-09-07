import type {
  DurableCheckpoint,
  DurableJob,
  DurableSnapshot,
  DurableStore,
  SideEffectReceipt,
} from "./types";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function assertLease(job: DurableJob, workerId: string, leaseToken: number, now: Date): void {
  if (!job.lease || job.lease.owner !== workerId || job.lease.token !== leaseToken) {
    throw new Error(`lease_not_owned:${job.id}`);
  }
  if (new Date(job.lease.expiresAt).getTime() <= now.getTime()) {
    throw new Error(`lease_expired:${job.id}`);
  }
}

export class MemoryDurableStore implements DurableStore {
  protected jobs = new Map<string, DurableJob>();
  protected receipts = new Map<string, SideEffectReceipt>();

  async createJob<TPayload>(job: DurableJob<TPayload>): Promise<void> {
    if (this.jobs.has(job.id)) throw new Error(`job_exists:${job.id}`);
    this.jobs.set(job.id, clone(job as DurableJob));
    await this.afterMutation();
  }

  async getJob<TPayload = unknown, TResult = unknown>(
    jobId: string,
  ): Promise<DurableJob<TPayload, TResult> | undefined> {
    const job = this.jobs.get(jobId);
    return job ? (clone(job) as DurableJob<TPayload, TResult>) : undefined;
  }

  async listJobs(): Promise<DurableJob[]> {
    return [...this.jobs.values()].map(clone);
  }

  async claimJob(
    jobId: string,
    workerId: string,
    now: Date,
    leaseMs: number,
  ): Promise<DurableJob | undefined> {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;
    if (["completed", "failed", "cancelled", "needs_reconciliation"].includes(job.status)) {
      return undefined;
    }
    if (new Date(job.availableAt).getTime() > now.getTime()) return undefined;
    const leaseLive = job.lease && new Date(job.lease.expiresAt).getTime() > now.getTime();
    if (leaseLive && job.lease?.owner !== workerId) return undefined;

    const isoNow = now.toISOString();
    job.status = "leased";
    job.attempt += 1;
    const nextToken = (job.lease?.token ?? 0) + 1;
    job.lease = {
      owner: workerId,
      token: nextToken,
      acquiredAt: leaseLive && job.lease?.owner === workerId ? job.lease.acquiredAt : isoNow,
      heartbeatAt: isoNow,
      expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
    };
    job.updatedAt = isoNow;
    await this.afterMutation();
    return clone(job);
  }

  async heartbeat(
    jobId: string,
    workerId: string,
    leaseToken: number,
    now: Date,
    leaseMs: number,
  ): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    try {
      assertLease(job, workerId, leaseToken, now);
    } catch {
      return false;
    }
    job.lease!.heartbeatAt = now.toISOString();
    job.lease!.expiresAt = new Date(now.getTime() + leaseMs).toISOString();
    job.updatedAt = now.toISOString();
    await this.afterMutation();
    return true;
  }

  async updateCheckpoint(
    jobId: string,
    workerId: string,
    leaseToken: number,
    checkpoint: DurableCheckpoint,
    now: Date,
  ): Promise<void> {
    const job = this.requireJob(jobId);
    assertLease(job, workerId, leaseToken, now);
    if (checkpoint.revision !== job.checkpoint.revision + 1) {
      throw new Error(
        `checkpoint_revision_conflict:${jobId}:${job.checkpoint.revision}:${checkpoint.revision}`,
      );
    }
    job.checkpoint = clone(checkpoint);
    job.updatedAt = now.toISOString();
    await this.afterMutation();
  }

  async completeJob(
    jobId: string,
    workerId: string,
    leaseToken: number,
    result: unknown,
    now: Date,
  ): Promise<void> {
    const job = this.requireJob(jobId);
    assertLease(job, workerId, leaseToken, now);
    job.status = "completed";
    job.result = clone(result);
    job.error = undefined;
    job.lease = undefined;
    job.updatedAt = now.toISOString();
    await this.afterMutation();
  }

  async failJob(
    jobId: string,
    workerId: string,
    leaseToken: number,
    error: string,
    now: Date,
  ): Promise<void> {
    const job = this.requireJob(jobId);
    assertLease(job, workerId, leaseToken, now);
    job.status = "failed";
    job.error = error;
    job.lease = undefined;
    job.updatedAt = now.toISOString();
    await this.afterMutation();
  }

  async markNeedsReconciliation(
    jobId: string,
    workerId: string,
    leaseToken: number,
    error: string,
    now: Date,
  ): Promise<void> {
    const job = this.requireJob(jobId);
    assertLease(job, workerId, leaseToken, now);
    job.status = "needs_reconciliation";
    job.error = error;
    job.lease = undefined;
    job.updatedAt = now.toISOString();
    await this.afterMutation();
  }

  async releaseJob(
    jobId: string,
    workerId: string,
    leaseToken: number,
    now: Date,
    delayMs = 0,
  ): Promise<void> {
    const job = this.requireJob(jobId);
    assertLease(job, workerId, leaseToken, now);
    job.status = "queued";
    job.availableAt = new Date(now.getTime() + delayMs).toISOString();
    job.lease = undefined;
    job.updatedAt = now.toISOString();
    await this.afterMutation();
  }

  async getReceipt(key: string): Promise<SideEffectReceipt | undefined> {
    const receipt = this.receipts.get(key);
    return receipt ? clone(receipt) : undefined;
  }

  async startReceipt(receipt: SideEffectReceipt): Promise<"created" | "exists"> {
    if (this.receipts.has(receipt.key)) return "exists";
    this.receipts.set(receipt.key, clone(receipt));
    await this.afterMutation();
    return "created";
  }

  async completeReceipt(key: string, output: unknown, now: Date): Promise<void> {
    const receipt = this.requireReceipt(key);
    if (receipt.status !== "started") {
      throw new Error(`receipt_not_started:${key}:${receipt.status}`);
    }
    receipt.status = "completed";
    receipt.output = clone(output);
    receipt.completedAt = now.toISOString();
    await this.afterMutation();
  }

  async failReceipt(key: string, error: string, now: Date): Promise<void> {
    const receipt = this.requireReceipt(key);
    if (receipt.status !== "started") {
      throw new Error(`receipt_not_started:${key}:${receipt.status}`);
    }
    receipt.status = "failed";
    receipt.error = error;
    receipt.completedAt = now.toISOString();
    await this.afterMutation();
  }

  async snapshot(now = new Date()): Promise<DurableSnapshot> {
    return {
      schemaVersion: 1,
      exportedAt: now.toISOString(),
      jobs: await this.listJobs(),
      receipts: [...this.receipts.values()].map(clone),
    };
  }

  async restore(snapshot: DurableSnapshot): Promise<void> {
    if (snapshot.schemaVersion !== 1) {
      throw new Error(`unsupported_snapshot_version:${snapshot.schemaVersion}`);
    }
    const jobs = new Map<string, DurableJob>();
    for (const job of snapshot.jobs) {
      if (jobs.has(job.id)) throw new Error(`duplicate_job_in_snapshot:${job.id}`);
      jobs.set(job.id, clone(job));
    }
    const receipts = new Map<string, SideEffectReceipt>();
    for (const receipt of snapshot.receipts) {
      if (receipts.has(receipt.key)) {
        throw new Error(`duplicate_receipt_in_snapshot:${receipt.key}`);
      }
      if (!jobs.has(receipt.jobId)) {
        throw new Error(`orphan_receipt_in_snapshot:${receipt.key}`);
      }
      receipts.set(receipt.key, clone(receipt));
    }
    this.jobs = jobs;
    this.receipts = receipts;
    await this.afterMutation();
  }

  protected async afterMutation(): Promise<void> {}

  protected requireJob(jobId: string): DurableJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`job_not_found:${jobId}`);
    return job;
  }

  protected requireReceipt(key: string): SideEffectReceipt {
    const receipt = this.receipts.get(key);
    if (!receipt) throw new Error(`receipt_not_found:${key}`);
    return receipt;
  }
}
