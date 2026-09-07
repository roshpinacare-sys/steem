import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExternalQualificationGate } from '../src/qualification/external-qualification-gate.js';
import { evaluateHsmKmsQualification } from '../src/qualification/hsm-kms-qualification.js';
import { evaluateHumanPilotQualification } from '../src/qualification/human-pilot-qualification.js';
import { evaluateIndependentReviewQualification } from '../src/qualification/independent-review-qualification.js';
import { evaluateMonotonicWitnessQualification } from '../src/qualification/monotonic-witness-qualification.js';
import { evaluateMultiHostSloQualification } from '../src/qualification/multi-host-slo-qualification.js';
import { evaluatePostgresHaQualification } from '../src/qualification/postgres-ha-qualification.js';
import { hsmEvidence, humanPilotEvidence, independentReviewEvidence, multiHostEvidence, postgresEvidence, sourceDigest, witnessEvidence } from './external-qualification-fixtures.js';

test('all six observed external gates can become eligible for an authorized production decision', () => {
  const report = evaluateExternalQualificationGate({ sourceDigest, hsmKms: evaluateHsmKmsQualification(hsmEvidence()), witness: evaluateMonotonicWitnessQualification(witnessEvidence()), postgres: evaluatePostgresHaQualification(postgresEvidence()), humanPilot: evaluateHumanPilotQualification(humanPilotEvidence()), independentReview: evaluateIndependentReviewQualification(independentReviewEvidence()), multiHostSlo: evaluateMultiHostSloQualification(multiHostEvidence()) });
  assert.equal(report.status, 'QUALIFIED'); assert.equal(report.passedGates, 6); assert.equal(report.productionPromotion, 'eligible-for-authorized-decision'); assert.match(report.reportDigest, /^[0-9a-f]{64}$/);
});

test('HSM/KMS evidence proves custody controls without exposing private key material', () => { assert.equal(evaluateHsmKmsQualification(hsmEvidence()).status, 'PASS'); });
test('external witness evidence proves monotonic receipts and rollback rejection', () => { assert.equal(evaluateMonotonicWitnessQualification(witnessEvidence()).status, 'PASS'); });
test('PostgreSQL evidence requires HA, RLS, tenant isolation, failover and PITR', () => { assert.equal(evaluatePostgresHaQualification(postgresEvidence()).status, 'PASS'); });
test('human pilot evidence measures predefined comparative value with consent', () => { const report=evaluateHumanPilotQualification(humanPilotEvidence()); assert.equal(report.status,'PASS'); assert.equal(report.metrics.participants,5); });
test('independent review evidence covers penetration, isolation, supply chain and licensing', () => { assert.equal(evaluateIndependentReviewQualification(independentReviewEvidence()).status, 'PASS'); });
test('multi-host evidence qualifies load, revocation propagation and recovery thresholds', () => { assert.equal(evaluateMultiHostSloQualification(multiHostEvidence()).status, 'PASS'); });

test('aggregate gate remains blocked when any one external gate is not qualified', () => {
  const failedHsm = evaluateHsmKmsQualification({ ...hsmEvidence(), privateKeyMaterialEnteredProcess: true });
  const report = evaluateExternalQualificationGate({ sourceDigest, hsmKms: failedHsm, witness: evaluateMonotonicWitnessQualification(witnessEvidence()), postgres: evaluatePostgresHaQualification(postgresEvidence()), humanPilot: evaluateHumanPilotQualification(humanPilotEvidence()), independentReview: evaluateIndependentReviewQualification(independentReviewEvidence()), multiHostSlo: evaluateMultiHostSloQualification(multiHostEvidence()) });
  assert.equal(report.status, 'BLOCKED'); assert.deepEqual(report.blockedGateIds, ['hsm-kms-custody']); assert.equal(report.productionPromotion, 'blocked');
});
