import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { checkRateLimit, resetRateLimits } from "@/lib/rate-limit";

describe("rate limit", () => {
  beforeEach(() => {
    resetRateLimits();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("allows up to the limit then blocks", () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit("k", { limit: 5, windowMs: 60_000 })).toBe(true);
    }
    expect(checkRateLimit("k", { limit: 5, windowMs: 60_000 })).toBe(false);
  });

  it("refills over time", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("k", { limit: 5, windowMs: 60_000 });
    expect(checkRateLimit("k", { limit: 5, windowMs: 60_000 })).toBe(false);
    vi.advanceTimersByTime(13_000); // > 1 token refilled (60s/5 = 12s per token)
    expect(checkRateLimit("k", { limit: 5, windowMs: 60_000 })).toBe(true);
  });

  it("keys are independent", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("a", { limit: 5, windowMs: 60_000 });
    expect(checkRateLimit("a", { limit: 5, windowMs: 60_000 })).toBe(false);
    expect(checkRateLimit("b", { limit: 5, windowMs: 60_000 })).toBe(true);
  });
});
