import "server-only";

/**
 * Minimal in-memory token bucket keyed by an arbitrary string (usually IP).
 * Suitable for the single-process deployment model; entries are pruned lazily.
 */

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const globalForRl = globalThis as unknown as {
  __titaiRateLimits?: Map<string, Bucket>;
};
const buckets = globalForRl.__titaiRateLimits ?? new Map<string, Bucket>();
globalForRl.__titaiRateLimits = buckets;

const MAX_ENTRIES = 10_000;

export interface RateLimitOptions {
  /** Max requests per window. */
  limit: number;
  /** Window length in ms. */
  windowMs: number;
}

/** Returns true when the request is allowed, false when rate-limited. */
export function checkRateLimit(
  key: string,
  { limit, windowMs }: RateLimitOptions,
): boolean {
  const now = Date.now();
  const refillPerMs = limit / windowMs;

  let bucket = buckets.get(key);
  if (!bucket) {
    if (buckets.size >= MAX_ENTRIES) {
      // Drop the stalest entries rather than growing unboundedly.
      const cutoff = now - windowMs * 2;
      for (const [k, b] of buckets) {
        if (b.updatedAt < cutoff) buckets.delete(k);
        if (buckets.size < MAX_ENTRIES) break;
      }
    }
    bucket = { tokens: limit, updatedAt: now };
    buckets.set(key, bucket);
  }

  // Refill.
  const elapsed = now - bucket.updatedAt;
  bucket.tokens = Math.min(limit, bucket.tokens + elapsed * refillPerMs);
  bucket.updatedAt = now;

  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

/** Extract a stable client key from a Request (best effort behind proxies). */
export function clientKey(req: Request): string {
  if (process.env.TRUST_PROXY_HEADERS === "true") {
    const fwd = req.headers.get("x-forwarded-for");
    if (fwd) return fwd.split(",")[0].trim();
    const real = req.headers.get("x-real-ip");
    if (real) return real;
  }
  const agent = req.headers.get("user-agent")?.slice(0, 120) ?? "unknown";
  return `direct:${agent}`;
}

/** Test hook. */
export function resetRateLimits(): void {
  buckets.clear();
}
