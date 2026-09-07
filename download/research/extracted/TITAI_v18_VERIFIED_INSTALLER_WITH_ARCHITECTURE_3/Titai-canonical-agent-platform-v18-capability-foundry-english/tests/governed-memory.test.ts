import { describe, expect, it } from "vitest";
import type { Memory } from "@/lib/db/schema";
import {
  hashMemoryContent,
  scoreMemory,
  selectMemoriesWithinBudget,
} from "@/lib/memory/governed-memory";

function memory(overrides: Partial<Memory> = {}): Memory {
  const now = new Date("2026-07-10T12:00:00.000Z");
  return {
    id: "m1",
    ownerId: "u1",
    tenantId: "tenant-u1",
    workspaceId: "workspace-u1",
    visibility: "private",
    kind: "semantic",
    content: "SQLite durable leases prevent duplicate worker ownership.",
    contentHash: hashMemoryContent("SQLite durable leases prevent duplicate worker ownership."),
    tags: ["sqlite", "durability"],
    provenance: { sourceType: "artifact", sourceRef: "ADR-0020", capturedAt: now.toISOString() },
    confidence: 0.9,
    authority: 0.9,
    contradictionRisk: 0,
    sensitivity: "internal",
    status: "active",
    correctsId: null,
    contradictionGroup: null,
    expiresAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("governed memory", () => {
  it("scores relevant authoritative memory above unrelated memory", () => {
    const relevant = scoreMemory(memory(), "How do SQLite worker leases avoid duplicates?", ["durability"]);
    const unrelated = scoreMemory(
      memory({ id: "m2", content: "Typography spacing rules for the interface.", tags: ["design"] }),
      "How do SQLite worker leases avoid duplicates?",
      ["durability"],
    );
    expect(relevant.score).toBeGreaterThan(unrelated.score);
  });

  it("excludes expired, corrected, and restricted memories by default", () => {
    const selected = selectMemoriesWithinBudget(
      [
        memory(),
        memory({ id: "expired", expiresAt: new Date("2026-01-01") }),
        memory({ id: "corrected", status: "corrected" }),
        memory({ id: "restricted", sensitivity: "restricted" }),
      ],
      { query: "SQLite durable leases", maxTokens: 500, now: new Date("2026-07-10") },
    );
    expect(selected.map((item) => item.memory.id)).toEqual(["m1"]);
  });

  it("honors the retrieval token budget", () => {
    const selected = selectMemoriesWithinBudget(
      [memory({ id: "a" }), memory({ id: "b" })],
      { query: "SQLite durable leases", maxTokens: 20 },
    );
    expect(selected.reduce((sum, item) => sum + item.estimatedTokens, 0)).toBeLessThanOrEqual(20);
  });

  it("produces stable content hashes", () => {
    expect(hashMemoryContent("same")).toBe(hashMemoryContent("same"));
    expect(hashMemoryContent("same")).not.toBe(hashMemoryContent("different"));
  });
});
