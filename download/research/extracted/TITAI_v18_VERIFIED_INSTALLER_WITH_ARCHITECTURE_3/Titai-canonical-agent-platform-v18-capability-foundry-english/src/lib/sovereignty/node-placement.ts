import type {
  SovereignModelProfile,
  SovereignNodeProfile,
  SovereignTaskRequirements,
} from "./types";
import { evaluateHardwareFeasibility } from "./model-runtime";

export interface NodePlacementCandidate {
  node: SovereignNodeProfile;
  eligible: boolean;
  score: number;
  reasons: string[];
  selectedModelId?: string;
  estimatedEnergyWh?: number;
  contributions: Record<string, number>;
}

export interface NodePlacementDecision {
  selected?: SovereignNodeProfile;
  selectedModelId?: string;
  candidates: NodePlacementCandidate[];
  reason: string;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function placeSovereignTask(options: {
  nodes: readonly SovereignNodeProfile[];
  models: readonly SovereignModelProfile[];
  requirements: SovereignTaskRequirements;
}): NodePlacementDecision {
  const modelMap = new Map(options.models.map((model) => [model.id, model]));
  const candidates = options.nodes.map((node): NodePlacementCandidate => {
    const reasons: string[] = [];
    if (node.health === "unavailable") reasons.push("node_unavailable");
    if (!node.tenantIds.includes(options.requirements.tenantId)) reasons.push("tenant_not_authorized");
    if (options.requirements.requiresOffline && !node.hardware.networkAvailable && node.modelIds.length === 0) {
      reasons.push("offline_node_has_no_model");
    }
    if (options.requirements.dataLocalityNodeId && node.id !== options.requirements.dataLocalityNodeId) {
      reasons.push("data_locality_required_elsewhere");
    }
    if (node.hardware.thermalState === "throttled" && options.requirements.energyPolicy !== "thermal_protection") {
      reasons.push("node_thermally_throttled");
    }
    const feasibleModels = node.modelIds
      .map((id) => modelMap.get(id))
      .filter((model): model is SovereignModelProfile => Boolean(model))
      .map((model) => ({ model, feasibility: evaluateHardwareFeasibility(model, node.hardware) }))
      .filter(({ model, feasibility }) => {
        if (!feasibility.eligible) return false;
        if (options.requirements.requiresOffline && !model.local) return false;
        if (model.contextTokens < options.requirements.requiredContextTokens) return false;
        if (options.requirements.requiresTools && !model.supportsTools) return false;
        return true;
      })
      .sort((a, b) => {
        const qualityA = (a.model.planningQuality + a.model.codeQuality + a.model.verificationQuality) / 3;
        const qualityB = (b.model.planningQuality + b.model.codeQuality + b.model.verificationQuality) / 3;
        if (qualityB !== qualityA) return qualityB - qualityA;
        return a.feasibility.estimatedEnergyWh - b.feasibility.estimatedEnergyWh;
      });
    if (feasibleModels.length === 0) reasons.push("no_feasible_model");
    const best = feasibleModels[0];
    const capabilityFit = best
      ? clamp01((best.model.planningQuality + best.model.codeQuality + best.model.verificationQuality) / 3)
      : 0;
    const dataLocality = options.requirements.dataLocalityNodeId
      ? node.id === options.requirements.dataLocalityNodeId
        ? 1
        : 0
      : 0.75;
    const privacy = node.trustLevel === "root" ? 1 : node.trustLevel === "trusted" ? 0.85 : node.trustLevel === "restricted" ? 0.55 : 0.1;
    const availability = node.health === "healthy" ? 1 : node.health === "degraded" ? 0.45 : 0;
    const energyEfficiency = best ? 1 - Math.min(1, best.feasibility.estimatedEnergyWh / 0.5) : 0;
    const loadPenalty = clamp01(node.currentLoad);
    const transferPenalty = options.requirements.dataLocalityNodeId && node.id !== options.requirements.dataLocalityNodeId ? 0.5 : 0;
    const trustPenalty = 1 - privacy;
    const contributions = {
      capabilityFit: capabilityFit * 0.28,
      dataLocality: dataLocality * 0.2,
      privacy: privacy * 0.16,
      availability: availability * 0.14,
      energyEfficiency: energyEfficiency * 0.12,
      loadPenalty: -loadPenalty * 0.06,
      transferPenalty: -transferPenalty * 0.06,
      trustPenalty: -trustPenalty * 0.08,
    };
    const score = Object.values(contributions).reduce((sum, value) => sum + value, 0);
    return {
      node,
      eligible: reasons.length === 0,
      score: Number(score.toFixed(6)),
      reasons,
      selectedModelId: best?.model.id,
      estimatedEnergyWh: best?.feasibility.estimatedEnergyWh,
      contributions,
    };
  }).sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    return a.node.id.localeCompare(b.node.id);
  });
  const selected = candidates.find((candidate) => candidate.eligible);
  return {
    selected: selected?.node,
    selectedModelId: selected?.selectedModelId,
    candidates,
    reason: selected
      ? `Selected ${selected.node.id} with model ${selected.selectedModelId} after hard feasibility, trust, tenant, locality, load, and energy checks.`
      : "No sovereign node satisfied the hard placement constraints.",
  };
}
