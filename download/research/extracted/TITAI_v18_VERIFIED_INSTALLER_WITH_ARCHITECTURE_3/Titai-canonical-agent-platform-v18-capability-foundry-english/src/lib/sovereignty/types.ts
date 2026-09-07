import type { ModelCapabilityProfile } from "@/lib/models/router";

export type SovereigntyLevel =
  | "non_sovereign"
  | "partially_sovereign"
  | "sovereign_development_mode"
  | "sovereign_controlled_pilot"
  | "sovereign_production_candidate";

export type LocalityClass =
  | "local_authoritative"
  | "local_preferred"
  | "hybrid_optional"
  | "remote_optional"
  | "remote_required"
  | "unsupported_offline";

export interface SovereigntyVector {
  compute: number;
  model: number;
  data: number;
  memory: number;
  identity: number;
  tools: number;
  network: number;
  updates: number;
  supplyChain: number;
  recovery: number;
  operations: number;
  energy: number;
  governance: number;
}

export interface SovereigntyDependency {
  id: string;
  name: string;
  version?: string;
  purpose: string;
  license?: string;
  maintainer?: string;
  phase: "build" | "runtime" | "both";
  locality: LocalityClass;
  mandatory: boolean;
  networkRequired: boolean;
  authenticationRequired: boolean;
  dataSentExternally: string[];
  updateSource?: string;
  integrityMethod: string;
  offlineReplacement?: string;
  removalStrategy?: string;
  failureBehavior: "fail_closed" | "degrade" | "unavailable" | "unknown";
  sovereigntyImpact: string;
  evidence: string[];
}

export interface HardwareProfile {
  id: string;
  displayName: string;
  cpuArchitecture: string;
  logicalCores: number;
  ramBytes: number;
  gpuVendor?: string;
  gpuArchitecture?: string;
  vramBytes?: number;
  diskFreeBytes: number;
  thermalState: "nominal" | "warm" | "throttled" | "unknown";
  powerSource: "mains" | "battery" | "ups" | "unknown";
  maximumPowerWatts?: number;
  networkAvailable: boolean;
}

export interface SovereignModelProfile extends ModelCapabilityProfile {
  modelFamily: string;
  artifactFormat: string;
  quantization?: string;
  artifactBytes?: number;
  minimumRamBytes: number;
  minimumVramBytes?: number;
  supportedCpuArchitectures: string[];
  supportedGpuArchitectures?: string[];
  startupMs: number;
  tokensPerSecond?: number;
  locality: LocalityClass;
  requiresCommercialKey: boolean;
  runtimeAdapter: string;
}

export interface SovereignNodeProfile {
  id: string;
  displayName: string;
  trustLevel: "root" | "trusted" | "restricted" | "untrusted";
  hardware: HardwareProfile;
  modelIds: string[];
  toolIds: string[];
  tenantIds: string[];
  storageFreeBytes: number;
  currentLoad: number;
  health: "healthy" | "degraded" | "unavailable";
  lastSynchronizedAt?: string;
  energyProfile: {
    idleWatts: number;
    estimatedInferenceWatts: number;
    confidence: "measured" | "estimated" | "unknown";
  };
}

export type EnergyPolicy =
  | "performance_first"
  | "balanced"
  | "energy_saving"
  | "offline_emergency"
  | "night_batch"
  | "renewable_surplus"
  | "thermal_protection";

export interface SovereignTaskRequirements {
  tenantId: string;
  workspaceId: string;
  taskClass: "planning" | "coding" | "verification" | "tool" | "general";
  requiredPrivacy: "public" | "internal" | "restricted";
  requiresOffline: boolean;
  requiredContextTokens: number;
  requiresTools: boolean;
  requiresStructuredOutput: boolean;
  minimumQuality: number;
  maximumLatencyMs?: number;
  maximumEnergyWh?: number;
  maximumCost?: number;
  dataLocalityNodeId?: string;
  energyPolicy: EnergyPolicy;
}

export interface SovereigntyAssessment {
  vector: SovereigntyVector;
  fatalWeaknesses: string[];
  mandatoryExternalDependencies: string[];
  level: SovereigntyLevel;
  evidenceUnknown: string[];
  explanation: string;
}
