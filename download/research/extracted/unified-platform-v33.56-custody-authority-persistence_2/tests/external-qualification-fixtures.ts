import type { ExternalEvidenceEnvelope } from '../src/qualification/external-evidence.js';
import type { HsmKmsQualificationEvidence } from '../src/qualification/hsm-kms-qualification.js';
import type { HumanPilotQualificationEvidence } from '../src/qualification/human-pilot-qualification.js';
import type { IndependentReviewQualificationEvidence } from '../src/qualification/independent-review-qualification.js';
import type { MonotonicWitnessEvidence, WitnessReceipt } from '../src/qualification/monotonic-witness-qualification.js';
import { witnessReceiptDigest } from '../src/qualification/monotonic-witness-qualification.js';
import type { MultiHostSloQualificationEvidence } from '../src/qualification/multi-host-slo-qualification.js';
import type { PostgresHaQualificationEvidence } from '../src/qualification/postgres-ha-qualification.js';

const digest = 'a'.repeat(64);
export function envelope(gateId: string): ExternalEvidenceEnvelope {
  return { evidenceId: `evidence-${gateId}`, gateId, sourceDigest: digest, artifactDigest: 'b'.repeat(64), producedAt: '2026-07-18T08:00:00.000Z', environmentId: 'external-lab-1', collectorId: 'collector-a', independentReviewerId: 'reviewer-b', evidenceClass: 'OBSERVED', signature: { keyId: 'review-key-1', algorithm: 'Ed25519', verified: true } };
}
export function hsmEvidence(): HsmKmsQualificationEvidence {
  return { envelope: envelope('hsm-kms-custody'), provider: 'authorized-hsm', keyId: 'root-key-1', algorithm: 'Ed25519', privateKeyMaterialEnteredProcess: false, providerBound: true, keyIdBound: true, requestDigestBound: true, nonceUnique: true, attestationVerified: true, unauthorizedSigningDenied: true, rotationObserved: true, revocationObserved: true, outageFailClosedObserved: true, auditTrailComplete: true, independentCustodianCount: 3, threshold: 2 };
}
export function witnessEvidence(): MonotonicWitnessEvidence {
  const receipts: WitnessReceipt[] = []; let previous: string | null = null;
  for (let index = 0; index < 3; index += 1) {
    const material: Omit<WitnessReceipt, 'receiptDigest'> = { sequence: index + 1, checkpointDigest: String(index + 1).repeat(64), previousReceiptDigest: previous, observedAt: `2026-07-18T08:0${index}:00.000Z`, witnessId: 'witness-external-1', signatureVerified: true };
    const receipt: WitnessReceipt = { ...material, receiptDigest: witnessReceiptDigest(material) }; receipts.push(receipt); previous = receipt.receiptDigest;
  }
  return { envelope: envelope('external-monotonic-witness'), receipts, rollbackAttemptRejected: true, equivocationProbeRejected: true };
}
export function postgresEvidence(): PostgresHaQualificationEvidence {
  return { envelope: envelope('postgres-ha-pitr'), postgresMajorVersion: 16, primaryId: 'pg-primary', standbyId: 'pg-standby', forceRlsVerified: true, crossTenantLeakAttempts: 500, crossTenantLeaksObserved: 0, poolTenantResetVerified: true, failoverDuringCommitObserved: true, committedWritesPreserved: true, uncommittedWritesRejectedOrRolledBack: true, pitrRestoreObserved: true, restoredEvidenceRootMatched: true, measuredRtoSeconds: 20, maximumRtoSeconds: 30, measuredRpoSeconds: 2, maximumRpoSeconds: 5 };
}
export function humanPilotEvidence(): HumanPilotQualificationEvidence {
  const outcomes = [];
  for (let index = 0; index < 5; index += 1) {
    outcomes.push({ participantId: `p-${index + 1}`, consented: true, synthetic: false, group: 'BASELINE' as const, taskId: 'task-a', successful: index < 3, durationSeconds: 100 + index, criticalErrors: index === 4 ? 1 : 0 });
    outcomes.push({ participantId: `p-${index + 1}`, consented: true, synthetic: false, group: 'ASSISTED' as const, taskId: 'task-a', successful: true, durationSeconds: 65 + index, criticalErrors: 0 });
  }
  return { envelope: envelope('consented-comparative-human-pilot'), protocolRegisteredAt: '2026-07-01T00:00:00.000Z', pilotStartedAt: '2026-07-10T00:00:00.000Z', minimumParticipants: 5, minimumSuccessRateImprovementPoints: 20, minimumMedianTimeReductionPercent: 20, maximumAssistedCriticalErrorRate: 0, outcomes };
}
export function independentReviewEvidence(): IndependentReviewQualificationEvidence {
  return { envelope: envelope('independent-security-isolation-license-review'), reviews: (['PENETRATION','ISOLATION','SUPPLY_CHAIN','LICENSING'] as const).map((scope) => ({ scope, reviewerId: `reviewer-${scope}`, reviewerOrganization: 'independent-lab', subjectOrganization: 'platform-owner', conflictOfInterestDeclared: false, signed: true, verdict: 'PASS', criticalFindings: 0, highFindings: 0, unresolvedLicenseBlockers: 0, evidenceRefs: [`report://${scope.toLowerCase()}`] })) };
}
export function multiHostEvidence(): MultiHostSloQualificationEvidence {
  return { envelope: envelope('multi-host-slo-revocation-recovery'), hostIds: ['host-a','host-b','host-c'], durationSeconds: 7200, requestSamples: 5000, p95LatencyMs: 120, maximumP95LatencyMs: 200, p99LatencyMs: 250, maximumP99LatencyMs: 400, errorRatePercent: 0.1, maximumErrorRatePercent: 0.5, revocationPropagationP99Ms: 500, maximumRevocationPropagationP99Ms: 1000, recoveryRtoSeconds: 25, maximumRecoveryRtoSeconds: 30, recoveryRpoSeconds: 1, maximumRecoveryRpoSeconds: 5, splitBrainObserved: false, staleAuthorizationObserved: false };
}
export const sourceDigest = digest;
