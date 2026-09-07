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
import {
  createFederatedCheckpointGenesisAnchorV33_32,
  createFederatedCheckpointWitnessPolicyV33_32,
  type FederatedCheckpointAnchorV33_32,
  type FederatedCheckpointWitnessDescriptorV33_32,
} from '../src/app/federated-human-pilot-checkpoint-v33_32.js';
import type { ExternalHumanPilotImportCheckpointV33_31 } from '../src/app/external-human-pilot-evidence-import-v33_31.js';
import {
  createCoordinatorLeaseProposalV33_33,
  createCoordinatorLeaseVoteV33_33,
  createEpochRotationVoteV33_33,
  createTransparencyLogEntryV33_33,
  createTransparencyPinVoteV33_33,
  createWitnessActivationProofV33_33,
  createWitnessEpochRotationPlanV33_33,
  detectCoordinatorSplitBrainV33_33,
  detectTransparencySplitViewV33_33,
  finalizeContinuityQualificationV33_33,
  finalizeCoordinatorLeaseV33_33,
  finalizeEpochRotationV33_33,
  finalizeTransparencyPinV33_33,
  verifyCoordinatorLeaseV33_33,
  verifyEpochRotationV33_33,
  verifyTransparencyPinV33_33,
  type ContinuityActorDescriptorV33_33,
  type CoordinatorLeaseCertificateV33_33,
  type CoordinatorLeaseTrustV33_33,
  type EpochRotationTrustV33_33,
  type TransparencyMonitorDescriptorV33_33,
  type TransparencyPinCertificateV33_33,
  type TransparencyTrustV33_33,
  type WitnessEpochRotationPlanV33_33,
} from '../src/app/federated-checkpoint-continuity-v33_33.js';

const issuedAt = new Date('2026-07-22T10:00:00.000Z');
const activeAt = new Date('2026-07-22T12:00:00.000Z');
const leaseActiveAt = new Date('2026-07-22T12:10:00.000Z');
const expiresAt = new Date('2026-07-23T10:00:00.000Z');
const protocolDigest = sha256({ protocol: 'v33.33-continuity' });
const activationChallengeDigest = sha256({ activation: 'epoch-2' });

function registry(...identities: readonly SigningIdentity[]): KeyRegistry {
  const value = new KeyRegistry();
  for (const identity of identities) value.register(identity.keyId, identity.publicKey);
  return value;
}

function descriptor(identity: SigningIdentity, organizationId: string, hostId: string): ContinuityActorDescriptorV33_33 {
  const keys = registry(identity);
  return { keyId: identity.keyId, keyFingerprint: keys.fingerprint(identity.keyId)!, organizationId, hostId };
}

function witnessDescriptor(identity: SigningIdentity, index: number, prefix: string): FederatedCheckpointWitnessDescriptorV33_32 {
  const actor = descriptor(identity, `${prefix}-org-${index}`, `${prefix}-host-${index}`);
  return { witnessId: `${prefix}-witness-${index}`, ...actor };
}

function monitorDescriptor(identity: SigningIdentity, index: number): TransparencyMonitorDescriptorV33_33 {
  return { monitorId: `monitor-${index}`, ...descriptor(identity, `monitor-org-${index}`, `monitor-host-${index}`) };
}

function checkpoint(signer: SigningIdentity): SignedEnvelope<ExternalHumanPilotImportCheckpointV33_31> {
  const material = {
    version: '33.31' as const,
    checkpointId: 'checkpoint-0',
    sequence: 0,
    previousCheckpointDigest: null,
    consumedChallengeDigests: [] as readonly string[],
    consumedPackageDigests: [] as readonly string[],
    generatedAt: new Date('2026-07-22T09:05:00.000Z').toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, checkpointDigest: sha256(material) }, signer);
}

function resign<T extends object>(payload: T, digestField: keyof T, signer: SigningIdentity): SignedEnvelope<T> {
  const material = { ...payload } as Record<string, unknown>;
  delete material[String(digestField)];
  material[String(digestField)] = sha256(material);
  return signEnvelope(material as T, signer);
}

function fixture() {
  const policySigner = generateSigningIdentity('v33-33-policy-signer');
  const oldImporter = generateSigningIdentity('v33-33-old-importer');
  const oldCoordinator = generateSigningIdentity('v33-33-old-coordinator');
  const oldWitnesses = Array.from({ length: 5 }, (_, index) => generateSigningIdentity(`v33-33-old-witness-${index + 1}`));
  const oldWitnessRows = oldWitnesses.map((identity, index) => witnessDescriptor(identity, index + 1, 'old'));
  const currentPolicy = createFederatedCheckpointWitnessPolicyV33_32({
    policySigner,
    studyId: 'study-v33-33',
    protocolDigest,
    epoch: 1,
    quorum: 3,
    witnesses: oldWitnessRows,
    importer: { keyId: oldImporter.keyId, organizationId: 'old-importer-org', hostId: 'old-importer-host' },
    coordinator: { keyId: oldCoordinator.keyId, organizationId: 'old-coordinator-org', hostId: 'old-coordinator-host' },
    issuedAt: new Date('2026-07-22T09:00:00.000Z'),
    expiresAt,
  });
  const initialCheckpoint = checkpoint(oldImporter);
  const currentAnchor = createFederatedCheckpointGenesisAnchorV33_32({
    anchorSigner: policySigner,
    policy: currentPolicy,
    initialCheckpoint,
    generatedAt: new Date('2026-07-22T09:10:00.000Z'),
  });

  const planSigner = generateSigningIdentity('v33-33-plan-signer');
  const rotationAuthority = generateSigningIdentity('v33-33-rotation-authority');
  const nextImporter = generateSigningIdentity('v33-33-next-importer');
  const nextCoordinator = generateSigningIdentity('v33-33-next-coordinator');
  const replacementWitnesses = [generateSigningIdentity('v33-33-new-witness-4'), generateSigningIdentity('v33-33-new-witness-5')];
  const nextWitnesses = [...oldWitnesses.slice(0, 3), ...replacementWitnesses];
  const nextWitnessRows = nextWitnesses.map((identity, index) => witnessDescriptor(identity, index + 1, 'next'));
  const nextImporterDescriptor = descriptor(nextImporter, 'next-importer-org', 'next-importer-host');
  const nextCoordinatorDescriptor = descriptor(nextCoordinator, 'next-coordinator-org', 'next-coordinator-host');
  const rotationAuthorityDescriptor = descriptor(rotationAuthority, 'rotation-authority-org', 'rotation-authority-host');

  const plan = createWitnessEpochRotationPlanV33_33({
    planSigner,
    currentPolicy,
    currentAnchor,
    nextWitnesses: nextWitnessRows,
    nextQuorum: 3,
    importer: nextImporterDescriptor,
    coordinator: nextCoordinatorDescriptor,
    rotationAuthority: rotationAuthorityDescriptor,
    activationChallengeDigest,
    issuedAt,
    expiresAt,
  });

  const rotationTrust: EpochRotationTrustV33_33 = {
    currentPolicyRegistry: registry(policySigner),
    trustedCurrentPolicySignerIds: [policySigner.keyId],
    currentAnchorRegistry: registry(policySigner, oldCoordinator),
    trustedCurrentAnchorSignerIds: [policySigner.keyId, oldCoordinator.keyId],
    currentWitnessRegistry: registry(...oldWitnesses),
    trustedCurrentWitnessIds: oldWitnesses.map((identity) => identity.keyId),
    nextWitnessRegistry: registry(...nextWitnesses),
    trustedNextWitnessIds: nextWitnesses.map((identity) => identity.keyId),
    planRegistry: registry(planSigner),
    trustedPlanSignerIds: [planSigner.keyId],
    rotationAuthorityRegistry: registry(rotationAuthority),
    trustedRotationAuthorityIds: [rotationAuthority.keyId],
  };
  const oldWitnessVotes = oldWitnesses.slice(0, 3).map((witness) => createEpochRotationVoteV33_33({ witness, currentPolicy, plan, observedAt: new Date('2026-07-22T10:05:00.000Z') }));
  const activationProofs = nextWitnesses.map((witness) => createWitnessActivationProofV33_33({ witness, plan, activatedAt: new Date('2026-07-22T10:06:00.000Z') }));
  const rotation = finalizeEpochRotationV33_33({ rotationAuthority, currentPolicy, currentAnchor, plan, oldWitnessVotes, activationProofs, trust: rotationTrust, issuedAt: new Date('2026-07-22T10:10:00.000Z') });

  const leaseTrust: CoordinatorLeaseTrustV33_33 = {
    planRegistry: registry(planSigner),
    trustedPlanSignerIds: [planSigner.keyId],
    coordinatorRegistry: registry(nextCoordinator),
    trustedCoordinatorIds: [nextCoordinator.keyId],
    witnessRegistry: registry(...nextWitnesses),
    trustedWitnessIds: nextWitnesses.map((identity) => identity.keyId),
    rotationAuthorityRegistry: registry(rotationAuthority),
    trustedRotationAuthorityIds: [rotationAuthority.keyId],
  };
  const leaseProposal = createCoordinatorLeaseProposalV33_33({
    coordinator: nextCoordinator,
    plan,
    term: 1,
    previousLease: null,
    sequenceWindow: 100,
    notBefore: new Date('2026-07-22T12:00:00.000Z'),
    expiresAt: new Date('2026-07-22T14:00:00.000Z'),
    proposedAt: new Date('2026-07-22T11:55:00.000Z'),
  });
  const leaseVotes = nextWitnesses.slice(0, 3).map((witness) => createCoordinatorLeaseVoteV33_33({ witness, plan, proposal: leaseProposal, observedAt: new Date('2026-07-22T11:57:00.000Z') }));
  const lease = finalizeCoordinatorLeaseV33_33({ rotationAuthority, plan, previousLease: null, proposal: leaseProposal, votes: leaseVotes, trust: leaseTrust, issuedAt: new Date('2026-07-22T11:58:00.000Z') });

  const logOperator = generateSigningIdentity('v33-33-log-operator');
  const monitors = Array.from({ length: 3 }, (_, index) => generateSigningIdentity(`v33-33-monitor-${index + 1}`));
  const pinAuthority = generateSigningIdentity('v33-33-pin-authority');
  const logOperatorDescriptor = descriptor(logOperator, 'log-operator-org', 'log-operator-host');
  const monitorRows = monitors.map((identity, index) => monitorDescriptor(identity, index + 1));
  const pinAuthorityDescriptor = descriptor(pinAuthority, 'pin-authority-org', 'pin-authority-host');
  const transparencyTrust: TransparencyTrustV33_33 = {
    logOperatorRegistry: registry(logOperator),
    trustedLogOperatorIds: [logOperator.keyId],
    logOperator: logOperatorDescriptor,
    monitorRegistry: registry(...monitors),
    trustedMonitorIds: monitors.map((identity) => identity.keyId),
    monitors: monitorRows,
    monitorQuorum: 2,
    pinAuthorityRegistry: registry(pinAuthority),
    trustedPinAuthorityIds: [pinAuthority.keyId],
    pinAuthority: pinAuthorityDescriptor,
    platformOwnerOrganizationId: 'platform-owner-org',
  };
  const entry0 = createTransparencyLogEntryV33_33({ operator: logOperator, operatorDescriptor: logOperatorDescriptor, logId: 'continuity-log', previousEntry: null, eventType: 'CHECKPOINT_ANCHOR', objectDigest: currentAnchor.payload.anchorDigest, epoch: 1, sequence: 0, recordedAt: new Date('2026-07-22T10:11:00.000Z') });
  const entry1 = createTransparencyLogEntryV33_33({ operator: logOperator, operatorDescriptor: logOperatorDescriptor, logId: 'continuity-log', previousEntry: entry0, eventType: 'EPOCH_ROTATION_PLAN', objectDigest: plan.payload.planDigest, epoch: 2, sequence: 0, recordedAt: new Date('2026-07-22T10:12:00.000Z') });
  const entry2 = createTransparencyLogEntryV33_33({ operator: logOperator, operatorDescriptor: logOperatorDescriptor, logId: 'continuity-log', previousEntry: entry1, eventType: 'EPOCH_ROTATION_CERTIFICATE', objectDigest: rotation.certificate.payload.certificateDigest, epoch: 2, sequence: 0, recordedAt: new Date('2026-07-22T10:13:00.000Z') });
  const entry3 = createTransparencyLogEntryV33_33({ operator: logOperator, operatorDescriptor: logOperatorDescriptor, logId: 'continuity-log', previousEntry: entry2, eventType: 'COORDINATOR_LEASE', objectDigest: lease.certificate.payload.leaseDigest, epoch: 2, sequence: 1, recordedAt: new Date('2026-07-22T11:59:00.000Z') });
  const entries = [entry0, entry1, entry2, entry3];
  const monitorVotes = monitors.slice(0, 2).map((monitor, index) => createTransparencyPinVoteV33_33({ monitor, monitorDescriptor: monitorRows[index]!, entries, observedAt: new Date('2026-07-22T12:01:00.000Z') }));
  const transparency = finalizeTransparencyPinV33_33({ pinAuthority, previousPin: null, entries, monitorVotes, trust: transparencyTrust, issuedAt: new Date('2026-07-22T12:02:00.000Z') });
  const verifier = generateSigningIdentity('v33-33-continuity-verifier');

  return {
    policySigner, oldImporter, oldCoordinator, oldWitnesses, oldWitnessRows, currentPolicy, currentAnchor,
    planSigner, rotationAuthority, nextImporter, nextCoordinator, nextWitnesses, nextWitnessRows,
    nextImporterDescriptor, nextCoordinatorDescriptor, rotationAuthorityDescriptor, plan, rotationTrust,
    oldWitnessVotes, activationProofs, rotation, leaseTrust, leaseProposal, leaseVotes, lease,
    logOperator, monitors, pinAuthority, logOperatorDescriptor, monitorRows, pinAuthorityDescriptor,
    transparencyTrust, entries, monitorVotes, transparency, verifier,
  };
}

test('valid epoch rotation verifies and preserves the checkpoint sequence floor', () => {
  const f = fixture();
  const result = verifyEpochRotationV33_33({ bundle: f.rotation, trust: f.rotationTrust, verifiedAt: activeAt });
  assert.equal(result.fromEpoch, 1);
  assert.equal(result.toEpoch, 2);
  assert.equal(result.sequenceFloor, f.currentAnchor.payload.sequence);
});

test('rotation replaces at most the two witnesses that quorum can survive', () => {
  const f = fixture();
  assert.equal(f.plan.payload.retainedWitnessKeyIds.length, 3);
  assert.equal(f.plan.payload.replacedWitnessKeyIds.length, 2);
  assert.equal(f.plan.payload.maximumReplacements, 2);
});

test('rotation rejects loss of more witnesses than the old quorum can survive', () => {
  const f = fixture();
  const newWitnesses = Array.from({ length: 3 }, (_, index) => generateSigningIdentity(`extra-new-${index}`));
  const rows = [...f.oldWitnesses.slice(0, 2), ...newWitnesses].map((identity, index) => witnessDescriptor(identity, index + 1, 'excess'));
  assert.throws(() => createWitnessEpochRotationPlanV33_33({
    planSigner: f.planSigner, currentPolicy: f.currentPolicy, currentAnchor: f.currentAnchor, nextWitnesses: rows, nextQuorum: 3,
    importer: f.nextImporterDescriptor, coordinator: f.nextCoordinatorDescriptor, rotationAuthority: f.rotationAuthorityDescriptor,
    activationChallengeDigest, issuedAt, expiresAt,
  }), /recovery_limit/);
});

test('rotation cannot reset or skip the epoch', () => {
  const f = fixture();
  const payload = { ...f.plan.payload, toEpoch: 1 };
  const plan = resign(payload, 'planDigest', f.planSigner) as SignedEnvelope<WitnessEpochRotationPlanV33_33>;
  assert.throws(() => verifyEpochRotationV33_33({ bundle: { ...f.rotation, plan }, trust: f.rotationTrust, verifiedAt: activeAt }), /policy_binding/);
});

test('rotation cannot reset the checkpoint sequence floor', () => {
  const f = fixture();
  const payload = { ...f.plan.payload, sequenceFloor: 999 };
  const plan = resign(payload, 'planDigest', f.planSigner) as SignedEnvelope<WitnessEpochRotationPlanV33_33>;
  assert.throws(() => verifyEpochRotationV33_33({ bundle: { ...f.rotation, plan }, trust: f.rotationTrust, verifiedAt: activeAt }), /anchor_binding/);
});

test('rotation cannot substitute a predecessor anchor', () => {
  const f = fixture();
  const payload = { ...f.plan.payload, predecessorAnchorDigest: sha256({ fork: true }) };
  const plan = resign(payload, 'planDigest', f.planSigner) as SignedEnvelope<WitnessEpochRotationPlanV33_33>;
  assert.throws(() => verifyEpochRotationV33_33({ bundle: { ...f.rotation, plan }, trust: f.rotationTrust, verifiedAt: activeAt }), /anchor_binding/);
});

test('old witness quorum is mandatory for normal recovery rotation', () => {
  const f = fixture();
  assert.throws(() => finalizeEpochRotationV33_33({
    rotationAuthority: f.rotationAuthority, currentPolicy: f.currentPolicy, currentAnchor: f.currentAnchor, plan: f.plan,
    oldWitnessVotes: f.oldWitnessVotes.slice(0, 2), activationProofs: f.activationProofs, trust: f.rotationTrust, issuedAt: activeAt,
  }), /quorum_not_met/);
});

test('duplicate old witness votes do not satisfy quorum', () => {
  const f = fixture();
  assert.throws(() => finalizeEpochRotationV33_33({
    rotationAuthority: f.rotationAuthority, currentPolicy: f.currentPolicy, currentAnchor: f.currentAnchor, plan: f.plan,
    oldWitnessVotes: [f.oldWitnessVotes[0]!, f.oldWitnessVotes[0]!, f.oldWitnessVotes[1]!], activationProofs: f.activationProofs, trust: f.rotationTrust, issuedAt: activeAt,
  }), /topology_duplicate/);
});

test('all next-epoch witnesses must prove private-key possession', () => {
  const f = fixture();
  assert.throws(() => finalizeEpochRotationV33_33({
    rotationAuthority: f.rotationAuthority, currentPolicy: f.currentPolicy, currentAnchor: f.currentAnchor, plan: f.plan,
    oldWitnessVotes: f.oldWitnessVotes, activationProofs: f.activationProofs.slice(0, 4), trust: f.rotationTrust, issuedAt: activeAt,
  }), /activation_incomplete/);
});

test('activation proof cannot be relabeled to another enrolled witness', () => {
  const f = fixture();
  const payload = { ...f.activationProofs[0]!.payload, witnessId: f.activationProofs[1]!.payload.witnessId };
  const proof = resign(payload, 'proofDigest', f.nextWitnesses[0]!);
  assert.throws(() => finalizeEpochRotationV33_33({
    rotationAuthority: f.rotationAuthority, currentPolicy: f.currentPolicy, currentAnchor: f.currentAnchor, plan: f.plan,
    oldWitnessVotes: f.oldWitnessVotes, activationProofs: [proof, ...f.activationProofs.slice(1)], trust: f.rotationTrust, issuedAt: activeAt,
  }), /activation_enrollment/);
});

test('next witness fingerprint must match the trusted registry', () => {
  const f = fixture();
  const witnesses = f.plan.payload.witnesses.map((row, index) => index === 0 ? { ...row, keyFingerprint: sha256({ forged: true }) } : row);
  const payload = { ...f.plan.payload, witnesses };
  const plan = resign(payload, 'planDigest', f.planSigner) as SignedEnvelope<WitnessEpochRotationPlanV33_33>;
  assert.throws(() => verifyEpochRotationV33_33({ bundle: { ...f.rotation, plan }, trust: f.rotationTrust, verifiedAt: activeAt }), /trust_binding/);
});

test('importer coordinator authority and witnesses must remain topologically separate', () => {
  const f = fixture();
  assert.throws(() => createWitnessEpochRotationPlanV33_33({
    planSigner: f.planSigner, currentPolicy: f.currentPolicy, currentAnchor: f.currentAnchor, nextWitnesses: f.nextWitnessRows, nextQuorum: 3,
    importer: { ...f.nextImporterDescriptor, organizationId: f.nextWitnessRows[0]!.organizationId }, coordinator: f.nextCoordinatorDescriptor,
    rotationAuthority: f.rotationAuthorityDescriptor, activationChallengeDigest, issuedAt, expiresAt,
  }), /topology_overlap/);
});

test('expired rotation plan is rejected', () => {
  const f = fixture();
  const plan = createWitnessEpochRotationPlanV33_33({
    planSigner: f.planSigner, currentPolicy: f.currentPolicy, currentAnchor: f.currentAnchor, nextWitnesses: f.nextWitnessRows, nextQuorum: 3,
    importer: f.nextImporterDescriptor, coordinator: f.nextCoordinatorDescriptor, rotationAuthority: f.rotationAuthorityDescriptor,
    activationChallengeDigest, issuedAt, expiresAt: new Date('2026-07-22T11:00:00.000Z'),
  });
  const oldWitnessVotes = f.oldWitnesses.slice(0, 3).map((witness) => createEpochRotationVoteV33_33({ witness, currentPolicy: f.currentPolicy, plan, observedAt: new Date('2026-07-22T10:05:00.000Z') }));
  const activationProofs = f.nextWitnesses.map((witness) => createWitnessActivationProofV33_33({ witness, plan, activatedAt: new Date('2026-07-22T10:06:00.000Z') }));
  const rotation = finalizeEpochRotationV33_33({ rotationAuthority: f.rotationAuthority, currentPolicy: f.currentPolicy, currentAnchor: f.currentAnchor, plan, oldWitnessVotes, activationProofs, trust: f.rotationTrust, issuedAt: new Date('2026-07-22T10:10:00.000Z') });
  assert.throws(() => verifyEpochRotationV33_33({ bundle: rotation, trust: f.rotationTrust, verifiedAt: activeAt }), /not_active/);
});

test('tampered rotation certificate signature is rejected', () => {
  const f = fixture();
  const certificate = { ...f.rotation.certificate, payload: { ...f.rotation.certificate.payload, sequenceFloor: 7 } };
  assert.throws(() => verifyEpochRotationV33_33({ bundle: { ...f.rotation, certificate }, trust: f.rotationTrust, verifiedAt: activeAt }), /certificate_signature/);
});

test('resigned rotation certificate cannot omit activation evidence', () => {
  const f = fixture();
  const payload = { ...f.rotation.certificate.payload, activationProofDigests: f.rotation.certificate.payload.activationProofDigests.slice(1) };
  const certificate = resign(payload, 'certificateDigest', f.rotationAuthority);
  assert.throws(() => verifyEpochRotationV33_33({ bundle: { ...f.rotation, certificate }, trust: f.rotationTrust, verifiedAt: activeAt }), /evidence_binding/);
});

test('valid coordinator lease is quorum-backed and begins after the sequence floor', () => {
  const f = fixture();
  const lease = verifyCoordinatorLeaseV33_33({ bundle: f.lease, trust: f.leaseTrust, verifiedAt: leaseActiveAt });
  assert.equal(lease.sequenceStart, f.plan.payload.sequenceFloor + 1);
  assert.equal(lease.quorumRequired, 3);
});

test('first lease must use term one and no predecessor', () => {
  const f = fixture();
  assert.throws(() => createCoordinatorLeaseProposalV33_33({
    coordinator: f.nextCoordinator, plan: f.plan, term: 2, previousLease: null, sequenceWindow: 10,
    notBefore: new Date('2026-07-22T12:00:00.000Z'), expiresAt: new Date('2026-07-22T13:00:00.000Z'), proposedAt: new Date('2026-07-22T11:50:00.000Z'),
  }), /predecessor/);
});

test('lease sequence allocation is bounded', () => {
  const f = fixture();
  assert.throws(() => createCoordinatorLeaseProposalV33_33({
    coordinator: f.nextCoordinator, plan: f.plan, term: 1, previousLease: null, sequenceWindow: 10_001,
    notBefore: new Date('2026-07-22T12:00:00.000Z'), expiresAt: new Date('2026-07-22T13:00:00.000Z'), proposedAt: new Date('2026-07-22T11:50:00.000Z'),
  }), /sequence_window/);
});

test('lease requires next-epoch witness quorum', () => {
  const f = fixture();
  assert.throws(() => finalizeCoordinatorLeaseV33_33({ rotationAuthority: f.rotationAuthority, plan: f.plan, previousLease: null, proposal: f.leaseProposal, votes: f.leaseVotes.slice(0, 2), trust: f.leaseTrust, issuedAt: activeAt }), /quorum_not_met/);
});

test('duplicate lease witness votes are rejected', () => {
  const f = fixture();
  assert.throws(() => finalizeCoordinatorLeaseV33_33({ rotationAuthority: f.rotationAuthority, plan: f.plan, previousLease: null, proposal: f.leaseProposal, votes: [f.leaseVotes[0]!, f.leaseVotes[0]!, f.leaseVotes[1]!], trust: f.leaseTrust, issuedAt: activeAt }), /topology_duplicate/);
});

test('tampered lease certificate is rejected', () => {
  const f = fixture();
  const certificate = { ...f.lease.certificate, payload: { ...f.lease.certificate.payload, sequenceEnd: 999 } };
  assert.throws(() => verifyCoordinatorLeaseV33_33({ bundle: { ...f.lease, certificate }, trust: f.leaseTrust, verifiedAt: leaseActiveAt }), /certificate_signature/);
});

test('lease cannot be used before not-before or after expiry', () => {
  const f = fixture();
  assert.throws(() => verifyCoordinatorLeaseV33_33({ bundle: f.lease, trust: f.leaseTrust, verifiedAt: new Date('2026-07-22T11:59:00.000Z') }), /not_active/);
  assert.throws(() => verifyCoordinatorLeaseV33_33({ bundle: f.lease, trust: f.leaseTrust, verifiedAt: new Date('2026-07-22T14:01:00.000Z') }), /not_active/);
});

test('successor lease must include and exactly continue the signed predecessor lease', () => {
  const f = fixture();
  const proposal = createCoordinatorLeaseProposalV33_33({
    coordinator: f.nextCoordinator, plan: f.plan, term: 2, previousLease: f.lease.certificate, sequenceWindow: 50,
    notBefore: new Date('2026-07-22T14:00:00.000Z'), expiresAt: new Date('2026-07-22T16:00:00.000Z'), proposedAt: new Date('2026-07-22T13:55:00.000Z'),
  });
  const votes = f.nextWitnesses.slice(0, 3).map((witness) => createCoordinatorLeaseVoteV33_33({ witness, plan: f.plan, proposal, observedAt: new Date('2026-07-22T13:57:00.000Z') }));
  const bundle = finalizeCoordinatorLeaseV33_33({ rotationAuthority: f.rotationAuthority, plan: f.plan, previousLease: f.lease.certificate, proposal, votes, trust: f.leaseTrust, issuedAt: new Date('2026-07-22T13:58:00.000Z') });
  const verified = verifyCoordinatorLeaseV33_33({ bundle, trust: f.leaseTrust, verifiedAt: new Date('2026-07-22T14:10:00.000Z') });
  assert.equal(verified.term, 2);
  assert.equal(verified.previousLeaseDigest, f.lease.certificate.payload.leaseDigest);
  assert.equal(verified.sequenceStart, f.lease.certificate.payload.sequenceEnd + 1);
});

test('successor lease rejects an omitted or substituted predecessor certificate', () => {
  const f = fixture();
  const proposal = createCoordinatorLeaseProposalV33_33({
    coordinator: f.nextCoordinator, plan: f.plan, term: 2, previousLease: f.lease.certificate, sequenceWindow: 50,
    notBefore: new Date('2026-07-22T14:00:00.000Z'), expiresAt: new Date('2026-07-22T16:00:00.000Z'), proposedAt: new Date('2026-07-22T13:55:00.000Z'),
  });
  const votes = f.nextWitnesses.slice(0, 3).map((witness) => createCoordinatorLeaseVoteV33_33({ witness, plan: f.plan, proposal, observedAt: new Date('2026-07-22T13:57:00.000Z') }));
  assert.throws(() => finalizeCoordinatorLeaseV33_33({ rotationAuthority: f.rotationAuthority, plan: f.plan, previousLease: null, proposal, votes, trust: f.leaseTrust, issuedAt: new Date('2026-07-22T13:58:00.000Z') }), /predecessor_bundle/);
  const payload = { ...f.lease.certificate.payload, sequenceEnd: 80 };
  const forgedPrevious = resign(payload, 'leaseDigest', f.rotationAuthority) as SignedEnvelope<CoordinatorLeaseCertificateV33_33>;
  assert.throws(() => finalizeCoordinatorLeaseV33_33({ rotationAuthority: f.rotationAuthority, plan: f.plan, previousLease: forgedPrevious, proposal, votes, trust: f.leaseTrust, issuedAt: new Date('2026-07-22T13:58:00.000Z') }), /predecessor_binding/);
});

test('split-brain detector finds two leases for the same epoch and term', () => {
  const f = fixture();
  const rogue = generateSigningIdentity('rogue-coordinator');
  const payload = { ...f.lease.certificate.payload, coordinatorKeyId: rogue.keyId, leaseId: 'rogue-lease' };
  const certificate = resign(payload, 'leaseDigest', f.rotationAuthority) as SignedEnvelope<CoordinatorLeaseCertificateV33_33>;
  const findings = detectCoordinatorSplitBrainV33_33([f.lease.certificate, certificate]);
  assert.equal(findings.length, 1);
});

test('split-brain detector finds overlapping sequence ownership by different coordinators', () => {
  const f = fixture();
  const payload = { ...f.lease.certificate.payload, term: 2, previousLeaseDigest: f.lease.certificate.payload.leaseDigest, coordinatorKeyId: 'other-coordinator', sequenceStart: 50, sequenceEnd: 150, leaseId: 'overlap' };
  const certificate = resign(payload, 'leaseDigest', f.rotationAuthority) as SignedEnvelope<CoordinatorLeaseCertificateV33_33>;
  assert.equal(detectCoordinatorSplitBrainV33_33([f.lease.certificate, certificate]).length, 1);
});

test('sequential non-overlapping leases do not create a split-brain finding', () => {
  const f = fixture();
  const payload = { ...f.lease.certificate.payload, term: 2, previousLeaseDigest: f.lease.certificate.payload.leaseDigest, sequenceStart: 101, sequenceEnd: 200, leaseId: 'next' };
  const certificate = resign(payload, 'leaseDigest', f.rotationAuthority) as SignedEnvelope<CoordinatorLeaseCertificateV33_33>;
  assert.equal(detectCoordinatorSplitBrainV33_33([f.lease.certificate, certificate]).length, 0);
});

test('transparency log and external monitor pin verify', () => {
  const f = fixture();
  const pin = verifyTransparencyPinV33_33({ bundle: f.transparency, trust: f.transparencyTrust, verifiedAt: leaseActiveAt });
  assert.equal(pin.logSize, 4);
  assert.equal(pin.quorumRequired, 2);
});

test('tampering any transparency entry breaks the chain or signature', () => {
  const f = fixture();
  const entry = { ...f.entries[1]!, payload: { ...f.entries[1]!.payload, objectDigest: sha256({ forged: true }) } };
  assert.throws(() => verifyTransparencyPinV33_33({ bundle: { ...f.transparency, entries: [f.entries[0]!, entry, ...f.entries.slice(2)] }, trust: f.transparencyTrust, verifiedAt: leaseActiveAt }), /entry_signature|chain/);
});

test('a pin cannot silently roll the log back', () => {
  const f = fixture();
  assert.throws(() => verifyTransparencyPinV33_33({ bundle: { ...f.transparency, entries: f.entries.slice(0, 3) }, trust: f.transparencyTrust, verifiedAt: leaseActiveAt }), /pin_vote_binding|evidence_binding/);
});

test('successor transparency pin binds the previous externally pinned head', () => {
  const f = fixture();
  const entry4 = createTransparencyLogEntryV33_33({ operator: f.logOperator, operatorDescriptor: f.logOperatorDescriptor, logId: 'continuity-log', previousEntry: f.entries[3]!, eventType: 'CHECKPOINT_ANCHOR', objectDigest: sha256({ anchor: 'epoch-2-sequence-2' }), epoch: 2, sequence: 2, recordedAt: new Date('2026-07-22T12:20:00.000Z') });
  const entries = [...f.entries, entry4];
  const votes = f.monitors.slice(0, 2).map((monitor, index) => createTransparencyPinVoteV33_33({ monitor, monitorDescriptor: f.monitorRows[index]!, entries, observedAt: new Date('2026-07-22T12:21:00.000Z') }));
  const bundle = finalizeTransparencyPinV33_33({ pinAuthority: f.pinAuthority, previousPin: f.transparency.certificate, entries, monitorVotes: votes, trust: f.transparencyTrust, issuedAt: new Date('2026-07-22T12:22:00.000Z') });
  const pin = verifyTransparencyPinV33_33({ bundle, trust: f.transparencyTrust, verifiedAt: new Date('2026-07-22T12:23:00.000Z') });
  assert.equal(pin.previousPinDigest, f.transparency.certificate.payload.pinDigest);
  assert.equal(pin.logSize, 5);
});

test('successor transparency pin rejects a substituted predecessor head', () => {
  const f = fixture();
  const entry4 = createTransparencyLogEntryV33_33({ operator: f.logOperator, operatorDescriptor: f.logOperatorDescriptor, logId: 'continuity-log', previousEntry: f.entries[3]!, eventType: 'CHECKPOINT_ANCHOR', objectDigest: sha256({ anchor: 'epoch-2-sequence-2' }), epoch: 2, sequence: 2, recordedAt: new Date('2026-07-22T12:20:00.000Z') });
  const entries = [...f.entries, entry4];
  const votes = f.monitors.slice(0, 2).map((monitor, index) => createTransparencyPinVoteV33_33({ monitor, monitorDescriptor: f.monitorRows[index]!, entries, observedAt: new Date('2026-07-22T12:21:00.000Z') }));
  const payload = { ...f.transparency.certificate.payload, headEntryDigest: sha256({ substituted: true }) };
  const prior = resign(payload, 'pinDigest', f.pinAuthority) as SignedEnvelope<TransparencyPinCertificateV33_33>;
  assert.throws(() => finalizeTransparencyPinV33_33({ pinAuthority: f.pinAuthority, previousPin: prior, entries, monitorVotes: votes, trust: f.transparencyTrust, issuedAt: new Date('2026-07-22T12:22:00.000Z') }), /previous_pin_continuity/);
});

test('monitor quorum is mandatory', () => {
  const f = fixture();
  assert.throws(() => finalizeTransparencyPinV33_33({ pinAuthority: f.pinAuthority, previousPin: null, entries: f.entries, monitorVotes: f.monitorVotes.slice(0, 1), trust: f.transparencyTrust, issuedAt: new Date('2026-07-22T12:02:00.000Z') }), /quorum_not_met/);
});

test('duplicate monitor votes cannot satisfy pin quorum', () => {
  const f = fixture();
  assert.throws(() => finalizeTransparencyPinV33_33({ pinAuthority: f.pinAuthority, previousPin: null, entries: f.entries, monitorVotes: [f.monitorVotes[0]!, f.monitorVotes[0]!], trust: f.transparencyTrust, issuedAt: new Date('2026-07-22T12:02:00.000Z') }), /topology_duplicate/);
});

test('transparency authorities and monitors must be outside platform owner topology', () => {
  const f = fixture();
  const trust: TransparencyTrustV33_33 = { ...f.transparencyTrust, platformOwnerOrganizationId: f.transparencyTrust.logOperator.organizationId };
  assert.throws(() => verifyTransparencyPinV33_33({ bundle: f.transparency, trust, verifiedAt: leaseActiveAt }), /authority_overlap/);
});

test('split-view detector finds same-size logs with different heads', () => {
  const f = fixture();
  const payload = { ...f.transparency.certificate.payload, headEntryDigest: sha256({ split: true }), pinId: 'split-pin' };
  const certificate = resign(payload, 'pinDigest', f.pinAuthority) as SignedEnvelope<TransparencyPinCertificateV33_33>;
  assert.equal(detectTransparencySplitViewV33_33([f.transparency.certificate, certificate]).length, 1);
});

test('continuity verdict binds rotation lease and transparency evidence but remains local-only', () => {
  const f = fixture();
  const verdict = finalizeContinuityQualificationV33_33({ verifier: f.verifier, rotation: f.rotation, rotationTrust: f.rotationTrust, lease: f.lease, leaseTrust: f.leaseTrust, transparency: f.transparency, transparencyTrust: f.transparencyTrust, generatedAt: leaseActiveAt });
  assert.equal(verdict.payload.externalTopologyObserved, false);
  assert.equal(verdict.payload.status, 'LOCAL_PROTOCOL_PROOF_ONLY_EXTERNAL_DEPLOYMENT_REQUIRED');
  assert.equal(verdict.payload.productionAuthority, 'NONE');
  assert.equal(verdict.payload.externalEffectsExecuted, 0);
});

test('continuity verdict rejects a log that omits the lease digest', () => {
  const f = fixture();
  const entry3 = createTransparencyLogEntryV33_33({ operator: f.logOperator, operatorDescriptor: f.logOperatorDescriptor, logId: 'continuity-log', previousEntry: f.entries[2]!, eventType: 'COORDINATOR_LEASE', objectDigest: sha256({ otherLease: true }), epoch: 2, sequence: 1, recordedAt: new Date('2026-07-22T11:59:00.000Z') });
  const entries = [...f.entries.slice(0, 3), entry3];
  const votes = f.monitors.slice(0, 2).map((monitor, index) => createTransparencyPinVoteV33_33({ monitor, monitorDescriptor: f.monitorRows[index]!, entries, observedAt: new Date('2026-07-22T12:01:00.000Z') }));
  const transparency = finalizeTransparencyPinV33_33({ pinAuthority: f.pinAuthority, previousPin: null, entries, monitorVotes: votes, trust: f.transparencyTrust, issuedAt: new Date('2026-07-22T12:02:00.000Z') });
  assert.throws(() => finalizeContinuityQualificationV33_33({ verifier: f.verifier, rotation: f.rotation, rotationTrust: f.rotationTrust, lease: f.lease, leaseTrust: f.leaseTrust, transparency, transparencyTrust: f.transparencyTrust, generatedAt: leaseActiveAt }), /log_binding/);
});

test('all v33.33 artifacts preserve zero production authority and zero external effects', () => {
  const f = fixture();
  const artifacts = [f.plan.payload, ...f.oldWitnessVotes.map((row) => row.payload), ...f.activationProofs.map((row) => row.payload), f.rotation.certificate.payload, f.leaseProposal.payload, ...f.leaseVotes.map((row) => row.payload), f.lease.certificate.payload, ...f.entries.map((row) => row.payload), ...f.monitorVotes.map((row) => row.payload), f.transparency.certificate.payload];
  assert.ok(artifacts.every((row) => row.productionAuthority === 'NONE' && row.externalEffectsExecuted === 0));
});
