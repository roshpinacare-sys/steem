import { randomUUID } from 'node:crypto';
import {
  KeyRegistry,
  sha256,
  signEnvelope,
  type SignedEnvelope,
  type SigningIdentity,
} from '../contracts/crypto.js';
import type {
  ContinuityActorDescriptorV33_33,
  CoordinatorLeaseCertificateV33_33,
  EpochRotationCertificateV33_33,
  TransparencyPinCertificateV33_33,
} from './federated-checkpoint-continuity-v33_33.js';

export interface RecoveryWitnessDescriptorV33_34 extends ContinuityActorDescriptorV33_33 {
  readonly witnessId: string;
}

export interface RecoveryEpochPlanV33_34 {
  readonly version: '33.34';
  readonly drillId: string;
  readonly planId: string;
  readonly transitionOrdinal: 1 | 2;
  readonly studyId: string;
  readonly protocolDigest: string;
  readonly fromEpoch: number;
  readonly toEpoch: number;
  readonly sequenceFloor: number;
  readonly predecessorEpochCertificateDigest: string;
  readonly predecessorLeaseDigest: string;
  readonly predecessorPinDigest: string;
  readonly quorum: number;
  readonly currentWitnesses: readonly RecoveryWitnessDescriptorV33_34[];
  readonly nextWitnesses: readonly RecoveryWitnessDescriptorV33_34[];
  readonly unavailableWitnessKeyIds: readonly string[];
  readonly retainedWitnessKeyIds: readonly string[];
  readonly replacedWitnessKeyIds: readonly string[];
  readonly maximumUnavailable: number;
  readonly maximumReplacements: number;
  readonly recoveryAuthority: ContinuityActorDescriptorV33_33;
  readonly activationChallengeDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly planDigest: string;
}

export interface RecoveryWitnessVoteV33_34 {
  readonly version: '33.34';
  readonly voteId: string;
  readonly planDigest: string;
  readonly fromEpoch: number;
  readonly toEpoch: number;
  readonly sequenceFloor: number;
  readonly predecessorEpochCertificateDigest: string;
  readonly activationChallengeDigest: string;
  readonly witnessId: string;
  readonly witnessKeyId: string;
  readonly witnessOrganizationId: string;
  readonly witnessHostId: string;
  readonly availability: 'AVAILABLE';
  readonly decision: 'ACCEPT';
  readonly observedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly voteDigest: string;
}

export interface RecoveryWitnessActivationV33_34 {
  readonly version: '33.34';
  readonly activationId: string;
  readonly planDigest: string;
  readonly epoch: number;
  readonly activationChallengeDigest: string;
  readonly witnessId: string;
  readonly witnessKeyId: string;
  readonly witnessKeyFingerprint: string;
  readonly witnessOrganizationId: string;
  readonly witnessHostId: string;
  readonly activatedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly activationDigest: string;
}

export interface RecoveryEpochCertificateV33_34 {
  readonly version: '33.34';
  readonly certificateId: string;
  readonly drillId: string;
  readonly planDigest: string;
  readonly transitionOrdinal: 1 | 2;
  readonly fromEpoch: number;
  readonly toEpoch: number;
  readonly sequenceFloor: number;
  readonly predecessorEpochCertificateDigest: string;
  readonly predecessorLeaseDigest: string;
  readonly predecessorPinDigest: string;
  readonly quorumRequired: number;
  readonly witnessVoteDigests: readonly string[];
  readonly votingWitnessKeyIds: readonly string[];
  readonly activationDigests: readonly string[];
  readonly activatedWitnessKeyIds: readonly string[];
  readonly unavailableWitnessKeyIds: readonly string[];
  readonly retainedWitnessKeyIds: readonly string[];
  readonly replacedWitnessKeyIds: readonly string[];
  readonly nextWitnesses: readonly RecoveryWitnessDescriptorV33_34[];
  readonly issuedAt: string;
  readonly recoveryAuthorityKeyId: string;
  readonly recoveryAuthorityOrganizationId: string;
  readonly recoveryAuthorityHostId: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly certificateDigest: string;
}

export interface RecoveryEpochBundleV33_34 {
  readonly predecessorCertificate: SignedEnvelope<EpochRotationCertificateV33_33 | RecoveryEpochCertificateV33_34>;
  readonly plan: SignedEnvelope<RecoveryEpochPlanV33_34>;
  readonly witnessVotes: readonly SignedEnvelope<RecoveryWitnessVoteV33_34>[];
  readonly activations: readonly SignedEnvelope<RecoveryWitnessActivationV33_34>[];
  readonly certificate: SignedEnvelope<RecoveryEpochCertificateV33_34>;
}

export interface RecoveryEpochTrustV33_34 {
  readonly predecessorRegistry: KeyRegistry;
  readonly trustedPredecessorSignerIds: readonly string[];
  readonly planRegistry: KeyRegistry;
  readonly trustedPlanSignerIds: readonly string[];
  readonly currentWitnessRegistry: KeyRegistry;
  readonly trustedCurrentWitnessIds: readonly string[];
  readonly nextWitnessRegistry: KeyRegistry;
  readonly trustedNextWitnessIds: readonly string[];
  readonly recoveryAuthorityRegistry: KeyRegistry;
  readonly trustedRecoveryAuthorityIds: readonly string[];
}

export interface CoordinatorRelinquishmentV33_34 {
  readonly version: '33.34';
  readonly relinquishmentId: string;
  readonly predecessorLeaseDigest: string;
  readonly epoch: number;
  readonly term: number;
  readonly cutoverSequence: number;
  readonly outgoingCoordinatorKeyId: string;
  readonly outgoingCoordinatorOrganizationId: string;
  readonly outgoingCoordinatorHostId: string;
  readonly replacementCoordinator: ContinuityActorDescriptorV33_33;
  readonly reason: 'CONTROLLED_RECOVERY_DRILL';
  readonly relinquishedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly relinquishmentDigest: string;
}

export interface CoordinatorAcceptanceV33_34 {
  readonly version: '33.34';
  readonly acceptanceId: string;
  readonly predecessorLeaseDigest: string;
  readonly relinquishmentDigest: string;
  readonly epoch: number;
  readonly nextTerm: number;
  readonly sequenceStart: number;
  readonly sequenceEnd: number;
  readonly replacementCoordinatorKeyId: string;
  readonly replacementCoordinatorKeyFingerprint: string;
  readonly replacementCoordinatorOrganizationId: string;
  readonly replacementCoordinatorHostId: string;
  readonly acceptedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly acceptanceDigest: string;
}

export interface CoordinatorHandoffVoteV33_34 {
  readonly version: '33.34';
  readonly voteId: string;
  readonly predecessorLeaseDigest: string;
  readonly relinquishmentDigest: string;
  readonly acceptanceDigest: string;
  readonly epoch: number;
  readonly cutoverSequence: number;
  readonly replacementCoordinatorKeyId: string;
  readonly witnessId: string;
  readonly witnessKeyId: string;
  readonly witnessOrganizationId: string;
  readonly witnessHostId: string;
  readonly decision: 'ACCEPT';
  readonly observedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly voteDigest: string;
}

export interface CoordinatorHandoffCertificateV33_34 {
  readonly version: '33.34';
  readonly handoffId: string;
  readonly predecessorLeaseDigest: string;
  readonly epoch: number;
  readonly predecessorTerm: number;
  readonly nextTerm: number;
  readonly relinquishmentDigest: string;
  readonly acceptanceDigest: string;
  readonly cutoverSequence: number;
  readonly sequenceStart: number;
  readonly sequenceEnd: number;
  readonly outgoingCoordinatorKeyId: string;
  readonly replacementCoordinatorKeyId: string;
  readonly replacementCoordinatorOrganizationId: string;
  readonly replacementCoordinatorHostId: string;
  readonly quorumRequired: number;
  readonly witnessVoteDigests: readonly string[];
  readonly witnessKeyIds: readonly string[];
  readonly issuedAt: string;
  readonly recoveryAuthorityKeyId: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly handoffDigest: string;
}

export interface CoordinatorHandoffBundleV33_34 {
  readonly predecessorLease: SignedEnvelope<CoordinatorLeaseCertificateV33_33>;
  readonly relinquishment: SignedEnvelope<CoordinatorRelinquishmentV33_34>;
  readonly acceptance: SignedEnvelope<CoordinatorAcceptanceV33_34>;
  readonly witnessVotes: readonly SignedEnvelope<CoordinatorHandoffVoteV33_34>[];
  readonly certificate: SignedEnvelope<CoordinatorHandoffCertificateV33_34>;
}

export interface CoordinatorHandoffTrustV33_34 {
  readonly predecessorLeaseRegistry: KeyRegistry;
  readonly trustedPredecessorLeaseSignerIds: readonly string[];
  readonly outgoingCoordinatorRegistry: KeyRegistry;
  readonly trustedOutgoingCoordinatorIds: readonly string[];
  readonly replacementCoordinatorRegistry: KeyRegistry;
  readonly trustedReplacementCoordinatorIds: readonly string[];
  readonly witnessRegistry: KeyRegistry;
  readonly trustedWitnessIds: readonly string[];
  readonly witnesses: readonly RecoveryWitnessDescriptorV33_34[];
  readonly quorum: number;
  readonly recoveryAuthorityRegistry: KeyRegistry;
  readonly trustedRecoveryAuthorityIds: readonly string[];
}

export interface CoordinatorHandoffConflictV33_34 {
  readonly predecessorLeaseDigest: string;
  readonly conflictingHandoffDigests: readonly string[];
  readonly conflictingCoordinatorKeyIds: readonly string[];
  readonly overlapStart: number;
  readonly overlapEnd: number;
}

export interface RecoveryPublicationRequestV33_34 {
  readonly version: '33.34';
  readonly requestId: string;
  readonly drillId: string;
  readonly priorPinDigest: string;
  readonly firstRecoveryCertificateDigest: string;
  readonly secondRecoveryCertificateDigest: string;
  readonly handoffDigest: string;
  readonly finalEpoch: number;
  readonly sequenceFloor: number;
  readonly endpointId: string;
  readonly endpointUri: string;
  readonly publisher: ContinuityActorDescriptorV33_33;
  readonly publicationChallengeDigest: string;
  readonly previousPublicationReceiptDigest: string | null;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly requestDigest: string;
}

export interface RecoveryPublicationReceiptV33_34 {
  readonly version: '33.34';
  readonly receiptId: string;
  readonly requestDigest: string;
  readonly drillId: string;
  readonly priorPinDigest: string;
  readonly finalEpoch: number;
  readonly sequenceFloor: number;
  readonly endpointId: string;
  readonly endpointUri: string;
  readonly publisherKeyId: string;
  readonly publisherKeyFingerprint: string;
  readonly publisherOrganizationId: string;
  readonly publisherHostId: string;
  readonly publicationChallengeDigest: string;
  readonly previousPublicationReceiptDigest: string | null;
  readonly publishedObjectDigest: string;
  readonly publicationClass: 'LOCAL_REHEARSAL_ARTIFACT';
  readonly networkFetchObserved: false;
  readonly publishedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly receiptDigest: string;
}

export interface RecoveryPublicationBundleV33_34 {
  readonly priorPin: SignedEnvelope<TransparencyPinCertificateV33_33>;
  readonly request: SignedEnvelope<RecoveryPublicationRequestV33_34>;
  readonly previousReceipt: SignedEnvelope<RecoveryPublicationReceiptV33_34> | null;
  readonly receipt: SignedEnvelope<RecoveryPublicationReceiptV33_34>;
}

export interface RecoveryPublicationTrustV33_34 {
  readonly priorPinRegistry: KeyRegistry;
  readonly trustedPriorPinSignerIds: readonly string[];
  readonly requestRegistry: KeyRegistry;
  readonly trustedRequestSignerIds: readonly string[];
  readonly publisherRegistry: KeyRegistry;
  readonly trustedPublisherIds: readonly string[];
  readonly publisher: ContinuityActorDescriptorV33_33;
  readonly platformOwnerOrganizationId: string;
}

export interface RecoveryDrillVerdictV33_34 {
  readonly version: '33.34';
  readonly drillId: string;
  readonly firstRecoveryCertificateDigest: string;
  readonly secondRecoveryCertificateDigest: string;
  readonly handoffDigest: string;
  readonly publicationReceiptDigest: string;
  readonly initialEpoch: number;
  readonly finalEpoch: number;
  readonly sequenceFloor: number;
  readonly witnessLossRecovered: true;
  readonly consecutiveEpochRotationsVerified: true;
  readonly activeLeaseHandoffVerified: true;
  readonly splitBrainRejected: true;
  readonly transparencyPublicationBundleVerified: true;
  readonly externalTopologyObserved: false;
  readonly externalHumanParticipants: 0;
  readonly status: 'LOCAL_RECOVERY_REHEARSAL_ONLY_EXTERNAL_EXECUTION_REQUIRED';
  readonly generatedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly verdictDigest: string;
}

export function createRecoveryEpochPlanV33_34(input: {
  readonly planSigner: SigningIdentity;
  readonly drillId: string;
  readonly transitionOrdinal: 1 | 2;
  readonly studyId: string;
  readonly protocolDigest: string;
  readonly fromEpoch: number;
  readonly sequenceFloor: number;
  readonly predecessorCertificate: SignedEnvelope<EpochRotationCertificateV33_33 | RecoveryEpochCertificateV33_34>;
  readonly predecessorLeaseDigest: string;
  readonly predecessorPinDigest: string;
  readonly currentWitnesses: readonly RecoveryWitnessDescriptorV33_34[];
  readonly nextWitnesses: readonly RecoveryWitnessDescriptorV33_34[];
  readonly unavailableWitnessKeyIds: readonly string[];
  readonly quorum: number;
  readonly recoveryAuthority: ContinuityActorDescriptorV33_33;
  readonly activationChallengeDigest: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}): SignedEnvelope<RecoveryEpochPlanV33_34> {
  requireDate(input.issuedAt, 'v33_34_recovery_plan_time_invalid');
  requireDate(input.expiresAt, 'v33_34_recovery_plan_time_invalid');
  if (input.expiresAt.getTime() <= input.issuedAt.getTime()) throw new Error('v33_34_recovery_plan_window_invalid');
  const currentWitnesses = normalizeWitnesses(input.currentWitnesses);
  const nextWitnesses = normalizeWitnesses(input.nextWitnesses);
  const unavailableWitnessKeyIds = uniqueSorted(input.unavailableWitnessKeyIds);
  if (currentWitnesses.length !== 5 || nextWitnesses.length !== 5) throw new Error('v33_34_recovery_witness_count_invalid');
  if (!Number.isInteger(input.quorum) || input.quorum < 3 || input.quorum > 5) throw new Error('v33_34_recovery_quorum_invalid');
  const currentKeys = new Set(currentWitnesses.map((row) => row.keyId));
  if (!unavailableWitnessKeyIds.every((key) => currentKeys.has(key))) throw new Error('v33_34_unavailable_witness_unknown');
  const maximumUnavailable = currentWitnesses.length - input.quorum;
  if (unavailableWitnessKeyIds.length > maximumUnavailable) throw new Error('v33_34_unavailable_witness_quorum_lost');
  const retainedWitnessKeyIds = nextWitnesses.map((row) => row.keyId).filter((key) => currentKeys.has(key)).sort();
  const replacedWitnessKeyIds = currentWitnesses.map((row) => row.keyId).filter((key) => !nextWitnesses.some((next) => next.keyId === key)).sort();
  const maximumReplacements = currentWitnesses.length - input.quorum;
  if (replacedWitnessKeyIds.length > maximumReplacements || retainedWitnessKeyIds.length < input.quorum) throw new Error('v33_34_recovery_replacement_limit_exceeded');
  if (!unavailableWitnessKeyIds.every((key) => replacedWitnessKeyIds.includes(key))) throw new Error('v33_34_unavailable_witness_not_replaced');
  ensureTopologyDistinct([...currentWitnesses, input.recoveryAuthority], 'v33_34_recovery_current_topology_invalid');
  ensureTopologyDistinct([...nextWitnesses, input.recoveryAuthority], 'v33_34_recovery_next_topology_invalid');
  const predecessor = input.predecessorCertificate.payload;
  const predecessorDigest = predecessor.version === '33.33' ? predecessor.certificateDigest : predecessor.certificateDigest;
  const predecessorToEpoch = predecessor.toEpoch;
  const predecessorSequenceFloor = predecessor.sequenceFloor;
  if (predecessorToEpoch !== input.fromEpoch || predecessorSequenceFloor !== input.sequenceFloor) throw new Error('v33_34_recovery_predecessor_continuity_invalid');
  if (input.transitionOrdinal === 2 && predecessor.version !== '33.34') throw new Error('v33_34_second_transition_predecessor_invalid');
  if (input.transitionOrdinal === 1 && predecessor.version !== '33.33') throw new Error('v33_34_first_transition_predecessor_invalid');
  if (predecessor.version === '33.34' && !sameWitnessSet(currentWitnesses, predecessor.nextWitnesses)) throw new Error('v33_34_recovery_witness_chain_invalid');
  const material = {
    version: '33.34' as const,
    drillId: identifier(input.drillId, 'v33_34_drill_id_invalid'),
    planId: randomUUID(),
    transitionOrdinal: input.transitionOrdinal,
    studyId: identifier(input.studyId, 'v33_34_study_id_invalid'),
    protocolDigest: digest(input.protocolDigest, 'v33_34_protocol_digest_invalid'),
    fromEpoch: integer(input.fromEpoch, 1, 'v33_34_from_epoch_invalid'),
    toEpoch: input.fromEpoch + 1,
    sequenceFloor: integer(input.sequenceFloor, 0, 'v33_34_sequence_floor_invalid'),
    predecessorEpochCertificateDigest: predecessorDigest,
    predecessorLeaseDigest: digest(input.predecessorLeaseDigest, 'v33_34_predecessor_lease_invalid'),
    predecessorPinDigest: digest(input.predecessorPinDigest, 'v33_34_predecessor_pin_invalid'),
    quorum: input.quorum,
    currentWitnesses,
    nextWitnesses,
    unavailableWitnessKeyIds,
    retainedWitnessKeyIds,
    replacedWitnessKeyIds,
    maximumUnavailable,
    maximumReplacements,
    recoveryAuthority: normalizeActor(input.recoveryAuthority, 'v33_34_recovery_authority'),
    activationChallengeDigest: digest(input.activationChallengeDigest, 'v33_34_activation_challenge_invalid'),
    issuedAt: input.issuedAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, planDigest: sha256(material) }, input.planSigner);
}

export function createRecoveryWitnessVoteV33_34(input: {
  readonly witness: SigningIdentity;
  readonly plan: SignedEnvelope<RecoveryEpochPlanV33_34>;
  readonly observedAt: Date;
}): SignedEnvelope<RecoveryWitnessVoteV33_34> {
  requireDate(input.observedAt, 'v33_34_recovery_vote_time_invalid');
  const plan = input.plan.payload;
  const descriptor = plan.currentWitnesses.find((row) => row.keyId === input.witness.keyId);
  if (descriptor === undefined || plan.unavailableWitnessKeyIds.includes(input.witness.keyId)) throw new Error('v33_34_recovery_voter_unavailable');
  const material = {
    version: '33.34' as const,
    voteId: randomUUID(),
    planDigest: plan.planDigest,
    fromEpoch: plan.fromEpoch,
    toEpoch: plan.toEpoch,
    sequenceFloor: plan.sequenceFloor,
    predecessorEpochCertificateDigest: plan.predecessorEpochCertificateDigest,
    activationChallengeDigest: plan.activationChallengeDigest,
    witnessId: descriptor.witnessId,
    witnessKeyId: descriptor.keyId,
    witnessOrganizationId: descriptor.organizationId,
    witnessHostId: descriptor.hostId,
    availability: 'AVAILABLE' as const,
    decision: 'ACCEPT' as const,
    observedAt: input.observedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, voteDigest: sha256(material) }, input.witness);
}

export function createRecoveryWitnessActivationV33_34(input: {
  readonly witness: SigningIdentity;
  readonly plan: SignedEnvelope<RecoveryEpochPlanV33_34>;
  readonly activatedAt: Date;
}): SignedEnvelope<RecoveryWitnessActivationV33_34> {
  requireDate(input.activatedAt, 'v33_34_recovery_activation_time_invalid');
  const plan = input.plan.payload;
  const descriptor = plan.nextWitnesses.find((row) => row.keyId === input.witness.keyId);
  if (descriptor === undefined) throw new Error('v33_34_recovery_activation_not_enrolled');
  const material = {
    version: '33.34' as const,
    activationId: randomUUID(),
    planDigest: plan.planDigest,
    epoch: plan.toEpoch,
    activationChallengeDigest: plan.activationChallengeDigest,
    witnessId: descriptor.witnessId,
    witnessKeyId: descriptor.keyId,
    witnessKeyFingerprint: descriptor.keyFingerprint,
    witnessOrganizationId: descriptor.organizationId,
    witnessHostId: descriptor.hostId,
    activatedAt: input.activatedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, activationDigest: sha256(material) }, input.witness);
}

export function finalizeRecoveryEpochV33_34(input: {
  readonly recoveryAuthority: SigningIdentity;
  readonly predecessorCertificate: SignedEnvelope<EpochRotationCertificateV33_33 | RecoveryEpochCertificateV33_34>;
  readonly plan: SignedEnvelope<RecoveryEpochPlanV33_34>;
  readonly witnessVotes: readonly SignedEnvelope<RecoveryWitnessVoteV33_34>[];
  readonly activations: readonly SignedEnvelope<RecoveryWitnessActivationV33_34>[];
  readonly trust: RecoveryEpochTrustV33_34;
  readonly issuedAt: Date;
}): RecoveryEpochBundleV33_34 {
  const partial = { predecessorCertificate: input.predecessorCertificate, plan: input.plan, witnessVotes: input.witnessVotes, activations: input.activations };
  const core = verifyRecoveryEpochCore(partial, input.trust, input.issuedAt);
  if (input.recoveryAuthority.keyId !== core.plan.recoveryAuthority.keyId) throw new Error('v33_34_recovery_authority_signer_invalid');
  const material = {
    version: '33.34' as const,
    certificateId: randomUUID(),
    drillId: core.plan.drillId,
    planDigest: core.plan.planDigest,
    transitionOrdinal: core.plan.transitionOrdinal,
    fromEpoch: core.plan.fromEpoch,
    toEpoch: core.plan.toEpoch,
    sequenceFloor: core.plan.sequenceFloor,
    predecessorEpochCertificateDigest: core.plan.predecessorEpochCertificateDigest,
    predecessorLeaseDigest: core.plan.predecessorLeaseDigest,
    predecessorPinDigest: core.plan.predecessorPinDigest,
    quorumRequired: core.plan.quorum,
    witnessVoteDigests: core.votes.map((row) => row.voteDigest).sort(),
    votingWitnessKeyIds: core.votes.map((row) => row.witnessKeyId).sort(),
    activationDigests: core.activations.map((row) => row.activationDigest).sort(),
    activatedWitnessKeyIds: core.activations.map((row) => row.witnessKeyId).sort(),
    unavailableWitnessKeyIds: [...core.plan.unavailableWitnessKeyIds],
    retainedWitnessKeyIds: [...core.plan.retainedWitnessKeyIds],
    replacedWitnessKeyIds: [...core.plan.replacedWitnessKeyIds],
    nextWitnesses: core.plan.nextWitnesses,
    issuedAt: input.issuedAt.toISOString(),
    recoveryAuthorityKeyId: core.plan.recoveryAuthority.keyId,
    recoveryAuthorityOrganizationId: core.plan.recoveryAuthority.organizationId,
    recoveryAuthorityHostId: core.plan.recoveryAuthority.hostId,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  const certificate = signEnvelope({ ...material, certificateDigest: sha256(material) }, input.recoveryAuthority);
  return { ...partial, certificate };
}

export function verifyRecoveryEpochV33_34(input: {
  readonly bundle: RecoveryEpochBundleV33_34;
  readonly trust: RecoveryEpochTrustV33_34;
  readonly verifiedAt: Date;
}): RecoveryEpochCertificateV33_34 {
  const core = verifyRecoveryEpochCore(input.bundle, input.trust, input.verifiedAt);
  const envelope = input.bundle.certificate;
  if (!input.trust.trustedRecoveryAuthorityIds.includes(envelope.issuerKeyId) || !input.trust.recoveryAuthorityRegistry.verifyAt(envelope, input.verifiedAt)) throw new Error('v33_34_recovery_certificate_signature_invalid');
  const certificate = verifyDigest(envelope.payload, 'certificateDigest', 'v33_34_recovery_certificate_digest_invalid');
  if (certificate.recoveryAuthorityKeyId !== envelope.issuerKeyId || certificate.recoveryAuthorityKeyId !== core.plan.recoveryAuthority.keyId || certificate.recoveryAuthorityOrganizationId !== core.plan.recoveryAuthority.organizationId || certificate.recoveryAuthorityHostId !== core.plan.recoveryAuthority.hostId) throw new Error('v33_34_recovery_certificate_authority_binding_invalid');
  if (certificate.planDigest !== core.plan.planDigest || certificate.drillId !== core.plan.drillId || certificate.transitionOrdinal !== core.plan.transitionOrdinal || certificate.fromEpoch !== core.plan.fromEpoch || certificate.toEpoch !== core.plan.toEpoch || certificate.sequenceFloor !== core.plan.sequenceFloor || certificate.predecessorEpochCertificateDigest !== core.plan.predecessorEpochCertificateDigest || certificate.predecessorLeaseDigest !== core.plan.predecessorLeaseDigest || certificate.predecessorPinDigest !== core.plan.predecessorPinDigest || certificate.quorumRequired !== core.plan.quorum || !sameSet(certificate.witnessVoteDigests, core.votes.map((row) => row.voteDigest)) || !sameSet(certificate.votingWitnessKeyIds, core.votes.map((row) => row.witnessKeyId)) || !sameSet(certificate.activationDigests, core.activations.map((row) => row.activationDigest)) || !sameSet(certificate.activatedWitnessKeyIds, core.activations.map((row) => row.witnessKeyId)) || !sameSet(certificate.unavailableWitnessKeyIds, core.plan.unavailableWitnessKeyIds) || !sameSet(certificate.retainedWitnessKeyIds, core.plan.retainedWitnessKeyIds) || !sameSet(certificate.replacedWitnessKeyIds, core.plan.replacedWitnessKeyIds) || !sameWitnessSet(certificate.nextWitnesses, core.plan.nextWitnesses)) throw new Error('v33_34_recovery_certificate_binding_invalid');
  enforceBoundary(certificate, 'v33_34_recovery_certificate_boundary_invalid');
  return certificate;
}

export function createCoordinatorRelinquishmentV33_34(input: {
  readonly outgoingCoordinator: SigningIdentity;
  readonly outgoingCoordinatorDescriptor: ContinuityActorDescriptorV33_33;
  readonly replacementCoordinator: ContinuityActorDescriptorV33_33;
  readonly predecessorLease: SignedEnvelope<CoordinatorLeaseCertificateV33_33>;
  readonly cutoverSequence: number;
  readonly relinquishedAt: Date;
}): SignedEnvelope<CoordinatorRelinquishmentV33_34> {
  requireDate(input.relinquishedAt, 'v33_34_relinquishment_time_invalid');
  const lease = input.predecessorLease.payload;
  if (input.outgoingCoordinator.keyId !== lease.coordinatorKeyId || input.outgoingCoordinatorDescriptor.keyId !== lease.coordinatorKeyId) throw new Error('v33_34_relinquishment_outgoing_invalid');
  if (sameActor(input.outgoingCoordinatorDescriptor, input.replacementCoordinator)) throw new Error('v33_34_relinquishment_same_coordinator');
  if (input.cutoverSequence < lease.sequenceStart || input.cutoverSequence >= lease.sequenceEnd) throw new Error('v33_34_relinquishment_cutover_invalid');
  const material = {
    version: '33.34' as const,
    relinquishmentId: randomUUID(),
    predecessorLeaseDigest: lease.leaseDigest,
    epoch: lease.epoch,
    term: lease.term,
    cutoverSequence: input.cutoverSequence,
    outgoingCoordinatorKeyId: input.outgoingCoordinatorDescriptor.keyId,
    outgoingCoordinatorOrganizationId: input.outgoingCoordinatorDescriptor.organizationId,
    outgoingCoordinatorHostId: input.outgoingCoordinatorDescriptor.hostId,
    replacementCoordinator: normalizeActor(input.replacementCoordinator, 'v33_34_replacement_coordinator'),
    reason: 'CONTROLLED_RECOVERY_DRILL' as const,
    relinquishedAt: input.relinquishedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, relinquishmentDigest: sha256(material) }, input.outgoingCoordinator);
}

export function createCoordinatorAcceptanceV33_34(input: {
  readonly replacementCoordinator: SigningIdentity;
  readonly predecessorLease: SignedEnvelope<CoordinatorLeaseCertificateV33_33>;
  readonly relinquishment: SignedEnvelope<CoordinatorRelinquishmentV33_34>;
  readonly acceptedAt: Date;
}): SignedEnvelope<CoordinatorAcceptanceV33_34> {
  requireDate(input.acceptedAt, 'v33_34_acceptance_time_invalid');
  const lease = input.predecessorLease.payload;
  const relinquishment = input.relinquishment.payload;
  if (input.replacementCoordinator.keyId !== relinquishment.replacementCoordinator.keyId) throw new Error('v33_34_acceptance_coordinator_invalid');
  const material = {
    version: '33.34' as const,
    acceptanceId: randomUUID(),
    predecessorLeaseDigest: lease.leaseDigest,
    relinquishmentDigest: relinquishment.relinquishmentDigest,
    epoch: lease.epoch,
    nextTerm: lease.term + 1,
    sequenceStart: relinquishment.cutoverSequence + 1,
    sequenceEnd: lease.sequenceEnd,
    replacementCoordinatorKeyId: relinquishment.replacementCoordinator.keyId,
    replacementCoordinatorKeyFingerprint: relinquishment.replacementCoordinator.keyFingerprint,
    replacementCoordinatorOrganizationId: relinquishment.replacementCoordinator.organizationId,
    replacementCoordinatorHostId: relinquishment.replacementCoordinator.hostId,
    acceptedAt: input.acceptedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, acceptanceDigest: sha256(material) }, input.replacementCoordinator);
}

export function createCoordinatorHandoffVoteV33_34(input: {
  readonly witness: SigningIdentity;
  readonly witnessDescriptor: RecoveryWitnessDescriptorV33_34;
  readonly predecessorLease: SignedEnvelope<CoordinatorLeaseCertificateV33_33>;
  readonly relinquishment: SignedEnvelope<CoordinatorRelinquishmentV33_34>;
  readonly acceptance: SignedEnvelope<CoordinatorAcceptanceV33_34>;
  readonly observedAt: Date;
}): SignedEnvelope<CoordinatorHandoffVoteV33_34> {
  requireDate(input.observedAt, 'v33_34_handoff_vote_time_invalid');
  if (input.witness.keyId !== input.witnessDescriptor.keyId) throw new Error('v33_34_handoff_vote_witness_invalid');
  const lease = input.predecessorLease.payload;
  const relinquishment = input.relinquishment.payload;
  const acceptance = input.acceptance.payload;
  const material = {
    version: '33.34' as const,
    voteId: randomUUID(),
    predecessorLeaseDigest: lease.leaseDigest,
    relinquishmentDigest: relinquishment.relinquishmentDigest,
    acceptanceDigest: acceptance.acceptanceDigest,
    epoch: lease.epoch,
    cutoverSequence: relinquishment.cutoverSequence,
    replacementCoordinatorKeyId: acceptance.replacementCoordinatorKeyId,
    witnessId: input.witnessDescriptor.witnessId,
    witnessKeyId: input.witnessDescriptor.keyId,
    witnessOrganizationId: input.witnessDescriptor.organizationId,
    witnessHostId: input.witnessDescriptor.hostId,
    decision: 'ACCEPT' as const,
    observedAt: input.observedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, voteDigest: sha256(material) }, input.witness);
}

export function finalizeCoordinatorHandoffV33_34(input: {
  readonly recoveryAuthority: SigningIdentity;
  readonly predecessorLease: SignedEnvelope<CoordinatorLeaseCertificateV33_33>;
  readonly relinquishment: SignedEnvelope<CoordinatorRelinquishmentV33_34>;
  readonly acceptance: SignedEnvelope<CoordinatorAcceptanceV33_34>;
  readonly witnessVotes: readonly SignedEnvelope<CoordinatorHandoffVoteV33_34>[];
  readonly trust: CoordinatorHandoffTrustV33_34;
  readonly issuedAt: Date;
}): CoordinatorHandoffBundleV33_34 {
  const partial = { predecessorLease: input.predecessorLease, relinquishment: input.relinquishment, acceptance: input.acceptance, witnessVotes: input.witnessVotes };
  const core = verifyCoordinatorHandoffCore(partial, input.trust, input.issuedAt);
  if (input.recoveryAuthority.keyId !== input.trust.trustedRecoveryAuthorityIds[0] && !input.trust.trustedRecoveryAuthorityIds.includes(input.recoveryAuthority.keyId)) throw new Error('v33_34_handoff_authority_signer_invalid');
  const material = {
    version: '33.34' as const,
    handoffId: randomUUID(),
    predecessorLeaseDigest: core.lease.leaseDigest,
    epoch: core.lease.epoch,
    predecessorTerm: core.lease.term,
    nextTerm: core.acceptance.nextTerm,
    relinquishmentDigest: core.relinquishment.relinquishmentDigest,
    acceptanceDigest: core.acceptance.acceptanceDigest,
    cutoverSequence: core.relinquishment.cutoverSequence,
    sequenceStart: core.acceptance.sequenceStart,
    sequenceEnd: core.acceptance.sequenceEnd,
    outgoingCoordinatorKeyId: core.relinquishment.outgoingCoordinatorKeyId,
    replacementCoordinatorKeyId: core.acceptance.replacementCoordinatorKeyId,
    replacementCoordinatorOrganizationId: core.acceptance.replacementCoordinatorOrganizationId,
    replacementCoordinatorHostId: core.acceptance.replacementCoordinatorHostId,
    quorumRequired: input.trust.quorum,
    witnessVoteDigests: core.votes.map((row) => row.voteDigest).sort(),
    witnessKeyIds: core.votes.map((row) => row.witnessKeyId).sort(),
    issuedAt: input.issuedAt.toISOString(),
    recoveryAuthorityKeyId: input.recoveryAuthority.keyId,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  const certificate = signEnvelope({ ...material, handoffDigest: sha256(material) }, input.recoveryAuthority);
  return { ...partial, certificate };
}

export function verifyCoordinatorHandoffV33_34(input: {
  readonly bundle: CoordinatorHandoffBundleV33_34;
  readonly trust: CoordinatorHandoffTrustV33_34;
  readonly verifiedAt: Date;
}): CoordinatorHandoffCertificateV33_34 {
  const core = verifyCoordinatorHandoffCore(input.bundle, input.trust, input.verifiedAt);
  const envelope = input.bundle.certificate;
  if (!input.trust.trustedRecoveryAuthorityIds.includes(envelope.issuerKeyId) || !input.trust.recoveryAuthorityRegistry.verifyAt(envelope, input.verifiedAt)) throw new Error('v33_34_handoff_certificate_signature_invalid');
  const certificate = verifyDigest(envelope.payload, 'handoffDigest', 'v33_34_handoff_certificate_digest_invalid');
  if (certificate.recoveryAuthorityKeyId !== envelope.issuerKeyId || certificate.predecessorLeaseDigest !== core.lease.leaseDigest || certificate.epoch !== core.lease.epoch || certificate.predecessorTerm !== core.lease.term || certificate.nextTerm !== core.acceptance.nextTerm || certificate.relinquishmentDigest !== core.relinquishment.relinquishmentDigest || certificate.acceptanceDigest !== core.acceptance.acceptanceDigest || certificate.cutoverSequence !== core.relinquishment.cutoverSequence || certificate.sequenceStart !== core.acceptance.sequenceStart || certificate.sequenceEnd !== core.acceptance.sequenceEnd || certificate.outgoingCoordinatorKeyId !== core.relinquishment.outgoingCoordinatorKeyId || certificate.replacementCoordinatorKeyId !== core.acceptance.replacementCoordinatorKeyId || certificate.replacementCoordinatorOrganizationId !== core.acceptance.replacementCoordinatorOrganizationId || certificate.replacementCoordinatorHostId !== core.acceptance.replacementCoordinatorHostId || certificate.quorumRequired !== input.trust.quorum || !sameSet(certificate.witnessVoteDigests, core.votes.map((row) => row.voteDigest)) || !sameSet(certificate.witnessKeyIds, core.votes.map((row) => row.witnessKeyId))) throw new Error('v33_34_handoff_certificate_binding_invalid');
  enforceBoundary(certificate, 'v33_34_handoff_certificate_boundary_invalid');
  return certificate;
}

export function detectCoordinatorHandoffConflictsV33_34(certificates: readonly SignedEnvelope<CoordinatorHandoffCertificateV33_34>[]): readonly CoordinatorHandoffConflictV33_34[] {
  const groups = new Map<string, SignedEnvelope<CoordinatorHandoffCertificateV33_34>[] >();
  for (const certificate of certificates) groups.set(certificate.payload.predecessorLeaseDigest, [...(groups.get(certificate.payload.predecessorLeaseDigest) ?? []), certificate]);
  const findings: CoordinatorHandoffConflictV33_34[] = [];
  for (const group of groups.values()) {
    const distinct = new Map(group.map((row) => [row.payload.handoffDigest, row]));
    if (distinct.size <= 1) continue;
    const rows = [...distinct.values()];
    const overlapStart = Math.max(...rows.map((row) => row.payload.sequenceStart));
    const overlapEnd = Math.min(...rows.map((row) => row.payload.sequenceEnd));
    if (overlapStart <= overlapEnd || new Set(rows.map((row) => row.payload.replacementCoordinatorKeyId)).size > 1) findings.push({
      predecessorLeaseDigest: rows[0]!.payload.predecessorLeaseDigest,
      conflictingHandoffDigests: rows.map((row) => row.payload.handoffDigest).sort(),
      conflictingCoordinatorKeyIds: [...new Set(rows.map((row) => row.payload.replacementCoordinatorKeyId))].sort(),
      overlapStart,
      overlapEnd,
    });
  }
  return findings;
}

export function createRecoveryPublicationRequestV33_34(input: {
  readonly requestSigner: SigningIdentity;
  readonly drillId: string;
  readonly priorPin: SignedEnvelope<TransparencyPinCertificateV33_33>;
  readonly firstRecovery: SignedEnvelope<RecoveryEpochCertificateV33_34>;
  readonly secondRecovery: SignedEnvelope<RecoveryEpochCertificateV33_34>;
  readonly handoff: SignedEnvelope<CoordinatorHandoffCertificateV33_34>;
  readonly endpointId: string;
  readonly endpointUri: string;
  readonly publisher: ContinuityActorDescriptorV33_33;
  readonly publicationChallengeDigest: string;
  readonly previousReceipt: SignedEnvelope<RecoveryPublicationReceiptV33_34> | null;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}): SignedEnvelope<RecoveryPublicationRequestV33_34> {
  requireDate(input.issuedAt, 'v33_34_publication_request_time_invalid');
  requireDate(input.expiresAt, 'v33_34_publication_request_time_invalid');
  if (input.expiresAt.getTime() <= input.issuedAt.getTime()) throw new Error('v33_34_publication_request_window_invalid');
  const first = input.firstRecovery.payload;
  const second = input.secondRecovery.payload;
  if (first.drillId !== input.drillId || second.drillId !== input.drillId || first.transitionOrdinal !== 1 || second.transitionOrdinal !== 2 || second.predecessorEpochCertificateDigest !== first.certificateDigest || second.fromEpoch !== first.toEpoch || second.sequenceFloor !== first.sequenceFloor) throw new Error('v33_34_publication_recovery_chain_invalid');
  const uri = validEndpointUri(input.endpointUri);
  const material = {
    version: '33.34' as const,
    requestId: randomUUID(),
    drillId: identifier(input.drillId, 'v33_34_publication_drill_invalid'),
    priorPinDigest: input.priorPin.payload.pinDigest,
    firstRecoveryCertificateDigest: first.certificateDigest,
    secondRecoveryCertificateDigest: second.certificateDigest,
    handoffDigest: input.handoff.payload.handoffDigest,
    finalEpoch: second.toEpoch,
    sequenceFloor: second.sequenceFloor,
    endpointId: identifier(input.endpointId, 'v33_34_endpoint_id_invalid'),
    endpointUri: uri,
    publisher: normalizeActor(input.publisher, 'v33_34_publisher'),
    publicationChallengeDigest: digest(input.publicationChallengeDigest, 'v33_34_publication_challenge_invalid'),
    previousPublicationReceiptDigest: input.previousReceipt?.payload.receiptDigest ?? null,
    issuedAt: input.issuedAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, requestDigest: sha256(material) }, input.requestSigner);
}

export function createRecoveryPublicationReceiptV33_34(input: {
  readonly publisher: SigningIdentity;
  readonly request: SignedEnvelope<RecoveryPublicationRequestV33_34>;
  readonly priorPin: SignedEnvelope<TransparencyPinCertificateV33_33>;
  readonly previousReceipt: SignedEnvelope<RecoveryPublicationReceiptV33_34> | null;
  readonly publishedAt: Date;
}): SignedEnvelope<RecoveryPublicationReceiptV33_34> {
  requireDate(input.publishedAt, 'v33_34_publication_receipt_time_invalid');
  const request = input.request.payload;
  if (input.publisher.keyId !== request.publisher.keyId) throw new Error('v33_34_publication_publisher_invalid');
  if ((input.previousReceipt?.payload.receiptDigest ?? null) !== request.previousPublicationReceiptDigest) throw new Error('v33_34_publication_predecessor_invalid');
  const publishedObjectDigest = sha256({
    priorPinDigest: request.priorPinDigest,
    firstRecoveryCertificateDigest: request.firstRecoveryCertificateDigest,
    secondRecoveryCertificateDigest: request.secondRecoveryCertificateDigest,
    handoffDigest: request.handoffDigest,
    finalEpoch: request.finalEpoch,
    sequenceFloor: request.sequenceFloor,
  });
  const material = {
    version: '33.34' as const,
    receiptId: randomUUID(),
    requestDigest: request.requestDigest,
    drillId: request.drillId,
    priorPinDigest: input.priorPin.payload.pinDigest,
    finalEpoch: request.finalEpoch,
    sequenceFloor: request.sequenceFloor,
    endpointId: request.endpointId,
    endpointUri: request.endpointUri,
    publisherKeyId: request.publisher.keyId,
    publisherKeyFingerprint: request.publisher.keyFingerprint,
    publisherOrganizationId: request.publisher.organizationId,
    publisherHostId: request.publisher.hostId,
    publicationChallengeDigest: request.publicationChallengeDigest,
    previousPublicationReceiptDigest: request.previousPublicationReceiptDigest,
    publishedObjectDigest,
    publicationClass: 'LOCAL_REHEARSAL_ARTIFACT' as const,
    networkFetchObserved: false as const,
    publishedAt: input.publishedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, receiptDigest: sha256(material) }, input.publisher);
}

export function verifyRecoveryPublicationV33_34(input: {
  readonly bundle: RecoveryPublicationBundleV33_34;
  readonly trust: RecoveryPublicationTrustV33_34;
  readonly verifiedAt: Date;
}): RecoveryPublicationReceiptV33_34 {
  requireDate(input.verifiedAt, 'v33_34_publication_verify_time_invalid');
  const pinEnvelope = input.bundle.priorPin;
  if (!input.trust.trustedPriorPinSignerIds.includes(pinEnvelope.issuerKeyId) || !input.trust.priorPinRegistry.verifyAt(pinEnvelope, input.verifiedAt)) throw new Error('v33_34_publication_pin_signature_invalid');
  const requestEnvelope = input.bundle.request;
  if (!input.trust.trustedRequestSignerIds.includes(requestEnvelope.issuerKeyId) || !input.trust.requestRegistry.verifyAt(requestEnvelope, input.verifiedAt)) throw new Error('v33_34_publication_request_signature_invalid');
  const request = verifyDigest(requestEnvelope.payload, 'requestDigest', 'v33_34_publication_request_digest_invalid');
  if (Date.parse(request.issuedAt) > input.verifiedAt.getTime() || Date.parse(request.expiresAt) <= input.verifiedAt.getTime()) throw new Error('v33_34_publication_request_not_active');
  if (!sameActor(request.publisher, input.trust.publisher) || input.trust.publisher.organizationId === input.trust.platformOwnerOrganizationId) throw new Error('v33_34_publication_topology_invalid');
  if (input.trust.publisherRegistry.fingerprint(request.publisher.keyId) !== request.publisher.keyFingerprint) throw new Error('v33_34_publication_publisher_fingerprint_invalid');
  if (request.priorPinDigest !== pinEnvelope.payload.pinDigest || request.previousPublicationReceiptDigest !== (input.bundle.previousReceipt?.payload.receiptDigest ?? null)) throw new Error('v33_34_publication_request_binding_invalid');
  if (input.bundle.previousReceipt !== null) {
    const previous = input.bundle.previousReceipt;
    if (!input.trust.trustedPublisherIds.includes(previous.issuerKeyId) || !input.trust.publisherRegistry.verifyAt(previous, input.verifiedAt)) throw new Error('v33_34_publication_previous_receipt_signature_invalid');
    verifyDigest(previous.payload, 'receiptDigest', 'v33_34_publication_previous_receipt_digest_invalid');
  }
  const receiptEnvelope = input.bundle.receipt;
  if (!input.trust.trustedPublisherIds.includes(receiptEnvelope.issuerKeyId) || !input.trust.publisherRegistry.verifyAt(receiptEnvelope, input.verifiedAt)) throw new Error('v33_34_publication_receipt_signature_invalid');
  const receipt = verifyDigest(receiptEnvelope.payload, 'receiptDigest', 'v33_34_publication_receipt_digest_invalid');
  const expectedObjectDigest = sha256({ priorPinDigest: request.priorPinDigest, firstRecoveryCertificateDigest: request.firstRecoveryCertificateDigest, secondRecoveryCertificateDigest: request.secondRecoveryCertificateDigest, handoffDigest: request.handoffDigest, finalEpoch: request.finalEpoch, sequenceFloor: request.sequenceFloor });
  if (receipt.requestDigest !== request.requestDigest || receipt.drillId !== request.drillId || receipt.priorPinDigest !== request.priorPinDigest || receipt.finalEpoch !== request.finalEpoch || receipt.sequenceFloor !== request.sequenceFloor || receipt.endpointId !== request.endpointId || receipt.endpointUri !== request.endpointUri || receipt.publisherKeyId !== request.publisher.keyId || receipt.publisherKeyFingerprint !== request.publisher.keyFingerprint || receipt.publisherOrganizationId !== request.publisher.organizationId || receipt.publisherHostId !== request.publisher.hostId || receipt.publicationChallengeDigest !== request.publicationChallengeDigest || receipt.previousPublicationReceiptDigest !== request.previousPublicationReceiptDigest || receipt.publishedObjectDigest !== expectedObjectDigest || receipt.publicationClass !== 'LOCAL_REHEARSAL_ARTIFACT' || receipt.networkFetchObserved !== false) throw new Error('v33_34_publication_receipt_binding_invalid');
  enforceBoundary(receipt, 'v33_34_publication_receipt_boundary_invalid');
  return receipt;
}

export function finalizeRecoveryDrillV33_34(input: {
  readonly verifier: SigningIdentity;
  readonly firstRecovery: RecoveryEpochBundleV33_34;
  readonly firstRecoveryTrust: RecoveryEpochTrustV33_34;
  readonly secondRecovery: RecoveryEpochBundleV33_34;
  readonly secondRecoveryTrust: RecoveryEpochTrustV33_34;
  readonly handoff: CoordinatorHandoffBundleV33_34;
  readonly handoffTrust: CoordinatorHandoffTrustV33_34;
  readonly publication: RecoveryPublicationBundleV33_34;
  readonly publicationTrust: RecoveryPublicationTrustV33_34;
  readonly generatedAt: Date;
}): SignedEnvelope<RecoveryDrillVerdictV33_34> {
  const first = verifyRecoveryEpochV33_34({ bundle: input.firstRecovery, trust: input.firstRecoveryTrust, verifiedAt: input.generatedAt });
  const second = verifyRecoveryEpochV33_34({ bundle: input.secondRecovery, trust: input.secondRecoveryTrust, verifiedAt: input.generatedAt });
  const handoff = verifyCoordinatorHandoffV33_34({ bundle: input.handoff, trust: input.handoffTrust, verifiedAt: input.generatedAt });
  const publication = verifyRecoveryPublicationV33_34({ bundle: input.publication, trust: input.publicationTrust, verifiedAt: input.generatedAt });
  if (first.transitionOrdinal !== 1 || second.transitionOrdinal !== 2 || second.predecessorEpochCertificateDigest !== first.certificateDigest || second.fromEpoch !== first.toEpoch || second.sequenceFloor !== first.sequenceFloor || first.predecessorLeaseDigest !== handoff.predecessorLeaseDigest || second.predecessorLeaseDigest !== handoff.predecessorLeaseDigest || publication.finalEpoch !== second.toEpoch || publication.sequenceFloor !== second.sequenceFloor || input.publication.request.payload.firstRecoveryCertificateDigest !== first.certificateDigest || input.publication.request.payload.secondRecoveryCertificateDigest !== second.certificateDigest || input.publication.request.payload.handoffDigest !== handoff.handoffDigest) throw new Error('v33_34_drill_chain_invalid');
  if (detectCoordinatorHandoffConflictsV33_34([input.handoff.certificate]).length !== 0) throw new Error('v33_34_drill_split_brain_detected');
  const material = {
    version: '33.34' as const,
    drillId: first.drillId,
    firstRecoveryCertificateDigest: first.certificateDigest,
    secondRecoveryCertificateDigest: second.certificateDigest,
    handoffDigest: handoff.handoffDigest,
    publicationReceiptDigest: publication.receiptDigest,
    initialEpoch: first.fromEpoch,
    finalEpoch: second.toEpoch,
    sequenceFloor: second.sequenceFloor,
    witnessLossRecovered: true as const,
    consecutiveEpochRotationsVerified: true as const,
    activeLeaseHandoffVerified: true as const,
    splitBrainRejected: true as const,
    transparencyPublicationBundleVerified: true as const,
    externalTopologyObserved: false as const,
    externalHumanParticipants: 0 as const,
    status: 'LOCAL_RECOVERY_REHEARSAL_ONLY_EXTERNAL_EXECUTION_REQUIRED' as const,
    generatedAt: input.generatedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, verdictDigest: sha256(material) }, input.verifier);
}

function verifyRecoveryEpochCore(input: Omit<RecoveryEpochBundleV33_34, 'certificate'> | RecoveryEpochBundleV33_34, trust: RecoveryEpochTrustV33_34, now: Date): { plan: RecoveryEpochPlanV33_34; votes: readonly RecoveryWitnessVoteV33_34[]; activations: readonly RecoveryWitnessActivationV33_34[] } {
  requireDate(now, 'v33_34_recovery_verify_time_invalid');
  const predecessorEnvelope = input.predecessorCertificate;
  if (!trust.trustedPredecessorSignerIds.includes(predecessorEnvelope.issuerKeyId) || !trust.predecessorRegistry.verifyAt(predecessorEnvelope, now)) throw new Error('v33_34_recovery_predecessor_signature_invalid');
  const predecessor = predecessorEnvelope.payload;
  const predecessorDigest = predecessor.version === '33.33' ? verifyDigest(predecessor, 'certificateDigest', 'v33_34_recovery_predecessor_digest_invalid').certificateDigest : verifyDigest(predecessor, 'certificateDigest', 'v33_34_recovery_predecessor_digest_invalid').certificateDigest;
  const planEnvelope = input.plan;
  if (!trust.trustedPlanSignerIds.includes(planEnvelope.issuerKeyId) || !trust.planRegistry.verifyAt(planEnvelope, now)) throw new Error('v33_34_recovery_plan_signature_invalid');
  const plan = verifyDigest(planEnvelope.payload, 'planDigest', 'v33_34_recovery_plan_digest_invalid');
  if (Date.parse(plan.issuedAt) > now.getTime() || Date.parse(plan.expiresAt) <= now.getTime()) throw new Error('v33_34_recovery_plan_not_active');
  if (plan.predecessorEpochCertificateDigest !== predecessorDigest || plan.fromEpoch !== predecessor.toEpoch || plan.toEpoch !== plan.fromEpoch + 1 || plan.sequenceFloor !== predecessor.sequenceFloor) throw new Error('v33_34_recovery_plan_predecessor_binding_invalid');
  if (plan.transitionOrdinal === 1 && predecessor.version !== '33.33') throw new Error('v33_34_first_transition_predecessor_invalid');
  if (plan.transitionOrdinal === 2 && (predecessor.version !== '33.34' || !sameWitnessSet(plan.currentWitnesses, predecessor.nextWitnesses))) throw new Error('v33_34_second_transition_predecessor_invalid');
  if (!trust.trustedRecoveryAuthorityIds.includes(plan.recoveryAuthority.keyId) || trust.recoveryAuthorityRegistry.fingerprint(plan.recoveryAuthority.keyId) !== plan.recoveryAuthority.keyFingerprint) throw new Error('v33_34_recovery_authority_trust_invalid');
  const currentWitnesses = normalizeWitnesses(plan.currentWitnesses);
  const nextWitnesses = normalizeWitnesses(plan.nextWitnesses);
  ensureTopologyDistinct([...currentWitnesses, plan.recoveryAuthority], 'v33_34_recovery_current_topology_invalid');
  ensureTopologyDistinct([...nextWitnesses, plan.recoveryAuthority], 'v33_34_recovery_next_topology_invalid');
  for (const witness of currentWitnesses) if (!trust.trustedCurrentWitnessIds.includes(witness.keyId) || trust.currentWitnessRegistry.fingerprint(witness.keyId) !== witness.keyFingerprint) throw new Error('v33_34_recovery_current_witness_trust_invalid');
  for (const witness of nextWitnesses) if (!trust.trustedNextWitnessIds.includes(witness.keyId) || trust.nextWitnessRegistry.fingerprint(witness.keyId) !== witness.keyFingerprint) throw new Error('v33_34_recovery_next_witness_trust_invalid');
  if (plan.quorum < 3 || plan.quorum > 5 || plan.maximumUnavailable !== 5 - plan.quorum || plan.maximumReplacements !== 5 - plan.quorum || plan.unavailableWitnessKeyIds.length > plan.maximumUnavailable || plan.replacedWitnessKeyIds.length > plan.maximumReplacements || plan.retainedWitnessKeyIds.length < plan.quorum || !plan.unavailableWitnessKeyIds.every((key) => plan.replacedWitnessKeyIds.includes(key))) throw new Error('v33_34_recovery_plan_constraints_invalid');
  enforceBoundary(plan, 'v33_34_recovery_plan_boundary_invalid');
  const votes = input.witnessVotes.map((envelope) => {
    if (!trust.trustedCurrentWitnessIds.includes(envelope.issuerKeyId) || !trust.currentWitnessRegistry.verifyAt(envelope, now)) throw new Error('v33_34_recovery_vote_signature_invalid');
    const vote = verifyDigest(envelope.payload, 'voteDigest', 'v33_34_recovery_vote_digest_invalid');
    const descriptor = currentWitnesses.find((row) => row.keyId === vote.witnessKeyId);
    if (descriptor === undefined || envelope.issuerKeyId !== vote.witnessKeyId || plan.unavailableWitnessKeyIds.includes(vote.witnessKeyId) || vote.witnessId !== descriptor.witnessId || vote.witnessOrganizationId !== descriptor.organizationId || vote.witnessHostId !== descriptor.hostId || vote.planDigest !== plan.planDigest || vote.fromEpoch !== plan.fromEpoch || vote.toEpoch !== plan.toEpoch || vote.sequenceFloor !== plan.sequenceFloor || vote.predecessorEpochCertificateDigest !== plan.predecessorEpochCertificateDigest || vote.activationChallengeDigest !== plan.activationChallengeDigest || vote.availability !== 'AVAILABLE' || vote.decision !== 'ACCEPT') throw new Error('v33_34_recovery_vote_binding_invalid');
    enforceBoundary(vote, 'v33_34_recovery_vote_boundary_invalid');
    return vote;
  });
  ensureTopologyDistinct(votes.map((row) => ({ keyId: row.witnessKeyId, keyFingerprint: trust.currentWitnessRegistry.fingerprint(row.witnessKeyId) ?? '', organizationId: row.witnessOrganizationId, hostId: row.witnessHostId })), 'v33_34_recovery_vote_topology_invalid');
  if (votes.length < plan.quorum) throw new Error('v33_34_recovery_vote_quorum_not_met');
  const activations = input.activations.map((envelope) => {
    if (!trust.trustedNextWitnessIds.includes(envelope.issuerKeyId) || !trust.nextWitnessRegistry.verifyAt(envelope, now)) throw new Error('v33_34_recovery_activation_signature_invalid');
    const activation = verifyDigest(envelope.payload, 'activationDigest', 'v33_34_recovery_activation_digest_invalid');
    const descriptor = nextWitnesses.find((row) => row.keyId === activation.witnessKeyId);
    if (descriptor === undefined || envelope.issuerKeyId !== activation.witnessKeyId || activation.planDigest !== plan.planDigest || activation.epoch !== plan.toEpoch || activation.activationChallengeDigest !== plan.activationChallengeDigest || activation.witnessId !== descriptor.witnessId || activation.witnessKeyFingerprint !== descriptor.keyFingerprint || activation.witnessOrganizationId !== descriptor.organizationId || activation.witnessHostId !== descriptor.hostId) throw new Error('v33_34_recovery_activation_binding_invalid');
    enforceBoundary(activation, 'v33_34_recovery_activation_boundary_invalid');
    return activation;
  });
  ensureTopologyDistinct(activations.map((row) => ({ keyId: row.witnessKeyId, keyFingerprint: row.witnessKeyFingerprint, organizationId: row.witnessOrganizationId, hostId: row.witnessHostId })), 'v33_34_recovery_activation_topology_invalid');
  if (!sameSet(activations.map((row) => row.witnessKeyId), nextWitnesses.map((row) => row.keyId))) throw new Error('v33_34_recovery_activation_incomplete');
  return { plan, votes, activations };
}

function verifyCoordinatorHandoffCore(input: Omit<CoordinatorHandoffBundleV33_34, 'certificate'> | CoordinatorHandoffBundleV33_34, trust: CoordinatorHandoffTrustV33_34, now: Date): { lease: CoordinatorLeaseCertificateV33_33; relinquishment: CoordinatorRelinquishmentV33_34; acceptance: CoordinatorAcceptanceV33_34; votes: readonly CoordinatorHandoffVoteV33_34[] } {
  requireDate(now, 'v33_34_handoff_verify_time_invalid');
  if (trust.quorum < 3 || trust.quorum > trust.witnesses.length) throw new Error('v33_34_handoff_quorum_invalid');
  ensureTopologyDistinct(trust.witnesses, 'v33_34_handoff_witness_topology_invalid');
  const leaseEnvelope = input.predecessorLease;
  if (!trust.trustedPredecessorLeaseSignerIds.includes(leaseEnvelope.issuerKeyId) || !trust.predecessorLeaseRegistry.verifyAt(leaseEnvelope, now)) throw new Error('v33_34_handoff_lease_signature_invalid');
  const lease = verifyDigest(leaseEnvelope.payload, 'leaseDigest', 'v33_34_handoff_lease_digest_invalid');
  const relinquishmentEnvelope = input.relinquishment;
  if (!trust.trustedOutgoingCoordinatorIds.includes(relinquishmentEnvelope.issuerKeyId) || !trust.outgoingCoordinatorRegistry.verifyAt(relinquishmentEnvelope, now)) throw new Error('v33_34_relinquishment_signature_invalid');
  const relinquishment = verifyDigest(relinquishmentEnvelope.payload, 'relinquishmentDigest', 'v33_34_relinquishment_digest_invalid');
  if (relinquishmentEnvelope.issuerKeyId !== lease.coordinatorKeyId || relinquishment.outgoingCoordinatorKeyId !== lease.coordinatorKeyId || relinquishment.predecessorLeaseDigest !== lease.leaseDigest || relinquishment.epoch !== lease.epoch || relinquishment.term !== lease.term || relinquishment.cutoverSequence < lease.sequenceStart || relinquishment.cutoverSequence >= lease.sequenceEnd || Date.parse(relinquishment.relinquishedAt) > Date.parse(lease.expiresAt)) throw new Error('v33_34_relinquishment_binding_invalid');
  const acceptanceEnvelope = input.acceptance;
  if (!trust.trustedReplacementCoordinatorIds.includes(acceptanceEnvelope.issuerKeyId) || !trust.replacementCoordinatorRegistry.verifyAt(acceptanceEnvelope, now)) throw new Error('v33_34_acceptance_signature_invalid');
  const acceptance = verifyDigest(acceptanceEnvelope.payload, 'acceptanceDigest', 'v33_34_acceptance_digest_invalid');
  if (acceptanceEnvelope.issuerKeyId !== relinquishment.replacementCoordinator.keyId || trust.replacementCoordinatorRegistry.fingerprint(acceptance.replacementCoordinatorKeyId) !== acceptance.replacementCoordinatorKeyFingerprint || acceptance.predecessorLeaseDigest !== lease.leaseDigest || acceptance.relinquishmentDigest !== relinquishment.relinquishmentDigest || acceptance.epoch !== lease.epoch || acceptance.nextTerm !== lease.term + 1 || acceptance.sequenceStart !== relinquishment.cutoverSequence + 1 || acceptance.sequenceEnd !== lease.sequenceEnd || acceptance.replacementCoordinatorKeyId !== relinquishment.replacementCoordinator.keyId || acceptance.replacementCoordinatorOrganizationId !== relinquishment.replacementCoordinator.organizationId || acceptance.replacementCoordinatorHostId !== relinquishment.replacementCoordinator.hostId) throw new Error('v33_34_acceptance_binding_invalid');
  enforceBoundary(relinquishment, 'v33_34_relinquishment_boundary_invalid');
  enforceBoundary(acceptance, 'v33_34_acceptance_boundary_invalid');
  const votes = input.witnessVotes.map((envelope) => {
    if (!trust.trustedWitnessIds.includes(envelope.issuerKeyId) || !trust.witnessRegistry.verifyAt(envelope, now)) throw new Error('v33_34_handoff_vote_signature_invalid');
    const vote = verifyDigest(envelope.payload, 'voteDigest', 'v33_34_handoff_vote_digest_invalid');
    const witness = trust.witnesses.find((row) => row.keyId === vote.witnessKeyId);
    if (witness === undefined || envelope.issuerKeyId !== vote.witnessKeyId || vote.witnessId !== witness.witnessId || vote.witnessOrganizationId !== witness.organizationId || vote.witnessHostId !== witness.hostId || vote.predecessorLeaseDigest !== lease.leaseDigest || vote.relinquishmentDigest !== relinquishment.relinquishmentDigest || vote.acceptanceDigest !== acceptance.acceptanceDigest || vote.epoch !== lease.epoch || vote.cutoverSequence !== relinquishment.cutoverSequence || vote.replacementCoordinatorKeyId !== acceptance.replacementCoordinatorKeyId || vote.decision !== 'ACCEPT') throw new Error('v33_34_handoff_vote_binding_invalid');
    enforceBoundary(vote, 'v33_34_handoff_vote_boundary_invalid');
    return vote;
  });
  ensureTopologyDistinct(votes.map((row) => ({ keyId: row.witnessKeyId, keyFingerprint: trust.witnessRegistry.fingerprint(row.witnessKeyId) ?? '', organizationId: row.witnessOrganizationId, hostId: row.witnessHostId })), 'v33_34_handoff_vote_topology_invalid');
  if (votes.length < trust.quorum) throw new Error('v33_34_handoff_vote_quorum_not_met');
  return { lease, relinquishment, acceptance, votes };
}

function normalizeWitnesses(input: readonly RecoveryWitnessDescriptorV33_34[]): RecoveryWitnessDescriptorV33_34[] {
  const rows = input.map((row) => ({ witnessId: identifier(row.witnessId, 'v33_34_witness_id_invalid'), ...normalizeActor(row, 'v33_34_witness') })).sort((a, b) => a.keyId.localeCompare(b.keyId));
  ensureTopologyDistinct(rows, 'v33_34_witness_topology_duplicate');
  return rows;
}

function normalizeActor(input: ContinuityActorDescriptorV33_33, prefix: string): ContinuityActorDescriptorV33_33 {
  return {
    keyId: identifier(input.keyId, `${prefix}_key_invalid`),
    keyFingerprint: digest(input.keyFingerprint, `${prefix}_fingerprint_invalid`),
    organizationId: identifier(input.organizationId, `${prefix}_organization_invalid`),
    hostId: identifier(input.hostId, `${prefix}_host_invalid`),
  };
}

function ensureTopologyDistinct(rows: readonly ContinuityActorDescriptorV33_33[], error: string): void {
  if (new Set(rows.map((row) => row.keyId)).size !== rows.length || new Set(rows.map((row) => row.organizationId)).size !== rows.length || new Set(rows.map((row) => row.hostId)).size !== rows.length) throw new Error(error);
}

function sameActor(left: ContinuityActorDescriptorV33_33, right: ContinuityActorDescriptorV33_33): boolean {
  return left.keyId === right.keyId && left.keyFingerprint === right.keyFingerprint && left.organizationId === right.organizationId && left.hostId === right.hostId;
}

function sameWitnessSet(left: readonly RecoveryWitnessDescriptorV33_34[], right: readonly RecoveryWitnessDescriptorV33_34[]): boolean {
  const normalize = (rows: readonly RecoveryWitnessDescriptorV33_34[]) => rows.map((row) => `${row.witnessId}|${row.keyId}|${row.keyFingerprint}|${row.organizationId}|${row.hostId}`).sort();
  return sameSet(normalize(left), normalize(right));
}

function enforceBoundary(value: { readonly productionAuthority: string; readonly externalEffectsExecuted: number }, error: string): void {
  if (value.productionAuthority !== 'NONE' || value.externalEffectsExecuted !== 0) throw new Error(error);
}

function verifyDigest<T extends object, K extends keyof T>(payload: T, key: K, error: string): T {
  const copy = { ...payload } as T & Record<PropertyKey, unknown>;
  const actual = copy[key];
  delete copy[key];
  if (typeof actual !== 'string' || actual !== sha256(copy)) throw new Error(error);
  return payload;
}

function digest(value: string, error: string): string {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(error);
  return value;
}

function identifier(value: string, error: string): string {
  const normalized = value.trim();
  if (normalized.length < 2 || normalized.length > 200 || !/^[A-Za-z0-9._:/-]+$/.test(normalized)) throw new Error(error);
  return normalized;
}

function integer(value: number, minimum: number, error: string): number {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(error);
  return value;
}

function uniqueSorted(values: readonly string[]): string[] {
  const rows = values.map((value) => identifier(value, 'v33_34_key_id_invalid'));
  if (new Set(rows).size !== rows.length) throw new Error('v33_34_duplicate_key_id');
  return rows.sort();
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function validEndpointUri(value: string): string {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error('v33_34_endpoint_uri_invalid'); }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '' || parsed.hash !== '') throw new Error('v33_34_endpoint_uri_invalid');
  return parsed.toString();
}

function requireDate(value: Date, error: string): void {
  if (!Number.isFinite(value.getTime())) throw new Error(error);
}
