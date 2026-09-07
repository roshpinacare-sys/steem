import { describe, expect, it } from "vitest";
import {
  directModelProfile,
  evaluateModelCandidate,
  routeModel,
  type ModelCapabilityProfile,
} from "@/lib/models/router";

function profile(id: string, patch: Partial<ModelCapabilityProfile> = {}): ModelCapabilityProfile {
  return {
    ...directModelProfile("simulation", id, {
      id,
      displayName: id,
      structuredOutputReliability: 0.8,
      toolReliability: 0.8,
      planningQuality: 0.8,
      codeQuality: 0.8,
      availability: 0.9,
      evaluationConfidence: 0.9,
      latencyMs: 100,
    }),
    ...patch,
  };
}

describe("model routing", () => {
  it("fails closed when no model satisfies hard constraints", () => {
    const decision = routeModel(
      [profile("remote", { local: false, privacyScore: 0.4 })],
      { requiresOffline: true, requiredPrivacy: "restricted" },
    );
    expect(decision.selected).toBeUndefined();
    expect(decision.candidates[0].rejections).toEqual(
      expect.arrayContaining(["offline_required", "privacy_requirement_not_met"]),
    );
  });

  it("selects the best eligible model and exposes a fallback", () => {
    const decision = routeModel(
      [
        profile("slow", { latencyMs: 15_000, planningQuality: 0.95 }),
        profile("balanced", { latencyMs: 300, planningQuality: 0.88 }),
        profile("weak", { planningQuality: 0.3 }),
      ],
      { minimumPlanningQuality: 0.7, allowFallback: true },
    );
    expect(decision.selected?.model).toBe("balanced");
    expect(decision.fallback?.model).toBe("slow");
  });

  it("uses deterministic tie breaking", () => {
    const a = profile("a");
    const b = profile("b");
    const first = routeModel([b, a], {});
    const second = routeModel([a, b], {});
    expect(first.selected?.id).toBe(second.selected?.id);
  });

  it("rejects disabled candidates independently of score", () => {
    const candidate = evaluateModelCandidate(
      profile("disabled", { enabled: false, planningQuality: 1, codeQuality: 1 }),
      {},
    );
    expect(candidate.eligible).toBe(false);
    expect(candidate.rejections).toContain("disabled");
  });

  it("weights verification quality for verification tasks", () => {
    const decision = routeModel(
      [
        profile("builder", { planningQuality: 0.95, codeQuality: 0.95, verificationQuality: 0.25 }),
        profile("verifier", { planningQuality: 0.72, codeQuality: 0.7, verificationQuality: 0.99 }),
      ],
      { taskClass: "verification", minimumVerificationQuality: 0.7 },
    );
    expect(decision.selected?.model).toBe("verifier");
    expect(decision.candidates.find((row) => row.profile.model === "builder")?.rejections)
      .toContain("verification_quality_insufficient");
  });

  it("rejects unavailable models and penalizes degraded health", () => {
    const decision = routeModel(
      [
        profile("unavailable", { healthState: "unavailable", planningQuality: 1 }),
        profile("degraded", { healthState: "degraded", planningQuality: 0.92 }),
        profile("healthy", { healthState: "healthy", planningQuality: 0.88 }),
      ],
      { taskClass: "planning" },
    );
    expect(decision.selected?.model).toBe("healthy");
    expect(decision.candidates.find((row) => row.profile.model === "unavailable")?.rejections)
      .toContain("health_unavailable");
  });

  it("never silently violates a tool-support constraint", () => {
    const decision = routeModel(
      [profile("no-tools", { supportsTools: false }), profile("tools", { supportsTools: true })],
      { requiresTools: true },
    );
    expect(decision.selected?.model).toBe("tools");
  });
});
