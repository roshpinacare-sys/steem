/**
 * tests/policy/rate-limiter.test.ts — v248.
 * RateLimiter: multi-tenant sliding-window limiter (pilot-readiness gap #17).
 *
 *   FEATURE       allows up to `limit` per window, then denies with retryAfter.
 *   SLIDING       as old hits exit the window, capacity returns (no fixed-window burst).
 *   ISOLATION     tenant / actor / action keys are independent.
 *   FAIL-CLOSED   malformed key/time → denied; bad config throws.
 */
import { test, assert, eq } from "../_harness.mjs";
import { RateLimiter, tenantKey, actorKey, actionKey } from "../../lib/policy/rate-limiter.ts";

test("allows up to the limit, then denies with retryAfter", () => {
  const rl = new RateLimiter({ limit: 3, windowMs: 1000 });
  const k = tenantKey("t1");
  eq(rl.check(k, 0).allowed, true);
  eq(rl.check(k, 100).allowed, true);
  const third = rl.check(k, 200);
  eq(third.allowed, true); eq(third.remaining, 0);
  const denied = rl.check(k, 300);
  eq(denied.allowed, false);
  assert(denied.retryAfterMs > 0, "suggests a retry delay");
  eq(denied.resetAt, 0 + 1000, "window eases when oldest (t=0) exits");
});

test("sliding window returns capacity as old hits expire", () => {
  const rl = new RateLimiter({ limit: 2, windowMs: 1000 });
  const k = actorKey("t1", "agent7");
  eq(rl.check(k, 0).allowed, true);
  eq(rl.check(k, 500).allowed, true);
  eq(rl.check(k, 900).allowed, false, "full");
  // at t=1001 the first hit (t=0) has exited the window → capacity returns
  eq(rl.check(k, 1001).allowed, true, "capacity returned after window slid");
});

test("tenant / actor / action scopes are independent", () => {
  const rl = new RateLimiter({ limit: 1, windowMs: 1000 });
  eq(rl.check(tenantKey("t1"), 0).allowed, true);
  eq(rl.check(tenantKey("t2"), 0).allowed, true, "different tenant unaffected");
  eq(rl.check(actorKey("t1", "a1"), 0).allowed, true, "different scope unaffected");
  eq(rl.check(actionKey("t1", "db.migration"), 0).allowed, true);
  eq(rl.check(tenantKey("t1"), 1).allowed, false, "same tenant key now capped");
});

test("prune drops idle keys; trackedKeys reflects state", () => {
  const rl = new RateLimiter({ limit: 5, windowMs: 1000 });
  rl.check(tenantKey("t1"), 0);
  rl.check(tenantKey("t2"), 0);
  eq(rl.trackedKeys, 2);
  rl.prune(5000); // both windows long expired
  eq(rl.trackedKeys, 0, "idle keys pruned");
});

test("fail-closed: malformed key/time denied; bad config throws", () => {
  const rl = new RateLimiter({ limit: 2, windowMs: 1000 });
  eq(rl.check("", 0).allowed, false, "empty key denied");
  eq(rl.check(tenantKey("t1"), NaN).allowed, false, "NaN time denied");
  for (const bad of [{ limit: 0, windowMs: 1000 }, { limit: 2, windowMs: 0 }, { limit: 1.5, windowMs: 10 }]) {
    let threw = false;
    try { new RateLimiter(bad as any); } catch { threw = true; }
    assert(threw, `bad config ${JSON.stringify(bad)} throws`);
  }
});
