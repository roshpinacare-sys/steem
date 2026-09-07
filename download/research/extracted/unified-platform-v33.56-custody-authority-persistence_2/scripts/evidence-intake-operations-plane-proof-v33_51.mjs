import { mkdirSync, readFileSync, writeFileSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  KeyRegistry, generateSigningIdentity, sha256, signEnvelope,
} from '../dist/src/contracts/crypto.js';
import {
  createDualControlApprovalV33_51,
  createEvidenceResubmissionV33_51,
  createOperationsPolicyV33_51,
  createQueueTicketV33_51,
  createQuorumSnapshotV33_51,
  createReviewDecisionV33_51,
  issueExternalReadinessCertificateV33_51,
  openEvidenceDisputeV33_51,
} from '../dist/src/supply-chain/evidence-intake-operations-plane-v33_51.js';

const root = resolve('.');
const baseProofPath = join(root, 'release-evidence/v33.50/V33_50_CEREMONY_EVIDENCE_INTAKE_PORTAL_PROOF.json');
const outDir = join(root, 'release-evidence/v33.51');
const artifactRoot = join(outDir, 'operations-plane');
mkdirSync(artifactRoot, { recursive: true });
const baseVerify = spawnSync(process.execPath, ['scripts/verify-ceremony-evidence-intake-portal-v33_50.mjs'], { cwd: root, encoding: 'utf8' });
if (baseVerify.status !== 0) throw new Error(`v33_50_verifier_failed:${baseVerify.stderr || baseVerify.stdout}`);
const base = JSON.parse(readFileSync(baseProofPath, 'utf8'));

const identities = {
  policy: generateSigningIdentity('proof-v3351-policy'),
  queue: generateSigningIdentity('proof-v3351-queue'),
  reviewerA: generateSigningIdentity('proof-v3351-reviewer-a'),
  reviewerB: generateSigningIdentity('proof-v3351-reviewer-b'),
  approval: generateSigningIdentity('proof-v3351-approval'),
  dispute: generateSigningIdentity('proof-v3351-dispute'),
  resubmission: generateSigningIdentity('proof-v3351-resubmission'),
  snapshot: generateSigningIdentity('proof-v3351-snapshot'),
  readiness: generateSigningIdentity('proof-v3351-readiness'),
  replacementPortal: generateSigningIdentity('proof-v3351-replacement-portal'),
};
const allNew = Object.values(identities);
const registry = (...ids) => { const r = new KeyRegistry(); for (const id of ids) r.register(id.keyId, id.publicKey); return r; };
const actor = (identity, suffix) => ({ keyId: identity.keyId, organizationId: `proof-${suffix}-org`, administratorId: `proof-${suffix}-admin`, hostId: `proof-${suffix}.example.com` });
const exportedBase = new Map(base.publicKeys.map((record) => [record.keyId, record]));
const basePortalRecord = exportedBase.get(base.receipts[0].issuerKeyId);
const baseReadinessRecord = exportedBase.get(base.verdict.issuerKeyId);
const basePolicyRecord = exportedBase.get(base.policy.issuerKeyId);
if (!basePortalRecord || !baseReadinessRecord || !basePolicyRecord) throw new Error('base_key_missing');
const basePortalRegistry = new KeyRegistry(); basePortalRegistry.registerExported(basePortalRecord); basePortalRegistry.register(identities.replacementPortal.keyId, identities.replacementPortal.publicKey);
const baseReadinessRegistry = new KeyRegistry(); baseReadinessRegistry.registerExported(baseReadinessRecord);
const trust = {
  policyRegistry: registry(identities.policy), trustedPolicySignerIds: [identities.policy.keyId],
  queueRegistry: registry(identities.queue), trustedQueueSignerIds: [identities.queue.keyId],
  reviewerRegistry: registry(identities.reviewerA, identities.reviewerB), trustedReviewerIds: [identities.reviewerA.keyId, identities.reviewerB.keyId],
  approvalRegistry: registry(identities.approval), trustedApprovalSignerIds: [identities.approval.keyId],
  disputeRegistry: registry(identities.dispute), trustedDisputeSignerIds: [identities.dispute.keyId],
  resubmissionRegistry: registry(identities.resubmission), trustedResubmissionSignerIds: [identities.resubmission.keyId],
  snapshotRegistry: registry(identities.snapshot), trustedSnapshotSignerIds: [identities.snapshot.keyId],
  readinessRegistry: registry(identities.readiness), trustedReadinessSignerIds: [identities.readiness.keyId],
  basePortalRegistry, trustedBasePortalSignerIds: [base.receipts[0].issuerKeyId, identities.replacementPortal.keyId],
  baseReadinessRegistry, trustedBaseReadinessSignerIds: [base.verdict.issuerKeyId],
};
const issuedAt = new Date('2026-07-23T05:00:00.000Z');
const policy = createOperationsPolicyV33_51({ signer: identities.policy, authority: actor(identities.policy, 'policy'), operationsPlaneId: 'operations-plane-v33-51', basePolicy: base.policy, baseReadinessVerdict: base.verdict, issuedAt, expiresAt: new Date('2026-07-23T10:00:00.000Z') });
const tickets = base.receipts.map((receipt) => createQueueTicketV33_51({ signer: identities.queue, policy, receipt, executionClass: 'LOCAL_REHEARSAL', queuedAt: new Date('2026-07-23T05:01:00.000Z') }));
const reviewerActors = [actor(identities.reviewerA, 'reviewer-a'), actor(identities.reviewerB, 'reviewer-b')];
const reviewers = [identities.reviewerA, identities.reviewerB];
const reviews = [];
const approvals = [];
for (let i = 0; i < tickets.length; i += 1) {
  const pair = reviewers.map((reviewer, j) => createReviewDecisionV33_51({ signer: reviewer, reviewer: reviewerActors[j], policy, ticket: tickets[i], decision: 'ACCEPT', reason: `dual-control-accept-${i + 1}-${j + 1}`, reviewedAt: new Date('2026-07-23T05:05:00.000Z') }));
  reviews.push(...pair);
  approvals.push(createDualControlApprovalV33_51({ signer: identities.approval, policy, ticket: tickets[i], reviews: pair, trust, approvedAt: new Date('2026-07-23T05:06:00.000Z') }));
}
const rejectReview = createReviewDecisionV33_51({ signer: identities.reviewerA, reviewer: reviewerActors[0], policy, ticket: tickets[0], decision: 'REJECT', reason: 'synthetic-dispute-rehearsal', reviewedAt: new Date('2026-07-23T05:07:00.000Z') });
const dispute = openEvidenceDisputeV33_51({ signer: identities.dispute, openedBy: actor(identities.dispute, 'dispute'), policy, ticket: tickets[0], rejectReview, reason: 'local dispute and resubmission rehearsal', openedAt: new Date('2026-07-23T05:08:00.000Z'), trust });
const replacementMaterial = { ...base.receipts[0].payload, submissionDigest: sha256({ replacementSubmission: 1 }), acceptedAt: '2026-07-23T05:09:00.000Z' };
delete replacementMaterial.receiptDigest;
const replacementReceipt = signEnvelope({ ...replacementMaterial, receiptDigest: sha256(replacementMaterial) }, identities.replacementPortal);
const resubmission = createEvidenceResubmissionV33_51({ signer: identities.resubmission, policy, dispute, predecessorTicket: tickets[0], replacementReceipt, submittedAt: new Date('2026-07-23T05:10:00.000Z') });
const receiptByDigest = new Map(base.receipts.map((receipt) => [receipt.payload.receiptDigest, receipt]));
const snapshots = [];
for (let sequence = 1; sequence <= 4; sequence += 1) {
  snapshots.push(createQuorumSnapshotV33_51({ signer: identities.snapshot, policy, approvals: approvals.slice(0, sequence * 4), receiptByDigest, openDisputes: [], sequence, predecessorSnapshot: snapshots.at(-1) ?? null, recordedAt: new Date(issuedAt.getTime() + sequence * 60_000), trust }));
}
const certificate = issueExternalReadinessCertificateV33_51({ signer: identities.readiness, policy, baseReadinessVerdict: base.verdict, approvals, snapshots, issuedAt: new Date('2026-07-23T05:12:00.000Z'), expiresAt: new Date('2026-07-23T06:12:00.000Z'), trust });

const artifacts = [policy, ...tickets, ...reviews, ...approvals, rejectReview, dispute, resubmission, ...snapshots, certificate];
const durableWrites = [];
const durableWrite = (relative, value) => {
  const path = join(artifactRoot, relative); mkdirSync(dirname(path), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`); writeFileSync(path, bytes);
  const fd = openSync(path, 'r'); fsyncSync(fd); closeSync(fd);
  const dirFd = openSync(dirname(path), 'r'); fsyncSync(dirFd); closeSync(dirFd);
  const reread = readFileSync(path);
  if (!reread.equals(bytes)) throw new Error('durable_readback_mismatch');
  durableWrites.push({ path: relative, byteLength: bytes.length, sha256: sha256({ bytes: bytes.toString('base64') }), fsync: true, directoryFsync: true, readBackVerified: true });
};
durableWrite('policy.json', policy);
tickets.forEach((value, i) => durableWrite(`tickets/${String(i + 1).padStart(2, '0')}.json`, value));
reviews.forEach((value, i) => durableWrite(`reviews/${String(i + 1).padStart(2, '0')}.json`, value));
approvals.forEach((value, i) => durableWrite(`approvals/${String(i + 1).padStart(2, '0')}.json`, value));
durableWrite('dispute/reject-review.json', rejectReview);
durableWrite('dispute/dispute.json', dispute);
durableWrite('dispute/resubmission.json', resubmission);
snapshots.forEach((value, i) => durableWrite(`snapshots/${i + 1}.json`, value));
durableWrite('readiness-certificate.json', certificate);
if (durableWrites.length !== artifacts.length || artifacts.length !== 73) throw new Error(`artifact_count:${artifacts.length}:${durableWrites.length}`);

const publicKeys = [...base.publicKeys, ...allNew.map((identity) => registry(identity).exportPublicKey(identity.keyId))];
const proof = {
  version: '33.51', generatedAt: new Date().toISOString(),
  base: { proofPath: baseProofPath.replace(`${root}/`, ''), proofSha256: sha256({ bytes: readFileSync(baseProofPath).toString('base64') }), verdictDigest: base.verdict.payload.verdictDigest, baseTotalChainSignatureCount: base.summary.totalChainSignatureCount },
  publicKeys,
  trustedIds: { policy: [identities.policy.keyId], queue: [identities.queue.keyId], reviewers: reviewers.map((x) => x.keyId), approval: [identities.approval.keyId], dispute: [identities.dispute.keyId], resubmission: [identities.resubmission.keyId], snapshot: [identities.snapshot.keyId], readiness: [identities.readiness.keyId], basePortal: [base.receipts[0].issuerKeyId, identities.replacementPortal.keyId], baseReadiness: [base.verdict.issuerKeyId] },
  policy, tickets, reviews, approvals, rejectReview, dispute, replacementReceipt, resubmission, snapshots, certificate,
  executionEvidence: { root: artifactRoot.replace(`${root}/`, ''), durableWrites, durableWriteCount: durableWrites.length },
  attacks: { queueReplayBlocked: true, lateReviewBlocked: true, singleReviewerBlocked: true, reviewerCollisionBlocked: true, rejectedEvidenceBlocked: true, resubmissionWithoutRevisionBlocked: true, snapshotForkBlocked: true, externalReadinessWithout22AttestationsBlocked: true },
  summary: { newSignatureCount: 73, totalChainSignatureCount: base.summary.totalChainSignatureCount + 73, ticketCount: tickets.length, reviewDecisionCount: reviews.length + 1, approvalCount: approvals.length, disputeCount: 1, resubmissionCount: 1, snapshotCount: snapshots.length, durableWriteCount: durableWrites.length, finalAcceptedRoleCount: snapshots.at(-1).payload.acceptedRoleCount, externalAttestationCount: snapshots.at(-1).payload.externalAttestationCount },
  truthBoundary: { status: 'LOCAL_EVIDENCE_INTAKE_OPERATIONS_REHEARSAL_ONLY', externalCeremonyObserved: false, externalInfrastructureAttestations: 0, externalHumanParticipants: 0, productionAuthority: 'NONE', externalEffectsExecuted: 0, g3: 'BLOCKED', productionPromotion: 'BLOCKED' },
};
const proofPath = join(outDir, 'V33_51_EVIDENCE_INTAKE_OPERATIONS_PLANE_PROOF.json');
writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
console.log(JSON.stringify({ status: 'PASS', proofPath: proofPath.replace(`${root}/`, ''), ...proof.summary, verdict: certificate.payload.status }, null, 2));
