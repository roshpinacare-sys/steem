import { createId } from "@/lib/ids";
import { sha256 } from "./canonical-json";
import { DurablePauseError } from "./types";
import type {
  DurableJob,
  DurableRunOptions,
  DurableRunOutcome,
  DurableStep,
  DurableStepContext,
  DurableStore,
  DurableWorkflow,
  SideEffectReceipt,
} from "./types";

export class InjectedCrashError extends Error {
  constructor(public readonly point: string) {
    super(`injected_crash:${point}`);
    this.name = "InjectedCrashError";
  }
}

export interface CreateDurableJobOptions<TPayload> {
  id?: string;
  payload: TPayload;
  maxAttempts?: number;
  tenantId?: string;
  workspaceId?: string;
  now?: Date;
}

export class DurableWorkflowEngine<TPayload, TResult> {
  constructor(
    private readonly store: DurableStore,
    private readonly workflow: DurableWorkflow<TPayload, TResult>,
  ) {
    const ids = new Set<string>();
    for (const step of workflow.steps) {
      if (!step.id.trim()) throw new Error("durable_step_id_required");
      if (ids.has(step.id)) throw new Error(`duplicate_durable_step:${step.id}`);
      ids.add(step.id);
    }
  }

  async createJob(options: CreateDurableJobOptions<TPayload>): Promise<DurableJob<TPayload>> {
    const now = options.now ?? new Date();
    const job: DurableJob<TPayload> = {
      id: options.id ?? createId(),
      tenantId: options.tenantId,
      workspaceId: options.workspaceId,
      workflowName: this.workflow.name,
      payload: structuredClone(options.payload),
      status: "queued",
      checkpoint: {
        nextStepIndex: 0,
        outputs: {},
        completedStepIds: [],
        revision: 0,
      },
      attempt: 0,
      maxAttempts: options.maxAttempts ?? 5,
      availableAt: now.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await this.store.createJob(job);
    return job;
  }

  async run(jobId: string, options: DurableRunOptions): Promise<DurableRunOutcome> {
    const now = options.now ?? (() => new Date());
    const leaseMs = options.leaseMs ?? 30_000;
    const signal = options.signal ?? new AbortController().signal;
    const claimed = await this.store.claimJob(jobId, options.workerId, now(), leaseMs);
    if (!claimed) return { status: "lease_unavailable" };
    const leaseToken = claimed.lease?.token;
    if (!leaseToken) throw new Error(`lease_token_missing:${jobId}`);

    try {
      await options.faultInjector?.({
        point: "after_claim",
        jobId,
        workerId: options.workerId,
      });

      const job = await this.requireJob(jobId);
      if (job.attempt > job.maxAttempts) {
        const error = `max_attempts_exceeded:${job.attempt}:${job.maxAttempts}`;
        await this.store.failJob(jobId, options.workerId, leaseToken, error, now());
        return { status: "failed", job: await this.requireJob(jobId), error };
      }

      for (
        let index = job.checkpoint.nextStepIndex;
        index < this.workflow.steps.length;
        index += 1
      ) {
        if (signal.aborted) throw new Error("durable_run_cancelled");
        const step = this.workflow.steps[index];
        await options.faultInjector?.({
          point: "before_step",
          jobId,
          stepId: step.id,
          workerId: options.workerId,
        });
        await this.store.heartbeat(jobId, options.workerId, leaseToken, now(), leaseMs);

        const current = await this.requireJob(jobId);
        const context: DurableStepContext<TPayload> = {
          jobId,
          workerId: options.workerId,
          leaseToken,
          payload: current.payload,
          outputs: current.checkpoint.outputs,
          signal,
        };

        const output =
          step.kind === "side_effect"
            ? await this.executeSideEffect(step, context, options, now)
            : await step.run(context);
        if (step.kind === "idempotent") {
          await options.faultInjector?.({
            point: "after_idempotent_step",
            jobId,
            stepId: step.id,
            workerId: options.workerId,
          });
        }

        const refreshed = await this.requireJob(jobId);
        const checkpoint = {
          nextStepIndex: index + 1,
          outputs: { ...refreshed.checkpoint.outputs, [step.id]: output },
          completedStepIds: [...refreshed.checkpoint.completedStepIds, step.id],
          revision: refreshed.checkpoint.revision + 1,
        };
        await this.store.updateCheckpoint(
          jobId,
          options.workerId,
          leaseToken,
          checkpoint,
          now(),
        );
        await options.faultInjector?.({
          point: "after_checkpoint",
          jobId,
          stepId: step.id,
          workerId: options.workerId,
        });
      }

      await options.faultInjector?.({
        point: "before_complete",
        jobId,
        workerId: options.workerId,
      });
      const finished = await this.requireJob(jobId);
      const result = this.workflow.buildResult(finished.checkpoint.outputs, finished.payload);
      await this.store.completeJob(jobId, options.workerId, leaseToken, result, now());
      return { status: "completed", job: await this.requireJob(jobId) };
    } catch (error) {
      if (error instanceof InjectedCrashError) throw error;
      if (error instanceof DurablePauseError) {
        const current = await this.requireJob(jobId);
        if (current.status === "leased") {
          await this.store.releaseJob(jobId, options.workerId, leaseToken, now(), error.retryAfterMs);
        }
        return { status: "waiting", job: await this.requireJob(jobId), reason: error.reason };
      }
      const message = error instanceof Error ? error.message : "durable_run_failed";
      const current = await this.requireJob(jobId);
      if (current.status === "needs_reconciliation") {
        return { status: "needs_reconciliation", job: current, error: message };
      }
      if (current.status === "leased") {
        await this.store.failJob(jobId, options.workerId, leaseToken, message, now());
      }
      return { status: "failed", job: await this.requireJob(jobId), error: message };
    }
  }

  private async executeSideEffect(
    step: DurableStep<TPayload>,
    context: DurableStepContext<TPayload>,
    options: DurableRunOptions,
    now: () => Date,
  ): Promise<unknown> {
    const input = step.idempotencyInput?.(context) ?? {
      payload: context.payload,
      outputs: context.outputs,
    };
    const inputHash = sha256(input);
    const key = sha256({
      workflow: this.workflow.name,
      jobId: context.jobId,
      stepId: step.id,
      operation: step.operation,
      inputHash,
    });
    const existing = await this.store.getReceipt(key);
    if (existing) {
      if (existing.inputHash !== inputHash) {
        throw new Error(`idempotency_input_mismatch:${step.id}`);
      }
      if (existing.status === "completed") return existing.output;
      if (existing.status === "started" || existing.status === "unknown") {
        const message = `side_effect_outcome_unknown:${step.id}:${key}`;
        await this.store.markNeedsReconciliation(
          context.jobId,
          context.workerId,
          context.leaseToken,
          message,
          now(),
        );
        throw new Error(message);
      }
      if (existing.status === "failed") {
        throw new Error(existing.error ?? `side_effect_failed:${step.id}`);
      }
    }

    const receipt: SideEffectReceipt = {
      key,
      jobId: context.jobId,
      stepId: step.id,
      operation: step.operation,
      inputHash,
      status: "started",
      startedAt: now().toISOString(),
      workerId: context.workerId,
      tenantId: (await this.requireJob(context.jobId)).tenantId,
      workspaceId: (await this.requireJob(context.jobId)).workspaceId,
    };
    const created = await this.store.startReceipt(receipt);
    if (created === "exists") {
      return this.executeSideEffect(step, context, options, now);
    }
    await options.faultInjector?.({
      point: "after_receipt_started",
      jobId: context.jobId,
      stepId: step.id,
      workerId: context.workerId,
    });

    try {
      const output = await step.run(context);
      await this.store.completeReceipt(key, output, now());
      await options.faultInjector?.({
        point: "after_side_effect",
        jobId: context.jobId,
        stepId: step.id,
        workerId: context.workerId,
      });
      return output;
    } catch (error) {
      if (error instanceof InjectedCrashError) throw error;
      const message = error instanceof Error ? error.message : "side_effect_failed";
      await this.store.failReceipt(key, message, now());
      throw error;
    }
  }

  private async requireJob(jobId: string): Promise<DurableJob<TPayload, TResult>> {
    const job = await this.store.getJob<TPayload, TResult>(jobId);
    if (!job) throw new Error(`job_not_found:${jobId}`);
    if (job.workflowName !== this.workflow.name) {
      throw new Error(`workflow_mismatch:${job.workflowName}:${this.workflow.name}`);
    }
    return job;
  }
}
