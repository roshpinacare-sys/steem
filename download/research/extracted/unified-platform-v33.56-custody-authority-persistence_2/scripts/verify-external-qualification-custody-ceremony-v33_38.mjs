import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { KeyRegistry } from '../dist/src/contracts/crypto.js';
import {
  verifyDeploymentReadinessV33_37,
  verifyExternalQualificationEvidenceImportV33_37,
} from '../dist/src/app/external-qualification-deployment-import-v33_37.js';
import {
  verifyCustodyCeremonyV33_38,
  verifyCustodyTransparencyCheckpointV33_38,
  verifyExternalCustodyQualificationV33_38,
  verifyOneTimeProvisioningEvidenceV33_38,
  verifyRoleLifecycleChainV33_38,
} from '../dist/src/app/external-qualification-custody-ceremony-v33_38.js';

const input = resolve(process.argv[2] ?? 'release-evidence/v33.38/V33_38_CUSTODY_CEREMONY_PROOF.json');
const output = resolve(process.argv[3] ?? 'release-evidence/v33.38/V33_38_INDEPENDENT_VERIFICATION.json');
const proof = JSON.parse(readFileSync(input, 'utf8'));
const registry = new KeyRegistry();
for (const record of proof.publicKeys ?? []) registry.registerExported(record);
const trusted = proof.trustedIds;
const importTrust = {
  deploymentAuthorityRegistry: registry, trustedDeploymentAuthorityIds: trusted.deploymentAuthority,
  roleRegistry: registry,
  evidenceExporterRegistry: registry, trustedEvidenceExporterIds: trusted.exporter,
  evidenceImporterRegistry: registry, trustedEvidenceImporterIds: trusted.importer,
  recoveryVerifierRegistry: registry, trustedRecoveryVerifierIds: trusted.recoveryVerifier,
};
const custodyTrust = {
  deploymentAuthorityRegistry: registry, trustedDeploymentAuthorityIds: trusted.deploymentAuthority,
  provisioningAuthorityRegistry: registry, trustedProvisioningAuthorityIds: trusted.provisioningAuthority,
  roleRegistry: registry,
  ceremonyRecorderRegistry: registry, trustedCeremonyRecorderIds: trusted.ceremonyRecorder,
  ceremonyWitnessRegistry: registry, trustedCeremonyWitnessIds: trusted.ceremonyWitnesses,
  lifecycleAuthorityRegistry: registry, trustedLifecycleAuthorityIds: trusted.lifecycleAuthority,
  securityCustodianRegistry: registry, trustedSecurityCustodianIds: trusted.securityCustodians,
  transparencyLogRegistry: registry, trustedTransparencyLogIds: trusted.transparencyLog,
  transparencyWitnessRegistry: registry, trustedTransparencyWitnessIds: trusted.transparencyWitnesses,
};
const verificationTime = new Date('2026-07-22T20:00:00.000Z');
const envelopes = [
  proof.manifest,
  ...proof.acceptances,
  proof.importChallenge,
  proof.importBundle,
  proof.importRecovery,
  ...proof.provisioningChallenges,
  ...proof.provisioningResponses,
  ...proof.provisioningReceipts,
  proof.transcript,
  ...proof.ceremonyWitnesses,
  proof.lifecycleProposal,
  proof.currentConsent,
  proof.replacementAcceptance,
  ...proof.securityApprovals,
  proof.lifecycleCertificate,
  proof.transparencySnapshot,
  ...proof.transparencyWitnesses,
];
const signaturesValid = envelopes.every((envelope) => registry.verifyAt(envelope, verificationTime));
const readiness = verifyDeploymentReadinessV33_37({ manifest: proof.manifest, acceptances: proof.acceptances, trust: importTrust, verifiedAt: new Date(proof.readiness.verifiedAt) });
const fileBytes = Object.fromEntries(Object.entries(proof.importFileBytesBase64).map(([path, encoded]) => [path, Buffer.from(encoded, 'base64')]));
const importReceipt = verifyExternalQualificationEvidenceImportV33_37({
  manifest: proof.manifest,
  readiness,
  challenge: proof.importChallenge,
  bundle: proof.importBundle,
  fileBytes,
  recovery: proof.importRecovery,
  trust: importTrust,
  consumedChallengeDigests: new Set(),
  importedAt: new Date(proof.importReceipt.importedAt),
});
for (let index = 0; index < proof.provisioningReceipts.length; index++) {
  verifyOneTimeProvisioningEvidenceV33_38({
    manifest: proof.manifest,
    challenge: proof.provisioningChallenges[index],
    response: proof.provisioningResponses[index],
    receipt: proof.provisioningReceipts[index],
    trust: custodyTrust,
    verifiedAt: verificationTime,
  });
}
const ceremonyVerdict = verifyCustodyCeremonyV33_38({
  manifest: proof.manifest,
  challenges: proof.provisioningChallenges,
  responses: proof.provisioningResponses,
  receipts: proof.provisioningReceipts,
  transcript: proof.transcript,
  witnesses: proof.ceremonyWitnesses,
  trust: custodyTrust,
  verifiedAt: new Date(proof.ceremonyVerdict.verifiedAt),
});
const lifecycle = verifyRoleLifecycleChainV33_38({ certificates: [proof.lifecycleCertificate], trust: custodyTrust, manifest: proof.manifest.payload, transcriptDigest: proof.transcript.payload.transcriptDigest, verifiedAt: verificationTime });
verifyCustodyTransparencyCheckpointV33_38({ snapshot: proof.transparencySnapshot, witnesses: proof.transparencyWitnesses, trust: custodyTrust, verifiedAt: verificationTime });
const finalVerdict = verifyExternalCustodyQualificationV33_38({
  manifest: proof.manifest,
  ceremonyVerdict,
  provisioningChallenges: proof.provisioningChallenges,
  provisioningResponses: proof.provisioningResponses,
  provisioningReceipts: proof.provisioningReceipts,
  ceremonyTranscript: proof.transcript,
  ceremonyWitnesses: proof.ceremonyWitnesses,
  lifecycleEvidence: [{ proposal: proof.lifecycleProposal, currentKeyConsent: proof.currentConsent, replacementKeyAcceptance: proof.replacementAcceptance, securityApprovals: proof.securityApprovals, certificate: proof.lifecycleCertificate }],
  importReceipt,
  importReadiness: readiness,
  importChallenge: proof.importChallenge,
  importBundle: proof.importBundle,
  importFileBytes: fileBytes,
  importRecovery: proof.importRecovery,
  importTrust,
  transparencySnapshot: proof.transparencySnapshot,
  transparencyWitnesses: proof.transparencyWitnesses,
  trust: custodyTrust,
  verifiedAt: verificationTime,
});
const checks = {
  version: proof.version === '33.38',
  signaturesValid,
  signatureCount: envelopes.length === proof.summary.signatureCount && envelopes.length === 60,
  readinessRecomputed: readiness.verdictDigest === proof.readiness.verdictDigest,
  importRecomputed: importReceipt.importDigest === proof.importReceipt.importDigest,
  provisioningVerified: proof.provisioningReceipts.length === 11,
  ceremonyRecomputed: ceremonyVerdict.verdictDigest === proof.ceremonyVerdict.verdictDigest,
  lifecycleVerified: lifecycle.headDigest === proof.lifecycleCertificate.payload.lifecycleDigest,
  transparencyVerified: proof.transparencySnapshot.payload.eventCount === 14,
  finalVerdictRecomputed: finalVerdict.verdictDigest === proof.finalVerdict.verdictDigest,
  attacksVerified: Object.values(proof.attacks ?? {}).length === 4 && Object.values(proof.attacks ?? {}).every(Boolean),
  truthBoundary: proof.truthBoundary?.executionClass === 'LOCAL_REHEARSAL' && proof.truthBoundary?.externalTopologyObserved === false && proof.truthBoundary?.externalRoleOwnersObserved === 0 && proof.truthBoundary?.externalHumanParticipants === 0 && proof.truthBoundary?.productionAuthority === 'NONE' && proof.truthBoundary?.externalEffectsExecuted === 0 && proof.truthBoundary?.productionPromotion === 'blocked',
  productionBlocked: finalVerdict.productionAuthority === 'NONE' && finalVerdict.externalEffectsExecuted === 0,
};
const status = Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL';
const report = {
  version: '33.38',
  generatedAt: new Date().toISOString(),
  status,
  signatureCount: envelopes.length,
  roleCount: proof.provisioningReceipts.length,
  transparencyEventCount: proof.transparencySnapshot.payload.eventCount,
  lifecycleHeadDigest: lifecycle.headDigest,
  importStatus: importReceipt.status,
  finalStatus: finalVerdict.status,
  externalTopologyObserved: finalVerdict.externalTopologyObserved,
  externalHumanParticipants: finalVerdict.externalHumanParticipants,
  productionAuthority: finalVerdict.productionAuthority,
  checks,
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (status !== 'PASS') process.exit(1);
