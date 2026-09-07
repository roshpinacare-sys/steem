/**
 * retry.ts — Generic retry with exponential back-off + jitter for Qodo V24.
 *
 * Provides a reusable `withRetry()` utility used by phase-runner.ts,
 * ai-router.ts, and any service that needs resilient async calls.
 *
 * Features:
 *  - Configurable max attempts, base delay, max delay
 *  - Full jitter (randomised within [0, computed delay]) to prevent thundering herd
 *  - Predicate function to control which errors are retryable
 *  - Per-attempt structured log output via logger.ts
 *  - onRetry hook for telemetry integration
 */

import { log } from "./logger.js";

export interface RetryOptions {
  /** Maximum number of attempts (including the first). Default: 4 */
  maxAttempts?: number;
  /** Base delay in ms before the first retry. Default: 500 */
  baseDelayMs?: number;
  /** Maximum delay cap in ms. Default: 30_000 */
  maxDelayMs?: number;
  /** Return true if the error should trigger a retry. Default: always retry. */
  isRetryable?: (err: unknown, attempt: number) => boolean;
  /** Called before each retry with attempt number and computed delay. */
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void | Promise<void>;
  /** Label for log output. */
  name?: string;
}

function computeDelay(attempt: number, baseMs: number, maxMs: number): number {
  // Exponential back-off: base * 2^attempt, capped, then full jitter
  const exponential = Math.min(baseMs * 2 ** attempt, maxMs);
  return Math.random() * exponential;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Execute `fn` with retry logic.
 * Throws the last error if all attempts are exhausted.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts  = 4,
    baseDelayMs  = 500,
    maxDelayMs   = 30_000,
    isRetryable  = () => true,
    onRetry,
    name         = "operation",
  } = opts;

  if (maxAttempts < 1) {
    throw new Error(`[retry] maxAttempts must be >= 1 (got ${maxAttempts}) for operation "${name}"`);
  }

  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;

      if (attempt === maxAttempts || !isRetryable(err, attempt)) {
        log.error(`[retry] ${name} failed permanently on attempt ${attempt}`, {
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }

      const delayMs = computeDelay(attempt, baseDelayMs, maxDelayMs);
      log.warn(`[retry] ${name} attempt ${attempt}/${maxAttempts} failed; retrying in ${Math.round(delayMs)}ms`, {
        error: err instanceof Error ? err.message : String(err),
      });

      if (onRetry) await onRetry(err, attempt, delayMs);
      await sleep(delayMs);
    }
  }

  throw lastErr;
}

// ---------------------------------------------------------------------------
// Convenience: HTTP-status-aware retryable predicate
// ---------------------------------------------------------------------------

/** Returns true for transient HTTP errors that are safe to retry. */
export function isHttpRetryable(err: unknown): boolean {
  if (err instanceof Error) {
    // Fetch network errors (no status)
    if (err.message.includes("ECONNRESET") || err.message.includes("ETIMEDOUT")) return true;
  }
  const status =
    (err as { status?: number })?.status ??
    (err as { response?: { status?: number } })?.response?.status;
  return status === 429 || status === 502 || status === 503 || status === 408 || status === 504;
}
