import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  KeyRegistry,
  generateSigningIdentity,
  sha256,
  signEnvelope,
} from '../dist/src/contracts/crypto.js';
import {
  createCoordinatorAcceptanceV33_34,
  createCoordinatorHandoffVoteV33_34,
  createCoordinatorRelinquishmentV33_34,
  createRecoveryEpochPlanV33_34,
  createRecoveryPublicationReceiptV33_34,
  createRecoveryPublicationRequestV33_34,
  createRecoveryWitnessActivationV33_34,
  createRecoveryWitnessVoteV33_34,
  finalizeCoordinatorHandoffV33_34,
  finalizeRecoveryDrillV33_34,
  finalizeRecoveryEpochV33_34,
} from '../dist/src/app/federated-recovery-drill-v33_34.js';

const out = resolve(process.argv[2] ?? 'release-evidence/v33.34/V33_34_RECOVERY_DRILL_PROOF.json');
const at = (value) => new Date(value);
const registry = (...identities) => { const result = new KeyRegistry(); for (const identity of identities) result.register(identity.keyId, identity.publicKey); return result; };
const actor = (identity, organizationId, hostId) => { const keys = registry(identity); return { keyId: identity.keyId, keyFingerprint: keys.fingerprint(identity.keyId), organizationId, hostId }; };
const witness = (identity, index, prefix) => ({ witnessId: `${prefix}-witness-${index}`, ...actor(identity, `${prefix}-org-${index}`, `${prefix}-host-${index}`) });
const signDigest = (material, field, signer) => signEnvelope({ ...material, [field]: sha256(material) }, signer);
const protocolDigest = sha256({ protocol: 'v33.34-recovery-drill-proof' });
const drillId = 'recovery-drill-v33-34';

const authority = generateSigningIdentity('proof-v3334-recovery-authority');
const activeCoordinator = generateSigningIdentity('proof-v3334-active-coordinator');
const replacementCoordinator = generateSigningIdentity('proof-v3334-replacement-coordinator');
const pinAuthority = generateSigningIdentity('proof-v3334-pin-authority');
const planSigner1 = generateSigningIdentity('proof-v3334-plan-1');
const planSigner2 = generateSigningIdentity('proof-v3334-plan-2');
const requestSigner = generateSigningIdentity('proof-v3334-request-signer');
const publisher = generateSigningIdentity('proof-v3334-publisher');
const verifier = generateSigningIdentity('proof-v3334-verifier');
const epoch2Witnesses = Array.from({ length: 5 }, (_, index) => generateSigningIdentity(`proof-v3334-epoch2-w${index + 1}`));
const epoch3New = [generateSigningIdentity('proof-v3334-epoch3-w4'), generateSigningIdentity('proof-v3334-epoch3-w5')];
const epoch3Witnesses = [...epoch2Witnesses.slice(0, 3), ...epoch3New];
const epoch4New = generateSigningIdentity('proof-v3334-epoch4-w5');
const epoch4Witnesses = [...epoch3Witnesses.slice(0, 4), epoch4New];
const epoch2Rows = epoch2Witnesses.map((identity, index) => witness(identity, index + 1, 'epoch2'));
const epoch3Rows = epoch3Witnesses.map((identity, index) => witness(identity, index + 1, 'epoch3'));
const epoch4Rows = epoch4Witnesses.map((identity, index) => witness(identity, index + 1, 'epoch4'));
const authorityDescriptor = actor(authority, 'recovery-authority-org', 'recovery-authority-host');
const activeCoordinatorDescriptor = actor(activeCoordinator, 'active-coordinator-org', 'active-coordinator-host');
const replacementCoordinatorDescriptor = actor(replacementCoordinator, 'replacement-coordinator-org', 'replacement-coordinator-host');
const publisherDescriptor = actor(publisher, 'independent-publisher-org', 'independent-publisher-host');

const predecessorRotation = signDigest({
  version: '33.33', certificateId: 'predecessor-rotation', planDigest: sha256({ plan: 'predecessor' }), fromPolicyDigest: sha256({ policy: 'predecessor' }),
  fromEpoch: 1, toEpoch: 2, sequenceFloor: 0, predecessorAnchorDigest: sha256({ anchor: 'predecessor' }), predecessorCheckpointDigest: sha256({ checkpoint: 'predecessor' }),
  quorumRequired: 3, oldWitnessVoteDigests: [], oldWitnessKeyIds: [], activationProofDigests: [], activatedWitnessKeyIds: epoch2Witnesses.map((row) => row.keyId).sort(),
  issuedAt: '2026-07-22T10:00:00.000Z', rotationAuthorityKeyId: authority.keyId, rotationAuthorityOrganizationId: authorityDescriptor.organizationId,
  rotationAuthorityHostId: authorityDescriptor.hostId, productionAuthority: 'NONE', externalEffectsExecuted: 0,
}, 'certificateDigest', authority);

const predecessorLease = signDigest({
  version: '33.33', leaseId: 'predecessor-lease', planDigest: predecessorRotation.payload.planDigest, proposalDigest: sha256({ proposal: 'predecessor' }),
  epoch: 2, term: 1, previousLeaseDigest: null, sequenceStart: 1, sequenceEnd: 100, coordinatorKeyId: activeCoordinator.keyId,
  coordinatorOrganizationId: activeCoordinatorDescriptor.organizationId, coordinatorHostId: activeCoordinatorDescriptor.hostId, quorumRequired: 3,
  witnessVoteDigests: [], witnessKeyIds: epoch2Witnesses.slice(0, 3).map((row) => row.keyId).sort(), issuedAt: '2026-07-22T10:30:00.000Z',
  expiresAt: '2026-07-23T10:30:00.000Z', rotationAuthorityKeyId: authority.keyId, productionAuthority: 'NONE', externalEffectsExecuted: 0,
}, 'leaseDigest', authority);

const predecessorPin = signDigest({
  version: '33.33', pinId: 'predecessor-pin', logId: 'recovery-log', logSize: 2, headEntryDigest: sha256({ head: 'predecessor' }), epoch: 2,
  highestSequence: 1, quorumRequired: 2, monitorVoteDigests: [], monitorKeyIds: [], issuedAt: '2026-07-22T10:40:00.000Z', pinAuthorityKeyId: pinAuthority.keyId,
  pinAuthorityOrganizationId: 'pin-authority-org', pinAuthorityHostId: 'pin-authority-host', previousPinDigest: null, productionAuthority: 'NONE', externalEffectsExecuted: 0,
}, 'pinDigest', pinAuthority);

const firstPlan = createRecoveryEpochPlanV33_34({
  planSigner: planSigner1, drillId, transitionOrdinal: 1, studyId: 'study-v33-34-proof', protocolDigest, fromEpoch: 2, sequenceFloor: 0,
  predecessorCertificate: predecessorRotation, predecessorLeaseDigest: predecessorLease.payload.leaseDigest, predecessorPinDigest: predecessorPin.payload.pinDigest,
  currentWitnesses: epoch2Rows, nextWitnesses: epoch3Rows, unavailableWitnessKeyIds: epoch2Witnesses.slice(3).map((row) => row.keyId), quorum: 3,
  recoveryAuthority: authorityDescriptor, activationChallengeDigest: sha256({ challenge: 'epoch3' }), issuedAt: at('2026-07-22T12:00:00.000Z'), expiresAt: at('2026-07-24T12:00:00.000Z'),
});
const firstTrust = {
  predecessorRegistry: registry(authority), trustedPredecessorSignerIds: [authority.keyId], planRegistry: registry(planSigner1), trustedPlanSignerIds: [planSigner1.keyId],
  currentWitnessRegistry: registry(...epoch2Witnesses), trustedCurrentWitnessIds: epoch2Witnesses.map((row) => row.keyId), nextWitnessRegistry: registry(...epoch3Witnesses),
  trustedNextWitnessIds: epoch3Witnesses.map((row) => row.keyId), recoveryAuthorityRegistry: registry(authority), trustedRecoveryAuthorityIds: [authority.keyId],
};
const firstVotes = epoch2Witnesses.slice(0, 3).map((identity) => createRecoveryWitnessVoteV33_34({ witness: identity, plan: firstPlan, observedAt: at('2026-07-22T12:05:00.000Z') }));
const firstActivations = epoch3Witnesses.map((identity) => createRecoveryWitnessActivationV33_34({ witness: identity, plan: firstPlan, activatedAt: at('2026-07-22T12:06:00.000Z') }));
const firstRecovery = finalizeRecoveryEpochV33_34({ recoveryAuthority: authority, predecessorCertificate: predecessorRotation, plan: firstPlan, witnessVotes: firstVotes, activations: firstActivations, trust: firstTrust, issuedAt: at('2026-07-22T12:10:00.000Z') });

const secondPlan = createRecoveryEpochPlanV33_34({
  planSigner: planSigner2, drillId, transitionOrdinal: 2, studyId: 'study-v33-34-proof', protocolDigest, fromEpoch: 3, sequenceFloor: 0,
  predecessorCertificate: firstRecovery.certificate, predecessorLeaseDigest: predecessorLease.payload.leaseDigest, predecessorPinDigest: predecessorPin.payload.pinDigest,
  currentWitnesses: epoch3Rows, nextWitnesses: epoch4Rows, unavailableWitnessKeyIds: [epoch3Witnesses[4].keyId], quorum: 3,
  recoveryAuthority: authorityDescriptor, activationChallengeDigest: sha256({ challenge: 'epoch4' }), issuedAt: at('2026-07-22T13:00:00.000Z'), expiresAt: at('2026-07-24T13:00:00.000Z'),
});
const secondTrust = {
  predecessorRegistry: registry(authority), trustedPredecessorSignerIds: [authority.keyId], planRegistry: registry(planSigner2), trustedPlanSignerIds: [planSigner2.keyId],
  currentWitnessRegistry: registry(...epoch3Witnesses), trustedCurrentWitnessIds: epoch3Witnesses.map((row) => row.keyId), nextWitnessRegistry: registry(...epoch4Witnesses),
  trustedNextWitnessIds: epoch4Witnesses.map((row) => row.keyId), recoveryAuthorityRegistry: registry(authority), trustedRecoveryAuthorityIds: [authority.keyId],
};
const secondVotes = epoch3Witnesses.slice(0, 3).map((identity) => createRecoveryWitnessVoteV33_34({ witness: identity, plan: secondPlan, observedAt: at('2026-07-22T13:05:00.000Z') }));
const secondActivations = epoch4Witnesses.map((identity) => createRecoveryWitnessActivationV33_34({ witness: identity, plan: secondPlan, activatedAt: at('2026-07-22T13:06:00.000Z') }));
const secondRecovery = finalizeRecoveryEpochV33_34({ recoveryAuthority: authority, predecessorCertificate: firstRecovery.certificate, plan: secondPlan, witnessVotes: secondVotes, activations: secondActivations, trust: secondTrust, issuedAt: at('2026-07-22T13:10:00.000Z') });

const relinquishment = createCoordinatorRelinquishmentV33_34({ outgoingCoordinator: activeCoordinator, outgoingCoordinatorDescriptor: activeCoordinatorDescriptor, replacementCoordinator: replacementCoordinatorDescriptor, predecessorLease, cutoverSequence: 50, relinquishedAt: at('2026-07-22T12:20:00.000Z') });
const acceptance = createCoordinatorAcceptanceV33_34({ replacementCoordinator, predecessorLease, relinquishment, acceptedAt: at('2026-07-22T12:21:00.000Z') });
const handoffVotes = epoch2Witnesses.slice(0, 3).map((identity, index) => createCoordinatorHandoffVoteV33_34({ witness: identity, witnessDescriptor: epoch2Rows[index], predecessorLease, relinquishment, acceptance, observedAt: at('2026-07-22T12:22:00.000Z') }));
const handoffTrust = {
  predecessorLeaseRegistry: registry(authority), trustedPredecessorLeaseSignerIds: [authority.keyId], outgoingCoordinatorRegistry: registry(activeCoordinator), trustedOutgoingCoordinatorIds: [activeCoordinator.keyId],
  replacementCoordinatorRegistry: registry(replacementCoordinator), trustedReplacementCoordinatorIds: [replacementCoordinator.keyId], witnessRegistry: registry(...epoch2Witnesses),
  trustedWitnessIds: epoch2Witnesses.map((row) => row.keyId), witnesses: epoch2Rows, quorum: 3, recoveryAuthorityRegistry: registry(authority), trustedRecoveryAuthorityIds: [authority.keyId],
};
const handoff = finalizeCoordinatorHandoffV33_34({ recoveryAuthority: authority, predecessorLease, relinquishment, acceptance, witnessVotes: handoffVotes, trust: handoffTrust, issuedAt: at('2026-07-22T12:25:00.000Z') });

const request = createRecoveryPublicationRequestV33_34({ requestSigner, drillId, priorPin: predecessorPin, firstRecovery: firstRecovery.certificate, secondRecovery: secondRecovery.certificate, handoff: handoff.certificate,
  endpointId: 'portable-independent-endpoint', endpointUri: 'https://evidence.example.test/v33.34/recovery.json', publisher: publisherDescriptor,
  publicationChallengeDigest: sha256({ challenge: 'publication' }), previousReceipt: null, issuedAt: at('2026-07-22T14:00:00.000Z'), expiresAt: at('2026-07-24T14:00:00.000Z') });
const receipt = createRecoveryPublicationReceiptV33_34({ publisher, request, priorPin: predecessorPin, previousReceipt: null, publishedAt: at('2026-07-22T14:05:00.000Z') });
const publication = { priorPin: predecessorPin, request, previousReceipt: null, receipt };
const publicationTrust = {
  priorPinRegistry: registry(pinAuthority), trustedPriorPinSignerIds: [pinAuthority.keyId], requestRegistry: registry(requestSigner), trustedRequestSignerIds: [requestSigner.keyId],
  publisherRegistry: registry(publisher), trustedPublisherIds: [publisher.keyId], publisher: publisherDescriptor, platformOwnerOrganizationId: 'platform-owner-org',
};
const verdict = finalizeRecoveryDrillV33_34({ verifier, firstRecovery, firstRecoveryTrust: firstTrust, secondRecovery, secondRecoveryTrust: secondTrust, handoff, handoffTrust, publication, publicationTrust, generatedAt: at('2026-07-22T15:00:00.000Z') });

const identities = [authority, activeCoordinator, replacementCoordinator, pinAuthority, planSigner1, planSigner2, requestSigner, publisher, verifier, ...epoch2Witnesses, ...epoch3Witnesses, ...epoch4Witnesses];
const uniqueIdentities = [...new Map(identities.map((identity) => [identity.keyId, identity])).values()];
const keys = registry(...uniqueIdentities);
const evidence = {
  schemaVersion: '1.0.0', version: '33.34', generatedAt: new Date().toISOString(),
  truthBoundary: { proofClass: 'SYNTHETIC_LOCAL_RECOVERY_REHEARSAL', externalTopologyObserved: false, externalHumanParticipants: 0, productionAuthority: 'NONE', externalEffectsExecuted: 0 },
  publicKeys: uniqueIdentities.map((identity) => keys.exportPublicKey(identity.keyId)),
  trust: {
    authorityKeyId: authority.keyId, activeCoordinatorKeyId: activeCoordinator.keyId, replacementCoordinatorKeyId: replacementCoordinator.keyId, pinAuthorityKeyId: pinAuthority.keyId,
    firstPlanSignerKeyId: planSigner1.keyId, secondPlanSignerKeyId: planSigner2.keyId, requestSignerKeyId: requestSigner.keyId, publisherKeyId: publisher.keyId, verifierKeyId: verifier.keyId,
    epoch2WitnessKeyIds: epoch2Witnesses.map((row) => row.keyId), epoch3WitnessKeyIds: epoch3Witnesses.map((row) => row.keyId), epoch4WitnessKeyIds: epoch4Witnesses.map((row) => row.keyId),
    epoch2Witnesses: epoch2Rows, publisher: publisherDescriptor, platformOwnerOrganizationId: 'platform-owner-org',
  },
  predecessor: { rotation: predecessorRotation, lease: predecessorLease, pin: predecessorPin },
  firstRecovery, secondRecovery, handoff, publication, verdict,
  summary: { initialEpoch: 2, finalEpoch: 4, sequenceFloor: 0, firstUnavailableWitnesses: 2, secondUnavailableWitnesses: 1, handoffCutoverSequence: 50, replacementLeaseStart: 51, signatureCount: 32 },
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ status: 'PASS', output: out, summary: evidence.summary, truthBoundary: evidence.truthBoundary }));
