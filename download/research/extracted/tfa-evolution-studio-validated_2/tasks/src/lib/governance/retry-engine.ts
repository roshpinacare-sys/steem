/**
 * TFA Evolution Studio v28 — Retry Engine
 *
 * Policy-driven retry with exponential backoff.
 */

export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export async function withRetry<T>(fn: () => Promise<T>, policy: RetryPolicy): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (e) {
      attempt++;
      if (attempt > policy.maxRetries) throw e;
      const delay = Math.min(policy.baseDelayMs * Math.pow(2, attempt - 1), policy.maxDelayMs);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
