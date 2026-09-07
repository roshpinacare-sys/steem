import { finding, qualificationResult, validateExternalEvidenceEnvelope, type ExternalEvidenceEnvelope, type QualificationResult } from './external-evidence.js';

export interface MultiHostSloQualificationEvidence {
  readonly envelope: ExternalEvidenceEnvelope;
  readonly hostIds: readonly string[];
  readonly durationSeconds: number;
  readonly requestSamples: number;
  readonly p95LatencyMs: number;
  readonly maximumP95LatencyMs: number;
  readonly p99LatencyMs: number;
  readonly maximumP99LatencyMs: number;
  readonly errorRatePercent: number;
  readonly maximumErrorRatePercent: number;
  readonly revocationPropagationP99Ms: number;
  readonly maximumRevocationPropagationP99Ms: number;
  readonly recoveryRtoSeconds: number;
  readonly maximumRecoveryRtoSeconds: number;
  readonly recoveryRpoSeconds: number;
  readonly maximumRecoveryRpoSeconds: number;
  readonly splitBrainObserved: boolean;
  readonly staleAuthorizationObserved: boolean;
}

export function evaluateMultiHostSloQualification(evidence: MultiHostSloQualificationEvidence): QualificationResult<Readonly<Record<string, unknown>>> {
  const findings = validateExternalEvidenceEnvelope(evidence.envelope, 'multi-host-slo-revocation-recovery');
  const hosts = new Set(evidence.hostIds);
  if (hosts.size < 3 || hosts.has('')) findings.push(finding('SLO_HOSTS_INSUFFICIENT', 'At least three distinct hosts are required.'));
  if (!Number.isFinite(evidence.durationSeconds) || evidence.durationSeconds < 3600) findings.push(finding('SLO_DURATION_INSUFFICIENT', 'At least one hour of measured execution is required.'));
  if (!Number.isInteger(evidence.requestSamples) || evidence.requestSamples < 1000) findings.push(finding('SLO_SAMPLES_INSUFFICIENT', 'At least 1000 measured requests are required.'));
  threshold(evidence.p95LatencyMs, evidence.maximumP95LatencyMs, 'SLO_P95_EXCEEDED', findings);
  threshold(evidence.p99LatencyMs, evidence.maximumP99LatencyMs, 'SLO_P99_EXCEEDED', findings);
  threshold(evidence.errorRatePercent, evidence.maximumErrorRatePercent, 'SLO_ERROR_RATE_EXCEEDED', findings);
  threshold(evidence.revocationPropagationP99Ms, evidence.maximumRevocationPropagationP99Ms, 'SLO_REVOCATION_PROPAGATION_EXCEEDED', findings);
  threshold(evidence.recoveryRtoSeconds, evidence.maximumRecoveryRtoSeconds, 'SLO_RECOVERY_RTO_EXCEEDED', findings);
  threshold(evidence.recoveryRpoSeconds, evidence.maximumRecoveryRpoSeconds, 'SLO_RECOVERY_RPO_EXCEEDED', findings);
  if (evidence.splitBrainObserved) findings.push(finding('SLO_SPLIT_BRAIN_OBSERVED', 'Split-brain behavior was observed.'));
  if (evidence.staleAuthorizationObserved) findings.push(finding('SLO_STALE_AUTHORIZATION_OBSERVED', 'A revoked authorization remained usable.'));
  const metrics = { hostCount: hosts.size, durationSeconds: evidence.durationSeconds, requestSamples: evidence.requestSamples, p95LatencyMs: evidence.p95LatencyMs, p99LatencyMs: evidence.p99LatencyMs, errorRatePercent: evidence.errorRatePercent, revocationPropagationP99Ms: evidence.revocationPropagationP99Ms, recoveryRtoSeconds: evidence.recoveryRtoSeconds, recoveryRpoSeconds: evidence.recoveryRpoSeconds };
  return qualificationResult('multi-host-slo-revocation-recovery', metrics, findings, evidence);
}
function threshold(observed: number, maximum: number, code: string, findings: ReturnType<typeof validateExternalEvidenceEnvelope>): void {
  if (!Number.isFinite(observed) || !Number.isFinite(maximum) || observed < 0 || maximum < 0 || observed > maximum) findings.push(finding(code, `${code.replaceAll('_', ' ').toLowerCase()}.`));
}
