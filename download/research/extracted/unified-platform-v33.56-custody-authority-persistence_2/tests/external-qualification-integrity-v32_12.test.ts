import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyRegistry, generateSigningIdentity, sha256, signEnvelope, type SigningIdentity } from '../src/contracts/crypto.js';
import { evaluateExternalQualificationGate } from '../src/qualification/external-qualification-gate.js';
import {
  REQUIRED_EXTERNAL_GATE_IDS,
  computeExternalQualificationPolicyDigestV32_12,
  evaluateExternalQualificationIntegrityV32_12,
  type ExternalGateId,
  type ExternalQualificationPolicyV32_12,
  type QualificationActorIdentityV32_12,
  type QualificationArtifactObservationV32_12,
  type QualificationCollectorStatementV32_12,
  type QualificationEvidenceBundleV32_12,
  type QualificationReviewerStatementV32_12,
  type QualificationWitnessStatementV32_12,
} from '../src/qualification/external-qualification-integrity-v32_12.js';

const digest = (char: string): string => char.repeat(64);
const sourceDigest = digest('a');
const artifactDigest = digest('b');
const toolchainDigest = digest('c');
const environmentFingerprint = digest('d');
const policyDigest = digest('e');
const evaluatedAt = '2026-07-19T10:00:00.000Z';

interface Fixture {
  readonly policy: ExternalQualificationPolicyV32_12;
  readonly registry: KeyRegistry;
  readonly identities: { collector: SigningIdentity; reviewer: SigningIdentity; witness: SigningIdentity };
  readonly bundles: QualificationEvidenceBundleV32_12[];
  readonly authorizations: import('../src/qualification/external-qualification-integrity-v32_12.js').QualificationKeyAuthorizationV32_12[];
  readonly observations: QualificationArtifactObservationV32_12[];
}

function actor(identity: SigningIdentity, role: string): QualificationActorIdentityV32_12 {
  const organization = role === 'collector' ? 'platform-operator' : role === 'reviewer' ? 'independent-auditor' : 'transparency-witness';
  return {
    actorId: `${role}-actor`, keyId: identity.keyId, keyFingerprint: '', processId: `${role}-process`, hostId: `${role}-host`, organizationId: organization,
    credentialValidFrom: '2026-07-01T00:00:00.000Z', credentialValidUntil: '2026-08-01T00:00:00.000Z',
  };
}

function buildFixture(): Fixture {
  const identities = {
    collector: generateSigningIdentity('collector-key-v1'),
    reviewer: generateSigningIdentity('reviewer-key-v1'),
    witness: generateSigningIdentity('witness-key-v1'),
  };
  const registry = new KeyRegistry();
  for (const identity of Object.values(identities)) registry.register(identity.keyId, identity.publicKey);
  const actors = {
    collector: { ...actor(identities.collector, 'collector'), keyFingerprint: registry.fingerprint(identities.collector.keyId)! },
    reviewer: { ...actor(identities.reviewer, 'reviewer'), keyFingerprint: registry.fingerprint(identities.reviewer.keyId)! },
    witness: { ...actor(identities.witness, 'witness'), keyFingerprint: registry.fingerprint(identities.witness.keyId)! },
  };
  const policyMaterial = {
    schemaVersion: '32.12' as const, policyId: 'external-production-policy-v32.12',
    expectedRunId: 'v32.12-authoritative-external-001', expectedSourceDigest: sourceDigest, expectedArtifactDigest: artifactDigest,
    expectedToolchainDigest: toolchainDigest, maximumEvidenceAgeMs: 24 * 60 * 60 * 1000, maximumClockSkewMs: 5_000,
    minimumExecutionMode: 'independent-organization' as const, requireWitness: true, requiredGateIds: REQUIRED_EXTERNAL_GATE_IDS,
  };
  const policy: ExternalQualificationPolicyV32_12 = { ...policyMaterial, policyDigest: computeExternalQualificationPolicyDigestV32_12(policyMaterial) };
  const authorizations = [
    { role: 'collector' as const, ...actors.collector, allowedGateIds: REQUIRED_EXTERNAL_GATE_IDS },
    { role: 'reviewer' as const, ...actors.reviewer, allowedGateIds: REQUIRED_EXTERNAL_GATE_IDS },
    { role: 'witness' as const, ...actors.witness, allowedGateIds: REQUIRED_EXTERNAL_GATE_IDS },
  ].map(({ role, actorId, keyId, keyFingerprint, organizationId, credentialValidFrom, credentialValidUntil, allowedGateIds }) => ({ role, actorId, keyId, keyFingerprint, organizationId, credentialValidFrom, credentialValidUntil, allowedGateIds }));
  const observations: QualificationArtifactObservationV32_12[] = [];
  let previousWitnessDigest: string | null = null;
  const bundles = REQUIRED_EXTERNAL_GATE_IDS.map((gateId, index) => {
    const path = `external-qualification/${gateId}/raw-evidence.json`;
    const raw = { path, sha256: String((index + 1) % 10).repeat(64), bytes: 100 + index, externalResponseIds: [`response-${gateId}`] };
    observations.push({ path, sha256: raw.sha256, bytes: raw.bytes, modifiedAt: `2026-07-19T09:${String(10 + index).padStart(2, '0')}:00.000Z` });
    const identity = {
      schemaVersion: '32.12' as const, runId: policy.expectedRunId, qualificationId: `qualification-${gateId}`, gateId,
      sourceDigest, artifactDigest, toolchainDigest, environmentFingerprint, policyDigest: policy.policyDigest, adapterVersion: '32.12.0',
    };
    const collector: QualificationCollectorStatementV32_12 = {
      identity, executionMode: 'independent-organization', evidenceClass: 'OBSERVED', synthetic: false, state: 'passed',
      challengeNonce: `nonce-${String(index).padStart(2, '0')}-${'x'.repeat(40)}`,
      startedAt: '2026-07-19T09:00:00.000Z', completedAt: `2026-07-19T09:${String(8 + index).padStart(2, '0')}:00.000Z`,
      collectedAt: `2026-07-19T09:${String(20 + index).padStart(2, '0')}:00.000Z`, collector: actors.collector, rawEvidence: raw,
    };
    const reviewer: QualificationReviewerStatementV32_12 = {
      identity, challengeNonce: collector.challengeNonce, collectorStatementDigest: sha256(collector), rawEvidenceDigest: sha256(raw),
      reviewedAt: `2026-07-19T09:${String(30 + index).padStart(2, '0')}:00.000Z`, reviewer: actors.reviewer,
      verdict: 'PASS', rationale: 'Independent review verified the raw evidence and policy controls.',
    };
    const witness: QualificationWitnessStatementV32_12 = {
      identity, challengeNonce: collector.challengeNonce, collectorStatementDigest: sha256(collector), reviewerStatementDigest: sha256(reviewer),
      witnessedAt: `2026-07-19T09:${String(40 + index).padStart(2, '0')}:00.000Z`, witness: actors.witness,
      checkpointSequence: index + 1, previousCheckpointDigest: previousWitnessDigest,
    };
    previousWitnessDigest = sha256(witness);
    return { collector: signEnvelope(collector, identities.collector), reviewer: signEnvelope(reviewer, identities.reviewer), witness: signEnvelope(witness, identities.witness) };
  });
  return { policy, registry, identities, bundles, authorizations, observations };
}

function evaluate(fixture: Fixture, overrides: Partial<Parameters<typeof evaluateExternalQualificationIntegrityV32_12>[0]> = {}) {
  return evaluateExternalQualificationIntegrityV32_12({ purpose: 'production', policy: fixture.policy, evaluatedAt, keyRegistry: fixture.registry, authorizations: fixture.authorizations, bundles: fixture.bundles, observations: fixture.observations, ...overrides });
}

function resignBundle(fixture: Fixture, index: number, changes: {
  collector?: (value: QualificationCollectorStatementV32_12) => QualificationCollectorStatementV32_12;
  reviewer?: (value: QualificationReviewerStatementV32_12, collector: QualificationCollectorStatementV32_12) => QualificationReviewerStatementV32_12;
  witness?: (value: QualificationWitnessStatementV32_12, collector: QualificationCollectorStatementV32_12, reviewer: QualificationReviewerStatementV32_12) => QualificationWitnessStatementV32_12;
}): QualificationEvidenceBundleV32_12[] {
  const bundles = [...fixture.bundles];
  const original = bundles[index]!;
  const collector = changes.collector?.(original.collector.payload) ?? original.collector.payload;
  const reviewerBase = changes.reviewer?.(original.reviewer.payload, collector) ?? original.reviewer.payload;
  const reviewer = { ...reviewerBase, collectorStatementDigest: changes.collector ? sha256(collector) : reviewerBase.collectorStatementDigest };
  const witnessBase = changes.witness?.(original.witness.payload, collector, reviewer) ?? original.witness.payload;
  const witness = { ...witnessBase, collectorStatementDigest: changes.collector ? sha256(collector) : witnessBase.collectorStatementDigest, reviewerStatementDigest: changes.collector || changes.reviewer ? sha256(reviewer) : witnessBase.reviewerStatementDigest };
  bundles[index] = { collector: signEnvelope(collector, fixture.identities.collector), reviewer: signEnvelope(reviewer, fixture.identities.reviewer), witness: signEnvelope(witness, fixture.identities.witness) };
  return bundles;
}

function gateFailures(report: ReturnType<typeof evaluateExternalQualificationIntegrityV32_12>, gateId: ExternalGateId): readonly string[] {
  return report.gateReports.find((row) => row.gateId === gateId)!.failures;
}

test('legacy aggregate accepts forged unbound PASS results, proving the inherited bypass', () => {
  const fake = (gateId: string) => ({ gateId, status: 'PASS' as const, metrics: {}, findings: [], evidenceDigest: digest('f') });
  const report = evaluateExternalQualificationGate({
    sourceDigest,
    hsmKms: fake('hsm-kms-custody'), witness: fake('external-monotonic-witness'), postgres: fake('postgres-ha-pitr'),
    humanPilot: fake('consented-comparative-human-pilot'), independentReview: fake('independent-security-isolation-license-review'),
    multiHostSlo: fake('multi-host-slo-revocation-recovery'),
  });
  assert.equal(report.status, 'QUALIFIED');
});

test('v32.12 qualifies all six gates only with a cryptographically bound collector-reviewer-witness chain', () => {
  const fixture = buildFixture();
  const report = evaluate(fixture);
  assert.equal(report.status, 'QUALIFIED', JSON.stringify(report.failures));
  assert.equal(report.passedGates, 6);
  assert.equal(report.productionPromotion, 'eligible-for-authorized-decision');
  assert.match(report.reportDigest, /^[0-9a-f]{64}$/);
});

test('synthetic, simulated, incomplete and dry-run evidence cannot satisfy production policy even when signed', () => {
  const fixture = buildFixture();
  const bundles = resignBundle(fixture, 0, { collector: (value) => ({ ...value, synthetic: true, evidenceClass: 'SIMULATED', state: 'incomplete', executionMode: 'local-dry-run' }) });
  const report = evaluate(fixture, { bundles });
  const failures = gateFailures(report, REQUIRED_EXTERNAL_GATE_IDS[0]);
  for (const expected of ['synthetic_evidence_forbidden', 'evidence_not_observed', 'collector_state_not_passed:incomplete', 'execution_mode_below_policy']) assert.ok(failures.includes(expected), `${expected}: ${JSON.stringify(failures)}`);
  assert.equal(report.status, 'BLOCKED');
});

test('source, artifact, toolchain, policy and run identity drift fail closed', () => {
  const fixture = buildFixture();
  const bundles = resignBundle(fixture, 1, { collector: (value) => ({ ...value, identity: { ...value.identity, runId: 'other-run', sourceDigest: digest('1'), artifactDigest: digest('2'), toolchainDigest: digest('3'), policyDigest: digest('4') } }) });
  const failures = gateFailures(evaluate(fixture, { bundles }), REQUIRED_EXTERNAL_GATE_IDS[1]);
  for (const expected of ['collector_run_id_mismatch', 'collector_source_digest_mismatch', 'collector_artifact_digest_mismatch', 'collector_toolchain_digest_mismatch', 'collector_policy_digest_mismatch', 'identity_tuple_drift']) assert.ok(failures.includes(expected), `${expected}: ${JSON.stringify(failures)}`);
});

test('replayed and duplicated challenge nonces are rejected', () => {
  const fixture = buildFixture();
  const replayed = evaluate(fixture, { previouslyConsumedNonces: [fixture.bundles[0]!.collector.payload.challengeNonce] });
  assert.ok(gateFailures(replayed, REQUIRED_EXTERNAL_GATE_IDS[0]).includes('challenge_nonce_replayed'));
  const nonce = fixture.bundles[0]!.collector.payload.challengeNonce;
  const bundles = resignBundle(fixture, 1, { collector: (value) => ({ ...value, challengeNonce: nonce }), reviewer: (value) => ({ ...value, challengeNonce: nonce }), witness: (value) => ({ ...value, challengeNonce: nonce }) });
  assert.ok(gateFailures(evaluate(fixture, { bundles }), REQUIRED_EXTERNAL_GATE_IDS[1]).includes('challenge_nonce_replayed'));
});

test('renaming the same signing identity does not create reviewer or witness independence', () => {
  const fixture = buildFixture();
  const original = fixture.bundles[0]!;
  const collectorActor = original.collector.payload.collector;
  const reviewer = { ...original.reviewer.payload, reviewer: { ...collectorActor, actorId: 'renamed-reviewer' } };
  const witness = { ...original.witness.payload, reviewerStatementDigest: sha256(reviewer) };
  const bundles = [...fixture.bundles];
  bundles[0] = { collector: original.collector, reviewer: signEnvelope(reviewer, fixture.identities.collector), witness: signEnvelope(witness, fixture.identities.witness) };
  const failures = gateFailures(evaluate(fixture, { bundles }), REQUIRED_EXTERNAL_GATE_IDS[0]);
  assert.ok(failures.includes('signing_key_not_independent'));
  assert.ok(failures.includes('process_not_independent'));
  assert.ok(failures.includes('host_not_independent'));
  assert.ok(failures.includes('organization_not_independent'));
});

test('tampered signature and raw evidence substitution are independently rejected', () => {
  const fixture = buildFixture();
  const bundles = [...fixture.bundles];
  bundles[2] = { ...bundles[2]!, reviewer: { ...bundles[2]!.reviewer, signature: `${bundles[2]!.reviewer.signature.slice(0, -2)}aa` } };
  const observations = fixture.observations.map((row, index) => index === 2 ? { ...row, sha256: digest('9'), bytes: row.bytes + 1 } : row);
  const failures = gateFailures(evaluate(fixture, { bundles, observations }), REQUIRED_EXTERNAL_GATE_IDS[2]);
  assert.ok(failures.includes('reviewer_signature_invalid'));
  assert.ok(failures.includes('raw_evidence_digest_or_size_mismatch'));
});

test('review copied from another qualification and witness equivocation are rejected', () => {
  const fixture = buildFixture();
  const original = fixture.bundles[3]!;
  const other = fixture.bundles[4]!;
  const reviewer = { ...other.reviewer.payload, identity: original.reviewer.payload.identity, challengeNonce: original.collector.payload.challengeNonce };
  const witness = { ...original.witness.payload, reviewerStatementDigest: digest('7'), previousCheckpointDigest: 'bad' };
  const bundles = [...fixture.bundles];
  bundles[3] = { collector: original.collector, reviewer: signEnvelope(reviewer, fixture.identities.reviewer), witness: signEnvelope(witness, fixture.identities.witness) };
  const failures = gateFailures(evaluate(fixture, { bundles }), REQUIRED_EXTERNAL_GATE_IDS[3]);
  assert.ok(failures.includes('reviewer_collector_digest_mismatch'));
  assert.ok(failures.includes('reviewer_raw_evidence_digest_mismatch'));
  assert.ok(failures.includes('witness_reviewer_digest_mismatch'));
  assert.ok(failures.includes('witness_previous_checkpoint_mismatch'));
});

test('expired or revoked reviewer credentials cannot approve current evidence', () => {
  const fixture = buildFixture();
  fixture.registry.revokeAt(fixture.identities.reviewer.keyId, '2026-07-19T09:25:00.000Z');
  const bundles = resignBundle(fixture, 4, { reviewer: (value) => ({ ...value, reviewer: { ...value.reviewer, credentialValidUntil: '2026-07-19T09:20:00.000Z' } }) });
  const failures = gateFailures(evaluate(fixture, { bundles }), REQUIRED_EXTERNAL_GATE_IDS[4]);
  assert.ok(failures.includes('reviewer_credential_expired'));
  assert.ok(failures.includes('reviewer_key_revoked'));
  assert.ok(failures.includes('reviewer_signature_invalid'));
});

test('review before collection, future witness, stale evidence and post-collection file changes fail closed', () => {
  const fixture = buildFixture();
  const bundles = resignBundle(fixture, 5, {
    collector: (value) => ({ ...value, startedAt: '2026-07-17T08:00:00.000Z', completedAt: '2026-07-17T08:10:00.000Z', collectedAt: '2026-07-17T08:20:00.000Z' }),
    reviewer: (value) => ({ ...value, reviewedAt: '2026-07-17T08:15:00.000Z' }),
    witness: (value) => ({ ...value, witnessedAt: '2026-07-19T10:01:00.000Z' }),
  });
  const observations = fixture.observations.map((row, index) => index === 5 ? { ...row, modifiedAt: '2026-07-18T08:30:00.000Z' } : row);
  const failures = gateFailures(evaluate(fixture, { bundles, observations }), REQUIRED_EXTERNAL_GATE_IDS[5]);
  for (const expected of ['review_before_collection', 'witnessed_in_future', 'evidence_stale', 'raw_evidence_modified_after_collection']) assert.ok(failures.includes(expected), `${expected}: ${JSON.stringify(failures)}`);
});

test('missing, duplicate and unexpected gate topology cannot be aggregated', () => {
  const fixture = buildFixture();
  const missing = evaluate(fixture, { bundles: fixture.bundles.slice(0, 5), observations: fixture.observations.slice(0, 5) });
  assert.ok(missing.failures.includes('required_gate_set_mismatch'));
  assert.ok(missing.failures.includes('required_gate_count_mismatch'));
  const duplicate = evaluate(fixture, { bundles: [...fixture.bundles.slice(0, 5), fixture.bundles[0]!], observations: fixture.observations });
  assert.ok(duplicate.failures.some((failure) => failure.startsWith('duplicate_gate:')));
});

test('noncanonical timestamps, unsafe evidence paths and missing observations fail closed', () => {
  const fixture = buildFixture();
  const bundles = resignBundle(fixture, 0, { collector: (value) => ({ ...value, collectedAt: '2026-07-19T09:20:00Z', rawEvidence: { ...value.rawEvidence, path: '../escape.json' } }) });
  const failures = gateFailures(evaluate(fixture, { bundles, observations: fixture.observations.slice(1) }), REQUIRED_EXTERNAL_GATE_IDS[0]);
  assert.ok(failures.includes('collector_collected_at_invalid'));
  assert.ok(failures.includes('raw_evidence_path_unsafe'));
  assert.ok(failures.includes('raw_evidence_observation_missing'));
});

test('policy validation rejects malformed identity, digest, age, skew and gate configuration', () => {
  const fixture = buildFixture();
  const invalidPolicies = [
    { ...fixture.policy, schemaVersion: '32.11' as '32.12' },
    { ...fixture.policy, policyId: '' },
    { ...fixture.policy, policyDigest: 'bad' },
    { ...fixture.policy, policyDigest: digest('f') },
    { ...fixture.policy, expectedSourceDigest: 'bad' },
    { ...fixture.policy, expectedArtifactDigest: 'bad' },
    { ...fixture.policy, expectedToolchainDigest: 'bad' },
    { ...fixture.policy, expectedRunId: 'bad run id' },
    { ...fixture.policy, maximumEvidenceAgeMs: 0 },
    { ...fixture.policy, maximumClockSkewMs: 60_001 },
    { ...fixture.policy, requiredGateIds: [REQUIRED_EXTERNAL_GATE_IDS[0], REQUIRED_EXTERNAL_GATE_IDS[0]] },
    { ...fixture.policy, requiredGateIds: ['unknown-gate' as ExternalGateId] },
  ];
  for (const policy of invalidPolicies) assert.throws(() => evaluate(fixture, { policy }));
  assert.throws(() => evaluate(fixture, { evaluatedAt: '2026-07-19T10:00:00Z' }), /evaluated_at_invalid/);
});


test('production purpose independently requires the exact six-gate witness-backed organization policy', () => {
  const fixture = buildFixture();
  const cases = [
    { minimumExecutionMode: 'independent-organization' as const, requireWitness: true, requiredGateIds: [REQUIRED_EXTERNAL_GATE_IDS[0]] },
    { minimumExecutionMode: 'independent-process' as const, requireWitness: true, requiredGateIds: REQUIRED_EXTERNAL_GATE_IDS },
    { minimumExecutionMode: 'independent-organization' as const, requireWitness: false, requiredGateIds: REQUIRED_EXTERNAL_GATE_IDS },
  ];
  const messages = [
    /external_qualification_production_requires_all_gates/,
    /external_qualification_production_mode_invalid/,
    /external_qualification_production_witness_required/,
  ];
  cases.forEach((change, index) => {
    const material = { ...fixture.policy, ...change };
    const { policyDigest: _ignored, ...unsigned } = material;
    const policy = { ...unsigned, policyDigest: computeExternalQualificationPolicyDigestV32_12(unsigned) };
    assert.throws(() => evaluate(fixture, { policy }), messages[index]!);
  });
});


test('a signed actor without an out-of-band authorization is rejected', () => {
  const fixture = buildFixture();
  const authorizations = fixture.authorizations.filter((entry) => entry.role !== 'collector');
  const failures = gateFailures(evaluate(fixture, { authorizations }), REQUIRED_EXTERNAL_GATE_IDS[0]);
  assert.ok(failures.includes('collector_key_not_authorized'), JSON.stringify(failures));
});

test('witness checkpoints must advance monotonically from verifier-owned prior state', () => {
  const fixture = buildFixture();
  const first = fixture.bundles[0]!.witness.payload;
  const prior = [{ witnessKeyId: first.witness.keyId, checkpointSequence: 1, statementDigest: digest('9') }];
  const failures = gateFailures(evaluate(fixture, { previousWitnessCheckpoints: prior }), REQUIRED_EXTERNAL_GATE_IDS[0]);
  assert.ok(failures.includes('witness_checkpoint_sequence_not_monotonic'), JSON.stringify(failures));
  assert.ok(failures.includes('witness_previous_checkpoint_mismatch'), JSON.stringify(failures));
});

test('actor credentials, fingerprints and signer identities are validated independently', () => {
  const fixture = buildFixture();
  const original = fixture.bundles[0]!;
  const collector = {
    ...original.collector.payload,
    collector: {
      ...original.collector.payload.collector,
      actorId: 'bad actor id', keyFingerprint: digest('0'), credentialValidFrom: '2026-07-19T09:30:00.000Z', credentialValidUntil: '2026-07-19T09:00:00.000Z',
    },
  };
  const reviewer = { ...original.reviewer.payload, collectorStatementDigest: sha256(collector), reviewer: { ...original.reviewer.payload.reviewer, keyId: 'missing-key' } };
  const witness = { ...original.witness.payload, collectorStatementDigest: sha256(collector), reviewerStatementDigest: sha256(reviewer) };
  const bundles = [...fixture.bundles];
  bundles[0] = {
    collector: signEnvelope(collector, fixture.identities.reviewer),
    reviewer: signEnvelope(reviewer, fixture.identities.reviewer),
    witness: { ...signEnvelope(witness, fixture.identities.witness), issuerKeyId: 'other-witness-key' },
  };
  const failures = gateFailures(evaluate(fixture, { bundles }), REQUIRED_EXTERNAL_GATE_IDS[0]);
  for (const expected of ['collector_actor_id_invalid','collector_key_fingerprint_mismatch','collector_credential_interval_invalid','collector_credential_not_yet_valid','collector_credential_expired','collector_signer_identity_mismatch','reviewer_signer_identity_mismatch','witness_signer_identity_mismatch']) assert.ok(failures.includes(expected), `${expected}: ${JSON.stringify(failures)}`);
});

test('time ordering, nonce binding, reviewer verdict and witness checkpoint branches fail closed', () => {
  const fixture = buildFixture();
  const bundles = resignBundle(fixture, 1, {
    collector: (value) => ({ ...value, challengeNonce: 'short', startedAt: '2026-07-19T09:50:00.000Z', completedAt: '2026-07-19T09:40:00.000Z', collectedAt: '2026-07-19T09:30:00.000Z' }),
    reviewer: (value) => ({ ...value, challengeNonce: `other-${'z'.repeat(40)}`, reviewedAt: '2026-07-19T09:20:00.000Z', verdict: 'FAIL', rationale: 'short' }),
    witness: (value) => ({ ...value, challengeNonce: `witness-${'y'.repeat(40)}`, witnessedAt: '2026-07-19T09:10:00.000Z', checkpointSequence: 0 }),
  });
  const observations = fixture.observations.map((row, index) => index === 1 ? { ...row, modifiedAt: '2026-07-19T08:00:00.000Z' } : row);
  const failures = gateFailures(evaluate(fixture, { bundles, observations }), REQUIRED_EXTERNAL_GATE_IDS[1]);
  for (const expected of ['challenge_nonce_invalid','challenge_nonce_binding_mismatch','collector_time_reversed','collection_before_completion','review_before_collection','witness_before_review','reviewer_verdict_not_pass','reviewer_rationale_insufficient','witness_checkpoint_sequence_invalid','raw_evidence_predates_execution']) assert.ok(failures.includes(expected), `${expected}: ${JSON.stringify(failures)}`);
});

test('raw evidence schema, safe path and observation uniqueness are enforced', () => {
  const fixture = buildFixture();
  const bundles = resignBundle(fixture, 2, { collector: (value) => ({ ...value, rawEvidence: { ...value.rawEvidence, path: '/absolute/raw.json', sha256: 'bad', bytes: -1, externalResponseIds: ['duplicate', 'duplicate'] } }) });
  const failures = gateFailures(evaluate(fixture, { bundles }), REQUIRED_EXTERNAL_GATE_IDS[2]);
  for (const expected of ['raw_evidence_path_unsafe','raw_evidence_record_invalid','external_response_ids_invalid','raw_evidence_observation_missing']) assert.ok(failures.includes(expected), `${expected}: ${JSON.stringify(failures)}`);
  assert.throws(() => evaluate(fixture, { observations: [...fixture.observations, fixture.observations[0]!] }), /observation_duplicate/);
});

test('diagnostic independent-process mode can validate a subset but can never become production eligible', () => {
  const fixture = buildFixture();
  const gateId = REQUIRED_EXTERNAL_GATE_IDS[0];
  const basePolicy = {
    ...fixture.policy,
    minimumExecutionMode: 'independent-process' as const,
    requireWitness: false,
    requiredGateIds: [gateId],
  };
  const policy = { ...basePolicy, policyDigest: computeExternalQualificationPolicyDigestV32_12(basePolicy) };
  const original = fixture.bundles[0]!;
  const identity = { ...original.collector.payload.identity, policyDigest: policy.policyDigest };
  const collectorActor = original.collector.payload.collector;
  const collector = { ...original.collector.payload, identity, executionMode: 'independent-process' as const };
  const reviewer = {
    ...original.reviewer.payload,
    identity,
    collectorStatementDigest: sha256(collector),
    reviewer: { ...original.reviewer.payload.reviewer, hostId: collectorActor.hostId, organizationId: collectorActor.organizationId },
  };
  const witness = {
    ...original.witness.payload,
    identity,
    collectorStatementDigest: sha256(collector),
    reviewerStatementDigest: sha256(reviewer),
    witness: { ...original.witness.payload.witness, hostId: collectorActor.hostId, organizationId: collectorActor.organizationId },
    checkpointSequence: 1,
    previousCheckpointDigest: null,
  };
  const authorizations = fixture.authorizations.map((authorization) => authorization.role === 'collector' ? { ...authorization, allowedGateIds: [gateId] } : {
    ...authorization,
    organizationId: collectorActor.organizationId,
    allowedGateIds: [gateId],
  });
  const bundle = {
    collector: signEnvelope(collector, fixture.identities.collector),
    reviewer: signEnvelope(reviewer, fixture.identities.reviewer),
    witness: { ...signEnvelope(witness, fixture.identities.witness), signature: 'deliberately-invalid-but-policy-does-not-require-witness' },
  };
  const report = evaluate(fixture, { purpose: 'diagnostic', policy, authorizations, bundles: [bundle], observations: [fixture.observations[0]!] });
  assert.equal(report.status, 'QUALIFIED', JSON.stringify(report.failures));
  assert.equal(report.productionPromotion, 'blocked');
});

test('malformed identity tuple, key fingerprint and observation timestamp branches fail explicitly', () => {
  const fixture = buildFixture();
  const original = fixture.bundles[0]!;
  const malformedIdentity = {
    ...original.collector.payload.identity,
    schemaVersion: '32.11' as '32.12',
    qualificationId: 'bad qualification id',
    gateId: 'unknown-gate' as ExternalGateId,
    environmentFingerprint: 'not-a-digest',
    adapterVersion: 'latest',
  };
  const collector = {
    ...original.collector.payload,
    identity: malformedIdentity,
    collector: { ...original.collector.payload.collector, keyFingerprint: 'not-a-digest' },
  };
  const reviewer = {
    ...original.reviewer.payload,
    identity: malformedIdentity,
    collectorStatementDigest: sha256(collector),
  };
  const witness = {
    ...original.witness.payload,
    identity: malformedIdentity,
    collectorStatementDigest: sha256(collector),
    reviewerStatementDigest: sha256(reviewer),
  };
  const bundles = [...fixture.bundles];
  bundles[0] = {
    collector: signEnvelope(collector, fixture.identities.collector),
    reviewer: signEnvelope(reviewer, fixture.identities.reviewer),
    witness: signEnvelope(witness, fixture.identities.witness),
  };
  const observations = fixture.observations.map((row, index) => index === 0 ? { ...row, modifiedAt: 'not-a-time' } : row);
  const report = evaluate(fixture, { bundles, observations });
  const failures = report.gateReports.find((row) => row.gateId === 'unknown-gate')!.failures;
  for (const role of ['collector', 'reviewer', 'witness']) {
    for (const suffix of ['schema_version_mismatch', 'qualification_id_invalid', 'gate_id_invalid', 'environment_fingerprint_invalid', 'adapter_version_invalid']) {
      assert.ok(failures.includes(`${role}_${suffix}`), `${role}_${suffix}: ${JSON.stringify(failures)}`);
    }
  }
  assert.ok(failures.includes('collector_key_fingerprint_invalid'));
  assert.ok(failures.includes('raw_evidence_modified_at_invalid'));
  assert.ok(report.failures.includes('required_gate_set_mismatch'));
});
