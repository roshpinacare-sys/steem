import { sha256 } from '../contracts/crypto.js';

export type FrontierDimensionV32_14 =
  | 'LONG_HORIZON_EXECUTION'
  | 'CONTEXT_ENGINEERING'
  | 'CODING_AND_REPAIR'
  | 'TOOL_COORDINATION'
  | 'MULTIMODAL_UNDERSTANDING'
  | 'BINARY_ARTIFACT_INTELLIGENCE'
  | 'FORMAL_ASSURANCE'
  | 'ADVERSARIAL_FALSE_PASS_RESISTANCE'
  | 'INDEPENDENT_VERIFICATION'
  | 'SOVEREIGN_OPERATION'
  | 'COST_EFFICIENCY'
  | 'REPRODUCIBLE_RELEASE'
  | 'EXTERNAL_PRODUCTION_QUALIFICATION';

export interface FrontierCapabilityEvidenceV32_14 {
  readonly dimension: FrontierDimensionV32_14;
  readonly score: number;
  readonly evidenceClass: 'OBSERVED_CURRENT_EXECUTION' | 'OBSERVED_EXTERNAL' | 'OFFICIAL_PROVIDER_CLAIM' | 'SYNTHETIC' | 'STATIC';
  readonly evidenceRef: string;
  readonly artifactDigest: string;
  readonly limitations: readonly string[];
}

export interface FrontierSystemProfileV32_14 {
  readonly systemId: string;
  readonly profileVersion: string;
  readonly evidence: readonly FrontierCapabilityEvidenceV32_14[];
}

export interface FrontierComparativeRequirementV32_14 {
  readonly dimension: FrontierDimensionV32_14;
  readonly minimumScore: number;
  readonly requiredEvidenceClasses: readonly FrontierCapabilityEvidenceV32_14['evidenceClass'][];
  readonly weight: number;
  readonly critical: boolean;
}

export interface FrontierDimensionResultV32_14 {
  readonly dimension: FrontierDimensionV32_14;
  readonly score: number;
  readonly threshold: number;
  readonly status: 'PASS' | 'FAIL' | 'UNPROVEN';
  readonly evidenceClass: FrontierCapabilityEvidenceV32_14['evidenceClass'] | 'NONE';
  readonly evidenceRef?: string;
  readonly reasons: readonly string[];
}

export interface FrontierComparativeReportV32_14 {
  readonly schemaVersion: '32.14';
  readonly systemId: string;
  readonly status: 'FRONTIER_CANDIDATE' | 'STRONG_BUT_UNQUALIFIED' | 'NOT_FRONTIER';
  readonly weightedScore: number;
  readonly criticalPassed: number;
  readonly criticalTotal: number;
  readonly dimensions: readonly FrontierDimensionResultV32_14[];
  readonly uniqueStrengths: readonly FrontierDimensionV32_14[];
  readonly blockingGaps: readonly FrontierDimensionV32_14[];
  readonly honestClaim: string;
  readonly reportDigest: string;
}

export function evaluateFrontierSystemV32_14(
  profile: FrontierSystemProfileV32_14,
  requirements: readonly FrontierComparativeRequirementV32_14[],
): FrontierComparativeReportV32_14 {
  validateProfile(profile);
  validateRequirements(requirements);
  const dimensions = requirements.map((requirement): FrontierDimensionResultV32_14 => {
    const candidates = profile.evidence.filter((item) => item.dimension === requirement.dimension).sort(compareEvidence);
    const best = candidates[0];
    if (best === undefined) return { dimension: requirement.dimension, score: 0, threshold: requirement.minimumScore, status: 'UNPROVEN', evidenceClass: 'NONE', reasons: ['evidence-missing'] };
    const classAllowed = requirement.requiredEvidenceClasses.includes(best.evidenceClass);
    const reasons: string[] = [];
    if (!classAllowed) reasons.push(`evidence-class-insufficient:${best.evidenceClass}`);
    if (best.score < requirement.minimumScore) reasons.push('score-below-threshold');
    const status = !classAllowed ? 'UNPROVEN' : best.score >= requirement.minimumScore ? 'PASS' : 'FAIL';
    return { dimension: requirement.dimension, score: best.score, threshold: requirement.minimumScore, status, evidenceClass: best.evidenceClass, evidenceRef: best.evidenceRef, reasons };
  });
  const totalWeight = requirements.reduce((sum, item) => sum + item.weight, 0);
  const weighted = dimensions.reduce((sum, result) => {
    const requirement = requirements.find((item) => item.dimension === result.dimension);
    if (requirement === undefined) throw new Error('frontier_requirement_internal_missing');
    return sum + Math.min(result.score / requirement.minimumScore, 1) * requirement.weight * (result.status === 'UNPROVEN' ? 0 : 1);
  }, 0);
  const weightedScore = Number((100 * weighted / totalWeight).toFixed(4));
  const critical = requirements.filter((item) => item.critical);
  const criticalPassed = critical.filter((item) => dimensions.find((result) => result.dimension === item.dimension)?.status === 'PASS').length;
  const blockingGaps = critical.filter((item) => dimensions.find((result) => result.dimension === item.dimension)?.status !== 'PASS').map((item) => item.dimension);
  const uniqueStrengths = dimensions.filter((item) => item.status === 'PASS' && ['BINARY_ARTIFACT_INTELLIGENCE', 'FORMAL_ASSURANCE', 'ADVERSARIAL_FALSE_PASS_RESISTANCE', 'INDEPENDENT_VERIFICATION', 'SOVEREIGN_OPERATION', 'REPRODUCIBLE_RELEASE'].includes(item.dimension)).map((item) => item.dimension);
  const status: FrontierComparativeReportV32_14['status'] = blockingGaps.length === 0 && weightedScore >= 90 ? 'FRONTIER_CANDIDATE' : weightedScore >= 60 ? 'STRONG_BUT_UNQUALIFIED' : 'NOT_FRONTIER';
  const honestClaim = status === 'FRONTIER_CANDIDATE'
    ? 'Frontier candidate under the supplied evidence-backed requirements; no universal best-in-world claim is implied.'
    : status === 'STRONG_BUT_UNQUALIFIED'
      ? 'Strong evidence-backed platform with unresolved critical qualification or comparative gaps; best-in-world is not proven.'
      : 'The supplied evidence does not support a frontier-system claim.';
  const material = { schemaVersion: '32.14' as const, systemId: profile.systemId, status, weightedScore, criticalPassed, criticalTotal: critical.length, dimensions, uniqueStrengths, blockingGaps, honestClaim };
  return { ...material, reportDigest: sha256(material) };
}

export function defaultFrontierRequirementsV32_14(): readonly FrontierComparativeRequirementV32_14[] {
  const observed = ['OBSERVED_CURRENT_EXECUTION', 'OBSERVED_EXTERNAL'] as const;
  return [
    req('LONG_HORIZON_EXECUTION', 0.85, [...observed], 9, true),
    req('CONTEXT_ENGINEERING', 0.85, [...observed], 8, true),
    req('CODING_AND_REPAIR', 0.85, [...observed], 9, true),
    req('TOOL_COORDINATION', 0.85, [...observed], 8, true),
    req('MULTIMODAL_UNDERSTANDING', 0.80, ['OBSERVED_EXTERNAL'], 6, false),
    req('BINARY_ARTIFACT_INTELLIGENCE', 0.85, [...observed], 8, true),
    req('FORMAL_ASSURANCE', 0.85, [...observed], 8, true),
    req('ADVERSARIAL_FALSE_PASS_RESISTANCE', 0.90, [...observed], 10, true),
    req('INDEPENDENT_VERIFICATION', 0.90, ['OBSERVED_EXTERNAL'], 9, true),
    req('SOVEREIGN_OPERATION', 0.90, ['OBSERVED_EXTERNAL'], 8, true),
    req('COST_EFFICIENCY', 0.80, ['OBSERVED_EXTERNAL'], 6, false),
    req('REPRODUCIBLE_RELEASE', 0.95, [...observed], 6, true),
    req('EXTERNAL_PRODUCTION_QUALIFICATION', 0.95, ['OBSERVED_EXTERNAL'], 5, true),
  ];
}

function req(dimension: FrontierDimensionV32_14, minimumScore: number, requiredEvidenceClasses: readonly FrontierCapabilityEvidenceV32_14['evidenceClass'][], weight: number, critical: boolean): FrontierComparativeRequirementV32_14 { return { dimension, minimumScore, requiredEvidenceClasses, weight, critical }; }
function compareEvidence(left: FrontierCapabilityEvidenceV32_14, right: FrontierCapabilityEvidenceV32_14): number {
  const rank = { OBSERVED_EXTERNAL: 5, OBSERVED_CURRENT_EXECUTION: 4, SYNTHETIC: 3, STATIC: 2, OFFICIAL_PROVIDER_CLAIM: 1 } as const;
  return rank[right.evidenceClass] - rank[left.evidenceClass] || right.score - left.score || left.evidenceRef.localeCompare(right.evidenceRef);
}
function validateProfile(profile: FrontierSystemProfileV32_14): void {
  if (profile.systemId.trim() === '' || profile.profileVersion.trim() === '') throw new Error('frontier_profile_identity_invalid');
  for (const item of profile.evidence) {
    if (!Number.isFinite(item.score) || item.score < 0 || item.score > 1) throw new Error('frontier_profile_score_invalid');
    if (item.evidenceRef.trim() === '' || !/^[a-f0-9]{64}$/.test(item.artifactDigest)) throw new Error('frontier_profile_evidence_invalid');
  }
}
function validateRequirements(requirements: readonly FrontierComparativeRequirementV32_14[]): void {
  if (requirements.length === 0 || new Set(requirements.map((item) => item.dimension)).size !== requirements.length) throw new Error('frontier_requirements_invalid');
  for (const item of requirements) {
    if (!Number.isFinite(item.minimumScore) || item.minimumScore <= 0 || item.minimumScore > 1) throw new Error('frontier_requirement_score_invalid');
    if (!Number.isSafeInteger(item.weight) || item.weight < 1) throw new Error('frontier_requirement_weight_invalid');
    if (item.requiredEvidenceClasses.length === 0 || new Set(item.requiredEvidenceClasses).size !== item.requiredEvidenceClasses.length) throw new Error('frontier_requirement_evidence_classes_invalid');
  }
}
