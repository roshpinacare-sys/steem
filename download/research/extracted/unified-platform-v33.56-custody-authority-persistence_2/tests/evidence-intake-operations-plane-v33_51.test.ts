import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KeyRegistry,
  generateSigningIdentity,
  sha256,
  signEnvelope,
  type SignedEnvelope,
  type SigningIdentity,
} from '../src/contracts/crypto.js';
import type { CoordinatorDeploymentRoleV33_48 } from '../src/supply-chain/external-coordinator-deployment-evidence-import-v33_48.js';
import type {
  IntakePortalPolicyPayloadV33_50,
  IntakeReadinessVerdictPayloadV33_50,
  QuarantineReceiptPayloadV33_50,
} from '../src/supply-chain/ceremony-evidence-intake-portal-v33_50.js';
import {
  createDualControlApprovalV33_51,
  createEvidenceResubmissionV33_51,
  createOperationsPolicyV33_51,
  createQueueTicketV33_51,
  createQuorumSnapshotV33_51,
  createReviewDecisionV33_51,
  issueExternalReadinessCertificateV33_51,
  openEvidenceDisputeV33_51,
  verifyExternalReadinessCertificateV33_51,
  type EvidenceIntakeOperationsTrustV33_51,
  type OperationsActorV33_51,
} from '../src/supply-chain/evidence-intake-operations-plane-v33_51.js';

const now = new Date('2026-07-23T05:00:00.000Z');
const at = (value: string) => new Date(value);
const registry = (...identities: SigningIdentity[]) => {
  const result = new KeyRegistry();
  for (const identity of identities) result.register(identity.keyId, identity.publicKey);
  return result;
};
const actor = (identity: SigningIdentity, suffix: string): OperationsActorV33_51 => ({
  keyId: identity.keyId,
  organizationId: `org-${suffix}`,
  administratorId: `admin-${suffix}`,
  hostId: `${suffix}.example.com`,
});
const roles: readonly [CoordinatorDeploymentRoleV33_48, number][] = [
  ['COORDINATOR_HOST', 1], ['COORDINATOR_HOST', 2], ['COORDINATOR_HOST', 3], ['COORDINATOR_HOST', 4],
  ['CLOCK_ROOT', 1], ['CLOCK_ROOT', 2],
  ['APPEND_ONLY_STORE', 1], ['APPEND_ONLY_STORE', 2], ['APPEND_ONLY_STORE', 3],
  ['PARTITION_OBSERVER', 1], ['PARTITION_OBSERVER', 2],
  ['TOPOLOGY_AUDITOR', 1], ['TOPOLOGY_AUDITOR', 2],
  ['EVIDENCE_EXPORTER', 1], ['EVIDENCE_IMPORTER', 1], ['RECOVERY_VERIFIER', 1],
];
const infra = new Set<CoordinatorDeploymentRoleV33_48>(['COORDINATOR_HOST', 'CLOCK_ROOT', 'APPEND_ONLY_STORE', 'PARTITION_OBSERVER']);

function fixture(external = false) {
  const basePolicySigner = generateSigningIdentity('v3351-base-policy');
  const basePortalSigner = generateSigningIdentity('v3351-base-portal');
  const baseReadinessSigner = generateSigningIdentity('v3351-base-readiness');
  const policySigner = generateSigningIdentity('v3351-ops-policy');
  const queueSigner = generateSigningIdentity('v3351-queue');
  const reviewers = [generateSigningIdentity('v3351-reviewer-a'), generateSigningIdentity('v3351-reviewer-b')];
  const approvalSigner = generateSigningIdentity('v3351-approval');
  const disputeSigner = generateSigningIdentity('v3351-dispute');
  const resubmissionSigner = generateSigningIdentity('v3351-resubmission');
  const snapshotSigner = generateSigningIdentity('v3351-snapshot');
  const readinessSigner = generateSigningIdentity('v3351-readiness');
  const policyAuthority = actor(policySigner, 'policy');
  const reviewerActors = reviewers.map((identity, index) => actor(identity, `reviewer-${index + 1}`));

  const basePolicyMaterial = {
    version: '33.50' as const,
    portalId: 'portal-v33-50', ceremonyId: 'ceremony-v33-51', baseCeremonyReceiptDigest: sha256({ base: 50 }),
    authority: { keyId: basePolicySigner.keyId, keyFingerprint: sha256({ k: 1 }), organizationId: 'base-policy-org', hostId: 'base-policy.example.com', administratorId: 'base-policy-admin' },
    authorizedEnrollmentResponseDigests: roles.map(([role, ordinal]) => sha256({ role, ordinal })),
    requiredRoleCount: 16 as const, requiredExternalInfrastructureAttestations: 22 as const, replacementApprovalQuorum: 3 as const,
    channelTtlSeconds: 3600, maximumFilesPerRole: 8, maximumBytesPerRole: 1_000_000,
    issuedAt: '2026-07-23T04:00:00.000Z', expiresAt: '2026-07-23T08:00:00.000Z', productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const,
  };
  const basePolicy = signEnvelope({ ...basePolicyMaterial, policyDigest: sha256(basePolicyMaterial) } as IntakePortalPolicyPayloadV33_50, basePolicySigner);

  const externalAttestations = Array.from({ length: 22 }, (_, index) => sha256({ external: index + 1 }));
  let attestationOffset = 0;
  const receipts = roles.map(([role, ordinal], index) => {
    const actorPayload = { keyId: `role-${index + 1}`, keyFingerprint: sha256({ roleKey: index }), organizationId: `role-org-${index + 1}`, hostId: `role-${index + 1}.example.com`, administratorId: `role-admin-${index + 1}` };
    const attestationDigests = external && infra.has(role) ? externalAttestations.slice(attestationOffset, attestationOffset += 2) : [];
    const material = {
      version: '33.50' as const, portalId: basePolicy.payload.portalId, ceremonyId: basePolicy.payload.ceremonyId,
      policyDigest: basePolicy.payload.policyDigest, role, ordinal, actor: actorPayload,
      channelDigest: sha256({ channel: index }), submissionDigest: sha256({ submission: index }), scanDigest: sha256({ scan: index }),
      executionClass: external ? 'LIVE_EXTERNAL' as const : 'LOCAL_REHEARSAL' as const,
      externalAttestationDigests: attestationDigests, quarantineStatus: 'SCAN_PASSED_QUARANTINED' as const,
      eligibleForLocalReadiness: true as const, eligibleForExternalReadiness: external,
      acceptedAt: '2026-07-23T04:20:00.000Z', productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const,
    };
    return signEnvelope({ ...material, receiptDigest: sha256(material) } as QuarantineReceiptPayloadV33_50, basePortalSigner);
  });
  const baseVerdictMaterial = {
    version: '33.50' as const, portalId: basePolicy.payload.portalId, ceremonyId: basePolicy.payload.ceremonyId,
    policyDigest: basePolicy.payload.policyDigest, baseCeremonyReceiptDigest: basePolicy.payload.baseCeremonyReceiptDigest,
    roleReceiptDigests: receipts.map((receipt) => receipt.payload.receiptDigest).sort(), replacementCertificateDigests: [], roleCount: 16 as const,
    externalAttestationCount: external ? 22 : 0, externallyQualifiedScanCount: external ? 16 : 0,
    allRolesQuarantinedAndVerified: true as const, mutualAuthenticationVerified: true as const, replacementChainVerified: true as const,
    status: external ? 'EXTERNAL_CEREMONY_EVIDENCE_READY_FOR_IMPORT' as const : 'LOCAL_CEREMONY_INTAKE_COMPLETE_REHEARSAL_ONLY' as const,
    externalCeremonyObserved: external, externalHumanParticipants: 0 as const, productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const,
    decidedAt: '2026-07-23T04:30:00.000Z',
  };
  const baseVerdict = signEnvelope({ ...baseVerdictMaterial, verdictDigest: sha256(baseVerdictMaterial) } as IntakeReadinessVerdictPayloadV33_50, baseReadinessSigner);

  const trust: EvidenceIntakeOperationsTrustV33_51 = {
    policyRegistry: registry(policySigner), trustedPolicySignerIds: [policySigner.keyId],
    queueRegistry: registry(queueSigner), trustedQueueSignerIds: [queueSigner.keyId],
    reviewerRegistry: registry(...reviewers), trustedReviewerIds: reviewers.map((identity) => identity.keyId),
    approvalRegistry: registry(approvalSigner), trustedApprovalSignerIds: [approvalSigner.keyId],
    disputeRegistry: registry(disputeSigner), trustedDisputeSignerIds: [disputeSigner.keyId],
    resubmissionRegistry: registry(resubmissionSigner), trustedResubmissionSignerIds: [resubmissionSigner.keyId],
    snapshotRegistry: registry(snapshotSigner), trustedSnapshotSignerIds: [snapshotSigner.keyId],
    readinessRegistry: registry(readinessSigner), trustedReadinessSignerIds: [readinessSigner.keyId],
    basePortalRegistry: registry(basePortalSigner), trustedBasePortalSignerIds: [basePortalSigner.keyId],
    baseReadinessRegistry: registry(baseReadinessSigner), trustedBaseReadinessSignerIds: [baseReadinessSigner.keyId],
  };
  const policy = createOperationsPolicyV33_51({ signer: policySigner, authority: policyAuthority, operationsPlaneId: 'operations-plane-v33-51', basePolicy, baseReadinessVerdict: baseVerdict, issuedAt: now, expiresAt: at('2026-07-23T10:00:00Z') });
  const tickets = receipts.map((receipt) => createQueueTicketV33_51({ signer: queueSigner, policy, receipt, executionClass: external ? 'LIVE_EXTERNAL' : 'LOCAL_REHEARSAL', queuedAt: at('2026-07-23T05:01:00Z') }));
  const reviewPairs = tickets.map((ticket, index) => reviewers.map((reviewer, reviewerIndex) => createReviewDecisionV33_51({ signer: reviewer, reviewer: reviewerActors[reviewerIndex]!, policy, ticket, decision: 'ACCEPT', reason: `accepted-${index}-${reviewerIndex}`, reviewedAt: at('2026-07-23T05:05:00Z') })));
  const approvals = tickets.map((ticket, index) => createDualControlApprovalV33_51({ signer: approvalSigner, policy, ticket, reviews: reviewPairs[index]!, trust, approvedAt: at('2026-07-23T05:06:00Z') }));
  const receiptByDigest = new Map(receipts.map((receipt) => [receipt.payload.receiptDigest, receipt]));
  return { basePolicySigner, basePortalSigner, baseReadinessSigner, policySigner, queueSigner, reviewers, approvalSigner, disputeSigner, resubmissionSigner, snapshotSigner, readinessSigner, policyAuthority, reviewerActors, basePolicy, baseVerdict, receipts, trust, policy, tickets, reviewPairs, approvals, receiptByDigest };
}

function snapshots(f: ReturnType<typeof fixture>) {
  const result: ReturnType<typeof createQuorumSnapshotV33_51>[] = [];
  for (let sequence = 1; sequence <= 4; sequence += 1) {
    result.push(createQuorumSnapshotV33_51({ signer: f.snapshotSigner, policy: f.policy, approvals: f.approvals.slice(0, sequence * 4), receiptByDigest: f.receiptByDigest, openDisputes: [], sequence, predecessorSnapshot: result.at(-1) ?? null, recordedAt: new Date(now.getTime() + sequence * 60_000), trust: f.trust }));
  }
  return result;
}
const resign = <T extends Record<string, unknown>>(envelope: SignedEnvelope<T>, signer: SigningIdentity, digestField: keyof T, patch: Partial<T>) => {
  const payload = { ...envelope.payload, ...patch };
  delete payload[digestField];
  return signEnvelope({ ...payload, [digestField]: sha256(payload) } as T, signer);
};

// Policy and queue
test('v33.51 policy binds v33.50 verdict', () => { const f = fixture(); assert.equal(f.policy.payload.baseReadinessVerdictDigest, f.baseVerdict.payload.verdictDigest); });
test('v33.51 policy rejects invalid SLA', () => { const f = fixture(); assert.throws(() => createOperationsPolicyV33_51({ signer: f.policySigner, authority: f.policyAuthority, operationsPlaneId: 'x', basePolicy: f.basePolicy, baseReadinessVerdict: f.baseVerdict, issuedAt: now, expiresAt: at('2026-07-23T06:00:00Z'), ticketSlaSeconds: 30 }), /policy_sla/); });
test('v33.51 queue ticket binds organization and receipt', () => { const f = fixture(); assert.equal(f.tickets[0]!.payload.organizationId, f.receipts[0]!.payload.actor.organizationId); });
test('v33.51 queue revision one rejects predecessor', () => { const f = fixture(); assert.throws(() => createQueueTicketV33_51({ signer: f.queueSigner, policy: f.policy, receipt: f.receipts[0]!, executionClass: 'LOCAL_REHEARSAL', queuedAt: now, predecessorTicketDigest: sha256({ p: 1 }) }), /ticket_revision/); });
test('v33.51 queue revision two requires predecessor', () => { const f = fixture(); assert.throws(() => createQueueTicketV33_51({ signer: f.queueSigner, policy: f.policy, receipt: f.receipts[0]!, executionClass: 'LOCAL_REHEARSAL', queuedAt: now, revision: 2 }), /ticket_revision/); });

// Reviews and approvals
test('v33.51 review before SLA is accepted', () => { const f = fixture(); assert.equal(f.reviewPairs[0]![0]!.payload.decision, 'ACCEPT'); });
test('v33.51 review after SLA is rejected', () => { const f = fixture(); assert.throws(() => createReviewDecisionV33_51({ signer: f.reviewers[0]!, reviewer: f.reviewerActors[0]!, policy: f.policy, ticket: f.tickets[0]!, decision: 'ACCEPT', reason: 'late', reviewedAt: at('2026-07-23T07:00:00Z') }), /review_expired/); });
test('v33.51 review reason is required', () => { const f = fixture(); assert.throws(() => createReviewDecisionV33_51({ signer: f.reviewers[0]!, reviewer: f.reviewerActors[0]!, policy: f.policy, ticket: f.tickets[0]!, decision: 'ACCEPT', reason: ' ', reviewedAt: now }), /review_reason/); });
test('v33.51 dual control approval succeeds', () => { const f = fixture(); assert.equal(f.approvals[0]!.payload.reviewDigests.length, 2); });
test('v33.51 approval rejects quorum below two', () => { const f = fixture(); assert.throws(() => createDualControlApprovalV33_51({ signer: f.approvalSigner, policy: f.policy, ticket: f.tickets[0]!, reviews: [f.reviewPairs[0]![0]!], trust: f.trust, approvedAt: now }), /review_quorum/); });
test('v33.51 approval rejects duplicate reviewer separation', () => { const f = fixture(); const one = f.reviewPairs[0]![0]!; assert.throws(() => createDualControlApprovalV33_51({ signer: f.approvalSigner, policy: f.policy, ticket: f.tickets[0]!, reviews: [one, one], trust: f.trust, approvedAt: now }), /reviewer_separation/); });
test('v33.51 approval rejects negative review', () => { const f = fixture(); const reject = createReviewDecisionV33_51({ signer: f.reviewers[1]!, reviewer: f.reviewerActors[1]!, policy: f.policy, ticket: f.tickets[0]!, decision: 'REJECT', reason: 'bad', reviewedAt: now }); assert.throws(() => createDualControlApprovalV33_51({ signer: f.approvalSigner, policy: f.policy, ticket: f.tickets[0]!, reviews: [f.reviewPairs[0]![0]!, reject], trust: f.trust, approvedAt: now }), /review_rejected/); });
test('v33.51 approval rejects review bound to another ticket', () => { const f = fixture(); assert.throws(() => createDualControlApprovalV33_51({ signer: f.approvalSigner, policy: f.policy, ticket: f.tickets[0]!, reviews: f.reviewPairs[1]!, trust: f.trust, approvedAt: now }), /review_binding/); });
test('v33.51 approval rejects untrusted reviewer signature', () => { const f = fixture(); const rogue = generateSigningIdentity('rogue-reviewer'); const bad = createReviewDecisionV33_51({ signer: rogue, reviewer: actor(rogue, 'rogue'), policy: f.policy, ticket: f.tickets[0]!, decision: 'ACCEPT', reason: 'rogue', reviewedAt: now }); assert.throws(() => createDualControlApprovalV33_51({ signer: f.approvalSigner, policy: f.policy, ticket: f.tickets[0]!, reviews: [bad, f.reviewPairs[0]![1]!], trust: f.trust, approvedAt: now }), /review_signature/); });

// Dispute and resubmission
test('v33.51 rejected review opens dispute', () => { const f = fixture(); const reject = createReviewDecisionV33_51({ signer: f.reviewers[0]!, reviewer: f.reviewerActors[0]!, policy: f.policy, ticket: f.tickets[0]!, decision: 'REJECT', reason: 'invalid', reviewedAt: now }); const dispute = openEvidenceDisputeV33_51({ signer: f.disputeSigner, openedBy: f.policyAuthority, policy: f.policy, ticket: f.tickets[0]!, rejectReview: reject, reason: 'needs resubmission', openedAt: now, trust: f.trust }); assert.equal(dispute.payload.disputeState, 'OPEN'); });
test('v33.51 accepted review cannot open dispute', () => { const f = fixture(); assert.throws(() => openEvidenceDisputeV33_51({ signer: f.disputeSigner, openedBy: f.policyAuthority, policy: f.policy, ticket: f.tickets[0]!, rejectReview: f.reviewPairs[0]![0]!, reason: 'x', openedAt: now, trust: f.trust }), /dispute_review/); });
test('v33.51 dispute reason is required', () => { const f = fixture(); const reject = createReviewDecisionV33_51({ signer: f.reviewers[0]!, reviewer: f.reviewerActors[0]!, policy: f.policy, ticket: f.tickets[0]!, decision: 'REJECT', reason: 'invalid', reviewedAt: now }); assert.throws(() => openEvidenceDisputeV33_51({ signer: f.disputeSigner, openedBy: f.policyAuthority, policy: f.policy, ticket: f.tickets[0]!, rejectReview: reject, reason: '', openedAt: now, trust: f.trust }), /dispute_reason/); });
function disputeFixture() { const f = fixture(); const reject = createReviewDecisionV33_51({ signer: f.reviewers[0]!, reviewer: f.reviewerActors[0]!, policy: f.policy, ticket: f.tickets[0]!, decision: 'REJECT', reason: 'invalid', reviewedAt: now }); const dispute = openEvidenceDisputeV33_51({ signer: f.disputeSigner, openedBy: f.policyAuthority, policy: f.policy, ticket: f.tickets[0]!, rejectReview: reject, reason: 'replace', openedAt: now, trust: f.trust }); const original = f.receipts[0]!; const material = { ...original.payload, submissionDigest: sha256({ replacement: 1 }) } as Record<string, unknown>; delete material.receiptDigest; const replacement = signEnvelope({ ...material, receiptDigest: sha256(material) } as unknown as QuarantineReceiptPayloadV33_50, f.basePortalSigner); return { f, reject, dispute, replacement }; }
test('v33.51 resubmission increments revision', () => { const x = disputeFixture(); const r = createEvidenceResubmissionV33_51({ signer: x.f.resubmissionSigner, policy: x.f.policy, dispute: x.dispute, predecessorTicket: x.f.tickets[0]!, replacementReceipt: x.replacement, submittedAt: at('2026-07-23T05:30:00Z') }); assert.equal(r.payload.revision, 2); });
test('v33.51 resubmission rejects unchanged receipt', () => { const x = disputeFixture(); assert.throws(() => createEvidenceResubmissionV33_51({ signer: x.f.resubmissionSigner, policy: x.f.policy, dispute: x.dispute, predecessorTicket: x.f.tickets[0]!, replacementReceipt: x.f.receipts[0]!, submittedAt: now }), /resubmission_unchanged/); });
test('v33.51 resubmission rejects wrong role', () => { const x = disputeFixture(); assert.throws(() => createEvidenceResubmissionV33_51({ signer: x.f.resubmissionSigner, policy: x.f.policy, dispute: x.dispute, predecessorTicket: x.f.tickets[0]!, replacementReceipt: x.f.receipts[1]!, submittedAt: now }), /resubmission_role_binding/); });
test('v33.51 resubmission rejects after dispute expiry', () => { const x = disputeFixture(); assert.throws(() => createEvidenceResubmissionV33_51({ signer: x.f.resubmissionSigner, policy: x.f.policy, dispute: x.dispute, predecessorTicket: x.f.tickets[0]!, replacementReceipt: x.replacement, submittedAt: at('2026-07-23T09:00:00Z') }), /resubmission_expired/); });

// Progression ledger
test('v33.51 first quorum snapshot starts at sequence one', () => { const f = fixture(); const s = createQuorumSnapshotV33_51({ signer: f.snapshotSigner, policy: f.policy, approvals: f.approvals.slice(0, 4), receiptByDigest: f.receiptByDigest, openDisputes: [], sequence: 1, recordedAt: now, trust: f.trust }); assert.equal(s.payload.sequence, 1); });
test('v33.51 snapshot rejects sequence gap', () => { const f = fixture(); assert.throws(() => createQuorumSnapshotV33_51({ signer: f.snapshotSigner, policy: f.policy, approvals: [], receiptByDigest: f.receiptByDigest, openDisputes: [], sequence: 2, recordedAt: now, trust: f.trust }), /snapshot_sequence/); });
test('v33.51 snapshot tracks partial role count', () => { const f = fixture(); const s = createQuorumSnapshotV33_51({ signer: f.snapshotSigner, policy: f.policy, approvals: f.approvals.slice(0, 8), receiptByDigest: f.receiptByDigest, openDisputes: [], sequence: 1, recordedAt: now, trust: f.trust }); assert.equal(s.payload.acceptedRoleCount, 8); });
test('v33.51 snapshot rejects duplicate role approval', () => { const f = fixture(); assert.throws(() => createQuorumSnapshotV33_51({ signer: f.snapshotSigner, policy: f.policy, approvals: [f.approvals[0]!, f.approvals[0]!], receiptByDigest: f.receiptByDigest, openDisputes: [], sequence: 1, recordedAt: now, trust: f.trust }), /approval_duplicate_role/); });
test('v33.51 snapshot rejects missing base receipt', () => { const f = fixture(); assert.throws(() => createQuorumSnapshotV33_51({ signer: f.snapshotSigner, policy: f.policy, approvals: [f.approvals[0]!], receiptByDigest: new Map(), openDisputes: [], sequence: 1, recordedAt: now, trust: f.trust }), /approval_receipt_missing/); });
test('v33.51 snapshot rejects tampered base receipt', () => { const f = fixture(); const bad = resign(f.receipts[0] as unknown as SignedEnvelope<Record<string, unknown>>, f.basePortalSigner, 'receiptDigest', { ordinal: 99 }); const map = new Map(f.receiptByDigest); map.set(f.approvals[0]!.payload.receiptDigest, bad as unknown as SignedEnvelope<QuarantineReceiptPayloadV33_50>); assert.throws(() => createQuorumSnapshotV33_51({ signer: f.snapshotSigner, policy: f.policy, approvals: [f.approvals[0]!], receiptByDigest: map, openDisputes: [], sequence: 1, recordedAt: now, trust: f.trust }), /approval_receipt_binding/); });
test('v33.51 local final snapshot is not externally complete', () => { const f = fixture(false); assert.equal(snapshots(f).at(-1)!.payload.externallyComplete, false); });
test('v33.51 external final snapshot counts twenty-two attestations', () => { const f = fixture(true); assert.equal(snapshots(f).at(-1)!.payload.externalAttestationCount, 22); });

// Readiness and verifier
test('v33.51 local operations certificate remains rehearsal only', () => { const f = fixture(false); const certificate = issueExternalReadinessCertificateV33_51({ signer: f.readinessSigner, policy: f.policy, baseReadinessVerdict: f.baseVerdict, approvals: f.approvals, snapshots: snapshots(f), issuedAt: at('2026-07-23T05:10:00Z'), expiresAt: at('2026-07-23T06:10:00Z'), trust: f.trust }); assert.equal(certificate.payload.status, 'LOCAL_OPERATIONS_COMPLETE_REHEARSAL_ONLY'); });
test('v33.51 full external evidence can be certified', () => { const f = fixture(true); const certificate = issueExternalReadinessCertificateV33_51({ signer: f.readinessSigner, policy: f.policy, baseReadinessVerdict: f.baseVerdict, approvals: f.approvals, snapshots: snapshots(f), issuedAt: at('2026-07-23T05:10:00Z'), expiresAt: at('2026-07-23T06:10:00Z'), trust: f.trust }); assert.equal(certificate.payload.status, 'EXTERNAL_CEREMONY_READINESS_CERTIFIED'); });
test('v33.51 readiness rejects fewer than sixteen approvals', () => { const f = fixture(); assert.throws(() => issueExternalReadinessCertificateV33_51({ signer: f.readinessSigner, policy: f.policy, baseReadinessVerdict: f.baseVerdict, approvals: f.approvals.slice(0, 15), snapshots: snapshots(f), issuedAt: now, expiresAt: at('2026-07-23T06:00:00Z'), trust: f.trust }), /readiness_approval_count/); });
test('v33.51 readiness rejects fewer than four snapshots', () => { const f = fixture(); assert.throws(() => issueExternalReadinessCertificateV33_51({ signer: f.readinessSigner, policy: f.policy, baseReadinessVerdict: f.baseVerdict, approvals: f.approvals, snapshots: snapshots(f).slice(0, 3), issuedAt: now, expiresAt: at('2026-07-23T06:00:00Z'), trust: f.trust }), /readiness_snapshot_count/); });
test('v33.51 verifier accepts recomputed local certificate', () => { const f = fixture(); const ss = snapshots(f); const certificate = issueExternalReadinessCertificateV33_51({ signer: f.readinessSigner, policy: f.policy, baseReadinessVerdict: f.baseVerdict, approvals: f.approvals, snapshots: ss, issuedAt: at('2026-07-23T05:10:00Z'), expiresAt: at('2026-07-23T06:10:00Z'), trust: f.trust }); assert.equal(verifyExternalReadinessCertificateV33_51({ certificate, policy: f.policy, baseReadinessVerdict: f.baseVerdict, approvals: f.approvals, snapshots: ss, trust: f.trust, verifiedAt: at('2026-07-23T05:20:00Z') }).certificateDigest, certificate.payload.certificateDigest); });
test('v33.51 verifier rejects readiness status tamper', () => { const f = fixture(); const ss = snapshots(f); const certificate = issueExternalReadinessCertificateV33_51({ signer: f.readinessSigner, policy: f.policy, baseReadinessVerdict: f.baseVerdict, approvals: f.approvals, snapshots: ss, issuedAt: at('2026-07-23T05:10:00Z'), expiresAt: at('2026-07-23T06:10:00Z'), trust: f.trust }); const bad = resign(certificate as unknown as SignedEnvelope<Record<string, unknown>>, f.readinessSigner, 'certificateDigest', { status: 'EXTERNAL_CEREMONY_READINESS_CERTIFIED', externalCeremonyObserved: true }); assert.throws(() => verifyExternalReadinessCertificateV33_51({ certificate: bad as unknown as typeof certificate, policy: f.policy, baseReadinessVerdict: f.baseVerdict, approvals: f.approvals, snapshots: ss, trust: f.trust, verifiedAt: at('2026-07-23T05:20:00Z') }), /readiness_recompute/); });
test('v33.51 verifier rejects expired certificate', () => { const f = fixture(); const ss = snapshots(f); const certificate = issueExternalReadinessCertificateV33_51({ signer: f.readinessSigner, policy: f.policy, baseReadinessVerdict: f.baseVerdict, approvals: f.approvals, snapshots: ss, issuedAt: at('2026-07-23T05:10:00Z'), expiresAt: at('2026-07-23T05:15:00Z'), trust: f.trust }); assert.throws(() => verifyExternalReadinessCertificateV33_51({ certificate, policy: f.policy, baseReadinessVerdict: f.baseVerdict, approvals: f.approvals, snapshots: ss, trust: f.trust, verifiedAt: at('2026-07-23T05:20:00Z') }), /readiness_signature|readiness_expired/); });
test('v33.51 certificate preserves no production authority', () => { const f = fixture(); const c = issueExternalReadinessCertificateV33_51({ signer: f.readinessSigner, policy: f.policy, baseReadinessVerdict: f.baseVerdict, approvals: f.approvals, snapshots: snapshots(f), issuedAt: now, expiresAt: at('2026-07-23T06:00:00Z'), trust: f.trust }); assert.equal(c.payload.productionAuthority, 'NONE'); assert.equal(c.payload.externalEffectsExecuted, 0); assert.equal(c.payload.externalHumanParticipants, 0); });
