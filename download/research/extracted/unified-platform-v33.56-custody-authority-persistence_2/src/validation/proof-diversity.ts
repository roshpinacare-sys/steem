import { sha256 } from '../contracts/crypto.js';

export type ProofTechnique =
  | 'unit'
  | 'contract'
  | 'property'
  | 'model'
  | 'mutation'
  | 'integration'
  | 'e2e'
  | 'concurrency'
  | 'fault-injection'
  | 'recovery'
  | 'security'
  | 'external';

export type ProofCriticality = 'normal' | 'high' | 'critical';

export interface ProofObservation {
  readonly proofId: string;
  readonly claimIds: readonly string[];
  readonly technique: ProofTechnique;
  readonly oracleId: string;
  readonly environmentId: string;
  readonly evidenceRef: string;
  readonly defectClasses: readonly string[];
  readonly current: boolean;
  readonly authentic: boolean;
  readonly complete: boolean;
  readonly observed: boolean;
}

export interface ProofRequirement {
  readonly claimId: string;
  readonly criticality: ProofCriticality;
  readonly requiredTechniques: readonly ProofTechnique[];
  readonly requiredDefectClasses: readonly string[];
  readonly minimumIndependentOracles: number;
  readonly minimumEnvironments: number;
  readonly requireObserved: boolean;
}

export interface ProofDiversityReport {
  readonly status: 'PASS' | 'BLOCK';
  readonly metrics: {
    readonly claims: number;
    readonly closedClaims: number;
    readonly proofs: number;
    readonly validProofs: number;
    readonly distinctTechniques: number;
    readonly independentOracles: number;
    readonly environments: number;
    readonly concentrationFindings: number;
  };
  readonly results: readonly {
    readonly claimId: string;
    readonly status: 'CLOSED' | 'OPEN';
    readonly score: number;
    readonly techniques: readonly ProofTechnique[];
    readonly oracles: readonly string[];
    readonly environments: readonly string[];
    readonly missingTechniques: readonly ProofTechnique[];
    readonly missingDefectClasses: readonly string[];
    readonly reasons: readonly string[];
  }[];
  readonly findings: readonly string[];
  readonly reportDigest: string;
}

const FLOORS: Readonly<Record<ProofCriticality, { techniques: number; oracles: number; environments: number }>> = {
  normal: { techniques: 3, oracles: 1, environments: 1 },
  high: { techniques: 4, oracles: 2, environments: 1 },
  critical: { techniques: 6, oracles: 2, environments: 2 },
};

/**
 * Measures diversity and independence of proof. It intentionally rejects a large
 * number of near-identical tests as a substitute for different failure oracles.
 */
export function evaluateProofDiversity(
  requirements: readonly ProofRequirement[],
  observations: readonly ProofObservation[],
): ProofDiversityReport {
  const requirementMap = new Map<string, ProofRequirement>();
  for (const raw of requirements) {
    const row = normalizeRequirement(raw);
    if (requirementMap.has(row.claimId)) throw new Error(`proof_requirement_duplicate:${row.claimId}`);
    requirementMap.set(row.claimId, row);
  }

  const observationMap = new Map<string, ProofObservation>();
  const findings: string[] = [];
  for (const raw of observations) {
    const row = normalizeObservation(raw);
    if (observationMap.has(row.proofId)) throw new Error(`proof_observation_duplicate:${row.proofId}`);
    observationMap.set(row.proofId, row);
    for (const claimId of row.claimIds) {
      if (!requirementMap.has(claimId)) findings.push(`proof_claim_unknown:${row.proofId}:${claimId}`);
    }
  }

  const valid = [...observationMap.values()].filter((row) => row.current && row.authentic && row.complete);
  const evidenceUse = new Map<string, Set<string>>();
  for (const row of valid) {
    const claims = evidenceUse.get(row.evidenceRef) ?? new Set<string>();
    row.claimIds.forEach((claimId) => claims.add(claimId));
    evidenceUse.set(row.evidenceRef, claims);
  }
  for (const [evidenceRef, claims] of evidenceUse) {
    if (claims.size > 3) findings.push(`proof_evidence_concentration:${evidenceRef}:${claims.size}`);
  }

  const results = [...requirementMap.values()].sort((a, b) => a.claimId.localeCompare(b.claimId)).map((requirement) => {
    const rows = valid.filter((row) => row.claimIds.includes(requirement.claimId));
    const techniques = sortedUnique(rows.map((row) => row.technique)) as ProofTechnique[];
    const oracles = sortedUnique(rows.map((row) => row.oracleId));
    const environments = sortedUnique(rows.map((row) => row.environmentId));
    const defectClasses = new Set(rows.flatMap((row) => row.defectClasses));
    const missingTechniques = requirement.requiredTechniques.filter((value) => !techniques.includes(value));
    const missingDefectClasses = requirement.requiredDefectClasses.filter((value) => !defectClasses.has(value));
    const floor = FLOORS[requirement.criticality];
    const requiredOracleCount = Math.max(floor.oracles, requirement.minimumIndependentOracles);
    const requiredEnvironmentCount = Math.max(floor.environments, requirement.minimumEnvironments);
    const reasons: string[] = [];
    if (techniques.length < floor.techniques) reasons.push(`technique_floor:${techniques.length}/${floor.techniques}`);
    if (missingTechniques.length > 0) reasons.push(`required_techniques_missing:${missingTechniques.join(',')}`);
    if (oracles.length < requiredOracleCount) reasons.push(`independent_oracle_floor:${oracles.length}/${requiredOracleCount}`);
    if (environments.length < requiredEnvironmentCount) reasons.push(`environment_floor:${environments.length}/${requiredEnvironmentCount}`);
    if (missingDefectClasses.length > 0) reasons.push(`defect_classes_missing:${missingDefectClasses.join(',')}`);
    if (requirement.requireObserved && !rows.some((row) => row.observed)) reasons.push('observed_proof_missing');
    if (rows.length === 0) reasons.push('proof_missing');

    const techniqueScore = ratioScore(techniques.length, Math.max(floor.techniques, requirement.requiredTechniques.length));
    const oracleScore = ratioScore(oracles.length, requiredOracleCount);
    const environmentScore = ratioScore(environments.length, requiredEnvironmentCount);
    const defectScore = requirement.requiredDefectClasses.length === 0
      ? 100
      : ratioScore(requirement.requiredDefectClasses.length - missingDefectClasses.length, requirement.requiredDefectClasses.length);
    const observedScore = !requirement.requireObserved || rows.some((row) => row.observed) ? 100 : 0;
    const score = Number((techniqueScore * 0.35 + oracleScore * 0.2 + environmentScore * 0.15 + defectScore * 0.2 + observedScore * 0.1).toFixed(2));
    return {
      claimId: requirement.claimId,
      status: reasons.length === 0 ? 'CLOSED' as const : 'OPEN' as const,
      score,
      techniques,
      oracles,
      environments,
      missingTechniques,
      missingDefectClasses,
      reasons: reasons.sort(),
    };
  });

  const material = {
    status: results.every((row) => row.status === 'CLOSED') && findings.length === 0 ? 'PASS' as const : 'BLOCK' as const,
    metrics: {
      claims: requirements.length,
      closedClaims: results.filter((row) => row.status === 'CLOSED').length,
      proofs: observations.length,
      validProofs: valid.length,
      distinctTechniques: new Set(valid.map((row) => row.technique)).size,
      independentOracles: new Set(valid.map((row) => row.oracleId)).size,
      environments: new Set(valid.map((row) => row.environmentId)).size,
      concentrationFindings: findings.filter((value) => value.startsWith('proof_evidence_concentration:')).length,
    },
    results,
    findings: [...new Set(findings)].sort(),
  };
  return { ...material, reportDigest: sha256(material) };
}

function normalizeRequirement(row: ProofRequirement): ProofRequirement {
  if (row.claimId.trim() === '') throw new Error('proof_requirement_identity_invalid');
  if (!Number.isSafeInteger(row.minimumIndependentOracles) || row.minimumIndependentOracles < 1) throw new Error(`proof_oracle_floor_invalid:${row.claimId}`);
  if (!Number.isSafeInteger(row.minimumEnvironments) || row.minimumEnvironments < 1) throw new Error(`proof_environment_floor_invalid:${row.claimId}`);
  return {
    ...row,
    claimId: row.claimId.trim(),
    requiredTechniques: unique(row.requiredTechniques),
    requiredDefectClasses: sortedUnique(row.requiredDefectClasses),
  };
}

function normalizeObservation(row: ProofObservation): ProofObservation {
  if (row.proofId.trim() === '' || row.oracleId.trim() === '' || row.environmentId.trim() === '' || row.evidenceRef.trim() === '') throw new Error('proof_observation_identity_invalid');
  const claimIds = sortedUnique(row.claimIds);
  if (claimIds.length === 0) throw new Error(`proof_claims_required:${row.proofId}`);
  return { ...row, proofId: row.proofId.trim(), claimIds, oracleId: row.oracleId.trim(), environmentId: row.environmentId.trim(), evidenceRef: row.evidenceRef.trim(), defectClasses: sortedUnique(row.defectClasses) };
}

function ratioScore(value: number, target: number): number { return Math.min(100, Number(((value / Math.max(1, target)) * 100).toFixed(2))); }
function sortedUnique(values: readonly string[]): string[] { return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort(); }
function unique<T>(values: readonly T[]): T[] { return [...new Set(values)]; }
