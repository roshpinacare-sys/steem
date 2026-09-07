import { sha256 } from '../contracts/crypto.js';

export type EvidenceClass = 'OBSERVED' | 'COMPUTED' | 'SIMULATED';
export type QualificationStatus = 'PASS' | 'BLOCK';

export interface ExternalEvidenceEnvelope {
  readonly evidenceId: string;
  readonly gateId: string;
  readonly sourceDigest: string;
  readonly artifactDigest: string;
  readonly producedAt: string;
  readonly environmentId: string;
  readonly collectorId: string;
  readonly independentReviewerId: string;
  readonly evidenceClass: EvidenceClass;
  readonly signature: {
    readonly keyId: string;
    readonly algorithm: string;
    readonly verified: boolean;
  };
}

export interface QualificationFinding {
  readonly code: string;
  readonly message: string;
}

export interface QualificationResult<TMetrics extends Readonly<Record<string, unknown>>> {
  readonly gateId: string;
  readonly status: QualificationStatus;
  readonly metrics: TMetrics;
  readonly findings: readonly QualificationFinding[];
  readonly evidenceDigest: string;
}

export function validateExternalEvidenceEnvelope(envelope: ExternalEvidenceEnvelope, expectedGateId: string): QualificationFinding[] {
  const findings: QualificationFinding[] = [];
  required(envelope.evidenceId, 'EVIDENCE_ID_REQUIRED', findings);
  if (envelope.gateId !== expectedGateId) findings.push(finding('EVIDENCE_GATE_MISMATCH', `Expected ${expectedGateId}.`));
  if (!hexDigest(envelope.sourceDigest)) findings.push(finding('EVIDENCE_SOURCE_DIGEST_INVALID', 'Source digest must be SHA-256 hex.'));
  if (!hexDigest(envelope.artifactDigest)) findings.push(finding('EVIDENCE_ARTIFACT_DIGEST_INVALID', 'Artifact digest must be SHA-256 hex.'));
  if (!validInstant(envelope.producedAt)) findings.push(finding('EVIDENCE_TIME_INVALID', 'Produced time must be an ISO instant.'));
  required(envelope.environmentId, 'EVIDENCE_ENVIRONMENT_REQUIRED', findings);
  required(envelope.collectorId, 'EVIDENCE_COLLECTOR_REQUIRED', findings);
  required(envelope.independentReviewerId, 'EVIDENCE_REVIEWER_REQUIRED', findings);
  if (envelope.collectorId === envelope.independentReviewerId) findings.push(finding('EVIDENCE_REVIEW_NOT_INDEPENDENT', 'Collector and reviewer must be distinct.'));
  if (envelope.evidenceClass !== 'OBSERVED') findings.push(finding('EVIDENCE_NOT_OBSERVED', 'External qualification requires observed evidence.'));
  if (!envelope.signature.verified) findings.push(finding('EVIDENCE_SIGNATURE_UNVERIFIED', 'Evidence signature must be verified by the ingestion boundary.'));
  required(envelope.signature.keyId, 'EVIDENCE_SIGNING_KEY_REQUIRED', findings);
  if (!['Ed25519', 'ECDSA_P256_SHA256', 'RSA_PSS_SHA256'].includes(envelope.signature.algorithm)) {
    findings.push(finding('EVIDENCE_SIGNATURE_ALGORITHM_UNAPPROVED', 'Evidence signature algorithm is not approved.'));
  }
  return findings;
}

export function qualificationResult<TMetrics extends Readonly<Record<string, unknown>>>(
  gateId: string,
  metrics: TMetrics,
  findings: readonly QualificationFinding[],
  evidence: unknown,
): QualificationResult<TMetrics> {
  return { gateId, status: findings.length === 0 ? 'PASS' : 'BLOCK', metrics, findings, evidenceDigest: sha256(evidence) };
}

export function finding(code: string, message: string): QualificationFinding { return { code, message }; }
export function validInstant(value: string): boolean { return Number.isFinite(Date.parse(value)); }
export function hexDigest(value: string): boolean { return /^[0-9a-f]{64}$/.test(value); }
export function round(value: number): number { return Number(value.toFixed(3)); }
function required(value: string, code: string, findings: QualificationFinding[]): void {
  if (value.trim() === '') findings.push(finding(code, 'Required value is empty.'));
}
