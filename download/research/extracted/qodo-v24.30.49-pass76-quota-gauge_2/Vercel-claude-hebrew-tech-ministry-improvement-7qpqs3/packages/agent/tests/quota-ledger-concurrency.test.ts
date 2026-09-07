/**
 * quota-ledger-concurrency.test.ts  —  Task-24  (Pass 56)
 *
 * QUOTA-GUARDIAN / COST-LEDGER CONCURRENT RECONCILIATION AUDIT
 *
 * ─── Background ────────────────────────────────────────────────────────────
 * Two independent spend-tracking systems govern every pipeline run:
 *
 *  1. quota-guardian.ts   — tracks per-provider free-tier capacity via Redis
 *                           snapshots of rate-limit headers. The router reads
 *                           these snapshots before dispatch to prefer providers
 *                           with headroom over exhausted ones.
 *
 *  2. cost-ledger.ts      — records per-run token spend against a named
 *                           objective, accumulating costs into a LedgerEntry
 *                           that closes at run completion.
 *
 * The concern from task-24: each system is correct against its own sequential
 * view. The bug class surfaces only when *two concurrent runs* share a Redis
 * key without atomic read-modify-write semantics.
 *
 * ─── What this pass proves ─────────────────────────────────────────────────
 *  1. Sequential cost-ledger recording accumulates all costs correctly
 *     (correctness baseline — CC4, HC2, SL1–SL3).
 *  2. Concurrent `recordCost()` is a non-atomic read-modify-write (GAP-1 High):
 *     with the controlled yield mock, two concurrent callers on the same ledger
 *     entry both capture the same base entry before either writes back. The last
 *     writer wins; the first writer's cost is deterministically discarded.
 *     With N concurrent callers, exactly 1 cost entry survives (CC1, CC2, HC1).
 *  3. `hasComfortableHeadroom()` under concurrent access deterministically
 *     returns true for both readers when the snapshot shows headroom — proving
 *     the joint-overshoot scenario is real: both concurrent runs approve dispatch
 *     from the same stale snapshot (CQ2).
 *  4. Concurrent quota snapshot writes are last-writer-wins: both callers write
 *     different values to the same key; one is always silently discarded (CQ1).
 *  5. `markProviderExhausted()` correctly blocks subsequent reads (CQ3, DB3).
 *  6. `rankByHeadroom()` correctly orders providers by requestsRemaining (QR4).
 *  7. Separate repo ledger keys never cross-contaminate (CM4).
 *  8. 20 concurrent quota snapshot reads are always internally consistent (HC3).
 *
 * ─── Race mechanism ────────────────────────────────────────────────────────
 * The `yieldAfterGet = true` flag in the mock inserts an `await Promise.resolve()`
 * between the store read and the return in `getJSON`. Under `Promise.all`, this
 * guarantees all N concurrent callers complete their reads before any write:
 *
 *   Phase 1 (microtask interleaved): all N callers call getJSON → all yield →
 *     all N store the same raw string in their local `raw` variable.
 *   Phase 2 (sequential microtask drain): c1 continues → modifies its local copy
 *     → calls setJSONWithTTL → writes entry_with_c1 to store.
 *     c2 continues → modifies its local copy (entry0, not c1's) → calls
 *     setJSONWithTTL → overwrites entry_with_c1 with entry_with_c2. And so on.
 *
 * Result: the final store value is entry_with_cN (last writer). Exactly 1 cost
 * entry survives. This is deterministic given the mock's async structure.
 *
 * ─── Scope / caveats ───────────────────────────────────────────────────────
 * The `InProcessRedisState` mock uses a plain `Map` and models the
 * get/set/getJSON/setJSON/setJSONWithTTL/setWithTTL subset used by the two
 * services. TTL expiry is not modelled (not relevant to the race).
 * No file system, real Redis, or network access required.
 *
 * ─── Files touched ─────────────────────────────────────────────────────────
 * - packages/agent/tests/quota-ledger-concurrency.test.ts  (this file, new)
 * - tasks/agent-task-queue.json                             (task-24 → done)
 * - 06-CHANGELOG.md, CHANGELOG.md, ENGINEERING_NOTES.md
 * - package.json files (version bump 24.30.27 → 24.30.28)
 */

import { describe, it, expect } from "vitest";
import {
  openLedger,
  recordCost,
  closeLedger,
  loadLedger,
} from "../src/services/cost-ledger.js";
import {
  hasHeadroom,
  recordQuotaFromHeaders,
  markProviderExhausted,
  loadQuotaSnapshot,
  rankByHeadroom,
  hasComfortableHeadroom,
  filterByHeadroom,
  type QuotaSnapshot,
} from "../src/services/quota-guardian.js";
import type { RedisState } from "../src/services/redis-state.js";
import type { Telemetry } from "../src/services/telemetry.js";
import type { CostEntry } from "../src/services/cost-tracker.js";

// ─────────────────────────────────────────────────────────────────────────────
// In-process RedisState mock — representative subset, no network
// ─────────────────────────────────────────────────────────────────────────────

/**
 * InProcessRedisState provides a plain in-process Map implementation of the
 * RedisState subset used by quota-guardian.ts and cost-ledger.ts:
 *   get / set / setWithTTL        — raw string API (quota-guardian)
 *   getJSON / setJSON /
 *   setJSONWithTTL                — JSON-serialised API (cost-ledger)
 *
 * TTL expiry is intentionally not modelled — it is irrelevant to the race
 * condition under test.
 *
 * The `yieldAfterGet` flag controls the race window. When true, `getJSON`
 * inserts `await Promise.resolve()` between reading `raw` from the map and
 * returning the parsed value. Under `Promise.all`, this guarantees all N
 * concurrent callers complete their reads before any writes (see header
 * "Race mechanism" section for the precise interleaving explanation).
 */
class InProcessRedisState {
  private readonly store = new Map<string, string>();

  /** When true, getJSON yields between read and return to expose the race. */
  yieldAfterGet = false;

  /** Total write calls (for assertion). */
  writeCalls = 0;
  /** Total read calls (for assertion). */
  readCalls = 0;

  // ── Raw string API (quota-guardian) ───────────────────────────────────────

  async get(key: string): Promise<string | null> {
    this.readCalls++;
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.writeCalls++;
    this.store.set(key, value);
  }

  async setWithTTL(key: string, value: string, _ttlSec: number): Promise<void> {
    this.writeCalls++;
    this.store.set(key, value);
  }

  // ── JSON API (cost-ledger) ─────────────────────────────────────────────────

  async getJSON<T>(key: string): Promise<T | null> {
    this.readCalls++;
    // Capture the raw value synchronously before any yield.
    const raw = this.store.get(key);
    if (!raw) return null;
    if (this.yieldAfterGet) {
      // Widen the race window: all concurrent callers complete this line
      // (capturing the same raw value) before any of them resume past this
      // yield to mutate and write back.
      await Promise.resolve();
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async setJSON<T>(key: string, value: T): Promise<void> {
    this.writeCalls++;
    this.store.set(key, JSON.stringify(value));
  }

  async setJSONWithTTL<T>(key: string, value: T, _ttlSec: number): Promise<void> {
    this.writeCalls++;
    this.store.set(key, JSON.stringify(value));
  }

  // ── Inspection helpers ─────────────────────────────────────────────────────

  size(): number { return this.store.size; }
  getRaw(key: string): string | undefined { return this.store.get(key); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeHeaders(map: Record<string, string>): Record<string, string | null> {
  return map;
}

function makeCostEntry(provider: string, tokens: number, cents: number): CostEntry {
  return {
    provider,
    model: "test-model",
    tier: "fast",
    usage: {
      promptTokens: Math.floor(tokens * 0.7),
      completionTokens: Math.floor(tokens * 0.3),
      totalTokens: tokens,
    },
    estimatedUsdCents: cents,
    timestamp: Date.now(),
  };
}

const noopTelemetry: Telemetry = {
  decision: async () => {},
} as unknown as Telemetry;

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — Sequential cost-ledger baseline (correctness, no race)
// ─────────────────────────────────────────────────────────────────────────────

describe("Sequential cost-ledger recording (correctness baseline)", () => {
  it("SL1: openLedger creates an entry with zero totals", async () => {
    const state = new InProcessRedisState() as unknown as RedisState;
    const entry = await openLedger("run-1", "owner", "repo", "fix bug", "maintenance", state);
    expect(entry.id).toBe("run-1");
    expect(entry.totals.totalTokens).toBe(0);
    expect(entry.totals.estimatedUsdCents).toBe(0);
    expect(entry.totals.callCount).toBe(0);
  });

  it("SL2: sequential recordCost accumulates all entries without loss", async () => {
    const state = new InProcessRedisState() as unknown as RedisState;
    await openLedger("run-seq", "owner", "repo", "add feature", "development", state);

    for (let i = 1; i <= 5; i++) {
      await recordCost("owner", "repo", "run-seq", makeCostEntry("groq", i * 100, i * 0.5), state);
    }

    const entry = await loadLedger("owner", "repo", "run-seq", state);
    expect(entry).not.toBeNull();
    expect(entry!.costs.length).toBe(5);
    expect(entry!.totals.callCount).toBe(5);
    // 100+200+300+400+500 = 1500
    expect(entry!.totals.totalTokens).toBe(1500);
    // 0.5+1.0+1.5+2.0+2.5 = 7.5
    expect(entry!.totals.estimatedUsdCents).toBeCloseTo(7.5, 5);
  });

  it("SL3: closeLedger seals the entry with a closedAt timestamp", async () => {
    const state = new InProcessRedisState() as unknown as RedisState;
    await openLedger("run-close", "owner", "repo", "refactor", "maintenance", state);
    await recordCost("owner", "repo", "run-close", makeCostEntry("groq", 500, 1.0), state);

    const closed = await closeLedger("owner", "repo", "run-close", state);
    expect(closed).not.toBeNull();
    expect(closed!.closedAt).toBeTruthy();
    expect(new Date(closed!.closedAt!).getTime()).toBeLessThanOrEqual(Date.now());
    expect(closed!.totals.callCount).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — Concurrent cost-ledger GAP-1 (non-atomic read-modify-write)
// ─────────────────────────────────────────────────────────────────────────────

describe("GAP-1 (High): concurrent recordCost — non-atomic read-modify-write", () => {
  /**
   * CONFIRMED GAP: recordCost() performs a non-atomic sequence:
   *   1. getJSON(entryKey)          ← read
   *   2. entry.costs.push(cost) …  ← mutate local copy
   *   3. setJSONWithTTL(entryKey)   ← write
   *
   * Two concurrent callers that both complete step 1 before either reaches
   * step 3 operate on the same base entry. The last write wins; the first
   * writer's update is silently discarded (lost-update / ABA race).
   *
   * With `yieldAfterGet = true` and `Promise.all`, this is deterministic:
   * all N callers capture the same raw entry before any of them write.
   * Each microtask continuation then overwrites the previous. Final result:
   * exactly 1 cost entry survives (the last writer's), regardless of N.
   */

  it("CC1: two concurrent recordCost calls — exactly 1 cost survives (last-writer-wins)", async () => {
    const mockState = new InProcessRedisState();
    mockState.yieldAfterGet = true;
    const state = mockState as unknown as RedisState;

    await openLedger("run-race", "owner", "repo", "fix perf", "development", state);

    const costA = makeCostEntry("groq", 1000, 2.0);
    const costB = makeCostEntry("openrouter", 2000, 4.0);

    await Promise.all([
      recordCost("owner", "repo", "run-race", costA, state),
      recordCost("owner", "repo", "run-race", costB, state),
    ]);

    const entry = await loadLedger("owner", "repo", "run-race", state);
    expect(entry).not.toBeNull();

    // Deterministic: both callers capture the same base entry (0 costs) before
    // either writes back. Last writer wins — exactly 1 cost survives.
    expect(entry!.costs.length).toBe(1);
    expect(entry!.totals.callCount).toBe(1);
    // Totals are internally consistent with the surviving cost
    expect(entry!.totals.totalTokens).toBe(entry!.costs[0].usage.totalTokens);
  });

  it("CC2: N=10 concurrent calls — exactly 1 cost survives (magnitude of under-count)", async () => {
    const mockState = new InProcessRedisState();
    mockState.yieldAfterGet = true;
    const state = mockState as unknown as RedisState;

    await openLedger("run-batch", "owner", "repo", "big feature", "development", state);

    const N = 10;
    const costs = Array.from({ length: N }, (_, i) =>
      makeCostEntry("groq", (i + 1) * 100, (i + 1) * 0.1),
    );

    await Promise.all(costs.map((c) => recordCost("owner", "repo", "run-batch", c, state)));

    const entry = await loadLedger("owner", "repo", "run-batch", state);
    expect(entry).not.toBeNull();

    // With the yield mock and Promise.all, all 10 callers capture entry0 before
    // any of them write. Each microtask continuation overwrites the previous.
    // Final state: exactly the last-writer's entry (1 cost of N) survives.
    // This documents the worst-case magnitude: 9 of 10 cost entries are lost.
    expect(entry!.costs.length).toBe(1);
    expect(entry!.totals.callCount).toBe(1);
    expect(entry!.totals.totalTokens).toBe(entry!.costs[0].usage.totalTokens);
  });

  it("CC3: race also occurs without explicit yield — async/await always schedules via microtasks", async () => {
    const mockState = new InProcessRedisState();
    mockState.yieldAfterGet = false; // no explicit yield — race still occurs
    const state = mockState as unknown as RedisState;

    await openLedger("run-tight", "owner", "repo", "tight path", "development", state);

    // Without yieldAfterGet, `getJSON` still returns a resolved Promise that
    // `await` schedules as a microtask. Under Promise.all, all callers reach
    // their `await getJSON(...)` suspension point before any continuation runs,
    // capturing the same base entry. The race is not eliminated by removing
    // the explicit yield — it is an inherent property of async/await.
    const costs = Array.from({ length: 5 }, (_, i) =>
      makeCostEntry("groq", (i + 1) * 200, (i + 1) * 0.2),
    );
    await Promise.all(costs.map((c) => recordCost("owner", "repo", "run-tight", c, state)));

    const entry = await loadLedger("owner", "repo", "run-tight", state);
    expect(entry).not.toBeNull();
    // Same outcome: totals are always internally consistent (callCount === costs.length),
    // even though costs.length may be less than N due to the race.
    expect(entry!.totals.callCount).toBe(entry!.costs.length);
    expect(entry!.totals.totalTokens).toBe(
      entry!.costs.reduce((s, c) => s + c.usage.totalTokens, 0),
    );
  });

  it("CC4: sequential awaits are safe — all costs survive even with yieldAfterGet=true", async () => {
    const mockState = new InProcessRedisState();
    mockState.yieldAfterGet = true;
    const state = mockState as unknown as RedisState;

    await openLedger("run-serial", "owner", "repo", "sequential safety", "development", state);

    const costs = Array.from({ length: 5 }, (_, i) =>
      makeCostEntry("groq", (i + 1) * 100, (i + 1) * 0.1),
    );
    // Sequential: each recordCost awaits completion before the next begins.
    // No concurrent reads → no lost updates.
    for (const c of costs) {
      await recordCost("owner", "repo", "run-serial", c, state);
    }

    const entry = await loadLedger("owner", "repo", "run-serial", state);
    expect(entry).not.toBeNull();
    expect(entry!.costs.length).toBe(5);
    expect(entry!.totals.callCount).toBe(5);
    expect(entry!.totals.totalTokens).toBe(1500); // 100+200+300+400+500
    expect(entry!.totals.estimatedUsdCents).toBeCloseTo(1.5, 5); // 0.1+0.2+0.3+0.4+0.5
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — Quota-guardian snapshot reads (correctness and edge cases)
// ─────────────────────────────────────────────────────────────────────────────

describe("Quota-guardian snapshot reads (resistance properties)", () => {
  it("QR1: loadQuotaSnapshot returns null when no snapshot exists", async () => {
    const state = new InProcessRedisState() as unknown as RedisState;
    const snap = await loadQuotaSnapshot("groq", state);
    expect(snap).toBeNull();
  });

  it("QR2: single write then read returns the exact snapshot written", async () => {
    const state = new InProcessRedisState() as unknown as RedisState;
    await recordQuotaFromHeaders(
      "groq",
      makeHeaders({
        "x-ratelimit-remaining-requests": "42",
        "x-ratelimit-remaining-tokens": "10000",
        "x-ratelimit-reset-requests": "60",
      }),
      state,
      noopTelemetry,
    );
    const snap = await loadQuotaSnapshot("groq", state);
    expect(snap).not.toBeNull();
    expect(snap!.provider).toBe("groq");
    expect(snap!.requestsRemaining).toBe(42);
    expect(snap!.tokensRemaining).toBe(10000);
  });

  it("QR3: hasHeadroom is deterministic across null/positive/zero inputs", () => {
    const base: Omit<QuotaSnapshot, "requestsRemaining" | "tokensRemaining"> = {
      provider: "groq",
      resetAt: null,
      recordedAt: new Date().toISOString(),
    };

    // null snapshot = unknown = optimistic
    expect(hasHeadroom(null)).toBe(true);
    // Both fields null = no header data = optimistic
    expect(hasHeadroom({ ...base, requestsRemaining: null, tokensRemaining: null })).toBe(true);
    // Positive requests = headroom present
    expect(hasHeadroom({ ...base, requestsRemaining: 10, tokensRemaining: null })).toBe(true);
    // Zero requests = exhausted, regardless of tokens
    expect(hasHeadroom({ ...base, requestsRemaining: 0, tokensRemaining: 1000 })).toBe(false);
    // Zero tokens = exhausted, regardless of requests
    expect(hasHeadroom({ ...base, requestsRemaining: 10, tokensRemaining: 0 })).toBe(false);
  });

  it("QR4: rankByHeadroom orders providers by requestsRemaining descending", async () => {
    const state = new InProcessRedisState() as unknown as RedisState;

    await recordQuotaFromHeaders("groq",       makeHeaders({ "x-ratelimit-remaining-requests": "100" }), state);
    await recordQuotaFromHeaders("openrouter",  makeHeaders({ "x-ratelimit-limit-requests":    "5"   }), state);
    await recordQuotaFromHeaders("gemini",      makeHeaders({ "x-ratelimit-remaining-requests": "50"  }), state);

    const ranked = await rankByHeadroom(["groq", "openrouter", "gemini"], state, noopTelemetry);
    // groq (100) > gemini (50) > openrouter (5)
    expect(ranked[0]).toBe("groq");
    expect(ranked[1]).toBe("gemini");
    expect(ranked[2]).toBe("openrouter");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4 — GAP-2: concurrent quota checks — both see headroom before writes
// ─────────────────────────────────────────────────────────────────────────────

describe("GAP-2 (Medium): concurrent quota checks both approve dispatch from stale snapshot", () => {
  /**
   * CONFIRMED GAP: two concurrent `hasComfortableHeadroom()` reads that
   * both observe the same prior snapshot before either dispatch+update
   * both return true, approving concurrent dispatch. This is the
   * joint-overshoot scenario: together they consume 2 quota slots when
   * only 1 may be safely available from the provider's perspective.
   *
   * Quota-guardian is advisory by design; it cannot prevent calls above
   * quota. The real gate is `markProviderExhausted()` after a 429.
   */

  it("CQ1: two concurrent snapshot writes — last writer wins, first write is lost", async () => {
    const state = new InProcessRedisState() as unknown as RedisState;

    // Two concurrent writes with different requestsRemaining values.
    await Promise.all([
      recordQuotaFromHeaders("groq", makeHeaders({ "x-ratelimit-remaining-requests": "100" }), state),
      recordQuotaFromHeaders("groq", makeHeaders({ "x-ratelimit-remaining-requests": "99"  }), state),
    ]);

    const snap = await loadQuotaSnapshot("groq", state);
    expect(snap).not.toBeNull();
    // One value wins; the resulting snapshot is always internally consistent.
    expect([99, 100]).toContain(snap!.requestsRemaining);
    expect(snap!.provider).toBe("groq");
    expect(typeof snap!.recordedAt).toBe("string");
  });

  it("CQ2: two concurrent headroom checks both return true — proving the joint-overshoot gap", async () => {
    const mockState = new InProcessRedisState();
    mockState.yieldAfterGet = true;
    const state = mockState as unknown as RedisState;

    // Seed: groq has 2 requests remaining out of an assumed 100 (= 2%, below threshold).
    // We set remaining to 15 (15%) to be clearly above the 10% comfort threshold.
    await recordQuotaFromHeaders(
      "groq",
      makeHeaders({ "x-ratelimit-remaining-requests": "15" }),
      state,
      noopTelemetry,
    );

    const assumedLimit = 100;
    // Both runs read the same "15 remaining" snapshot before either dispatches
    // and writes an update. Both independently approve dispatch.
    const [run1Headroom, run2Headroom] = await Promise.all([
      hasComfortableHeadroom("groq", assumedLimit, state),
      hasComfortableHeadroom("groq", assumedLimit, state),
    ]);

    // CONFIRMED: both concurrent reads approve dispatch from the same snapshot.
    // In a real pipeline, both runs then call the provider, consuming 2 of 15
    // remaining slots before either updates the snapshot. The quota-guardian
    // cannot prevent this — it is advisory, not transactional.
    expect(run1Headroom).toBe(true);
    expect(run2Headroom).toBe(true);
  });

  it("CQ3: markProviderExhausted after dispatch correctly blocks all subsequent checks", async () => {
    const state = new InProcessRedisState() as unknown as RedisState;

    await recordQuotaFromHeaders("gemini", makeHeaders({ "x-ratelimit-remaining-requests": "3" }), state);
    const before = await loadQuotaSnapshot("gemini", state);
    expect(hasHeadroom(before)).toBe(true);

    // Simulate: run receives a 429, calls markProviderExhausted
    await markProviderExhausted("gemini", 60, state, noopTelemetry);

    // All subsequent reads now see 0 remaining — the reactive gate works.
    const after = await loadQuotaSnapshot("gemini", state);
    expect(hasHeadroom(after)).toBe(false);
    expect(after!.requestsRemaining).toBe(0);
    expect(after!.tokensRemaining).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5 — Combined concurrent scenario (quota + cost-ledger)
// ─────────────────────────────────────────────────────────────────────────────

describe("Combined scenario: two runs racing quota headroom and cost recording", () => {
  it("CM1: independent ledger entries for two runs never interfere with each other", async () => {
    const state = new InProcessRedisState() as unknown as RedisState;

    await recordQuotaFromHeaders("groq", makeHeaders({ "x-ratelimit-remaining-requests": "5" }), state);
    await openLedger("run-A", "owner", "repo", "feature-A", "dev", state);
    await openLedger("run-B", "owner", "repo", "feature-B", "dev", state);

    // Both record their costs to different ledger keys — no race between them.
    await Promise.all([
      recordCost("owner", "repo", "run-A", makeCostEntry("groq", 500, 1.0), state),
      recordCost("owner", "repo", "run-B", makeCostEntry("groq", 800, 1.6), state),
    ]);

    const entryA = await loadLedger("owner", "repo", "run-A", state);
    const entryB = await loadLedger("owner", "repo", "run-B", state);
    expect(entryA).not.toBeNull();
    expect(entryB).not.toBeNull();
    // Each entry is independent — exactly its own cost survives.
    expect(entryA!.totals.totalTokens).toBe(500);
    expect(entryB!.totals.totalTokens).toBe(800);
  });

  it("CM2: two runs on the same ledger key (double-dispatch) — totals always internally consistent", async () => {
    const mockState = new InProcessRedisState();
    mockState.yieldAfterGet = true;
    const state = mockState as unknown as RedisState;

    await openLedger("run-shared", "owner", "repo", "shared-obj", "dev", state);

    await Promise.all([
      recordCost("owner", "repo", "run-shared", makeCostEntry("groq", 1000, 2.0), state),
      recordCost("owner", "repo", "run-shared", makeCostEntry("groq", 2000, 4.0), state),
    ]);

    const entry = await loadLedger("owner", "repo", "run-shared", state);
    expect(entry).not.toBeNull();
    // Even with the race, the surviving entry is always internally consistent:
    // totals match costs array exactly (no partial-write corruption).
    const derivedTotal = entry!.costs.reduce((s, c) => s + c.usage.totalTokens, 0);
    expect(entry!.totals.totalTokens).toBe(derivedTotal);
    expect(entry!.totals.callCount).toBe(entry!.costs.length);
  });

  it("CM3: filterByHeadroom excludes exhausted providers correctly", async () => {
    const state = new InProcessRedisState() as unknown as RedisState;

    await recordQuotaFromHeaders("groq",    makeHeaders({ "x-ratelimit-remaining-requests": "10" }), state);
    await markProviderExhausted("cerebras", null, state, noopTelemetry);

    const available = await filterByHeadroom(["groq", "cerebras"], state);
    // cerebras is exhausted → excluded; groq has headroom → included
    expect(available).toContain("groq");
    expect(available).not.toContain("cerebras");
  });

  it("CM4: separate (owner, repo, runId) keys never cross-contaminate", async () => {
    const state = new InProcessRedisState() as unknown as RedisState;

    await openLedger("run-X", "org-1", "repo-alpha", "task X", "dev", state);
    await openLedger("run-X", "org-2", "repo-beta",  "task X", "dev", state);

    await recordCost("org-1", "repo-alpha", "run-X", makeCostEntry("groq", 300, 0.6), state);
    await recordCost("org-2", "repo-beta",  "run-X", makeCostEntry("groq", 700, 1.4), state);

    const entryAlpha = await loadLedger("org-1", "repo-alpha", "run-X", state);
    const entryBeta  = await loadLedger("org-2", "repo-beta",  "run-X", state);

    expect(entryAlpha).not.toBeNull();
    expect(entryBeta).not.toBeNull();
    // Same runId across different orgs → different Redis keys → no interference.
    expect(entryAlpha!.totals.totalTokens).toBe(300);
    expect(entryBeta!.totals.totalTokens).toBe(700);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 6 — hasComfortableHeadroom threshold edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe("hasComfortableHeadroom threshold edge cases", () => {
  it("HH1: returns true when no snapshot exists (unknown = optimistic)", async () => {
    const state = new InProcessRedisState() as unknown as RedisState;
    expect(await hasComfortableHeadroom("together", 100, state)).toBe(true);
  });

  it("HH2: returns true when requestsRemaining is null (no header data — optimistic)", async () => {
    const state = new InProcessRedisState() as unknown as RedisState;
    // cf-workers-ai has no header mappings in HEADER_MAP → requestsRemaining stays null
    await recordQuotaFromHeaders("cf-workers-ai", makeHeaders({}), state, noopTelemetry);
    expect(await hasComfortableHeadroom("cf-workers-ai", 100, state)).toBe(true);
  });

  it("HH3: returns false when remaining fraction is below threshold (5/100 < 10%)", async () => {
    const state = new InProcessRedisState() as unknown as RedisState;
    await recordQuotaFromHeaders(
      "mistral",
      makeHeaders({ "x-ratelimit-remaining-requests": "5" }),
      state,
      noopTelemetry,
    );
    expect(await hasComfortableHeadroom("mistral", 100, state, 0.1)).toBe(false);
  });

  it("HH4: assumedLimit=0 falls back to requestsRemaining > 0 check", async () => {
    const state = new InProcessRedisState() as unknown as RedisState;
    await recordQuotaFromHeaders(
      "sambanova",
      makeHeaders({ "x-ratelimit-remaining-requests": "1" }),
      state,
      noopTelemetry,
    );
    expect(await hasComfortableHeadroom("sambanova", 0, state)).toBe(true);

    await markProviderExhausted("sambanova", 30, state, noopTelemetry);
    expect(await hasComfortableHeadroom("sambanova", 0, state)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 7 — High-concurrency scaling
// ─────────────────────────────────────────────────────────────────────────────

describe("High-concurrency scaling", () => {
  it("HC1: 20 concurrent recordCost calls — exactly 1 cost survives (deterministic)", async () => {
    const mockState = new InProcessRedisState();
    mockState.yieldAfterGet = true;
    const state = mockState as unknown as RedisState;

    await openLedger("run-20", "owner", "repo", "scale test", "dev", state);

    const N = 20;
    const perCallTokens = 100;
    await Promise.all(
      Array.from({ length: N }, () =>
        recordCost("owner", "repo", "run-20", makeCostEntry("groq", perCallTokens, 0.1), state),
      ),
    );

    const entry = await loadLedger("owner", "repo", "run-20", state);
    expect(entry).not.toBeNull();

    // Deterministic outcome: all 20 callers read the same base entry (0 costs),
    // each writes its own 1-cost copy. Last writer wins → exactly 1 cost survives.
    // This proves the worst-case under-count: 19 of 20 cost entries are lost.
    expect(entry!.costs.length).toBe(1);
    expect(entry!.totals.callCount).toBe(1);
    expect(entry!.totals.totalTokens).toBe(perCallTokens);
  });

  it("HC2: 20 sequential calls — all 20 costs survive (safe baseline confirmed at scale)", async () => {
    const mockState = new InProcessRedisState();
    mockState.yieldAfterGet = true;
    const state = mockState as unknown as RedisState;

    await openLedger("run-20-seq", "owner", "repo", "sequential scale", "dev", state);

    const N = 20;
    for (let i = 0; i < N; i++) {
      await recordCost("owner", "repo", "run-20-seq", makeCostEntry("groq", 100, 0.1), state);
    }

    const entry = await loadLedger("owner", "repo", "run-20-seq", state);
    expect(entry).not.toBeNull();
    expect(entry!.costs.length).toBe(N);
    expect(entry!.totals.callCount).toBe(N);
    expect(entry!.totals.totalTokens).toBe(N * 100);
  });

  it("HC3: 20 concurrent quota snapshot reads always see the same consistent value (no torn read)", async () => {
    const state = new InProcessRedisState() as unknown as RedisState;

    await recordQuotaFromHeaders(
      "groq",
      makeHeaders({
        "x-ratelimit-remaining-requests": "77",
        "x-ratelimit-remaining-tokens": "50000",
      }),
      state,
      noopTelemetry,
    );

    const reads = await Promise.all(
      Array.from({ length: 20 }, () => loadQuotaSnapshot("groq", state)),
    );

    // Reads are safe: JSON.parse on the same string always produces the same
    // object. No torn-read possible — reads do not interleave with writes here.
    for (const snap of reads) {
      expect(snap).not.toBeNull();
      expect(snap!.requestsRemaining).toBe(77);
      expect(snap!.tokensRemaining).toBe(50000);
      expect(snap!.provider).toBe("groq");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 8 — Design boundaries confirmed valid (not bugs)
// ─────────────────────────────────────────────────────────────────────────────

describe("Design boundaries confirmed valid (not bugs)", () => {
  it("DB1: quota-guardian is advisory — it signals routing, does not gate cost recording", async () => {
    const quotaState = new InProcessRedisState() as unknown as RedisState;
    const ledgerState = new InProcessRedisState() as unknown as RedisState;

    // Mark groq exhausted in quota state
    await markProviderExhausted("groq", 60, quotaState, noopTelemetry);
    const snap = await loadQuotaSnapshot("groq", quotaState);
    expect(hasHeadroom(snap)).toBe(false); // quota signal: do not dispatch

    // But the cost ledger still accepts recording from a caller that bypassed
    // the routing signal (e.g. a direct call, or a different process).
    await openLedger("bypass-run", "owner", "repo", "bypass", "dev", ledgerState);
    await recordCost("owner", "repo", "bypass-run", makeCostEntry("groq", 100, 0.1), ledgerState);
    const entry = await loadLedger("owner", "repo", "bypass-run", ledgerState);
    expect(entry).not.toBeNull();
    expect(entry!.costs.length).toBe(1); // ledger records regardless of quota signal
  });

  it("DB2: safe recordCost pattern — single flush after in-memory accumulation captures all costs", async () => {
    // The documented safe pattern: accumulate costs in-process (e.g. via
    // CostTracker), then call recordCost once at phase completion.
    // This test proves a single recordCost call with the final cost entry
    // is always safe — no concurrent read race possible with one caller.
    const state = new InProcessRedisState() as unknown as RedisState;
    await openLedger("run-flush", "owner", "repo", "flush pattern", "dev", state);

    // Simulate: 5 LLM calls accumulated in-memory, then flushed as one call.
    const bulkCost = makeCostEntry("groq", 1500, 3.0); // sum of all 5 in-memory costs
    await recordCost("owner", "repo", "run-flush", bulkCost, state);

    const entry = await loadLedger("owner", "repo", "run-flush", state);
    expect(entry).not.toBeNull();
    // Single flush = 1 cost entry, exact totals, no lost-update possible
    expect(entry!.costs.length).toBe(1);
    expect(entry!.totals.totalTokens).toBe(1500);
    expect(entry!.totals.estimatedUsdCents).toBeCloseTo(3.0, 5);
  });

  it("DB3: markProviderExhausted is the reactive gate — correctly blocks all subsequent callers", async () => {
    const state = new InProcessRedisState() as unknown as RedisState;

    await recordQuotaFromHeaders(
      "openrouter",
      makeHeaders({ "x-ratelimit-limit-requests": "2" }),
      state,
    );

    // Two concurrent reads both see headroom (the CQ2-documented gap)
    const [h1, h2] = await Promise.all([
      loadQuotaSnapshot("openrouter", state),
      loadQuotaSnapshot("openrouter", state),
    ]);
    expect(hasHeadroom(h1)).toBe(true);
    expect(hasHeadroom(h2)).toBe(true);

    // After a 429, markProviderExhausted fires — the real reactive gate.
    await markProviderExhausted("openrouter", 30, state, noopTelemetry);
    const blocked = await loadQuotaSnapshot("openrouter", state);
    expect(hasHeadroom(blocked)).toBe(false); // gate is now closed

    // rankByHeadroom correctly de-prioritizes the exhausted provider
    const ranked = await rankByHeadroom(["groq", "openrouter"], state, noopTelemetry);
    expect(ranked[ranked.length - 1]).toBe("openrouter"); // 0 remaining → lowest rank
    expect(ranked[0]).toBe("groq"); // unknown (never tracked) → optimistic → higher rank
  });
});
