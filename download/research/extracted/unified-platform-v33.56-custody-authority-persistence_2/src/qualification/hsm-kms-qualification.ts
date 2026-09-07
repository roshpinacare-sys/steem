import {
  finding,
  qualificationResult,
  validateExternalEvidenceEnvelope,
  type ExternalEvidenceEnvelope,
  type QualificationResult,
} from './external-evidence.js';

export interface HsmKmsQualificationEvidence {
  readonly envelope: ExternalEvidenceEnvelope;
  readonly provider: string;
  readonly keyId: string;
  readonly algorithm: string;
  readonly privateKeyMaterialEnteredProcess: boolean;
  readonly providerBound: boolean;
  readonly keyIdBound: boolean;
  readonly requestDigestBound: boolean;
  readonly nonceUnique: boolean;
  readonly attestationVerified: boolean;
  readonly unauthorizedSigningDenied: boolean;
  readonly rotationObserved: boolean;
  readonly revocationObserved: boolean;
  readonly outageFailClosedObserved: boolean;
  readonly auditTrailComplete: boolean;
  readonly independentCustodianCount: number;
  readonly threshold: number;
}

export function evaluateHsmKmsQualification(evidence: HsmKmsQualificationEvidence): QualificationResult<Readonly<Record<string, unknown>>> {
  const findings = validateExternalEvidenceEnvelope(evidence.envelope, 'hsm-kms-custody');
  if (evidence.provider.trim() === '' || evidence.keyId.trim() === '') findings.push(finding('KMS_IDENTITY_REQUIRED', 'Provider and key ID are required.'));
  if (!['Ed25519', 'ECDSA_P256_SHA256', 'RSA_PSS_SHA256'].includes(evidence.algorithm)) findings.push(finding('KMS_ALGORITHM_UNAPPROVED', 'KMS algorithm is not approved.'));
  if (evidence.privateKeyMaterialEnteredProcess) findings.push(finding('KMS_PRIVATE_KEY_EXPOSED', 'Private key material entered the application process.'));
  const controls: ReadonlyArray<readonly [boolean, string]> = [
    [evidence.providerBound, 'KMS_PROVIDER_NOT_BOUND'],
    [evidence.keyIdBound, 'KMS_KEY_NOT_BOUND'],
    [evidence.requestDigestBound, 'KMS_DIGEST_NOT_BOUND'],
    [evidence.nonceUnique, 'KMS_NONCE_REUSE'],
    [evidence.attestationVerified, 'KMS_ATTESTATION_UNVERIFIED'],
    [evidence.unauthorizedSigningDenied, 'KMS_UNAUTHORIZED_SIGNING_NOT_DENIED'],
    [evidence.rotationObserved, 'KMS_ROTATION_UNOBSERVED'],
    [evidence.revocationObserved, 'KMS_REVOCATION_UNOBSERVED'],
    [evidence.outageFailClosedObserved, 'KMS_OUTAGE_NOT_FAIL_CLOSED'],
    [evidence.auditTrailComplete, 'KMS_AUDIT_INCOMPLETE'],
  ];
  for (const [passed, code] of controls) if (!passed) findings.push(finding(code, code.replaceAll('_', ' ').toLowerCase()));
  if (!Number.isInteger(evidence.threshold) || evidence.threshold < 2) findings.push(finding('KMS_THRESHOLD_INVALID', 'Custody threshold must be at least two.'));
  if (!Number.isInteger(evidence.independentCustodianCount) || evidence.independentCustodianCount < evidence.threshold) findings.push(finding('KMS_CUSTODIAN_THRESHOLD_NOT_MET', 'Independent custodian threshold was not met.'));
  const metrics = { provider: evidence.provider, algorithm: evidence.algorithm, threshold: evidence.threshold, independentCustodianCount: evidence.independentCustodianCount, controlCount: controls.length };
  return qualificationResult('hsm-kms-custody', metrics, findings, evidence);
}
