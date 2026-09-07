import type { DurableRunOptions, DurableRunOutcome, DurableStore } from "./types";

export interface RunnableDurableEngine {
  run(jobId: string, options: DurableRunOptions): Promise<DurableRunOutcome>;
}

export interface DurableWorkerOptions {
  workerId: string;
  leaseMs?: number;
  now?: () => Date;
  signal?: AbortSignal;
  maxJobsPerPass?: number;
}

export interface DurableWorkerPassResult {
  inspected: number;
  dispatched: number;
  outcomes: Array<{ jobId: string; outcome: DurableRunOutcome }>;
  unknownWorkflows: Array<{ jobId: string; workflowName: string }>;
}

/**
 * A bounded, pull-based worker pass. Scheduling is intentionally explicit:
 * callers decide whether to run once, use a timer, or attach it to a service.
 */
export class DurableWorker {
  constructor(
    private readonly store: DurableStore,
    private readonly engines: Readonly<Record<string, RunnableDurableEngine>>,
  ) {}

  async runOnce(options: DurableWorkerOptions): Promise<DurableWorkerPassResult> {
    const now = options.now ?? (() => new Date());
    const maxJobs = Math.max(1, Math.min(options.maxJobsPerPass ?? 8, 100));
    const jobs = (await this.store.listJobs())
      .filter((job) => {
        if (["completed", "failed", "cancelled", "needs_reconciliation"].includes(job.status)) {
          return false;
        }
        if (new Date(job.availableAt).getTime() > now().getTime()) return false;
        if (job.lease && new Date(job.lease.expiresAt).getTime() > now().getTime()) {
          return job.lease.owner === options.workerId;
        }
        return true;
      })
      .sort((a, b) => {
        const available = a.availableAt.localeCompare(b.availableAt);
        return available !== 0 ? available : a.createdAt.localeCompare(b.createdAt);
      });

    const result: DurableWorkerPassResult = {
      inspected: jobs.length,
      dispatched: 0,
      outcomes: [],
      unknownWorkflows: [],
    };

    for (const job of jobs.slice(0, maxJobs)) {
      if (options.signal?.aborted) break;
      const engine = this.engines[job.workflowName];
      if (!engine) {
        result.unknownWorkflows.push({ jobId: job.id, workflowName: job.workflowName });
        continue;
      }
      const outcome = await engine.run(job.id, {
        workerId: options.workerId,
        leaseMs: options.leaseMs,
        now,
        signal: options.signal,
      });
      result.dispatched += 1;
      result.outcomes.push({ jobId: job.id, outcome });
    }
    return result;
  }
}
