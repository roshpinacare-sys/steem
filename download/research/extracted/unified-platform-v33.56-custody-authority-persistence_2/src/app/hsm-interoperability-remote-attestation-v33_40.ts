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
  ExternalCustodyHardwareQualificationVerdictV33_39,
  ThresholdOperationEvidenceV33_39,
} from './external-custody-hsm-threshold-recovery-v33_39.js';

export type HsmAdapterClassV33_40 =
  | 'SOFTWARE_REHEARSAL'
  | 'PKCS11_GENERIC'
  | 'AWS_CLOUDHSM'
  | 'AZURE_MANAGED_HSM'
  | 'GCP_CLOUD_HSM'
  | 'DEDICATED_NETWORK_HSM';

export type InteropExecutionClassV33_40 = 'LOCAL_INTEROP_REHEARSAL' | 'LIVE_EXTERNAL_MULTI_PROVIDER';

export interface SignedHsmAdapterManifestV33_40 {
  readonly version: '33.40';
  readonly adapterId: string;
  readonly adapterClass: HsmAdapterClassV33_40;
  readonly providerId: string;
  readonly moduleName: string;
  readonly moduleVersion: string;
  readonly moduleDigest: string;
  readonly interfaceStandard: 'PKCS11-3.1' | 'PROVIDER_NATIVE_SIGNING_API';
  readonly abi: 'linux-x64' | 'linux-arm64';
  readonly mechanisms: readonly ['CKM_EDDSA'];
  readonly keyOrigin: 'GENERATED_IN_HSM';
  readonly extractable: false;
  readonly privateKeyMaterialEnteredProcess: false;
  readonly failClosedOnProviderOutage: true;
  readonly conformanceVectorDigest: string;
  readonly signerKeyId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly executionClass: InteropExecutionClassV33_40;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly manifestDigest: string;
}

export interface RemoteAttestationEvidenceV33_40 {
  readonly version: '33.40';
  readonly evidenceId: string;
  readonly adapterManifestDigest: string;
  readonly roleKeyId: string;
  readonly roleKeyFingerprint: string;
  readonly providerId: string;
  readonly deviceId: string;
  readonly firmwareDigest: string;
  readonly attestationDocumentDigest: string;
  readonly challengeDigest: string;
  readonly nonceUnique: true;
  readonly keyOrigin: 'GENERATED_IN_HSM';
  readonly extractable: false;
  readonly verifiedBootObserved: true;
  readonly requestDigestBound: true;
  readonly attestationAuthorityKeyId: string;
  readonly observedAt: string;
  readonly expiresAt: string;
  readonly executionClass: InteropExecutionClassV33_40;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly evidenceDigest: string;
}

export interface MultiProviderCustodianApprovalV33_40 {
  readonly version: '33.40';
  readonly approvalId: string;
  readonly ceremonyDigest: string;
  readonly operationDigest: string;
  readonly shareIndex: number;
  readonly custodian: QualificationActorDescriptorV33_36;
  readonly providerId: string;
  readonly adapterManifestDigest: string;
  readonly remoteAttestationDigest: string;
  readonly approvedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly approvalDigest: string;
}

export interface MultiProviderThresholdCertificateV33_40 {
  readonly version: '33.40';
  readonly certificateId: string;
  readonly ceremonyDigest: string;
  readonly operationDigest: string;
  readonly thresholdSequence: number;
  readonly previousThresholdDigest: string;
  readonly threshold: 3;
  readonly configuredCustodianCount: 5;
  readonly distinctProviderCount: number;
  readonly distinctOrganizationCount: number;
  readonly approvalDigests: readonly string[];
  readonly providerIds: readonly string[];
  readonly custodianKeyIds: readonly string[];
  readonly authorityKeyId: string;
  readonly issuedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly certificateDigest: string;
}

export interface PublicInteroperabilityCheckpointV33_40 {
  readonly version: '33.40';
  readonly checkpointId: string;
  readonly previousCheckpointDigest: string;
  readonly checkpointSequence: number;
  readonly priorV33_39VerdictDigest: string;
  readonly thresholdCertificateDigest: string;
  readonly adapterSetDigest: string;
  readonly remoteAttestationSetDigest: string;
  readonly endpoint: string;
  readonly dnsName: string;
  readonly checkpointBytesDigest: string;
  readonly publisher: QualificationActorDescriptorV33_36;
  readonly publishedAt: string;
  readonly executionClass: InteropExecutionClassV33_40;
  readonly publicNetworkRetrievalObserved: boolean;
  readonly publicationAuthorityKeyId: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly checkpointDigest: string;
}

export interface InteroperabilityMonitorReceiptV33_40 {
  readonly version: '33.40';
  readonly receiptId: string;
  readonly checkpointDigest: string;
  readonly checkpointSequence: number;
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

export interface CrossSiteRecoveryReceiptV33_40 {
  readonly version: '33.40';
  readonly recoveryId: string;
  readonly priorRecoveryDigest: string;
  readonly sourceSiteId: string;
  readonly targetSiteId: string;
  readonly sourceProviderId: string;
  readonly targetProviderId: string;
  readonly checkpointDigest: string;
  readonly checkpointSequence: number;
  readonly restoredBytesDigest: string;
  readonly thresholdCertificateDigest: string;
  readonly recoverySequence: number;
  readonly sequenceReset: false;
  readonly forkDetected: false;
  readonly recoveryVerifier: QualificationActorDescriptorV33_36;
  readonly recoveredAt: string;
  readonly executionClass: InteropExecutionClassV33_40;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly recoveryDigest: string;
}

export interface HsmInteroperabilityVerdictV33_40 {
  readonly version: '33.40';
  readonly priorV33_39VerdictDigest: string;
  readonly adapterManifestCount: number;
  readonly providerCount: number;
  readonly remoteAttestationCount: number;
  readonly thresholdCertificateDigest: string;
  readonly checkpointDigest: string;
  readonly monitorReceiptCount: number;
  readonly crossSiteRecoveryDigest: string;
  readonly status: 'LOCAL_MULTI_PROVIDER_INTEROP_REHEARSAL_ONLY' | 'EXTERNAL_MULTI_PROVIDER_INTEROP_EVIDENCE_ACCEPTED';
  readonly externalTopologyObserved: boolean;
  readonly externalHardwareObserved: boolean;
  readonly externalHumanParticipants: 0;
  readonly verifiedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly verdictDigest: string;
}

export interface InteroperabilityTrustV33_40 {
  readonly adapterSignerRegistry: KeyRegistry;
  readonly trustedAdapterSignerIds: readonly string[];
  readonly attestationAuthorityRegistry: KeyRegistry;
  readonly trustedAttestationAuthorityIds: readonly string[];
  readonly custodianRegistry: KeyRegistry;
  readonly trustedCustodianIds: readonly string[];
  readonly thresholdAuthorityRegistry: KeyRegistry;
  readonly trustedThresholdAuthorityIds: readonly string[];
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
  return ['keyId', 'organizationId', 'hostId', 'administratorId'].every((field) => new Set(rows.map((r) => r[field as keyof QualificationActorDescriptorV33_36])).size === rows.length);
}
function verifyEnvelope<T>(registry: KeyRegistry, trusted: readonly string[], envelope: SignedEnvelope<T>, at: Date, code: string): void {
  if (!trusted.includes(envelope.issuerKeyId) || !registry.verifyAt(envelope, at)) throw new Error(code);
}
function isPublicDns(name: string): boolean {
  const v = name.toLowerCase();
  return v.includes('.') && !v.endsWith('.local') && !v.endsWith('.invalid') && v !== 'localhost' && !/^\d+\.\d+\.\d+\.\d+$/.test(v);
}

export function createSignedHsmAdapterManifestV33_40(input: {
  readonly signer: SigningIdentity;
  readonly adapterClass: HsmAdapterClassV33_40;
  readonly providerId: string;
  readonly moduleName: string;
  readonly moduleVersion: string;
  readonly moduleBytes: Uint8Array;
  readonly interfaceStandard: 'PKCS11-3.1' | 'PROVIDER_NATIVE_SIGNING_API';
  readonly abi: 'linux-x64' | 'linux-arm64';
  readonly conformanceVectorDigest: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly executionClass: InteropExecutionClassV33_40;
}): SignedEnvelope<SignedHsmAdapterManifestV33_40> {
  [input.providerId, input.moduleName, input.moduleVersion].forEach((v) => requireText(v, 'v33_40_adapter_text_invalid'));
  requireDigest(input.conformanceVectorDigest, 'v33_40_adapter_conformance_invalid');
  requireDate(input.issuedAt, 'v33_40_adapter_time_invalid'); requireDate(input.expiresAt, 'v33_40_adapter_time_invalid');
  if (input.expiresAt <= input.issuedAt) throw new Error('v33_40_adapter_expiry_invalid');
  if (input.adapterClass === 'PKCS11_GENERIC' && input.interfaceStandard !== 'PKCS11-3.1') throw new Error('v33_40_pkcs11_interface_invalid');
  if (input.executionClass === 'LIVE_EXTERNAL_MULTI_PROVIDER' && input.adapterClass === 'SOFTWARE_REHEARSAL') throw new Error('v33_40_external_software_adapter_forbidden');
  const material = {
    version: '33.40' as const, adapterId: randomUUID(), adapterClass: input.adapterClass, providerId: input.providerId,
    moduleName: input.moduleName, moduleVersion: input.moduleVersion, moduleDigest: sha256Bytes(input.moduleBytes),
    interfaceStandard: input.interfaceStandard, abi: input.abi, mechanisms: ['CKM_EDDSA'] as const,
    keyOrigin: 'GENERATED_IN_HSM' as const, extractable: false as const, privateKeyMaterialEnteredProcess: false as const,
    failClosedOnProviderOutage: true as const, conformanceVectorDigest: input.conformanceVectorDigest,
    signerKeyId: input.signer.keyId, issuedAt: input.issuedAt.toISOString(), expiresAt: input.expiresAt.toISOString(),
    executionClass: input.executionClass, productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, manifestDigest: sha256(material) }, input.signer);
}

export function verifyAdapterManifestsV33_40(input: {
  readonly manifests: readonly SignedEnvelope<SignedHsmAdapterManifestV33_40>[];
  readonly moduleBytesByManifestDigest: ReadonlyMap<string, Uint8Array>;
  readonly trust: InteroperabilityTrustV33_40;
  readonly verifiedAt: Date;
}): { readonly providerCount: number; readonly externalAdaptersObserved: boolean } {
  if (input.manifests.length < 3) throw new Error('v33_40_adapter_count_invalid');
  const providers = new Set<string>(); const classes = new Set<string>();
  for (const env of input.manifests) {
    const row = env.payload;
    verifyEnvelope(input.trust.adapterSignerRegistry, input.trust.trustedAdapterSignerIds, env, input.verifiedAt, 'v33_40_adapter_signature_invalid');
    if (row.signerKeyId !== env.issuerKeyId || row.manifestDigest !== digestWithout(row, 'manifestDigest')) throw new Error('v33_40_adapter_binding_invalid');
    if (Date.parse(row.issuedAt) > input.verifiedAt.getTime() || Date.parse(row.expiresAt) < input.verifiedAt.getTime()) throw new Error('v33_40_adapter_inactive');
    const bytes = input.moduleBytesByManifestDigest.get(row.manifestDigest);
    if (bytes === undefined || sha256Bytes(bytes) !== row.moduleDigest) throw new Error('v33_40_adapter_module_digest_invalid');
    if (row.mechanisms.length !== 1 || row.mechanisms[0] !== 'CKM_EDDSA' || row.extractable !== false || row.privateKeyMaterialEnteredProcess !== false || row.failClosedOnProviderOutage !== true) throw new Error('v33_40_adapter_controls_invalid');
    if (row.adapterClass === 'PKCS11_GENERIC' && row.interfaceStandard !== 'PKCS11-3.1') throw new Error('v33_40_pkcs11_interface_invalid');
    assertBoundary(row, 'v33_40_adapter_boundary_invalid'); providers.add(row.providerId); classes.add(row.adapterClass);
  }
  if (providers.size < 3 || classes.size < 3) throw new Error('v33_40_adapter_diversity_invalid');
  const external = input.manifests.every((e) => e.payload.executionClass === 'LIVE_EXTERNAL_MULTI_PROVIDER' && e.payload.adapterClass !== 'SOFTWARE_REHEARSAL');
  return { providerCount: providers.size, externalAdaptersObserved: external };
}

export function createRemoteAttestationEvidenceV33_40(input: {
  readonly authority: SigningIdentity;
  readonly adapterManifest: SignedHsmAdapterManifestV33_40;
  readonly roleKeyId: string;
  readonly roleKeyFingerprint: string;
  readonly deviceId: string;
  readonly firmwareDigest: string;
  readonly attestationDocument: Uint8Array;
  readonly challenge: Uint8Array;
  readonly observedAt: Date;
  readonly expiresAt: Date;
  readonly executionClass: InteropExecutionClassV33_40;
}): SignedEnvelope<RemoteAttestationEvidenceV33_40> {
  requireDigest(input.roleKeyFingerprint, 'v33_40_role_fingerprint_invalid'); requireDigest(input.firmwareDigest, 'v33_40_firmware_digest_invalid');
  requireText(input.roleKeyId, 'v33_40_role_key_invalid'); requireText(input.deviceId, 'v33_40_device_invalid');
  if (input.expiresAt <= input.observedAt) throw new Error('v33_40_attestation_expiry_invalid');
  const material = {
    version: '33.40' as const, evidenceId: randomUUID(), adapterManifestDigest: input.adapterManifest.manifestDigest,
    roleKeyId: input.roleKeyId, roleKeyFingerprint: input.roleKeyFingerprint, providerId: input.adapterManifest.providerId,
    deviceId: input.deviceId, firmwareDigest: input.firmwareDigest, attestationDocumentDigest: sha256Bytes(input.attestationDocument),
    challengeDigest: sha256Bytes(input.challenge), nonceUnique: true as const, keyOrigin: 'GENERATED_IN_HSM' as const,
    extractable: false as const, verifiedBootObserved: true as const, requestDigestBound: true as const,
    attestationAuthorityKeyId: input.authority.keyId, observedAt: input.observedAt.toISOString(), expiresAt: input.expiresAt.toISOString(),
    executionClass: input.executionClass, productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, evidenceDigest: sha256(material) }, input.authority);
}

export function verifyRemoteAttestationsV33_40(input: {
  readonly attestations: readonly SignedEnvelope<RemoteAttestationEvidenceV33_40>[];
  readonly manifests: readonly SignedEnvelope<SignedHsmAdapterManifestV33_40>[];
  readonly documentsByEvidenceDigest: ReadonlyMap<string, Uint8Array>;
  readonly challengesByEvidenceDigest: ReadonlyMap<string, Uint8Array>;
  readonly trust: InteroperabilityTrustV33_40;
  readonly verifiedAt: Date;
}): { readonly providerCount: number; readonly externalHardwareObserved: boolean } {
  if (input.attestations.length < 5) throw new Error('v33_40_attestation_count_invalid');
  const manifestByDigest = new Map(input.manifests.map((m) => [m.payload.manifestDigest, m.payload]));
  const roleKeys = new Set<string>(); const devices = new Set<string>(); const providers = new Set<string>();
  for (const env of input.attestations) {
    const row = env.payload;
    verifyEnvelope(input.trust.attestationAuthorityRegistry, input.trust.trustedAttestationAuthorityIds, env, input.verifiedAt, 'v33_40_attestation_signature_invalid');
    if (row.attestationAuthorityKeyId !== env.issuerKeyId || row.evidenceDigest !== digestWithout(row, 'evidenceDigest')) throw new Error('v33_40_attestation_binding_invalid');
    if (Date.parse(row.observedAt) > input.verifiedAt.getTime() || Date.parse(row.expiresAt) < input.verifiedAt.getTime()) throw new Error('v33_40_attestation_inactive');
    const manifest = manifestByDigest.get(row.adapterManifestDigest);
    if (manifest === undefined || manifest.providerId !== row.providerId) throw new Error('v33_40_attestation_adapter_binding_invalid');
    const doc = input.documentsByEvidenceDigest.get(row.evidenceDigest); const challenge = input.challengesByEvidenceDigest.get(row.evidenceDigest);
    if (doc === undefined || sha256Bytes(doc) !== row.attestationDocumentDigest || challenge === undefined || sha256Bytes(challenge) !== row.challengeDigest) throw new Error('v33_40_attestation_bytes_invalid');
    if (row.keyOrigin !== 'GENERATED_IN_HSM' || row.extractable !== false || row.verifiedBootObserved !== true || row.requestDigestBound !== true || row.nonceUnique !== true) throw new Error('v33_40_attestation_controls_invalid');
    if (roleKeys.has(row.roleKeyId) || devices.has(row.deviceId)) throw new Error('v33_40_attestation_reuse_invalid');
    roleKeys.add(row.roleKeyId); devices.add(row.deviceId); providers.add(row.providerId); assertBoundary(row, 'v33_40_attestation_boundary_invalid');
  }
  if (providers.size < 3) throw new Error('v33_40_attestation_provider_diversity_invalid');
  return { providerCount: providers.size, externalHardwareObserved: input.attestations.every((a) => a.payload.executionClass === 'LIVE_EXTERNAL_MULTI_PROVIDER') };
}

export function createMultiProviderCustodianApprovalV33_40(input: {
  readonly custodian: SigningIdentity;
  readonly descriptor: QualificationActorDescriptorV33_36;
  readonly ceremonyDigest: string;
  readonly operationDigest: string;
  readonly shareIndex: number;
  readonly providerId: string;
  readonly adapterManifestDigest: string;
  readonly remoteAttestationDigest: string;
  readonly approvedAt: Date;
}): SignedEnvelope<MultiProviderCustodianApprovalV33_40> {
  [input.ceremonyDigest, input.operationDigest, input.adapterManifestDigest, input.remoteAttestationDigest].forEach((d) => requireDigest(d, 'v33_40_approval_digest_invalid'));
  assertDescriptor(input.descriptor, 'v33_40_custodian_descriptor_invalid');
  if (input.custodian.keyId !== input.descriptor.keyId || !Number.isInteger(input.shareIndex) || input.shareIndex < 1 || input.shareIndex > 5) throw new Error('v33_40_share_invalid');
  const material = { version: '33.40' as const, approvalId: randomUUID(), ceremonyDigest: input.ceremonyDigest, operationDigest: input.operationDigest,
    shareIndex: input.shareIndex, custodian: input.descriptor, providerId: input.providerId, adapterManifestDigest: input.adapterManifestDigest,
    remoteAttestationDigest: input.remoteAttestationDigest, approvedAt: input.approvedAt.toISOString(), productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const };
  return signEnvelope({ ...material, approvalDigest: sha256(material) }, input.custodian);
}

export function finalizeMultiProviderThresholdV33_40(input: {
  readonly authority: SigningIdentity;
  readonly ceremonyDigest: string;
  readonly operationDigest: string;
  readonly thresholdSequence: number;
  readonly previousThresholdDigest: string;
  readonly approvals: readonly SignedEnvelope<MultiProviderCustodianApprovalV33_40>[];
  readonly trust: InteroperabilityTrustV33_40;
  readonly issuedAt: Date;
}): SignedEnvelope<MultiProviderThresholdCertificateV33_40> {
  if (input.approvals.length < 3 || input.approvals.length > 5) throw new Error('v33_40_threshold_quorum_invalid');
  if (!Number.isInteger(input.thresholdSequence) || input.thresholdSequence < 1) throw new Error('v33_40_threshold_sequence_invalid');
  [input.ceremonyDigest, input.operationDigest, input.previousThresholdDigest].forEach((d) => requireDigest(d, 'v33_40_threshold_digest_invalid'));
  const custodians: QualificationActorDescriptorV33_36[] = []; const providers = new Set<string>(); const shares = new Set<number>();
  for (const env of input.approvals) {
    const row = env.payload;
    verifyEnvelope(input.trust.custodianRegistry, input.trust.trustedCustodianIds, env, input.issuedAt, 'v33_40_custodian_signature_invalid');
    if (row.custodian.keyId !== env.issuerKeyId || row.approvalDigest !== digestWithout(row, 'approvalDigest') || row.ceremonyDigest !== input.ceremonyDigest || row.operationDigest !== input.operationDigest) throw new Error('v33_40_approval_binding_invalid');
    if (input.trust.custodianRegistry.fingerprint(row.custodian.keyId) !== row.custodian.keyFingerprint) throw new Error('v33_40_custodian_fingerprint_invalid');
    if (shares.has(row.shareIndex)) throw new Error('v33_40_duplicate_share'); shares.add(row.shareIndex); providers.add(row.providerId); custodians.push(row.custodian);
  }
  if (providers.size < 3 || !descriptorSeparated(custodians)) throw new Error('v33_40_threshold_diversity_invalid');
  const material = { version: '33.40' as const, certificateId: randomUUID(), ceremonyDigest: input.ceremonyDigest, operationDigest: input.operationDigest,
    thresholdSequence: input.thresholdSequence, previousThresholdDigest: input.previousThresholdDigest, threshold: 3 as const, configuredCustodianCount: 5 as const,
    distinctProviderCount: providers.size, distinctOrganizationCount: new Set(custodians.map((c) => c.organizationId)).size,
    approvalDigests: input.approvals.map((a) => a.payload.approvalDigest).sort(), providerIds: [...providers].sort(), custodianKeyIds: custodians.map((c) => c.keyId).sort(),
    authorityKeyId: input.authority.keyId, issuedAt: input.issuedAt.toISOString(), productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const };
  return signEnvelope({ ...material, certificateDigest: sha256(material) }, input.authority);
}

export function verifyMultiProviderThresholdV33_40(input: {
  readonly evidence: { readonly approvals: readonly SignedEnvelope<MultiProviderCustodianApprovalV33_40>[]; readonly certificate: SignedEnvelope<MultiProviderThresholdCertificateV33_40> };
  readonly trust: InteroperabilityTrustV33_40;
  readonly verifiedAt: Date;
}): MultiProviderThresholdCertificateV33_40 {
  const cert = input.evidence.certificate.payload;
  verifyEnvelope(input.trust.thresholdAuthorityRegistry, input.trust.trustedThresholdAuthorityIds, input.evidence.certificate, input.verifiedAt, 'v33_40_threshold_signature_invalid');
  if (cert.authorityKeyId !== input.evidence.certificate.issuerKeyId || cert.certificateDigest !== digestWithout(cert, 'certificateDigest')) throw new Error('v33_40_threshold_binding_invalid');
  if (input.evidence.approvals.length < 3 || input.evidence.approvals.length > 5) throw new Error('v33_40_threshold_quorum_invalid');
  const custodians: QualificationActorDescriptorV33_36[] = []; const providers = new Set<string>(); const shares = new Set<number>();
  for (const env of input.evidence.approvals) {
    const row = env.payload;
    verifyEnvelope(input.trust.custodianRegistry, input.trust.trustedCustodianIds, env, input.verifiedAt, 'v33_40_custodian_signature_invalid');
    if (row.custodian.keyId !== env.issuerKeyId || row.approvalDigest !== digestWithout(row, 'approvalDigest') || row.ceremonyDigest !== cert.ceremonyDigest || row.operationDigest !== cert.operationDigest) throw new Error('v33_40_approval_binding_invalid');
    if (input.trust.custodianRegistry.fingerprint(row.custodian.keyId) !== row.custodian.keyFingerprint) throw new Error('v33_40_custodian_fingerprint_invalid');
    if (shares.has(row.shareIndex)) throw new Error('v33_40_duplicate_share');
    shares.add(row.shareIndex); providers.add(row.providerId); custodians.push(row.custodian);
  }
  if (providers.size < 3 || !descriptorSeparated(custodians)) throw new Error('v33_40_threshold_diversity_invalid');
  const expectedApprovals = input.evidence.approvals.map((a) => a.payload.approvalDigest).sort();
  const expectedProviders = [...providers].sort();
  const expectedKeys = custodians.map((c) => c.keyId).sort();
  if (sha256(cert.approvalDigests) !== sha256(expectedApprovals) || sha256(cert.providerIds) !== sha256(expectedProviders) || sha256(cert.custodianKeyIds) !== sha256(expectedKeys)) throw new Error('v33_40_threshold_evidence_set_invalid');
  if (cert.threshold !== 3 || cert.configuredCustodianCount !== 5 || cert.distinctProviderCount !== providers.size || cert.distinctOrganizationCount !== new Set(custodians.map((c) => c.organizationId)).size) throw new Error('v33_40_threshold_cardinality_invalid');
  assertBoundary(cert, 'v33_40_threshold_boundary_invalid');
  return cert;
}

export function createPublicInteroperabilityCheckpointV33_40(input: {
  readonly authority: SigningIdentity;
  readonly priorV33_39Verdict: ExternalCustodyHardwareQualificationVerdictV33_39;
  readonly thresholdCertificate: MultiProviderThresholdCertificateV33_40;
  readonly adapterManifestDigests: readonly string[];
  readonly remoteAttestationDigests: readonly string[];
  readonly previousCheckpointDigest: string;
  readonly checkpointSequence: number;
  readonly endpoint: string;
  readonly dnsName: string;
  readonly checkpointBytes: Uint8Array;
  readonly publisher: QualificationActorDescriptorV33_36;
  readonly publishedAt: Date;
  readonly executionClass: InteropExecutionClassV33_40;
  readonly publicNetworkRetrievalObserved: boolean;
}): SignedEnvelope<PublicInteroperabilityCheckpointV33_40> {
  if (input.checkpointSequence < 1 || !Number.isInteger(input.checkpointSequence)) throw new Error('v33_40_checkpoint_sequence_invalid');
  requireDigest(input.previousCheckpointDigest, 'v33_40_checkpoint_predecessor_invalid'); assertDescriptor(input.publisher, 'v33_40_publisher_invalid');
  if (!input.endpoint.startsWith('https://') || !isPublicDns(input.dnsName) && input.executionClass === 'LIVE_EXTERNAL_MULTI_PROVIDER') throw new Error('v33_40_checkpoint_endpoint_invalid');
  if (input.executionClass === 'LIVE_EXTERNAL_MULTI_PROVIDER' && !input.publicNetworkRetrievalObserved) throw new Error('v33_40_external_retrieval_required');
  const material = { version: '33.40' as const, checkpointId: randomUUID(), previousCheckpointDigest: input.previousCheckpointDigest,
    checkpointSequence: input.checkpointSequence, priorV33_39VerdictDigest: input.priorV33_39Verdict.verdictDigest,
    thresholdCertificateDigest: input.thresholdCertificate.certificateDigest, adapterSetDigest: sha256([...input.adapterManifestDigests].sort()),
    remoteAttestationSetDigest: sha256([...input.remoteAttestationDigests].sort()), endpoint: input.endpoint, dnsName: input.dnsName,
    checkpointBytesDigest: sha256Bytes(input.checkpointBytes), publisher: input.publisher, publishedAt: input.publishedAt.toISOString(),
    executionClass: input.executionClass, publicNetworkRetrievalObserved: input.publicNetworkRetrievalObserved,
    publicationAuthorityKeyId: input.authority.keyId, productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const };
  return signEnvelope({ ...material, checkpointDigest: sha256(material) }, input.authority);
}

export function createInteroperabilityMonitorReceiptV33_40(input: {
  readonly monitor: SigningIdentity;
  readonly descriptor: QualificationActorDescriptorV33_36;
  readonly providerId: string;
  readonly checkpoint: PublicInteroperabilityCheckpointV33_40;
  readonly retrievedBytes: Uint8Array;
  readonly retrievedAt: Date;
  readonly networkClass: 'LOCAL_LOOPBACK' | 'INDEPENDENT_EXTERNAL';
}): SignedEnvelope<InteroperabilityMonitorReceiptV33_40> {
  if (sha256Bytes(input.retrievedBytes) !== input.checkpoint.checkpointBytesDigest) throw new Error('v33_40_monitor_bytes_invalid');
  if (input.monitor.keyId !== input.descriptor.keyId) throw new Error('v33_40_monitor_identity_invalid');
  const material = { version: '33.40' as const, receiptId: randomUUID(), checkpointDigest: input.checkpoint.checkpointDigest,
    checkpointSequence: input.checkpoint.checkpointSequence, checkpointBytesDigest: input.checkpoint.checkpointBytesDigest, monitor: input.descriptor,
    providerId: input.providerId, retrievedAt: input.retrievedAt.toISOString(), durableWriteObserved: true as const, fsyncObserved: true as const,
    networkClass: input.networkClass, productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const };
  return signEnvelope({ ...material, receiptDigest: sha256(material) }, input.monitor);
}

export function verifyCheckpointAndReceiptsV33_40(input: {
  readonly checkpoint: SignedEnvelope<PublicInteroperabilityCheckpointV33_40>;
  readonly checkpointBytes: Uint8Array;
  readonly receipts: readonly SignedEnvelope<InteroperabilityMonitorReceiptV33_40>[];
  readonly trust: InteroperabilityTrustV33_40;
  readonly verifiedAt: Date;
}): { readonly externalTopologyObserved: boolean } {
  const cp = input.checkpoint.payload;
  verifyEnvelope(input.trust.publicationAuthorityRegistry, input.trust.trustedPublicationAuthorityIds, input.checkpoint, input.verifiedAt, 'v33_40_checkpoint_signature_invalid');
  if (cp.publicationAuthorityKeyId !== input.checkpoint.issuerKeyId || cp.checkpointDigest !== digestWithout(cp, 'checkpointDigest') || sha256Bytes(input.checkpointBytes) !== cp.checkpointBytesDigest) throw new Error('v33_40_checkpoint_binding_invalid');
  if (input.receipts.length < 3) throw new Error('v33_40_monitor_quorum_invalid');
  const descriptors: QualificationActorDescriptorV33_36[] = []; const providers = new Set<string>();
  for (const env of input.receipts) {
    const r = env.payload;
    verifyEnvelope(input.trust.monitorRegistry, input.trust.trustedMonitorIds, env, input.verifiedAt, 'v33_40_monitor_signature_invalid');
    if (r.monitor.keyId !== env.issuerKeyId || r.receiptDigest !== digestWithout(r, 'receiptDigest') || r.checkpointDigest !== cp.checkpointDigest || r.checkpointSequence !== cp.checkpointSequence || r.checkpointBytesDigest !== cp.checkpointBytesDigest) throw new Error('v33_40_monitor_binding_invalid');
    if (input.trust.monitorRegistry.fingerprint(r.monitor.keyId) !== r.monitor.keyFingerprint) throw new Error('v33_40_monitor_fingerprint_invalid');
    descriptors.push(r.monitor); providers.add(r.providerId); assertBoundary(r, 'v33_40_monitor_boundary_invalid');
  }
  if (!descriptorSeparated(descriptors) || providers.size < 3) throw new Error('v33_40_monitor_diversity_invalid');
  const external = cp.executionClass === 'LIVE_EXTERNAL_MULTI_PROVIDER' && cp.publicNetworkRetrievalObserved && input.receipts.every((r) => r.payload.networkClass === 'INDEPENDENT_EXTERNAL');
  return { externalTopologyObserved: external };
}

export function createCrossSiteRecoveryReceiptV33_40(input: {
  readonly verifier: SigningIdentity;
  readonly descriptor: QualificationActorDescriptorV33_36;
  readonly priorRecoveryDigest: string;
  readonly sourceSiteId: string;
  readonly targetSiteId: string;
  readonly sourceProviderId: string;
  readonly targetProviderId: string;
  readonly checkpoint: PublicInteroperabilityCheckpointV33_40;
  readonly restoredBytes: Uint8Array;
  readonly thresholdCertificateDigest: string;
  readonly recoverySequence: number;
  readonly recoveredAt: Date;
  readonly executionClass: InteropExecutionClassV33_40;
}): SignedEnvelope<CrossSiteRecoveryReceiptV33_40> {
  if (input.sourceSiteId === input.targetSiteId || input.sourceProviderId === input.targetProviderId) throw new Error('v33_40_recovery_site_separation_invalid');
  requireDigest(input.priorRecoveryDigest, 'v33_40_recovery_predecessor_invalid'); requireDigest(input.thresholdCertificateDigest, 'v33_40_recovery_threshold_invalid');
  if (input.recoverySequence < 1 || !Number.isInteger(input.recoverySequence) || sha256Bytes(input.restoredBytes) !== input.checkpoint.checkpointBytesDigest) throw new Error('v33_40_recovery_continuity_invalid');
  const material = { version: '33.40' as const, recoveryId: randomUUID(), priorRecoveryDigest: input.priorRecoveryDigest,
    sourceSiteId: input.sourceSiteId, targetSiteId: input.targetSiteId, sourceProviderId: input.sourceProviderId, targetProviderId: input.targetProviderId,
    checkpointDigest: input.checkpoint.checkpointDigest, checkpointSequence: input.checkpoint.checkpointSequence,
    restoredBytesDigest: sha256Bytes(input.restoredBytes), thresholdCertificateDigest: input.thresholdCertificateDigest, recoverySequence: input.recoverySequence,
    sequenceReset: false as const, forkDetected: false as const, recoveryVerifier: input.descriptor, recoveredAt: input.recoveredAt.toISOString(),
    executionClass: input.executionClass, productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const };
  return signEnvelope({ ...material, recoveryDigest: sha256(material) }, input.verifier);
}

export function verifyCrossSiteRecoveryV33_40(input: {
  readonly receipt: SignedEnvelope<CrossSiteRecoveryReceiptV33_40>;
  readonly checkpoint: PublicInteroperabilityCheckpointV33_40;
  readonly restoredBytes: Uint8Array;
  readonly trust: InteroperabilityTrustV33_40;
  readonly verifiedAt: Date;
}): CrossSiteRecoveryReceiptV33_40 {
  const r = input.receipt.payload;
  verifyEnvelope(input.trust.recoveryVerifierRegistry, input.trust.trustedRecoveryVerifierIds, input.receipt, input.verifiedAt, 'v33_40_recovery_signature_invalid');
  if (r.recoveryVerifier.keyId !== input.receipt.issuerKeyId || r.recoveryDigest !== digestWithout(r, 'recoveryDigest') || r.checkpointDigest !== input.checkpoint.checkpointDigest || r.checkpointSequence !== input.checkpoint.checkpointSequence || sha256Bytes(input.restoredBytes) !== r.restoredBytesDigest || r.restoredBytesDigest !== input.checkpoint.checkpointBytesDigest) throw new Error('v33_40_recovery_binding_invalid');
  if (r.sourceSiteId === r.targetSiteId || r.sourceProviderId === r.targetProviderId || r.sequenceReset !== false || r.forkDetected !== false) throw new Error('v33_40_recovery_continuity_invalid');
  assertBoundary(r, 'v33_40_recovery_boundary_invalid'); return r;
}

export function verifyHsmInteroperabilityQualificationV33_40(input: {
  readonly priorV33_39Verdict: ExternalCustodyHardwareQualificationVerdictV33_39;
  readonly priorV33_39ThresholdEvidence: readonly ThresholdOperationEvidenceV33_39[];
  readonly manifests: readonly SignedEnvelope<SignedHsmAdapterManifestV33_40>[];
  readonly moduleBytesByManifestDigest: ReadonlyMap<string, Uint8Array>;
  readonly attestations: readonly SignedEnvelope<RemoteAttestationEvidenceV33_40>[];
  readonly documentsByEvidenceDigest: ReadonlyMap<string, Uint8Array>;
  readonly challengesByEvidenceDigest: ReadonlyMap<string, Uint8Array>;
  readonly thresholdEvidence: { readonly approvals: readonly SignedEnvelope<MultiProviderCustodianApprovalV33_40>[]; readonly certificate: SignedEnvelope<MultiProviderThresholdCertificateV33_40> };
  readonly checkpoint: SignedEnvelope<PublicInteroperabilityCheckpointV33_40>;
  readonly checkpointBytes: Uint8Array;
  readonly monitorReceipts: readonly SignedEnvelope<InteroperabilityMonitorReceiptV33_40>[];
  readonly recoveryReceipt: SignedEnvelope<CrossSiteRecoveryReceiptV33_40>;
  readonly restoredBytes: Uint8Array;
  readonly trust: InteroperabilityTrustV33_40;
  readonly verifiedAt: Date;
}): HsmInteroperabilityVerdictV33_40 {
  if (input.priorV33_39Verdict.productionAuthority !== 'NONE' || input.priorV33_39Verdict.externalEffectsExecuted !== 0 || input.priorV33_39Verdict.externalHumanParticipants !== 0) throw new Error('v33_40_prior_boundary_invalid');
  const priorExternal = input.priorV33_39Verdict.status === 'EXTERNAL_HSM_THRESHOLD_RECOVERY_EVIDENCE_ACCEPTED';
  if (input.priorV33_39Verdict.externalHardwareObserved !== priorExternal || input.priorV33_39Verdict.externalTopologyObserved !== priorExternal) throw new Error('v33_40_prior_status_binding_invalid');
  if (input.priorV33_39ThresholdEvidence.length !== 3 || input.priorV33_39Verdict.thresholdHeadDigest !== input.priorV33_39ThresholdEvidence[2]?.certificate.payload.thresholdDigest) throw new Error('v33_40_prior_threshold_chain_invalid');
  const adapters = verifyAdapterManifestsV33_40({ manifests: input.manifests, moduleBytesByManifestDigest: input.moduleBytesByManifestDigest, trust: input.trust, verifiedAt: input.verifiedAt });
  const attestations = verifyRemoteAttestationsV33_40({ attestations: input.attestations, manifests: input.manifests, documentsByEvidenceDigest: input.documentsByEvidenceDigest, challengesByEvidenceDigest: input.challengesByEvidenceDigest, trust: input.trust, verifiedAt: input.verifiedAt });
  const threshold = verifyMultiProviderThresholdV33_40({ evidence: input.thresholdEvidence, trust: input.trust, verifiedAt: input.verifiedAt });
  if (input.checkpoint.payload.priorV33_39VerdictDigest !== input.priorV33_39Verdict.verdictDigest || input.checkpoint.payload.thresholdCertificateDigest !== threshold.certificateDigest) throw new Error('v33_40_checkpoint_prior_binding_invalid');
  const checkpoint = verifyCheckpointAndReceiptsV33_40({ checkpoint: input.checkpoint, checkpointBytes: input.checkpointBytes, receipts: input.monitorReceipts, trust: input.trust, verifiedAt: input.verifiedAt });
  const recovery = verifyCrossSiteRecoveryV33_40({ receipt: input.recoveryReceipt, checkpoint: input.checkpoint.payload, restoredBytes: input.restoredBytes, trust: input.trust, verifiedAt: input.verifiedAt });
  if (recovery.thresholdCertificateDigest !== threshold.certificateDigest) throw new Error('v33_40_recovery_threshold_binding_invalid');
  const external = adapters.externalAdaptersObserved && attestations.externalHardwareObserved && checkpoint.externalTopologyObserved && recovery.executionClass === 'LIVE_EXTERNAL_MULTI_PROVIDER';
  const material = { version: '33.40' as const, priorV33_39VerdictDigest: input.priorV33_39Verdict.verdictDigest, adapterManifestCount: input.manifests.length,
    providerCount: adapters.providerCount, remoteAttestationCount: input.attestations.length, thresholdCertificateDigest: threshold.certificateDigest,
    checkpointDigest: input.checkpoint.payload.checkpointDigest, monitorReceiptCount: input.monitorReceipts.length, crossSiteRecoveryDigest: recovery.recoveryDigest,
    status: external ? 'EXTERNAL_MULTI_PROVIDER_INTEROP_EVIDENCE_ACCEPTED' as const : 'LOCAL_MULTI_PROVIDER_INTEROP_REHEARSAL_ONLY' as const,
    externalTopologyObserved: checkpoint.externalTopologyObserved, externalHardwareObserved: attestations.externalHardwareObserved,
    externalHumanParticipants: 0 as const, verifiedAt: input.verifiedAt.toISOString(), productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const };
  return { ...material, verdictDigest: sha256(material) };
}
