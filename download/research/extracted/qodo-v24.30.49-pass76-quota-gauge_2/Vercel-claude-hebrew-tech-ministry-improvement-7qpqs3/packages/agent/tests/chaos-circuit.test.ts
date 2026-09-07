/**
 * chaos-circuit.test.ts — Task-16 (Pass 53)
 *
 * CHAOS-MONKEY × CIRCUIT-BREAKER INTERACTION STRESS TEST
 *
 * ─── Background ────────────────────────────────────────────────────────────
 * circuit-breaker.ts and the ai-router's fault-injection pattern are each
 * tested in isolation elsewhere in this suite. The existing
 * circuit-breaker.test.ts confirms unit-level state-machine correctness.
 *
 * This pass (task-16) targets the *interaction surface*: does the circuit
 * breaker correctly open, half-open, and close when a chaos-monkey-style
 * fault injector systematically injects failures across multiple pipeline
 * phases in the same run? The audit history of this repo shows the highest-
 * risk regressions live at these interaction boundaries — both subsystems
 * being independently correct is no guarantee that their composition behaves
 * correctly.
 *
 * ─── What this pass proves ─────────────────────────────────────────────────
 * 1. A ChaosMonkey injecting exactly failureThreshold failures trips the
 *    circuit from CLOSED to OPEN.
 * 2. No call reaches the underlying provider while the circuit is OPEN.
 * 3. After resetTimeoutMs elapses, the circuit transitions to HALF_OPEN
 *    and allows exactly one probe call through.
 * 4. A successful probe closes the circuit and resets the failure count.
 * 5. A failed probe re-opens the circuit with a fresh reset timeout.
 * 6. Multiple independent circuit breakers (one per AI provider) fail and
 *    recover independently — one tripped breaker does not affect others.
 * 7. Interleaved successes reset the consecutive failure counter, so a
 *    circuit that sees success→failure→success→failure never opens unless
 *    failureThreshold *consecutive* failures occur.
 * 8. Concurrent phase invocations (Promise.all) that all fail trip the
 *    breaker correctly without leaving it in an undefined state.
 * 9. A full simulated multi-phase pipeline run with chaos injection
 *    demonstrates the complete CLOSED→OPEN→HALF_OPEN→CLOSED lifecycle.
 *
 * ─── Scope / caveats ───────────────────────────────────────────────────────
 * All time advancement uses vi.useFakeTimers() / vi.setSystemTime() to
 * control Date.now() without real delays. No network, no Redis, no file
 * system required. Only circuit-breaker.ts is imported; all providers are
 * simulated in-process.
 *
 * ─── Files touched ─────────────────────────────────────────────────────────
 * - packages/agent/tests/chaos-circuit.test.ts  (this file, new)
 * - tasks/agent-task-queue.json                  (task-16 → done)
 * - 06-CHANGELOG.md, CHANGELOG.md, ENGINEERING_NOTES.md
 * - package.json files (version bump 24.30.24 → 24.30.25)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
  type CBState,
} from "../src/services/circuit-breaker.js";

// ─────────────────────────────────────────────────────────────────────────────
// ChaosMonkey helper — in-process fault injector
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ChaosMonkey wraps an underlying provider function and injects configurable
 * failures before allowing calls to succeed, simulating a flaky AI provider
 * across pipeline phases.
 *
 * Configuration:
 * - failCount:     number of consecutive errors to inject before succeeding.
 * - errorFactory:  produces the error thrown on each injected failure.
 * - phase:         label for the calls record (defaults to "unknown").
 */
class ChaosMonkey<T> {
  private callCount = 0;
  private injectedFailures = 0;
  private successCount = 0;
  readonly calls: Array<{ phase: string; attempt: number; outcome: "failure" | "success" }> = [];

  constructor(
    private readonly provider: () => Promise<T>,
    private readonly config: {
      failCount: number;
      errorFactory?: (attempt: number) => Error;
      phase?: string;
    },
  ) {}

  /**
   * Execute the provider, injecting a failure if the configured failure count
   * has not yet been exhausted.
   */
  async execute(): Promise<T> {
    this.callCount++;
    const attempt = this.callCount;
    const phase = this.config.phase ?? "unknown";

    if (this.injectedFailures < this.config.failCount) {
      this.injectedFailures++;
      const err =
        this.config.errorFactory
          ? this.config.errorFactory(attempt)
          : Object.assign(
              new Error(`chaos-monkey: injected failure #${this.injectedFailures}`),
              { status: 503 },
            );
      this.calls.push({ phase, attempt, outcome: "failure" });
      throw err;
    }

    const result = await this.provider();
    this.successCount++;
    this.calls.push({ phase, attempt, outcome: "success" });
    return result;
  }

  get totalCalls(): number { return this.callCount; }
  get totalInjectedFailures(): number { return this.injectedFailures; }
  get totalSuccesses(): number { return this.successCount; }

  /** Reset counters for reuse across phases. */
  reset(): void {
    this.callCount = 0;
    this.injectedFailures = 0;
    this.successCount = 0;
    this.calls.length = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Exhaust a breaker's failureThreshold via the given chaos monkey. */
async function exhaustThreshold(
  breaker: CircuitBreaker,
  chaos: ChaosMonkey<string>,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await breaker.call(() => chaos.execute()).catch(() => {});
  }
}

/** Advance fake system time by ms milliseconds. */
function advanceTime(ms: number): void {
  vi.setSystemTime(Date.now() + ms);
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — ChaosMonkey subsystem isolation
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 1 — ChaosMonkey subsystem isolation", () => {
  it("CM1: injects exactly failCount failures then succeeds", async () => {
    const chaos = new ChaosMonkey(async () => "ok", { failCount: 3, phase: "architect" });

    const outcomes: string[] = [];
    for (let i = 0; i < 5; i++) {
      try {
        outcomes.push(await chaos.execute());
      } catch {
        outcomes.push("err");
      }
    }

    expect(outcomes).toEqual(["err", "err", "err", "ok", "ok"]);
    expect(chaos.totalInjectedFailures).toBe(3);
    expect(chaos.totalSuccesses).toBe(2);
  });

  it("CM2: with failCount=0, never injects failures", async () => {
    const chaos = new ChaosMonkey(async () => "pass", { failCount: 0 });
    const results = await Promise.all([chaos.execute(), chaos.execute()]);
    expect(results).toEqual(["pass", "pass"]);
    expect(chaos.totalInjectedFailures).toBe(0);
  });

  it("CM3: errorFactory controls the injected error type and status", async () => {
    const chaos = new ChaosMonkey(async () => "ok", {
      failCount: 1,
      errorFactory: () =>
        Object.assign(new Error("429 Too Many Requests"), { status: 429 }),
    });
    const err = await chaos.execute().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { status: number }).status).toBe(429);
    expect((err as Error).message).toContain("429");
  });

  it("CM4: calls array records phase and outcome for every attempt", async () => {
    const chaos = new ChaosMonkey(async () => "done", { failCount: 2, phase: "coder" });
    for (let i = 0; i < 3; i++) await chaos.execute().catch(() => {});
    expect(chaos.calls).toEqual([
      { phase: "coder", attempt: 1, outcome: "failure" },
      { phase: "coder", attempt: 2, outcome: "failure" },
      { phase: "coder", attempt: 3, outcome: "success" },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — Sequential phase failure injection trips the circuit
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 2 — Sequential phase failure injection trips the circuit", () => {
  const THRESHOLD = 3;
  let cb: CircuitBreaker;

  beforeEach(() => {
    vi.useFakeTimers();
    cb = new CircuitBreaker({ name: "groq", failureThreshold: THRESHOLD, resetTimeoutMs: 60_000 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("P1: circuit starts CLOSED and stays CLOSED below failure threshold", async () => {
    const chaos = new ChaosMonkey(async () => "ok", { failCount: THRESHOLD - 1, phase: "architect" });
    await exhaustThreshold(cb, chaos, THRESHOLD - 1);
    // One success should keep it closed
    await cb.call(async () => "recovered");
    expect(cb.currentState).toBe("CLOSED");
  });

  it("P2: exactly failureThreshold consecutive failures open the circuit", async () => {
    const chaos = new ChaosMonkey(async () => "ok", { failCount: THRESHOLD, phase: "coder" });
    await exhaustThreshold(cb, chaos, THRESHOLD);
    expect(cb.currentState).toBe("OPEN");
  });

  it("P3: circuit opened after threshold failures rejects subsequent calls as CircuitBreakerOpenError", async () => {
    const chaos = new ChaosMonkey(async () => "ok", { failCount: THRESHOLD, phase: "gate" });
    await exhaustThreshold(cb, chaos, THRESHOLD);
    expect(cb.currentState).toBe("OPEN");

    const result = await cb.call(async () => "should-not-reach").catch((e: unknown) => e);
    expect(result).toBeInstanceOf(CircuitBreakerOpenError);
    // Provider must not have been invoked for the fast-failed call
    expect(chaos.totalCalls).toBe(THRESHOLD);
  });

  it("P4: threshold-minus-one failures do not open circuit", async () => {
    const chaos = new ChaosMonkey(async () => "ok", { failCount: THRESHOLD - 1 });
    await exhaustThreshold(cb, chaos, THRESHOLD - 1);
    expect(cb.currentState).toBe("CLOSED");
    const r = await cb.call(async () => "healed");
    expect(r).toBe("healed");
    expect(cb.currentState).toBe("CLOSED");
  });

  it("P5: threshold+1 injected failures still results in OPEN (no secondary state)", async () => {
    const chaos = new ChaosMonkey(async () => "ok", { failCount: THRESHOLD + 1, phase: "commit" });
    await exhaustThreshold(cb, chaos, THRESHOLD);
    expect(cb.currentState).toBe("OPEN");
    // An extra fast-failed call should not change state
    await cb.call(async () => "ok").catch(() => {});
    expect(cb.currentState).toBe("OPEN");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — Recovery sequence: OPEN → HALF_OPEN → CLOSED
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 3 — Recovery sequence: OPEN → HALF_OPEN → CLOSED", () => {
  const THRESHOLD = 3;
  const RESET_MS  = 1_000;
  let cb: CircuitBreaker;

  beforeEach(() => {
    vi.useFakeTimers();
    cb = new CircuitBreaker({ name: "openrouter", failureThreshold: THRESHOLD, resetTimeoutMs: RESET_MS });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("R1: circuit remains OPEN before resetTimeoutMs elapses", async () => {
    const chaos = new ChaosMonkey(async () => "ok", { failCount: THRESHOLD });
    await exhaustThreshold(cb, chaos, THRESHOLD);
    expect(cb.currentState).toBe("OPEN");

    advanceTime(RESET_MS - 1);

    const result = await cb.call(async () => "probe").catch((e: unknown) => e);
    expect(result).toBeInstanceOf(CircuitBreakerOpenError);
    expect(cb.currentState).toBe("OPEN");
  });

  it("R2: after resetTimeoutMs elapses, next call transitions circuit to HALF_OPEN then executes", async () => {
    const chaos = new ChaosMonkey(async () => "ok", { failCount: THRESHOLD });
    await exhaustThreshold(cb, chaos, THRESHOLD);

    advanceTime(RESET_MS);

    let stateAtProbe: CBState = "CLOSED";
    await cb.call(async () => {
      stateAtProbe = cb.currentState;
      return "probe-success";
    });

    // During the probe call the state is HALF_OPEN; it closes on success
    expect(stateAtProbe).toBe("HALF_OPEN");
    expect(cb.currentState).toBe("CLOSED");
  });

  it("R3: successful probe closes the circuit and normal calls resume", async () => {
    const chaos = new ChaosMonkey(async () => "ok", { failCount: THRESHOLD });
    await exhaustThreshold(cb, chaos, THRESHOLD);
    advanceTime(RESET_MS);

    const probeResult = await cb.call(async () => "probe-ok");
    expect(probeResult).toBe("probe-ok");
    expect(cb.currentState).toBe("CLOSED");

    const next = await cb.call(async () => "normal-call");
    expect(next).toBe("normal-call");
    expect(cb.currentState).toBe("CLOSED");
  });

  it("R4: after closing, a single subsequent failure does not re-open (counter reset)", async () => {
    const chaos = new ChaosMonkey(async () => "ok", { failCount: THRESHOLD });
    await exhaustThreshold(cb, chaos, THRESHOLD);
    advanceTime(RESET_MS);
    await cb.call(async () => "recovered"); // closes circuit

    await cb.call(() => Promise.reject(new Error("single-post-recovery-failure"))).catch(() => {});
    expect(cb.currentState).toBe("CLOSED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4 — Re-open under continued chaos: HALF_OPEN → OPEN
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 4 — Re-open under continued chaos: HALF_OPEN → OPEN", () => {
  const THRESHOLD = 3;
  const RESET_MS  = 500;
  let cb: CircuitBreaker;

  beforeEach(() => {
    vi.useFakeTimers();
    cb = new CircuitBreaker({ name: "gemini", failureThreshold: THRESHOLD, resetTimeoutMs: RESET_MS });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("HO1: probe failure from HALF_OPEN re-opens the circuit immediately", async () => {
    const chaos = new ChaosMonkey(async () => "ok", { failCount: THRESHOLD });
    await exhaustThreshold(cb, chaos, THRESHOLD);
    advanceTime(RESET_MS);

    const probeChaos = new ChaosMonkey(async () => "ok", { failCount: 1 });
    await cb.call(() => probeChaos.execute()).catch(() => {});

    expect(cb.currentState).toBe("OPEN");
  });

  it("HO2: after re-open, circuit requires a second full resetTimeoutMs before next HALF_OPEN", async () => {
    const chaos = new ChaosMonkey(async () => "ok", { failCount: THRESHOLD });
    await exhaustThreshold(cb, chaos, THRESHOLD);

    advanceTime(RESET_MS);

    // Probe fails → re-opens with a fresh reset timestamp
    const probeChaos = new ChaosMonkey(async () => "ok", { failCount: 1 });
    await cb.call(() => probeChaos.execute()).catch(() => {});
    expect(cb.currentState).toBe("OPEN");

    // Advance less than a full second reset window → still OPEN
    advanceTime(RESET_MS - 1);
    const earlyCall = await cb.call(async () => "too-soon").catch((e: unknown) => e);
    expect(earlyCall).toBeInstanceOf(CircuitBreakerOpenError);

    // Advance past the second reset window → HALF_OPEN probe allowed
    advanceTime(2);
    const successProvider = new ChaosMonkey(async () => "now-ok", { failCount: 0 });
    const result = await cb.call(() => successProvider.execute());
    expect(result).toBe("now-ok");
    expect(cb.currentState).toBe("CLOSED");
  });

  it("HO3: repeated OPEN/HALF_OPEN/OPEN cycles leave the circuit OPEN until chaos subsides", async () => {
    // Chaos never runs out of failures during cycles
    const chaos = new ChaosMonkey(async () => "ok", { failCount: 9999 });

    await exhaustThreshold(cb, chaos, THRESHOLD);
    expect(cb.currentState).toBe("OPEN");

    for (let cycle = 0; cycle < 3; cycle++) {
      advanceTime(RESET_MS);
      await cb.call(() => chaos.execute()).catch(() => {});
      expect(cb.currentState).toBe("OPEN");
    }

    // Now chaos subsides — next probe closes the circuit
    advanceTime(RESET_MS);
    const r = await cb.call(async () => "finally-ok");
    expect(r).toBe("finally-ok");
    expect(cb.currentState).toBe("CLOSED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5 — Multi-provider independence
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 5 — Multi-provider chaos: independent circuit breakers", () => {
  const THRESHOLD = 3;
  const RESET_MS  = 1_000;
  let groqBreaker: CircuitBreaker;
  let openrouterBreaker: CircuitBreaker;
  let geminiBreaker: CircuitBreaker;

  beforeEach(() => {
    vi.useFakeTimers();
    groqBreaker       = new CircuitBreaker({ name: "groq",       failureThreshold: THRESHOLD, resetTimeoutMs: RESET_MS });
    openrouterBreaker = new CircuitBreaker({ name: "openrouter", failureThreshold: THRESHOLD, resetTimeoutMs: RESET_MS });
    geminiBreaker     = new CircuitBreaker({ name: "gemini",     failureThreshold: THRESHOLD, resetTimeoutMs: RESET_MS });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("MP1: chaos against groq only opens groq breaker; openrouter and gemini remain CLOSED", async () => {
    const groqChaos = new ChaosMonkey(async () => "ok", { failCount: THRESHOLD, phase: "groq" });
    await exhaustThreshold(groqBreaker, groqChaos, THRESHOLD);

    expect(groqBreaker.currentState).toBe("OPEN");
    expect(openrouterBreaker.currentState).toBe("CLOSED");
    expect(geminiBreaker.currentState).toBe("CLOSED");

    expect(await openrouterBreaker.call(async () => "or-ok")).toBe("or-ok");
    expect(await geminiBreaker.call(async () => "gemini-ok")).toBe("gemini-ok");
  });

  it("MP2: chaos across all providers independently trips each breaker", async () => {
    const groqChaos   = new ChaosMonkey(async () => "ok", { failCount: THRESHOLD });
    const orChaos     = new ChaosMonkey(async () => "ok", { failCount: THRESHOLD });
    const geminiChaos = new ChaosMonkey(async () => "ok", { failCount: THRESHOLD });

    await exhaustThreshold(groqBreaker,       groqChaos,   THRESHOLD);
    await exhaustThreshold(openrouterBreaker, orChaos,     THRESHOLD);
    await exhaustThreshold(geminiBreaker,     geminiChaos, THRESHOLD);

    expect(groqBreaker.currentState).toBe("OPEN");
    expect(openrouterBreaker.currentState).toBe("OPEN");
    expect(geminiBreaker.currentState).toBe("OPEN");
  });

  it("MP3: recovery of one breaker does not affect others", async () => {
    const groqChaos = new ChaosMonkey(async () => "ok", { failCount: THRESHOLD });
    const orChaos   = new ChaosMonkey(async () => "ok", { failCount: THRESHOLD });

    // Open the two breakers at DIFFERENT clock times: groq first, then
    // openrouter halfway through groq's reset window. Advancing to groq's
    // reset boundary then leaves openrouter mid-window — genuinely testing
    // that one breaker's recovery clock does not bleed into another's.
    await exhaustThreshold(groqBreaker, groqChaos, THRESHOLD);
    advanceTime(RESET_MS / 2);
    await exhaustThreshold(openrouterBreaker, orChaos, THRESHOLD);

    expect(groqBreaker.currentState).toBe("OPEN");
    expect(openrouterBreaker.currentState).toBe("OPEN");

    advanceTime(RESET_MS / 2);
    await groqBreaker.call(async () => "groq-recovered");
    expect(groqBreaker.currentState).toBe("CLOSED");

    // openrouter still OPEN — must still fast-fail
    const blocked = await openrouterBreaker.call(async () => "should-not-run").catch((e: unknown) => e);
    expect(blocked).toBeInstanceOf(CircuitBreakerOpenError);
    expect(openrouterBreaker.currentState).toBe("OPEN");
  });

  it("MP4: provider fallback pattern — when primary trips, secondary handles traffic", async () => {
    const groqChaos = new ChaosMonkey(async () => "groq-result", { failCount: THRESHOLD });
    const openrouterProvider = vi.fn(async () => "openrouter-result");

    // Trip groq
    for (let i = 0; i < THRESHOLD; i++) {
      await groqBreaker.call(() => groqChaos.execute()).catch(() => {});
    }
    expect(groqBreaker.currentState).toBe("OPEN");

    // Simulate pipeline falling back to openrouter for 3 calls
    const results: string[] = [];
    for (let i = 0; i < 3; i++) {
      let result: string;
      try {
        result = await groqBreaker.call(() => groqChaos.execute());
      } catch {
        result = await openrouterBreaker.call(openrouterProvider);
      }
      results.push(result);
    }

    expect(results).toEqual(["openrouter-result", "openrouter-result", "openrouter-result"]);
    expect(openrouterProvider).toHaveBeenCalledTimes(3);
    expect(openrouterBreaker.currentState).toBe("CLOSED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 6 — Interleaved success/failure: consecutive counter resets on success
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 6 — Interleaved success/failure: failure count resets on success", () => {
  const THRESHOLD = 4;
  let cb: CircuitBreaker;

  beforeEach(() => {
    vi.useFakeTimers();
    cb = new CircuitBreaker({ name: "mistral", failureThreshold: THRESHOLD, resetTimeoutMs: 1_000 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("IF1: a single success between failure bursts resets the consecutive-failure counter", async () => {
    const alwaysFail    = () => Promise.reject(new Error("fail"));
    const alwaysSucceed = () => Promise.resolve("ok");

    // THRESHOLD-1 failures
    for (let i = 0; i < THRESHOLD - 1; i++) {
      await cb.call(alwaysFail).catch(() => {});
    }
    expect(cb.currentState).toBe("CLOSED");

    // One success resets the counter
    await cb.call(alwaysSucceed);

    // THRESHOLD-1 more failures — counter starts fresh, circuit remains CLOSED
    for (let i = 0; i < THRESHOLD - 1; i++) {
      await cb.call(alwaysFail).catch(() => {});
    }
    expect(cb.currentState).toBe("CLOSED");
  });

  it("IF2: alternating success/failure pattern (20 iterations) never opens the circuit", async () => {
    const alwaysFail    = () => Promise.reject(new Error("fail"));
    const alwaysSucceed = () => Promise.resolve("ok");

    for (let i = 0; i < 20; i++) {
      if (i % 2 === 0) {
        await cb.call(alwaysFail).catch(() => {});
      } else {
        await cb.call(alwaysSucceed);
      }
    }
    expect(cb.currentState).toBe("CLOSED");
  });

  it("IF3: two near-threshold bursts separated by one success do not open the circuit", async () => {
    // Burst 1: THRESHOLD-1 failures
    for (let i = 0; i < THRESHOLD - 1; i++) {
      await cb.call(() => Promise.reject(new Error("burst1"))).catch(() => {});
    }
    // Success resets
    await cb.call(() => Promise.resolve("between-bursts"));

    // Burst 2: THRESHOLD-1 failures
    for (let i = 0; i < THRESHOLD - 1; i++) {
      await cb.call(() => Promise.reject(new Error("burst2"))).catch(() => {});
    }
    expect(cb.currentState).toBe("CLOSED");

    // Now THRESHOLD consecutive failures should open it
    for (let i = 0; i < THRESHOLD; i++) {
      await cb.call(() => Promise.reject(new Error("final-burst"))).catch(() => {});
    }
    expect(cb.currentState).toBe("OPEN");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 7 — Concurrent phase chaos: parallel failures
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 7 — Concurrent phase chaos: parallel phase failures", () => {
  const THRESHOLD = 3;
  let cb: CircuitBreaker;

  beforeEach(() => {
    vi.useFakeTimers();
    cb = new CircuitBreaker({ name: "cerebras", failureThreshold: THRESHOLD, resetTimeoutMs: 1_000 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("CC1: concurrent failures from Promise.all trip the breaker and leave it OPEN", async () => {
    const errors: unknown[] = [];
    await Promise.all(
      Array.from({ length: THRESHOLD }, (_, i) =>
        cb
          .call(() => Promise.reject(Object.assign(new Error(`concurrent-fail-${i}`), { status: 503 })))
          .catch((e: unknown) => errors.push(e)),
      ),
    );

    expect(errors).toHaveLength(THRESHOLD);
    expect(cb.currentState).toBe("OPEN");
  });

  it("CC2: after concurrent failures open the circuit, subsequent single call is fast-failed", async () => {
    await Promise.all(
      Array.from({ length: THRESHOLD }, () =>
        cb.call(() => Promise.reject(new Error("concurrent-fail"))).catch(() => {}),
      ),
    );
    expect(cb.currentState).toBe("OPEN");

    const fastFailed = await cb.call(async () => "should-not-reach").catch((e: unknown) => e);
    expect(fastFailed).toBeInstanceOf(CircuitBreakerOpenError);
  });

  it("CC3: concurrent successes keep the circuit CLOSED throughout", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => cb.call(async () => `result-${i}`)),
    );
    expect(results).toHaveLength(10);
    expect(cb.currentState).toBe("CLOSED");
  });

  it("CC4: concurrent failures beyond threshold do not corrupt state (still OPEN, not undefined)", async () => {
    await Promise.all(
      Array.from({ length: THRESHOLD * 3 }, () =>
        cb.call(() => Promise.reject(new Error("mass-fail"))).catch(() => {}),
      ),
    );
    // State must be a valid CBState value
    expect(["OPEN", "CLOSED", "HALF_OPEN"]).toContain(cb.currentState);
    // And since we definitely exceeded threshold, it must be OPEN
    expect(cb.currentState).toBe("OPEN");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 8 — No phantom provider calls while OPEN
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 8 — No phantom provider calls while OPEN", () => {
  const THRESHOLD = 3;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("PH1: provider function is never invoked while circuit is OPEN", async () => {
    const cb = new CircuitBreaker({ name: "phantom-test", failureThreshold: THRESHOLD, resetTimeoutMs: 1_000 });
    const provider = vi.fn(async () => "real-result");

    // Trip the circuit
    for (let i = 0; i < THRESHOLD; i++) {
      await cb.call(() => Promise.reject(new Error("trip"))).catch(() => {});
    }
    expect(cb.currentState).toBe("OPEN");

    // 5 calls while OPEN — none should reach the provider
    for (let i = 0; i < 5; i++) {
      await cb.call(provider).catch(() => {});
    }

    expect(provider).not.toHaveBeenCalled();
  });

  it("PH2: exactly one provider call is made for the HALF_OPEN probe on success", async () => {
    const cb = new CircuitBreaker({ name: "probe-count", failureThreshold: THRESHOLD, resetTimeoutMs: 500 });
    const probeProvider = vi.fn(async () => "probe-ok");

    for (let i = 0; i < THRESHOLD; i++) {
      await cb.call(() => Promise.reject(new Error("trip"))).catch(() => {});
    }
    advanceTime(500);

    await cb.call(probeProvider);

    expect(probeProvider).toHaveBeenCalledTimes(1);
    expect(cb.currentState).toBe("CLOSED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 9 — Full lifecycle: multi-phase pipeline run with chaos
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 9 — Full lifecycle: multi-phase pipeline run with chaos", () => {
  const THRESHOLD = 3;
  const RESET_MS  = 1_000;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Simulates a 7-phase pipeline (architect→coder→gate→astdoc→canary→review→done)
   * where an AI provider (groq) is called once per phase.
   *
   * Chaos schedule:
   * - phases 0–2 (architect, coder, gate): groq fails → circuit trips after gate
   * - phases 3–4 (astdoc, canary):         groq circuit OPEN → breaker fast-fails → openrouter bypass
   * - before phase 5 (review):             reset timeout elapses; chaos already exhausted
   * - phase 5 (review):                    groq transitions OPEN→HALF_OPEN on first call; probe succeeds → CLOSED
   * - phase 6 (done):                      groq CLOSED, serving primary traffic again
   *
   * Correct routing: always attempt groq via groqBreaker.call() — the circuit breaker
   * itself fast-fails when OPEN (CircuitBreakerOpenError) or HALF_OPEN→probe. We
   * distinguish CircuitBreakerOpenError (circuit fast-fail) from chaos errors (underlying
   * provider failure) so provider labels correctly reflect each phase's outcome.
   */
  it("FL1: complete CLOSED→OPEN→HALF_OPEN→CLOSED lifecycle across pipeline phases", async () => {
    const groqBreaker       = new CircuitBreaker({ name: "groq",        failureThreshold: THRESHOLD, resetTimeoutMs: RESET_MS });
    const openrouterBreaker = new CircuitBreaker({ name: "openrouter",  failureThreshold: THRESHOLD, resetTimeoutMs: RESET_MS });

    // Groq chaos: exactly THRESHOLD failures (phases 0–2), then recovers
    const groqChaos = new ChaosMonkey(async () => "primary-result", { failCount: THRESHOLD, phase: "groq" });
    const openrouterProvider = vi.fn(async () => "secondary-result");

    const phases = ["architect", "coder", "gate", "astdoc", "canary", "review", "done"];
    const phaseResults: Array<{ phase: string; provider: string; state: CBState }> = [];

    for (let idx = 0; idx < phases.length; idx++) {
      const phase = phases[idx]!;

      // Before review (idx === 5), advance clock past the reset window so groq
      // can transition from OPEN → HALF_OPEN on its next call.
      if (idx === 5) {
        advanceTime(RESET_MS);
      }

      let result: string;
      let provider: string;

      // Always route through groqBreaker — the circuit breaker itself manages
      // fast-failing (CircuitBreakerOpenError) and probe-on-HALF_OPEN. We only
      // fall back to openrouter when groqBreaker.call() throws for any reason.
      try {
        result = await groqBreaker.call(() => groqChaos.execute());
        provider = "primary";
      } catch (err: unknown) {
        if (err instanceof CircuitBreakerOpenError) {
          // groq circuit is OPEN — bypass directly to openrouter
          result = await openrouterBreaker.call(openrouterProvider);
          provider = "secondary-bypass";
        } else {
          // groq provider error (chaos injection or real failure) — fallback
          result = await openrouterBreaker.call(openrouterProvider);
          provider = "secondary-fallback";
        }
      }

      phaseResults.push({ phase, provider, state: groqBreaker.currentState as CBState });
    }

    // phases 0–2: groq chaos injects errors → falls back to openrouter (provider error, not open-circuit)
    expect(phaseResults[0]!.provider).toBe("secondary-fallback"); // architect: chaos failure
    expect(phaseResults[1]!.provider).toBe("secondary-fallback"); // coder: chaos failure
    expect(phaseResults[2]!.provider).toBe("secondary-fallback"); // gate: chaos failure trips breaker

    // After gate (3rd consecutive failure), groq must be OPEN
    expect(phaseResults[2]!.state).toBe("OPEN");

    // phases 3–4: groq circuit OPEN → CircuitBreakerOpenError → bypass to openrouter
    expect(phaseResults[3]!.provider).toBe("secondary-bypass"); // astdoc: fast-failed
    expect(phaseResults[4]!.provider).toBe("secondary-bypass"); // canary: fast-failed

    // phase 5 (review): clock advanced past RESET_MS → groq transitions to HALF_OPEN
    // on the first call; chaos exhausted → probe returns "primary-result" → circuit CLOSES
    expect(phaseResults[5]!.provider).toBe("primary");
    expect(phaseResults[5]!.state).toBe("CLOSED");

    // phase 6 (done): groq fully recovered
    expect(phaseResults[6]!.provider).toBe("primary");
    expect(phaseResults[6]!.state).toBe("CLOSED");

    // openrouter call count: phases 0,1,2 (fallback) + phases 3,4 (bypass) = 5
    expect(openrouterProvider).toHaveBeenCalledTimes(5);

    // Groq chaos injected exactly THRESHOLD failures (phases 0, 1, 2)
    expect(groqChaos.totalInjectedFailures).toBe(THRESHOLD);
  });

  it("FL2: reset() clears all state and makes the circuit immediately operational", async () => {
    const cb = new CircuitBreaker({ name: "reset-test", failureThreshold: THRESHOLD, resetTimeoutMs: RESET_MS });

    for (let i = 0; i < THRESHOLD; i++) {
      await cb.call(() => Promise.reject(new Error("trip"))).catch(() => {});
    }
    expect(cb.currentState).toBe("OPEN");

    cb.reset();
    expect(cb.currentState).toBe("CLOSED");

    const r = await cb.call(async () => "post-reset");
    expect(r).toBe("post-reset");
    expect(cb.currentState).toBe("CLOSED");
  });
});
