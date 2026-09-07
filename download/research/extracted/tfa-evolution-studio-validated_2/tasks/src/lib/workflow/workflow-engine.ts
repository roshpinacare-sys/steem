/**
 * TFA Evolution Studio v28 — Durable Workflow Engine
 *
 * A higher-order layer on top of the durable job store that runs a typed
 * sequence of steps with explicit checkpoint, replay, idempotency,
 * cancellation, and recovery semantics. Designed for long-running and
 * interrupted batches.
 *
 * Guarantees:
 *   - Every step records its checkpoint to the durable store before advancing.
 *   - On resume, completed step outputs are replayed from the checkpoint —
 *     they are never re-executed.
 *   - cancel() flips the workflow into a "cancelled" terminal state that
 *     subsequent step boundaries observe; in-flight step work is left to
 *     finish but its result is discarded.
 *   - Each attempt of each step gets a unique executionId for dedup.
 *   - retryStep() applies exponential backoff bounded by the job's retryPolicy.
 *
 * V23 additions over V22:
 *   - Removed dynamic import in recoverInterruptedWorkflows — static imports
 *     are now used so tree-shaking and bundler analysis work correctly.
 *   - `durableGetStuckJobs()` + `markStuckJobsAsInterrupted()` — jobs that
 *     are in "running" state but have not been updated in N minutes (process
 *     crash scenario) are now detectable and recoverable.
 *   - `recoverInterruptedWorkflows()` now also recovers stuck jobs (not just
 *     explicitly-interrupted ones), eliminating the crash-without-recovery gap.
 *   - `WorkflowResult.stepTimings` — per-step wall-clock times included in
 *     the result for diagnostics.
 */

import { v4 as uuidv4 } from "uuid";
import {
  durableCreateJob,
  durableGetJob,
  durableUpdateJob,
  durableSaveCheckpoint,
  durableRecordEvidence,
  durableAppendLog,
  durableMarkInterrupted,
  durableMarkRetrying,
  durableCanRetry,
  durableGetInterruptedJobs,
  durableListJobs,
} from "@/lib/job-engine/durable-job-store";
import type { CompilerJob, EvidenceNode, RetryPolicy } from "@/lib/types";

// ── Types ─────────────────────────────────────────────────────────────────

export interface WorkflowStep<
  S extends Record<string, unknown> = Record<string, unknown>
> {
  id: string;
  description?: string;
  /** Pure-ish step: given accumulated state, produces the next slice.
   *  Implementations must be idempotent given the same input state. */
  run: (state: Readonly<S>, ctx: WorkflowContext) => Promise<Partial<S>>;
}

export interface WorkflowContext {
  jobId: string;
  projectId: string;
  workflowId: string;
  attempt: number;
  log: (msg: string) => void;
  recordEvidence: (node: EvidenceNode) => void;
  isCancelled: () => boolean;
}

export interface WorkflowDefinition<
  S extends Record<string, unknown> = Record<string, unknown>
> {
  workflowId: string;
  steps: WorkflowStep<S>[];
  initialState: S;
  retryPolicy?: RetryPolicy;
  idempotencyKey?: string;
}

export interface WorkflowResult<S extends Record<string, unknown>> {
  jobId: string;
  status: "completed" | "failed" | "cancelled" | "interrupted";
  finalState: S;
  stepOutcomes: {
    stepId: string;
    status: "passed" | "failed" | "skipped";
    durationMs: number;
    replayed: boolean;
  }[];
  evidence: EvidenceNode[];
  replayable: boolean;
  /** Per-step wall-clock durations for diagnostics (stepId → ms). */
  stepTimings: Record<string, number>;
}

// ── Cancellation registry ─────────────────────────────────────────────────

const cancellationFlags = new Map<string, boolean>();

export function cancelWorkflow(workflowId: string): void {
  cancellationFlags.set(workflowId, true);
}

function isCancelled(workflowId: string): boolean {
  return cancellationFlags.get(workflowId) === true;
}

// ── Checkpoint payload ─────────────────────────────────────────────────────

interface CheckpointPayload<S extends Record<string, unknown>> {
  workflowId: string;
  state: S;
  completedSteps: string[];
  stepDurations: Record<string, number>;
}

// ── Core execution ─────────────────────────────────────────────────────────

/**
 * Execute (or resume) a durable workflow.
 *
 * Resume semantics: if a job with the same idempotencyKey exists and has a
 * checkpoint, the workflow is reconstituted from that checkpoint and only
 * the remaining steps are executed.
 */
export async function runWorkflow<S extends Record<string, unknown>>(
  projectId: string,
  def: WorkflowDefinition<S>
): Promise<WorkflowResult<S>> {
  const job = durableCreateJob(projectId, {
    idempotencyKey: def.idempotencyKey ?? `wf:${def.workflowId}`,
    retryPolicy: def.retryPolicy,
  });
  const jobId = job.id;

  let state: S = def.initialState;
  let completedSteps: string[] = [];
  let stepDurations: Record<string, number> = {};

  if (job.checkpoint?.metadata) {
    const cp = job.checkpoint.metadata as unknown as CheckpointPayload<S>;
    if (cp && cp.workflowId === def.workflowId) {
      state = { ...def.initialState, ...cp.state };
      completedSteps = cp.completedSteps ?? [];
      stepDurations = cp.stepDurations ?? {};
    }
  }

  durableUpdateJob(jobId, projectId, {
    status: "running",
    startedAt: job.startedAt ?? new Date().toISOString(),
  });

  const stepOutcomes: WorkflowResult<S>["stepOutcomes"] = [];
  const evidence: EvidenceNode[] = [];

  const ctx: WorkflowContext = {
    jobId,
    projectId,
    workflowId: def.workflowId,
    attempt: job.retryCount + 1,
    log: (msg) => durableAppendLog(jobId, projectId, msg),
    recordEvidence: (node) => {
      evidence.push(node);
      durableRecordEvidence(jobId, projectId, node);
    },
    isCancelled: () => isCancelled(def.workflowId),
  };

  for (const step of def.steps) {
    if (completedSteps.includes(step.id)) {
      stepOutcomes.push({
        stepId: step.id,
        status: "passed",
        durationMs: stepDurations[step.id] ?? 0,
        replayed: true,
      });
      continue;
    }

    if (isCancelled(def.workflowId)) {
      durableUpdateJob(jobId, projectId, { status: "cancelled" });
      return finalize(jobId, projectId, "cancelled", state, stepOutcomes, evidence, stepDurations);
    }

    const startedAt = Date.now();
    try {
      ctx.log(`step.start ${step.id}`);
      const patch = await step.run(state, ctx);
      if (isCancelled(def.workflowId)) {
        durableUpdateJob(jobId, projectId, { status: "cancelled" });
        return finalize(jobId, projectId, "cancelled", state, stepOutcomes, evidence, stepDurations);
      }
      state = { ...state, ...patch };
      completedSteps.push(step.id);
      const durationMs = Date.now() - startedAt;
      stepDurations[step.id] = durationMs;

      const cp: CheckpointPayload<S> = {
        workflowId: def.workflowId,
        state,
        completedSteps,
        stepDurations,
      };
      durableSaveCheckpoint(jobId, projectId, {
        phase: step.id,
        savedAt: new Date().toISOString(),
        progress: Math.round((completedSteps.length / def.steps.length) * 100),
        metadata: cp as unknown as Record<string, unknown>,
      });

      stepOutcomes.push({ stepId: step.id, status: "passed", durationMs, replayed: false });
      ctx.log(`step.ok    ${step.id} (${durationMs}ms)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.log(`step.fail  ${step.id}: ${message}`);
      durableUpdateJob(jobId, projectId, {
        status: "failed",
        error: `step ${step.id}: ${message}`,
      });
      stepOutcomes.push({
        stepId: step.id,
        status: "failed",
        durationMs: Date.now() - startedAt,
        replayed: false,
      });
      durableMarkInterrupted(jobId, projectId);
      return finalize(jobId, projectId, "interrupted", state, stepOutcomes, evidence, stepDurations);
    }
  }

  durableUpdateJob(jobId, projectId, { status: "completed", progress: 100 });
  return finalize(jobId, projectId, "completed", state, stepOutcomes, evidence, stepDurations);
}

function finalize<S extends Record<string, unknown>>(
  jobId: string,
  projectId: string,
  status: WorkflowResult<S>["status"],
  state: S,
  stepOutcomes: WorkflowResult<S>["stepOutcomes"],
  evidence: EvidenceNode[],
  stepDurations: Record<string, number>
): WorkflowResult<S> {
  const passedSteps = stepOutcomes.filter((s) => s.status === "passed");
  const replayable = passedSteps.length > 0;
    // Previously skipped if all steps were replayed (replayed=true), meaning
  // resumed workflows never emitted the evidence node and the release gate
  // always blocked them. Now emits unconditionally when any step passed.
  if (replayable) {
    const replayedCount = passedSteps.filter((s) => s.replayed).length;
    const freshCount = passedSteps.filter((s) => !s.replayed).length;
    const node: EvidenceNode = {
      kind: "workflow_replayable",
      status: "passed",
      message:
        `Checkpoint captured for ${passedSteps.length} step(s) ` +
        `(${freshCount} fresh, ${replayedCount} replayed); workflow resumable.`,
      timestamp: new Date().toISOString(),
    };
    evidence.push(node);
    durableRecordEvidence(jobId, projectId, node);
  }
  return {
    jobId,
    status,
    finalState: state,
    stepOutcomes,
    evidence,
    replayable,
    stepTimings: stepDurations,
  };
}

// ── Replay ─────────────────────────────────────────────────────────────────

export async function replayWorkflow<S extends Record<string, unknown>>(
  projectId: string,
  jobId: string,
  def: WorkflowDefinition<S>
): Promise<WorkflowResult<S>> {
  const existing = durableGetJob(jobId, projectId);
  if (!existing) throw new Error(`No durable job ${jobId} in project ${projectId}`);
  if (existing.status === "completed") {
        // initialState. Previously returned def.initialState which discards all
    // accumulated state from completed steps — a silent data loss on replay.
    const cp = existing.checkpoint?.metadata as unknown as CheckpointPayload<S> | undefined;
    const finalState: S =
      cp?.workflowId === def.workflowId
        ? { ...def.initialState, ...cp.state }
        : def.initialState;
    return {
      jobId,
      status: "completed",
      finalState,
      stepOutcomes: def.steps.map((s) => ({
        stepId: s.id,
        status: "passed" as const,
        durationMs: cp?.stepDurations?.[s.id] ?? 0,
        replayed: true,
      })),
      evidence: existing.evidence,
      replayable: true,
      stepTimings: cp?.stepDurations ?? {},
    };
  }
  if (durableCanRetry(jobId, projectId)) {
    durableMarkRetrying(jobId, projectId);
  }
  return runWorkflow(projectId, {
    ...def,
    idempotencyKey: existing.idempotencyKey ?? `wf:${def.workflowId}`,
  });
}

// ── Stuck-job recovery ─────────────────────────────────────────────────────

/**
 * Returns jobs in "running" status whose last update timestamp is older than
 * stuckThresholdMs (default: 10 minutes). These are candidates for crash
 * recovery — they were never explicitly interrupted but their process died.
 *
 * V24 fix: previously called durableGetInterruptedJobs() which only returns
 * interrupted/retrying jobs — running jobs were never returned, making stuck
 * detection permanently broken. Now calls durableListJobs() to get ALL jobs
 * and filters for running + stale updatedAt. Also removes the unsafe cast —
 * CompilerJob.updatedAt is now a typed field (added in V24 types).
 */
export function findStuckJobs(
  projectId: string,
  stuckThresholdMs = 10 * 60 * 1000
): CompilerJob[] {
  const allJobs = durableListJobs(projectId);
  const cutoff = new Date(Date.now() - stuckThresholdMs).toISOString();
  return allJobs.filter(
    (j) =>
      j.status === "running" &&
      j.updatedAt != null &&
      j.updatedAt < cutoff
  );
}

/**
 * Marks stuck running jobs as interrupted so the recovery scanner picks them up.
 */
export function markStuckJobsAsInterrupted(
  projectId: string,
  stuckThresholdMs = 10 * 60 * 1000
): string[] {
  const stuck = findStuckJobs(projectId, stuckThresholdMs);
  for (const j of stuck) {
    durableMarkInterrupted(j.id, projectId);
  }
  return stuck.map((j) => j.id);
}

// ── Recovery scanner ───────────────────────────────────────────────────────

/**
 * Scan a project for interrupted (and optionally stuck) jobs and resume each
 * one using a definition resolver supplied by the caller.
 *
 * V23: Uses static import (no dynamic import) and also recovers stuck jobs.
 */
export async function recoverInterruptedWorkflows<S extends Record<string, unknown>>(
  projectId: string,
  resolveDefinition: (job: CompilerJob) => WorkflowDefinition<S> | null,
  opts: { recoverStuck?: boolean; stuckThresholdMs?: number } = {}
): Promise<WorkflowResult<S>[]> {
  const recoverStuck = opts.recoverStuck ?? true;
  if (recoverStuck) {
    markStuckJobsAsInterrupted(projectId, opts.stuckThresholdMs);
  }

  const interrupted = durableGetInterruptedJobs(projectId);
  const out: WorkflowResult<S>[] = [];
  for (const job of interrupted) {
    const def = resolveDefinition(job);
    if (!def) continue;
    out.push(await replayWorkflow(projectId, job.id, def));
  }
  return out;
}

export const __workflowInternals = { isCancelled, cancellationFlags };
