import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { KeyRegistry, sha256 } from '../dist/src/contracts/crypto.js';
import { verifyExternalReadinessCertificateV33_51 } from '../dist/src/supply-chain/evidence-intake-operations-plane-v33_51.js';

const root = resolve('.');
const proofPath = join(root, 'release-evidence/v33.51/V33_51_EVIDENCE_INTAKE_OPERATIONS_PLANE_PROOF.json');
const proof = JSON.parse(readFileSync(proofPath, 'utf8'));
const baseVerify = spawnSync(process.execPath, ['scripts/verify-ceremony-evidence-intake-portal-v33_50.mjs'], { cwd: root, encoding: 'utf8' });
if (baseVerify.status !== 0) throw new Error(`base_verifier_failed:${baseVerify.stderr || baseVerify.stdout}`);
const byId = new Map(proof.publicKeys.map((record) => [record.keyId, record]));
const makeRegistry = (ids) => { const r = new KeyRegistry(); for (const id of ids) { const record = byId.get(id); if (!record) throw new Error(`public_key_missing:${id}`); r.registerExported(record); } return r; };
const trust = {
  policyRegistry: makeRegistry(proof.trustedIds.policy), trustedPolicySignerIds: proof.trustedIds.policy,
  queueRegistry: makeRegistry(proof.trustedIds.queue), trustedQueueSignerIds: proof.trustedIds.queue,
  reviewerRegistry: makeRegistry(proof.trustedIds.reviewers), trustedReviewerIds: proof.trustedIds.reviewers,
  approvalRegistry: makeRegistry(proof.trustedIds.approval), trustedApprovalSignerIds: proof.trustedIds.approval,
  disputeRegistry: makeRegistry(proof.trustedIds.dispute), trustedDisputeSignerIds: proof.trustedIds.dispute,
  resubmissionRegistry: makeRegistry(proof.trustedIds.resubmission), trustedResubmissionSignerIds: proof.trustedIds.resubmission,
  snapshotRegistry: makeRegistry(proof.trustedIds.snapshot), trustedSnapshotSignerIds: proof.trustedIds.snapshot,
  readinessRegistry: makeRegistry(proof.trustedIds.readiness), trustedReadinessSignerIds: proof.trustedIds.readiness,
  basePortalRegistry: makeRegistry(proof.trustedIds.basePortal), trustedBasePortalSignerIds: proof.trustedIds.basePortal,
  baseReadinessRegistry: makeRegistry(proof.trustedIds.baseReadiness), trustedBaseReadinessSignerIds: proof.trustedIds.baseReadiness,
};
const verifyEnvelope = (envelope, registry, ids, digestField, code) => {
  if (!ids.includes(envelope.issuerKeyId) || !registry.verifyAt(envelope, new Date('2026-07-23T05:20:00.000Z'))) throw new Error(`${code}_signature`);
  const payload = { ...envelope.payload }; const digest = payload[digestField]; delete payload[digestField];
  if (typeof digest !== 'string' || sha256(payload) !== digest) throw new Error(`${code}_digest`);
};
verifyEnvelope(proof.policy, trust.policyRegistry, trust.trustedPolicySignerIds, 'policyDigest', 'policy');
proof.tickets.forEach((x) => verifyEnvelope(x, trust.queueRegistry, trust.trustedQueueSignerIds, 'ticketDigest', 'ticket'));
proof.reviews.forEach((x) => verifyEnvelope(x, trust.reviewerRegistry, trust.trustedReviewerIds, 'reviewDigest', 'review'));
verifyEnvelope(proof.rejectReview, trust.reviewerRegistry, trust.trustedReviewerIds, 'reviewDigest', 'reject_review');
proof.approvals.forEach((x) => verifyEnvelope(x, trust.approvalRegistry, trust.trustedApprovalSignerIds, 'approvalDigest', 'approval'));
verifyEnvelope(proof.dispute, trust.disputeRegistry, trust.trustedDisputeSignerIds, 'disputeDigest', 'dispute');
verifyEnvelope(proof.resubmission, trust.resubmissionRegistry, trust.trustedResubmissionSignerIds, 'resubmissionDigest', 'resubmission');
proof.snapshots.forEach((x) => verifyEnvelope(x, trust.snapshotRegistry, trust.trustedSnapshotSignerIds, 'snapshotDigest', 'snapshot'));
const verdict = verifyExternalReadinessCertificateV33_51({ certificate: proof.certificate, policy: proof.policy, baseReadinessVerdict: JSON.parse(readFileSync(join(root, 'release-evidence/v33.50/V33_50_CEREMONY_EVIDENCE_INTAKE_PORTAL_PROOF.json'), 'utf8')).verdict, approvals: proof.approvals, snapshots: proof.snapshots, trust, verifiedAt: new Date('2026-07-23T05:20:00.000Z') });
if (proof.summary.newSignatureCount !== 73 || proof.summary.totalChainSignatureCount !== 305 || proof.summary.ticketCount !== 16 || proof.summary.approvalCount !== 16 || proof.summary.snapshotCount !== 4 || proof.summary.durableWriteCount !== 73) throw new Error('summary_count');
if (proof.executionEvidence.durableWrites.length !== 73 || proof.executionEvidence.durableWrites.some((x) => !x.fsync || !x.directoryFsync || !x.readBackVerified)) throw new Error('durability');
if (proof.truthBoundary.status !== 'LOCAL_EVIDENCE_INTAKE_OPERATIONS_REHEARSAL_ONLY' || proof.truthBoundary.externalCeremonyObserved || proof.truthBoundary.externalInfrastructureAttestations !== 0 || proof.truthBoundary.productionAuthority !== 'NONE' || proof.truthBoundary.externalEffectsExecuted !== 0 || proof.truthBoundary.g3 !== 'BLOCKED' || proof.truthBoundary.productionPromotion !== 'BLOCKED') throw new Error('truth_boundary');
if (verdict.status !== 'LOCAL_OPERATIONS_COMPLETE_REHEARSAL_ONLY' || verdict.externalCeremonyObserved) throw new Error('verdict_boundary');
const report = { version: '33.51', verifiedAt: new Date().toISOString(), status: 'PASS', baseV3350Verified: true, newSignatureCount: 73, totalChainSignatureCount: 305, ticketCount: 16, dualControlApprovalCount: 16, snapshotCount: 4, durableWriteCount: 73, verdict: verdict.status, truthBoundary: proof.truthBoundary };
const out = join(root, 'release-evidence/v33.51/V33_51_INDEPENDENT_VERIFICATION.json'); mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
