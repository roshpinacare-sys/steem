/**
 * src/http/rate-limiter.ts — in-house token-bucket rate limiter (zero dependencies).
 *
 * Per-tenant request throttling. Configurable window + maxRequests.
 * No external stores — pure in-memory Map. Suitable for single-process
 * deployments; multi-process requires a shared store (out of scope here).
 */

export interface RateLimitConfig {
  /** Time window in milliseconds. */
  windowMs: number;
  /** Maximum requests allowed per window. */
  maxRequests: number;
}

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60_000, // 1 minute
  maxRequests: 100,
};

export class TokenBucketRateLimiter {
  private buckets = new Map<string, Bucket>();
  private config: RateLimitConfig;
  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  /**
   * Attempt to consume one token for `key`.
   * Returns whether the request is allowed, remaining tokens, and reset timestamp.
   */
  consume(key: string, now = Date.now()): { allowed: boolean; remaining: number; resetAt: number } {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.config.maxRequests, lastRefill: now };
    }

    const elapsed = now - bucket.lastRefill;
    const windowsPassed = Math.floor(elapsed / this.config.windowMs);
    if (windowsPassed > 0) {
      bucket.tokens = Math.min(
        this.config.maxRequests,
        bucket.tokens + windowsPassed * this.config.maxRequests,
      );
      // Align to the window boundary, not to `now`. This ensures resetAt is
      // always a clean multiple of windowMs from the original epoch, preventing
      // the reset timestamp from drifting forward each time a request arrives
      // mid-window after one or more idle windows.
      bucket.lastRefill = bucket.lastRefill + windowsPassed * this.config.windowMs;
    }

    const resetAt = bucket.lastRefill + this.config.windowMs;
    if (bucket.tokens > 0) {
      bucket.tokens--;
      this.buckets.set(key, bucket);
      return { allowed: true, remaining: bucket.tokens, resetAt };
    }

    this.buckets.set(key, bucket);
    return { allowed: false, remaining: 0, resetAt };
  }

  /** Reset a specific key, or all keys if omitted. */
  reset(key?: string): void {
    if (key) this.buckets.delete(key);
    else this.buckets.clear();
  }

  /**
   * Evict buckets that have been idle for at least `idleWindowMultiple` full
   * windows (default: 1). A bucket is considered idle when it is full (tokens
   * === maxRequests) and its lastRefill is older than idleWindowMultiple *
   * windowMs before `now`.
   *
   * Call periodically (e.g. once per window) to bound Map memory in
   * long-running servers with many transient tenants. Evicting a full,
   * long-idle bucket is safe: the next request for that key will recreate it
   * with a fresh epoch — identical to the state it would have after natural
   * refill.
   *
   * Returns the number of entries removed.
   */
  evictStale(now = Date.now(), idleWindowMultiple = 1): number {
    const cutoff = now - idleWindowMultiple * this.config.windowMs;
    let removed = 0;
    for (const [key, bucket] of this.buckets) {
      // A bucket is safe to evict when its last activity was more than
      // `idleWindowMultiple` full windows ago. At that point, the next
      // request would refill it to full anyway — recreating it fresh is
      // identical in effect. We do NOT check token count: a partially-
      // consumed bucket whose window has fully expired has already "forgiven"
      // the earlier consumption, so evicting it is safe and avoids the
      // subtle bug where tokens < maxRequests would wrongly block eviction
      // for tenants that simply consumed once, then went idle for many hours.
      if (bucket.lastRefill <= cutoff) {
        this.buckets.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** Current number of tracked buckets (for monitoring / tests). */
  get size(): number {
    return this.buckets.size;
  }

  /** Exposed for tests / header generation. */
  getConfig(): RateLimitConfig {
    return { ...this.config };
  }
}

/** Build standard rate-limit response headers from a consumption result. */
export function buildRateLimitHeaders(
  config: RateLimitConfig,
  result: { allowed: boolean; remaining: number; resetAt: number },
): Record<string, string> {
  return {
    "x-ratelimit-limit": String(config.maxRequests),
    "x-ratelimit-remaining": String(result.remaining),
    "x-ratelimit-reset": String(Math.ceil(result.resetAt / 1000)),
  };
}
