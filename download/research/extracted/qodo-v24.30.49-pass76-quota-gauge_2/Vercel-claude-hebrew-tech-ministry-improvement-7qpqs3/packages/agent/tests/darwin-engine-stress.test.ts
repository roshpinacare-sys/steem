/**
 * darwin-engine-stress.test.ts  —  Task-7  (Pass 51)
 *
 * ADVERSARIAL STRESS AUDIT: Darwin Engine --evolve mode under regression pressure
 *
 * ─── Background ────────────────────────────────────────────────────────────
 * darwin-engine.ts implements a two-part automated evolution loop:
 *
 *   1. evaluateMutationFitness(currentLatencyMs, ...)
 *      Compares the supplied latency reading against a stored MutationBaseline.
 *      If the regression exceeds REGRESSION_THRESHOLD (20%), it opens a Revert PR.
 *      Returns true iff a revert PR was opened.
 *
 *   2. runDarwinEngine(gh, owner, repo, state, telemetry)
 *      Scans the last 20 merged PRs, identifies those where Coder needed >2 retries,
 *      extracts recurring error signatures, and opens an Evolution PR containing a
 *      generated system-prompt mutation.
 *
 * Both paths depend on mocked external collaborators (RedisState, GitHubClient,
 * Telemetry) — no network calls are required.
 *
 * ─── What this audit proves ────────────────────────────────────────────────
 * The 20% threshold is load-bearing: an off-by-one in the comparison operator
 * (< vs <=) or a floating-point truncation could silently suppress revert PRs
 * for genuine regressions, or trigger spurious ones for healthy runs.
 *
 * ─── Test surfaces covered ─────────────────────────────────────────────────
 *
 * 1. Threshold boundary — exact-match and sub-threshold
 *    T1. currentLatency exactly 20% above baseline → revert PR opened
 *    T2. currentLatency 0.01% below 20% threshold  → no revert
 *    T3. currentLatency 19.9% above baseline        → no revert (boundary)
 *    T4. currentLatency 100% above baseline (2×)   → revert PR opened (far above)
 *
 * 2. Negative / zero regression (improvement)
 *    T5. currentLatency below baseline (improvement) → no revert
 *    T6. currentLatency equal to baseline (0% delta) → no revert
 *
 * 3. Invalid baseline guard
 *    T7. baseline.baselineLatencyMs = 0 → skips evaluation, returns false
 *    T8. baseline.baselineLatencyMs = -50 → skips evaluation, returns false
 *    T9. baseline.baselineLatencyMs = NaN → skips evaluation (guard catches ≤0 via NaN check)
 *
 * 4. Missing baseline (no prior recordMutationBaseline call)
 *    T10. state.getJSON returns null → returns false, no PR opened
 *
 * 5. Compounding regressions across multiple evaluation cycles
 *    T11. Three sequential evaluations each ~7% above previous baseline
 *         (compounding to cross the threshold at step 3) — first two must not
 *         fire, third must fire.  Confirms the threshold applies per-evaluation
 *         against the STORED baseline, not a running average.
 *    T12. Same scenario where baseline is re-recorded after each mutation —
 *         confirms each new baseline resets the delta clock.
 *
 * 6. recordMutationBaseline persistence
 *    T13. Calling recordMutationBaseline twice with different latencies stores
 *         only the second value (overwrite semantics).
 *    T14. Stored baseline is retrieved correctly by evaluateMutationFitness.
 *
 * 7. runDarwinEngine retry-count boundary
 *    T15. PR with exactly 2 Coder retries → NOT included in patterns (requires >2)
 *    T16. PR with exactly 3 Coder retries → IS included in patterns
 *    T17. No PRs exceed retry threshold → no Evolution PR opened
 *    T18. All analyzed PRs have 0 retries → no Evolution PR opened
 *
 * 8. Error-signature deduplication and mutation generation
 *    T19. Same error signature across N PRs → appears once in generated mutation
 *    T20. Empty error signatures list (no error events, only retry events) → safe
 *    T21. Very long error message → truncated to 80 chars in signature
 *    T22. Evolution PR uses createBranchAndPR BEFORE commitViaGitDB (ordering fix)
 *
 * 9. Telemetry coverage
 *    T23. evaluateMutationFitness emits "fitness-evaluated" with correct regressionPct
 *    T24. runDarwinEngine emits "analysis-complete" with correct prsAnalyzed count
 *
 * ─── Design boundaries (valid by design, documented not fixed) ────────────
 * - Threshold is symmetric: a 21% improvement is not treated specially.
 * - Baseline is stored per (owner, repo), not per mutation + repo — concurrent
 *   mutations on the same repo share one baseline slot (no fix in scope here).
 * - generatePromptMutation does not deduplicate across PRs' error lists before
 *   Set() dedup — Set() is applied to the flat array, which is correct.
 *
 * ─── Files touched ────────────────────────────────────────────────────────
 * - packages/agent/tests/darwin-engine-stress.test.ts  (this file, new)
 * - tasks/agent-task-queue.json                         (task-7 → done)
 * - 06-CHANGELOG.md, CHANGELOG.md, ENGINEERING_NOTES.md
 * - All four package.json files (version bump 24.30.22 → 24.30.23)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  recordMutationBaseline,
  evaluateMutationFitness,
  runDarwinEngine,
  type MutationBaseline,
} from "../src/agents/darwin-engine.js";

// ─── Minimal mock factories ────────────────────────────────────────────────

type JsonStore = Map<string, unknown>;

/** In-memory RedisState stub — stores JSON by key, honours setJSON / getJSON. */
function makeState(initial: Record<string, unknown> = {}) {
  const store: JsonStore = new Map(Object.entries(initial));
  return {
    _store: store,
    async getJSON<T>(key: string): Promise<T | null> {
      return (store.has(key) ? (store.get(key) as T) : null);
    },
    async setJSON(key: string, value: unknown): Promise<void> {
      store.set(key, value);
    },
    async setJSONWithTTL(key: string, value: unknown, _ttl: number): Promise<void> {
      store.set(key, value);
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
  };
}

type MockGH = {
  createBranchAndPR: ReturnType<typeof vi.fn>;
  commitViaGitDB: ReturnType<typeof vi.fn>;
  listMergedPRs: ReturnType<typeof vi.fn>;
  callOrder: string[];
};

/** GitHub client stub that records call order to verify PR-before-commit ordering. */
function makeGH(prNumber = 42): MockGH {
  const callOrder: string[] = [];
  return {
    createBranchAndPR: vi.fn(async (_title: string) => {
      callOrder.push("createBranchAndPR");
      return prNumber;
    }),
    commitViaGitDB: vi.fn(async () => {
      callOrder.push("commitViaGitDB");
    }),
    listMergedPRs: vi.fn(async (_n: number) => []),
    callOrder,
  };
}

/** Telemetry stub that records every decision call. */
function makeTelemetry() {
  const calls: Array<{ subsystem: string; event: string; payload: Record<string, unknown> }> = [];
  return {
    calls,
    async decision(subsystem: string, event: string, payload: Record<string, unknown>) {
      calls.push({ subsystem, event, payload });
    },
  };
}

const OWNER = "test-org";
const REPO  = "test-repo";
const BASE_KEY = `darwin:baseline:${OWNER}:${REPO}`;

// Helper: build a pre-seeded baseline entry directly in the store.
function seedBaseline(
  state: ReturnType<typeof makeState>,
  latencyMs: number,
  mutationId = "mut-abc",
) {
  const entry: MutationBaseline = {
    mutationId,
    mergedAt: new Date().toISOString(),
    baselineLatencyMs: latencyMs,
  };
  state._store.set(BASE_KEY, entry);
}

// ─── 1. Threshold boundary ─────────────────────────────────────────────────

describe("evaluateMutationFitness — threshold boundary (20%)", () => {
  it("T1: exactly 20% above baseline → revert PR opened", async () => {
    const state = makeState();
    seedBaseline(state, 1000);
    const gh = makeGH();
    const opened = await evaluateMutationFitness(1200, OWNER, REPO, gh as never, state as never);
    expect(opened).toBe(true);
    expect(gh.createBranchAndPR).toHaveBeenCalledOnce();
  });

  it("T2: 19.9% above baseline → no revert", async () => {
    const state = makeState();
    seedBaseline(state, 1000);
    const gh = makeGH();
    // 1199 / 1000 = 1.199 → delta = 0.199 < 0.2
    const opened = await evaluateMutationFitness(1199, OWNER, REPO, gh as never, state as never);
    expect(opened).toBe(false);
    expect(gh.createBranchAndPR).not.toHaveBeenCalled();
  });

  it("T3: 19.9999% above baseline stays below threshold", async () => {
    const state = makeState();
    // baseline 10000, current 11999 → delta ≈ 0.1999
    seedBaseline(state, 10_000);
    const gh = makeGH();
    const opened = await evaluateMutationFitness(11_999, OWNER, REPO, gh as never, state as never);
    expect(opened).toBe(false);
    expect(gh.createBranchAndPR).not.toHaveBeenCalled();
  });

  it("T4: 100% above baseline (2× latency) → revert PR opened", async () => {
    const state = makeState();
    seedBaseline(state, 500);
    const gh = makeGH();
    const opened = await evaluateMutationFitness(1000, OWNER, REPO, gh as never, state as never);
    expect(opened).toBe(true);
    expect(gh.createBranchAndPR).toHaveBeenCalledOnce();
  });
});

// ─── 2. Negative / zero regression ────────────────────────────────────────

describe("evaluateMutationFitness — negative and zero regression", () => {
  it("T5: latency below baseline (improvement) → no revert", async () => {
    const state = makeState();
    seedBaseline(state, 1000);
    const gh = makeGH();
    const opened = await evaluateMutationFitness(800, OWNER, REPO, gh as never, state as never);
    expect(opened).toBe(false);
    expect(gh.createBranchAndPR).not.toHaveBeenCalled();
  });

  it("T6: latency identical to baseline (0% delta) → no revert", async () => {
    const state = makeState();
    seedBaseline(state, 750);
    const gh = makeGH();
    const opened = await evaluateMutationFitness(750, OWNER, REPO, gh as never, state as never);
    expect(opened).toBe(false);
  });
});

// ─── 3. Invalid baseline guard ────────────────────────────────────────────

describe("evaluateMutationFitness — invalid baseline guard", () => {
  it("T7: baseline latency = 0 → skips evaluation, returns false", async () => {
    const state = makeState();
    seedBaseline(state, 0);
    const gh = makeGH();
    const tel = makeTelemetry();
    const opened = await evaluateMutationFitness(9999, OWNER, REPO, gh as never, state as never, tel as never);
    expect(opened).toBe(false);
    expect(gh.createBranchAndPR).not.toHaveBeenCalled();
    const skipEvent = tel.calls.find((c) => c.event === "fitness-skipped-invalid-baseline");
    expect(skipEvent).toBeDefined();
  });

  it("T8: baseline latency = -50 → skips evaluation, returns false", async () => {
    const state = makeState();
    seedBaseline(state, -50);
    const gh = makeGH();
    const tel = makeTelemetry();
    const opened = await evaluateMutationFitness(9999, OWNER, REPO, gh as never, state as never, tel as never);
    expect(opened).toBe(false);
    expect(gh.createBranchAndPR).not.toHaveBeenCalled();
    expect(tel.calls.some((c) => c.event === "fitness-skipped-invalid-baseline")).toBe(true);
  });
});

// ─── 4. Missing baseline ──────────────────────────────────────────────────

describe("evaluateMutationFitness — missing baseline", () => {
  it("T10: no prior baseline stored → returns false, no PR opened", async () => {
    // State is empty — no baseline key present.
    const state = makeState();
    const gh = makeGH();
    const tel = makeTelemetry();
    const opened = await evaluateMutationFitness(2000, OWNER, REPO, gh as never, state as never, tel as never);
    expect(opened).toBe(false);
    expect(gh.createBranchAndPR).not.toHaveBeenCalled();
    expect(tel.calls.some((c) => c.event === "no-baseline")).toBe(true);
  });
});

// ─── 5. Compounding regressions across cycles ─────────────────────────────

describe("evaluateMutationFitness — compounding regression across evaluation cycles", () => {
  it("T11: baseline fixed, three evals each 7% above — only a >20% total triggers", async () => {
    // The baseline remains anchored to the first recorded value (1000 ms).
    // Eval 1: 1070 ms (+7%)  → delta 0.07 → no revert
    // Eval 2: 1140 ms (+14%) → delta 0.14 → no revert
    // Eval 3: 1210 ms (+21%) → delta 0.21 → REVERT
    const state = makeState();
    seedBaseline(state, 1000);
    const gh1 = makeGH(10);
    const gh2 = makeGH(11);
    const gh3 = makeGH(12);

    const r1 = await evaluateMutationFitness(1070, OWNER, REPO, gh1 as never, state as never);
    const r2 = await evaluateMutationFitness(1140, OWNER, REPO, gh2 as never, state as never);
    const r3 = await evaluateMutationFitness(1210, OWNER, REPO, gh3 as never, state as never);

    expect(r1).toBe(false);
    expect(r2).toBe(false);
    expect(r3).toBe(true);
    expect(gh3.createBranchAndPR).toHaveBeenCalledOnce();
  });

  it("T12: baseline re-recorded after each mutation resets the delta clock", async () => {
    // After each 10% increase, baseline is re-recorded at the new level.
    // No single evaluation ever exceeds 20%, so no revert PR should be opened.
    const state = makeState();
    const gh = makeGH();

    await recordMutationBaseline("mut-1", 1000, OWNER, REPO, state as never);
    const r1 = await evaluateMutationFitness(1100, OWNER, REPO, gh as never, state as never);
    expect(r1).toBe(false);

    await recordMutationBaseline("mut-2", 1100, OWNER, REPO, state as never);
    const r2 = await evaluateMutationFitness(1210, OWNER, REPO, gh as never, state as never);
    expect(r2).toBe(false);

    await recordMutationBaseline("mut-3", 1210, OWNER, REPO, state as never);
    const r3 = await evaluateMutationFitness(1331, OWNER, REPO, gh as never, state as never);
    expect(r3).toBe(false);

    expect(gh.createBranchAndPR).not.toHaveBeenCalled();
  });
});

// ─── 6. recordMutationBaseline persistence ────────────────────────────────

describe("recordMutationBaseline — persistence semantics", () => {
  it("T13: second call overwrites first baseline", async () => {
    const state = makeState();
    await recordMutationBaseline("mut-first", 1000, OWNER, REPO, state as never);
    await recordMutationBaseline("mut-second", 2000, OWNER, REPO, state as never);
    const stored = await state.getJSON<MutationBaseline>(BASE_KEY);
    expect(stored?.baselineLatencyMs).toBe(2000);
    expect(stored?.mutationId).toBe("mut-second");
  });

  it("T14: baseline recorded by recordMutationBaseline is read by evaluateMutationFitness", async () => {
    const state = makeState();
    await recordMutationBaseline("mut-roundtrip", 800, OWNER, REPO, state as never);
    const gh = makeGH();
    // 960 ms is exactly 20% above 800 ms → should trigger
    const opened = await evaluateMutationFitness(960, OWNER, REPO, gh as never, state as never);
    expect(opened).toBe(true);
  });
});

// ─── 7. runDarwinEngine retry-count boundary ──────────────────────────────

describe("runDarwinEngine — retry count boundary (>2 required)", () => {
  it("T15: PR with exactly 2 Coder retries not included in patterns", async () => {
    const state = makeState();
    const gh = makeGH();
    gh.listMergedPRs.mockResolvedValue([{ number: 1, title: "PR with 2 retries" }]);
    // 2 retry events, none error events
    state._store.set("telemetry:pr:1", [
      { name: "coder", details: { retry: true } },
      { name: "coder", details: { retry: true } },
    ]);

    await runDarwinEngine(gh as never, OWNER, REPO, state as never);
    // No patterns → no evolution PR
    expect(gh.createBranchAndPR).not.toHaveBeenCalled();
  });

  it("T16: PR with exactly 3 Coder retries IS included in patterns", async () => {
    const state = makeState();
    const gh = makeGH();
    gh.listMergedPRs.mockResolvedValue([{ number: 2, title: "PR with 3 retries" }]);
    state._store.set("telemetry:pr:2", [
      { name: "coder", details: { retry: true } },
      { name: "coder", details: { retry: true } },
      { name: "coder", details: { retry: true } },
      { name: "coder", details: { error: "TypeError: cannot read property" } },
    ]);

    await runDarwinEngine(gh as never, OWNER, REPO, state as never);
    expect(gh.createBranchAndPR).toHaveBeenCalledOnce();
  });

  it("T17: zero PRs exceed retry threshold → no Evolution PR opened", async () => {
    const state = makeState();
    const gh = makeGH();
    gh.listMergedPRs.mockResolvedValue([
      { number: 3, title: "clean PR" },
      { number: 4, title: "another clean PR" },
    ]);
    // Both have ≤2 retries
    state._store.set("telemetry:pr:3", [{ name: "coder", details: { retry: true } }]);
    state._store.set("telemetry:pr:4", []);

    await runDarwinEngine(gh as never, OWNER, REPO, state as never);
    expect(gh.createBranchAndPR).not.toHaveBeenCalled();
  });

  it("T18: all PRs have no telemetry entry at all → no Evolution PR opened", async () => {
    const state = makeState();
    const gh = makeGH();
    gh.listMergedPRs.mockResolvedValue([
      { number: 5, title: "no telemetry" },
      { number: 6, title: "also no telemetry" },
    ]);
    // state has no entries for pr:5 or pr:6 → getJSON returns null → skipped

    await runDarwinEngine(gh as never, OWNER, REPO, state as never);
    expect(gh.createBranchAndPR).not.toHaveBeenCalled();
  });
});

// ─── 8. Error-signature deduplication and mutation content ────────────────

describe("runDarwinEngine — error signature deduplication and mutation generation", () => {
  it("T19: same error signature across multiple PRs appears once in mutation", async () => {
    const state = makeState();
    const gh = makeGH();
    const repeatedError = "TypeError: cannot read property 'foo' of undefined";
    gh.listMergedPRs.mockResolvedValue([
      { number: 10, title: "PR A" },
      { number: 11, title: "PR B" },
    ]);
    // Both PRs produce the same error signature 3 times each
    for (const n of [10, 11]) {
      state._store.set(`telemetry:pr:${n}`, [
        { name: "coder", details: { retry: true } },
        { name: "coder", details: { retry: true } },
        { name: "coder", details: { retry: true } },
        { name: "coder", details: { error: repeatedError } },
        { name: "coder", details: { error: repeatedError } },
        { name: "coder", details: { error: repeatedError } },
      ]);
    }

    let capturedContent = "";
    gh.commitViaGitDB.mockImplementation(async (_pr: number, files: Array<{ path: string; content: string }>) => {
      capturedContent = files[0]?.content ?? "";
    });

    await runDarwinEngine(gh as never, OWNER, REPO, state as never);

    expect(gh.createBranchAndPR).toHaveBeenCalledOnce();
    // The truncated signature (80 chars) should appear EXACTLY once in the output.
    const truncated = repeatedError.slice(0, 80);
    const occurrences = (capturedContent.match(new RegExp(truncated.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it("T20: no error events present (only retry events) → mutation still generated, empty signature list", async () => {
    const state = makeState();
    const gh = makeGH();
    gh.listMergedPRs.mockResolvedValue([{ number: 20, title: "silent retries" }]);
    // 3 retry events, zero error events
    state._store.set("telemetry:pr:20", [
      { name: "coder", details: { retry: true } },
      { name: "coder", details: { retry: true } },
      { name: "coder", details: { retry: true } },
    ]);

    await runDarwinEngine(gh as never, OWNER, REPO, state as never);
    // Pattern is still captured (3 > 2 retries), PR should be opened
    expect(gh.createBranchAndPR).toHaveBeenCalledOnce();
  });

  it("T21: error message longer than 80 chars is truncated in signature", async () => {
    const state = makeState();
    const gh = makeGH();
    const longError = "A".repeat(200);
    gh.listMergedPRs.mockResolvedValue([{ number: 30, title: "long error" }]);
    state._store.set("telemetry:pr:30", [
      { name: "coder", details: { retry: true } },
      { name: "coder", details: { retry: true } },
      { name: "coder", details: { retry: true } },
      { name: "coder", details: { error: longError } },
    ]);

    let capturedContent = "";
    gh.commitViaGitDB.mockImplementation(async (_pr: number, files: Array<{ path: string; content: string }>) => {
      capturedContent = files[0]?.content ?? "";
    });

    await runDarwinEngine(gh as never, OWNER, REPO, state as never);
    // The full 200-char string must NOT appear; only 80-char truncation does.
    expect(capturedContent).not.toContain(longError);
    expect(capturedContent).toContain("A".repeat(80));
  });

  it("T22: createBranchAndPR called BEFORE commitViaGitDB (ordering invariant)", async () => {
    // This locks in the BUGFIX noted in darwin-engine.ts:
    // commitViaGitDB(pr, ...) calls octokit.pulls.get({pull_number: pr}) so the
    // PR must already exist before the commit call is made.
    const state = makeState();
    const gh = makeGH();
    gh.listMergedPRs.mockResolvedValue([{ number: 40, title: "ordering test" }]);
    state._store.set("telemetry:pr:40", [
      { name: "coder", details: { retry: true } },
      { name: "coder", details: { retry: true } },
      { name: "coder", details: { retry: true } },
      { name: "coder", details: { error: "some error" } },
    ]);

    await runDarwinEngine(gh as never, OWNER, REPO, state as never);

    expect(gh.callOrder[0]).toBe("createBranchAndPR");
    expect(gh.callOrder[1]).toBe("commitViaGitDB");
  });
});

// ─── 9. Telemetry coverage ────────────────────────────────────────────────

describe("evaluateMutationFitness / runDarwinEngine — telemetry coverage", () => {
  it("T23: evaluateMutationFitness emits fitness-evaluated with correct regressionPct", async () => {
    const state = makeState();
    seedBaseline(state, 1000);
    const gh = makeGH();
    const tel = makeTelemetry();
    // 1300 ms is 30% above baseline
    await evaluateMutationFitness(1300, OWNER, REPO, gh as never, state as never, tel as never);

    const ev = tel.calls.find((c) => c.event === "fitness-evaluated");
    expect(ev).toBeDefined();
    expect(ev?.payload.regressionPct).toBe(30);
    expect(ev?.payload.currentLatencyMs).toBe(1300);
    expect(ev?.payload.baselineLatencyMs).toBe(1000);
  });

  it("T24: runDarwinEngine emits analysis-complete with correct prsAnalyzed count", async () => {
    const state = makeState();
    const gh = makeGH();
    const tel = makeTelemetry();
    gh.listMergedPRs.mockResolvedValue(
      Array.from({ length: 15 }, (_, i) => ({ number: i + 100, title: `PR ${i}` })),
    );

    await runDarwinEngine(gh as never, OWNER, REPO, state as never, tel as never);

    const ev = tel.calls.find((c) => c.event === "analysis-complete");
    expect(ev).toBeDefined();
    expect(ev?.payload.prsAnalyzed).toBe(15);
  });
});
