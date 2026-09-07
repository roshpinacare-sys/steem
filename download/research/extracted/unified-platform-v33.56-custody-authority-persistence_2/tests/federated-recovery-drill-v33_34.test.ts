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
  finalizeCoordinatorLeaseV33_33,
  finalizeEpochRotationV33_33,
  finalizeTransparencyPinV33_33,
  type ContinuityActorDescriptorV33_33,
} from '../src/app/federated-checkpoint-continuity-v33_33.js';
import {
  createCoordinatorAcceptanceV33_34,
  createCoordinatorHandoffVoteV33_34,
  createCoordinatorRelinquishmentV33_34,
  createRecoveryEpochPlanV33_34,
  createRecoveryPublicationReceiptV33_34,
  createRecoveryPublicationRequestV33_34,
  createRecoveryWitnessActivationV33_34,
  createRecoveryWitnessVoteV33_34,
  detectCoordinatorHandoffConflictsV33_34,
  finalizeCoordinatorHandoffV33_34,
  finalizeRecoveryDrillV33_34,
  finalizeRecoveryEpochV33_34,
  verifyCoordinatorHandoffV33_34,
  verifyRecoveryEpochV33_34,
  verifyRecoveryPublicationV33_34,
  type RecoveryPublicationBundleV33_34,
  type RecoveryWitnessDescriptorV33_34,
} from '../src/app/federated-recovery-drill-v33_34.js';

const protocolDigest = sha256({ protocol: 'v33.34-test' });
const activationDigest = (name: string) => sha256({ activation: name });
const at = (value: string) => new Date(value);

function registry(...identities: readonly SigningIdentity[]): KeyRegistry {
  const result = new KeyRegistry();
  for (const identity of identities) result.register(identity.keyId, identity.publicKey);
  return result;
}

function actor(identity: SigningIdentity, organizationId: string, hostId: string): ContinuityActorDescriptorV33_33 {
  const keys = registry(identity);
  return { keyId: identity.keyId, keyFingerprint: keys.fingerprint(identity.keyId)!, organizationId, hostId };
}

function witness(identity: SigningIdentity, index: number, prefix: string): RecoveryWitnessDescriptorV33_34 {
  return { witnessId: `${prefix}-witness-${index}`, ...actor(identity, `${prefix}-org-${index}`, `${prefix}-host-${index}`) };
}

function checkpoint(signer: SigningIdentity): SignedEnvelope<ExternalHumanPilotImportCheckpointV33_31> {
  const material = {
    version: '33.31' as const,
    checkpointId: 'checkpoint-v33-34',
    sequence: 0,
    previousCheckpointDigest: null,
    consumedChallengeDigests: [],
    consumedPackageDigests: [],
    generatedAt: '2026-07-22T09:05:00.000Z',
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, checkpointDigest: sha256(material) }, signer);
}

function resign<T extends object>(envelope: SignedEnvelope<T>, signer: SigningIdentity, digestField: keyof T, patch: Partial<T>): SignedEnvelope<T> {
  const material = { ...envelope.payload, ...patch } as T & Record<PropertyKey, unknown>;
  delete material[digestField];
  return signEnvelope({ ...material, [digestField]: sha256(material) } as T, signer);
}

function fixture() {
  const policySigner = generateSigningIdentity('v3334-policy');
  const oldImporter = generateSigningIdentity('v3334-old-importer');
  const oldCoordinator = generateSigningIdentity('v3334-old-coordinator');
  const oldWitnesses = Array.from({ length: 5 }, (_, index) => generateSigningIdentity(`v3334-old-witness-${index + 1}`));
  const oldRows = oldWitnesses.map((identity, index) => ({ witnessId: `old-witness-${index + 1}`, ...actor(identity, `old-org-${index + 1}`, `old-host-${index + 1}`) })) as FederatedCheckpointWitnessDescriptorV33_32[];
  const policy = createFederatedCheckpointWitnessPolicyV33_32({
    policySigner,
    studyId: 'study-v33-34',
    protocolDigest,
    epoch: 1,
    quorum: 3,
    witnesses: oldRows,
    importer: { keyId: oldImporter.keyId, organizationId: 'old-importer-org', hostId: 'old-importer-host' },
    coordinator: { keyId: oldCoordinator.keyId, organizationId: 'old-coordinator-org', hostId: 'old-coordinator-host' },
    issuedAt: at('2026-07-22T09:00:00.000Z'),
    expiresAt: at('2026-07-25T09:00:00.000Z'),
  });
  const anchor = createFederatedCheckpointGenesisAnchorV33_32({ anchorSigner: policySigner, policy, initialCheckpoint: checkpoint(oldImporter), generatedAt: at('2026-07-22T09:10:00.000Z') });

  const planSigner33 = generateSigningIdentity('v3334-plan-33');
  const recoveryAuthority = generateSigningIdentity('v3334-recovery-authority');
  const nextImporter = generateSigningIdentity('v3334-next-importer');
  const activeCoordinator = generateSigningIdentity('v3334-active-coordinator');
  const epoch2New = [generateSigningIdentity('v3334-epoch2-w4'), generateSigningIdentity('v3334-epoch2-w5')];
  const epoch2Witnesses = [...oldWitnesses.slice(0, 3), ...epoch2New];
  const epoch2Rows = epoch2Witnesses.map((identity, index) => witness(identity, index + 1, 'epoch2'));
  const rotationPlan = createWitnessEpochRotationPlanV33_33({
    planSigner: planSigner33,
    currentPolicy: policy,
    currentAnchor: anchor,
    nextWitnesses: epoch2Rows,
    nextQuorum: 3,
    importer: actor(nextImporter, 'next-importer-org', 'next-importer-host'),
    coordinator: actor(activeCoordinator, 'active-coordinator-org', 'active-coordinator-host'),
    rotationAuthority: actor(recoveryAuthority, 'recovery-authority-org', 'recovery-authority-host'),
    activationChallengeDigest: activationDigest('epoch2'),
    issuedAt: at('2026-07-22T10:00:00.000Z'),
    expiresAt: at('2026-07-24T10:00:00.000Z'),
  });
  const rotationTrust = {
    currentPolicyRegistry: registry(policySigner), trustedCurrentPolicySignerIds: [policySigner.keyId],
    currentAnchorRegistry: registry(policySigner, oldCoordinator), trustedCurrentAnchorSignerIds: [policySigner.keyId, oldCoordinator.keyId],
    currentWitnessRegistry: registry(...oldWitnesses), trustedCurrentWitnessIds: oldWitnesses.map((row) => row.keyId),
    nextWitnessRegistry: registry(...epoch2Witnesses), trustedNextWitnessIds: epoch2Witnesses.map((row) => row.keyId),
    planRegistry: registry(planSigner33), trustedPlanSignerIds: [planSigner33.keyId],
    rotationAuthorityRegistry: registry(recoveryAuthority), trustedRotationAuthorityIds: [recoveryAuthority.keyId],
  };
  const rotationVotes = oldWitnesses.slice(0, 3).map((identity) => createEpochRotationVoteV33_33({ witness: identity, currentPolicy: policy, plan: rotationPlan, observedAt: at('2026-07-22T10:05:00.000Z') }));
  const rotationActivations = epoch2Witnesses.map((identity) => createWitnessActivationProofV33_33({ witness: identity, plan: rotationPlan, activatedAt: at('2026-07-22T10:06:00.000Z') }));
  const rotation = finalizeEpochRotationV33_33({ rotationAuthority: recoveryAuthority, currentPolicy: policy, currentAnchor: anchor, plan: rotationPlan, oldWitnessVotes: rotationVotes, activationProofs: rotationActivations, trust: rotationTrust, issuedAt: at('2026-07-22T10:10:00.000Z') });

  const leaseTrust33 = {
    planRegistry: registry(planSigner33), trustedPlanSignerIds: [planSigner33.keyId],
    coordinatorRegistry: registry(activeCoordinator), trustedCoordinatorIds: [activeCoordinator.keyId],
    witnessRegistry: registry(...epoch2Witnesses), trustedWitnessIds: epoch2Witnesses.map((row) => row.keyId),
    rotationAuthorityRegistry: registry(recoveryAuthority), trustedRotationAuthorityIds: [recoveryAuthority.keyId],
  };
  const leaseProposal = createCoordinatorLeaseProposalV33_33({ coordinator: activeCoordinator, plan: rotationPlan, term: 1, previousLease: null, sequenceWindow: 100, notBefore: at('2026-07-22T11:00:00.000Z'), expiresAt: at('2026-07-23T11:00:00.000Z'), proposedAt: at('2026-07-22T10:55:00.000Z') });
  const leaseVotes = epoch2Witnesses.slice(0, 3).map((identity) => createCoordinatorLeaseVoteV33_33({ witness: identity, plan: rotationPlan, proposal: leaseProposal, observedAt: at('2026-07-22T10:57:00.000Z') }));
  const lease = finalizeCoordinatorLeaseV33_33({ rotationAuthority: recoveryAuthority, plan: rotationPlan, previousLease: null, proposal: leaseProposal, votes: leaseVotes, trust: leaseTrust33, issuedAt: at('2026-07-22T10:58:00.000Z') });

  const logOperator = generateSigningIdentity('v3334-log-operator');
  const monitors = [generateSigningIdentity('v3334-monitor-1'), generateSigningIdentity('v3334-monitor-2'), generateSigningIdentity('v3334-monitor-3')];
  const pinAuthority = generateSigningIdentity('v3334-pin-authority');
  const logOperatorDescriptor = actor(logOperator, 'log-operator-org', 'log-operator-host');
  const monitorRows = monitors.map((identity, index) => ({ monitorId: `monitor-${index + 1}`, ...actor(identity, `monitor-org-${index + 1}`, `monitor-host-${index + 1}`) }));
  const pinAuthorityDescriptor = actor(pinAuthority, 'pin-authority-org', 'pin-authority-host');
  const transparencyTrust = {
    logOperatorRegistry: registry(logOperator), trustedLogOperatorIds: [logOperator.keyId], logOperator: logOperatorDescriptor,
    monitorRegistry: registry(...monitors), trustedMonitorIds: monitors.map((row) => row.keyId), monitors: monitorRows, monitorQuorum: 2,
    pinAuthorityRegistry: registry(pinAuthority), trustedPinAuthorityIds: [pinAuthority.keyId], pinAuthority: pinAuthorityDescriptor,
    platformOwnerOrganizationId: 'platform-owner-org',
  };
  const entries = [
    createTransparencyLogEntryV33_33({ operator: logOperator, operatorDescriptor: logOperatorDescriptor, logId: 'v3334-log', previousEntry: null, eventType: 'EPOCH_ROTATION_CERTIFICATE', objectDigest: rotation.certificate.payload.certificateDigest, epoch: 2, sequence: 0, recordedAt: at('2026-07-22T10:20:00.000Z') }),
  ];
  entries.push(createTransparencyLogEntryV33_33({ operator: logOperator, operatorDescriptor: logOperatorDescriptor, logId: 'v3334-log', previousEntry: entries[0]!, eventType: 'COORDINATOR_LEASE', objectDigest: lease.certificate.payload.leaseDigest, epoch: 2, sequence: 1, recordedAt: at('2026-07-22T10:21:00.000Z') }));
  const pinVotes = monitors.slice(0, 2).map((identity, index) => createTransparencyPinVoteV33_33({ monitor: identity, monitorDescriptor: monitorRows[index]!, entries, observedAt: at('2026-07-22T10:25:00.000Z') }));
  const pin = finalizeTransparencyPinV33_33({ pinAuthority, previousPin: null, entries, monitorVotes: pinVotes, trust: transparencyTrust, issuedAt: at('2026-07-22T10:26:00.000Z') });

  const planSigner34a = generateSigningIdentity('v3334-plan-a');
  const epoch3New = [generateSigningIdentity('v3334-epoch3-w4'), generateSigningIdentity('v3334-epoch3-w5')];
  const epoch3Witnesses = [...epoch2Witnesses.slice(0, 3), ...epoch3New];
  const epoch3Rows = epoch3Witnesses.map((identity, index) => witness(identity, index + 1, 'epoch3'));
  const firstPlan = createRecoveryEpochPlanV33_34({
    planSigner: planSigner34a, drillId: 'drill-v33-34', transitionOrdinal: 1, studyId: 'study-v33-34', protocolDigest,
    fromEpoch: 2, sequenceFloor: 0, predecessorCertificate: rotation.certificate, predecessorLeaseDigest: lease.certificate.payload.leaseDigest,
    predecessorPinDigest: pin.certificate.payload.pinDigest, currentWitnesses: epoch2Rows, nextWitnesses: epoch3Rows,
    unavailableWitnessKeyIds: epoch2Witnesses.slice(3).map((row) => row.keyId), quorum: 3,
    recoveryAuthority: actor(recoveryAuthority, 'recovery-authority-org', 'recovery-authority-host'), activationChallengeDigest: activationDigest('epoch3'),
    issuedAt: at('2026-07-22T12:00:00.000Z'), expiresAt: at('2026-07-24T12:00:00.000Z'),
  });
  const firstTrust = {
    predecessorRegistry: registry(recoveryAuthority), trustedPredecessorSignerIds: [recoveryAuthority.keyId],
    planRegistry: registry(planSigner34a), trustedPlanSignerIds: [planSigner34a.keyId],
    currentWitnessRegistry: registry(...epoch2Witnesses), trustedCurrentWitnessIds: epoch2Witnesses.map((row) => row.keyId),
    nextWitnessRegistry: registry(...epoch3Witnesses), trustedNextWitnessIds: epoch3Witnesses.map((row) => row.keyId),
    recoveryAuthorityRegistry: registry(recoveryAuthority), trustedRecoveryAuthorityIds: [recoveryAuthority.keyId],
  };
  const firstVotes = epoch2Witnesses.slice(0, 3).map((identity) => createRecoveryWitnessVoteV33_34({ witness: identity, plan: firstPlan, observedAt: at('2026-07-22T12:05:00.000Z') }));
  const firstActivations = epoch3Witnesses.map((identity) => createRecoveryWitnessActivationV33_34({ witness: identity, plan: firstPlan, activatedAt: at('2026-07-22T12:06:00.000Z') }));
  const firstRecovery = finalizeRecoveryEpochV33_34({ recoveryAuthority, predecessorCertificate: rotation.certificate, plan: firstPlan, witnessVotes: firstVotes, activations: firstActivations, trust: firstTrust, issuedAt: at('2026-07-22T12:10:00.000Z') });

  const planSigner34b = generateSigningIdentity('v3334-plan-b');
  const epoch4New = [generateSigningIdentity('v3334-epoch4-w5')];
  const epoch4Witnesses = [...epoch3Witnesses.slice(0, 4), ...epoch4New];
  const epoch4Rows = epoch4Witnesses.map((identity, index) => witness(identity, index + 1, 'epoch4'));
  const secondPlan = createRecoveryEpochPlanV33_34({
    planSigner: planSigner34b, drillId: 'drill-v33-34', transitionOrdinal: 2, studyId: 'study-v33-34', protocolDigest,
    fromEpoch: 3, sequenceFloor: 0, predecessorCertificate: firstRecovery.certificate, predecessorLeaseDigest: lease.certificate.payload.leaseDigest,
    predecessorPinDigest: pin.certificate.payload.pinDigest, currentWitnesses: epoch3Rows, nextWitnesses: epoch4Rows,
    unavailableWitnessKeyIds: [epoch3Witnesses[4]!.keyId], quorum: 3,
    recoveryAuthority: actor(recoveryAuthority, 'recovery-authority-org', 'recovery-authority-host'), activationChallengeDigest: activationDigest('epoch4'),
    issuedAt: at('2026-07-22T13:00:00.000Z'), expiresAt: at('2026-07-24T13:00:00.000Z'),
  });
  const secondTrust = {
    predecessorRegistry: registry(recoveryAuthority), trustedPredecessorSignerIds: [recoveryAuthority.keyId],
    planRegistry: registry(planSigner34b), trustedPlanSignerIds: [planSigner34b.keyId],
    currentWitnessRegistry: registry(...epoch3Witnesses), trustedCurrentWitnessIds: epoch3Witnesses.map((row) => row.keyId),
    nextWitnessRegistry: registry(...epoch4Witnesses), trustedNextWitnessIds: epoch4Witnesses.map((row) => row.keyId),
    recoveryAuthorityRegistry: registry(recoveryAuthority), trustedRecoveryAuthorityIds: [recoveryAuthority.keyId],
  };
  const secondVotes = epoch3Witnesses.slice(0, 3).map((identity) => createRecoveryWitnessVoteV33_34({ witness: identity, plan: secondPlan, observedAt: at('2026-07-22T13:05:00.000Z') }));
  const secondActivations = epoch4Witnesses.map((identity) => createRecoveryWitnessActivationV33_34({ witness: identity, plan: secondPlan, activatedAt: at('2026-07-22T13:06:00.000Z') }));
  const secondRecovery = finalizeRecoveryEpochV33_34({ recoveryAuthority, predecessorCertificate: firstRecovery.certificate, plan: secondPlan, witnessVotes: secondVotes, activations: secondActivations, trust: secondTrust, issuedAt: at('2026-07-22T13:10:00.000Z') });

  const replacementCoordinator = generateSigningIdentity('v3334-replacement-coordinator');
  const replacementDescriptor = actor(replacementCoordinator, 'replacement-coordinator-org', 'replacement-coordinator-host');
  const relinquishment = createCoordinatorRelinquishmentV33_34({ outgoingCoordinator: activeCoordinator, outgoingCoordinatorDescriptor: actor(activeCoordinator, 'active-coordinator-org', 'active-coordinator-host'), replacementCoordinator: replacementDescriptor, predecessorLease: lease.certificate, cutoverSequence: 50, relinquishedAt: at('2026-07-22T12:20:00.000Z') });
  const acceptance = createCoordinatorAcceptanceV33_34({ replacementCoordinator, predecessorLease: lease.certificate, relinquishment, acceptedAt: at('2026-07-22T12:21:00.000Z') });
  const handoffVotes = epoch2Witnesses.slice(0, 3).map((identity, index) => createCoordinatorHandoffVoteV33_34({ witness: identity, witnessDescriptor: epoch2Rows[index]!, predecessorLease: lease.certificate, relinquishment, acceptance, observedAt: at('2026-07-22T12:22:00.000Z') }));
  const handoffTrust = {
    predecessorLeaseRegistry: registry(recoveryAuthority), trustedPredecessorLeaseSignerIds: [recoveryAuthority.keyId],
    outgoingCoordinatorRegistry: registry(activeCoordinator), trustedOutgoingCoordinatorIds: [activeCoordinator.keyId],
    replacementCoordinatorRegistry: registry(replacementCoordinator), trustedReplacementCoordinatorIds: [replacementCoordinator.keyId],
    witnessRegistry: registry(...epoch2Witnesses), trustedWitnessIds: epoch2Witnesses.map((row) => row.keyId), witnesses: epoch2Rows, quorum: 3,
    recoveryAuthorityRegistry: registry(recoveryAuthority), trustedRecoveryAuthorityIds: [recoveryAuthority.keyId],
  };
  const handoff = finalizeCoordinatorHandoffV33_34({ recoveryAuthority, predecessorLease: lease.certificate, relinquishment, acceptance, witnessVotes: handoffVotes, trust: handoffTrust, issuedAt: at('2026-07-22T12:25:00.000Z') });

  const requestSigner = generateSigningIdentity('v3334-publication-request');
  const publisher = generateSigningIdentity('v3334-publisher');
  const publisherDescriptor = actor(publisher, 'independent-publisher-org', 'independent-publisher-host');
  const request = createRecoveryPublicationRequestV33_34({ requestSigner, drillId: 'drill-v33-34', priorPin: pin.certificate, firstRecovery: firstRecovery.certificate, secondRecovery: secondRecovery.certificate, handoff: handoff.certificate, endpointId: 'publisher-endpoint-1', endpointUri: 'https://evidence.example.test/recovery/v33.34.json', publisher: publisherDescriptor, publicationChallengeDigest: activationDigest('publication'), previousReceipt: null, issuedAt: at('2026-07-22T14:00:00.000Z'), expiresAt: at('2026-07-24T14:00:00.000Z') });
  const receipt = createRecoveryPublicationReceiptV33_34({ publisher, request, priorPin: pin.certificate, previousReceipt: null, publishedAt: at('2026-07-22T14:05:00.000Z') });
  const publication: RecoveryPublicationBundleV33_34 = { priorPin: pin.certificate, request, previousReceipt: null, receipt };
  const publicationTrust = {
    priorPinRegistry: registry(pinAuthority), trustedPriorPinSignerIds: [pinAuthority.keyId],
    requestRegistry: registry(requestSigner), trustedRequestSignerIds: [requestSigner.keyId],
    publisherRegistry: registry(publisher), trustedPublisherIds: [publisher.keyId], publisher: publisherDescriptor,
    platformOwnerOrganizationId: 'platform-owner-org',
  };

  return {
    recoveryAuthority, activeCoordinator, replacementCoordinator, replacementDescriptor, epoch2Witnesses, epoch2Rows, epoch3Witnesses, epoch3Rows, epoch4Witnesses,
    rotation, lease, pin, firstPlan, firstTrust, firstVotes, firstActivations, firstRecovery, secondPlan, secondTrust, secondVotes, secondActivations, secondRecovery,
    relinquishment, acceptance, handoffVotes, handoffTrust, handoff, requestSigner, publisher, publisherDescriptor, request, receipt, publication, publicationTrust,
  };
}

const verifiedAt = at('2026-07-22T15:00:00.000Z');

test('two consecutive recovery epochs preserve sequence and advance exactly once', () => {
  const f = fixture();
  const first = verifyRecoveryEpochV33_34({ bundle: f.firstRecovery, trust: f.firstTrust, verifiedAt });
  const second = verifyRecoveryEpochV33_34({ bundle: f.secondRecovery, trust: f.secondTrust, verifiedAt });
  assert.equal(first.fromEpoch, 2); assert.equal(second.toEpoch, 4); assert.equal(first.sequenceFloor, second.sequenceFloor);
});

test('recovery supports loss of two witnesses with three-of-five quorum', () => {
  const f = fixture();
  assert.equal(f.firstRecovery.certificate.payload.unavailableWitnessKeyIds.length, 2);
  assert.equal(verifyRecoveryEpochV33_34({ bundle: f.firstRecovery, trust: f.firstTrust, verifiedAt }).quorumRequired, 3);
});

test('more than two unavailable witnesses is rejected', () => {
  const f = fixture();
  assert.throws(() => createRecoveryEpochPlanV33_34({
    planSigner: generateSigningIdentity('too-many-plan'), drillId: 'drill-too-many', transitionOrdinal: 1, studyId: 'study-v33-34', protocolDigest,
    fromEpoch: 2, sequenceFloor: 0, predecessorCertificate: f.rotation.certificate, predecessorLeaseDigest: f.lease.certificate.payload.leaseDigest,
    predecessorPinDigest: f.pin.certificate.payload.pinDigest, currentWitnesses: f.epoch2Rows, nextWitnesses: f.epoch2Rows,
    unavailableWitnessKeyIds: f.epoch2Witnesses.slice(0, 3).map((row) => row.keyId), quorum: 3,
    recoveryAuthority: actor(f.recoveryAuthority, 'recovery-authority-org', 'recovery-authority-host'), activationChallengeDigest: activationDigest('too-many'),
    issuedAt: at('2026-07-22T12:00:00.000Z'), expiresAt: at('2026-07-24T12:00:00.000Z'),
  }), /v33_34_unavailable_witness_quorum_lost/);
});

test('unknown unavailable witness is rejected', () => {
  const f = fixture();
  assert.throws(() => createRecoveryEpochPlanV33_34({
    planSigner: generateSigningIdentity('unknown-plan'), drillId: 'drill-unknown', transitionOrdinal: 1, studyId: 'study-v33-34', protocolDigest,
    fromEpoch: 2, sequenceFloor: 0, predecessorCertificate: f.rotation.certificate, predecessorLeaseDigest: f.lease.certificate.payload.leaseDigest,
    predecessorPinDigest: f.pin.certificate.payload.pinDigest, currentWitnesses: f.epoch2Rows, nextWitnesses: f.epoch2Rows,
    unavailableWitnessKeyIds: ['unknown-witness'], quorum: 3, recoveryAuthority: actor(f.recoveryAuthority, 'recovery-authority-org', 'recovery-authority-host'),
    activationChallengeDigest: activationDigest('unknown'), issuedAt: at('2026-07-22T12:00:00.000Z'), expiresAt: at('2026-07-24T12:00:00.000Z'),
  }), /v33_34_unavailable_witness_unknown/);
});

test('unavailable witness must be replaced', () => {
  const f = fixture();
  assert.throws(() => createRecoveryEpochPlanV33_34({
    planSigner: generateSigningIdentity('not-replaced-plan'), drillId: 'drill-not-replaced', transitionOrdinal: 1, studyId: 'study-v33-34', protocolDigest,
    fromEpoch: 2, sequenceFloor: 0, predecessorCertificate: f.rotation.certificate, predecessorLeaseDigest: f.lease.certificate.payload.leaseDigest,
    predecessorPinDigest: f.pin.certificate.payload.pinDigest, currentWitnesses: f.epoch2Rows, nextWitnesses: f.epoch2Rows,
    unavailableWitnessKeyIds: [f.epoch2Witnesses[4]!.keyId], quorum: 3, recoveryAuthority: actor(f.recoveryAuthority, 'recovery-authority-org', 'recovery-authority-host'),
    activationChallengeDigest: activationDigest('not-replaced'), issuedAt: at('2026-07-22T12:00:00.000Z'), expiresAt: at('2026-07-24T12:00:00.000Z'),
  }), /v33_34_unavailable_witness_not_replaced/);
});

test('first transition rejects a v33.34 predecessor', () => {
  const f = fixture();
  assert.throws(() => createRecoveryEpochPlanV33_34({
    planSigner: generateSigningIdentity('bad-first-plan'), drillId: 'drill-bad-first', transitionOrdinal: 1, studyId: 'study-v33-34', protocolDigest,
    fromEpoch: 3, sequenceFloor: 0, predecessorCertificate: f.firstRecovery.certificate, predecessorLeaseDigest: f.lease.certificate.payload.leaseDigest,
    predecessorPinDigest: f.pin.certificate.payload.pinDigest, currentWitnesses: f.epoch3Rows, nextWitnesses: f.epoch3Rows,
    unavailableWitnessKeyIds: [], quorum: 3, recoveryAuthority: actor(f.recoveryAuthority, 'recovery-authority-org', 'recovery-authority-host'),
    activationChallengeDigest: activationDigest('bad-first'), issuedAt: at('2026-07-22T13:00:00.000Z'), expiresAt: at('2026-07-24T13:00:00.000Z'),
  }), /v33_34_first_transition_predecessor_invalid/);
});

test('second transition rejects a v33.33 predecessor', () => {
  const f = fixture();
  assert.throws(() => createRecoveryEpochPlanV33_34({
    planSigner: generateSigningIdentity('bad-second-plan'), drillId: 'drill-bad-second', transitionOrdinal: 2, studyId: 'study-v33-34', protocolDigest,
    fromEpoch: 2, sequenceFloor: 0, predecessorCertificate: f.rotation.certificate, predecessorLeaseDigest: f.lease.certificate.payload.leaseDigest,
    predecessorPinDigest: f.pin.certificate.payload.pinDigest, currentWitnesses: f.epoch2Rows, nextWitnesses: f.epoch2Rows,
    unavailableWitnessKeyIds: [], quorum: 3, recoveryAuthority: actor(f.recoveryAuthority, 'recovery-authority-org', 'recovery-authority-host'),
    activationChallengeDigest: activationDigest('bad-second'), issuedAt: at('2026-07-22T13:00:00.000Z'), expiresAt: at('2026-07-24T13:00:00.000Z'),
  }), /v33_34_second_transition_predecessor_invalid/);
});

test('sequence reset is rejected', () => {
  const f = fixture();
  assert.throws(() => createRecoveryEpochPlanV33_34({
    planSigner: generateSigningIdentity('reset-plan'), drillId: 'drill-reset', transitionOrdinal: 1, studyId: 'study-v33-34', protocolDigest,
    fromEpoch: 2, sequenceFloor: 1, predecessorCertificate: f.rotation.certificate, predecessorLeaseDigest: f.lease.certificate.payload.leaseDigest,
    predecessorPinDigest: f.pin.certificate.payload.pinDigest, currentWitnesses: f.epoch2Rows, nextWitnesses: f.epoch2Rows,
    unavailableWitnessKeyIds: [], quorum: 3, recoveryAuthority: actor(f.recoveryAuthority, 'recovery-authority-org', 'recovery-authority-host'),
    activationChallengeDigest: activationDigest('reset'), issuedAt: at('2026-07-22T12:00:00.000Z'), expiresAt: at('2026-07-24T12:00:00.000Z'),
  }), /v33_34_recovery_predecessor_continuity_invalid/);
});

test('tampered recovery plan signature is rejected', () => {
  const f = fixture();
  const bundle = { ...f.firstRecovery, plan: { ...f.firstPlan, signature: `${f.firstPlan.signature}x` } };
  assert.throws(() => verifyRecoveryEpochV33_34({ bundle, trust: f.firstTrust, verifiedAt }), /v33_34_recovery_plan_signature_invalid/);
});

test('insufficient recovery witness votes are rejected', () => {
  const f = fixture();
  const bundle = { ...f.firstRecovery, witnessVotes: f.firstVotes.slice(0, 2) };
  assert.throws(() => verifyRecoveryEpochV33_34({ bundle, trust: f.firstTrust, verifiedAt }), /v33_34_recovery_vote_quorum_not_met/);
});

test('duplicate recovery witness votes are rejected', () => {
  const f = fixture();
  const bundle = { ...f.firstRecovery, witnessVotes: [f.firstVotes[0]!, f.firstVotes[0]!, f.firstVotes[1]!] };
  assert.throws(() => verifyRecoveryEpochV33_34({ bundle, trust: f.firstTrust, verifiedAt }), /v33_34_recovery_vote_topology_invalid/);
});

test('an unavailable witness cannot vote', () => {
  const f = fixture();
  assert.throws(() => createRecoveryWitnessVoteV33_34({ witness: f.epoch2Witnesses[4]!, plan: f.firstPlan, observedAt: at('2026-07-22T12:05:00.000Z') }), /v33_34_recovery_voter_unavailable/);
});

test('missing recovery activation is rejected', () => {
  const f = fixture();
  const bundle = { ...f.firstRecovery, activations: f.firstActivations.slice(0, 4) };
  assert.throws(() => verifyRecoveryEpochV33_34({ bundle, trust: f.firstTrust, verifiedAt }), /v33_34_recovery_activation_incomplete/);
});

test('activation fingerprint mismatch is rejected even when resigned', () => {
  const f = fixture();
  const changed = resign(f.firstActivations[0]!, f.epoch3Witnesses[0]!, 'activationDigest', { witnessKeyFingerprint: '0'.repeat(64) });
  const bundle = { ...f.firstRecovery, activations: [changed, ...f.firstActivations.slice(1)] };
  assert.throws(() => verifyRecoveryEpochV33_34({ bundle, trust: f.firstTrust, verifiedAt }), /v33_34_recovery_activation_binding_invalid/);
});

test('recovery authority cannot share witness topology', () => {
  const f = fixture();
  const overlapping = { ...actor(f.recoveryAuthority, 'epoch2-org-1', 'unique-authority-host') };
  assert.throws(() => createRecoveryEpochPlanV33_34({
    planSigner: generateSigningIdentity('overlap-plan'), drillId: 'drill-overlap', transitionOrdinal: 1, studyId: 'study-v33-34', protocolDigest,
    fromEpoch: 2, sequenceFloor: 0, predecessorCertificate: f.rotation.certificate, predecessorLeaseDigest: f.lease.certificate.payload.leaseDigest,
    predecessorPinDigest: f.pin.certificate.payload.pinDigest, currentWitnesses: f.epoch2Rows, nextWitnesses: f.epoch2Rows,
    unavailableWitnessKeyIds: [], quorum: 3, recoveryAuthority: overlapping, activationChallengeDigest: activationDigest('overlap'),
    issuedAt: at('2026-07-22T12:00:00.000Z'), expiresAt: at('2026-07-24T12:00:00.000Z'),
  }), /v33_34_recovery_current_topology_invalid/);
});

test('tampered recovery certificate is rejected', () => {
  const f = fixture();
  const certificate = resign(f.firstRecovery.certificate, f.recoveryAuthority, 'certificateDigest', { sequenceFloor: 10 });
  assert.throws(() => verifyRecoveryEpochV33_34({ bundle: { ...f.firstRecovery, certificate }, trust: f.firstTrust, verifiedAt }), /v33_34_recovery_certificate_binding_invalid/);
});

test('active lease handoff verifies with signed relinquishment and quorum', () => {
  const f = fixture();
  const result = verifyCoordinatorHandoffV33_34({ bundle: f.handoff, trust: f.handoffTrust, verifiedAt });
  assert.equal(result.sequenceStart, 51); assert.equal(result.nextTerm, 2);
});

test('cutover at lease end is rejected', () => {
  const f = fixture();
  assert.throws(() => createCoordinatorRelinquishmentV33_34({ outgoingCoordinator: f.activeCoordinator, outgoingCoordinatorDescriptor: actor(f.activeCoordinator, 'active-coordinator-org', 'active-coordinator-host'), replacementCoordinator: f.replacementDescriptor, predecessorLease: f.lease.certificate, cutoverSequence: f.lease.certificate.payload.sequenceEnd, relinquishedAt: at('2026-07-22T12:20:00.000Z') }), /v33_34_relinquishment_cutover_invalid/);
});

test('handoff to same coordinator is rejected', () => {
  const f = fixture();
  assert.throws(() => createCoordinatorRelinquishmentV33_34({ outgoingCoordinator: f.activeCoordinator, outgoingCoordinatorDescriptor: actor(f.activeCoordinator, 'active-coordinator-org', 'active-coordinator-host'), replacementCoordinator: actor(f.activeCoordinator, 'active-coordinator-org', 'active-coordinator-host'), predecessorLease: f.lease.certificate, cutoverSequence: 50, relinquishedAt: at('2026-07-22T12:20:00.000Z') }), /v33_34_relinquishment_same_coordinator/);
});

test('forged outgoing coordinator relinquishment is rejected', () => {
  const f = fixture();
  const attacker = generateSigningIdentity('handoff-attacker');
  const forged = signEnvelope(f.relinquishment.payload, attacker);
  assert.throws(() => verifyCoordinatorHandoffV33_34({ bundle: { ...f.handoff, relinquishment: forged }, trust: f.handoffTrust, verifiedAt }), /v33_34_relinquishment_signature_invalid/);
});

test('forged replacement acceptance is rejected', () => {
  const f = fixture();
  const attacker = generateSigningIdentity('acceptance-attacker');
  const forged = signEnvelope(f.acceptance.payload, attacker);
  assert.throws(() => verifyCoordinatorHandoffV33_34({ bundle: { ...f.handoff, acceptance: forged }, trust: f.handoffTrust, verifiedAt }), /v33_34_acceptance_signature_invalid/);
});

test('handoff requires witness quorum', () => {
  const f = fixture();
  assert.throws(() => verifyCoordinatorHandoffV33_34({ bundle: { ...f.handoff, witnessVotes: f.handoffVotes.slice(0, 2) }, trust: f.handoffTrust, verifiedAt }), /v33_34_handoff_vote_quorum_not_met/);
});

test('duplicate handoff witness votes are rejected', () => {
  const f = fixture();
  assert.throws(() => verifyCoordinatorHandoffV33_34({ bundle: { ...f.handoff, witnessVotes: [f.handoffVotes[0]!, f.handoffVotes[0]!, f.handoffVotes[1]!] }, trust: f.handoffTrust, verifiedAt }), /v33_34_handoff_vote_topology_invalid/);
});

test('tampered handoff certificate is rejected', () => {
  const f = fixture();
  const certificate = resign(f.handoff.certificate, f.recoveryAuthority, 'handoffDigest', { sequenceStart: 50 });
  assert.throws(() => verifyCoordinatorHandoffV33_34({ bundle: { ...f.handoff, certificate }, trust: f.handoffTrust, verifiedAt }), /v33_34_handoff_certificate_binding_invalid/);
});

test('conflicting handoffs from one active lease are detected', () => {
  const f = fixture();
  const replacement2 = generateSigningIdentity('replacement-coordinator-2');
  const descriptor2 = actor(replacement2, 'replacement-coordinator-org-2', 'replacement-coordinator-host-2');
  const relinquishment2 = createCoordinatorRelinquishmentV33_34({ outgoingCoordinator: f.activeCoordinator, outgoingCoordinatorDescriptor: actor(f.activeCoordinator, 'active-coordinator-org', 'active-coordinator-host'), replacementCoordinator: descriptor2, predecessorLease: f.lease.certificate, cutoverSequence: 60, relinquishedAt: at('2026-07-22T12:20:00.000Z') });
  const acceptance2 = createCoordinatorAcceptanceV33_34({ replacementCoordinator: replacement2, predecessorLease: f.lease.certificate, relinquishment: relinquishment2, acceptedAt: at('2026-07-22T12:21:00.000Z') });
  const votes2 = f.epoch2Witnesses.slice(0, 3).map((identity, index) => createCoordinatorHandoffVoteV33_34({ witness: identity, witnessDescriptor: f.epoch2Rows[index]!, predecessorLease: f.lease.certificate, relinquishment: relinquishment2, acceptance: acceptance2, observedAt: at('2026-07-22T12:22:00.000Z') }));
  const trust2 = { ...f.handoffTrust, replacementCoordinatorRegistry: registry(replacement2), trustedReplacementCoordinatorIds: [replacement2.keyId] };
  const handoff2 = finalizeCoordinatorHandoffV33_34({ recoveryAuthority: f.recoveryAuthority, predecessorLease: f.lease.certificate, relinquishment: relinquishment2, acceptance: acceptance2, witnessVotes: votes2, trust: trust2, issuedAt: at('2026-07-22T12:25:00.000Z') });
  assert.equal(detectCoordinatorHandoffConflictsV33_34([f.handoff.certificate, handoff2.certificate]).length, 1);
});

test('publication rehearsal bundle verifies without claiming network observation', () => {
  const f = fixture();
  const receipt = verifyRecoveryPublicationV33_34({ bundle: f.publication, trust: f.publicationTrust, verifiedAt });
  assert.equal(receipt.networkFetchObserved, false); assert.equal(receipt.publicationClass, 'LOCAL_REHEARSAL_ARTIFACT');
});

test('publication endpoint must use HTTPS', () => {
  const f = fixture();
  assert.throws(() => createRecoveryPublicationRequestV33_34({ requestSigner: f.requestSigner, drillId: 'drill-v33-34', priorPin: f.pin.certificate, firstRecovery: f.firstRecovery.certificate, secondRecovery: f.secondRecovery.certificate, handoff: f.handoff.certificate, endpointId: 'bad-endpoint', endpointUri: 'http://example.test/file.json', publisher: f.publisherDescriptor, publicationChallengeDigest: activationDigest('bad-endpoint'), previousReceipt: null, issuedAt: at('2026-07-22T14:00:00.000Z'), expiresAt: at('2026-07-24T14:00:00.000Z') }), /v33_34_endpoint_uri_invalid/);
});

test('publisher organization must differ from platform owner', () => {
  const f = fixture();
  const badTrust = { ...f.publicationTrust, platformOwnerOrganizationId: f.publisherDescriptor.organizationId };
  assert.throws(() => verifyRecoveryPublicationV33_34({ bundle: f.publication, trust: badTrust, verifiedAt }), /v33_34_publication_topology_invalid/);
});

test('publication receipt tampering is rejected', () => {
  const f = fixture();
  const receipt = resign(f.receipt, f.publisher, 'receiptDigest', { finalEpoch: 99 });
  assert.throws(() => verifyRecoveryPublicationV33_34({ bundle: { ...f.publication, receipt }, trust: f.publicationTrust, verifiedAt }), /v33_34_publication_receipt_binding_invalid/);
});

test('publication cannot claim network observation through resigning', () => {
  const f = fixture();
  const receipt = resign(f.receipt, f.publisher, 'receiptDigest', { networkFetchObserved: true as never });
  assert.throws(() => verifyRecoveryPublicationV33_34({ bundle: { ...f.publication, receipt }, trust: f.publicationTrust, verifiedAt }), /v33_34_publication_receipt_binding_invalid/);
});

test('publication predecessor receipt mismatch is rejected', () => {
  const f = fixture();
  const previous = resign(f.receipt, f.publisher, 'receiptDigest', { receiptId: 'previous-receipt' });
  assert.throws(() => createRecoveryPublicationReceiptV33_34({ publisher: f.publisher, request: f.request, priorPin: f.pin.certificate, previousReceipt: previous, publishedAt: at('2026-07-22T14:05:00.000Z') }), /v33_34_publication_predecessor_invalid/);
});

test('full recovery drill produces local-only verdict', () => {
  const f = fixture();
  const verifier = generateSigningIdentity('v3334-verifier');
  const verdict = finalizeRecoveryDrillV33_34({ verifier, firstRecovery: f.firstRecovery, firstRecoveryTrust: f.firstTrust, secondRecovery: f.secondRecovery, secondRecoveryTrust: f.secondTrust, handoff: f.handoff, handoffTrust: f.handoffTrust, publication: f.publication, publicationTrust: f.publicationTrust, generatedAt: verifiedAt });
  assert.equal(verdict.payload.finalEpoch, 4); assert.equal(verdict.payload.externalTopologyObserved, false); assert.equal(verdict.payload.productionAuthority, 'NONE');
});

test('full drill rejects recovery chain substitution', () => {
  const f = fixture();
  const verifier = generateSigningIdentity('v3334-verifier-chain');
  const changedRequest = resign(f.request, f.requestSigner, 'requestDigest', { firstRecoveryCertificateDigest: 'f'.repeat(64) });
  const changedReceipt = createRecoveryPublicationReceiptV33_34({ publisher: f.publisher, request: changedRequest, priorPin: f.pin.certificate, previousReceipt: null, publishedAt: at('2026-07-22T14:05:00.000Z') });
  const publication = { ...f.publication, request: changedRequest, receipt: changedReceipt };
  assert.throws(() => finalizeRecoveryDrillV33_34({ verifier, firstRecovery: f.firstRecovery, firstRecoveryTrust: f.firstTrust, secondRecovery: f.secondRecovery, secondRecoveryTrust: f.secondTrust, handoff: f.handoff, handoffTrust: f.handoffTrust, publication, publicationTrust: f.publicationTrust, generatedAt: verifiedAt }), /v33_34_drill_chain_invalid/);
});

test('production authority mutation is rejected in recovery certificate', () => {
  const f = fixture();
  const certificate = resign(f.firstRecovery.certificate, f.recoveryAuthority, 'certificateDigest', { productionAuthority: 'LIVE' as never });
  assert.throws(() => verifyRecoveryEpochV33_34({ bundle: { ...f.firstRecovery, certificate }, trust: f.firstTrust, verifiedAt }), /v33_34_recovery_certificate_boundary_invalid|v33_34_recovery_certificate_binding_invalid/);
});

test('external effects mutation is rejected in handoff vote', () => {
  const f = fixture();
  const vote = resign(f.handoffVotes[0]!, f.epoch2Witnesses[0]!, 'voteDigest', { externalEffectsExecuted: 1 as never });
  assert.throws(() => verifyCoordinatorHandoffV33_34({ bundle: { ...f.handoff, witnessVotes: [vote, ...f.handoffVotes.slice(1)] }, trust: f.handoffTrust, verifiedAt }), /v33_34_handoff_vote_boundary_invalid/);
});
