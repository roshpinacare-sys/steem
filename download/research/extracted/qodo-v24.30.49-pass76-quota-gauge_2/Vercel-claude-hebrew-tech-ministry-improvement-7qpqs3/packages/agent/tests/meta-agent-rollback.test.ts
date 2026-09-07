/**
 * meta-agent-rollback.test.ts — Task-17 (Pass 54)
 *
 * META-AGENT MUTATION ROLLBACK ADVERSARIAL TEST
 *
 * ─── Background ────────────────────────────────────────────────────────────
 * meta-agent.ts exposes three write-path functions:
 *   - mutatePrompt()         — reads active → writes history → calls AI → writes active
 *   - rollbackLastMutation() — reads history → pops head → restores active (or deletes it)
 *   - promoteMutation()      — extends the TTL of an active mutation (human approval path)
 *
 * Both functions operate against a two-key Redis namespace:
 *   activeKey  = prompt_mutations:<owner>:<repo>:<agent>:active
 *   historyKey = prompt_mutations:<owner>:<repo>:<agent>:history
 *
 * ─── What this pass proves ─────────────────────────────────────────────────
 * 1. mutatePrompt stores the previous active prompt in history before writing
 *    the new active value — the history entry is the sole mechanism for rollback.
 * 2. rollbackLastMutation restores the active key to a byte-identical copy of
 *    the value that was active before the corresponding mutation.
 * 3. A chain of N mutations can be fully unwound by N sequential rollbacks,
 *    with each step restoring the exact prior value.
 * 4. A crash (simulated by aiRoute throwing) after historyKey is written but
 *    before activeKey is written leaves the system in a recoverable, consistent
 *    state — not a "half-applied" mutation. The active key is never partially
 *    overwritten; it holds either the pre-crash or the fully-committed value.
 * 5. Multiple crash/success interactions leave a phantom history stack that
 *    rollback chains clean up idempotently.
 * 6. Prompt content — including Unicode, multi-line whitespace, and very long
 *    strings — is preserved byte-identically through the mutation/rollback cycle.
 * 7. Namespace isolation: mutations to one agent/repo do not bleed into another.
 *
 * ─── Design boundaries confirmed (valid, not fixed) ───────────────────────
 * DB1. History is capped at 20 entries; mutations beyond that silently drop
 *      the oldest entry, making rollback impossible past that depth.
 *      (Intentional design choice — documented, not a bug.)
 * DB2. rollbackLastMutation is not atomic across the two Redis keys: it reads
 *      historyKey, then writes activeKey, then writes historyKey. A crash
 *      between those writes could leave partial state. This is acceptable for
 *      the current single-process model; a future distributed pass might want
 *      a Lua compare-and-swap.
 * DB3. mutatePrompt writes historyKey BEFORE the AI call and BEFORE activeKey.
 *      An AI failure leaves a phantom history entry; calling rollback cleans it
 *      up safely (idempotent for the active key's effective value).
 *
 * ─── Scope / caveats ───────────────────────────────────────────────────────
 * - All tests are in-process: no network, no Redis, no file system.
 * - aiRoute is stubbed via vi.mock; log is silenced.
 * - The mock RedisState uses a Map<string, unknown> — the same pattern as
 *   trust-ledger-gaming.test.ts and swarm-contention.test.ts.
 * - No production source files are modified.
 *
 * ─── Files touched ─────────────────────────────────────────────────────────
 * - packages/agent/tests/meta-agent-rollback.test.ts  (this file, new)
 * - packages/agent/docs/54-V24-AUDIT-PASS-54.md       (new)
 * - tasks/agent-task-queue.json                        (task-17 → done)
 * - tasks/agent-task-queue.md                          (status snapshot)
 * - 06-CHANGELOG.md, CHANGELOG.md, ENGINEERING_NOTES.md
 * - package.json (×3)                                  (version 24.30.25 → 24.30.26)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mutatePrompt,
  rollbackLastMutation,
  getActiveMutation,
  promoteMutation,
} from "../src/agents/meta-agent.js";

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks (hoisted by vitest to the top of the file)
// ─────────────────────────────────────────────────────────────────────────────

// Stub aiRoute — each test configures return value via mockResolvedValueOnce
vi.mock("../src/services/ai-router.js", () => ({
  aiRoute: vi.fn(),
}));

// Suppress logger output — prevents noise in test output
vi.mock("../src/services/logger.js", () => ({
  log: {
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import the mocked aiRoute for per-test configuration
import { aiRoute } from "../src/services/ai-router.js";
const mockAiRoute = vi.mocked(aiRoute);

// ─────────────────────────────────────────────────────────────────────────────
// In-process RedisState mock — faithful Map-based implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal RedisState stand-in that implements only the three methods used by
 * meta-agent.ts: getJSON, setJSONWithTTL, and delete.
 *
 * Deep-clones values via JSON round-trip to prevent aliasing — the same
 * strategy that production code uses when writing to a serialised store.
 */
function makeRedisState() {
  const store = new Map<string, string>(); // raw JSON strings, matching Redis wire format
  return {
    async getJSON<T>(key: string): Promise<T | null> {
      const raw = store.get(key);
      if (raw === undefined) return null;
      // Deep-clone via JSON re-parse on every read — matches production semantics:
      // real Redis returns a fresh deserialized object; callers must not assume
      // identity equality across two getJSON calls for the same key.
      return JSON.parse(raw) as T;
    },
    async setJSONWithTTL(key: string, value: unknown, _ttl: number): Promise<void> {
      store.set(key, JSON.stringify(value));
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
    // Test-only accessor — does not exist on production RedisState
    _store: store,
  };
}

type MockState = ReturnType<typeof makeRedisState>;

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

const OWNER = "test-org";
const REPO  = "test-repo";
const AGENT = "architect" as const;

/** Canonical Redis key helpers — mirror meta-agent.ts internal key format */
function activeKey(agent = AGENT, owner = OWNER, repo = REPO): string {
  return `prompt_mutations:${owner}:${repo}:${agent}:active`;
}
function historyKey(agent = AGENT, owner = OWNER, repo = REPO): string {
  return `prompt_mutations:${owner}:${repo}:${agent}:history`;
}

/** Minimal AIContractFailure fixture */
function makeFailure(
  prompt = "old-prompt",
  raw    = '{"bad":"json"}',
  error  = "Zod validation failed: missing steps",
) {
  return { prompt, raw, error };
}

/**
 * Run a single mutation cycle: configure the mock AI to return `output`,
 * then call mutatePrompt and return the settled active value.
 */
async function runMutation(state: MockState, output: string): Promise<string> {
  mockAiRoute.mockResolvedValueOnce(output);
  return mutatePrompt(AGENT, makeFailure(), state as never, undefined, OWNER, REPO);
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — RedisState mock subsystem isolation
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 1 — RedisState mock isolation", () => {
  it("M0: getJSON returns null for a key that was never written", async () => {
    const state = makeRedisState();
    const result = await state.getJSON<string>("key-never-set");
    expect(result).toBeNull();
  });

  it("M1: setJSONWithTTL + getJSON round-trips a string with embedded newlines", async () => {
    const state = makeRedisState();
    const value = "line1\n\nline2\ttabbed\nline3";
    await state.setJSONWithTTL("k", value, 60);
    expect(await state.getJSON<string>("k")).toBe(value);
  });

  it("M2: deep-clone on both write and read — external mutation cannot corrupt stored value", async () => {
    const state = makeRedisState();
    const arr = [{ score: 1 }];
    await state.setJSONWithTTL("k", arr, 60);
    arr[0]!.score = 999;                          // mutate original after write
    const retrieved = await state.getJSON<typeof arr>("k");
    expect(retrieved![0]!.score).toBe(1);         // write clone must be unaffected

    // Also verify read returns a fresh object each time (no identity aliasing)
    const r1 = await state.getJSON<typeof arr>("k");
    const r2 = await state.getJSON<typeof arr>("k");
    expect(r1).not.toBe(r2);                      // different object references
    expect(r1![0]!.score).toBe(r2![0]!.score);   // but same value
  });

  it("M3: delete removes the key; subsequent getJSON returns null", async () => {
    const state = makeRedisState();
    await state.setJSONWithTTL("k", "hello", 60);
    await state.delete("k");
    expect(await state.getJSON("k")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — Single mutation + rollback correctness
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 2 — Single mutation + rollback correctness", () => {
  let state: MockState;

  beforeEach(() => {
    state = makeRedisState();
    mockAiRoute.mockReset();
  });

  it("R1: mutatePrompt sets the active key to the trimmed AI output", async () => {
    await runMutation(state, "  MUTATED_PROMPT_V1  ");
    const active = await state.getJSON<string>(activeKey());
    expect(active).toBe("MUTATED_PROMPT_V1");
  });

  it("R2: history records null as previous when no prior mutation existed", async () => {
    await runMutation(state, "MUTATED_V1");
    const history = await state.getJSON<Array<{ previous: unknown }>>(historyKey());
    expect(history).toHaveLength(1);
    expect(history![0]!.previous).toBeNull();
  });

  it("R3: rollback after first mutation (previous=null) deletes the active key", async () => {
    await runMutation(state, "MUTATED_V1");
    expect(await state.getJSON<string>(activeKey())).toBe("MUTATED_V1");

    await rollbackLastMutation(AGENT, state as never, undefined, OWNER, REPO);

    // previous was null → rollback deletes active rather than writing null
    expect(await state.getJSON<string>(activeKey())).toBeNull();
    // history should be empty after rollback
    const history = await state.getJSON<unknown[]>(historyKey());
    expect(history).toHaveLength(0);
  });

  it("R4: rollback with a real previous prompt restores it byte-identically", async () => {
    const ORIGINAL = "You are the ARCHITECT.\n\nOutput JSON: {steps:[{id,description,files:[]}]}";
    // Seed a pre-existing active value
    await state.setJSONWithTTL(activeKey(), ORIGINAL, 60);

    // Overwrite with a mutation
    await runMutation(state, "OVERRIDE_V2");
    expect(await state.getJSON<string>(activeKey())).toBe("OVERRIDE_V2");

    // Rollback → must restore ORIGINAL byte-for-byte
    await rollbackLastMutation(AGENT, state as never, undefined, OWNER, REPO);
    const restored = await state.getJSON<string>(activeKey());

    expect(restored).toBe(ORIGINAL);
    // Verify character-by-character (guards against any codec/encoding corruption)
    for (let i = 0; i < ORIGINAL.length; i++) {
      expect(restored!.charCodeAt(i)).toBe(ORIGINAL.charCodeAt(i));
    }
  });

  it("R5: rollbackLastMutation is a no-op when history is empty (no mutation to undo)", async () => {
    // No mutations at all — rollback must not throw or corrupt state
    await expect(
      rollbackLastMutation(AGENT, state as never, undefined, OWNER, REPO)
    ).resolves.toBeUndefined();
    expect(await state.getJSON<string>(activeKey())).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — Chained N mutations + sequential rollback chain
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 3 — Chained 7 mutations + sequential rollback", () => {
  let state: MockState;

  beforeEach(() => {
    state = makeRedisState();
    mockAiRoute.mockReset();
  });

  it("C1: 7-mutation chain leaves the last mutation as the active value", async () => {
    for (let i = 1; i <= 7; i++) {
      await runMutation(state, `MUTATION_V${i}`);
    }
    expect(await state.getJSON<string>(activeKey())).toBe("MUTATION_V7");
  });

  it("C2: history length matches mutation count (one entry per mutation)", async () => {
    for (let i = 0; i < 7; i++) {
      await runMutation(state, `PROMPT_${i}`);
    }
    const history = await state.getJSON<unknown[]>(historyKey());
    expect(history!.length).toBe(7);
  });

  it("C3: sequential rollback restores each prior step byte-identically", async () => {
    const BASE = "INITIAL_PROMPT";
    await state.setJSONWithTTL(activeKey(), BASE, 60);

    // Apply 7 mutations: M1 through M7
    for (let i = 1; i <= 7; i++) {
      await runMutation(state, `M${i}`);
    }

    // Roll back one step at a time
    const restoredSteps: (string | null)[] = [];
    for (let i = 0; i < 7; i++) {
      await rollbackLastMutation(AGENT, state as never, undefined, OWNER, REPO);
      restoredSteps.push(await state.getJSON<string>(activeKey()));
    }

    // After rollback k, we should see M(7-k-1) or BASE for the last rollback
    expect(restoredSteps[0]).toBe("M6");   // after 1st rollback: M6
    expect(restoredSteps[1]).toBe("M5");   // after 2nd rollback: M5
    expect(restoredSteps[2]).toBe("M4");
    expect(restoredSteps[3]).toBe("M3");
    expect(restoredSteps[4]).toBe("M2");
    expect(restoredSteps[5]).toBe("M1");
    expect(restoredSteps[6]).toBe(BASE);   // after 7th rollback: BASE (the original)
  });

  it("C4: after full rollback chain, active == original and history is empty", async () => {
    const ORIGINAL = "ORIGINAL_SYSTEM_PROMPT";
    await state.setJSONWithTTL(activeKey(), ORIGINAL, 60);

    for (let i = 0; i < 5; i++) {
      await runMutation(state, `V${i + 1}`);
    }

    for (let i = 0; i < 5; i++) {
      await rollbackLastMutation(AGENT, state as never, undefined, OWNER, REPO);
    }

    expect(await state.getJSON<string>(activeKey())).toBe(ORIGINAL);
    const history = await state.getJSON<unknown[]>(historyKey());
    expect(history!.length).toBe(0);
  });

  it("C5: history is capped at 20 entries; oldest are silently dropped (DB1)", async () => {
    // Apply 25 mutations — history must not exceed 20 (per the slice(0, 20) in meta-agent.ts)
    for (let i = 1; i <= 25; i++) {
      await runMutation(state, `M${i}`);
    }
    const history = await state.getJSON<unknown[]>(historyKey());
    expect(history!.length).toBeLessThanOrEqual(20);
    // Active must be the last mutation regardless
    expect(await state.getJSON<string>(activeKey())).toBe("M25");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4 — Crash simulation: partial-commit scenarios
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 4 — Crash simulation: partial-commit adversarial scenarios", () => {
  let state: MockState;

  beforeEach(() => {
    state = makeRedisState();
    mockAiRoute.mockReset();
  });

  /**
   * CRASH-1: aiRoute throws after historyKey is written but before activeKey
   * is written. This is the only plausible "crash between writes" scenario given
   * that meta-agent.ts serialises the two writes as:
   *   (A) historyKey write
   *   (B) aiRoute() call  ← can throw
   *   (C) activeKey write
   *
   * Invariant: active must not change (no partial mutation applied).
   */
  it("CRASH-1: aiRoute failure leaves active key unchanged — no partial mutation", async () => {
    const BEFORE = "BEFORE_MUTATION";
    await state.setJSONWithTTL(activeKey(), BEFORE, 60);

    mockAiRoute.mockRejectedValueOnce(new Error("LLM timeout — simulated crash"));

    await expect(
      mutatePrompt(AGENT, makeFailure(), state as never, undefined, OWNER, REPO)
    ).rejects.toThrow("LLM timeout");

    // Active must be unchanged — no half-applied mutation
    expect(await state.getJSON<string>(activeKey())).toBe(BEFORE);
  });

  /**
   * CRASH-2: After an aiRoute failure the historyKey holds a phantom head entry
   * (previous = BEFORE, but active is still BEFORE). Calling rollback must:
   *   - clean up the phantom entry
   *   - leave active at BEFORE (idempotent — same value, correct result)
   *   - leave history empty
   */
  it("CRASH-2: rollback after aiRoute failure cleans phantom history entry idempotently", async () => {
    const BEFORE = "BEFORE_MUTATION";
    await state.setJSONWithTTL(activeKey(), BEFORE, 60);

    mockAiRoute.mockRejectedValueOnce(new Error("crash"));
    await mutatePrompt(AGENT, makeFailure(), state as never, undefined, OWNER, REPO).catch(() => {});

    // Phantom entry should be in history
    const historyBefore = await state.getJSON<Array<{ previous: string | null }>>(historyKey());
    expect(historyBefore).toHaveLength(1);
    expect(historyBefore![0]!.previous).toBe(BEFORE);

    // Rollback the phantom — must not error
    await rollbackLastMutation(AGENT, state as never, undefined, OWNER, REPO);

    // Active must still be BEFORE (idempotent: same value restored to same value)
    expect(await state.getJSON<string>(activeKey())).toBe(BEFORE);
    // Phantom entry cleaned
    const historyAfter = await state.getJSON<unknown[]>(historyKey());
    expect(historyAfter).toHaveLength(0);
  });

  /**
   * CRASH-3: Simulate 3 crashes then 1 committed success.
   * 3 crashes leave 3 phantom history entries; the success adds 1 real one.
   * 4 rollbacks must restore state to the pre-all-mutations original.
   */
  it("CRASH-3: 3 crashes + 1 success → 4 rollbacks restore original state", async () => {
    const ORIGINAL = "ORIGINAL";
    await state.setJSONWithTTL(activeKey(), ORIGINAL, 60);

    // 3 crashes (phantom history entries, active unchanged)
    for (let i = 0; i < 3; i++) {
      mockAiRoute.mockRejectedValueOnce(new Error("crash"));
      await mutatePrompt(AGENT, makeFailure(), state as never, undefined, OWNER, REPO).catch(() => {});
    }

    // 1 committed success
    await runMutation(state, "COMMITTED_MUTATION");
    expect(await state.getJSON<string>(activeKey())).toBe("COMMITTED_MUTATION");

    // History: 4 entries (3 phantom + 1 real)
    const history = await state.getJSON<unknown[]>(historyKey());
    expect(history!.length).toBe(4);

    // 4 rollbacks to unwind everything
    for (let i = 0; i < 4; i++) {
      await rollbackLastMutation(AGENT, state as never, undefined, OWNER, REPO);
    }

    expect(await state.getJSON<string>(activeKey())).toBe(ORIGINAL);
    const historyAfter = await state.getJSON<unknown[]>(historyKey());
    expect(historyAfter!.length).toBe(0);
  });

  /**
   * CRASH-4: Across 20 interleaved crash/success operations the active key
   * must always equal either the pre-operation value (crash) or the newly
   * committed output (success). It must never be in an intermediate state.
   *
   * This is the core partial-commit safety invariant.
   */
  it("CRASH-4: across 20 interleaved crash/success ops, active is always pre-crash or post-success", async () => {
    let lastSuccessfulMutation: string | null = null;

    for (let i = 0; i < 20; i++) {
      const shouldCrash = i % 3 === 0;
      const activeBefore = await state.getJSON<string>(activeKey());

      if (shouldCrash) {
        mockAiRoute.mockRejectedValueOnce(new Error("crash"));
        await mutatePrompt(AGENT, makeFailure(), state as never, undefined, OWNER, REPO).catch(() => {});

        // After crash: active must be unchanged
        expect(await state.getJSON<string>(activeKey())).toBe(activeBefore);
      } else {
        const output = `MUTATION_${i}`;
        await runMutation(state, output);
        lastSuccessfulMutation = output;

        // After success: active must be the new output
        expect(await state.getJSON<string>(activeKey())).toBe(output);
      }
    }

    // Final consistency: active must be the last committed mutation
    expect(await state.getJSON<string>(activeKey())).toBe(lastSuccessfulMutation);
  });

  /**
   * CRASH-5: Whenever the active key holds a new value V, the head of the
   * history stack must record a previous value that differs from V — proving
   * the rollback mechanism has what it needs to undo the mutation.
   *
   * (If active=V and history[0].previous=V, rollback would be a no-op rather
   * than actually restoring anything meaningful.)
   */
  it("CRASH-5: whenever active has a new value, history head records a different previous", async () => {
    for (let i = 0; i < 10; i++) {
      const isSuccess = i % 2 === 0;
      if (isSuccess) {
        await runMutation(state, `PROMPT_${i}`);
        const active  = await state.getJSON<string>(activeKey());
        const history = await state.getJSON<Array<{ previous: string | null }>>(historyKey());

        if (active !== null && history && history.length > 0) {
          // The head of history must not equal the current active value
          // (history[0].previous records what came BEFORE active, not active itself)
          expect(history[0]!.previous).not.toBe(active);
        }
      } else {
        mockAiRoute.mockRejectedValueOnce(new Error("crash"));
        await mutatePrompt(AGENT, makeFailure(), state as never, undefined, OWNER, REPO).catch(() => {});
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5 — String content fidelity through the mutation/rollback cycle
// ─────────────────────────────────────────────────────────────────────────────
//
// These tests assert that the JS string value (code-unit equality) of a prompt
// is preserved exactly after mutatePrompt overwrites it and rollbackLastMutation
// restores it.  The storage path is:
//
//   original JS string
//     → JSON.stringify (setJSONWithTTL)
//     → stored as raw JSON string in the Map
//     → JSON.parse (getJSON on each read)
//     → restored JS string
//
// "Preserved" here means toBe() equivalence plus same .length — i.e. the same
// sequence of UTF-16 code units, which is the semantically meaningful identity
// guarantee for a text prompt.  True raw-byte identity (across different
// encoding representations) is out-of-scope for a JS/JSON serialisation path.

describe("Suite 5 — String content fidelity through the mutation/rollback cycle", () => {
  let state: MockState;

  beforeEach(() => {
    state = makeRedisState();
    mockAiRoute.mockReset();
  });

  it("BI1: prompt with Unicode content is restored with exact code-unit equality after rollback", async () => {
    const UNICODE = "You are an agent.\n日本語テキスト\nEmoji: 🚀💡🎯\n\u0000\u001F End.";
    await state.setJSONWithTTL(activeKey(), UNICODE, 60);

    await runMutation(state, "OVERRIDE");
    await rollbackLastMutation(AGENT, state as never, undefined, OWNER, REPO);

    const restored = await state.getJSON<string>(activeKey());
    expect(restored).toBe(UNICODE);
    // Verify Unicode code-point count is intact (spread iterates code points, not code units)
    expect([...restored!].length).toBe([...UNICODE].length);
  });

  it("BI2: whitespace-heavy prompt is restored exactly (tabs, double-newlines, trailing space)", async () => {
    const WHITESPACE = "Line1\n\n\tLine2   \n  Line3\t\nEnd  ";
    await state.setJSONWithTTL(activeKey(), WHITESPACE, 60);

    await runMutation(state, "OVERRIDE");
    await rollbackLastMutation(AGENT, state as never, undefined, OWNER, REPO);

    expect(await state.getJSON<string>(activeKey())).toBe(WHITESPACE);
  });

  it("BI3: very long prompt (>10 KB) is restored with exact code-unit equality after 5 mutation/rollback cycles", async () => {
    // Deterministic ~12 KB prompt string
    const LONG = Array.from({ length: 500 }, (_, i) =>
      `Instruction line ${String(i).padStart(3, "0")}: handle the task carefully and precisely.`,
    ).join("\n");

    await state.setJSONWithTTL(activeKey(), LONG, 60);

    for (let i = 0; i < 5; i++) {
      await runMutation(state, `SHORT_V${i}`);
    }
    for (let i = 0; i < 5; i++) {
      await rollbackLastMutation(AGENT, state as never, undefined, OWNER, REPO);
    }

    const restored = await state.getJSON<string>(activeKey());
    expect(restored).toBe(LONG);
    expect(restored!.length).toBe(LONG.length); // same UTF-16 code-unit count
  });

  it("BI4: mutatePrompt trims AI output before storing; stored value matches returned value; rollback restores original", async () => {
    const ORIGINAL = "ORIGINAL";
    await state.setJSONWithTTL(activeKey(), ORIGINAL, 60);

    mockAiRoute.mockResolvedValueOnce("  STRIPPED_RESULT  ");
    const returned = await mutatePrompt(AGENT, makeFailure(), state as never, undefined, OWNER, REPO);

    const stored = await state.getJSON<string>(activeKey());
    // Stored value must match the value returned by mutatePrompt (both trimmed)
    expect(stored).toBe(returned);
    expect(stored).toBe("STRIPPED_RESULT");

    // Rollback must restore ORIGINAL — not the post-trim intermediate value
    await rollbackLastMutation(AGENT, state as never, undefined, OWNER, REPO);
    expect(await state.getJSON<string>(activeKey())).toBe(ORIGINAL);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 6 — getActiveMutation and promoteMutation lifecycle
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 6 — getActiveMutation and promoteMutation lifecycle", () => {
  let state: MockState;

  beforeEach(() => {
    state = makeRedisState();
    mockAiRoute.mockReset();
  });

  it("GA1: getActiveMutation returns null before any mutation is applied", async () => {
    const active = await getActiveMutation(AGENT, state as never, OWNER, REPO);
    expect(active).toBeNull();
  });

  it("GA2: getActiveMutation returns the current active mutation after one mutation cycle", async () => {
    await runMutation(state, "THE_MUTATION");
    const active = await getActiveMutation(AGENT, state as never, OWNER, REPO);
    expect(active).toBe("THE_MUTATION");
  });

  it("PM1: promoteMutation returns false when no active mutation exists", async () => {
    const result = await promoteMutation(AGENT, state as never, undefined, OWNER, REPO);
    expect(result).toBe(false);
  });

  it("PM2: promoteMutation returns true and leaves active key intact", async () => {
    await runMutation(state, "THE_MUTATION");
    const result = await promoteMutation(AGENT, state as never, undefined, OWNER, REPO);
    expect(result).toBe(true);
    expect(await state.getJSON<string>(activeKey())).toBe("THE_MUTATION");
  });

  it("PM3: rollback still works correctly after a mutation is promoted", async () => {
    const ORIGINAL = "ORIGINAL";
    await state.setJSONWithTTL(activeKey(), ORIGINAL, 60);

    await runMutation(state, "PROMOTED_MUTATION");
    await promoteMutation(AGENT, state as never, undefined, OWNER, REPO);

    await rollbackLastMutation(AGENT, state as never, undefined, OWNER, REPO);
    expect(await state.getJSON<string>(activeKey())).toBe(ORIGINAL);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 7 — Namespace isolation: different agents/repos must not interfere
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 7 — Namespace isolation: agent/repo namespaces are independent", () => {
  let state: MockState;

  beforeEach(() => {
    state = makeRedisState();
    mockAiRoute.mockReset();
  });

  it("ISO1: mutation to 'architect' does not affect 'coder' active key", async () => {
    await runMutation(state, "ARCHITECT_MUTATION");
    const coderActive = await getActiveMutation("coder", state as never, OWNER, REPO);
    expect(coderActive).toBeNull();
  });

  it("ISO2: mutation to org-A/repo-A does not affect org-B/repo-B", async () => {
    mockAiRoute.mockResolvedValueOnce("MUTATION_A");
    await mutatePrompt(AGENT, makeFailure(), state as never, undefined, "org-A", "repo-A");

    const activeBinB = await getActiveMutation(AGENT, state as never, "org-B", "repo-B");
    expect(activeBinB).toBeNull();
  });

  it("ISO3: rollback on 'reviewer' does not affect 'architect' state", async () => {
    // Apply architect mutation
    await runMutation(state, "ARCHITECT_V1");

    // Apply reviewer mutation
    mockAiRoute.mockResolvedValueOnce("REVIEWER_V1");
    await mutatePrompt("reviewer", makeFailure(), state as never, undefined, OWNER, REPO);

    // Roll back reviewer
    await rollbackLastMutation("reviewer", state as never, undefined, OWNER, REPO);

    // Architect must still hold its mutation
    const architectActive = await getActiveMutation(AGENT, state as never, OWNER, REPO);
    expect(architectActive).toBe("ARCHITECT_V1");
  });

  it("ISO4: all three agents can be mutated and rolled back independently", async () => {
    const agents = ["architect", "coder", "reviewer"] as const;

    // Mutate all three
    for (const agent of agents) {
      mockAiRoute.mockResolvedValueOnce(`${agent.toUpperCase()}_MUTATION`);
      await mutatePrompt(agent, makeFailure(), state as never, undefined, OWNER, REPO);
    }

    // Verify each has its own mutation
    for (const agent of agents) {
      const active = await getActiveMutation(agent, state as never, OWNER, REPO);
      expect(active).toBe(`${agent.toUpperCase()}_MUTATION`);
    }

    // Roll back each independently
    for (const agent of agents) {
      await rollbackLastMutation(agent, state as never, undefined, OWNER, REPO);
      // After rollback from null-previous, active must be null
      expect(await getActiveMutation(agent, state as never, OWNER, REPO)).toBeNull();
    }
  });
});
