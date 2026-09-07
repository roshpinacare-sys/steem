/**
 * quota-guardian.test.ts
 *
 * Regression tests for the quota-guardian utility, with particular focus on
 * the zero-remaining-treated-as-null bug:
 *
 *   Bug: recordQuotaFromHeaders used `(Number(get(...)) || null)` to parse
 *   rate-limit headers.  When a provider returned "0" (exhausted), Number("0")
 *   is 0, which is falsy, so `0 || null` collapsed to null.  hasHeadroom()
 *   treats null as "unknown → optimistic", so an exhausted provider was
 *   incorrectly considered available and re-dispatched, causing immediate 429s.
 *
 *   Fix: replaced the falsy-coalesce with an explicit null/NaN check so "0"
 *   is preserved as the number 0, and hasHeadroom correctly returns false.
 */

import { describe, it, expect, vi } from "vitest";
import {
  hasHeadroom,
  recordQuotaFromHeaders,
  markProviderExhausted,
  loadQuotaSnapshot,
  filterByHeadroom,
  rankByHeadroom,
  type QuotaSnapshot,
} from "../src/services/quota-guardian.js";
import type { RedisState } from "../src/services/redis-state.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** In-memory RedisState stub — no real Redis needed. */
function makeRedisStub(): { store: Map<string, string>; state: RedisState } {
  const store = new Map<string, string>();
  const state = {
    setWithTTL: vi.fn(async (key: string, value: string, _ttl: number) => {
      store.set(key, value);
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
  } as unknown as RedisState;
  return { store, state };
}

/** Build a Headers-compatible stub from a plain record. */
function makeHeaders(map: Record<string, string>): Headers {
  return {
    get: (name: string) => map[name] ?? null,
  } as unknown as Headers;
}

/** Parse the single snapshot stored in an in-memory Redis stub. */
function firstSnapshot(store: Map<string, string>): QuotaSnapshot {
  return JSON.parse(Array.from(store.values())[0]) as QuotaSnapshot;
}

// ---------------------------------------------------------------------------
// hasHeadroom — pure unit tests, no I/O needed
// ---------------------------------------------------------------------------

describe("hasHeadroom", () => {
  it("returns true when snapshot is null (never seen)", () => {
    expect(hasHeadroom(null)).toBe(true);
  });

  it("returns true when both remaining fields are null (no header data)", () => {
    const snap: QuotaSnapshot = {
      provider: "groq",
      requestsRemaining: null,
      tokensRemaining: null,
      resetAt: null,
      recordedAt: new Date().toISOString(),
    };
    expect(hasHeadroom(snap)).toBe(true);
  });

  it("returns false when requestsRemaining is 0 (exhausted)", () => {
    const snap: QuotaSnapshot = {
      provider: "groq",
      requestsRemaining: 0,
      tokensRemaining: null,
      resetAt: null,
      recordedAt: new Date().toISOString(),
    };
    expect(hasHeadroom(snap)).toBe(false);
  });

  it("returns false when tokensRemaining is 0 (exhausted)", () => {
    const snap: QuotaSnapshot = {
      provider: "groq",
      requestsRemaining: null,
      tokensRemaining: 0,
      resetAt: null,
      recordedAt: new Date().toISOString(),
    };
    expect(hasHeadroom(snap)).toBe(false);
  });

  it("returns true when requestsRemaining is positive", () => {
    const snap: QuotaSnapshot = {
      provider: "gemini",
      requestsRemaining: 42,
      tokensRemaining: null,
      resetAt: null,
      recordedAt: new Date().toISOString(),
    };
    expect(hasHeadroom(snap)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// recordQuotaFromHeaders — bug regression: "0" must not become null
// ---------------------------------------------------------------------------

describe("recordQuotaFromHeaders — zero-remaining regression (bug fix)", () => {
  it("stores requestsRemaining=0 when header value is '0' (not null)", async () => {
    const { store, state } = makeRedisStub();

    await recordQuotaFromHeaders(
      "groq",
      makeHeaders({
        "x-ratelimit-remaining-requests": "0",
        "x-ratelimit-remaining-tokens":   "500",
        "x-ratelimit-reset-requests":     "60",
      }),
      state,
    );

    expect(store.size).toBe(1);
    const snap = firstSnapshot(store);
    // Critical regression assertion: 0 must NOT become null
    expect(snap.requestsRemaining).toBe(0);
    expect(snap.tokensRemaining).toBe(500);
  });

  it("stores tokensRemaining=0 when header value is '0'", async () => {
    const { store, state } = makeRedisStub();

    await recordQuotaFromHeaders(
      "groq",
      makeHeaders({
        "x-ratelimit-remaining-requests": "10",
        "x-ratelimit-remaining-tokens":   "0",
      }),
      state,
    );

    const snap = firstSnapshot(store);
    expect(snap.tokensRemaining).toBe(0);
    expect(snap.requestsRemaining).toBe(10);
  });

  it("stores null for absent headers (not 0)", async () => {
    const { store, state } = makeRedisStub();

    await recordQuotaFromHeaders("groq", makeHeaders({}), state);

    const snap = firstSnapshot(store);
    expect(snap.requestsRemaining).toBeNull();
    expect(snap.tokensRemaining).toBeNull();
  });

  it("hasHeadroom returns false after recording requestsRemaining=0 (end-to-end)", async () => {
    const { state } = makeRedisStub();

    await recordQuotaFromHeaders(
      "groq",
      makeHeaders({
        "x-ratelimit-remaining-requests": "0",
        "x-ratelimit-remaining-tokens":   "0",
      }),
      state,
    );

    const snap = await loadQuotaSnapshot("groq", state);
    expect(hasHeadroom(snap)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// markProviderExhausted
// ---------------------------------------------------------------------------

describe("markProviderExhausted", () => {
  it("records requestsRemaining=0 and tokensRemaining=0", async () => {
    const { store, state } = makeRedisStub();
    await markProviderExhausted("gemini", 60, state);

    const snap = firstSnapshot(store);
    expect(snap.requestsRemaining).toBe(0);
    expect(snap.tokensRemaining).toBe(0);
    expect(hasHeadroom(snap)).toBe(false);
  });

  it("uses default reset window when resetInSeconds is null", async () => {
    const { store, state } = makeRedisStub();
    await markProviderExhausted("mistral", null, state);
    expect(store.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// loadQuotaSnapshot
// ---------------------------------------------------------------------------

describe("loadQuotaSnapshot", () => {
  it("returns null when nothing is stored", async () => {
    const { state } = makeRedisStub();
    expect(await loadQuotaSnapshot("cerebras", state)).toBeNull();
  });

  it("round-trips a snapshot correctly", async () => {
    const { state } = makeRedisStub();
    await markProviderExhausted("openrouter", 30, state);
    const snap = await loadQuotaSnapshot("openrouter", state);
    expect(snap?.provider).toBe("openrouter");
    expect(snap?.requestsRemaining).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// filterByHeadroom
// ---------------------------------------------------------------------------

describe("filterByHeadroom", () => {
  it("removes exhausted providers from the candidate list", async () => {
    const { state } = makeRedisStub();
    await markProviderExhausted("groq", 60, state);

    const result = await filterByHeadroom(["groq", "gemini"], state);
    expect(result).not.toContain("groq");
    expect(result).toContain("gemini");
  });

  it("returns all providers when all are exhausted (fallback)", async () => {
    const { state } = makeRedisStub();
    await markProviderExhausted("groq",    60, state);
    await markProviderExhausted("gemini",  60, state);
    await markProviderExhausted("mistral", 60, state);

    const result = await filterByHeadroom(["groq", "gemini", "mistral"], state);
    // Fallback: full list returned so the caller handles the 429 itself
    expect(result).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// rankByHeadroom
// ---------------------------------------------------------------------------

describe("rankByHeadroom", () => {
  it("places the provider with more remaining requests first", async () => {
    const { store, state } = makeRedisStub();

    const groqSnap: QuotaSnapshot = {
      provider: "groq", requestsRemaining: 100, tokensRemaining: null,
      resetAt: null, recordedAt: new Date().toISOString(),
    };
    store.set("qodo:v24:quota:groq",   JSON.stringify(groqSnap));

    const geminiSnap: QuotaSnapshot = {
      provider: "gemini", requestsRemaining: 10, tokensRemaining: null,
      resetAt: null, recordedAt: new Date().toISOString(),
    };
    store.set("qodo:v24:quota:gemini", JSON.stringify(geminiSnap));

    const ranked = await rankByHeadroom(["gemini", "groq"], state);
    expect(ranked[0]).toBe("groq");
    expect(ranked[1]).toBe("gemini");
  });
});
