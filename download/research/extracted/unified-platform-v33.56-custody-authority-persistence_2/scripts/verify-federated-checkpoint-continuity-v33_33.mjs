import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { KeyRegistry, sha256 } from '../dist/src/contracts/crypto.js';
import {
  detectCoordinatorSplitBrainV33_33,
  detectTransparencySplitViewV33_33,
  verifyCoordinatorLeaseV33_33,
  verifyEpochRotationV33_33,
  verifyTransparencyPinV33_33,
} from '../dist/src/app/federated-checkpoint-continuity-v33_33.js';

const inputPath = resolve(process.argv[2] ?? 'release-evidence/v33.33/V33_33_CONTINUITY_PROOF.json');
const outputPath = resolve(process.argv[3] ?? 'release-evidence/v33.33/V33_33_INDEPENDENT_VERIFICATION.json');
const proof = JSON.parse(readFileSync(inputPath, 'utf8'));
const registry = new KeyRegistry();
for (const record of proof.publicKeys) registry.registerExported(record);
const ids = (rows) => rows.map((row) => row.keyId);
const currentWitnesses = proof.rotation.currentPolicy.payload.witnesses;
const nextWitnesses = proof.rotation.plan.payload.witnesses;
const rotationTrust = {
  currentPolicyRegistry: registry, trustedCurrentPolicySignerIds: [proof.rotation.currentPolicy.issuerKeyId],
  currentAnchorRegistry: registry, trustedCurrentAnchorSignerIds: [proof.rotation.currentAnchor.issuerKeyId],
  currentWitnessRegistry: registry, trustedCurrentWitnessIds: ids(currentWitnesses),
  nextWitnessRegistry: registry, trustedNextWitnessIds: ids(nextWitnesses),
  planRegistry: registry, trustedPlanSignerIds: [proof.rotation.plan.issuerKeyId],
  rotationAuthorityRegistry: registry, trustedRotationAuthorityIds: [proof.rotation.certificate.issuerKeyId],
};
const leaseTrust = {
  planRegistry: registry, trustedPlanSignerIds: [proof.lease.plan.issuerKeyId],
  coordinatorRegistry: registry, trustedCoordinatorIds: [proof.lease.proposal.issuerKeyId],
  witnessRegistry: registry, trustedWitnessIds: ids(nextWitnesses),
  rotationAuthorityRegistry: registry, trustedRotationAuthorityIds: [proof.lease.certificate.issuerKeyId],
};
const transparencyTrust = {
  logOperatorRegistry: registry, trustedLogOperatorIds: [proof.descriptors.logOperator.keyId], logOperator: proof.descriptors.logOperator,
  monitorRegistry: registry, trustedMonitorIds: ids(proof.descriptors.monitors), monitors: proof.descriptors.monitors,
  monitorQuorum: proof.transparency.certificate.payload.quorumRequired,
  pinAuthorityRegistry: registry, trustedPinAuthorityIds: [proof.descriptors.pinAuthority.keyId], pinAuthority: proof.descriptors.pinAuthority,
  platformOwnerOrganizationId: proof.descriptors.platformOwnerOrganizationId,
};
const verifiedAt = new Date(proof.verdict.payload.generatedAt);
const rotation = verifyEpochRotationV33_33({ bundle: proof.rotation, trust: rotationTrust, verifiedAt });
const lease = verifyCoordinatorLeaseV33_33({ bundle: proof.lease, trust: leaseTrust, verifiedAt });
const pin = verifyTransparencyPinV33_33({ bundle: proof.transparency, trust: transparencyTrust, verifiedAt });
if (!registry.verifyAt(proof.verdict, verifiedAt)) throw new Error('v33_33_verdict_signature_invalid');
const { verdictDigest, ...verdictMaterial } = proof.verdict.payload;
if (verdictDigest !== sha256(verdictMaterial)) throw new Error('v33_33_verdict_digest_invalid');
if (proof.truthBoundary.proofClass !== 'SYNTHETIC_LOCAL_PROTOCOL_PROOF' || proof.truthBoundary.externalTopologyObserved !== false || proof.truthBoundary.externalHumanParticipants !== 0 || proof.truthBoundary.productionAuthority !== 'NONE' || proof.truthBoundary.externalEffectsExecuted !== 0) throw new Error('v33_33_truth_boundary_invalid');
if (detectCoordinatorSplitBrainV33_33([proof.lease.certificate]).length !== 0) throw new Error('v33_33_split_brain_present');
if (detectTransparencySplitViewV33_33([proof.transparency.certificate]).length !== 0) throw new Error('v33_33_split_view_present');
const result = {
  schemaVersion: '1.0.0', version: '33.33', verifiedAt: new Date().toISOString(), status: 'PASS',
  verified: {
    rotationCertificateDigest: rotation.certificateDigest,
    leaseDigest: lease.leaseDigest,
    transparencyPinDigest: pin.pinDigest,
    verdictDigest,
    signatureCount: proof.summary.signatureCount,
    logEntries: proof.transparency.entries.length,
    oldWitnessVotes: proof.rotation.oldWitnessVotes.length,
    nextWitnessActivationProofs: proof.rotation.activationProofs.length,
    leaseWitnessVotes: proof.lease.votes.length,
    monitorVotes: proof.transparency.monitorVotes.length,
  },
  truthBoundary: proof.truthBoundary,
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
