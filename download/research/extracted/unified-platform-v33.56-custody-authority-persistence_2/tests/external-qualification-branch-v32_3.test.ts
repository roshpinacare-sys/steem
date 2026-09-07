import test from 'node:test';
import assert from 'node:assert/strict';
import { validateExternalEvidenceEnvelope } from '../src/qualification/external-evidence.js';
import { evaluateExternalQualificationGate } from '../src/qualification/external-qualification-gate.js';
import { evaluateHsmKmsQualification } from '../src/qualification/hsm-kms-qualification.js';
import { evaluateHumanPilotQualification } from '../src/qualification/human-pilot-qualification.js';
import { evaluateIndependentReviewQualification } from '../src/qualification/independent-review-qualification.js';
import { evaluateMonotonicWitnessQualification } from '../src/qualification/monotonic-witness-qualification.js';
import { evaluateMultiHostSloQualification } from '../src/qualification/multi-host-slo-qualification.js';
import { evaluatePostgresHaQualification } from '../src/qualification/postgres-ha-qualification.js';
import { envelope, hsmEvidence, humanPilotEvidence, independentReviewEvidence, multiHostEvidence, postgresEvidence, sourceDigest, witnessEvidence } from './external-qualification-fixtures.js';

function codes(report: { findings: readonly { code: string }[] }): string[] { return report.findings.map((row) => row.code); }

test('simulated or self-reviewed evidence is rejected', () => {
  const bad = { ...envelope('hsm-kms-custody'), evidenceClass: 'SIMULATED' as const, independentReviewerId: 'collector-a', signature: { keyId: '', algorithm: 'none', verified: false } };
  assert.deepEqual(codes({ findings: validateExternalEvidenceEnvelope(bad, 'hsm-kms-custody') }).sort(), ['EVIDENCE_NOT_OBSERVED','EVIDENCE_REVIEW_NOT_INDEPENDENT','EVIDENCE_SIGNATURE_ALGORITHM_UNAPPROVED','EVIDENCE_SIGNATURE_UNVERIFIED','EVIDENCE_SIGNING_KEY_REQUIRED'].sort());
});

test('HSM/KMS qualification fails closed across identity, control, threshold and custody failures', () => {
  const report = evaluateHsmKmsQualification({ ...hsmEvidence(), provider: '', algorithm: 'SHA1', providerBound: false, keyIdBound: false, requestDigestBound: false, nonceUnique: false, attestationVerified: false, unauthorizedSigningDenied: false, rotationObserved: false, revocationObserved: false, outageFailClosedObserved: false, auditTrailComplete: false, independentCustodianCount: 0, threshold: 1 });
  assert.equal(report.status,'BLOCK'); assert.ok(codes(report).includes('KMS_PROVIDER_NOT_BOUND')); assert.ok(codes(report).includes('KMS_CUSTODIAN_THRESHOLD_NOT_MET')); assert.ok(codes(report).length >= 13);
});

test('witness chain rejects short, non-monotonic, unsigned and tampered receipts', () => {
  const evidence=witnessEvidence(); const receipts=[{...evidence.receipts[0]!,sequence:2,observedAt:'invalid',signatureVerified:false,receiptDigest:'c'.repeat(64)}];
  const report=evaluateMonotonicWitnessQualification({...evidence,receipts,rollbackAttemptRejected:false,equivocationProbeRejected:false});
  assert.equal(report.status,'BLOCK'); for(const code of ['WITNESS_RECEIPTS_INSUFFICIENT','WITNESS_CHAIN_INVALID','WITNESS_TIME_NOT_MONOTONIC','WITNESS_SIGNATURE_UNVERIFIED','WITNESS_RECEIPT_TAMPERED','WITNESS_ROLLBACK_NOT_REJECTED','WITNESS_EQUIVOCATION_NOT_REJECTED']) assert.ok(codes(report).includes(code));
});

test('witness qualification rejects identity drift', () => { const evidence=witnessEvidence(); const receipts=evidence.receipts.map((r,i)=>i===2?{...r,witnessId:'other'}:r); assert.ok(codes(evaluateMonotonicWitnessQualification({...evidence,receipts})).includes('WITNESS_IDENTITY_DRIFT')); });

test('PostgreSQL qualification rejects weak topology, leakage and missing recovery controls', () => {
  const report=evaluatePostgresHaQualification({...postgresEvidence(),postgresMajorVersion:15,standbyId:'pg-primary',forceRlsVerified:false,crossTenantLeakAttempts:2,crossTenantLeaksObserved:1,poolTenantResetVerified:false,failoverDuringCommitObserved:false,committedWritesPreserved:false,uncommittedWritesRejectedOrRolledBack:false,pitrRestoreObserved:false,restoredEvidenceRootMatched:false,measuredRtoSeconds:40,measuredRpoSeconds:6});
  assert.equal(report.status,'BLOCK'); for(const code of ['POSTGRES_VERSION_UNQUALIFIED','POSTGRES_TOPOLOGY_INVALID','POSTGRES_TENANT_LEAK_OBSERVED','POSTGRES_FAILOVER_UNOBSERVED','POSTGRES_PITR_UNOBSERVED','POSTGRES_RTO_EXCEEDED','POSTGRES_RPO_EXCEEDED']) assert.ok(codes(report).includes(code));
});

test('human pilot rejects protocol-after-start, low sample, no consent and synthetic outcomes', () => {
  const base=humanPilotEvidence(); const outcomes=base.outcomes.filter((row)=>row.group==='BASELINE').slice(0,1).map((row)=>({...row,consented:false,synthetic:true,participantId:''}));
  const report=evaluateHumanPilotQualification({...base,protocolRegisteredAt:'2026-07-20T00:00:00Z',outcomes});
  assert.equal(report.status,'BLOCK'); for(const code of ['PILOT_PROTOCOL_NOT_PREREGISTERED','PILOT_PARTICIPANTS_INSUFFICIENT','PILOT_CONSENT_MISSING','PILOT_SYNTHETIC_OUTCOME_FORBIDDEN','PILOT_OUTCOME_INVALID','PILOT_COMPARISON_GROUP_MISSING']) assert.ok(codes(report).includes(code));
});

test('human pilot rejects thresholds that measured outcomes do not meet', () => { const base=humanPilotEvidence(); const report=evaluateHumanPilotQualification({...base,minimumSuccessRateImprovementPoints:90,minimumMedianTimeReductionPercent:90,maximumAssistedCriticalErrorRate:-1}); for(const code of ['PILOT_SUCCESS_THRESHOLD_NOT_MET','PILOT_TIME_THRESHOLD_NOT_MET','PILOT_ERROR_THRESHOLD_EXCEEDED']) assert.ok(codes(report).includes(code)); });

test('independent review rejects missing scope, conflicts, unsigned qualified verdict and open findings', () => {
  const base=independentReviewEvidence(); const reviews=[{...base.reviews[0]!,reviewerOrganization:'platform-owner',conflictOfInterestDeclared:true,signed:false,verdict:'QUALIFIED' as const,criticalFindings:1,highFindings:1,evidenceRefs:[]}];
  const report=evaluateIndependentReviewQualification({...base,reviews}); assert.equal(report.status,'BLOCK'); for(const code of ['REVIEW_NOT_INDEPENDENT','REVIEW_UNSIGNED','REVIEW_VERDICT_NOT_PASS','REVIEW_HIGH_SEVERITY_OPEN','REVIEW_EVIDENCE_MISSING','REVIEW_SCOPE_MISSING']) assert.ok(codes(report).includes(code));
});

test('independent review rejects duplicate scopes and license blockers', () => { const base=independentReviewEvidence(); const licensing={...base.reviews[3]!,unresolvedLicenseBlockers:1}; const report=evaluateIndependentReviewQualification({...base,reviews:[...base.reviews,licensing]}); assert.ok(codes(report).includes('REVIEW_SCOPE_DUPLICATE')); assert.ok(codes(report).includes('REVIEW_LICENSE_BLOCKER_OPEN')); });

test('multi-host SLO rejects weak sample, breached thresholds, split brain and stale authorization', () => {
  const report=evaluateMultiHostSloQualification({...multiHostEvidence(),hostIds:['a','a'],durationSeconds:10,requestSamples:10,p95LatencyMs:300,p99LatencyMs:500,errorRatePercent:1,revocationPropagationP99Ms:1500,recoveryRtoSeconds:40,recoveryRpoSeconds:10,splitBrainObserved:true,staleAuthorizationObserved:true});
  assert.equal(report.status,'BLOCK'); for(const code of ['SLO_HOSTS_INSUFFICIENT','SLO_DURATION_INSUFFICIENT','SLO_SAMPLES_INSUFFICIENT','SLO_P95_EXCEEDED','SLO_P99_EXCEEDED','SLO_ERROR_RATE_EXCEEDED','SLO_REVOCATION_PROPAGATION_EXCEEDED','SLO_RECOVERY_RTO_EXCEEDED','SLO_RECOVERY_RPO_EXCEEDED','SLO_SPLIT_BRAIN_OBSERVED','SLO_STALE_AUTHORIZATION_OBSERVED']) assert.ok(codes(report).includes(code));
});

test('aggregate gate rejects invalid source digest and duplicate gate identities', () => {
  const pass=evaluateHsmKmsQualification(hsmEvidence());
  assert.throws(()=>evaluateExternalQualificationGate({sourceDigest:'bad',hsmKms:pass,witness:pass,postgres:pass,humanPilot:pass,independentReview:pass,multiHostSlo:pass}),/source_digest_invalid/);
  assert.throws(()=>evaluateExternalQualificationGate({sourceDigest,hsmKms:pass,witness:pass,postgres:pass,humanPilot:pass,independentReview:pass,multiHostSlo:pass}),/gate_identity_invalid/);
});
