/**
 * phase-runner.test.ts — regression tests for per-phase resilience.
 *
 * Validates:
 *  - Successful phases return their result and log/emit telemetry.
 *  - Hung phases are aborted by the configured timeout.
 *  - Transient HTTP-style errors are retried.
 *  - Non-retryable errors fail fast (no unnecessary retries).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runPhase } from "../src/services/phase-runner.js";

describe("runPhase", () => {
  const logs: unknown[] = [];
  const telemetryEvents: unknown[] = [];

  const logger = {
    info: vi.fn((...args: unknown[]) => logs.push(args)),
    warn: vi.fn((...args: unknown[]) => logs.push(args)),
    error: vi.fn((...args: unknown[]) => logs.push(args)),
    child: vi.fn(() => logger),
  };

  const telemetry = {
    push: vi.fn(async (evt: unknown) => {
      telemetryEvents.push(evt);
    }),
    decision: vi.fn(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    logs.length = 0;
    telemetryEvents.length = 0;
    vi.clearAllMocks();
  });

  it("returns the phase result on success", async () => {
    const promise = runPhase(
      "success-phase",
      async () => "done",
      { logger, telemetry, timeoutMs: 1_000, retry: { maxAttempts: 1 } },
    );
    const result = await promise;
    expect(result).toBe("done");
    expect(logger.info).toHaveBeenCalledWith("phase complete", expect.any(Object));
    expect(telemetry.push).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: "success-phase", decision: "phase-complete" }),
    );
  });

  it("times out a hung phase", async () => {
    const promise = runPhase(
      "hang-phase",
      async () => new Promise(() => {}), // never resolves
      { logger, telemetry, timeoutMs: 50, retry: { maxAttempts: 1 } },
    );
    // Consume the rejection eagerly so Node does not flag it as unhandled
    // while we advance the fake timer.
    promise.catch(() => {});

    // Advance far enough for the timeout to fire.
    await vi.advanceTimersByTimeAsync(100);

    await expect(promise).rejects.toThrow(/timed out after 50ms/);
    expect(logger.error).toHaveBeenCalledWith("phase failed", expect.any(Object));
    expect(telemetry.push).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: "hang-phase", decision: "phase-failed" }),
    );
  });

  it("retries transient HTTP-style errors and eventually succeeds", async () => {
    let calls = 0;
    const err = Object.assign(new Error("503 Service Unavailable"), { status: 503 });

    const promise = runPhase(
      "retry-phase",
      async () => {
        calls++;
        if (calls < 3) throw err;
        return "recovered";
      },
      {
        logger,
        telemetry,
        timeoutMs: 1_000,
        retry: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0, isRetryable: () => true },
      },
    );

    // Allow the zero-delay retries to settle.
    await vi.advanceTimersByTimeAsync(10);
    const result = await promise;

    expect(calls).toBe(3);
    expect(result).toBe("recovered");
    expect(logger.warn).toHaveBeenCalledWith("phase retry", expect.any(Object));
  });

  it("does not retry non-retryable errors", async () => {
    let calls = 0;
    const promise = runPhase(
      "fail-fast-phase",
      async () => {
        calls++;
        throw new Error("permanent failure");
      },
      {
        logger,
        telemetry,
        timeoutMs: 1_000,
        retry: { maxAttempts: 3, isRetryable: () => false },
      },
    );

    await expect(promise).rejects.toThrow("permanent failure");
    expect(calls).toBe(1);
  });

  it("returns null for optional phases instead of throwing", async () => {
    const result = await runPhase(
      "optional-phase",
      async () => {
        throw new Error("soft failure");
      },
      {
        logger,
        telemetry,
        timeoutMs: 1_000,
        retry: { maxAttempts: 1, isRetryable: () => false },
        optional: true,
      },
    );

    expect(result).toBeNull();
    expect(logger.error).toHaveBeenCalledWith("phase failed", expect.any(Object));
  });
});
