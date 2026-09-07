import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { KeyRegistry, sha256 } from '../dist/src/contracts/crypto.js';
import {
  verifyCoordinatorHandoffV33_34,
  verifyRecoveryEpochV33_34,
  verifyRecoveryPublicationV33_34,
} from '../dist/src/app/federated-recovery-drill-v33_34.js';

const inputPath = resolve(process.argv[2] ?? 'release-evidence/v33.34/V33_34_RECOVERY_DRILL_PROOF.json');
const outputPath = resolve(process.argv[3] ?? 'release-evidence/v33.34/V33_34_INDEPENDENT_VERIFICATION.json');
const evidence = JSON.parse(readFileSync(inputPath, 'utf8'));
if (evidence.version !== '33.34' || evidence.truthBoundary?.proofClass !== 'SYNTHETIC_LOCAL_RECOVERY_REHEARSAL') throw new Error('v33_34_evidence_class_invalid');
if (evidence.truthBoundary.externalTopologyObserved !== false || evidence.truthBoundary.externalHumanParticipants !== 0 || evidence.truthBoundary.productionAuthority !== 'NONE' || evidence.truthBoundary.externalEffectsExecuted !== 0) throw new Error('v33_34_truth_boundary_invalid');

const allKeys = new KeyRegistry();
for (const record of evidence.publicKeys) allKeys.registerExported(record);
const registryFor = (ids) => { const result = new KeyRegistry(); for (const id of ids) result.registerExported(evidence.publicKeys.find((row) => row.keyId === id)); return result; };
const trust = evidence.trust;
const verifiedAt = new Date('2026-07-22T15:00:00.000Z');
const firstTrust = {
  predecessorRegistry: registryFor([trust.authorityKeyId]), trustedPredecessorSignerIds: [trust.authorityKeyId], planRegistry: registryFor([trust.firstPlanSignerKeyId]), trustedPlanSignerIds: [trust.firstPlanSignerKeyId],
  currentWitnessRegistry: registryFor(trust.epoch2WitnessKeyIds), trustedCurrentWitnessIds: trust.epoch2WitnessKeyIds, nextWitnessRegistry: registryFor(trust.epoch3WitnessKeyIds), trustedNextWitnessIds: trust.epoch3WitnessKeyIds,
  recoveryAuthorityRegistry: registryFor([trust.authorityKeyId]), trustedRecoveryAuthorityIds: [trust.authorityKeyId],
};
const secondTrust = {
  predecessorRegistry: registryFor([trust.authorityKeyId]), trustedPredecessorSignerIds: [trust.authorityKeyId], planRegistry: registryFor([trust.secondPlanSignerKeyId]), trustedPlanSignerIds: [trust.secondPlanSignerKeyId],
  currentWitnessRegistry: registryFor(trust.epoch3WitnessKeyIds), trustedCurrentWitnessIds: trust.epoch3WitnessKeyIds, nextWitnessRegistry: registryFor(trust.epoch4WitnessKeyIds), trustedNextWitnessIds: trust.epoch4WitnessKeyIds,
  recoveryAuthorityRegistry: registryFor([trust.authorityKeyId]), trustedRecoveryAuthorityIds: [trust.authorityKeyId],
};
const handoffTrust = {
  predecessorLeaseRegistry: registryFor([trust.authorityKeyId]), trustedPredecessorLeaseSignerIds: [trust.authorityKeyId], outgoingCoordinatorRegistry: registryFor([trust.activeCoordinatorKeyId]), trustedOutgoingCoordinatorIds: [trust.activeCoordinatorKeyId],
  replacementCoordinatorRegistry: registryFor([trust.replacementCoordinatorKeyId]), trustedReplacementCoordinatorIds: [trust.replacementCoordinatorKeyId], witnessRegistry: registryFor(trust.epoch2WitnessKeyIds),
  trustedWitnessIds: trust.epoch2WitnessKeyIds, witnesses: trust.epoch2Witnesses, quorum: 3, recoveryAuthorityRegistry: registryFor([trust.authorityKeyId]), trustedRecoveryAuthorityIds: [trust.authorityKeyId],
};
const publicationTrust = {
  priorPinRegistry: registryFor([trust.pinAuthorityKeyId]), trustedPriorPinSignerIds: [trust.pinAuthorityKeyId], requestRegistry: registryFor([trust.requestSignerKeyId]), trustedRequestSignerIds: [trust.requestSignerKeyId],
  publisherRegistry: registryFor([trust.publisherKeyId]), trustedPublisherIds: [trust.publisherKeyId], publisher: trust.publisher, platformOwnerOrganizationId: trust.platformOwnerOrganizationId,
};
const first = verifyRecoveryEpochV33_34({ bundle: evidence.firstRecovery, trust: firstTrust, verifiedAt });
const second = verifyRecoveryEpochV33_34({ bundle: evidence.secondRecovery, trust: secondTrust, verifiedAt });
const handoff = verifyCoordinatorHandoffV33_34({ bundle: evidence.handoff, trust: handoffTrust, verifiedAt });
const publication = verifyRecoveryPublicationV33_34({ bundle: evidence.publication, trust: publicationTrust, verifiedAt });
if (!allKeys.verifyAt(evidence.verdict, verifiedAt)) throw new Error('v33_34_verdict_signature_invalid');
const verdictMaterial = { ...evidence.verdict.payload }; delete verdictMaterial.verdictDigest;
if (evidence.verdict.payload.verdictDigest !== sha256(verdictMaterial)) throw new Error('v33_34_verdict_digest_invalid');
if (evidence.verdict.payload.firstRecoveryCertificateDigest !== first.certificateDigest || evidence.verdict.payload.secondRecoveryCertificateDigest !== second.certificateDigest || evidence.verdict.payload.handoffDigest !== handoff.handoffDigest || evidence.verdict.payload.publicationReceiptDigest !== publication.receiptDigest || evidence.verdict.payload.externalTopologyObserved !== false || evidence.verdict.payload.externalHumanParticipants !== 0 || evidence.verdict.payload.productionAuthority !== 'NONE' || evidence.verdict.payload.externalEffectsExecuted !== 0) throw new Error('v33_34_verdict_binding_invalid');

const envelopes = [
  evidence.predecessor.rotation, evidence.predecessor.lease, evidence.predecessor.pin,
  evidence.firstRecovery.plan, ...evidence.firstRecovery.witnessVotes, ...evidence.firstRecovery.activations, evidence.firstRecovery.certificate,
  evidence.secondRecovery.plan, ...evidence.secondRecovery.witnessVotes, ...evidence.secondRecovery.activations, evidence.secondRecovery.certificate,
  evidence.handoff.relinquishment, evidence.handoff.acceptance, ...evidence.handoff.witnessVotes, evidence.handoff.certificate,
  evidence.publication.request, evidence.publication.receipt, evidence.verdict,
];
if (envelopes.length !== evidence.summary.signatureCount || !envelopes.every((envelope) => allKeys.verifyAt(envelope, verifiedAt))) throw new Error('v33_34_signature_inventory_invalid');
const report = {
  schemaVersion: '1.0.0', version: '33.34', verifiedAt: new Date().toISOString(), status: 'PASS',
  signatureCount: envelopes.length, firstEpoch: first.fromEpoch, finalEpoch: second.toEpoch, sequenceFloor: second.sequenceFloor,
  handoffCutoverSequence: handoff.cutoverSequence, replacementLeaseStart: handoff.sequenceStart,
  publicationClass: publication.publicationClass, networkFetchObserved: publication.networkFetchObserved,
  truthBoundary: evidence.truthBoundary,
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
