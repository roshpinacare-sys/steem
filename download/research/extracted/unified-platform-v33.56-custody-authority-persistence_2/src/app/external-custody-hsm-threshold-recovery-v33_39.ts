import { randomUUID } from 'node:crypto';
import {
  KeyRegistry,
  sha256,
  sha256Bytes,
  signEnvelope,
  type SignedEnvelope,
  type SigningIdentity,
} from '../contracts/crypto.js';
import type { QualificationActorDescriptorV33_36 } from './external-https-monitor-qualification-v33_36.js';
import type {
  CustodyRoleSlotV33_38,
  ExternalCustodyQualificationVerdictV33_38,
} from './external-qualification-custody-ceremony-v33_38.js';

export type HardwareKeyProviderClassV33_39 = 'SOFTWARE_REHEARSAL' | 'TPM_BOUND' | 'CLOUD_HSM' | 'DEDICATED_HSM';
export type ThresholdOperationTypeV33_39 = 'PUBLIC_CHECKPOINT' | 'KEY_ROTATION' | 'REVOCATION_PROPAGATION' | 'SITE_RECOVERY';

export interface HardwareKeyAttestationV33_39 {
  readonly version: '33.39';
  readonly attestationId: string;
  readonly manifestDigest: string;
  readonly transcriptDigest: string;
  readonly roleSlot: CustodyRoleSlotV33_38;
  readonly actor: QualificationActorDescriptorV33_36;
  readonly providerClass: HardwareKeyProviderClassV33_39;
  readonly providerId: string;
  readonly deviceId: string;
  readonly deviceFirmwareDigest: string;
  readonly algorithm: 'Ed25519';
  readonly keyOrigin: 'GENERATED_IN_DEVICE';
  readonly extractable: false;
  readonly privateKeyMaterialEnteredProcess: false;
  readonly requestDigestBound: true;
  readonly nonceUnique: true;
  readonly unauthorizedSigningDenied: true;
  readonly outageFailClosedObserved: true;
  readonly attestationAuthorityKeyId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly executionClass: 'LOCAL_REHEARSAL' | 'LIVE_EXTERNAL';
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly attestationDigest: string;
}

export interface ThresholdCustodianApprovalV33_39 {
  readonly version: '33.39';
  readonly approvalId: string;
  readonly operationDigest: string;
  readonly operationType: ThresholdOperationTypeV33_39;
  readonly shareIndex: number;
  readonly custodian: QualificationActorDescriptorV33_36;
  readonly decision: 'APPROVE_THRESHOLD_OPERATION';
  readonly approvedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly approvalDigest: string;
}

export interface ThresholdOperationCertificateV33_39 {
  readonly version: '33.39';
  readonly certificateId: string;
  readonly operationDigest: string;
  readonly operationType: ThresholdOperationTypeV33_39;
  readonly manifestDigest: string;
  readonly transcriptDigest: string;
  readonly thresholdSequence: number;
  readonly previousThresholdDigest: string | null;
  readonly threshold: 3;
  readonly configuredCustodianCount: 5;
  readonly approvalDigests: readonly string[];
  readonly custodianKeyIds: readonly string[];
  readonly issuedAt: string;
  readonly thresholdAuthorityKeyId: string;
  readonly decision: 'THRESHOLD_AUTHORIZED';
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly thresholdDigest: string;
}

export interface ThresholdOperationEvidenceV33_39 {
  readonly operationDigest: string;
  readonly operationType: ThresholdOperationTypeV33_39;
  readonly approvals: readonly SignedEnvelope<ThresholdCustodianApprovalV33_39>[];
  readonly certificate: SignedEnvelope<ThresholdOperationCertificateV33_39>;
}

export interface SealedCustodyTransferPackageV33_39 {
  readonly version: '33.39';
  readonly transferId: string;
  readonly manifestDigest: string;
  readonly transcriptDigest: string;
  readonly roleSlot: CustodyRoleSlotV33_38;
  readonly sourceActor: QualificationActorDescriptorV33_36;
  readonly targetActor: QualificationActorDescriptorV33_36;
  readonly sourceHardwareAttestationDigest: string;
  readonly targetHardwareAttestationDigest: string;
  readonly recipientKeyFingerprint: string;
  readonly sealedMaterialDigest: string;
  readonly transferNonceDigest: string;
  readonly privateKeyMaterialIncluded: false;
  readonly exportableKeyMaterialIncluded: false;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly transferAuthorityKeyId: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly transferDigest: string;
}

export interface PublicCheckpointPublicationV33_39 {
  readonly version: '33.39';
  readonly publicationId: string;
  readonly manifestDigest: string;
  readonly transcriptDigest: string;
  readonly checkpointSequence: number;
  readonly previousPublicationDigest: string | null;
  readonly priorCustodyVerdictDigest: string;
  readonly custodyTransparencyHeadDigest: string;
  readonly thresholdCertificateDigest: string;
  readonly endpoint: string;
  readonly dnsName: string;
  readonly publishedBytesDigest: string;
  readonly publisher: QualificationActorDescriptorV33_36;
  readonly publishedAt: string;
  readonly executionClass: 'LOCAL_REHEARSAL' | 'LIVE_EXTERNAL';
  readonly networkRetrievalObserved: boolean;
  readonly publicationAuthorityKeyId: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly publicationDigest: string;
}

export interface PublicCheckpointRetrievalReceiptV33_39 {
  readonly version: '33.39';
  readonly receiptId: string;
  readonly publicationDigest: string;
  readonly checkpointSequence: number;
  readonly endpoint: string;
  readonly publishedBytesDigest: string;
  readonly monitor: QualificationActorDescriptorV33_36;
  readonly retrievedAt: string;
  readonly durableWriteObserved: true;
  readonly fsyncObserved: true;
  readonly networkClass: 'LOCAL_LOOPBACK' | 'INDEPENDENT_EXTERNAL';
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly receiptDigest: string;
}

export interface RevocationPropagationReceiptV33_39 {
  readonly version: '33.39';
  readonly receiptId: string;
  readonly manifestDigest: string;
  readonly transcriptDigest: string;
  readonly lifecycleDigest: string;
  readonly revokedKeyId: string;
  readonly revocationSequence: number;
  readonly previousRevocationDigest: string | null;
  readonly monitor: QualificationActorDescriptorV33_36;
  readonly thresholdCertificateDigest: string;
  readonly appliedAt: string;
  readonly durableWriteObserved: true;
  readonly resurrectionDenied: true;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly receiptDigest: string;
}

export interface SiteLossRecoveryReceiptV33_39 {
  readonly version: '33.39';
  readonly recoveryId: string;
  readonly manifestDigest: string;
  readonly transcriptDigest: string;
  readonly incidentDigest: string;
  readonly lostSiteId: string;
  readonly recoverySiteId: string;
  readonly priorCheckpointPublicationDigest: string;
  readonly restoredCheckpointSequence: number;
  readonly restoredThresholdHeadDigest: string;
  readonly backupInventoryDigest: string;
  readonly restoredArtifactDigest: string;
  readonly thresholdCertificateDigest: string;
  readonly restoredRoleCount: 11;
  readonly sequenceReset: false;
  readonly forkDetected: false;
  readonly recoveryVerifier: QualificationActorDescriptorV33_36;
  readonly recoveredAt: string;
  readonly executionClass: 'LOCAL_REHEARSAL' | 'LIVE_EXTERNAL';
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly recoveryDigest: string;
}

export interface ExternalCustodyHardwareQualificationVerdictV33_39 {
  readonly version: '33.39';
  readonly manifestDigest: string;
  readonly transcriptDigest: string;
  readonly priorCustodyVerdictDigest: string;
  readonly hardwareAttestationCount: 11;
  readonly hardwareBoundRoleCount: number;
  readonly threshold: 3;
  readonly configuredCustodianCount: 5;
  readonly thresholdHeadDigest: string;
  readonly publicCheckpointPublicationDigest: string;
  readonly publicCheckpointSequence: number;
  readonly retrievalReceiptCount: number;
  readonly revocationReceiptCount: number;
  readonly recoveryDigest: string;
  readonly custodyTransferVerified: true;
  readonly revocationPropagationVerified: true;
  readonly siteRecoveryVerified: true;
  readonly status: 'LOCAL_HSM_THRESHOLD_RECOVERY_REHEARSAL_ONLY' | 'EXTERNAL_HSM_THRESHOLD_RECOVERY_EVIDENCE_ACCEPTED';
  readonly externalTopologyObserved: boolean;
  readonly externalHardwareObserved: boolean;
  readonly externalHumanParticipants: 0;
  readonly verifiedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly verdictDigest: string;
}

export interface HardwareCustodyTrustV33_39 {
  readonly hardwareAttestationRegistry: KeyRegistry;
  readonly trustedHardwareAttestationAuthorityIds: readonly string[];
  readonly thresholdCustodianRegistry: KeyRegistry;
  readonly trustedThresholdCustodianIds: readonly string[];
  readonly thresholdAuthorityRegistry: KeyRegistry;
  readonly trustedThresholdAuthorityIds: readonly string[];
  readonly transferAuthorityRegistry: KeyRegistry;
  readonly trustedTransferAuthorityIds: readonly string[];
  readonly publicationAuthorityRegistry: KeyRegistry;
  readonly trustedPublicationAuthorityIds: readonly string[];
  readonly monitorRegistry: KeyRegistry;
  readonly trustedMonitorIds: readonly string[];
  readonly recoveryVerifierRegistry: KeyRegistry;
  readonly trustedRecoveryVerifierIds: readonly string[];
}

const DIGEST_RE = /^[0-9a-f]{64}$/;
function requireDigest(value: string, code: string): void { if (!DIGEST_RE.test(value)) throw new Error(code); }
function requireText(value: string, code: string): void { if (value.trim() === '') throw new Error(code); }
function requireDate(value: Date, code: string): void { if (!Number.isFinite(value.getTime())) throw new Error(code); }
function digestWithout<T extends object>(row: T, field: keyof T): string {
  const copy = { ...row } as Record<PropertyKey, unknown>;
  delete copy[field as PropertyKey];
  return sha256(copy);
}
function assertBoundary(row: { productionAuthority: 'NONE'; externalEffectsExecuted: 0 }, code: string): void {
  if (row.productionAuthority !== 'NONE' || row.externalEffectsExecuted !== 0) throw new Error(code);
}
function assertDescriptor(row: QualificationActorDescriptorV33_36, code: string): void {
  if ([row.keyId, row.keyFingerprint, row.organizationId, row.hostId, row.administratorId].some((value) => value.trim() === '')) throw new Error(code);
  requireDigest(row.keyFingerprint, code);
}
function descriptorEquals(a: QualificationActorDescriptorV33_36, b: QualificationActorDescriptorV33_36): boolean {
  return a.keyId === b.keyId && a.keyFingerprint === b.keyFingerprint && a.organizationId === b.organizationId && a.hostId === b.hostId && a.administratorId === b.administratorId;
}
function descriptorsSeparated(rows: readonly QualificationActorDescriptorV33_36[]): boolean {
  const fields: (keyof QualificationActorDescriptorV33_36)[] = ['keyId', 'organizationId', 'hostId', 'administratorId'];
  return fields.every((field) => new Set(rows.map((row) => row[field])).size === rows.length);
}
function verifyDescriptorFingerprint(registry: KeyRegistry, descriptor: QualificationActorDescriptorV33_36, code: string): void {
  if (registry.fingerprint(descriptor.keyId) !== descriptor.keyFingerprint) throw new Error(code);
}

export function createHardwareKeyAttestationV33_39(input: {
  readonly authority: SigningIdentity;
  readonly manifestDigest: string;
  readonly transcriptDigest: string;
  readonly roleSlot: CustodyRoleSlotV33_38;
  readonly actor: QualificationActorDescriptorV33_36;
  readonly providerClass: HardwareKeyProviderClassV33_39;
  readonly providerId: string;
  readonly deviceId: string;
  readonly deviceFirmware: Uint8Array;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly executionClass: 'LOCAL_REHEARSAL' | 'LIVE_EXTERNAL';
}): SignedEnvelope<HardwareKeyAttestationV33_39> {
  requireDigest(input.manifestDigest, 'v33_39_manifest_digest_invalid');
  requireDigest(input.transcriptDigest, 'v33_39_transcript_digest_invalid');
  assertDescriptor(input.actor, 'v33_39_actor_invalid');
  requireText(input.providerId, 'v33_39_provider_required');
  requireText(input.deviceId, 'v33_39_device_required');
  requireDate(input.issuedAt, 'v33_39_attestation_time_invalid');
  requireDate(input.expiresAt, 'v33_39_attestation_time_invalid');
  if (input.expiresAt.getTime() <= input.issuedAt.getTime() || input.expiresAt.getTime() - input.issuedAt.getTime() > 90 * 24 * 60 * 60 * 1000 || input.deviceFirmware.byteLength < 16) throw new Error('v33_39_attestation_window_invalid');
  if (input.executionClass === 'LIVE_EXTERNAL' && input.providerClass === 'SOFTWARE_REHEARSAL') throw new Error('v33_39_external_hardware_required');
  const material = {
    version: '33.39' as const,
    attestationId: randomUUID(),
    manifestDigest: input.manifestDigest,
    transcriptDigest: input.transcriptDigest,
    roleSlot: input.roleSlot,
    actor: input.actor,
    providerClass: input.providerClass,
    providerId: input.providerId,
    deviceId: input.deviceId,
    deviceFirmwareDigest: sha256Bytes(input.deviceFirmware),
    algorithm: 'Ed25519' as const,
    keyOrigin: 'GENERATED_IN_DEVICE' as const,
    extractable: false as const,
    privateKeyMaterialEnteredProcess: false as const,
    requestDigestBound: true as const,
    nonceUnique: true as const,
    unauthorizedSigningDenied: true as const,
    outageFailClosedObserved: true as const,
    attestationAuthorityKeyId: input.authority.keyId,
    issuedAt: input.issuedAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    executionClass: input.executionClass,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, attestationDigest: sha256(material) }, input.authority);
}

export function verifyHardwareKeyAttestationsV33_39(input: {
  readonly attestations: readonly SignedEnvelope<HardwareKeyAttestationV33_39>[];
  readonly expectedRoles: readonly { readonly roleSlot: CustodyRoleSlotV33_38; readonly actor: QualificationActorDescriptorV33_36 }[];
  readonly trust: HardwareCustodyTrustV33_39;
  readonly verifiedAt: Date;
}): { readonly hardwareBoundRoleCount: number; readonly externalHardwareObserved: boolean } {
  requireDate(input.verifiedAt, 'v33_39_hardware_verification_time_invalid');
  if (input.attestations.length !== 11 || input.expectedRoles.length !== 11) throw new Error('v33_39_hardware_cardinality_invalid');
  const bySlot = new Map<CustodyRoleSlotV33_38, SignedEnvelope<HardwareKeyAttestationV33_39>>();
  for (const envelope of input.attestations) {
    const row = envelope.payload;
    if (!input.trust.trustedHardwareAttestationAuthorityIds.includes(envelope.issuerKeyId) || !input.trust.hardwareAttestationRegistry.verifyAt(envelope, input.verifiedAt)) throw new Error('v33_39_hardware_signature_invalid');
    if (row.attestationAuthorityKeyId !== envelope.issuerKeyId || row.attestationDigest !== digestWithout(row, 'attestationDigest')) throw new Error('v33_39_hardware_binding_invalid');
    if (Date.parse(row.issuedAt) > input.verifiedAt.getTime() || Date.parse(row.expiresAt) < input.verifiedAt.getTime()) throw new Error('v33_39_hardware_attestation_inactive');
    if (row.algorithm !== 'Ed25519' || row.keyOrigin !== 'GENERATED_IN_DEVICE' || row.extractable !== false || row.privateKeyMaterialEnteredProcess !== false || row.requestDigestBound !== true || row.nonceUnique !== true || row.unauthorizedSigningDenied !== true || row.outageFailClosedObserved !== true) throw new Error('v33_39_hardware_controls_invalid');
    assertDescriptor(row.actor, 'v33_39_hardware_actor_invalid');
    assertBoundary(row, 'v33_39_hardware_boundary_invalid');
    if (bySlot.has(row.roleSlot)) throw new Error('v33_39_hardware_duplicate_role');
    bySlot.set(row.roleSlot, envelope);
  }
  for (const expected of input.expectedRoles) {
    const envelope = bySlot.get(expected.roleSlot);
    if (envelope === undefined || !descriptorEquals(envelope.payload.actor, expected.actor)) throw new Error('v33_39_hardware_role_binding_invalid');
  }
  const external = input.attestations.every((row) => row.payload.executionClass === 'LIVE_EXTERNAL' && row.payload.providerClass !== 'SOFTWARE_REHEARSAL');
  return { hardwareBoundRoleCount: input.attestations.filter((row) => row.payload.providerClass !== 'SOFTWARE_REHEARSAL').length, externalHardwareObserved: external };
}

export function createThresholdCustodianApprovalV33_39(input: {
  readonly custodian: SigningIdentity;
  readonly custodianDescriptor: QualificationActorDescriptorV33_36;
  readonly operationDigest: string;
  readonly operationType: ThresholdOperationTypeV33_39;
  readonly shareIndex: number;
  readonly approvedAt: Date;
}): SignedEnvelope<ThresholdCustodianApprovalV33_39> {
  requireDigest(input.operationDigest, 'v33_39_operation_digest_invalid');
  assertDescriptor(input.custodianDescriptor, 'v33_39_custodian_invalid');
  if (input.custodian.keyId !== input.custodianDescriptor.keyId || !Number.isInteger(input.shareIndex) || input.shareIndex < 1 || input.shareIndex > 5) throw new Error('v33_39_share_invalid');
  requireDate(input.approvedAt, 'v33_39_approval_time_invalid');
  const material = {
    version: '33.39' as const,
    approvalId: randomUUID(),
    operationDigest: input.operationDigest,
    operationType: input.operationType,
    shareIndex: input.shareIndex,
    custodian: input.custodianDescriptor,
    decision: 'APPROVE_THRESHOLD_OPERATION' as const,
    approvedAt: input.approvedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, approvalDigest: sha256(material) }, input.custodian);
}

export function finalizeThresholdOperationV33_39(input: {
  readonly authority: SigningIdentity;
  readonly manifestDigest: string;
  readonly transcriptDigest: string;
  readonly operationDigest: string;
  readonly operationType: ThresholdOperationTypeV33_39;
  readonly thresholdSequence: number;
  readonly previousThresholdDigest: string | null;
  readonly approvals: readonly SignedEnvelope<ThresholdCustodianApprovalV33_39>[];
  readonly trust: HardwareCustodyTrustV33_39;
  readonly issuedAt: Date;
}): SignedEnvelope<ThresholdOperationCertificateV33_39> {
  requireDate(input.issuedAt, 'v33_39_threshold_time_invalid');
  requireDigest(input.manifestDigest, 'v33_39_manifest_digest_invalid');
  requireDigest(input.transcriptDigest, 'v33_39_transcript_digest_invalid');
  requireDigest(input.operationDigest, 'v33_39_operation_digest_invalid');
  if (!Number.isInteger(input.thresholdSequence) || input.thresholdSequence < 1) throw new Error('v33_39_threshold_sequence_invalid');
  if ((input.thresholdSequence === 1) !== (input.previousThresholdDigest === null)) throw new Error('v33_39_threshold_predecessor_invalid');
  if (input.previousThresholdDigest !== null) requireDigest(input.previousThresholdDigest, 'v33_39_threshold_predecessor_invalid');
  if (input.approvals.length < 3 || input.approvals.length > 5) throw new Error('v33_39_threshold_quorum_invalid');
  const custodians: QualificationActorDescriptorV33_36[] = [];
  const shareIndexes = new Set<number>();
  for (const envelope of input.approvals) {
    const row = envelope.payload;
    if (!input.trust.trustedThresholdCustodianIds.includes(envelope.issuerKeyId) || !input.trust.thresholdCustodianRegistry.verifyAt(envelope, input.issuedAt)) throw new Error('v33_39_threshold_approval_signature_invalid');
    verifyDescriptorFingerprint(input.trust.thresholdCustodianRegistry, row.custodian, 'v33_39_threshold_custodian_fingerprint_invalid');
    if (row.custodian.keyId !== envelope.issuerKeyId || row.approvalDigest !== digestWithout(row, 'approvalDigest') || row.operationDigest !== input.operationDigest || row.operationType !== input.operationType || row.decision !== 'APPROVE_THRESHOLD_OPERATION') throw new Error('v33_39_threshold_approval_binding_invalid');
    if (shareIndexes.has(row.shareIndex)) throw new Error('v33_39_threshold_duplicate_share');
    shareIndexes.add(row.shareIndex);
    custodians.push(row.custodian);
    assertBoundary(row, 'v33_39_threshold_approval_boundary_invalid');
  }
  if (!descriptorsSeparated(custodians)) throw new Error('v33_39_threshold_custodian_separation_invalid');
  const material = {
    version: '33.39' as const,
    certificateId: randomUUID(),
    operationDigest: input.operationDigest,
    operationType: input.operationType,
    manifestDigest: input.manifestDigest,
    transcriptDigest: input.transcriptDigest,
    thresholdSequence: input.thresholdSequence,
    previousThresholdDigest: input.previousThresholdDigest,
    threshold: 3 as const,
    configuredCustodianCount: 5 as const,
    approvalDigests: input.approvals.map((row) => row.payload.approvalDigest).sort(),
    custodianKeyIds: input.approvals.map((row) => row.payload.custodian.keyId).sort(),
    issuedAt: input.issuedAt.toISOString(),
    thresholdAuthorityKeyId: input.authority.keyId,
    decision: 'THRESHOLD_AUTHORIZED' as const,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, thresholdDigest: sha256(material) }, input.authority);
}

function verifyApprovalsOnly(input: {
  readonly approvals: readonly SignedEnvelope<ThresholdCustodianApprovalV33_39>[];
  readonly operationDigest: string;
  readonly operationType: ThresholdOperationTypeV33_39;
  readonly trust: HardwareCustodyTrustV33_39;
  readonly verifiedAt: Date;
}): void {
  if (input.approvals.length < 3 || input.approvals.length > 5) throw new Error('v33_39_threshold_quorum_invalid');
  const custodians: QualificationActorDescriptorV33_36[] = [];
  const shares = new Set<number>();
  for (const envelope of input.approvals) {
    const row = envelope.payload;
    if (!input.trust.trustedThresholdCustodianIds.includes(envelope.issuerKeyId) || !input.trust.thresholdCustodianRegistry.verifyAt(envelope, input.verifiedAt)) throw new Error('v33_39_threshold_approval_signature_invalid');
    if (row.custodian.keyId !== envelope.issuerKeyId || row.approvalDigest !== digestWithout(row, 'approvalDigest') || row.operationDigest !== input.operationDigest || row.operationType !== input.operationType || row.decision !== 'APPROVE_THRESHOLD_OPERATION') throw new Error('v33_39_threshold_approval_binding_invalid');
    verifyDescriptorFingerprint(input.trust.thresholdCustodianRegistry, row.custodian, 'v33_39_threshold_custodian_fingerprint_invalid');
    if (shares.has(row.shareIndex)) throw new Error('v33_39_threshold_duplicate_share');
    shares.add(row.shareIndex);
    custodians.push(row.custodian);
  }
  if (!descriptorsSeparated(custodians)) throw new Error('v33_39_threshold_custodian_separation_invalid');
}

export function verifyThresholdCertificateV33_39(input: {
  readonly evidence: ThresholdOperationEvidenceV33_39;
  readonly manifestDigest: string;
  readonly transcriptDigest: string;
  readonly trust: HardwareCustodyTrustV33_39;
  readonly verifiedAt: Date;
}): ThresholdOperationCertificateV33_39 {
  requireDate(input.verifiedAt, 'v33_39_threshold_verification_time_invalid');
  const certificate = input.evidence.certificate.payload;
  if (!input.trust.trustedThresholdAuthorityIds.includes(input.evidence.certificate.issuerKeyId) || !input.trust.thresholdAuthorityRegistry.verifyAt(input.evidence.certificate, input.verifiedAt)) throw new Error('v33_39_threshold_certificate_signature_invalid');
  if (certificate.thresholdAuthorityKeyId !== input.evidence.certificate.issuerKeyId || certificate.thresholdDigest !== digestWithout(certificate, 'thresholdDigest') || certificate.operationDigest !== input.evidence.operationDigest || certificate.operationType !== input.evidence.operationType || certificate.manifestDigest !== input.manifestDigest || certificate.transcriptDigest !== input.transcriptDigest || certificate.threshold !== 3 || certificate.configuredCustodianCount !== 5 || certificate.decision !== 'THRESHOLD_AUTHORIZED') throw new Error('v33_39_threshold_certificate_binding_invalid');
  assertBoundary(certificate, 'v33_39_threshold_certificate_boundary_invalid');
  verifyApprovalsOnly({ approvals: input.evidence.approvals, operationDigest: input.evidence.operationDigest, operationType: input.evidence.operationType, trust: input.trust, verifiedAt: new Date(certificate.issuedAt) });
  const approvalDigests = input.evidence.approvals.map((row) => row.payload.approvalDigest).sort();
  const custodianKeyIds = input.evidence.approvals.map((row) => row.payload.custodian.keyId).sort();
  if (sha256(approvalDigests) !== sha256(certificate.approvalDigests) || sha256(custodianKeyIds) !== sha256(certificate.custodianKeyIds)) throw new Error('v33_39_threshold_certificate_approval_set_invalid');
  return certificate;
}

export function verifyThresholdChainV33_39(input: {
  readonly evidence: readonly ThresholdOperationEvidenceV33_39[];
  readonly manifestDigest: string;
  readonly transcriptDigest: string;
  readonly trust: HardwareCustodyTrustV33_39;
  readonly verifiedAt: Date;
}): { readonly headDigest: string; readonly sequence: number } {
  if (input.evidence.length === 0) throw new Error('v33_39_threshold_chain_empty');
  let previous: string | null = null;
  let sequence = 0;
  for (const evidence of input.evidence) {
    const row = verifyThresholdCertificateV33_39({ evidence, manifestDigest: input.manifestDigest, transcriptDigest: input.transcriptDigest, trust: input.trust, verifiedAt: input.verifiedAt });
    if (row.thresholdSequence !== sequence + 1 || row.previousThresholdDigest !== previous) throw new Error('v33_39_threshold_chain_discontinuity');
    sequence = row.thresholdSequence;
    previous = row.thresholdDigest;
  }
  return { headDigest: previous!, sequence };
}

export function createSealedCustodyTransferPackageV33_39(input: {
  readonly authority: SigningIdentity;
  readonly manifestDigest: string;
  readonly transcriptDigest: string;
  readonly roleSlot: CustodyRoleSlotV33_38;
  readonly sourceActor: QualificationActorDescriptorV33_36;
  readonly targetActor: QualificationActorDescriptorV33_36;
  readonly sourceHardwareAttestationDigest: string;
  readonly targetHardwareAttestationDigest: string;
  readonly sealedMaterial: Uint8Array;
  readonly transferNonce: Uint8Array;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}): SignedEnvelope<SealedCustodyTransferPackageV33_39> {
  assertDescriptor(input.sourceActor, 'v33_39_transfer_source_invalid');
  assertDescriptor(input.targetActor, 'v33_39_transfer_target_invalid');
  if (descriptorEquals(input.sourceActor, input.targetActor) || input.sourceActor.organizationId === input.targetActor.organizationId || input.sourceActor.hostId === input.targetActor.hostId || input.sourceActor.administratorId === input.targetActor.administratorId) throw new Error('v33_39_transfer_separation_invalid');
  requireDigest(input.sourceHardwareAttestationDigest, 'v33_39_transfer_attestation_invalid');
  requireDigest(input.targetHardwareAttestationDigest, 'v33_39_transfer_attestation_invalid');
  if (input.sealedMaterial.byteLength < 32 || input.transferNonce.byteLength < 32) throw new Error('v33_39_transfer_material_invalid');
  requireDate(input.createdAt, 'v33_39_transfer_time_invalid');
  requireDate(input.expiresAt, 'v33_39_transfer_time_invalid');
  if (input.expiresAt.getTime() <= input.createdAt.getTime() || input.expiresAt.getTime() - input.createdAt.getTime() > 24 * 60 * 60 * 1000) throw new Error('v33_39_transfer_window_invalid');
  const material = {
    version: '33.39' as const,
    transferId: randomUUID(),
    manifestDigest: input.manifestDigest,
    transcriptDigest: input.transcriptDigest,
    roleSlot: input.roleSlot,
    sourceActor: input.sourceActor,
    targetActor: input.targetActor,
    sourceHardwareAttestationDigest: input.sourceHardwareAttestationDigest,
    targetHardwareAttestationDigest: input.targetHardwareAttestationDigest,
    recipientKeyFingerprint: input.targetActor.keyFingerprint,
    sealedMaterialDigest: sha256Bytes(input.sealedMaterial),
    transferNonceDigest: sha256Bytes(input.transferNonce),
    privateKeyMaterialIncluded: false as const,
    exportableKeyMaterialIncluded: false as const,
    createdAt: input.createdAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    transferAuthorityKeyId: input.authority.keyId,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, transferDigest: sha256(material) }, input.authority);
}

export function verifySealedCustodyTransferPackageV33_39(input: {
  readonly transfer: SignedEnvelope<SealedCustodyTransferPackageV33_39>;
  readonly sourceAttestation: SignedEnvelope<HardwareKeyAttestationV33_39>;
  readonly targetAttestation: SignedEnvelope<HardwareKeyAttestationV33_39>;
  readonly sealedMaterial: Uint8Array;
  readonly transferNonce: Uint8Array;
  readonly trust: HardwareCustodyTrustV33_39;
  readonly verifiedAt: Date;
}): void {
  const row = input.transfer.payload;
  if (!input.trust.trustedTransferAuthorityIds.includes(input.transfer.issuerKeyId) || !input.trust.transferAuthorityRegistry.verifyAt(input.transfer, input.verifiedAt)) throw new Error('v33_39_transfer_signature_invalid');
  for (const attestation of [input.sourceAttestation, input.targetAttestation]) {
    const payload = attestation.payload;
    if (!input.trust.trustedHardwareAttestationAuthorityIds.includes(attestation.issuerKeyId) || !input.trust.hardwareAttestationRegistry.verifyAt(attestation, input.verifiedAt) || payload.attestationAuthorityKeyId !== attestation.issuerKeyId || payload.attestationDigest !== digestWithout(payload, 'attestationDigest')) throw new Error('v33_39_transfer_attestation_signature_invalid');
    if (Date.parse(payload.issuedAt) > input.verifiedAt.getTime() || Date.parse(payload.expiresAt) < input.verifiedAt.getTime()) throw new Error('v33_39_transfer_attestation_inactive');
  }
  if (row.transferAuthorityKeyId !== input.transfer.issuerKeyId || row.transferDigest !== digestWithout(row, 'transferDigest') || row.privateKeyMaterialIncluded !== false || row.exportableKeyMaterialIncluded !== false) throw new Error('v33_39_transfer_binding_invalid');
  if (Date.parse(row.createdAt) > input.verifiedAt.getTime() || Date.parse(row.expiresAt) < input.verifiedAt.getTime()) throw new Error('v33_39_transfer_inactive');
  if (row.sourceHardwareAttestationDigest !== input.sourceAttestation.payload.attestationDigest || row.targetHardwareAttestationDigest !== input.targetAttestation.payload.attestationDigest || !descriptorEquals(row.sourceActor, input.sourceAttestation.payload.actor) || !descriptorEquals(row.targetActor, input.targetAttestation.payload.actor) || row.recipientKeyFingerprint !== row.targetActor.keyFingerprint) throw new Error('v33_39_transfer_attestation_binding_invalid');
  if (row.sealedMaterialDigest !== sha256Bytes(input.sealedMaterial) || row.transferNonceDigest !== sha256Bytes(input.transferNonce)) throw new Error('v33_39_transfer_bytes_invalid');
  assertBoundary(row, 'v33_39_transfer_boundary_invalid');
}

export function createPublicCheckpointPublicationV33_39(input: {
  readonly authority: SigningIdentity;
  readonly manifestDigest: string;
  readonly transcriptDigest: string;
  readonly checkpointSequence: number;
  readonly previousPublicationDigest: string | null;
  readonly priorCustodyVerdictDigest: string;
  readonly custodyTransparencyHeadDigest: string;
  readonly thresholdCertificateDigest: string;
  readonly endpoint: string;
  readonly dnsName: string;
  readonly publishedBytes: Uint8Array;
  readonly publisher: QualificationActorDescriptorV33_36;
  readonly publishedAt: Date;
  readonly executionClass: 'LOCAL_REHEARSAL' | 'LIVE_EXTERNAL';
  readonly networkRetrievalObserved: boolean;
}): SignedEnvelope<PublicCheckpointPublicationV33_39> {
  if (!Number.isInteger(input.checkpointSequence) || input.checkpointSequence < 1 || (input.checkpointSequence === 1) !== (input.previousPublicationDigest === null)) throw new Error('v33_39_publication_sequence_invalid');
  if (input.previousPublicationDigest !== null) requireDigest(input.previousPublicationDigest, 'v33_39_publication_predecessor_invalid');
  [input.priorCustodyVerdictDigest, input.custodyTransparencyHeadDigest, input.thresholdCertificateDigest].forEach((value) => requireDigest(value, 'v33_39_publication_digest_invalid'));
  requireText(input.endpoint, 'v33_39_publication_endpoint_required');
  requireText(input.dnsName, 'v33_39_publication_dns_required');
  if (!input.endpoint.startsWith('https://') || !input.endpoint.includes(input.dnsName)) throw new Error('v33_39_publication_https_dns_invalid');
  if (input.executionClass === 'LIVE_EXTERNAL' && (input.dnsName === 'localhost' || input.dnsName.endsWith('.local') || input.dnsName.endsWith('.invalid') || !input.networkRetrievalObserved)) throw new Error('v33_39_publication_external_observation_required');
  assertDescriptor(input.publisher, 'v33_39_publication_publisher_invalid');
  requireDate(input.publishedAt, 'v33_39_publication_time_invalid');
  if (input.publishedBytes.byteLength < 16) throw new Error('v33_39_publication_bytes_invalid');
  const material = {
    version: '33.39' as const,
    publicationId: randomUUID(),
    manifestDigest: input.manifestDigest,
    transcriptDigest: input.transcriptDigest,
    checkpointSequence: input.checkpointSequence,
    previousPublicationDigest: input.previousPublicationDigest,
    priorCustodyVerdictDigest: input.priorCustodyVerdictDigest,
    custodyTransparencyHeadDigest: input.custodyTransparencyHeadDigest,
    thresholdCertificateDigest: input.thresholdCertificateDigest,
    endpoint: input.endpoint,
    dnsName: input.dnsName,
    publishedBytesDigest: sha256Bytes(input.publishedBytes),
    publisher: input.publisher,
    publishedAt: input.publishedAt.toISOString(),
    executionClass: input.executionClass,
    networkRetrievalObserved: input.networkRetrievalObserved,
    publicationAuthorityKeyId: input.authority.keyId,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, publicationDigest: sha256(material) }, input.authority);
}

export function createPublicCheckpointRetrievalReceiptV33_39(input: {
  readonly monitor: SigningIdentity;
  readonly monitorDescriptor: QualificationActorDescriptorV33_36;
  readonly publication: PublicCheckpointPublicationV33_39;
  readonly retrievedBytes: Uint8Array;
  readonly retrievedAt: Date;
  readonly networkClass: 'LOCAL_LOOPBACK' | 'INDEPENDENT_EXTERNAL';
}): SignedEnvelope<PublicCheckpointRetrievalReceiptV33_39> {
  assertDescriptor(input.monitorDescriptor, 'v33_39_monitor_invalid');
  if (input.monitor.keyId !== input.monitorDescriptor.keyId || input.publication.publishedBytesDigest !== sha256Bytes(input.retrievedBytes)) throw new Error('v33_39_retrieval_binding_invalid');
  if (input.networkClass === 'INDEPENDENT_EXTERNAL' && input.publication.executionClass !== 'LIVE_EXTERNAL') throw new Error('v33_39_retrieval_external_class_invalid');
  requireDate(input.retrievedAt, 'v33_39_retrieval_time_invalid');
  const material = {
    version: '33.39' as const,
    receiptId: randomUUID(),
    publicationDigest: input.publication.publicationDigest,
    checkpointSequence: input.publication.checkpointSequence,
    endpoint: input.publication.endpoint,
    publishedBytesDigest: input.publication.publishedBytesDigest,
    monitor: input.monitorDescriptor,
    retrievedAt: input.retrievedAt.toISOString(),
    durableWriteObserved: true as const,
    fsyncObserved: true as const,
    networkClass: input.networkClass,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, receiptDigest: sha256(material) }, input.monitor);
}

export function verifyPublicCheckpointPublicationV33_39(input: {
  readonly publication: SignedEnvelope<PublicCheckpointPublicationV33_39>;
  readonly thresholdEvidence: ThresholdOperationEvidenceV33_39;
  readonly retrievalReceipts: readonly SignedEnvelope<PublicCheckpointRetrievalReceiptV33_39>[];
  readonly publishedBytes: Uint8Array;
  readonly manifestDigest: string;
  readonly transcriptDigest: string;
  readonly trust: HardwareCustodyTrustV33_39;
  readonly verifiedAt: Date;
}): { readonly externalTopologyObserved: boolean } {
  const row = input.publication.payload;
  if (!input.trust.trustedPublicationAuthorityIds.includes(input.publication.issuerKeyId) || !input.trust.publicationAuthorityRegistry.verifyAt(input.publication, input.verifiedAt)) throw new Error('v33_39_publication_signature_invalid');
  if (row.publicationAuthorityKeyId !== input.publication.issuerKeyId || row.publicationDigest !== digestWithout(row, 'publicationDigest') || row.manifestDigest !== input.manifestDigest || row.transcriptDigest !== input.transcriptDigest || row.publishedBytesDigest !== sha256Bytes(input.publishedBytes)) throw new Error('v33_39_publication_binding_invalid');
  const threshold = verifyThresholdCertificateV33_39({ evidence: input.thresholdEvidence, manifestDigest: input.manifestDigest, transcriptDigest: input.transcriptDigest, trust: input.trust, verifiedAt: input.verifiedAt });
  if (threshold.operationType !== 'PUBLIC_CHECKPOINT' || row.thresholdCertificateDigest !== threshold.thresholdDigest || threshold.operationDigest !== sha256({ priorCustodyVerdictDigest: row.priorCustodyVerdictDigest, custodyTransparencyHeadDigest: row.custodyTransparencyHeadDigest, checkpointSequence: row.checkpointSequence, publishedBytesDigest: row.publishedBytesDigest })) throw new Error('v33_39_publication_threshold_binding_invalid');
  if (input.retrievalReceipts.length < 3) throw new Error('v33_39_retrieval_quorum_invalid');
  const monitors: QualificationActorDescriptorV33_36[] = [];
  for (const envelope of input.retrievalReceipts) {
    const receipt = envelope.payload;
    if (!input.trust.trustedMonitorIds.includes(envelope.issuerKeyId) || !input.trust.monitorRegistry.verifyAt(envelope, input.verifiedAt)) throw new Error('v33_39_retrieval_signature_invalid');
    verifyDescriptorFingerprint(input.trust.monitorRegistry, receipt.monitor, 'v33_39_retrieval_monitor_fingerprint_invalid');
    if (receipt.monitor.keyId !== envelope.issuerKeyId || receipt.receiptDigest !== digestWithout(receipt, 'receiptDigest') || receipt.publicationDigest !== row.publicationDigest || receipt.checkpointSequence !== row.checkpointSequence || receipt.endpoint !== row.endpoint || receipt.publishedBytesDigest !== row.publishedBytesDigest || receipt.durableWriteObserved !== true || receipt.fsyncObserved !== true) throw new Error('v33_39_retrieval_receipt_binding_invalid');
    monitors.push(receipt.monitor);
  }
  if (!descriptorsSeparated(monitors)) throw new Error('v33_39_retrieval_monitor_separation_invalid');
  assertBoundary(row, 'v33_39_publication_boundary_invalid');
  const external = row.executionClass === 'LIVE_EXTERNAL' && row.networkRetrievalObserved === true && input.retrievalReceipts.every((receipt) => receipt.payload.networkClass === 'INDEPENDENT_EXTERNAL');
  return { externalTopologyObserved: external };
}

export function createRevocationPropagationReceiptV33_39(input: {
  readonly monitor: SigningIdentity;
  readonly monitorDescriptor: QualificationActorDescriptorV33_36;
  readonly manifestDigest: string;
  readonly transcriptDigest: string;
  readonly lifecycleDigest: string;
  readonly revokedKeyId: string;
  readonly revocationSequence: number;
  readonly previousRevocationDigest: string | null;
  readonly thresholdCertificateDigest: string;
  readonly appliedAt: Date;
}): SignedEnvelope<RevocationPropagationReceiptV33_39> {
  [input.manifestDigest, input.transcriptDigest, input.lifecycleDigest, input.thresholdCertificateDigest].forEach((value) => requireDigest(value, 'v33_39_revocation_digest_invalid'));
  requireText(input.revokedKeyId, 'v33_39_revoked_key_required');
  if (!Number.isInteger(input.revocationSequence) || input.revocationSequence < 1 || (input.revocationSequence === 1) !== (input.previousRevocationDigest === null)) throw new Error('v33_39_revocation_sequence_invalid');
  if (input.previousRevocationDigest !== null) requireDigest(input.previousRevocationDigest, 'v33_39_revocation_predecessor_invalid');
  assertDescriptor(input.monitorDescriptor, 'v33_39_revocation_monitor_invalid');
  if (input.monitor.keyId !== input.monitorDescriptor.keyId) throw new Error('v33_39_revocation_monitor_binding_invalid');
  requireDate(input.appliedAt, 'v33_39_revocation_time_invalid');
  const material = {
    version: '33.39' as const,
    receiptId: randomUUID(),
    manifestDigest: input.manifestDigest,
    transcriptDigest: input.transcriptDigest,
    lifecycleDigest: input.lifecycleDigest,
    revokedKeyId: input.revokedKeyId,
    revocationSequence: input.revocationSequence,
    previousRevocationDigest: input.previousRevocationDigest,
    monitor: input.monitorDescriptor,
    thresholdCertificateDigest: input.thresholdCertificateDigest,
    appliedAt: input.appliedAt.toISOString(),
    durableWriteObserved: true as const,
    resurrectionDenied: true as const,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, receiptDigest: sha256(material) }, input.monitor);
}

export function verifyRevocationPropagationV33_39(input: {
  readonly receipts: readonly SignedEnvelope<RevocationPropagationReceiptV33_39>[];
  readonly thresholdEvidence: ThresholdOperationEvidenceV33_39;
  readonly manifestDigest: string;
  readonly transcriptDigest: string;
  readonly lifecycleDigest: string;
  readonly revokedKeyId: string;
  readonly trust: HardwareCustodyTrustV33_39;
  readonly verifiedAt: Date;
}): void {
  const threshold = verifyThresholdCertificateV33_39({ evidence: input.thresholdEvidence, manifestDigest: input.manifestDigest, transcriptDigest: input.transcriptDigest, trust: input.trust, verifiedAt: input.verifiedAt });
  if (threshold.operationType !== 'REVOCATION_PROPAGATION' || threshold.operationDigest !== sha256({ lifecycleDigest: input.lifecycleDigest, revokedKeyId: input.revokedKeyId })) throw new Error('v33_39_revocation_threshold_binding_invalid');
  if (input.receipts.length < 3) throw new Error('v33_39_revocation_quorum_invalid');
  const monitors: QualificationActorDescriptorV33_36[] = [];
  for (const envelope of input.receipts) {
    const row = envelope.payload;
    if (!input.trust.trustedMonitorIds.includes(envelope.issuerKeyId) || !input.trust.monitorRegistry.verifyAt(envelope, input.verifiedAt)) throw new Error('v33_39_revocation_signature_invalid');
    if (row.monitor.keyId !== envelope.issuerKeyId || row.receiptDigest !== digestWithout(row, 'receiptDigest') || row.manifestDigest !== input.manifestDigest || row.transcriptDigest !== input.transcriptDigest || row.lifecycleDigest !== input.lifecycleDigest || row.revokedKeyId !== input.revokedKeyId || row.thresholdCertificateDigest !== threshold.thresholdDigest || row.durableWriteObserved !== true || row.resurrectionDenied !== true) throw new Error('v33_39_revocation_receipt_binding_invalid');
    verifyDescriptorFingerprint(input.trust.monitorRegistry, row.monitor, 'v33_39_revocation_monitor_fingerprint_invalid');
    monitors.push(row.monitor);
  }
  if (!descriptorsSeparated(monitors)) throw new Error('v33_39_revocation_monitor_separation_invalid');
  const coordinates = new Set(input.receipts.map((row) => `${row.payload.revocationSequence}:${row.payload.previousRevocationDigest ?? 'GENESIS'}`));
  if (coordinates.size !== 1) throw new Error('v33_39_revocation_split_view');
}

export function createSiteLossRecoveryReceiptV33_39(input: {
  readonly verifier: SigningIdentity;
  readonly verifierDescriptor: QualificationActorDescriptorV33_36;
  readonly manifestDigest: string;
  readonly transcriptDigest: string;
  readonly incident: Uint8Array;
  readonly lostSiteId: string;
  readonly recoverySiteId: string;
  readonly priorCheckpointPublicationDigest: string;
  readonly restoredCheckpointSequence: number;
  readonly restoredThresholdHeadDigest: string;
  readonly backupInventory: Uint8Array;
  readonly restoredArtifact: Uint8Array;
  readonly thresholdCertificateDigest: string;
  readonly recoveredAt: Date;
  readonly executionClass: 'LOCAL_REHEARSAL' | 'LIVE_EXTERNAL';
}): SignedEnvelope<SiteLossRecoveryReceiptV33_39> {
  assertDescriptor(input.verifierDescriptor, 'v33_39_recovery_verifier_invalid');
  if (input.verifier.keyId !== input.verifierDescriptor.keyId || input.lostSiteId.trim() === '' || input.recoverySiteId.trim() === '' || input.lostSiteId === input.recoverySiteId) throw new Error('v33_39_recovery_site_invalid');
  [input.priorCheckpointPublicationDigest, input.restoredThresholdHeadDigest, input.thresholdCertificateDigest].forEach((value) => requireDigest(value, 'v33_39_recovery_digest_invalid'));
  if (!Number.isInteger(input.restoredCheckpointSequence) || input.restoredCheckpointSequence < 1 || input.incident.byteLength < 16 || input.backupInventory.byteLength < 16 || input.restoredArtifact.byteLength < 16) throw new Error('v33_39_recovery_material_invalid');
  requireDate(input.recoveredAt, 'v33_39_recovery_time_invalid');
  const material = {
    version: '33.39' as const,
    recoveryId: randomUUID(),
    manifestDigest: input.manifestDigest,
    transcriptDigest: input.transcriptDigest,
    incidentDigest: sha256Bytes(input.incident),
    lostSiteId: input.lostSiteId,
    recoverySiteId: input.recoverySiteId,
    priorCheckpointPublicationDigest: input.priorCheckpointPublicationDigest,
    restoredCheckpointSequence: input.restoredCheckpointSequence,
    restoredThresholdHeadDigest: input.restoredThresholdHeadDigest,
    backupInventoryDigest: sha256Bytes(input.backupInventory),
    restoredArtifactDigest: sha256Bytes(input.restoredArtifact),
    thresholdCertificateDigest: input.thresholdCertificateDigest,
    restoredRoleCount: 11 as const,
    sequenceReset: false as const,
    forkDetected: false as const,
    recoveryVerifier: input.verifierDescriptor,
    recoveredAt: input.recoveredAt.toISOString(),
    executionClass: input.executionClass,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, recoveryDigest: sha256(material) }, input.verifier);
}

export function verifySiteLossRecoveryV33_39(input: {
  readonly receipt: SignedEnvelope<SiteLossRecoveryReceiptV33_39>;
  readonly thresholdEvidence: ThresholdOperationEvidenceV33_39;
  readonly checkpointPublication: PublicCheckpointPublicationV33_39;
  readonly incident: Uint8Array;
  readonly backupInventory: Uint8Array;
  readonly restoredArtifact: Uint8Array;
  readonly manifestDigest: string;
  readonly transcriptDigest: string;
  readonly trust: HardwareCustodyTrustV33_39;
  readonly verifiedAt: Date;
}): void {
  const row = input.receipt.payload;
  if (!input.trust.trustedRecoveryVerifierIds.includes(input.receipt.issuerKeyId) || !input.trust.recoveryVerifierRegistry.verifyAt(input.receipt, input.verifiedAt)) throw new Error('v33_39_recovery_signature_invalid');
  verifyDescriptorFingerprint(input.trust.recoveryVerifierRegistry, row.recoveryVerifier, 'v33_39_recovery_verifier_fingerprint_invalid');
  if (row.recoveryVerifier.keyId !== input.receipt.issuerKeyId || row.recoveryDigest !== digestWithout(row, 'recoveryDigest') || row.manifestDigest !== input.manifestDigest || row.transcriptDigest !== input.transcriptDigest || row.sequenceReset !== false || row.forkDetected !== false || row.restoredRoleCount !== 11) throw new Error('v33_39_recovery_binding_invalid');
  if (row.incidentDigest !== sha256Bytes(input.incident) || row.backupInventoryDigest !== sha256Bytes(input.backupInventory) || row.restoredArtifactDigest !== sha256Bytes(input.restoredArtifact)) throw new Error('v33_39_recovery_bytes_invalid');
  if (row.priorCheckpointPublicationDigest !== input.checkpointPublication.publicationDigest || row.restoredCheckpointSequence !== input.checkpointPublication.checkpointSequence) throw new Error('v33_39_recovery_checkpoint_continuity_invalid');
  const threshold = verifyThresholdCertificateV33_39({ evidence: input.thresholdEvidence, manifestDigest: input.manifestDigest, transcriptDigest: input.transcriptDigest, trust: input.trust, verifiedAt: input.verifiedAt });
  if (threshold.operationType !== 'SITE_RECOVERY' || row.thresholdCertificateDigest !== threshold.thresholdDigest || threshold.operationDigest !== sha256({ incidentDigest: row.incidentDigest, priorCheckpointPublicationDigest: row.priorCheckpointPublicationDigest, recoverySiteId: row.recoverySiteId, backupInventoryDigest: row.backupInventoryDigest, restoredArtifactDigest: row.restoredArtifactDigest })) throw new Error('v33_39_recovery_threshold_binding_invalid');
  assertBoundary(row, 'v33_39_recovery_boundary_invalid');
}

export function verifyExternalCustodyHardwareQualificationV33_39(input: {
  readonly priorCustodyVerdict: ExternalCustodyQualificationVerdictV33_38;
  readonly manifestDigest: string;
  readonly transcriptDigest: string;
  readonly expectedRoles: readonly { readonly roleSlot: CustodyRoleSlotV33_38; readonly actor: QualificationActorDescriptorV33_36 }[];
  readonly hardwareAttestations: readonly SignedEnvelope<HardwareKeyAttestationV33_39>[];
  readonly thresholdEvidence: readonly ThresholdOperationEvidenceV33_39[];
  readonly custodyTransfer: SignedEnvelope<SealedCustodyTransferPackageV33_39>;
  readonly transferSourceAttestation: SignedEnvelope<HardwareKeyAttestationV33_39>;
  readonly transferTargetAttestation: SignedEnvelope<HardwareKeyAttestationV33_39>;
  readonly sealedTransferMaterial: Uint8Array;
  readonly transferNonce: Uint8Array;
  readonly publicCheckpoint: SignedEnvelope<PublicCheckpointPublicationV33_39>;
  readonly publicCheckpointBytes: Uint8Array;
  readonly retrievalReceipts: readonly SignedEnvelope<PublicCheckpointRetrievalReceiptV33_39>[];
  readonly revocationReceipts: readonly SignedEnvelope<RevocationPropagationReceiptV33_39>[];
  readonly revocationLifecycleDigest: string;
  readonly revokedKeyId: string;
  readonly recoveryReceipt: SignedEnvelope<SiteLossRecoveryReceiptV33_39>;
  readonly incident: Uint8Array;
  readonly backupInventory: Uint8Array;
  readonly restoredArtifact: Uint8Array;
  readonly trust: HardwareCustodyTrustV33_39;
  readonly verifiedAt: Date;
}): ExternalCustodyHardwareQualificationVerdictV33_39 {
  if (input.priorCustodyVerdict.version !== '33.38' || input.priorCustodyVerdict.verdictDigest !== digestWithout(input.priorCustodyVerdict, 'verdictDigest') || input.priorCustodyVerdict.manifestDigest !== input.manifestDigest || input.priorCustodyVerdict.transcriptDigest !== input.transcriptDigest || input.priorCustodyVerdict.productionAuthority !== 'NONE' || input.priorCustodyVerdict.externalEffectsExecuted !== 0) throw new Error('v33_39_prior_verdict_invalid');
  const hardware = verifyHardwareKeyAttestationsV33_39({ attestations: input.hardwareAttestations, expectedRoles: input.expectedRoles, trust: input.trust, verifiedAt: input.verifiedAt });
  const threshold = verifyThresholdChainV33_39({ evidence: input.thresholdEvidence, manifestDigest: input.manifestDigest, transcriptDigest: input.transcriptDigest, trust: input.trust, verifiedAt: input.verifiedAt });
  verifySealedCustodyTransferPackageV33_39({ transfer: input.custodyTransfer, sourceAttestation: input.transferSourceAttestation, targetAttestation: input.transferTargetAttestation, sealedMaterial: input.sealedTransferMaterial, transferNonce: input.transferNonce, trust: input.trust, verifiedAt: input.verifiedAt });
  const checkpointEvidence = input.thresholdEvidence.find((row) => row.operationType === 'PUBLIC_CHECKPOINT');
  const revocationEvidence = input.thresholdEvidence.find((row) => row.operationType === 'REVOCATION_PROPAGATION');
  const recoveryEvidence = input.thresholdEvidence.find((row) => row.operationType === 'SITE_RECOVERY');
  if (checkpointEvidence === undefined || revocationEvidence === undefined || recoveryEvidence === undefined) throw new Error('v33_39_threshold_evidence_incomplete');
  const publication = verifyPublicCheckpointPublicationV33_39({ publication: input.publicCheckpoint, thresholdEvidence: checkpointEvidence, retrievalReceipts: input.retrievalReceipts, publishedBytes: input.publicCheckpointBytes, manifestDigest: input.manifestDigest, transcriptDigest: input.transcriptDigest, trust: input.trust, verifiedAt: input.verifiedAt });
  verifyRevocationPropagationV33_39({ receipts: input.revocationReceipts, thresholdEvidence: revocationEvidence, manifestDigest: input.manifestDigest, transcriptDigest: input.transcriptDigest, lifecycleDigest: input.revocationLifecycleDigest, revokedKeyId: input.revokedKeyId, trust: input.trust, verifiedAt: input.verifiedAt });
  verifySiteLossRecoveryV33_39({ receipt: input.recoveryReceipt, thresholdEvidence: recoveryEvidence, checkpointPublication: input.publicCheckpoint.payload, incident: input.incident, backupInventory: input.backupInventory, restoredArtifact: input.restoredArtifact, manifestDigest: input.manifestDigest, transcriptDigest: input.transcriptDigest, trust: input.trust, verifiedAt: input.verifiedAt });
  const external = input.priorCustodyVerdict.externalTopologyObserved === true && hardware.externalHardwareObserved && publication.externalTopologyObserved && input.recoveryReceipt.payload.executionClass === 'LIVE_EXTERNAL';
  const material = {
    version: '33.39' as const,
    manifestDigest: input.manifestDigest,
    transcriptDigest: input.transcriptDigest,
    priorCustodyVerdictDigest: input.priorCustodyVerdict.verdictDigest,
    hardwareAttestationCount: 11 as const,
    hardwareBoundRoleCount: hardware.hardwareBoundRoleCount,
    threshold: 3 as const,
    configuredCustodianCount: 5 as const,
    thresholdHeadDigest: threshold.headDigest,
    publicCheckpointPublicationDigest: input.publicCheckpoint.payload.publicationDigest,
    publicCheckpointSequence: input.publicCheckpoint.payload.checkpointSequence,
    retrievalReceiptCount: input.retrievalReceipts.length,
    revocationReceiptCount: input.revocationReceipts.length,
    recoveryDigest: input.recoveryReceipt.payload.recoveryDigest,
    custodyTransferVerified: true as const,
    revocationPropagationVerified: true as const,
    siteRecoveryVerified: true as const,
    status: external ? 'EXTERNAL_HSM_THRESHOLD_RECOVERY_EVIDENCE_ACCEPTED' as const : 'LOCAL_HSM_THRESHOLD_RECOVERY_REHEARSAL_ONLY' as const,
    externalTopologyObserved: external,
    externalHardwareObserved: hardware.externalHardwareObserved,
    externalHumanParticipants: 0 as const,
    verifiedAt: input.verifiedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return { ...material, verdictDigest: sha256(material) };
}
