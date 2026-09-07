import { describe, expect, it } from "vitest";
import { decideRiskAdjustedAutonomy } from "@/lib/intelligence/risk-adjusted-autonomy";

describe("risk-adjusted autonomy", () => {
  it("denies dry-run side effects", () => {
    expect(decideRiskAdjustedAutonomy({ risk: "low", effect: "write", idempotency: "intrinsic", dryRun: true, hasHumanApproval: false }).level).toBe("deny");
  });

  it("requires human authority for external or reconciliation-prone effects", () => {
    expect(decideRiskAdjustedAutonomy({ risk: "medium", effect: "external", idempotency: "reconciliation", dryRun: false, hasHumanApproval: false, reversible: false }).level).toBe("human_required");
  });

  it("permits bounded low-risk reads without human approval", () => {
    expect(decideRiskAdjustedAutonomy({ risk: "low", effect: "read", idempotency: "intrinsic", dryRun: false, hasHumanApproval: false, reversible: true, evidenceCompleteness: 1, modelConfidence: 1 }).level).toBe("autonomous");
  });

  it("rejects authority derived from model or memory content", () => {
    const result = decideRiskAdjustedAutonomy({ risk: "low", effect: "read", idempotency: "intrinsic", dryRun: false, hasHumanApproval: false, externalAuthority: true });
    expect(result.level).toBe("deny");
    expect(result.reasons).toContain("model_or_memory_cannot_grant_authority");
  });
});
