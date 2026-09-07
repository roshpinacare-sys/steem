/**
 * drain-trigger-queue.ts — the resume-loop consumer (ADR-005, NEXT-STEP IR4).
 *
 * Runs in GitHub Actions (`schedule:` cron → `cli.js --drain-trigger-queue`),
 * NOT in the Cloudflare Worker: `runPipeline` transitively depends on Node's
 * `fs` (sacred-file-integrity, audit-log, license-checker, …), which a Workers
 * isolate cannot provide, and `docs/INVARIANTS.md` classifies the Worker as a
 * dispatch boundary that never executes agent logic (D1).
 *
 * Each invocation:
 *   1. reap() — reconcile the processing list: complete acked items, requeue
 *      stale un-acked items, dead-letter poison messages.
 *   2. Drain loop — pop() one task at a time and dispatch a workflow_dispatch
 *      for the agent pipeline (carrying pr_number + task_id so the resumed run
 *      resumes the correct PR and writes its ack key). We do NOT block waiting
 *      for the ack: the dispatched run checkpoints minutes later, and the next
 *      scheduled drain tick reconciles it via reap(). The processing list is
 *      the durable in-flight set between ticks.
 *
 * The consumer is deliberately decoupled from GitHub and Redis specifics: it
 * takes a `TriggerQueue` and a `dispatch` callback, so the whole loop is
 * exercised offline against `InMemoryTriggerQueue` in resume-loop.test.ts.
 */
import type { TriggerQueue, TriggerTask } from "../services/trigger-queue.js";

export type DrainEvent =
  | "trigger.pop"
  | "trigger.dispatch"
  | "trigger.exception"
  | "trigger.complete"
  | "trigger.reaper.requeue"
  | "trigger.reaper.dead";

export interface DrainOptions {
  queue: TriggerQueue;
  /** Fire the pipeline for a popped task (e.g. workflow_dispatch). */
  dispatch: (task: TriggerTask) => Promise<void>;
  /** Structured telemetry sink; defaults to a no-op. */
  emit?: (event: DrainEvent, data: Record<string, unknown>) => void;
  /** Processing item older than this with no ack is stale. Default 15 min. */
  staleMs?: number;
  /** Attempts before dead-lettering. Default 3. */
  maxAttempts?: number;
  /** Safety cap on dispatches per invocation. Default 25. */
  maxBatch?: number;
  /** Cooperative cancellation. */
  signal?: AbortSignal;
}

export interface DrainSummary {
  dispatched: number;
  failed: number;
  completed: number;
  requeued: number;
  dead: number;
}

export async function drainTriggerQueue(opts: DrainOptions): Promise<DrainSummary> {
  const {
    queue,
    dispatch,
    emit = () => {},
    staleMs = 15 * 60 * 1000,
    maxAttempts = 3,
    maxBatch = 25,
    signal,
  } = opts;

  const summary: DrainSummary = { dispatched: 0, failed: 0, completed: 0, requeued: 0, dead: 0 };

  // 1. Reconcile before draining, so acked in-flight items are cleared and
  //    stale ones are back in the queue where this same run can pick them up.
  const reaped = await queue.reap({ staleMs, maxAttempts });
  summary.completed += reaped.completed.length;
  summary.requeued += reaped.requeued.length;
  summary.dead += reaped.dead.length;
  for (const taskId of reaped.completed) emit("trigger.complete", { taskId });
  for (const taskId of reaped.requeued) emit("trigger.reaper.requeue", { taskId });
  for (const taskId of reaped.dead) emit("trigger.reaper.dead", { taskId });

  // 2. Drain loop.
  while (!signal?.aborted && summary.dispatched + summary.failed < maxBatch) {
    const task = await queue.pop();
    if (!task) break; // empty queue → clean exit
    emit("trigger.pop", { taskId: task.taskId, owner: task.owner, repo: task.repo, prNumber: task.prNumber, trigger: task.trigger });
    try {
      await dispatch(task);
      summary.dispatched += 1;
      emit("trigger.dispatch", { taskId: task.taskId, prNumber: task.prNumber });
      // Intentionally no complete() here: the dispatched run writes the ack
      // key at its first checkpoint; the next reap() (this run's tail pass or a
      // later tick) removes it from processing. This is what makes a crash
      // between dispatch and checkpoint recoverable rather than silently lost.
    } catch (err) {
      summary.failed += 1;
      // Leave the task in the processing list; the reaper will requeue it once
      // it goes stale (or dead-letter it after maxAttempts).
      emit("trigger.exception", { taskId: task.taskId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return summary;
}
