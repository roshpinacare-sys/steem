import { sha256 } from '../contracts/crypto.js';

export interface ValueHypothesis {
  readonly hypothesisId: string;
  readonly capabilityId: string;
  readonly operatorProblem: string;
  readonly baselineMetric: string;
  readonly targetDirection: 'increase' | 'decrease';
  readonly targetValue: number;
  readonly measurementProtocolRef: string;
  readonly minimumHumanParticipants: number;
  readonly minimumRuns: number;
  readonly evidenceState: 'MODELED' | 'MEASURED_LOCAL' | 'MEASURED_HUMAN';
  readonly participants: number;
  readonly runs: number;
  readonly observedValue?: number | undefined;
  readonly provenanceRefs: readonly string[];
}
export interface ValueHypothesisReport {
  readonly status: 'READY_FOR_PILOT' | 'VALUE_DEMONSTRATED' | 'INSUFFICIENT' | 'REGRESSED';
  readonly metrics: { readonly hypotheses: number; readonly protocolReady: number; readonly humanMeasured: number; readonly demonstrated: number; readonly regressed: number };
  readonly results: readonly { readonly hypothesisId: string; readonly capabilityId: string; readonly status: 'PROTOCOL_READY' | 'INSUFFICIENT' | 'DEMONSTRATED' | 'REGRESSED'; readonly claimAllowed: boolean; readonly reasons: readonly string[] }[];
  readonly forbiddenClaims: readonly string[];
  readonly reportDigest: string;
}
export function evaluateValueHypotheses(hypotheses: readonly ValueHypothesis[]): ValueHypothesisReport {
  const ids = new Set<string>();
  const results = hypotheses.map((item) => {
    if (item.hypothesisId.trim() === '' || item.capabilityId.trim() === '' || item.operatorProblem.trim() === '' || item.baselineMetric.trim() === '' || item.measurementProtocolRef.trim() === '' || ids.has(item.hypothesisId)) throw new Error('value_hypothesis_identity_invalid');
    ids.add(item.hypothesisId);
    if (!Number.isFinite(item.targetValue) || !Number.isInteger(item.minimumHumanParticipants) || item.minimumHumanParticipants < 1 || !Number.isInteger(item.minimumRuns) || item.minimumRuns < 1 || !Number.isInteger(item.participants) || item.participants < 0 || !Number.isInteger(item.runs) || item.runs < 0) throw new Error('value_hypothesis_measurement_invalid');
    if (item.provenanceRefs.some((ref) => ref.trim() === '')) throw new Error('value_hypothesis_provenance_invalid');
    const reasons: string[] = [];
    if (item.evidenceState !== 'MEASURED_HUMAN') reasons.push('human_measurement_not_completed');
    if (item.participants < item.minimumHumanParticipants) reasons.push('participant_minimum_not_met');
    if (item.runs < item.minimumRuns) reasons.push('run_minimum_not_met');
    if (item.observedValue === undefined || !Number.isFinite(item.observedValue)) reasons.push('observed_value_missing');
    if (item.provenanceRefs.length === 0) reasons.push('provenance_missing');
    const enough = reasons.length === 0;
    const met = enough && (item.targetDirection === 'increase' ? item.observedValue! >= item.targetValue : item.observedValue! <= item.targetValue);
    const regressed = enough && !met;
    const status = met ? 'DEMONSTRATED' as const : regressed ? 'REGRESSED' as const : item.measurementProtocolRef.trim() !== '' ? 'PROTOCOL_READY' as const : 'INSUFFICIENT' as const;
    return { hypothesisId: item.hypothesisId, capabilityId: item.capabilityId, status, claimAllowed: met, reasons: met ? [] : reasons.length > 0 ? reasons : ['target_not_met'] };
  });
  const metrics = { hypotheses: hypotheses.length, protocolReady: results.filter((item) => item.status === 'PROTOCOL_READY').length, humanMeasured: hypotheses.filter((item) => item.evidenceState === 'MEASURED_HUMAN').length, demonstrated: results.filter((item) => item.status === 'DEMONSTRATED').length, regressed: results.filter((item) => item.status === 'REGRESSED').length };
  const status: ValueHypothesisReport['status'] = metrics.regressed > 0 ? 'REGRESSED' : metrics.demonstrated === hypotheses.length && hypotheses.length > 0 ? 'VALUE_DEMONSTRATED' : metrics.protocolReady > 0 ? 'READY_FOR_PILOT' : 'INSUFFICIENT';
  const forbiddenClaims = results.filter((item) => !item.claimAllowed).map((item) => `value_claim_forbidden:${item.hypothesisId}`).sort();
  const material = { status, metrics, results, forbiddenClaims };
  return { ...material, reportDigest: sha256(material) };
}
