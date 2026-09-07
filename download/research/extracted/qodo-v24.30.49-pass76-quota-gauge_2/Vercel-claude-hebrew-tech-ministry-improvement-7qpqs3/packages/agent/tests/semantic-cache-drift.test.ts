/**
 * Regression tests for semantic-cache hive drift detection (Bug 17-F).
 *
 * The hive is the cross-repo cache. Without prefetch drift validation a
 * cached patch from another repository could be applied after the source files
 * had changed, producing stale or broken code. These tests verify that
 * findHiveReference rejects a patch as soon as any file hash differs from
 * the current working-tree content.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { findHiveReference, saveHivePatch } from "../src/services/semantic-cache.js";
import type { R2Storage } from "../src/services/r2-storage.js";
import type { Patch } from "../src/agents/coder.js";

// Normalised deterministic vector: every text gets the same unit vector so
// cosine similarity is always exactly 1.0 and the threshold check passes.
const UNIT_VEC = new Float32Array(384).map((_, i) => (i === 0 ? 1 : 0));

vi.mock("@xenova/transformers", () => ({
  env: { cacheDir: "" },
  pipeline: vi.fn().mockResolvedValue(() =>
    Promise.resolve({ data: UNIT_VEC }),
  ),
}));

function makeStorage(initial: Record<string, string> = {}): R2Storage {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getText: vi.fn(async (key: string) => store.get(key) ?? null),
    putText: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    getJSON: vi.fn(),
    putJSON: vi.fn(),
  } as unknown as R2Storage;
}

function makePatch(contentByPath: Record<string, string>): Patch {
  return {
    diff: "",
    files: Object.entries(contentByPath).map(([path, content]) => ({ path, content })),
  };
}

describe("semantic-cache hive drift (Bug 17-F regression)", () => {
  let storage: R2Storage;

  beforeEach(() => {
    storage = makeStorage();
  });

  it("returns a hive patch when current files match cached hashes", async () => {
    const patch = makePatch({ "src/utils/greet.ts": "export function greet() {}" });
    await saveHivePatch(
      "add greet helper",
      { steps: ["add helper"] },
      patch,
      "acme",
      "repo-a",
      storage,
      { QODO_HIVE_SHARE: "public" },
    );

    const hit = await findHiveReference(
      "add greet helper",
      { steps: ["add helper"] },
      "other",
      { "src/utils/greet.ts": "export function greet() {}" },
      storage,
      undefined,
      { QODO_HIVE_SHARE: "public" },
    );

    expect(hit).not.toBeNull();
    expect(hit!.files[0].content).toBe("export function greet() {}");
  });

  it("rejects a hive patch when a file has drifted", async () => {
    const patch = makePatch({ "src/utils/greet.ts": "export function greet() {}" });
    await saveHivePatch(
      "add greet helper",
      { steps: ["add helper"] },
      patch,
      "acme",
      "repo-a",
      storage,
      { QODO_HIVE_SHARE: "public" },
    );

    const hit = await findHiveReference(
      "add greet helper",
      { steps: ["add helper"] },
      "other",
      // File now has different content than what was cached.
      { "src/utils/greet.ts": "export function greet(name: string) {}" },
      storage,
      undefined,
      { QODO_HIVE_SHARE: "public" },
    );

    expect(hit).toBeNull();
  });

  it("rejects a hive patch when a cached file is missing from prefetch", async () => {
    const patch = makePatch({
      "src/utils/greet.ts": "export function greet() {}",
      "src/utils/bye.ts": "export function bye() {}",
    });
    await saveHivePatch(
      "add helpers",
      { steps: ["add helpers"] },
      patch,
      "acme",
      "repo-a",
      storage,
      { QODO_HIVE_SHARE: "public" },
    );

    const hit = await findHiveReference(
      "add helpers",
      { steps: ["add helpers"] },
      "other",
      // bye.ts is absent from current working tree
      { "src/utils/greet.ts": "export function greet() {}" },
      storage,
      undefined,
      { QODO_HIVE_SHARE: "public" },
    );

    expect(hit).toBeNull();
  });
});
