import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  KeyRegistry,
  generateSigningIdentity,
  sha256,
} from '../dist/src/contracts/crypto.js';
import {
  createDeploymentRoleAcceptanceV33_37,
  createDurableReceiptRecoveryAttestationV33_37,
  createExternalQualificationDeploymentManifestV33_37,
  createExternalQualificationEvidenceBundleV33_37,
  createExternalQualificationImportChallengeV33_37,
  verifyDeploymentReadinessV33_37,
  verifyExternalQualificationEvidenceImportV33_37,
} from '../dist/src/app/external-qualification-deployment-import-v33_37.js';
import {
  CustodyReceiptTransparencyLogV33_38,
  createCustodyCeremonyTranscriptV33_38,
  createCustodyCeremonyWitnessV33_38,
  createCustodyTransparencyWitnessV33_38,
  createProvisioningChallengeV33_38,
  createProvisioningResponseV33_38,
  createRoleActionAssertionV33_38,
  createRoleLifecycleProposalV33_38,
  createRolePossessionStatementV33_38,
  createSecurityCustodianApprovalV33_38,
  custodyRoleAssignmentsV33_38,
  detectCustodyTransparencySplitViewV33_38,
  finalizeOneTimeProvisioningV33_38,
  finalizeRoleLifecycleChangeV33_38,
  verifyCustodyCeremonyV33_38,
  verifyExternalCustodyQualificationV33_38,
  verifyRoleActionAssertionV33_38,
} from '../dist/src/app/external-qualification-custody-ceremony-v33_38.js';

const output = resolve(process.argv[2] ?? 'release-evidence/v33.38/V33_38_CUSTODY_CEREMONY_PROOF.json');
const at = (value) => new Date(value);
const registry = (...identities) => { const result = new KeyRegistry(); for (const identity of identities) result.register(identity.keyId, identity.publicKey); return result; };
const descriptor = (identity, name) => { const keys = registry(identity); return { keyId: identity.keyId, keyFingerprint: keys.fingerprint(identity.keyId), organizationId: `${name}-org`, hostId: `${name}-host`, administratorId: `${name}-admin` }; };

const deploymentAuthority = generateSigningIdentity('proof-v3338-deployment-authority');
const provisioningAuthority = generateSigningIdentity('proof-v3338-provisioning-authority');
const recorder = generateSigningIdentity('proof-v3338-recorder');
const ceremonyWitnesses = [1, 2].map((n) => generateSigningIdentity(`proof-v3338-ceremony-witness-${n}`));
const lifecycleAuthority = generateSigningIdentity('proof-v3338-lifecycle-authority');
const securityCustodians = [1, 2, 3].map((n) => generateSigningIdentity(`proof-v3338-security-${n}`));
const logAuthority = generateSigningIdentity('proof-v3338-log-authority');
const logWitnesses = [1, 2].map((n) => generateSigningIdentity(`proof-v3338-log-witness-${n}`));
const publisher = generateSigningIdentity('proof-v3338-publisher');
const monitors = [1, 2, 3].map((n) => generateSigningIdentity(`proof-v3338-monitor-${n}`));
const auditors = [1, 2].map((n) => generateSigningIdentity(`proof-v3338-auditor-${n}`));
const timeSources = [1, 2].map((n) => generateSigningIdentity(`proof-v3338-time-${n}`));
const exporter = generateSigningIdentity('proof-v3338-exporter');
const importer = generateSigningIdentity('proof-v3338-importer');
const recoveryVerifier = generateSigningIdentity('proof-v3338-recovery');
const replacementMonitor = generateSigningIdentity('proof-v3338-monitor-1-replacement');
const roleIdentities = [publisher, ...monitors, ...auditors, ...timeSources, exporter, importer, recoveryVerifier];
const allRoleKeys = [...roleIdentities, replacementMonitor];
const infrastructure = [deploymentAuthority, provisioningAuthority, recorder, ...ceremonyWitnesses, lifecycleAuthority, ...securityCustodians, logAuthority, ...logWitnesses];
const allIdentities = [...infrastructure, ...allRoleKeys];
const roleRows = new Map(allRoleKeys.map((identity) => [identity.keyId, descriptor(identity, identity.keyId)]));
const infrastructureRows = new Map(infrastructure.map((identity) => [identity.keyId, descriptor(identity, identity.keyId)]));

const manifest = createExternalQualificationDeploymentManifestV33_37({
  deploymentAuthority,
  deploymentAuthorityDescriptor: infrastructureRows.get(deploymentAuthority.keyId),
  deploymentId: 'v3338-custody-deployment',
  campaignId: 'v3338-local-custody-rehearsal',
  artifactId: 'v3338-qualification-artifact',
  artifactDigest: sha256({ artifact: 'v3338-local-custody-rehearsal' }),
  publisher: roleRows.get(publisher.keyId),
  monitors: monitors.map((identity) => roleRows.get(identity.keyId)),
  topologyAuditors: auditors.map((identity) => roleRows.get(identity.keyId)),
  timeSources: timeSources.map((identity) => roleRows.get(identity.keyId)),
  evidenceExporter: roleRows.get(exporter.keyId),
  evidenceImporter: roleRows.get(importer.keyId),
  recoveryVerifier: roleRows.get(recoveryVerifier.keyId),
  allowedDnsNames: ['publisher.example.com'],
  providerEvidencePolicyDigest: sha256({ policy: 'v3338-independent-custody' }),
  issuedAt: at('2026-07-22T18:00:00.000Z'),
  expiresAt: at('2026-08-22T18:00:00.000Z'),
});
const v3337Assignments = [
  ['PUBLISHER', publisher],
  ...monitors.map((identity) => ['MONITOR', identity]),
  ...auditors.map((identity) => ['TOPOLOGY_AUDITOR', identity]),
  ...timeSources.map((identity) => ['TIME_SOURCE', identity]),
  ['EVIDENCE_EXPORTER', exporter],
  ['EVIDENCE_IMPORTER', importer],
  ['RECOVERY_VERIFIER', recoveryVerifier],
];
const acceptances = v3337Assignments.map(([role, identity], index) => createDeploymentRoleAcceptanceV33_37({ actor: identity, actorDescriptor: roleRows.get(identity.keyId), role, manifestDigest: manifest.payload.manifestDigest, acceptedAt: new Date(Date.parse('2026-07-22T18:01:00.000Z') + index * 20_000) }));
const importTrust = {
  deploymentAuthorityRegistry: registry(deploymentAuthority), trustedDeploymentAuthorityIds: [deploymentAuthority.keyId],
  roleRegistry: registry(...roleIdentities),
  evidenceExporterRegistry: registry(exporter), trustedEvidenceExporterIds: [exporter.keyId],
  evidenceImporterRegistry: registry(importer), trustedEvidenceImporterIds: [importer.keyId],
  recoveryVerifierRegistry: registry(recoveryVerifier), trustedRecoveryVerifierIds: [recoveryVerifier.keyId],
};
const readiness = verifyDeploymentReadinessV33_37({ manifest, acceptances, trust: importTrust, verifiedAt: at('2026-07-22T19:00:00.000Z') });
const importChallenge = createExternalQualificationImportChallengeV33_37({ importer, manifestDigest: manifest.payload.manifestDigest, nonce: new Uint8Array(32).fill(38), issuedAt: at('2026-07-22T19:01:00.000Z'), expiresAt: at('2026-07-22T20:01:00.000Z') });
const fileRows = {
  'receipts/monitor-1.bin': { bytes: Buffer.from('v33.38 durable monitor receipt\n'), mediaType: 'application/octet-stream' },
  'qualification/verdict.json': { bytes: Buffer.from(JSON.stringify({ version: '33.38', status: 'LOCAL_CUSTODY_IMPORT_REHEARSAL_ONLY' }, null, 2) + '\n'), mediaType: 'application/json' },
  'ceremony/chain-of-custody.json': { bytes: Buffer.from(JSON.stringify({ ceremony: 'local-rehearsal', externalOperatorsObserved: 0 }, null, 2) + '\n'), mediaType: 'application/json' },
};
const bundle = createExternalQualificationEvidenceBundleV33_37({ exporter, exporterDescriptor: roleRows.get(exporter.keyId), manifestDigest: manifest.payload.manifestDigest, challengeDigest: importChallenge.payload.challengeDigest, executionClass: 'LOCAL_REHEARSAL', qualificationStatus: 'LOCAL_HTTPS_MONITOR_REHEARSAL_ONLY', externalTopologyObserved: false, qualificationVerdictDigest: sha256({ status: 'local-v3338' }), files: fileRows, exportedAt: at('2026-07-22T19:02:00.000Z') });
const recovered = bundle.payload.files.find((row) => row.path === 'receipts/monitor-1.bin');
const recovery = createDurableReceiptRecoveryAttestationV33_37({ recoveryVerifier, manifestDigest: manifest.payload.manifestDigest, bundleDigest: bundle.payload.bundleDigest, durableReceiptPath: recovered.path, inventoryFileDigest: recovered.sha256, restoredBytes: fileRows[recovered.path].bytes, restoredAt: at('2026-07-22T19:03:00.000Z') });
const fileBytes = Object.fromEntries(Object.entries(fileRows).map(([path, row]) => [path, row.bytes]));
const importReceipt = verifyExternalQualificationEvidenceImportV33_37({ manifest, readiness, challenge: importChallenge, bundle, fileBytes, recovery, trust: importTrust, consumedChallengeDigests: new Set(), importedAt: at('2026-07-22T19:04:00.000Z') });

const custodyTrust = {
  deploymentAuthorityRegistry: registry(deploymentAuthority), trustedDeploymentAuthorityIds: [deploymentAuthority.keyId],
  provisioningAuthorityRegistry: registry(provisioningAuthority), trustedProvisioningAuthorityIds: [provisioningAuthority.keyId],
  roleRegistry: registry(...allRoleKeys),
  ceremonyRecorderRegistry: registry(recorder), trustedCeremonyRecorderIds: [recorder.keyId],
  ceremonyWitnessRegistry: registry(...ceremonyWitnesses), trustedCeremonyWitnessIds: ceremonyWitnesses.map((identity) => identity.keyId),
  lifecycleAuthorityRegistry: registry(lifecycleAuthority), trustedLifecycleAuthorityIds: [lifecycleAuthority.keyId],
  securityCustodianRegistry: registry(...securityCustodians), trustedSecurityCustodianIds: securityCustodians.map((identity) => identity.keyId),
  transparencyLogRegistry: registry(logAuthority), trustedTransparencyLogIds: [logAuthority.keyId],
  transparencyWitnessRegistry: registry(...logWitnesses), trustedTransparencyWitnessIds: logWitnesses.map((identity) => identity.keyId),
};
const roleByKey = new Map(roleIdentities.map((identity) => [identity.keyId, identity]));
const ceremonyId = 'v3338-local-custody-ceremony';
const assignments = custodyRoleAssignmentsV33_38(manifest.payload);
const provisioningChallenges = assignments.map((assignment, index) => createProvisioningChallengeV33_38({ provisioningAuthority, provisioningAuthorityDescriptor: infrastructureRows.get(provisioningAuthority.keyId), manifest: manifest.payload, ceremonyId, roleSlot: assignment.roleSlot, nonce: new Uint8Array(32).fill(index + 1), issuedAt: new Date(Date.parse('2026-07-22T18:10:00.000Z') + index * 20_000), expiresAt: at('2026-07-22T19:30:00.000Z') }));
const provisioningResponses = provisioningChallenges.map((challenge, index) => { const identity = roleByKey.get(challenge.payload.actorKeyId); return createProvisioningResponseV33_38({ actor: identity, actorDescriptor: roleRows.get(identity.keyId), challenge: challenge.payload, respondedAt: new Date(Date.parse('2026-07-22T18:20:00.000Z') + index * 20_000) }); });
const consumedProvisioning = new Set();
const provisioningReceipts = provisioningChallenges.map((challenge, index) => finalizeOneTimeProvisioningV33_38({ provisioningAuthority, manifest, challenge, response: provisioningResponses[index], trust: custodyTrust, consumedChallengeDigests: consumedProvisioning, provisionedAt: new Date(Date.parse('2026-07-22T18:30:00.000Z') + index * 20_000) }));
const transcript = createCustodyCeremonyTranscriptV33_38({ recorder, recorderDescriptor: infrastructureRows.get(recorder.keyId), manifest: manifest.payload, ceremonyId, receipts: provisioningReceipts, executionClass: 'LOCAL_REHEARSAL', openedAt: at('2026-07-22T18:00:00.000Z'), closedAt: at('2026-07-22T18:50:00.000Z') });
const ceremonyWitnessEnvelopes = ceremonyWitnesses.map((witness, index) => createCustodyCeremonyWitnessV33_38({ witness, witnessDescriptor: infrastructureRows.get(witness.keyId), manifestDigest: manifest.payload.manifestDigest, transcript: transcript.payload, observedAt: new Date(Date.parse('2026-07-22T18:51:00.000Z') + index * 30_000) }));
const ceremonyVerdict = verifyCustodyCeremonyV33_38({ manifest, challenges: provisioningChallenges, responses: provisioningResponses, receipts: provisioningReceipts, transcript, witnesses: ceremonyWitnessEnvelopes, trust: custodyTrust, verifiedAt: at('2026-07-22T19:00:00.000Z') });

const lifecycleProposal = createRoleLifecycleProposalV33_38({ lifecycleAuthority, manifestDigest: manifest.payload.manifestDigest, transcriptDigest: transcript.payload.transcriptDigest, lifecycleSequence: 1, previousLifecycleDigest: null, roleSlot: 'MONITOR_1', action: 'SCHEDULED_ROTATION', currentActor: roleRows.get(monitors[0].keyId), replacementActor: roleRows.get(replacementMonitor.keyId), reasonDigest: sha256({ reason: 'planned-proof-rotation' }), effectiveAt: at('2026-07-22T19:10:00.000Z') });
const currentConsent = createRolePossessionStatementV33_38({ actor: monitors[0], actorDescriptor: roleRows.get(monitors[0].keyId), proposalDigest: lifecycleProposal.payload.proposalDigest, purpose: 'CURRENT_KEY_CONSENT', signedAt: at('2026-07-22T19:05:00.000Z') });
const replacementAcceptance = createRolePossessionStatementV33_38({ actor: replacementMonitor, actorDescriptor: roleRows.get(replacementMonitor.keyId), proposalDigest: lifecycleProposal.payload.proposalDigest, purpose: 'REPLACEMENT_KEY_ACCEPTANCE', signedAt: at('2026-07-22T19:05:30.000Z') });
const securityApprovals = securityCustodians.slice(0, 2).map((custodian, index) => createSecurityCustodianApprovalV33_38({ custodian, custodianDescriptor: infrastructureRows.get(custodian.keyId), proposalDigest: lifecycleProposal.payload.proposalDigest, approvedAt: new Date(Date.parse('2026-07-22T19:06:00.000Z') + index * 30_000) }));
const lifecycleCertificate = finalizeRoleLifecycleChangeV33_38({ lifecycleAuthority, proposal: lifecycleProposal, currentKeyConsent: currentConsent, replacementKeyAcceptance: replacementAcceptance, securityApprovals, trust: custodyTrust, finalizedAt: at('2026-07-22T19:08:00.000Z') });

const log = new CustodyReceiptTransparencyLogV33_38('v3338-custody-log', logAuthority);
let eventTime = Date.parse('2026-07-22T19:20:00.000Z');
for (const receipt of provisioningReceipts) { log.append('ROLE_PROVISIONED', receipt.payload.receiptDigest, receipt.payload.roleSlot, new Date(eventTime)); eventTime += 10_000; }
log.append('CEREMONY_CLOSED', transcript.payload.transcriptDigest, null, new Date(eventTime)); eventTime += 10_000;
log.append('KEY_LIFECYCLE_CHANGED', lifecycleCertificate.payload.lifecycleDigest, lifecycleCertificate.payload.roleSlot, new Date(eventTime)); eventTime += 10_000;
log.append('EVIDENCE_IMPORTED', importReceipt.importDigest, null, new Date(eventTime)); eventTime += 10_000;
const transparencySnapshot = log.snapshot(new Date(eventTime));
const transparencyWitnesses = logWitnesses.map((witness, index) => createCustodyTransparencyWitnessV33_38({ witness, witnessDescriptor: infrastructureRows.get(witness.keyId), snapshot: transparencySnapshot.payload, observedAt: new Date(eventTime + (index + 1) * 30_000) }));
const finalVerdict = verifyExternalCustodyQualificationV33_38({
  manifest,
  ceremonyVerdict,
  provisioningChallenges,
  provisioningResponses,
  provisioningReceipts,
  ceremonyTranscript: transcript,
  ceremonyWitnesses: ceremonyWitnessEnvelopes,
  lifecycleEvidence: [{ proposal: lifecycleProposal, currentKeyConsent: currentConsent, replacementKeyAcceptance: replacementAcceptance, securityApprovals, certificate: lifecycleCertificate }],
  importReceipt,
  importReadiness: readiness,
  importChallenge,
  importBundle: bundle,
  importFileBytes: fileBytes,
  importRecovery: recovery,
  importTrust,
  transparencySnapshot,
  transparencyWitnesses,
  trust: custodyTrust,
  verifiedAt: at('2026-07-22T20:00:00.000Z'),
});

const attacks = {};
try { finalizeOneTimeProvisioningV33_38({ provisioningAuthority, manifest, challenge: provisioningChallenges[0], response: provisioningResponses[0], trust: custodyTrust, consumedChallengeDigests: consumedProvisioning, provisionedAt: at('2026-07-22T18:45:00.000Z') }); attacks.provisioningReplayBlocked = false; } catch { attacks.provisioningReplayBlocked = true; }
try {
  const oldAssertion = createRoleActionAssertionV33_38({ actor: monitors[0], manifestDigest: manifest.payload.manifestDigest, transcriptDigest: transcript.payload.transcriptDigest, roleSlot: 'MONITOR_1', lifecycleHeadDigest: lifecycleCertificate.payload.lifecycleDigest, actionBytes: Buffer.from('resurrection'), actedAt: at('2026-07-22T19:30:00.000Z') });
  verifyRoleActionAssertionV33_38({ assertion: oldAssertion, manifest: manifest.payload, lifecycleCertificates: [lifecycleCertificate], trust: custodyTrust, manifestDigest: manifest.payload.manifestDigest, transcriptDigest: transcript.payload.transcriptDigest, verifiedAt: at('2026-07-22T19:30:00.000Z') });
  attacks.oldKeyResurrectionBlocked = false;
} catch { attacks.oldKeyResurrectionBlocked = true; }
const forkLog = new CustodyReceiptTransparencyLogV33_38('v3338-custody-log', logAuthority);
for (let index = 0; index < transparencySnapshot.payload.eventCount; index++) forkLog.append(index === transparencySnapshot.payload.eventCount - 1 ? 'EVIDENCE_IMPORTED' : 'ROLE_PROVISIONED', sha256({ fork: index }), index < 11 ? assignments[index].roleSlot : null, new Date(Date.parse('2026-07-22T19:20:00.000Z') + index * 1000));
attacks.splitViewDetected = detectCustodyTransparencySplitViewV33_38([transparencySnapshot, forkLog.snapshot(at('2026-07-22T20:00:00.000Z'))]);
try {
  verifyExternalCustodyQualificationV33_38({ manifest, ceremonyVerdict, provisioningChallenges, provisioningResponses, provisioningReceipts, ceremonyTranscript: transcript, ceremonyWitnesses: ceremonyWitnessEnvelopes, lifecycleEvidence: [{ proposal: lifecycleProposal, currentKeyConsent: currentConsent, replacementKeyAcceptance: replacementAcceptance, securityApprovals, certificate: lifecycleCertificate }], importReceipt: { ...importReceipt, verifiedFileCount: 999 }, importReadiness: readiness, importChallenge, importBundle: bundle, importFileBytes: fileBytes, importRecovery: recovery, importTrust, transparencySnapshot, transparencyWitnesses, trust: custodyTrust, verifiedAt: at('2026-07-22T20:00:00.000Z') });
  attacks.importReceiptRecomputationBlocked = false;
} catch { attacks.importReceiptRecomputationBlocked = true; }

const publicRegistry = registry(...allIdentities);
const publicKeys = allIdentities.map((identity) => publicRegistry.exportPublicKey(identity.keyId));
const signatureCount = 1 + acceptances.length + 3 + provisioningChallenges.length + provisioningResponses.length + provisioningReceipts.length + 1 + ceremonyWitnessEnvelopes.length + 1 + 2 + securityApprovals.length + 1 + 1 + transparencyWitnesses.length;
const proof = {
  version: '33.38',
  generatedAt: new Date().toISOString(),
  manifest,
  acceptances,
  readiness,
  importChallenge,
  importBundle: bundle,
  importRecovery: recovery,
  importReceipt,
  importFileBytesBase64: Object.fromEntries(Object.entries(fileRows).map(([path, row]) => [path, row.bytes.toString('base64')])),
  provisioningChallenges,
  provisioningResponses,
  provisioningReceipts,
  transcript,
  ceremonyWitnesses: ceremonyWitnessEnvelopes,
  ceremonyVerdict,
  lifecycleProposal,
  currentConsent,
  replacementAcceptance,
  securityApprovals,
  lifecycleCertificate,
  transparencySnapshot,
  transparencyWitnesses,
  finalVerdict,
  publicKeys,
  trustedIds: {
    deploymentAuthority: [deploymentAuthority.keyId], provisioningAuthority: [provisioningAuthority.keyId], roles: allRoleKeys.map((identity) => identity.keyId), ceremonyRecorder: [recorder.keyId], ceremonyWitnesses: ceremonyWitnesses.map((identity) => identity.keyId), lifecycleAuthority: [lifecycleAuthority.keyId], securityCustodians: securityCustodians.map((identity) => identity.keyId), transparencyLog: [logAuthority.keyId], transparencyWitnesses: logWitnesses.map((identity) => identity.keyId), exporter: [exporter.keyId], importer: [importer.keyId], recoveryVerifier: [recoveryVerifier.keyId],
  },
  attacks,
  summary: { roleCount: 11, provisioningReceiptCount: provisioningReceipts.length, transparencyEventCount: transparencySnapshot.payload.eventCount, signatureCount },
  truthBoundary: { executionClass: 'LOCAL_REHEARSAL', externalTopologyObserved: false, externalRoleOwnersObserved: 0, externalHumanParticipants: 0, productionAuthority: 'NONE', externalEffectsExecuted: 0, g3: 'blocked', productionPromotion: 'blocked' },
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(proof, null, 2) + '\n');
console.log(JSON.stringify({ status: 'PASS', output, signatureCount, provisioningReceipts: provisioningReceipts.length, transparencyEvents: transparencySnapshot.payload.eventCount, finalStatus: finalVerdict.status, attacks }, null, 2));
