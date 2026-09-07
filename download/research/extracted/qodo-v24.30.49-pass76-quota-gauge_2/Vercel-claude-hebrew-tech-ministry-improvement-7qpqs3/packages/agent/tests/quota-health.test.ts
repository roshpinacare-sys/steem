/**
 * quota-health.test.ts — task-47: per-provider quota-gauge (percentUsed /
 * isNearExhaustion / getQuotaHealthReport), plus a regression test for the
 * openrouter HEADER_MAP bug found while implementing this (the `requests`
 * field was reading the LIMIT header into the REMAINING slot).
 *
 * NOTE ON EXECUTION: authored and hand-traced in a sandbox with no network
 * access, so vitest could not run against these TS sources directly. The
 * exact quotaPercentUsed/isNearExhaustion algorithm below WAS executed for
 * real with plain node against all seven cases in this file (fresh, half
 * used, 89%, the 90% boundary, exhausted-with-unknown-limit, and
 * remaining-known-but-limit-unknown) — see the pass audit note for the
 * transcript. Confirming this exact suite passes under real vitest is
 * still owed before merge.
 */
import { describe, it, expect, vi } from "vitest";
import {
  quotaPercentUsed,
  isNearExhaustion,
  getQuotaHealthReport,
  recordQuotaFromHeaders,
  loadQuotaSnapshot,
  type QuotaSnapshot,
} from "../src/services/quota-guardian.js";
import type { RedisState } from "../src/services/redis-state.js";

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

function makeHeaders(map: Record<string, string>): Headers {
  return { get: (name: string) => map[name] ?? null } as unknown as Headers;
}

const base = (overrides: Partial<QuotaSnapshot> = {}): QuotaSnapshot => ({
  provider: "groq",
  requestsRemaining: null,
  tokensRemaining: null,
  resetAt: null,
  recordedAt: new Date().toISOString(),
  ...overrides,
});

describe("quotaPercentUsed", () => {
  it("null snapshot -> null (no data, not 0%)", () => {
    expect(quotaPercentUsed(null)).toBeNull();
  });

  it("no limit known -> null, even with a remaining count (never guess)", () => {
    expect(quotaPercentUsed(base({ requestsRemaining: 50 }))).toBeNull();
  });

  it("fresh quota -> 0%", () => {
    expect(quotaPercentUsed(base({ requestsRemaining: 1000, requestsLimit: 1000 }))).toBe(0);
  });

  it("half used -> 50%", () => {
    expect(quotaPercentUsed(base({ requestsRemaining: 500, requestsLimit: 1000 }))).toBe(50);
  });

  it("just under the 90% threshold -> 89%, not rounded up to 90", () => {
    expect(quotaPercentUsed(base({ requestsRemaining: 110, requestsLimit: 1000 }))).toBe(89);
  });

  it("exactly at 90% -> 90 (boundary is inclusive in isNearExhaustion)", () => {
    expect(quotaPercentUsed(base({ requestsRemaining: 100, requestsLimit: 1000 }))).toBe(90);
  });

  it("requestsRemaining=0 -> 100%, even when requestsLimit is unknown (markProviderExhausted case)", () => {
    expect(quotaPercentUsed(base({ requestsRemaining: 0, requestsLimit: undefined }))).toBe(100);
  });
});

describe("isNearExhaustion", () => {
  it("false when percentUsed is unknown (null never counts as near-exhaustion)", () => {
    expect(isNearExhaustion(base({ requestsRemaining: 50 }))).toBe(false);
  });

  it("false just under threshold, true at and above it", () => {
    expect(isNearExhaustion(base({ requestsRemaining: 110, requestsLimit: 1000 }))).toBe(false);
    expect(isNearExhaustion(base({ requestsRemaining: 100, requestsLimit: 1000 }))).toBe(true);
  });

  it("true for an exhausted provider regardless of known limit", () => {
    expect(isNearExhaustion(base({ requestsRemaining: 0 }))).toBe(true);
  });

  it("respects a custom threshold", () => {
    const snap = base({ requestsRemaining: 300, requestsLimit: 1000 }); // 70% used
    expect(isNearExhaustion(snap, 90)).toBe(false);
    expect(isNearExhaustion(snap, 60)).toBe(true);
  });
});

describe("getQuotaHealthReport", () => {
  it("reports percentUsed/nearExhaustion/resetAt per provider, null-safe for untracked providers", async () => {
    const { store, state } = makeRedisStub();
    await recordQuotaFromHeaders("groq", makeHeaders({
      "x-ratelimit-remaining-requests": "100",
      "x-ratelimit-limit-requests": "1000",
      "x-ratelimit-reset-requests": "60",
    }), state);
    expect(store.size).toBe(1);

    const report = await getQuotaHealthReport(["groq", "openrouter"], state);
    const groq = report.find((r) => r.provider === "groq")!;
    const openrouter = report.find((r) => r.provider === "openrouter")!;

    expect(groq.percentUsed).toBe(90);
    expect(groq.nearExhaustion).toBe(true);
    expect(openrouter.percentUsed).toBeNull(); // never recorded -> no data, not 0%
    expect(openrouter.nearExhaustion).toBe(false);
  });
});

describe("openrouter HEADER_MAP fix (task-47)", () => {
  it("requests field now reads the REMAINING header, not the LIMIT header", async () => {
    const { state } = makeRedisStub();
    // A response where the org has burned through most of its quota:
    // limit is large and constant, remaining is small and falling.
    await recordQuotaFromHeaders("openrouter", makeHeaders({
      "x-ratelimit-remaining-requests": "50",
      "x-ratelimit-limit-requests": "1000",
    }), state);

    const snap = await loadQuotaSnapshot("openrouter", state);
    // Before the fix, `requestsRemaining` would have been read from the
    // LIMIT header and stored as 1000 — always "full", never near
    // exhaustion, no matter how close to the real cap the org actually was.
    expect(snap!.requestsRemaining).toBe(50);
    expect(snap!.requestsLimit).toBe(1000);
    expect(quotaPercentUsed(snap)).toBe(95);
    expect(isNearExhaustion(snap)).toBe(true);
  });
});
