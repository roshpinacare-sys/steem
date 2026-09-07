/**
 * Pass 21 economics + customer-loop regression tests.
 *
 * Covers the new services introduced in v24.22.0:
 *   - trust-ledger (V1)
 *   - uncertainty-sampling (S1)
 *   - cost-ledger (P1)
 *   - support-ticket-bridge (T1/T2)
 *   - vitals-score (U4)
 *   - api-contract-guard (R1)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RedisState } from "../../src/services/redis-state.js";
import type { R2Storage } from "../../src/services/r2-storage.js";
import type { Telemetry } from "../../src/services/telemetry.js";

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------

function makeState(): RedisState {
  const store = new Map<string, unknown>();
  return {
    getJSON: vi.fn(async <T>(key: string): Promise<T | null> => (store.get(key) as T) ?? null),
    setJSONWithTTL: vi.fn(async (key: string, value: unknown) => { store.set(key, value); }),
    setJSON: vi.fn(async (key: string, value: unknown) => { store.set(key, value); }),
    get: vi.fn(),
    set: vi.fn(),
    acquireLock: vi.fn(),
    releaseLock: vi.fn(),
    renewLock: vi.fn(),
    exists: vi.fn(),
  } as unknown as RedisState;
}

function makeStorage(): R2Storage {
  const store = new Map<string, string>();
  return {
    getText: vi.fn(async (key: string) => store.get(key) ?? null),
    putText: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    getJSON: vi.fn(),
    putJSON: vi.fn(),
  } as unknown as R2Storage;
}

function makeTelemetry(): Telemetry {
  return { decision: vi.fn(), push: vi.fn(), flush: vi.fn() } as unknown as Telemetry;
}

// ---------------------------------------------------------------------------
// V1: Trust Ledger
// ---------------------------------------------------------------------------

describe("trust-ledger", async () => {
  const {
    classifyTrustCategory,
    loadTrustLedger,
    recordOutcome,
    canAutoMerge,
    isProbation,
    seedTrustFromProvenRepo,
  } = await import("../../src/services/trust-ledger.js");

  it("classifies common objective types correctly", () => {
    expect(classifyTrustCategory("Fix CVE in auth middleware")).toBe("security-fix");
    expect(classifyTrustCategory("Add Stripe checkout test")).toBe("payment-path-fix");
    expect(classifyTrustCategory("Improve API latency")).toBe("performance-fix");
    expect(classifyTrustCategory("Bump lodash dependency")).toBe("dependency-bump");
    expect(classifyTrustCategory("Add unit tests for parser")).toBe("test-addition");
    expect(classifyTrustCategory("Refactor module structure", "architecture")).toBe("refactor");
    expect(classifyTrustCategory("Fix typo in README")).toBe("cosmetic");
    expect(classifyTrustCategory("Add dark mode toggle")).toBe("feature");
  });

  it("starts a new repo with an empty ledger", async () => {
    const state = makeState();
    const ledger = await loadTrustLedger("acme", "widget", state);
    expect(ledger.owner).toBe("acme");
    expect(ledger.repo).toBe("widget");
    expect(ledger.bonds).toEqual([]);
  });

  it("records successful outcomes and raises bond", async () => {
    const state = makeState();
    await recordOutcome("acme", "widget", "feature", true, 80, state);
    const bond = (await loadTrustLedger("acme", "widget", state)).bonds[0];
    expect(bond.score).toBeGreaterThan(50);
    expect(bond.successes).toBe(1);
    expect(canAutoMerge(bond)).toBe(false); // not yet 75
  });

  it("records failures and lowers bond, entering probation", async () => {
    const state = makeState();
    for (let i = 0; i < 5; i++) {
      await recordOutcome("acme", "widget", "feature", false, 90, state);
    }
    const bond = (await loadTrustLedger("acme", "widget", state)).bonds[0];
    expect(bond.probation).toBe(true);
    expect(isProbation(bond)).toBe(true);
    expect(canAutoMerge(bond)).toBe(false);
  });

  it("allows auto-merge only when bond is high enough and not on probation", async () => {
    const state = makeState();
    for (let i = 0; i < 10; i++) {
      await recordOutcome("acme", "widget", "test-addition", true, 95, state);
    }
    const bond = (await loadTrustLedger("acme", "widget", state)).bonds[0];
    expect(bond.score).toBe(100);
    expect(bond.probation).toBe(false);
    expect(canAutoMerge(bond)).toBe(true);
  });

  it("seeds a new repo at probationary level from a proven repo", async () => {
    const state = makeState();
    for (let i = 0; i < 10; i++) {
      await recordOutcome("acme", "proven", "feature", true, 95, state);
    }
    await seedTrustFromProvenRepo("acme", "new-repo", "acme", "proven", state);
    const newBond = (await loadTrustLedger("acme", "new-repo", state)).bonds[0];
    expect(newBond.score).toBeLessThan(75);
    expect(newBond.probation).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// S1: Uncertainty Sampling
// ---------------------------------------------------------------------------

describe("uncertainty-sampling", async () => {
  const { sampleUncertainty, sampleUncertaintyAsync } = await import("../../src/services/uncertainty-sampling.js");

  it("routes to mentor-mode when models disagree", () => {
    const decision = sampleUncertainty({
      objective: "payment retry logic",
      category: "payment-path-fix",
      confidenceScore: 80,
      modelVotes: [
        { provider: "groq", answer: "yes", confidence: 90 },
        { provider: "openrouter", answer: "no", confidence: 60 },
      ],
    });
    expect(decision.route).toBe("mentor-mode");
    expect(decision.uncertainty).toBeGreaterThan(0.3);
  });

  it("auto-proceeds with high confidence and consensus", () => {
    const decision = sampleUncertainty({
      objective: "add unit test",
      category: "test-addition",
      confidenceScore: 95,
      historicalReliability: 0.95,
      trustBondScore: 85,
      modelVotes: [
        { provider: "groq", answer: "yes", confidence: 95 },
        { provider: "openrouter", answer: "yes", confidence: 94 },
      ],
    });
    expect(decision.route).toBe("auto-proceed");
  });

  it("routes to mentor-mode when red-team found high severity issues", () => {
    const decision = sampleUncertainty({
      objective: "auth fix",
      category: "security-fix",
      confidenceScore: 95,
      redTeamHighSeverity: true,
      modelVotes: [{ provider: "groq", answer: "yes", confidence: 95 }],
    });
    expect(decision.route).toBe("mentor-mode");
  });

  it("async wrapper falls back to neutral reliability and returns a decision", async () => {
    const state = makeState();
    const telemetry = makeTelemetry();
    const decision = await sampleUncertaintyAsync(
      { objective: "low risk refactor", category: "refactor", confidenceScore: 88 },
      state,
      telemetry,
    );
    expect(["auto-proceed", "mentor-mode"].includes(decision.route)).toBe(true);
    expect(telemetry.decision).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// P1: Cost Ledger
// ---------------------------------------------------------------------------

describe("cost-ledger", async () => {
  const { openLedger, recordCost, closeLedger, queryLedger, generateChargebackReport, loadLedger } = await import(
    "../../src/services/cost-ledger.js"
  );
  const { CostTracker } = await import("../../src/services/cost-tracker.js");

  it("opens a ledger tagged with owner/repo/objective/category", async () => {
    const state = makeState();
    const entry = await openLedger("run-1", "acme", "widget", "Add feature", "feature", state);
    expect(entry.owner).toBe("acme");
    expect(entry.repo).toBe("widget");
    expect(entry.category).toBe("feature");
    expect(entry.totals.callCount).toBe(0);
  });

  it("records costs and totals them", async () => {
    const state = makeState();
    await openLedger("run-1", "acme", "widget", "Add feature", "feature", state);
    const tracker = new CostTracker();
    tracker.record("groq", "llama-3.1-8b-instant", "fast", { prompt_tokens: 1000, completion_tokens: 500 });
    for (const c of tracker.breakdown()) {
      await recordCost("acme", "widget", "run-1", c, state);
    }
    const entry = await loadLedger("acme", "widget", "run-1", state);
    expect(entry?.totals.callCount).toBe(1);
    expect(entry?.totals.totalTokens).toBe(1500);
    expect(entry?.totals.estimatedUsdCents).toBeGreaterThan(0);
  });

  it("closes a ledger and mirrors to R2", async () => {
    const state = makeState();
    const storage = makeStorage();
    await openLedger("run-1", "acme", "widget", "Add feature", "feature", state);
    const closed = await closeLedger("acme", "widget", "run-1", state, storage);
    expect(closed?.closedAt).toBeDefined();
    const mirror = await storage.getText("cost-ledger/acme/widget/run-1.json");
    expect(mirror).not.toBeNull();
  });

  it("generates a chargeback report grouped by team", async () => {
    const state = makeState();
    await openLedger("run-1", "acme", "widget", "[checkout] Fix payment button", "payment-path-fix", state);
    const tracker = new CostTracker();
    tracker.record("groq", "llama-3.1-8b-instant", "fast", { prompt_tokens: 1000, completion_tokens: 500 });
    for (const c of tracker.breakdown()) await recordCost("acme", "widget", "run-1", c, state);
    await closeLedger("acme", "widget", "run-1", state);

    const reports = await generateChargebackReport(
      "acme",
      "widget",
      new Date().toISOString().slice(0, 7),
      state,
    );
    expect(reports.length).toBe(1);
    expect(reports[0].team).toBe("checkout");
  });

  it("queries ledgers by repo filter", async () => {
    const state = makeState();
    await openLedger("run-a", "acme", "widget", "A", "feature", state);
    await openLedger("run-b", "acme", "other", "B", "feature", state);
    const widgetOnly = await queryLedger(state, { owner: "acme", repo: "widget" });
    expect(widgetOnly).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// T1/T2: Support Ticket Bridge
// ---------------------------------------------------------------------------

describe("support-ticket-bridge", async () => {
  const {
    buildTicketObjectives,
    aggregateDuplicates,
    
  } = await import("../../src/services/support-ticket-bridge.js");

  it("builds objectives only for complaint-shaped tickets", () => {
    const tickets = [
      { id: "zendesk-1", subject: "Checkout is broken", body: "I cannot pay", source: "zendesk" as const, url: "", createdAt: "", priority: "high" as const },
      { id: "zendesk-2", subject: "Feature request", body: "Please add dark mode", source: "zendesk" as const, url: "", createdAt: "", priority: "normal" as const },
    ];
    const { newObjectives, duplicates } = buildTicketObjectives(tickets);
    expect(newObjectives).toHaveLength(1);
    expect(newObjectives[0].ticketId).toBe("zendesk-1");
    expect(duplicates).toHaveLength(0);
  });

  it("deduplicates tickets with overlapping fingerprints", () => {
    const tickets = [
      { id: "zendesk-1", subject: "Login broken", body: "Cannot sign in", source: "zendesk" as const, url: "", createdAt: "" },
      { id: "zendesk-2", subject: "Login broken", body: "Cannot sign in with SSO", source: "zendesk" as const, url: "", createdAt: "" },
    ];
    const { newObjectives, duplicates } = buildTicketObjectives(tickets);
    expect(newObjectives).toHaveLength(1);
    expect(duplicates).toHaveLength(1);
  });

  it("aggregates duplicate tickets into affected-user counts", () => {
    const objectives = [
      { ticketId: "1", source: "zendesk" as const, objective: "login broken", customerWords: "x", affectedUserCount: 1, priorityBoost: 1, url: "", fingerprint: "login broken" },
      { ticketId: "2", source: "zendesk" as const, objective: "login broken", customerWords: "y", affectedUserCount: 1, priorityBoost: 1, url: "", fingerprint: "login broken" },
    ];
    const aggregated = aggregateDuplicates(objectives);
    expect(aggregated).toHaveLength(1);
    expect(aggregated[0].affectedUserCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// U4: Vitals Score
// ---------------------------------------------------------------------------

describe("vitals-score", async () => {
  const { computeVitals, recordVitals, loadVitals } = await import("../../src/services/vitals-score.js");

  it("computes a healthy score when all signals are strong", () => {
    const score = computeVitals({
      calibrationScore: 90,
      openSentryIssues: 0,
      sloHealth: 1,
      recentSuccessRate: 0.95,
      forecastTrend: "improving",
      criticalCveCount: 0,
    });
    expect(score.score).toBeGreaterThanOrEqual(80);
    expect(score.label).toBe("healthy");
    expect(score.trend).toBe("improving");
  });

  it("computes a critical score when signals are weak", () => {
    const score = computeVitals({
      calibrationScore: 40,
      openSentryIssues: 15,
      sloHealth: 0.5,
      recentSuccessRate: 0.4,
      forecastTrend: "degrading",
      criticalCveCount: 8,
    });
    expect(score.score).toBeLessThan(55);
    expect(score.label).toBe("critical");
  });

  it("records and loads vitals", async () => {
    const state = makeState();
    const telemetry = makeTelemetry();
    const score = await recordVitals("acme", "widget", { calibrationScore: 85, recentSuccessRate: 0.9 }, state, telemetry);
    expect(score.label).toBe("healthy");
    const loaded = await loadVitals("acme", "widget", state);
    expect(loaded?.score).toBe(score.score);
    expect(telemetry.decision).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// R1: API Contract Guard
// ---------------------------------------------------------------------------

describe("api-contract-guard", async () => {
  const { guardApiContracts, isSchemaFile } = await import("../../src/services/api-contract-guard.js");

  it("identifies OpenAPI and GraphQL schema files", () => {
    expect(isSchemaFile("openapi.yaml")).toBe(true);
    expect(isSchemaFile("schema.graphql")).toBe(true);
    expect(isSchemaFile("src/index.ts")).toBe(false);
  });

  it("passes when no schema files are changed", () => {
    const result = guardApiContracts({}, { "src/index.ts": "code" });
    expect(result.passed).toBe(true);
    expect(result.breakingChanges).toHaveLength(0);
  });

  it("detects a removed OpenAPI path as breaking", () => {
    const base = JSON.stringify({
      paths: {
        "/users": {
          GET: { parameters: [{ name: "id", in: "query", required: true, schema: { type: "string" } }] },
        },
      },
    });
    const head = JSON.stringify({ paths: {} });
    const result = guardApiContracts({ "openapi.json": base }, { "openapi.json": head });
    expect(result.passed).toBe(false);
    expect(result.breakingChanges.some((c) => c.summary.includes("Removed path"))).toBe(true);
  });

  it("detects a new OpenAPI path as additive", () => {
    const base = JSON.stringify({ paths: {} });
    const head = JSON.stringify({
      paths: {
        "/users": { GET: { parameters: [] } },
      },
    });
    const result = guardApiContracts({ "openapi.json": base }, { "openapi.json": head });
    expect(result.passed).toBe(true);
    expect(result.additiveChanges).toHaveLength(1);
  });

  it("detects a removed GraphQL field as breaking", () => {
    const base = "type Query { users: [User] }";
    const head = "type Query { }";
    const result = guardApiContracts({ "schema.graphql": base }, { "schema.graphql": head });
    expect(result.passed).toBe(false);
    expect(result.breakingChanges.some((c) => c.summary.includes("Removed field"))).toBe(true);
  });

  it("does not break when GraphQL type changes are additive", () => {
    const base = "type Query { users: [User] }";
    const head = "type Query { users: [User] posts: [Post] }";
    const result = guardApiContracts({ "schema.graphql": base }, { "schema.graphql": head });
    expect(result.passed).toBe(true);
    expect(result.additiveChanges).toHaveLength(1);
  });
});
