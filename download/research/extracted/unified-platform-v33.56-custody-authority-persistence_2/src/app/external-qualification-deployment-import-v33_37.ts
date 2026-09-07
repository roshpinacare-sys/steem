import { posix } from 'node:path';
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

export type DeploymentRoleV33_37 =
  | 'PUBLISHER'
  | 'MONITOR'
  | 'TOPOLOGY_AUDITOR'
  | 'TIME_SOURCE'
  | 'EVIDENCE_EXPORTER'
  | 'EVIDENCE_IMPORTER'
  | 'RECOVERY_VERIFIER';

export interface ExternalQualificationDeploymentManifestV33_37 {
  readonly version: '33.37';
  readonly deploymentId: string;
  readonly campaignId: string;
  readonly artifactId: string;
  readonly artifactDigest: string;
  readonly deploymentAuthorityKeyId: string;
  readonly deploymentAuthorityOrganizationId: string;
  readonly deploymentAuthorityHostId: string;
  readonly deploymentAuthorityAdministratorId: string;
  readonly publisher: QualificationActorDescriptorV33_36;
  readonly monitors: readonly QualificationActorDescriptorV33_36[];
  readonly topologyAuditors: readonly QualificationActorDescriptorV33_36[];
  readonly timeSources: readonly QualificationActorDescriptorV33_36[];
  readonly evidenceExporter: QualificationActorDescriptorV33_36;
  readonly evidenceImporter: QualificationActorDescriptorV33_36;
  readonly recoveryVerifier: QualificationActorDescriptorV33_36;
  readonly allowedDnsNames: readonly string[];
  readonly requiredTlsProtocol: 'TLSv1.3';
  readonly monitorQuorum: 3;
  readonly topologyAuditorQuorum: 2;
  readonly timeSourceQuorum: 2;
  readonly requiredEvidenceClass: 'LIVE_EXTERNAL';
  readonly providerEvidencePolicyDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly manifestDigest: string;
}

export interface DeploymentRoleAcceptanceV33_37 {
  readonly version: '33.37';
  readonly acceptanceId: string;
  readonly manifestDigest: string;
  readonly role: DeploymentRoleV33_37;
  readonly actorKeyId: string;
  readonly actorKeyFingerprint: string;
  readonly actorOrganizationId: string;
  readonly actorHostId: string;
  readonly actorAdministratorId: string;
  readonly acceptedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly acceptanceDigest: string;
}

export interface DeploymentReadinessVerdictV33_37 {
  readonly version: '33.37';
  readonly manifestDigest: string;
  readonly requiredRoleCount: number;
  readonly acceptedRoleCount: number;
  readonly keyPossessionVerified: true;
  readonly roleSeparationVerified: true;
  readonly dnsPolicyVerified: true;
  readonly status: 'READY_FOR_EXTERNAL_EXECUTION';
  readonly verifiedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly verdictDigest: string;
}

export interface EvidenceInventoryEntryV33_37 {
  readonly path: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface ExternalQualificationImportChallengeV33_37 {
  readonly version: '33.37';
  readonly challengeId: string;
  readonly nonceDigest: string;
  readonly manifestDigest: string;
  readonly importerKeyId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly challengeDigest: string;
}

export interface ExternalQualificationEvidenceBundleV33_37 {
  readonly version: '33.37';
  readonly bundleId: string;
  readonly manifestDigest: string;
  readonly challengeDigest: string;
  readonly executionClass: 'LOCAL_REHEARSAL' | 'LIVE_EXTERNAL';
  readonly qualificationStatus: 'LOCAL_HTTPS_MONITOR_REHEARSAL_ONLY' | 'EXTERNAL_MONITOR_QUALIFIED';
  readonly externalTopologyObserved: boolean;
  readonly qualificationVerdictDigest: string;
  readonly exporterKeyId: string;
  readonly exporterOrganizationId: string;
  readonly exporterHostId: string;
  readonly exporterAdministratorId: string;
  readonly files: readonly EvidenceInventoryEntryV33_37[];
  readonly exportedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly bundleDigest: string;
}

export interface DurableReceiptRecoveryAttestationV33_37 {
  readonly version: '33.37';
  readonly recoveryId: string;
  readonly manifestDigest: string;
  readonly bundleDigest: string;
  readonly recoveryVerifierKeyId: string;
  readonly durableReceiptPath: string;
  readonly inventoryFileDigest: string;
  readonly restoredFileDigest: string;
  readonly fsyncObserved: true;
  readonly restoredAt: string;
  readonly decision: 'RESTORE_VERIFIED';
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly recoveryDigest: string;
}

export interface ExternalQualificationImportTrustV33_37 {
  readonly deploymentAuthorityRegistry: KeyRegistry;
  readonly trustedDeploymentAuthorityIds: readonly string[];
  readonly roleRegistry: KeyRegistry;
  readonly evidenceExporterRegistry: KeyRegistry;
  readonly trustedEvidenceExporterIds: readonly string[];
  readonly evidenceImporterRegistry: KeyRegistry;
  readonly trustedEvidenceImporterIds: readonly string[];
  readonly recoveryVerifierRegistry: KeyRegistry;
  readonly trustedRecoveryVerifierIds: readonly string[];
}

export interface ExternalQualificationImportReceiptV33_37 {
  readonly version: '33.37';
  readonly manifestDigest: string;
  readonly challengeDigest: string;
  readonly bundleDigest: string;
  readonly verifiedFileCount: number;
  readonly exactInventoryVerified: true;
  readonly byteIntegrityVerified: true;
  readonly recoveryVerified: true;
  readonly externalTopologyObserved: boolean;
  readonly externalHumanParticipants: 0;
  readonly status: 'LOCAL_IMPORT_REHEARSAL_ONLY' | 'EXTERNAL_EVIDENCE_ACCEPTED';
  readonly importedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly importDigest: string;
}

function digestWithout<T extends object>(row: T, field: keyof T): string {
  const copy = { ...row } as Record<PropertyKey, unknown>;
  delete copy[field as PropertyKey];
  return sha256(copy);
}
function requireDigest(value: string, code: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(code);
}
function requireDate(value: Date, code: string): void {
  if (!Number.isFinite(value.getTime())) throw new Error(code);
}
function assertBoundary(row: { productionAuthority: 'NONE'; externalEffectsExecuted: 0 }, code: string): void {
  if (row.productionAuthority !== 'NONE' || row.externalEffectsExecuted !== 0) throw new Error(code);
}
function assertDescriptor(row: QualificationActorDescriptorV33_36, code: string): void {
  if ([row.keyId, row.keyFingerprint, row.organizationId, row.hostId, row.administratorId].some((v) => v.trim() === '')) throw new Error(code);
  requireDigest(row.keyFingerprint, code);
}
function normalizedEvidencePath(value: string): string {
  if (value.trim() === '' || value.includes('\\') || value.startsWith('/') || value.includes('\0')) throw new Error('v33_37_inventory_path_invalid');
  const normalized = posix.normalize(value);
  if (normalized !== value || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) throw new Error('v33_37_inventory_path_invalid');
  return normalized;
}
function assertPublicDnsName(value: string): void {
  const lower = value.trim().toLowerCase();
  if (lower !== value || lower.length > 253 || lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local') || lower.endsWith('.invalid')) throw new Error('v33_37_dns_name_invalid');
  if (!lower.includes('.') || !lower.split('.').every((label) => /^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(label))) throw new Error('v33_37_dns_name_invalid');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(lower) || lower.includes(':')) throw new Error('v33_37_dns_name_invalid');
}
function allActors(manifest: ExternalQualificationDeploymentManifestV33_37): QualificationActorDescriptorV33_36[] {
  return [manifest.publisher, ...manifest.monitors, ...manifest.topologyAuditors, ...manifest.timeSources, manifest.evidenceExporter, manifest.evidenceImporter, manifest.recoveryVerifier];
}
function assertDistinctActors(rows: readonly QualificationActorDescriptorV33_36[]): void {
  for (const row of rows) assertDescriptor(row, 'v33_37_actor_descriptor_invalid');
  const fields: (keyof QualificationActorDescriptorV33_36)[] = ['keyId', 'organizationId', 'hostId', 'administratorId'];
  for (const field of fields) if (new Set(rows.map((row) => row[field])).size !== rows.length) throw new Error('v33_37_role_separation_invalid');
}
function roleAssignments(manifest: ExternalQualificationDeploymentManifestV33_37): readonly { role: DeploymentRoleV33_37; actor: QualificationActorDescriptorV33_36 }[] {
  return [
    { role: 'PUBLISHER', actor: manifest.publisher },
    ...manifest.monitors.map((actor) => ({ role: 'MONITOR' as const, actor })),
    ...manifest.topologyAuditors.map((actor) => ({ role: 'TOPOLOGY_AUDITOR' as const, actor })),
    ...manifest.timeSources.map((actor) => ({ role: 'TIME_SOURCE' as const, actor })),
    { role: 'EVIDENCE_EXPORTER', actor: manifest.evidenceExporter },
    { role: 'EVIDENCE_IMPORTER', actor: manifest.evidenceImporter },
    { role: 'RECOVERY_VERIFIER', actor: manifest.recoveryVerifier },
  ];
}

export function createExternalQualificationDeploymentManifestV33_37(input: {
  readonly deploymentAuthority: SigningIdentity;
  readonly deploymentAuthorityDescriptor: QualificationActorDescriptorV33_36;
  readonly deploymentId: string;
  readonly campaignId: string;
  readonly artifactId: string;
  readonly artifactDigest: string;
  readonly publisher: QualificationActorDescriptorV33_36;
  readonly monitors: readonly QualificationActorDescriptorV33_36[];
  readonly topologyAuditors: readonly QualificationActorDescriptorV33_36[];
  readonly timeSources: readonly QualificationActorDescriptorV33_36[];
  readonly evidenceExporter: QualificationActorDescriptorV33_36;
  readonly evidenceImporter: QualificationActorDescriptorV33_36;
  readonly recoveryVerifier: QualificationActorDescriptorV33_36;
  readonly allowedDnsNames: readonly string[];
  readonly providerEvidencePolicyDigest: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}): SignedEnvelope<ExternalQualificationDeploymentManifestV33_37> {
  requireDate(input.issuedAt, 'v33_37_manifest_issued_at_invalid');
  requireDate(input.expiresAt, 'v33_37_manifest_expires_at_invalid');
  assertDescriptor(input.deploymentAuthorityDescriptor, 'v33_37_authority_descriptor_invalid');
  if (input.deploymentAuthority.keyId !== input.deploymentAuthorityDescriptor.keyId) throw new Error('v33_37_authority_binding_invalid');
  if (input.expiresAt.getTime() <= input.issuedAt.getTime()) throw new Error('v33_37_manifest_window_invalid');
  if ([input.deploymentId, input.campaignId, input.artifactId].some((v) => v.trim() === '')) throw new Error('v33_37_manifest_identity_invalid');
  requireDigest(input.artifactDigest, 'v33_37_artifact_digest_invalid');
  requireDigest(input.providerEvidencePolicyDigest, 'v33_37_provider_policy_digest_invalid');
  if (input.monitors.length !== 3 || input.topologyAuditors.length !== 2 || input.timeSources.length !== 2) throw new Error('v33_37_role_cardinality_invalid');
  if (input.allowedDnsNames.length === 0 || new Set(input.allowedDnsNames).size !== input.allowedDnsNames.length) throw new Error('v33_37_dns_policy_invalid');
  for (const dnsName of input.allowedDnsNames) assertPublicDnsName(dnsName);
  const actors = [input.deploymentAuthorityDescriptor, input.publisher, ...input.monitors, ...input.topologyAuditors, ...input.timeSources, input.evidenceExporter, input.evidenceImporter, input.recoveryVerifier];
  assertDistinctActors(actors);
  const material = {
    version: '33.37' as const,
    deploymentId: input.deploymentId,
    campaignId: input.campaignId,
    artifactId: input.artifactId,
    artifactDigest: input.artifactDigest,
    deploymentAuthorityKeyId: input.deploymentAuthority.keyId,
    deploymentAuthorityOrganizationId: input.deploymentAuthorityDescriptor.organizationId,
    deploymentAuthorityHostId: input.deploymentAuthorityDescriptor.hostId,
    deploymentAuthorityAdministratorId: input.deploymentAuthorityDescriptor.administratorId,
    publisher: input.publisher,
    monitors: input.monitors,
    topologyAuditors: input.topologyAuditors,
    timeSources: input.timeSources,
    evidenceExporter: input.evidenceExporter,
    evidenceImporter: input.evidenceImporter,
    recoveryVerifier: input.recoveryVerifier,
    allowedDnsNames: [...input.allowedDnsNames].sort(),
    requiredTlsProtocol: 'TLSv1.3' as const,
    monitorQuorum: 3 as const,
    topologyAuditorQuorum: 2 as const,
    timeSourceQuorum: 2 as const,
    requiredEvidenceClass: 'LIVE_EXTERNAL' as const,
    providerEvidencePolicyDigest: input.providerEvidencePolicyDigest,
    issuedAt: input.issuedAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, manifestDigest: sha256(material) }, input.deploymentAuthority);
}

export function createDeploymentRoleAcceptanceV33_37(input: {
  readonly actor: SigningIdentity;
  readonly actorDescriptor: QualificationActorDescriptorV33_36;
  readonly role: DeploymentRoleV33_37;
  readonly manifestDigest: string;
  readonly acceptedAt: Date;
}): SignedEnvelope<DeploymentRoleAcceptanceV33_37> {
  requireDate(input.acceptedAt, 'v33_37_acceptance_time_invalid');
  requireDigest(input.manifestDigest, 'v33_37_acceptance_manifest_digest_invalid');
  assertDescriptor(input.actorDescriptor, 'v33_37_acceptance_actor_invalid');
  if (input.actor.keyId !== input.actorDescriptor.keyId) throw new Error('v33_37_acceptance_actor_binding_invalid');
  const material = {
    version: '33.37' as const,
    acceptanceId: randomUUID(),
    manifestDigest: input.manifestDigest,
    role: input.role,
    actorKeyId: input.actor.keyId,
    actorKeyFingerprint: input.actorDescriptor.keyFingerprint,
    actorOrganizationId: input.actorDescriptor.organizationId,
    actorHostId: input.actorDescriptor.hostId,
    actorAdministratorId: input.actorDescriptor.administratorId,
    acceptedAt: input.acceptedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, acceptanceDigest: sha256(material) }, input.actor);
}

export function verifyDeploymentReadinessV33_37(input: {
  readonly manifest: SignedEnvelope<ExternalQualificationDeploymentManifestV33_37>;
  readonly acceptances: readonly SignedEnvelope<DeploymentRoleAcceptanceV33_37>[];
  readonly trust: ExternalQualificationImportTrustV33_37;
  readonly verifiedAt: Date;
}): DeploymentReadinessVerdictV33_37 {
  requireDate(input.verifiedAt, 'v33_37_readiness_time_invalid');
  const manifest = input.manifest.payload;
  if (!input.trust.trustedDeploymentAuthorityIds.includes(input.manifest.issuerKeyId) || !input.trust.deploymentAuthorityRegistry.verifyAt(input.manifest, input.verifiedAt)) throw new Error('v33_37_manifest_signature_invalid');
  if (manifest.manifestDigest !== digestWithout(manifest, 'manifestDigest')) throw new Error('v33_37_manifest_digest_invalid');
  assertBoundary(manifest, 'v33_37_manifest_boundary_invalid');
  if (input.verifiedAt.getTime() < Date.parse(manifest.issuedAt) || input.verifiedAt.getTime() > Date.parse(manifest.expiresAt)) throw new Error('v33_37_manifest_not_active');
  if (manifest.monitors.length !== 3 || manifest.topologyAuditors.length !== 2 || manifest.timeSources.length !== 2) throw new Error('v33_37_role_cardinality_invalid');
  for (const dnsName of manifest.allowedDnsNames) assertPublicDnsName(dnsName);
  assertDistinctActors([{ keyId: manifest.deploymentAuthorityKeyId, keyFingerprint: input.trust.deploymentAuthorityRegistry.fingerprint(manifest.deploymentAuthorityKeyId) ?? '', organizationId: manifest.deploymentAuthorityOrganizationId, hostId: manifest.deploymentAuthorityHostId, administratorId: manifest.deploymentAuthorityAdministratorId }, ...allActors(manifest)]);
  const assignments = roleAssignments(manifest);
  if (input.acceptances.length !== assignments.length) throw new Error('v33_37_acceptance_count_invalid');
  const consumed = new Set<string>();
  for (const acceptance of input.acceptances) {
    const row = acceptance.payload;
    if (!input.trust.roleRegistry.verifyAt(acceptance, input.verifiedAt)) throw new Error('v33_37_acceptance_signature_invalid');
    if (row.acceptanceDigest !== digestWithout(row, 'acceptanceDigest')) throw new Error('v33_37_acceptance_digest_invalid');
    assertBoundary(row, 'v33_37_acceptance_boundary_invalid');
    if (row.manifestDigest !== manifest.manifestDigest || row.actorKeyId !== acceptance.issuerKeyId) throw new Error('v33_37_acceptance_binding_invalid');
    const assignment = assignments.find((candidate) => candidate.role === row.role && candidate.actor.keyId === row.actorKeyId);
    if (assignment === undefined || assignment.actor.keyFingerprint !== row.actorKeyFingerprint || assignment.actor.organizationId !== row.actorOrganizationId || assignment.actor.hostId !== row.actorHostId || assignment.actor.administratorId !== row.actorAdministratorId) throw new Error('v33_37_acceptance_assignment_invalid');
    const key = `${row.role}:${row.actorKeyId}`;
    if (consumed.has(key)) throw new Error('v33_37_duplicate_acceptance');
    consumed.add(key);
  }
  if (consumed.size !== assignments.length) throw new Error('v33_37_acceptance_coverage_invalid');
  const material = {
    version: '33.37' as const,
    manifestDigest: manifest.manifestDigest,
    requiredRoleCount: assignments.length,
    acceptedRoleCount: consumed.size,
    keyPossessionVerified: true as const,
    roleSeparationVerified: true as const,
    dnsPolicyVerified: true as const,
    status: 'READY_FOR_EXTERNAL_EXECUTION' as const,
    verifiedAt: input.verifiedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return { ...material, verdictDigest: sha256(material) };
}

export function createExternalQualificationImportChallengeV33_37(input: {
  readonly importer: SigningIdentity;
  readonly manifestDigest: string;
  readonly nonce: Uint8Array;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}): SignedEnvelope<ExternalQualificationImportChallengeV33_37> {
  requireDate(input.issuedAt, 'v33_37_challenge_issued_at_invalid');
  requireDate(input.expiresAt, 'v33_37_challenge_expires_at_invalid');
  requireDigest(input.manifestDigest, 'v33_37_challenge_manifest_invalid');
  if (input.nonce.byteLength < 16 || input.expiresAt.getTime() <= input.issuedAt.getTime()) throw new Error('v33_37_challenge_invalid');
  const material = {
    version: '33.37' as const,
    challengeId: randomUUID(),
    nonceDigest: sha256Bytes(input.nonce),
    manifestDigest: input.manifestDigest,
    importerKeyId: input.importer.keyId,
    issuedAt: input.issuedAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, challengeDigest: sha256(material) }, input.importer);
}

export function createExternalQualificationEvidenceBundleV33_37(input: {
  readonly exporter: SigningIdentity;
  readonly exporterDescriptor: QualificationActorDescriptorV33_36;
  readonly manifestDigest: string;
  readonly challengeDigest: string;
  readonly executionClass: 'LOCAL_REHEARSAL' | 'LIVE_EXTERNAL';
  readonly qualificationStatus: 'LOCAL_HTTPS_MONITOR_REHEARSAL_ONLY' | 'EXTERNAL_MONITOR_QUALIFIED';
  readonly externalTopologyObserved: boolean;
  readonly qualificationVerdictDigest: string;
  readonly files: Readonly<Record<string, { readonly bytes: Uint8Array; readonly mediaType: string }>>;
  readonly exportedAt: Date;
}): SignedEnvelope<ExternalQualificationEvidenceBundleV33_37> {
  requireDate(input.exportedAt, 'v33_37_bundle_time_invalid');
  assertDescriptor(input.exporterDescriptor, 'v33_37_exporter_descriptor_invalid');
  if (input.exporter.keyId !== input.exporterDescriptor.keyId) throw new Error('v33_37_exporter_binding_invalid');
  requireDigest(input.manifestDigest, 'v33_37_bundle_manifest_invalid');
  requireDigest(input.challengeDigest, 'v33_37_bundle_challenge_invalid');
  requireDigest(input.qualificationVerdictDigest, 'v33_37_qualification_verdict_invalid');
  if (input.executionClass === 'LIVE_EXTERNAL') {
    if (input.qualificationStatus !== 'EXTERNAL_MONITOR_QUALIFIED' || input.externalTopologyObserved !== true) throw new Error('v33_37_live_evidence_claim_invalid');
  } else if (input.qualificationStatus !== 'LOCAL_HTTPS_MONITOR_REHEARSAL_ONLY' || input.externalTopologyObserved !== false) throw new Error('v33_37_rehearsal_claim_invalid');
  const entries = Object.entries(input.files);
  if (entries.length === 0) throw new Error('v33_37_inventory_empty');
  const normalized = new Set<string>();
  const files = entries.map(([path, file]) => {
    const clean = normalizedEvidencePath(path);
    if (normalized.has(clean)) throw new Error('v33_37_inventory_duplicate_path');
    normalized.add(clean);
    if (file.mediaType.trim() === '' || file.bytes.byteLength === 0) throw new Error('v33_37_inventory_file_invalid');
    return { path: clean, mediaType: file.mediaType, byteLength: file.bytes.byteLength, sha256: sha256Bytes(file.bytes) };
  }).sort((a, b) => a.path.localeCompare(b.path));
  const material = {
    version: '33.37' as const,
    bundleId: randomUUID(),
    manifestDigest: input.manifestDigest,
    challengeDigest: input.challengeDigest,
    executionClass: input.executionClass,
    qualificationStatus: input.qualificationStatus,
    externalTopologyObserved: input.externalTopologyObserved,
    qualificationVerdictDigest: input.qualificationVerdictDigest,
    exporterKeyId: input.exporter.keyId,
    exporterOrganizationId: input.exporterDescriptor.organizationId,
    exporterHostId: input.exporterDescriptor.hostId,
    exporterAdministratorId: input.exporterDescriptor.administratorId,
    files,
    exportedAt: input.exportedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, bundleDigest: sha256(material) }, input.exporter);
}

export function createDurableReceiptRecoveryAttestationV33_37(input: {
  readonly recoveryVerifier: SigningIdentity;
  readonly manifestDigest: string;
  readonly bundleDigest: string;
  readonly durableReceiptPath: string;
  readonly inventoryFileDigest: string;
  readonly restoredBytes: Uint8Array;
  readonly restoredAt: Date;
}): SignedEnvelope<DurableReceiptRecoveryAttestationV33_37> {
  requireDate(input.restoredAt, 'v33_37_recovery_time_invalid');
  requireDigest(input.manifestDigest, 'v33_37_recovery_manifest_invalid');
  requireDigest(input.bundleDigest, 'v33_37_recovery_bundle_invalid');
  requireDigest(input.inventoryFileDigest, 'v33_37_recovery_inventory_digest_invalid');
  normalizedEvidencePath(input.durableReceiptPath);
  const restoredFileDigest = sha256Bytes(input.restoredBytes);
  if (restoredFileDigest !== input.inventoryFileDigest) throw new Error('v33_37_recovery_bytes_invalid');
  const material = {
    version: '33.37' as const,
    recoveryId: randomUUID(),
    manifestDigest: input.manifestDigest,
    bundleDigest: input.bundleDigest,
    recoveryVerifierKeyId: input.recoveryVerifier.keyId,
    durableReceiptPath: input.durableReceiptPath,
    inventoryFileDigest: input.inventoryFileDigest,
    restoredFileDigest,
    fsyncObserved: true as const,
    restoredAt: input.restoredAt.toISOString(),
    decision: 'RESTORE_VERIFIED' as const,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, recoveryDigest: sha256(material) }, input.recoveryVerifier);
}

export function verifyExternalQualificationEvidenceImportV33_37(input: {
  readonly manifest: SignedEnvelope<ExternalQualificationDeploymentManifestV33_37>;
  readonly readiness: DeploymentReadinessVerdictV33_37;
  readonly challenge: SignedEnvelope<ExternalQualificationImportChallengeV33_37>;
  readonly bundle: SignedEnvelope<ExternalQualificationEvidenceBundleV33_37>;
  readonly fileBytes: Readonly<Record<string, Uint8Array>>;
  readonly recovery: SignedEnvelope<DurableReceiptRecoveryAttestationV33_37>;
  readonly trust: ExternalQualificationImportTrustV33_37;
  readonly consumedChallengeDigests: Set<string>;
  readonly importedAt: Date;
}): ExternalQualificationImportReceiptV33_37 {
  requireDate(input.importedAt, 'v33_37_import_time_invalid');
  const manifest = input.manifest.payload;
  if (input.readiness.status !== 'READY_FOR_EXTERNAL_EXECUTION' || input.readiness.manifestDigest !== manifest.manifestDigest || input.readiness.verdictDigest !== digestWithout(input.readiness, 'verdictDigest')) throw new Error('v33_37_readiness_invalid');
  const challenge = input.challenge.payload;
  if (!input.trust.trustedEvidenceImporterIds.includes(input.challenge.issuerKeyId) || !input.trust.evidenceImporterRegistry.verifyAt(input.challenge, input.importedAt)) throw new Error('v33_37_challenge_signature_invalid');
  if (challenge.challengeDigest !== digestWithout(challenge, 'challengeDigest') || challenge.manifestDigest !== manifest.manifestDigest || challenge.importerKeyId !== manifest.evidenceImporter.keyId) throw new Error('v33_37_challenge_binding_invalid');
  assertBoundary(challenge, 'v33_37_challenge_boundary_invalid');
  if (input.importedAt.getTime() < Date.parse(challenge.issuedAt) || input.importedAt.getTime() > Date.parse(challenge.expiresAt)) throw new Error('v33_37_challenge_not_active');
  if (input.consumedChallengeDigests.has(challenge.challengeDigest)) throw new Error('v33_37_challenge_replay');
  const bundle = input.bundle.payload;
  if (!input.trust.trustedEvidenceExporterIds.includes(input.bundle.issuerKeyId) || !input.trust.evidenceExporterRegistry.verifyAt(input.bundle, input.importedAt)) throw new Error('v33_37_bundle_signature_invalid');
  if (bundle.bundleDigest !== digestWithout(bundle, 'bundleDigest')) throw new Error('v33_37_bundle_digest_invalid');
  assertBoundary(bundle, 'v33_37_bundle_boundary_invalid');
  if (bundle.manifestDigest !== manifest.manifestDigest || bundle.challengeDigest !== challenge.challengeDigest || bundle.exporterKeyId !== manifest.evidenceExporter.keyId) throw new Error('v33_37_bundle_binding_invalid');
  if (bundle.exporterOrganizationId !== manifest.evidenceExporter.organizationId || bundle.exporterHostId !== manifest.evidenceExporter.hostId || bundle.exporterAdministratorId !== manifest.evidenceExporter.administratorId) throw new Error('v33_37_exporter_topology_invalid');
  if (bundle.executionClass === 'LIVE_EXTERNAL') {
    if (bundle.qualificationStatus !== 'EXTERNAL_MONITOR_QUALIFIED' || bundle.externalTopologyObserved !== true) throw new Error('v33_37_live_evidence_claim_invalid');
  } else if (bundle.qualificationStatus !== 'LOCAL_HTTPS_MONITOR_REHEARSAL_ONLY' || bundle.externalTopologyObserved !== false) throw new Error('v33_37_rehearsal_claim_invalid');
  const expectedPaths = bundle.files.map((entry) => normalizedEvidencePath(entry.path));
  if (new Set(expectedPaths).size !== expectedPaths.length) throw new Error('v33_37_inventory_duplicate_path');
  const actualPaths = Object.keys(input.fileBytes).map(normalizedEvidencePath).sort();
  if (expectedPaths.slice().sort().join('\n') !== actualPaths.join('\n')) throw new Error('v33_37_inventory_exactness_invalid');
  for (const entry of bundle.files) {
    requireDigest(entry.sha256, 'v33_37_inventory_digest_invalid');
    const bytes = input.fileBytes[entry.path];
    if (bytes === undefined || bytes.byteLength !== entry.byteLength || sha256Bytes(bytes) !== entry.sha256) throw new Error('v33_37_inventory_bytes_invalid');
  }
  const recovery = input.recovery.payload;
  if (!input.trust.trustedRecoveryVerifierIds.includes(input.recovery.issuerKeyId) || !input.trust.recoveryVerifierRegistry.verifyAt(input.recovery, input.importedAt)) throw new Error('v33_37_recovery_signature_invalid');
  if (recovery.recoveryDigest !== digestWithout(recovery, 'recoveryDigest')) throw new Error('v33_37_recovery_digest_invalid');
  assertBoundary(recovery, 'v33_37_recovery_boundary_invalid');
  if (recovery.manifestDigest !== manifest.manifestDigest || recovery.bundleDigest !== bundle.bundleDigest || recovery.recoveryVerifierKeyId !== manifest.recoveryVerifier.keyId || recovery.fsyncObserved !== true || recovery.decision !== 'RESTORE_VERIFIED') throw new Error('v33_37_recovery_binding_invalid');
  const recoveredEntry = bundle.files.find((entry) => entry.path === recovery.durableReceiptPath);
  if (recoveredEntry === undefined || recoveredEntry.sha256 !== recovery.inventoryFileDigest || recovery.restoredFileDigest !== recoveredEntry.sha256) throw new Error('v33_37_recovery_inventory_binding_invalid');
  input.consumedChallengeDigests.add(challenge.challengeDigest);
  const external = bundle.executionClass === 'LIVE_EXTERNAL' && bundle.externalTopologyObserved === true;
  const material = {
    version: '33.37' as const,
    manifestDigest: manifest.manifestDigest,
    challengeDigest: challenge.challengeDigest,
    bundleDigest: bundle.bundleDigest,
    verifiedFileCount: bundle.files.length,
    exactInventoryVerified: true as const,
    byteIntegrityVerified: true as const,
    recoveryVerified: true as const,
    externalTopologyObserved: external,
    externalHumanParticipants: 0 as const,
    status: external ? 'EXTERNAL_EVIDENCE_ACCEPTED' as const : 'LOCAL_IMPORT_REHEARSAL_ONLY' as const,
    importedAt: input.importedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return { ...material, importDigest: sha256(material) };
}
