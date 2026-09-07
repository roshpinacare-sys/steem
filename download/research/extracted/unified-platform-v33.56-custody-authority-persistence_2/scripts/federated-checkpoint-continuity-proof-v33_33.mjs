import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  KeyRegistry,
  generateSigningIdentity,
  sha256,
  signEnvelope,
} from '../dist/src/contracts/crypto.js';
import {
  createFederatedCheckpointGenesisAnchorV33_32,
  createFederatedCheckpointWitnessPolicyV33_32,
} from '../dist/src/app/federated-human-pilot-checkpoint-v33_32.js';
import {
  createCoordinatorLeaseProposalV33_33,
  createCoordinatorLeaseVoteV33_33,
  createEpochRotationVoteV33_33,
  createTransparencyLogEntryV33_33,
  createTransparencyPinVoteV33_33,
  createWitnessActivationProofV33_33,
  createWitnessEpochRotationPlanV33_33,
  finalizeContinuityQualificationV33_33,
  finalizeCoordinatorLeaseV33_33,
  finalizeEpochRotationV33_33,
  finalizeTransparencyPinV33_33,
} from '../dist/src/app/federated-checkpoint-continuity-v33_33.js';

const out = resolve(process.argv[2] ?? 'release-evidence/v33.33/V33_33_CONTINUITY_PROOF.json');
const at = (value) => new Date(value);
const protocolDigest = sha256({ protocol: 'v33.33-portable-proof' });
const activationChallengeDigest = sha256({ activation: 'epoch-2-portable-proof' });

function registry(...identities) {
  const value = new KeyRegistry();
  for (const identity of identities) value.register(identity.keyId, identity.publicKey);
  return value;
}
function actor(identity, organizationId, hostId) {
  const keys = registry(identity);
  return { keyId: identity.keyId, keyFingerprint: keys.fingerprint(identity.keyId), organizationId, hostId };
}
function witness(identity, index, prefix) {
  return { witnessId: `${prefix}-witness-${index}`, ...actor(identity, `${prefix}-org-${index}`, `${prefix}-host-${index}`) };
}
function checkpoint(signer) {
  const material = {
    version: '33.31', checkpointId: 'checkpoint-0', sequence: 0, previousCheckpointDigest: null,
    consumedChallengeDigests: [], consumedPackageDigests: [], generatedAt: '2026-07-22T09:05:00.000Z',
    productionAuthority: 'NONE', externalEffectsExecuted: 0,
  };
  return signEnvelope({ ...material, checkpointDigest: sha256(material) }, signer);
}
function exportKeys(identities) {
  const keys = registry(...identities);
  return identities.map((identity) => keys.exportPublicKey(identity.keyId));
}

const policySigner = generateSigningIdentity('proof-policy-signer');
const oldImporter = generateSigningIdentity('proof-old-importer');
const oldCoordinator = generateSigningIdentity('proof-old-coordinator');
const oldWitnesses = Array.from({ length: 5 }, (_, i) => generateSigningIdentity(`proof-old-witness-${i + 1}`));
const oldWitnessRows = oldWitnesses.map((identity, i) => witness(identity, i + 1, 'old'));
const currentPolicy = createFederatedCheckpointWitnessPolicyV33_32({
  policySigner, studyId: 'study-v33-33-proof', protocolDigest, epoch: 1, quorum: 3, witnesses: oldWitnessRows,
  importer: { keyId: oldImporter.keyId, organizationId: 'old-importer-org', hostId: 'old-importer-host' },
  coordinator: { keyId: oldCoordinator.keyId, organizationId: 'old-coordinator-org', hostId: 'old-coordinator-host' },
  issuedAt: at('2026-07-22T09:00:00.000Z'), expiresAt: at('2026-07-23T10:00:00.000Z'),
});
const currentAnchor = createFederatedCheckpointGenesisAnchorV33_32({ anchorSigner: policySigner, policy: currentPolicy, initialCheckpoint: checkpoint(oldImporter), generatedAt: at('2026-07-22T09:10:00.000Z') });

const planSigner = generateSigningIdentity('proof-plan-signer');
const rotationAuthority = generateSigningIdentity('proof-rotation-authority');
const nextImporter = generateSigningIdentity('proof-next-importer');
const nextCoordinator = generateSigningIdentity('proof-next-coordinator');
const newWitnesses = [generateSigningIdentity('proof-new-witness-4'), generateSigningIdentity('proof-new-witness-5')];
const nextWitnesses = [...oldWitnesses.slice(0, 3), ...newWitnesses];
const nextWitnessRows = nextWitnesses.map((identity, i) => witness(identity, i + 1, 'next'));
const plan = createWitnessEpochRotationPlanV33_33({
  planSigner, currentPolicy, currentAnchor, nextWitnesses: nextWitnessRows, nextQuorum: 3,
  importer: actor(nextImporter, 'next-importer-org', 'next-importer-host'),
  coordinator: actor(nextCoordinator, 'next-coordinator-org', 'next-coordinator-host'),
  rotationAuthority: actor(rotationAuthority, 'rotation-authority-org', 'rotation-authority-host'),
  activationChallengeDigest, issuedAt: at('2026-07-22T10:00:00.000Z'), expiresAt: at('2026-07-23T10:00:00.000Z'),
});
const rotationTrust = {
  currentPolicyRegistry: registry(policySigner), trustedCurrentPolicySignerIds: [policySigner.keyId],
  currentAnchorRegistry: registry(policySigner, oldCoordinator), trustedCurrentAnchorSignerIds: [policySigner.keyId, oldCoordinator.keyId],
  currentWitnessRegistry: registry(...oldWitnesses), trustedCurrentWitnessIds: oldWitnesses.map((x) => x.keyId),
  nextWitnessRegistry: registry(...nextWitnesses), trustedNextWitnessIds: nextWitnesses.map((x) => x.keyId),
  planRegistry: registry(planSigner), trustedPlanSignerIds: [planSigner.keyId],
  rotationAuthorityRegistry: registry(rotationAuthority), trustedRotationAuthorityIds: [rotationAuthority.keyId],
};
const oldWitnessVotes = oldWitnesses.slice(0, 3).map((identity) => createEpochRotationVoteV33_33({ witness: identity, currentPolicy, plan, observedAt: at('2026-07-22T10:05:00.000Z') }));
const activationProofs = nextWitnesses.map((identity) => createWitnessActivationProofV33_33({ witness: identity, plan, activatedAt: at('2026-07-22T10:06:00.000Z') }));
const rotation = finalizeEpochRotationV33_33({ rotationAuthority, currentPolicy, currentAnchor, plan, oldWitnessVotes, activationProofs, trust: rotationTrust, issuedAt: at('2026-07-22T10:10:00.000Z') });

const leaseTrust = {
  planRegistry: registry(planSigner), trustedPlanSignerIds: [planSigner.keyId],
  coordinatorRegistry: registry(nextCoordinator), trustedCoordinatorIds: [nextCoordinator.keyId],
  witnessRegistry: registry(...nextWitnesses), trustedWitnessIds: nextWitnesses.map((x) => x.keyId),
  rotationAuthorityRegistry: registry(rotationAuthority), trustedRotationAuthorityIds: [rotationAuthority.keyId],
};
const leaseProposal = createCoordinatorLeaseProposalV33_33({
  coordinator: nextCoordinator, plan, term: 1, previousLease: null, sequenceWindow: 100,
  notBefore: at('2026-07-22T12:00:00.000Z'), expiresAt: at('2026-07-22T14:00:00.000Z'), proposedAt: at('2026-07-22T11:55:00.000Z'),
});
const leaseVotes = nextWitnesses.slice(0, 3).map((identity) => createCoordinatorLeaseVoteV33_33({ witness: identity, plan, proposal: leaseProposal, observedAt: at('2026-07-22T11:57:00.000Z') }));
const lease = finalizeCoordinatorLeaseV33_33({ rotationAuthority, plan, previousLease: null, proposal: leaseProposal, votes: leaseVotes, trust: leaseTrust, issuedAt: at('2026-07-22T11:58:00.000Z') });

const logOperator = generateSigningIdentity('proof-log-operator');
const monitors = Array.from({ length: 3 }, (_, i) => generateSigningIdentity(`proof-monitor-${i + 1}`));
const pinAuthority = generateSigningIdentity('proof-pin-authority');
const logOperatorDescriptor = actor(logOperator, 'log-operator-org', 'log-operator-host');
const monitorRows = monitors.map((identity, i) => ({ monitorId: `monitor-${i + 1}`, ...actor(identity, `monitor-org-${i + 1}`, `monitor-host-${i + 1}`) }));
const pinAuthorityDescriptor = actor(pinAuthority, 'pin-authority-org', 'pin-authority-host');
const transparencyTrust = {
  logOperatorRegistry: registry(logOperator), trustedLogOperatorIds: [logOperator.keyId], logOperator: logOperatorDescriptor,
  monitorRegistry: registry(...monitors), trustedMonitorIds: monitors.map((x) => x.keyId), monitors: monitorRows, monitorQuorum: 2,
  pinAuthorityRegistry: registry(pinAuthority), trustedPinAuthorityIds: [pinAuthority.keyId], pinAuthority: pinAuthorityDescriptor,
  platformOwnerOrganizationId: 'platform-owner-org',
};
const entries = [];
entries.push(createTransparencyLogEntryV33_33({ operator: logOperator, operatorDescriptor: logOperatorDescriptor, logId: 'continuity-log', previousEntry: null, eventType: 'CHECKPOINT_ANCHOR', objectDigest: currentAnchor.payload.anchorDigest, epoch: 1, sequence: 0, recordedAt: at('2026-07-22T10:11:00.000Z') }));
entries.push(createTransparencyLogEntryV33_33({ operator: logOperator, operatorDescriptor: logOperatorDescriptor, logId: 'continuity-log', previousEntry: entries.at(-1), eventType: 'EPOCH_ROTATION_PLAN', objectDigest: plan.payload.planDigest, epoch: 2, sequence: 0, recordedAt: at('2026-07-22T10:12:00.000Z') }));
entries.push(createTransparencyLogEntryV33_33({ operator: logOperator, operatorDescriptor: logOperatorDescriptor, logId: 'continuity-log', previousEntry: entries.at(-1), eventType: 'EPOCH_ROTATION_CERTIFICATE', objectDigest: rotation.certificate.payload.certificateDigest, epoch: 2, sequence: 0, recordedAt: at('2026-07-22T10:13:00.000Z') }));
entries.push(createTransparencyLogEntryV33_33({ operator: logOperator, operatorDescriptor: logOperatorDescriptor, logId: 'continuity-log', previousEntry: entries.at(-1), eventType: 'COORDINATOR_LEASE', objectDigest: lease.certificate.payload.leaseDigest, epoch: 2, sequence: 1, recordedAt: at('2026-07-22T11:59:00.000Z') }));
const monitorVotes = monitors.slice(0, 2).map((identity, i) => createTransparencyPinVoteV33_33({ monitor: identity, monitorDescriptor: monitorRows[i], entries, observedAt: at('2026-07-22T12:01:00.000Z') }));
const transparency = finalizeTransparencyPinV33_33({ pinAuthority, previousPin: null, entries, monitorVotes, trust: transparencyTrust, issuedAt: at('2026-07-22T12:02:00.000Z') });
const verifier = generateSigningIdentity('proof-continuity-verifier');
const verdict = finalizeContinuityQualificationV33_33({ verifier, rotation, rotationTrust, lease, leaseTrust, transparency, transparencyTrust, generatedAt: at('2026-07-22T12:10:00.000Z') });

const identities = [policySigner, oldCoordinator, ...oldWitnesses, planSigner, rotationAuthority, ...nextWitnesses, nextCoordinator, logOperator, ...monitors, pinAuthority, verifier];
const uniqueIdentities = [...new Map(identities.map((identity) => [identity.keyId, identity])).values()];
const evidence = {
  schemaVersion: '1.0.0', version: '33.33', generatedAt: new Date().toISOString(),
  truthBoundary: {
    proofClass: 'SYNTHETIC_LOCAL_PROTOCOL_PROOF', externalTopologyObserved: false, externalHumanParticipants: 0,
    productionAuthority: 'NONE', externalEffectsExecuted: 0,
  },
  publicKeys: exportKeys(uniqueIdentities),
  descriptors: { logOperator: logOperatorDescriptor, monitors: monitorRows, pinAuthority: pinAuthorityDescriptor, platformOwnerOrganizationId: 'platform-owner-org' },
  rotation,
  lease,
  transparency,
  verdict,
  summary: {
    fromEpoch: 1, toEpoch: 2, sequenceFloor: currentAnchor.payload.sequence,
    retainedWitnesses: plan.payload.retainedWitnessKeyIds.length, replacedWitnesses: plan.payload.replacedWitnessKeyIds.length,
    oldWitnessQuorum: oldWitnessVotes.length, activatedNextWitnesses: activationProofs.length,
    leaseTerm: lease.certificate.payload.term, leaseSequenceStart: lease.certificate.payload.sequenceStart,
    transparencyLogSize: transparency.certificate.payload.logSize, monitorQuorum: transparency.certificate.payload.monitorKeyIds.length,
    signatureCount: 25,
  },
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ status: 'PASS', output: out, summary: evidence.summary, truthBoundary: evidence.truthBoundary }));
