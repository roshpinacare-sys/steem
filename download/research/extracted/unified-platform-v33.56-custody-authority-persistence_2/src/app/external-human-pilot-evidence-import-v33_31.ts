import { randomUUID } from 'node:crypto';
import {
  KeyRegistry,
  canonicalJson,
  sha256,
  sha256Bytes,
  signEnvelope,
  type SignedEnvelope,
  type SigningIdentity,
} from '../contracts/crypto.js';
import {
  evaluateControlledHumanUxPilotV33_30,
  type ControlledHumanUxPilotVerdictV33_30,
  type InstrumentedUxFlowSessionV33_30,
  type ObserverUxAssessmentV33_30,
  type UxParticipantConsentV33_30,
  type UxParticipantWithdrawalV33_30,
  type UxPilotProtocolV33_30,
  type UxPilotRoleBindingV33_30,
  type UxPilotRoleV33_30,
  type UxSessionEvidenceBundleV33_30,
} from './controlled-human-ux-pilot-v33_30.js';

export type ExternalHumanPilotEvidenceClassV33_31 = 'SYNTHETIC_REFERENCE' | 'LIVE_EXTERNAL';
export type ExternalHumanPilotEnrolledRoleV33_31 = UxPilotRoleV33_30 | 'EXPORTER';

export interface ExternalHumanPilotRoleChallengeV33_31 {
  readonly version: '33.31';
  readonly challengeId: string;
  readonly studyId: string;
  readonly protocolDigest: string;
  readonly subjectId: string;
  readonly role: ExternalHumanPilotEnrolledRoleV33_31;
  readonly organizationId: string;
  readonly hostId: string;
  readonly keyId: string;
  readonly keyFingerprint: string;
  readonly evidenceClass: ExternalHumanPilotEvidenceClassV33_31;
  readonly nonceDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly registrarKeyId: string;
  readonly registrarOrganizationId: string;
  readonly registrarHostId: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly challengeDigest: string;
}

export interface ExternalHumanPilotRoleOwnershipResponseV33_31 {
  readonly version: '33.31';
  readonly responseId: string;
  readonly challengeDigest: string;
  readonly studyId: string;
  readonly protocolDigest: string;
  readonly subjectId: string;
  readonly role: ExternalHumanPilotEnrolledRoleV33_31;
  readonly organizationId: string;
  readonly hostId: string;
  readonly keyId: string;
  readonly keyFingerprint: string;
  readonly evidenceClass: ExternalHumanPilotEvidenceClassV33_31;
  readonly nonceDigest: string;
  readonly respondedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly responseDigest: string;
}

export interface ExternalHumanPilotRoleEnrollmentV33_31 {
  readonly version: '33.31';
  readonly enrollmentId: string;
  readonly challengeDigest: string;
  readonly ownershipResponseDigest: string;
  readonly studyId: string;
  readonly protocolDigest: string;
  readonly subjectId: string;
  readonly role: ExternalHumanPilotEnrolledRoleV33_31;
  readonly organizationId: string;
  readonly hostId: string;
  readonly keyId: string;
  readonly keyFingerprint: string;
  readonly evidenceClass: ExternalHumanPilotEvidenceClassV33_31;
  readonly registrarKeyId: string;
  readonly registrarOrganizationId: string;
  readonly registrarHostId: string;
  readonly enrolledAt: string;
  readonly expiresAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly enrollmentDigest: string;
}

export interface ExternalHumanPilotRoleProofBundleV33_31 {
  readonly challenge: SignedEnvelope<ExternalHumanPilotRoleChallengeV33_31>;
  readonly ownershipResponse: SignedEnvelope<ExternalHumanPilotRoleOwnershipResponseV33_31>;
  readonly enrollment: SignedEnvelope<ExternalHumanPilotRoleEnrollmentV33_31>;
}

export interface ExternalHumanPilotExportChallengeV33_31 {
  readonly version: '33.31';
  readonly challengeId: string;
  readonly studyId: string;
  readonly protocolDigest: string;
  readonly expectedExporterKeyId: string;
  readonly expectedExporterFingerprint: string;
  readonly nonceDigest: string;
  readonly maximumArtifactCount: number;
  readonly maximumTotalBytes: number;
  readonly onePackageOnly: true;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly importerKeyId: string;
  readonly importerOrganizationId: string;
  readonly importerHostId: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly challengeDigest: string;
}

export interface ExternalHumanPilotObservationArtifactV33_31 {
  readonly version: '33.31';
  readonly artifactId: string;
  readonly studyId: string;
  readonly protocolDigest: string;
  readonly consentDigest: string;
  readonly participantId: string;
  readonly participantAliasDigest: string;
  readonly experienceBand: UxParticipantConsentV33_30['experienceBand'];
  readonly accessibilityAccommodationCode: UxParticipantConsentV33_30['accessibilityAccommodationCode'];
  readonly sessionId: string;
  readonly sessionDigest: string;
  readonly eventChainDigest: string;
  readonly scenarioId: string;
  readonly flow: InstrumentedUxFlowSessionV33_30['flow'];
  readonly observerKeyId: string;
  readonly observerOrganization: string;
  readonly taskSuccess: boolean;
  readonly accessibilityPassed: boolean;
  readonly comprehensionCorrect?: boolean;
  readonly errorCount: number;
  readonly observedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
}

export interface ExternalHumanPilotArtifactRecordV33_31 {
  readonly path: string;
  readonly kind: 'OBSERVATION_EVIDENCE';
  readonly mediaType: 'application/json';
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly sessionDigest: string;
  readonly participantId: string;
  readonly flow: InstrumentedUxFlowSessionV33_30['flow'];
}

export interface ExternalHumanPilotEvidenceManifestV33_31 {
  readonly version: '33.31';
  readonly packageId: string;
  readonly challengeDigest: string;
  readonly nonceDigest: string;
  readonly studyId: string;
  readonly protocolDigest: string;
  readonly evidenceClass: ExternalHumanPilotEvidenceClassV33_31;
  readonly exporterKeyId: string;
  readonly exporterOrganizationId: string;
  readonly exporterHostId: string;
  readonly roleBindingsDigest: string;
  readonly roleProofsDigest: string;
  readonly consentsDigest: string;
  readonly withdrawalsDigest: string;
  readonly baselineEvidenceDigest: string;
  readonly governedEvidenceDigest: string;
  readonly artifactManifest: readonly ExternalHumanPilotArtifactRecordV33_31[];
  readonly artifactManifestDigest: string;
  readonly participantCount: number;
  readonly baselineSessionCount: number;
  readonly governedSessionCount: number;
  readonly exportedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly packageDigest: string;
}

export interface ExternalHumanPilotEvidencePackageV33_31 {
  readonly protocol: SignedEnvelope<UxPilotProtocolV33_30>;
  readonly roleBindings: readonly UxPilotRoleBindingV33_30[];
  readonly roleProofs: readonly ExternalHumanPilotRoleProofBundleV33_31[];
  readonly consents: readonly SignedEnvelope<UxParticipantConsentV33_30>[];
  readonly withdrawals: readonly SignedEnvelope<UxParticipantWithdrawalV33_30>[];
  readonly baselineEvidence: readonly UxSessionEvidenceBundleV33_30[];
  readonly governedEvidence: readonly UxSessionEvidenceBundleV33_30[];
  readonly artifactBytesByPath: Readonly<Record<string, Uint8Array>>;
  readonly manifest: SignedEnvelope<ExternalHumanPilotEvidenceManifestV33_31>;
}

export interface ExternalHumanPilotImportCheckpointV33_31 {
  readonly version: '33.31';
  readonly checkpointId: string;
  readonly sequence: number;
  readonly previousCheckpointDigest: string | null;
  readonly consumedChallengeDigests: readonly string[];
  readonly consumedPackageDigests: readonly string[];
  readonly generatedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly checkpointDigest: string;
}

export interface ExternalHumanPilotImportReceiptV33_31 {
  readonly version: '33.31';
  readonly receiptId: string;
  readonly packageId: string;
  readonly packageDigest: string;
  readonly challengeDigest: string;
  readonly checkpointSequence: number;
  readonly evidenceClass: ExternalHumanPilotEvidenceClassV33_31;
  readonly status: 'VERIFIED_LIVE_EXTERNAL_EVIDENCE_READY_FOR_EVALUATION' | 'SYNTHETIC_REFERENCE_NOT_EXTERNAL';
  readonly participantCount: number;
  readonly externalHumanParticipants: number;
  readonly artifactCount: number;
  readonly artifactBytesVerified: true;
  readonly observationSchemaVerified: true;
  readonly roleProofsVerified: true;
  readonly roleBindingsExternallyAttested: true;
  readonly replayProtected: true;
  readonly importedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly receiptDigest: string;
}

export interface ExternalHumanPilotQualificationVerdictV33_31 {
  readonly version: '33.31';
  readonly verdictId: string;
  readonly studyId: string;
  readonly protocolDigest: string;
  readonly packageDigest: string;
  readonly importReceiptDigest: string;
  readonly baseContractVerdictDigest: string;
  readonly evidenceClass: ExternalHumanPilotEvidenceClassV33_31;
  readonly participantCount: number;
  readonly distinctScenarioCount: number;
  readonly medianStepReductionPercent: number;
  readonly medianGovernedApprovals: number;
  readonly medianComprehensionSeconds: number | null;
  readonly taskSuccessRatePercent: number;
  readonly accessibilityPassRatePercent: number;
  readonly comprehensionCorrectRatePercent: number;
  readonly evidenceClosurePercent: number;
  readonly externalProvenanceVerified: boolean;
  readonly observationArtifactsVerified: true;
  readonly roleProofsVerified: true;
  readonly replayProtected: true;
  readonly humanPilotPassed: boolean;
  readonly status:
    | 'HUMAN_UX_PILOT_PASSED_SHADOW_ONLY'
    | 'HUMAN_UX_PILOT_REQUIRED'
    | 'HUMAN_UX_PILOT_FAILED_THRESHOLDS'
    | 'HUMAN_UX_PILOT_INSUFFICIENT_EVIDENCE';
  readonly blockers: readonly string[];
  readonly generatedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly verdictDigest: string;
}

export interface ExternalHumanPilotContractTrustV33_31 {
  readonly protocolRegistry: KeyRegistry;
  readonly trustedResearcherIds: readonly string[];
  readonly participantRegistry: KeyRegistry;
  readonly trustedParticipantIds: readonly string[];
  readonly instrumentationRegistry: KeyRegistry;
  readonly trustedInstrumentationIds: readonly string[];
  readonly observerRegistry: KeyRegistry;
  readonly trustedObserverIds: readonly string[];
}

export interface ExternalHumanPilotImportTrustV33_31 {
  readonly registrarRegistry: KeyRegistry;
  readonly trustedRegistrarIds: readonly string[];
  readonly subjectRegistry: KeyRegistry;
  readonly trustedSubjectIds: readonly string[];
  readonly challengeRegistry: KeyRegistry;
  readonly trustedChallengeSignerIds: readonly string[];
  readonly exporterRegistry: KeyRegistry;
  readonly trustedExporterIds: readonly string[];
  readonly checkpointRegistry: KeyRegistry;
  readonly trustedCheckpointSignerIds: readonly string[];
}

export function issueExternalHumanPilotRoleChallengeV33_31(input: {
  readonly registrar: SigningIdentity;
  readonly registrarOrganizationId: string;
  readonly registrarHostId: string;
  readonly subjectRegistry: KeyRegistry;
  readonly studyId: string;
  readonly protocolDigest: string;
  readonly subjectId: string;
  readonly role: ExternalHumanPilotEnrolledRoleV33_31;
  readonly organizationId: string;
  readonly hostId: string;
  readonly keyId: string;
  readonly evidenceClass: ExternalHumanPilotEvidenceClassV33_31;
  readonly nonce: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}): SignedEnvelope<ExternalHumanPilotRoleChallengeV33_31> {
  requireDate(input.issuedAt, 'external_role_challenge_time_invalid');
  requireDate(input.expiresAt, 'external_role_challenge_expiry_invalid');
  if (input.expiresAt.getTime() <= input.issuedAt.getTime()) throw new Error('external_role_challenge_window_invalid');
  if (input.nonce.length < 24) throw new Error('external_role_nonce_too_short');
  validateRole(input.role);
  validateEvidenceClass(input.evidenceClass);
  const keyFingerprint = input.subjectRegistry.fingerprint(input.keyId);
  if (keyFingerprint === undefined) throw new Error('external_role_subject_key_unregistered');
  const material = {
    version: '33.31' as const,
    challengeId: randomUUID(),
    studyId: identifier(input.studyId, 'external_role_study_id_required'),
    protocolDigest: digest(input.protocolDigest, 'external_role_protocol_digest_invalid'),
    subjectId: identifier(input.subjectId, 'external_role_subject_id_required'),
    role: input.role,
    organizationId: identifier(input.organizationId, 'external_role_organization_required'),
    hostId: identifier(input.hostId, 'external_role_host_required'),
    keyId: identifier(input.keyId, 'external_role_key_required'),
    keyFingerprint,
    evidenceClass: input.evidenceClass,
    nonceDigest: sha256({ nonce: input.nonce }),
    issuedAt: input.issuedAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    registrarKeyId: input.registrar.keyId,
    registrarOrganizationId: identifier(input.registrarOrganizationId, 'external_role_registrar_organization_required'),
    registrarHostId: identifier(input.registrarHostId, 'external_role_registrar_host_required'),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, challengeDigest: sha256(material) }, input.registrar);
}

export function respondExternalHumanPilotRoleChallengeV33_31(input: {
  readonly subject: SigningIdentity;
  readonly challenge: SignedEnvelope<ExternalHumanPilotRoleChallengeV33_31>;
  readonly registrarRegistry: KeyRegistry;
  readonly trustedRegistrarIds: readonly string[];
  readonly nonce: string;
  readonly respondedAt: Date;
}): SignedEnvelope<ExternalHumanPilotRoleOwnershipResponseV33_31> {
  const challenge = verifyRoleChallenge(input.challenge, input.registrarRegistry, input.trustedRegistrarIds, input.respondedAt);
  if (input.subject.keyId !== challenge.keyId) throw new Error('external_role_subject_key_mismatch');
  if (sha256({ nonce: input.nonce }) !== challenge.nonceDigest) throw new Error('external_role_nonce_invalid');
  if (input.respondedAt.getTime() < Date.parse(challenge.issuedAt)) throw new Error('external_role_response_before_challenge');
  const material = {
    version: '33.31' as const,
    responseId: randomUUID(),
    challengeDigest: challenge.challengeDigest,
    studyId: challenge.studyId,
    protocolDigest: challenge.protocolDigest,
    subjectId: challenge.subjectId,
    role: challenge.role,
    organizationId: challenge.organizationId,
    hostId: challenge.hostId,
    keyId: challenge.keyId,
    keyFingerprint: challenge.keyFingerprint,
    evidenceClass: challenge.evidenceClass,
    nonceDigest: challenge.nonceDigest,
    respondedAt: input.respondedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, responseDigest: sha256(material) }, input.subject);
}

export function enrollExternalHumanPilotRoleV33_31(input: {
  readonly registrar: SigningIdentity;
  readonly challenge: SignedEnvelope<ExternalHumanPilotRoleChallengeV33_31>;
  readonly ownershipResponse: SignedEnvelope<ExternalHumanPilotRoleOwnershipResponseV33_31>;
  readonly registrarRegistry: KeyRegistry;
  readonly trustedRegistrarIds: readonly string[];
  readonly subjectRegistry: KeyRegistry;
  readonly trustedSubjectIds: readonly string[];
  readonly enrolledAt: Date;
  readonly expiresAt: Date;
}): SignedEnvelope<ExternalHumanPilotRoleEnrollmentV33_31> {
  const challenge = verifyRoleChallenge(input.challenge, input.registrarRegistry, input.trustedRegistrarIds, input.enrolledAt);
  const response = verifyRoleOwnershipResponse(input.ownershipResponse, input.subjectRegistry, input.trustedSubjectIds, input.enrolledAt);
  if (challenge.registrarKeyId !== input.registrar.keyId) throw new Error('external_role_registrar_mismatch');
  if (response.challengeDigest !== challenge.challengeDigest || response.keyId !== challenge.keyId || response.subjectId !== challenge.subjectId || response.role !== challenge.role || response.organizationId !== challenge.organizationId || response.hostId !== challenge.hostId || response.evidenceClass !== challenge.evidenceClass || response.nonceDigest !== challenge.nonceDigest) throw new Error('external_role_response_binding_invalid');
  requireDate(input.expiresAt, 'external_role_enrollment_expiry_invalid');
  if (input.enrolledAt.getTime() < Date.parse(response.respondedAt) || input.expiresAt.getTime() <= input.enrolledAt.getTime() || input.expiresAt.getTime() > Date.parse(challenge.expiresAt)) throw new Error('external_role_enrollment_window_invalid');
  const material = {
    version: '33.31' as const,
    enrollmentId: randomUUID(),
    challengeDigest: challenge.challengeDigest,
    ownershipResponseDigest: response.responseDigest,
    studyId: challenge.studyId,
    protocolDigest: challenge.protocolDigest,
    subjectId: challenge.subjectId,
    role: challenge.role,
    organizationId: challenge.organizationId,
    hostId: challenge.hostId,
    keyId: challenge.keyId,
    keyFingerprint: challenge.keyFingerprint,
    evidenceClass: challenge.evidenceClass,
    registrarKeyId: input.registrar.keyId,
    registrarOrganizationId: challenge.registrarOrganizationId,
    registrarHostId: challenge.registrarHostId,
    enrolledAt: input.enrolledAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, enrollmentDigest: sha256(material) }, input.registrar);
}

export function issueExternalHumanPilotExportChallengeV33_31(input: {
  readonly importer: SigningIdentity;
  readonly importerOrganizationId: string;
  readonly importerHostId: string;
  readonly exporterRegistry: KeyRegistry;
  readonly studyId: string;
  readonly protocolDigest: string;
  readonly expectedExporterKeyId: string;
  readonly nonce: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly maximumArtifactCount?: number;
  readonly maximumTotalBytes?: number;
}): SignedEnvelope<ExternalHumanPilotExportChallengeV33_31> {
  requireDate(input.issuedAt, 'external_export_challenge_time_invalid');
  requireDate(input.expiresAt, 'external_export_challenge_expiry_invalid');
  if (input.expiresAt.getTime() <= input.issuedAt.getTime()) throw new Error('external_export_challenge_window_invalid');
  if (input.nonce.length < 24) throw new Error('external_export_nonce_too_short');
  const expectedExporterFingerprint = input.exporterRegistry.fingerprint(input.expectedExporterKeyId);
  if (expectedExporterFingerprint === undefined) throw new Error('external_exporter_key_unregistered');
  const material = {
    version: '33.31' as const,
    challengeId: randomUUID(),
    studyId: identifier(input.studyId, 'external_export_study_id_required'),
    protocolDigest: digest(input.protocolDigest, 'external_export_protocol_digest_invalid'),
    expectedExporterKeyId: identifier(input.expectedExporterKeyId, 'external_exporter_key_required'),
    expectedExporterFingerprint,
    nonceDigest: sha256({ nonce: input.nonce }),
    maximumArtifactCount: boundedInteger(input.maximumArtifactCount ?? 128, 1, 512, 'external_export_artifact_count_invalid'),
    maximumTotalBytes: boundedInteger(input.maximumTotalBytes ?? 16 * 1024 * 1024, 1024, 64 * 1024 * 1024, 'external_export_total_bytes_invalid'),
    onePackageOnly: true as const,
    issuedAt: input.issuedAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    importerKeyId: input.importer.keyId,
    importerOrganizationId: identifier(input.importerOrganizationId, 'external_importer_organization_required'),
    importerHostId: identifier(input.importerHostId, 'external_importer_host_required'),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, challengeDigest: sha256(material) }, input.importer);
}

export function createExternalHumanPilotObservationArtifactV33_31(input: {
  readonly protocol: UxPilotProtocolV33_30;
  readonly consent: UxParticipantConsentV33_30;
  readonly session: InstrumentedUxFlowSessionV33_30;
  readonly observerKeyId: string;
  readonly observerOrganization: string;
  readonly taskSuccess: boolean;
  readonly accessibilityPassed: boolean;
  readonly comprehensionCorrect?: boolean;
  readonly errorCount: number;
  readonly observedAt: Date;
}): { readonly artifact: ExternalHumanPilotObservationArtifactV33_31; readonly bytes: Uint8Array; readonly digest: string } {
  if (input.session.studyId !== input.protocol.studyId || input.session.protocolDigest !== input.protocol.protocolDigest || input.session.participantId !== input.consent.participantId || input.session.consentDigest !== input.consent.consentDigest) throw new Error('external_observation_binding_invalid');
  if (input.session.flow === 'GOVERNED' && typeof input.comprehensionCorrect !== 'boolean') throw new Error('external_observation_comprehension_required');
  if (input.session.flow === 'BASELINE' && input.comprehensionCorrect !== undefined) throw new Error('external_observation_baseline_comprehension_forbidden');
  if (!Number.isInteger(input.errorCount) || input.errorCount < 0 || input.errorCount > 100) throw new Error('external_observation_error_count_invalid');
  if (input.observedAt.getTime() < Date.parse(input.session.completedAt)) throw new Error('external_observation_before_session_completion');
  const artifact: ExternalHumanPilotObservationArtifactV33_31 = {
    version: '33.31',
    artifactId: `observation-${input.session.sessionId}`,
    studyId: input.protocol.studyId,
    protocolDigest: input.protocol.protocolDigest,
    consentDigest: input.consent.consentDigest,
    participantId: input.consent.participantId,
    participantAliasDigest: input.consent.participantAliasDigest,
    experienceBand: input.consent.experienceBand,
    accessibilityAccommodationCode: input.consent.accessibilityAccommodationCode,
    sessionId: input.session.sessionId,
    sessionDigest: input.session.sessionDigest,
    eventChainDigest: input.session.eventChainDigest,
    scenarioId: input.session.scenarioId,
    flow: input.session.flow,
    observerKeyId: identifier(input.observerKeyId, 'external_observation_observer_key_required'),
    observerOrganization: identifier(input.observerOrganization, 'external_observation_observer_org_required'),
    taskSuccess: input.taskSuccess,
    accessibilityPassed: input.accessibilityPassed,
    ...(input.comprehensionCorrect === undefined ? {} : { comprehensionCorrect: input.comprehensionCorrect }),
    errorCount: input.errorCount,
    observedAt: input.observedAt.toISOString(),
    productionAuthority: 'NONE',
    externalEffectsExecuted: 0,
  };
  const bytes = Buffer.from(canonicalJson(artifact), 'utf8');
  return { artifact, bytes, digest: sha256Bytes(bytes) };
}

export function createExternalHumanPilotEvidenceManifestV33_31(input: {
  readonly exporter: SigningIdentity;
  readonly exporterOrganizationId: string;
  readonly exporterHostId: string;
  readonly challenge: SignedEnvelope<ExternalHumanPilotExportChallengeV33_31>;
  readonly challengeRegistry: KeyRegistry;
  readonly trustedChallengeSignerIds: readonly string[];
  readonly nonce: string;
  readonly protocol: SignedEnvelope<UxPilotProtocolV33_30>;
  readonly evidenceClass: ExternalHumanPilotEvidenceClassV33_31;
  readonly roleBindings: readonly UxPilotRoleBindingV33_30[];
  readonly roleProofs: readonly ExternalHumanPilotRoleProofBundleV33_31[];
  readonly consents: readonly SignedEnvelope<UxParticipantConsentV33_30>[];
  readonly withdrawals?: readonly SignedEnvelope<UxParticipantWithdrawalV33_30>[];
  readonly baselineEvidence: readonly UxSessionEvidenceBundleV33_30[];
  readonly governedEvidence: readonly UxSessionEvidenceBundleV33_30[];
  readonly artifactRecords: readonly ExternalHumanPilotArtifactRecordV33_31[];
  readonly exportedAt: Date;
}): SignedEnvelope<ExternalHumanPilotEvidenceManifestV33_31> {
  const challenge = verifyExportChallenge(input.challenge, input.challengeRegistry, input.trustedChallengeSignerIds, input.exportedAt);
  if (input.exporter.keyId !== challenge.expectedExporterKeyId) throw new Error('external_manifest_exporter_mismatch');
  if (sha256({ nonce: input.nonce }) !== challenge.nonceDigest) throw new Error('external_manifest_nonce_invalid');
  if (input.protocol.payload.studyId !== challenge.studyId || input.protocol.payload.protocolDigest !== challenge.protocolDigest) throw new Error('external_manifest_protocol_binding_invalid');
  validateEvidenceClass(input.evidenceClass);
  const artifactManifest = normalizeArtifactRecords(input.artifactRecords);
  const material = {
    version: '33.31' as const,
    packageId: randomUUID(),
    challengeDigest: challenge.challengeDigest,
    nonceDigest: challenge.nonceDigest,
    studyId: challenge.studyId,
    protocolDigest: challenge.protocolDigest,
    evidenceClass: input.evidenceClass,
    exporterKeyId: input.exporter.keyId,
    exporterOrganizationId: identifier(input.exporterOrganizationId, 'external_manifest_exporter_org_required'),
    exporterHostId: identifier(input.exporterHostId, 'external_manifest_exporter_host_required'),
    roleBindingsDigest: sha256(input.roleBindings),
    roleProofsDigest: sha256(input.roleProofs),
    consentsDigest: sha256(input.consents),
    withdrawalsDigest: sha256(input.withdrawals ?? []),
    baselineEvidenceDigest: sha256(input.baselineEvidence),
    governedEvidenceDigest: sha256(input.governedEvidence),
    artifactManifest,
    artifactManifestDigest: sha256(artifactManifest),
    participantCount: input.consents.length,
    baselineSessionCount: input.baselineEvidence.length,
    governedSessionCount: input.governedEvidence.length,
    exportedAt: input.exportedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, packageDigest: sha256(material) }, input.exporter);
}

export function createInitialExternalHumanPilotImportCheckpointV33_31(input: {
  readonly signer: SigningIdentity;
  readonly generatedAt: Date;
}): SignedEnvelope<ExternalHumanPilotImportCheckpointV33_31> {
  requireDate(input.generatedAt, 'external_checkpoint_time_invalid');
  const material = {
    version: '33.31' as const,
    checkpointId: randomUUID(),
    sequence: 0,
    previousCheckpointDigest: null,
    consumedChallengeDigests: [] as readonly string[],
    consumedPackageDigests: [] as readonly string[],
    generatedAt: input.generatedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, checkpointDigest: sha256(material) }, input.signer);
}

export function importExternalHumanPilotEvidenceV33_31(input: {
  readonly importer: SigningIdentity;
  readonly importerOrganizationId: string;
  readonly importerHostId: string;
  readonly verifier: SigningIdentity;
  readonly verifierRegistry: KeyRegistry;
  readonly trustedVerifierIds: readonly string[];
  readonly package: ExternalHumanPilotEvidencePackageV33_31;
  readonly challenge: SignedEnvelope<ExternalHumanPilotExportChallengeV33_31>;
  readonly previousCheckpoint: SignedEnvelope<ExternalHumanPilotImportCheckpointV33_31>;
  readonly trust: ExternalHumanPilotImportTrustV33_31;
  readonly contractTrust: ExternalHumanPilotContractTrustV33_31;
  readonly importedAt: Date;
}): {
  readonly receipt: SignedEnvelope<ExternalHumanPilotImportReceiptV33_31>;
  readonly checkpoint: SignedEnvelope<ExternalHumanPilotImportCheckpointV33_31>;
  readonly baseContractVerdict: SignedEnvelope<ControlledHumanUxPilotVerdictV33_30>;
  readonly verdict: SignedEnvelope<ExternalHumanPilotQualificationVerdictV33_31>;
} {
  requireDate(input.importedAt, 'external_import_time_invalid');
  const challenge = verifyExportChallenge(input.challenge, input.trust.challengeRegistry, input.trust.trustedChallengeSignerIds, input.importedAt);
  if (challenge.importerKeyId !== input.importer.keyId || challenge.importerOrganizationId !== input.importerOrganizationId || challenge.importerHostId !== input.importerHostId) throw new Error('external_importer_challenge_binding_invalid');
  const prior = verifyImportCheckpoint(input.previousCheckpoint, input.trust.checkpointRegistry, input.trust.trustedCheckpointSignerIds, input.importedAt);
  const manifest = verifyManifest(input.package.manifest, input.trust.exporterRegistry, input.trust.trustedExporterIds, input.importedAt);
  if (manifest.challengeDigest !== challenge.challengeDigest || manifest.studyId !== challenge.studyId || manifest.protocolDigest !== challenge.protocolDigest || manifest.exporterKeyId !== challenge.expectedExporterKeyId || manifest.nonceDigest !== challenge.nonceDigest) throw new Error('external_manifest_challenge_binding_invalid');
  if (prior.consumedChallengeDigests.includes(challenge.challengeDigest)) throw new Error('external_import_challenge_replay');
  if (prior.consumedPackageDigests.includes(manifest.packageDigest)) throw new Error('external_import_package_replay');
  verifyManifestBindings(input.package, manifest);
  const roleMap = verifyRoleProofs(input.package.roleProofs, input.package.roleBindings, input.package.consents, manifest, input.trust, input.importedAt);
  enforceExternalSeparation(roleMap, challenge, input.importer, input.importerOrganizationId, input.importerHostId, input.verifier);
  verifyObservationArtifacts(input.package, manifest, challenge);
  const baseContractVerdict = evaluateControlledHumanUxPilotV33_30({
    verifier: input.verifier,
    protocol: input.package.protocol,
    protocolRegistry: input.contractTrust.protocolRegistry,
    trustedResearcherIds: input.contractTrust.trustedResearcherIds,
    participantRegistry: input.contractTrust.participantRegistry,
    trustedParticipantIds: input.contractTrust.trustedParticipantIds,
    instrumentationRegistry: input.contractTrust.instrumentationRegistry,
    trustedInstrumentationIds: input.contractTrust.trustedInstrumentationIds,
    observerRegistry: input.contractTrust.observerRegistry,
    trustedObserverIds: input.contractTrust.trustedObserverIds,
    roleBindings: input.package.roleBindings,
    consents: input.package.consents,
    withdrawals: input.package.withdrawals,
    baselineEvidence: input.package.baselineEvidence,
    governedEvidence: input.package.governedEvidence,
    generatedAt: input.importedAt,
  });
  const base = baseContractVerdict.payload;
  if (base.studyId !== manifest.studyId || base.protocolDigest !== manifest.protocolDigest) throw new Error('external_base_verdict_binding_invalid');
  const liveExternal = manifest.evidenceClass === 'LIVE_EXTERNAL';
  const filteredBlockers = base.blockers.filter((blocker) => blocker !== 'external_evidence_provenance_required');
  if (!liveExternal) filteredBlockers.push('external_human_observation_required');
  const blockers = [...new Set(filteredBlockers)].sort();
  const humanPilotPassed = liveExternal && blockers.length === 0;
  let status: ExternalHumanPilotQualificationVerdictV33_31['status'];
  if (humanPilotPassed) status = 'HUMAN_UX_PILOT_PASSED_SHADOW_ONLY';
  else if (!liveExternal) status = 'HUMAN_UX_PILOT_REQUIRED';
  else if (base.participantCount < input.package.protocol.payload.minimumParticipants) status = 'HUMAN_UX_PILOT_INSUFFICIENT_EVIDENCE';
  else status = 'HUMAN_UX_PILOT_FAILED_THRESHOLDS';
  const checkpointMaterial = {
    version: '33.31' as const,
    checkpointId: randomUUID(),
    sequence: prior.sequence + 1,
    previousCheckpointDigest: prior.checkpointDigest,
    consumedChallengeDigests: [...prior.consumedChallengeDigests, challenge.challengeDigest].sort(),
    consumedPackageDigests: [...prior.consumedPackageDigests, manifest.packageDigest].sort(),
    generatedAt: input.importedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  const checkpoint = signEnvelope({ ...checkpointMaterial, checkpointDigest: sha256(checkpointMaterial) }, input.importer);
  const receiptMaterial = {
    version: '33.31' as const,
    receiptId: randomUUID(),
    packageId: manifest.packageId,
    packageDigest: manifest.packageDigest,
    challengeDigest: challenge.challengeDigest,
    checkpointSequence: checkpoint.payload.sequence,
    evidenceClass: manifest.evidenceClass,
    status: liveExternal ? 'VERIFIED_LIVE_EXTERNAL_EVIDENCE_READY_FOR_EVALUATION' as const : 'SYNTHETIC_REFERENCE_NOT_EXTERNAL' as const,
    participantCount: base.participantCount,
    externalHumanParticipants: liveExternal ? base.participantCount : 0,
    artifactCount: manifest.artifactManifest.length,
    artifactBytesVerified: true as const,
    observationSchemaVerified: true as const,
    roleProofsVerified: true as const,
    roleBindingsExternallyAttested: true as const,
    replayProtected: true as const,
    importedAt: input.importedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  const receipt = signEnvelope({ ...receiptMaterial, receiptDigest: sha256(receiptMaterial) }, input.importer);
  const verdictMaterial = {
    version: '33.31' as const,
    verdictId: randomUUID(),
    studyId: base.studyId,
    protocolDigest: base.protocolDigest,
    packageDigest: manifest.packageDigest,
    importReceiptDigest: receipt.payload.receiptDigest,
    baseContractVerdictDigest: base.verdictDigest,
    evidenceClass: manifest.evidenceClass,
    participantCount: base.participantCount,
    distinctScenarioCount: base.distinctScenarioCount,
    medianStepReductionPercent: base.medianStepReductionPercent,
    medianGovernedApprovals: base.medianGovernedApprovals,
    medianComprehensionSeconds: base.medianComprehensionSeconds,
    taskSuccessRatePercent: base.taskSuccessRatePercent,
    accessibilityPassRatePercent: base.accessibilityPassRatePercent,
    comprehensionCorrectRatePercent: base.comprehensionCorrectRatePercent,
    evidenceClosurePercent: base.evidenceClosurePercent,
    externalProvenanceVerified: liveExternal,
    observationArtifactsVerified: true as const,
    roleProofsVerified: true as const,
    replayProtected: true as const,
    humanPilotPassed,
    status,
    blockers,
    generatedAt: input.importedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  const verdict = signEnvelope({ ...verdictMaterial, verdictDigest: sha256(verdictMaterial) }, input.verifier);
  verifyExternalHumanPilotQualificationVerdictV33_31({ verdict, verifierRegistry: input.verifierRegistry, trustedVerifierIds: input.trustedVerifierIds, expectedProtocolDigest: manifest.protocolDigest, expectedPackageDigest: manifest.packageDigest });
  return { receipt, checkpoint, baseContractVerdict, verdict };
}

export function verifyExternalHumanPilotQualificationVerdictV33_31(input: {
  readonly verdict: SignedEnvelope<ExternalHumanPilotQualificationVerdictV33_31>;
  readonly verifierRegistry: KeyRegistry;
  readonly trustedVerifierIds: readonly string[];
  readonly expectedProtocolDigest: string;
  readonly expectedPackageDigest: string;
}): ExternalHumanPilotQualificationVerdictV33_31 {
  const at = input.verdict.payload.generatedAt;
  if (!input.trustedVerifierIds.includes(input.verdict.issuerKeyId) || !input.verifierRegistry.verifyAt(input.verdict, at)) throw new Error('external_verdict_signature_invalid');
  const payload = input.verdict.payload;
  const { verdictDigest, ...material } = payload;
  if (verdictDigest !== sha256(material)) throw new Error('external_verdict_digest_invalid');
  if (payload.protocolDigest !== input.expectedProtocolDigest || payload.packageDigest !== input.expectedPackageDigest) throw new Error('external_verdict_binding_invalid');
  if (payload.productionAuthority !== 'NONE' || payload.externalEffectsExecuted !== 0) throw new Error('external_verdict_boundary_invalid');
  if (payload.humanPilotPassed && (payload.evidenceClass !== 'LIVE_EXTERNAL' || !payload.externalProvenanceVerified || !payload.observationArtifactsVerified || !payload.roleProofsVerified || !payload.replayProtected || payload.status !== 'HUMAN_UX_PILOT_PASSED_SHADOW_ONLY' || payload.blockers.length !== 0)) throw new Error('external_verdict_false_pass');
  if (!payload.humanPilotPassed && payload.status === 'HUMAN_UX_PILOT_PASSED_SHADOW_ONLY') throw new Error('external_verdict_status_invalid');
  return structuredClone(payload);
}

function verifyRoleProofs(
  bundles: readonly ExternalHumanPilotRoleProofBundleV33_31[],
  roleBindings: readonly UxPilotRoleBindingV33_30[],
  consents: readonly SignedEnvelope<UxParticipantConsentV33_30>[],
  manifest: ExternalHumanPilotEvidenceManifestV33_31,
  trust: ExternalHumanPilotImportTrustV33_31,
  now: Date,
): Map<ExternalHumanPilotEnrolledRoleV33_31, ExternalHumanPilotRoleEnrollmentV33_31[]> {
  const byRole = new Map<ExternalHumanPilotEnrolledRoleV33_31, ExternalHumanPilotRoleEnrollmentV33_31[]>();
  const keyIds = new Set<string>();
  const subjectIds = new Set<string>();
  const challengeDigests = new Set<string>();
  for (const bundle of bundles) {
    const challenge = verifyRoleChallenge(bundle.challenge, trust.registrarRegistry, trust.trustedRegistrarIds, now);
    const response = verifyRoleOwnershipResponse(bundle.ownershipResponse, trust.subjectRegistry, trust.trustedSubjectIds, now);
    const enrollment = verifyRoleEnrollment(bundle.enrollment, trust.registrarRegistry, trust.trustedRegistrarIds, now);
    if (response.challengeDigest !== challenge.challengeDigest || enrollment.challengeDigest !== challenge.challengeDigest || enrollment.ownershipResponseDigest !== response.responseDigest) throw new Error('external_role_bundle_binding_invalid');
    for (const field of ['studyId','protocolDigest','subjectId','role','organizationId','hostId','keyId','keyFingerprint','evidenceClass'] as const) {
      if (response[field] !== challenge[field] || enrollment[field] !== challenge[field]) throw new Error('external_role_bundle_claim_mismatch');
    }
    if (challenge.studyId !== manifest.studyId || challenge.protocolDigest !== manifest.protocolDigest || challenge.evidenceClass !== manifest.evidenceClass) throw new Error('external_role_manifest_binding_invalid');
    if (keyIds.has(enrollment.keyId)) throw new Error('external_role_key_duplicate');
    if (subjectIds.has(enrollment.subjectId)) throw new Error('external_role_subject_duplicate');
    if (challengeDigests.has(challenge.challengeDigest)) throw new Error('external_role_challenge_duplicate');
    keyIds.add(enrollment.keyId); subjectIds.add(enrollment.subjectId); challengeDigests.add(challenge.challengeDigest);
    const rows = byRole.get(enrollment.role) ?? [];
    rows.push(enrollment); byRole.set(enrollment.role, rows);
  }
  for (const role of ['RESEARCHER','INSTRUMENTATION','OBSERVER','VERIFIER','EXPORTER'] as const) if ((byRole.get(role)?.length ?? 0) !== 1) throw new Error(`external_role_${role.toLowerCase()}_count_invalid`);
  const participantEnrollments = byRole.get('PARTICIPANT') ?? [];
  if (participantEnrollments.length !== consents.length) throw new Error('external_role_participant_count_invalid');
  const bindingByKey = new Map(roleBindings.map((binding) => [binding.keyId, binding]));
  if (bindingByKey.size !== roleBindings.length) throw new Error('external_role_binding_key_duplicate');
  for (const role of ['RESEARCHER','INSTRUMENTATION','OBSERVER','VERIFIER','PARTICIPANT'] as const) {
    for (const enrollment of byRole.get(role) ?? []) {
      const binding = bindingByKey.get(enrollment.keyId);
      if (binding === undefined || binding.role !== role || binding.organization !== enrollment.organizationId || binding.hostId !== enrollment.hostId) throw new Error('external_role_binding_not_attested');
    }
  }
  if (roleBindings.length !== (byRole.get('RESEARCHER')?.length ?? 0) + (byRole.get('INSTRUMENTATION')?.length ?? 0) + (byRole.get('OBSERVER')?.length ?? 0) + (byRole.get('VERIFIER')?.length ?? 0) + participantEnrollments.length) throw new Error('external_role_binding_extra');
  const consentByParticipant = new Map(consents.map((consent) => [consent.payload.participantId, consent.payload]));
  if (consentByParticipant.size !== consents.length) throw new Error('external_consent_participant_duplicate');
  for (const enrollment of participantEnrollments) {
    const consent = consentByParticipant.get(enrollment.subjectId);
    const expectedConsentClass = manifest.evidenceClass === 'LIVE_EXTERNAL' ? 'HUMAN_OBSERVED_EXTERNAL' : 'SIMULATED_CONTRACT_TEST';
    if (consent === undefined || consent.participantKeyId !== enrollment.keyId || consent.studyId !== enrollment.studyId || consent.evidenceClass !== expectedConsentClass) throw new Error('external_participant_enrollment_consent_binding_invalid');
  }
  const exporter = byRole.get('EXPORTER')![0]!;
  if (exporter.keyId !== manifest.exporterKeyId || exporter.organizationId !== manifest.exporterOrganizationId || exporter.hostId !== manifest.exporterHostId) throw new Error('external_exporter_enrollment_manifest_binding_invalid');
  return byRole;
}

function enforceExternalSeparation(
  byRole: Map<ExternalHumanPilotEnrolledRoleV33_31, ExternalHumanPilotRoleEnrollmentV33_31[]>,
  challenge: ExternalHumanPilotExportChallengeV33_31,
  importer: SigningIdentity,
  importerOrganizationId: string,
  importerHostId: string,
  verifier: SigningIdentity,
): void {
  const researcher = byRole.get('RESEARCHER')![0]!;
  const instrumentation = byRole.get('INSTRUMENTATION')![0]!;
  const observer = byRole.get('OBSERVER')![0]!;
  const enrolledVerifier = byRole.get('VERIFIER')![0]!;
  const exporter = byRole.get('EXPORTER')![0]!;
  if (enrolledVerifier.keyId !== verifier.keyId) throw new Error('external_verifier_enrollment_key_mismatch');
  const allStaff = [researcher, instrumentation, observer, enrolledVerifier, exporter];
  if (new Set(allStaff.map((row) => row.keyId)).size !== allStaff.length) throw new Error('external_staff_key_overlap');
  if (researcher.organizationId === enrolledVerifier.organizationId || researcher.hostId === enrolledVerifier.hostId) throw new Error('external_verifier_researcher_separation_invalid');
  if (observer.organizationId === researcher.organizationId || observer.organizationId === instrumentation.organizationId || observer.hostId === researcher.hostId || observer.hostId === instrumentation.hostId) throw new Error('external_observer_independence_invalid');
  if (exporter.keyId === importer.keyId || exporter.organizationId === importerOrganizationId || exporter.hostId === importerHostId) throw new Error('external_exporter_importer_separation_invalid');
  if (enrolledVerifier.keyId === importer.keyId || enrolledVerifier.organizationId === importerOrganizationId || enrolledVerifier.hostId === importerHostId) throw new Error('external_verifier_importer_separation_invalid');
  if (challenge.importerKeyId !== importer.keyId || challenge.importerOrganizationId !== importerOrganizationId || challenge.importerHostId !== importerHostId) throw new Error('external_importer_identity_invalid');
  const registrarKeys = new Set(allStaff.map((row) => row.registrarKeyId));
  if (registrarKeys.size !== 1) throw new Error('external_registrar_inconsistent');
  const registrarKey = [...registrarKeys][0]!;
  if ([importer.keyId, verifier.keyId, exporter.keyId].includes(registrarKey)) throw new Error('external_registrar_role_overlap');
}

function verifyObservationArtifacts(pkg: ExternalHumanPilotEvidencePackageV33_31, manifest: ExternalHumanPilotEvidenceManifestV33_31, challenge: ExternalHumanPilotExportChallengeV33_31): void {
  const paths = Object.keys(pkg.artifactBytesByPath).sort();
  const records = manifest.artifactManifest;
  if (paths.length !== records.length || paths.length > challenge.maximumArtifactCount) throw new Error('external_artifact_inventory_mismatch');
  const recordPaths = records.map((record) => record.path).sort();
  if (sha256(paths) !== sha256(recordPaths)) throw new Error('external_artifact_path_inventory_mismatch');
  const expectedBundles = [...pkg.baselineEvidence, ...pkg.governedEvidence];
  if (records.length !== expectedBundles.length) throw new Error('external_artifact_bundle_count_mismatch');
  const consentByParticipant = new Map(pkg.consents.map((consent) => [consent.payload.participantId, consent.payload]));
  const expectedByDigest = new Map<string, { session: InstrumentedUxFlowSessionV33_30; assessment: ObserverUxAssessmentV33_30; consent: UxParticipantConsentV33_30 }>();
  for (const bundle of expectedBundles) {
    const session = bundle.session.payload;
    const assessment = bundle.observerAssessment.payload;
    const consent = consentByParticipant.get(session.participantId);
    if (consent === undefined) throw new Error('external_artifact_consent_missing');
    if (expectedByDigest.has(assessment.evidenceArtifactDigest)) throw new Error('external_artifact_digest_duplicate');
    expectedByDigest.set(assessment.evidenceArtifactDigest, { session, assessment, consent });
  }
  let totalBytes = 0;
  for (const record of records) {
    safeRelativePath(record.path);
    const bytes = pkg.artifactBytesByPath[record.path];
    if (bytes === undefined) throw new Error('external_artifact_bytes_missing');
    totalBytes += bytes.byteLength;
    if (bytes.byteLength !== record.sizeBytes || sha256Bytes(bytes) !== record.sha256) throw new Error('external_artifact_digest_or_size_invalid');
    const expected = expectedByDigest.get(record.sha256);
    if (expected === undefined) throw new Error('external_artifact_not_referenced');
    if (record.sessionDigest !== expected.session.sessionDigest || record.participantId !== expected.session.participantId || record.flow !== expected.session.flow || record.kind !== 'OBSERVATION_EVIDENCE' || record.mediaType !== 'application/json') throw new Error('external_artifact_record_binding_invalid');
    const artifact = parseObservationArtifact(bytes);
    verifyObservationArtifactBinding(artifact, expected.session, expected.assessment, expected.consent, manifest);
    expectedByDigest.delete(record.sha256);
  }
  if (totalBytes > challenge.maximumTotalBytes) throw new Error('external_artifact_total_bytes_exceeded');
  if (expectedByDigest.size !== 0) throw new Error('external_artifact_reference_missing');
}

function verifyObservationArtifactBinding(artifact: ExternalHumanPilotObservationArtifactV33_31, session: InstrumentedUxFlowSessionV33_30, assessment: ObserverUxAssessmentV33_30, consent: UxParticipantConsentV33_30, manifest: ExternalHumanPilotEvidenceManifestV33_31): void {
  if (artifact.studyId !== manifest.studyId || artifact.protocolDigest !== manifest.protocolDigest || artifact.consentDigest !== consent.consentDigest || artifact.participantId !== consent.participantId || artifact.participantAliasDigest !== consent.participantAliasDigest || artifact.experienceBand !== consent.experienceBand || artifact.accessibilityAccommodationCode !== consent.accessibilityAccommodationCode) throw new Error('external_observation_participant_binding_invalid');
  if (artifact.sessionId !== session.sessionId || artifact.sessionDigest !== session.sessionDigest || artifact.eventChainDigest !== session.eventChainDigest || artifact.scenarioId !== session.scenarioId || artifact.flow !== session.flow) throw new Error('external_observation_session_binding_invalid');
  if (artifact.observerKeyId !== assessment.observerKeyId || artifact.observerOrganization !== assessment.observerOrganization || artifact.taskSuccess !== assessment.taskSuccess || artifact.accessibilityPassed !== assessment.accessibilityPassed || artifact.comprehensionCorrect !== assessment.comprehensionCorrect || artifact.errorCount !== assessment.errorCount || artifact.observedAt !== assessment.observedAt) throw new Error('external_observation_assessment_binding_invalid');
  if (artifact.productionAuthority !== 'NONE' || artifact.externalEffectsExecuted !== 0) throw new Error('external_observation_boundary_invalid');
}

function parseObservationArtifact(bytes: Uint8Array): ExternalHumanPilotObservationArtifactV33_31 {
  let parsed: unknown;
  let text: string;
  try { text = Buffer.from(bytes).toString('utf8'); parsed = JSON.parse(text); } catch { throw new Error('external_observation_json_invalid'); }
  if (canonicalJson(parsed) !== text) throw new Error('external_observation_json_not_canonical');
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('external_observation_schema_invalid');
  const row = parsed as Record<string, unknown>;
  const required = ['version','artifactId','studyId','protocolDigest','consentDigest','participantId','participantAliasDigest','experienceBand','accessibilityAccommodationCode','sessionId','sessionDigest','eventChainDigest','scenarioId','flow','observerKeyId','observerOrganization','taskSuccess','accessibilityPassed','errorCount','observedAt','productionAuthority','externalEffectsExecuted'];
  const allowed = new Set([...required, 'comprehensionCorrect']);
  const keys = Object.keys(row);
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(row, key)) || keys.some((key) => !allowed.has(key))) throw new Error('external_observation_schema_invalid');
  if (row.version !== '33.31' || row.productionAuthority !== 'NONE' || row.externalEffectsExecuted !== 0) throw new Error('external_observation_schema_invalid');
  if (typeof row.taskSuccess !== 'boolean' || typeof row.accessibilityPassed !== 'boolean' || !Number.isInteger(row.errorCount)) throw new Error('external_observation_schema_invalid');
  if (row.flow === 'GOVERNED' && typeof row.comprehensionCorrect !== 'boolean') throw new Error('external_observation_schema_invalid');
  if (row.flow === 'BASELINE' && row.comprehensionCorrect !== undefined) throw new Error('external_observation_schema_invalid');
  for (const key of ['artifactId','studyId','protocolDigest','consentDigest','participantId','participantAliasDigest','experienceBand','accessibilityAccommodationCode','sessionId','sessionDigest','eventChainDigest','scenarioId','flow','observerKeyId','observerOrganization','observedAt']) if (typeof row[key] !== 'string') throw new Error('external_observation_schema_invalid');
  return parsed as ExternalHumanPilotObservationArtifactV33_31;
}

function verifyManifestBindings(pkg: ExternalHumanPilotEvidencePackageV33_31, manifest: ExternalHumanPilotEvidenceManifestV33_31): void {
  if (pkg.protocol.payload.studyId !== manifest.studyId || pkg.protocol.payload.protocolDigest !== manifest.protocolDigest) throw new Error('external_package_protocol_binding_invalid');
  if (manifest.roleBindingsDigest !== sha256(pkg.roleBindings) || manifest.roleProofsDigest !== sha256(pkg.roleProofs) || manifest.consentsDigest !== sha256(pkg.consents) || manifest.withdrawalsDigest !== sha256(pkg.withdrawals) || manifest.baselineEvidenceDigest !== sha256(pkg.baselineEvidence) || manifest.governedEvidenceDigest !== sha256(pkg.governedEvidence) || manifest.artifactManifestDigest !== sha256(manifest.artifactManifest)) throw new Error('external_package_manifest_digest_binding_invalid');
  if (manifest.participantCount !== pkg.consents.length || manifest.baselineSessionCount !== pkg.baselineEvidence.length || manifest.governedSessionCount !== pkg.governedEvidence.length) throw new Error('external_package_manifest_count_binding_invalid');
  const evidenceClasses = new Set(pkg.consents.map((consent) => consent.payload.evidenceClass));
  if (evidenceClasses.size !== 1) throw new Error('external_package_mixed_consent_classes');
  const expectedClass = manifest.evidenceClass === 'LIVE_EXTERNAL' ? 'HUMAN_OBSERVED_EXTERNAL' : 'SIMULATED_CONTRACT_TEST';
  if ([...evidenceClasses][0] !== expectedClass) throw new Error('external_package_evidence_class_binding_invalid');
  const latestEvidenceAt = Math.max(...[...pkg.baselineEvidence, ...pkg.governedEvidence].flatMap((bundle) => [Date.parse(bundle.session.payload.completedAt), Date.parse(bundle.participantAttestation.payload.attestedAt), Date.parse(bundle.observerAssessment.payload.observedAt)]));
  if (Date.parse(manifest.exportedAt) < latestEvidenceAt) throw new Error('external_package_export_before_evidence_complete');
}

function verifyRoleChallenge(envelope: SignedEnvelope<ExternalHumanPilotRoleChallengeV33_31>, registry: KeyRegistry, trusted: readonly string[], now: Date): ExternalHumanPilotRoleChallengeV33_31 {
  if (!trusted.includes(envelope.issuerKeyId) || !registry.verifyAt(envelope, now)) throw new Error('external_role_challenge_signature_invalid');
  const payload = envelope.payload; const { challengeDigest, ...material } = payload;
  if (challengeDigest !== sha256(material) || payload.registrarKeyId !== envelope.issuerKeyId) throw new Error('external_role_challenge_digest_invalid');
  if (now.getTime() < Date.parse(payload.issuedAt) || now.getTime() >= Date.parse(payload.expiresAt)) throw new Error('external_role_challenge_not_active');
  if (payload.productionAuthority !== 'NONE' || payload.externalEffectsExecuted !== 0) throw new Error('external_role_challenge_boundary_invalid');
  return payload;
}

function verifyRoleOwnershipResponse(envelope: SignedEnvelope<ExternalHumanPilotRoleOwnershipResponseV33_31>, registry: KeyRegistry, trusted: readonly string[], now: Date): ExternalHumanPilotRoleOwnershipResponseV33_31 {
  if (!trusted.includes(envelope.issuerKeyId) || !registry.verifyAt(envelope, now)) throw new Error('external_role_response_signature_invalid');
  const payload = envelope.payload; const { responseDigest, ...material } = payload;
  if (responseDigest !== sha256(material) || payload.keyId !== envelope.issuerKeyId) throw new Error('external_role_response_digest_invalid');
  if (payload.productionAuthority !== 'NONE' || payload.externalEffectsExecuted !== 0) throw new Error('external_role_response_boundary_invalid');
  return payload;
}

function verifyRoleEnrollment(envelope: SignedEnvelope<ExternalHumanPilotRoleEnrollmentV33_31>, registry: KeyRegistry, trusted: readonly string[], now: Date): ExternalHumanPilotRoleEnrollmentV33_31 {
  if (!trusted.includes(envelope.issuerKeyId) || !registry.verifyAt(envelope, now)) throw new Error('external_role_enrollment_signature_invalid');
  const payload = envelope.payload; const { enrollmentDigest, ...material } = payload;
  if (enrollmentDigest !== sha256(material) || payload.registrarKeyId !== envelope.issuerKeyId) throw new Error('external_role_enrollment_digest_invalid');
  if (now.getTime() < Date.parse(payload.enrolledAt) || now.getTime() >= Date.parse(payload.expiresAt)) throw new Error('external_role_enrollment_not_active');
  if (payload.productionAuthority !== 'NONE' || payload.externalEffectsExecuted !== 0) throw new Error('external_role_enrollment_boundary_invalid');
  return payload;
}

function verifyExportChallenge(envelope: SignedEnvelope<ExternalHumanPilotExportChallengeV33_31>, registry: KeyRegistry, trusted: readonly string[], now: Date): ExternalHumanPilotExportChallengeV33_31 {
  if (!trusted.includes(envelope.issuerKeyId) || !registry.verifyAt(envelope, now)) throw new Error('external_export_challenge_signature_invalid');
  const payload = envelope.payload; const { challengeDigest, ...material } = payload;
  if (challengeDigest !== sha256(material) || payload.importerKeyId !== envelope.issuerKeyId) throw new Error('external_export_challenge_digest_invalid');
  if (now.getTime() < Date.parse(payload.issuedAt) || now.getTime() >= Date.parse(payload.expiresAt)) throw new Error('external_export_challenge_not_active');
  if (payload.productionAuthority !== 'NONE' || payload.externalEffectsExecuted !== 0 || !payload.onePackageOnly) throw new Error('external_export_challenge_boundary_invalid');
  return payload;
}

function verifyManifest(envelope: SignedEnvelope<ExternalHumanPilotEvidenceManifestV33_31>, registry: KeyRegistry, trusted: readonly string[], now: Date): ExternalHumanPilotEvidenceManifestV33_31 {
  if (!trusted.includes(envelope.issuerKeyId) || !registry.verifyAt(envelope, now)) throw new Error('external_manifest_signature_invalid');
  const payload = envelope.payload; const { packageDigest, ...material } = payload;
  if (packageDigest !== sha256(material) || payload.exporterKeyId !== envelope.issuerKeyId) throw new Error('external_manifest_digest_invalid');
  if (Date.parse(payload.exportedAt) > now.getTime()) throw new Error('external_manifest_from_future');
  if (payload.productionAuthority !== 'NONE' || payload.externalEffectsExecuted !== 0) throw new Error('external_manifest_boundary_invalid');
  return payload;
}

function verifyImportCheckpoint(envelope: SignedEnvelope<ExternalHumanPilotImportCheckpointV33_31>, registry: KeyRegistry, trusted: readonly string[], now: Date): ExternalHumanPilotImportCheckpointV33_31 {
  if (!trusted.includes(envelope.issuerKeyId) || !registry.verifyAt(envelope, now)) throw new Error('external_checkpoint_signature_invalid');
  const payload = envelope.payload; const { checkpointDigest, ...material } = payload;
  if (checkpointDigest !== sha256(material)) throw new Error('external_checkpoint_digest_invalid');
  if (!Number.isInteger(payload.sequence) || payload.sequence < 0 || (payload.sequence === 0) !== (payload.previousCheckpointDigest === null)) throw new Error('external_checkpoint_sequence_invalid');
  if (new Set(payload.consumedChallengeDigests).size !== payload.consumedChallengeDigests.length || new Set(payload.consumedPackageDigests).size !== payload.consumedPackageDigests.length) throw new Error('external_checkpoint_duplicate_consumption');
  payload.consumedChallengeDigests.forEach((value) => digest(value, 'external_checkpoint_challenge_digest_invalid'));
  payload.consumedPackageDigests.forEach((value) => digest(value, 'external_checkpoint_package_digest_invalid'));
  if (payload.productionAuthority !== 'NONE' || payload.externalEffectsExecuted !== 0) throw new Error('external_checkpoint_boundary_invalid');
  return payload;
}

function normalizeArtifactRecords(records: readonly ExternalHumanPilotArtifactRecordV33_31[]): ExternalHumanPilotArtifactRecordV33_31[] {
  const paths = new Set<string>();
  const digests = new Set<string>();
  const normalized = records.map((record) => {
    safeRelativePath(record.path);
    if (paths.has(record.path)) throw new Error('external_artifact_path_duplicate');
    if (digests.has(record.sha256)) throw new Error('external_artifact_digest_duplicate');
    paths.add(record.path); digests.add(digest(record.sha256, 'external_artifact_digest_invalid'));
    if (!Number.isInteger(record.sizeBytes) || record.sizeBytes < 2 || record.sizeBytes > 2 * 1024 * 1024) throw new Error('external_artifact_size_invalid');
    if (record.kind !== 'OBSERVATION_EVIDENCE' || record.mediaType !== 'application/json') throw new Error('external_artifact_type_invalid');
    return { ...record };
  });
  return normalized.sort((a, b) => a.path.localeCompare(b.path));
}

function safeRelativePath(value: string): void {
  if (value.trim() === '' || value.length > 240 || value.startsWith('/') || value.includes('\\') || value.includes('\0') || value.split('/').some((part) => part === '' || part === '.' || part === '..')) throw new Error('external_artifact_path_invalid');
}

function validateRole(value: string): asserts value is ExternalHumanPilotEnrolledRoleV33_31 {
  if (!['RESEARCHER','INSTRUMENTATION','OBSERVER','VERIFIER','PARTICIPANT','EXPORTER'].includes(value)) throw new Error('external_role_invalid');
}

function validateEvidenceClass(value: string): asserts value is ExternalHumanPilotEvidenceClassV33_31 {
  if (!['SYNTHETIC_REFERENCE','LIVE_EXTERNAL'].includes(value)) throw new Error('external_evidence_class_invalid');
}

function identifier(value: string, error: string): string { const clean = value.trim(); if (clean === '' || clean.length > 200) throw new Error(error); return clean; }
function digest(value: string, error: string): string { if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(error); return value; }
function boundedInteger(value: number, min: number, max: number, error: string): number { if (!Number.isInteger(value) || value < min || value > max) throw new Error(error); return value; }
function requireDate(value: Date, error: string): void { if (!Number.isFinite(value.getTime())) throw new Error(error); }
