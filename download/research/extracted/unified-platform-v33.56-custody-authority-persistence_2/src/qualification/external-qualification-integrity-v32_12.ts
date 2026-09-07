import { isAbsolute, posix } from 'node:path';
import { KeyRegistry, sha256, type SignedEnvelope } from '../contracts/crypto.js';

export const REQUIRED_EXTERNAL_GATE_IDS = [
  'hsm-kms-custody',
  'external-monotonic-witness',
  'postgres-ha-pitr',
  'consented-comparative-human-pilot',
  'independent-security-isolation-license-review',
  'multi-host-slo-revocation-recovery',
] as const;

export type ExternalGateId = typeof REQUIRED_EXTERNAL_GATE_IDS[number];
export type QualificationExecutionMode = 'local-dry-run' | 'independent-process' | 'independent-host' | 'independent-organization';
export type QualificationEvidenceClass = 'OBSERVED' | 'COMPUTED' | 'SIMULATED';
export type QualificationExecutionState = 'not_executed' | 'incomplete' | 'failed' | 'passed';
export type QualificationPurposeV32_12 = 'production' | 'diagnostic';
export type QualificationActorRoleV32_12 = 'collector' | 'reviewer' | 'witness';

export interface QualificationIdentityTupleV32_12 {
  readonly schemaVersion: '32.12';
  readonly runId: string;
  readonly qualificationId: string;
  readonly gateId: ExternalGateId;
  readonly sourceDigest: string;
  readonly artifactDigest: string;
  readonly toolchainDigest: string;
  readonly environmentFingerprint: string;
  readonly policyDigest: string;
  readonly adapterVersion: string;
}

export interface QualificationActorIdentityV32_12 {
  readonly actorId: string;
  readonly keyId: string;
  readonly keyFingerprint: string;
  readonly processId: string;
  readonly hostId: string;
  readonly organizationId: string;
  readonly credentialValidFrom: string;
  readonly credentialValidUntil: string;
}

export interface QualificationKeyAuthorizationV32_12 {
  readonly role: QualificationActorRoleV32_12;
  readonly actorId: string;
  readonly keyId: string;
  readonly keyFingerprint: string;
  readonly organizationId: string;
  readonly allowedGateIds: readonly ExternalGateId[];
  readonly credentialValidFrom: string;
  readonly credentialValidUntil: string;
}

export interface RawQualificationEvidenceReferenceV32_12 {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly externalResponseIds: readonly string[];
}

export interface QualificationCollectorStatementV32_12 {
  readonly identity: QualificationIdentityTupleV32_12;
  readonly executionMode: QualificationExecutionMode;
  readonly evidenceClass: QualificationEvidenceClass;
  readonly synthetic: boolean;
  readonly state: QualificationExecutionState;
  readonly challengeNonce: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly collectedAt: string;
  readonly collector: QualificationActorIdentityV32_12;
  readonly rawEvidence: RawQualificationEvidenceReferenceV32_12;
}

export interface QualificationReviewerStatementV32_12 {
  readonly identity: QualificationIdentityTupleV32_12;
  readonly challengeNonce: string;
  readonly collectorStatementDigest: string;
  readonly rawEvidenceDigest: string;
  readonly reviewedAt: string;
  readonly reviewer: QualificationActorIdentityV32_12;
  readonly verdict: 'PASS' | 'FAIL';
  readonly rationale: string;
}

export interface QualificationWitnessStatementV32_12 {
  readonly identity: QualificationIdentityTupleV32_12;
  readonly challengeNonce: string;
  readonly collectorStatementDigest: string;
  readonly reviewerStatementDigest: string;
  readonly witnessedAt: string;
  readonly witness: QualificationActorIdentityV32_12;
  readonly checkpointSequence: number;
  readonly previousCheckpointDigest: string | null;
}

export interface QualificationEvidenceBundleV32_12 {
  readonly collector: SignedEnvelope<QualificationCollectorStatementV32_12>;
  readonly reviewer: SignedEnvelope<QualificationReviewerStatementV32_12>;
  readonly witness: SignedEnvelope<QualificationWitnessStatementV32_12>;
}

export interface QualificationArtifactObservationV32_12 {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly modifiedAt: string;
}

export interface QualificationWitnessCheckpointV32_12 {
  readonly witnessKeyId: string;
  readonly checkpointSequence: number;
  readonly statementDigest: string;
}

export interface ExternalQualificationPolicyV32_12 {
  readonly schemaVersion: '32.12';
  readonly policyId: string;
  readonly policyDigest: string;
  readonly expectedRunId: string;
  readonly expectedSourceDigest: string;
  readonly expectedArtifactDigest: string;
  readonly expectedToolchainDigest: string;
  readonly maximumEvidenceAgeMs: number;
  readonly maximumClockSkewMs: number;
  readonly minimumExecutionMode: QualificationExecutionMode;
  readonly requireWitness: boolean;
  readonly requiredGateIds: readonly ExternalGateId[];
}

export interface ExternalQualificationVerificationInputV32_12 {
  readonly purpose: QualificationPurposeV32_12;
  readonly policy: ExternalQualificationPolicyV32_12;
  readonly evaluatedAt: string;
  readonly keyRegistry: KeyRegistry;
  readonly authorizations: readonly QualificationKeyAuthorizationV32_12[];
  readonly bundles: readonly QualificationEvidenceBundleV32_12[];
  readonly observations: readonly QualificationArtifactObservationV32_12[];
  readonly previouslyConsumedNonces?: readonly string[];
  readonly previousWitnessCheckpoints?: readonly QualificationWitnessCheckpointV32_12[];
}

export interface ExternalGateIntegrityReportV32_12 {
  readonly gateId: string;
  readonly status: 'PASS' | 'BLOCK';
  readonly failures: readonly string[];
  readonly collectorStatementDigest: string;
  readonly reviewerStatementDigest: string;
  readonly witnessStatementDigest: string;
  readonly witnessKeyId: string;
  readonly checkpointSequence: number;
}

export interface ExternalQualificationIntegrityReportV32_12 {
  readonly version: '32.12';
  readonly purpose: QualificationPurposeV32_12;
  readonly status: 'QUALIFIED' | 'BLOCKED';
  readonly productionPromotion: 'eligible-for-authorized-decision' | 'blocked';
  readonly passedGates: number;
  readonly totalGates: number;
  readonly gateReports: readonly ExternalGateIntegrityReportV32_12[];
  readonly failures: readonly string[];
  readonly identity: {
    readonly runId: string;
    readonly sourceDigest: string;
    readonly artifactDigest: string;
    readonly toolchainDigest: string;
    readonly policyDigest: string;
  };
  readonly stateDelta: {
    readonly consumedNonces: readonly string[];
    readonly witnessCheckpoints: readonly QualificationWitnessCheckpointV32_12[];
  };
  readonly reportDigest: string;
}

const modeRank: Readonly<Record<QualificationExecutionMode, number>> = {
  'local-dry-run': 0,
  'independent-process': 1,
  'independent-host': 2,
  'independent-organization': 3,
};

export function computeExternalQualificationPolicyDigestV32_12(policy: Omit<ExternalQualificationPolicyV32_12, 'policyDigest'> | ExternalQualificationPolicyV32_12): string {
  const { policyDigest: _ignored, ...material } = policy as ExternalQualificationPolicyV32_12;
  return sha256(material);
}

export function evaluateExternalQualificationIntegrityV32_12(input: ExternalQualificationVerificationInputV32_12): ExternalQualificationIntegrityReportV32_12 {
  validatePolicy(input.policy, input.purpose);
  const evaluatedAtMs = parseCanonicalInstant(input.evaluatedAt, 'evaluated_at');
  const observations = observationMap(input.observations);
  const authorizations = authorizationList(input.authorizations);
  const consumed = new Set(input.previouslyConsumedNonces ?? []);
  const initialConsumed = new Set(consumed);
  const checkpoints = checkpointMap(input.previousWitnessCheckpoints ?? []);
  const seenGateIds = new Set<string>();
  const gateReports: ExternalGateIntegrityReportV32_12[] = [];
  const globalFailures: string[] = [];

  for (const bundle of input.bundles) {
    const gateId = bundle.collector.payload.identity.gateId;
    if (seenGateIds.has(gateId)) globalFailures.push(`duplicate_gate:${gateId}`);
    seenGateIds.add(gateId);
    const report = verifyGateBundle(bundle, input.policy, evaluatedAtMs, input.keyRegistry, authorizations, observations, consumed, checkpoints);
    gateReports.push(report);
    if (report.status === 'PASS') checkpoints.set(report.witnessKeyId, { witnessKeyId: report.witnessKeyId, checkpointSequence: report.checkpointSequence, statementDigest: report.witnessStatementDigest });
  }

  const expected = [...input.policy.requiredGateIds].sort();
  const actual = [...seenGateIds].sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) globalFailures.push('required_gate_set_mismatch');
  if (input.bundles.length !== input.policy.requiredGateIds.length) globalFailures.push('required_gate_count_mismatch');

  const passedGates = gateReports.filter((report) => report.status === 'PASS').length;
  const failures = [...new Set([...globalFailures, ...gateReports.flatMap((report) => report.failures.map((failure) => `${report.gateId}:${failure}`))])].sort();
  const status = failures.length === 0 && passedGates === input.policy.requiredGateIds.length ? 'QUALIFIED' as const : 'BLOCKED' as const;
  const productionEligible = status === 'QUALIFIED' && input.purpose === 'production';
  const material = {
    version: '32.12' as const,
    purpose: input.purpose,
    status,
    productionPromotion: productionEligible ? 'eligible-for-authorized-decision' as const : 'blocked' as const,
    passedGates,
    totalGates: input.policy.requiredGateIds.length,
    gateReports: gateReports.sort((a, b) => a.gateId.localeCompare(b.gateId)),
    failures,
    identity: {
      runId: input.policy.expectedRunId,
      sourceDigest: input.policy.expectedSourceDigest,
      artifactDigest: input.policy.expectedArtifactDigest,
      toolchainDigest: input.policy.expectedToolchainDigest,
      policyDigest: input.policy.policyDigest,
    },
    stateDelta: {
      consumedNonces: [...consumed].filter((nonce) => !initialConsumed.has(nonce)).sort(),
      witnessCheckpoints: [...checkpoints.values()].sort((a, b) => a.witnessKeyId.localeCompare(b.witnessKeyId)),
    },
  };
  return { ...material, reportDigest: sha256(material) };
}

function verifyGateBundle(
  bundle: QualificationEvidenceBundleV32_12,
  policy: ExternalQualificationPolicyV32_12,
  evaluatedAtMs: number,
  registry: KeyRegistry,
  authorizations: readonly QualificationKeyAuthorizationV32_12[],
  observations: ReadonlyMap<string, QualificationArtifactObservationV32_12>,
  consumed: Set<string>,
  checkpoints: ReadonlyMap<string, QualificationWitnessCheckpointV32_12>,
): ExternalGateIntegrityReportV32_12 {
  const collector = bundle.collector.payload;
  const reviewer = bundle.reviewer.payload;
  const witness = bundle.witness.payload;
  const gateId = collector.identity.gateId;
  const failures: string[] = [];
  const collectorDigest = sha256(collector);
  const reviewerDigest = sha256(reviewer);
  const witnessDigest = sha256(witness);

  validateIdentityTuple(collector.identity, policy, failures, 'collector');
  validateIdentityTuple(reviewer.identity, policy, failures, 'reviewer');
  validateIdentityTuple(witness.identity, policy, failures, 'witness');
  if (sha256(reviewer.identity) !== sha256(collector.identity) || sha256(witness.identity) !== sha256(collector.identity)) failures.push('identity_tuple_drift');

  if (collector.state !== 'passed') failures.push(`collector_state_not_passed:${collector.state}`);
  if (collector.evidenceClass !== 'OBSERVED') failures.push('evidence_not_observed');
  if (collector.synthetic) failures.push('synthetic_evidence_forbidden');
  if (modeRank[collector.executionMode] < modeRank[policy.minimumExecutionMode]) failures.push('execution_mode_below_policy');
  validateNonce(collector.challengeNonce, failures);
  if (reviewer.challengeNonce !== collector.challengeNonce || witness.challengeNonce !== collector.challengeNonce) failures.push('challenge_nonce_binding_mismatch');
  if (consumed.has(collector.challengeNonce)) failures.push('challenge_nonce_replayed');
  consumed.add(collector.challengeNonce);

  const startedAt = parseInstantInto(collector.startedAt, 'collector_started_at', failures);
  const completedAt = parseInstantInto(collector.completedAt, 'collector_completed_at', failures);
  const collectedAt = parseInstantInto(collector.collectedAt, 'collector_collected_at', failures);
  const reviewedAt = parseInstantInto(reviewer.reviewedAt, 'reviewed_at', failures);
  const witnessedAt = parseInstantInto(witness.witnessedAt, 'witnessed_at', failures);
  if (startedAt !== undefined && completedAt !== undefined && startedAt > completedAt) failures.push('collector_time_reversed');
  if (completedAt !== undefined && collectedAt !== undefined && completedAt > collectedAt) failures.push('collection_before_completion');
  if (collectedAt !== undefined && reviewedAt !== undefined && collectedAt > reviewedAt) failures.push('review_before_collection');
  if (reviewedAt !== undefined && witnessedAt !== undefined && reviewedAt > witnessedAt) failures.push('witness_before_review');
  for (const [label, value] of [['started', startedAt], ['completed', completedAt], ['collected', collectedAt], ['reviewed', reviewedAt], ['witnessed', witnessedAt]] as const) {
    if (value !== undefined && value > evaluatedAtMs + policy.maximumClockSkewMs) failures.push(`${label}_in_future`);
  }
  if (collectedAt !== undefined && evaluatedAtMs - collectedAt > policy.maximumEvidenceAgeMs) failures.push('evidence_stale');

  validateActor(collector.collector, collectedAt, registry, authorizations, gateId, 'collector', failures);
  validateActor(reviewer.reviewer, reviewedAt, registry, authorizations, gateId, 'reviewer', failures);
  validateActor(witness.witness, witnessedAt, registry, authorizations, gateId, 'witness', failures);
  validateSeparation(collector.collector, reviewer.reviewer, witness.witness, collector.executionMode, policy.requireWitness, failures);

  if (bundle.collector.issuerKeyId !== collector.collector.keyId) failures.push('collector_signer_identity_mismatch');
  if (bundle.reviewer.issuerKeyId !== reviewer.reviewer.keyId) failures.push('reviewer_signer_identity_mismatch');
  if (bundle.witness.issuerKeyId !== witness.witness.keyId) failures.push('witness_signer_identity_mismatch');
  if (collectedAt === undefined || !registry.verifyAt(bundle.collector, collector.collectedAt)) failures.push('collector_signature_invalid');
  if (reviewedAt === undefined || !registry.verifyAt(bundle.reviewer, reviewer.reviewedAt)) failures.push('reviewer_signature_invalid');
  if (policy.requireWitness && (witnessedAt === undefined || !registry.verifyAt(bundle.witness, witness.witnessedAt))) failures.push('witness_signature_invalid');

  if (reviewer.collectorStatementDigest !== collectorDigest) failures.push('reviewer_collector_digest_mismatch');
  const rawEvidenceDigest = sha256(collector.rawEvidence);
  if (reviewer.rawEvidenceDigest !== rawEvidenceDigest) failures.push('reviewer_raw_evidence_digest_mismatch');
  if (witness.collectorStatementDigest !== collectorDigest) failures.push('witness_collector_digest_mismatch');
  if (witness.reviewerStatementDigest !== reviewerDigest) failures.push('witness_reviewer_digest_mismatch');
  if (reviewer.verdict !== 'PASS') failures.push('reviewer_verdict_not_pass');
  if (reviewer.rationale.trim().length < 12) failures.push('reviewer_rationale_insufficient');
  validateWitnessCheckpoint(witness, witnessDigest, checkpoints, failures);

  validateRawEvidence(collector.rawEvidence, observations, startedAt, collectedAt, failures);

  return {
    gateId,
    status: failures.length === 0 ? 'PASS' : 'BLOCK',
    failures: [...new Set(failures)].sort(),
    collectorStatementDigest: collectorDigest,
    reviewerStatementDigest: reviewerDigest,
    witnessStatementDigest: witnessDigest,
    witnessKeyId: witness.witness.keyId,
    checkpointSequence: witness.checkpointSequence,
  };
}

function validatePolicy(policy: ExternalQualificationPolicyV32_12, purpose: QualificationPurposeV32_12): void {
  if (policy.schemaVersion !== '32.12' || policy.policyId.trim() === '') throw new Error('external_qualification_policy_invalid');
  for (const [label, value] of [['policy', policy.policyDigest], ['source', policy.expectedSourceDigest], ['artifact', policy.expectedArtifactDigest], ['toolchain', policy.expectedToolchainDigest]] as const) if (!isDigest(value)) throw new Error(`external_qualification_${label}_digest_invalid`);
  if (computeExternalQualificationPolicyDigestV32_12(policy) !== policy.policyDigest) throw new Error('external_qualification_policy_digest_mismatch');
  if (!validIdentifier(policy.expectedRunId)) throw new Error('external_qualification_run_id_invalid');
  if (!Number.isInteger(policy.maximumEvidenceAgeMs) || policy.maximumEvidenceAgeMs <= 0) throw new Error('external_qualification_maximum_age_invalid');
  if (!Number.isInteger(policy.maximumClockSkewMs) || policy.maximumClockSkewMs < 0 || policy.maximumClockSkewMs > 60_000) throw new Error('external_qualification_clock_skew_invalid');
  const ids = new Set(policy.requiredGateIds);
  if (ids.size === 0 || ids.size !== policy.requiredGateIds.length || policy.requiredGateIds.some((id) => !REQUIRED_EXTERNAL_GATE_IDS.includes(id))) throw new Error('external_qualification_required_gates_invalid');
  if (purpose === 'production') {
    const required = [...REQUIRED_EXTERNAL_GATE_IDS].sort();
    if (JSON.stringify([...ids].sort()) !== JSON.stringify(required)) throw new Error('external_qualification_production_requires_all_gates');
    if (policy.minimumExecutionMode !== 'independent-organization') throw new Error('external_qualification_production_mode_invalid');
    if (!policy.requireWitness) throw new Error('external_qualification_production_witness_required');
  }
}

function validateIdentityTuple(identity: QualificationIdentityTupleV32_12, policy: ExternalQualificationPolicyV32_12, failures: string[], role: string): void {
  if (identity.schemaVersion !== '32.12') failures.push(`${role}_schema_version_mismatch`);
  if (identity.runId !== policy.expectedRunId) failures.push(`${role}_run_id_mismatch`);
  if (identity.sourceDigest !== policy.expectedSourceDigest) failures.push(`${role}_source_digest_mismatch`);
  if (identity.artifactDigest !== policy.expectedArtifactDigest) failures.push(`${role}_artifact_digest_mismatch`);
  if (identity.toolchainDigest !== policy.expectedToolchainDigest) failures.push(`${role}_toolchain_digest_mismatch`);
  if (identity.policyDigest !== policy.policyDigest) failures.push(`${role}_policy_digest_mismatch`);
  if (!validIdentifier(identity.qualificationId)) failures.push(`${role}_qualification_id_invalid`);
  if (!REQUIRED_EXTERNAL_GATE_IDS.includes(identity.gateId)) failures.push(`${role}_gate_id_invalid`);
  if (!isDigest(identity.environmentFingerprint)) failures.push(`${role}_environment_fingerprint_invalid`);
  if (!/^v?\d+\.\d+(?:\.\d+)?(?:[-+][A-Za-z0-9._-]+)?$/.test(identity.adapterVersion)) failures.push(`${role}_adapter_version_invalid`);
}

function validateActor(actor: QualificationActorIdentityV32_12, actionAt: number | undefined, registry: KeyRegistry, authorizations: readonly QualificationKeyAuthorizationV32_12[], gateId: ExternalGateId, role: QualificationActorRoleV32_12, failures: string[]): void {
  for (const [label, value] of [['actor', actor.actorId], ['key', actor.keyId], ['process', actor.processId], ['host', actor.hostId], ['organization', actor.organizationId]] as const) if (!validIdentifier(value)) failures.push(`${role}_${label}_id_invalid`);
  if (!isDigest(actor.keyFingerprint)) failures.push(`${role}_key_fingerprint_invalid`);
  else if (registry.fingerprint(actor.keyId) !== actor.keyFingerprint) failures.push(`${role}_key_fingerprint_mismatch`);
  const authorization = authorizations.find((entry) => entry.role === role && entry.keyId === actor.keyId && entry.allowedGateIds.includes(gateId));
  if (authorization === undefined) failures.push(`${role}_key_not_authorized`);
  else {
    if (authorization.actorId !== actor.actorId) failures.push(`${role}_authorized_actor_mismatch`);
    if (authorization.organizationId !== actor.organizationId) failures.push(`${role}_authorized_organization_mismatch`);
    if (authorization.keyFingerprint !== actor.keyFingerprint) failures.push(`${role}_authorized_fingerprint_mismatch`);
    if (authorization.credentialValidFrom !== actor.credentialValidFrom || authorization.credentialValidUntil !== actor.credentialValidUntil) failures.push(`${role}_credential_claim_mismatch`);
  }
  const validFrom = parseInstantInto(actor.credentialValidFrom, `${role}_credential_valid_from`, failures);
  const validUntil = parseInstantInto(actor.credentialValidUntil, `${role}_credential_valid_until`, failures);
  if (validFrom !== undefined && validUntil !== undefined && validFrom >= validUntil) failures.push(`${role}_credential_interval_invalid`);
  if (actionAt !== undefined && validFrom !== undefined && actionAt < validFrom) failures.push(`${role}_credential_not_yet_valid`);
  if (actionAt !== undefined && validUntil !== undefined && actionAt > validUntil) failures.push(`${role}_credential_expired`);
  if (actionAt !== undefined && registry.isRevoked(actor.keyId, new Date(actionAt))) failures.push(`${role}_key_revoked`);
}

function validateSeparation(collector: QualificationActorIdentityV32_12, reviewer: QualificationActorIdentityV32_12, witness: QualificationActorIdentityV32_12, mode: QualificationExecutionMode, requireWitness: boolean, failures: string[]): void {
  const actors = [collector, reviewer, ...(requireWitness ? [witness] : [])];
  const unique = (field: keyof QualificationActorIdentityV32_12): boolean => new Set(actors.map((actor) => actor[field])).size === actors.length;
  if (!unique('actorId')) failures.push('actor_identity_not_independent');
  if (!unique('keyId') || !unique('keyFingerprint')) failures.push('signing_key_not_independent');
  if (modeRank[mode] >= modeRank['independent-process'] && !unique('processId')) failures.push('process_not_independent');
  if (modeRank[mode] >= modeRank['independent-host'] && !unique('hostId')) failures.push('host_not_independent');
  if (modeRank[mode] >= modeRank['independent-organization'] && !unique('organizationId')) failures.push('organization_not_independent');
}

function validateRawEvidence(raw: RawQualificationEvidenceReferenceV32_12, observations: ReadonlyMap<string, QualificationArtifactObservationV32_12>, startedAt: number | undefined, collectedAt: number | undefined, failures: string[]): void {
  if (!safeEvidencePath(raw.path)) failures.push('raw_evidence_path_unsafe');
  if (!isDigest(raw.sha256) || !Number.isInteger(raw.bytes) || raw.bytes <= 0) failures.push('raw_evidence_record_invalid');
  if (raw.externalResponseIds.length === 0 || new Set(raw.externalResponseIds).size !== raw.externalResponseIds.length || raw.externalResponseIds.some((id) => !validIdentifier(id))) failures.push('external_response_ids_invalid');
  const observation = observations.get(raw.path);
  if (observation === undefined) { failures.push('raw_evidence_observation_missing'); return; }
  if (observation.sha256 !== raw.sha256 || observation.bytes !== raw.bytes) failures.push('raw_evidence_digest_or_size_mismatch');
  const modifiedAt = parseInstantInto(observation.modifiedAt, 'raw_evidence_modified_at', failures);
  if (modifiedAt !== undefined && startedAt !== undefined && modifiedAt < startedAt) failures.push('raw_evidence_predates_execution');
  if (modifiedAt !== undefined && collectedAt !== undefined && modifiedAt > collectedAt) failures.push('raw_evidence_modified_after_collection');
}

function validateWitnessCheckpoint(witness: QualificationWitnessStatementV32_12, witnessDigest: string, checkpoints: ReadonlyMap<string, QualificationWitnessCheckpointV32_12>, failures: string[]): void {
  if (!Number.isInteger(witness.checkpointSequence) || witness.checkpointSequence < 1) { failures.push('witness_checkpoint_sequence_invalid'); return; }
  const prior = checkpoints.get(witness.witness.keyId);
  if (prior === undefined) {
    if (witness.checkpointSequence !== 1) failures.push('witness_checkpoint_initial_sequence_invalid');
    if (witness.previousCheckpointDigest !== null) failures.push('witness_checkpoint_initial_previous_not_null');
    return;
  }
  if (witness.checkpointSequence !== prior.checkpointSequence + 1) failures.push('witness_checkpoint_sequence_not_monotonic');
  if (witness.previousCheckpointDigest !== prior.statementDigest) failures.push('witness_previous_checkpoint_mismatch');
  if (witnessDigest === prior.statementDigest) failures.push('witness_checkpoint_digest_replayed');
}

function observationMap(observations: readonly QualificationArtifactObservationV32_12[]): ReadonlyMap<string, QualificationArtifactObservationV32_12> {
  const map = new Map<string, QualificationArtifactObservationV32_12>();
  for (const observation of observations) {
    if (map.has(observation.path)) throw new Error('external_qualification_observation_duplicate');
    map.set(observation.path, observation);
  }
  return map;
}

function authorizationList(authorizations: readonly QualificationKeyAuthorizationV32_12[]): readonly QualificationKeyAuthorizationV32_12[] {
  const seen = new Set<string>();
  for (const authorization of authorizations) {
    const key = `${authorization.role}:${authorization.keyId}`;
    if (seen.has(key)) throw new Error('external_qualification_authorization_duplicate');
    seen.add(key);
    if (!validIdentifier(authorization.actorId) || !validIdentifier(authorization.keyId) || !isDigest(authorization.keyFingerprint) || !validIdentifier(authorization.organizationId)) throw new Error('external_qualification_authorization_invalid');
    if (authorization.allowedGateIds.length === 0 || authorization.allowedGateIds.some((gateId) => !REQUIRED_EXTERNAL_GATE_IDS.includes(gateId))) throw new Error('external_qualification_authorization_gate_invalid');
    parseCanonicalInstant(authorization.credentialValidFrom, 'authorization_valid_from');
    parseCanonicalInstant(authorization.credentialValidUntil, 'authorization_valid_until');
  }
  return authorizations;
}

function checkpointMap(checkpoints: readonly QualificationWitnessCheckpointV32_12[]): Map<string, QualificationWitnessCheckpointV32_12> {
  const map = new Map<string, QualificationWitnessCheckpointV32_12>();
  for (const checkpoint of checkpoints) {
    if (!validIdentifier(checkpoint.witnessKeyId) || !Number.isInteger(checkpoint.checkpointSequence) || checkpoint.checkpointSequence < 1 || !isDigest(checkpoint.statementDigest)) throw new Error('external_qualification_checkpoint_invalid');
    if (map.has(checkpoint.witnessKeyId)) throw new Error('external_qualification_checkpoint_duplicate');
    map.set(checkpoint.witnessKeyId, checkpoint);
  }
  return map;
}

function validateNonce(value: string, failures: string[]): void {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(value)) failures.push('challenge_nonce_invalid');
}

function parseCanonicalInstant(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error(`${label}_invalid`);
  return parsed;
}

function parseInstantInto(value: string, label: string, failures: string[]): number | undefined {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) { failures.push(`${label}_invalid`); return undefined; }
  return parsed;
}

function safeEvidencePath(value: string): boolean {
  if (value.trim() === '' || isAbsolute(value) || value.includes('\\') || value.includes('\0')) return false;
  const normalized = posix.normalize(value);
  return normalized === value && !normalized.startsWith('../') && !normalized.includes('/../') && value.startsWith('external-qualification/');
}

function isDigest(value: string): boolean { return /^[0-9a-f]{64}$/.test(value); }
function validIdentifier(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,159}$/.test(value); }
