/**
 * tests/policy/rate-limiter-lower-bound.test.ts — v386
 *
 * Covers the O(log n) lowerBound optimisation added to RateLimiter.check / prune:
 * all existing behaviour must be preserved because the only change is internal
 * (filter → slice(lowerBound(...))).
 *
 * HAPPY PATH   — large series: all in-window hits counted correctly at capacity.
 * EDGE CASE    — boundary conditions: all hits expired, all hits live,
 *                exactly-at-boundary (t === windowStart is NOT in window, t === windowStart+1 IS).
 * FAIL-CLOSED  — at-limit denial is still exact; sliding window restores capacity exactly.
 */
import { test, assert, eq } from "../_harness.mjs";
import { RateLimiter, tenantKey, actorKey } from "../../lib/policy/rate-limiter.ts";

test("lowerBound happy path: large series — capacity tracked correctly up to limit", () => {
  const limit = 50;
  const rl = new RateLimiter({ limit, windowMs: 10_000 });
  const k = tenantKey("t-large");
  // Fill exactly to the limit; each hit is 100 ms apart inside the 10 s window.
  for (let i = 0; i < limit; i++) {
    const v = rl.check(k, i * 100);
    eq(v.allowed, true, `hit ${i} should be allowed`);
  }
  // Next check at t=(limit * 100) must be denied: limit reached.
  const denied = rl.check(k, limit * 100);
  eq(denied.allowed, false, "denied when at capacity");
  eq(denied.remaining, 0, "remaining = 0 when at limit");
  // retryAfterMs is positive: oldest hit (t=0) + 10000 ms window.
  assert(denied.retryAfterMs > 0, "retryAfterMs > 0 on denial");
});

test("lowerBound edge case: all hits expired — full capacity restored", () => {
  const rl = new RateLimiter({ limit: 3, windowMs: 1_000 });
  const k = tenantKey("t-expire");
  // Three hits at t=0,1,2 — all inside window at t=0.
  rl.check(k, 0);
  rl.check(k, 1);
  rl.check(k, 2);
  // At t=2000, all hits (which expire at t=1001 at the latest) have slid out.
  const v = rl.check(k, 2_000);
  eq(v.allowed, true, "all expired — window is clear");
  eq(v.remaining, 2, "only one slot consumed by the new hit");
});

test("lowerBound edge case: exact boundary — t === windowStart excluded, t === windowStart+1 included", () => {
  // windowStart = nowMs - windowMs. A hit at exactly windowStart is NOT in window
  // (strictly-greater condition: t > windowStart required).
  const rl = new RateLimiter({ limit: 2, windowMs: 1_000 });
  const k = actorKey("t-boundary", "agent1");
  // Hit at t=0.
  rl.check(k, 0);
  // At nowMs=1000, windowStart=0. The hit at t=0 is NOT in window (0 > 0 is false).
  // So the window is empty and another hit is allowed.
  const v = rl.check(k, 1_000);
  eq(v.allowed, true, "hit at exactly windowStart edge is excluded (window slid past it)");
  // At nowMs=1001, windowStart=1. Hit at t=0 already excluded; hit at t=1000 IS in window.
  // One slot consumed → remaining=0 after adding this hit.
  const v2 = rl.check(k, 1_001);
  eq(v2.allowed, true, "1001: two hits total in window (t=1000, t=1001)");
  eq(v2.remaining, 0, "limit=2 reached");
  const denied = rl.check(k, 1_002);
  eq(denied.allowed, false, "denied: at capacity");
});

test("lowerBound fail-closed: sliding window restores capacity exactly when oldest hit exits", () => {
  // Mirror the existing sliding-window test with higher cardinality to exercise
  // the binary-search path through more elements.
  const rl = new RateLimiter({ limit: 5, windowMs: 1_000 });
  const k = tenantKey("t-slide");
  // Hit at t=0,200,400,600,800 — fill to limit.
  for (let i = 0; i < 5; i++) rl.check(k, i * 200);
  eq(rl.check(k, 900).allowed, false, "full at t=900");
  // At t=1001, the hit at t=0 has exited the window → one slot free.
  const v = rl.check(k, 1_001);
  eq(v.allowed, true, "capacity restored when oldest slides out");
  eq(v.remaining, 0, "still at limit after new hit recorded");
});
