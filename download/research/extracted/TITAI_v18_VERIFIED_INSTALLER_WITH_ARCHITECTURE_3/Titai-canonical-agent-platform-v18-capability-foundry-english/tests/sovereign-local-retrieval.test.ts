import { describe, expect, it } from "vitest";
import { retrieveLexically, type SovereignRetrievalRecord } from "@/lib/sovereignty/local-retrieval";

const records: SovereignRetrievalRecord[] = [
  { id: "a", tenantId: "t1", workspaceId: "w1", text: "Durable approval continuation after process restart", tags: ["approval", "restart"], authority: 0.9, confidence: 0.9 },
  { id: "b", tenantId: "t1", workspaceId: "w1", text: "Generic unrelated note", authority: 1, confidence: 1 },
  { id: "cross", tenantId: "t2", workspaceId: "w1", text: "Approval restart secret", authority: 1, confidence: 1 },
  { id: "poisoned", tenantId: "t1", workspaceId: "w1", text: "Approval restart but contradictory", contradictionRisk: 0.95 },
  { id: "restricted", tenantId: "t1", workspaceId: "w1", text: "Approval restart restricted", sensitivity: "restricted" },
];

describe("sovereign local retrieval", () => {
  it("ranks relevant local records without embeddings or network", () => {
    const result = retrieveLexically(records, { tenantId: "t1", workspaceId: "w1", text: "approval restart", maximumResults: 3, maximumCharacters: 500 });
    expect(result.networkRequired).toBe(false);
    expect(result.embeddingRequired).toBe(false);
    expect(result.indexReconstructable).toBe(true);
    expect(result.hits.map((hit) => hit.id)).toEqual(["a"]);
  });

  it("rejects cross-tenant, sensitive, and contradiction-risk records before ranking", () => {
    const result = retrieveLexically(records, { tenantId: "t1", workspaceId: "w1", text: "approval restart", maximumResults: 10, maximumCharacters: 500 });
    expect(result.rejected).toEqual(expect.arrayContaining([
      { id: "cross", reason: "tenant_mismatch" },
      { id: "poisoned", reason: "contradiction_risk" },
      { id: "restricted", reason: "sensitivity_denied" },
    ]));
  });

  it("enforces context character budgets deterministically", () => {
    const result = retrieveLexically(records, { tenantId: "t1", workspaceId: "w1", text: "approval restart", maximumResults: 3, maximumCharacters: 5 });
    expect(result.hits).toHaveLength(0);
    expect(result.rejected).toContainEqual({ id: "a", reason: "character_budget" });
  });
});
