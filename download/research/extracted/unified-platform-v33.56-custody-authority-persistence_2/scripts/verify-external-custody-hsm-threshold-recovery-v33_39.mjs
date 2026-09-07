import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { KeyRegistry } from '../dist/src/contracts/crypto.js';
import { verifyDeploymentReadinessV33_37, verifyExternalQualificationEvidenceImportV33_37 } from '../dist/src/app/external-qualification-deployment-import-v33_37.js';
import {
  verifyCustodyCeremonyV33_38, verifyCustodyTransparencyCheckpointV33_38,
  verifyExternalCustodyQualificationV33_38, verifyOneTimeProvisioningEvidenceV33_38,
  verifyRoleLifecycleChainV33_38,
} from '../dist/src/app/external-qualification-custody-ceremony-v33_38.js';
import { verifyExternalCustodyHardwareQualificationV33_39 } from '../dist/src/app/external-custody-hsm-threshold-recovery-v33_39.js';

const input = resolve(process.argv[2] ?? 'release-evidence/v33.39/V33_39_HSM_THRESHOLD_RECOVERY_PROOF.json');
const output = resolve(process.argv[3] ?? 'release-evidence/v33.39/V33_39_INDEPENDENT_VERIFICATION.json');
const proof = JSON.parse(readFileSync(input, 'utf8'));

function recomputePrior(prior) {
  const registry = new KeyRegistry();
  for (const record of prior.publicKeys ?? []) registry.registerExported(record);
  const trusted = prior.trustedIds;
  const importTrust = {
    deploymentAuthorityRegistry: registry, trustedDeploymentAuthorityIds: trusted.deploymentAuthority,
    roleRegistry: registry, evidenceExporterRegistry: registry, trustedEvidenceExporterIds: trusted.exporter,
    evidenceImporterRegistry: registry, trustedEvidenceImporterIds: trusted.importer,
    recoveryVerifierRegistry: registry, trustedRecoveryVerifierIds: trusted.recoveryVerifier,
  };
  const custodyTrust = {
    deploymentAuthorityRegistry: registry, trustedDeploymentAuthorityIds: trusted.deploymentAuthority,
    provisioningAuthorityRegistry: registry, trustedProvisioningAuthorityIds: trusted.provisioningAuthority,
    roleRegistry: registry, ceremonyRecorderRegistry: registry, trustedCeremonyRecorderIds: trusted.ceremonyRecorder,
    ceremonyWitnessRegistry: registry, trustedCeremonyWitnessIds: trusted.ceremonyWitnesses,
    lifecycleAuthorityRegistry: registry, trustedLifecycleAuthorityIds: trusted.lifecycleAuthority,
    securityCustodianRegistry: registry, trustedSecurityCustodianIds: trusted.securityCustodians,
    transparencyLogRegistry: registry, trustedTransparencyLogIds: trusted.transparencyLog,
    transparencyWitnessRegistry: registry, trustedTransparencyWitnessIds: trusted.transparencyWitnesses,
  };
  const verificationTime = new Date('2026-07-22T20:00:00.000Z');
  const readiness = verifyDeploymentReadinessV33_37({ manifest: prior.manifest, acceptances: prior.acceptances, trust: importTrust, verifiedAt: new Date(prior.readiness.verifiedAt) });
  const fileBytes = Object.fromEntries(Object.entries(prior.importFileBytesBase64).map(([path, encoded]) => [path, Buffer.from(encoded, 'base64')]));
  const importReceipt = verifyExternalQualificationEvidenceImportV33_37({ manifest: prior.manifest, readiness, challenge: prior.importChallenge, bundle: prior.importBundle, fileBytes, recovery: prior.importRecovery, trust: importTrust, consumedChallengeDigests: new Set(), importedAt: new Date(prior.importReceipt.importedAt) });
  for (let i = 0; i < prior.provisioningReceipts.length; i++) verifyOneTimeProvisioningEvidenceV33_38({ manifest: prior.manifest, challenge: prior.provisioningChallenges[i], response: prior.provisioningResponses[i], receipt: prior.provisioningReceipts[i], trust: custodyTrust, verifiedAt: verificationTime });
  const ceremonyVerdict = verifyCustodyCeremonyV33_38({ manifest: prior.manifest, challenges: prior.provisioningChallenges, responses: prior.provisioningResponses, receipts: prior.provisioningReceipts, transcript: prior.transcript, witnesses: prior.ceremonyWitnesses, trust: custodyTrust, verifiedAt: new Date(prior.ceremonyVerdict.verifiedAt) });
  verifyRoleLifecycleChainV33_38({ certificates: [prior.lifecycleCertificate], trust: custodyTrust, manifest: prior.manifest.payload, transcriptDigest: prior.transcript.payload.transcriptDigest, verifiedAt: verificationTime });
  verifyCustodyTransparencyCheckpointV33_38({ snapshot: prior.transparencySnapshot, witnesses: prior.transparencyWitnesses, trust: custodyTrust, verifiedAt: verificationTime });
  return verifyExternalCustodyQualificationV33_38({
    manifest: prior.manifest, ceremonyVerdict,
    provisioningChallenges: prior.provisioningChallenges, provisioningResponses: prior.provisioningResponses, provisioningReceipts: prior.provisioningReceipts,
    ceremonyTranscript: prior.transcript, ceremonyWitnesses: prior.ceremonyWitnesses,
    lifecycleEvidence: [{ proposal: prior.lifecycleProposal, currentKeyConsent: prior.currentConsent, replacementKeyAcceptance: prior.replacementAcceptance, securityApprovals: prior.securityApprovals, certificate: prior.lifecycleCertificate }],
    importReceipt, importReadiness: readiness, importChallenge: prior.importChallenge, importBundle: prior.importBundle, importFileBytes: fileBytes, importRecovery: prior.importRecovery, importTrust,
    transparencySnapshot: prior.transparencySnapshot, transparencyWitnesses: prior.transparencyWitnesses, trust: custodyTrust, verifiedAt: verificationTime,
  });
}

const priorVerdict = recomputePrior(proof.priorV33_38Proof);
const registry = new KeyRegistry();
for (const record of proof.publicKeys ?? []) registry.registerExported(record);
const trusted = proof.trustedIds;
const trust = {
  hardwareAttestationRegistry: registry, trustedHardwareAttestationAuthorityIds: trusted.hardwareAttestationAuthorities,
  thresholdCustodianRegistry: registry, trustedThresholdCustodianIds: trusted.thresholdCustodians,
  thresholdAuthorityRegistry: registry, trustedThresholdAuthorityIds: trusted.thresholdAuthorities,
  transferAuthorityRegistry: registry, trustedTransferAuthorityIds: trusted.transferAuthorities,
  publicationAuthorityRegistry: registry, trustedPublicationAuthorityIds: trusted.publicationAuthorities,
  monitorRegistry: registry, trustedMonitorIds: trusted.monitors,
  recoveryVerifierRegistry: registry, trustedRecoveryVerifierIds: trusted.recoveryVerifiers,
};
const verificationTime = new Date('2026-07-22T20:30:00.000Z');
const envelopes = [
  ...proof.hardwareAttestations, proof.rotatedAttestation,
  ...proof.thresholdEvidence.flatMap((row) => [...row.approvals, row.certificate]),
  proof.transfer, proof.publication, ...proof.retrievalReceipts, ...proof.revocationReceipts, proof.recoveryReceipt,
];
const signaturesValid = envelopes.every((envelope) => registry.verifyAt(envelope, verificationTime));
const finalVerdict = verifyExternalCustodyHardwareQualificationV33_39({
  priorCustodyVerdict: priorVerdict,
  manifestDigest: proof.manifestDigest,
  transcriptDigest: proof.transcriptDigest,
  expectedRoles: proof.expectedRoles,
  hardwareAttestations: proof.hardwareAttestations,
  thresholdEvidence: proof.thresholdEvidence,
  custodyTransfer: proof.transfer,
  transferSourceAttestation: proof.hardwareAttestations[0],
  transferTargetAttestation: proof.rotatedAttestation,
  sealedTransferMaterial: Buffer.from(proof.sealedTransferMaterialBase64, 'base64'),
  transferNonce: Buffer.from(proof.transferNonceBase64, 'base64'),
  publicCheckpoint: proof.publication,
  publicCheckpointBytes: Buffer.from(proof.checkpointBytesBase64, 'base64'),
  retrievalReceipts: proof.retrievalReceipts,
  revocationReceipts: proof.revocationReceipts,
  revocationLifecycleDigest: proof.lifecycleDigest,
  revokedKeyId: proof.revokedKeyId,
  recoveryReceipt: proof.recoveryReceipt,
  incident: Buffer.from(proof.incidentBase64, 'base64'),
  backupInventory: Buffer.from(proof.backupInventoryBase64, 'base64'),
  restoredArtifact: Buffer.from(proof.restoredArtifactBase64, 'base64'),
  trust,
  verifiedAt: verificationTime,
});
const checks = {
  version: proof.version === '33.39',
  priorV33_38Recomputed: priorVerdict.verdictDigest === proof.priorV33_38Verdict.verdictDigest,
  signaturesValid,
  signatureCount: envelopes.length === proof.summary.signatureCount && envelopes.length === 33,
  hardwareCount: proof.hardwareAttestations.length === 11 && proof.summary.hardwareAttestationCount === 11,
  thresholdChainCount: proof.thresholdEvidence.length === 3 && proof.summary.thresholdCertificateCount === 3,
  retrievalQuorum: proof.retrievalReceipts.length === 3,
  revocationQuorum: proof.revocationReceipts.length === 3,
  finalVerdictRecomputed: finalVerdict.verdictDigest === proof.finalVerdict.verdictDigest,
  attacksVerified: Object.keys(proof.attacks ?? {}).length === 5 && Object.values(proof.attacks ?? {}).every(Boolean),
  truthBoundary: proof.truthBoundary?.executionClass === 'LOCAL_REHEARSAL' && proof.truthBoundary?.externalTopologyObserved === false && proof.truthBoundary?.externalHardwareObserved === false && proof.truthBoundary?.externalRoleOwnersObserved === 0 && proof.truthBoundary?.externalHumanParticipants === 0 && proof.truthBoundary?.productionAuthority === 'NONE' && proof.truthBoundary?.externalEffectsExecuted === 0 && proof.truthBoundary?.g3 === 'blocked' && proof.truthBoundary?.productionPromotion === 'blocked',
  productionBlocked: finalVerdict.status === 'LOCAL_HSM_THRESHOLD_RECOVERY_REHEARSAL_ONLY' && finalVerdict.productionAuthority === 'NONE' && finalVerdict.externalEffectsExecuted === 0,
};
const status = Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL';
const report = {
  version: '33.39', generatedAt: new Date().toISOString(), status,
  signatureCount: envelopes.length, hardwareAttestationCount: proof.hardwareAttestations.length,
  thresholdCertificateCount: proof.thresholdEvidence.length, retrievalReceiptCount: proof.retrievalReceipts.length,
  revocationReceiptCount: proof.revocationReceipts.length, finalStatus: finalVerdict.status,
  externalTopologyObserved: finalVerdict.externalTopologyObserved, externalHardwareObserved: finalVerdict.externalHardwareObserved,
  externalHumanParticipants: finalVerdict.externalHumanParticipants, productionAuthority: finalVerdict.productionAuthority, checks,
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (status !== 'PASS') process.exit(1);
