import { sha256 } from '../contracts/crypto.js';
import type { RequirementCriticality } from '../contracts/system.js';

export type MeasurementClass = 'OBSERVED' | 'COMPUTED' | 'SIMULATED';

export interface MeasurementEvidence {
  readonly measurementId: string;
  readonly requirementId: string;
  readonly evidenceClass: MeasurementClass;
  readonly estimate: number;
  readonly lowerBound: number;
  readonly upperBound: number;
  readonly unit: string;
  readonly sampleCount: number;
  readonly method: string;
  readonly evidenceRef: string;
}

export interface UncertaintyRequirement {
  readonly requirementId: string;
  readonly criticality: RequirementCriticality;
  readonly toleranceMin: number;
  readonly toleranceMax: number;
  readonly minimumSamples: number;
  readonly allowedEvidenceClasses: readonly MeasurementClass[];
}

export interface UncertaintyDecision {
  readonly decision: 'PASS' | 'SIMULATION_PASS' | 'INCONCLUSIVE' | 'FAIL';
  readonly requirementId: string;
  readonly marginToLower: number;
  readonly marginToUpper: number;
  readonly reasons: readonly string[];
  readonly evidenceDigest: string;
  readonly decisionDigest: string;
}

/** Yongzuan/SRS-derived measurement and scientific-honesty gate. */
export function evaluateUncertainty(requirement: UncertaintyRequirement, evidence: MeasurementEvidence): UncertaintyDecision {
  validateRequirement(requirement);
  validateEvidence(evidence);
  if (requirement.requirementId !== evidence.requirementId) throw new Error('uncertainty_requirement_mismatch');
  const reasons: string[] = [];
  if (!requirement.allowedEvidenceClasses.includes(evidence.evidenceClass)) reasons.push('EVIDENCE_CLASS_NOT_ALLOWED');
  if (evidence.sampleCount < requirement.minimumSamples) reasons.push('INSUFFICIENT_SAMPLES');
  if (evidence.lowerBound < requirement.toleranceMin || evidence.upperBound > requirement.toleranceMax) reasons.push('UNCERTAINTY_INTERVAL_OUTSIDE_TOLERANCE');
  if (requirement.criticality === 'SAFETY_CRITICAL' && evidence.evidenceClass === 'SIMULATED') reasons.push('SAFETY_CRITICAL_SIMULATION_ONLY');
  if (evidence.estimate < evidence.lowerBound || evidence.estimate > evidence.upperBound) reasons.push('ESTIMATE_OUTSIDE_INTERVAL');

  const hardFailure = reasons.includes('UNCERTAINTY_INTERVAL_OUTSIDE_TOLERANCE') || reasons.includes('ESTIMATE_OUTSIDE_INTERVAL');
  const inconclusive = reasons.length > 0 && !hardFailure;
  const decisionValue: UncertaintyDecision['decision'] = hardFailure ? 'FAIL'
    : inconclusive ? 'INCONCLUSIVE'
      : evidence.evidenceClass === 'SIMULATED' ? 'SIMULATION_PASS'
        : 'PASS';
  const evidenceDigest = sha256(evidence);
  const material = {
    decision: decisionValue,
    requirementId: requirement.requirementId,
    marginToLower: normalizeNumber(evidence.lowerBound - requirement.toleranceMin),
    marginToUpper: normalizeNumber(requirement.toleranceMax - evidence.upperBound),
    reasons: [...reasons].sort(),
    evidenceDigest,
  };
  return { ...material, decisionDigest: sha256(material) };
}

function validateRequirement(requirement: UncertaintyRequirement): void {
  if (requirement.requirementId.trim() === '') throw new Error('uncertainty_requirement_id_required');
  if (!Number.isFinite(requirement.toleranceMin) || !Number.isFinite(requirement.toleranceMax) || requirement.toleranceMin >= requirement.toleranceMax) throw new Error('uncertainty_tolerance_invalid');
  if (!Number.isSafeInteger(requirement.minimumSamples) || requirement.minimumSamples < 1) throw new Error('uncertainty_sample_floor_invalid');
  if (requirement.allowedEvidenceClasses.length === 0) throw new Error('uncertainty_evidence_class_required');
}

function validateEvidence(evidence: MeasurementEvidence): void {
  if (evidence.measurementId.trim() === '' || evidence.requirementId.trim() === '' || evidence.unit.trim() === '' || evidence.method.trim() === '' || evidence.evidenceRef.trim() === '') throw new Error('measurement_identity_invalid');
  if (![evidence.estimate, evidence.lowerBound, evidence.upperBound].every(Number.isFinite) || evidence.lowerBound > evidence.upperBound) throw new Error('measurement_interval_invalid');
  if (!Number.isSafeInteger(evidence.sampleCount) || evidence.sampleCount < 1) throw new Error('measurement_sample_count_invalid');
}

function normalizeNumber(value: number): number { return Number(value.toFixed(12)); }
