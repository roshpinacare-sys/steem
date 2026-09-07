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
import {
  verifyExternalQualificationEvidenceImportV33_37,
  type DeploymentRoleV33_37,
  DeploymentReadinessVerdictV33_37,
  DurableReceiptRecoveryAttestationV33_37,
  ExternalQualificationDeploymentManifestV33_37,
  ExternalQualificationEvidenceBundleV33_37,
  ExternalQualificationImportChallengeV33_37,
  ExternalQualificationImportReceiptV33_37,
  ExternalQualificationImportTrustV33_37,
} from './external-qualification-deployment-import-v33_37.js';

export type CustodyRoleSlotV33_38 =
  | 'PUBLISHER'
  | 'MONITOR_1'
  | 'MONITOR_2'
  | 'MONITOR_3'
  | 'TOPOLOGY_AUDITOR_1'
  | 'TOPOLOGY_AUDITOR_2'
  | 'TIME_SOURCE_1'
  | 'TIME_SOURCE_2'
  | 'EVIDENCE_EXPORTER'
  | 'EVIDENCE_IMPORTER'
  | 'RECOVERY_VERIFIER';

export interface ProvisioningChallengeV33_38 {
  readonly version: '33.38';
  readonly challengeId: string;
  readonly ceremonyId: string;
  readonly manifestDigest: string;
  readonly roleSlot: CustodyRoleSlotV33_38;
  readonly role: DeploymentRoleV33_37;
  readonly actorKeyId: string;
  readonly actorKeyFingerprint: string;
  readonly actorOrganizationId: string;
  readonly actorHostId: string;
  readonly actorAdministratorId: string;
  readonly provisioningAuthorityKeyId: string;
  readonly nonceDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly oneTime: true;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly challengeDigest: string;
}

export interface ProvisioningResponseV33_38 {
  readonly version: '33.38';
  readonly responseId: string;
  readonly challengeDigest: string;
  readonly ceremonyId: string;
  readonly manifestDigest: string;
  readonly roleSlot: CustodyRoleSlotV33_38;
  readonly role: DeploymentRoleV33_37;
  readonly actorKeyId: string;
  readonly actorKeyFingerprint: string;
  readonly actorOrganizationId: string;
  readonly actorHostId: string;
  readonly actorAdministratorId: string;
  readonly possessionProofDigest: string;
  readonly respondedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly responseDigest: string;
}

export interface ProvisioningReceiptV33_38 {
  readonly version: '33.38';
  readonly receiptId: string;
  readonly ceremonyId: string;
  readonly manifestDigest: string;
  readonly challengeDigest: string;
  readonly responseDigest: string;
  readonly roleSlot: CustodyRoleSlotV33_38;
  readonly role: DeploymentRoleV33_37;
  readonly actorKeyId: string;
  readonly actorKeyFingerprint: string;
  readonly actorOrganizationId: string;
  readonly actorHostId: string;
  readonly actorAdministratorId: string;
  readonly provisioningAuthorityKeyId: string;
  readonly keyPossessionVerified: true;
  readonly oneTimeChallengeConsumed: true;
  readonly provisionedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly receiptDigest: string;
}

export interface CustodyCeremonyTranscriptV33_38 {
  readonly version: '33.38';
  readonly transcriptId: string;
  readonly ceremonyId: string;
  readonly manifestDigest: string;
  readonly executionClass: 'LOCAL_REHEARSAL' | 'LIVE_EXTERNAL';
  readonly recorderKeyId: string;
  readonly recorderOrganizationId: string;
  readonly recorderHostId: string;
  readonly recorderAdministratorId: string;
  readonly roleSlots: readonly CustodyRoleSlotV33_38[];
  readonly provisioningReceiptDigests: readonly string[];
  readonly receiptCount: 11;
  readonly openedAt: string;
  readonly closedAt: string;
  readonly immutableTranscript: true;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly transcriptDigest: string;
}

export interface CustodyCeremonyWitnessV33_38 {
  readonly version: '33.38';
  readonly witnessId: string;
  readonly manifestDigest: string;
  readonly transcriptDigest: string;
  readonly witnessKeyId: string;
  readonly witnessOrganizationId: string;
  readonly witnessHostId: string;
  readonly witnessAdministratorId: string;
  readonly observedReceiptCount: 11;
  readonly decision: 'CEREMONY_OBSERVED_COMPLETE';
  readonly observedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly witnessDigest: string;
}

export interface CustodyCeremonyVerdictV33_38 {
  readonly version: '33.38';
  readonly manifestDigest: string;
  readonly transcriptDigest: string;
  readonly verifiedRoleCount: 11;
  readonly witnessCount: number;
  readonly exactProvisioningSetVerified: true;
  readonly oneTimeProvisioningVerified: true;
  readonly executionClass: 'LOCAL_REHEARSAL' | 'LIVE_EXTERNAL';
  readonly status: 'LOCAL_CUSTODY_CEREMONY_REHEARSAL_ONLY' | 'EXTERNAL_CUSTODY_CEREMONY_STRUCTURALLY_ACCEPTED';
  readonly verifiedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly verdictDigest: string;
}

export type RoleLifecycleActionV33_38 = 'SCHEDULED_ROTATION' | 'EMERGENCY_ROTATION' | 'REVOCATION_ONLY';
export type RolePossessionPurposeV33_38 = 'CURRENT_KEY_CONSENT' | 'REPLACEMENT_KEY_ACCEPTANCE';

export interface RoleLifecycleProposalV33_38 {
  readonly version: '33.38';
  readonly proposalId: string;
  readonly manifestDigest: string;
  readonly transcriptDigest: string;
  readonly lifecycleSequence: number;
  readonly previousLifecycleDigest: string | null;
  readonly roleSlot: CustodyRoleSlotV33_38;
  readonly action: RoleLifecycleActionV33_38;
  readonly currentActor: QualificationActorDescriptorV33_36;
  readonly replacementActor: QualificationActorDescriptorV33_36 | null;
  readonly reasonDigest: string;
  readonly effectiveAt: string;
  readonly lifecycleAuthorityKeyId: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly proposalDigest: string;
}

export interface RolePossessionStatementV33_38 {
  readonly version: '33.38';
  readonly statementId: string;
  readonly proposalDigest: string;
  readonly purpose: RolePossessionPurposeV33_38;
  readonly actorKeyId: string;
  readonly actorKeyFingerprint: string;
  readonly signedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly statementDigest: string;
}

export interface SecurityCustodianApprovalV33_38 {
  readonly version: '33.38';
  readonly approvalId: string;
  readonly proposalDigest: string;
  readonly custodianKeyId: string;
  readonly custodianOrganizationId: string;
  readonly custodianHostId: string;
  readonly custodianAdministratorId: string;
  readonly decision: 'APPROVE_KEY_LIFECYCLE_CHANGE';
  readonly approvedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly approvalDigest: string;
}

export interface RoleLifecycleCertificateV33_38 {
  readonly version: '33.38';
  readonly certificateId: string;
  readonly proposalDigest: string;
  readonly manifestDigest: string;
  readonly transcriptDigest: string;
  readonly lifecycleSequence: number;
  readonly previousLifecycleDigest: string | null;
  readonly roleSlot: CustodyRoleSlotV33_38;
  readonly action: RoleLifecycleActionV33_38;
  readonly currentActor: QualificationActorDescriptorV33_36;
  readonly replacementActor: QualificationActorDescriptorV33_36 | null;
  readonly currentKeyConsentDigest: string | null;
  readonly replacementKeyAcceptanceDigest: string | null;
  readonly securityApprovalDigests: readonly string[];
  readonly securityCustodianKeyIds: readonly string[];
  readonly effectiveAt: string;
  readonly lifecycleAuthorityKeyId: string;
  readonly oldKeyRevoked: true;
  readonly decision: 'KEY_LIFECYCLE_CHANGE_AUTHORIZED';
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly lifecycleDigest: string;
}

export interface RoleLifecycleEvidenceV33_38 {
  readonly proposal: SignedEnvelope<RoleLifecycleProposalV33_38>;
  readonly currentKeyConsent: SignedEnvelope<RolePossessionStatementV33_38> | null;
  readonly replacementKeyAcceptance: SignedEnvelope<RolePossessionStatementV33_38> | null;
  readonly securityApprovals: readonly SignedEnvelope<SecurityCustodianApprovalV33_38>[];
  readonly certificate: SignedEnvelope<RoleLifecycleCertificateV33_38>;
}

export interface RoleActionAssertionV33_38 {
  readonly version: '33.38';
  readonly assertionId: string;
  readonly manifestDigest: string;
  readonly transcriptDigest: string;
  readonly roleSlot: CustodyRoleSlotV33_38;
  readonly actorKeyId: string;
  readonly lifecycleHeadDigest: string | null;
  readonly actionDigest: string;
  readonly actedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly assertionDigest: string;
}

export type CustodyTransparencyEventTypeV33_38 =
  | 'ROLE_PROVISIONED'
  | 'CEREMONY_CLOSED'
  | 'KEY_LIFECYCLE_CHANGED'
  | 'EVIDENCE_IMPORTED';

export interface CustodyTransparencyEventV33_38 {
  readonly version: '33.38';
  readonly logId: string;
  readonly sequence: number;
  readonly eventId: string;
  readonly eventType: CustodyTransparencyEventTypeV33_38;
  readonly subjectDigest: string;
  readonly roleSlot: CustodyRoleSlotV33_38 | null;
  readonly previousEventDigest: string | null;
  readonly recordedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly eventDigest: string;
}

export interface CustodyTransparencySnapshotV33_38 {
  readonly version: '33.38';
  readonly logId: string;
  readonly eventCount: number;
  readonly headEventDigest: string | null;
  readonly events: readonly CustodyTransparencyEventV33_38[];
  readonly generatedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly snapshotDigest: string;
}

export interface CustodyTransparencyWitnessV33_38 {
  readonly version: '33.38';
  readonly checkpointId: string;
  readonly snapshotDigest: string;
  readonly logId: string;
  readonly eventCount: number;
  readonly headEventDigest: string | null;
  readonly witnessKeyId: string;
  readonly witnessOrganizationId: string;
  readonly witnessHostId: string;
  readonly witnessAdministratorId: string;
  readonly observedAt: string;
  readonly decision: 'TRANSPARENCY_CHECKPOINT_OBSERVED';
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly checkpointDigest: string;
}

export interface ExternalCustodyQualificationVerdictV33_38 {
  readonly version: '33.38';
  readonly manifestDigest: string;
  readonly transcriptDigest: string;
  readonly importDigest: string;
  readonly transparencySnapshotDigest: string;
  readonly transparencyHeadEventDigest: string;
  readonly lifecycleHeadDigest: string | null;
  readonly provisionedRoleCount: 11;
  readonly transparencyWitnessCount: number;
  readonly custodyChainVerified: true;
  readonly lifecycleChainVerified: true;
  readonly importReceiptLogged: true;
  readonly status: 'LOCAL_CUSTODY_IMPORT_REHEARSAL_ONLY' | 'EXTERNAL_CUSTODY_EVIDENCE_ACCEPTED';
  readonly externalTopologyObserved: boolean;
  readonly externalHumanParticipants: 0;
  readonly verifiedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly verdictDigest: string;
}

export interface CustodyTrustV33_38 {
  readonly deploymentAuthorityRegistry: KeyRegistry;
  readonly trustedDeploymentAuthorityIds: readonly string[];
  readonly provisioningAuthorityRegistry: KeyRegistry;
  readonly trustedProvisioningAuthorityIds: readonly string[];
  readonly roleRegistry: KeyRegistry;
  readonly ceremonyRecorderRegistry: KeyRegistry;
  readonly trustedCeremonyRecorderIds: readonly string[];
  readonly ceremonyWitnessRegistry: KeyRegistry;
  readonly trustedCeremonyWitnessIds: readonly string[];
  readonly lifecycleAuthorityRegistry: KeyRegistry;
  readonly trustedLifecycleAuthorityIds: readonly string[];
  readonly securityCustodianRegistry: KeyRegistry;
  readonly trustedSecurityCustodianIds: readonly string[];
  readonly transparencyLogRegistry: KeyRegistry;
  readonly trustedTransparencyLogIds: readonly string[];
  readonly transparencyWitnessRegistry: KeyRegistry;
  readonly trustedTransparencyWitnessIds: readonly string[];
}

const DIGEST_RE = /^[0-9a-f]{64}$/;
function requireDigest(value: string, code: string): void { if (!DIGEST_RE.test(value)) throw new Error(code); }
function requireDate(value: Date, code: string): void { if (!Number.isFinite(value.getTime())) throw new Error(code); }
function requireText(value: string, code: string): void { if (value.trim() === '') throw new Error(code); }
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

export function custodyRoleAssignmentsV33_38(manifest: ExternalQualificationDeploymentManifestV33_37): readonly { readonly roleSlot: CustodyRoleSlotV33_38; readonly role: DeploymentRoleV33_37; readonly actor: QualificationActorDescriptorV33_36 }[] {
  if (manifest.monitors.length !== 3 || manifest.topologyAuditors.length !== 2 || manifest.timeSources.length !== 2) throw new Error('v33_38_manifest_cardinality_invalid');
  return [
    { roleSlot: 'PUBLISHER', role: 'PUBLISHER', actor: manifest.publisher },
    { roleSlot: 'MONITOR_1', role: 'MONITOR', actor: manifest.monitors[0]! },
    { roleSlot: 'MONITOR_2', role: 'MONITOR', actor: manifest.monitors[1]! },
    { roleSlot: 'MONITOR_3', role: 'MONITOR', actor: manifest.monitors[2]! },
    { roleSlot: 'TOPOLOGY_AUDITOR_1', role: 'TOPOLOGY_AUDITOR', actor: manifest.topologyAuditors[0]! },
    { roleSlot: 'TOPOLOGY_AUDITOR_2', role: 'TOPOLOGY_AUDITOR', actor: manifest.topologyAuditors[1]! },
    { roleSlot: 'TIME_SOURCE_1', role: 'TIME_SOURCE', actor: manifest.timeSources[0]! },
    { roleSlot: 'TIME_SOURCE_2', role: 'TIME_SOURCE', actor: manifest.timeSources[1]! },
    { roleSlot: 'EVIDENCE_EXPORTER', role: 'EVIDENCE_EXPORTER', actor: manifest.evidenceExporter },
    { roleSlot: 'EVIDENCE_IMPORTER', role: 'EVIDENCE_IMPORTER', actor: manifest.evidenceImporter },
    { roleSlot: 'RECOVERY_VERIFIER', role: 'RECOVERY_VERIFIER', actor: manifest.recoveryVerifier },
  ];
}
function assignmentFor(manifest: ExternalQualificationDeploymentManifestV33_37, roleSlot: CustodyRoleSlotV33_38) {
  const row = custodyRoleAssignmentsV33_38(manifest).find((entry) => entry.roleSlot === roleSlot);
  if (row === undefined) throw new Error('v33_38_role_slot_invalid');
  return row;
}
function assertAuthoritySeparated(authority: QualificationActorDescriptorV33_36, manifest: ExternalQualificationDeploymentManifestV33_37, code: string): void {
  assertDescriptor(authority, code);
  if (!descriptorsSeparated([authority, ...custodyRoleAssignmentsV33_38(manifest).map((row) => row.actor)])) throw new Error(code);
}

export function createProvisioningChallengeV33_38(input: {
  readonly provisioningAuthority: SigningIdentity;
  readonly provisioningAuthorityDescriptor: QualificationActorDescriptorV33_36;
  readonly manifest: ExternalQualificationDeploymentManifestV33_37;
  readonly ceremonyId: string;
  readonly roleSlot: CustodyRoleSlotV33_38;
  readonly nonce: Uint8Array;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}): SignedEnvelope<ProvisioningChallengeV33_38> {
  requireText(input.ceremonyId, 'v33_38_ceremony_id_required');
  requireDate(input.issuedAt, 'v33_38_challenge_time_invalid');
  requireDate(input.expiresAt, 'v33_38_challenge_time_invalid');
  if (input.expiresAt.getTime() <= input.issuedAt.getTime() || input.expiresAt.getTime() - input.issuedAt.getTime() > 24 * 60 * 60 * 1000 || input.nonce.byteLength < 32) throw new Error('v33_38_challenge_invalid');
  assertAuthoritySeparated(input.provisioningAuthorityDescriptor, input.manifest, 'v33_38_provisioning_authority_overlap');
  if (input.provisioningAuthorityDescriptor.keyId !== input.provisioningAuthority.keyId) throw new Error('v33_38_provisioning_authority_identity_invalid');
  const assignment = assignmentFor(input.manifest, input.roleSlot);
  const material = {
    version: '33.38' as const,
    challengeId: randomUUID(),
    ceremonyId: input.ceremonyId,
    manifestDigest: input.manifest.manifestDigest,
    roleSlot: assignment.roleSlot,
    role: assignment.role,
    actorKeyId: assignment.actor.keyId,
    actorKeyFingerprint: assignment.actor.keyFingerprint,
    actorOrganizationId: assignment.actor.organizationId,
    actorHostId: assignment.actor.hostId,
    actorAdministratorId: assignment.actor.administratorId,
    provisioningAuthorityKeyId: input.provisioningAuthority.keyId,
    nonceDigest: sha256Bytes(input.nonce),
    issuedAt: input.issuedAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    oneTime: true as const,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, challengeDigest: sha256(material) }, input.provisioningAuthority);
}

export function createProvisioningResponseV33_38(input: {
  readonly actor: SigningIdentity;
  readonly actorDescriptor: QualificationActorDescriptorV33_36;
  readonly challenge: ProvisioningChallengeV33_38;
  readonly respondedAt: Date;
}): SignedEnvelope<ProvisioningResponseV33_38> {
  requireDate(input.respondedAt, 'v33_38_response_time_invalid');
  assertDescriptor(input.actorDescriptor, 'v33_38_response_actor_invalid');
  if (input.actor.keyId !== input.actorDescriptor.keyId || input.actor.keyId !== input.challenge.actorKeyId || input.actorDescriptor.keyFingerprint !== input.challenge.actorKeyFingerprint || input.actorDescriptor.organizationId !== input.challenge.actorOrganizationId || input.actorDescriptor.hostId !== input.challenge.actorHostId || input.actorDescriptor.administratorId !== input.challenge.actorAdministratorId) throw new Error('v33_38_response_actor_binding_invalid');
  if (input.respondedAt.getTime() < Date.parse(input.challenge.issuedAt) || input.respondedAt.getTime() > Date.parse(input.challenge.expiresAt)) throw new Error('v33_38_response_not_active');
  const material = {
    version: '33.38' as const,
    responseId: randomUUID(),
    challengeDigest: input.challenge.challengeDigest,
    ceremonyId: input.challenge.ceremonyId,
    manifestDigest: input.challenge.manifestDigest,
    roleSlot: input.challenge.roleSlot,
    role: input.challenge.role,
    actorKeyId: input.actor.keyId,
    actorKeyFingerprint: input.actorDescriptor.keyFingerprint,
    actorOrganizationId: input.actorDescriptor.organizationId,
    actorHostId: input.actorDescriptor.hostId,
    actorAdministratorId: input.actorDescriptor.administratorId,
    possessionProofDigest: sha256({ challengeDigest: input.challenge.challengeDigest, actorKeyFingerprint: input.actorDescriptor.keyFingerprint }),
    respondedAt: input.respondedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, responseDigest: sha256(material) }, input.actor);
}

export function verifyOneTimeProvisioningEvidenceV33_38(input: {
  readonly manifest: SignedEnvelope<ExternalQualificationDeploymentManifestV33_37>;
  readonly challenge: SignedEnvelope<ProvisioningChallengeV33_38>;
  readonly response: SignedEnvelope<ProvisioningResponseV33_38>;
  readonly receipt: SignedEnvelope<ProvisioningReceiptV33_38>;
  readonly trust: CustodyTrustV33_38;
  readonly verifiedAt: Date;
}): void {
  requireDate(input.verifiedAt, 'v33_38_provisioning_verification_time_invalid');
  const manifest = input.manifest.payload;
  if (!input.trust.trustedDeploymentAuthorityIds.includes(input.manifest.issuerKeyId) || !input.trust.deploymentAuthorityRegistry.verifyAt(input.manifest, input.verifiedAt)) throw new Error('v33_38_manifest_signature_invalid');
  const challenge = input.challenge.payload;
  if (!input.trust.trustedProvisioningAuthorityIds.includes(input.challenge.issuerKeyId) || !input.trust.provisioningAuthorityRegistry.verifyAt(input.challenge, new Date(challenge.issuedAt))) throw new Error('v33_38_challenge_signature_invalid');
  if (challenge.challengeDigest !== digestWithout(challenge, 'challengeDigest') || challenge.manifestDigest !== manifest.manifestDigest || challenge.oneTime !== true) throw new Error('v33_38_challenge_binding_invalid');
  assertBoundary(challenge, 'v33_38_challenge_boundary_invalid');
  const expected = assignmentFor(manifest, challenge.roleSlot);
  if (challenge.role !== expected.role || challenge.actorKeyId !== expected.actor.keyId || challenge.actorKeyFingerprint !== expected.actor.keyFingerprint || challenge.actorOrganizationId !== expected.actor.organizationId || challenge.actorHostId !== expected.actor.hostId || challenge.actorAdministratorId !== expected.actor.administratorId) throw new Error('v33_38_challenge_assignment_invalid');
  const response = input.response.payload;
  const respondedAt = new Date(response.respondedAt);
  if (!Number.isFinite(respondedAt.getTime()) || respondedAt.getTime() < Date.parse(challenge.issuedAt) || respondedAt.getTime() > Date.parse(challenge.expiresAt)) throw new Error('v33_38_response_not_active');
  if (input.response.issuerKeyId !== expected.actor.keyId || !input.trust.roleRegistry.verifyAt(input.response, respondedAt)) throw new Error('v33_38_response_signature_invalid');
  verifyDescriptorFingerprint(input.trust.roleRegistry, expected.actor, 'v33_38_role_fingerprint_invalid');
  if (response.responseDigest !== digestWithout(response, 'responseDigest') || response.challengeDigest !== challenge.challengeDigest || response.manifestDigest !== manifest.manifestDigest || response.ceremonyId !== challenge.ceremonyId || response.roleSlot !== challenge.roleSlot || response.role !== challenge.role || response.actorKeyId !== expected.actor.keyId || response.actorKeyFingerprint !== expected.actor.keyFingerprint || response.actorOrganizationId !== expected.actor.organizationId || response.actorHostId !== expected.actor.hostId || response.actorAdministratorId !== expected.actor.administratorId || response.possessionProofDigest !== sha256({ challengeDigest: challenge.challengeDigest, actorKeyFingerprint: expected.actor.keyFingerprint })) throw new Error('v33_38_response_binding_invalid');
  assertBoundary(response, 'v33_38_response_boundary_invalid');
  const receipt = input.receipt.payload;
  const provisionedAt = new Date(receipt.provisionedAt);
  if (!Number.isFinite(provisionedAt.getTime()) || provisionedAt.getTime() < respondedAt.getTime() || provisionedAt.getTime() > Date.parse(challenge.expiresAt)) throw new Error('v33_38_receipt_time_invalid');
  if (!input.trust.trustedProvisioningAuthorityIds.includes(input.receipt.issuerKeyId) || input.receipt.issuerKeyId !== input.challenge.issuerKeyId || !input.trust.provisioningAuthorityRegistry.verifyAt(input.receipt, provisionedAt)) throw new Error('v33_38_receipt_signature_invalid');
  if (receipt.receiptDigest !== digestWithout(receipt, 'receiptDigest') || receipt.ceremonyId !== challenge.ceremonyId || receipt.manifestDigest !== manifest.manifestDigest || receipt.challengeDigest !== challenge.challengeDigest || receipt.responseDigest !== response.responseDigest || receipt.roleSlot !== challenge.roleSlot || receipt.role !== challenge.role || receipt.actorKeyId !== expected.actor.keyId || receipt.actorKeyFingerprint !== expected.actor.keyFingerprint || receipt.actorOrganizationId !== expected.actor.organizationId || receipt.actorHostId !== expected.actor.hostId || receipt.actorAdministratorId !== expected.actor.administratorId || receipt.keyPossessionVerified !== true || receipt.oneTimeChallengeConsumed !== true) throw new Error('v33_38_receipt_binding_invalid');
  assertBoundary(receipt, 'v33_38_receipt_boundary_invalid');
}

export function finalizeOneTimeProvisioningV33_38(input: {
  readonly provisioningAuthority: SigningIdentity;
  readonly manifest: SignedEnvelope<ExternalQualificationDeploymentManifestV33_37>;
  readonly challenge: SignedEnvelope<ProvisioningChallengeV33_38>;
  readonly response: SignedEnvelope<ProvisioningResponseV33_38>;
  readonly trust: CustodyTrustV33_38;
  readonly consumedChallengeDigests: Set<string>;
  readonly provisionedAt: Date;
}): SignedEnvelope<ProvisioningReceiptV33_38> {
  requireDate(input.provisionedAt, 'v33_38_provisioning_time_invalid');
  const manifest = input.manifest.payload;
  if (!input.trust.trustedDeploymentAuthorityIds.includes(input.manifest.issuerKeyId) || !input.trust.deploymentAuthorityRegistry.verifyAt(input.manifest, input.provisionedAt)) throw new Error('v33_38_manifest_signature_invalid');
  const challenge = input.challenge.payload;
  if (!input.trust.trustedProvisioningAuthorityIds.includes(input.challenge.issuerKeyId) || input.challenge.issuerKeyId !== input.provisioningAuthority.keyId || !input.trust.provisioningAuthorityRegistry.verifyAt(input.challenge, input.provisionedAt)) throw new Error('v33_38_challenge_signature_invalid');
  if (challenge.challengeDigest !== digestWithout(challenge, 'challengeDigest') || challenge.manifestDigest !== manifest.manifestDigest || challenge.provisioningAuthorityKeyId !== input.provisioningAuthority.keyId || challenge.oneTime !== true) throw new Error('v33_38_challenge_binding_invalid');
  assertBoundary(challenge, 'v33_38_challenge_boundary_invalid');
  if (input.provisionedAt.getTime() < Date.parse(challenge.issuedAt) || input.provisionedAt.getTime() > Date.parse(challenge.expiresAt)) throw new Error('v33_38_challenge_not_active');
  if (input.consumedChallengeDigests.has(challenge.challengeDigest)) throw new Error('v33_38_challenge_replay');
  const expected = assignmentFor(manifest, challenge.roleSlot);
  if (challenge.role !== expected.role || challenge.actorKeyId !== expected.actor.keyId || challenge.actorKeyFingerprint !== expected.actor.keyFingerprint || challenge.actorOrganizationId !== expected.actor.organizationId || challenge.actorHostId !== expected.actor.hostId || challenge.actorAdministratorId !== expected.actor.administratorId) throw new Error('v33_38_challenge_assignment_invalid');
  const response = input.response.payload;
  if (input.response.issuerKeyId !== expected.actor.keyId || !input.trust.roleRegistry.verifyAt(input.response, input.provisionedAt)) throw new Error('v33_38_response_signature_invalid');
  verifyDescriptorFingerprint(input.trust.roleRegistry, expected.actor, 'v33_38_role_fingerprint_invalid');
  if (response.responseDigest !== digestWithout(response, 'responseDigest') || response.challengeDigest !== challenge.challengeDigest || response.manifestDigest !== manifest.manifestDigest || response.ceremonyId !== challenge.ceremonyId || response.roleSlot !== challenge.roleSlot || response.role !== challenge.role || response.actorKeyId !== expected.actor.keyId || response.actorKeyFingerprint !== expected.actor.keyFingerprint || response.actorOrganizationId !== expected.actor.organizationId || response.actorHostId !== expected.actor.hostId || response.actorAdministratorId !== expected.actor.administratorId || response.possessionProofDigest !== sha256({ challengeDigest: challenge.challengeDigest, actorKeyFingerprint: expected.actor.keyFingerprint })) throw new Error('v33_38_response_binding_invalid');
  assertBoundary(response, 'v33_38_response_boundary_invalid');
  input.consumedChallengeDigests.add(challenge.challengeDigest);
  const material = {
    version: '33.38' as const,
    receiptId: randomUUID(),
    ceremonyId: challenge.ceremonyId,
    manifestDigest: manifest.manifestDigest,
    challengeDigest: challenge.challengeDigest,
    responseDigest: response.responseDigest,
    roleSlot: challenge.roleSlot,
    role: challenge.role,
    actorKeyId: expected.actor.keyId,
    actorKeyFingerprint: expected.actor.keyFingerprint,
    actorOrganizationId: expected.actor.organizationId,
    actorHostId: expected.actor.hostId,
    actorAdministratorId: expected.actor.administratorId,
    provisioningAuthorityKeyId: input.provisioningAuthority.keyId,
    keyPossessionVerified: true as const,
    oneTimeChallengeConsumed: true as const,
    provisionedAt: input.provisionedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, receiptDigest: sha256(material) }, input.provisioningAuthority);
}

export function createCustodyCeremonyTranscriptV33_38(input: {
  readonly recorder: SigningIdentity;
  readonly recorderDescriptor: QualificationActorDescriptorV33_36;
  readonly manifest: ExternalQualificationDeploymentManifestV33_37;
  readonly ceremonyId: string;
  readonly receipts: readonly SignedEnvelope<ProvisioningReceiptV33_38>[];
  readonly executionClass: 'LOCAL_REHEARSAL' | 'LIVE_EXTERNAL';
  readonly openedAt: Date;
  readonly closedAt: Date;
}): SignedEnvelope<CustodyCeremonyTranscriptV33_38> {
  requireDate(input.openedAt, 'v33_38_transcript_time_invalid');
  requireDate(input.closedAt, 'v33_38_transcript_time_invalid');
  if (input.closedAt.getTime() <= input.openedAt.getTime()) throw new Error('v33_38_transcript_time_invalid');
  assertAuthoritySeparated(input.recorderDescriptor, input.manifest, 'v33_38_recorder_role_overlap');
  if (input.recorder.keyId !== input.recorderDescriptor.keyId) throw new Error('v33_38_recorder_identity_invalid');
  const expectedSlots = custodyRoleAssignmentsV33_38(input.manifest).map((row) => row.roleSlot);
  const sorted = [...input.receipts].sort((a, b) => expectedSlots.indexOf(a.payload.roleSlot) - expectedSlots.indexOf(b.payload.roleSlot));
  if (sorted.length !== 11 || new Set(sorted.map((row) => row.payload.roleSlot)).size !== 11 || sorted.some((row, index) => row.payload.roleSlot !== expectedSlots[index] || row.payload.manifestDigest !== input.manifest.manifestDigest || row.payload.ceremonyId !== input.ceremonyId || row.payload.receiptDigest !== digestWithout(row.payload, 'receiptDigest'))) throw new Error('v33_38_transcript_receipt_set_invalid');
  if (sorted.some((row) => Date.parse(row.payload.provisionedAt) > input.closedAt.getTime())) throw new Error('v33_38_transcript_closed_before_provisioning');
  const material = {
    version: '33.38' as const,
    transcriptId: randomUUID(),
    ceremonyId: input.ceremonyId,
    manifestDigest: input.manifest.manifestDigest,
    executionClass: input.executionClass,
    recorderKeyId: input.recorder.keyId,
    recorderOrganizationId: input.recorderDescriptor.organizationId,
    recorderHostId: input.recorderDescriptor.hostId,
    recorderAdministratorId: input.recorderDescriptor.administratorId,
    roleSlots: expectedSlots,
    provisioningReceiptDigests: sorted.map((row) => row.payload.receiptDigest),
    receiptCount: 11 as const,
    openedAt: input.openedAt.toISOString(),
    closedAt: input.closedAt.toISOString(),
    immutableTranscript: true as const,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, transcriptDigest: sha256(material) }, input.recorder);
}

export function createCustodyCeremonyWitnessV33_38(input: {
  readonly witness: SigningIdentity;
  readonly witnessDescriptor: QualificationActorDescriptorV33_36;
  readonly manifestDigest: string;
  readonly transcript: CustodyCeremonyTranscriptV33_38;
  readonly observedAt: Date;
}): SignedEnvelope<CustodyCeremonyWitnessV33_38> {
  requireDate(input.observedAt, 'v33_38_witness_time_invalid');
  assertDescriptor(input.witnessDescriptor, 'v33_38_witness_descriptor_invalid');
  if (input.witness.keyId !== input.witnessDescriptor.keyId || input.witness.keyId === input.transcript.recorderKeyId) throw new Error('v33_38_witness_identity_invalid');
  if (input.manifestDigest !== input.transcript.manifestDigest || input.transcript.receiptCount !== 11 || input.observedAt.getTime() < Date.parse(input.transcript.closedAt)) throw new Error('v33_38_witness_binding_invalid');
  const material = {
    version: '33.38' as const,
    witnessId: randomUUID(),
    manifestDigest: input.manifestDigest,
    transcriptDigest: input.transcript.transcriptDigest,
    witnessKeyId: input.witness.keyId,
    witnessOrganizationId: input.witnessDescriptor.organizationId,
    witnessHostId: input.witnessDescriptor.hostId,
    witnessAdministratorId: input.witnessDescriptor.administratorId,
    observedReceiptCount: 11 as const,
    decision: 'CEREMONY_OBSERVED_COMPLETE' as const,
    observedAt: input.observedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, witnessDigest: sha256(material) }, input.witness);
}

export function verifyCustodyCeremonyV33_38(input: {
  readonly manifest: SignedEnvelope<ExternalQualificationDeploymentManifestV33_37>;
  readonly challenges: readonly SignedEnvelope<ProvisioningChallengeV33_38>[];
  readonly responses: readonly SignedEnvelope<ProvisioningResponseV33_38>[];
  readonly receipts: readonly SignedEnvelope<ProvisioningReceiptV33_38>[];
  readonly transcript: SignedEnvelope<CustodyCeremonyTranscriptV33_38>;
  readonly witnesses: readonly SignedEnvelope<CustodyCeremonyWitnessV33_38>[];
  readonly trust: CustodyTrustV33_38;
  readonly verifiedAt: Date;
}): CustodyCeremonyVerdictV33_38 {
  requireDate(input.verifiedAt, 'v33_38_ceremony_verification_time_invalid');
  const manifest = input.manifest.payload;
  if (!input.trust.trustedDeploymentAuthorityIds.includes(input.manifest.issuerKeyId) || !input.trust.deploymentAuthorityRegistry.verifyAt(input.manifest, input.verifiedAt)) throw new Error('v33_38_manifest_signature_invalid');
  const expected = custodyRoleAssignmentsV33_38(manifest);
  if (input.challenges.length !== 11 || input.responses.length !== 11 || input.receipts.length !== 11) throw new Error('v33_38_provisioning_evidence_set_invalid');
  const challengeBySlot = new Map(input.challenges.map((row) => [row.payload.roleSlot, row]));
  const responseBySlot = new Map(input.responses.map((row) => [row.payload.roleSlot, row]));
  const receiptBySlot = new Map(input.receipts.map((row) => [row.payload.roleSlot, row]));
  if (challengeBySlot.size !== 11 || responseBySlot.size !== 11 || receiptBySlot.size !== 11) throw new Error('v33_38_provisioning_evidence_set_invalid');
  for (const assignment of expected) {
    const challenge = challengeBySlot.get(assignment.roleSlot);
    const response = responseBySlot.get(assignment.roleSlot);
    const receipt = receiptBySlot.get(assignment.roleSlot);
    if (challenge === undefined || response === undefined || receipt === undefined) throw new Error('v33_38_provisioning_evidence_set_invalid');
    verifyOneTimeProvisioningEvidenceV33_38({ manifest: input.manifest, challenge, response, receipt, trust: input.trust, verifiedAt: input.verifiedAt });
  }
  const transcript = input.transcript.payload;
  if (!input.trust.trustedCeremonyRecorderIds.includes(input.transcript.issuerKeyId) || !input.trust.ceremonyRecorderRegistry.verifyAt(input.transcript, input.verifiedAt)) throw new Error('v33_38_transcript_signature_invalid');
  if (transcript.transcriptDigest !== digestWithout(transcript, 'transcriptDigest') || transcript.manifestDigest !== manifest.manifestDigest || transcript.receiptCount !== 11 || transcript.immutableTranscript !== true) throw new Error('v33_38_transcript_binding_invalid');
  assertBoundary(transcript, 'v33_38_transcript_boundary_invalid');
  const expectedSlots = expected.map((row) => row.roleSlot);
  const receiptDigests = [...input.receipts].sort((a, b) => expectedSlots.indexOf(a.payload.roleSlot) - expectedSlots.indexOf(b.payload.roleSlot)).map((row) => row.payload.receiptDigest);
  if (transcript.roleSlots.join('\n') !== expectedSlots.join('\n') || transcript.provisioningReceiptDigests.join('\n') !== receiptDigests.join('\n')) throw new Error('v33_38_transcript_exactness_invalid');
  if (input.witnesses.length < 2) throw new Error('v33_38_witness_quorum_invalid');
  const witnessRows: QualificationActorDescriptorV33_36[] = [];
  for (const witnessEnvelope of input.witnesses) {
    const witness = witnessEnvelope.payload;
    if (!input.trust.trustedCeremonyWitnessIds.includes(witnessEnvelope.issuerKeyId) || !input.trust.ceremonyWitnessRegistry.verifyAt(witnessEnvelope, input.verifiedAt)) throw new Error('v33_38_witness_signature_invalid');
    if (witness.witnessDigest !== digestWithout(witness, 'witnessDigest') || witness.transcriptDigest !== transcript.transcriptDigest || witness.manifestDigest !== manifest.manifestDigest || witness.observedReceiptCount !== 11 || witness.decision !== 'CEREMONY_OBSERVED_COMPLETE') throw new Error('v33_38_witness_binding_invalid');
    assertBoundary(witness, 'v33_38_witness_boundary_invalid');
    witnessRows.push({ keyId: witness.witnessKeyId, keyFingerprint: input.trust.ceremonyWitnessRegistry.fingerprint(witness.witnessKeyId) ?? '', organizationId: witness.witnessOrganizationId, hostId: witness.witnessHostId, administratorId: witness.witnessAdministratorId });
  }
  if (!descriptorsSeparated(witnessRows) || new Set(witnessRows.map((row) => row.keyId)).size !== input.witnesses.length || witnessRows.some((row) => row.keyId === transcript.recorderKeyId || expected.some((assignment) => assignment.actor.keyId === row.keyId))) throw new Error('v33_38_witness_separation_invalid');
  const material = {
    version: '33.38' as const,
    manifestDigest: manifest.manifestDigest,
    transcriptDigest: transcript.transcriptDigest,
    verifiedRoleCount: 11 as const,
    witnessCount: input.witnesses.length,
    exactProvisioningSetVerified: true as const,
    oneTimeProvisioningVerified: true as const,
    executionClass: transcript.executionClass,
    status: transcript.executionClass === 'LIVE_EXTERNAL' ? 'EXTERNAL_CUSTODY_CEREMONY_STRUCTURALLY_ACCEPTED' as const : 'LOCAL_CUSTODY_CEREMONY_REHEARSAL_ONLY' as const,
    verifiedAt: input.verifiedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return { ...material, verdictDigest: sha256(material) };
}

export function createRoleLifecycleProposalV33_38(input: {
  readonly lifecycleAuthority: SigningIdentity;
  readonly manifestDigest: string;
  readonly transcriptDigest: string;
  readonly lifecycleSequence: number;
  readonly previousLifecycleDigest: string | null;
  readonly roleSlot: CustodyRoleSlotV33_38;
  readonly action: RoleLifecycleActionV33_38;
  readonly currentActor: QualificationActorDescriptorV33_36;
  readonly replacementActor: QualificationActorDescriptorV33_36 | null;
  readonly reasonDigest: string;
  readonly effectiveAt: Date;
}): SignedEnvelope<RoleLifecycleProposalV33_38> {
  requireDate(input.effectiveAt, 'v33_38_lifecycle_time_invalid');
  requireDigest(input.manifestDigest, 'v33_38_lifecycle_manifest_invalid');
  requireDigest(input.transcriptDigest, 'v33_38_lifecycle_transcript_invalid');
  requireDigest(input.reasonDigest, 'v33_38_lifecycle_reason_invalid');
  if (!Number.isSafeInteger(input.lifecycleSequence) || input.lifecycleSequence < 1 || (input.lifecycleSequence === 1 ? input.previousLifecycleDigest !== null : input.previousLifecycleDigest === null)) throw new Error('v33_38_lifecycle_sequence_invalid');
  if (input.previousLifecycleDigest !== null) requireDigest(input.previousLifecycleDigest, 'v33_38_lifecycle_previous_invalid');
  assertDescriptor(input.currentActor, 'v33_38_lifecycle_current_actor_invalid');
  if (input.action === 'REVOCATION_ONLY') {
    if (input.replacementActor !== null) throw new Error('v33_38_revocation_replacement_invalid');
  } else {
    if (input.replacementActor === null) throw new Error('v33_38_rotation_replacement_required');
    assertDescriptor(input.replacementActor, 'v33_38_lifecycle_replacement_actor_invalid');
    if (!descriptorsSeparated([input.currentActor, input.replacementActor])) throw new Error('v33_38_rotation_separation_invalid');
  }
  const material = {
    version: '33.38' as const,
    proposalId: randomUUID(),
    manifestDigest: input.manifestDigest,
    transcriptDigest: input.transcriptDigest,
    lifecycleSequence: input.lifecycleSequence,
    previousLifecycleDigest: input.previousLifecycleDigest,
    roleSlot: input.roleSlot,
    action: input.action,
    currentActor: input.currentActor,
    replacementActor: input.replacementActor,
    reasonDigest: input.reasonDigest,
    effectiveAt: input.effectiveAt.toISOString(),
    lifecycleAuthorityKeyId: input.lifecycleAuthority.keyId,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, proposalDigest: sha256(material) }, input.lifecycleAuthority);
}

export function createRolePossessionStatementV33_38(input: {
  readonly actor: SigningIdentity;
  readonly actorDescriptor: QualificationActorDescriptorV33_36;
  readonly proposalDigest: string;
  readonly purpose: RolePossessionPurposeV33_38;
  readonly signedAt: Date;
}): SignedEnvelope<RolePossessionStatementV33_38> {
  requireDate(input.signedAt, 'v33_38_possession_time_invalid');
  requireDigest(input.proposalDigest, 'v33_38_possession_proposal_invalid');
  assertDescriptor(input.actorDescriptor, 'v33_38_possession_actor_invalid');
  if (input.actor.keyId !== input.actorDescriptor.keyId) throw new Error('v33_38_possession_actor_binding_invalid');
  const material = {
    version: '33.38' as const,
    statementId: randomUUID(),
    proposalDigest: input.proposalDigest,
    purpose: input.purpose,
    actorKeyId: input.actor.keyId,
    actorKeyFingerprint: input.actorDescriptor.keyFingerprint,
    signedAt: input.signedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, statementDigest: sha256(material) }, input.actor);
}

export function createSecurityCustodianApprovalV33_38(input: {
  readonly custodian: SigningIdentity;
  readonly custodianDescriptor: QualificationActorDescriptorV33_36;
  readonly proposalDigest: string;
  readonly approvedAt: Date;
}): SignedEnvelope<SecurityCustodianApprovalV33_38> {
  requireDate(input.approvedAt, 'v33_38_security_approval_time_invalid');
  requireDigest(input.proposalDigest, 'v33_38_security_approval_proposal_invalid');
  assertDescriptor(input.custodianDescriptor, 'v33_38_security_custodian_invalid');
  if (input.custodian.keyId !== input.custodianDescriptor.keyId) throw new Error('v33_38_security_custodian_binding_invalid');
  const material = {
    version: '33.38' as const,
    approvalId: randomUUID(),
    proposalDigest: input.proposalDigest,
    custodianKeyId: input.custodian.keyId,
    custodianOrganizationId: input.custodianDescriptor.organizationId,
    custodianHostId: input.custodianDescriptor.hostId,
    custodianAdministratorId: input.custodianDescriptor.administratorId,
    decision: 'APPROVE_KEY_LIFECYCLE_CHANGE' as const,
    approvedAt: input.approvedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, approvalDigest: sha256(material) }, input.custodian);
}

export function finalizeRoleLifecycleChangeV33_38(input: {
  readonly lifecycleAuthority: SigningIdentity;
  readonly proposal: SignedEnvelope<RoleLifecycleProposalV33_38>;
  readonly currentKeyConsent: SignedEnvelope<RolePossessionStatementV33_38> | null;
  readonly replacementKeyAcceptance: SignedEnvelope<RolePossessionStatementV33_38> | null;
  readonly securityApprovals: readonly SignedEnvelope<SecurityCustodianApprovalV33_38>[];
  readonly trust: CustodyTrustV33_38;
  readonly finalizedAt: Date;
}): SignedEnvelope<RoleLifecycleCertificateV33_38> {
  requireDate(input.finalizedAt, 'v33_38_lifecycle_finalize_time_invalid');
  const proposal = input.proposal.payload;
  if (!input.trust.trustedLifecycleAuthorityIds.includes(input.proposal.issuerKeyId) || input.proposal.issuerKeyId !== input.lifecycleAuthority.keyId || !input.trust.lifecycleAuthorityRegistry.verifyAt(input.proposal, input.finalizedAt)) throw new Error('v33_38_lifecycle_proposal_signature_invalid');
  if (proposal.proposalDigest !== digestWithout(proposal, 'proposalDigest') || proposal.lifecycleAuthorityKeyId !== input.lifecycleAuthority.keyId) throw new Error('v33_38_lifecycle_proposal_binding_invalid');
  assertBoundary(proposal, 'v33_38_lifecycle_proposal_boundary_invalid');
  const verifyPossession = (statementEnvelope: SignedEnvelope<RolePossessionStatementV33_38>, expected: QualificationActorDescriptorV33_36, purpose: RolePossessionPurposeV33_38): string => {
    const statement = statementEnvelope.payload;
    if (statementEnvelope.issuerKeyId !== expected.keyId || !input.trust.roleRegistry.verifyAt(statementEnvelope, input.finalizedAt)) throw new Error('v33_38_possession_signature_invalid');
    verifyDescriptorFingerprint(input.trust.roleRegistry, expected, 'v33_38_possession_fingerprint_invalid');
    if (statement.statementDigest !== digestWithout(statement, 'statementDigest') || statement.proposalDigest !== proposal.proposalDigest || statement.purpose !== purpose || statement.actorKeyId !== expected.keyId || statement.actorKeyFingerprint !== expected.keyFingerprint) throw new Error('v33_38_possession_binding_invalid');
    assertBoundary(statement, 'v33_38_possession_boundary_invalid');
    return statement.statementDigest;
  };
  let currentConsentDigest: string | null = null;
  let replacementAcceptanceDigest: string | null = null;
  if (proposal.action === 'SCHEDULED_ROTATION') {
    if (input.currentKeyConsent === null || input.replacementKeyAcceptance === null || proposal.replacementActor === null) throw new Error('v33_38_scheduled_rotation_proof_missing');
    currentConsentDigest = verifyPossession(input.currentKeyConsent, proposal.currentActor, 'CURRENT_KEY_CONSENT');
    replacementAcceptanceDigest = verifyPossession(input.replacementKeyAcceptance, proposal.replacementActor, 'REPLACEMENT_KEY_ACCEPTANCE');
  } else if (proposal.action === 'EMERGENCY_ROTATION') {
    if (input.currentKeyConsent !== null || input.replacementKeyAcceptance === null || proposal.replacementActor === null) throw new Error('v33_38_emergency_rotation_proof_invalid');
    replacementAcceptanceDigest = verifyPossession(input.replacementKeyAcceptance, proposal.replacementActor, 'REPLACEMENT_KEY_ACCEPTANCE');
  } else if (input.currentKeyConsent !== null || input.replacementKeyAcceptance !== null || proposal.replacementActor !== null) throw new Error('v33_38_revocation_proof_invalid');
  const requiredApprovals = proposal.action === 'SCHEDULED_ROTATION' ? 2 : 3;
  if (input.securityApprovals.length < requiredApprovals) throw new Error('v33_38_security_quorum_invalid');
  const custodianRows: QualificationActorDescriptorV33_36[] = [];
  const approvalDigests: string[] = [];
  for (const approvalEnvelope of input.securityApprovals) {
    const approval = approvalEnvelope.payload;
    if (!input.trust.trustedSecurityCustodianIds.includes(approvalEnvelope.issuerKeyId) || !input.trust.securityCustodianRegistry.verifyAt(approvalEnvelope, input.finalizedAt)) throw new Error('v33_38_security_approval_signature_invalid');
    if (approval.approvalDigest !== digestWithout(approval, 'approvalDigest') || approval.proposalDigest !== proposal.proposalDigest || approval.decision !== 'APPROVE_KEY_LIFECYCLE_CHANGE') throw new Error('v33_38_security_approval_binding_invalid');
    assertBoundary(approval, 'v33_38_security_approval_boundary_invalid');
    custodianRows.push({ keyId: approval.custodianKeyId, keyFingerprint: input.trust.securityCustodianRegistry.fingerprint(approval.custodianKeyId) ?? '', organizationId: approval.custodianOrganizationId, hostId: approval.custodianHostId, administratorId: approval.custodianAdministratorId });
    approvalDigests.push(approval.approvalDigest);
  }
  if (!descriptorsSeparated(custodianRows) || new Set(custodianRows.map((row) => row.keyId)).size !== input.securityApprovals.length || custodianRows.some((row) => row.keyId === proposal.lifecycleAuthorityKeyId || row.keyId === proposal.currentActor.keyId || row.keyId === proposal.replacementActor?.keyId)) throw new Error('v33_38_security_custodian_separation_invalid');
  const sortedApprovals = [...approvalDigests].sort();
  const sortedCustodians = [...custodianRows.map((row) => row.keyId)].sort();
  const material = {
    version: '33.38' as const,
    certificateId: randomUUID(),
    proposalDigest: proposal.proposalDigest,
    manifestDigest: proposal.manifestDigest,
    transcriptDigest: proposal.transcriptDigest,
    lifecycleSequence: proposal.lifecycleSequence,
    previousLifecycleDigest: proposal.previousLifecycleDigest,
    roleSlot: proposal.roleSlot,
    action: proposal.action,
    currentActor: proposal.currentActor,
    replacementActor: proposal.replacementActor,
    currentKeyConsentDigest: currentConsentDigest,
    replacementKeyAcceptanceDigest: replacementAcceptanceDigest,
    securityApprovalDigests: sortedApprovals,
    securityCustodianKeyIds: sortedCustodians,
    effectiveAt: proposal.effectiveAt,
    lifecycleAuthorityKeyId: proposal.lifecycleAuthorityKeyId,
    oldKeyRevoked: true as const,
    decision: 'KEY_LIFECYCLE_CHANGE_AUTHORIZED' as const,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, lifecycleDigest: sha256(material) }, input.lifecycleAuthority);
}

export function verifyRoleLifecycleEvidenceV33_38(input: {
  readonly evidence: RoleLifecycleEvidenceV33_38;
  readonly trust: CustodyTrustV33_38;
  readonly manifest: ExternalQualificationDeploymentManifestV33_37;
  readonly transcriptDigest: string;
  readonly verifiedAt: Date;
}): SignedEnvelope<RoleLifecycleCertificateV33_38> {
  requireDate(input.verifiedAt, 'v33_38_lifecycle_evidence_time_invalid');
  const { proposal: proposalEnvelope, currentKeyConsent, replacementKeyAcceptance, securityApprovals, certificate: certificateEnvelope } = input.evidence;
  const proposal = proposalEnvelope.payload;
  if (!input.trust.trustedLifecycleAuthorityIds.includes(proposalEnvelope.issuerKeyId) || !input.trust.lifecycleAuthorityRegistry.verifyAt(proposalEnvelope, input.verifiedAt)) throw new Error('v33_38_lifecycle_proposal_signature_invalid');
  if (proposal.proposalDigest !== digestWithout(proposal, 'proposalDigest') || proposal.lifecycleAuthorityKeyId !== proposalEnvelope.issuerKeyId || proposal.manifestDigest !== input.manifest.manifestDigest || proposal.transcriptDigest !== input.transcriptDigest) throw new Error('v33_38_lifecycle_proposal_binding_invalid');
  if (!Number.isSafeInteger(proposal.lifecycleSequence) || proposal.lifecycleSequence < 1 || (proposal.lifecycleSequence === 1 ? proposal.previousLifecycleDigest !== null : proposal.previousLifecycleDigest === null)) throw new Error('v33_38_lifecycle_sequence_invalid');
  if (proposal.previousLifecycleDigest !== null) requireDigest(proposal.previousLifecycleDigest, 'v33_38_lifecycle_previous_invalid');
  const effectiveAt = new Date(proposal.effectiveAt);
  requireDate(effectiveAt, 'v33_38_lifecycle_effective_time_invalid');
  if (effectiveAt.getTime() > input.verifiedAt.getTime()) throw new Error('v33_38_lifecycle_not_effective');
  assertDescriptor(proposal.currentActor, 'v33_38_lifecycle_current_actor_invalid');
  if (proposal.action === 'REVOCATION_ONLY') {
    if (proposal.replacementActor !== null) throw new Error('v33_38_revocation_replacement_invalid');
  } else {
    if (proposal.replacementActor === null) throw new Error('v33_38_rotation_replacement_required');
    assertDescriptor(proposal.replacementActor, 'v33_38_lifecycle_replacement_actor_invalid');
    if (!descriptorsSeparated([proposal.currentActor, proposal.replacementActor])) throw new Error('v33_38_rotation_separation_invalid');
  }
  assertBoundary(proposal, 'v33_38_lifecycle_proposal_boundary_invalid');

  const verifyPossession = (statementEnvelope: SignedEnvelope<RolePossessionStatementV33_38>, expected: QualificationActorDescriptorV33_36, purpose: RolePossessionPurposeV33_38): string => {
    const statement = statementEnvelope.payload;
    if (statementEnvelope.issuerKeyId !== expected.keyId || !input.trust.roleRegistry.verifyAt(statementEnvelope, input.verifiedAt)) throw new Error('v33_38_possession_signature_invalid');
    verifyDescriptorFingerprint(input.trust.roleRegistry, expected, 'v33_38_possession_fingerprint_invalid');
    if (statement.statementDigest !== digestWithout(statement, 'statementDigest') || statement.proposalDigest !== proposal.proposalDigest || statement.purpose !== purpose || statement.actorKeyId !== expected.keyId || statement.actorKeyFingerprint !== expected.keyFingerprint) throw new Error('v33_38_possession_binding_invalid');
    assertBoundary(statement, 'v33_38_possession_boundary_invalid');
    return statement.statementDigest;
  };
  let currentConsentDigest: string | null = null;
  let replacementAcceptanceDigest: string | null = null;
  if (proposal.action === 'SCHEDULED_ROTATION') {
    if (currentKeyConsent === null || replacementKeyAcceptance === null || proposal.replacementActor === null) throw new Error('v33_38_scheduled_rotation_proof_missing');
    currentConsentDigest = verifyPossession(currentKeyConsent, proposal.currentActor, 'CURRENT_KEY_CONSENT');
    replacementAcceptanceDigest = verifyPossession(replacementKeyAcceptance, proposal.replacementActor, 'REPLACEMENT_KEY_ACCEPTANCE');
  } else if (proposal.action === 'EMERGENCY_ROTATION') {
    if (currentKeyConsent !== null || replacementKeyAcceptance === null || proposal.replacementActor === null) throw new Error('v33_38_emergency_rotation_proof_invalid');
    replacementAcceptanceDigest = verifyPossession(replacementKeyAcceptance, proposal.replacementActor, 'REPLACEMENT_KEY_ACCEPTANCE');
  } else if (currentKeyConsent !== null || replacementKeyAcceptance !== null || proposal.replacementActor !== null) throw new Error('v33_38_revocation_proof_invalid');

  const requiredApprovals = proposal.action === 'SCHEDULED_ROTATION' ? 2 : 3;
  if (securityApprovals.length < requiredApprovals) throw new Error('v33_38_security_quorum_invalid');
  const approvalDigests: string[] = [];
  const custodianRows: QualificationActorDescriptorV33_36[] = [];
  for (const approvalEnvelope of securityApprovals) {
    const approval = approvalEnvelope.payload;
    if (!input.trust.trustedSecurityCustodianIds.includes(approvalEnvelope.issuerKeyId) || approvalEnvelope.issuerKeyId !== approval.custodianKeyId || !input.trust.securityCustodianRegistry.verifyAt(approvalEnvelope, input.verifiedAt)) throw new Error('v33_38_security_approval_signature_invalid');
    if (approval.approvalDigest !== digestWithout(approval, 'approvalDigest') || approval.proposalDigest !== proposal.proposalDigest || approval.decision !== 'APPROVE_KEY_LIFECYCLE_CHANGE') throw new Error('v33_38_security_approval_binding_invalid');
    assertBoundary(approval, 'v33_38_security_approval_boundary_invalid');
    const row = { keyId: approval.custodianKeyId, keyFingerprint: input.trust.securityCustodianRegistry.fingerprint(approval.custodianKeyId) ?? '', organizationId: approval.custodianOrganizationId, hostId: approval.custodianHostId, administratorId: approval.custodianAdministratorId };
    verifyDescriptorFingerprint(input.trust.securityCustodianRegistry, row, 'v33_38_security_custodian_fingerprint_invalid');
    custodianRows.push(row);
    approvalDigests.push(approval.approvalDigest);
  }
  if (!descriptorsSeparated(custodianRows) || new Set(custodianRows.map((row) => row.keyId)).size !== securityApprovals.length || custodianRows.some((row) => row.keyId === proposal.lifecycleAuthorityKeyId || row.keyId === proposal.currentActor.keyId || row.keyId === proposal.replacementActor?.keyId)) throw new Error('v33_38_security_custodian_separation_invalid');

  const certificate = certificateEnvelope.payload;
  if (certificateEnvelope.issuerKeyId !== proposalEnvelope.issuerKeyId || !input.trust.trustedLifecycleAuthorityIds.includes(certificateEnvelope.issuerKeyId) || !input.trust.lifecycleAuthorityRegistry.verifyAt(certificateEnvelope, input.verifiedAt)) throw new Error('v33_38_lifecycle_certificate_signature_invalid');
  if (certificate.lifecycleDigest !== digestWithout(certificate, 'lifecycleDigest') || certificate.proposalDigest !== proposal.proposalDigest || certificate.manifestDigest !== proposal.manifestDigest || certificate.transcriptDigest !== proposal.transcriptDigest || certificate.lifecycleSequence !== proposal.lifecycleSequence || certificate.previousLifecycleDigest !== proposal.previousLifecycleDigest || certificate.roleSlot !== proposal.roleSlot || certificate.action !== proposal.action || !descriptorEquals(certificate.currentActor, proposal.currentActor) || (certificate.replacementActor === null ? proposal.replacementActor !== null : proposal.replacementActor === null || !descriptorEquals(certificate.replacementActor, proposal.replacementActor)) || certificate.currentKeyConsentDigest !== currentConsentDigest || certificate.replacementKeyAcceptanceDigest !== replacementAcceptanceDigest || JSON.stringify(certificate.securityApprovalDigests) !== JSON.stringify([...approvalDigests].sort()) || JSON.stringify(certificate.securityCustodianKeyIds) !== JSON.stringify([...custodianRows.map((row) => row.keyId)].sort()) || certificate.effectiveAt !== proposal.effectiveAt || certificate.lifecycleAuthorityKeyId !== proposal.lifecycleAuthorityKeyId || certificate.oldKeyRevoked !== true || certificate.decision !== 'KEY_LIFECYCLE_CHANGE_AUTHORIZED') throw new Error('v33_38_lifecycle_evidence_binding_invalid');
  assertBoundary(certificate, 'v33_38_lifecycle_certificate_boundary_invalid');
  return certificateEnvelope;
}

export function verifyRoleLifecycleChainV33_38(input: {
  readonly certificates: readonly SignedEnvelope<RoleLifecycleCertificateV33_38>[];
  readonly trust: CustodyTrustV33_38;
  readonly manifest: ExternalQualificationDeploymentManifestV33_37;
  readonly transcriptDigest: string;
  readonly verifiedAt: Date;
}): { readonly headDigest: string | null; readonly activeActors: ReadonlyMap<CustodyRoleSlotV33_38, QualificationActorDescriptorV33_36 | null>; readonly revokedKeyIds: ReadonlySet<string> } {
  requireDate(input.verifiedAt, 'v33_38_lifecycle_chain_time_invalid');
  let previous: string | null = null;
  const active = new Map<CustodyRoleSlotV33_38, QualificationActorDescriptorV33_36 | null>();
  const revoked = new Set<string>();
  input.certificates.forEach((certificateEnvelope, index) => {
    const certificate = certificateEnvelope.payload;
    if (!input.trust.trustedLifecycleAuthorityIds.includes(certificateEnvelope.issuerKeyId) || !input.trust.lifecycleAuthorityRegistry.verifyAt(certificateEnvelope, input.verifiedAt)) throw new Error('v33_38_lifecycle_certificate_signature_invalid');
    if (certificate.lifecycleDigest !== digestWithout(certificate, 'lifecycleDigest') || certificate.lifecycleSequence !== index + 1 || certificate.previousLifecycleDigest !== previous || certificate.manifestDigest !== input.manifest.manifestDigest || certificate.transcriptDigest !== input.transcriptDigest || certificate.decision !== 'KEY_LIFECYCLE_CHANGE_AUTHORIZED' || certificate.oldKeyRevoked !== true) throw new Error('v33_38_lifecycle_chain_invalid');
    assertBoundary(certificate, 'v33_38_lifecycle_certificate_boundary_invalid');
    const current = active.get(certificate.roleSlot);
    const expectedCurrent = current === undefined ? assignmentFor(input.manifest, certificate.roleSlot).actor : current;
    if (expectedCurrent === null || !descriptorEquals(expectedCurrent, certificate.currentActor)) throw new Error('v33_38_lifecycle_current_actor_invalid');
    if (revoked.has(certificate.currentActor.keyId)) throw new Error('v33_38_lifecycle_key_resurrection');
    revoked.add(certificate.currentActor.keyId);
    if (certificate.replacementActor !== null) {
      if (revoked.has(certificate.replacementActor.keyId)) throw new Error('v33_38_lifecycle_replacement_revoked');
      active.set(certificate.roleSlot, certificate.replacementActor);
    } else active.set(certificate.roleSlot, null);
    previous = certificate.lifecycleDigest;
  });
  return { headDigest: previous, activeActors: active, revokedKeyIds: revoked };
}

export function createRoleActionAssertionV33_38(input: {
  readonly actor: SigningIdentity;
  readonly manifestDigest: string;
  readonly transcriptDigest: string;
  readonly roleSlot: CustodyRoleSlotV33_38;
  readonly lifecycleHeadDigest: string | null;
  readonly actionBytes: Uint8Array;
  readonly actedAt: Date;
}): SignedEnvelope<RoleActionAssertionV33_38> {
  requireDate(input.actedAt, 'v33_38_role_action_time_invalid');
  requireDigest(input.manifestDigest, 'v33_38_role_action_manifest_invalid');
  requireDigest(input.transcriptDigest, 'v33_38_role_action_transcript_invalid');
  if (input.lifecycleHeadDigest !== null) requireDigest(input.lifecycleHeadDigest, 'v33_38_role_action_lifecycle_invalid');
  const material = {
    version: '33.38' as const,
    assertionId: randomUUID(),
    manifestDigest: input.manifestDigest,
    transcriptDigest: input.transcriptDigest,
    roleSlot: input.roleSlot,
    actorKeyId: input.actor.keyId,
    lifecycleHeadDigest: input.lifecycleHeadDigest,
    actionDigest: sha256Bytes(input.actionBytes),
    actedAt: input.actedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, assertionDigest: sha256(material) }, input.actor);
}

export function verifyRoleActionAssertionV33_38(input: {
  readonly assertion: SignedEnvelope<RoleActionAssertionV33_38>;
  readonly manifest: ExternalQualificationDeploymentManifestV33_37;
  readonly lifecycleCertificates: readonly SignedEnvelope<RoleLifecycleCertificateV33_38>[];
  readonly trust: CustodyTrustV33_38;
  readonly manifestDigest: string;
  readonly transcriptDigest: string;
  readonly verifiedAt: Date;
}): void {
  const chain = verifyRoleLifecycleChainV33_38({ certificates: input.lifecycleCertificates, trust: input.trust, manifest: input.manifest, transcriptDigest: input.transcriptDigest, verifiedAt: input.verifiedAt });
  const assertion = input.assertion.payload;
  if (assertion.assertionDigest !== digestWithout(assertion, 'assertionDigest') || assertion.manifestDigest !== input.manifestDigest || assertion.transcriptDigest !== input.transcriptDigest || assertion.lifecycleHeadDigest !== chain.headDigest) throw new Error('v33_38_role_action_binding_invalid');
  assertBoundary(assertion, 'v33_38_role_action_boundary_invalid');
  const active = chain.activeActors.has(assertion.roleSlot) ? chain.activeActors.get(assertion.roleSlot)! : assignmentFor(input.manifest, assertion.roleSlot).actor;
  if (active === null || assertion.actorKeyId !== active.keyId || input.assertion.issuerKeyId !== active.keyId || !input.trust.roleRegistry.verifyAt(input.assertion, input.verifiedAt)) throw new Error('v33_38_role_action_key_inactive');
  verifyDescriptorFingerprint(input.trust.roleRegistry, active, 'v33_38_role_action_fingerprint_invalid');
}

export class CustodyReceiptTransparencyLogV33_38 {
  readonly #events: CustodyTransparencyEventV33_38[] = [];
  constructor(readonly logId: string, readonly signer: SigningIdentity) { requireText(logId, 'v33_38_log_id_required'); }
  append(eventType: CustodyTransparencyEventTypeV33_38, subjectDigest: string, roleSlot: CustodyRoleSlotV33_38 | null, recordedAt: Date): SignedEnvelope<CustodyTransparencyEventV33_38> {
    requireDate(recordedAt, 'v33_38_log_time_invalid');
    requireDigest(subjectDigest, 'v33_38_log_subject_invalid');
    const previousEventDigest = this.#events.at(-1)?.eventDigest ?? null;
    const material = {
      version: '33.38' as const,
      logId: this.logId,
      sequence: this.#events.length + 1,
      eventId: randomUUID(),
      eventType,
      subjectDigest,
      roleSlot,
      previousEventDigest,
      recordedAt: recordedAt.toISOString(),
      productionAuthority: 'NONE' as const,
      externalEffectsExecuted: 0 as const,
    };
    const event = { ...material, eventDigest: sha256(material) };
    this.#events.push(event);
    return signEnvelope(event, this.signer);
  }
  snapshot(generatedAt: Date): SignedEnvelope<CustodyTransparencySnapshotV33_38> {
    requireDate(generatedAt, 'v33_38_snapshot_time_invalid');
    const material = {
      version: '33.38' as const,
      logId: this.logId,
      eventCount: this.#events.length,
      headEventDigest: this.#events.at(-1)?.eventDigest ?? null,
      events: [...this.#events],
      generatedAt: generatedAt.toISOString(),
      productionAuthority: 'NONE' as const,
      externalEffectsExecuted: 0 as const,
    };
    return signEnvelope({ ...material, snapshotDigest: sha256(material) }, this.signer);
  }
}

export function verifyCustodyTransparencySnapshotV33_38(input: {
  readonly snapshot: SignedEnvelope<CustodyTransparencySnapshotV33_38>;
  readonly trust: CustodyTrustV33_38;
  readonly verifiedAt: Date;
  readonly previousSnapshot?: SignedEnvelope<CustodyTransparencySnapshotV33_38>;
}): void {
  requireDate(input.verifiedAt, 'v33_38_snapshot_verification_time_invalid');
  if (!input.trust.trustedTransparencyLogIds.includes(input.snapshot.issuerKeyId) || !input.trust.transparencyLogRegistry.verifyAt(input.snapshot, input.verifiedAt)) throw new Error('v33_38_snapshot_signature_invalid');
  const snapshot = input.snapshot.payload;
  if (snapshot.snapshotDigest !== digestWithout(snapshot, 'snapshotDigest') || snapshot.eventCount !== snapshot.events.length) throw new Error('v33_38_snapshot_binding_invalid');
  assertBoundary(snapshot, 'v33_38_snapshot_boundary_invalid');
  let previous: string | null = null;
  snapshot.events.forEach((event, index) => {
    if (event.logId !== snapshot.logId || event.sequence !== index + 1 || event.previousEventDigest !== previous || event.eventDigest !== digestWithout(event, 'eventDigest')) throw new Error('v33_38_log_chain_invalid');
    assertBoundary(event, 'v33_38_log_event_boundary_invalid');
    previous = event.eventDigest;
  });
  if (snapshot.headEventDigest !== previous) throw new Error('v33_38_log_head_invalid');
  if (input.previousSnapshot !== undefined) {
    verifyCustodyTransparencySnapshotV33_38({ snapshot: input.previousSnapshot, trust: input.trust, verifiedAt: input.verifiedAt });
    const prior = input.previousSnapshot.payload;
    if (prior.logId !== snapshot.logId || prior.eventCount > snapshot.eventCount || prior.events.some((event, index) => snapshot.events[index]?.eventDigest !== event.eventDigest)) throw new Error('v33_38_log_rollback_or_fork');
  }
}

export function createCustodyTransparencyWitnessV33_38(input: {
  readonly witness: SigningIdentity;
  readonly witnessDescriptor: QualificationActorDescriptorV33_36;
  readonly snapshot: CustodyTransparencySnapshotV33_38;
  readonly observedAt: Date;
}): SignedEnvelope<CustodyTransparencyWitnessV33_38> {
  requireDate(input.observedAt, 'v33_38_checkpoint_time_invalid');
  assertDescriptor(input.witnessDescriptor, 'v33_38_checkpoint_witness_invalid');
  if (input.witness.keyId !== input.witnessDescriptor.keyId) throw new Error('v33_38_checkpoint_witness_binding_invalid');
  const material = {
    version: '33.38' as const,
    checkpointId: randomUUID(),
    snapshotDigest: input.snapshot.snapshotDigest,
    logId: input.snapshot.logId,
    eventCount: input.snapshot.eventCount,
    headEventDigest: input.snapshot.headEventDigest,
    witnessKeyId: input.witness.keyId,
    witnessOrganizationId: input.witnessDescriptor.organizationId,
    witnessHostId: input.witnessDescriptor.hostId,
    witnessAdministratorId: input.witnessDescriptor.administratorId,
    observedAt: input.observedAt.toISOString(),
    decision: 'TRANSPARENCY_CHECKPOINT_OBSERVED' as const,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, checkpointDigest: sha256(material) }, input.witness);
}

export function verifyCustodyTransparencyCheckpointV33_38(input: {
  readonly snapshot: SignedEnvelope<CustodyTransparencySnapshotV33_38>;
  readonly witnesses: readonly SignedEnvelope<CustodyTransparencyWitnessV33_38>[];
  readonly trust: CustodyTrustV33_38;
  readonly verifiedAt: Date;
}): void {
  verifyCustodyTransparencySnapshotV33_38({ snapshot: input.snapshot, trust: input.trust, verifiedAt: input.verifiedAt });
  if (input.witnesses.length < 2) throw new Error('v33_38_checkpoint_quorum_invalid');
  const rows: QualificationActorDescriptorV33_36[] = [];
  for (const envelope of input.witnesses) {
    const witness = envelope.payload;
    if (!input.trust.trustedTransparencyWitnessIds.includes(envelope.issuerKeyId) || !input.trust.transparencyWitnessRegistry.verifyAt(envelope, input.verifiedAt)) throw new Error('v33_38_checkpoint_signature_invalid');
    if (witness.checkpointDigest !== digestWithout(witness, 'checkpointDigest') || witness.snapshotDigest !== input.snapshot.payload.snapshotDigest || witness.logId !== input.snapshot.payload.logId || witness.eventCount !== input.snapshot.payload.eventCount || witness.headEventDigest !== input.snapshot.payload.headEventDigest || witness.decision !== 'TRANSPARENCY_CHECKPOINT_OBSERVED') throw new Error('v33_38_checkpoint_binding_invalid');
    assertBoundary(witness, 'v33_38_checkpoint_boundary_invalid');
    rows.push({ keyId: witness.witnessKeyId, keyFingerprint: input.trust.transparencyWitnessRegistry.fingerprint(witness.witnessKeyId) ?? '', organizationId: witness.witnessOrganizationId, hostId: witness.witnessHostId, administratorId: witness.witnessAdministratorId });
  }
  if (!descriptorsSeparated(rows) || new Set(rows.map((row) => row.keyId)).size !== input.witnesses.length || rows.some((row) => row.keyId === input.snapshot.issuerKeyId)) throw new Error('v33_38_checkpoint_witness_separation_invalid');
}

export function detectCustodyTransparencySplitViewV33_38(snapshots: readonly SignedEnvelope<CustodyTransparencySnapshotV33_38>[]): boolean {
  const byCoordinate = new Map<string, Set<string | null>>();
  for (const snapshot of snapshots) {
    const key = `${snapshot.payload.logId}:${snapshot.payload.eventCount}`;
    const heads = byCoordinate.get(key) ?? new Set<string | null>();
    heads.add(snapshot.payload.headEventDigest);
    byCoordinate.set(key, heads);
  }
  return [...byCoordinate.values()].some((heads) => heads.size > 1);
}

export function verifyExternalCustodyQualificationV33_38(input: {
  readonly manifest: SignedEnvelope<ExternalQualificationDeploymentManifestV33_37>;
  readonly ceremonyVerdict: CustodyCeremonyVerdictV33_38;
  readonly provisioningChallenges: readonly SignedEnvelope<ProvisioningChallengeV33_38>[];
  readonly provisioningResponses: readonly SignedEnvelope<ProvisioningResponseV33_38>[];
  readonly provisioningReceipts: readonly SignedEnvelope<ProvisioningReceiptV33_38>[];
  readonly ceremonyTranscript: SignedEnvelope<CustodyCeremonyTranscriptV33_38>;
  readonly ceremonyWitnesses: readonly SignedEnvelope<CustodyCeremonyWitnessV33_38>[];
  readonly lifecycleEvidence: readonly RoleLifecycleEvidenceV33_38[];
  readonly importReceipt: ExternalQualificationImportReceiptV33_37;
  readonly importReadiness: DeploymentReadinessVerdictV33_37;
  readonly importChallenge: SignedEnvelope<ExternalQualificationImportChallengeV33_37>;
  readonly importBundle: SignedEnvelope<ExternalQualificationEvidenceBundleV33_37>;
  readonly importFileBytes: Readonly<Record<string, Uint8Array>>;
  readonly importRecovery: SignedEnvelope<DurableReceiptRecoveryAttestationV33_37>;
  readonly importTrust: ExternalQualificationImportTrustV33_37;
  readonly transparencySnapshot: SignedEnvelope<CustodyTransparencySnapshotV33_38>;
  readonly transparencyWitnesses: readonly SignedEnvelope<CustodyTransparencyWitnessV33_38>[];
  readonly trust: CustodyTrustV33_38;
  readonly verifiedAt: Date;
}): ExternalCustodyQualificationVerdictV33_38 {
  requireDate(input.verifiedAt, 'v33_38_final_verification_time_invalid');
  const manifest = input.manifest.payload;
  if (!input.trust.trustedDeploymentAuthorityIds.includes(input.manifest.issuerKeyId) || !input.trust.deploymentAuthorityRegistry.verifyAt(input.manifest, input.verifiedAt)) throw new Error('v33_38_manifest_signature_invalid');
  if (input.ceremonyVerdict.verdictDigest !== digestWithout(input.ceremonyVerdict, 'verdictDigest') || input.ceremonyVerdict.manifestDigest !== manifest.manifestDigest || input.ceremonyVerdict.verifiedRoleCount !== 11) throw new Error('v33_38_ceremony_verdict_invalid');
  const recomputedCeremonyVerdict = verifyCustodyCeremonyV33_38({
    manifest: input.manifest,
    challenges: input.provisioningChallenges,
    responses: input.provisioningResponses,
    receipts: input.provisioningReceipts,
    transcript: input.ceremonyTranscript,
    witnesses: input.ceremonyWitnesses,
    trust: input.trust,
    verifiedAt: new Date(input.ceremonyVerdict.verifiedAt),
  });
  if (recomputedCeremonyVerdict.verdictDigest !== input.ceremonyVerdict.verdictDigest) throw new Error('v33_38_ceremony_verdict_recomputation_invalid');
  if (input.importReceipt.importDigest !== digestWithout(input.importReceipt, 'importDigest') || input.importReceipt.manifestDigest !== manifest.manifestDigest || input.importReceipt.productionAuthority !== 'NONE' || input.importReceipt.externalEffectsExecuted !== 0) throw new Error('v33_38_import_receipt_invalid');
  const recomputedImportReceipt = verifyExternalQualificationEvidenceImportV33_37({
    manifest: input.manifest,
    readiness: input.importReadiness,
    challenge: input.importChallenge,
    bundle: input.importBundle,
    fileBytes: input.importFileBytes,
    recovery: input.importRecovery,
    trust: input.importTrust,
    consumedChallengeDigests: new Set<string>(),
    importedAt: new Date(input.importReceipt.importedAt),
  });
  if (recomputedImportReceipt.importDigest !== input.importReceipt.importDigest) throw new Error('v33_38_import_receipt_recomputation_invalid');
  const lifecycleCertificates = input.lifecycleEvidence.map((evidence) => verifyRoleLifecycleEvidenceV33_38({ evidence, trust: input.trust, manifest, transcriptDigest: input.ceremonyVerdict.transcriptDigest, verifiedAt: input.verifiedAt }));
  const lifecycle = verifyRoleLifecycleChainV33_38({ certificates: lifecycleCertificates, trust: input.trust, manifest, transcriptDigest: input.ceremonyVerdict.transcriptDigest, verifiedAt: input.verifiedAt });
  verifyCustodyTransparencyCheckpointV33_38({ snapshot: input.transparencySnapshot, witnesses: input.transparencyWitnesses, trust: input.trust, verifiedAt: input.verifiedAt });
  const events = input.transparencySnapshot.payload.events;
  const requiredProvisioningDigests = new Set(input.provisioningReceipts.map((row) => row.payload.receiptDigest));
  const loggedProvisioningDigests = new Set(events.filter((event) => event.eventType === 'ROLE_PROVISIONED').map((event) => event.subjectDigest));
  if (requiredProvisioningDigests.size !== 11 || [...requiredProvisioningDigests].some((digest) => !loggedProvisioningDigests.has(digest))) throw new Error('v33_38_provisioning_log_incomplete');
  if (!events.some((event) => event.eventType === 'CEREMONY_CLOSED' && event.subjectDigest === input.ceremonyVerdict.transcriptDigest)) throw new Error('v33_38_transcript_not_logged');
  if (!events.some((event) => event.eventType === 'EVIDENCE_IMPORTED' && event.subjectDigest === input.importReceipt.importDigest)) throw new Error('v33_38_import_not_logged');
  for (const certificate of lifecycleCertificates) if (!events.some((event) => event.eventType === 'KEY_LIFECYCLE_CHANGED' && event.subjectDigest === certificate.payload.lifecycleDigest && event.roleSlot === certificate.payload.roleSlot)) throw new Error('v33_38_lifecycle_not_logged');
  if (input.transparencySnapshot.payload.headEventDigest === null) throw new Error('v33_38_empty_transparency_log');
  const external = recomputedCeremonyVerdict.executionClass === 'LIVE_EXTERNAL' && recomputedImportReceipt.status === 'EXTERNAL_EVIDENCE_ACCEPTED' && recomputedImportReceipt.externalTopologyObserved === true;
  const material = {
    version: '33.38' as const,
    manifestDigest: manifest.manifestDigest,
    transcriptDigest: input.ceremonyVerdict.transcriptDigest,
    importDigest: input.importReceipt.importDigest,
    transparencySnapshotDigest: input.transparencySnapshot.payload.snapshotDigest,
    transparencyHeadEventDigest: input.transparencySnapshot.payload.headEventDigest,
    lifecycleHeadDigest: lifecycle.headDigest,
    provisionedRoleCount: 11 as const,
    transparencyWitnessCount: input.transparencyWitnesses.length,
    custodyChainVerified: true as const,
    lifecycleChainVerified: true as const,
    importReceiptLogged: true as const,
    status: external ? 'EXTERNAL_CUSTODY_EVIDENCE_ACCEPTED' as const : 'LOCAL_CUSTODY_IMPORT_REHEARSAL_ONLY' as const,
    externalTopologyObserved: external,
    externalHumanParticipants: 0 as const,
    verifiedAt: input.verifiedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return { ...material, verdictDigest: sha256(material) };
}
