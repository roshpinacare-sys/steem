import { describe, it, expect, vi, afterEach } from "vitest";
import { RedisState } from "../src/services/redis-state.js";

// ---------------------------------------------------------------------------
// RedisState.renewLock — unit tests
//
// Redis is not available in CI. We stub the module-level `fetch` so the tests
// run entirely in-process without network access.
// ---------------------------------------------------------------------------

/**
 * Build a fetch stub that records calls and returns controlled responses.
 * Each entry in `responses` is consumed in order; the last one is reused
 * for any additional calls.
 */
function makeFetchStub(responses: Array<{ result: unknown }>) {
  let idx = 0;
  return vi.fn(async (..._args: unknown[]) => {
    const body = responses[Math.min(idx++, responses.length - 1)];
    return {
      json: async () => body,
    } as unknown as Response;
  });
}

describe("RedisState.renewLock", () => {
  const REDIS_URL   = "https://fake-redis.upstash.io";
  const REDIS_TOKEN = "fake-token";

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true when EXPIRE confirms the key still exists (result === 1)", async () => {
    process.env.UPSTASH_REDIS_REST_URL   = REDIS_URL;
    process.env.UPSTASH_REDIS_REST_TOKEN = REDIS_TOKEN;

    const stub = makeFetchStub([{ result: 1 }]);
    vi.stubGlobal("fetch", stub);

    const redis = new RedisState();
    const renewed = await redis.renewLock("pr-42");

    expect(renewed).toBe(true);
    // The URL must contain EXPIRE and the lock key.
    const calledUrl = stub.mock.calls[0][0] as string;
    expect(calledUrl).toContain("expire");
    // Bug 18-A fix: Redis keys now live under the qodo:v24: namespace.
    expect(calledUrl).toContain("qodo%3Av24%3Alock%3Apr-42");
  });

  it("returns false when EXPIRE reports the key is gone (result === 0 — lock expired)", async () => {
    process.env.UPSTASH_REDIS_REST_URL   = REDIS_URL;
    process.env.UPSTASH_REDIS_REST_TOKEN = REDIS_TOKEN;

    const stub = makeFetchStub([{ result: 0 }]);
    vi.stubGlobal("fetch", stub);

    const redis = new RedisState();
    const renewed = await redis.renewLock("pr-99");

    expect(renewed).toBe(false);
  });

  it("returns true immediately (no network call) when Redis is not configured", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.UPSTASH_REDIS_REST_URLS;
    delete process.env.UPSTASH_REDIS_REST_TOKENS;

    const stub = vi.fn();
    vi.stubGlobal("fetch", stub);

    const redis = new RedisState();
    const renewed = await redis.renewLock("pr-0");

    expect(renewed).toBe(true);
    expect(stub).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Lock exclusivity: a second acquireLock must fail while the first holder
// is alive (i.e. while the lock key is present).
// ---------------------------------------------------------------------------

describe("RedisState lock exclusivity", () => {
  const REDIS_URL   = "https://fake-redis.upstash.io";
  const REDIS_TOKEN = "fake-token";

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("second acquireLock returns false while first holder's lock is alive", async () => {
    process.env.UPSTASH_REDIS_REST_URL   = REDIS_URL;
    process.env.UPSTASH_REDIS_REST_TOKEN = REDIS_TOKEN;

    // First call: SET NX succeeds → "OK"
    // Second call: SET NX is blocked (key exists) → null result
    const stub = makeFetchStub([{ result: "OK" }, { result: null }]);
    vi.stubGlobal("fetch", stub);

    const redis = new RedisState();

    const firstAcquire  = await redis.acquireLock("pr-7");
    const secondAcquire = await redis.acquireLock("pr-7");

    expect(firstAcquire).toBe(true);   // first holder gets the lock
    expect(secondAcquire).toBe(false); // second dispatch is blocked

    // Both calls must target the same lock key.
    for (const call of stub.mock.calls) {
      expect(call[0] as string).toContain("qodo%3Av24%3Alock%3Apr-7");
    }
  });

  it("renewLock keeps the lock alive so a second acquireLock still fails", async () => {
    process.env.UPSTASH_REDIS_REST_URL   = REDIS_URL;
    process.env.UPSTASH_REDIS_REST_TOKEN = REDIS_TOKEN;

    // Sequence: acquire OK → renew (EXPIRE returns 1) → second acquire blocked
    const stub = makeFetchStub([
      { result: "OK" }, // acquireLock (first holder)
      { result: 1 },    // renewLock   (heartbeat)
      { result: null }, // acquireLock (second dispatch — blocked)
    ]);
    vi.stubGlobal("fetch", stub);

    const redis = new RedisState();

    const firstAcquired = await redis.acquireLock("pr-8");
    const renewed       = await redis.renewLock("pr-8");
    const secondBlocked = await redis.acquireLock("pr-8");

    expect(firstAcquired).toBe(true);
    expect(renewed).toBe(true);
    expect(secondBlocked).toBe(false);
  });
});
