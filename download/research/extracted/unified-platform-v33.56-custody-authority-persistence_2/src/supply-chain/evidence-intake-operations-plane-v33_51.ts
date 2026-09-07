import { KeyRegistry, sha256, signEnvelope, type SignedEnvelope, type SigningIdentity } from '../contracts/crypto.js';
import type { CoordinatorDeploymentRoleV33_48 } from './external-coordinator-deployment-evidence-import-v33_48.js';
import type {
  IntakePortalPolicyPayloadV33_50,
  IntakeReadinessVerdictPayloadV33_50,
  QuarantineReceiptPayloadV33_50,
} from './ceremony-evidence-intake-portal-v33_50.js';

export type OperationsExecutionClassV33_51 = 'LOCAL_REHEARSAL' | 'LIVE_EXTERNAL';
export type ReviewDecisionV33_51 = 'ACCEPT' | 'REJECT';
export type OperationsReadinessStatusV33_51 =
  | 'LOCAL_OPERATIONS_COMPLETE_REHEARSAL_ONLY'
  | 'EXTERNAL_CEREMONY_READINESS_CERTIFIED';

export interface OperationsActorV33_51 {
  readonly keyId: string;
  readonly organizationId: string;
  readonly administratorId: string;
  readonly hostId: string;
}

export interface OperationsPolicyPayloadV33_51 {
  readonly version: '33.51';
  readonly operationsPlaneId: string;
  readonly portalId: string;
  readonly ceremonyId: string;
  readonly basePolicyDigest: string;
  readonly baseReadinessVerdictDigest: string;
  readonly authority: OperationsActorV33_51;
  readonly requiredRoleCount: 16;
  readonly requiredExternalAttestations: 22;
  readonly dualControlReviewQuorum: 2;
  readonly requiredQuorumSnapshots: 4;
  readonly ticketSlaSeconds: number;
  readonly disputeSlaSeconds: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly policyDigest: string;
}

export interface IntakeQueueTicketPayloadV33_51 {
  readonly version: '33.51';
  readonly operationsPlaneId: string;
  readonly portalId: string;
  readonly ceremonyId: string;
  readonly policyDigest: string;
  readonly role: CoordinatorDeploymentRoleV33_48;
  readonly ordinal: number;
  readonly organizationId: string;
  readonly receiptDigest: string;
  readonly executionClass: OperationsExecutionClassV33_51;
  readonly revision: number;
  readonly predecessorTicketDigest: string | null;
  readonly queuedAt: string;
  readonly reviewDeadline: string;
  readonly queueState: 'QUEUED';
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly ticketDigest: string;
}

export interface DualControlReviewPayloadV33_51 {
  readonly version: '33.51';
  readonly operationsPlaneId: string;
  readonly policyDigest: string;
  readonly ticketDigest: string;
  readonly receiptDigest: string;
  readonly reviewer: OperationsActorV33_51;
  readonly decision: ReviewDecisionV33_51;
  readonly reasonDigest: string;
  readonly reviewedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly reviewDigest: string;
}

export interface DualControlApprovalPayloadV33_51 {
  readonly version: '33.51';
  readonly operationsPlaneId: string;
  readonly policyDigest: string;
  readonly ticketDigest: string;
  readonly receiptDigest: string;
  readonly role: CoordinatorDeploymentRoleV33_48;
  readonly ordinal: number;
  readonly revision: number;
  readonly reviewDigests: readonly string[];
  readonly approvedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly approvalDigest: string;
}

export interface EvidenceDisputePayloadV33_51 {
  readonly version: '33.51';
  readonly operationsPlaneId: string;
  readonly policyDigest: string;
  readonly ticketDigest: string;
  readonly receiptDigest: string;
  readonly rejectReviewDigest: string;
  readonly openedBy: OperationsActorV33_51;
  readonly reasonDigest: string;
  readonly openedAt: string;
  readonly expiresAt: string;
  readonly disputeState: 'OPEN';
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly disputeDigest: string;
}

export interface EvidenceResubmissionPayloadV33_51 {
  readonly version: '33.51';
  readonly operationsPlaneId: string;
  readonly policyDigest: string;
  readonly disputeDigest: string;
  readonly predecessorTicketDigest: string;
  readonly replacementReceiptDigest: string;
  readonly role: CoordinatorDeploymentRoleV33_48;
  readonly ordinal: number;
  readonly revision: number;
  readonly submittedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly resubmissionDigest: string;
}

export interface QuorumProgressSnapshotPayloadV33_51 {
  readonly version: '33.51';
  readonly operationsPlaneId: string;
  readonly policyDigest: string;
  readonly sequence: number;
  readonly predecessorSnapshotDigest: string | null;
  readonly acceptedApprovalDigests: readonly string[];
  readonly acceptedRoleCount: number;
  readonly externalAttestationCount: number;
  readonly openDisputeCount: number;
  readonly locallyComplete: boolean;
  readonly externallyComplete: boolean;
  readonly recordedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly snapshotDigest: string;
}

export interface ExternalReadinessCertificatePayloadV33_51 {
  readonly version: '33.51';
  readonly operationsPlaneId: string;
  readonly portalId: string;
  readonly ceremonyId: string;
  readonly policyDigest: string;
  readonly baseReadinessVerdictDigest: string;
  readonly finalSnapshotDigest: string;
  readonly approvalDigests: readonly string[];
  readonly roleCount: 16;
  readonly externalAttestationCount: number;
  readonly openDisputeCount: 0;
  readonly dualControlVerified: true;
  readonly progressionLedgerVerified: true;
  readonly status: OperationsReadinessStatusV33_51;
  readonly externalCeremonyObserved: boolean;
  readonly externalHumanParticipants: 0;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly certificateDigest: string;
}

export interface EvidenceIntakeOperationsTrustV33_51 {
  readonly policyRegistry: KeyRegistry;
  readonly trustedPolicySignerIds: readonly string[];
  readonly queueRegistry: KeyRegistry;
  readonly trustedQueueSignerIds: readonly string[];
  readonly reviewerRegistry: KeyRegistry;
  readonly trustedReviewerIds: readonly string[];
  readonly approvalRegistry: KeyRegistry;
  readonly trustedApprovalSignerIds: readonly string[];
  readonly disputeRegistry: KeyRegistry;
  readonly trustedDisputeSignerIds: readonly string[];
  readonly resubmissionRegistry: KeyRegistry;
  readonly trustedResubmissionSignerIds: readonly string[];
  readonly snapshotRegistry: KeyRegistry;
  readonly trustedSnapshotSignerIds: readonly string[];
  readonly readinessRegistry: KeyRegistry;
  readonly trustedReadinessSignerIds: readonly string[];
  readonly basePortalRegistry: KeyRegistry;
  readonly trustedBasePortalSignerIds: readonly string[];
  readonly baseReadinessRegistry: KeyRegistry;
  readonly trustedBaseReadinessSignerIds: readonly string[];
}

const HEX64 = /^[0-9a-f]{64}$/;
const digestWithout = <T extends Record<string, unknown>>(payload: T, key: keyof T): string => {
  const copy = { ...payload };
  delete copy[key];
  return sha256(copy);
};
const assertDigest = (payload: Record<string, unknown>, key: string, code: string): void => {
  const value = payload[key];
  if (typeof value !== 'string' || !HEX64.test(value) || digestWithout(payload, key) !== value) throw new Error(code);
};
const parseTime = (value: string, code: string): number => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(code);
  return parsed;
};
const verifyEnvelope = <T>(envelope: SignedEnvelope<T>, registry: KeyRegistry, trusted: readonly string[], at: Date, code: string): void => {
  if (!trusted.includes(envelope.issuerKeyId) || !registry.verifyAt(envelope, at)) throw new Error(code);
};
const assertActor = (actor: OperationsActorV33_51, code: string): void => {
  if (Object.values(actor).some((value) => typeof value !== 'string' || value.trim() === '')) throw new Error(code);
};
const assertDistinctReviewers = (reviews: readonly SignedEnvelope<DualControlReviewPayloadV33_51>[]): void => {
  for (const field of ['keyId', 'organizationId', 'administratorId', 'hostId'] as const) {
    if (new Set(reviews.map((review) => review.payload.reviewer[field])).size !== reviews.length) throw new Error('reviewer_separation');
  }
};
const roleSlot = (role: CoordinatorDeploymentRoleV33_48, ordinal: number): string => `${role}:${ordinal}`;

export function createOperationsPolicyV33_51(input: {
  signer: SigningIdentity;
  authority: OperationsActorV33_51;
  operationsPlaneId: string;
  basePolicy: SignedEnvelope<IntakePortalPolicyPayloadV33_50>;
  baseReadinessVerdict: SignedEnvelope<IntakeReadinessVerdictPayloadV33_50>;
  issuedAt: Date;
  expiresAt: Date;
  ticketSlaSeconds?: number;
  disputeSlaSeconds?: number;
}): SignedEnvelope<OperationsPolicyPayloadV33_51> {
  assertActor(input.authority, 'policy_actor');
  if (input.operationsPlaneId.trim() === '' || input.expiresAt <= input.issuedAt) throw new Error('policy_input');
  const ticketSlaSeconds = input.ticketSlaSeconds ?? 3600;
  const disputeSlaSeconds = input.disputeSlaSeconds ?? 7200;
  if (ticketSlaSeconds < 60 || disputeSlaSeconds < ticketSlaSeconds) throw new Error('policy_sla');
  const material = {
    version: '33.51' as const,
    operationsPlaneId: input.operationsPlaneId,
    portalId: input.basePolicy.payload.portalId,
    ceremonyId: input.basePolicy.payload.ceremonyId,
    basePolicyDigest: input.basePolicy.payload.policyDigest,
    baseReadinessVerdictDigest: input.baseReadinessVerdict.payload.verdictDigest,
    authority: input.authority,
    requiredRoleCount: 16 as const,
    requiredExternalAttestations: 22 as const,
    dualControlReviewQuorum: 2 as const,
    requiredQuorumSnapshots: 4 as const,
    ticketSlaSeconds,
    disputeSlaSeconds,
    issuedAt: input.issuedAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, policyDigest: sha256(material) }, input.signer);
}

export function createQueueTicketV33_51(input: {
  signer: SigningIdentity;
  policy: SignedEnvelope<OperationsPolicyPayloadV33_51>;
  receipt: SignedEnvelope<QuarantineReceiptPayloadV33_50>;
  executionClass: OperationsExecutionClassV33_51;
  queuedAt: Date;
  revision?: number;
  predecessorTicketDigest?: string | null;
}): SignedEnvelope<IntakeQueueTicketPayloadV33_51> {
  const revision = input.revision ?? 1;
  const predecessor = input.predecessorTicketDigest ?? null;
  if (revision < 1 || (revision === 1) !== (predecessor === null)) throw new Error('ticket_revision');
  const material = {
    version: '33.51' as const,
    operationsPlaneId: input.policy.payload.operationsPlaneId,
    portalId: input.policy.payload.portalId,
    ceremonyId: input.policy.payload.ceremonyId,
    policyDigest: input.policy.payload.policyDigest,
    role: input.receipt.payload.role,
    ordinal: input.receipt.payload.ordinal,
    organizationId: input.receipt.payload.actor.organizationId,
    receiptDigest: input.receipt.payload.receiptDigest,
    executionClass: input.executionClass,
    revision,
    predecessorTicketDigest: predecessor,
    queuedAt: input.queuedAt.toISOString(),
    reviewDeadline: new Date(input.queuedAt.getTime() + input.policy.payload.ticketSlaSeconds * 1000).toISOString(),
    queueState: 'QUEUED' as const,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, ticketDigest: sha256(material) }, input.signer);
}

export function createReviewDecisionV33_51(input: {
  signer: SigningIdentity;
  reviewer: OperationsActorV33_51;
  policy: SignedEnvelope<OperationsPolicyPayloadV33_51>;
  ticket: SignedEnvelope<IntakeQueueTicketPayloadV33_51>;
  decision: ReviewDecisionV33_51;
  reason: string;
  reviewedAt: Date;
}): SignedEnvelope<DualControlReviewPayloadV33_51> {
  assertActor(input.reviewer, 'review_actor');
  if (input.reason.trim() === '') throw new Error('review_reason');
  if (input.reviewedAt.getTime() > parseTime(input.ticket.payload.reviewDeadline, 'ticket_deadline')) throw new Error('review_expired');
  const material = {
    version: '33.51' as const,
    operationsPlaneId: input.policy.payload.operationsPlaneId,
    policyDigest: input.policy.payload.policyDigest,
    ticketDigest: input.ticket.payload.ticketDigest,
    receiptDigest: input.ticket.payload.receiptDigest,
    reviewer: input.reviewer,
    decision: input.decision,
    reasonDigest: sha256({ reason: input.reason }),
    reviewedAt: input.reviewedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, reviewDigest: sha256(material) }, input.signer);
}

export function createDualControlApprovalV33_51(input: {
  signer: SigningIdentity;
  policy: SignedEnvelope<OperationsPolicyPayloadV33_51>;
  ticket: SignedEnvelope<IntakeQueueTicketPayloadV33_51>;
  reviews: readonly SignedEnvelope<DualControlReviewPayloadV33_51>[];
  trust: EvidenceIntakeOperationsTrustV33_51;
  approvedAt: Date;
}): SignedEnvelope<DualControlApprovalPayloadV33_51> {
  if (input.reviews.length !== input.policy.payload.dualControlReviewQuorum) throw new Error('review_quorum');
  assertDistinctReviewers(input.reviews);
  const digests: string[] = [];
  for (const review of input.reviews) {
    verifyEnvelope(review, input.trust.reviewerRegistry, input.trust.trustedReviewerIds, input.approvedAt, 'review_signature');
    assertDigest(review.payload as unknown as Record<string, unknown>, 'reviewDigest', 'review_digest');
    if (review.payload.policyDigest !== input.policy.payload.policyDigest || review.payload.ticketDigest !== input.ticket.payload.ticketDigest || review.payload.receiptDigest !== input.ticket.payload.receiptDigest) throw new Error('review_binding');
    if (review.payload.decision !== 'ACCEPT') throw new Error('review_rejected');
    digests.push(review.payload.reviewDigest);
  }
  const material = {
    version: '33.51' as const,
    operationsPlaneId: input.policy.payload.operationsPlaneId,
    policyDigest: input.policy.payload.policyDigest,
    ticketDigest: input.ticket.payload.ticketDigest,
    receiptDigest: input.ticket.payload.receiptDigest,
    role: input.ticket.payload.role,
    ordinal: input.ticket.payload.ordinal,
    revision: input.ticket.payload.revision,
    reviewDigests: digests.sort(),
    approvedAt: input.approvedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, approvalDigest: sha256(material) }, input.signer);
}

export function openEvidenceDisputeV33_51(input: {
  signer: SigningIdentity;
  openedBy: OperationsActorV33_51;
  policy: SignedEnvelope<OperationsPolicyPayloadV33_51>;
  ticket: SignedEnvelope<IntakeQueueTicketPayloadV33_51>;
  rejectReview: SignedEnvelope<DualControlReviewPayloadV33_51>;
  reason: string;
  openedAt: Date;
  trust: EvidenceIntakeOperationsTrustV33_51;
}): SignedEnvelope<EvidenceDisputePayloadV33_51> {
  assertActor(input.openedBy, 'dispute_actor');
  verifyEnvelope(input.rejectReview, input.trust.reviewerRegistry, input.trust.trustedReviewerIds, input.openedAt, 'review_signature');
  assertDigest(input.rejectReview.payload as unknown as Record<string, unknown>, 'reviewDigest', 'review_digest');
  if (input.rejectReview.payload.decision !== 'REJECT' || input.rejectReview.payload.ticketDigest !== input.ticket.payload.ticketDigest) throw new Error('dispute_review');
  if (input.reason.trim() === '') throw new Error('dispute_reason');
  const material = {
    version: '33.51' as const,
    operationsPlaneId: input.policy.payload.operationsPlaneId,
    policyDigest: input.policy.payload.policyDigest,
    ticketDigest: input.ticket.payload.ticketDigest,
    receiptDigest: input.ticket.payload.receiptDigest,
    rejectReviewDigest: input.rejectReview.payload.reviewDigest,
    openedBy: input.openedBy,
    reasonDigest: sha256({ reason: input.reason }),
    openedAt: input.openedAt.toISOString(),
    expiresAt: new Date(input.openedAt.getTime() + input.policy.payload.disputeSlaSeconds * 1000).toISOString(),
    disputeState: 'OPEN' as const,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, disputeDigest: sha256(material) }, input.signer);
}

export function createEvidenceResubmissionV33_51(input: {
  signer: SigningIdentity;
  policy: SignedEnvelope<OperationsPolicyPayloadV33_51>;
  dispute: SignedEnvelope<EvidenceDisputePayloadV33_51>;
  predecessorTicket: SignedEnvelope<IntakeQueueTicketPayloadV33_51>;
  replacementReceipt: SignedEnvelope<QuarantineReceiptPayloadV33_50>;
  submittedAt: Date;
}): SignedEnvelope<EvidenceResubmissionPayloadV33_51> {
  if (input.dispute.payload.ticketDigest !== input.predecessorTicket.payload.ticketDigest) throw new Error('resubmission_dispute_binding');
  if (input.replacementReceipt.payload.role !== input.predecessorTicket.payload.role || input.replacementReceipt.payload.ordinal !== input.predecessorTicket.payload.ordinal) throw new Error('resubmission_role_binding');
  if (input.replacementReceipt.payload.receiptDigest === input.predecessorTicket.payload.receiptDigest) throw new Error('resubmission_unchanged');
  if (input.submittedAt.getTime() > parseTime(input.dispute.payload.expiresAt, 'dispute_expiry')) throw new Error('resubmission_expired');
  const material = {
    version: '33.51' as const,
    operationsPlaneId: input.policy.payload.operationsPlaneId,
    policyDigest: input.policy.payload.policyDigest,
    disputeDigest: input.dispute.payload.disputeDigest,
    predecessorTicketDigest: input.predecessorTicket.payload.ticketDigest,
    replacementReceiptDigest: input.replacementReceipt.payload.receiptDigest,
    role: input.predecessorTicket.payload.role,
    ordinal: input.predecessorTicket.payload.ordinal,
    revision: input.predecessorTicket.payload.revision + 1,
    submittedAt: input.submittedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, resubmissionDigest: sha256(material) }, input.signer);
}

export function createQuorumSnapshotV33_51(input: {
  signer: SigningIdentity;
  policy: SignedEnvelope<OperationsPolicyPayloadV33_51>;
  approvals: readonly SignedEnvelope<DualControlApprovalPayloadV33_51>[];
  receiptByDigest: ReadonlyMap<string, SignedEnvelope<QuarantineReceiptPayloadV33_50>>;
  openDisputes: readonly SignedEnvelope<EvidenceDisputePayloadV33_51>[];
  sequence: number;
  predecessorSnapshot?: SignedEnvelope<QuorumProgressSnapshotPayloadV33_51> | null;
  recordedAt: Date;
  trust: EvidenceIntakeOperationsTrustV33_51;
}): SignedEnvelope<QuorumProgressSnapshotPayloadV33_51> {
  const predecessor = input.predecessorSnapshot ?? null;
  if (input.sequence < 1 || (input.sequence === 1) !== (predecessor === null)) throw new Error('snapshot_sequence');
  if (predecessor && (predecessor.payload.sequence + 1 !== input.sequence || predecessor.payload.policyDigest !== input.policy.payload.policyDigest)) throw new Error('snapshot_predecessor');
  const slots = new Set<string>();
  const approvalDigests: string[] = [];
  const external = new Set<string>();
  for (const approval of input.approvals) {
    verifyEnvelope(approval, input.trust.approvalRegistry, input.trust.trustedApprovalSignerIds, input.recordedAt, 'approval_signature');
    assertDigest(approval.payload as unknown as Record<string, unknown>, 'approvalDigest', 'approval_digest');
    if (approval.payload.policyDigest !== input.policy.payload.policyDigest) throw new Error('approval_policy');
    const slot = roleSlot(approval.payload.role, approval.payload.ordinal);
    if (slots.has(slot)) throw new Error('approval_duplicate_role');
    slots.add(slot);
    const receipt = input.receiptByDigest.get(approval.payload.receiptDigest);
    if (!receipt) throw new Error('approval_receipt_missing');
    verifyEnvelope(receipt, input.trust.basePortalRegistry, input.trust.trustedBasePortalSignerIds, input.recordedAt, 'base_receipt_signature');
    assertDigest(receipt.payload as unknown as Record<string, unknown>, 'receiptDigest', 'base_receipt_digest');
    if (receipt.payload.role !== approval.payload.role || receipt.payload.ordinal !== approval.payload.ordinal) throw new Error('approval_receipt_binding');
    for (const digest of receipt.payload.externalAttestationDigests) external.add(digest);
    approvalDigests.push(approval.payload.approvalDigest);
  }
  const openDisputeCount = input.openDisputes.length;
  const locallyComplete = slots.size === input.policy.payload.requiredRoleCount && openDisputeCount === 0;
  const externallyComplete = locallyComplete && external.size === input.policy.payload.requiredExternalAttestations;
  const material = {
    version: '33.51' as const,
    operationsPlaneId: input.policy.payload.operationsPlaneId,
    policyDigest: input.policy.payload.policyDigest,
    sequence: input.sequence,
    predecessorSnapshotDigest: predecessor?.payload.snapshotDigest ?? null,
    acceptedApprovalDigests: approvalDigests.sort(),
    acceptedRoleCount: slots.size,
    externalAttestationCount: external.size,
    openDisputeCount,
    locallyComplete,
    externallyComplete,
    recordedAt: input.recordedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, snapshotDigest: sha256(material) }, input.signer);
}

export function issueExternalReadinessCertificateV33_51(input: {
  signer: SigningIdentity;
  policy: SignedEnvelope<OperationsPolicyPayloadV33_51>;
  baseReadinessVerdict: SignedEnvelope<IntakeReadinessVerdictPayloadV33_50>;
  approvals: readonly SignedEnvelope<DualControlApprovalPayloadV33_51>[];
  snapshots: readonly SignedEnvelope<QuorumProgressSnapshotPayloadV33_51>[];
  issuedAt: Date;
  expiresAt: Date;
  trust: EvidenceIntakeOperationsTrustV33_51;
}): SignedEnvelope<ExternalReadinessCertificatePayloadV33_51> {
  verifyEnvelope(input.baseReadinessVerdict, input.trust.baseReadinessRegistry, input.trust.trustedBaseReadinessSignerIds, input.issuedAt, 'base_readiness_signature');
  if (input.baseReadinessVerdict.payload.verdictDigest !== input.policy.payload.baseReadinessVerdictDigest) throw new Error('base_readiness_binding');
  if (input.approvals.length !== input.policy.payload.requiredRoleCount) throw new Error('readiness_approval_count');
  const approvalSlots = new Set<string>();
  for (const approval of input.approvals) {
    verifyEnvelope(approval, input.trust.approvalRegistry, input.trust.trustedApprovalSignerIds, input.issuedAt, 'approval_signature');
    assertDigest(approval.payload as unknown as Record<string, unknown>, 'approvalDigest', 'approval_digest');
    if (approval.payload.policyDigest !== input.policy.payload.policyDigest) throw new Error('approval_policy');
    const slot = roleSlot(approval.payload.role, approval.payload.ordinal);
    if (approvalSlots.has(slot)) throw new Error('readiness_duplicate_role');
    approvalSlots.add(slot);
  }
  if (approvalSlots.size !== 16) throw new Error('readiness_role_count');
  if (input.snapshots.length < input.policy.payload.requiredQuorumSnapshots) throw new Error('readiness_snapshot_count');
  const sortedSnapshots = [...input.snapshots].sort((a, b) => a.payload.sequence - b.payload.sequence);
  for (let index = 0; index < sortedSnapshots.length; index += 1) {
    const snapshot = sortedSnapshots[index]!;
    verifyEnvelope(snapshot, input.trust.snapshotRegistry, input.trust.trustedSnapshotSignerIds, input.issuedAt, 'snapshot_signature');
    assertDigest(snapshot.payload as unknown as Record<string, unknown>, 'snapshotDigest', 'snapshot_digest');
    if (snapshot.payload.sequence !== index + 1) throw new Error('snapshot_chain_sequence');
    const expectedPredecessor = index === 0 ? null : sortedSnapshots[index - 1]!.payload.snapshotDigest;
    if (snapshot.payload.predecessorSnapshotDigest !== expectedPredecessor) throw new Error('snapshot_chain_predecessor');
  }
  const finalSnapshot = sortedSnapshots.at(-1)!;
  if (!finalSnapshot.payload.locallyComplete || finalSnapshot.payload.openDisputeCount !== 0 || finalSnapshot.payload.acceptedRoleCount !== 16) throw new Error('readiness_local_incomplete');
  const externalReady = input.baseReadinessVerdict.payload.status === 'EXTERNAL_CEREMONY_EVIDENCE_READY_FOR_IMPORT'
    && input.baseReadinessVerdict.payload.externalCeremonyObserved
    && finalSnapshot.payload.externallyComplete
    && finalSnapshot.payload.externalAttestationCount === 22;
  const status: OperationsReadinessStatusV33_51 = externalReady ? 'EXTERNAL_CEREMONY_READINESS_CERTIFIED' : 'LOCAL_OPERATIONS_COMPLETE_REHEARSAL_ONLY';
  const material = {
    version: '33.51' as const,
    operationsPlaneId: input.policy.payload.operationsPlaneId,
    portalId: input.policy.payload.portalId,
    ceremonyId: input.policy.payload.ceremonyId,
    policyDigest: input.policy.payload.policyDigest,
    baseReadinessVerdictDigest: input.baseReadinessVerdict.payload.verdictDigest,
    finalSnapshotDigest: finalSnapshot.payload.snapshotDigest,
    approvalDigests: input.approvals.map((approval) => approval.payload.approvalDigest).sort(),
    roleCount: 16 as const,
    externalAttestationCount: finalSnapshot.payload.externalAttestationCount,
    openDisputeCount: 0 as const,
    dualControlVerified: true as const,
    progressionLedgerVerified: true as const,
    status,
    externalCeremonyObserved: externalReady,
    externalHumanParticipants: 0 as const,
    issuedAt: input.issuedAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, certificateDigest: sha256(material) }, input.signer);
}

export function verifyExternalReadinessCertificateV33_51(input: {
  certificate: SignedEnvelope<ExternalReadinessCertificatePayloadV33_51>;
  policy: SignedEnvelope<OperationsPolicyPayloadV33_51>;
  baseReadinessVerdict: SignedEnvelope<IntakeReadinessVerdictPayloadV33_50>;
  approvals: readonly SignedEnvelope<DualControlApprovalPayloadV33_51>[];
  snapshots: readonly SignedEnvelope<QuorumProgressSnapshotPayloadV33_51>[];
  trust: EvidenceIntakeOperationsTrustV33_51;
  verifiedAt: Date;
}): ExternalReadinessCertificatePayloadV33_51 {
  verifyEnvelope(input.certificate, input.trust.readinessRegistry, input.trust.trustedReadinessSignerIds, input.verifiedAt, 'readiness_signature');
  assertDigest(input.certificate.payload as unknown as Record<string, unknown>, 'certificateDigest', 'readiness_digest');
  verifyEnvelope(input.baseReadinessVerdict, input.trust.baseReadinessRegistry, input.trust.trustedBaseReadinessSignerIds, input.verifiedAt, 'base_readiness_signature');
  if (input.certificate.payload.policyDigest !== input.policy.payload.policyDigest || input.certificate.payload.baseReadinessVerdictDigest !== input.baseReadinessVerdict.payload.verdictDigest) throw new Error('readiness_binding');
  if (input.approvals.length !== 16 || input.snapshots.length < 4) throw new Error('readiness_counts');
  const approvalDigests = input.approvals.map((approval) => {
    verifyEnvelope(approval, input.trust.approvalRegistry, input.trust.trustedApprovalSignerIds, input.verifiedAt, 'approval_signature');
    assertDigest(approval.payload as unknown as Record<string, unknown>, 'approvalDigest', 'approval_digest');
    return approval.payload.approvalDigest;
  }).sort();
  if (JSON.stringify(approvalDigests) !== JSON.stringify([...input.certificate.payload.approvalDigests].sort())) throw new Error('readiness_approvals');
  const sortedSnapshots = [...input.snapshots].sort((a, b) => a.payload.sequence - b.payload.sequence);
  for (let index = 0; index < sortedSnapshots.length; index += 1) {
    const snapshot = sortedSnapshots[index]!;
    verifyEnvelope(snapshot, input.trust.snapshotRegistry, input.trust.trustedSnapshotSignerIds, input.verifiedAt, 'snapshot_signature');
    assertDigest(snapshot.payload as unknown as Record<string, unknown>, 'snapshotDigest', 'snapshot_digest');
    if (snapshot.payload.sequence !== index + 1) throw new Error('snapshot_chain_sequence');
    const predecessor = index === 0 ? null : sortedSnapshots[index - 1]!.payload.snapshotDigest;
    if (snapshot.payload.predecessorSnapshotDigest !== predecessor) throw new Error('snapshot_chain_predecessor');
  }
  const finalSnapshot = sortedSnapshots.at(-1)!;
  if (input.certificate.payload.finalSnapshotDigest !== finalSnapshot.payload.snapshotDigest || finalSnapshot.payload.openDisputeCount !== 0 || !finalSnapshot.payload.locallyComplete) throw new Error('readiness_snapshot');
  const externalReady = input.baseReadinessVerdict.payload.status === 'EXTERNAL_CEREMONY_EVIDENCE_READY_FOR_IMPORT'
    && input.baseReadinessVerdict.payload.externalCeremonyObserved
    && finalSnapshot.payload.externallyComplete
    && finalSnapshot.payload.externalAttestationCount === 22;
  const expectedStatus: OperationsReadinessStatusV33_51 = externalReady ? 'EXTERNAL_CEREMONY_READINESS_CERTIFIED' : 'LOCAL_OPERATIONS_COMPLETE_REHEARSAL_ONLY';
  if (input.certificate.payload.status !== expectedStatus || input.certificate.payload.externalCeremonyObserved !== externalReady || input.certificate.payload.externalAttestationCount !== finalSnapshot.payload.externalAttestationCount || input.certificate.payload.productionAuthority !== 'NONE' || input.certificate.payload.externalEffectsExecuted !== 0 || input.certificate.payload.externalHumanParticipants !== 0) throw new Error('readiness_recompute');
  if (parseTime(input.certificate.payload.issuedAt, 'readiness_time') > input.verifiedAt.getTime() || parseTime(input.certificate.payload.expiresAt, 'readiness_time') < input.verifiedAt.getTime()) throw new Error('readiness_expired');
  return input.certificate.payload;
}
