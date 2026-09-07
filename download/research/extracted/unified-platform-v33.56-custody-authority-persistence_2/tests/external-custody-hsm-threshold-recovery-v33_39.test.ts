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
import type { ExternalCustodyQualificationVerdictV33_38 } from '../src/app/external-qualification-custody-ceremony-v33_38.js';
import {
  createHardwareKeyAttestationV33_39,
  createPublicCheckpointPublicationV33_39,
  createPublicCheckpointRetrievalReceiptV33_39,
  createRevocationPropagationReceiptV33_39,
  createSealedCustodyTransferPackageV33_39,
  createSiteLossRecoveryReceiptV33_39,
  createThresholdCustodianApprovalV33_39,
  finalizeThresholdOperationV33_39,
  verifyExternalCustodyHardwareQualificationV33_39,
  verifyHardwareKeyAttestationsV33_39,
  verifyPublicCheckpointPublicationV33_39,
  verifyRevocationPropagationV33_39,
  verifySealedCustodyTransferPackageV33_39,
  verifySiteLossRecoveryV33_39,
  verifyThresholdCertificateV33_39,
  verifyThresholdChainV33_39,
  type HardwareCustodyTrustV33_39,
  type HardwareKeyAttestationV33_39,
  type ThresholdOperationEvidenceV33_39,
  type ThresholdOperationTypeV33_39,
} from '../src/app/external-custody-hsm-threshold-recovery-v33_39.js';

const ROLE_SLOTS = [
  'PUBLISHER', 'MONITOR_1', 'MONITOR_2', 'MONITOR_3', 'TOPOLOGY_AUDITOR_1', 'TOPOLOGY_AUDITOR_2',
  'TIME_SOURCE_1', 'TIME_SOURCE_2', 'EVIDENCE_EXPORTER', 'EVIDENCE_IMPORTER', 'RECOVERY_VERIFIER',
] as const;

function priorVerdict(manifestDigest: string, transcriptDigest: string): ExternalCustodyQualificationVerdictV33_38 {
  const material = {
    version: '33.38' as const,
    manifestDigest,
    transcriptDigest,
    importDigest: sha256('import'),
    transparencySnapshotDigest: sha256('snapshot'),
    transparencyHeadEventDigest: sha256('head'),
    lifecycleHeadDigest: sha256('lifecycle'),
    provisionedRoleCount: 11 as const,
    transparencyWitnessCount: 2,
    custodyChainVerified: true as const,
    lifecycleChainVerified: true as const,
    importReceiptLogged: true as const,
    status: 'LOCAL_CUSTODY_IMPORT_REHEARSAL_ONLY' as const,
    externalTopologyObserved: false,
    externalHumanParticipants: 0 as const,
    verifiedAt: '2026-07-22T20:00:00.000Z',
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return { ...material, verdictDigest: sha256(material) };
}

function fixture() {
  const registry = new KeyRegistry();
  const identity = (id: string): SigningIdentity => {
    const row = generateSigningIdentity(id);
    registry.register(row.keyId, row.publicKey);
    return row;
  };
  const descriptor = (row: SigningIdentity, n: string): QualificationActorDescriptorV33_36 => ({
    keyId: row.keyId,
    keyFingerprint: registry.fingerprint(row.keyId)!,
    organizationId: `org-${n}`,
    hostId: `host-${n}`,
    administratorId: `admin-${n}`,
  });
  const attestationAuthority = identity('attestation-authority');
  const thresholdAuthority = identity('threshold-authority');
  const transferAuthority = identity('transfer-authority');
  const publicationAuthority = identity('publication-authority');
  const recoveryVerifier = identity('site-recovery-verifier');
  const custodians = Array.from({ length: 5 }, (_, i) => identity(`threshold-custodian-${i + 1}`));
  const custodianDescriptors = custodians.map((row, i) => descriptor(row, `custodian-${i + 1}`));
  const monitors = Array.from({ length: 3 }, (_, i) => identity(`checkpoint-monitor-${i + 1}`));
  const monitorDescriptors = monitors.map((row, i) => descriptor(row, `checkpoint-monitor-${i + 1}`));
  const roles = ROLE_SLOTS.map((roleSlot, i) => {
    const actor = identity(`role-${i + 1}`);
    return { roleSlot, actor, descriptor: descriptor(actor, `role-${i + 1}`) };
  });
  const rotated = identity('role-publisher-rotated');
  const rotatedDescriptor = descriptor(rotated, 'role-publisher-rotated');
  const recoveryVerifierDescriptor = descriptor(recoveryVerifier, 'site-recovery-verifier');
  const trust: HardwareCustodyTrustV33_39 = {
    hardwareAttestationRegistry: registry,
    trustedHardwareAttestationAuthorityIds: [attestationAuthority.keyId],
    thresholdCustodianRegistry: registry,
    trustedThresholdCustodianIds: custodians.map((row) => row.keyId),
    thresholdAuthorityRegistry: registry,
    trustedThresholdAuthorityIds: [thresholdAuthority.keyId],
    transferAuthorityRegistry: registry,
    trustedTransferAuthorityIds: [transferAuthority.keyId],
    publicationAuthorityRegistry: registry,
    trustedPublicationAuthorityIds: [publicationAuthority.keyId],
    monitorRegistry: registry,
    trustedMonitorIds: monitors.map((row) => row.keyId),
    recoveryVerifierRegistry: registry,
    trustedRecoveryVerifierIds: [recoveryVerifier.keyId],
  };
  const manifestDigest = sha256('manifest-v33.39');
  const transcriptDigest = sha256('transcript-v33.39');
  const verificationTime = new Date('2026-07-22T20:30:00.000Z');
  const attestations = roles.map((row, i) => createHardwareKeyAttestationV33_39({
    authority: attestationAuthority,
    manifestDigest,
    transcriptDigest,
    roleSlot: row.roleSlot,
    actor: row.descriptor,
    providerClass: 'TPM_BOUND',
    providerId: `local-tpm-provider-${i + 1}`,
    deviceId: `device-${i + 1}`,
    deviceFirmware: Buffer.from(`firmware-image-${i + 1}-v1`),
    issuedAt: new Date('2026-07-22T19:00:00.000Z'),
    expiresAt: new Date('2026-08-22T19:00:00.000Z'),
    executionClass: 'LOCAL_REHEARSAL',
  }));
  const rotatedAttestation = createHardwareKeyAttestationV33_39({
    authority: attestationAuthority,
    manifestDigest,
    transcriptDigest,
    roleSlot: 'PUBLISHER',
    actor: rotatedDescriptor,
    providerClass: 'TPM_BOUND',
    providerId: 'local-tpm-provider-rotated',
    deviceId: 'device-publisher-rotated',
    deviceFirmware: Buffer.from('firmware-image-rotated-v1'),
    issuedAt: new Date('2026-07-22T19:00:00.000Z'),
    expiresAt: new Date('2026-08-22T19:00:00.000Z'),
    executionClass: 'LOCAL_REHEARSAL',
  });
  const thresholdEvidence: ThresholdOperationEvidenceV33_39[] = [];
  const makeThreshold = (operationDigest: string, operationType: ThresholdOperationTypeV33_39, sequence: number, previous: string | null) => {
    const approvals = custodians.slice(0, 3).map((custodian, i) => createThresholdCustodianApprovalV33_39({
      custodian,
      custodianDescriptor: custodianDescriptors[i]!,
      operationDigest,
      operationType,
      shareIndex: i + 1,
      approvedAt: new Date(`2026-07-22T20:0${sequence}:00.000Z`),
    }));
    const certificate = finalizeThresholdOperationV33_39({
      authority: thresholdAuthority,
      manifestDigest,
      transcriptDigest,
      operationDigest,
      operationType,
      thresholdSequence: sequence,
      previousThresholdDigest: previous,
      approvals,
      trust,
      issuedAt: new Date(`2026-07-22T20:0${sequence}:30.000Z`),
    });
    const evidence = { operationDigest, operationType, approvals, certificate } as const;
    thresholdEvidence.push(evidence);
    return evidence;
  };
  const publicBytes = Buffer.from('public checkpoint v33.39 bytes');
  const checkpointOperation = sha256({
    priorCustodyVerdictDigest: priorVerdict(manifestDigest, transcriptDigest).verdictDigest,
    custodyTransparencyHeadDigest: sha256('custody-head'),
    checkpointSequence: 1,
    publishedBytesDigest: sha256(Buffer.from(publicBytes).toString('base64')),
  });
  // sha256Bytes is used by the implementation; derive it through a temporary attestation-compatible path below.
  const publishedBytesDigest = (createPublicCheckpointPublicationV33_39 as unknown);
  void publishedBytesDigest;
  const crypto = awaitImportSha256Bytes(publicBytes);
  const checkpointDigest = sha256({
    priorCustodyVerdictDigest: priorVerdict(manifestDigest, transcriptDigest).verdictDigest,
    custodyTransparencyHeadDigest: sha256('custody-head'),
    checkpointSequence: 1,
    publishedBytesDigest: crypto,
  });
  const checkpointThreshold = makeThreshold(checkpointDigest, 'PUBLIC_CHECKPOINT', 1, null);
  const publication = createPublicCheckpointPublicationV33_39({
    authority: publicationAuthority,
    manifestDigest,
    transcriptDigest,
    checkpointSequence: 1,
    previousPublicationDigest: null,
    priorCustodyVerdictDigest: priorVerdict(manifestDigest, transcriptDigest).verdictDigest,
    custodyTransparencyHeadDigest: sha256('custody-head'),
    thresholdCertificateDigest: checkpointThreshold.certificate.payload.thresholdDigest,
    endpoint: 'https://checkpoint.local/v33.39/checkpoint.json',
    dnsName: 'checkpoint.local',
    publishedBytes: publicBytes,
    publisher: roles[0]!.descriptor,
    publishedAt: new Date('2026-07-22T20:05:00.000Z'),
    executionClass: 'LOCAL_REHEARSAL',
    networkRetrievalObserved: true,
  });
  const retrievalReceipts = monitors.map((monitor, i) => createPublicCheckpointRetrievalReceiptV33_39({
    monitor,
    monitorDescriptor: monitorDescriptors[i]!,
    publication: publication.payload,
    retrievedBytes: publicBytes,
    retrievedAt: new Date(`2026-07-22T20:0${6 + i}:00.000Z`),
    networkClass: 'LOCAL_LOOPBACK',
  }));
  const lifecycleDigest = sha256('revoked-lifecycle-head');
  const revokedKeyId = roles[0]!.actor.keyId;
  const revocationThreshold = makeThreshold(sha256({ lifecycleDigest, revokedKeyId }), 'REVOCATION_PROPAGATION', 2, checkpointThreshold.certificate.payload.thresholdDigest);
  const revocationReceipts = monitors.map((monitor, i) => createRevocationPropagationReceiptV33_39({
    monitor,
    monitorDescriptor: monitorDescriptors[i]!,
    manifestDigest,
    transcriptDigest,
    lifecycleDigest,
    revokedKeyId,
    revocationSequence: 1,
    previousRevocationDigest: null,
    thresholdCertificateDigest: revocationThreshold.certificate.payload.thresholdDigest,
    appliedAt: new Date(`2026-07-22T20:1${i}:00.000Z`),
  }));
  const incident = Buffer.from('site loss incident evidence');
  const backupInventory = Buffer.from('backup inventory exact bytes');
  const restoredArtifact = Buffer.from('restored custody artifact exact bytes');
  const recoverySiteId = 'site-recovery-b';
  const recoveryOperationDigest = sha256({
    incidentDigest: awaitImportSha256Bytes(incident),
    priorCheckpointPublicationDigest: publication.payload.publicationDigest,
    recoverySiteId,
    backupInventoryDigest: awaitImportSha256Bytes(backupInventory),
    restoredArtifactDigest: awaitImportSha256Bytes(restoredArtifact),
  });
  const recoveryThreshold = makeThreshold(recoveryOperationDigest, 'SITE_RECOVERY', 3, revocationThreshold.certificate.payload.thresholdDigest);
  const recoveryReceipt = createSiteLossRecoveryReceiptV33_39({
    verifier: recoveryVerifier,
    verifierDescriptor: recoveryVerifierDescriptor,
    manifestDigest,
    transcriptDigest,
    incident,
    lostSiteId: 'site-primary-a',
    recoverySiteId,
    priorCheckpointPublicationDigest: publication.payload.publicationDigest,
    restoredCheckpointSequence: 1,
    restoredThresholdHeadDigest: recoveryThreshold.certificate.payload.thresholdDigest,
    backupInventory,
    restoredArtifact,
    thresholdCertificateDigest: recoveryThreshold.certificate.payload.thresholdDigest,
    recoveredAt: new Date('2026-07-22T20:20:00.000Z'),
    executionClass: 'LOCAL_REHEARSAL',
  });
  const sealedTransferMaterial = Buffer.from('sealed transfer material for recipient only');
  const transferNonce = Buffer.alloc(32, 7);
  const transfer = createSealedCustodyTransferPackageV33_39({
    authority: transferAuthority,
    manifestDigest,
    transcriptDigest,
    roleSlot: 'PUBLISHER',
    sourceActor: roles[0]!.descriptor,
    targetActor: rotatedDescriptor,
    sourceHardwareAttestationDigest: attestations[0]!.payload.attestationDigest,
    targetHardwareAttestationDigest: rotatedAttestation.payload.attestationDigest,
    sealedMaterial: sealedTransferMaterial,
    transferNonce,
    createdAt: new Date('2026-07-22T20:02:00.000Z'),
    expiresAt: new Date('2026-07-22T21:02:00.000Z'),
  });
  return {
    registry, trust, identities: { attestationAuthority, thresholdAuthority, transferAuthority, publicationAuthority, recoveryVerifier, custodians, monitors, roles, rotated },
    descriptors: { custodianDescriptors, monitorDescriptors, rotatedDescriptor, recoveryVerifierDescriptor },
    manifestDigest, transcriptDigest, verificationTime, attestations, rotatedAttestation, thresholdEvidence,
    checkpointThreshold, revocationThreshold, recoveryThreshold, publication, publicBytes, retrievalReceipts,
    lifecycleDigest, revokedKeyId, revocationReceipts, incident, backupInventory, restoredArtifact, recoveryReceipt,
    sealedTransferMaterial, transferNonce, transfer, prior: priorVerdict(manifestDigest, transcriptDigest),
  };
}

// Keep tests independent from implementation internals while matching its byte hashing primitive.
import { sha256Bytes as awaitImportSha256Bytes } from '../src/contracts/crypto.js';

function resign<T>(payload: T, identity: SigningIdentity): SignedEnvelope<T> { return signEnvelope(payload, identity); }

// Core happy paths.
test('hardware attestations bind all eleven roles', () => {
  const f = fixture();
  assert.deepEqual(verifyHardwareKeyAttestationsV33_39({ attestations: f.attestations, expectedRoles: f.identities.roles.map((r) => ({ roleSlot: r.roleSlot, actor: r.descriptor })), trust: f.trust, verifiedAt: f.verificationTime }), { hardwareBoundRoleCount: 11, externalHardwareObserved: false });
});
test('threshold certificate verifies three of five separated custodians', () => {
  const f = fixture();
  assert.equal(verifyThresholdCertificateV33_39({ evidence: f.checkpointThreshold, manifestDigest: f.manifestDigest, transcriptDigest: f.transcriptDigest, trust: f.trust, verifiedAt: f.verificationTime }).threshold, 3);
});
test('threshold chain preserves exact sequence and predecessor', () => {
  const f = fixture();
  assert.deepEqual(verifyThresholdChainV33_39({ evidence: f.thresholdEvidence, manifestDigest: f.manifestDigest, transcriptDigest: f.transcriptDigest, trust: f.trust, verifiedAt: f.verificationTime }), { headDigest: f.recoveryThreshold.certificate.payload.thresholdDigest, sequence: 3 });
});
test('sealed custody transfer verifies exact bytes and target attestation', () => {
  const f = fixture();
  assert.doesNotThrow(() => verifySealedCustodyTransferPackageV33_39({ transfer: f.transfer, sourceAttestation: f.attestations[0]!, targetAttestation: f.rotatedAttestation, sealedMaterial: f.sealedTransferMaterial, transferNonce: f.transferNonce, trust: f.trust, verifiedAt: f.verificationTime }));
});
test('public checkpoint verifies threshold and three retrieval monitors', () => {
  const f = fixture();
  assert.deepEqual(verifyPublicCheckpointPublicationV33_39({ publication: f.publication, thresholdEvidence: f.checkpointThreshold, retrievalReceipts: f.retrievalReceipts, publishedBytes: f.publicBytes, manifestDigest: f.manifestDigest, transcriptDigest: f.transcriptDigest, trust: f.trust, verifiedAt: f.verificationTime }), { externalTopologyObserved: false });
});
test('revocation propagation verifies on three monitors', () => {
  const f = fixture();
  assert.doesNotThrow(() => verifyRevocationPropagationV33_39({ receipts: f.revocationReceipts, thresholdEvidence: f.revocationThreshold, manifestDigest: f.manifestDigest, transcriptDigest: f.transcriptDigest, lifecycleDigest: f.lifecycleDigest, revokedKeyId: f.revokedKeyId, trust: f.trust, verifiedAt: f.verificationTime }));
});
test('site loss recovery verifies continuity without reset or fork', () => {
  const f = fixture();
  assert.doesNotThrow(() => verifySiteLossRecoveryV33_39({ receipt: f.recoveryReceipt, thresholdEvidence: f.recoveryThreshold, checkpointPublication: f.publication.payload, incident: f.incident, backupInventory: f.backupInventory, restoredArtifact: f.restoredArtifact, manifestDigest: f.manifestDigest, transcriptDigest: f.transcriptDigest, trust: f.trust, verifiedAt: f.verificationTime }));
});
test('full qualification remains local-only and production blocked', () => {
  const f = fixture();
  const verdict = verifyExternalCustodyHardwareQualificationV33_39({
    priorCustodyVerdict: f.prior, manifestDigest: f.manifestDigest, transcriptDigest: f.transcriptDigest,
    expectedRoles: f.identities.roles.map((r) => ({ roleSlot: r.roleSlot, actor: r.descriptor })), hardwareAttestations: f.attestations,
    thresholdEvidence: f.thresholdEvidence, custodyTransfer: f.transfer, transferSourceAttestation: f.attestations[0]!, transferTargetAttestation: f.rotatedAttestation,
    sealedTransferMaterial: f.sealedTransferMaterial, transferNonce: f.transferNonce, publicCheckpoint: f.publication, publicCheckpointBytes: f.publicBytes,
    retrievalReceipts: f.retrievalReceipts, revocationReceipts: f.revocationReceipts, revocationLifecycleDigest: f.lifecycleDigest, revokedKeyId: f.revokedKeyId,
    recoveryReceipt: f.recoveryReceipt, incident: f.incident, backupInventory: f.backupInventory, restoredArtifact: f.restoredArtifact, trust: f.trust, verifiedAt: f.verificationTime,
  });
  assert.equal(verdict.status, 'LOCAL_HSM_THRESHOLD_RECOVERY_REHEARSAL_ONLY');
  assert.equal(verdict.externalTopologyObserved, false);
  assert.equal(verdict.externalHardwareObserved, false);
  assert.equal(verdict.productionAuthority, 'NONE');
});

// Adversarial controls.
test('external hardware claim rejects software rehearsal provider', () => {
  const f = fixture();
  assert.throws(() => createHardwareKeyAttestationV33_39({ authority: f.identities.attestationAuthority, manifestDigest: f.manifestDigest, transcriptDigest: f.transcriptDigest, roleSlot: 'PUBLISHER', actor: f.identities.roles[0]!.descriptor, providerClass: 'SOFTWARE_REHEARSAL', providerId: 'soft', deviceId: 'soft-device', deviceFirmware: Buffer.from('firmware-image-long'), issuedAt: new Date('2026-07-22T19:00:00Z'), expiresAt: new Date('2026-07-23T19:00:00Z'), executionClass: 'LIVE_EXTERNAL' }), /external_hardware_required/);
});
test('duplicate hardware role is rejected', () => {
  const f = fixture();
  const rows = [...f.attestations.slice(0, 10), f.attestations[0]!];
  assert.throws(() => verifyHardwareKeyAttestationsV33_39({ attestations: rows, expectedRoles: f.identities.roles.map((r) => ({ roleSlot: r.roleSlot, actor: r.descriptor })), trust: f.trust, verifiedAt: f.verificationTime }), /duplicate_role/);
});
test('expired hardware attestation is rejected', () => {
  const f = fixture();
  assert.throws(() => verifyHardwareKeyAttestationsV33_39({ attestations: f.attestations, expectedRoles: f.identities.roles.map((r) => ({ roleSlot: r.roleSlot, actor: r.descriptor })), trust: f.trust, verifiedAt: new Date('2027-01-01T00:00:00Z') }), /inactive/);
});
test('hardware actor relabel is rejected even when resigned', () => {
  const f = fixture();
  const { attestationDigest: _oldDigest, ...base } = f.attestations[0]!.payload;
  const material = { ...base, actor: f.identities.roles[1]!.descriptor };
  const altered = resign({ ...material, attestationDigest: sha256(material) } as HardwareKeyAttestationV33_39, f.identities.attestationAuthority);
  assert.throws(() => verifyHardwareKeyAttestationsV33_39({ attestations: [altered, ...f.attestations.slice(1)], expectedRoles: f.identities.roles.map((r) => ({ roleSlot: r.roleSlot, actor: r.descriptor })), trust: f.trust, verifiedAt: f.verificationTime }));
});
test('threshold quorum below three is rejected', () => {
  const f = fixture();
  assert.throws(() => finalizeThresholdOperationV33_39({ authority: f.identities.thresholdAuthority, manifestDigest: f.manifestDigest, transcriptDigest: f.transcriptDigest, operationDigest: sha256('x'), operationType: 'KEY_ROTATION', thresholdSequence: 1, previousThresholdDigest: null, approvals: f.checkpointThreshold.approvals.slice(0, 2), trust: f.trust, issuedAt: f.verificationTime }), /quorum/);
});
test('duplicate threshold share is rejected', () => {
  const f = fixture();
  const duplicate = f.checkpointThreshold.approvals[0]!;
  assert.throws(() => finalizeThresholdOperationV33_39({ authority: f.identities.thresholdAuthority, manifestDigest: f.manifestDigest, transcriptDigest: f.transcriptDigest, operationDigest: f.checkpointThreshold.operationDigest, operationType: 'PUBLIC_CHECKPOINT', thresholdSequence: 1, previousThresholdDigest: null, approvals: [duplicate, duplicate, f.checkpointThreshold.approvals[1]!], trust: f.trust, issuedAt: f.verificationTime }), /duplicate_share|separation/);
});
test('threshold certificate tampering is rejected', () => {
  const f = fixture();
  const altered = { ...f.checkpointThreshold, certificate: { ...f.checkpointThreshold.certificate, payload: { ...f.checkpointThreshold.certificate.payload, thresholdSequence: 2 } } };
  assert.throws(() => verifyThresholdCertificateV33_39({ evidence: altered, manifestDigest: f.manifestDigest, transcriptDigest: f.transcriptDigest, trust: f.trust, verifiedAt: f.verificationTime }), /signature|binding/);
});
test('threshold chain rollback is rejected', () => {
  const f = fixture();
  assert.throws(() => verifyThresholdChainV33_39({ evidence: [f.checkpointThreshold, f.recoveryThreshold], manifestDigest: f.manifestDigest, transcriptDigest: f.transcriptDigest, trust: f.trust, verifiedAt: f.verificationTime }), /discontinuity/);
});
test('transfer rejects tampered sealed bytes', () => {
  const f = fixture();
  assert.throws(() => verifySealedCustodyTransferPackageV33_39({ transfer: f.transfer, sourceAttestation: f.attestations[0]!, targetAttestation: f.rotatedAttestation, sealedMaterial: Buffer.from('different sealed material bytes entirely'), transferNonce: f.transferNonce, trust: f.trust, verifiedAt: f.verificationTime }), /bytes/);
});
test('transfer rejects tampered target attestation', () => {
  const f = fixture();
  const altered = { ...f.rotatedAttestation, payload: { ...f.rotatedAttestation.payload, deviceId: 'evil-device' } };
  assert.throws(() => verifySealedCustodyTransferPackageV33_39({ transfer: f.transfer, sourceAttestation: f.attestations[0]!, targetAttestation: altered, sealedMaterial: f.sealedTransferMaterial, transferNonce: f.transferNonce, trust: f.trust, verifiedAt: f.verificationTime }), /attestation_signature/);
});
test('live public checkpoint requires external DNS and retrieval', () => {
  const f = fixture();
  assert.throws(() => createPublicCheckpointPublicationV33_39({ authority: f.identities.publicationAuthority, manifestDigest: f.manifestDigest, transcriptDigest: f.transcriptDigest, checkpointSequence: 1, previousPublicationDigest: null, priorCustodyVerdictDigest: f.prior.verdictDigest, custodyTransparencyHeadDigest: sha256('head'), thresholdCertificateDigest: f.checkpointThreshold.certificate.payload.thresholdDigest, endpoint: 'https://checkpoint.local/x', dnsName: 'checkpoint.local', publishedBytes: f.publicBytes, publisher: f.identities.roles[0]!.descriptor, publishedAt: f.verificationTime, executionClass: 'LIVE_EXTERNAL', networkRetrievalObserved: false }), /external_observation/);
});
test('public checkpoint rejects fewer than three retrieval monitors', () => {
  const f = fixture();
  assert.throws(() => verifyPublicCheckpointPublicationV33_39({ publication: f.publication, thresholdEvidence: f.checkpointThreshold, retrievalReceipts: f.retrievalReceipts.slice(0, 2), publishedBytes: f.publicBytes, manifestDigest: f.manifestDigest, transcriptDigest: f.transcriptDigest, trust: f.trust, verifiedAt: f.verificationTime }), /quorum/);
});
test('public checkpoint rejects duplicate monitor topology', () => {
  const f = fixture();
  assert.throws(() => verifyPublicCheckpointPublicationV33_39({ publication: f.publication, thresholdEvidence: f.checkpointThreshold, retrievalReceipts: [f.retrievalReceipts[0]!, f.retrievalReceipts[0]!, f.retrievalReceipts[1]!], publishedBytes: f.publicBytes, manifestDigest: f.manifestDigest, transcriptDigest: f.transcriptDigest, trust: f.trust, verifiedAt: f.verificationTime }), /separation/);
});
test('public checkpoint rejects byte substitution', () => {
  const f = fixture();
  assert.throws(() => verifyPublicCheckpointPublicationV33_39({ publication: f.publication, thresholdEvidence: f.checkpointThreshold, retrievalReceipts: f.retrievalReceipts, publishedBytes: Buffer.from('substituted public checkpoint bytes'), manifestDigest: f.manifestDigest, transcriptDigest: f.transcriptDigest, trust: f.trust, verifiedAt: f.verificationTime }), /binding/);
});
test('revocation propagation rejects fewer than three monitors', () => {
  const f = fixture();
  assert.throws(() => verifyRevocationPropagationV33_39({ receipts: f.revocationReceipts.slice(0, 2), thresholdEvidence: f.revocationThreshold, manifestDigest: f.manifestDigest, transcriptDigest: f.transcriptDigest, lifecycleDigest: f.lifecycleDigest, revokedKeyId: f.revokedKeyId, trust: f.trust, verifiedAt: f.verificationTime }), /quorum/);
});
test('revocation propagation rejects split-view coordinate', () => {
  const f = fixture();
  const row = f.revocationReceipts[2]!.payload;
  const { receiptDigest: _oldReceiptDigest, ...base } = row;
  const alteredMaterial = { ...base, revocationSequence: 2, previousRevocationDigest: row.receiptDigest };
  const altered = resign({ ...alteredMaterial, receiptDigest: sha256(alteredMaterial) } as typeof row, f.identities.monitors[2]!);
  assert.throws(() => verifyRevocationPropagationV33_39({ receipts: [f.revocationReceipts[0]!, f.revocationReceipts[1]!, altered], thresholdEvidence: f.revocationThreshold, manifestDigest: f.manifestDigest, transcriptDigest: f.transcriptDigest, lifecycleDigest: f.lifecycleDigest, revokedKeyId: f.revokedKeyId, trust: f.trust, verifiedAt: f.verificationTime }), /split_view|binding/);
});
test('revoked monitor signing key is rejected after effective revocation', () => {
  const f = fixture();
  f.registry.revokeAt(f.identities.monitors[0]!.keyId, '2026-07-22T20:15:00.000Z');
  assert.throws(() => verifyRevocationPropagationV33_39({ receipts: f.revocationReceipts, thresholdEvidence: f.revocationThreshold, manifestDigest: f.manifestDigest, transcriptDigest: f.transcriptDigest, lifecycleDigest: f.lifecycleDigest, revokedKeyId: f.revokedKeyId, trust: f.trust, verifiedAt: f.verificationTime }), /signature/);
});
test('site recovery rejects changed backup inventory', () => {
  const f = fixture();
  assert.throws(() => verifySiteLossRecoveryV33_39({ receipt: f.recoveryReceipt, thresholdEvidence: f.recoveryThreshold, checkpointPublication: f.publication.payload, incident: f.incident, backupInventory: Buffer.from('different backup inventory bytes'), restoredArtifact: f.restoredArtifact, manifestDigest: f.manifestDigest, transcriptDigest: f.transcriptDigest, trust: f.trust, verifiedAt: f.verificationTime }), /bytes/);
});
test('site recovery rejects checkpoint rollback', () => {
  const f = fixture();
  const altered = { ...f.publication.payload, checkpointSequence: 2 };
  assert.throws(() => verifySiteLossRecoveryV33_39({ receipt: f.recoveryReceipt, thresholdEvidence: f.recoveryThreshold, checkpointPublication: altered, incident: f.incident, backupInventory: f.backupInventory, restoredArtifact: f.restoredArtifact, manifestDigest: f.manifestDigest, transcriptDigest: f.transcriptDigest, trust: f.trust, verifiedAt: f.verificationTime }), /continuity/);
});
test('site recovery rejects fork flag mutation', () => {
  const f = fixture();
  const altered = { ...f.recoveryReceipt, payload: { ...f.recoveryReceipt.payload, forkDetected: true as const } };
  assert.throws(() => verifySiteLossRecoveryV33_39({ receipt: altered as unknown as typeof f.recoveryReceipt, thresholdEvidence: f.recoveryThreshold, checkpointPublication: f.publication.payload, incident: f.incident, backupInventory: f.backupInventory, restoredArtifact: f.restoredArtifact, manifestDigest: f.manifestDigest, transcriptDigest: f.transcriptDigest, trust: f.trust, verifiedAt: f.verificationTime }), /signature|binding/);
});
test('full qualification rejects prior verdict mutation', () => {
  const f = fixture();
  const altered = { ...f.prior, externalTopologyObserved: true };
  assert.throws(() => verifyExternalCustodyHardwareQualificationV33_39({ priorCustodyVerdict: altered, manifestDigest: f.manifestDigest, transcriptDigest: f.transcriptDigest, expectedRoles: f.identities.roles.map((r) => ({ roleSlot: r.roleSlot, actor: r.descriptor })), hardwareAttestations: f.attestations, thresholdEvidence: f.thresholdEvidence, custodyTransfer: f.transfer, transferSourceAttestation: f.attestations[0]!, transferTargetAttestation: f.rotatedAttestation, sealedTransferMaterial: f.sealedTransferMaterial, transferNonce: f.transferNonce, publicCheckpoint: f.publication, publicCheckpointBytes: f.publicBytes, retrievalReceipts: f.retrievalReceipts, revocationReceipts: f.revocationReceipts, revocationLifecycleDigest: f.lifecycleDigest, revokedKeyId: f.revokedKeyId, recoveryReceipt: f.recoveryReceipt, incident: f.incident, backupInventory: f.backupInventory, restoredArtifact: f.restoredArtifact, trust: f.trust, verifiedAt: f.verificationTime }), /prior_verdict/);
});
test('full qualification rejects incomplete threshold operation set', () => {
  const f = fixture();
  assert.throws(() => verifyExternalCustodyHardwareQualificationV33_39({ priorCustodyVerdict: f.prior, manifestDigest: f.manifestDigest, transcriptDigest: f.transcriptDigest, expectedRoles: f.identities.roles.map((r) => ({ roleSlot: r.roleSlot, actor: r.descriptor })), hardwareAttestations: f.attestations, thresholdEvidence: f.thresholdEvidence.slice(0, 2), custodyTransfer: f.transfer, transferSourceAttestation: f.attestations[0]!, transferTargetAttestation: f.rotatedAttestation, sealedTransferMaterial: f.sealedTransferMaterial, transferNonce: f.transferNonce, publicCheckpoint: f.publication, publicCheckpointBytes: f.publicBytes, retrievalReceipts: f.retrievalReceipts, revocationReceipts: f.revocationReceipts, revocationLifecycleDigest: f.lifecycleDigest, revokedKeyId: f.revokedKeyId, recoveryReceipt: f.recoveryReceipt, incident: f.incident, backupInventory: f.backupInventory, restoredArtifact: f.restoredArtifact, trust: f.trust, verifiedAt: f.verificationTime }), /incomplete|chain/);
});
test('production authority mutation is rejected by signature boundary', () => {
  const f = fixture();
  const altered = { ...f.publication, payload: { ...f.publication.payload, productionAuthority: 'FULL' as never } };
  assert.throws(() => verifyPublicCheckpointPublicationV33_39({ publication: altered, thresholdEvidence: f.checkpointThreshold, retrievalReceipts: f.retrievalReceipts, publishedBytes: f.publicBytes, manifestDigest: f.manifestDigest, transcriptDigest: f.transcriptDigest, trust: f.trust, verifiedAt: f.verificationTime }), /signature|boundary/);
});
test('external relabeling without external attestations remains rejected', () => {
  const f = fixture();
  const altered = { ...f.recoveryReceipt, payload: { ...f.recoveryReceipt.payload, executionClass: 'LIVE_EXTERNAL' as const } };
  assert.throws(() => verifySiteLossRecoveryV33_39({ receipt: altered, thresholdEvidence: f.recoveryThreshold, checkpointPublication: f.publication.payload, incident: f.incident, backupInventory: f.backupInventory, restoredArtifact: f.restoredArtifact, manifestDigest: f.manifestDigest, transcriptDigest: f.transcriptDigest, trust: f.trust, verifiedAt: f.verificationTime }), /signature/);
});
