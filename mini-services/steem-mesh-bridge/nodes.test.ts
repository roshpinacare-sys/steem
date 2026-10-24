// G71-2c — steem-mesh-bridge · nodes.test.ts
// Contract tests for the health-ranked node pool + circuit breaker.
// Zero network: fetch is injected. Zero Date.now in module logic: clock is injected.
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_EMA_MS,
  NodePool,
  healthScore,
  type FetchLike,
} from "./nodes";

/** Fully manual clock — time moves only when the test says so. */
function manualClock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    fn: () => now,
  };
}

/** Narrows the empty-array branch — an empty pool is always a loud test failure. */
function first<T>(arr: T[]): T {
  if (arr.length === 0) throw new Error("expected non-empty array");
  return arr[0] as T;
}

const failFetch: FetchLike = async () => {
  throw new Error("boom");
};

function makePool(
  nodes: string[],
  opts: {
    fetch?: FetchLike;
    clock?: () => number;
    threshold?: number;
    cooldownMs?: number;
  } = {},
): NodePool {
  return new NodePool({
    nodes,
    fetch: opts.fetch ?? failFetch,
    clock: opts.clock ?? manualClock().fn,
    breaker: { failureThreshold: opts.threshold ?? 3, cooldownMs: opts.cooldownMs ?? 100 },
    timeoutMs: 50,
  });
}

describe("health score (deterministic, pure)", () => {
  test("fresh node with zero observations is neutral 70", () => {
    const n = {
      url: "https://x.test",
      state: "CLOSED" as const,
      emaLatencyMs: null,
      successCount: 0,
      failureCount: 0,
      consecutiveFailures: 0,
      openedAt: null,
      probeInFlight: false,
    };
    expect(healthScore(n)).toBe(70);
  });

  test("more failures lowers the score below fresh", () => {
    const base = {
      url: "https://x.test",
      state: "CLOSED" as const,
      emaLatencyMs: null,
      consecutiveFailures: 0,
      openedAt: null,
      probeInFlight: false,
    };
    const good = healthScore({ ...base, successCount: 9, failureCount: 1 });
    const bad = healthScore({ ...base, successCount: 1, failureCount: 9 });
    expect(good).toBeGreaterThan(bad);
    expect(bad).toBe(6 + 40); // successRate 0.1 → 60*0.1 + 40*1 = 46
  });

  test("higher latency lowers the latency factor", () => {
    const n = {
      url: "https://x.test",
      state: "CLOSED" as const,
      successCount: 5,
      failureCount: 0,
      consecutiveFailures: 0,
      openedAt: null,
      probeInFlight: false,
    };
    const fast = healthScore({ ...n, emaLatencyMs: 50 });
    const slow = healthScore({ ...n, emaLatencyMs: 5000 });
    expect(fast).toBeGreaterThan(slow);
    expect(slow).toBeGreaterThanOrEqual(0);
  });

  test("DEFAULT_EMA_MS is exported and finite", () => {
    expect(Number.isFinite(DEFAULT_EMA_MS)).toBe(true);
  });
});

describe("ranking (failover order)", () => {
  test("equal fresh nodes rank by url ascending (deterministic)", () => {
    const pool = makePool(["https://c.test", "https://a.test", "https://b.test"]);
    expect(pool.rank().map((n) => n.url)).toEqual([
      "https://a.test",
      "https://b.test",
      "https://c.test",
    ]);
  });

  test("a node with a recent failure ranks behind a fresh node", () => {
    const pool = makePool(["https://a.test", "https://b.test"]);
    pool.reportFailure("https://a.test");
    expect(pool.rank().map((n) => n.url)).toEqual(["https://b.test", "https://a.test"]);
  });

  test("a node with recorded success+latency ranks first", () => {
    const pool = makePool(["https://a.test", "https://b.test"]);
    pool.reportSuccess("https://b.test", 40);
    pool.reportFailure("https://a.test");
    pool.reportFailure("https://a.test");
    expect(first(pool.rank()).url).toBe("https://b.test");
  });
});

describe("circuit breaker", () => {
  test("CLOSED → OPEN after failureThreshold consecutive failures (deterministic)", () => {
    const pool = makePool(["https://a.test"], { threshold: 3 });
    pool.reportFailure("https://a.test");
    pool.reportFailure("https://a.test");
    expect(first(pool.snapshot()).state).toBe("CLOSED");
    pool.reportFailure("https://a.test");
    expect(first(pool.snapshot()).state).toBe("OPEN");
    expect(pool.rank()).toEqual([]); // OPEN nodes are excluded from failover
  });

  test("transitions are drained exactly once in order", () => {
    const clock = manualClock();
    const pool = makePool(["https://a.test"], { threshold: 2, cooldownMs: 100, clock: clock.fn });
    pool.reportFailure("https://a.test");
    pool.reportFailure("https://a.test");
    pool.drainTransitions();
    expect(pool.drainTransitions()).toEqual([]); // drained
    pool.rank(clock.now() + 10); // cooldown not elapsed → no transition
    expect(pool.drainTransitions()).toEqual([]);
    pool.reportSuccess("https://a.test", 10); // manual recovery also possible
    expect(first(pool.snapshot()).state).toBe("CLOSED");
    expect(pool.drainTransitions()).toEqual([
      { url: "https://a.test", from: "OPEN", to: "CLOSED", kind: "CLOSED", at: expect.any(Number) },
    ]);
  });

  test("OPEN → HALF_OPEN after cooldown, on rank evaluation", () => {
    const clock = manualClock();
    const pool = makePool(["https://a.test"], { threshold: 1, cooldownMs: 100, clock: clock.fn });
    pool.reportFailure("https://a.test");
    expect(first(pool.snapshot()).state).toBe("OPEN");
    pool.rank(clock.now() + 50); // 50ms < 100ms cooldown
    expect(first(pool.snapshot()).state).toBe("OPEN");
    pool.rank(clock.now() + 100); // cooldown elapsed
    expect(first(pool.snapshot()).state).toBe("HALF_OPEN");
    expect(pool.drainTransitions().map((t) => t.kind)).toEqual(["OPEN", "HALF_OPEN"]);
  });

  test("HALF_OPEN allows a single probe: beginProbe excludes it until resolved", () => {
    const clock = manualClock();
    const pool = makePool(["https://a.test"], { threshold: 1, cooldownMs: 100, clock: clock.fn });
    pool.reportFailure("https://a.test");
    pool.rank(clock.now() + 100); // → HALF_OPEN
    expect(pool.rank().map((n) => n.url)).toEqual(["https://a.test"]);
    pool.beginProbe("https://a.test");
    expect(pool.rank()).toEqual([]); // probe in flight → single-probe law
    pool.reportSuccess("https://a.test", 30);
    expect(first(pool.snapshot()).state).toBe("CLOSED");
    expect(pool.rank().map((n) => n.url)).toEqual(["https://a.test"]);
  });

  test("HALF_OPEN probe failure → REOPEN (back to OPEN with fresh cooldown)", () => {
    const clock = manualClock();
    const pool = makePool(["https://a.test"], { threshold: 1, cooldownMs: 1_000, clock: clock.fn });
    pool.reportFailure("https://a.test");
    pool.rank(clock.now() + 1_000); // → HALF_OPEN
    pool.beginProbe("https://a.test");
    pool.reportFailure("https://a.test"); // probe failed → REOPEN
    expect(first(pool.snapshot()).state).toBe("OPEN");
    expect(pool.drainTransitions().map((t) => t.kind)).toEqual(["OPEN", "HALF_OPEN", "REOPEN"]);
    const reopened = first(pool.snapshot());
    expect(reopened.state).toBe("OPEN");
    expect(reopened.nextProbeAt).not.toBeNull();
    expect(pool.rank((reopened.nextProbeAt as number) - 1)).toEqual([]); // fresh cooldown → still excluded
    expect(pool.rank(reopened.nextProbeAt as number).map((n) => n.url)).toEqual([
      "https://a.test",
    ]); // eligible again after cooldown
  });

  test("success resets consecutive failures; threshold counts only consecutive", () => {
    const pool = makePool(["https://a.test"], { threshold: 3 });
    pool.reportFailure("https://a.test");
    pool.reportFailure("https://a.test");
    pool.reportSuccess("https://a.test", 10);
    pool.reportFailure("https://a.test");
    pool.reportFailure("https://a.test");
    expect(first(pool.snapshot()).state).toBe("CLOSED"); // streak broken at 2
  });
});

describe("pool honesty", () => {
  test("snapshot reports full per-node truth", () => {
    const pool = makePool(["https://a.test", "https://b.test"]);
    pool.reportSuccess("https://a.test", 25);
    pool.reportFailure("https://b.test");
    const snap = pool.snapshot();
    const a = snap.find((n) => n.url === "https://a.test");
    const b = snap.find((n) => n.url === "https://b.test");
    expect(a).toMatchObject({ state: "CLOSED", successCount: 1, failureCount: 0 });
    expect(a?.emaLatencyMs).toBeCloseTo(25);
    expect(b).toMatchObject({
      state: "CLOSED",
      successCount: 0,
      failureCount: 1,
      consecutiveFailures: 1,
    });
  });

  test("healthyCount counts only CLOSED nodes", () => {
    const clock = manualClock();
    const pool = makePool(["https://a.test", "https://b.test"], {
      threshold: 1,
      cooldownMs: 10,
      clock: clock.fn,
    });
    expect(pool.healthyCount()).toBe(2);
    pool.reportFailure("https://a.test");
    pool.rank(clock.now() + 10); // a → HALF_OPEN
    expect(pool.healthyCount()).toBe(1);
  });

  test("unknown url reports are ignored (fail-closed, no invented nodes)", () => {
    const pool = makePool(["https://a.test"]);
    pool.reportSuccess("https://ghost.test", 10);
    pool.reportFailure("https://ghost.test");
    expect(pool.snapshot()).toHaveLength(1);
  });
});
