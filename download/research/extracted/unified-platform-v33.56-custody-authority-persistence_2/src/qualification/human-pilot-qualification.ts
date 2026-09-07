import { finding, qualificationResult, round, validateExternalEvidenceEnvelope, validInstant, type ExternalEvidenceEnvelope, type QualificationResult } from './external-evidence.js';

export interface HumanPilotOutcome {
  readonly participantId: string;
  readonly consented: boolean;
  readonly synthetic: boolean;
  readonly group: 'BASELINE' | 'ASSISTED';
  readonly taskId: string;
  readonly successful: boolean;
  readonly durationSeconds: number;
  readonly criticalErrors: number;
}
export interface HumanPilotQualificationEvidence {
  readonly envelope: ExternalEvidenceEnvelope;
  readonly protocolRegisteredAt: string;
  readonly pilotStartedAt: string;
  readonly minimumParticipants: number;
  readonly minimumSuccessRateImprovementPoints: number;
  readonly minimumMedianTimeReductionPercent: number;
  readonly maximumAssistedCriticalErrorRate: number;
  readonly outcomes: readonly HumanPilotOutcome[];
}

export function evaluateHumanPilotQualification(evidence: HumanPilotQualificationEvidence): QualificationResult<Readonly<Record<string, unknown>>> {
  const findings = validateExternalEvidenceEnvelope(evidence.envelope, 'consented-comparative-human-pilot');
  if (!validInstant(evidence.protocolRegisteredAt) || !validInstant(evidence.pilotStartedAt) || Date.parse(evidence.protocolRegisteredAt) >= Date.parse(evidence.pilotStartedAt)) findings.push(finding('PILOT_PROTOCOL_NOT_PREREGISTERED', 'Pilot protocol and thresholds must be registered before the pilot starts.'));
  const participants = new Set(evidence.outcomes.map((row) => row.participantId));
  if (!Number.isInteger(evidence.minimumParticipants) || evidence.minimumParticipants < 5 || participants.size < evidence.minimumParticipants) findings.push(finding('PILOT_PARTICIPANTS_INSUFFICIENT', 'At least five distinct participants are required.'));
  if (evidence.outcomes.length === 0 || evidence.outcomes.some((row) => !row.consented)) findings.push(finding('PILOT_CONSENT_MISSING', 'Every participant must provide consent.'));
  if (evidence.outcomes.some((row) => row.synthetic)) findings.push(finding('PILOT_SYNTHETIC_OUTCOME_FORBIDDEN', 'Synthetic outcomes cannot qualify human value.'));
  if (evidence.outcomes.some((row) => row.participantId.trim() === '' || row.taskId.trim() === '' || !Number.isFinite(row.durationSeconds) || row.durationSeconds <= 0 || !Number.isInteger(row.criticalErrors) || row.criticalErrors < 0)) findings.push(finding('PILOT_OUTCOME_INVALID', 'Pilot outcomes contain invalid fields.'));
  const baseline = evidence.outcomes.filter((row) => row.group === 'BASELINE');
  const assisted = evidence.outcomes.filter((row) => row.group === 'ASSISTED');
  if (baseline.length === 0 || assisted.length === 0) findings.push(finding('PILOT_COMPARISON_GROUP_MISSING', 'Both baseline and assisted outcomes are required.'));
  const baselineSuccess = rate(baseline.filter((row) => row.successful).length, baseline.length);
  const assistedSuccess = rate(assisted.filter((row) => row.successful).length, assisted.length);
  const successImprovement = assistedSuccess - baselineSuccess;
  const baselineMedian = median(baseline.map((row) => row.durationSeconds));
  const assistedMedian = median(assisted.map((row) => row.durationSeconds));
  const timeReduction = baselineMedian === 0 ? 0 : ((baselineMedian - assistedMedian) / baselineMedian) * 100;
  const assistedErrorRate = rate(assisted.reduce((sum, row) => sum + row.criticalErrors, 0), assisted.length);
  if (successImprovement < evidence.minimumSuccessRateImprovementPoints) findings.push(finding('PILOT_SUCCESS_THRESHOLD_NOT_MET', 'Success-rate improvement threshold was not met.'));
  if (timeReduction < evidence.minimumMedianTimeReductionPercent) findings.push(finding('PILOT_TIME_THRESHOLD_NOT_MET', 'Median time reduction threshold was not met.'));
  if (assistedErrorRate > evidence.maximumAssistedCriticalErrorRate) findings.push(finding('PILOT_ERROR_THRESHOLD_EXCEEDED', 'Assisted critical-error threshold was exceeded.'));
  const metrics = { participants: participants.size, baselineOutcomes: baseline.length, assistedOutcomes: assisted.length, baselineSuccessRate: round(baselineSuccess), assistedSuccessRate: round(assistedSuccess), successImprovementPoints: round(successImprovement), medianTimeReductionPercent: round(timeReduction), assistedCriticalErrorRate: round(assistedErrorRate) };
  return qualificationResult('consented-comparative-human-pilot', metrics, findings, evidence);
}
function rate(numerator: number, denominator: number): number { return denominator === 0 ? 0 : (numerator / denominator) * 100; }
function median(values: readonly number[]): number { if (values.length === 0) return 0; const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : sorted[middle] ?? 0; }
