import { describe, expect, it } from "vitest";
import { placeSovereignTask } from "@/lib/sovereignty/node-placement";
import type { SovereignModelProfile, SovereignNodeProfile, SovereignTaskRequirements } from "@/lib/sovereignty/types";

const model: SovereignModelProfile = {
  id: "local-model",
  provider: "simulation",
  model: "local-model",
  displayName: "Local model",
  enabled: true,
  local: true,
  contextTokens: 8192,
  supportsTools: true,
  supportsStructuredOutput: true,
  structuredOutputReliability: 0.9,
  toolReliability: 0.9,
  planningQuality: 0.8,
  codeQuality: 0.7,
  verificationQuality: 0.7,
  healthState: "healthy",
  availability: 1,
  failureRate: 0.01,
  latencyMs: 400,
  costPerMillionInput: 0,
  costPerMillionOutput: 0,
  energyWhPerMillionTokens: 30,
  privacyScore: 1,
  sovereigntyScore: 1,
  evaluationConfidence: 0.9,
  modelFamily: "test",
  artifactFormat: "builtin",
  minimumRamBytes: 512 * 1024 ** 2,
  supportedCpuArchitectures: ["x64"],
  startupMs: 10,
  tokensPerSecond: 100,
  locality: "local_authoritative",
  requiresCommercialKey: false,
  runtimeAdapter: "test",
};

function node(id: string, overrides: Partial<SovereignNodeProfile> = {}): SovereignNodeProfile {
  return {
    id,
    displayName: id,
    trustLevel: "trusted",
    hardware: {
      id,
      displayName: id,
      cpuArchitecture: "x64",
      logicalCores: 8,
      ramBytes: 16 * 1024 ** 3,
      diskFreeBytes: 100 * 1024 ** 3,
      thermalState: "nominal",
      powerSource: "mains",
      maximumPowerWatts: 45,
      networkAvailable: false,
    },
    modelIds: ["local-model"],
    toolIds: ["local.hash"],
    tenantIds: ["tenant-a"],
    storageFreeBytes: 100 * 1024 ** 3,
    currentLoad: 0.1,
    health: "healthy",
    energyProfile: { idleWatts: 8, estimatedInferenceWatts: 35, confidence: "estimated" },
    ...overrides,
  };
}

const requirements: SovereignTaskRequirements = {
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
};

describe("sovereign node placement", () => {
  it("prefers trusted feasible low-load local nodes", () => {
    const decision = placeSovereignTask({
      nodes: [node("busy", { currentLoad: 0.9 }), node("ready", { currentLoad: 0.05, trustLevel: "root" })],
      models: [model],
      requirements,
    });
    expect(decision.selected?.id).toBe("ready");
    expect(decision.selectedModelId).toBe("local-model");
  });

  it("fails closed when tenant scope is absent", () => {
    const decision = placeSovereignTask({ nodes: [node("other", { tenantIds: ["tenant-b"] })], models: [model], requirements });
    expect(decision.selected).toBeUndefined();
    expect(decision.candidates[0]?.reasons).toContain("tenant_not_authorized");
  });
});
