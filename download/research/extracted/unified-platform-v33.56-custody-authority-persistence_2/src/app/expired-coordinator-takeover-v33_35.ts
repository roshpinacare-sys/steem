import { randomUUID } from 'node:crypto';
import {
  KeyRegistry,
  sha256,
  sha256Bytes,
  signEnvelope,
  type SignedEnvelope,
  type SigningIdentity,
} from '../contracts/crypto.js';
import type { ContinuityActorDescriptorV33_33, CoordinatorLeaseCertificateV33_33 } from './federated-checkpoint-continuity-v33_33.js';
import type { RecoveryWitnessDescriptorV33_34 } from './federated-recovery-drill-v33_34.js';

export interface ExpiredCoordinatorTakeoverPlanV33_35 {
  readonly version: '33.35';
  readonly takeoverId: string;
  readonly predecessorLeaseDigest: string;
  readonly epoch: number;
  readonly predecessorTerm: number;
  readonly nextTerm: number;
  readonly predecessorSequenceEnd: number;
  readonly sequenceStart: number;
  readonly sequenceEnd: number;
  readonly outgoingCoordinator: ContinuityActorDescriptorV33_33;
  readonly replacementCoordinator: ContinuityActorDescriptorV33_33;
  readonly recoveryAuthority: ContinuityActorDescriptorV33_33;
  readonly leaseExpiresAt: string;
  readonly expirySafetyDelayMs: number;
  readonly earliestTakeoverAt: string;
  readonly challengeDigest: string;
  readonly previousTakeoverDigest: string | null;
  readonly quorumRequired: number;
  readonly witnesses: readonly RecoveryWitnessDescriptorV33_34[];
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly planDigest: string;
}

export interface ReplacementTakeoverAcceptanceV33_35 {
  readonly version: '33.35';
  readonly acceptanceId: string;
  readonly planDigest: string;
  readonly predecessorLeaseDigest: string;
  readonly epoch: number;
  readonly nextTerm: number;
  readonly sequenceStart: number;
  readonly sequenceEnd: number;
  readonly replacementCoordinatorKeyId: string;
  readonly replacementCoordinatorKeyFingerprint: string;
  readonly replacementCoordinatorOrganizationId: string;
  readonly replacementCoordinatorHostId: string;
  readonly challengeDigest: string;
  readonly acceptedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly acceptanceDigest: string;
}

export interface LeaseExpiryWitnessVoteV33_35 {
  readonly version: '33.35';
  readonly voteId: string;
  readonly planDigest: string;
  readonly predecessorLeaseDigest: string;
  readonly leaseExpiresAt: string;
  readonly earliestTakeoverAt: string;
  readonly witnessId: string;
  readonly witnessKeyId: string;
  readonly witnessOrganizationId: string;
  readonly witnessHostId: string;
  readonly decision: 'LEASE_EXPIRED';
  readonly observedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly voteDigest: string;
}

export interface ExpiredCoordinatorTakeoverCertificateV33_35 {
  readonly version: '33.35';
  readonly certificateId: string;
  readonly planDigest: string;
  readonly acceptanceDigest: string;
  readonly predecessorLeaseDigest: string;
  readonly previousTakeoverDigest: string | null;
  readonly epoch: number;
  readonly predecessorTerm: number;
  readonly nextTerm: number;
  readonly sequenceStart: number;
  readonly sequenceEnd: number;
  readonly fenceSequence: number;
  readonly fenceEffectiveAt: string;
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
  readonly takeoverDigest: string;
}

export interface ExpiredCoordinatorTakeoverBundleV33_35 {
  readonly predecessorLease: SignedEnvelope<CoordinatorLeaseCertificateV33_33>;
  readonly plan: SignedEnvelope<ExpiredCoordinatorTakeoverPlanV33_35>;
  readonly acceptance: SignedEnvelope<ReplacementTakeoverAcceptanceV33_35>;
  readonly expiryVotes: readonly SignedEnvelope<LeaseExpiryWitnessVoteV33_35>[];
  readonly certificate: SignedEnvelope<ExpiredCoordinatorTakeoverCertificateV33_35>;
}

export interface ExpiredCoordinatorTakeoverTrustV33_35 {
  readonly predecessorLeaseRegistry: KeyRegistry;
  readonly trustedPredecessorLeaseSignerIds: readonly string[];
  readonly planRegistry: KeyRegistry;
  readonly trustedPlanSignerIds: readonly string[];
  readonly replacementCoordinatorRegistry: KeyRegistry;
  readonly trustedReplacementCoordinatorIds: readonly string[];
  readonly witnessRegistry: KeyRegistry;
  readonly trustedWitnessIds: readonly string[];
  readonly recoveryAuthorityRegistry: KeyRegistry;
  readonly trustedRecoveryAuthorityIds: readonly string[];
}

export interface CoordinatorActionClaimV33_35 {
  readonly version: '33.35';
  readonly actionId: string;
  readonly coordinatorKeyId: string;
  readonly leaseDigest: string;
  readonly takeoverDigest: string | null;
  readonly epoch: number;
  readonly term: number;
  readonly sequence: number;
  readonly commandDigest: string;
  readonly issuedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly actionDigest: string;
}

export interface PublishedTakeoverArtifactV33_35 {
  readonly version: '33.35';
  readonly artifactId: string;
  readonly takeoverDigest: string;
  readonly contentDigest: string;
  readonly mediaType: 'application/json';
  readonly createdAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly artifactDigest: string;
}

export interface PublicationEndpointReceiptV33_35 {
  readonly version: '33.35';
  readonly receiptId: string;
  readonly artifactDigest: string;
  readonly contentDigest: string;
  readonly endpointUri: string;
  readonly publisherKeyId: string;
  readonly publisherOrganizationId: string;
  readonly publisherHostId: string;
  readonly publishedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly receiptDigest: string;
}

export type RetrievalTransportV33_35 = 'HTTP_LOOPBACK' | 'HTTPS_EXTERNAL';

export interface MonitorRetrievalReceiptV33_35 {
  readonly version: '33.35';
  readonly retrievalId: string;
  readonly publicationReceiptDigest: string;
  readonly endpointUri: string;
  readonly artifactDigest: string;
  readonly contentDigest: string;
  readonly httpStatus: 200;
  readonly transport: RetrievalTransportV33_35;
  readonly monitorId: string;
  readonly monitorKeyId: string;
  readonly monitorOrganizationId: string;
  readonly monitorHostId: string;
  readonly processId: number;
  readonly observedAt: string;
  readonly networkFetchObserved: true;
  readonly externalTopologyObserved: boolean;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly retrievalDigest: string;
}

export interface MonitorGossipStatementV33_35 {
  readonly version: '33.35';
  readonly gossipId: string;
  readonly endpointUri: string;
  readonly publicationReceiptDigest: string;
  readonly artifactDigest: string;
  readonly contentDigest: string;
  readonly retrievalDigest: string;
  readonly peerRetrievalDigests: readonly string[];
  readonly monitorId: string;
  readonly monitorKeyId: string;
  readonly monitorOrganizationId: string;
  readonly monitorHostId: string;
  readonly observedAt: string;
  readonly decision: 'CONSISTENT';
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly gossipDigest: string;
}

export interface RetrievalTrustV33_35 {
  readonly publisherRegistry: KeyRegistry;
  readonly trustedPublisherIds: readonly string[];
  readonly monitorRegistry: KeyRegistry;
  readonly trustedMonitorIds: readonly string[];
  readonly monitors: readonly RecoveryWitnessDescriptorV33_34[];
  readonly quorum: number;
}

export interface MonitorSplitViewFindingV33_35 {
  readonly endpointUri: string;
  readonly publicationReceiptDigest: string;
  readonly artifactDigests: readonly string[];
  readonly contentDigests: readonly string[];
  readonly monitorKeyIds: readonly string[];
}

export interface TakeoverRecoveryVerdictV33_35 {
  readonly version: '33.35';
  readonly takeoverDigest: string;
  readonly predecessorLeaseDigest: string;
  readonly expiredLeaseTakeoverVerified: true;
  readonly outgoingCoordinatorSignatureRequired: false;
  readonly coordinatorResurrectionBlocked: true;
  readonly retrievalQuorumVerified: true;
  readonly gossipConsistencyVerified: true;
  readonly splitViewRejected: true;
  readonly independentProcessesObserved: boolean;
  readonly networkFetchObserved: boolean;
  readonly externalTopologyObserved: boolean;
  readonly externalHumanParticipants: 0;
  readonly status: 'LOCAL_MULTI_PROCESS_RECOVERY_REHEARSAL_ONLY';
  readonly generatedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly verdictDigest: string;
}

export function createExpiredCoordinatorTakeoverPlanV33_35(input: {
  readonly recoveryAuthority: SigningIdentity;
  readonly recoveryAuthorityDescriptor: ContinuityActorDescriptorV33_33;
  readonly predecessorLease: SignedEnvelope<CoordinatorLeaseCertificateV33_33>;
  readonly replacementCoordinator: ContinuityActorDescriptorV33_33;
  readonly witnesses: readonly RecoveryWitnessDescriptorV33_34[];
  readonly quorum: number;
  readonly sequenceEnd: number;
  readonly expirySafetyDelayMs: number;
  readonly challengeDigest: string;
  readonly previousTakeoverDigest: string | null;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}): SignedEnvelope<ExpiredCoordinatorTakeoverPlanV33_35> {
  requireDate(input.issuedAt, 'v33_35_takeover_plan_time_invalid');
  requireDate(input.expiresAt, 'v33_35_takeover_plan_time_invalid');
  if (input.recoveryAuthority.keyId !== input.recoveryAuthorityDescriptor.keyId) throw new Error('v33_35_takeover_authority_signer_invalid');
  if (input.expiresAt.getTime() <= input.issuedAt.getTime()) throw new Error('v33_35_takeover_plan_window_invalid');
  const lease = verifyDigest(input.predecessorLease.payload, 'leaseDigest', 'v33_35_predecessor_lease_digest_invalid');
  enforceBoundary(lease, 'v33_35_predecessor_lease_boundary_invalid');
  const outgoing: ContinuityActorDescriptorV33_33 = {
    keyId: lease.coordinatorKeyId,
    keyFingerprint: sha256({ keyId: lease.coordinatorKeyId }),
    organizationId: lease.coordinatorOrganizationId,
    hostId: lease.coordinatorHostId,
  };
  const replacement = normalizeActor(input.replacementCoordinator, 'v33_35_replacement');
  const authority = normalizeActor(input.recoveryAuthorityDescriptor, 'v33_35_authority');
  if (replacement.keyId === outgoing.keyId || replacement.organizationId === outgoing.organizationId || replacement.hostId === outgoing.hostId) throw new Error('v33_35_replacement_not_independent');
  if (replacement.keyId === authority.keyId || replacement.organizationId === authority.organizationId || replacement.hostId === authority.hostId) throw new Error('v33_35_replacement_authority_overlap');
  const witnesses = normalizeWitnesses(input.witnesses);
  if (witnesses.length !== 5 || !Number.isInteger(input.quorum) || input.quorum < 3 || input.quorum > witnesses.length) throw new Error('v33_35_takeover_quorum_invalid');
  ensureTopologyDistinct([...witnesses, replacement, authority], 'v33_35_takeover_topology_invalid');
  if (!Number.isSafeInteger(input.expirySafetyDelayMs) || input.expirySafetyDelayMs < 0 || input.expirySafetyDelayMs > 86_400_000) throw new Error('v33_35_expiry_safety_delay_invalid');
  const earliestTakeoverAtMs = Date.parse(lease.expiresAt) + input.expirySafetyDelayMs;
  if (!Number.isFinite(earliestTakeoverAtMs) || input.issuedAt.getTime() < earliestTakeoverAtMs) throw new Error('v33_35_lease_not_expired');
  const sequenceStart = lease.sequenceEnd + 1;
  if (!Number.isSafeInteger(input.sequenceEnd) || input.sequenceEnd < sequenceStart) throw new Error('v33_35_takeover_sequence_range_invalid');
  const material = {
    version: '33.35' as const,
    takeoverId: randomUUID(),
    predecessorLeaseDigest: lease.leaseDigest,
    epoch: lease.epoch,
    predecessorTerm: lease.term,
    nextTerm: lease.term + 1,
    predecessorSequenceEnd: lease.sequenceEnd,
    sequenceStart,
    sequenceEnd: input.sequenceEnd,
    outgoingCoordinator: outgoing,
    replacementCoordinator: replacement,
    recoveryAuthority: authority,
    leaseExpiresAt: lease.expiresAt,
    expirySafetyDelayMs: input.expirySafetyDelayMs,
    earliestTakeoverAt: new Date(earliestTakeoverAtMs).toISOString(),
    challengeDigest: digest(input.challengeDigest, 'v33_35_takeover_challenge_invalid'),
    previousTakeoverDigest: input.previousTakeoverDigest === null ? null : digest(input.previousTakeoverDigest, 'v33_35_previous_takeover_invalid'),
    quorumRequired: input.quorum,
    witnesses,
    issuedAt: input.issuedAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, planDigest: sha256(material) }, input.recoveryAuthority);
}

export function createReplacementTakeoverAcceptanceV33_35(input: {
  readonly replacementCoordinator: SigningIdentity;
  readonly plan: SignedEnvelope<ExpiredCoordinatorTakeoverPlanV33_35>;
  readonly acceptedAt: Date;
}): SignedEnvelope<ReplacementTakeoverAcceptanceV33_35> {
  requireDate(input.acceptedAt, 'v33_35_acceptance_time_invalid');
  const plan = input.plan.payload;
  if (input.replacementCoordinator.keyId !== plan.replacementCoordinator.keyId) throw new Error('v33_35_acceptance_signer_invalid');
  if (input.acceptedAt.getTime() < Date.parse(plan.earliestTakeoverAt) || input.acceptedAt.getTime() >= Date.parse(plan.expiresAt)) throw new Error('v33_35_acceptance_window_invalid');
  const material = {
    version: '33.35' as const,
    acceptanceId: randomUUID(),
    planDigest: plan.planDigest,
    predecessorLeaseDigest: plan.predecessorLeaseDigest,
    epoch: plan.epoch,
    nextTerm: plan.nextTerm,
    sequenceStart: plan.sequenceStart,
    sequenceEnd: plan.sequenceEnd,
    replacementCoordinatorKeyId: plan.replacementCoordinator.keyId,
    replacementCoordinatorKeyFingerprint: plan.replacementCoordinator.keyFingerprint,
    replacementCoordinatorOrganizationId: plan.replacementCoordinator.organizationId,
    replacementCoordinatorHostId: plan.replacementCoordinator.hostId,
    challengeDigest: plan.challengeDigest,
    acceptedAt: input.acceptedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, acceptanceDigest: sha256(material) }, input.replacementCoordinator);
}

export function createLeaseExpiryWitnessVoteV33_35(input: {
  readonly witness: SigningIdentity;
  readonly plan: SignedEnvelope<ExpiredCoordinatorTakeoverPlanV33_35>;
  readonly observedAt: Date;
}): SignedEnvelope<LeaseExpiryWitnessVoteV33_35> {
  requireDate(input.observedAt, 'v33_35_expiry_vote_time_invalid');
  const plan = input.plan.payload;
  const witness = plan.witnesses.find((row) => row.keyId === input.witness.keyId);
  if (witness === undefined) throw new Error('v33_35_expiry_voter_not_enrolled');
  if (input.observedAt.getTime() < Date.parse(plan.earliestTakeoverAt) || input.observedAt.getTime() >= Date.parse(plan.expiresAt)) throw new Error('v33_35_expiry_vote_too_early');
  const material = {
    version: '33.35' as const,
    voteId: randomUUID(),
    planDigest: plan.planDigest,
    predecessorLeaseDigest: plan.predecessorLeaseDigest,
    leaseExpiresAt: plan.leaseExpiresAt,
    earliestTakeoverAt: plan.earliestTakeoverAt,
    witnessId: witness.witnessId,
    witnessKeyId: witness.keyId,
    witnessOrganizationId: witness.organizationId,
    witnessHostId: witness.hostId,
    decision: 'LEASE_EXPIRED' as const,
    observedAt: input.observedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, voteDigest: sha256(material) }, input.witness);
}

export function finalizeExpiredCoordinatorTakeoverV33_35(input: {
  readonly recoveryAuthority: SigningIdentity;
  readonly predecessorLease: SignedEnvelope<CoordinatorLeaseCertificateV33_33>;
  readonly plan: SignedEnvelope<ExpiredCoordinatorTakeoverPlanV33_35>;
  readonly acceptance: SignedEnvelope<ReplacementTakeoverAcceptanceV33_35>;
  readonly expiryVotes: readonly SignedEnvelope<LeaseExpiryWitnessVoteV33_35>[];
  readonly trust: ExpiredCoordinatorTakeoverTrustV33_35;
  readonly issuedAt: Date;
}): ExpiredCoordinatorTakeoverBundleV33_35 {
  const partial = { predecessorLease: input.predecessorLease, plan: input.plan, acceptance: input.acceptance, expiryVotes: input.expiryVotes };
  const core = verifyTakeoverCore(partial, input.trust, input.issuedAt);
  if (!input.trust.trustedRecoveryAuthorityIds.includes(input.recoveryAuthority.keyId) || input.recoveryAuthority.keyId !== core.plan.recoveryAuthority.keyId) throw new Error('v33_35_takeover_certificate_signer_invalid');
  const material = {
    version: '33.35' as const,
    certificateId: randomUUID(),
    planDigest: core.plan.planDigest,
    acceptanceDigest: core.acceptance.acceptanceDigest,
    predecessorLeaseDigest: core.lease.leaseDigest,
    previousTakeoverDigest: core.plan.previousTakeoverDigest,
    epoch: core.plan.epoch,
    predecessorTerm: core.plan.predecessorTerm,
    nextTerm: core.plan.nextTerm,
    sequenceStart: core.plan.sequenceStart,
    sequenceEnd: core.plan.sequenceEnd,
    fenceSequence: core.plan.sequenceStart,
    fenceEffectiveAt: core.plan.earliestTakeoverAt,
    outgoingCoordinatorKeyId: core.plan.outgoingCoordinator.keyId,
    replacementCoordinatorKeyId: core.plan.replacementCoordinator.keyId,
    replacementCoordinatorOrganizationId: core.plan.replacementCoordinator.organizationId,
    replacementCoordinatorHostId: core.plan.replacementCoordinator.hostId,
    quorumRequired: core.plan.quorumRequired,
    witnessVoteDigests: core.votes.map((row) => row.voteDigest).sort(),
    witnessKeyIds: core.votes.map((row) => row.witnessKeyId).sort(),
    issuedAt: input.issuedAt.toISOString(),
    recoveryAuthorityKeyId: input.recoveryAuthority.keyId,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  const certificate = signEnvelope({ ...material, takeoverDigest: sha256(material) }, input.recoveryAuthority);
  return { ...partial, certificate };
}

export function verifyExpiredCoordinatorTakeoverV33_35(input: {
  readonly bundle: ExpiredCoordinatorTakeoverBundleV33_35;
  readonly trust: ExpiredCoordinatorTakeoverTrustV33_35;
  readonly verifiedAt: Date;
}): ExpiredCoordinatorTakeoverCertificateV33_35 {
  const core = verifyTakeoverCore(input.bundle, input.trust, input.verifiedAt);
  const envelope = input.bundle.certificate;
  if (!input.trust.trustedRecoveryAuthorityIds.includes(envelope.issuerKeyId) || !input.trust.recoveryAuthorityRegistry.verifyAt(envelope, input.verifiedAt)) throw new Error('v33_35_takeover_certificate_signature_invalid');
  const certificate = verifyDigest(envelope.payload, 'takeoverDigest', 'v33_35_takeover_certificate_digest_invalid');
  if (certificate.recoveryAuthorityKeyId !== envelope.issuerKeyId || certificate.planDigest !== core.plan.planDigest || certificate.acceptanceDigest !== core.acceptance.acceptanceDigest || certificate.predecessorLeaseDigest !== core.lease.leaseDigest || certificate.previousTakeoverDigest !== core.plan.previousTakeoverDigest || certificate.epoch !== core.plan.epoch || certificate.predecessorTerm !== core.plan.predecessorTerm || certificate.nextTerm !== core.plan.nextTerm || certificate.sequenceStart !== core.plan.sequenceStart || certificate.sequenceEnd !== core.plan.sequenceEnd || certificate.fenceSequence !== core.plan.sequenceStart || certificate.fenceEffectiveAt !== core.plan.earliestTakeoverAt || certificate.outgoingCoordinatorKeyId !== core.plan.outgoingCoordinator.keyId || certificate.replacementCoordinatorKeyId !== core.plan.replacementCoordinator.keyId || certificate.replacementCoordinatorOrganizationId !== core.plan.replacementCoordinator.organizationId || certificate.replacementCoordinatorHostId !== core.plan.replacementCoordinator.hostId || certificate.quorumRequired !== core.plan.quorumRequired || !sameSet(certificate.witnessVoteDigests, core.votes.map((row) => row.voteDigest)) || !sameSet(certificate.witnessKeyIds, core.votes.map((row) => row.witnessKeyId))) throw new Error('v33_35_takeover_certificate_binding_invalid');
  enforceBoundary(certificate, 'v33_35_takeover_certificate_boundary_invalid');
  return certificate;
}

export function detectExpiredTakeoverConflictsV33_35(certificates: readonly SignedEnvelope<ExpiredCoordinatorTakeoverCertificateV33_35>[]): readonly { predecessorLeaseDigest: string; takeoverDigests: readonly string[]; coordinatorKeyIds: readonly string[] }[] {
  const groups = new Map<string, SignedEnvelope<ExpiredCoordinatorTakeoverCertificateV33_35>[] >();
  for (const row of certificates) groups.set(row.payload.predecessorLeaseDigest, [...(groups.get(row.payload.predecessorLeaseDigest) ?? []), row]);
  return [...groups.entries()].flatMap(([predecessorLeaseDigest, rows]) => {
    const unique = [...new Map(rows.map((row) => [row.payload.takeoverDigest, row])).values()];
    if (unique.length <= 1) return [];
    return [{ predecessorLeaseDigest, takeoverDigests: unique.map((row) => row.payload.takeoverDigest).sort(), coordinatorKeyIds: [...new Set(unique.map((row) => row.payload.replacementCoordinatorKeyId))].sort() }];
  });
}

export function createCoordinatorActionClaimV33_35(input: {
  readonly coordinator: SigningIdentity;
  readonly leaseDigest: string;
  readonly takeoverDigest: string | null;
  readonly epoch: number;
  readonly term: number;
  readonly sequence: number;
  readonly commandDigest: string;
  readonly issuedAt: Date;
}): SignedEnvelope<CoordinatorActionClaimV33_35> {
  requireDate(input.issuedAt, 'v33_35_action_time_invalid');
  const material = {
    version: '33.35' as const,
    actionId: randomUUID(),
    coordinatorKeyId: input.coordinator.keyId,
    leaseDigest: digest(input.leaseDigest, 'v33_35_action_lease_invalid'),
    takeoverDigest: input.takeoverDigest === null ? null : digest(input.takeoverDigest, 'v33_35_action_takeover_invalid'),
    epoch: integer(input.epoch, 1, 'v33_35_action_epoch_invalid'),
    term: integer(input.term, 1, 'v33_35_action_term_invalid'),
    sequence: integer(input.sequence, 0, 'v33_35_action_sequence_invalid'),
    commandDigest: digest(input.commandDigest, 'v33_35_action_command_invalid'),
    issuedAt: input.issuedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, actionDigest: sha256(material) }, input.coordinator);
}

export function verifyCoordinatorActionAgainstTakeoverV33_35(input: {
  readonly action: SignedEnvelope<CoordinatorActionClaimV33_35>;
  readonly coordinatorRegistry: KeyRegistry;
  readonly takeover: SignedEnvelope<ExpiredCoordinatorTakeoverCertificateV33_35>;
  readonly verifiedAt: Date;
}): CoordinatorActionClaimV33_35 {
  requireDate(input.verifiedAt, 'v33_35_action_verify_time_invalid');
  if (!input.coordinatorRegistry.verifyAt(input.action, input.verifiedAt)) throw new Error('v33_35_action_signature_invalid');
  const action = verifyDigest(input.action.payload, 'actionDigest', 'v33_35_action_digest_invalid');
  const takeover = verifyDigest(input.takeover.payload, 'takeoverDigest', 'v33_35_takeover_certificate_digest_invalid');
  if (input.action.issuerKeyId !== action.coordinatorKeyId) throw new Error('v33_35_action_signer_binding_invalid');
  enforceBoundary(action, 'v33_35_action_boundary_invalid');
  if (action.epoch !== takeover.epoch || action.sequence < takeover.sequenceStart || action.sequence > takeover.sequenceEnd) throw new Error('v33_35_action_sequence_outside_takeover');
  if (action.coordinatorKeyId === takeover.outgoingCoordinatorKeyId) throw new Error('v33_35_outgoing_coordinator_fenced');
  if (action.coordinatorKeyId !== takeover.replacementCoordinatorKeyId || action.term !== takeover.nextTerm || action.takeoverDigest !== takeover.takeoverDigest || action.leaseDigest !== takeover.predecessorLeaseDigest || Date.parse(action.issuedAt) < Date.parse(takeover.fenceEffectiveAt)) throw new Error('v33_35_replacement_action_binding_invalid');
  return action;
}

export function createPublishedTakeoverArtifactV33_35(input: { readonly takeover: SignedEnvelope<ExpiredCoordinatorTakeoverCertificateV33_35>; readonly content: Uint8Array; readonly createdAt: Date }): PublishedTakeoverArtifactV33_35 {
  requireDate(input.createdAt, 'v33_35_artifact_time_invalid');
  const material = {
    version: '33.35' as const,
    artifactId: randomUUID(),
    takeoverDigest: digest(input.takeover.payload.takeoverDigest, 'v33_35_artifact_takeover_invalid'),
    contentDigest: sha256Bytes(input.content),
    mediaType: 'application/json' as const,
    createdAt: input.createdAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return { ...material, artifactDigest: sha256(material) };
}

export function createPublicationEndpointReceiptV33_35(input: {
  readonly publisher: SigningIdentity;
  readonly publisherDescriptor: ContinuityActorDescriptorV33_33;
  readonly artifact: PublishedTakeoverArtifactV33_35;
  readonly endpointUri: string;
  readonly publishedAt: Date;
}): SignedEnvelope<PublicationEndpointReceiptV33_35> {
  requireDate(input.publishedAt, 'v33_35_publication_time_invalid');
  if (input.publisher.keyId !== input.publisherDescriptor.keyId) throw new Error('v33_35_publisher_signer_invalid');
  const endpointUri = validEndpointUri(input.endpointUri);
  const material = {
    version: '33.35' as const,
    receiptId: randomUUID(),
    artifactDigest: input.artifact.artifactDigest,
    contentDigest: input.artifact.contentDigest,
    endpointUri,
    publisherKeyId: input.publisherDescriptor.keyId,
    publisherOrganizationId: identifier(input.publisherDescriptor.organizationId, 'v33_35_publisher_org_invalid'),
    publisherHostId: identifier(input.publisherDescriptor.hostId, 'v33_35_publisher_host_invalid'),
    publishedAt: input.publishedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, receiptDigest: sha256(material) }, input.publisher);
}

export function createMonitorRetrievalReceiptV33_35(input: {
  readonly monitor: SigningIdentity;
  readonly monitorDescriptor: RecoveryWitnessDescriptorV33_34;
  readonly publicationReceipt: SignedEnvelope<PublicationEndpointReceiptV33_35>;
  readonly content: Uint8Array;
  readonly transport: RetrievalTransportV33_35;
  readonly processId: number;
  readonly observedAt: Date;
}): SignedEnvelope<MonitorRetrievalReceiptV33_35> {
  requireDate(input.observedAt, 'v33_35_retrieval_time_invalid');
  if (input.monitor.keyId !== input.monitorDescriptor.keyId) throw new Error('v33_35_monitor_signer_invalid');
  if (!Number.isSafeInteger(input.processId) || input.processId <= 0) throw new Error('v33_35_monitor_process_invalid');
  const publication = input.publicationReceipt.payload;
  const contentDigest = sha256Bytes(input.content);
  if (contentDigest !== publication.contentDigest) throw new Error('v33_35_retrieved_content_mismatch');
  const material = {
    version: '33.35' as const,
    retrievalId: randomUUID(),
    publicationReceiptDigest: publication.receiptDigest,
    endpointUri: publication.endpointUri,
    artifactDigest: publication.artifactDigest,
    contentDigest,
    httpStatus: 200 as const,
    transport: input.transport,
    monitorId: identifier(input.monitorDescriptor.witnessId, 'v33_35_monitor_id_invalid'),
    monitorKeyId: input.monitorDescriptor.keyId,
    monitorOrganizationId: input.monitorDescriptor.organizationId,
    monitorHostId: input.monitorDescriptor.hostId,
    processId: input.processId,
    observedAt: input.observedAt.toISOString(),
    networkFetchObserved: true as const,
    externalTopologyObserved: input.transport === 'HTTPS_EXTERNAL',
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, retrievalDigest: sha256(material) }, input.monitor);
}

export function createMonitorGossipStatementV33_35(input: {
  readonly monitor: SigningIdentity;
  readonly ownReceipt: SignedEnvelope<MonitorRetrievalReceiptV33_35>;
  readonly peerReceipts: readonly SignedEnvelope<MonitorRetrievalReceiptV33_35>[];
  readonly observedAt: Date;
}): SignedEnvelope<MonitorGossipStatementV33_35> {
  requireDate(input.observedAt, 'v33_35_gossip_time_invalid');
  const own = input.ownReceipt.payload;
  if (input.monitor.keyId !== own.monitorKeyId) throw new Error('v33_35_gossip_signer_invalid');
  const all = [input.ownReceipt, ...input.peerReceipts].map((row) => row.payload);
  if (all.some((row) => row.endpointUri !== own.endpointUri || row.publicationReceiptDigest !== own.publicationReceiptDigest || row.artifactDigest !== own.artifactDigest || row.contentDigest !== own.contentDigest)) throw new Error('v33_35_gossip_split_view_detected');
  const peerRetrievalDigests = uniqueSorted(input.peerReceipts.map((row) => row.payload.retrievalDigest));
  const material = {
    version: '33.35' as const,
    gossipId: randomUUID(),
    endpointUri: own.endpointUri,
    publicationReceiptDigest: own.publicationReceiptDigest,
    artifactDigest: own.artifactDigest,
    contentDigest: own.contentDigest,
    retrievalDigest: own.retrievalDigest,
    peerRetrievalDigests,
    monitorId: own.monitorId,
    monitorKeyId: own.monitorKeyId,
    monitorOrganizationId: own.monitorOrganizationId,
    monitorHostId: own.monitorHostId,
    observedAt: input.observedAt.toISOString(),
    decision: 'CONSISTENT' as const,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, gossipDigest: sha256(material) }, input.monitor);
}

export function verifyRetrievalAndGossipV33_35(input: {
  readonly publicationReceipt: SignedEnvelope<PublicationEndpointReceiptV33_35>;
  readonly retrievalReceipts: readonly SignedEnvelope<MonitorRetrievalReceiptV33_35>[];
  readonly gossipStatements: readonly SignedEnvelope<MonitorGossipStatementV33_35>[];
  readonly trust: RetrievalTrustV33_35;
  readonly verifiedAt: Date;
}): { readonly retrievals: readonly MonitorRetrievalReceiptV33_35[]; readonly gossip: readonly MonitorGossipStatementV33_35[]; readonly independentProcessesObserved: boolean; readonly externalTopologyObserved: boolean } {
  requireDate(input.verifiedAt, 'v33_35_retrieval_verify_time_invalid');
  const pubEnv = input.publicationReceipt;
  if (!input.trust.trustedPublisherIds.includes(pubEnv.issuerKeyId) || !input.trust.publisherRegistry.verifyAt(pubEnv, input.verifiedAt)) throw new Error('v33_35_publication_signature_invalid');
  const publication = verifyDigest(pubEnv.payload, 'receiptDigest', 'v33_35_publication_digest_invalid');
  enforceBoundary(publication, 'v33_35_publication_boundary_invalid');
  const retrievals = input.retrievalReceipts.map((env) => {
    if (!input.trust.trustedMonitorIds.includes(env.issuerKeyId) || !input.trust.monitorRegistry.verifyAt(env, input.verifiedAt)) throw new Error('v33_35_retrieval_signature_invalid');
    const row = verifyDigest(env.payload, 'retrievalDigest', 'v33_35_retrieval_digest_invalid');
    const monitor = input.trust.monitors.find((candidate) => candidate.keyId === row.monitorKeyId);
    if (monitor === undefined || env.issuerKeyId !== row.monitorKeyId || row.monitorId !== monitor.witnessId || row.monitorOrganizationId !== monitor.organizationId || row.monitorHostId !== monitor.hostId || row.publicationReceiptDigest !== publication.receiptDigest || row.endpointUri !== publication.endpointUri || row.artifactDigest !== publication.artifactDigest || row.contentDigest !== publication.contentDigest || row.httpStatus !== 200 || row.networkFetchObserved !== true) throw new Error('v33_35_retrieval_binding_invalid');
    enforceBoundary(row, 'v33_35_retrieval_boundary_invalid');
    return row;
  });
  ensureTopologyDistinct(retrievals.map((row) => ({ keyId: row.monitorKeyId, keyFingerprint: input.trust.monitorRegistry.fingerprint(row.monitorKeyId) ?? '', organizationId: row.monitorOrganizationId, hostId: row.monitorHostId })), 'v33_35_retrieval_topology_invalid');
  if (retrievals.length < input.trust.quorum || new Set(retrievals.map((row) => row.monitorKeyId)).size !== retrievals.length) throw new Error('v33_35_retrieval_quorum_not_met');
  if (detectMonitorSplitViewV33_35(input.retrievalReceipts).length > 0) throw new Error('v33_35_retrieval_split_view_detected');
  const gossip = input.gossipStatements.map((env) => {
    if (!input.trust.trustedMonitorIds.includes(env.issuerKeyId) || !input.trust.monitorRegistry.verifyAt(env, input.verifiedAt)) throw new Error('v33_35_gossip_signature_invalid');
    const row = verifyDigest(env.payload, 'gossipDigest', 'v33_35_gossip_digest_invalid');
    const own = retrievals.find((receipt) => receipt.retrievalDigest === row.retrievalDigest && receipt.monitorKeyId === row.monitorKeyId);
    if (own === undefined || env.issuerKeyId !== row.monitorKeyId || row.endpointUri !== publication.endpointUri || row.publicationReceiptDigest !== publication.receiptDigest || row.artifactDigest !== publication.artifactDigest || row.contentDigest !== publication.contentDigest || row.decision !== 'CONSISTENT') throw new Error('v33_35_gossip_binding_invalid');
    const expectedPeers = retrievals.filter((receipt) => receipt.monitorKeyId !== row.monitorKeyId).map((receipt) => receipt.retrievalDigest);
    if (!sameSet(row.peerRetrievalDigests, expectedPeers)) throw new Error('v33_35_gossip_peer_set_invalid');
    enforceBoundary(row, 'v33_35_gossip_boundary_invalid');
    return row;
  });
  if (gossip.length < input.trust.quorum || new Set(gossip.map((row) => row.monitorKeyId)).size !== gossip.length) throw new Error('v33_35_gossip_quorum_not_met');
  return {
    retrievals,
    gossip,
    independentProcessesObserved: new Set(retrievals.map((row) => row.processId)).size >= input.trust.quorum,
    externalTopologyObserved: retrievals.every((row) => row.externalTopologyObserved),
  };
}

export function detectMonitorSplitViewV33_35(receipts: readonly SignedEnvelope<MonitorRetrievalReceiptV33_35>[]): readonly MonitorSplitViewFindingV33_35[] {
  const groups = new Map<string, MonitorRetrievalReceiptV33_35[]>();
  for (const env of receipts) {
    const row = env.payload;
    const key = `${row.endpointUri}|${row.publicationReceiptDigest}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].flatMap((rows) => {
    const artifactDigests = [...new Set(rows.map((row) => row.artifactDigest))].sort();
    const contentDigests = [...new Set(rows.map((row) => row.contentDigest))].sort();
    if (artifactDigests.length <= 1 && contentDigests.length <= 1) return [];
    return [{ endpointUri: rows[0]!.endpointUri, publicationReceiptDigest: rows[0]!.publicationReceiptDigest, artifactDigests, contentDigests, monitorKeyIds: [...new Set(rows.map((row) => row.monitorKeyId))].sort() }];
  });
}

export function createTakeoverRecoveryVerdictV33_35(input: {
  readonly takeover: SignedEnvelope<ExpiredCoordinatorTakeoverCertificateV33_35>;
  readonly retrievalResult: { readonly independentProcessesObserved: boolean; readonly externalTopologyObserved: boolean };
  readonly generatedAt: Date;
}): TakeoverRecoveryVerdictV33_35 {
  requireDate(input.generatedAt, 'v33_35_verdict_time_invalid');
  const takeover = input.takeover.payload;
  const material = {
    version: '33.35' as const,
    takeoverDigest: takeover.takeoverDigest,
    predecessorLeaseDigest: takeover.predecessorLeaseDigest,
    expiredLeaseTakeoverVerified: true as const,
    outgoingCoordinatorSignatureRequired: false as const,
    coordinatorResurrectionBlocked: true as const,
    retrievalQuorumVerified: true as const,
    gossipConsistencyVerified: true as const,
    splitViewRejected: true as const,
    independentProcessesObserved: input.retrievalResult.independentProcessesObserved,
    networkFetchObserved: true,
    externalTopologyObserved: input.retrievalResult.externalTopologyObserved,
    externalHumanParticipants: 0 as const,
    status: 'LOCAL_MULTI_PROCESS_RECOVERY_REHEARSAL_ONLY' as const,
    generatedAt: input.generatedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return { ...material, verdictDigest: sha256(material) };
}

function verifyTakeoverCore(input: Omit<ExpiredCoordinatorTakeoverBundleV33_35, 'certificate'> | ExpiredCoordinatorTakeoverBundleV33_35, trust: ExpiredCoordinatorTakeoverTrustV33_35, now: Date): { lease: CoordinatorLeaseCertificateV33_33; plan: ExpiredCoordinatorTakeoverPlanV33_35; acceptance: ReplacementTakeoverAcceptanceV33_35; votes: readonly LeaseExpiryWitnessVoteV33_35[] } {
  requireDate(now, 'v33_35_takeover_verify_time_invalid');
  const leaseEnv = input.predecessorLease;
  if (!trust.trustedPredecessorLeaseSignerIds.includes(leaseEnv.issuerKeyId) || !trust.predecessorLeaseRegistry.verifyAt(leaseEnv, now)) throw new Error('v33_35_predecessor_lease_signature_invalid');
  const lease = verifyDigest(leaseEnv.payload, 'leaseDigest', 'v33_35_predecessor_lease_digest_invalid');
  const planEnv = input.plan;
  if (!trust.trustedPlanSignerIds.includes(planEnv.issuerKeyId) || !trust.planRegistry.verifyAt(planEnv, now)) throw new Error('v33_35_takeover_plan_signature_invalid');
  const plan = verifyDigest(planEnv.payload, 'planDigest', 'v33_35_takeover_plan_digest_invalid');
  if (planEnv.issuerKeyId !== plan.recoveryAuthority.keyId || plan.predecessorLeaseDigest !== lease.leaseDigest || plan.epoch !== lease.epoch || plan.predecessorTerm !== lease.term || plan.nextTerm !== lease.term + 1 || plan.predecessorSequenceEnd !== lease.sequenceEnd || plan.sequenceStart !== lease.sequenceEnd + 1 || plan.outgoingCoordinator.keyId !== lease.coordinatorKeyId || plan.outgoingCoordinator.organizationId !== lease.coordinatorOrganizationId || plan.outgoingCoordinator.hostId !== lease.coordinatorHostId || plan.leaseExpiresAt !== lease.expiresAt || Date.parse(plan.earliestTakeoverAt) !== Date.parse(lease.expiresAt) + plan.expirySafetyDelayMs || now.getTime() < Date.parse(plan.earliestTakeoverAt) || now.getTime() >= Date.parse(plan.expiresAt)) throw new Error('v33_35_takeover_plan_binding_invalid');
  enforceBoundary(plan, 'v33_35_takeover_plan_boundary_invalid');
  const acceptanceEnv = input.acceptance;
  if (!trust.trustedReplacementCoordinatorIds.includes(acceptanceEnv.issuerKeyId) || !trust.replacementCoordinatorRegistry.verifyAt(acceptanceEnv, now)) throw new Error('v33_35_acceptance_signature_invalid');
  const acceptance = verifyDigest(acceptanceEnv.payload, 'acceptanceDigest', 'v33_35_acceptance_digest_invalid');
  if (acceptanceEnv.issuerKeyId !== plan.replacementCoordinator.keyId || trust.replacementCoordinatorRegistry.fingerprint(acceptance.replacementCoordinatorKeyId) !== acceptance.replacementCoordinatorKeyFingerprint || acceptance.planDigest !== plan.planDigest || acceptance.predecessorLeaseDigest !== lease.leaseDigest || acceptance.epoch !== plan.epoch || acceptance.nextTerm !== plan.nextTerm || acceptance.sequenceStart !== plan.sequenceStart || acceptance.sequenceEnd !== plan.sequenceEnd || acceptance.replacementCoordinatorKeyId !== plan.replacementCoordinator.keyId || acceptance.replacementCoordinatorOrganizationId !== plan.replacementCoordinator.organizationId || acceptance.replacementCoordinatorHostId !== plan.replacementCoordinator.hostId || acceptance.challengeDigest !== plan.challengeDigest) throw new Error('v33_35_acceptance_binding_invalid');
  enforceBoundary(acceptance, 'v33_35_acceptance_boundary_invalid');
  const votes = input.expiryVotes.map((env) => {
    if (!trust.trustedWitnessIds.includes(env.issuerKeyId) || !trust.witnessRegistry.verifyAt(env, now)) throw new Error('v33_35_expiry_vote_signature_invalid');
    const vote = verifyDigest(env.payload, 'voteDigest', 'v33_35_expiry_vote_digest_invalid');
    const witness = plan.witnesses.find((row) => row.keyId === vote.witnessKeyId);
    if (witness === undefined || env.issuerKeyId !== vote.witnessKeyId || vote.planDigest !== plan.planDigest || vote.predecessorLeaseDigest !== lease.leaseDigest || vote.leaseExpiresAt !== lease.expiresAt || vote.earliestTakeoverAt !== plan.earliestTakeoverAt || vote.witnessId !== witness.witnessId || vote.witnessOrganizationId !== witness.organizationId || vote.witnessHostId !== witness.hostId || vote.decision !== 'LEASE_EXPIRED' || Date.parse(vote.observedAt) < Date.parse(plan.earliestTakeoverAt)) throw new Error('v33_35_expiry_vote_binding_invalid');
    enforceBoundary(vote, 'v33_35_expiry_vote_boundary_invalid');
    return vote;
  });
  ensureTopologyDistinct(votes.map((row) => ({ keyId: row.witnessKeyId, keyFingerprint: trust.witnessRegistry.fingerprint(row.witnessKeyId) ?? '', organizationId: row.witnessOrganizationId, hostId: row.witnessHostId })), 'v33_35_expiry_vote_topology_invalid');
  if (votes.length < plan.quorumRequired || new Set(votes.map((row) => row.witnessKeyId)).size !== votes.length) throw new Error('v33_35_expiry_vote_quorum_not_met');
  return { lease, plan, acceptance, votes };
}

function normalizeWitnesses(input: readonly RecoveryWitnessDescriptorV33_34[]): RecoveryWitnessDescriptorV33_34[] {
  const rows = input.map((row) => ({ witnessId: identifier(row.witnessId, 'v33_35_witness_id_invalid'), ...normalizeActor(row, 'v33_35_witness') })).sort((a, b) => a.keyId.localeCompare(b.keyId));
  ensureTopologyDistinct(rows, 'v33_35_witness_topology_invalid');
  return rows;
}

function normalizeActor(input: ContinuityActorDescriptorV33_33, prefix: string): ContinuityActorDescriptorV33_33 {
  return { keyId: identifier(input.keyId, `${prefix}_key_invalid`), keyFingerprint: digest(input.keyFingerprint, `${prefix}_fingerprint_invalid`), organizationId: identifier(input.organizationId, `${prefix}_organization_invalid`), hostId: identifier(input.hostId, `${prefix}_host_invalid`) };
}

function ensureTopologyDistinct(rows: readonly ContinuityActorDescriptorV33_33[], error: string): void {
  if (new Set(rows.map((row) => row.keyId)).size !== rows.length || new Set(rows.map((row) => row.organizationId)).size !== rows.length || new Set(rows.map((row) => row.hostId)).size !== rows.length) throw new Error(error);
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

function digest(value: string, error: string): string { if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(error); return value; }
function identifier(value: string, error: string): string { const v = value.trim(); if (v.length < 2 || v.length > 300 || !/^[A-Za-z0-9._:/-]+$/.test(v)) throw new Error(error); return v; }
function integer(value: number, minimum: number, error: string): number { if (!Number.isSafeInteger(value) || value < minimum) throw new Error(error); return value; }
function sameSet(left: readonly string[], right: readonly string[]): boolean { const a = [...left].sort(); const b = [...right].sort(); return a.length === b.length && a.every((v, i) => v === b[i]); }
function uniqueSorted(values: readonly string[]): string[] { const rows = values.map((v) => identifier(v, 'v33_35_digest_list_invalid')); if (new Set(rows).size !== rows.length) throw new Error('v33_35_duplicate_value'); return rows.sort(); }
function requireDate(value: Date, error: string): void { if (!Number.isFinite(value.getTime())) throw new Error(error); }
function validEndpointUri(value: string): string {
  let parsed: URL; try { parsed = new URL(value); } catch { throw new Error('v33_35_endpoint_uri_invalid'); }
  const loopback = parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '::1');
  if ((!loopback && parsed.protocol !== 'https:') || parsed.username !== '' || parsed.password !== '' || parsed.hash !== '') throw new Error('v33_35_endpoint_uri_invalid');
  return parsed.toString();
}
