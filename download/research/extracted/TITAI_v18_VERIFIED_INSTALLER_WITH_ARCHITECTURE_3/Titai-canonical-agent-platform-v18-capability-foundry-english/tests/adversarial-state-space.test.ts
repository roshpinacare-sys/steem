import { describe, expect, it } from "vitest";
import { validateExecutionPlan } from "@/lib/engine/plan";
import { routeModel, type ModelCapabilityProfile } from "@/lib/models/router";
import { assertApprovalTransition, assertRunTransition, assertStepTransition } from "@/lib/canonical/lifecycle";

function profile(id: string, quality: number, enabled = true): ModelCapabilityProfile {
  return {
    id, provider: "simulation", model: id, displayName: id, enabled, local: true, contextTokens: 32_000,
    supportsTools: true, supportsStructuredOutput: true, structuredOutputReliability: quality, toolReliability: quality,
    planningQuality: quality, codeQuality: quality, verificationQuality: quality, healthState: "healthy", availability: 1, failureRate: 1 - quality, latencyMs: 10,
    costPerMillionInput: 0, costPerMillionOutput: 0, energyWhPerMillionTokens: 1, privacyScore: 1,
    sovereigntyScore: 1, evaluationConfidence: 1,
  };
}

describe("adversarial state-space exploration", () => {
  it("rejects every generated directed cycle", () => {
    for (let size = 2; size <= 25; size += 1) {
      const steps = Array.from({ length: size }, (_, index) => ({
        name: `s${index}`,
        description: "generated",
        dependsOn: [`s${(index + 1) % size}`],
      }));
      expect(() => validateExecutionPlan({ steps }, 30)).toThrow(/cycle/i);
    }
  });

  it("accepts generated acyclic plans regardless of input order", () => {
    for (let size = 1; size <= 30; size += 1) {
      const steps = Array.from({ length: size }, (_, index) => ({ name: `s${index}`, description: "generated", dependsOn: index ? [`s${index - 1}`] : [] }));
      expect(validateExecutionPlan({ steps: [...steps].reverse() }, 30).steps).toHaveLength(size);
    }
  });

  it("keeps routing deterministic under candidate permutation", () => {
    const candidates = [profile("weak", .2), profile("best", .95), profile("middle", .6)];
    const selections = [candidates, [...candidates].reverse(), [candidates[1], candidates[0], candidates[2]]]
      .map((rows) => routeModel(rows, { requiresOffline: true, allowFallback: true }, undefined, new Date("2026-07-11T00:00:00Z")).selected?.id);
    expect(new Set(selections)).toEqual(new Set(["best"]));
  });

  it("fails closed when every model violates a hard constraint", () => {
    const decision = routeModel([profile("disabled", .99, false)], { requiresOffline: true, requiresTools: true });
    expect(decision.selected).toBeUndefined();
    expect(decision.reason).toMatch(/No eligible model/);
  });

  it("rejects sampled illegal lifecycle transitions", () => {
    expect(() => assertRunTransition("queued", "completed")).toThrow();
    expect(() => assertStepTransition("completed", "running")).toThrow();
    expect(() => assertApprovalTransition("approved", "rejected")).toThrow();
  });
});
