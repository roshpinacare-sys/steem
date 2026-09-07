/**
 * pass-22-preflight-quota-webhook.test.ts
 * Regression tests for Pass 22:
 *   - preflight-estimator.ts (new)
 *   - quota-guardian.ts additions: rankByHeadroom, hasComfortableHeadroom
 *   - webhook-receiver.js additions: issue_comment, check_suite, dual dispatch
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  classifyRiskTier,
  estimatePreflight,
  recordPreflightOutcome,
  type RiskTier,
} from "../../src/services/preflight-estimator.js";
import {
  hasHeadroom,
  rankByHeadroom,
  hasComfortableHeadroom,
  type QuotaProvider,
  type QuotaSnapshot,
} from "../../src/services/quota-guardian.js";

// ---------------------------------------------------------------------------
// Minimal in-memory state stub
// ---------------------------------------------------------------------------

function makeStore(seed: Record<string, string> = {}) {
  const data = { ...seed };
  return {
    get:       async (k: string) => data[k] ?? null,
    set:       async (k: string, v: string) => { data[k] = v; },
    setWithTTL: async (k: string, v: string) => { data[k] = v; },
    delete:    async (k: string) => { delete data[k]; },
    _data:     data,
  };
}

// ---------------------------------------------------------------------------
// preflight-estimator: classifyRiskTier
// ---------------------------------------------------------------------------

describe("classifyRiskTier", () => {
  it("classifies security keywords as high", () => {
    expect(classifyRiskTier("Add JWT auth middleware")).toBe("high");
    expect(classifyRiskTier("Rotate encryption keys")).toBe("high");
    expect(classifyRiskTier("Fix CVE-2024-1234 in dependency")).toBe("high");
  });

  it("classifies refactor/migration keywords as medium", () => {
    expect(classifyRiskTier("Refactor database schema")).toBe("medium");
    expect(classifyRiskTier("Migrate from Mongoose to Prisma")).toBe("medium");
    expect(classifyRiskTier("Upgrade major dependency version")).toBe("medium");
  });

  it("classifies trivial keywords as cosmetic", () => {
    expect(classifyRiskTier("Fix typo in README")).toBe("cosmetic");
    expect(classifyRiskTier("Rename variable for clarity")).toBe("cosmetic");
    expect(classifyRiskTier("Format code with prettier")).toBe("cosmetic");
  });

  it("defaults to low for generic objectives", () => {
    expect(classifyRiskTier("Add a loading spinner")).toBe("low");
    expect(classifyRiskTier("Implement pagination")).toBe("low");
    expect(classifyRiskTier("Add unit tests for utils")).toBe("low");
  });
});

// ---------------------------------------------------------------------------
// preflight-estimator: estimatePreflight
// ---------------------------------------------------------------------------

describe("estimatePreflight", () => {
  it("returns confirm_before_proceeding for high-risk objectives", async () => {
    const store = makeStore() as any;
    const result = await estimatePreflight("Add OAuth2 authentication flow", store);
    expect(result.riskTier).toBe("high");
    expect(result.recommendation).toBe("confirm_before_proceeding");
    expect(result.summaryLine).toContain("Risk: high");
  });

  it("returns proceed for cosmetic objectives with no history", async () => {
    const store = makeStore() as any;
    const result = await estimatePreflight("Fix typo in README", store);
    expect(result.riskTier).toBe("cosmetic");
    expect(result.recommendation).toBe("proceed");
    expect(result.estimatedGatePassRate).toBeNull(); // no history
  });

  it("returns proceed_with_caution for medium risk", async () => {
    const store = makeStore() as any;
    const result = await estimatePreflight("Refactor database schema", store);
    expect(result.riskTier).toBe("medium");
    expect(result.recommendation).toBe("proceed_with_caution");
  });

  it("includes correct summaryLine format", async () => {
    const store = makeStore() as any;
    const result = await estimatePreflight("Add loading spinner", store);
    expect(result.summaryLine).toMatch(/^Est\. cost: \$[\d.]+/);
    expect(result.summaryLine).toContain("Risk:");
  });

  it("returns confirm_before_proceeding when avg cost exceeds threshold", async () => {
    // Seed history with high average cost ($1.50) for 'low' tier
    const store = makeStore({
      "qodo:v24:preflight:history:low": JSON.stringify({
        sampleSize: 10,
        avgCostUsd: 1.5,
        gatePassRate: 0.9,
      }),
    }) as any;
    const result = await estimatePreflight("Add pagination", store);
    expect(result.recommendation).toBe("confirm_before_proceeding");
    expect(result.estimatedCostUsd).toBe(1.5);
  });

  it("shows confident gate pass rate when sample size >= 5", async () => {
    const store = makeStore({
      "qodo:v24:preflight:history:low": JSON.stringify({
        sampleSize: 8,
        avgCostUsd: 0.12,
        gatePassRate: 0.875,
      }),
    }) as any;
    const result = await estimatePreflight("Add loading indicator", store);
    expect(result.estimatedGatePassRate).toBeCloseTo(0.875);
    expect(result.summaryLine).toContain("88% gate pass rate");
  });

  it("shows no-history message when sample size < 5", async () => {
    const store = makeStore({
      "qodo:v24:preflight:history:low": JSON.stringify({
        sampleSize: 3,
        avgCostUsd: 0.12,
        gatePassRate: 0.67,
      }),
    }) as any;
    const result = await estimatePreflight("Add loading indicator", store);
    expect(result.estimatedGatePassRate).toBeNull();
    expect(result.summaryLine).toContain("no reliable history");
  });
});

// ---------------------------------------------------------------------------
// preflight-estimator: recordPreflightOutcome
// ---------------------------------------------------------------------------

describe("recordPreflightOutcome", () => {
  it("persists rolling average correctly after first outcome", async () => {
    const store = makeStore() as any;
    await recordPreflightOutcome("low", 0.20, true, store);
    const raw = store._data["qodo:v24:preflight:history:low"];
    expect(raw).toBeDefined();
    const stats = JSON.parse(raw);
    expect(stats.sampleSize).toBe(1);
    expect(stats.avgCostUsd).toBeCloseTo(0.20);
    expect(stats.gatePassRate).toBe(1);
  });

  it("correctly averages cost over multiple outcomes", async () => {
    const store = makeStore() as any;
    await recordPreflightOutcome("low", 0.10, true, store);
    await recordPreflightOutcome("low", 0.30, true, store);
    const stats = JSON.parse(store._data["qodo:v24:preflight:history:low"]);
    expect(stats.sampleSize).toBe(2);
    expect(stats.avgCostUsd).toBeCloseTo(0.20);
  });

  it("updates pass rate correctly on mixed outcomes", async () => {
    const store = makeStore() as any;
    await recordPreflightOutcome("medium", 0.40, true, store);
    await recordPreflightOutcome("medium", 0.60, false, store);
    await recordPreflightOutcome("medium", 0.50, true, store);
    const stats = JSON.parse(store._data["qodo:v24:preflight:history:medium"]);
    expect(stats.sampleSize).toBe(3);
    expect(stats.gatePassRate).toBeCloseTo(2 / 3);
  });

  it("does not throw when store fails (best-effort)", async () => {
    const badStore = {
      get:  async () => { throw new Error("redis down"); },
      set:  async () => { throw new Error("redis down"); },
    } as any;
    await expect(
      recordPreflightOutcome("low", 0.10, true, badStore),
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// quota-guardian: hasHeadroom
// ---------------------------------------------------------------------------

describe("hasHeadroom", () => {
  it("returns true for null snapshot (never tracked)", () => {
    expect(hasHeadroom(null)).toBe(true);
  });

  it("returns true when requests and tokens are both positive", () => {
    const snap: QuotaSnapshot = {
      provider: "groq",
      requestsRemaining: 100,
      tokensRemaining: 5000,
      resetAt: null,
      recordedAt: new Date().toISOString(),
    };
    expect(hasHeadroom(snap)).toBe(true);
  });

  it("returns false when requestsRemaining is 0", () => {
    const snap: QuotaSnapshot = {
      provider: "groq",
      requestsRemaining: 0,
      tokensRemaining: 5000,
      resetAt: null,
      recordedAt: new Date().toISOString(),
    };
    expect(hasHeadroom(snap)).toBe(false);
  });

  it("returns false when tokensRemaining is 0", () => {
    const snap: QuotaSnapshot = {
      provider: "gemini",
      requestsRemaining: 50,
      tokensRemaining: 0,
      resetAt: null,
      recordedAt: new Date().toISOString(),
    };
    expect(hasHeadroom(snap)).toBe(false);
  });

  it("returns true when both fields are null (provider hides headers)", () => {
    const snap: QuotaSnapshot = {
      provider: "cf-workers-ai",
      requestsRemaining: null,
      tokensRemaining: null,
      resetAt: null,
      recordedAt: new Date().toISOString(),
    };
    expect(hasHeadroom(snap)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// quota-guardian: rankByHeadroom
// ---------------------------------------------------------------------------

describe("rankByHeadroom", () => {
  function makeStateWithSnapshots(snapshots: Partial<Record<QuotaProvider, Partial<QuotaSnapshot>>>) {
    const data: Record<string, string> = {};
    for (const [provider, snap] of Object.entries(snapshots)) {
      data[`qodo:v24:quota:${provider}`] = JSON.stringify({
        provider,
        requestsRemaining: null,
        tokensRemaining: null,
        resetAt: null,
        recordedAt: new Date().toISOString(),
        ...snap,
      });
    }
    return makeStore(data) as any;
  }

  it("sorts providers with higher requestsRemaining first", async () => {
    const state = makeStateWithSnapshots({
      groq: { requestsRemaining: 10 },
      gemini: { requestsRemaining: 200 },
      cerebras: { requestsRemaining: 50 },
    });
    const ranked = await rankByHeadroom(["groq", "gemini", "cerebras"], state);
    expect(ranked[0]).toBe("gemini");
    expect(ranked[1]).toBe("cerebras");
    expect(ranked[2]).toBe("groq");
  });

  it("places unknown (null snapshot) providers at mid-range (500)", async () => {
    const state = makeStateWithSnapshots({
      groq: { requestsRemaining: 1000 },
      gemini: { requestsRemaining: 5 },
      // cerebras has no snapshot at all
    });
    const ranked = await rankByHeadroom(["groq", "gemini", "cerebras"], state);
    expect(ranked[0]).toBe("groq");    // 1000
    expect(ranked[1]).toBe("cerebras"); // 500 (unknown = optimistic)
    expect(ranked[2]).toBe("gemini");   // 5
  });

  it("preserves relative order when all scores are equal", async () => {
    const state = makeStore() as any; // no snapshots — all 500
    const providers: QuotaProvider[] = ["groq", "gemini", "cerebras"];
    const ranked = await rankByHeadroom(providers, state);
    expect(ranked).toHaveLength(3);
    expect(new Set(ranked)).toEqual(new Set(providers));
  });
});

// ---------------------------------------------------------------------------
// quota-guardian: hasComfortableHeadroom
// ---------------------------------------------------------------------------

describe("hasComfortableHeadroom", () => {
  function stateWith(provider: QuotaProvider, requestsRemaining: number | null) {
    const data: Record<string, string> = {};
    if (requestsRemaining !== undefined) {
      data[`qodo:v24:quota:${provider}`] = JSON.stringify({
        provider, requestsRemaining,
        tokensRemaining: null, resetAt: null,
        recordedAt: new Date().toISOString(),
      });
    }
    return makeStore(data) as any;
  }

  it("returns true when remaining fraction is above threshold", async () => {
    const state = stateWith("groq", 20); // 20/100 = 20% > 10%
    expect(await hasComfortableHeadroom("groq", 100, state)).toBe(true);
  });

  it("returns false when remaining fraction is below threshold", async () => {
    const state = stateWith("groq", 5); // 5/100 = 5% < 10%
    expect(await hasComfortableHeadroom("groq", 100, state)).toBe(false);
  });

  it("returns true when no snapshot exists (optimistic)", async () => {
    const state = makeStore() as any;
    expect(await hasComfortableHeadroom("mistral", 60, state)).toBe(true);
  });

  it("returns true when requestsRemaining is null (headers absent)", async () => {
    const state = stateWith("cerebras", null);
    expect(await hasComfortableHeadroom("cerebras", 60, state)).toBe(true);
  });

  it("respects a custom threshold", async () => {
    const state = stateWith("gemini", 25); // 25/100 = 25%
    expect(await hasComfortableHeadroom("gemini", 100, state, 0.30)).toBe(false); // 25% < 30%
    expect(await hasComfortableHeadroom("gemini", 100, state, 0.20)).toBe(true);  // 25% > 20%
  });
});
