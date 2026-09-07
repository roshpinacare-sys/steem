import { KeyRegistry, sha256, sha256Bytes, signEnvelope, type SignedEnvelope, type SigningIdentity } from '../contracts/crypto.js';
import type { ExternalCoordinatorJournalQualificationVerdictV33_47 } from './external-coordinator-journal-qualification-v33_47.js';

export type CoordinatorDeploymentRoleV33_48 =
  | 'COORDINATOR_HOST'
  | 'CLOCK_ROOT'
  | 'APPEND_ONLY_STORE'
  | 'PARTITION_OBSERVER'
  | 'TOPOLOGY_AUDITOR'
  | 'EVIDENCE_EXPORTER'
  | 'EVIDENCE_IMPORTER'
  | 'RECOVERY_VERIFIER';
export type CoordinatorDeploymentTopologyV33_48 = 'LOCAL_DEPLOYMENT_REHEARSAL' | 'INDEPENDENT_EXTERNAL_ATTESTED';
export type CoordinatorDeploymentExecutionClassV33_48 = 'LOCAL_REHEARSAL' | 'LIVE_EXTERNAL';

export interface CoordinatorDeploymentActorV33_48 {
  readonly keyId: string;
  readonly keyFingerprint: string;
  readonly organizationId: string;
  readonly hostId: string;
  readonly administratorId: string;
}
export interface CoordinatorExternalDeploymentManifestPayloadV33_48 {
  readonly version: '33.48';
  readonly deploymentId: string;
  readonly campaignId: string;
  readonly artifactId: string;
  readonly artifactDigest: string;
  readonly baseQualificationVerdictDigest: string;
  readonly deploymentAuthority: CoordinatorDeploymentActorV33_48;
  readonly coordinatorHosts: readonly CoordinatorDeploymentActorV33_48[];
  readonly clockRoots: readonly CoordinatorDeploymentActorV33_48[];
  readonly appendOnlyStores: readonly CoordinatorDeploymentActorV33_48[];
  readonly partitionObservers: readonly CoordinatorDeploymentActorV33_48[];
  readonly topologyAuditors: readonly CoordinatorDeploymentActorV33_48[];
  readonly evidenceExporter: CoordinatorDeploymentActorV33_48;
  readonly evidenceImporter: CoordinatorDeploymentActorV33_48;
  readonly recoveryVerifier: CoordinatorDeploymentActorV33_48;
  readonly allowedDnsNames: readonly string[];
  readonly evidencePolicyDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly manifestDigest: string;
}
export interface CoordinatorDeploymentRoleAcceptancePayloadV33_48 {
  readonly version: '33.48';
  readonly manifestDigest: string;
  readonly role: CoordinatorDeploymentRoleV33_48;
  readonly ordinal: number;
  readonly actor: CoordinatorDeploymentActorV33_48;
  readonly acceptedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly acceptanceDigest: string;
}
export interface CoordinatorDeploymentReadinessV33_48 {
  readonly version: '33.48';
  readonly status: 'READY_FOR_EXTERNAL_EXECUTION';
  readonly manifestDigest: string;
  readonly requiredRoleCount: 16;
  readonly acceptedRoleCount: 16;
  readonly coordinatorHostCount: 4;
  readonly clockRootCount: 2;
  readonly appendOnlyStoreCount: 3;
  readonly partitionObserverCount: 2;
  readonly topologyAuditorCount: 2;
  readonly roleSeparationVerified: true;
  readonly verifiedAt: string;
  readonly readinessDigest: string;
}
export interface CoordinatorEvidenceImportChallengePayloadV33_48 {
  readonly version: '33.48';
  readonly manifestDigest: string;
  readonly nonceDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly challengeDigest: string;
}
export interface ExternalInfrastructureEvidencePayloadV33_48 {
  readonly version: '33.48';
  readonly manifestDigest: string;
  readonly role: 'COORDINATOR_HOST' | 'CLOCK_ROOT' | 'APPEND_ONLY_STORE' | 'PARTITION_OBSERVER';
  readonly ordinal: number;
  readonly subject: CoordinatorDeploymentActorV33_48;
  readonly topology: CoordinatorDeploymentTopologyV33_48;
  readonly providerEvidenceDigest: string | null;
  readonly observedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly evidenceDigest: string;
}
export interface CoordinatorEvidenceInventoryEntryV33_48 {
  readonly path: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly sha256: string;
}
export interface CoordinatorJournalEvidenceBundlePayloadV33_48 {
  readonly version: '33.48';
  readonly manifestDigest: string;
  readonly challengeDigest: string;
  readonly baseQualificationVerdictDigest: string;
  readonly executionClass: CoordinatorDeploymentExecutionClassV33_48;
  readonly qualificationStatus: ExternalCoordinatorJournalQualificationVerdictV33_47['status'];
  readonly externalTopologyObserved: boolean;
  readonly externalCoordinatorHostCount: number;
  readonly externalClockRootCount: number;
  readonly externalAppendOnlyStoreCount: number;
  readonly externalPartitionObserverCount: number;
  readonly infrastructureEvidenceDigests: readonly string[];
  readonly files: readonly CoordinatorEvidenceInventoryEntryV33_48[];
  readonly exportedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly bundleDigest: string;
}
export interface AppendOnlyStoreRecoveryAttestationPayloadV33_48 {
  readonly version: '33.48';
  readonly manifestDigest: string;
  readonly bundleDigest: string;
  readonly durableStoreEvidencePath: string;
  readonly inventoryFileDigest: string;
  readonly restoredBytesDigest: string;
  readonly restoredByteLength: number;
  readonly fileFsync: true;
  readonly directoryFsync: true;
  readonly rereadVerified: true;
  readonly restoredAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly recoveryDigest: string;
}
export interface CoordinatorExternalEvidenceImportTrustV33_48 {
  readonly deploymentAuthorityRegistry: KeyRegistry;
  readonly trustedDeploymentAuthorityIds: readonly string[];
  readonly roleRegistry: KeyRegistry;
  readonly evidenceAuditorRegistry: KeyRegistry;
  readonly trustedEvidenceAuditorIds: readonly string[];
  readonly evidenceExporterRegistry: KeyRegistry;
  readonly trustedEvidenceExporterIds: readonly string[];
  readonly evidenceImporterRegistry: KeyRegistry;
  readonly trustedEvidenceImporterIds: readonly string[];
  readonly recoveryVerifierRegistry: KeyRegistry;
  readonly trustedRecoveryVerifierIds: readonly string[];
  readonly trustedExternalEvidenceDigests: readonly string[];
}
export interface CoordinatorExternalEvidenceImportReceiptV33_48 {
  readonly version: '33.48';
  readonly status: 'LOCAL_EXTERNAL_DEPLOYMENT_IMPORT_REHEARSAL_ONLY' | 'EXTERNAL_COORDINATOR_DEPLOYMENT_EVIDENCE_ACCEPTED';
  readonly manifestDigest: string;
  readonly readinessDigest: string;
  readonly challengeDigest: string;
  readonly bundleDigest: string;
  readonly recoveryDigest: string;
  readonly baseQualificationVerdictDigest: string;
  readonly inventoryFileCount: number;
  readonly infrastructureEvidenceCount: number;
  readonly coordinatorHostCount: number;
  readonly clockRootCount: number;
  readonly appendOnlyStoreCount: number;
  readonly partitionObserverCount: number;
  readonly exactInventoryVerified: true;
  readonly challengeReplayProtectionVerified: true;
  readonly durableRecoveryVerified: true;
  readonly independentEvidenceQuorumVerified: boolean;
  readonly externalTopologyObserved: boolean;
  readonly externalHumanParticipants: 0;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly importedAt: string;
  readonly receiptDigest: string;
}

const digestWithout = <T extends Record<string, unknown>>(payload: T, key: keyof T) => {
  const material = { ...payload };
  delete material[key];
  return sha256(material);
};
const assertDigest = (payload: Record<string, unknown>, key: string, code: string) => {
  const value = payload[key];
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value) || digestWithout(payload, key) !== value) throw new Error(code);
};
const requireDigest = (value: string, code: string) => { if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(code); };
const parsedTime = (value: string, code: string) => { const result = Date.parse(value); if (!Number.isFinite(result)) throw new Error(code); return result; };
const verifyEnvelope = <T>(envelope: SignedEnvelope<T>, registry: KeyRegistry, trustedIds: readonly string[], at: Date, code: string) => {
  if (!trustedIds.includes(envelope.issuerKeyId) || !registry.verifyAt(envelope, at)) throw new Error(code);
};
const actorIdentity = (actor: CoordinatorDeploymentActorV33_48) => `${actor.keyId}|${actor.keyFingerprint}|${actor.organizationId}|${actor.hostId}|${actor.administratorId}`;
const requireActor = (actor: CoordinatorDeploymentActorV33_48, code: string) => {
  if (actor.keyId.trim() === '' || !/^[0-9a-f]{64}$/.test(actor.keyFingerprint) || actor.organizationId.trim() === '' || actor.hostId.trim() === '' || actor.administratorId.trim() === '') throw new Error(code);
};
const requireDistinctActors = (actors: readonly CoordinatorDeploymentActorV33_48[], code: string) => {
  for (const field of ['keyId', 'keyFingerprint', 'organizationId', 'hostId', 'administratorId'] as const) {
    if (new Set(actors.map((actor) => actor[field])).size !== actors.length) throw new Error(code);
  }
};
const validDnsName = (value: string) => {
  const name = value.trim().toLowerCase();
  if (name === '' || name === 'localhost' || name.endsWith('.localhost') || name.endsWith('.local') || name.endsWith('.invalid')) return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(name) || name.includes(':')) return false;
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(name);
};
const safePath = (value: string) => value !== '' && !value.startsWith('/') && !value.includes('\\') && value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
const infrastructureAssignments = (manifest: CoordinatorExternalDeploymentManifestPayloadV33_48) => [
  ...manifest.coordinatorHosts.map((actor, index) => ({ role: 'COORDINATOR_HOST' as const, ordinal: index + 1, actor })),
  ...manifest.clockRoots.map((actor, index) => ({ role: 'CLOCK_ROOT' as const, ordinal: index + 1, actor })),
  ...manifest.appendOnlyStores.map((actor, index) => ({ role: 'APPEND_ONLY_STORE' as const, ordinal: index + 1, actor })),
  ...manifest.partitionObservers.map((actor, index) => ({ role: 'PARTITION_OBSERVER' as const, ordinal: index + 1, actor })),
];
const allAssignments = (manifest: CoordinatorExternalDeploymentManifestPayloadV33_48) => [
  ...infrastructureAssignments(manifest),
  ...manifest.topologyAuditors.map((actor, index) => ({ role: 'TOPOLOGY_AUDITOR' as const, ordinal: index + 1, actor })),
  { role: 'EVIDENCE_EXPORTER' as const, ordinal: 1, actor: manifest.evidenceExporter },
  { role: 'EVIDENCE_IMPORTER' as const, ordinal: 1, actor: manifest.evidenceImporter },
  { role: 'RECOVERY_VERIFIER' as const, ordinal: 1, actor: manifest.recoveryVerifier },
];

export function createCoordinatorExternalDeploymentManifestV33_48(input: {
  deploymentAuthority: SigningIdentity;
  deploymentAuthorityDescriptor: CoordinatorDeploymentActorV33_48;
  deploymentId: string;
  campaignId: string;
  artifactId: string;
  artifactDigest: string;
  baseQualificationVerdictDigest: string;
  coordinatorHosts: readonly CoordinatorDeploymentActorV33_48[];
  clockRoots: readonly CoordinatorDeploymentActorV33_48[];
  appendOnlyStores: readonly CoordinatorDeploymentActorV33_48[];
  partitionObservers: readonly CoordinatorDeploymentActorV33_48[];
  topologyAuditors: readonly CoordinatorDeploymentActorV33_48[];
  evidenceExporter: CoordinatorDeploymentActorV33_48;
  evidenceImporter: CoordinatorDeploymentActorV33_48;
  recoveryVerifier: CoordinatorDeploymentActorV33_48;
  allowedDnsNames: readonly string[];
  evidencePolicyDigest: string;
  issuedAt: Date;
  expiresAt: Date;
}) {
  if ([input.deploymentId, input.campaignId, input.artifactId].some((value) => value.trim() === '')) throw new Error('deployment_manifest_identifier_invalid');
  requireDigest(input.artifactDigest, 'deployment_manifest_artifact_digest_invalid');
  requireDigest(input.baseQualificationVerdictDigest, 'deployment_manifest_base_digest_invalid');
  requireDigest(input.evidencePolicyDigest, 'deployment_manifest_policy_digest_invalid');
  requireActor(input.deploymentAuthorityDescriptor, 'deployment_manifest_authority_invalid');
  if (input.deploymentAuthorityDescriptor.keyId !== input.deploymentAuthority.keyId) throw new Error('deployment_manifest_authority_key_mismatch');
  if (input.coordinatorHosts.length !== 4 || input.clockRoots.length !== 2 || input.appendOnlyStores.length !== 3 || input.partitionObservers.length !== 2 || input.topologyAuditors.length !== 2) throw new Error('deployment_manifest_role_cardinality');
  const roleActors = [...input.coordinatorHosts, ...input.clockRoots, ...input.appendOnlyStores, ...input.partitionObservers, ...input.topologyAuditors, input.evidenceExporter, input.evidenceImporter, input.recoveryVerifier];
  roleActors.forEach((actor) => requireActor(actor, 'deployment_manifest_actor_invalid'));
  requireDistinctActors([input.deploymentAuthorityDescriptor, ...roleActors], 'deployment_manifest_role_separation');
  const dnsNames = [...new Set(input.allowedDnsNames.map((name) => name.trim().toLowerCase()))].sort();
  if (dnsNames.length < 9 || dnsNames.some((name) => !validDnsName(name))) throw new Error('deployment_manifest_dns_invalid');
  const requiredHosts = [...input.coordinatorHosts, ...input.clockRoots, ...input.appendOnlyStores, ...input.partitionObservers].map((actor) => actor.hostId.toLowerCase());
  if (requiredHosts.some((host) => !dnsNames.includes(host))) throw new Error('deployment_manifest_dns_coverage');
  if (!(input.expiresAt.getTime() > input.issuedAt.getTime())) throw new Error('deployment_manifest_time_window_invalid');
  const material = {
    version: '33.48' as const,
    deploymentId: input.deploymentId,
    campaignId: input.campaignId,
    artifactId: input.artifactId,
    artifactDigest: input.artifactDigest,
    baseQualificationVerdictDigest: input.baseQualificationVerdictDigest,
    deploymentAuthority: input.deploymentAuthorityDescriptor,
    coordinatorHosts: [...input.coordinatorHosts],
    clockRoots: [...input.clockRoots],
    appendOnlyStores: [...input.appendOnlyStores],
    partitionObservers: [...input.partitionObservers],
    topologyAuditors: [...input.topologyAuditors],
    evidenceExporter: input.evidenceExporter,
    evidenceImporter: input.evidenceImporter,
    recoveryVerifier: input.recoveryVerifier,
    allowedDnsNames: dnsNames,
    evidencePolicyDigest: input.evidencePolicyDigest,
    issuedAt: input.issuedAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, manifestDigest: sha256(material) }, input.deploymentAuthority);
}

export function createCoordinatorDeploymentRoleAcceptanceV33_48(input: {
  actor: SigningIdentity;
  actorDescriptor: CoordinatorDeploymentActorV33_48;
  role: CoordinatorDeploymentRoleV33_48;
  ordinal: number;
  manifestDigest: string;
  acceptedAt: Date;
}) {
  requireActor(input.actorDescriptor, 'deployment_acceptance_actor_invalid');
  if (input.actorDescriptor.keyId !== input.actor.keyId || !Number.isInteger(input.ordinal) || input.ordinal < 1) throw new Error('deployment_acceptance_invalid');
  requireDigest(input.manifestDigest, 'deployment_acceptance_manifest_digest_invalid');
  const material = { version: '33.48' as const, manifestDigest: input.manifestDigest, role: input.role, ordinal: input.ordinal, actor: input.actorDescriptor, acceptedAt: input.acceptedAt.toISOString(), productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const };
  return signEnvelope({ ...material, acceptanceDigest: sha256(material) }, input.actor);
}

export function verifyCoordinatorDeploymentReadinessV33_48(input: {
  manifest: SignedEnvelope<CoordinatorExternalDeploymentManifestPayloadV33_48>;
  acceptances: readonly SignedEnvelope<CoordinatorDeploymentRoleAcceptancePayloadV33_48>[];
  trust: CoordinatorExternalEvidenceImportTrustV33_48;
  verifiedAt: Date;
}): CoordinatorDeploymentReadinessV33_48 {
  const manifest = input.manifest.payload;
  verifyEnvelope(input.manifest, input.trust.deploymentAuthorityRegistry, input.trust.trustedDeploymentAuthorityIds, input.verifiedAt, 'deployment_manifest_signature');
  assertDigest(manifest as unknown as Record<string, unknown>, 'manifestDigest', 'deployment_manifest_digest');
  if (manifest.version !== '33.48' || manifest.productionAuthority !== 'NONE' || manifest.externalEffectsExecuted !== 0) throw new Error('deployment_manifest_truth_boundary');
  if (input.trust.deploymentAuthorityRegistry.fingerprint(manifest.deploymentAuthority.keyId) !== manifest.deploymentAuthority.keyFingerprint) throw new Error('deployment_manifest_authority_fingerprint');
  for (const row of allAssignments(manifest)) if (input.trust.roleRegistry.fingerprint(row.actor.keyId) !== row.actor.keyFingerprint) throw new Error('deployment_manifest_actor_fingerprint');
  const verifiedAt = input.verifiedAt.getTime();
  if (verifiedAt < parsedTime(manifest.issuedAt, 'deployment_manifest_issued_at') || verifiedAt > parsedTime(manifest.expiresAt, 'deployment_manifest_expires_at')) throw new Error('deployment_manifest_expired');
  const expected = allAssignments(manifest);
  if (expected.length !== 16 || input.acceptances.length !== 16) throw new Error('deployment_acceptance_cardinality');
  const expectedMap = new Map(expected.map((row) => [`${row.role}:${row.ordinal}`, row]));
  const seen = new Set<string>();
  for (const envelope of input.acceptances) {
    const acceptance = envelope.payload;
    verifyEnvelope(envelope, input.trust.roleRegistry, [acceptance.actor.keyId], input.verifiedAt, 'deployment_acceptance_signature');
    assertDigest(acceptance as unknown as Record<string, unknown>, 'acceptanceDigest', 'deployment_acceptance_digest');
    if (acceptance.version !== '33.48' || acceptance.manifestDigest !== manifest.manifestDigest || acceptance.productionAuthority !== 'NONE' || acceptance.externalEffectsExecuted !== 0) throw new Error('deployment_acceptance_binding');
    if (parsedTime(acceptance.acceptedAt, 'deployment_acceptance_time') < parsedTime(manifest.issuedAt, 'deployment_manifest_issued_at') || parsedTime(acceptance.acceptedAt, 'deployment_acceptance_time') > verifiedAt) throw new Error('deployment_acceptance_time_window');
    const key = `${acceptance.role}:${acceptance.ordinal}`;
    if (seen.has(key)) throw new Error('deployment_acceptance_duplicate');
    seen.add(key);
    const row = expectedMap.get(key);
    if (row === undefined || actorIdentity(row.actor) !== actorIdentity(acceptance.actor) || input.trust.roleRegistry.fingerprint(acceptance.actor.keyId) !== acceptance.actor.keyFingerprint) throw new Error('deployment_acceptance_assignment');
  }
  if (seen.size !== expectedMap.size) throw new Error('deployment_acceptance_missing');
  const material = { version: '33.48' as const, status: 'READY_FOR_EXTERNAL_EXECUTION' as const, manifestDigest: manifest.manifestDigest, requiredRoleCount: 16 as const, acceptedRoleCount: 16 as const, coordinatorHostCount: 4 as const, clockRootCount: 2 as const, appendOnlyStoreCount: 3 as const, partitionObserverCount: 2 as const, topologyAuditorCount: 2 as const, roleSeparationVerified: true as const, verifiedAt: input.verifiedAt.toISOString() };
  return { ...material, readinessDigest: sha256(material) };
}

export function createCoordinatorEvidenceImportChallengeV33_48(input: { importer: SigningIdentity; manifestDigest: string; nonce: Uint8Array; issuedAt: Date; expiresAt: Date }) {
  requireDigest(input.manifestDigest, 'import_challenge_manifest_digest_invalid');
  if (input.nonce.byteLength < 32 || input.expiresAt.getTime() <= input.issuedAt.getTime()) throw new Error('import_challenge_invalid');
  const material = { version: '33.48' as const, manifestDigest: input.manifestDigest, nonceDigest: sha256Bytes(input.nonce), issuedAt: input.issuedAt.toISOString(), expiresAt: input.expiresAt.toISOString(), productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const };
  return signEnvelope({ ...material, challengeDigest: sha256(material) }, input.importer);
}

export function createExternalInfrastructureEvidenceAttestationV33_48(input: {
  auditor: SigningIdentity;
  manifestDigest: string;
  role: ExternalInfrastructureEvidencePayloadV33_48['role'];
  ordinal: number;
  subject: CoordinatorDeploymentActorV33_48;
  topology: CoordinatorDeploymentTopologyV33_48;
  providerEvidenceDigest: string | null;
  observedAt: Date;
}) {
  requireDigest(input.manifestDigest, 'infrastructure_evidence_manifest_digest_invalid');
  requireActor(input.subject, 'infrastructure_evidence_subject_invalid');
  if (!Number.isInteger(input.ordinal) || input.ordinal < 1) throw new Error('infrastructure_evidence_ordinal_invalid');
  if (input.auditor.keyId === input.subject.keyId) throw new Error('infrastructure_evidence_self_attestation');
  if (input.topology === 'INDEPENDENT_EXTERNAL_ATTESTED' && input.providerEvidenceDigest === null) throw new Error('infrastructure_external_evidence_required');
  if (input.providerEvidenceDigest !== null) requireDigest(input.providerEvidenceDigest, 'infrastructure_evidence_digest_invalid');
  const material = { version: '33.48' as const, manifestDigest: input.manifestDigest, role: input.role, ordinal: input.ordinal, subject: input.subject, topology: input.topology, providerEvidenceDigest: input.providerEvidenceDigest, observedAt: input.observedAt.toISOString(), productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const };
  return signEnvelope({ ...material, evidenceDigest: sha256(material) }, input.auditor);
}

export function createCoordinatorJournalEvidenceBundleV33_48(input: {
  exporter: SigningIdentity;
  manifestDigest: string;
  challengeDigest: string;
  baseQualificationVerdictDigest: string;
  executionClass: CoordinatorDeploymentExecutionClassV33_48;
  qualificationStatus: ExternalCoordinatorJournalQualificationVerdictV33_47['status'];
  externalTopologyObserved: boolean;
  externalCoordinatorHostCount: number;
  externalClockRootCount: number;
  externalAppendOnlyStoreCount: number;
  externalPartitionObserverCount: number;
  infrastructureEvidence: readonly SignedEnvelope<ExternalInfrastructureEvidencePayloadV33_48>[];
  files: Readonly<Record<string, { readonly bytes: Uint8Array; readonly mediaType: string }>>;
  exportedAt: Date;
}) {
  requireDigest(input.manifestDigest, 'evidence_bundle_manifest_digest_invalid');
  requireDigest(input.challengeDigest, 'evidence_bundle_challenge_digest_invalid');
  requireDigest(input.baseQualificationVerdictDigest, 'evidence_bundle_base_digest_invalid');
  const paths = Object.keys(input.files).sort();
  if (paths.length < 5 || paths.some((path) => !safePath(path))) throw new Error('evidence_bundle_inventory_path');
  const inventory = paths.map((path) => {
    const row = input.files[path]!;
    if (row.mediaType.trim() === '') throw new Error('evidence_bundle_media_type');
    return { path, mediaType: row.mediaType, byteLength: row.bytes.byteLength, sha256: sha256Bytes(row.bytes) };
  });
  if (input.executionClass === 'LOCAL_REHEARSAL') {
    if (input.externalTopologyObserved || input.externalCoordinatorHostCount !== 0 || input.externalClockRootCount !== 0 || input.externalAppendOnlyStoreCount !== 0 || input.externalPartitionObserverCount !== 0 || input.infrastructureEvidence.length !== 0 || input.qualificationStatus !== 'LOCAL_COORDINATOR_JOURNAL_QUALIFICATION_REHEARSAL_ONLY') throw new Error('evidence_bundle_local_truth_boundary');
  } else {
    if (!input.externalTopologyObserved || input.externalCoordinatorHostCount !== 4 || input.externalClockRootCount !== 2 || input.externalAppendOnlyStoreCount !== 3 || input.externalPartitionObserverCount !== 2 || input.qualificationStatus !== 'EXTERNAL_COORDINATOR_JOURNAL_QUALIFIED') throw new Error('evidence_bundle_external_cardinality');
  }
  const material = {
    version: '33.48' as const,
    manifestDigest: input.manifestDigest,
    challengeDigest: input.challengeDigest,
    baseQualificationVerdictDigest: input.baseQualificationVerdictDigest,
    executionClass: input.executionClass,
    qualificationStatus: input.qualificationStatus,
    externalTopologyObserved: input.externalTopologyObserved,
    externalCoordinatorHostCount: input.externalCoordinatorHostCount,
    externalClockRootCount: input.externalClockRootCount,
    externalAppendOnlyStoreCount: input.externalAppendOnlyStoreCount,
    externalPartitionObserverCount: input.externalPartitionObserverCount,
    infrastructureEvidenceDigests: input.infrastructureEvidence.map((row) => row.payload.evidenceDigest).sort(),
    files: inventory,
    exportedAt: input.exportedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, bundleDigest: sha256(material) }, input.exporter);
}

export function createAppendOnlyStoreRecoveryAttestationV33_48(input: {
  recoveryVerifier: SigningIdentity;
  manifestDigest: string;
  bundleDigest: string;
  durableStoreEvidencePath: string;
  inventoryFileDigest: string;
  restoredBytes: Uint8Array;
  fileFsync: true;
  directoryFsync: true;
  rereadVerified: true;
  restoredAt: Date;
}) {
  requireDigest(input.manifestDigest, 'store_recovery_manifest_digest_invalid');
  requireDigest(input.bundleDigest, 'store_recovery_bundle_digest_invalid');
  requireDigest(input.inventoryFileDigest, 'store_recovery_inventory_digest_invalid');
  if (!safePath(input.durableStoreEvidencePath) || !input.durableStoreEvidencePath.startsWith('stores/')) throw new Error('store_recovery_path_invalid');
  const material = { version: '33.48' as const, manifestDigest: input.manifestDigest, bundleDigest: input.bundleDigest, durableStoreEvidencePath: input.durableStoreEvidencePath, inventoryFileDigest: input.inventoryFileDigest, restoredBytesDigest: sha256Bytes(input.restoredBytes), restoredByteLength: input.restoredBytes.byteLength, fileFsync: input.fileFsync, directoryFsync: input.directoryFsync, rereadVerified: input.rereadVerified, restoredAt: input.restoredAt.toISOString(), productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const };
  return signEnvelope({ ...material, recoveryDigest: sha256(material) }, input.recoveryVerifier);
}

export function verifyCoordinatorJournalEvidenceImportV33_48(input: {
  baseVerdict: ExternalCoordinatorJournalQualificationVerdictV33_47;
  manifest: SignedEnvelope<CoordinatorExternalDeploymentManifestPayloadV33_48>;
  readiness: CoordinatorDeploymentReadinessV33_48;
  challenge: SignedEnvelope<CoordinatorEvidenceImportChallengePayloadV33_48>;
  infrastructureEvidence: readonly SignedEnvelope<ExternalInfrastructureEvidencePayloadV33_48>[];
  bundle: SignedEnvelope<CoordinatorJournalEvidenceBundlePayloadV33_48>;
  fileBytes: Readonly<Record<string, Uint8Array>>;
  recovery: SignedEnvelope<AppendOnlyStoreRecoveryAttestationPayloadV33_48>;
  trust: CoordinatorExternalEvidenceImportTrustV33_48;
  consumedChallengeDigests: Set<string>;
  importedAt: Date;
}): CoordinatorExternalEvidenceImportReceiptV33_48 {
  const at = input.importedAt;
  const manifest = input.manifest.payload;
  verifyEnvelope(input.manifest, input.trust.deploymentAuthorityRegistry, input.trust.trustedDeploymentAuthorityIds, at, 'import_manifest_signature');
  assertDigest(manifest as unknown as Record<string, unknown>, 'manifestDigest', 'import_manifest_digest');
  if (manifest.baseQualificationVerdictDigest !== input.baseVerdict.verdictDigest || input.baseVerdict.version !== '33.47' || input.baseVerdict.productionAuthority !== 'NONE' || input.baseVerdict.externalEffectsExecuted !== 0) throw new Error('import_base_verdict_binding');
  if (input.readiness.version !== '33.48' || input.readiness.status !== 'READY_FOR_EXTERNAL_EXECUTION' || input.readiness.requiredRoleCount !== 16 || input.readiness.acceptedRoleCount !== 16 || input.readiness.coordinatorHostCount !== 4 || input.readiness.clockRootCount !== 2 || input.readiness.appendOnlyStoreCount !== 3 || input.readiness.partitionObserverCount !== 2 || input.readiness.topologyAuditorCount !== 2 || !input.readiness.roleSeparationVerified) throw new Error('import_readiness_fields');
  assertDigest(input.readiness as unknown as Record<string, unknown>, 'readinessDigest', 'import_readiness_digest');
  if (input.readiness.manifestDigest !== manifest.manifestDigest || input.readiness.status !== 'READY_FOR_EXTERNAL_EXECUTION') throw new Error('import_readiness_binding');
  const challenge = input.challenge.payload;
  verifyEnvelope(input.challenge, input.trust.evidenceImporterRegistry, input.trust.trustedEvidenceImporterIds, at, 'import_challenge_signature');
  if (input.challenge.issuerKeyId !== manifest.evidenceImporter.keyId) throw new Error('import_challenge_issuer');
  assertDigest(challenge as unknown as Record<string, unknown>, 'challengeDigest', 'import_challenge_digest');
  if (challenge.manifestDigest !== manifest.manifestDigest || challenge.productionAuthority !== 'NONE' || challenge.externalEffectsExecuted !== 0) throw new Error('import_challenge_binding');
  const importedAtMs = at.getTime();
  if (importedAtMs < parsedTime(challenge.issuedAt, 'import_challenge_issued_at') || importedAtMs > parsedTime(challenge.expiresAt, 'import_challenge_expires_at')) throw new Error('import_challenge_expired');
  if (input.consumedChallengeDigests.has(challenge.challengeDigest)) throw new Error('import_challenge_replay');
  const bundle = input.bundle.payload;
  verifyEnvelope(input.bundle, input.trust.evidenceExporterRegistry, input.trust.trustedEvidenceExporterIds, at, 'import_bundle_signature');
  if (input.bundle.issuerKeyId !== manifest.evidenceExporter.keyId) throw new Error('import_bundle_issuer');
  assertDigest(bundle as unknown as Record<string, unknown>, 'bundleDigest', 'import_bundle_digest');
  if (bundle.manifestDigest !== manifest.manifestDigest || bundle.challengeDigest !== challenge.challengeDigest || bundle.baseQualificationVerdictDigest !== input.baseVerdict.verdictDigest || bundle.productionAuthority !== 'NONE' || bundle.externalEffectsExecuted !== 0) throw new Error('import_bundle_binding');
  const inventoryPaths = bundle.files.map((row) => row.path);
  if (new Set(inventoryPaths).size !== inventoryPaths.length || inventoryPaths.some((path) => !safePath(path))) throw new Error('import_inventory_invalid');
  const actualPaths = Object.keys(input.fileBytes).sort();
  const expectedPaths = [...inventoryPaths].sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) throw new Error('import_inventory_exact_set');
  for (const row of bundle.files) {
    const bytes = input.fileBytes[row.path];
    if (bytes === undefined || bytes.byteLength !== row.byteLength || sha256Bytes(bytes) !== row.sha256) throw new Error('import_inventory_bytes');
  }
  const external = bundle.executionClass === 'LIVE_EXTERNAL';
  const expectedInfrastructure = infrastructureAssignments(manifest);
  let independentEvidenceQuorumVerified = false;
  if (!external) {
    if (bundle.qualificationStatus !== 'LOCAL_COORDINATOR_JOURNAL_QUALIFICATION_REHEARSAL_ONLY' || bundle.externalTopologyObserved || bundle.infrastructureEvidenceDigests.length !== 0 || input.infrastructureEvidence.length !== 0 || bundle.externalCoordinatorHostCount !== 0 || bundle.externalClockRootCount !== 0 || bundle.externalAppendOnlyStoreCount !== 0 || bundle.externalPartitionObserverCount !== 0) throw new Error('import_local_truth_boundary');
  } else {
    if (bundle.qualificationStatus !== 'EXTERNAL_COORDINATOR_JOURNAL_QUALIFIED' || !bundle.externalTopologyObserved || bundle.externalCoordinatorHostCount !== 4 || bundle.externalClockRootCount !== 2 || bundle.externalAppendOnlyStoreCount !== 3 || bundle.externalPartitionObserverCount !== 2) throw new Error('import_external_cardinality');
    if (input.infrastructureEvidence.length !== expectedInfrastructure.length * 2 || bundle.infrastructureEvidenceDigests.length !== input.infrastructureEvidence.length) throw new Error('import_external_evidence_cardinality');
    const expectedSubjects = new Map(expectedInfrastructure.map((row) => [`${row.role}:${row.ordinal}`, row.actor]));
    const bySubject = new Map<string, Set<string>>();
    const digests: string[] = [];
    for (const envelope of input.infrastructureEvidence) {
      const evidence = envelope.payload;
      verifyEnvelope(envelope, input.trust.evidenceAuditorRegistry, input.trust.trustedEvidenceAuditorIds, at, 'import_external_evidence_signature');
      if (!manifest.topologyAuditors.some((auditor) => auditor.keyId === envelope.issuerKeyId)) throw new Error('import_external_evidence_auditor_assignment');
      assertDigest(evidence as unknown as Record<string, unknown>, 'evidenceDigest', 'import_external_evidence_digest');
      if (evidence.manifestDigest !== manifest.manifestDigest || evidence.topology !== 'INDEPENDENT_EXTERNAL_ATTESTED' || evidence.providerEvidenceDigest === null || !input.trust.trustedExternalEvidenceDigests.includes(evidence.providerEvidenceDigest) || evidence.productionAuthority !== 'NONE' || evidence.externalEffectsExecuted !== 0) throw new Error('import_external_evidence_binding');
      const key = `${evidence.role}:${evidence.ordinal}`;
      const subject = expectedSubjects.get(key);
      if (subject === undefined || actorIdentity(subject) !== actorIdentity(evidence.subject)) throw new Error('import_external_evidence_subject');
      if (envelope.issuerKeyId === evidence.subject.keyId || manifest.topologyAuditors.find((auditor) => auditor.keyId === envelope.issuerKeyId)?.organizationId === evidence.subject.organizationId || manifest.topologyAuditors.find((auditor) => auditor.keyId === envelope.issuerKeyId)?.administratorId === evidence.subject.administratorId) throw new Error('import_external_evidence_independence');
      const issuers = bySubject.get(key) ?? new Set<string>();
      if (issuers.has(envelope.issuerKeyId)) throw new Error('import_external_evidence_duplicate_auditor');
      issuers.add(envelope.issuerKeyId);
      bySubject.set(key, issuers);
      digests.push(evidence.evidenceDigest);
    }
    if ([...expectedSubjects.keys()].some((key) => bySubject.get(key)?.size !== 2)) throw new Error('import_external_evidence_quorum');
    if (JSON.stringify([...digests].sort()) !== JSON.stringify([...bundle.infrastructureEvidenceDigests].sort())) throw new Error('import_external_evidence_inventory');
    independentEvidenceQuorumVerified = true;
  }
  const recovery = input.recovery.payload;
  verifyEnvelope(input.recovery, input.trust.recoveryVerifierRegistry, input.trust.trustedRecoveryVerifierIds, at, 'import_recovery_signature');
  if (input.recovery.issuerKeyId !== manifest.recoveryVerifier.keyId) throw new Error('import_recovery_issuer');
  assertDigest(recovery as unknown as Record<string, unknown>, 'recoveryDigest', 'import_recovery_digest');
  const inventoryEntry = bundle.files.find((row) => row.path === recovery.durableStoreEvidencePath);
  const restored = input.fileBytes[recovery.durableStoreEvidencePath];
  if (inventoryEntry === undefined || restored === undefined || !recovery.durableStoreEvidencePath.startsWith('stores/') || recovery.manifestDigest !== manifest.manifestDigest || recovery.bundleDigest !== bundle.bundleDigest || recovery.inventoryFileDigest !== inventoryEntry.sha256 || recovery.restoredBytesDigest !== inventoryEntry.sha256 || recovery.restoredByteLength !== inventoryEntry.byteLength || !recovery.fileFsync || !recovery.directoryFsync || !recovery.rereadVerified || recovery.productionAuthority !== 'NONE' || recovery.externalEffectsExecuted !== 0) throw new Error('import_recovery_binding');
  if (input.bundle.issuerKeyId === input.challenge.issuerKeyId || input.bundle.issuerKeyId === input.recovery.issuerKeyId || input.challenge.issuerKeyId === input.recovery.issuerKeyId) throw new Error('import_duty_separation');
  const material = {
    version: '33.48' as const,
    status: (external ? 'EXTERNAL_COORDINATOR_DEPLOYMENT_EVIDENCE_ACCEPTED' : 'LOCAL_EXTERNAL_DEPLOYMENT_IMPORT_REHEARSAL_ONLY') as CoordinatorExternalEvidenceImportReceiptV33_48['status'],
    manifestDigest: manifest.manifestDigest,
    readinessDigest: input.readiness.readinessDigest,
    challengeDigest: challenge.challengeDigest,
    bundleDigest: bundle.bundleDigest,
    recoveryDigest: recovery.recoveryDigest,
    baseQualificationVerdictDigest: input.baseVerdict.verdictDigest,
    inventoryFileCount: bundle.files.length,
    infrastructureEvidenceCount: input.infrastructureEvidence.length,
    coordinatorHostCount: external ? 4 : 0,
    clockRootCount: external ? 2 : 0,
    appendOnlyStoreCount: external ? 3 : 0,
    partitionObserverCount: external ? 2 : 0,
    exactInventoryVerified: true as const,
    challengeReplayProtectionVerified: true as const,
    durableRecoveryVerified: true as const,
    independentEvidenceQuorumVerified,
    externalTopologyObserved: external,
    externalHumanParticipants: 0 as const,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
    importedAt: at.toISOString(),
  };
  const receipt = { ...material, receiptDigest: sha256(material) };
  input.consumedChallengeDigests.add(challenge.challengeDigest);
  return receipt;
}
