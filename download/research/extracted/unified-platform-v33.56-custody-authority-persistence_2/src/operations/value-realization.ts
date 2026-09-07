import { sha256 } from '../contracts/crypto.js';

export interface WorkflowValueBaseline {
  readonly manualSteps: number;
  readonly manualDecisionPoints: number;
  readonly medianMinutes: number;
  readonly errorOpportunities: number;
}
export interface WorkflowValueObservation {
  readonly sampleSize: number;
  readonly operatorSteps: number;
  readonly operatorDecisionPoints: number;
  readonly medianMinutes: number;
  readonly invalidActionsBlocked: number;
  readonly evidenceGapsDetected: number;
  readonly operatorOverrides: number;
  readonly completedRuns: number;
  readonly provenanceRefs: readonly string[];
  readonly measurementKind: 'MEASURED_LOCAL' | 'MODELED';
}
export interface WorkflowValueReport {
  readonly status: 'VALUE_DEMONSTRATED' | 'PROMISING' | 'INSUFFICIENT_EVIDENCE' | 'REGRESSED';
  readonly measurementKind: WorkflowValueObservation['measurementKind'];
  readonly sampleSize: number;
  readonly metrics: {
    readonly stepReductionPercent: number;
    readonly decisionReductionPercent: number;
    readonly timeReductionPercent: number;
    readonly invalidActionsBlockedPerRun: number;
    readonly evidenceGapsDetectedPerRun: number;
    readonly operatorOverrideRatePercent: number;
    readonly completionRatePercent: number;
  };
  readonly benefits: readonly string[];
  readonly cautions: readonly string[];
  readonly provenanceRefs: readonly string[];
  readonly reportDigest: string;
}

export function buildWorkflowValueReport(baseline: WorkflowValueBaseline, observation: WorkflowValueObservation): WorkflowValueReport {
  validateBaseline(baseline); validateObservation(observation);
  const metrics = {
    stepReductionPercent: percentReduction(baseline.manualSteps, observation.operatorSteps),
    decisionReductionPercent: percentReduction(baseline.manualDecisionPoints, observation.operatorDecisionPoints),
    timeReductionPercent: percentReduction(baseline.medianMinutes, observation.medianMinutes),
    invalidActionsBlockedPerRun: ratio(observation.invalidActionsBlocked, observation.sampleSize),
    evidenceGapsDetectedPerRun: ratio(observation.evidenceGapsDetected, observation.sampleSize),
    operatorOverrideRatePercent: percent(observation.operatorOverrides, observation.sampleSize),
    completionRatePercent: percent(observation.completedRuns, observation.sampleSize),
  };
  const benefits: string[] = [];
  if (metrics.stepReductionPercent > 0) benefits.push('operator_steps_reduced');
  if (metrics.decisionReductionPercent > 0) benefits.push('manual_routing_decisions_reduced');
  if (metrics.timeReductionPercent > 0) benefits.push('workflow_time_reduced');
  if (observation.invalidActionsBlocked > 0) benefits.push('invalid_actions_prevented');
  if (observation.evidenceGapsDetected > 0) benefits.push('evidence_gaps_detected_before_promotion');
  const cautions = [
    ...(observation.measurementKind === 'MODELED' ? ['modeled_results_are_not_human_pilot_measurements'] : []),
    ...(observation.sampleSize < 5 ? ['sample_size_below_five'] : []),
    ...(metrics.operatorOverrideRatePercent > 25 ? ['operator_override_rate_above_25_percent'] : []),
    ...(metrics.timeReductionPercent < 0 ? ['workflow_time_regressed'] : []),
    'local_workflow_value_does_not_imply_production_qualification',
  ];
  const status: WorkflowValueReport['status'] = observation.sampleSize < 3 || observation.provenanceRefs.length === 0 ? 'INSUFFICIENT_EVIDENCE'
    : metrics.timeReductionPercent < -2 || metrics.stepReductionPercent < -2 ? 'REGRESSED'
      : observation.measurementKind === 'MEASURED_LOCAL' && metrics.completionRatePercent >= 80 && benefits.length >= 2 ? 'VALUE_DEMONSTRATED'
        : 'PROMISING';
  const material = { status, measurementKind: observation.measurementKind, sampleSize: observation.sampleSize, metrics, benefits: benefits.sort(), cautions: [...new Set(cautions)].sort(), provenanceRefs: [...new Set(observation.provenanceRefs)].sort() };
  return { ...material, reportDigest: sha256(material) };
}
function validateBaseline(value: WorkflowValueBaseline): void {
  if (![value.manualSteps, value.manualDecisionPoints, value.medianMinutes, value.errorOpportunities].every((item) => Number.isFinite(item) && item > 0)) throw new Error('value_baseline_invalid');
}
function validateObservation(value: WorkflowValueObservation): void {
  const nonNegative = [value.sampleSize, value.operatorSteps, value.operatorDecisionPoints, value.medianMinutes, value.invalidActionsBlocked, value.evidenceGapsDetected, value.operatorOverrides, value.completedRuns];
  if (!nonNegative.every((item) => Number.isFinite(item) && item >= 0) || !Number.isInteger(value.sampleSize) || value.sampleSize < 1) throw new Error('value_observation_invalid');
  if (value.completedRuns > value.sampleSize || value.operatorOverrides > value.sampleSize) throw new Error('value_observation_counts_invalid');
  if (value.provenanceRefs.some((ref) => ref.trim() === '')) throw new Error('value_provenance_invalid');
}
function percentReduction(baseline: number, current: number): number { return Number((((baseline - current) / baseline) * 100).toFixed(2)); }
function percent(numerator: number, denominator: number): number { return denominator === 0 ? 0 : Number(((numerator / denominator) * 100).toFixed(2)); }
function ratio(numerator: number, denominator: number): number { return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(3)); }
