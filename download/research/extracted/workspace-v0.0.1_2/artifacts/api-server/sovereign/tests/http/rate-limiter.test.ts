import "../_flush.mjs";
/**
 * tests/http/rate-limiter.test.ts — unit tests for the in-house token-bucket rate limiter.
 */

import { test, assert, eq } from "../_harness.mjs";
import { TokenBucketRateLimiter, buildRateLimitHeaders } from "../../src/http/rate-limiter.ts";

// ─── Happy path ──────────────────────────────────────────────────────────────

test("TokenBucketRateLimiter allows requests up to maxRequests", () => {
  const limiter = new TokenBucketRateLimiter({ windowMs: 10_000, maxRequests: 3 });
  const r1 = limiter.consume("t1", 0);
  assert(r1.allowed, "first request should be allowed");
  eq(r1.remaining, 2);
  const r2 = limiter.consume("t1", 0);
  assert(r2.allowed, "second request should be allowed");
  eq(r2.remaining, 1);
  const r3 = limiter.consume("t1", 0);
  assert(r3.allowed, "third request should be allowed");
  eq(r3.remaining, 0);
});

test("TokenBucketRateLimiter blocks requests beyond maxRequests", () => {
  const limiter = new TokenBucketRateLimiter({ windowMs: 10_000, maxRequests: 2 });
  limiter.consume("t1", 0);
  limiter.consume("t1", 0);
  const r3 = limiter.consume("t1", 0);
  assert(!r3.allowed, "third request should be blocked");
  eq(r3.remaining, 0);
});

test("TokenBucketRateLimiter refills after window passes", () => {
  const limiter = new TokenBucketRateLimiter({ windowMs: 1_000, maxRequests: 1 });
  limiter.consume("t1", 0);
  const r2 = limiter.consume("t1", 500);
  assert(!r2.allowed, "should still be blocked mid-window");
  const r3 = limiter.consume("t1", 1_001);
  assert(r3.allowed, "should refill after windowMs elapsed");
  eq(r3.remaining, 0);
});

// ─── Isolation ─────────────────────────────────────────────────────────────────

test("TokenBucketRateLimiter isolates keys", () => {
  const limiter = new TokenBucketRateLimiter({ windowMs: 10_000, maxRequests: 1 });
  limiter.consume("t1", 0);
  const r2 = limiter.consume("t2", 0);
  assert(r2.allowed, "t2 should be independent of t1");
});

// ─── Reset ───────────────────────────────────────────────────────────────────

test("TokenBucketRateLimiter reset(key) clears only that key", () => {
  const limiter = new TokenBucketRateLimiter({ windowMs: 10_000, maxRequests: 1 });
  limiter.consume("t1", 0);
  limiter.reset("t1");
  const r = limiter.consume("t1", 0);
  assert(r.allowed, "t1 should be allowed after reset");
});

test("TokenBucketRateLimiter reset() clears all keys", () => {
  const limiter = new TokenBucketRateLimiter({ windowMs: 10_000, maxRequests: 1 });
  limiter.consume("t1", 0);
  limiter.consume("t2", 0);
  limiter.reset();
  assert(limiter.consume("t1", 0).allowed, "t1 should be allowed after global reset");
  assert(limiter.consume("t2", 0).allowed, "t2 should be allowed after global reset");
});

// ─── Headers ─────────────────────────────────────────────────────────────────

test("buildRateLimitHeaders returns correct fields", () => {
  const headers = buildRateLimitHeaders({ windowMs: 60_000, maxRequests: 10 }, { allowed: true, remaining: 7, resetAt: 65_000 });
  eq(headers["x-ratelimit-limit"], "10");
  eq(headers["x-ratelimit-remaining"], "7");
  eq(headers["x-ratelimit-reset"], "65"); // ceil(65000/1000)
});

// ─── Window-boundary alignment (v333 fix) ────────────────────────────────────
// Previously, lastRefill was set to `now` instead of the nearest window
// boundary, causing resetAt to drift by up to (windowMs - 1) ms.

test("resetAt is aligned to window boundary, not to request arrival time", () => {
  // Window: 1000ms, max: 5. First request at t=0, next at t=3500 (mid-4th window).
  const limiter = new TokenBucketRateLimiter({ windowMs: 1_000, maxRequests: 5 });
  limiter.consume("t1", 0); // tokens=4, lastRefill=0
  const r = limiter.consume("t1", 3_500); // 3 full windows elapsed
  // lastRefill must align to 3000 (3rd window boundary), not 3500
  // => resetAt = 3000 + 1000 = 4000 (not 4500)
  eq(r.resetAt, 4_000, `resetAt should be 4000 (window boundary), got ${r.resetAt}`);
  assert(r.allowed, "request after idle windows should be allowed");
});

test("resetAt is stable: two requests in same window share the same resetAt", () => {
  const limiter = new TokenBucketRateLimiter({ windowMs: 1_000, maxRequests: 5 });
  const r1 = limiter.consume("t1", 0);   // lastRefill=0, resetAt=1000
  const r2 = limiter.consume("t1", 400); // same window, resetAt still 1000
  eq(r1.resetAt, 1_000, "first request resetAt should be 1000");
  eq(r2.resetAt, 1_000, "second request in same window should share resetAt");
});

test("resetAt advances correctly across multiple idle windows (drift regression)", () => {
  // 5 idle windows should land lastRefill at exactly 5000, not at the late-arrival time.
  const limiter = new TokenBucketRateLimiter({ windowMs: 1_000, maxRequests: 2 });
  limiter.consume("t1", 0);         // exhaust: tokens=1
  limiter.consume("t1", 0);         // exhaust: tokens=0
  const blocked = limiter.consume("t1", 800);  // still in window, blocked
  assert(!blocked.allowed, "should be blocked mid-window");
  // After 5 full windows (t=5999), refill epoch should be 5000
  const r = limiter.consume("t1", 5_999);
  assert(r.allowed, "should be allowed after 5 windows");
  eq(r.resetAt, 6_000, `resetAt should align to window boundary 6000, got ${r.resetAt}`);
});

// ─── evictStale (v368) ────────────────────────────────────────────────────────

test("evictStale removes buckets whose window has fully expired (happy path)", () => {
  // Correct semantics: any bucket whose lastRefill is older than idleWindowMultiple * windowMs
  // can be safely evicted — the next request would refill it to full anyway.
  const lim = new TokenBucketRateLimiter({ windowMs: 1_000, maxRequests: 5 });
  lim.consume("a", 0);   // lastRefill=0, tokens=4
  lim.consume("b", 0);   // lastRefill=0, tokens=4
  lim.consume("c", 500); // lastRefill=500, tokens=4 (within same window, still fresh at t=1600)
  eq(lim.size, 3, "three buckets tracked");

  // At t=1600: cutoff = 1600 - 1000 = 600
  // a.lastRefill=0 ≤ 600 → evict; b.lastRefill=0 ≤ 600 → evict; c.lastRefill=500 ≤ 600 → evict
  const removed = lim.evictStale(1_600);
  eq(removed, 3, "all three buckets evicted after their windows expired");
  eq(lim.size, 0, "map is empty after eviction");
});

test("evictStale preserves buckets still within their active window", () => {
  const lim = new TokenBucketRateLimiter({ windowMs: 1_000, maxRequests: 5 });
  lim.consume("old",    0);   // lastRefill=0, expires at cutoff 0
  lim.consume("recent", 800); // lastRefill=800, still fresh at t=1600

  // At t=1600: cutoff=600. old.lastRefill=0 ≤ 600 → evict; recent.lastRefill=800 > 600 → keep
  const removed = lim.evictStale(1_600);
  eq(removed, 1, "only the expired bucket evicted");
  eq(lim.size, 1, "recent bucket preserved");
});

test("evictStale: size getter reflects current bucket count", () => {
  const lim = new TokenBucketRateLimiter({ windowMs: 1_000, maxRequests: 5 });
  eq(lim.size, 0, "empty limiter size=0");
  lim.consume("a", 0);
  lim.consume("b", 0);
  lim.consume("c", 0);
  eq(lim.size, 3, "three tenants tracked");
  lim.reset("b");
  eq(lim.size, 2, "size decrements after reset(key)");
  lim.reset();
  eq(lim.size, 0, "size=0 after reset()");
});

test("evictStale with idleWindowMultiple=2 applies wider cutoff", () => {
  const lim = new TokenBucketRateLimiter({ windowMs: 1_000, maxRequests: 5 });
  lim.consume("a", 0); // tokens=4, lastRefill=0 — not full, so never evictable anyway
  // With idleWindowMultiple=2, cutoff = now - 2000; verify no crash and returns 0
  const removed = lim.evictStale(1_500, 2);
  eq(removed, 0, "no full idle buckets with wider cutoff");
});
