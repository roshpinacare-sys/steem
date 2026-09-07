/**
 * retry-double-execution.test.ts  — Task-29
 *
 * Adversarial suite for the retry/circuit-breaker double-execution safety.
 *
 * The class of bug being tested:
 *   `withRetry` wraps operations that may have side-effects (e.g. GitHub API
 *   writes). If a network response is slow enough that the timeout fires and
 *   triggers a retry, but the original request actually succeeded and is still
 *   in-flight, the write can execute twice. This is especially dangerous for
 *   non-idempotent operations: `createComment`, `mergePR`, `commitViaGitDB`
 *   against a ref that has already been advanced.
 *
 * Strategy:
 *  1. Confirm `withRetry` does NOT retry on success (no double-execution on
 *     the happy path).
 *  2. Confirm `withRetry` does NOT retry non-retryable errors (HTTP 4xx).
 *  3. Simulate a slow-then-succeed response where the timeout races: verify
 *     the first call "wins" and the second is not initiated (because the
 *     first returned before maxAttempts was reached).
 *  4. Verify that `commitViaGitDB`-style ref-update conflict (HTTP 409 /
 *     422) is correctly NOT retried — it indicates the ref has already
 *     advanced, so a retry would create a second commit on a stale base.
 *  5. Verify `mergePR`-style operation is safe: if the merge API returns
 *     HTTP 405 (already merged) on a retry, the caller receives the
 *     original error, not a second merge attempt.
 *  6. `isHttpRetryable` correctly classifies statuses:
 *     retryable (429, 502, 503, 504, 408, ECONNRESET, ETIMEDOUT).
 *     not-retryable (400, 401, 403, 404, 405, 409, 422).
 *  7. Race condition: withRetry does not start attempt N+1 if attempt N
 *     resolves successfully in the delay window (no phantom second call).
 *  8. `maxAttempts: 1` disables all retries (single-shot guarantee).
 *
 * None of these tests require a network connection, Redis, or node_modules
 * beyond vitest itself.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withRetry, isHttpRetryable } from "../src/services/retry.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an Error-like object with an HTTP status for testing isHttpRetryable. */
function httpError(status: number): Error & { status: number } {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

/** Tiny sleep so we can test timing without real network I/O. */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 1. No double-execution on success
// ---------------------------------------------------------------------------
describe("withRetry — no double-execution on success", () => {
  it("calls the function exactly once when it succeeds immediately", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { maxAttempts: 4, name: "test-success" });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not invoke fn a second time after a clean return", async () => {
    let calls = 0;
    await withRetry(async () => {
      calls++;
      return "done";
    }, { maxAttempts: 3 });
    // Give the event loop a few ticks to confirm no phantom second call
    await sleep(20);
    expect(calls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Non-retryable errors are not retried
// ---------------------------------------------------------------------------
describe("withRetry — non-retryable errors stop immediately", () => {
  it("does not retry HTTP 409 (ref conflict — already-advanced base)", async () => {
    const fn = vi.fn().mockRejectedValue(httpError(409));
    await expect(
      withRetry(fn, {
        maxAttempts: 4,
        isRetryable: isHttpRetryable,
        // baseDelayMs 0 so the test doesn't wait real time if retry did fire
        baseDelayMs: 0,
        name: "test-409",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry HTTP 422 (unprocessable entity — invalid state transition)", async () => {
    const fn = vi.fn().mockRejectedValue(httpError(422));
    await expect(
      withRetry(fn, { maxAttempts: 4, isRetryable: isHttpRetryable, baseDelayMs: 0, name: "test-422" }),
    ).rejects.toMatchObject({ status: 422 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry HTTP 405 (method not allowed — already merged)", async () => {
    const fn = vi.fn().mockRejectedValue(httpError(405));
    await expect(
      withRetry(fn, { maxAttempts: 4, isRetryable: isHttpRetryable, baseDelayMs: 0, name: "test-405" }),
    ).rejects.toMatchObject({ status: 405 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry HTTP 403 (forbidden)", async () => {
    const fn = vi.fn().mockRejectedValue(httpError(403));
    await expect(
      withRetry(fn, { maxAttempts: 4, isRetryable: isHttpRetryable, baseDelayMs: 0, name: "test-403" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry HTTP 404 (not found)", async () => {
    const fn = vi.fn().mockRejectedValue(httpError(404));
    await expect(
      withRetry(fn, { maxAttempts: 4, isRetryable: isHttpRetryable, baseDelayMs: 0, name: "test-404" }),
    ).rejects.toMatchObject({ status: 404 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry HTTP 400 (bad request)", async () => {
    const fn = vi.fn().mockRejectedValue(httpError(400));
    await expect(
      withRetry(fn, { maxAttempts: 4, isRetryable: isHttpRetryable, baseDelayMs: 0, name: "test-400" }),
    ).rejects.toMatchObject({ status: 400 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry HTTP 401 (unauthorized)", async () => {
    const fn = vi.fn().mockRejectedValue(httpError(401));
    await expect(
      withRetry(fn, { maxAttempts: 4, isRetryable: isHttpRetryable, baseDelayMs: 0, name: "test-401" }),
    ).rejects.toMatchObject({ status: 401 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Slow-then-succeed: first success wins, no second attempt
// ---------------------------------------------------------------------------
describe("withRetry — slow first attempt succeeds before timeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves with the first attempt result without calling fn again", async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      calls++;
      // Simulates a slow but ultimately successful request
      await sleep(10);
      return `call-${calls}`;
    });

    vi.useRealTimers();
    const result = await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 200,
      isRetryable: isHttpRetryable,
      name: "slow-success",
    });
    expect(result).toBe("call-1");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Transient failures do retry, but stop once success is seen
// ---------------------------------------------------------------------------
describe("withRetry — retries on transient errors then stops", () => {
  it("retries exactly N-1 times on 503, then succeeds and stops", async () => {
    let attempt = 0;
    const fn = vi.fn().mockImplementation(async () => {
      attempt++;
      if (attempt < 3) throw httpError(503);
      return "recovered";
    });

    const result = await withRetry(fn, {
      maxAttempts: 4,
      baseDelayMs: 1,
      maxDelayMs: 5,
      isRetryable: isHttpRetryable,
      name: "transient-503",
    });
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
    // no further calls after success
    await sleep(20);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("retries on 429 (rate-limited) and succeeds on second attempt", async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls === 1) throw httpError(429);
      return "ok-after-ratelimit";
    });

    const result = await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 1,
      isRetryable: isHttpRetryable,
      name: "429-retry",
    });
    expect(result).toBe("ok-after-ratelimit");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 5. maxAttempts: 1 — single-shot guarantee (no retries at all)
// ---------------------------------------------------------------------------
describe("withRetry — maxAttempts: 1 disables retries", () => {
  it("throws immediately without retrying even on a retryable error", async () => {
    const fn = vi.fn().mockRejectedValue(httpError(503));
    await expect(
      withRetry(fn, { maxAttempts: 1, isRetryable: isHttpRetryable, name: "single-shot" }),
    ).rejects.toMatchObject({ status: 503 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("succeeds on first call with maxAttempts: 1", async () => {
    const fn = vi.fn().mockResolvedValue("single-ok");
    const result = await withRetry(fn, { maxAttempts: 1, name: "single-ok" });
    expect(result).toBe("single-ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 6. isHttpRetryable classification correctness
// ---------------------------------------------------------------------------
describe("isHttpRetryable — status classification", () => {
  // Retryable statuses
  it.each([429, 502, 503, 504, 408])("classifies HTTP %i as retryable", (status) => {
    expect(isHttpRetryable(httpError(status))).toBe(true);
  });

  // Network-level retryable
  it("classifies ECONNRESET as retryable", () => {
    expect(isHttpRetryable(new Error("ECONNRESET"))).toBe(true);
  });

  it("classifies ETIMEDOUT as retryable", () => {
    expect(isHttpRetryable(new Error("ETIMEDOUT"))).toBe(true);
  });

  // Non-retryable statuses — executing these again risks double-write
  it.each([400, 401, 403, 404, 405, 409, 422, 500])(
    "classifies HTTP %i as NOT retryable",
    (status) => {
      // 500 is intentionally not in our retryable set — it's ambiguous and
      // a double-executed 500 could be worse than surfacing the original error.
      expect(isHttpRetryable(httpError(status))).toBe(false);
    },
  );

  it("classifies a non-Error throw as not retryable", () => {
    expect(isHttpRetryable("string error")).toBe(false);
    expect(isHttpRetryable(42)).toBe(false);
    expect(isHttpRetryable(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Exhaustion: all attempts consumed, last error re-thrown exactly once
// ---------------------------------------------------------------------------
describe("withRetry — exhaustion behaviour", () => {
  it("throws after maxAttempts retryable failures, calling fn exactly maxAttempts times", async () => {
    const fn = vi.fn().mockRejectedValue(httpError(503));
    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 1, isRetryable: isHttpRetryable, name: "exhaust" }),
    ).rejects.toMatchObject({ status: 503 });
    expect(fn).toHaveBeenCalledTimes(3);
    // Confirm no delayed extra calls
    await sleep(30);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// 8. onRetry hook fires the right number of times
// ---------------------------------------------------------------------------
describe("withRetry — onRetry hook", () => {
  it("fires onRetry once per retry (not on the final failure)", async () => {
    const retryEvents: number[] = [];
    const fn = vi.fn().mockRejectedValue(httpError(503));

    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        baseDelayMs: 1,
        isRetryable: isHttpRetryable,
        name: "onretry-hook",
        onRetry: (_err, attempt) => { retryEvents.push(attempt); },
      }),
    ).rejects.toBeDefined();

    // 3 attempts total → 2 retries → hook fires at attempt 1 and 2
    expect(retryEvents).toEqual([1, 2]);
  });

  it("onRetry does not fire when fn succeeds on the first attempt", async () => {
    const retryEvents: number[] = [];
    await withRetry(
      async () => "ok",
      { onRetry: (_err, attempt) => { retryEvents.push(attempt); } },
    );
    expect(retryEvents).toHaveLength(0);
  });
});
