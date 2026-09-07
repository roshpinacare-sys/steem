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
import type { CoordinatorLeaseCertificateV33_33, ContinuityActorDescriptorV33_33 } from '../src/app/federated-checkpoint-continuity-v33_33.js';
import type { RecoveryWitnessDescriptorV33_34 } from '../src/app/federated-recovery-drill-v33_34.js';
import {
  createCoordinatorActionClaimV33_35,
  createExpiredCoordinatorTakeoverPlanV33_35,
  createLeaseExpiryWitnessVoteV33_35,
  createMonitorGossipStatementV33_35,
  createMonitorRetrievalReceiptV33_35,
  createPublicationEndpointReceiptV33_35,
  createPublishedTakeoverArtifactV33_35,
  createReplacementTakeoverAcceptanceV33_35,
  createTakeoverRecoveryVerdictV33_35,
  detectExpiredTakeoverConflictsV33_35,
  detectMonitorSplitViewV33_35,
  finalizeExpiredCoordinatorTakeoverV33_35,
  verifyCoordinatorActionAgainstTakeoverV33_35,
  verifyExpiredCoordinatorTakeoverV33_35,
  verifyRetrievalAndGossipV33_35,
  type MonitorRetrievalReceiptV33_35,
} from '../src/app/expired-coordinator-takeover-v33_35.js';

function registry(...ids: SigningIdentity[]): KeyRegistry { const r = new KeyRegistry(); for (const id of ids) r.register(id.keyId, id.publicKey); return r; }
function descriptor(id: SigningIdentity, org: string, host: string): ContinuityActorDescriptorV33_33 { const r = registry(id); return { keyId: id.keyId, keyFingerprint: r.fingerprint(id.keyId)!, organizationId: org, hostId: host }; }
function witness(id: SigningIdentity, n: number): RecoveryWitnessDescriptorV33_34 { return { witnessId: `witness-${n}`, ...descriptor(id, `witness-org-${n}`, `witness-host-${n}`) }; }
function at(value: string): Date { return new Date(value); }
const digest = (name: string): string => sha256({ name });

function fakeLease(rotationAuthority: SigningIdentity, outgoing: SigningIdentity): SignedEnvelope<CoordinatorLeaseCertificateV33_33> {
  const material = {
    version: '33.33' as const,
    leaseId: 'lease-v33-35-base',
    planDigest: digest('plan'),
    proposalDigest: digest('proposal'),
    epoch: 4,
    term: 7,
    previousLeaseDigest: digest('previous-lease'),
    sequenceStart: 101,
    sequenceEnd: 200,
    coordinatorKeyId: outgoing.keyId,
    coordinatorOrganizationId: 'outgoing-org',
    coordinatorHostId: 'outgoing-host',
    quorumRequired: 3,
    witnessVoteDigests: [digest('lv1'), digest('lv2'), digest('lv3')],
    witnessKeyIds: ['lease-w1', 'lease-w2', 'lease-w3'],
    issuedAt: '2026-07-22T14:00:00.000Z',
    expiresAt: '2026-07-22T15:00:00.000Z',
    rotationAuthorityKeyId: rotationAuthority.keyId,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, leaseDigest: sha256(material) }, rotationAuthority);
}

function fixture() {
  const rotationAuthority = generateSigningIdentity('rotation-authority-v3335');
  const recoveryAuthority = generateSigningIdentity('recovery-authority-v3335');
  const outgoing = generateSigningIdentity('outgoing-coordinator-v3335');
  const replacement = generateSigningIdentity('replacement-coordinator-v3335');
  const witnesses = Array.from({ length: 5 }, (_, i) => generateSigningIdentity(`takeover-witness-${i + 1}`));
  const witnessRows = witnesses.map((id, i) => witness(id, i + 1));
  const lease = fakeLease(rotationAuthority, outgoing);
  const recoveryDescriptor = descriptor(recoveryAuthority, 'recovery-org', 'recovery-host');
  const replacementDescriptor = descriptor(replacement, 'replacement-org', 'replacement-host');
  const plan = createExpiredCoordinatorTakeoverPlanV33_35({
    recoveryAuthority, recoveryAuthorityDescriptor: recoveryDescriptor, predecessorLease: lease, replacementCoordinator: replacementDescriptor,
    witnesses: witnessRows, quorum: 3, sequenceEnd: 300, expirySafetyDelayMs: 60_000, challengeDigest: digest('takeover-challenge'),
    previousTakeoverDigest: null, issuedAt: at('2026-07-22T15:01:00.000Z'), expiresAt: at('2026-07-22T16:00:00.000Z'),
  });
  const acceptance = createReplacementTakeoverAcceptanceV33_35({ replacementCoordinator: replacement, plan, acceptedAt: at('2026-07-22T15:01:05.000Z') });
  const votes = witnesses.slice(0, 3).map((id, i) => createLeaseExpiryWitnessVoteV33_35({ witness: id, plan, observedAt: at(`2026-07-22T15:01:0${i + 6}.000Z`) }));
  const trust = {
    predecessorLeaseRegistry: registry(rotationAuthority), trustedPredecessorLeaseSignerIds: [rotationAuthority.keyId],
    planRegistry: registry(recoveryAuthority), trustedPlanSignerIds: [recoveryAuthority.keyId],
    replacementCoordinatorRegistry: registry(replacement), trustedReplacementCoordinatorIds: [replacement.keyId],
    witnessRegistry: registry(...witnesses), trustedWitnessIds: witnesses.map((id) => id.keyId),
    recoveryAuthorityRegistry: registry(recoveryAuthority), trustedRecoveryAuthorityIds: [recoveryAuthority.keyId],
  };
  const bundle = finalizeExpiredCoordinatorTakeoverV33_35({ recoveryAuthority, predecessorLease: lease, plan, acceptance, expiryVotes: votes, trust, issuedAt: at('2026-07-22T15:01:20.000Z') });

  const publisher = generateSigningIdentity('publisher-v3335');
  const publisherDescriptor = descriptor(publisher, 'publisher-org', 'publisher-host');
  const monitors = Array.from({ length: 3 }, (_, i) => generateSigningIdentity(`monitor-v3335-${i + 1}`));
  const monitorRows = monitors.map((id, i) => witness(id, i + 11));
  const content = Buffer.from(JSON.stringify({ takeoverDigest: bundle.certificate.payload.takeoverDigest, status: 'recovered' }));
  const artifact = createPublishedTakeoverArtifactV33_35({ takeover: bundle.certificate, content, createdAt: at('2026-07-22T15:02:00.000Z') });
  const publication = createPublicationEndpointReceiptV33_35({ publisher, publisherDescriptor, artifact, endpointUri: 'http://127.0.0.1:19435/recovery.json', publishedAt: at('2026-07-22T15:02:01.000Z') });
  const retrievals = monitors.map((id, i) => createMonitorRetrievalReceiptV33_35({ monitor: id, monitorDescriptor: monitorRows[i]!, publicationReceipt: publication, content, transport: 'HTTP_LOOPBACK', processId: 4000 + i, observedAt: at(`2026-07-22T15:02:1${i}.000Z`) }));
  const gossip = monitors.map((id, i) => createMonitorGossipStatementV33_35({ monitor: id, ownReceipt: retrievals[i]!, peerReceipts: retrievals.filter((_, j) => j !== i), observedAt: at(`2026-07-22T15:02:2${i}.000Z`) }));
  const retrievalTrust = { publisherRegistry: registry(publisher), trustedPublisherIds: [publisher.keyId], monitorRegistry: registry(...monitors), trustedMonitorIds: monitors.map((id) => id.keyId), monitors: monitorRows, quorum: 3 };
  return { rotationAuthority, recoveryAuthority, recoveryDescriptor, outgoing, replacement, replacementDescriptor, witnesses, witnessRows, lease, plan, acceptance, votes, trust, bundle, publisher, publisherDescriptor, monitors, monitorRows, content, artifact, publication, retrievals, gossip, retrievalTrust };
}

const verifiedAt = at('2026-07-22T15:03:00.000Z');

test('expired lease takeover succeeds without outgoing coordinator signature', () => {
  const f = fixture();
  const cert = verifyExpiredCoordinatorTakeoverV33_35({ bundle: f.bundle, trust: f.trust, verifiedAt });
  assert.equal(cert.outgoingCoordinatorKeyId, f.outgoing.keyId); assert.equal(cert.nextTerm, 8); assert.equal(cert.sequenceStart, 201);
});

test('takeover before lease expiry plus safety delay is rejected', () => {
  const f = fixture();
  assert.throws(() => createExpiredCoordinatorTakeoverPlanV33_35({
    recoveryAuthority: f.recoveryAuthority, recoveryAuthorityDescriptor: f.recoveryDescriptor, predecessorLease: f.lease, replacementCoordinator: f.replacementDescriptor,
    witnesses: f.witnessRows, quorum: 3, sequenceEnd: 300, expirySafetyDelayMs: 60_000, challengeDigest: digest('early'), previousTakeoverDigest: null,
    issuedAt: at('2026-07-22T15:00:59.999Z'), expiresAt: at('2026-07-22T16:00:00.000Z'),
  }), /v33_35_lease_not_expired/);
});

test('replacement must be independent of outgoing coordinator', () => {
  const f = fixture();
  assert.throws(() => createExpiredCoordinatorTakeoverPlanV33_35({
    recoveryAuthority: f.recoveryAuthority, recoveryAuthorityDescriptor: f.recoveryDescriptor, predecessorLease: f.lease,
    replacementCoordinator: { ...f.replacementDescriptor, organizationId: 'outgoing-org' }, witnesses: f.witnessRows, quorum: 3, sequenceEnd: 300,
    expirySafetyDelayMs: 0, challengeDigest: digest('overlap'), previousTakeoverDigest: null, issuedAt: at('2026-07-22T15:01:00.000Z'), expiresAt: at('2026-07-22T16:00:00.000Z'),
  }), /v33_35_replacement_not_independent/);
});

test('replacement cannot overlap recovery authority', () => {
  const f = fixture();
  assert.throws(() => createExpiredCoordinatorTakeoverPlanV33_35({
    recoveryAuthority: f.recoveryAuthority, recoveryAuthorityDescriptor: f.recoveryDescriptor, predecessorLease: f.lease,
    replacementCoordinator: { ...f.replacementDescriptor, hostId: 'recovery-host' }, witnesses: f.witnessRows, quorum: 3, sequenceEnd: 300,
    expirySafetyDelayMs: 0, challengeDigest: digest('authority-overlap'), previousTakeoverDigest: null, issuedAt: at('2026-07-22T15:01:00.000Z'), expiresAt: at('2026-07-22T16:00:00.000Z'),
  }), /v33_35_replacement_authority_overlap/);
});

test('sequence must continue exactly after predecessor lease', () => {
  const f = fixture();
  assert.throws(() => createExpiredCoordinatorTakeoverPlanV33_35({
    recoveryAuthority: f.recoveryAuthority, recoveryAuthorityDescriptor: f.recoveryDescriptor, predecessorLease: f.lease, replacementCoordinator: f.replacementDescriptor,
    witnesses: f.witnessRows, quorum: 3, sequenceEnd: 200, expirySafetyDelayMs: 0, challengeDigest: digest('sequence'), previousTakeoverDigest: null,
    issuedAt: at('2026-07-22T15:01:00.000Z'), expiresAt: at('2026-07-22T16:00:00.000Z'),
  }), /v33_35_takeover_sequence_range_invalid/);
});

test('quorum below three is rejected', () => {
  const f = fixture();
  assert.throws(() => createExpiredCoordinatorTakeoverPlanV33_35({
    recoveryAuthority: f.recoveryAuthority, recoveryAuthorityDescriptor: f.recoveryDescriptor, predecessorLease: f.lease, replacementCoordinator: f.replacementDescriptor,
    witnesses: f.witnessRows, quorum: 2, sequenceEnd: 300, expirySafetyDelayMs: 0, challengeDigest: digest('quorum'), previousTakeoverDigest: null,
    issuedAt: at('2026-07-22T15:01:00.000Z'), expiresAt: at('2026-07-22T16:00:00.000Z'),
  }), /v33_35_takeover_quorum_invalid/);
});

test('expiry vote before earliest takeover is rejected', () => {
  const f = fixture();
  assert.throws(() => createLeaseExpiryWitnessVoteV33_35({ witness: f.witnesses[0]!, plan: f.plan, observedAt: at('2026-07-22T15:00:59.000Z') }), /v33_35_expiry_vote_too_early/);
});

test('unenrolled expiry voter is rejected', () => {
  const f = fixture();
  assert.throws(() => createLeaseExpiryWitnessVoteV33_35({ witness: generateSigningIdentity('outsider-vote'), plan: f.plan, observedAt: at('2026-07-22T15:01:10.000Z') }), /v33_35_expiry_voter_not_enrolled/);
});

test('takeover requires three distinct expiry votes', () => {
  const f = fixture();
  assert.throws(() => finalizeExpiredCoordinatorTakeoverV33_35({ recoveryAuthority: f.recoveryAuthority, predecessorLease: f.lease, plan: f.plan, acceptance: f.acceptance, expiryVotes: f.votes.slice(0, 2), trust: f.trust, issuedAt: at('2026-07-22T15:01:20.000Z') }), /v33_35_expiry_vote_quorum_not_met/);
});

test('duplicate expiry votes are rejected', () => {
  const f = fixture();
  assert.throws(() => finalizeExpiredCoordinatorTakeoverV33_35({ recoveryAuthority: f.recoveryAuthority, predecessorLease: f.lease, plan: f.plan, acceptance: f.acceptance, expiryVotes: [f.votes[0]!, f.votes[0]!, f.votes[1]!], trust: f.trust, issuedAt: at('2026-07-22T15:01:20.000Z') }), /v33_35_expiry_vote_topology_invalid|v33_35_expiry_vote_quorum_not_met/);
});

test('forged plan signature is rejected', () => {
  const f = fixture(); const plan = { ...f.plan, signature: `${f.plan.signature}x` };
  assert.throws(() => verifyExpiredCoordinatorTakeoverV33_35({ bundle: { ...f.bundle, plan }, trust: f.trust, verifiedAt }), /v33_35_takeover_plan_signature_invalid/);
});

test('forged replacement acceptance is rejected', () => {
  const f = fixture(); const acceptance = { ...f.acceptance, signature: `${f.acceptance.signature}x` };
  assert.throws(() => verifyExpiredCoordinatorTakeoverV33_35({ bundle: { ...f.bundle, acceptance }, trust: f.trust, verifiedAt }), /v33_35_acceptance_signature_invalid/);
});

test('tampered takeover certificate is rejected', () => {
  const f = fixture(); const p = f.bundle.certificate.payload; const certificate = { ...f.bundle.certificate, payload: { ...p, sequenceEnd: p.sequenceEnd + 1 } };
  assert.throws(() => verifyExpiredCoordinatorTakeoverV33_35({ bundle: { ...f.bundle, certificate }, trust: f.trust, verifiedAt }), /v33_35_takeover_certificate_signature_invalid|v33_35_takeover_certificate_digest_invalid/);
});

test('production authority mutation is rejected', () => {
  const f = fixture(); const p = f.bundle.certificate.payload; const material = { ...p, productionAuthority: 'PRODUCTION' as never }; delete (material as { takeoverDigest?: string }).takeoverDigest;
  const certificate = signEnvelope({ ...material, takeoverDigest: sha256(material) }, f.recoveryAuthority) as typeof f.bundle.certificate;
  assert.throws(() => verifyExpiredCoordinatorTakeoverV33_35({ bundle: { ...f.bundle, certificate }, trust: f.trust, verifiedAt }), /v33_35_takeover_certificate_boundary_invalid/);
});

test('conflicting takeovers from one expired lease are detected', () => {
  const f = fixture(); const other = generateSigningIdentity('other-replacement');
  const p = f.bundle.certificate.payload; const material = { ...p, certificateId: 'other-cert', replacementCoordinatorKeyId: other.keyId }; delete (material as { takeoverDigest?: string }).takeoverDigest;
  const second = signEnvelope({ ...material, takeoverDigest: sha256(material) }, f.recoveryAuthority) as typeof f.bundle.certificate;
  assert.equal(detectExpiredTakeoverConflictsV33_35([f.bundle.certificate, second]).length, 1);
});

test('outgoing coordinator is fenced after takeover', () => {
  const f = fixture(); const action = createCoordinatorActionClaimV33_35({ coordinator: f.outgoing, leaseDigest: f.lease.payload.leaseDigest, takeoverDigest: null, epoch: 4, term: 7, sequence: 201, commandDigest: digest('resurrection'), issuedAt: at('2026-07-22T15:02:00.000Z') });
  assert.throws(() => verifyCoordinatorActionAgainstTakeoverV33_35({ action, coordinatorRegistry: registry(f.outgoing, f.replacement), takeover: f.bundle.certificate, verifiedAt }), /v33_35_outgoing_coordinator_fenced/);
});

test('replacement coordinator action verifies with takeover fencing token', () => {
  const f = fixture(); const action = createCoordinatorActionClaimV33_35({ coordinator: f.replacement, leaseDigest: f.lease.payload.leaseDigest, takeoverDigest: f.bundle.certificate.payload.takeoverDigest, epoch: 4, term: 8, sequence: 201, commandDigest: digest('replacement-action'), issuedAt: at('2026-07-22T15:02:00.000Z') });
  assert.equal(verifyCoordinatorActionAgainstTakeoverV33_35({ action, coordinatorRegistry: registry(f.outgoing, f.replacement), takeover: f.bundle.certificate, verifiedAt }).sequence, 201);
});

test('replacement action without takeover digest is rejected', () => {
  const f = fixture(); const action = createCoordinatorActionClaimV33_35({ coordinator: f.replacement, leaseDigest: f.lease.payload.leaseDigest, takeoverDigest: null, epoch: 4, term: 8, sequence: 201, commandDigest: digest('no-token'), issuedAt: at('2026-07-22T15:02:00.000Z') });
  assert.throws(() => verifyCoordinatorActionAgainstTakeoverV33_35({ action, coordinatorRegistry: registry(f.replacement), takeover: f.bundle.certificate, verifiedAt }), /v33_35_replacement_action_binding_invalid/);
});

test('replacement action with old term is rejected', () => {
  const f = fixture(); const action = createCoordinatorActionClaimV33_35({ coordinator: f.replacement, leaseDigest: f.lease.payload.leaseDigest, takeoverDigest: f.bundle.certificate.payload.takeoverDigest, epoch: 4, term: 7, sequence: 201, commandDigest: digest('old-term'), issuedAt: at('2026-07-22T15:02:00.000Z') });
  assert.throws(() => verifyCoordinatorActionAgainstTakeoverV33_35({ action, coordinatorRegistry: registry(f.replacement), takeover: f.bundle.certificate, verifiedAt }), /v33_35_replacement_action_binding_invalid/);
});

test('replacement action outside takeover sequence range is rejected', () => {
  const f = fixture(); const action = createCoordinatorActionClaimV33_35({ coordinator: f.replacement, leaseDigest: f.lease.payload.leaseDigest, takeoverDigest: f.bundle.certificate.payload.takeoverDigest, epoch: 4, term: 8, sequence: 301, commandDigest: digest('outside'), issuedAt: at('2026-07-22T15:02:00.000Z') });
  assert.throws(() => verifyCoordinatorActionAgainstTakeoverV33_35({ action, coordinatorRegistry: registry(f.replacement), takeover: f.bundle.certificate, verifiedAt }), /v33_35_action_sequence_outside_takeover/);
});

test('loopback publication endpoint is accepted for local process rehearsal', () => { const f = fixture(); assert.match(f.publication.payload.endpointUri, /^http:\/\/127\.0\.0\.1/); });

test('non-loopback HTTP publication endpoint is rejected', () => {
  const f = fixture();
  assert.throws(() => createPublicationEndpointReceiptV33_35({ publisher: f.publisher, publisherDescriptor: f.publisherDescriptor, artifact: f.artifact, endpointUri: 'http://example.com/recovery.json', publishedAt: at('2026-07-22T15:02:01.000Z') }), /v33_35_endpoint_uri_invalid/);
});

test('retrieved content bytes must match publication digest', () => {
  const f = fixture();
  assert.throws(() => createMonitorRetrievalReceiptV33_35({ monitor: f.monitors[0]!, monitorDescriptor: f.monitorRows[0]!, publicationReceipt: f.publication, content: Buffer.from('different'), transport: 'HTTP_LOOPBACK', processId: 9, observedAt: verifiedAt }), /v33_35_retrieved_content_mismatch/);
});

test('retrieval and gossip quorum verifies across distinct processes', () => {
  const f = fixture(); const result = verifyRetrievalAndGossipV33_35({ publicationReceipt: f.publication, retrievalReceipts: f.retrievals, gossipStatements: f.gossip, trust: f.retrievalTrust, verifiedAt });
  assert.equal(result.independentProcessesObserved, true); assert.equal(result.externalTopologyObserved, false);
});

test('retrieval quorum below three is rejected', () => {
  const f = fixture(); assert.throws(() => verifyRetrievalAndGossipV33_35({ publicationReceipt: f.publication, retrievalReceipts: f.retrievals.slice(0, 2), gossipStatements: f.gossip.slice(0, 2), trust: f.retrievalTrust, verifiedAt }), /v33_35_retrieval_quorum_not_met/);
});

test('duplicate monitor retrievals are rejected', () => {
  const f = fixture(); assert.throws(() => verifyRetrievalAndGossipV33_35({ publicationReceipt: f.publication, retrievalReceipts: [f.retrievals[0]!, f.retrievals[0]!, f.retrievals[1]!], gossipStatements: f.gossip, trust: f.retrievalTrust, verifiedAt }), /v33_35_retrieval_topology_invalid|v33_35_retrieval_quorum_not_met/);
});

test('forged retrieval signature is rejected', () => {
  const f = fixture(); const retrievals = [{ ...f.retrievals[0]!, signature: `${f.retrievals[0]!.signature}x` }, ...f.retrievals.slice(1)];
  assert.throws(() => verifyRetrievalAndGossipV33_35({ publicationReceipt: f.publication, retrievalReceipts: retrievals, gossipStatements: f.gossip, trust: f.retrievalTrust, verifiedAt }), /v33_35_retrieval_signature_invalid/);
});

test('monitor split-view is detected', () => {
  const f = fixture(); const original = f.retrievals[2]!.payload; const alteredMaterial = { ...original, artifactDigest: digest('evil-artifact'), contentDigest: digest('evil-content') }; delete (alteredMaterial as { retrievalDigest?: string }).retrievalDigest;
  const altered = signEnvelope({ ...alteredMaterial, retrievalDigest: sha256(alteredMaterial) }, f.monitors[2]!) as SignedEnvelope<MonitorRetrievalReceiptV33_35>;
  assert.equal(detectMonitorSplitViewV33_35([f.retrievals[0]!, f.retrievals[1]!, altered]).length, 1);
});

test('split-view receipts are rejected by consensus verifier', () => {
  const f = fixture(); const original = f.retrievals[2]!.payload; const alteredMaterial = { ...original, artifactDigest: digest('evil-artifact'), contentDigest: digest('evil-content') }; delete (alteredMaterial as { retrievalDigest?: string }).retrievalDigest;
  const altered = signEnvelope({ ...alteredMaterial, retrievalDigest: sha256(alteredMaterial) }, f.monitors[2]!) as SignedEnvelope<MonitorRetrievalReceiptV33_35>;
  assert.throws(() => verifyRetrievalAndGossipV33_35({ publicationReceipt: f.publication, retrievalReceipts: [f.retrievals[0]!, f.retrievals[1]!, altered], gossipStatements: f.gossip, trust: f.retrievalTrust, verifiedAt }), /v33_35_retrieval_binding_invalid|v33_35_retrieval_split_view_detected/);
});

test('gossip statement rejects a conflicting peer view', () => {
  const f = fixture(); const original = f.retrievals[2]!.payload; const alteredMaterial = { ...original, artifactDigest: digest('other') }; delete (alteredMaterial as { retrievalDigest?: string }).retrievalDigest;
  const altered = signEnvelope({ ...alteredMaterial, retrievalDigest: sha256(alteredMaterial) }, f.monitors[2]!) as SignedEnvelope<MonitorRetrievalReceiptV33_35>;
  assert.throws(() => createMonitorGossipStatementV33_35({ monitor: f.monitors[0]!, ownReceipt: f.retrievals[0]!, peerReceipts: [f.retrievals[1]!, altered], observedAt: verifiedAt }), /v33_35_gossip_split_view_detected/);
});

test('gossip peer set omission is rejected', () => {
  const f = fixture(); const g = f.gossip[0]!.payload; const material = { ...g, peerRetrievalDigests: [g.peerRetrievalDigests[0]!] }; delete (material as { gossipDigest?: string }).gossipDigest;
  const tampered = signEnvelope({ ...material, gossipDigest: sha256(material) }, f.monitors[0]!) as typeof f.gossip[number];
  assert.throws(() => verifyRetrievalAndGossipV33_35({ publicationReceipt: f.publication, retrievalReceipts: f.retrievals, gossipStatements: [tampered, f.gossip[1]!, f.gossip[2]!], trust: f.retrievalTrust, verifiedAt }), /v33_35_gossip_peer_set_invalid/);
});

test('external transport claims external topology only for HTTPS_EXTERNAL', () => {
  const f = fixture(); const r = createMonitorRetrievalReceiptV33_35({ monitor: f.monitors[0]!, monitorDescriptor: f.monitorRows[0]!, publicationReceipt: f.publication, content: f.content, transport: 'HTTPS_EXTERNAL', processId: 99, observedAt: verifiedAt });
  assert.equal(r.payload.externalTopologyObserved, true);
});

test('local multi-process verdict preserves no-production boundary', () => {
  const f = fixture(); const retrieval = verifyRetrievalAndGossipV33_35({ publicationReceipt: f.publication, retrievalReceipts: f.retrievals, gossipStatements: f.gossip, trust: f.retrievalTrust, verifiedAt });
  const verdict = createTakeoverRecoveryVerdictV33_35({ takeover: f.bundle.certificate, retrievalResult: retrieval, generatedAt: verifiedAt });
  assert.equal(verdict.status, 'LOCAL_MULTI_PROCESS_RECOVERY_REHEARSAL_ONLY'); assert.equal(verdict.networkFetchObserved, true); assert.equal(verdict.externalTopologyObserved, false); assert.equal(verdict.productionAuthority, 'NONE');
});
