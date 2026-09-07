import type { ProviderName } from "@/lib/engine/types";

export type PrivacyClass = "public" | "internal" | "restricted";

export interface ModelCapabilityProfile {
  id: string;
  provider: ProviderName;
  model: string;
  displayName: string;
  enabled: boolean;
  local: boolean;
  license?: string;
  contextTokens: number;
  supportsTools: boolean;
  supportsStructuredOutput: boolean;
  structuredOutputReliability: number;
  toolReliability: number;
  planningQuality: number;
  codeQuality: number;
  verificationQuality: number;
  healthState: "healthy" | "degraded" | "unavailable";
  availability: number;
  failureRate: number;
  latencyMs: number;
  costPerMillionInput: number;
  costPerMillionOutput: number;
  energyWhPerMillionTokens: number;
  privacyScore: number;
  sovereigntyScore: number;
  evaluationConfidence: number;
  evaluatedAt?: string;
  artifactHash?: string;
}

export interface ModelRoutingConstraints {
  preferredProvider?: ProviderName;
  preferredModel?: string;
  requiredPrivacy?: PrivacyClass;
  requiresOffline?: boolean;
  requiresTools?: boolean;
  requiresStructuredOutput?: boolean;
  minimumContextTokens?: number;
  maximumLatencyMs?: number;
  maximumCostPerMillionTokens?: number;
  minimumEvaluationConfidence?: number;
  minimumPlanningQuality?: number;
  minimumCodeQuality?: number;
  minimumVerificationQuality?: number;
  taskClass?: "planning" | "coding" | "verification" | "tool" | "general";
  allowFallback?: boolean;
}

export interface ModelRoutingWeights {
  planningQuality: number;
  codeQuality: number;
  verificationQuality: number;
  structuredOutputReliability: number;
  toolReliability: number;
  availability: number;
  privacy: number;
  sovereignty: number;
  latencyPenalty: number;
  costPenalty: number;
  energyPenalty: number;
  failurePenalty: number;
  degradedHealthPenalty: number;
  preferredProviderBonus: number;
  preferredModelBonus: number;
}

export const DEFAULT_ROUTING_WEIGHTS: ModelRoutingWeights = {
  planningQuality: 0.19,
  codeQuality: 0.14,
  verificationQuality: 0.12,
  structuredOutputReliability: 0.12,
  toolReliability: 0.12,
  availability: 0.1,
  privacy: 0.1,
  sovereignty: 0.1,
  latencyPenalty: 0.04,
  costPenalty: 0.03,
  energyPenalty: 0.02,
  failurePenalty: 0.12,
  degradedHealthPenalty: 0.08,
  preferredProviderBonus: 0.04,
  preferredModelBonus: 0.08,
};

export interface ModelRouteCandidate {
  profile: ModelCapabilityProfile;
  eligible: boolean;
  score: number;
  rejections: string[];
  contributions: Record<string, number>;
}

export interface ModelRouteDecision {
  selected?: ModelCapabilityProfile;
  fallback?: ModelCapabilityProfile;
  reason: string;
  candidates: ModelRouteCandidate[];
  constraints: ModelRoutingConstraints;
  evaluatedAt: string;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function privacyThreshold(value: PrivacyClass | undefined): number {
  if (value === "restricted") return 0.9;
  if (value === "internal") return 0.65;
  return 0;
}

function normalizedPenalty(value: number, scale: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(1, value / scale);
}

export function evaluateModelCandidate(
  profile: ModelCapabilityProfile,
  constraints: ModelRoutingConstraints,
  weights: ModelRoutingWeights = DEFAULT_ROUTING_WEIGHTS,
): ModelRouteCandidate {
  const rejections: string[] = [];
  if (!profile.enabled) rejections.push("disabled");
  if (profile.healthState === "unavailable") rejections.push("health_unavailable");
  if (constraints.requiresOffline && !profile.local) rejections.push("offline_required");
  if (constraints.requiresTools && !profile.supportsTools) rejections.push("tool_support_required");
  if (constraints.requiresStructuredOutput && !profile.supportsStructuredOutput) {
    rejections.push("structured_output_required");
  }
  if ((constraints.minimumContextTokens ?? 0) > profile.contextTokens) {
    rejections.push("context_capacity_insufficient");
  }
  if ((constraints.maximumLatencyMs ?? Number.POSITIVE_INFINITY) < profile.latencyMs) {
    rejections.push("latency_limit_exceeded");
  }
  const blendedCost = profile.costPerMillionInput + profile.costPerMillionOutput;
  if (
    (constraints.maximumCostPerMillionTokens ?? Number.POSITIVE_INFINITY) < blendedCost
  ) {
    rejections.push("cost_limit_exceeded");
  }
  if (
    profile.evaluationConfidence < (constraints.minimumEvaluationConfidence ?? 0)
  ) {
    rejections.push("evaluation_confidence_insufficient");
  }
  if (profile.planningQuality < (constraints.minimumPlanningQuality ?? 0)) {
    rejections.push("planning_quality_insufficient");
  }
  if (profile.codeQuality < (constraints.minimumCodeQuality ?? 0)) {
    rejections.push("code_quality_insufficient");
  }
  if (profile.verificationQuality < (constraints.minimumVerificationQuality ?? 0)) {
    rejections.push("verification_quality_insufficient");
  }
  if (profile.privacyScore < privacyThreshold(constraints.requiredPrivacy)) {
    rejections.push("privacy_requirement_not_met");
  }

  const taskClass = constraints.taskClass ?? "general";
  const planningMultiplier = taskClass === "planning" ? 1.5 : 1;
  const codingMultiplier = taskClass === "coding" ? 1.5 : 1;
  const verificationMultiplier = taskClass === "verification" ? 1.8 : 1;
  const toolMultiplier = taskClass === "tool" ? 1.5 : 1;
  const contributions = {
    planningQuality: weights.planningQuality * planningMultiplier * clamp01(profile.planningQuality),
    codeQuality: weights.codeQuality * codingMultiplier * clamp01(profile.codeQuality),
    verificationQuality: weights.verificationQuality * verificationMultiplier * clamp01(profile.verificationQuality),
    structuredOutputReliability:
      weights.structuredOutputReliability * clamp01(profile.structuredOutputReliability),
    toolReliability: weights.toolReliability * toolMultiplier * clamp01(profile.toolReliability),
    availability: weights.availability * clamp01(profile.availability),
    privacy: weights.privacy * clamp01(profile.privacyScore),
    sovereignty: weights.sovereignty * clamp01(profile.sovereigntyScore),
    latencyPenalty: -weights.latencyPenalty * normalizedPenalty(profile.latencyMs, 20_000),
    costPenalty: -weights.costPenalty * normalizedPenalty(blendedCost, 100),
    energyPenalty:
      -weights.energyPenalty * normalizedPenalty(profile.energyWhPerMillionTokens, 2_000),
    failurePenalty: -weights.failurePenalty * clamp01(profile.failureRate),
    degradedHealthPenalty: profile.healthState === "degraded" ? -weights.degradedHealthPenalty : 0,
    preferredProviderBonus:
      constraints.preferredProvider === profile.provider
        ? weights.preferredProviderBonus
        : 0,
    preferredModelBonus:
      constraints.preferredModel === profile.model ? weights.preferredModelBonus : 0,
  };

  const rawScore = Object.values(contributions).reduce((sum, value) => sum + value, 0);
  return {
    profile,
    eligible: rejections.length === 0,
    score: Number(rawScore.toFixed(6)),
    rejections,
    contributions,
  };
}

export function routeModel(
  profiles: readonly ModelCapabilityProfile[],
  constraints: ModelRoutingConstraints,
  weights: ModelRoutingWeights = DEFAULT_ROUTING_WEIGHTS,
  now = new Date(),
): ModelRouteDecision {
  const candidates = profiles
    .map((profile) => evaluateModelCandidate(profile, constraints, weights))
    .sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      if (b.score !== a.score) return b.score - a.score;
      return `${a.profile.provider}:${a.profile.model}`.localeCompare(
        `${b.profile.provider}:${b.profile.model}`,
      );
    });
  const eligible = candidates.filter((candidate) => candidate.eligible);
  const selected = eligible[0]?.profile;
  const fallback = constraints.allowFallback === false ? undefined : eligible[1]?.profile;
  const reason = selected
    ? `Selected ${selected.provider}/${selected.model} from ${eligible.length} eligible candidate(s) using measured capability, reliability, privacy, sovereignty, latency, cost, energy, and failure signals.`
    : `No eligible model satisfied the hard routing constraints. ${candidates.length} candidate(s) were evaluated.`;
  return {
    selected,
    fallback,
    reason,
    candidates,
    constraints: structuredClone(constraints),
    evaluatedAt: now.toISOString(),
  };
}

export function directModelProfile(
  provider: ProviderName,
  model: string,
  options: Partial<ModelCapabilityProfile> = {},
): ModelCapabilityProfile {
  const local = provider === "ollama" || provider === "simulation";
  return {
    id: options.id ?? `direct:${provider}:${model || "default"}`,
    provider,
    model: model || (provider === "simulation" ? "sim-1" : "default"),
    displayName: options.displayName ?? `${provider}/${model || "default"}`,
    enabled: options.enabled ?? true,
    local: options.local ?? local,
    contextTokens: options.contextTokens ?? 32_000,
    supportsTools: options.supportsTools ?? true,
    supportsStructuredOutput: options.supportsStructuredOutput ?? true,
    structuredOutputReliability: options.structuredOutputReliability ?? 0.5,
    toolReliability: options.toolReliability ?? 0.5,
    planningQuality: options.planningQuality ?? 0.5,
    codeQuality: options.codeQuality ?? 0.5,
    verificationQuality: options.verificationQuality ?? 0.5,
    healthState: options.healthState ?? "healthy",
    availability: options.availability ?? 0.5,
    failureRate: options.failureRate ?? 0.1,
    latencyMs: options.latencyMs ?? 5_000,
    costPerMillionInput: options.costPerMillionInput ?? 0,
    costPerMillionOutput: options.costPerMillionOutput ?? 0,
    energyWhPerMillionTokens: options.energyWhPerMillionTokens ?? 0,
    privacyScore: options.privacyScore ?? (local ? 0.95 : 0.5),
    sovereigntyScore: options.sovereigntyScore ?? (local ? 0.95 : 0.35),
    evaluationConfidence: options.evaluationConfidence ?? 0.2,
    license: options.license,
    evaluatedAt: options.evaluatedAt,
    artifactHash: options.artifactHash,
  };
}
