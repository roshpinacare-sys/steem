import { routeModel, type ModelRouteDecision } from "@/lib/models/router";
import type {
  HardwareProfile,
  SovereignModelProfile,
  SovereignTaskRequirements,
} from "./types";

export interface HardwareFeasibility {
  eligible: boolean;
  reasons: string[];
  estimatedLoadMs: number;
  estimatedEnergyWh: number;
}

export interface SovereignRouteDecision extends ModelRouteDecision {
  hardware: HardwareProfile;
  feasibility: Record<string, HardwareFeasibility>;
  degradationLadder: string[];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function evaluateHardwareFeasibility(
  profile: SovereignModelProfile,
  hardware: HardwareProfile,
  expectedOutputTokens = 1_000,
): HardwareFeasibility {
  const reasons: string[] = [];
  if (!profile.supportedCpuArchitectures.includes(hardware.cpuArchitecture)) {
    reasons.push("cpu_architecture_unsupported");
  }
  if (hardware.ramBytes < profile.minimumRamBytes) reasons.push("ram_insufficient");
  if ((profile.artifactBytes ?? 0) > hardware.diskFreeBytes) reasons.push("disk_insufficient");
  if ((profile.minimumVramBytes ?? 0) > 0) {
    if (!hardware.vramBytes || hardware.vramBytes < (profile.minimumVramBytes ?? 0)) {
      reasons.push("vram_insufficient");
    }
    if (
      profile.supportedGpuArchitectures?.length &&
      (!hardware.gpuArchitecture || !profile.supportedGpuArchitectures.includes(hardware.gpuArchitecture))
    ) {
      reasons.push("gpu_architecture_unsupported");
    }
  }
  if (hardware.thermalState === "throttled") reasons.push("thermal_throttling");
  if (!hardware.networkAvailable && profile.locality === "remote_required") {
    reasons.push("network_unavailable");
  }
  const tokensPerSecond = Math.max(0.1, profile.tokensPerSecond ?? 1);
  const inferenceSeconds = expectedOutputTokens / tokensPerSecond;
  const estimatedLoadMs = Math.max(0, profile.startupMs) + inferenceSeconds * 1_000;
  const estimatedEnergyWh =
    (profile.energyWhPerMillionTokens * expectedOutputTokens) / 1_000_000 +
    ((hardware.maximumPowerWatts ?? 30) * profile.startupMs) / 3_600_000;
  return {
    eligible: reasons.length === 0,
    reasons,
    estimatedLoadMs: Math.round(estimatedLoadMs),
    estimatedEnergyWh: Number(estimatedEnergyWh.toFixed(6)),
  };
}

function applyEnergyPolicy(
  profile: SovereignModelProfile,
  hardware: HardwareProfile,
  requirements: SovereignTaskRequirements,
): SovereignModelProfile {
  const copy = structuredClone(profile);
  const estimatedPower = hardware.maximumPowerWatts ?? 30;
  const energyPenalty =
    requirements.energyPolicy === "performance_first"
      ? 0
      : requirements.energyPolicy === "balanced"
        ? 0.05
        : requirements.energyPolicy === "renewable_surplus"
          ? -0.05
          : 0.15;
  copy.energyWhPerMillionTokens = Math.max(
    0,
    copy.energyWhPerMillionTokens * (1 + energyPenalty) + estimatedPower / 1_000,
  );
  copy.sovereigntyScore = clamp01(
    copy.sovereigntyScore +
      (copy.local ? 0.03 : -0.04) +
      (requirements.requiresOffline && copy.local ? 0.04 : 0),
  );
  return copy;
}

export function routeSovereignModel(
  profiles: readonly SovereignModelProfile[],
  hardware: HardwareProfile,
  requirements: SovereignTaskRequirements,
  now = new Date(),
): SovereignRouteDecision {
  const feasibility: Record<string, HardwareFeasibility> = {};
  const feasibleProfiles = profiles
    .map((profile) => {
      const result = evaluateHardwareFeasibility(profile, hardware);
      feasibility[profile.id] = result;
      return result.eligible ? applyEnergyPolicy(profile, hardware, requirements) : undefined;
    })
    .filter((profile): profile is SovereignModelProfile => Boolean(profile));

  const decision = routeModel(
    feasibleProfiles,
    {
      taskClass: requirements.taskClass,
      requiredPrivacy: requirements.requiredPrivacy,
      requiresOffline: requirements.requiresOffline,
      requiresTools: requirements.requiresTools,
      requiresStructuredOutput: requirements.requiresStructuredOutput,
      minimumContextTokens: requirements.requiredContextTokens,
      maximumLatencyMs: requirements.maximumLatencyMs,
      minimumPlanningQuality: requirements.taskClass === "planning" ? requirements.minimumQuality : 0,
      minimumCodeQuality: requirements.taskClass === "coding" ? requirements.minimumQuality : 0,
      minimumVerificationQuality:
        requirements.taskClass === "verification" ? requirements.minimumQuality : 0,
      allowFallback: true,
    },
    undefined,
    now,
  );

  const selected = decision.selected as SovereignModelProfile | undefined;
  if (selected && requirements.maximumEnergyWh !== undefined) {
    const energy = feasibility[selected.id]?.estimatedEnergyWh ?? Number.POSITIVE_INFINITY;
    if (energy > requirements.maximumEnergyWh) {
      decision.selected = undefined;
      decision.fallback = undefined;
      decision.reason = `No eligible model satisfied the maximum energy budget of ${requirements.maximumEnergyWh} Wh.`;
    }
  }

  const ladder = profiles
    .slice()
    .sort((a, b) => {
      if (a.local !== b.local) return a.local ? -1 : 1;
      if ((a.artifactBytes ?? 0) !== (b.artifactBytes ?? 0)) {
        return (b.artifactBytes ?? 0) - (a.artifactBytes ?? 0);
      }
      return b.planningQuality - a.planningQuality;
    })
    .map((profile) => profile.id);
  ladder.push("human_intervention", "fail_closed");

  return {
    ...decision,
    hardware: structuredClone(hardware),
    feasibility,
    degradationLadder: ladder,
  };
}

export interface LocalRuntimeRequest {
  modelId: string;
  prompt: string;
  maximumOutputTokens: number;
}

export interface LocalRuntimeResponse {
  modelId: string;
  text: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  local: true;
  structured: boolean;
}

export interface LocalModelRuntime {
  readonly id: string;
  readonly networkRequired: false;
  generate(request: LocalRuntimeRequest): Promise<LocalRuntimeResponse>;
}

export class DeterministicLocalRuntime implements LocalModelRuntime {
  readonly id = "deterministic-local-runtime";
  readonly networkRequired = false as const;

  async generate(request: LocalRuntimeRequest): Promise<LocalRuntimeResponse> {
    if (!request.prompt.trim()) throw new Error("prompt_required");
    if (request.maximumOutputTokens <= 0) throw new Error("output_budget_invalid");
    const started = performance.now();
    const text = JSON.stringify({
      summary: request.prompt.trim().slice(0, 320),
      model: request.modelId,
      mode: "local_zero_key",
    });
    return {
      modelId: request.modelId,
      text,
      inputTokens: Math.max(1, Math.ceil(request.prompt.length / 4)),
      outputTokens: Math.min(request.maximumOutputTokens, Math.max(1, Math.ceil(text.length / 4))),
      latencyMs: Math.max(1, Math.round(performance.now() - started)),
      local: true,
      structured: true,
    };
  }
}
