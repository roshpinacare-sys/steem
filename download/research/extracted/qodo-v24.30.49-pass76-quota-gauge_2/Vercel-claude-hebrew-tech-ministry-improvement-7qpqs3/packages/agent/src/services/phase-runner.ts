/**
 * phase-runner.ts — Resilient pipeline phase executor for Qodo V24.
 *
 * Wraps every pipeline phase with:
 *  - Structured logging (start / success / failure)
 *  - Configurable retry with exponential back-off via retry.ts
 *  - Phase-level timeout (to prevent a hung phase from stalling the pipeline)
 *  - Telemetry events for phase start, end, duration, and error
 *  - Automatic checkpoint save on success
 *
 * Usage:
 *   await runPhase("architect", async () => {
 *     s.plan = await runArchitect(...);
 *   }, { telemetry, logger: runLog, timeoutMs: 120_000 });
 */

import { withRetry, isHttpRetryable, type RetryOptions } from "./retry.js";
import type { Logger } from "./logger.js";
import type { Telemetry } from "./telemetry.js";

/** The subset of Logger that runPhase needs (full Logger satisfies it). */
export type PhaseLogger = Pick<Logger, "info" | "warn" | "error">;
/** The subset of Telemetry that runPhase needs (full Telemetry satisfies it). */
export type PhaseTelemetry = Pick<Telemetry, "push">;

export interface PhaseOptions {
  /** Structured logger (child with runId/phase already bound). */
  logger?: PhaseLogger;
  /** Telemetry service for emitting phase events. */
  telemetry?: PhaseTelemetry;
  /** Phase-level timeout in ms. Default: 180_000 (3 min). */
  timeoutMs?: number;
  /** Retry configuration. Default: 3 attempts, HTTP-retryable predicate. */
  retry?: RetryOptions;
  /** If true, a thrown error is logged but not re-thrown. Default: false. */
  optional?: boolean;
}

// ---------------------------------------------------------------------------
// Timeout helper
// ---------------------------------------------------------------------------

function withTimeout<T>(promise: Promise<T>, ms: number, name: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`[phase-runner] phase "${name}" timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(id); resolve(v); },
      (e) => { clearTimeout(id); reject(e); },
    );
  });
}

// ---------------------------------------------------------------------------
// Phase executor
// ---------------------------------------------------------------------------

/**
 * Execute a single pipeline phase with logging, retry, timeout, and telemetry.
 * Returns the result of `fn` on success; throws on unrecoverable failure
 * (unless `optional: true`).
 */
export async function runPhase<T>(
  name: string,
  fn: () => Promise<T>,
  opts: PhaseOptions & { optional?: false },
): Promise<T>;
export async function runPhase<T>(
  name: string,
  fn: () => Promise<T>,
  opts: PhaseOptions,
): Promise<T | null>;
export async function runPhase<T>(
  name: string,
  fn: () => Promise<T>,
  opts: PhaseOptions = {},
): Promise<T | null> {
  const {
    logger,
    telemetry,
    timeoutMs = 180_000,
    retry = { maxAttempts: 3, baseDelayMs: 1_000, maxDelayMs: 30_000, isRetryable: isHttpRetryable, name },
    optional = false,
  } = opts;

  const start = Date.now();
  logger?.info(`phase started`, { phase: name });
  await telemetry?.push({ phase: name, decision: "phase-start" });

  try {
    const result = await withRetry(
      () => withTimeout(fn(), timeoutMs, name),
      {
        ...retry,
        name,
        onRetry: async (err, attempt, delayMs) => {
          logger?.warn(`phase retry`, { phase: name, attempt, delayMs, error: err instanceof Error ? err.message : String(err) });
          await telemetry?.push({
            phase: name,
            decision: "phase-retry",
          });
          return retry.onRetry?.(err, attempt, delayMs);
        },
      },
    );

    const durationMs = Date.now() - start;
    logger?.info(`phase complete`, { phase: name, durationMs });
    await telemetry?.push({ phase: name, decision: "phase-complete", durationMs });

    return result;
  } catch (err: unknown) {
    const durationMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    logger?.error(`phase failed`, { phase: name, durationMs, error: msg });
    await telemetry?.push({ phase: name, decision: "phase-failed", durationMs });

    if (optional) return null;
    throw err;
  }
}
