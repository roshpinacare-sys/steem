/**
 * cartographer-oversized-pr.test.ts — Task-12 (Pass 59)
 *
 * LOAD TEST: Cartographer with Oversized PR Fixtures
 *
 * ─── Background ────────────────────────────────────────────────────────────
 * `cartographer.ts` builds the file map the Architect and Coder agents use to
 * understand the repository before writing a patch.  In a typical PR it
 * handles tens of changed files.  The task-12 load scenario is an oversized
 * PR: hundreds of changed files, several exceeding 500 KB each — the shape of
 * load most likely to blow the Groq context window or cause redundant LLM
 * calls.
 *
 * The cartographer's design uses a two-level cache to avoid redundant AI
 * summarisation:
 *
 *   1. Redis (keyed by path: `file_map:<path>`)        — fast, per-path
 *   2. R2 (keyed by SHA-256 hash: `ast_cache:<hash>`) — shared, per-content
 *   3. AI route (aiRoute) — fallback; result written to both caches
 *
 * This pass validates those three levels under a synthetic fixture that
 * exercises the full range of file sizes, file counts, and cache interactions
 * expected from an oversized PR.
 *
 * ─── Scope / caveats ───────────────────────────────────────────────────────
 * All network calls are mocked in-process:
 *   - `ai-router.ts` → `aiRoute` is a vi.fn() spy
 *   - `r2-storage.ts` → R2Storage is backed by an in-process Map
 *   - `RedisState` is stubbed per-test with a Map-backed in-process implementation
 * No real AI calls, Redis, R2, or GitHub API access needed.
 *
 * ─── What this pass proves ─────────────────────────────────────────────────
 * 1. `isLargeFile()` threshold boundary: exactly 50 000 bytes → NOT large;
 *    50 001 bytes → IS large. Boundary uses byte count, not char count.
 * 2. `buildFileMap()` routes correctly: large files are summarised; small
 *    files are silently excluded from the fileMap; targetFiles are always
 *    skipped regardless of size.
 * 3. `summarizeFile()` Redis cache hit prevents R2 lookup and AI call.
 * 4. `summarizeFile()` R2 cache hit prevents AI call and writes to Redis.
 * 5. `summarizeFile()` both-cache-miss triggers exactly one AI call; result
 *    is written to both Redis and R2.
 * 6. Two files with identical content share one R2 entry (content hash =
 *    R2 key) but maintain separate Redis entries (path = Redis key).
 * 7. A 200-file oversized PR fixture routes correctly: large files summarised,
 *    small files excluded, targetFiles always skipped.
 * 8. AI call count equals large-non-target file count when no caches are warm.
 * 9. A 500 KB+ file is correctly classified as large; its summary is
 *    truncated to SUMMARY_LINES (50) lines regardless of AI response length.
 *
 * ─── Design boundaries documented ─────────────────────────────────────────
 * DB1: `sharedStorage` is a module-level singleton created on first use of
 *      getSharedStorage().  It is shared across all summarizeFile() calls in
 *      the same process.  Tests that clear the mock R2 Map effectively reset
 *      the store while reusing the same singleton instance — this is correct
 *      because the mock class delegates all ops to the shared Map.
 *
 * DB2: `getSharedStorage()` (no args) in the putText code path uses the env
 *      captured at singleton-creation time.  If env changes between calls
 *      (e.g. credentials rotated at runtime), the putText path silently uses
 *      stale credentials.  Safe pattern: always call getSharedStorage(env).
 *
 * DB3: SUMMARY_LINES truncation applies AFTER the AI responds.  The full
 *      file content is always sent to the AI regardless of file size — no
 *      pre-truncation.  Very large files therefore consume proportionally
 *      more LLM tokens even though the stored summary is capped at 50 lines.
 *
 * DB4: Redis key is path-based (`file_map:<path>`); R2 key is content-hash-
 *      based (`ast_cache:<hash>`).  Two files with identical content share
 *      one R2 entry but have separate Redis entries — correct, because
 *      path-based metadata (file name, module name) belongs to the Redis
 *      cache and content-based summaries belong to R2.
 *
 * ─── Gaps documented ───────────────────────────────────────────────────────
 * GAP-1 (Medium): No concurrency control on summarizeFile.  Two simultaneous
 *   calls for the same uncached path will both miss all caches and make
 *   independent AI calls.  Last writer wins on both caches, so correctness
 *   is preserved, but the redundant AI call wastes tokens proportionally
 *   to concurrent callers.  In an oversized PR with many large files
 *   processed concurrently (Promise.all), this doubles or more the LLM spend.
 *
 * GAP-2 (Low): The same content-hash collision that enables deduplication
 *   (DB4) also means a file whose content changes but whose path doesn't
 *   will get a stale Redis hit (pointing to the old summary) until the Redis
 *   TTL expires.  The R2 key is correctly invalidated by the new hash, but
 *   the Redis path-based entry still returns the old summary.
 *
 * ─── Test structure ────────────────────────────────────────────────────────
 *  Suite A: isLargeFile threshold semantics (4 tests)
 *  Suite B: buildFileMap routing correctness (5 tests)
 *  Suite C: summarizeFile — Redis cache hit path (3 tests)
 *  Suite D: summarizeFile — R2 cache hit path (2 tests)
 *  Suite E: summarizeFile — both-cache-miss path (2 tests)
 *  Suite F: Content-hash deduplication (2 tests)
 *  Suite G: 200-file oversized PR synthetic fixture (4 tests)
 *  Suite H: 500 KB+ file handling and summary truncation (3 tests)
 *  Suite I: throttledBatch rate-limiter under oversized-PR load (6 tests)
 *
 * Total: 9 describe blocks, 31 test cases.
 * (grep -c "it(" counts 31 because each `it()` call = one test; no it.each expansion.)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { isLargeFile, summarizeFile, buildFileMap } from "../src/services/cartographer.js";
import { throttledBatch } from "../src/utils/rate-limiter.js";
import type { RedisState } from "../src/services/redis-state.js";

// ─────────────────────────────────────────────────────────────────────────────
// Module-level mocks (vi.hoisted + vi.mock)
// ─────────────────────────────────────────────────────────────────────────────

const { mockR2Store, mockAiRoute } = vi.hoisted(() => {
  const mockR2Store = new Map<string, string>();
  const mockAiRoute = vi.fn<(...args: [string, string, string]) => Promise<string>>();
  return { mockR2Store, mockAiRoute };
});

vi.mock("../src/services/ai-router.js", () => ({
  aiRoute: mockAiRoute,
}));

vi.mock("../src/services/r2-storage.js", () => ({
  R2Storage: class {
    getText(key: string): Promise<string | null> {
      return Promise.resolve(mockR2Store.get(key) ?? null);
    }
    putText(key: string, val: string): Promise<void> {
      mockR2Store.set(key, val);
      return Promise.resolve();
    }
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** EDGE_FRAGMENT_THRESHOLD_BYTES from cartographer.ts. */
const THRESHOLD_BYTES = 50_000;

/** SUMMARY_LINES from cartographer.ts. */
const SUMMARY_LINES = 50;

/** Build a string that is exactly `byteCount` ASCII bytes long. */
function makeContent(byteCount: number, fillChar = "x"): string {
  return fillChar.repeat(byteCount);
}

/** Build a multi-line AI response with exactly `lineCount` lines. */
function makeMultiLineSummary(lineCount: number): string {
  return Array.from({ length: lineCount }, (_, i) => `Line ${i + 1}: summary content here.`).join("\n");
}

/** Minimal in-process RedisState mock backed by a Map. */
function makeRedis(): { redis: RedisState; store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  const redis = {
    getJSON: vi.fn(async (key: string) => store.get(key) ?? null),
    setJSON: vi.fn(async (key: string, value: unknown) => { store.set(key, value); }),
  } as unknown as RedisState;
  return { redis, store };
}

/** Minimal telemetry spy. */
function makeTelemetrySpy() {
  const events: Array<[string, string, Record<string, unknown>]> = [];
  return {
    telemetry: { decision: vi.fn((s: string, d: string, m: Record<string, unknown>) => { events.push([s, d, m]); }) } as unknown as Parameters<typeof summarizeFile>[3],
    events,
  };
}

beforeEach(() => {
  mockR2Store.clear();
  mockAiRoute.mockReset();
  // Default: return a deterministic summary based on the path argument.
  mockAiRoute.mockImplementation(async (path: string) => `Summary for ${path}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite A — isLargeFile threshold semantics
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite A — isLargeFile threshold semantics", () => {
  it("A1: content exactly at threshold (50 000 bytes) is NOT large", () => {
    const content = makeContent(THRESHOLD_BYTES);
    expect(Buffer.byteLength(content, "utf8")).toBe(THRESHOLD_BYTES);
    expect(isLargeFile(content)).toBe(false);
  });

  it("A2: content one byte over threshold (50 001 bytes) IS large", () => {
    const content = makeContent(THRESHOLD_BYTES + 1);
    expect(Buffer.byteLength(content, "utf8")).toBe(THRESHOLD_BYTES + 1);
    expect(isLargeFile(content)).toBe(true);
  });

  it("A3: empty content is not large", () => {
    expect(isLargeFile("")).toBe(false);
  });

  it("A4: multi-byte unicode characters count by byte size, not char count", () => {
    // Each '€' is 3 bytes in UTF-8; 50 000 / 3 ≈ 16 666 chars → < threshold in chars
    // but at 16 667 chars × 3 = 50 001 bytes → IS large
    const eurosLarge = "€".repeat(Math.ceil((THRESHOLD_BYTES + 1) / 3));
    expect(Buffer.byteLength(eurosLarge, "utf8")).toBeGreaterThan(THRESHOLD_BYTES);
    expect(isLargeFile(eurosLarge)).toBe(true);

    // Exactly THRESHOLD_BYTES chars of ASCII = exactly THRESHOLD_BYTES bytes → NOT large
    const asciiAtThreshold = makeContent(THRESHOLD_BYTES);
    expect(isLargeFile(asciiAtThreshold)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite B — buildFileMap routing correctness
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite B — buildFileMap routing correctness", () => {
  it("B1: small files are excluded from the returned fileMap", async () => {
    const { redis } = makeRedis();
    const prefetch = {
      "src/small.ts": makeContent(100),
      "src/tiny.ts":  makeContent(50),
    };
    const result = await buildFileMap(prefetch, new Set(), redis);
    // Small files are not large — buildFileMap only summarises large files.
    expect(Object.keys(result)).toHaveLength(0);
    expect(mockAiRoute).not.toHaveBeenCalled();
  });

  it("B2: large files are included in the fileMap as summaries", async () => {
    const { redis } = makeRedis();
    const prefetch = {
      "src/large.ts": makeContent(THRESHOLD_BYTES + 100),
      "src/small.ts": makeContent(100),
    };
    const result = await buildFileMap(prefetch, new Set(), redis);
    expect(Object.keys(result)).toEqual(["src/large.ts"]);
    expect(result["src/large.ts"]).toBe("Summary for src/large.ts");
    expect(mockAiRoute).toHaveBeenCalledOnce();
  });

  it("B3: targetFiles are excluded from fileMap regardless of size", async () => {
    const { redis } = makeRedis();
    const largeTarget = makeContent(THRESHOLD_BYTES + 1_000);
    const prefetch = {
      "src/target.ts":    largeTarget,
      "src/context.ts":   largeTarget,
    };
    const targets = new Set(["src/target.ts"]);
    const result = await buildFileMap(prefetch, targets, redis);
    // target.ts is skipped; context.ts is large and summarised
    expect(Object.keys(result)).toEqual(["src/context.ts"]);
    expect(mockAiRoute).toHaveBeenCalledOnce();
  });

  it("B4: when all files are targets, fileMap is empty even if all are large", async () => {
    const { redis } = makeRedis();
    const content = makeContent(THRESHOLD_BYTES + 1);
    const prefetch = { "a.ts": content, "b.ts": content };
    const targets = new Set(["a.ts", "b.ts"]);
    const result = await buildFileMap(prefetch, targets, redis);
    expect(Object.keys(result)).toHaveLength(0);
    expect(mockAiRoute).not.toHaveBeenCalled();
  });

  it("B5: mix of large, small, and target files routes each correctly", async () => {
    const { redis } = makeRedis();
    mockAiRoute.mockImplementation(async (path: string) => `Summary:${path}`);
    const prefetch = {
      "large-context.ts": makeContent(THRESHOLD_BYTES + 1),
      "small-context.ts": makeContent(100),
      "target-large.ts":  makeContent(THRESHOLD_BYTES + 1),
      "target-small.ts":  makeContent(100),
    };
    const targets = new Set(["target-large.ts", "target-small.ts"]);
    const result = await buildFileMap(prefetch, targets, redis);
    expect(Object.keys(result)).toEqual(["large-context.ts"]);
    expect(mockAiRoute).toHaveBeenCalledTimes(1);
    expect(result["large-context.ts"]).toBe("Summary:large-context.ts");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite C — summarizeFile: Redis cache hit path
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite C — summarizeFile Redis cache hit", () => {
  it("C1: Redis hit returns cached summary without consulting R2 or AI", async () => {
    const { redis, store } = makeRedis();
    // Pre-warm Redis cache
    store.set("file_map:src/cached.ts", "cached-summary");
    const content = makeContent(THRESHOLD_BYTES + 1);

    const result = await summarizeFile("src/cached.ts", content, redis);

    expect(result).toBe("cached-summary");
    expect(mockAiRoute).not.toHaveBeenCalled();
    expect(mockR2Store.size).toBe(0); // R2 was never consulted
  });

  it("C2: Redis hit is returned regardless of R2 state", async () => {
    const { redis, store } = makeRedis();
    store.set("file_map:src/both-warm.ts", "redis-wins");
    // Also warm R2 with a different value — Redis should win
    mockR2Store.set("ast_cache:somehash", "r2-value");

    const result = await summarizeFile("src/both-warm.ts", makeContent(THRESHOLD_BYTES + 1), redis);
    expect(result).toBe("redis-wins");
    expect(mockAiRoute).not.toHaveBeenCalled();
  });

  it("C3: subsequent calls to summarizeFile for the same path hit Redis", async () => {
    const { redis } = makeRedis();
    const content = makeContent(THRESHOLD_BYTES + 1);
    mockAiRoute.mockResolvedValue("ai-generated-summary");

    // First call: cold cache → AI is called
    const first = await summarizeFile("src/module.ts", content, redis);
    expect(mockAiRoute).toHaveBeenCalledTimes(1);
    expect(first).toBe("ai-generated-summary");

    // Second call: Redis is warm → no AI call
    const second = await summarizeFile("src/module.ts", content, redis);
    expect(mockAiRoute).toHaveBeenCalledTimes(1); // still only 1
    expect(second).toBe("ai-generated-summary");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite D — summarizeFile: R2 cache hit path
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite D — summarizeFile R2 cache hit", () => {
  it("D1: R2 hit skips AI call and writes summary to Redis", async () => {
    const { redis, store } = makeRedis();
    // Do NOT pre-warm Redis (empty store)
    // Pre-warm R2 with a summary keyed by content hash
    const content = makeContent(THRESHOLD_BYTES + 1);
    // Compute the same hash cartographer uses
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
    mockR2Store.set(`ast_cache:${hash}`, "r2-cached-summary");

    const result = await summarizeFile("src/r2hit.ts", content, redis);

    expect(result).toBe("r2-cached-summary");
    expect(mockAiRoute).not.toHaveBeenCalled();
    // R2 hit should back-fill Redis for subsequent calls
    expect(store.get("file_map:src/r2hit.ts")).toBe("r2-cached-summary");
  });

  it("D2: after R2 back-fill, a second call to the same path is served from Redis", async () => {
    const { redis } = makeRedis();
    const content = makeContent(THRESHOLD_BYTES + 1);
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
    mockR2Store.set(`ast_cache:${hash}`, "r2-content");

    await summarizeFile("src/backfill.ts", content, redis);   // primes Redis
    await summarizeFile("src/backfill.ts", content, redis);   // should hit Redis

    // AI is never called in either invocation
    expect(mockAiRoute).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite E — summarizeFile: both-cache-miss path (AI fallback)
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite E — summarizeFile both-cache-miss (AI fallback)", () => {
  it("E1: cold cache triggers exactly one AI call; result stored in Redis and R2", async () => {
    const { redis, store } = makeRedis();
    const content = makeContent(THRESHOLD_BYTES + 1);
    mockAiRoute.mockResolvedValue("fresh-ai-summary");

    const result = await summarizeFile("src/cold.ts", content, redis);

    expect(result).toBe("fresh-ai-summary");
    expect(mockAiRoute).toHaveBeenCalledOnce();
    // Redis updated
    expect(store.get("file_map:src/cold.ts")).toBe("fresh-ai-summary");
    // R2 updated (at least one entry written)
    expect(mockR2Store.size).toBeGreaterThanOrEqual(1);
  });

  it("E2: AI response longer than SUMMARY_LINES is truncated before caching", async () => {
    const { redis } = makeRedis();
    const content = makeContent(THRESHOLD_BYTES + 1);
    // AI returns 100 lines; only first 50 should be stored
    mockAiRoute.mockResolvedValue(makeMultiLineSummary(100));

    const result = await summarizeFile("src/long-summary.ts", content, redis);

    const lines = result.split("\n");
    expect(lines.length).toBeLessThanOrEqual(SUMMARY_LINES);
    expect(lines[0]).toBe("Line 1: summary content here.");
    expect(lines[SUMMARY_LINES - 1]).toBe(`Line ${SUMMARY_LINES}: summary content here.`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite F — Content-hash deduplication
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite F — Content-hash deduplication", () => {
  it("F1: two files with identical content share one R2 entry (single AI call)", async () => {
    const { redis } = makeRedis();
    const content = makeContent(THRESHOLD_BYTES + 1);
    mockAiRoute.mockResolvedValue("shared-summary");

    await summarizeFile("src/file-a.ts", content, redis);
    // mockR2Store now has the hash entry; second call should hit R2
    await summarizeFile("src/file-b.ts", content, redis);

    // AI called only once: second file hits the R2 hash cache
    expect(mockAiRoute).toHaveBeenCalledTimes(1);
    // R2 has exactly one entry
    expect(mockR2Store.size).toBe(1);
  });

  it("F2: same content / different paths → separate Redis keys, shared R2 key", async () => {
    const { redis, store } = makeRedis();
    const content = makeContent(THRESHOLD_BYTES + 1);
    mockAiRoute.mockResolvedValue("deduped");

    await summarizeFile("src/alpha.ts", content, redis);
    await summarizeFile("src/beta.ts",  content, redis);

    // Two separate Redis entries (path-keyed)
    expect(store.has("file_map:src/alpha.ts")).toBe(true);
    expect(store.has("file_map:src/beta.ts")).toBe(true);
    expect(store.get("file_map:src/alpha.ts")).toBe("deduped");
    expect(store.get("file_map:src/beta.ts")).toBe("deduped");

    // Only one R2 entry (content-hash-keyed)
    expect(mockR2Store.size).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite G — 200-file oversized PR synthetic fixture
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite G — 200-file oversized PR synthetic fixture", () => {
  /**
   * Generates a synthetic PR fixture:
   * - `smallCount` small files (< threshold, unique paths)
   * - `largeCount` large files (> threshold, unique paths, unique content)
   * - `targetCount` target files (always skipped by buildFileMap)
   */
  function makePrFixture(opts: { smallCount: number; largeCount: number; targetCount: number }) {
    const prefetch: Record<string, string> = {};
    const targets = new Set<string>();

    for (let i = 0; i < opts.smallCount; i++) {
      // Each small file has unique content to avoid hash collisions
      prefetch[`src/small-${i}.ts`] = `// small file ${i}\n`.repeat(10);
    }
    for (let i = 0; i < opts.largeCount; i++) {
      // Each large file has unique content (i suffix ensures unique hash)
      prefetch[`src/large-${i}.ts`] = makeContent(THRESHOLD_BYTES + 1) + i.toString();
    }
    for (let i = 0; i < opts.targetCount; i++) {
      const path = `src/target-${i}.ts`;
      prefetch[path] = makeContent(THRESHOLD_BYTES + 1) + `target-${i}`;
      targets.add(path);
    }
    return { prefetch, targets };
  }

  it("G1: 200 files (180 small, 10 large, 10 target-large) — only 10 non-target large files summarised", async () => {
    const { redis } = makeRedis();
    mockAiRoute.mockImplementation(async (path: string) => `Summary:${path}`);
    const { prefetch, targets } = makePrFixture({ smallCount: 180, largeCount: 10, targetCount: 10 });

    const result = await buildFileMap(prefetch, targets, redis);

    const summarisedPaths = Object.keys(result);
    // Exactly 10 large non-target files should appear in the fileMap
    expect(summarisedPaths).toHaveLength(10);
    expect(summarisedPaths.every((p) => p.startsWith("src/large-"))).toBe(true);
    // AI called exactly once per large non-target file
    expect(mockAiRoute).toHaveBeenCalledTimes(10);
    // No small or target file in result
    expect(summarisedPaths.some((p) => p.includes("small"))).toBe(false);
    expect(summarisedPaths.some((p) => p.includes("target"))).toBe(false);
  });

  it("G2: 10 large files with warm Redis cache produce zero AI calls", async () => {
    const { redis, store } = makeRedis();
    const { prefetch, targets } = makePrFixture({ smallCount: 0, largeCount: 10, targetCount: 0 });

    // Pre-warm Redis for every large file
    for (let i = 0; i < 10; i++) {
      store.set(`file_map:src/large-${i}.ts`, `warm-summary-${i}`);
    }

    const result = await buildFileMap(prefetch, targets, redis);

    expect(mockAiRoute).not.toHaveBeenCalled();
    expect(Object.keys(result)).toHaveLength(10);
    expect(result["src/large-0.ts"]).toBe("warm-summary-0");
    expect(result["src/large-9.ts"]).toBe("warm-summary-9");
  });

  it("G3: cold cache — AI call count equals exactly the number of large non-target files", async () => {
    const { redis } = makeRedis();
    const LARGE_COUNT = 15;
    const TARGET_LARGE_COUNT = 5;
    const { prefetch, targets } = makePrFixture({
      smallCount: 80,
      largeCount: LARGE_COUNT,
      targetCount: TARGET_LARGE_COUNT,
    });
    mockAiRoute.mockImplementation(async (path: string) => `S:${path}`);

    await buildFileMap(prefetch, targets, redis);

    expect(mockAiRoute).toHaveBeenCalledTimes(LARGE_COUNT);
  });

  it("G4 — GAP-1: concurrent summarizeFile calls for the same uncached path make redundant AI calls", async () => {
    // Two simultaneous calls for the same uncached large file both miss cache
    // and both invoke the AI, doubling token spend. This is a documented gap.
    const { redis } = makeRedis();
    const content = makeContent(THRESHOLD_BYTES + 1);
    let aiCallCount = 0;
    mockAiRoute.mockImplementation(async () => {
      aiCallCount++;
      return "concurrent-summary";
    });

    // Launch both simultaneously before either can write to cache
    const [r1, r2] = await Promise.all([
      summarizeFile("src/concurrent.ts", content, redis),
      summarizeFile("src/concurrent.ts", content, redis),
    ]);

    // Both return the correct value
    expect(r1).toBe("concurrent-summary");
    expect(r2).toBe("concurrent-summary");

    // DOCUMENTED GAP-1: two AI calls were made (one per concurrent invocation)
    // because neither could see the other's in-flight result.
    expect(aiCallCount).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite H — 500 KB+ file handling and summary truncation
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite H — 500 KB+ file content handling", () => {
  it("H1: 500 KB file is correctly classified as large", () => {
    const content = makeContent(500_000);
    expect(Buffer.byteLength(content, "utf8")).toBe(500_000);
    expect(isLargeFile(content)).toBe(true);
  });

  it("H2: AI receives full file content; stored summary is capped at SUMMARY_LINES", async () => {
    const { redis } = makeRedis();
    const fiveHundredKB = makeContent(500_000);

    // AI receives the full content (captured in the call arg)
    let capturedPrompt = "";
    mockAiRoute.mockImplementation(async (_path: string, _model: string, prompt: string) => {
      capturedPrompt = prompt;
      return makeMultiLineSummary(200); // AI returns 200 lines
    });

    const result = await summarizeFile("src/huge.ts", fiveHundredKB, redis);

    // Full content was sent to AI (DB3: no pre-truncation)
    expect(capturedPrompt).toContain(fiveHundredKB);

    // Stored summary is capped at SUMMARY_LINES
    expect(result.split("\n").length).toBeLessThanOrEqual(SUMMARY_LINES);
  });

  it("H3: summary for 500KB file is cached; second call makes no AI call", async () => {
    const { redis } = makeRedis();
    const fiveHundredKB = makeContent(500_000);
    mockAiRoute.mockResolvedValue(makeMultiLineSummary(10));

    await summarizeFile("src/big-cached.ts", fiveHundredKB, redis);  // cold
    await summarizeFile("src/big-cached.ts", fiveHundredKB, redis);  // warm

    expect(mockAiRoute).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite I — throttledBatch rate-limiter under oversized-PR load
//
// `throttledBatch` is the rate-limiter used when the pipeline dispatches
// multiple concurrent GitHub API calls or summarizeFile calls for an oversized
// PR.  It batches items into chunks of `size`, runs each chunk concurrently
// with Promise.all, and inserts a random jitter delay of up to `jitterMs`
// between chunks.
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite I — throttledBatch rate-limiter under oversized-PR load", () => {
  it("I1: results are returned in input order regardless of chunk boundaries", async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const results = await throttledBatch(items, 5, 0, async (x) => x * 2);
    expect(results).toEqual(items.map((x) => x * 2));
  });

  it("I2: items are processed in chunks of the specified size", async () => {
    const callLog: number[] = [];
    // Track the maximum concurrent call count inside each chunk
    let concurrentNow = 0;
    let maxConcurrent = 0;

    const items = Array.from({ length: 12 }, (_, i) => i);
    await throttledBatch(items, 4, 0, async (x) => {
      concurrentNow++;
      maxConcurrent = Math.max(maxConcurrent, concurrentNow);
      callLog.push(x);
      await Promise.resolve(); // yield to allow other chunk members to start
      concurrentNow--;
      return x;
    });

    // Within a chunk, up to `size` (4) items are concurrent
    expect(maxConcurrent).toBeLessThanOrEqual(4);
    // All 12 items are processed
    expect(callLog.sort((a, b) => a - b)).toEqual(items);
  });

  it("I3: 200-file oversized PR fixture processed in chunks of 10 — correct result count", async () => {
    const files = Array.from({ length: 200 }, (_, i) => `src/file-${i}.ts`);
    const results = await throttledBatch(files, 10, 0, async (path) => `processed:${path}`);
    expect(results).toHaveLength(200);
    expect(results[0]).toBe("processed:src/file-0.ts");
    expect(results[199]).toBe("processed:src/file-199.ts");
  });

  it("I4: empty input returns empty array immediately", async () => {
    const fn = vi.fn().mockResolvedValue("never");
    const results = await throttledBatch<string, string>([], 10, 0, fn);
    expect(results).toHaveLength(0);
    expect(fn).not.toHaveBeenCalled();
  });

  it("I5: exactly (n-1) jitter delays are inserted for n chunks — none after the last chunk", async () => {
    // throttledBatch source: `if (i + size < items.length) { await sleep(Math.random() * jitterMs); }`
    // The guard `i + size < items.length` is FALSE for the last chunk — no delay is inserted.
    //
    // Strategy: stub Math.random to 0.5 for a deterministic delay value,
    // use fake timers to control setTimeout, count calls exactly.
    const JITTER_MS = 1000;
    const mathRandomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.useFakeTimers();

    const items = Array.from({ length: 9 }, (_, i) => i);
    // 9 items / chunk-size 3 = 3 chunks → exactly 2 inter-chunk delays; 0 after last chunk
    const promise = throttledBatch(items, 3, JITTER_MS, async (x) => x);
    // Run all pending timers so the jitter sleeps resolve. Must be the async
    // variant: each subsequent sleep is only scheduled after the previous
    // chunk's microtask chain runs, which the sync runAllTimers never yields to.
    await vi.runAllTimersAsync();
    const results = await promise;

    // All results in order
    expect(results).toEqual(items);

    // sleep() is `new Promise(r => setTimeout(r, ms))` and each inter-chunk
    // jitter computes its delay via exactly one Math.random() call. Fake
    // timers do not expose setTimeout as a vi.fn, so the spy on Math.random
    // is the reliable jitter counter: 3 chunks → exactly 2 inter-chunk
    // delays, none after the last chunk.
    expect(mathRandomSpy).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
    mathRandomSpy.mockRestore();
  });

  it("I6 — documented fail-fast: a single item failure aborts the batch; subsequent chunks never start", async () => {
    // throttledBatch uses `await Promise.all(chunk.map(fn))` per chunk.
    // Promise.all rejects on the first rejection, throwing out of the for-loop.
    // This is correct fail-fast behavior — not a bug.
    //
    // Design boundary: partial results from the failing chunk are silently
    // discarded because the for-loop throws before `out.push(...results)`.
    // Callers that need partial results or per-item retry must implement
    // their own wrapper around throttledBatch.
    const processed: number[] = [];
    const items = Array.from({ length: 9 }, (_, i) => i);

    // Item 1 throws; items 0 and 2 are in the same first chunk of 3
    await expect(
      throttledBatch(items, 3, 0, async (x) => {
        if (x === 1) throw new Error("injected-failure");
        processed.push(x);
        return x;
      }),
    ).rejects.toThrow("injected-failure");

    // Items in chunks 1 and 2 (indices 3–8) are never started because
    // the first chunk's Promise.all rejects before the loop can advance.
    const neverProcessed = processed.filter((x) => x >= 3);
    expect(neverProcessed).toHaveLength(0);

    // Items 0 and 2 completed successfully inside the failing chunk but their
    // results are discarded — the caller only sees the rejection.
    // An oversized-PR caller that retries the full batch on any single failure
    // will re-process all already-completed items.  This is the known cost of
    // the current all-or-nothing Promise.all design.
  });
});
