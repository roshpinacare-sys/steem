import { describe, it, expect, beforeEach } from "vitest";
import { CostTracker } from "../src/services/cost-tracker.js";

describe("CostTracker", () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker();
  });

  it("starts with zero totals", () => {
    const t = tracker.totals();
    expect(t.tokens.totalTokens).toBe(0);
    expect(t.estimatedUsdCents).toBe(0);
    expect(t.callCount).toBe(0);
  });

  it("records a groq fast call correctly", () => {
    tracker.record("groq", "llama-3.1-8b-instant", "fast", {
      prompt_tokens: 1000,
      completion_tokens: 500,
      total_tokens: 1500,
    });
    const t = tracker.totals();
    expect(t.tokens.totalTokens).toBe(1500);
    expect(t.callCount).toBe(1);
    expect(t.estimatedUsdCents).toBeGreaterThan(0);
  });

  it("estimates cost in genuine USD cents (Bug 17-E regression)", () => {
    // 1000 input + 1000 output tokens on the 8b model should cost 0.013 cents
    // (= 0.005 + 0.008). Previously the pricing table stored dollars-per-1k,
    // so estimatedUsdCents contained dollars and the PR cost alert never fired.
    tracker.record("groq", "llama-3.1-8b-instant", "fast", {
      prompt_tokens: 1000,
      completion_tokens: 1000,
      total_tokens: 2000,
    });
    const t = tracker.totals();
    expect(t.estimatedUsdCents).toBeCloseTo(0.013, 6);
  });

  it("accumulates multiple calls", () => {
    tracker.record("groq", "llama-3.1-8b-instant", "fast", { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 });
    tracker.record("groq", "llama-3.3-70b-versatile", "heavy", { prompt_tokens: 200, completion_tokens: 300, total_tokens: 500 });
    const t = tracker.totals();
    expect(t.callCount).toBe(2);
    expect(t.tokens.totalTokens).toBe(700);
  });

  it("infers total_tokens when not provided", () => {
    tracker.record("groq", "llama-3.1-8b-instant", "fast", {
      prompt_tokens: 300,
      completion_tokens: 200,
    });
    expect(tracker.totals().tokens.totalTokens).toBe(500);
  });

  it("toTelemetryPayload returns correct structure", () => {
    tracker.record("openrouter", "openrouter", "heavy", { prompt_tokens: 400, completion_tokens: 600, total_tokens: 1000 });
    const payload = tracker.toTelemetryPayload();
    expect(payload).toHaveProperty("totalTokens", 1000);
    expect(payload).toHaveProperty("callCount", 1);
    expect(payload).toHaveProperty("breakdown");
    expect(Array.isArray(payload.breakdown)).toBe(true);
  });

  it("reset clears all entries", () => {
    tracker.record("groq", "llama-3.1-8b-instant", "fast", { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 });
    tracker.reset();
    expect(tracker.totals().callCount).toBe(0);
    expect(tracker.totals().tokens.totalTokens).toBe(0);
  });

  it("breakdown returns a copy (immutable)", () => {
    tracker.record("groq", "llama-3.1-8b-instant", "fast", { total_tokens: 100 });
    const bd = tracker.breakdown();
    bd.pop();
    expect(tracker.breakdown().length).toBe(1);
  });
});
