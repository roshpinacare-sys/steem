import { describe, expect, it } from "vitest";
import { DeterministicLocalRuntime, evaluateHardwareFeasibility, routeSovereignModel } from "@/lib/sovereignty/model-runtime";
import type { HardwareProfile, SovereignModelProfile } from "@/lib/sovereignty/types";

const hardware: HardwareProfile = {
  id: "node-a",
  displayName: "Local node",
  cpuArchitecture: "x64",
  logicalCores: 8,
  ramBytes: 16 * 1024 ** 3,
  diskFreeBytes: 100 * 1024 ** 3,
  thermalState: "nominal",
  powerSource: "mains",
  maximumPowerWatts: 65,
  networkAvailable: false,
};

function model(overrides: Partial<SovereignModelProfile> = {}): SovereignModelProfile {
  return {
    id: "local-small",
    provider: "simulation",
    model: "local-small",
    displayName: "Local small",
    enabled: true,
    local: true,
    license: "Apache-2.0",
    contextTokens: 8192,
    supportsTools: true,
    supportsStructuredOutput: true,
    structuredOutputReliability: 0.95,
    toolReliability: 0.9,
    planningQuality: 0.7,
    codeQuality: 0.6,
    verificationQuality: 0.65,
    healthState: "healthy",
    availability: 1,
    failureRate: 0.01,
    latencyMs: 500,
    costPerMillionInput: 0,
    costPerMillionOutput: 0,
    energyWhPerMillionTokens: 50,
    privacyScore: 1,
    sovereigntyScore: 1,
    evaluationConfidence: 0.9,
    modelFamily: "deterministic",
    artifactFormat: "builtin",
    minimumRamBytes: 512 * 1024 ** 2,
    supportedCpuArchitectures: ["x64"],
    startupMs: 10,
    tokensPerSecond: 200,
    locality: "local_authoritative",
    requiresCommercialKey: false,
    runtimeAdapter: "deterministic-local-runtime",
    ...overrides,
  };
}

describe("sovereign model runtime", () => {
  it("rejects models that cannot physically run", () => {
    const result = evaluateHardwareFeasibility(model({ minimumRamBytes: 32 * 1024 ** 3 }), hardware);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("ram_insufficient");
  });

  it("routes offline work only to feasible local models", () => {
    const remote = model({ id: "remote", provider: "openai", local: false, locality: "remote_required", requiresCommercialKey: true });
    const decision = routeSovereignModel([remote, model()], hardware, {
      tenantId: "tenant-a",
      workspaceId: "workspace-a",
      taskClass: "general",
      requiredPrivacy: "restricted",
      requiresOffline: true,
      requiredContextTokens: 2048,
      requiresTools: true,
      requiresStructuredOutput: true,
      minimumQuality: 0.2,
      energyPolicy: "balanced",
    });
    expect(decision.selected?.id).toBe("local-small");
    expect(decision.candidates.some((candidate) => candidate.profile.id === "remote")).toBe(false);
  });

  it("provides a zero-network deterministic adapter", async () => {
    const runtime = new DeterministicLocalRuntime();
    const result = await runtime.generate({ modelId: "local-small", prompt: "Create a local result", maximumOutputTokens: 100 });
    expect(runtime.networkRequired).toBe(false);
    expect(result.local).toBe(true);
    expect(JSON.parse(result.text).mode).toBe("local_zero_key");
  });
});
