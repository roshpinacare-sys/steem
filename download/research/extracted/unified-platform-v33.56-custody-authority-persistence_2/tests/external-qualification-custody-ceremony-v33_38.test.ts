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
import type { QualificationActorDescriptorV33_36 } from '../src/app/external-https-monitor-qualification-v33_36.js';
import {
  createDeploymentRoleAcceptanceV33_37,
  createDurableReceiptRecoveryAttestationV33_37,
  createExternalQualificationDeploymentManifestV33_37,
  createExternalQualificationEvidenceBundleV33_37,
  createExternalQualificationImportChallengeV33_37,
  verifyDeploymentReadinessV33_37,
  verifyExternalQualificationEvidenceImportV33_37,
  type DeploymentRoleV33_37,
  type ExternalQualificationImportTrustV33_37,
} from '../src/app/external-qualification-deployment-import-v33_37.js';
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
  verifyCustodyTransparencyCheckpointV33_38,
  verifyCustodyTransparencySnapshotV33_38,
  verifyExternalCustodyQualificationV33_38,
  verifyRoleActionAssertionV33_38,
  verifyRoleLifecycleChainV33_38,
  verifyRoleLifecycleEvidenceV33_38,
  type CustodyRoleSlotV33_38,
  type CustodyTrustV33_38,
  type ProvisioningReceiptV33_38,
  type RoleLifecycleCertificateV33_38,
} from '../src/app/external-qualification-custody-ceremony-v33_38.js';

const at = (value: string) => new Date(value);
function registry(...identities: readonly SigningIdentity[]): KeyRegistry {
  const result = new KeyRegistry();
  for (const identity of identities) result.register(identity.keyId, identity.publicKey);
  return result;
}
function descriptor(identity: SigningIdentity, name: string): QualificationActorDescriptorV33_36 {
  const keys = registry(identity);
  return {
    keyId: identity.keyId,
    keyFingerprint: keys.fingerprint(identity.keyId)!,
    organizationId: `${name}-org`,
    hostId: `${name}-host`,
    administratorId: `${name}-admin`,
  };
}
function resign<T extends object>(envelope: SignedEnvelope<T>, signer: SigningIdentity, digestField: keyof T, patch: Partial<T>): SignedEnvelope<T> {
  const material = { ...envelope.payload, ...patch } as T & Record<PropertyKey, unknown>;
  delete material[digestField];
  return signEnvelope({ ...material, [digestField]: sha256(material) } as T, signer);
}

function fixture(executionClass: 'LOCAL_REHEARSAL' | 'LIVE_EXTERNAL' = 'LOCAL_REHEARSAL') {
  const deploymentAuthority = generateSigningIdentity('v3338-deployment-authority');
  const provisioningAuthority = generateSigningIdentity('v3338-provisioning-authority');
  const recorder = generateSigningIdentity('v3338-recorder');
  const ceremonyWitnesses = [1, 2].map((n) => generateSigningIdentity(`v3338-ceremony-witness-${n}`));
  const lifecycleAuthority = generateSigningIdentity('v3338-lifecycle-authority');
  const securityCustodians = [1, 2, 3].map((n) => generateSigningIdentity(`v3338-security-${n}`));
  const logAuthority = generateSigningIdentity('v3338-log-authority');
  const logWitnesses = [1, 2].map((n) => generateSigningIdentity(`v3338-log-witness-${n}`));

  const publisher = generateSigningIdentity('v3338-publisher');
  const monitors = [1, 2, 3].map((n) => generateSigningIdentity(`v3338-monitor-${n}`));
  const auditors = [1, 2].map((n) => generateSigningIdentity(`v3338-auditor-${n}`));
  const times = [1, 2].map((n) => generateSigningIdentity(`v3338-time-${n}`));
  const exporter = generateSigningIdentity('v3338-exporter');
  const importer = generateSigningIdentity('v3338-importer');
  const recovery = generateSigningIdentity('v3338-recovery');
  const replacementMonitor = generateSigningIdentity('v3338-monitor-1-replacement');
  const roleIdentities = [publisher, ...monitors, ...auditors, ...times, exporter, importer, recovery];
  const allRoleKeys = [...roleIdentities, replacementMonitor];
  const rows = new Map(allRoleKeys.map((identity) => [identity.keyId, descriptor(identity, identity.keyId)]));
  const infrastructureRows = new Map([
    deploymentAuthority,
    provisioningAuthority,
    recorder,
    ...ceremonyWitnesses,
    lifecycleAuthority,
    ...securityCustodians,
    logAuthority,
    ...logWitnesses,
  ].map((identity) => [identity.keyId, descriptor(identity, identity.keyId)]));

  const manifest = createExternalQualificationDeploymentManifestV33_37({
    deploymentAuthority,
    deploymentAuthorityDescriptor: infrastructureRows.get(deploymentAuthority.keyId)!,
    deploymentId: 'deployment-v3338',
    campaignId: 'campaign-v3338',
    artifactId: 'artifact-v3338',
    artifactDigest: sha256({ artifact: 'v3338' }),
    publisher: rows.get(publisher.keyId)!,
    monitors: monitors.map((identity) => rows.get(identity.keyId)!),
    topologyAuditors: auditors.map((identity) => rows.get(identity.keyId)!),
    timeSources: times.map((identity) => rows.get(identity.keyId)!),
    evidenceExporter: rows.get(exporter.keyId)!,
    evidenceImporter: rows.get(importer.keyId)!,
    recoveryVerifier: rows.get(recovery.keyId)!,
    allowedDnsNames: ['publisher.example.com'],
    providerEvidencePolicyDigest: sha256({ providerPolicy: 'v3338' }),
    issuedAt: at('2026-07-22T18:00:00.000Z'),
    expiresAt: at('2026-07-25T18:00:00.000Z'),
  });
  const v3337Assignments: { role: DeploymentRoleV33_37; actor: SigningIdentity }[] = [
    { role: 'PUBLISHER', actor: publisher },
    ...monitors.map((actor) => ({ role: 'MONITOR' as const, actor })),
    ...auditors.map((actor) => ({ role: 'TOPOLOGY_AUDITOR' as const, actor })),
    ...times.map((actor) => ({ role: 'TIME_SOURCE' as const, actor })),
    { role: 'EVIDENCE_EXPORTER', actor: exporter },
    { role: 'EVIDENCE_IMPORTER', actor: importer },
    { role: 'RECOVERY_VERIFIER', actor: recovery },
  ];
  const acceptances = v3337Assignments.map(({ role, actor }, index) => createDeploymentRoleAcceptanceV33_37({
    actor,
    actorDescriptor: rows.get(actor.keyId)!,
    role,
    manifestDigest: manifest.payload.manifestDigest,
    acceptedAt: new Date(Date.parse('2026-07-22T18:00:00.000Z') + index * 30_000),
  }));
  const importTrust: ExternalQualificationImportTrustV33_37 = {
    deploymentAuthorityRegistry: registry(deploymentAuthority),
    trustedDeploymentAuthorityIds: [deploymentAuthority.keyId],
    roleRegistry: registry(...roleIdentities),
    evidenceExporterRegistry: registry(exporter),
    trustedEvidenceExporterIds: [exporter.keyId],
    evidenceImporterRegistry: registry(importer),
    trustedEvidenceImporterIds: [importer.keyId],
    recoveryVerifierRegistry: registry(recovery),
    trustedRecoveryVerifierIds: [recovery.keyId],
  };
  const readiness = verifyDeploymentReadinessV33_37({ manifest, acceptances, trust: importTrust, verifiedAt: at('2026-07-22T19:00:00.000Z') });
  const importChallenge = createExternalQualificationImportChallengeV33_37({ importer, manifestDigest: manifest.payload.manifestDigest, nonce: new Uint8Array(32).fill(38), issuedAt: at('2026-07-22T19:01:00.000Z'), expiresAt: at('2026-07-22T20:01:00.000Z') });
  const durableBytes = Buffer.from('v3338 durable receipt');
  const files = {
    'receipts/monitor-1.bin': { bytes: durableBytes, mediaType: 'application/octet-stream' },
    'qualification/verdict.json': { bytes: Buffer.from(`{"execution":"${executionClass}"}\n`), mediaType: 'application/json' },
  };
  const bundle = createExternalQualificationEvidenceBundleV33_37({
    exporter,
    exporterDescriptor: rows.get(exporter.keyId)!,
    manifestDigest: manifest.payload.manifestDigest,
    challengeDigest: importChallenge.payload.challengeDigest,
    executionClass,
    qualificationStatus: executionClass === 'LIVE_EXTERNAL' ? 'EXTERNAL_MONITOR_QUALIFIED' : 'LOCAL_HTTPS_MONITOR_REHEARSAL_ONLY',
    externalTopologyObserved: executionClass === 'LIVE_EXTERNAL',
    qualificationVerdictDigest: sha256({ verdict: executionClass }),
    files,
    exportedAt: at('2026-07-22T19:02:00.000Z'),
  });
  const durableEntry = bundle.payload.files.find((entry) => entry.path === 'receipts/monitor-1.bin')!;
  const recoveryAttestation = createDurableReceiptRecoveryAttestationV33_37({
    recoveryVerifier: recovery,
    manifestDigest: manifest.payload.manifestDigest,
    bundleDigest: bundle.payload.bundleDigest,
    durableReceiptPath: durableEntry.path,
    inventoryFileDigest: durableEntry.sha256,
    restoredBytes: durableBytes,
    restoredAt: at('2026-07-22T19:03:00.000Z'),
  });
  const importReceipt = verifyExternalQualificationEvidenceImportV33_37({
    manifest,
    readiness,
    challenge: importChallenge,
    bundle,
    fileBytes: Object.fromEntries(Object.entries(files).map(([path, row]) => [path, row.bytes])),
    recovery: recoveryAttestation,
    trust: importTrust,
    consumedChallengeDigests: new Set(),
    importedAt: at('2026-07-22T19:04:00.000Z'),
  });

  const custodyTrust: CustodyTrustV33_38 = {
    deploymentAuthorityRegistry: registry(deploymentAuthority),
    trustedDeploymentAuthorityIds: [deploymentAuthority.keyId],
    provisioningAuthorityRegistry: registry(provisioningAuthority),
    trustedProvisioningAuthorityIds: [provisioningAuthority.keyId],
    roleRegistry: registry(...allRoleKeys),
    ceremonyRecorderRegistry: registry(recorder),
    trustedCeremonyRecorderIds: [recorder.keyId],
    ceremonyWitnessRegistry: registry(...ceremonyWitnesses),
    trustedCeremonyWitnessIds: ceremonyWitnesses.map((identity) => identity.keyId),
    lifecycleAuthorityRegistry: registry(lifecycleAuthority),
    trustedLifecycleAuthorityIds: [lifecycleAuthority.keyId],
    securityCustodianRegistry: registry(...securityCustodians),
    trustedSecurityCustodianIds: securityCustodians.map((identity) => identity.keyId),
    transparencyLogRegistry: registry(logAuthority),
    trustedTransparencyLogIds: [logAuthority.keyId],
    transparencyWitnessRegistry: registry(...logWitnesses),
    trustedTransparencyWitnessIds: logWitnesses.map((identity) => identity.keyId),
  };

  const roleByKey = new Map(roleIdentities.map((identity) => [identity.keyId, identity]));
  const ceremonyId = 'ceremony-v3338';
  const consumedProvisioningChallenges = new Set<string>();
  const assignments = custodyRoleAssignmentsV33_38(manifest.payload);
  const challenges = assignments.map((assignment, index) => createProvisioningChallengeV33_38({
    provisioningAuthority,
    provisioningAuthorityDescriptor: infrastructureRows.get(provisioningAuthority.keyId)!,
    manifest: manifest.payload,
    ceremonyId,
    roleSlot: assignment.roleSlot,
    nonce: new Uint8Array(32).fill(index + 1),
    issuedAt: new Date(Date.parse('2026-07-22T18:10:00.000Z') + index * 30_000),
    expiresAt: at('2026-07-22T19:30:00.000Z'),
  }));
  const responses = challenges.map((challenge, index) => {
    const actor = roleByKey.get(challenge.payload.actorKeyId)!;
    return createProvisioningResponseV33_38({ actor, actorDescriptor: rows.get(actor.keyId)!, challenge: challenge.payload, respondedAt: new Date(Date.parse('2026-07-22T18:20:00.000Z') + index * 30_000) });
  });
  const receipts = challenges.map((challenge, index) => finalizeOneTimeProvisioningV33_38({
    provisioningAuthority,
    manifest,
    challenge,
    response: responses[index]!,
    trust: custodyTrust,
    consumedChallengeDigests: consumedProvisioningChallenges,
    provisionedAt: new Date(Date.parse('2026-07-22T18:30:00.000Z') + index * 30_000),
  }));
  const transcript = createCustodyCeremonyTranscriptV33_38({
    recorder,
    recorderDescriptor: infrastructureRows.get(recorder.keyId)!,
    manifest: manifest.payload,
    ceremonyId,
    receipts,
    executionClass,
    openedAt: at('2026-07-22T18:00:00.000Z'),
    closedAt: at('2026-07-22T18:50:00.000Z'),
  });
  const ceremonyWitnessEnvelopes = ceremonyWitnesses.map((witness, index) => createCustodyCeremonyWitnessV33_38({
    witness,
    witnessDescriptor: infrastructureRows.get(witness.keyId)!,
    manifestDigest: manifest.payload.manifestDigest,
    transcript: transcript.payload,
    observedAt: new Date(Date.parse('2026-07-22T18:51:00.000Z') + index * 30_000),
  }));
  const ceremonyVerdict = verifyCustodyCeremonyV33_38({ manifest, challenges, responses, receipts, transcript, witnesses: ceremonyWitnessEnvelopes, trust: custodyTrust, verifiedAt: at('2026-07-22T19:00:00.000Z') });

  const rotationProposal = createRoleLifecycleProposalV33_38({
    lifecycleAuthority,
    manifestDigest: manifest.payload.manifestDigest,
    transcriptDigest: transcript.payload.transcriptDigest,
    lifecycleSequence: 1,
    previousLifecycleDigest: null,
    roleSlot: 'MONITOR_1',
    action: 'SCHEDULED_ROTATION',
    currentActor: rows.get(monitors[0]!.keyId)!,
    replacementActor: rows.get(replacementMonitor.keyId)!,
    reasonDigest: sha256({ reason: 'planned-monitor-key-rotation' }),
    effectiveAt: at('2026-07-22T19:10:00.000Z'),
  });
  const currentConsent = createRolePossessionStatementV33_38({ actor: monitors[0]!, actorDescriptor: rows.get(monitors[0]!.keyId)!, proposalDigest: rotationProposal.payload.proposalDigest, purpose: 'CURRENT_KEY_CONSENT', signedAt: at('2026-07-22T19:05:00.000Z') });
  const replacementAcceptance = createRolePossessionStatementV33_38({ actor: replacementMonitor, actorDescriptor: rows.get(replacementMonitor.keyId)!, proposalDigest: rotationProposal.payload.proposalDigest, purpose: 'REPLACEMENT_KEY_ACCEPTANCE', signedAt: at('2026-07-22T19:05:30.000Z') });
  const securityApprovals = securityCustodians.slice(0, 2).map((custodian, index) => createSecurityCustodianApprovalV33_38({ custodian, custodianDescriptor: infrastructureRows.get(custodian.keyId)!, proposalDigest: rotationProposal.payload.proposalDigest, approvedAt: new Date(Date.parse('2026-07-22T19:06:00.000Z') + index * 30_000) }));
  const lifecycleCertificate = finalizeRoleLifecycleChangeV33_38({ lifecycleAuthority, proposal: rotationProposal, currentKeyConsent: currentConsent, replacementKeyAcceptance: replacementAcceptance, securityApprovals, trust: custodyTrust, finalizedAt: at('2026-07-22T19:08:00.000Z') });
  const lifecycleCertificates = [lifecycleCertificate];
  const lifecycleEvidence = [{ proposal: rotationProposal, currentKeyConsent: currentConsent, replacementKeyAcceptance: replacementAcceptance, securityApprovals, certificate: lifecycleCertificate }];

  const log = new CustodyReceiptTransparencyLogV33_38('custody-log-v3338', logAuthority);
  let eventTime = Date.parse('2026-07-22T19:20:00.000Z');
  for (const receipt of receipts) {
    log.append('ROLE_PROVISIONED', receipt.payload.receiptDigest, receipt.payload.roleSlot, new Date(eventTime));
    eventTime += 10_000;
  }
  log.append('CEREMONY_CLOSED', transcript.payload.transcriptDigest, null, new Date(eventTime)); eventTime += 10_000;
  const preLifecycleSnapshot = log.snapshot(new Date(eventTime));
  log.append('KEY_LIFECYCLE_CHANGED', lifecycleCertificate.payload.lifecycleDigest, lifecycleCertificate.payload.roleSlot, new Date(eventTime)); eventTime += 10_000;
  const preImportSnapshot = log.snapshot(new Date(eventTime));
  log.append('EVIDENCE_IMPORTED', importReceipt.importDigest, null, new Date(eventTime)); eventTime += 10_000;
  const transparencySnapshot = log.snapshot(new Date(eventTime));
  const transparencyWitnesses = logWitnesses.map((witness, index) => createCustodyTransparencyWitnessV33_38({ witness, witnessDescriptor: infrastructureRows.get(witness.keyId)!, snapshot: transparencySnapshot.payload, observedAt: new Date(eventTime + (index + 1) * 30_000) }));
  const finalVerdict = verifyExternalCustodyQualificationV33_38({
    manifest,
    ceremonyVerdict,
    provisioningChallenges: challenges,
    provisioningResponses: responses,
    provisioningReceipts: receipts,
    ceremonyTranscript: transcript,
    ceremonyWitnesses: ceremonyWitnessEnvelopes,
    lifecycleEvidence,
    importReceipt,
    importReadiness: readiness,
    importChallenge,
    importBundle: bundle,
    importFileBytes: Object.fromEntries(Object.entries(files).map(([path, row]) => [path, row.bytes])),
    importRecovery: recoveryAttestation,
    importTrust,
    transparencySnapshot,
    transparencyWitnesses,
    trust: custodyTrust,
    verifiedAt: at('2026-07-22T20:00:00.000Z'),
  });

  return {
    deploymentAuthority,
    provisioningAuthority,
    recorder,
    ceremonyWitnesses,
    lifecycleAuthority,
    securityCustodians,
    logAuthority,
    logWitnesses,
    publisher,
    monitors,
    auditors,
    times,
    exporter,
    importer,
    recovery,
    replacementMonitor,
    rows,
    infrastructureRows,
    manifest,
    readiness,
    importChallenge,
    bundle,
    files,
    recoveryAttestation,
    importTrust,
    importReceipt,
    custodyTrust,
    ceremonyId,
    assignments,
    challenges,
    responses,
    receipts,
    transcript,
    ceremonyWitnessEnvelopes,
    ceremonyVerdict,
    rotationProposal,
    currentConsent,
    replacementAcceptance,
    securityApprovals,
    lifecycleCertificate,
    lifecycleCertificates,
    lifecycleEvidence,
    log,
    preLifecycleSnapshot,
    preImportSnapshot,
    transparencySnapshot,
    transparencyWitnesses,
    finalVerdict,
  };
}

function buildEmergencyCertificate(f = fixture()) {
  const replacement = generateSigningIdentity('v3338-emergency-replacement');
  const replacementRow = descriptor(replacement, replacement.keyId);
  f.custodyTrust.roleRegistry.register(replacement.keyId, replacement.publicKey);
  const proposal = createRoleLifecycleProposalV33_38({ lifecycleAuthority: f.lifecycleAuthority, manifestDigest: f.manifest.payload.manifestDigest, transcriptDigest: f.transcript.payload.transcriptDigest, lifecycleSequence: 1, previousLifecycleDigest: null, roleSlot: 'MONITOR_2', action: 'EMERGENCY_ROTATION', currentActor: f.rows.get(f.monitors[1]!.keyId)!, replacementActor: replacementRow, reasonDigest: sha256({ reason: 'lost-key' }), effectiveAt: at('2026-07-22T19:10:00Z') });
  const replacementAcceptance = createRolePossessionStatementV33_38({ actor: replacement, actorDescriptor: replacementRow, proposalDigest: proposal.payload.proposalDigest, purpose: 'REPLACEMENT_KEY_ACCEPTANCE', signedAt: at('2026-07-22T19:05:00Z') });
  const approvals = f.securityCustodians.map((custodian, index) => createSecurityCustodianApprovalV33_38({ custodian, custodianDescriptor: f.infrastructureRows.get(custodian.keyId)!, proposalDigest: proposal.payload.proposalDigest, approvedAt: new Date(Date.parse('2026-07-22T19:06:00Z') + index * 1000) }));
  return { replacement, replacementRow, proposal, replacementAcceptance, approvals, certificate: finalizeRoleLifecycleChangeV33_38({ lifecycleAuthority: f.lifecycleAuthority, proposal, currentKeyConsent: null, replacementKeyAcceptance: replacementAcceptance, securityApprovals: approvals, trust: f.custodyTrust, finalizedAt: at('2026-07-22T19:08:00Z') }) };
}

// End-to-end and one-time provisioning.
test('v33.38 verifies local custody ceremony, lifecycle and receipt log without production authority', () => {
  const f = fixture();
  assert.equal(f.finalVerdict.status, 'LOCAL_CUSTODY_IMPORT_REHEARSAL_ONLY');
  assert.equal(f.finalVerdict.provisionedRoleCount, 11);
  assert.equal(f.finalVerdict.productionAuthority, 'NONE');
  assert.equal(f.finalVerdict.externalEffectsExecuted, 0);
});
test('v33.38 consumes all eleven provisioning challenges exactly once', () => { const f = fixture(); assert.equal(new Set(f.receipts.map((row) => row.payload.challengeDigest)).size, 11); });
test('v33.38 rejects provisioning challenge replay', () => {
  const f = fixture(); const consumed = new Set<string>();
  finalizeOneTimeProvisioningV33_38({ provisioningAuthority: f.provisioningAuthority, manifest: f.manifest, challenge: f.challenges[0]!, response: f.responses[0]!, trust: f.custodyTrust, consumedChallengeDigests: consumed, provisionedAt: at('2026-07-22T18:40:00Z') });
  assert.throws(() => finalizeOneTimeProvisioningV33_38({ provisioningAuthority: f.provisioningAuthority, manifest: f.manifest, challenge: f.challenges[0]!, response: f.responses[0]!, trust: f.custodyTrust, consumedChallengeDigests: consumed, provisionedAt: at('2026-07-22T18:41:00Z') }), /replay/);
});
test('v33.38 rejects provisioning response from wrong actor', () => { const f = fixture(); assert.throws(() => createProvisioningResponseV33_38({ actor: f.monitors[1]!, actorDescriptor: f.rows.get(f.monitors[1]!.keyId)!, challenge: f.challenges[0]!.payload, respondedAt: at('2026-07-22T18:20:00Z') }), /actor_binding/); });
test('v33.38 rejects expired provisioning challenge', () => { const f = fixture(); assert.throws(() => finalizeOneTimeProvisioningV33_38({ provisioningAuthority: f.provisioningAuthority, manifest: f.manifest, challenge: f.challenges[0]!, response: f.responses[0]!, trust: f.custodyTrust, consumedChallengeDigests: new Set(), provisionedAt: at('2026-07-22T20:00:00Z') }), /not_active/); });
test('v33.38 rejects forged provisioning challenge signature', () => { const f = fixture(); const attacker = generateSigningIdentity('v3338-attacker'); const forged = signEnvelope(f.challenges[0]!.payload, attacker); assert.throws(() => finalizeOneTimeProvisioningV33_38({ provisioningAuthority: f.provisioningAuthority, manifest: f.manifest, challenge: forged, response: f.responses[0]!, trust: f.custodyTrust, consumedChallengeDigests: new Set(), provisionedAt: at('2026-07-22T18:40:00Z') }), /challenge_signature/); });
test('v33.38 rejects provisioning authority overlapping a deployment role', () => { const f = fixture(); assert.throws(() => createProvisioningChallengeV33_38({ provisioningAuthority: f.publisher, provisioningAuthorityDescriptor: f.rows.get(f.publisher.keyId)!, manifest: f.manifest.payload, ceremonyId: 'bad', roleSlot: 'MONITOR_1', nonce: new Uint8Array(32), issuedAt: at('2026-07-22T18:00:00Z'), expiresAt: at('2026-07-22T19:00:00Z') }), /authority_overlap/); });

// Ceremony transcript integrity.
test('v33.38 rejects ceremony transcript missing one role receipt', () => { const f = fixture(); assert.throws(() => createCustodyCeremonyTranscriptV33_38({ recorder: f.recorder, recorderDescriptor: f.infrastructureRows.get(f.recorder.keyId)!, manifest: f.manifest.payload, ceremonyId: f.ceremonyId, receipts: f.receipts.slice(0, 10), executionClass: 'LOCAL_REHEARSAL', openedAt: at('2026-07-22T18:00:00Z'), closedAt: at('2026-07-22T18:50:00Z') }), /receipt_set/); });
test('v33.38 rejects transcript with changed receipt ordering', () => { const f = fixture(); const changed = resign(f.transcript, f.recorder, 'transcriptDigest', { provisioningReceiptDigests: [...f.transcript.payload.provisioningReceiptDigests].reverse() }); assert.throws(() => verifyCustodyCeremonyV33_38({ manifest: f.manifest, challenges: f.challenges, responses: f.responses, receipts: f.receipts, transcript: changed, witnesses: f.ceremonyWitnessEnvelopes, trust: f.custodyTrust, verifiedAt: at('2026-07-22T19:00:00Z') }), /exactness/); });
test('v33.38 rejects forged ceremony transcript signature', () => { const f = fixture(); const attacker = generateSigningIdentity('v3338-transcript-attacker'); const forged = signEnvelope(f.transcript.payload, attacker); assert.throws(() => verifyCustodyCeremonyV33_38({ manifest: f.manifest, challenges: f.challenges, responses: f.responses, receipts: f.receipts, transcript: forged, witnesses: f.ceremonyWitnessEnvelopes, trust: f.custodyTrust, verifiedAt: at('2026-07-22T19:00:00Z') }), /transcript_signature/); });
test('v33.38 rejects ceremony witness quorum below two', () => { const f = fixture(); assert.throws(() => verifyCustodyCeremonyV33_38({ manifest: f.manifest, challenges: f.challenges, responses: f.responses, receipts: f.receipts, transcript: f.transcript, witnesses: f.ceremonyWitnessEnvelopes.slice(0, 1), trust: f.custodyTrust, verifiedAt: at('2026-07-22T19:00:00Z') }), /witness_quorum/); });
test('v33.38 rejects ceremony witnesses sharing an organization', () => { const f = fixture(); const second = f.ceremonyWitnesses[1]!; const row = { ...f.infrastructureRows.get(second.keyId)!, organizationId: f.infrastructureRows.get(f.ceremonyWitnesses[0]!.keyId)!.organizationId }; const bad = createCustodyCeremonyWitnessV33_38({ witness: second, witnessDescriptor: row, manifestDigest: f.manifest.payload.manifestDigest, transcript: f.transcript.payload, observedAt: at('2026-07-22T18:52:00Z') }); assert.throws(() => verifyCustodyCeremonyV33_38({ manifest: f.manifest, challenges: f.challenges, responses: f.responses, receipts: f.receipts, transcript: f.transcript, witnesses: [f.ceremonyWitnessEnvelopes[0]!, bad], trust: f.custodyTrust, verifiedAt: at('2026-07-22T19:00:00Z') }), /witness_separation/); });
test('v33.38 refuses transcript closure before provisioning completed', () => { const f = fixture(); assert.throws(() => createCustodyCeremonyTranscriptV33_38({ recorder: f.recorder, recorderDescriptor: f.infrastructureRows.get(f.recorder.keyId)!, manifest: f.manifest.payload, ceremonyId: f.ceremonyId, receipts: f.receipts, executionClass: 'LOCAL_REHEARSAL', openedAt: at('2026-07-22T18:00:00Z'), closedAt: at('2026-07-22T18:31:00Z') }), /closed_before/); });

// Key lifecycle and anti-resurrection.
test('v33.38 accepts scheduled key rotation with old and new key possession', () => { const f = fixture(); const chain = verifyRoleLifecycleChainV33_38({ certificates: f.lifecycleCertificates, trust: f.custodyTrust, manifest: f.manifest.payload, transcriptDigest: f.transcript.payload.transcriptDigest, verifiedAt: at('2026-07-22T20:00:00Z') }); assert.equal(chain.activeActors.get('MONITOR_1')?.keyId, f.replacementMonitor.keyId); assert(chain.revokedKeyIds.has(f.monitors[0]!.keyId)); });
test('v33.38 rejects scheduled rotation without current-key consent', () => { const f = fixture(); assert.throws(() => finalizeRoleLifecycleChangeV33_38({ lifecycleAuthority: f.lifecycleAuthority, proposal: f.rotationProposal, currentKeyConsent: null, replacementKeyAcceptance: f.replacementAcceptance, securityApprovals: f.securityApprovals, trust: f.custodyTrust, finalizedAt: at('2026-07-22T19:08:00Z') }), /proof_missing/); });
test('v33.38 accepts emergency rotation only with three security custodians', () => { const f = fixture(); const emergency = buildEmergencyCertificate(f); assert.equal(emergency.certificate.payload.action, 'EMERGENCY_ROTATION'); });
test('v33.38 rejects emergency rotation with only two custodians', () => { const f = fixture(); const emergency = buildEmergencyCertificate(f); assert.throws(() => finalizeRoleLifecycleChangeV33_38({ lifecycleAuthority: f.lifecycleAuthority, proposal: emergency.proposal, currentKeyConsent: null, replacementKeyAcceptance: emergency.replacementAcceptance, securityApprovals: emergency.approvals.slice(0, 2), trust: f.custodyTrust, finalizedAt: at('2026-07-22T19:08:00Z') }), /security_quorum/); });
test('v33.38 rejects duplicate security custodian approvals', () => { const f = fixture(); assert.throws(() => finalizeRoleLifecycleChangeV33_38({ lifecycleAuthority: f.lifecycleAuthority, proposal: f.rotationProposal, currentKeyConsent: f.currentConsent, replacementKeyAcceptance: f.replacementAcceptance, securityApprovals: [f.securityApprovals[0]!, f.securityApprovals[0]!], trust: f.custodyTrust, finalizedAt: at('2026-07-22T19:08:00Z') }), /custodian_separation/); });
test('v33.38 rejects lifecycle chain starting from an actor not assigned by manifest', () => { const f = fixture(); const wrongProposal = createRoleLifecycleProposalV33_38({ lifecycleAuthority: f.lifecycleAuthority, manifestDigest: f.manifest.payload.manifestDigest, transcriptDigest: f.transcript.payload.transcriptDigest, lifecycleSequence: 1, previousLifecycleDigest: null, roleSlot: 'MONITOR_2', action: 'SCHEDULED_ROTATION', currentActor: f.rows.get(f.monitors[0]!.keyId)!, replacementActor: f.rows.get(f.replacementMonitor.keyId)!, reasonDigest: sha256({ wrong: true }), effectiveAt: at('2026-07-22T19:10:00Z') }); const oldConsent = createRolePossessionStatementV33_38({ actor: f.monitors[0]!, actorDescriptor: f.rows.get(f.monitors[0]!.keyId)!, proposalDigest: wrongProposal.payload.proposalDigest, purpose: 'CURRENT_KEY_CONSENT', signedAt: at('2026-07-22T19:05:00Z') }); const nextConsent = createRolePossessionStatementV33_38({ actor: f.replacementMonitor, actorDescriptor: f.rows.get(f.replacementMonitor.keyId)!, proposalDigest: wrongProposal.payload.proposalDigest, purpose: 'REPLACEMENT_KEY_ACCEPTANCE', signedAt: at('2026-07-22T19:05:00Z') }); const approvals = f.securityCustodians.slice(0, 2).map((custodian) => createSecurityCustodianApprovalV33_38({ custodian, custodianDescriptor: f.infrastructureRows.get(custodian.keyId)!, proposalDigest: wrongProposal.payload.proposalDigest, approvedAt: at('2026-07-22T19:06:00Z') })); const certificate = finalizeRoleLifecycleChangeV33_38({ lifecycleAuthority: f.lifecycleAuthority, proposal: wrongProposal, currentKeyConsent: oldConsent, replacementKeyAcceptance: nextConsent, securityApprovals: approvals, trust: f.custodyTrust, finalizedAt: at('2026-07-22T19:08:00Z') }); assert.throws(() => verifyRoleLifecycleChainV33_38({ certificates: [certificate], trust: f.custodyTrust, manifest: f.manifest.payload, transcriptDigest: f.transcript.payload.transcriptDigest, verifiedAt: at('2026-07-22T20:00:00Z') }), /current_actor/); });
test('v33.38 blocks old-key resurrection after rotation', () => { const f = fixture(); const assertion = createRoleActionAssertionV33_38({ actor: f.monitors[0]!, manifestDigest: f.manifest.payload.manifestDigest, transcriptDigest: f.transcript.payload.transcriptDigest, roleSlot: 'MONITOR_1', lifecycleHeadDigest: f.lifecycleCertificate.payload.lifecycleDigest, actionBytes: Buffer.from('old-key-action'), actedAt: at('2026-07-22T19:20:00Z') }); assert.throws(() => verifyRoleActionAssertionV33_38({ assertion, manifest: f.manifest.payload, lifecycleCertificates: f.lifecycleCertificates, trust: f.custodyTrust, manifestDigest: f.manifest.payload.manifestDigest, transcriptDigest: f.transcript.payload.transcriptDigest, verifiedAt: at('2026-07-22T19:20:00Z') }), /key_inactive/); });
test('v33.38 accepts replacement-key action at current lifecycle head', () => { const f = fixture(); const assertion = createRoleActionAssertionV33_38({ actor: f.replacementMonitor, manifestDigest: f.manifest.payload.manifestDigest, transcriptDigest: f.transcript.payload.transcriptDigest, roleSlot: 'MONITOR_1', lifecycleHeadDigest: f.lifecycleCertificate.payload.lifecycleDigest, actionBytes: Buffer.from('new-key-action'), actedAt: at('2026-07-22T19:20:00Z') }); assert.doesNotThrow(() => verifyRoleActionAssertionV33_38({ assertion, manifest: f.manifest.payload, lifecycleCertificates: f.lifecycleCertificates, trust: f.custodyTrust, manifestDigest: f.manifest.payload.manifestDigest, transcriptDigest: f.transcript.payload.transcriptDigest, verifiedAt: at('2026-07-22T19:20:00Z') })); });
test('v33.38 rejects role action bound to stale lifecycle head', () => { const f = fixture(); const assertion = createRoleActionAssertionV33_38({ actor: f.replacementMonitor, manifestDigest: f.manifest.payload.manifestDigest, transcriptDigest: f.transcript.payload.transcriptDigest, roleSlot: 'MONITOR_1', lifecycleHeadDigest: null, actionBytes: Buffer.from('stale-head'), actedAt: at('2026-07-22T19:20:00Z') }); assert.throws(() => verifyRoleActionAssertionV33_38({ assertion, manifest: f.manifest.payload, lifecycleCertificates: f.lifecycleCertificates, trust: f.custodyTrust, manifestDigest: f.manifest.payload.manifestDigest, transcriptDigest: f.transcript.payload.transcriptDigest, verifiedAt: at('2026-07-22T19:20:00Z') }), /binding/); });

test('v33.38 recomputes lifecycle evidence instead of trusting the signed certificate alone', () => { const f = fixture(); const tamperedConsent = { ...f.currentConsent, payload: { ...f.currentConsent.payload, purpose: 'REPLACEMENT_KEY_ACCEPTANCE' as const } }; assert.throws(() => verifyRoleLifecycleEvidenceV33_38({ evidence: { ...f.lifecycleEvidence[0]!, currentKeyConsent: tamperedConsent }, trust: f.custodyTrust, manifest: f.manifest.payload, transcriptDigest: f.transcript.payload.transcriptDigest, verifiedAt: at('2026-07-22T20:00:00Z') }), /possession_signature|possession_binding/); });

// Transparency log and final import binding.
test('v33.38 verifies append-only receipt transparency snapshot and two-witness checkpoint', () => { const f = fixture(); assert.doesNotThrow(() => verifyCustodyTransparencyCheckpointV33_38({ snapshot: f.transparencySnapshot, witnesses: f.transparencyWitnesses, trust: f.custodyTrust, verifiedAt: at('2026-07-22T20:00:00Z') })); });
test('v33.38 rejects tampered transparency event even when snapshot is re-signed', () => { const f = fixture(); const events = [...f.transparencySnapshot.payload.events]; events[0] = { ...events[0]!, subjectDigest: sha256({ changed: true }) }; const changed = resign(f.transparencySnapshot, f.logAuthority, 'snapshotDigest', { events }); assert.throws(() => verifyCustodyTransparencySnapshotV33_38({ snapshot: changed, trust: f.custodyTrust, verifiedAt: at('2026-07-22T20:00:00Z') }), /log_chain/); });
test('v33.38 rejects transparency rollback against a newer pinned snapshot', () => { const f = fixture(); assert.throws(() => verifyCustodyTransparencySnapshotV33_38({ snapshot: f.preImportSnapshot, previousSnapshot: f.transparencySnapshot, trust: f.custodyTrust, verifiedAt: at('2026-07-22T20:00:00Z') }), /rollback_or_fork/); });
test('v33.38 detects split view at same log coordinate', () => { const f = fixture(); const fork = new CustodyReceiptTransparencyLogV33_38('custody-log-v3338', f.logAuthority); let t = Date.parse('2026-07-22T19:20:00Z'); for (let i = 0; i < f.transparencySnapshot.payload.eventCount; i++) { fork.append(i === f.transparencySnapshot.payload.eventCount - 1 ? 'EVIDENCE_IMPORTED' : 'ROLE_PROVISIONED', sha256({ fork: i }), i < 11 ? f.assignments[i]!.roleSlot : null, new Date(t + i * 1000)); } const forkSnapshot = fork.snapshot(at('2026-07-22T20:00:00Z')); assert.equal(detectCustodyTransparencySplitViewV33_38([f.transparencySnapshot, forkSnapshot]), true); });
test('v33.38 rejects transparency checkpoint with one witness', () => { const f = fixture(); assert.throws(() => verifyCustodyTransparencyCheckpointV33_38({ snapshot: f.transparencySnapshot, witnesses: f.transparencyWitnesses.slice(0, 1), trust: f.custodyTrust, verifiedAt: at('2026-07-22T20:00:00Z') }), /checkpoint_quorum/); });
test('v33.38 rejects transparency witnesses sharing a host', () => { const f = fixture(); const second = f.logWitnesses[1]!; const row = { ...f.infrastructureRows.get(second.keyId)!, hostId: f.infrastructureRows.get(f.logWitnesses[0]!.keyId)!.hostId }; const bad = createCustodyTransparencyWitnessV33_38({ witness: second, witnessDescriptor: row, snapshot: f.transparencySnapshot.payload, observedAt: at('2026-07-22T20:01:00Z') }); assert.throws(() => verifyCustodyTransparencyCheckpointV33_38({ snapshot: f.transparencySnapshot, witnesses: [f.transparencyWitnesses[0]!, bad], trust: f.custodyTrust, verifiedAt: at('2026-07-22T20:02:00Z') }), /witness_separation/); });
test('v33.38 rejects final qualification when import receipt is not logged', () => { const f = fixture(); const witnesses = f.logWitnesses.map((witness, index) => createCustodyTransparencyWitnessV33_38({ witness, witnessDescriptor: f.infrastructureRows.get(witness.keyId)!, snapshot: f.preImportSnapshot.payload, observedAt: new Date(Date.parse('2026-07-22T20:00:00Z') + index * 1000) })); assert.throws(() => verifyExternalCustodyQualificationV33_38({ manifest: f.manifest, ceremonyVerdict: f.ceremonyVerdict, provisioningChallenges: f.challenges, provisioningResponses: f.responses, provisioningReceipts: f.receipts, ceremonyTranscript: f.transcript, ceremonyWitnesses: f.ceremonyWitnessEnvelopes, lifecycleEvidence: f.lifecycleEvidence, importReceipt: f.importReceipt, importReadiness: f.readiness, importChallenge: f.importChallenge, importBundle: f.bundle, importFileBytes: Object.fromEntries(Object.entries(f.files).map(([path, row]) => [path, row.bytes])), importRecovery: f.recoveryAttestation, importTrust: f.importTrust, transparencySnapshot: f.preImportSnapshot, transparencyWitnesses: witnesses, trust: f.custodyTrust, verifiedAt: at('2026-07-22T20:00:00Z') }), /import_not_logged/); });
test('v33.38 rejects final qualification when lifecycle certificate is not logged', () => { const f = fixture(); const localLog = new CustodyReceiptTransparencyLogV33_38('custody-log-no-lifecycle', f.logAuthority); let t = Date.parse('2026-07-22T19:20:00Z'); for (const receipt of f.receipts) { localLog.append('ROLE_PROVISIONED', receipt.payload.receiptDigest, receipt.payload.roleSlot, new Date(t)); t += 1000; } localLog.append('CEREMONY_CLOSED', f.transcript.payload.transcriptDigest, null, new Date(t)); t += 1000; localLog.append('EVIDENCE_IMPORTED', f.importReceipt.importDigest, null, new Date(t)); const snapshot = localLog.snapshot(at('2026-07-22T20:00:00Z')); const witnesses = f.logWitnesses.map((witness) => createCustodyTransparencyWitnessV33_38({ witness, witnessDescriptor: f.infrastructureRows.get(witness.keyId)!, snapshot: snapshot.payload, observedAt: at('2026-07-22T20:01:00Z') })); assert.throws(() => verifyExternalCustodyQualificationV33_38({ manifest: f.manifest, ceremonyVerdict: f.ceremonyVerdict, provisioningChallenges: f.challenges, provisioningResponses: f.responses, provisioningReceipts: f.receipts, ceremonyTranscript: f.transcript, ceremonyWitnesses: f.ceremonyWitnessEnvelopes, lifecycleEvidence: f.lifecycleEvidence, importReceipt: f.importReceipt, importReadiness: f.readiness, importChallenge: f.importChallenge, importBundle: f.bundle, importFileBytes: Object.fromEntries(Object.entries(f.files).map(([path, row]) => [path, row.bytes])), importRecovery: f.recoveryAttestation, importTrust: f.importTrust, transparencySnapshot: snapshot, transparencyWitnesses: witnesses, trust: f.custodyTrust, verifiedAt: at('2026-07-22T20:02:00Z') }), /lifecycle_not_logged/); });
test('v33.38 rejects tampered v33.37 import receipt', () => { const f = fixture(); const bad = { ...f.importReceipt, verifiedFileCount: 999 }; assert.throws(() => verifyExternalCustodyQualificationV33_38({ manifest: f.manifest, ceremonyVerdict: f.ceremonyVerdict, provisioningChallenges: f.challenges, provisioningResponses: f.responses, provisioningReceipts: f.receipts, ceremonyTranscript: f.transcript, ceremonyWitnesses: f.ceremonyWitnessEnvelopes, lifecycleEvidence: f.lifecycleEvidence, importReceipt: bad, importReadiness: f.readiness, importChallenge: f.importChallenge, importBundle: f.bundle, importFileBytes: Object.fromEntries(Object.entries(f.files).map(([path, row]) => [path, row.bytes])), importRecovery: f.recoveryAttestation, importTrust: f.importTrust, transparencySnapshot: f.transparencySnapshot, transparencyWitnesses: f.transparencyWitnesses, trust: f.custodyTrust, verifiedAt: at('2026-07-22T20:00:00Z') }), /import_receipt/); });
test('v33.38 structurally accepts live external custody evidence but still grants no production authority', () => { const f = fixture('LIVE_EXTERNAL'); assert.equal(f.finalVerdict.status, 'EXTERNAL_CUSTODY_EVIDENCE_ACCEPTED'); assert.equal(f.finalVerdict.externalTopologyObserved, true); assert.equal(f.finalVerdict.productionAuthority, 'NONE'); });
