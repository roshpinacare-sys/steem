import { finding, qualificationResult, validateExternalEvidenceEnvelope, type ExternalEvidenceEnvelope, type QualificationResult } from './external-evidence.js';

export interface PostgresHaQualificationEvidence {
  readonly envelope: ExternalEvidenceEnvelope;
  readonly postgresMajorVersion: number;
  readonly primaryId: string;
  readonly standbyId: string;
  readonly forceRlsVerified: boolean;
  readonly crossTenantLeakAttempts: number;
  readonly crossTenantLeaksObserved: number;
  readonly poolTenantResetVerified: boolean;
  readonly failoverDuringCommitObserved: boolean;
  readonly committedWritesPreserved: boolean;
  readonly uncommittedWritesRejectedOrRolledBack: boolean;
  readonly pitrRestoreObserved: boolean;
  readonly restoredEvidenceRootMatched: boolean;
  readonly measuredRtoSeconds: number;
  readonly maximumRtoSeconds: number;
  readonly measuredRpoSeconds: number;
  readonly maximumRpoSeconds: number;
}

export function evaluatePostgresHaQualification(evidence: PostgresHaQualificationEvidence): QualificationResult<Readonly<Record<string, unknown>>> {
  const findings = validateExternalEvidenceEnvelope(evidence.envelope, 'postgres-ha-pitr');
  if (!Number.isInteger(evidence.postgresMajorVersion) || evidence.postgresMajorVersion < 16) findings.push(finding('POSTGRES_VERSION_UNQUALIFIED', 'PostgreSQL 16 or later is required.'));
  if (evidence.primaryId.trim() === '' || evidence.standbyId.trim() === '' || evidence.primaryId === evidence.standbyId) findings.push(finding('POSTGRES_TOPOLOGY_INVALID', 'Distinct primary and standby identities are required.'));
  if (!evidence.forceRlsVerified) findings.push(finding('POSTGRES_FORCE_RLS_UNVERIFIED', 'FORCE RLS was not verified.'));
  if (!Number.isInteger(evidence.crossTenantLeakAttempts) || evidence.crossTenantLeakAttempts < 100) findings.push(finding('POSTGRES_TENANT_PROBES_INSUFFICIENT', 'At least 100 cross-tenant probes are required.'));
  if (evidence.crossTenantLeaksObserved !== 0) findings.push(finding('POSTGRES_TENANT_LEAK_OBSERVED', 'Cross-tenant leakage was observed.'));
  const controls: ReadonlyArray<readonly [boolean, string]> = [
    [evidence.poolTenantResetVerified, 'POSTGRES_POOL_RESET_UNVERIFIED'],
    [evidence.failoverDuringCommitObserved, 'POSTGRES_FAILOVER_UNOBSERVED'],
    [evidence.committedWritesPreserved, 'POSTGRES_COMMITTED_WRITE_LOSS'],
    [evidence.uncommittedWritesRejectedOrRolledBack, 'POSTGRES_UNCOMMITTED_WRITE_AMBIGUOUS'],
    [evidence.pitrRestoreObserved, 'POSTGRES_PITR_UNOBSERVED'],
    [evidence.restoredEvidenceRootMatched, 'POSTGRES_PITR_ROOT_MISMATCH'],
  ];
  for (const [passed, code] of controls) if (!passed) findings.push(finding(code, code.replaceAll('_', ' ').toLowerCase()));
  validateSlo(evidence.measuredRtoSeconds, evidence.maximumRtoSeconds, 'POSTGRES_RTO_EXCEEDED', findings);
  validateSlo(evidence.measuredRpoSeconds, evidence.maximumRpoSeconds, 'POSTGRES_RPO_EXCEEDED', findings);
  const metrics = { postgresMajorVersion: evidence.postgresMajorVersion, crossTenantLeakAttempts: evidence.crossTenantLeakAttempts, measuredRtoSeconds: evidence.measuredRtoSeconds, measuredRpoSeconds: evidence.measuredRpoSeconds };
  return qualificationResult('postgres-ha-pitr', metrics, findings, evidence);
}
function validateSlo(measured: number, maximum: number, code: string, findings: ReturnType<typeof validateExternalEvidenceEnvelope>): void {
  if (!Number.isFinite(measured) || !Number.isFinite(maximum) || measured < 0 || maximum < 0 || measured > maximum) findings.push(finding(code, `${code.replaceAll('_', ' ').toLowerCase()}.`));
}
