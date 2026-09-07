/**
 * retry.test.ts — Unit tests for the retry utility.
 */
import { describe, it, expect, vi } from "vitest";
import { withRetry, isHttpRetryable } from "../src/services/retry.js";

describe("withRetry", () => {
  it("returns immediately on success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { maxAttempts: 3, name: "test" });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and eventually succeeds", async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 3) throw Object.assign(new Error("transient"), { status: 429 });
      return "recovered";
    });
    const result = await withRetry(fn, { maxAttempts: 4, baseDelayMs: 1, name: "test" });
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws after exhausting all attempts", async () => {
    const fn = vi.fn().mockRejectedValue(Object.assign(new Error("always-fail"), { status: 503 }));
    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 1, name: "test" }))
      .rejects.toThrow("always-fail");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry when isRetryable returns false", async () => {
    const err = new Error("fatal");
    const fn = vi.fn().mockRejectedValue(err);
    await expect(
      withRetry(fn, { maxAttempts: 5, baseDelayMs: 1, isRetryable: () => false, name: "test" })
    ).rejects.toThrow("fatal");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("calls onRetry hook with correct arguments", async () => {
    const onRetry = vi.fn();
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      if (++calls < 2) throw Object.assign(new Error("x"), { status: 429 });
      return "done";
    });
    await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1, onRetry, name: "test" });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][1]).toBe(1); // attempt number
  });

  it("throws a clear error when maxAttempts is 0 (Bug 14-D regression)", async () => {
    const fn = vi.fn().mockResolvedValue("should-not-run");
    await expect(withRetry(fn, { maxAttempts: 0, name: "zero-attempts" }))
      .rejects.toThrow(/maxAttempts must be >= 1/);
    expect(fn).not.toHaveBeenCalled();
  });

  it("throws a clear error when maxAttempts is negative (Bug 14-D regression)", async () => {
    const fn = vi.fn();
    await expect(withRetry(fn, { maxAttempts: -5, name: "neg-attempts" }))
      .rejects.toThrow(/maxAttempts must be >= 1/);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("isHttpRetryable", () => {
  it.each([429, 502, 503, 408, 504])("returns true for status %i", (status) => {
    expect(isHttpRetryable({ status })).toBe(true);
  });

  it.each([400, 401, 403, 404, 422])("returns false for status %i", (status) => {
    expect(isHttpRetryable({ status })).toBe(false);
  });

  it("returns true for ECONNRESET errors", () => {
    expect(isHttpRetryable(new Error("ECONNRESET"))).toBe(true);
  });
});
