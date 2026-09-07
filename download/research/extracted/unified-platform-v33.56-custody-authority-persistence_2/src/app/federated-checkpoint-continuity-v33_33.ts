import { randomUUID } from 'node:crypto';
import {
  KeyRegistry,
  sha256,
  signEnvelope,
  type SignedEnvelope,
  type SigningIdentity,
} from '../contracts/crypto.js';
import type {
  FederatedCheckpointAnchorV33_32,
  FederatedCheckpointWitnessDescriptorV33_32,
  FederatedCheckpointWitnessPolicyV33_32,
} from './federated-human-pilot-checkpoint-v33_32.js';

export interface ContinuityActorDescriptorV33_33 {
  readonly keyId: string;
  readonly keyFingerprint: string;
  readonly organizationId: string;
  readonly hostId: string;
}

export interface WitnessEpochRotationPlanV33_33 {
  readonly version: '33.33';
  readonly rotationId: string;
  readonly studyId: string;
  readonly protocolDigest: string;
  readonly fromPolicyDigest: string;
  readonly fromEpoch: number;
  readonly toEpoch: number;
  readonly sequenceFloor: number;
  readonly predecessorAnchorDigest: string;
  readonly predecessorCheckpointDigest: string;
  readonly quorum: number;
  readonly witnesses: readonly FederatedCheckpointWitnessDescriptorV33_32[];
  readonly retainedWitnessKeyIds: readonly string[];
  readonly replacedWitnessKeyIds: readonly string[];
  readonly maximumReplacements: number;
  readonly importer: ContinuityActorDescriptorV33_33;
  readonly coordinator: ContinuityActorDescriptorV33_33;
  readonly rotationAuthority: ContinuityActorDescriptorV33_33;
  readonly activationChallengeDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly planDigest: string;
}

export interface WitnessActivationProofV33_33 {
  readonly version: '33.33';
  readonly proofId: string;
  readonly planDigest: string;
  readonly epoch: number;
  readonly witnessId: string;
  readonly witnessKeyId: string;
  readonly witnessKeyFingerprint: string;
  readonly witnessOrganizationId: string;
  readonly witnessHostId: string;
  readonly activationChallengeDigest: string;
  readonly activatedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly proofDigest: string;
}

export interface EpochRotationVoteV33_33 {
  readonly version: '33.33';
  readonly voteId: string;
  readonly planDigest: string;
  readonly fromPolicyDigest: string;
  readonly fromEpoch: number;
  readonly toEpoch: number;
  readonly sequenceFloor: number;
  readonly predecessorAnchorDigest: string;
  readonly voterKeyId: string;
  readonly voterOrganizationId: string;
  readonly voterHostId: string;
  readonly decision: 'ACCEPT';
  readonly observedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly voteDigest: string;
}

export interface EpochRotationCertificateV33_33 {
  readonly version: '33.33';
  readonly certificateId: string;
  readonly planDigest: string;
  readonly fromPolicyDigest: string;
  readonly fromEpoch: number;
  readonly toEpoch: number;
  readonly sequenceFloor: number;
  readonly predecessorAnchorDigest: string;
  readonly predecessorCheckpointDigest: string;
  readonly quorumRequired: number;
  readonly oldWitnessVoteDigests: readonly string[];
  readonly oldWitnessKeyIds: readonly string[];
  readonly activationProofDigests: readonly string[];
  readonly activatedWitnessKeyIds: readonly string[];
  readonly issuedAt: string;
  readonly rotationAuthorityKeyId: string;
  readonly rotationAuthorityOrganizationId: string;
  readonly rotationAuthorityHostId: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly certificateDigest: string;
}

export interface EpochRotationBundleV33_33 {
  readonly currentPolicy: SignedEnvelope<FederatedCheckpointWitnessPolicyV33_32>;
  readonly currentAnchor: SignedEnvelope<FederatedCheckpointAnchorV33_32>;
  readonly plan: SignedEnvelope<WitnessEpochRotationPlanV33_33>;
  readonly oldWitnessVotes: readonly SignedEnvelope<EpochRotationVoteV33_33>[];
  readonly activationProofs: readonly SignedEnvelope<WitnessActivationProofV33_33>[];
  readonly certificate: SignedEnvelope<EpochRotationCertificateV33_33>;
}

export interface EpochRotationTrustV33_33 {
  readonly currentPolicyRegistry: KeyRegistry;
  readonly trustedCurrentPolicySignerIds: readonly string[];
  readonly currentAnchorRegistry: KeyRegistry;
  readonly trustedCurrentAnchorSignerIds: readonly string[];
  readonly currentWitnessRegistry: KeyRegistry;
  readonly trustedCurrentWitnessIds: readonly string[];
  readonly nextWitnessRegistry: KeyRegistry;
  readonly trustedNextWitnessIds: readonly string[];
  readonly planRegistry: KeyRegistry;
  readonly trustedPlanSignerIds: readonly string[];
  readonly rotationAuthorityRegistry: KeyRegistry;
  readonly trustedRotationAuthorityIds: readonly string[];
}

export interface CoordinatorLeaseProposalV33_33 {
  readonly version: '33.33';
  readonly proposalId: string;
  readonly planDigest: string;
  readonly epoch: number;
  readonly term: number;
  readonly previousLeaseDigest: string | null;
  readonly sequenceStart: number;
  readonly sequenceEnd: number;
  readonly coordinatorKeyId: string;
  readonly coordinatorKeyFingerprint: string;
  readonly coordinatorOrganizationId: string;
  readonly coordinatorHostId: string;
  readonly notBefore: string;
  readonly expiresAt: string;
  readonly proposedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly proposalDigest: string;
}

export interface CoordinatorLeaseVoteV33_33 {
  readonly version: '33.33';
  readonly voteId: string;
  readonly planDigest: string;
  readonly proposalDigest: string;
  readonly epoch: number;
  readonly term: number;
  readonly sequenceStart: number;
  readonly sequenceEnd: number;
  readonly coordinatorKeyId: string;
  readonly witnessKeyId: string;
  readonly witnessOrganizationId: string;
  readonly witnessHostId: string;
  readonly decision: 'ACCEPT';
  readonly observedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly voteDigest: string;
}

export interface CoordinatorLeaseCertificateV33_33 {
  readonly version: '33.33';
  readonly leaseId: string;
  readonly planDigest: string;
  readonly proposalDigest: string;
  readonly epoch: number;
  readonly term: number;
  readonly previousLeaseDigest: string | null;
  readonly sequenceStart: number;
  readonly sequenceEnd: number;
  readonly coordinatorKeyId: string;
  readonly coordinatorOrganizationId: string;
  readonly coordinatorHostId: string;
  readonly quorumRequired: number;
  readonly witnessVoteDigests: readonly string[];
  readonly witnessKeyIds: readonly string[];
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly rotationAuthorityKeyId: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly leaseDigest: string;
}

export interface CoordinatorLeaseBundleV33_33 {
  readonly plan: SignedEnvelope<WitnessEpochRotationPlanV33_33>;
  readonly previousLease: SignedEnvelope<CoordinatorLeaseCertificateV33_33> | null;
  readonly proposal: SignedEnvelope<CoordinatorLeaseProposalV33_33>;
  readonly votes: readonly SignedEnvelope<CoordinatorLeaseVoteV33_33>[];
  readonly certificate: SignedEnvelope<CoordinatorLeaseCertificateV33_33>;
}

export interface CoordinatorLeaseTrustV33_33 {
  readonly planRegistry: KeyRegistry;
  readonly trustedPlanSignerIds: readonly string[];
  readonly coordinatorRegistry: KeyRegistry;
  readonly trustedCoordinatorIds: readonly string[];
  readonly witnessRegistry: KeyRegistry;
  readonly trustedWitnessIds: readonly string[];
  readonly rotationAuthorityRegistry: KeyRegistry;
  readonly trustedRotationAuthorityIds: readonly string[];
}

export interface CoordinatorSplitBrainFindingV33_33 {
  readonly epoch: number;
  readonly term: number;
  readonly conflictingLeaseDigests: readonly string[];
  readonly conflictingCoordinatorKeyIds: readonly string[];
  readonly overlapStart: number;
  readonly overlapEnd: number;
}

export type TransparencyEventTypeV33_33 =
  | 'EPOCH_ROTATION_PLAN'
  | 'EPOCH_ROTATION_CERTIFICATE'
  | 'COORDINATOR_LEASE'
  | 'CHECKPOINT_ANCHOR';

export interface TransparencyLogEntryV33_33 {
  readonly version: '33.33';
  readonly entryId: string;
  readonly logId: string;
  readonly index: number;
  readonly previousEntryDigest: string | null;
  readonly eventType: TransparencyEventTypeV33_33;
  readonly objectDigest: string;
  readonly epoch: number;
  readonly sequence: number;
  readonly operatorKeyId: string;
  readonly operatorOrganizationId: string;
  readonly operatorHostId: string;
  readonly recordedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly entryDigest: string;
}

export interface TransparencyMonitorDescriptorV33_33 extends ContinuityActorDescriptorV33_33 {
  readonly monitorId: string;
}

export interface TransparencyPinVoteV33_33 {
  readonly version: '33.33';
  readonly voteId: string;
  readonly logId: string;
  readonly logSize: number;
  readonly headEntryDigest: string;
  readonly epoch: number;
  readonly highestSequence: number;
  readonly monitorId: string;
  readonly monitorKeyId: string;
  readonly monitorOrganizationId: string;
  readonly monitorHostId: string;
  readonly observedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly voteDigest: string;
}

export interface TransparencyPinCertificateV33_33 {
  readonly version: '33.33';
  readonly pinId: string;
  readonly logId: string;
  readonly logSize: number;
  readonly headEntryDigest: string;
  readonly epoch: number;
  readonly highestSequence: number;
  readonly quorumRequired: number;
  readonly monitorVoteDigests: readonly string[];
  readonly monitorKeyIds: readonly string[];
  readonly issuedAt: string;
  readonly pinAuthorityKeyId: string;
  readonly pinAuthorityOrganizationId: string;
  readonly pinAuthorityHostId: string;
  readonly previousPinDigest: string | null;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly pinDigest: string;
}

export interface TransparencyPinBundleV33_33 {
  readonly previousPin: SignedEnvelope<TransparencyPinCertificateV33_33> | null;
  readonly entries: readonly SignedEnvelope<TransparencyLogEntryV33_33>[];
  readonly monitorVotes: readonly SignedEnvelope<TransparencyPinVoteV33_33>[];
  readonly certificate: SignedEnvelope<TransparencyPinCertificateV33_33>;
}

export interface TransparencyTrustV33_33 {
  readonly logOperatorRegistry: KeyRegistry;
  readonly trustedLogOperatorIds: readonly string[];
  readonly logOperator: ContinuityActorDescriptorV33_33;
  readonly monitorRegistry: KeyRegistry;
  readonly trustedMonitorIds: readonly string[];
  readonly monitors: readonly TransparencyMonitorDescriptorV33_33[];
  readonly monitorQuorum: number;
  readonly pinAuthorityRegistry: KeyRegistry;
  readonly trustedPinAuthorityIds: readonly string[];
  readonly pinAuthority: ContinuityActorDescriptorV33_33;
  readonly platformOwnerOrganizationId: string;
}

export interface TransparencySplitViewFindingV33_33 {
  readonly logId: string;
  readonly logSize: number;
  readonly conflictingHeadDigests: readonly string[];
  readonly conflictingPinDigests: readonly string[];
}

export interface ContinuityQualificationVerdictV33_33 {
  readonly version: '33.33';
  readonly planDigest: string;
  readonly rotationCertificateDigest: string;
  readonly leaseDigest: string;
  readonly transparencyPinDigest: string;
  readonly epoch: number;
  readonly sequenceFloor: number;
  readonly coordinatorTerm: number;
  readonly witnessRotationVerified: true;
  readonly coordinatorLeaseVerified: true;
  readonly splitBrainRejected: true;
  readonly transparencyLogPinned: true;
  readonly externalTopologyObserved: false;
  readonly status: 'LOCAL_PROTOCOL_PROOF_ONLY_EXTERNAL_DEPLOYMENT_REQUIRED';
  readonly generatedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly verdictDigest: string;
}

export function createWitnessEpochRotationPlanV33_33(input: {
  readonly planSigner: SigningIdentity;
  readonly currentPolicy: SignedEnvelope<FederatedCheckpointWitnessPolicyV33_32>;
  readonly currentAnchor: SignedEnvelope<FederatedCheckpointAnchorV33_32>;
  readonly nextWitnesses: readonly FederatedCheckpointWitnessDescriptorV33_32[];
  readonly nextQuorum: number;
  readonly importer: ContinuityActorDescriptorV33_33;
  readonly coordinator: ContinuityActorDescriptorV33_33;
  readonly rotationAuthority: ContinuityActorDescriptorV33_33;
  readonly activationChallengeDigest: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}): SignedEnvelope<WitnessEpochRotationPlanV33_33> {
  requireDate(input.issuedAt, 'v33_33_rotation_time_invalid');
  requireDate(input.expiresAt, 'v33_33_rotation_time_invalid');
  if (input.expiresAt.getTime() <= input.issuedAt.getTime()) throw new Error('v33_33_rotation_window_invalid');
  const current = input.currentPolicy.payload;
  const anchor = input.currentAnchor.payload;
  if (current.version !== '33.32' || anchor.version !== '33.32') throw new Error('v33_33_predecessor_version_invalid');
  if (anchor.policyDigest !== current.policyDigest || anchor.epoch !== current.epoch) throw new Error('v33_33_predecessor_binding_invalid');
  const witnesses = normalizeWitnesses(input.nextWitnesses);
  if (!Number.isInteger(input.nextQuorum) || input.nextQuorum < 3 || input.nextQuorum > witnesses.length) throw new Error('v33_33_next_quorum_invalid');
  const oldKeys = new Set(current.witnesses.map((row) => row.keyId));
  const retainedWitnessKeyIds = witnesses.map((row) => row.keyId).filter((key) => oldKeys.has(key)).sort();
  const replacedWitnessKeyIds = current.witnesses.map((row) => row.keyId).filter((key) => !witnesses.some((row) => row.keyId === key)).sort();
  const maximumReplacements = current.witnesses.length - current.quorum;
  if (replacedWitnessKeyIds.length > maximumReplacements || retainedWitnessKeyIds.length < current.quorum) throw new Error('v33_33_rotation_recovery_limit_exceeded');
  ensureActorDistinct(input.importer, input.coordinator, input.rotationAuthority, witnesses);
  const material = {
    version: '33.33' as const,
    rotationId: randomUUID(),
    studyId: current.studyId,
    protocolDigest: current.protocolDigest,
    fromPolicyDigest: current.policyDigest,
    fromEpoch: current.epoch,
    toEpoch: current.epoch + 1,
    sequenceFloor: anchor.sequence,
    predecessorAnchorDigest: anchor.anchorDigest,
    predecessorCheckpointDigest: anchor.checkpointDigest,
    quorum: input.nextQuorum,
    witnesses,
    retainedWitnessKeyIds,
    replacedWitnessKeyIds,
    maximumReplacements,
    importer: normalizeActor(input.importer, 'v33_33_importer'),
    coordinator: normalizeActor(input.coordinator, 'v33_33_coordinator'),
    rotationAuthority: normalizeActor(input.rotationAuthority, 'v33_33_rotation_authority'),
    activationChallengeDigest: validDigest(input.activationChallengeDigest, 'v33_33_activation_challenge_invalid'),
    issuedAt: input.issuedAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, planDigest: sha256(material) }, input.planSigner);
}

export function createWitnessActivationProofV33_33(input: {
  readonly witness: SigningIdentity;
  readonly plan: SignedEnvelope<WitnessEpochRotationPlanV33_33>;
  readonly activatedAt: Date;
}): SignedEnvelope<WitnessActivationProofV33_33> {
  requireDate(input.activatedAt, 'v33_33_activation_time_invalid');
  const descriptor = input.plan.payload.witnesses.find((row) => row.keyId === input.witness.keyId);
  if (descriptor === undefined) throw new Error('v33_33_activation_witness_not_enrolled');
  const material = {
    version: '33.33' as const,
    proofId: randomUUID(),
    planDigest: input.plan.payload.planDigest,
    epoch: input.plan.payload.toEpoch,
    witnessId: descriptor.witnessId,
    witnessKeyId: descriptor.keyId,
    witnessKeyFingerprint: descriptor.keyFingerprint,
    witnessOrganizationId: descriptor.organizationId,
    witnessHostId: descriptor.hostId,
    activationChallengeDigest: input.plan.payload.activationChallengeDigest,
    activatedAt: input.activatedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, proofDigest: sha256(material) }, input.witness);
}

export function createEpochRotationVoteV33_33(input: {
  readonly witness: SigningIdentity;
  readonly currentPolicy: SignedEnvelope<FederatedCheckpointWitnessPolicyV33_32>;
  readonly plan: SignedEnvelope<WitnessEpochRotationPlanV33_33>;
  readonly observedAt: Date;
}): SignedEnvelope<EpochRotationVoteV33_33> {
  requireDate(input.observedAt, 'v33_33_rotation_vote_time_invalid');
  const descriptor = input.currentPolicy.payload.witnesses.find((row) => row.keyId === input.witness.keyId);
  if (descriptor === undefined) throw new Error('v33_33_rotation_voter_not_enrolled');
  const plan = input.plan.payload;
  const material = {
    version: '33.33' as const,
    voteId: randomUUID(),
    planDigest: plan.planDigest,
    fromPolicyDigest: plan.fromPolicyDigest,
    fromEpoch: plan.fromEpoch,
    toEpoch: plan.toEpoch,
    sequenceFloor: plan.sequenceFloor,
    predecessorAnchorDigest: plan.predecessorAnchorDigest,
    voterKeyId: descriptor.keyId,
    voterOrganizationId: descriptor.organizationId,
    voterHostId: descriptor.hostId,
    decision: 'ACCEPT' as const,
    observedAt: input.observedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, voteDigest: sha256(material) }, input.witness);
}

export function finalizeEpochRotationV33_33(input: {
  readonly rotationAuthority: SigningIdentity;
  readonly currentPolicy: SignedEnvelope<FederatedCheckpointWitnessPolicyV33_32>;
  readonly currentAnchor: SignedEnvelope<FederatedCheckpointAnchorV33_32>;
  readonly plan: SignedEnvelope<WitnessEpochRotationPlanV33_33>;
  readonly oldWitnessVotes: readonly SignedEnvelope<EpochRotationVoteV33_33>[];
  readonly activationProofs: readonly SignedEnvelope<WitnessActivationProofV33_33>[];
  readonly trust: EpochRotationTrustV33_33;
  readonly issuedAt: Date;
}): EpochRotationBundleV33_33 {
  requireDate(input.issuedAt, 'v33_33_rotation_certificate_time_invalid');
  const partial = { currentPolicy: input.currentPolicy, currentAnchor: input.currentAnchor, plan: input.plan, oldWitnessVotes: input.oldWitnessVotes, activationProofs: input.activationProofs };
  const verified = verifyRotationCore(partial, input.trust, input.issuedAt);
  if (input.rotationAuthority.keyId !== verified.plan.rotationAuthority.keyId) throw new Error('v33_33_rotation_authority_signer_invalid');
  const material = {
    version: '33.33' as const,
    certificateId: randomUUID(),
    planDigest: verified.plan.planDigest,
    fromPolicyDigest: verified.plan.fromPolicyDigest,
    fromEpoch: verified.plan.fromEpoch,
    toEpoch: verified.plan.toEpoch,
    sequenceFloor: verified.plan.sequenceFloor,
    predecessorAnchorDigest: verified.plan.predecessorAnchorDigest,
    predecessorCheckpointDigest: verified.plan.predecessorCheckpointDigest,
    quorumRequired: verified.currentPolicy.quorum,
    oldWitnessVoteDigests: verified.votes.map((row) => row.voteDigest).sort(),
    oldWitnessKeyIds: verified.votes.map((row) => row.voterKeyId).sort(),
    activationProofDigests: verified.activations.map((row) => row.proofDigest).sort(),
    activatedWitnessKeyIds: verified.activations.map((row) => row.witnessKeyId).sort(),
    issuedAt: input.issuedAt.toISOString(),
    rotationAuthorityKeyId: verified.plan.rotationAuthority.keyId,
    rotationAuthorityOrganizationId: verified.plan.rotationAuthority.organizationId,
    rotationAuthorityHostId: verified.plan.rotationAuthority.hostId,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  const certificate = signEnvelope({ ...material, certificateDigest: sha256(material) }, input.rotationAuthority);
  return { ...partial, certificate };
}

export function verifyEpochRotationV33_33(input: {
  readonly bundle: EpochRotationBundleV33_33;
  readonly trust: EpochRotationTrustV33_33;
  readonly verifiedAt: Date;
}): EpochRotationCertificateV33_33 {
  requireDate(input.verifiedAt, 'v33_33_rotation_verify_time_invalid');
  const core = verifyRotationCore(input.bundle, input.trust, input.verifiedAt);
  const envelope = input.bundle.certificate;
  if (!input.trust.trustedRotationAuthorityIds.includes(envelope.issuerKeyId) || !input.trust.rotationAuthorityRegistry.verifyAt(envelope, input.verifiedAt)) throw new Error('v33_33_rotation_certificate_signature_invalid');
  const certificate = verifyDigest(envelope.payload, 'certificateDigest', 'v33_33_rotation_certificate_digest_invalid');
  if (certificate.rotationAuthorityKeyId !== envelope.issuerKeyId || certificate.rotationAuthorityKeyId !== core.plan.rotationAuthority.keyId || certificate.rotationAuthorityOrganizationId !== core.plan.rotationAuthority.organizationId || certificate.rotationAuthorityHostId !== core.plan.rotationAuthority.hostId) throw new Error('v33_33_rotation_certificate_authority_binding_invalid');
  if (certificate.planDigest !== core.plan.planDigest || certificate.fromPolicyDigest !== core.plan.fromPolicyDigest || certificate.fromEpoch !== core.plan.fromEpoch || certificate.toEpoch !== core.plan.toEpoch || certificate.sequenceFloor !== core.plan.sequenceFloor || certificate.predecessorAnchorDigest !== core.plan.predecessorAnchorDigest || certificate.predecessorCheckpointDigest !== core.plan.predecessorCheckpointDigest) throw new Error('v33_33_rotation_certificate_plan_binding_invalid');
  if (certificate.quorumRequired !== core.currentPolicy.quorum || !sameSet(certificate.oldWitnessVoteDigests, core.votes.map((row) => row.voteDigest)) || !sameSet(certificate.oldWitnessKeyIds, core.votes.map((row) => row.voterKeyId)) || !sameSet(certificate.activationProofDigests, core.activations.map((row) => row.proofDigest)) || !sameSet(certificate.activatedWitnessKeyIds, core.activations.map((row) => row.witnessKeyId))) throw new Error('v33_33_rotation_certificate_evidence_binding_invalid');
  enforceBoundary(certificate, 'v33_33_rotation_certificate_boundary_invalid');
  return certificate;
}

export function createCoordinatorLeaseProposalV33_33(input: {
  readonly coordinator: SigningIdentity;
  readonly plan: SignedEnvelope<WitnessEpochRotationPlanV33_33>;
  readonly term: number;
  readonly previousLease: SignedEnvelope<CoordinatorLeaseCertificateV33_33> | null;
  readonly sequenceWindow: number;
  readonly notBefore: Date;
  readonly expiresAt: Date;
  readonly proposedAt: Date;
}): SignedEnvelope<CoordinatorLeaseProposalV33_33> {
  requireDate(input.notBefore, 'v33_33_lease_time_invalid');
  requireDate(input.expiresAt, 'v33_33_lease_time_invalid');
  requireDate(input.proposedAt, 'v33_33_lease_time_invalid');
  if (input.expiresAt.getTime() <= input.notBefore.getTime() || input.proposedAt.getTime() > input.notBefore.getTime()) throw new Error('v33_33_lease_window_invalid');
  const plan = input.plan.payload;
  if (input.coordinator.keyId !== plan.coordinator.keyId) throw new Error('v33_33_lease_coordinator_signer_invalid');
  boundedInteger(input.term, 1, Number.MAX_SAFE_INTEGER, 'v33_33_lease_term_invalid');
  boundedInteger(input.sequenceWindow, 1, 10_000, 'v33_33_lease_sequence_window_invalid');
  const prior = input.previousLease?.payload ?? null;
  if ((input.term === 1) !== (prior === null)) throw new Error('v33_33_lease_predecessor_invalid');
  if (prior !== null && (input.term !== prior.term + 1 || prior.epoch !== plan.toEpoch || prior.planDigest !== plan.planDigest)) throw new Error('v33_33_lease_term_non_monotonic');
  const sequenceStart = prior === null ? plan.sequenceFloor + 1 : prior.sequenceEnd + 1;
  const material = {
    version: '33.33' as const,
    proposalId: randomUUID(),
    planDigest: plan.planDigest,
    epoch: plan.toEpoch,
    term: input.term,
    previousLeaseDigest: prior?.leaseDigest ?? null,
    sequenceStart,
    sequenceEnd: sequenceStart + input.sequenceWindow - 1,
    coordinatorKeyId: plan.coordinator.keyId,
    coordinatorKeyFingerprint: plan.coordinator.keyFingerprint,
    coordinatorOrganizationId: plan.coordinator.organizationId,
    coordinatorHostId: plan.coordinator.hostId,
    notBefore: input.notBefore.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    proposedAt: input.proposedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, proposalDigest: sha256(material) }, input.coordinator);
}

export function createCoordinatorLeaseVoteV33_33(input: {
  readonly witness: SigningIdentity;
  readonly plan: SignedEnvelope<WitnessEpochRotationPlanV33_33>;
  readonly proposal: SignedEnvelope<CoordinatorLeaseProposalV33_33>;
  readonly observedAt: Date;
}): SignedEnvelope<CoordinatorLeaseVoteV33_33> {
  requireDate(input.observedAt, 'v33_33_lease_vote_time_invalid');
  const descriptor = input.plan.payload.witnesses.find((row) => row.keyId === input.witness.keyId);
  if (descriptor === undefined) throw new Error('v33_33_lease_voter_not_enrolled');
  const proposal = input.proposal.payload;
  const material = {
    version: '33.33' as const,
    voteId: randomUUID(),
    planDigest: input.plan.payload.planDigest,
    proposalDigest: proposal.proposalDigest,
    epoch: proposal.epoch,
    term: proposal.term,
    sequenceStart: proposal.sequenceStart,
    sequenceEnd: proposal.sequenceEnd,
    coordinatorKeyId: proposal.coordinatorKeyId,
    witnessKeyId: descriptor.keyId,
    witnessOrganizationId: descriptor.organizationId,
    witnessHostId: descriptor.hostId,
    decision: 'ACCEPT' as const,
    observedAt: input.observedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, voteDigest: sha256(material) }, input.witness);
}

export function finalizeCoordinatorLeaseV33_33(input: {
  readonly rotationAuthority: SigningIdentity;
  readonly plan: SignedEnvelope<WitnessEpochRotationPlanV33_33>;
  readonly previousLease: SignedEnvelope<CoordinatorLeaseCertificateV33_33> | null;
  readonly proposal: SignedEnvelope<CoordinatorLeaseProposalV33_33>;
  readonly votes: readonly SignedEnvelope<CoordinatorLeaseVoteV33_33>[];
  readonly trust: CoordinatorLeaseTrustV33_33;
  readonly issuedAt: Date;
}): CoordinatorLeaseBundleV33_33 {
  requireDate(input.issuedAt, 'v33_33_lease_certificate_time_invalid');
  const partial = { plan: input.plan, previousLease: input.previousLease, proposal: input.proposal, votes: input.votes };
  const core = verifyLeaseCore(partial, input.trust, input.issuedAt);
  if (input.rotationAuthority.keyId !== core.plan.rotationAuthority.keyId) throw new Error('v33_33_lease_authority_signer_invalid');
  const material = {
    version: '33.33' as const,
    leaseId: randomUUID(),
    planDigest: core.plan.planDigest,
    proposalDigest: core.proposal.proposalDigest,
    epoch: core.proposal.epoch,
    term: core.proposal.term,
    previousLeaseDigest: core.proposal.previousLeaseDigest,
    sequenceStart: core.proposal.sequenceStart,
    sequenceEnd: core.proposal.sequenceEnd,
    coordinatorKeyId: core.proposal.coordinatorKeyId,
    coordinatorOrganizationId: core.proposal.coordinatorOrganizationId,
    coordinatorHostId: core.proposal.coordinatorHostId,
    quorumRequired: core.plan.quorum,
    witnessVoteDigests: core.votes.map((row) => row.voteDigest).sort(),
    witnessKeyIds: core.votes.map((row) => row.witnessKeyId).sort(),
    issuedAt: input.issuedAt.toISOString(),
    expiresAt: core.proposal.expiresAt,
    rotationAuthorityKeyId: core.plan.rotationAuthority.keyId,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  const certificate = signEnvelope({ ...material, leaseDigest: sha256(material) }, input.rotationAuthority);
  return { ...partial, certificate };
}

export function verifyCoordinatorLeaseV33_33(input: {
  readonly bundle: CoordinatorLeaseBundleV33_33;
  readonly trust: CoordinatorLeaseTrustV33_33;
  readonly verifiedAt: Date;
}): CoordinatorLeaseCertificateV33_33 {
  requireDate(input.verifiedAt, 'v33_33_lease_verify_time_invalid');
  const core = verifyLeaseCore(input.bundle, input.trust, input.verifiedAt);
  const envelope = input.bundle.certificate;
  if (!input.trust.trustedRotationAuthorityIds.includes(envelope.issuerKeyId) || !input.trust.rotationAuthorityRegistry.verifyAt(envelope, input.verifiedAt)) throw new Error('v33_33_lease_certificate_signature_invalid');
  const certificate = verifyDigest(envelope.payload, 'leaseDigest', 'v33_33_lease_certificate_digest_invalid');
  if (certificate.rotationAuthorityKeyId !== envelope.issuerKeyId || certificate.rotationAuthorityKeyId !== core.plan.rotationAuthority.keyId) throw new Error('v33_33_lease_certificate_authority_binding_invalid');
  if (certificate.planDigest !== core.plan.planDigest || certificate.proposalDigest !== core.proposal.proposalDigest || certificate.epoch !== core.proposal.epoch || certificate.term !== core.proposal.term || certificate.previousLeaseDigest !== core.proposal.previousLeaseDigest || certificate.sequenceStart !== core.proposal.sequenceStart || certificate.sequenceEnd !== core.proposal.sequenceEnd || certificate.coordinatorKeyId !== core.proposal.coordinatorKeyId || certificate.coordinatorOrganizationId !== core.proposal.coordinatorOrganizationId || certificate.coordinatorHostId !== core.proposal.coordinatorHostId || certificate.expiresAt !== core.proposal.expiresAt) throw new Error('v33_33_lease_certificate_proposal_binding_invalid');
  if (certificate.quorumRequired !== core.plan.quorum || !sameSet(certificate.witnessVoteDigests, core.votes.map((row) => row.voteDigest)) || !sameSet(certificate.witnessKeyIds, core.votes.map((row) => row.witnessKeyId))) throw new Error('v33_33_lease_certificate_vote_binding_invalid');
  if (input.verifiedAt.getTime() < Date.parse(core.proposal.notBefore) || input.verifiedAt.getTime() >= Date.parse(certificate.expiresAt)) throw new Error('v33_33_lease_not_active');
  enforceBoundary(certificate, 'v33_33_lease_certificate_boundary_invalid');
  return certificate;
}

export function detectCoordinatorSplitBrainV33_33(certificates: readonly SignedEnvelope<CoordinatorLeaseCertificateV33_33>[]): readonly CoordinatorSplitBrainFindingV33_33[] {
  const findings: CoordinatorSplitBrainFindingV33_33[] = [];
  for (let i = 0; i < certificates.length; i += 1) {
    const left = certificates[i]!.payload;
    for (let j = i + 1; j < certificates.length; j += 1) {
      const right = certificates[j]!.payload;
      if (left.planDigest !== right.planDigest || left.epoch !== right.epoch) continue;
      const overlapStart = Math.max(left.sequenceStart, right.sequenceStart);
      const overlapEnd = Math.min(left.sequenceEnd, right.sequenceEnd);
      const conflict = left.term === right.term
        ? left.leaseDigest !== right.leaseDigest
        : overlapStart <= overlapEnd && left.coordinatorKeyId !== right.coordinatorKeyId;
      if (conflict) findings.push({
        epoch: left.epoch,
        term: Math.min(left.term, right.term),
        conflictingLeaseDigests: [left.leaseDigest, right.leaseDigest].sort(),
        conflictingCoordinatorKeyIds: [...new Set([left.coordinatorKeyId, right.coordinatorKeyId])].sort(),
        overlapStart,
        overlapEnd,
      });
    }
  }
  return findings;
}

export function createTransparencyLogEntryV33_33(input: {
  readonly operator: SigningIdentity;
  readonly operatorDescriptor: ContinuityActorDescriptorV33_33;
  readonly logId: string;
  readonly previousEntry: SignedEnvelope<TransparencyLogEntryV33_33> | null;
  readonly eventType: TransparencyEventTypeV33_33;
  readonly objectDigest: string;
  readonly epoch: number;
  readonly sequence: number;
  readonly recordedAt: Date;
}): SignedEnvelope<TransparencyLogEntryV33_33> {
  requireDate(input.recordedAt, 'v33_33_log_time_invalid');
  if (input.operator.keyId !== input.operatorDescriptor.keyId) throw new Error('v33_33_log_operator_signer_invalid');
  const prior = input.previousEntry?.payload ?? null;
  if (prior !== null && prior.logId !== input.logId) throw new Error('v33_33_log_id_continuity_invalid');
  if (prior !== null && (input.epoch < prior.epoch || input.sequence < prior.sequence)) throw new Error('v33_33_log_monotonicity_invalid');
  const material = {
    version: '33.33' as const,
    entryId: randomUUID(),
    logId: identifier(input.logId, 'v33_33_log_id_invalid'),
    index: prior === null ? 0 : prior.index + 1,
    previousEntryDigest: prior?.entryDigest ?? null,
    eventType: input.eventType,
    objectDigest: validDigest(input.objectDigest, 'v33_33_log_object_digest_invalid'),
    epoch: boundedInteger(input.epoch, 1, Number.MAX_SAFE_INTEGER, 'v33_33_log_epoch_invalid'),
    sequence: boundedInteger(input.sequence, 0, Number.MAX_SAFE_INTEGER, 'v33_33_log_sequence_invalid'),
    operatorKeyId: input.operatorDescriptor.keyId,
    operatorOrganizationId: input.operatorDescriptor.organizationId,
    operatorHostId: input.operatorDescriptor.hostId,
    recordedAt: input.recordedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, entryDigest: sha256(material) }, input.operator);
}

export function createTransparencyPinVoteV33_33(input: {
  readonly monitor: SigningIdentity;
  readonly monitorDescriptor: TransparencyMonitorDescriptorV33_33;
  readonly entries: readonly SignedEnvelope<TransparencyLogEntryV33_33>[];
  readonly observedAt: Date;
}): SignedEnvelope<TransparencyPinVoteV33_33> {
  requireDate(input.observedAt, 'v33_33_pin_vote_time_invalid');
  if (input.monitor.keyId !== input.monitorDescriptor.keyId) throw new Error('v33_33_pin_monitor_signer_invalid');
  const head = input.entries.at(-1)?.payload;
  if (head === undefined) throw new Error('v33_33_pin_empty_log');
  const material = {
    version: '33.33' as const,
    voteId: randomUUID(),
    logId: head.logId,
    logSize: head.index + 1,
    headEntryDigest: head.entryDigest,
    epoch: head.epoch,
    highestSequence: head.sequence,
    monitorId: input.monitorDescriptor.monitorId,
    monitorKeyId: input.monitorDescriptor.keyId,
    monitorOrganizationId: input.monitorDescriptor.organizationId,
    monitorHostId: input.monitorDescriptor.hostId,
    observedAt: input.observedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, voteDigest: sha256(material) }, input.monitor);
}

export function finalizeTransparencyPinV33_33(input: {
  readonly pinAuthority: SigningIdentity;
  readonly previousPin: SignedEnvelope<TransparencyPinCertificateV33_33> | null;
  readonly entries: readonly SignedEnvelope<TransparencyLogEntryV33_33>[];
  readonly monitorVotes: readonly SignedEnvelope<TransparencyPinVoteV33_33>[];
  readonly trust: TransparencyTrustV33_33;
  readonly issuedAt: Date;
}): TransparencyPinBundleV33_33 {
  requireDate(input.issuedAt, 'v33_33_pin_time_invalid');
  const partial = { previousPin: input.previousPin, entries: input.entries, monitorVotes: input.monitorVotes };
  const core = verifyTransparencyCore(partial, input.trust, input.issuedAt);
  if (input.pinAuthority.keyId !== input.trust.pinAuthority.keyId) throw new Error('v33_33_pin_authority_signer_invalid');
  const material = {
    version: '33.33' as const,
    pinId: randomUUID(),
    logId: core.head.logId,
    logSize: core.head.index + 1,
    headEntryDigest: core.head.entryDigest,
    epoch: core.head.epoch,
    highestSequence: core.head.sequence,
    quorumRequired: input.trust.monitorQuorum,
    monitorVoteDigests: core.votes.map((row) => row.voteDigest).sort(),
    monitorKeyIds: core.votes.map((row) => row.monitorKeyId).sort(),
    issuedAt: input.issuedAt.toISOString(),
    pinAuthorityKeyId: input.trust.pinAuthority.keyId,
    pinAuthorityOrganizationId: input.trust.pinAuthority.organizationId,
    pinAuthorityHostId: input.trust.pinAuthority.hostId,
    previousPinDigest: input.previousPin?.payload.pinDigest ?? null,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  const certificate = signEnvelope({ ...material, pinDigest: sha256(material) }, input.pinAuthority);
  return { ...partial, certificate };
}

export function verifyTransparencyPinV33_33(input: {
  readonly bundle: TransparencyPinBundleV33_33;
  readonly trust: TransparencyTrustV33_33;
  readonly verifiedAt: Date;
}): TransparencyPinCertificateV33_33 {
  requireDate(input.verifiedAt, 'v33_33_pin_verify_time_invalid');
  const core = verifyTransparencyCore(input.bundle, input.trust, input.verifiedAt);
  const envelope = input.bundle.certificate;
  if (!input.trust.trustedPinAuthorityIds.includes(envelope.issuerKeyId) || !input.trust.pinAuthorityRegistry.verifyAt(envelope, input.verifiedAt)) throw new Error('v33_33_pin_certificate_signature_invalid');
  const certificate = verifyDigest(envelope.payload, 'pinDigest', 'v33_33_pin_certificate_digest_invalid');
  if (certificate.pinAuthorityKeyId !== envelope.issuerKeyId || !actorEqual(input.trust.pinAuthority, { keyId: certificate.pinAuthorityKeyId, keyFingerprint: input.trust.pinAuthority.keyFingerprint, organizationId: certificate.pinAuthorityOrganizationId, hostId: certificate.pinAuthorityHostId })) throw new Error('v33_33_pin_authority_binding_invalid');
  if (certificate.logId !== core.head.logId || certificate.logSize !== core.head.index + 1 || certificate.headEntryDigest !== core.head.entryDigest || certificate.epoch !== core.head.epoch || certificate.highestSequence !== core.head.sequence || certificate.previousPinDigest !== (input.bundle.previousPin?.payload.pinDigest ?? null) || certificate.quorumRequired !== input.trust.monitorQuorum || !sameSet(certificate.monitorVoteDigests, core.votes.map((row) => row.voteDigest)) || !sameSet(certificate.monitorKeyIds, core.votes.map((row) => row.monitorKeyId))) throw new Error('v33_33_pin_evidence_binding_invalid');
  enforceBoundary(certificate, 'v33_33_pin_certificate_boundary_invalid');
  return certificate;
}

export function detectTransparencySplitViewV33_33(certificates: readonly SignedEnvelope<TransparencyPinCertificateV33_33>[]): readonly TransparencySplitViewFindingV33_33[] {
  const groups = new Map<string, SignedEnvelope<TransparencyPinCertificateV33_33>[]>();
  for (const certificate of certificates) {
    const key = `${certificate.payload.logId}:${certificate.payload.logSize}`;
    groups.set(key, [...(groups.get(key) ?? []), certificate]);
  }
  const findings: TransparencySplitViewFindingV33_33[] = [];
  for (const group of groups.values()) {
    const heads = [...new Set(group.map((row) => row.payload.headEntryDigest))];
    if (heads.length > 1) findings.push({
      logId: group[0]!.payload.logId,
      logSize: group[0]!.payload.logSize,
      conflictingHeadDigests: heads.sort(),
      conflictingPinDigests: group.map((row) => row.payload.pinDigest).sort(),
    });
  }
  return findings;
}

export function finalizeContinuityQualificationV33_33(input: {
  readonly verifier: SigningIdentity;
  readonly rotation: EpochRotationBundleV33_33;
  readonly rotationTrust: EpochRotationTrustV33_33;
  readonly lease: CoordinatorLeaseBundleV33_33;
  readonly leaseTrust: CoordinatorLeaseTrustV33_33;
  readonly transparency: TransparencyPinBundleV33_33;
  readonly transparencyTrust: TransparencyTrustV33_33;
  readonly generatedAt: Date;
}): SignedEnvelope<ContinuityQualificationVerdictV33_33> {
  const rotation = verifyEpochRotationV33_33({ bundle: input.rotation, trust: input.rotationTrust, verifiedAt: input.generatedAt });
  const lease = verifyCoordinatorLeaseV33_33({ bundle: input.lease, trust: input.leaseTrust, verifiedAt: input.generatedAt });
  const pin = verifyTransparencyPinV33_33({ bundle: input.transparency, trust: input.transparencyTrust, verifiedAt: input.generatedAt });
  if (detectCoordinatorSplitBrainV33_33([input.lease.certificate]).length !== 0 || detectTransparencySplitViewV33_33([input.transparency.certificate]).length !== 0) throw new Error('v33_33_continuity_conflict_detected');
  const required = [rotation.planDigest, rotation.certificateDigest, lease.leaseDigest];
  const logged = new Set(input.transparency.entries.map((row) => row.payload.objectDigest));
  if (!required.every((value) => logged.has(value))) throw new Error('v33_33_continuity_log_binding_invalid');
  const material = {
    version: '33.33' as const,
    planDigest: rotation.planDigest,
    rotationCertificateDigest: rotation.certificateDigest,
    leaseDigest: lease.leaseDigest,
    transparencyPinDigest: pin.pinDigest,
    epoch: rotation.toEpoch,
    sequenceFloor: rotation.sequenceFloor,
    coordinatorTerm: lease.term,
    witnessRotationVerified: true as const,
    coordinatorLeaseVerified: true as const,
    splitBrainRejected: true as const,
    transparencyLogPinned: true as const,
    externalTopologyObserved: false as const,
    status: 'LOCAL_PROTOCOL_PROOF_ONLY_EXTERNAL_DEPLOYMENT_REQUIRED' as const,
    generatedAt: input.generatedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, verdictDigest: sha256(material) }, input.verifier);
}

function verifyRotationCore(input: Omit<EpochRotationBundleV33_33, 'certificate'> | EpochRotationBundleV33_33, trust: EpochRotationTrustV33_33, now: Date): {
  currentPolicy: FederatedCheckpointWitnessPolicyV33_32;
  currentAnchor: FederatedCheckpointAnchorV33_32;
  plan: WitnessEpochRotationPlanV33_33;
  votes: readonly EpochRotationVoteV33_33[];
  activations: readonly WitnessActivationProofV33_33[];
} {
  const currentPolicy = verifyCurrentPolicy(input.currentPolicy, trust, now);
  const currentAnchor = verifyCurrentAnchor(input.currentAnchor, trust, now);
  const planEnvelope = input.plan;
  if (!trust.trustedPlanSignerIds.includes(planEnvelope.issuerKeyId) || !trust.planRegistry.verifyAt(planEnvelope, now)) throw new Error('v33_33_rotation_plan_signature_invalid');
  const plan = verifyDigest(planEnvelope.payload, 'planDigest', 'v33_33_rotation_plan_digest_invalid');
  if (now.getTime() < Date.parse(plan.issuedAt) || now.getTime() >= Date.parse(plan.expiresAt)) throw new Error('v33_33_rotation_plan_not_active');
  if (plan.fromPolicyDigest !== currentPolicy.policyDigest || plan.fromEpoch !== currentPolicy.epoch || plan.toEpoch !== currentPolicy.epoch + 1 || plan.studyId !== currentPolicy.studyId || plan.protocolDigest !== currentPolicy.protocolDigest) throw new Error('v33_33_rotation_plan_policy_binding_invalid');
  if (plan.sequenceFloor !== currentAnchor.sequence || plan.predecessorAnchorDigest !== currentAnchor.anchorDigest || plan.predecessorCheckpointDigest !== currentAnchor.checkpointDigest || currentAnchor.policyDigest !== currentPolicy.policyDigest || currentAnchor.epoch !== currentPolicy.epoch) throw new Error('v33_33_rotation_plan_anchor_binding_invalid');
  const normalized = normalizeWitnesses(plan.witnesses);
  if (plan.quorum < 3 || plan.quorum > normalized.length || plan.maximumReplacements !== currentPolicy.witnesses.length - currentPolicy.quorum) throw new Error('v33_33_rotation_plan_constraints_invalid');
  const expectedRetained = normalized.map((row) => row.keyId).filter((key) => currentPolicy.witnesses.some((old) => old.keyId === key)).sort();
  const expectedReplaced = currentPolicy.witnesses.map((row) => row.keyId).filter((key) => !normalized.some((next) => next.keyId === key)).sort();
  if (!sameSet(plan.retainedWitnessKeyIds, expectedRetained) || !sameSet(plan.replacedWitnessKeyIds, expectedReplaced) || expectedReplaced.length > plan.maximumReplacements || expectedRetained.length < currentPolicy.quorum) throw new Error('v33_33_rotation_recovery_limit_exceeded');
  ensureActorDistinct(plan.importer, plan.coordinator, plan.rotationAuthority, normalized);
  if (!trust.trustedRotationAuthorityIds.includes(plan.rotationAuthority.keyId) || trust.rotationAuthorityRegistry.fingerprint(plan.rotationAuthority.keyId) !== plan.rotationAuthority.keyFingerprint) throw new Error('v33_33_rotation_authority_trust_binding_invalid');
  for (const witness of normalized) {
    if (!trust.trustedNextWitnessIds.includes(witness.keyId) || trust.nextWitnessRegistry.fingerprint(witness.keyId) !== witness.keyFingerprint) throw new Error('v33_33_next_witness_trust_binding_invalid');
  }
  enforceBoundary(plan, 'v33_33_rotation_plan_boundary_invalid');
  const votes = input.oldWitnessVotes.map((row) => verifyRotationVote(row, currentPolicy, plan, trust, now));
  ensureUniqueTopology(votes.map((row) => ({ keyId: row.voterKeyId, organizationId: row.voterOrganizationId, hostId: row.voterHostId })), 'v33_33_rotation_vote_topology_duplicate');
  if (votes.length < currentPolicy.quorum) throw new Error('v33_33_rotation_quorum_not_met');
  const activations = input.activationProofs.map((row) => verifyActivation(row, plan, trust, now));
  ensureUniqueTopology(activations.map((row) => ({ keyId: row.witnessKeyId, organizationId: row.witnessOrganizationId, hostId: row.witnessHostId })), 'v33_33_activation_topology_duplicate');
  if (!sameSet(activations.map((row) => row.witnessKeyId), normalized.map((row) => row.keyId))) throw new Error('v33_33_activation_incomplete');
  return { currentPolicy, currentAnchor, plan, votes, activations };
}

function verifyLeaseCore(input: Omit<CoordinatorLeaseBundleV33_33, 'certificate'> | CoordinatorLeaseBundleV33_33, trust: CoordinatorLeaseTrustV33_33, now: Date): { plan: WitnessEpochRotationPlanV33_33; proposal: CoordinatorLeaseProposalV33_33; votes: readonly CoordinatorLeaseVoteV33_33[] } {
  const planEnvelope = input.plan;
  if (!trust.trustedPlanSignerIds.includes(planEnvelope.issuerKeyId) || !trust.planRegistry.verifyAt(planEnvelope, now)) throw new Error('v33_33_lease_plan_signature_invalid');
  const plan = verifyDigest(planEnvelope.payload, 'planDigest', 'v33_33_lease_plan_digest_invalid');
  const proposalEnvelope = input.proposal;
  if (!trust.trustedCoordinatorIds.includes(proposalEnvelope.issuerKeyId) || !trust.coordinatorRegistry.verifyAt(proposalEnvelope, now)) throw new Error('v33_33_lease_proposal_signature_invalid');
  const proposal = verifyDigest(proposalEnvelope.payload, 'proposalDigest', 'v33_33_lease_proposal_digest_invalid');
  if (proposal.coordinatorKeyId !== proposalEnvelope.issuerKeyId || !actorEqual(plan.coordinator, { keyId: proposal.coordinatorKeyId, keyFingerprint: proposal.coordinatorKeyFingerprint, organizationId: proposal.coordinatorOrganizationId, hostId: proposal.coordinatorHostId })) throw new Error('v33_33_lease_coordinator_binding_invalid');
  if (trust.coordinatorRegistry.fingerprint(proposal.coordinatorKeyId) !== proposal.coordinatorKeyFingerprint || proposal.planDigest !== plan.planDigest || proposal.epoch !== plan.toEpoch || proposal.sequenceStart < plan.sequenceFloor + 1 || proposal.sequenceEnd < proposal.sequenceStart || proposal.sequenceEnd - proposal.sequenceStart + 1 > 10_000 || proposal.term < 1) throw new Error('v33_33_lease_constraints_invalid');
  if ((proposal.term === 1) !== (proposal.previousLeaseDigest === null)) throw new Error('v33_33_lease_predecessor_invalid');
  if ((proposal.term === 1) !== (input.previousLease === null)) throw new Error('v33_33_lease_predecessor_bundle_invalid');
  if (input.previousLease !== null) {
    const previousEnvelope = input.previousLease;
    if (!trust.trustedRotationAuthorityIds.includes(previousEnvelope.issuerKeyId) || !trust.rotationAuthorityRegistry.verifyAt(previousEnvelope, now)) throw new Error('v33_33_previous_lease_signature_invalid');
    const previous = verifyDigest(previousEnvelope.payload, 'leaseDigest', 'v33_33_previous_lease_digest_invalid');
    if (previous.planDigest !== plan.planDigest || previous.epoch !== plan.toEpoch || previous.term + 1 !== proposal.term || proposal.previousLeaseDigest !== previous.leaseDigest || proposal.sequenceStart !== previous.sequenceEnd + 1 || previous.sequenceEnd >= proposal.sequenceStart || previous.coordinatorKeyId !== plan.coordinator.keyId) throw new Error('v33_33_lease_predecessor_binding_invalid');
    enforceBoundary(previous, 'v33_33_previous_lease_boundary_invalid');
  } else if (proposal.sequenceStart !== plan.sequenceFloor + 1) throw new Error('v33_33_lease_genesis_sequence_invalid');
  if (Date.parse(proposal.proposedAt) > now.getTime() || Date.parse(proposal.notBefore) > Date.parse(proposal.expiresAt)) throw new Error('v33_33_lease_time_invalid');
  enforceBoundary(proposal, 'v33_33_lease_proposal_boundary_invalid');
  const votes = input.votes.map((row) => verifyLeaseVote(row, plan, proposal, trust, now));
  ensureUniqueTopology(votes.map((row) => ({ keyId: row.witnessKeyId, organizationId: row.witnessOrganizationId, hostId: row.witnessHostId })), 'v33_33_lease_vote_topology_duplicate');
  if (votes.length < plan.quorum) throw new Error('v33_33_lease_quorum_not_met');
  return { plan, proposal, votes };
}

function verifyTransparencyCore(input: Omit<TransparencyPinBundleV33_33, 'certificate'> | TransparencyPinBundleV33_33, trust: TransparencyTrustV33_33, now: Date): { head: TransparencyLogEntryV33_33; votes: readonly TransparencyPinVoteV33_33[] } {
  if (input.entries.length === 0) throw new Error('v33_33_log_empty');
  validateTransparencyTopology(trust);
  let previous: TransparencyLogEntryV33_33 | null = null;
  for (const envelope of input.entries) {
    if (!trust.trustedLogOperatorIds.includes(envelope.issuerKeyId) || !trust.logOperatorRegistry.verifyAt(envelope, now)) throw new Error('v33_33_log_entry_signature_invalid');
    const entry = verifyDigest(envelope.payload, 'entryDigest', 'v33_33_log_entry_digest_invalid');
    if (entry.operatorKeyId !== envelope.issuerKeyId || !actorEqual(trust.logOperator, { keyId: entry.operatorKeyId, keyFingerprint: trust.logOperator.keyFingerprint, organizationId: entry.operatorOrganizationId, hostId: entry.operatorHostId })) throw new Error('v33_33_log_operator_binding_invalid');
    if (previous === null) {
      if (entry.index !== 0 || entry.previousEntryDigest !== null) throw new Error('v33_33_log_genesis_invalid');
    } else if (entry.logId !== previous.logId || entry.index !== previous.index + 1 || entry.previousEntryDigest !== previous.entryDigest || entry.epoch < previous.epoch || entry.sequence < previous.sequence) throw new Error('v33_33_log_chain_invalid');
    if (Date.parse(entry.recordedAt) > now.getTime()) throw new Error('v33_33_log_future_entry');
    enforceBoundary(entry, 'v33_33_log_boundary_invalid');
    previous = entry;
  }
  const head = previous!;
  if (input.previousPin !== null) {
    const priorEnvelope = input.previousPin;
    if (!trust.trustedPinAuthorityIds.includes(priorEnvelope.issuerKeyId) || !trust.pinAuthorityRegistry.verifyAt(priorEnvelope, now)) throw new Error('v33_33_previous_pin_signature_invalid');
    const prior = verifyDigest(priorEnvelope.payload, 'pinDigest', 'v33_33_previous_pin_digest_invalid');
    if (prior.logId !== head.logId || prior.logSize >= head.index + 1 || prior.logSize < 1 || input.entries[prior.logSize - 1]?.payload.entryDigest !== prior.headEntryDigest) throw new Error('v33_33_previous_pin_continuity_invalid');
    enforceBoundary(prior, 'v33_33_previous_pin_boundary_invalid');
  }
  const votes = input.monitorVotes.map((row) => verifyPinVote(row, head, trust, now));
  ensureUniqueTopology(votes.map((row) => ({ keyId: row.monitorKeyId, organizationId: row.monitorOrganizationId, hostId: row.monitorHostId })), 'v33_33_pin_vote_topology_duplicate');
  if (votes.length < trust.monitorQuorum) throw new Error('v33_33_pin_quorum_not_met');
  return { head, votes };
}

function verifyCurrentPolicy(envelope: SignedEnvelope<FederatedCheckpointWitnessPolicyV33_32>, trust: EpochRotationTrustV33_33, now: Date): FederatedCheckpointWitnessPolicyV33_32 {
  if (!trust.trustedCurrentPolicySignerIds.includes(envelope.issuerKeyId) || !trust.currentPolicyRegistry.verifyAt(envelope, now)) throw new Error('v33_33_current_policy_signature_invalid');
  const policy = verifyDigest(envelope.payload, 'policyDigest', 'v33_33_current_policy_digest_invalid');
  if (policy.version !== '33.32' || policy.epoch < 1 || policy.quorum < 3 || policy.quorum > policy.witnesses.length || now.getTime() < Date.parse(policy.issuedAt) || now.getTime() >= Date.parse(policy.expiresAt)) throw new Error('v33_33_current_policy_invalid');
  normalizeWitnesses(policy.witnesses);
  for (const witness of policy.witnesses) if (!trust.trustedCurrentWitnessIds.includes(witness.keyId) || trust.currentWitnessRegistry.fingerprint(witness.keyId) !== witness.keyFingerprint) throw new Error('v33_33_current_witness_trust_binding_invalid');
  enforceBoundary(policy, 'v33_33_current_policy_boundary_invalid');
  return policy;
}

function verifyCurrentAnchor(envelope: SignedEnvelope<FederatedCheckpointAnchorV33_32>, trust: EpochRotationTrustV33_33, now: Date): FederatedCheckpointAnchorV33_32 {
  if (!trust.trustedCurrentAnchorSignerIds.includes(envelope.issuerKeyId) || !trust.currentAnchorRegistry.verifyAt(envelope, now)) throw new Error('v33_33_current_anchor_signature_invalid');
  const anchor = verifyDigest(envelope.payload, 'anchorDigest', 'v33_33_current_anchor_digest_invalid');
  if (anchor.version !== '33.32' || anchor.epoch < 1 || anchor.sequence < 0 || Date.parse(anchor.anchoredAt) > now.getTime()) throw new Error('v33_33_current_anchor_invalid');
  enforceBoundary(anchor, 'v33_33_current_anchor_boundary_invalid');
  return anchor;
}

function verifyRotationVote(envelope: SignedEnvelope<EpochRotationVoteV33_33>, policy: FederatedCheckpointWitnessPolicyV33_32, plan: WitnessEpochRotationPlanV33_33, trust: EpochRotationTrustV33_33, now: Date): EpochRotationVoteV33_33 {
  if (!trust.trustedCurrentWitnessIds.includes(envelope.issuerKeyId) || !trust.currentWitnessRegistry.verifyAt(envelope, now)) throw new Error('v33_33_rotation_vote_signature_invalid');
  const vote = verifyDigest(envelope.payload, 'voteDigest', 'v33_33_rotation_vote_digest_invalid');
  const descriptor = policy.witnesses.find((row) => row.keyId === envelope.issuerKeyId);
  if (descriptor === undefined || vote.voterKeyId !== descriptor.keyId || vote.voterOrganizationId !== descriptor.organizationId || vote.voterHostId !== descriptor.hostId) throw new Error('v33_33_rotation_vote_enrollment_invalid');
  if (vote.planDigest !== plan.planDigest || vote.fromPolicyDigest !== plan.fromPolicyDigest || vote.fromEpoch !== plan.fromEpoch || vote.toEpoch !== plan.toEpoch || vote.sequenceFloor !== plan.sequenceFloor || vote.predecessorAnchorDigest !== plan.predecessorAnchorDigest || vote.decision !== 'ACCEPT' || Date.parse(vote.observedAt) > now.getTime()) throw new Error('v33_33_rotation_vote_binding_invalid');
  enforceBoundary(vote, 'v33_33_rotation_vote_boundary_invalid');
  return vote;
}

function verifyActivation(envelope: SignedEnvelope<WitnessActivationProofV33_33>, plan: WitnessEpochRotationPlanV33_33, trust: EpochRotationTrustV33_33, now: Date): WitnessActivationProofV33_33 {
  if (!trust.trustedNextWitnessIds.includes(envelope.issuerKeyId) || !trust.nextWitnessRegistry.verifyAt(envelope, now)) throw new Error('v33_33_activation_signature_invalid');
  const proof = verifyDigest(envelope.payload, 'proofDigest', 'v33_33_activation_digest_invalid');
  const descriptor = plan.witnesses.find((row) => row.keyId === envelope.issuerKeyId);
  if (descriptor === undefined || proof.witnessId !== descriptor.witnessId || proof.witnessKeyId !== descriptor.keyId || proof.witnessKeyFingerprint !== descriptor.keyFingerprint || proof.witnessOrganizationId !== descriptor.organizationId || proof.witnessHostId !== descriptor.hostId) throw new Error('v33_33_activation_enrollment_invalid');
  if (proof.planDigest !== plan.planDigest || proof.epoch !== plan.toEpoch || proof.activationChallengeDigest !== plan.activationChallengeDigest || Date.parse(proof.activatedAt) > now.getTime()) throw new Error('v33_33_activation_binding_invalid');
  enforceBoundary(proof, 'v33_33_activation_boundary_invalid');
  return proof;
}

function verifyLeaseVote(envelope: SignedEnvelope<CoordinatorLeaseVoteV33_33>, plan: WitnessEpochRotationPlanV33_33, proposal: CoordinatorLeaseProposalV33_33, trust: CoordinatorLeaseTrustV33_33, now: Date): CoordinatorLeaseVoteV33_33 {
  if (!trust.trustedWitnessIds.includes(envelope.issuerKeyId) || !trust.witnessRegistry.verifyAt(envelope, now)) throw new Error('v33_33_lease_vote_signature_invalid');
  const vote = verifyDigest(envelope.payload, 'voteDigest', 'v33_33_lease_vote_digest_invalid');
  const descriptor = plan.witnesses.find((row) => row.keyId === envelope.issuerKeyId);
  if (descriptor === undefined || vote.witnessKeyId !== descriptor.keyId || vote.witnessOrganizationId !== descriptor.organizationId || vote.witnessHostId !== descriptor.hostId) throw new Error('v33_33_lease_vote_enrollment_invalid');
  if (vote.planDigest !== plan.planDigest || vote.proposalDigest !== proposal.proposalDigest || vote.epoch !== proposal.epoch || vote.term !== proposal.term || vote.sequenceStart !== proposal.sequenceStart || vote.sequenceEnd !== proposal.sequenceEnd || vote.coordinatorKeyId !== proposal.coordinatorKeyId || vote.decision !== 'ACCEPT' || Date.parse(vote.observedAt) > now.getTime()) throw new Error('v33_33_lease_vote_binding_invalid');
  enforceBoundary(vote, 'v33_33_lease_vote_boundary_invalid');
  return vote;
}

function verifyPinVote(envelope: SignedEnvelope<TransparencyPinVoteV33_33>, head: TransparencyLogEntryV33_33, trust: TransparencyTrustV33_33, now: Date): TransparencyPinVoteV33_33 {
  if (!trust.trustedMonitorIds.includes(envelope.issuerKeyId) || !trust.monitorRegistry.verifyAt(envelope, now)) throw new Error('v33_33_pin_vote_signature_invalid');
  const vote = verifyDigest(envelope.payload, 'voteDigest', 'v33_33_pin_vote_digest_invalid');
  const descriptor = trust.monitors.find((row) => row.keyId === envelope.issuerKeyId);
  if (descriptor === undefined || vote.monitorId !== descriptor.monitorId || vote.monitorKeyId !== descriptor.keyId || vote.monitorOrganizationId !== descriptor.organizationId || vote.monitorHostId !== descriptor.hostId) throw new Error('v33_33_pin_vote_enrollment_invalid');
  if (vote.logId !== head.logId || vote.logSize !== head.index + 1 || vote.headEntryDigest !== head.entryDigest || vote.epoch !== head.epoch || vote.highestSequence !== head.sequence || Date.parse(vote.observedAt) > now.getTime()) throw new Error('v33_33_pin_vote_binding_invalid');
  enforceBoundary(vote, 'v33_33_pin_vote_boundary_invalid');
  return vote;
}

function validateTransparencyTopology(trust: TransparencyTrustV33_33): void {
  if (trust.monitorQuorum < 2 || trust.monitorQuorum > trust.monitors.length) throw new Error('v33_33_monitor_quorum_invalid');
  if (trust.logOperator.organizationId === trust.platformOwnerOrganizationId || trust.pinAuthority.organizationId === trust.platformOwnerOrganizationId || trust.logOperator.organizationId === trust.pinAuthority.organizationId || trust.logOperator.hostId === trust.pinAuthority.hostId || trust.logOperator.keyId === trust.pinAuthority.keyId) throw new Error('v33_33_transparency_authority_overlap');
  const monitors = trust.monitors.map((row) => ({ keyId: row.keyId, organizationId: row.organizationId, hostId: row.hostId }));
  ensureUniqueTopology(monitors, 'v33_33_monitor_topology_duplicate');
  for (const monitor of trust.monitors) {
    if (monitor.organizationId === trust.platformOwnerOrganizationId || monitor.organizationId === trust.logOperator.organizationId || monitor.organizationId === trust.pinAuthority.organizationId || monitor.hostId === trust.logOperator.hostId || monitor.hostId === trust.pinAuthority.hostId || monitor.keyId === trust.logOperator.keyId || monitor.keyId === trust.pinAuthority.keyId) throw new Error('v33_33_monitor_authority_overlap');
    if (!trust.trustedMonitorIds.includes(monitor.keyId) || trust.monitorRegistry.fingerprint(monitor.keyId) !== monitor.keyFingerprint) throw new Error('v33_33_monitor_trust_binding_invalid');
  }
  if (!trust.trustedLogOperatorIds.includes(trust.logOperator.keyId) || trust.logOperatorRegistry.fingerprint(trust.logOperator.keyId) !== trust.logOperator.keyFingerprint || !trust.trustedPinAuthorityIds.includes(trust.pinAuthority.keyId) || trust.pinAuthorityRegistry.fingerprint(trust.pinAuthority.keyId) !== trust.pinAuthority.keyFingerprint) throw new Error('v33_33_transparency_trust_binding_invalid');
}

function normalizeWitnesses(input: readonly FederatedCheckpointWitnessDescriptorV33_32[]): FederatedCheckpointWitnessDescriptorV33_32[] {
  if (input.length < 5 || input.length > 15) throw new Error('v33_33_witness_count_invalid');
  const witnesses = input.map((row) => ({
    witnessId: identifier(row.witnessId, 'v33_33_witness_id_invalid'),
    keyId: identifier(row.keyId, 'v33_33_witness_key_invalid'),
    keyFingerprint: validDigest(row.keyFingerprint, 'v33_33_witness_fingerprint_invalid'),
    organizationId: identifier(row.organizationId, 'v33_33_witness_org_invalid'),
    hostId: identifier(row.hostId, 'v33_33_witness_host_invalid'),
  })).sort((a, b) => a.witnessId.localeCompare(b.witnessId));
  ensureUniqueTopology(witnesses, 'v33_33_witness_topology_duplicate');
  if (new Set(witnesses.map((row) => row.witnessId)).size !== witnesses.length) throw new Error('v33_33_witness_id_duplicate');
  return witnesses;
}

function ensureActorDistinct(importer: ContinuityActorDescriptorV33_33, coordinator: ContinuityActorDescriptorV33_33, authority: ContinuityActorDescriptorV33_33, witnesses: readonly FederatedCheckpointWitnessDescriptorV33_32[]): void {
  const actors = [normalizeActor(importer, 'v33_33_importer'), normalizeActor(coordinator, 'v33_33_coordinator'), normalizeActor(authority, 'v33_33_rotation_authority'), ...witnesses.map((row) => ({ keyId: row.keyId, organizationId: row.organizationId, hostId: row.hostId }))];
  ensureUniqueTopology(actors, 'v33_33_role_topology_overlap');
}

function normalizeActor(input: ContinuityActorDescriptorV33_33, prefix: string): ContinuityActorDescriptorV33_33 {
  return {
    keyId: identifier(input.keyId, `${prefix}_key_invalid`),
    keyFingerprint: validDigest(input.keyFingerprint, `${prefix}_fingerprint_invalid`),
    organizationId: identifier(input.organizationId, `${prefix}_org_invalid`),
    hostId: identifier(input.hostId, `${prefix}_host_invalid`),
  };
}

function ensureUniqueTopology(rows: readonly { readonly keyId: string; readonly organizationId: string; readonly hostId: string }[], error: string): void {
  if (new Set(rows.map((row) => row.keyId)).size !== rows.length || new Set(rows.map((row) => row.organizationId)).size !== rows.length || new Set(rows.map((row) => row.hostId)).size !== rows.length) throw new Error(error);
}

function actorEqual(left: ContinuityActorDescriptorV33_33, right: ContinuityActorDescriptorV33_33): boolean {
  return left.keyId === right.keyId && left.keyFingerprint === right.keyFingerprint && left.organizationId === right.organizationId && left.hostId === right.hostId;
}

function enforceBoundary(value: { readonly productionAuthority: string; readonly externalEffectsExecuted: number }, error: string): void {
  if (value.productionAuthority !== 'NONE' || value.externalEffectsExecuted !== 0) throw new Error(error);
}

function verifyDigest<T extends object, K extends keyof T>(payload: T, key: K, error: string): T {
  const material = { ...payload } as Record<string, unknown>;
  const claimed = material[String(key)];
  delete material[String(key)];
  if (typeof claimed !== 'string' || claimed !== sha256(material)) throw new Error(error);
  return payload;
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function validDigest(value: string, error: string): string {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(error);
  return value;
}

function identifier(value: string, error: string): string {
  const clean = value.trim();
  if (clean === '' || clean.length > 200) throw new Error(error);
  return clean;
}

function boundedInteger(value: number, minimum: number, maximum: number, error: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(error);
  return value;
}

function requireDate(value: Date, error: string): void {
  if (!Number.isFinite(value.getTime())) throw new Error(error);
}
