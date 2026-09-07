/**
 * warden-multi-violation.test.ts
 *
 * Adversarial audit of warden.ts + warden-memory.ts for multi-violation
 * correctness, priority-ordering behavior, and Coder feedback loop quality.
 *
 * SCOPE — Task-46
 * ---------------
 * Documents and locks the undocumented priority-ordering rule
 * (any > console.log > await) and the single-violation-per-call design
 * boundary that limits Coder feedback when multiple violations co-exist
 * in a single file or across files in a patch.
 *
 * GAPS DOCUMENTED (not fixed in this pass)
 * -----------------------------------------
 * GAP-1 (Medium): Priority ordering (any > console.log > await) is an
 *   artifact of loop sequencing, not a stated policy. Changing the loop
 *   order silently changes Coder feedback behavior. No test previously
 *   locked this ordering.
 *
 * GAP-2 (Medium): inspectFile() returns on first match. A file with N
 *   distinct violation types requires N wardenGuard() round-trips to
 *   surface all of them. Each round-trip is a full Coder + Warden cycle.
 *
 * GAP-3 (Medium): wardenGuard() stops at the first violating file in the
 *   patch.files[] array. Later files are never inspected, even if they
 *   also have violations.
 *
 * GAP-4 (Medium): warden-memory.ts records exactly one lesson key per
 *   wardenGuard() call — the key for the first-encountered violation only.
 *   loadWardenLessons() therefore presents incomplete violation context to
 *   the Coder, requiring multiple round-trips to surface all violation
 *   types on multi-violation files.
 *
 * DESIGN BOUNDARIES (intentional — not bugs)
 * -------------------------------------------
 * DB-1: inspectFile() is a pure function: identical input always returns
 *       identical output. Priority ordering is deterministic for the
 *       current loop sequence.
 * DB-2: wardenGuard() processes files in patch.files[] array order.
 *       Patch-array ordering is the Coder's responsibility.
 * DB-3: warden-memory key is "${path}::${rule}" — lesson identity is the
 *       (file-path, violation-rule) pair. Multiple rules on the same file
 *       accumulate as separate keys, each surfaced only once its guard call
 *       is reached.
 * DB-4: loadWardenLessons() returns up to `limit` (default 5) lessons
 *       sorted by count descending. High-frequency lessons bubble up
 *       regardless of rule type.
 */

import { describe, it, expect } from "vitest";
import { inspectFile, wardenGuard, WardenRejectionError } from "../src/agents/warden.js";
import { recordWardenRejection, loadWardenLessons } from "../src/services/warden-memory.js";
import type { CoderOutput } from "../src/schemas/coder-schema.js";
import type { RedisState } from "../src/services/redis-state.js";

// ---------------------------------------------------------------------------
// Minimal in-memory RedisState mock.
// Satisfies the getJSON / setJSONWithTTL contract used by warden-memory.ts
// without requiring a live Upstash Redis connection.
// ---------------------------------------------------------------------------
function makeMockState(): RedisState {
  const store: Record<string, unknown> = {};
  return {
    getJSON: async <T>(key: string): Promise<T | null> =>
      key in store ? (store[key] as T) : null,
    setJSONWithTTL: async (key: string, value: unknown, _ttl: number): Promise<void> => {
      store[key] = value;
    },
  } as unknown as RedisState;
}

// ---------------------------------------------------------------------------
// Helper — runs wardenGuard and returns the caught WardenRejectionError
// message (or empty string if no error was thrown).
// ---------------------------------------------------------------------------
async function runGuard(patch: CoderOutput, state?: RedisState): Promise<string> {
  try {
    await wardenGuard(patch, state, "owner", "repo");
    return "";
  } catch (e) {
    if (e instanceof WardenRejectionError) return e.message;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Describe 1: Priority rule — any beats console.log and await (GAP-1)
// ---------------------------------------------------------------------------
describe("inspectFile() — priority rule: any beats console.log and await", () => {
  it("reports 'any' when the file has only an any-typed parameter", () => {
    const code = `export function f(x: any) { return x; }`;
    const result = inspectFile("f.ts", code);
    expect(result).toContain("any");
  });

  it("reports 'any' (not console.log) when both violations are present", () => {
    const code = `export function f(x: any) { console.log(x); return x; }`;
    const result = inspectFile("f.ts", code);
    expect(result).toContain("any");
    expect(result).not.toContain("console.log");
  });

  it("reports 'any' (not unwrapped await) when both violations are present", () => {
    const code = `export async function f(x: any) { return await fetch("/"); }`;
    const result = inspectFile("f.ts", code);
    expect(result).toContain("any");
    expect(result).not.toContain("await");
  });

  it("reports 'any' (not console.log or await) when all three violations are present", () => {
    const code = `export async function f(x: any) {
      console.log(x);
      return await fetch("/");
    }`;
    const result = inspectFile("f.ts", code);
    expect(result).toContain("any");
    expect(result).not.toContain("console.log");
    expect(result).not.toContain("await");
  });
});

// ---------------------------------------------------------------------------
// Describe 2: Priority rule — console.log beats await when no any (GAP-1)
// ---------------------------------------------------------------------------
describe("inspectFile() — priority rule: console.log beats await when no any", () => {
  it("reports 'console.log' when that is the only violation", () => {
    const code = `export function f() { console.log("x"); }`;
    const result = inspectFile("f.ts", code);
    expect(result).toContain("console.log");
  });

  it("reports 'console.log' (not await) when both violations are present and no any", () => {
    const code = `export async function f() {
      console.log("x");
      return await fetch("/");
    }`;
    const result = inspectFile("f.ts", code);
    expect(result).toContain("console.log");
    expect(result).not.toContain("await");
  });

  it("reports 'await' when only an unwrapped await is present", () => {
    const code = `export async function f() { return await fetch("/"); }`;
    const result = inspectFile("f.ts", code);
    expect(result).toContain("await");
  });

  it("returns null when await is wrapped in try/catch and no other violations exist", () => {
    const code = `export async function f() {
      try { return await fetch("/"); } catch { return null; }
    }`;
    expect(inspectFile("f.ts", code)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Describe 3: Multi-violation iterative disclosure — N violations need N calls (GAP-2)
// ---------------------------------------------------------------------------
describe("inspectFile() — multi-violation iterative disclosure requires N calls (GAP-2)", () => {
  const v0 = `export async function f(x: any) {
    console.log(x);
    return await fetch("/");
  }`;
  const v1 = `export async function f(x: string) {
    console.log(x);
    return await fetch("/");
  }`;
  const v2 = `export async function f(x: string) {
    return await fetch("/");
  }`;
  const v3 = `export async function f(x: string) {
    try { return await fetch("/"); } catch { return null; }
  }`;

  it("call 1: reports 'any' on triple-violation file", () => {
    expect(inspectFile("f.ts", v0)).toContain("any");
  });

  it("call 2: after fixing any, reports 'console.log'", () => {
    expect(inspectFile("f.ts", v1)).toContain("console.log");
    expect(inspectFile("f.ts", v1)).not.toContain("any");
  });

  it("call 3: after fixing any + console.log, reports 'await'", () => {
    expect(inspectFile("f.ts", v2)).toContain("await");
    expect(inspectFile("f.ts", v2)).not.toContain("console.log");
  });

  it("call 4: after all three fixed, returns null", () => {
    expect(inspectFile("f.ts", v3)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Describe 4: Edge cases and false-positive guards
// ---------------------------------------------------------------------------
describe("inspectFile() — edge cases and false-positive guards", () => {
  it("console.warn and console.error are not flagged (only console.log is)", () => {
    const code = `export function f() {
      console.warn("warn");
      console.error("err");
    }`;
    expect(inspectFile("f.ts", code)).toBeNull();
  });

  it("await inside deeply nested try/catch is allowed", () => {
    const code = `export async function f() {
      try {
        try { return await fetch("/a"); } catch { return null; }
      } catch { return null; }
    }`;
    expect(inspectFile("f.ts", code)).toBeNull();
  });

  it("the string literal 'any' is not flagged (only the AnyKeyword type node)", () => {
    const code = `export const msg: string = "any value is accepted";`;
    expect(inspectFile("f.ts", code)).toBeNull();
  });

  it("a file with syntax errors returns a non-null warden string (not null, not throw)", () => {
    const code = `this { is {{ not valid TypeScript )))`;
    const result = inspectFile("bad.ts", code);
    expect(result).not.toBeNull();
    expect(result).toContain("bad.ts");
  });
});

// ---------------------------------------------------------------------------
// Describe 5: wardenGuard() multi-file patch stops at first violating file (GAP-3)
// ---------------------------------------------------------------------------
describe("wardenGuard() — stops at first violating file in patch array (GAP-3)", () => {
  it("a clean multi-file patch resolves without error", async () => {
    const patch: CoderOutput = {
      diff: "",
      files: [
        { path: "a.ts", content: `export const a = 1;` },
        { path: "b.ts", content: `export const b = 2;` },
      ],
    };
    await expect(wardenGuard(patch)).resolves.toBeUndefined();
  });

  it("violation in file 1 throws and names file 1", async () => {
    const patch: CoderOutput = {
      diff: "",
      files: [
        { path: "bad.ts", content: `export function f(x: any) { return x; }` },
        { path: "good.ts", content: `export const a = 1;` },
      ],
    };
    const msg = await runGuard(patch);
    expect(msg).toContain("bad.ts");
    expect(msg).toContain("any");
  });

  it("violation in file 2 throws and names file 2 (file 1 passes)", async () => {
    const patch: CoderOutput = {
      diff: "",
      files: [
        { path: "good.ts", content: `export const a = 1;` },
        { path: "bad.ts", content: `export function f(x: any) { return x; }` },
      ],
    };
    const msg = await runGuard(patch);
    expect(msg).toContain("bad.ts");
    expect(msg).toContain("any");
  });

  it("when both files have violations, only the first file's violation is reported (GAP-3)", async () => {
    const patch: CoderOutput = {
      diff: "",
      files: [
        { path: "first.ts", content: `export function f(x: any) { return x; }` },
        { path: "second.ts", content: `export function g() { console.log("x"); }` },
      ],
    };
    const msg = await runGuard(patch);
    expect(msg).toContain("first.ts");
    expect(msg).toContain("any");
    // second.ts violation is completely invisible to this guard call
    expect(msg).not.toContain("second.ts");
    expect(msg).not.toContain("console.log");
  });
});

// ---------------------------------------------------------------------------
// Describe 6: warden-memory recordWardenRejection key structure (DB-3)
// ---------------------------------------------------------------------------
describe("warden-memory — recordWardenRejection key and count semantics (DB-3)", () => {
  it("records exactly one lesson entry for a (path, rule) pair", async () => {
    const state = makeMockState();
    await recordWardenRejection("o", "r", "foo.ts", "rule-A", state);
    const lessons = await loadWardenLessons("o", "r", state);
    expect(lessons).toHaveLength(1);
    expect(lessons[0].path).toBe("foo.ts");
    expect(lessons[0].rule).toBe("rule-A");
    expect(lessons[0].count).toBe(1);
  });

  it("repeated calls for the same (path, rule) increment count rather than adding entries", async () => {
    const state = makeMockState();
    await recordWardenRejection("o", "r", "foo.ts", "rule-A", state);
    await recordWardenRejection("o", "r", "foo.ts", "rule-A", state);
    await recordWardenRejection("o", "r", "foo.ts", "rule-A", state);
    const lessons = await loadWardenLessons("o", "r", state);
    expect(lessons).toHaveLength(1);
    expect(lessons[0].count).toBe(3);
  });

  it("different rules on the same file become separate entries only as each is surfaced", async () => {
    const state = makeMockState();
    // Round 1: any violation
    await recordWardenRejection("o", "r", "foo.ts", "rule-any", state);
    expect(await loadWardenLessons("o", "r", state)).toHaveLength(1);
    // Round 2: after Coder fixed any, console.log violation surfaced
    await recordWardenRejection("o", "r", "foo.ts", "rule-console", state);
    expect(await loadWardenLessons("o", "r", state)).toHaveLength(2);
  });

  it("loadWardenLessons returns entries sorted by count descending (DB-4)", async () => {
    const state = makeMockState();
    await recordWardenRejection("o", "r", "low.ts", "rule-X", state); // count 1
    await recordWardenRejection("o", "r", "high.ts", "rule-Y", state);
    await recordWardenRejection("o", "r", "high.ts", "rule-Y", state); // count 2
    const lessons = await loadWardenLessons("o", "r", state);
    expect(lessons[0].path).toBe("high.ts");
    expect(lessons[0].count).toBe(2);
    expect(lessons[1].path).toBe("low.ts");
    expect(lessons[1].count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Describe 7: Coder feedback loop gap — wardenGuard() + warden-memory (GAP-4)
// ---------------------------------------------------------------------------
describe("wardenGuard() + warden-memory — Coder feedback loop gap (GAP-4)", () => {
  it("multi-violation file: only the first violation is recorded after guard call", async () => {
    const state = makeMockState();
    const patch: CoderOutput = {
      diff: "",
      files: [{
        path: "multi.ts",
        content: `export async function f(x: any) {
          console.log(x);
          return await fetch("/");
        }`,
      }],
    };
    await expect(wardenGuard(patch, state, "owner", "repo"))
      .rejects.toThrow(WardenRejectionError);

    const lessons = await loadWardenLessons("owner", "repo", state);
    expect(lessons).toHaveLength(1);
    expect(lessons[0].rule).toContain("any");
    // console.log and await violations are invisible to warden-memory
    expect(lessons.every(l => !l.rule.includes("console.log"))).toBe(true);
    expect(lessons.every(l => !l.rule.includes("await"))).toBe(true);
  });

  it("round-trip 2: after Coder fixes any, console.log violation surfaces and is recorded", async () => {
    const state = makeMockState();
    const patch: CoderOutput = {
      diff: "",
      files: [{
        path: "multi.ts",
        content: `export async function f(x: string) {
          console.log(x);
          return await fetch("/");
        }`,
      }],
    };
    await expect(wardenGuard(patch, state, "owner", "repo"))
      .rejects.toThrow(WardenRejectionError);

    const lessons = await loadWardenLessons("owner", "repo", state);
    expect(lessons).toHaveLength(1);
    expect(lessons[0].rule).toContain("console.log");
  });

  it("multi-file patch: only the first violating file's lesson is recorded (GAP-3 × GAP-4)", async () => {
    const state = makeMockState();
    const patch: CoderOutput = {
      diff: "",
      files: [
        { path: "first.ts", content: `export function f(x: any) { return x; }` },
        { path: "second.ts", content: `export function g() { console.log("x"); }` },
      ],
    };
    await expect(wardenGuard(patch, state, "owner", "repo"))
      .rejects.toThrow(WardenRejectionError);

    const lessons = await loadWardenLessons("owner", "repo", state);
    expect(lessons).toHaveLength(1);
    expect(lessons[0].path).toBe("first.ts");
    // second.ts's console.log violation goes completely unrecorded
    expect(lessons.every(l => l.path !== "second.ts")).toBe(true);
  });

  it("loadWardenLessons default limit caps feedback at 5 regardless of total recorded", async () => {
    const state = makeMockState();
    for (let i = 0; i < 7; i++) {
      await recordWardenRejection("owner", "repo", `f${i}.ts`, "rule-X", state);
    }
    const lessons = await loadWardenLessons("owner", "repo", state);
    expect(lessons.length).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// Describe 8: Design boundary locks (DB-1 through DB-4)
// ---------------------------------------------------------------------------
describe("warden — design boundary locks (DB-1 through DB-4)", () => {
  it("DB-1: inspectFile() is deterministic — identical input always produces identical output", () => {
    const code = `export async function f(x: any) {
      console.log(x);
      return await fetch("/");
    }`;
    const r1 = inspectFile("f.ts", code);
    const r2 = inspectFile("f.ts", code);
    expect(r1).toBe(r2);
    expect(r1).toContain("any");
  });

  it("DB-2: wardenGuard() processes files in array order — swapping file order changes which violation is reported", async () => {
    const patchAB: CoderOutput = {
      diff: "",
      files: [
        { path: "a.ts", content: `export function f(x: any) { return x; }` },
        { path: "b.ts", content: `export function g() { console.log("x"); }` },
      ],
    };
    const patchBA: CoderOutput = {
      diff: "",
      files: [
        { path: "b.ts", content: `export function g() { console.log("x"); }` },
        { path: "a.ts", content: `export function f(x: any) { return x; }` },
      ],
    };
    const msgAB = await runGuard(patchAB);
    const msgBA = await runGuard(patchBA);
    expect(msgAB).toContain("a.ts");  // first file wins
    expect(msgBA).toContain("b.ts");  // first file wins
    // Error message for AB contains the any violation, not console.log
    expect(msgAB).toContain("any");
    expect(msgBA).toContain("console.log");
  });

  it("DB-3: same file, different rules → separate warden-memory keys", async () => {
    const state = makeMockState();
    await recordWardenRejection("o", "r", "shared.ts", "rule-any", state);
    await recordWardenRejection("o", "r", "shared.ts", "rule-console", state);
    const lessons = await loadWardenLessons("o", "r", state, 10);
    expect(lessons).toHaveLength(2);
    const rules = lessons.map(l => l.rule);
    expect(rules).toContain("rule-any");
    expect(rules).toContain("rule-console");
  });

  it("DB-4: loadWardenLessons default limit is 5; explicit limit overrides it", async () => {
    const state = makeMockState();
    for (let i = 0; i < 8; i++) {
      await recordWardenRejection("o", "r", `f${i}.ts`, `rule-${i}`, state);
    }
    const default5 = await loadWardenLessons("o", "r", state);
    const explicit3 = await loadWardenLessons("o", "r", state, 3);
    const all10    = await loadWardenLessons("o", "r", state, 10);
    expect(default5.length).toBe(5);
    expect(explicit3.length).toBe(3);
    expect(all10.length).toBe(8); // only 8 recorded
  });
});
