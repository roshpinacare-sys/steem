import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  KeyRegistry, generateSigningIdentity, sha256, sha256Bytes,
} from '../dist/src/contracts/crypto.js';
import {
  verifyDeploymentReadinessV33_37, verifyExternalQualificationEvidenceImportV33_37,
} from '../dist/src/app/external-qualification-deployment-import-v33_37.js';
import {
  custodyRoleAssignmentsV33_38, verifyCustodyCeremonyV33_38,
  verifyCustodyTransparencyCheckpointV33_38, verifyExternalCustodyQualificationV33_38,
  verifyOneTimeProvisioningEvidenceV33_38, verifyRoleLifecycleChainV33_38,
} from '../dist/src/app/external-qualification-custody-ceremony-v33_38.js';
import {
  createHardwareKeyAttestationV33_39, createPublicCheckpointPublicationV33_39,
  createPublicCheckpointRetrievalReceiptV33_39, createRevocationPropagationReceiptV33_39,
  createSealedCustodyTransferPackageV33_39, createSiteLossRecoveryReceiptV33_39,
  createThresholdCustodianApprovalV33_39, finalizeThresholdOperationV33_39,
  verifyExternalCustodyHardwareQualificationV33_39,
} from '../dist/src/app/external-custody-hsm-threshold-recovery-v33_39.js';

const priorPath = resolve(process.argv[2] ?? 'release-evidence/v33.38/V33_38_CUSTODY_CEREMONY_PROOF.json');
const output = resolve(process.argv[3] ?? 'release-evidence/v33.39/V33_39_HSM_THRESHOLD_RECOVERY_PROOF.json');
const prior = JSON.parse(readFileSync(priorPath, 'utf8'));

function recomputePrior(proof) {
  const registry = new KeyRegistry();
  for (const record of proof.publicKeys ?? []) registry.registerExported(record);
  const trusted = proof.trustedIds;
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
  const readiness = verifyDeploymentReadinessV33_37({ manifest: proof.manifest, acceptances: proof.acceptances, trust: importTrust, verifiedAt: new Date(proof.readiness.verifiedAt) });
  const fileBytes = Object.fromEntries(Object.entries(proof.importFileBytesBase64).map(([path, encoded]) => [path, Buffer.from(encoded, 'base64')]));
  const importReceipt = verifyExternalQualificationEvidenceImportV33_37({ manifest: proof.manifest, readiness, challenge: proof.importChallenge, bundle: proof.importBundle, fileBytes, recovery: proof.importRecovery, trust: importTrust, consumedChallengeDigests: new Set(), importedAt: new Date(proof.importReceipt.importedAt) });
  for (let index = 0; index < proof.provisioningReceipts.length; index++) verifyOneTimeProvisioningEvidenceV33_38({ manifest: proof.manifest, challenge: proof.provisioningChallenges[index], response: proof.provisioningResponses[index], receipt: proof.provisioningReceipts[index], trust: custodyTrust, verifiedAt: verificationTime });
  const ceremonyVerdict = verifyCustodyCeremonyV33_38({ manifest: proof.manifest, challenges: proof.provisioningChallenges, responses: proof.provisioningResponses, receipts: proof.provisioningReceipts, transcript: proof.transcript, witnesses: proof.ceremonyWitnesses, trust: custodyTrust, verifiedAt: new Date(proof.ceremonyVerdict.verifiedAt) });
  verifyRoleLifecycleChainV33_38({ certificates: [proof.lifecycleCertificate], trust: custodyTrust, manifest: proof.manifest.payload, transcriptDigest: proof.transcript.payload.transcriptDigest, verifiedAt: verificationTime });
  verifyCustodyTransparencyCheckpointV33_38({ snapshot: proof.transparencySnapshot, witnesses: proof.transparencyWitnesses, trust: custodyTrust, verifiedAt: verificationTime });
  const finalVerdict = verifyExternalCustodyQualificationV33_38({
    manifest: proof.manifest, ceremonyVerdict,
    provisioningChallenges: proof.provisioningChallenges, provisioningResponses: proof.provisioningResponses, provisioningReceipts: proof.provisioningReceipts,
    ceremonyTranscript: proof.transcript, ceremonyWitnesses: proof.ceremonyWitnesses,
    lifecycleEvidence: [{ proposal: proof.lifecycleProposal, currentKeyConsent: proof.currentConsent, replacementKeyAcceptance: proof.replacementAcceptance, securityApprovals: proof.securityApprovals, certificate: proof.lifecycleCertificate }],
    importReceipt, importReadiness: readiness, importChallenge: proof.importChallenge, importBundle: proof.importBundle, importFileBytes: fileBytes, importRecovery: proof.importRecovery, importTrust,
    transparencySnapshot: proof.transparencySnapshot, transparencyWitnesses: proof.transparencyWitnesses, trust: custodyTrust, verifiedAt: verificationTime,
  });
  if (finalVerdict.verdictDigest !== proof.finalVerdict.verdictDigest) throw new Error('prior_v33_38_verdict_mismatch');
  return finalVerdict;
}

const priorVerdict = recomputePrior(prior);
const registry = new KeyRegistry();
const identities = [];
const id = (keyId) => { const row = generateSigningIdentity(keyId); registry.register(row.keyId, row.publicKey); identities.push(row); return row; };
const desc = (identity, suffix) => ({ keyId: identity.keyId, keyFingerprint: registry.fingerprint(identity.keyId), organizationId: `org-v33-39-${suffix}`, hostId: `host-v33-39-${suffix}`, administratorId: `admin-v33-39-${suffix}` });
const attestationAuthority = id('v33.39-attestation-authority');
const thresholdAuthority = id('v33.39-threshold-authority');
const transferAuthority = id('v33.39-transfer-authority');
const publicationAuthority = id('v33.39-publication-authority');
const recoveryVerifier = id('v33.39-recovery-verifier');
const custodians = Array.from({ length: 5 }, (_, i) => id(`v33.39-threshold-custodian-${i + 1}`));
const custodianDescriptors = custodians.map((row, i) => desc(row, `custodian-${i + 1}`));
const monitors = Array.from({ length: 3 }, (_, i) => id(`v33.39-monitor-${i + 1}`));
const monitorDescriptors = monitors.map((row, i) => desc(row, `monitor-${i + 1}`));
const rotatedPublisher = id('v33.39-rotated-publisher');
const rotatedPublisherDescriptor = desc(rotatedPublisher, 'rotated-publisher');
const recoveryVerifierDescriptor = desc(recoveryVerifier, 'recovery-verifier');
const manifestDigest = prior.manifest.payload.manifestDigest;
const transcriptDigest = prior.transcript.payload.transcriptDigest;
const expectedRoles = custodyRoleAssignmentsV33_38(prior.manifest.payload);
const trust = {
  hardwareAttestationRegistry: registry, trustedHardwareAttestationAuthorityIds: [attestationAuthority.keyId],
  thresholdCustodianRegistry: registry, trustedThresholdCustodianIds: custodians.map((row) => row.keyId),
  thresholdAuthorityRegistry: registry, trustedThresholdAuthorityIds: [thresholdAuthority.keyId],
  transferAuthorityRegistry: registry, trustedTransferAuthorityIds: [transferAuthority.keyId],
  publicationAuthorityRegistry: registry, trustedPublicationAuthorityIds: [publicationAuthority.keyId],
  monitorRegistry: registry, trustedMonitorIds: monitors.map((row) => row.keyId),
  recoveryVerifierRegistry: registry, trustedRecoveryVerifierIds: [recoveryVerifier.keyId],
};
const hardwareAttestations = expectedRoles.map((row, i) => createHardwareKeyAttestationV33_39({
  authority: attestationAuthority, manifestDigest, transcriptDigest, roleSlot: row.roleSlot, actor: row.actor,
  providerClass: 'TPM_BOUND', providerId: `local-tpm-provider-${i + 1}`, deviceId: `local-device-${i + 1}`,
  deviceFirmware: Buffer.from(`local-firmware-image-${i + 1}-v1`), issuedAt: new Date('2026-07-22T20:00:00.000Z'), expiresAt: new Date('2026-08-22T20:00:00.000Z'), executionClass: 'LOCAL_REHEARSAL',
}));
const rotatedAttestation = createHardwareKeyAttestationV33_39({
  authority: attestationAuthority, manifestDigest, transcriptDigest, roleSlot: 'PUBLISHER', actor: rotatedPublisherDescriptor,
  providerClass: 'TPM_BOUND', providerId: 'local-tpm-provider-rotated', deviceId: 'local-device-rotated',
  deviceFirmware: Buffer.from('local-firmware-image-rotated-v1'), issuedAt: new Date('2026-07-22T20:00:00.000Z'), expiresAt: new Date('2026-08-22T20:00:00.000Z'), executionClass: 'LOCAL_REHEARSAL',
});
const thresholdEvidence = [];
function threshold(operationDigest, operationType, thresholdSequence, previousThresholdDigest) {
  const approvals = custodians.slice(0, 3).map((custodian, i) => createThresholdCustodianApprovalV33_39({ custodian, custodianDescriptor: custodianDescriptors[i], operationDigest, operationType, shareIndex: i + 1, approvedAt: new Date(`2026-07-22T20:0${thresholdSequence}:00.000Z`) }));
  const certificate = finalizeThresholdOperationV33_39({ authority: thresholdAuthority, manifestDigest, transcriptDigest, operationDigest, operationType, thresholdSequence, previousThresholdDigest, approvals, trust, issuedAt: new Date(`2026-07-22T20:0${thresholdSequence}:30.000Z`) });
  const evidence = { operationDigest, operationType, approvals, certificate };
  thresholdEvidence.push(evidence);
  return evidence;
}
const checkpointBytes = Buffer.from(JSON.stringify({ version: '33.39', priorCustodyVerdictDigest: priorVerdict.verdictDigest, custodyTransparencyHeadDigest: prior.transparencySnapshot.payload.headEventDigest, sequence: 1 }));
const checkpointOperationDigest = sha256({ priorCustodyVerdictDigest: priorVerdict.verdictDigest, custodyTransparencyHeadDigest: prior.transparencySnapshot.payload.headEventDigest, checkpointSequence: 1, publishedBytesDigest: sha256Bytes(checkpointBytes) });
const checkpointThreshold = threshold(checkpointOperationDigest, 'PUBLIC_CHECKPOINT', 1, null);
const publication = createPublicCheckpointPublicationV33_39({
  authority: publicationAuthority, manifestDigest, transcriptDigest, checkpointSequence: 1, previousPublicationDigest: null,
  priorCustodyVerdictDigest: priorVerdict.verdictDigest, custodyTransparencyHeadDigest: prior.transparencySnapshot.payload.headEventDigest,
  thresholdCertificateDigest: checkpointThreshold.certificate.payload.thresholdDigest, endpoint: 'https://checkpoint.local/v33.39/checkpoint.json', dnsName: 'checkpoint.local',
  publishedBytes: checkpointBytes, publisher: expectedRoles[0].actor, publishedAt: new Date('2026-07-22T20:05:00.000Z'), executionClass: 'LOCAL_REHEARSAL', networkRetrievalObserved: true,
});
const retrievalReceipts = monitors.map((monitor, i) => createPublicCheckpointRetrievalReceiptV33_39({ monitor, monitorDescriptor: monitorDescriptors[i], publication: publication.payload, retrievedBytes: checkpointBytes, retrievedAt: new Date(`2026-07-22T20:0${6 + i}:00.000Z`), networkClass: 'LOCAL_LOOPBACK' }));
const lifecycleDigest = prior.lifecycleCertificate.payload.lifecycleDigest;
const revokedKeyId = prior.lifecycleCertificate.payload.currentActor.keyId;
const revocationThreshold = threshold(sha256({ lifecycleDigest, revokedKeyId }), 'REVOCATION_PROPAGATION', 2, checkpointThreshold.certificate.payload.thresholdDigest);
const revocationReceipts = monitors.map((monitor, i) => createRevocationPropagationReceiptV33_39({ monitor, monitorDescriptor: monitorDescriptors[i], manifestDigest, transcriptDigest, lifecycleDigest, revokedKeyId, revocationSequence: 1, previousRevocationDigest: null, thresholdCertificateDigest: revocationThreshold.certificate.payload.thresholdDigest, appliedAt: new Date(`2026-07-22T20:1${i}:00.000Z`) }));
const incident = Buffer.from('local site loss incident record v33.39');
const backupInventory = Buffer.from('local exact backup inventory v33.39');
const restoredArtifact = Buffer.from('local exact restored artifact v33.39');
const recoverySiteId = 'local-recovery-site-b';
const recoveryOperationDigest = sha256({ incidentDigest: sha256Bytes(incident), priorCheckpointPublicationDigest: publication.payload.publicationDigest, recoverySiteId, backupInventoryDigest: sha256Bytes(backupInventory), restoredArtifactDigest: sha256Bytes(restoredArtifact) });
const recoveryThreshold = threshold(recoveryOperationDigest, 'SITE_RECOVERY', 3, revocationThreshold.certificate.payload.thresholdDigest);
const recoveryReceipt = createSiteLossRecoveryReceiptV33_39({ verifier: recoveryVerifier, verifierDescriptor: recoveryVerifierDescriptor, manifestDigest, transcriptDigest, incident, lostSiteId: 'local-primary-site-a', recoverySiteId, priorCheckpointPublicationDigest: publication.payload.publicationDigest, restoredCheckpointSequence: 1, restoredThresholdHeadDigest: recoveryThreshold.certificate.payload.thresholdDigest, backupInventory, restoredArtifact, thresholdCertificateDigest: recoveryThreshold.certificate.payload.thresholdDigest, recoveredAt: new Date('2026-07-22T20:20:00.000Z'), executionClass: 'LOCAL_REHEARSAL' });
const sealedTransferMaterial = Buffer.from('sealed non-exportable transfer material v33.39');
const transferNonce = Buffer.alloc(32, 39);
const transfer = createSealedCustodyTransferPackageV33_39({ authority: transferAuthority, manifestDigest, transcriptDigest, roleSlot: 'PUBLISHER', sourceActor: expectedRoles[0].actor, targetActor: rotatedPublisherDescriptor, sourceHardwareAttestationDigest: hardwareAttestations[0].payload.attestationDigest, targetHardwareAttestationDigest: rotatedAttestation.payload.attestationDigest, sealedMaterial: sealedTransferMaterial, transferNonce, createdAt: new Date('2026-07-22T20:02:00.000Z'), expiresAt: new Date('2026-07-22T21:02:00.000Z') });
const finalVerdict = verifyExternalCustodyHardwareQualificationV33_39({ priorCustodyVerdict: priorVerdict, manifestDigest, transcriptDigest, expectedRoles, hardwareAttestations, thresholdEvidence, custodyTransfer: transfer, transferSourceAttestation: hardwareAttestations[0], transferTargetAttestation: rotatedAttestation, sealedTransferMaterial, transferNonce, publicCheckpoint: publication, publicCheckpointBytes: checkpointBytes, retrievalReceipts, revocationReceipts, revocationLifecycleDigest: lifecycleDigest, revokedKeyId, recoveryReceipt, incident, backupInventory, restoredArtifact, trust, verifiedAt: new Date('2026-07-22T20:30:00.000Z') });

const attacks = {};
try { finalizeThresholdOperationV33_39({ authority: thresholdAuthority, manifestDigest, transcriptDigest, operationDigest: checkpointOperationDigest, operationType: 'PUBLIC_CHECKPOINT', thresholdSequence: 1, previousThresholdDigest: null, approvals: checkpointThreshold.approvals.slice(0, 2), trust, issuedAt: new Date('2026-07-22T20:01:30.000Z') }); attacks.thresholdBelowQuorumBlocked = false; } catch { attacks.thresholdBelowQuorumBlocked = true; }
try { verifyExternalCustodyHardwareQualificationV33_39({ priorCustodyVerdict: { ...priorVerdict, externalTopologyObserved: true }, manifestDigest, transcriptDigest, expectedRoles, hardwareAttestations, thresholdEvidence, custodyTransfer: transfer, transferSourceAttestation: hardwareAttestations[0], transferTargetAttestation: rotatedAttestation, sealedTransferMaterial, transferNonce, publicCheckpoint: publication, publicCheckpointBytes: checkpointBytes, retrievalReceipts, revocationReceipts, revocationLifecycleDigest: lifecycleDigest, revokedKeyId, recoveryReceipt, incident, backupInventory, restoredArtifact, trust, verifiedAt: new Date('2026-07-22T20:30:00.000Z') }); attacks.priorVerdictRelabelBlocked = false; } catch { attacks.priorVerdictRelabelBlocked = true; }
try { verifyExternalCustodyHardwareQualificationV33_39({ priorCustodyVerdict: priorVerdict, manifestDigest, transcriptDigest, expectedRoles, hardwareAttestations, thresholdEvidence, custodyTransfer: transfer, transferSourceAttestation: hardwareAttestations[0], transferTargetAttestation: rotatedAttestation, sealedTransferMaterial: Buffer.from('substituted sealed bytes that are invalid'), transferNonce, publicCheckpoint: publication, publicCheckpointBytes: checkpointBytes, retrievalReceipts, revocationReceipts, revocationLifecycleDigest: lifecycleDigest, revokedKeyId, recoveryReceipt, incident, backupInventory, restoredArtifact, trust, verifiedAt: new Date('2026-07-22T20:30:00.000Z') }); attacks.transferSubstitutionBlocked = false; } catch { attacks.transferSubstitutionBlocked = true; }
try { verifyExternalCustodyHardwareQualificationV33_39({ priorCustodyVerdict: priorVerdict, manifestDigest, transcriptDigest, expectedRoles, hardwareAttestations, thresholdEvidence, custodyTransfer: transfer, transferSourceAttestation: hardwareAttestations[0], transferTargetAttestation: rotatedAttestation, sealedTransferMaterial, transferNonce, publicCheckpoint: publication, publicCheckpointBytes: checkpointBytes, retrievalReceipts, revocationReceipts, revocationLifecycleDigest: lifecycleDigest, revokedKeyId, recoveryReceipt, incident, backupInventory: Buffer.from('rollback backup inventory'), restoredArtifact, trust, verifiedAt: new Date('2026-07-22T20:30:00.000Z') }); attacks.recoveryRollbackBlocked = false; } catch { attacks.recoveryRollbackBlocked = true; }
try { verifyExternalCustodyHardwareQualificationV33_39({ priorCustodyVerdict: priorVerdict, manifestDigest, transcriptDigest, expectedRoles, hardwareAttestations, thresholdEvidence, custodyTransfer: transfer, transferSourceAttestation: hardwareAttestations[0], transferTargetAttestation: rotatedAttestation, sealedTransferMaterial, transferNonce, publicCheckpoint: publication, publicCheckpointBytes: checkpointBytes, retrievalReceipts: retrievalReceipts.slice(0, 2), revocationReceipts, revocationLifecycleDigest: lifecycleDigest, revokedKeyId, recoveryReceipt, incident, backupInventory, restoredArtifact, trust, verifiedAt: new Date('2026-07-22T20:30:00.000Z') }); attacks.monitorQuorumBlocked = false; } catch { attacks.monitorQuorumBlocked = true; }

const publicKeys = registry.listPublicKeys();
const signedEnvelopes = [...hardwareAttestations, rotatedAttestation, ...thresholdEvidence.flatMap((row) => [...row.approvals, row.certificate]), transfer, publication, ...retrievalReceipts, ...revocationReceipts, recoveryReceipt];
const proof = {
  version: '33.39', generatedAt: new Date().toISOString(), priorV33_38Proof: prior, priorV33_38Verdict: priorVerdict,
  manifestDigest, transcriptDigest, expectedRoles, hardwareAttestations, rotatedAttestation,
  thresholdEvidence, transfer, sealedTransferMaterialBase64: sealedTransferMaterial.toString('base64'), transferNonceBase64: transferNonce.toString('base64'),
  checkpointBytesBase64: checkpointBytes.toString('base64'), publication, retrievalReceipts,
  lifecycleDigest, revokedKeyId, revocationReceipts,
  incidentBase64: incident.toString('base64'), backupInventoryBase64: backupInventory.toString('base64'), restoredArtifactBase64: restoredArtifact.toString('base64'), recoveryReceipt,
  finalVerdict, publicKeys,
  trustedIds: { hardwareAttestationAuthorities: [attestationAuthority.keyId], thresholdCustodians: custodians.map((row) => row.keyId), thresholdAuthorities: [thresholdAuthority.keyId], transferAuthorities: [transferAuthority.keyId], publicationAuthorities: [publicationAuthority.keyId], monitors: monitors.map((row) => row.keyId), recoveryVerifiers: [recoveryVerifier.keyId] },
  attacks,
  summary: { hardwareAttestationCount: hardwareAttestations.length, thresholdCertificateCount: thresholdEvidence.length, retrievalReceiptCount: retrievalReceipts.length, revocationReceiptCount: revocationReceipts.length, signatureCount: signedEnvelopes.length },
  truthBoundary: { executionClass: 'LOCAL_REHEARSAL', externalTopologyObserved: false, externalHardwareObserved: false, externalRoleOwnersObserved: 0, externalHumanParticipants: 0, productionAuthority: 'NONE', externalEffectsExecuted: 0, g3: 'blocked', productionPromotion: 'blocked' },
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(proof, null, 2) + '\n');
console.log(JSON.stringify({ status: 'PASS', output, signatureCount: signedEnvelopes.length, hardwareAttestations: hardwareAttestations.length, thresholdCertificates: thresholdEvidence.length, finalStatus: finalVerdict.status, attacks }, null, 2));
