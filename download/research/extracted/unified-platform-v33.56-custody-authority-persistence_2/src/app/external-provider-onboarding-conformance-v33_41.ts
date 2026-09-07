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
  HsmInteroperabilityVerdictV33_40,
  RemoteAttestationEvidenceV33_40,
  SignedHsmAdapterManifestV33_40,
} from './hsm-interoperability-remote-attestation-v33_40.js';

export type ProviderOnboardingExecutionClassV33_41 =
  | 'LOCAL_PROVIDER_CONFORMANCE_REHEARSAL'
  | 'LIVE_EXTERNAL_PROVIDER_CONFORMANCE';

export type ProviderRootClassV33_41 =
  | 'PKCS11_VENDOR_ROOT'
  | 'CLOUD_HSM_ATTESTATION_ROOT'
  | 'ENTERPRISE_HSM_ROOT';

export interface ProviderTrustRootManifestV33_41 {
  readonly version: '33.41';
  readonly rootId: string;
  readonly providerId: string;
  readonly rootClass: ProviderRootClassV33_41;
  readonly rootFingerprint: string;
  readonly rootCertificateDigest: string;
  readonly policyDigest: string;
  readonly publicDocumentationDigest: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly registrarKeyId: string;
  readonly executionClass: ProviderOnboardingExecutionClassV33_41;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly rootManifestDigest: string;
}

export type ConformanceInterfaceV33_41 = 'PKCS11-3.1' | 'PROVIDER_NATIVE_SIGNING_API';

export interface ProviderConformanceReceiptV33_41 {
  readonly version: '33.41';
  readonly receiptId: string;
  readonly providerId: string;
  readonly trustRootManifestDigest: string;
  readonly adapterManifestDigest: string;
  readonly remoteAttestationDigest: string;
  readonly moduleDigest: string;
  readonly interfaceStandard: ConformanceInterfaceV33_41;
  readonly deviceId: string;
  readonly tokenSerialDigest: string;
  readonly sessionNonceDigest: string;
  readonly testVectorDigest: string;
  readonly generatedInDevice: true;
  readonly extractable: false;
  readonly sensitive: true;
  readonly alwaysSensitive: true;
  readonly neverExtractable: true;
  readonly signVerifyObserved: true;
  readonly privateKeyExportBlocked: true;
  readonly sessionClosed: true;
  readonly hardwareSessionObserved: boolean;
  readonly laboratory: QualificationActorDescriptorV33_36;
  readonly executedAt: string;
  readonly expiresAt: string;
  readonly executionClass: ProviderOnboardingExecutionClassV33_41;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly receiptDigest: string;
}

export interface AttestationRevocationSnapshotV33_41 {
  readonly version: '33.41';
  readonly snapshotId: string;
  readonly sequence: number;
  readonly previousSnapshotDigest: string;
  readonly trustRootSetDigest: string;
  readonly revokedAttestationDigests: readonly string[];
  readonly revokedDeviceIds: readonly string[];
  readonly effectiveAt: string;
  readonly authorityKeyId: string;
  readonly executionClass: ProviderOnboardingExecutionClassV33_41;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly snapshotDigest: string;
}

export interface ProviderReplacementApprovalV33_41 {
  readonly version: '33.41';
  readonly approvalId: string;
  readonly replacementPlanDigest: string;
  readonly shareIndex: number;
  readonly custodian: QualificationActorDescriptorV33_36;
  readonly approvedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly approvalDigest: string;
}

export interface ProviderReplacementCertificateV33_41 {
  readonly version: '33.41';
  readonly certificateId: string;
  readonly previousReplacementDigest: string;
  readonly replacementSequence: number;
  readonly oldProviderId: string;
  readonly oldAttestationDigest: string;
  readonly oldDeviceId: string;
  readonly newProviderId: string;
  readonly newTrustRootManifestDigest: string;
  readonly newConformanceReceiptDigest: string;
  readonly revocationSnapshotDigest: string;
  readonly activeProviderIdsBefore: readonly string[];
  readonly activeProviderIdsAfter: readonly string[];
  readonly threshold: 3;
  readonly configuredCustodianCount: 5;
  readonly approvalDigests: readonly string[];
  readonly custodianKeyIds: readonly string[];
  readonly authorityKeyId: string;
  readonly issuedAt: string;
  readonly oldProviderFenced: true;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly certificateDigest: string;
}

export interface ProviderCheckpointAnchorV33_41 {
  readonly version: '33.41';
  readonly anchorId: string;
  readonly previousAnchorDigest: string;
  readonly anchorSequence: number;
  readonly priorV33_40VerdictDigest: string;
  readonly trustRootSetDigest: string;
  readonly conformanceSetDigest: string;
  readonly revocationSnapshotDigest: string;
  readonly replacementCertificateDigest: string;
  readonly checkpointBytesDigest: string;
  readonly endpoint: string;
  readonly publisher: QualificationActorDescriptorV33_36;
  readonly publicNetworkRetrievalObserved: boolean;
  readonly publishedAt: string;
  readonly executionClass: ProviderOnboardingExecutionClassV33_41;
  readonly publicationAuthorityKeyId: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly anchorDigest: string;
}

export interface ProviderCheckpointMonitorReceiptV33_41 {
  readonly version: '33.41';
  readonly receiptId: string;
  readonly anchorDigest: string;
  readonly anchorSequence: number;
  readonly checkpointBytesDigest: string;
  readonly monitor: QualificationActorDescriptorV33_36;
  readonly providerId: string;
  readonly retrievedAt: string;
  readonly durableWriteObserved: true;
  readonly fsyncObserved: true;
  readonly networkClass: 'LOCAL_LOOPBACK' | 'INDEPENDENT_EXTERNAL';
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly receiptDigest: string;
}

export interface ProviderSiteRecoveryReceiptV33_41 {
  readonly version: '33.41';
  readonly recoveryId: string;
  readonly previousRecoveryDigest: string;
  readonly recoverySequence: number;
  readonly sourceSiteId: string;
  readonly targetSiteId: string;
  readonly sourceProviderId: string;
  readonly targetProviderId: string;
  readonly anchorDigest: string;
  readonly replacementCertificateDigest: string;
  readonly restoredBytesDigest: string;
  readonly sequenceReset: false;
  readonly forkDetected: false;
  readonly verifier: QualificationActorDescriptorV33_36;
  readonly recoveredAt: string;
  readonly executionClass: ProviderOnboardingExecutionClassV33_41;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly recoveryDigest: string;
}

export interface ExternalProviderOnboardingVerdictV33_41 {
  readonly version: '33.41';
  readonly priorV33_40VerdictDigest: string;
  readonly trustRootCount: number;
  readonly conformanceReceiptCount: number;
  readonly revocationSnapshotDigest: string;
  readonly replacementCertificateDigest: string;
  readonly checkpointAnchorDigest: string;
  readonly monitorReceiptCount: number;
  readonly siteRecoveryDigest: string;
  readonly status:
    | 'LOCAL_PROVIDER_ONBOARDING_CONFORMANCE_REHEARSAL_ONLY'
    | 'EXTERNAL_PROVIDER_ONBOARDING_CONFORMANCE_ACCEPTED';
  readonly externalTrustRootsObserved: boolean;
  readonly externalHardwareSessionsObserved: boolean;
  readonly publicCheckpointObserved: boolean;
  readonly externalHumanParticipants: 0;
  readonly verifiedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly verdictDigest: string;
}

export interface ProviderOnboardingTrustV33_41 {
  readonly adapterSignerRegistry: KeyRegistry;
  readonly trustedAdapterSignerIds: readonly string[];
  readonly attestationAuthorityRegistry: KeyRegistry;
  readonly trustedAttestationAuthorityIds: readonly string[];
  readonly rootRegistrarRegistry: KeyRegistry;
  readonly trustedRootRegistrarIds: readonly string[];
  readonly conformanceLaboratoryRegistry: KeyRegistry;
  readonly trustedConformanceLaboratoryIds: readonly string[];
  readonly revocationAuthorityRegistry: KeyRegistry;
  readonly trustedRevocationAuthorityIds: readonly string[];
  readonly custodianRegistry: KeyRegistry;
  readonly trustedCustodianIds: readonly string[];
  readonly replacementAuthorityRegistry: KeyRegistry;
  readonly trustedReplacementAuthorityIds: readonly string[];
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
  if ([row.keyId, row.keyFingerprint, row.organizationId, row.hostId, row.administratorId].some((v) => v.trim() === '')) throw new Error(code);
  requireDigest(row.keyFingerprint, code);
}
function descriptorSeparated(rows: readonly QualificationActorDescriptorV33_36[]): boolean {
  return ['keyId', 'organizationId', 'hostId', 'administratorId'].every(
    (field) => new Set(rows.map((r) => r[field as keyof QualificationActorDescriptorV33_36])).size === rows.length,
  );
}
function verifyEnvelope<T>(registry: KeyRegistry, trusted: readonly string[], envelope: SignedEnvelope<T>, at: Date, code: string): void {
  if (!trusted.includes(envelope.issuerKeyId) || !registry.verifyAt(envelope, at)) throw new Error(code);
}
function sortedUnique(values: readonly string[]): string[] { return [...new Set(values)].sort(); }
function isPublicHttps(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    const host = u.hostname.toLowerCase();
    return u.protocol === 'https:' && host.includes('.') && host !== 'localhost' && !host.endsWith('.local') && !host.endsWith('.invalid') && !/^\d+\.\d+\.\d+\.\d+$/.test(host);
  } catch { return false; }
}

export function createProviderTrustRootManifestV33_41(input: {
  readonly registrar: SigningIdentity;
  readonly providerId: string;
  readonly rootClass: ProviderRootClassV33_41;
  readonly rootCertificateBytes: Uint8Array;
  readonly policyDigest: string;
  readonly publicDocumentationDigest: string;
  readonly validFrom: Date;
  readonly validUntil: Date;
  readonly executionClass: ProviderOnboardingExecutionClassV33_41;
}): SignedEnvelope<ProviderTrustRootManifestV33_41> {
  requireText(input.providerId, 'v33_41_root_provider_required'); requireDigest(input.policyDigest, 'v33_41_root_policy_invalid'); requireDigest(input.publicDocumentationDigest, 'v33_41_root_documentation_invalid');
  requireDate(input.validFrom, 'v33_41_root_valid_from_invalid'); requireDate(input.validUntil, 'v33_41_root_valid_until_invalid'); if (input.validUntil <= input.validFrom) throw new Error('v33_41_root_window_invalid');
  const rootCertificateDigest = sha256Bytes(input.rootCertificateBytes); if (input.rootCertificateBytes.byteLength === 0) throw new Error('v33_41_root_certificate_empty');
  const material = {
    version: '33.41' as const, rootId: `root-${input.providerId}`, providerId: input.providerId, rootClass: input.rootClass,
    rootFingerprint: rootCertificateDigest, rootCertificateDigest, policyDigest: input.policyDigest,
    publicDocumentationDigest: input.publicDocumentationDigest, validFrom: input.validFrom.toISOString(), validUntil: input.validUntil.toISOString(),
    registrarKeyId: input.registrar.keyId, executionClass: input.executionClass, productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, rootManifestDigest: sha256(material) }, input.registrar);
}

export function verifyProviderTrustRootsV33_41(input: {
  readonly roots: readonly SignedEnvelope<ProviderTrustRootManifestV33_41>[];
  readonly rootCertificateBytesByManifestDigest: ReadonlyMap<string, Uint8Array>;
  readonly trust: ProviderOnboardingTrustV33_41;
  readonly verifiedAt: Date;
}): readonly ProviderTrustRootManifestV33_41[] {
  if (input.roots.length < 3) throw new Error('v33_41_root_quorum_required');
  const providers = new Set<string>(); const rootIds = new Set<string>(); const fingerprints = new Set<string>();
  const rows = input.roots.map((e) => {
    const r = e.payload; verifyEnvelope(input.trust.rootRegistrarRegistry, input.trust.trustedRootRegistrarIds, e, input.verifiedAt, 'v33_41_root_signature_invalid');
    assertBoundary(r, 'v33_41_root_boundary_invalid'); if (r.version !== '33.41' || r.registrarKeyId !== e.issuerKeyId || r.rootManifestDigest !== digestWithout(r, 'rootManifestDigest')) throw new Error('v33_41_root_manifest_invalid');
    requireDigest(r.rootFingerprint, 'v33_41_root_fingerprint_invalid'); requireDigest(r.rootCertificateDigest, 'v33_41_root_certificate_digest_invalid'); requireDigest(r.policyDigest, 'v33_41_root_policy_invalid'); requireDigest(r.publicDocumentationDigest, 'v33_41_root_documentation_invalid');
    const at = input.verifiedAt.getTime(); if (at < Date.parse(r.validFrom) || at > Date.parse(r.validUntil)) throw new Error('v33_41_root_expired');
    const bytes = input.rootCertificateBytesByManifestDigest.get(r.rootManifestDigest); if (bytes === undefined || sha256Bytes(bytes) !== r.rootCertificateDigest || r.rootFingerprint !== r.rootCertificateDigest) throw new Error('v33_41_root_bytes_mismatch');
    if (r.executionClass === 'LIVE_EXTERNAL_PROVIDER_CONFORMANCE' && r.rootClass === 'ENTERPRISE_HSM_ROOT' && r.publicDocumentationDigest === sha256({ local: true })) throw new Error('v33_41_external_root_not_public');
    if (providers.has(r.providerId) || rootIds.has(r.rootId) || fingerprints.has(r.rootFingerprint)) throw new Error('v33_41_root_duplicate');
    providers.add(r.providerId); rootIds.add(r.rootId); fingerprints.add(r.rootFingerprint); return r;
  });
  return rows;
}

export function createProviderConformanceReceiptV33_41(input: {
  readonly laboratory: SigningIdentity;
  readonly laboratoryDescriptor: QualificationActorDescriptorV33_36;
  readonly providerId: string;
  readonly trustRootManifest: ProviderTrustRootManifestV33_41;
  readonly adapterManifest: SignedHsmAdapterManifestV33_40;
  readonly remoteAttestation: RemoteAttestationEvidenceV33_40;
  readonly deviceId: string;
  readonly tokenSerialDigest: string;
  readonly sessionNonce: Uint8Array;
  readonly testVectorDigest: string;
  readonly hardwareSessionObserved: boolean;
  readonly executedAt: Date;
  readonly expiresAt: Date;
  readonly executionClass: ProviderOnboardingExecutionClassV33_41;
}): SignedEnvelope<ProviderConformanceReceiptV33_41> {
  assertDescriptor(input.laboratoryDescriptor, 'v33_41_lab_descriptor_invalid'); requireDigest(input.tokenSerialDigest, 'v33_41_token_serial_invalid'); requireDigest(input.testVectorDigest, 'v33_41_test_vector_invalid');
  if (input.providerId !== input.trustRootManifest.providerId || input.providerId !== input.adapterManifest.providerId || input.providerId !== input.remoteAttestation.providerId) throw new Error('v33_41_conformance_provider_mismatch');
  if (input.deviceId !== input.remoteAttestation.deviceId) throw new Error('v33_41_conformance_device_mismatch');
  if (input.remoteAttestation.adapterManifestDigest !== input.adapterManifest.manifestDigest) throw new Error('v33_41_conformance_adapter_binding_invalid');
  if (input.sessionNonce.byteLength < 16) throw new Error('v33_41_conformance_nonce_too_short'); requireDate(input.executedAt, 'v33_41_conformance_time_invalid'); requireDate(input.expiresAt, 'v33_41_conformance_expiry_invalid'); if (input.expiresAt <= input.executedAt) throw new Error('v33_41_conformance_window_invalid');
  if (input.executionClass === 'LIVE_EXTERNAL_PROVIDER_CONFORMANCE' && !input.hardwareSessionObserved) throw new Error('v33_41_live_hardware_session_required');
  const material = {
    version: '33.41' as const, receiptId: `conformance-${input.providerId}-${input.deviceId}`, providerId: input.providerId,
    trustRootManifestDigest: input.trustRootManifest.rootManifestDigest, adapterManifestDigest: input.adapterManifest.manifestDigest,
    remoteAttestationDigest: input.remoteAttestation.evidenceDigest, moduleDigest: input.adapterManifest.moduleDigest,
    interfaceStandard: input.adapterManifest.interfaceStandard, deviceId: input.deviceId, tokenSerialDigest: input.tokenSerialDigest,
    sessionNonceDigest: sha256Bytes(input.sessionNonce), testVectorDigest: input.testVectorDigest,
    generatedInDevice: true as const, extractable: false as const, sensitive: true as const, alwaysSensitive: true as const,
    neverExtractable: true as const, signVerifyObserved: true as const, privateKeyExportBlocked: true as const, sessionClosed: true as const,
    hardwareSessionObserved: input.hardwareSessionObserved, laboratory: input.laboratoryDescriptor, executedAt: input.executedAt.toISOString(), expiresAt: input.expiresAt.toISOString(),
    executionClass: input.executionClass, productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, receiptDigest: sha256(material) }, input.laboratory);
}

export function verifyProviderConformanceReceiptsV33_41(input: {
  readonly receipts: readonly SignedEnvelope<ProviderConformanceReceiptV33_41>[];
  readonly roots: readonly ProviderTrustRootManifestV33_41[];
  readonly manifests: readonly SignedEnvelope<SignedHsmAdapterManifestV33_40>[];
  readonly moduleBytesByManifestDigest: ReadonlyMap<string, Uint8Array>;
  readonly attestations: readonly SignedEnvelope<RemoteAttestationEvidenceV33_40>[];
  readonly sessionNoncesByReceiptDigest: ReadonlyMap<string, Uint8Array>;
  readonly trust: ProviderOnboardingTrustV33_41;
  readonly verifiedAt: Date;
}): readonly ProviderConformanceReceiptV33_41[] {
  if (input.receipts.length < 3) throw new Error('v33_41_conformance_quorum_required');
  const rootByDigest = new Map(input.roots.map((r) => [r.rootManifestDigest, r]));
  const manifestPayloads = input.manifests.map((envelope) => {
    verifyEnvelope(input.trust.adapterSignerRegistry, input.trust.trustedAdapterSignerIds, envelope, input.verifiedAt, 'v33_41_adapter_signature_invalid');
    const m = envelope.payload;
    assertBoundary(m, 'v33_41_adapter_boundary_invalid');
    if (m.manifestDigest !== digestWithout(m, 'manifestDigest') || m.signerKeyId !== envelope.issuerKeyId) throw new Error('v33_41_adapter_manifest_invalid');
    const moduleBytes = input.moduleBytesByManifestDigest.get(m.manifestDigest);
    if (moduleBytes === undefined || sha256Bytes(moduleBytes) !== m.moduleDigest) throw new Error('v33_41_adapter_module_bytes_mismatch');
    return m;
  });
  const attestationPayloads = input.attestations.map((envelope) => {
    verifyEnvelope(input.trust.attestationAuthorityRegistry, input.trust.trustedAttestationAuthorityIds, envelope, input.verifiedAt, 'v33_41_attestation_signature_invalid');
    const a = envelope.payload;
    assertBoundary(a, 'v33_41_attestation_boundary_invalid');
    if (a.evidenceDigest !== digestWithout(a, 'evidenceDigest') || a.attestationAuthorityKeyId !== envelope.issuerKeyId) throw new Error('v33_41_attestation_invalid');
    if (input.verifiedAt.getTime() < Date.parse(a.observedAt) || input.verifiedAt.getTime() > Date.parse(a.expiresAt)) throw new Error('v33_41_attestation_expired');
    return a;
  });
  const manifestByDigest = new Map(manifestPayloads.map((m) => [m.manifestDigest, m]));
  const attestationByDigest = new Map(attestationPayloads.map((a) => [a.evidenceDigest, a]));
  const devices = new Set<string>(); const providers = new Set<string>(); const labs: QualificationActorDescriptorV33_36[] = [];
  return input.receipts.map((e) => {
    const r = e.payload; verifyEnvelope(input.trust.conformanceLaboratoryRegistry, input.trust.trustedConformanceLaboratoryIds, e, input.verifiedAt, 'v33_41_conformance_signature_invalid');
    assertBoundary(r, 'v33_41_conformance_boundary_invalid'); assertDescriptor(r.laboratory, 'v33_41_conformance_lab_invalid'); if (r.laboratory.keyId !== e.issuerKeyId) throw new Error('v33_41_conformance_lab_key_mismatch');
    if (r.version !== '33.41' || r.receiptDigest !== digestWithout(r, 'receiptDigest')) throw new Error('v33_41_conformance_receipt_invalid');
    const root = rootByDigest.get(r.trustRootManifestDigest); const manifest = manifestByDigest.get(r.adapterManifestDigest); const attestation = attestationByDigest.get(r.remoteAttestationDigest);
    if (root === undefined || manifest === undefined || attestation === undefined) throw new Error('v33_41_conformance_reference_missing');
    if (root.providerId !== r.providerId || manifest.providerId !== r.providerId || attestation.providerId !== r.providerId || attestation.deviceId !== r.deviceId || attestation.adapterManifestDigest !== manifest.manifestDigest || r.moduleDigest !== manifest.moduleDigest || r.interfaceStandard !== manifest.interfaceStandard) throw new Error('v33_41_conformance_binding_invalid');
    const nonce = input.sessionNoncesByReceiptDigest.get(r.receiptDigest); if (nonce === undefined || sha256Bytes(nonce) !== r.sessionNonceDigest) throw new Error('v33_41_conformance_nonce_mismatch');
    const at = input.verifiedAt.getTime(); if (at < Date.parse(r.executedAt) || at > Date.parse(r.expiresAt)) throw new Error('v33_41_conformance_expired');
    if (!(r.generatedInDevice && !r.extractable && r.sensitive && r.alwaysSensitive && r.neverExtractable && r.signVerifyObserved && r.privateKeyExportBlocked && r.sessionClosed)) throw new Error('v33_41_conformance_vector_failed');
    if (r.executionClass === 'LIVE_EXTERNAL_PROVIDER_CONFORMANCE' && !r.hardwareSessionObserved) throw new Error('v33_41_conformance_external_hardware_missing');
    if (devices.has(r.deviceId) || providers.has(r.providerId)) throw new Error('v33_41_conformance_duplicate'); devices.add(r.deviceId); providers.add(r.providerId); labs.push(r.laboratory); return r;
  }).map((r, _i, rows) => { if (!descriptorSeparated(labs)) throw new Error('v33_41_laboratory_separation_required'); return r; });
}

export function createAttestationRevocationSnapshotV33_41(input: {
  readonly authority: SigningIdentity;
  readonly sequence: number;
  readonly previousSnapshot?: AttestationRevocationSnapshotV33_41;
  readonly trustRootManifestDigests: readonly string[];
  readonly revokedAttestationDigests: readonly string[];
  readonly revokedDeviceIds: readonly string[];
  readonly effectiveAt: Date;
  readonly executionClass: ProviderOnboardingExecutionClassV33_41;
}): SignedEnvelope<AttestationRevocationSnapshotV33_41> {
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) throw new Error('v33_41_revocation_sequence_invalid');
  const previousSnapshotDigest = input.previousSnapshot?.snapshotDigest ?? sha256({ genesis: 'v33.41-revocation' }); if (input.previousSnapshot !== undefined && input.sequence !== input.previousSnapshot.sequence + 1) throw new Error('v33_41_revocation_sequence_gap');
  const revokedAttestationDigests = sortedUnique(input.revokedAttestationDigests); const revokedDeviceIds = sortedUnique(input.revokedDeviceIds); if (revokedAttestationDigests.length === 0 || revokedDeviceIds.length === 0 || revokedAttestationDigests.length !== revokedDeviceIds.length) throw new Error('v33_41_revocation_entries_invalid');
  revokedAttestationDigests.forEach((d) => requireDigest(d, 'v33_41_revocation_digest_invalid')); revokedDeviceIds.forEach((d) => requireText(d, 'v33_41_revocation_device_invalid')); input.trustRootManifestDigests.forEach((d) => requireDigest(d, 'v33_41_revocation_root_invalid'));
  if (input.previousSnapshot !== undefined) {
    if (!input.previousSnapshot.revokedAttestationDigests.every((d) => revokedAttestationDigests.includes(d)) || !input.previousSnapshot.revokedDeviceIds.every((d) => revokedDeviceIds.includes(d))) throw new Error('v33_41_revocation_rollback');
  }
  const material = { version: '33.41' as const, snapshotId: `revocation-${input.sequence}`, sequence: input.sequence, previousSnapshotDigest, trustRootSetDigest: sha256(sortedUnique(input.trustRootManifestDigests)), revokedAttestationDigests, revokedDeviceIds, effectiveAt: input.effectiveAt.toISOString(), authorityKeyId: input.authority.keyId, executionClass: input.executionClass, productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const };
  return signEnvelope({ ...material, snapshotDigest: sha256(material) }, input.authority);
}

export function verifyAttestationRevocationSnapshotV33_41(input: {
  readonly snapshot: SignedEnvelope<AttestationRevocationSnapshotV33_41>;
  readonly previousSnapshot?: AttestationRevocationSnapshotV33_41;
  readonly roots: readonly ProviderTrustRootManifestV33_41[];
  readonly trust: ProviderOnboardingTrustV33_41;
  readonly verifiedAt: Date;
}): AttestationRevocationSnapshotV33_41 {
  const r = input.snapshot.payload; verifyEnvelope(input.trust.revocationAuthorityRegistry, input.trust.trustedRevocationAuthorityIds, input.snapshot, input.verifiedAt, 'v33_41_revocation_signature_invalid'); assertBoundary(r, 'v33_41_revocation_boundary_invalid');
  if (r.version !== '33.41' || r.authorityKeyId !== input.snapshot.issuerKeyId || r.snapshotDigest !== digestWithout(r, 'snapshotDigest')) throw new Error('v33_41_revocation_snapshot_invalid');
  if (r.trustRootSetDigest !== sha256(sortedUnique(input.roots.map((x) => x.rootManifestDigest)))) throw new Error('v33_41_revocation_root_set_mismatch');
  if (input.previousSnapshot === undefined) { if (r.sequence !== 1 || r.previousSnapshotDigest !== sha256({ genesis: 'v33.41-revocation' })) throw new Error('v33_41_revocation_genesis_invalid'); }
  else { if (r.sequence !== input.previousSnapshot.sequence + 1 || r.previousSnapshotDigest !== input.previousSnapshot.snapshotDigest) throw new Error('v33_41_revocation_chain_invalid'); if (!input.previousSnapshot.revokedAttestationDigests.every((d) => r.revokedAttestationDigests.includes(d)) || !input.previousSnapshot.revokedDeviceIds.every((d) => r.revokedDeviceIds.includes(d))) throw new Error('v33_41_revocation_rollback'); }
  if (Date.parse(r.effectiveAt) > input.verifiedAt.getTime()) throw new Error('v33_41_revocation_not_effective'); return r;
}

export function createProviderReplacementApprovalV33_41(input: {
  readonly custodian: SigningIdentity;
  readonly descriptor: QualificationActorDescriptorV33_36;
  readonly replacementPlanDigest: string;
  readonly shareIndex: number;
  readonly approvedAt: Date;
}): SignedEnvelope<ProviderReplacementApprovalV33_41> {
  assertDescriptor(input.descriptor, 'v33_41_replacement_custodian_invalid'); requireDigest(input.replacementPlanDigest, 'v33_41_replacement_plan_invalid'); if (!Number.isSafeInteger(input.shareIndex) || input.shareIndex < 1 || input.shareIndex > 5) throw new Error('v33_41_replacement_share_invalid');
  const material = { version: '33.41' as const, approvalId: `replacement-approval-${input.shareIndex}`, replacementPlanDigest: input.replacementPlanDigest, shareIndex: input.shareIndex, custodian: input.descriptor, approvedAt: input.approvedAt.toISOString(), productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const };
  return signEnvelope({ ...material, approvalDigest: sha256(material) }, input.custodian);
}

export function finalizeProviderReplacementV33_41(input: {
  readonly authority: SigningIdentity;
  readonly previousReplacementDigest: string;
  readonly replacementSequence: number;
  readonly oldProviderId: string;
  readonly oldAttestation: RemoteAttestationEvidenceV33_40;
  readonly newProviderId: string;
  readonly newTrustRoot: ProviderTrustRootManifestV33_41;
  readonly newConformanceReceipt: ProviderConformanceReceiptV33_41;
  readonly revocationSnapshot: AttestationRevocationSnapshotV33_41;
  readonly activeProviderIdsBefore: readonly string[];
  readonly approvals: readonly SignedEnvelope<ProviderReplacementApprovalV33_41>[];
  readonly trust: ProviderOnboardingTrustV33_41;
  readonly issuedAt: Date;
}): SignedEnvelope<ProviderReplacementCertificateV33_41> {
  requireDigest(input.previousReplacementDigest, 'v33_41_replacement_previous_invalid'); if (!Number.isSafeInteger(input.replacementSequence) || input.replacementSequence < 1) throw new Error('v33_41_replacement_sequence_invalid');
  const before = sortedUnique(input.activeProviderIdsBefore); if (before.length !== input.activeProviderIdsBefore.length || !before.includes(input.oldProviderId) || before.includes(input.newProviderId) || before.length < 3) throw new Error('v33_41_replacement_provider_set_invalid');
  if (input.oldProviderId === input.newProviderId || input.newProviderId !== input.newTrustRoot.providerId || input.newProviderId !== input.newConformanceReceipt.providerId || input.newTrustRoot.rootManifestDigest !== input.newConformanceReceipt.trustRootManifestDigest) throw new Error('v33_41_replacement_binding_invalid');
  if (!input.revocationSnapshot.revokedAttestationDigests.includes(input.oldAttestation.evidenceDigest) || !input.revocationSnapshot.revokedDeviceIds.includes(input.oldAttestation.deviceId)) throw new Error('v33_41_old_provider_not_revoked');
  if (Date.parse(input.revocationSnapshot.effectiveAt) > input.issuedAt.getTime()) throw new Error('v33_41_revocation_after_replacement');
  if (input.approvals.length < 3) throw new Error('v33_41_replacement_quorum_required'); const planDigest = sha256({ previousReplacementDigest: input.previousReplacementDigest, replacementSequence: input.replacementSequence, oldProviderId: input.oldProviderId, oldAttestationDigest: input.oldAttestation.evidenceDigest, newProviderId: input.newProviderId, newTrustRootManifestDigest: input.newTrustRoot.rootManifestDigest, newConformanceReceiptDigest: input.newConformanceReceipt.receiptDigest, revocationSnapshotDigest: input.revocationSnapshot.snapshotDigest, activeProviderIdsBefore: before });
  const shares = new Set<number>(); const keys = new Set<string>(); const actors: QualificationActorDescriptorV33_36[] = [];
  for (const e of input.approvals) { const a = e.payload; verifyEnvelope(input.trust.custodianRegistry, input.trust.trustedCustodianIds, e, input.issuedAt, 'v33_41_replacement_approval_signature_invalid'); assertBoundary(a, 'v33_41_replacement_approval_boundary_invalid'); assertDescriptor(a.custodian, 'v33_41_replacement_approval_actor_invalid'); if (a.custodian.keyId !== e.issuerKeyId || a.replacementPlanDigest !== planDigest || a.approvalDigest !== digestWithout(a, 'approvalDigest')) throw new Error('v33_41_replacement_approval_invalid'); if (shares.has(a.shareIndex) || keys.has(e.issuerKeyId)) throw new Error('v33_41_replacement_approval_duplicate'); shares.add(a.shareIndex); keys.add(e.issuerKeyId); actors.push(a.custodian); }
  if (!descriptorSeparated(actors)) throw new Error('v33_41_replacement_custodian_separation_required');
  const after = before.filter((p) => p !== input.oldProviderId).concat(input.newProviderId).sort(); if (after.length !== before.length || new Set(after).size !== after.length || after.length < 3) throw new Error('v33_41_replacement_quorum_lost');
  const material = { version: '33.41' as const, certificateId: `replacement-${input.replacementSequence}`, previousReplacementDigest: input.previousReplacementDigest, replacementSequence: input.replacementSequence, oldProviderId: input.oldProviderId, oldAttestationDigest: input.oldAttestation.evidenceDigest, oldDeviceId: input.oldAttestation.deviceId, newProviderId: input.newProviderId, newTrustRootManifestDigest: input.newTrustRoot.rootManifestDigest, newConformanceReceiptDigest: input.newConformanceReceipt.receiptDigest, revocationSnapshotDigest: input.revocationSnapshot.snapshotDigest, activeProviderIdsBefore: before, activeProviderIdsAfter: after, threshold: 3 as const, configuredCustodianCount: 5 as const, approvalDigests: input.approvals.map((a) => a.payload.approvalDigest).sort(), custodianKeyIds: [...keys].sort(), authorityKeyId: input.authority.keyId, issuedAt: input.issuedAt.toISOString(), oldProviderFenced: true as const, productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const };
  return signEnvelope({ ...material, certificateDigest: sha256(material) }, input.authority);
}

export function verifyProviderReplacementV33_41(input: {
  readonly certificate: SignedEnvelope<ProviderReplacementCertificateV33_41>;
  readonly approvals: readonly SignedEnvelope<ProviderReplacementApprovalV33_41>[];
  readonly oldAttestation: RemoteAttestationEvidenceV33_40;
  readonly newTrustRoot: ProviderTrustRootManifestV33_41;
  readonly newConformanceReceipt: ProviderConformanceReceiptV33_41;
  readonly revocationSnapshot: AttestationRevocationSnapshotV33_41;
  readonly trust: ProviderOnboardingTrustV33_41;
  readonly verifiedAt: Date;
}): ProviderReplacementCertificateV33_41 {
  const c = input.certificate.payload; verifyEnvelope(input.trust.replacementAuthorityRegistry, input.trust.trustedReplacementAuthorityIds, input.certificate, input.verifiedAt, 'v33_41_replacement_signature_invalid'); assertBoundary(c, 'v33_41_replacement_boundary_invalid');
  if (c.version !== '33.41' || c.authorityKeyId !== input.certificate.issuerKeyId || c.certificateDigest !== digestWithout(c, 'certificateDigest') || !c.oldProviderFenced) throw new Error('v33_41_replacement_certificate_invalid');
  if (c.oldAttestationDigest !== input.oldAttestation.evidenceDigest || c.oldDeviceId !== input.oldAttestation.deviceId || c.newTrustRootManifestDigest !== input.newTrustRoot.rootManifestDigest || c.newConformanceReceiptDigest !== input.newConformanceReceipt.receiptDigest || c.revocationSnapshotDigest !== input.revocationSnapshot.snapshotDigest) throw new Error('v33_41_replacement_reference_mismatch');
  if (!input.revocationSnapshot.revokedAttestationDigests.includes(c.oldAttestationDigest) || !input.revocationSnapshot.revokedDeviceIds.includes(c.oldDeviceId)) throw new Error('v33_41_replacement_revocation_missing');
  const planDigest = sha256({ previousReplacementDigest: c.previousReplacementDigest, replacementSequence: c.replacementSequence, oldProviderId: c.oldProviderId, oldAttestationDigest: c.oldAttestationDigest, newProviderId: c.newProviderId, newTrustRootManifestDigest: c.newTrustRootManifestDigest, newConformanceReceiptDigest: c.newConformanceReceiptDigest, revocationSnapshotDigest: c.revocationSnapshotDigest, activeProviderIdsBefore: [...c.activeProviderIdsBefore] });
  const shares = new Set<number>(); const keys = new Set<string>(); const actors: QualificationActorDescriptorV33_36[] = [];
  for (const e of input.approvals) { const a = e.payload; verifyEnvelope(input.trust.custodianRegistry, input.trust.trustedCustodianIds, e, input.verifiedAt, 'v33_41_replacement_approval_signature_invalid'); if (a.replacementPlanDigest !== planDigest || a.approvalDigest !== digestWithout(a, 'approvalDigest') || a.custodian.keyId !== e.issuerKeyId || shares.has(a.shareIndex) || keys.has(e.issuerKeyId)) throw new Error('v33_41_replacement_approval_invalid'); shares.add(a.shareIndex); keys.add(e.issuerKeyId); actors.push(a.custodian); }
  if (keys.size < 3 || !descriptorSeparated(actors) || sha256([...input.approvals.map((a) => a.payload.approvalDigest)].sort()) !== sha256([...c.approvalDigests])) throw new Error('v33_41_replacement_quorum_invalid');
  const expectedAfter = c.activeProviderIdsBefore.filter((p) => p !== c.oldProviderId).concat(c.newProviderId).sort(); if (sha256(expectedAfter) !== sha256([...c.activeProviderIdsAfter]) || new Set(expectedAfter).size !== expectedAfter.length || expectedAfter.length < 3) throw new Error('v33_41_replacement_provider_set_invalid'); return c;
}

export function createProviderCheckpointAnchorV33_41(input: {
  readonly authority: SigningIdentity;
  readonly priorV33_40Verdict: HsmInteroperabilityVerdictV33_40;
  readonly roots: readonly ProviderTrustRootManifestV33_41[];
  readonly conformanceReceipts: readonly ProviderConformanceReceiptV33_41[];
  readonly revocationSnapshot: AttestationRevocationSnapshotV33_41;
  readonly replacementCertificate: ProviderReplacementCertificateV33_41;
  readonly previousAnchorDigest: string;
  readonly anchorSequence: number;
  readonly checkpointBytes: Uint8Array;
  readonly endpoint: string;
  readonly publisher: QualificationActorDescriptorV33_36;
  readonly publicNetworkRetrievalObserved: boolean;
  readonly publishedAt: Date;
  readonly executionClass: ProviderOnboardingExecutionClassV33_41;
}): SignedEnvelope<ProviderCheckpointAnchorV33_41> {
  assertDescriptor(input.publisher, 'v33_41_anchor_publisher_invalid'); requireDigest(input.previousAnchorDigest, 'v33_41_anchor_previous_invalid'); if (!Number.isSafeInteger(input.anchorSequence) || input.anchorSequence < 1) throw new Error('v33_41_anchor_sequence_invalid'); if (input.checkpointBytes.byteLength === 0) throw new Error('v33_41_anchor_bytes_empty');
  if (input.executionClass === 'LIVE_EXTERNAL_PROVIDER_CONFORMANCE' && (!input.publicNetworkRetrievalObserved || !isPublicHttps(input.endpoint))) throw new Error('v33_41_external_anchor_requirements_missing');
  const material = { version: '33.41' as const, anchorId: `provider-anchor-${input.anchorSequence}`, previousAnchorDigest: input.previousAnchorDigest, anchorSequence: input.anchorSequence, priorV33_40VerdictDigest: input.priorV33_40Verdict.verdictDigest, trustRootSetDigest: sha256(sortedUnique(input.roots.map((r) => r.rootManifestDigest))), conformanceSetDigest: sha256(sortedUnique(input.conformanceReceipts.map((r) => r.receiptDigest))), revocationSnapshotDigest: input.revocationSnapshot.snapshotDigest, replacementCertificateDigest: input.replacementCertificate.certificateDigest, checkpointBytesDigest: sha256Bytes(input.checkpointBytes), endpoint: input.endpoint, publisher: input.publisher, publicNetworkRetrievalObserved: input.publicNetworkRetrievalObserved, publishedAt: input.publishedAt.toISOString(), executionClass: input.executionClass, publicationAuthorityKeyId: input.authority.keyId, productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const };
  return signEnvelope({ ...material, anchorDigest: sha256(material) }, input.authority);
}

export function createProviderCheckpointMonitorReceiptV33_41(input: {
  readonly monitor: SigningIdentity;
  readonly descriptor: QualificationActorDescriptorV33_36;
  readonly providerId: string;
  readonly anchor: ProviderCheckpointAnchorV33_41;
  readonly retrievedBytes: Uint8Array;
  readonly retrievedAt: Date;
  readonly networkClass: 'LOCAL_LOOPBACK' | 'INDEPENDENT_EXTERNAL';
}): SignedEnvelope<ProviderCheckpointMonitorReceiptV33_41> {
  assertDescriptor(input.descriptor, 'v33_41_monitor_descriptor_invalid'); if (sha256Bytes(input.retrievedBytes) !== input.anchor.checkpointBytesDigest) throw new Error('v33_41_monitor_bytes_mismatch');
  const material = { version: '33.41' as const, receiptId: `provider-monitor-${input.monitor.keyId}`, anchorDigest: input.anchor.anchorDigest, anchorSequence: input.anchor.anchorSequence, checkpointBytesDigest: input.anchor.checkpointBytesDigest, monitor: input.descriptor, providerId: input.providerId, retrievedAt: input.retrievedAt.toISOString(), durableWriteObserved: true as const, fsyncObserved: true as const, networkClass: input.networkClass, productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const };
  return signEnvelope({ ...material, receiptDigest: sha256(material) }, input.monitor);
}

export function verifyProviderCheckpointV33_41(input: {
  readonly anchor: SignedEnvelope<ProviderCheckpointAnchorV33_41>;
  readonly checkpointBytes: Uint8Array;
  readonly receipts: readonly SignedEnvelope<ProviderCheckpointMonitorReceiptV33_41>[];
  readonly priorV33_40Verdict: HsmInteroperabilityVerdictV33_40;
  readonly roots: readonly ProviderTrustRootManifestV33_41[];
  readonly conformanceReceipts: readonly ProviderConformanceReceiptV33_41[];
  readonly revocationSnapshot: AttestationRevocationSnapshotV33_41;
  readonly replacementCertificate: ProviderReplacementCertificateV33_41;
  readonly trust: ProviderOnboardingTrustV33_41;
  readonly verifiedAt: Date;
}): ProviderCheckpointAnchorV33_41 {
  const a = input.anchor.payload; verifyEnvelope(input.trust.publicationAuthorityRegistry, input.trust.trustedPublicationAuthorityIds, input.anchor, input.verifiedAt, 'v33_41_anchor_signature_invalid'); assertBoundary(a, 'v33_41_anchor_boundary_invalid'); assertDescriptor(a.publisher, 'v33_41_anchor_publisher_invalid');
  if (a.version !== '33.41' || a.publicationAuthorityKeyId !== input.anchor.issuerKeyId || a.anchorDigest !== digestWithout(a, 'anchorDigest') || a.priorV33_40VerdictDigest !== input.priorV33_40Verdict.verdictDigest || a.trustRootSetDigest !== sha256(sortedUnique(input.roots.map((r) => r.rootManifestDigest))) || a.conformanceSetDigest !== sha256(sortedUnique(input.conformanceReceipts.map((r) => r.receiptDigest))) || a.revocationSnapshotDigest !== input.revocationSnapshot.snapshotDigest || a.replacementCertificateDigest !== input.replacementCertificate.certificateDigest || sha256Bytes(input.checkpointBytes) !== a.checkpointBytesDigest) throw new Error('v33_41_anchor_binding_invalid');
  if (a.executionClass === 'LIVE_EXTERNAL_PROVIDER_CONFORMANCE' && (!a.publicNetworkRetrievalObserved || !isPublicHttps(a.endpoint))) throw new Error('v33_41_external_anchor_invalid');
  if (input.receipts.length < 3) throw new Error('v33_41_monitor_quorum_required'); const providers = new Set<string>(); const actors: QualificationActorDescriptorV33_36[] = [];
  for (const e of input.receipts) { const r = e.payload; verifyEnvelope(input.trust.monitorRegistry, input.trust.trustedMonitorIds, e, input.verifiedAt, 'v33_41_monitor_signature_invalid'); assertBoundary(r, 'v33_41_monitor_boundary_invalid'); assertDescriptor(r.monitor, 'v33_41_monitor_descriptor_invalid'); if (r.monitor.keyId !== e.issuerKeyId || r.receiptDigest !== digestWithout(r, 'receiptDigest') || r.anchorDigest !== a.anchorDigest || r.anchorSequence !== a.anchorSequence || r.checkpointBytesDigest !== a.checkpointBytesDigest || !r.durableWriteObserved || !r.fsyncObserved) throw new Error('v33_41_monitor_receipt_invalid'); providers.add(r.providerId); actors.push(r.monitor); }
  if (providers.size < 3 || !descriptorSeparated(actors)) throw new Error('v33_41_monitor_diversity_required'); if (a.executionClass === 'LIVE_EXTERNAL_PROVIDER_CONFORMANCE' && input.receipts.some((r) => r.payload.networkClass !== 'INDEPENDENT_EXTERNAL')) throw new Error('v33_41_external_monitor_network_required'); return a;
}

export function createProviderSiteRecoveryReceiptV33_41(input: {
  readonly verifier: SigningIdentity;
  readonly descriptor: QualificationActorDescriptorV33_36;
  readonly previousRecoveryDigest: string;
  readonly recoverySequence: number;
  readonly sourceSiteId: string;
  readonly targetSiteId: string;
  readonly sourceProviderId: string;
  readonly targetProviderId: string;
  readonly anchor: ProviderCheckpointAnchorV33_41;
  readonly replacementCertificate: ProviderReplacementCertificateV33_41;
  readonly restoredBytes: Uint8Array;
  readonly recoveredAt: Date;
  readonly executionClass: ProviderOnboardingExecutionClassV33_41;
}): SignedEnvelope<ProviderSiteRecoveryReceiptV33_41> {
  assertDescriptor(input.descriptor, 'v33_41_recovery_descriptor_invalid'); requireDigest(input.previousRecoveryDigest, 'v33_41_recovery_previous_invalid'); if (!Number.isSafeInteger(input.recoverySequence) || input.recoverySequence < 1) throw new Error('v33_41_recovery_sequence_invalid');
  if (input.sourceSiteId === input.targetSiteId || input.sourceProviderId === input.targetProviderId) throw new Error('v33_41_recovery_diversity_required'); if (sha256Bytes(input.restoredBytes) !== input.anchor.checkpointBytesDigest) throw new Error('v33_41_recovery_bytes_mismatch');
  const material = { version: '33.41' as const, recoveryId: `provider-recovery-${input.recoverySequence}`, previousRecoveryDigest: input.previousRecoveryDigest, recoverySequence: input.recoverySequence, sourceSiteId: input.sourceSiteId, targetSiteId: input.targetSiteId, sourceProviderId: input.sourceProviderId, targetProviderId: input.targetProviderId, anchorDigest: input.anchor.anchorDigest, replacementCertificateDigest: input.replacementCertificate.certificateDigest, restoredBytesDigest: sha256Bytes(input.restoredBytes), sequenceReset: false as const, forkDetected: false as const, verifier: input.descriptor, recoveredAt: input.recoveredAt.toISOString(), executionClass: input.executionClass, productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const };
  return signEnvelope({ ...material, recoveryDigest: sha256(material) }, input.verifier);
}

export function verifyProviderSiteRecoveryV33_41(input: {
  readonly receipt: SignedEnvelope<ProviderSiteRecoveryReceiptV33_41>;
  readonly anchor: ProviderCheckpointAnchorV33_41;
  readonly replacementCertificate: ProviderReplacementCertificateV33_41;
  readonly restoredBytes: Uint8Array;
  readonly trust: ProviderOnboardingTrustV33_41;
  readonly verifiedAt: Date;
}): ProviderSiteRecoveryReceiptV33_41 {
  const r = input.receipt.payload; verifyEnvelope(input.trust.recoveryVerifierRegistry, input.trust.trustedRecoveryVerifierIds, input.receipt, input.verifiedAt, 'v33_41_recovery_signature_invalid'); assertBoundary(r, 'v33_41_recovery_boundary_invalid'); assertDescriptor(r.verifier, 'v33_41_recovery_descriptor_invalid');
  if (r.version !== '33.41' || r.verifier.keyId !== input.receipt.issuerKeyId || r.recoveryDigest !== digestWithout(r, 'recoveryDigest') || r.anchorDigest !== input.anchor.anchorDigest || r.replacementCertificateDigest !== input.replacementCertificate.certificateDigest || r.restoredBytesDigest !== sha256Bytes(input.restoredBytes) || r.restoredBytesDigest !== input.anchor.checkpointBytesDigest || r.sequenceReset || r.forkDetected || r.sourceSiteId === r.targetSiteId || r.sourceProviderId === r.targetProviderId) throw new Error('v33_41_recovery_receipt_invalid'); return r;
}

export function verifyExternalProviderOnboardingQualificationV33_41(input: {
  readonly priorV33_40Verdict: HsmInteroperabilityVerdictV33_40;
  readonly roots: readonly SignedEnvelope<ProviderTrustRootManifestV33_41>[];
  readonly rootCertificateBytesByManifestDigest: ReadonlyMap<string, Uint8Array>;
  readonly manifests: readonly SignedEnvelope<SignedHsmAdapterManifestV33_40>[];
  readonly moduleBytesByManifestDigest: ReadonlyMap<string, Uint8Array>;
  readonly attestations: readonly SignedEnvelope<RemoteAttestationEvidenceV33_40>[];
  readonly conformanceReceipts: readonly SignedEnvelope<ProviderConformanceReceiptV33_41>[];
  readonly sessionNoncesByReceiptDigest: ReadonlyMap<string, Uint8Array>;
  readonly revocationSnapshot: SignedEnvelope<AttestationRevocationSnapshotV33_41>;
  readonly previousRevocationSnapshot?: AttestationRevocationSnapshotV33_41;
  readonly replacementCertificate: SignedEnvelope<ProviderReplacementCertificateV33_41>;
  readonly replacementApprovals: readonly SignedEnvelope<ProviderReplacementApprovalV33_41>[];
  readonly oldAttestation: RemoteAttestationEvidenceV33_40;
  readonly newTrustRoot: ProviderTrustRootManifestV33_41;
  readonly newConformanceReceipt: ProviderConformanceReceiptV33_41;
  readonly checkpointAnchor: SignedEnvelope<ProviderCheckpointAnchorV33_41>;
  readonly checkpointBytes: Uint8Array;
  readonly monitorReceipts: readonly SignedEnvelope<ProviderCheckpointMonitorReceiptV33_41>[];
  readonly siteRecoveryReceipt: SignedEnvelope<ProviderSiteRecoveryReceiptV33_41>;
  readonly restoredBytes: Uint8Array;
  readonly trust: ProviderOnboardingTrustV33_41;
  readonly verifiedAt: Date;
}): ExternalProviderOnboardingVerdictV33_41 {
  if (input.priorV33_40Verdict.productionAuthority !== 'NONE' || input.priorV33_40Verdict.externalEffectsExecuted !== 0 || input.priorV33_40Verdict.externalHumanParticipants !== 0) throw new Error('v33_41_prior_boundary_invalid');
  if (input.priorV33_40Verdict.version !== '33.40' || input.priorV33_40Verdict.verdictDigest !== digestWithout(input.priorV33_40Verdict, 'verdictDigest')) throw new Error('v33_41_prior_verdict_invalid');
  const roots = verifyProviderTrustRootsV33_41({ roots: input.roots, rootCertificateBytesByManifestDigest: input.rootCertificateBytesByManifestDigest, trust: input.trust, verifiedAt: input.verifiedAt });
  const conformance = verifyProviderConformanceReceiptsV33_41({ receipts: input.conformanceReceipts, roots, manifests: input.manifests, moduleBytesByManifestDigest: input.moduleBytesByManifestDigest, attestations: input.attestations, sessionNoncesByReceiptDigest: input.sessionNoncesByReceiptDigest, trust: input.trust, verifiedAt: input.verifiedAt });
  const revocation = verifyAttestationRevocationSnapshotV33_41({
    snapshot: input.revocationSnapshot,
    ...(input.previousRevocationSnapshot === undefined ? {} : { previousSnapshot: input.previousRevocationSnapshot }),
    roots,
    trust: input.trust,
    verifiedAt: input.verifiedAt,
  });
  const replacement = verifyProviderReplacementV33_41({ certificate: input.replacementCertificate, approvals: input.replacementApprovals, oldAttestation: input.oldAttestation, newTrustRoot: input.newTrustRoot, newConformanceReceipt: input.newConformanceReceipt, revocationSnapshot: revocation, trust: input.trust, verifiedAt: input.verifiedAt });
  const anchor = verifyProviderCheckpointV33_41({ anchor: input.checkpointAnchor, checkpointBytes: input.checkpointBytes, receipts: input.monitorReceipts, priorV33_40Verdict: input.priorV33_40Verdict, roots, conformanceReceipts: conformance, revocationSnapshot: revocation, replacementCertificate: replacement, trust: input.trust, verifiedAt: input.verifiedAt });
  const recovery = verifyProviderSiteRecoveryV33_41({ receipt: input.siteRecoveryReceipt, anchor, replacementCertificate: replacement, restoredBytes: input.restoredBytes, trust: input.trust, verifiedAt: input.verifiedAt });
  const externalTrustRootsObserved = roots.every((r) => r.executionClass === 'LIVE_EXTERNAL_PROVIDER_CONFORMANCE');
  const externalHardwareSessionsObserved = conformance.every((r) => r.executionClass === 'LIVE_EXTERNAL_PROVIDER_CONFORMANCE' && r.hardwareSessionObserved);
  const publicCheckpointObserved = anchor.executionClass === 'LIVE_EXTERNAL_PROVIDER_CONFORMANCE' && anchor.publicNetworkRetrievalObserved && input.monitorReceipts.every((r) => r.payload.networkClass === 'INDEPENDENT_EXTERNAL');
  const external = input.priorV33_40Verdict.status === 'EXTERNAL_MULTI_PROVIDER_INTEROP_EVIDENCE_ACCEPTED' && externalTrustRootsObserved && externalHardwareSessionsObserved && publicCheckpointObserved && recovery.executionClass === 'LIVE_EXTERNAL_PROVIDER_CONFORMANCE';
  const material = { version: '33.41' as const, priorV33_40VerdictDigest: input.priorV33_40Verdict.verdictDigest, trustRootCount: roots.length, conformanceReceiptCount: conformance.length, revocationSnapshotDigest: revocation.snapshotDigest, replacementCertificateDigest: replacement.certificateDigest, checkpointAnchorDigest: anchor.anchorDigest, monitorReceiptCount: input.monitorReceipts.length, siteRecoveryDigest: recovery.recoveryDigest, status: external ? 'EXTERNAL_PROVIDER_ONBOARDING_CONFORMANCE_ACCEPTED' as const : 'LOCAL_PROVIDER_ONBOARDING_CONFORMANCE_REHEARSAL_ONLY' as const, externalTrustRootsObserved, externalHardwareSessionsObserved, publicCheckpointObserved, externalHumanParticipants: 0 as const, verifiedAt: input.verifiedAt.toISOString(), productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const };
  return { ...material, verdictDigest: sha256(material) };
}
