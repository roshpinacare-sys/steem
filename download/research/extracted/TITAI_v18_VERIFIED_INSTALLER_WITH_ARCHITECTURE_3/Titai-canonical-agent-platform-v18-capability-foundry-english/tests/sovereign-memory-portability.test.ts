import { describe, expect, it } from "vitest";
import {
  calculateMemoryConfidence,
  exportMemoryBundle,
  importMemoryBundle,
  type PortableMemoryRecord,
} from "@/lib/sovereignty/memory-portability";

function memory(id: string, overrides: Partial<PortableMemoryRecord> = {}): PortableMemoryRecord {
  return {
    id,
    ownerId: "user-a",
    tenantId: "tenant-a",
    workspaceId: "workspace-a",
    visibility: "private",
    kind: "semantic",
    content: `memory ${id}`,
    contentHash: "a".repeat(64),
    tags: ["local"],
    provenance: { sourceType: "user", capturedAt: "2026-07-11T00:00:00Z" },
    confidence: 0.8,
    authority: 0.7,
    contradictionRisk: 0,
    sensitivity: "internal",
    status: "active",
    correctsId: null,
    contradictionGroup: null,
    expiresAt: null,
    createdAt: "2026-07-11T00:00:00Z",
    updatedAt: "2026-07-11T00:00:00Z",
    ...overrides,
  };
}

describe("sovereign memory portability", () => {
  it("exports, verifies, imports, and detects duplicates", () => {
    const bundle = exportMemoryBundle({ tenantId: "tenant-a", workspaceId: "workspace-a", records: [memory("m1")], now: new Date("2026-07-11T00:00:00Z") });
    const imported = importMemoryBundle({ bundle, targetTenantId: "tenant-a", targetWorkspaceId: "workspace-a" });
    expect(imported.accepted).toHaveLength(1);
    const duplicate = importMemoryBundle({ bundle, targetTenantId: "tenant-a", targetWorkspaceId: "workspace-a", existing: [memory("m1")] });
    expect(duplicate.duplicates).toEqual(["m1"]);
  });

  it("fails closed on cross-tenant import", () => {
    const bundle = exportMemoryBundle({ tenantId: "tenant-a", records: [memory("m1")] });
    expect(() => importMemoryBundle({ bundle, targetTenantId: "tenant-b" })).toThrow("memory_bundle_tenant_mismatch");
  });

  it("decays old procedural memory faster than stable semantic memory", () => {
    const procedural = calculateMemoryConfidence({ baseConfidence: 0.9, authority: 0.9, ageDays: 120, contradictionRisk: 0, corrections: 0, successfulUses: 0, failedUses: 0, kind: "procedural" });
    const semantic = calculateMemoryConfidence({ baseConfidence: 0.9, authority: 0.9, ageDays: 120, contradictionRisk: 0, corrections: 0, successfulUses: 0, failedUses: 0, kind: "semantic" });
    expect(procedural).toBeLessThan(semantic);
  });
});
