import { randomUUID } from 'node:crypto';
import {
  KeyRegistry,
  sha256,
  signEnvelope,
  type SignedEnvelope,
  type SigningIdentity,
} from '../contracts/crypto.js';
import {
  defaultProgramParametersV33_27,
  verifySignedProgramParameterLedgerV33_27,
  type ProgramParameterV33_27,
  type SignedProgramParameterLedgerV33_27,
  type TransparencyWitnessGossipReceiptV33_27,
  type TransparencyWitnessObservationV33_27,
} from './external-transparency-witness-v33_27.js';

export type CeremonyEvidenceClassV33_28 = 'SYNTHETIC_REFERENCE' | 'LIVE_EXTERNAL';
export type CeremonyMemberRoleV33_28 = 'SCANNER_OPERATOR' | 'TRANSPARENCY_WITNESS';
export type CeremonyLifecycleStatusV33_28 = 'ACTIVE' | 'ROTATED' | 'REVOKED';

export interface SignedProgramParameterLedgerV33_28 {
  readonly version: '33.28';
  readonly ledgerId: string;
  readonly previousVersion: '33.27';
  readonly previousLedgerDigest: string;
  readonly parameterCount: 14;
  readonly parameters: readonly ProgramParameterV33_27[];
  readonly preservedParameterCount: 8;
  readonly strengthenedParameterCount: 3;
  readonly externalEvidencePendingParameterCount: 3;
  readonly generatedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly ledgerDigest: string;
}

export interface OperatorCeremonyChallengeV33_28 {
  readonly version: '33.28';
  readonly challengeId: string;
  readonly participantId: string;
  readonly memberRole: CeremonyMemberRoleV33_28;
  readonly organizationId: string;
  readonly hostId: string;
  readonly keyId: string;
  readonly keyFingerprint: string;
  readonly nonceDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly twoCustodianApprovalsRequired: true;
  readonly registrarCannotBeCustodian: true;
  readonly verifierCannotBeParticipant: true;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly challengeDigest: string;
}

export interface OperatorKeyOwnershipResponseV33_28 {
  readonly version: '33.28';
  readonly responseId: string;
  readonly challengeId: string;
  readonly participantId: string;
  readonly memberRole: CeremonyMemberRoleV33_28;
  readonly organizationId: string;
  readonly hostId: string;
  readonly keyId: string;
  readonly keyFingerprint: string;
  readonly nonceDigest: string;
  readonly respondedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly responseDigest: string;
}

export interface CeremonyCustodianApprovalV33_28 {
  readonly version: '33.28';
  readonly approvalId: string;
  readonly challengeDigest: string;
  readonly ownershipResponseDigest: string;
  readonly custodianId: string;
  readonly approvedAt: string;
  readonly expiresAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly approvalDigest: string;
}

export interface CeremonyEnrollmentRecordV33_28 {
  readonly version: '33.28';
  readonly enrollmentId: string;
  readonly evidenceClass: CeremonyEvidenceClassV33_28;
  readonly participantId: string;
  readonly memberRole: CeremonyMemberRoleV33_28;
  readonly organizationId: string;
  readonly hostId: string;
  readonly keyId: string;
  readonly keyFingerprint: string;
  readonly generation: number;
  readonly priorEnrollmentDigest: string | null;
  readonly lifecycleStatus: 'ACTIVE';
  readonly challengeDigest: string;
  readonly ownershipResponseDigest: string;
  readonly custodianApprovalDigests: readonly [string, string];
  readonly enrolledAt: string;
  readonly expiresAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly enrollmentDigest: string;
}

export interface CeremonyKeyRotationRecordV33_28 {
  readonly version: '33.28';
  readonly rotationId: string;
  readonly participantId: string;
  readonly memberRole: CeremonyMemberRoleV33_28;
  readonly priorEnrollmentDigest: string;
  readonly oldKeyId: string;
  readonly oldKeyFingerprint: string;
  readonly newKeyId: string;
  readonly newKeyFingerprint: string;
  readonly newGeneration: number;
  readonly newChallengeDigest: string;
  readonly newOwnershipResponseDigest: string;
  readonly custodianApprovalDigests: readonly [string, string];
  readonly rotatedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly rotationDigest: string;
}

export interface CeremonyRevocationRecordV33_28 {
  readonly version: '33.28';
  readonly revocationId: string;
  readonly participantId: string;
  readonly memberRole: CeremonyMemberRoleV33_28;
  readonly enrollmentDigest: string;
  readonly keyId: string;
  readonly reason: 'KEY_COMPROMISE' | 'ROLE_CHANGE' | 'HOST_DECOMMISSIONED' | 'OPERATOR_REQUEST';
  readonly effectiveAt: string;
  readonly securityOfficerKeyId: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly revocationDigest: string;
}

export interface WitnessNetworkPolicyV33_28 {
  readonly version: '33.28';
  readonly policyId: string;
  readonly minimumActiveWitnesses: 2;
  readonly maximumObservationAgeMs: number;
  readonly maximumGossipAgeMs: number;
  readonly allActiveWitnessesRequired: true;
  readonly unanimousCheckpointRequired: true;
  readonly bidirectionalGossipRequired: true;
  readonly majorityVotingForbidden: true;
  readonly staleEvidenceFailsClosed: true;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly policyDigest: string;
}

export type WitnessNetworkEventTypeV33_28 =
  | 'ENROLLED'
  | 'ROTATED'
  | 'REVOKED'
  | 'OBSERVATION_ACCEPTED'
  | 'GOSSIP_ACCEPTED'
  | 'SPLIT_VIEW_QUARANTINED'
  | 'STALE_EVIDENCE_REJECTED';

export interface WitnessNetworkLedgerEventV33_28 {
  readonly version: '33.28';
  readonly sequence: number;
  readonly eventId: string;
  readonly eventType: WitnessNetworkEventTypeV33_28;
  readonly subjectId: string;
  readonly evidenceDigest: string;
  readonly previousEventDigest: string | null;
  readonly recordedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly eventDigest: string;
}

export interface WitnessNetworkLedgerSnapshotV33_28 {
  readonly version: '33.28';
  readonly ledgerId: string;
  readonly eventCount: number;
  readonly headEventDigest: string | null;
  readonly events: readonly WitnessNetworkLedgerEventV33_28[];
  readonly generatedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly snapshotDigest: string;
}

export interface WitnessNetworkQualificationVerdictV33_28 {
  readonly version: '33.28';
  readonly verdictId: string;
  readonly status:
    | 'EXTERNAL_WITNESS_NETWORK_QUALIFIED_FOR_PILOT'
    | 'EXTERNAL_WITNESS_NETWORK_QUALIFICATION_REQUIRED'
    | 'INCOMPLETE_NETWORK_FAIL_CLOSED'
    | 'STALE_EVIDENCE_FAIL_CLOSED'
    | 'SPLIT_VIEW_DETECTED_QUARANTINE'
    | 'REJECTED';
  readonly parameterLedgerVerified: true;
  readonly parameterCount: 14;
  readonly activeWitnessCount: number;
  readonly liveWitnessCount: number;
  readonly syntheticWitnessCount: number;
  readonly observationCount: number;
  readonly gossipReceiptCount: number;
  readonly allActiveWitnessesObserved: boolean;
  readonly allEvidenceFresh: boolean;
  readonly unanimousCheckpoint: boolean;
  readonly bidirectionalGossipVerified: boolean;
  readonly majorityVotingUsed: false;
  readonly splitViewDetected: boolean;
  readonly eligibleForProductionPromotion: false;
  readonly evaluatedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly verdictDigest: string;
}

const DIGEST_RE = /^[0-9a-f]{64}$/;

export function createProgramParameterLedgerV33_28(input: {
  readonly signer: SigningIdentity;
  readonly previousLedger: SignedEnvelope<SignedProgramParameterLedgerV33_27>;
  readonly previousLedgerRegistry: KeyRegistry;
  readonly trustedPreviousLedgerSignerIds: readonly string[];
  readonly generatedAt?: Date;
}): SignedEnvelope<SignedProgramParameterLedgerV33_28> {
  const now = input.generatedAt ?? new Date();
  verifySignedProgramParameterLedgerV33_27(input.previousLedger, input.previousLedgerRegistry, input.trustedPreviousLedgerSignerIds, now);
  const expected = defaultProgramParametersV33_27();
  if (sha256(input.previousLedger.payload.parameters) !== sha256(expected)) throw new Error('parameter_ledger_continuity_invalid');
  const material = {
    version: '33.28' as const,
    ledgerId: randomUUID(),
    previousVersion: '33.27' as const,
    previousLedgerDigest: input.previousLedger.payload.ledgerDigest,
    parameterCount: 14 as const,
    parameters: expected,
    preservedParameterCount: 8 as const,
    strengthenedParameterCount: 3 as const,
    externalEvidencePendingParameterCount: 3 as const,
    generatedAt: now.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, ledgerDigest: sha256(material) }, input.signer);
}

export function verifyProgramParameterLedgerV33_28(
  envelope: SignedEnvelope<SignedProgramParameterLedgerV33_28>,
  registry: KeyRegistry,
  trustedSignerIds: readonly string[],
  now: Date = new Date(),
): void {
  if (!trustedSignerIds.includes(envelope.issuerKeyId) || !registry.verifyAt(envelope, now)) throw new Error('parameter_ledger_signature_invalid');
  const p = envelope.payload;
  if (p.version !== '33.28' || p.parameterCount !== 14 || !DIGEST_RE.test(p.previousLedgerDigest)) throw new Error('parameter_ledger_shape_invalid');
  const material = stripDigest(p, 'ledgerDigest');
  if (sha256(material) !== p.ledgerDigest) throw new Error('parameter_ledger_digest_invalid');
  if (sha256(p.parameters) !== sha256(defaultProgramParametersV33_27())) throw new Error('parameter_ledger_continuity_invalid');
  if (p.preservedParameterCount !== 8 || p.strengthenedParameterCount !== 3 || p.externalEvidencePendingParameterCount !== 3) throw new Error('parameter_ledger_status_counts_invalid');
  if (Date.parse(p.generatedAt) > now.getTime() + 60_000) throw new Error('parameter_ledger_time_invalid');
}

export function createOperatorCeremonyChallengeV33_28(input: {
  readonly issuer: SigningIdentity;
  readonly participantId: string;
  readonly memberRole: CeremonyMemberRoleV33_28;
  readonly organizationId: string;
  readonly hostId: string;
  readonly keyId: string;
  readonly keyFingerprint: string;
  readonly nonce: string;
  readonly issuedAt?: Date;
  readonly expiresAt: Date;
}): SignedEnvelope<OperatorCeremonyChallengeV33_28> {
  const issuedAt = input.issuedAt ?? new Date();
  requireText(input.participantId, 'participant_id_required'); requireText(input.organizationId, 'organization_id_required'); requireText(input.hostId, 'host_id_required'); requireText(input.keyId, 'key_id_required');
  if (!DIGEST_RE.test(input.keyFingerprint)) throw new Error('key_fingerprint_invalid');
  if (input.nonce.length < 24) throw new Error('ceremony_nonce_too_short');
  if (input.expiresAt.getTime() <= issuedAt.getTime()) throw new Error('ceremony_challenge_expiry_invalid');
  const material = {
    version: '33.28' as const, challengeId: randomUUID(), participantId: input.participantId, memberRole: input.memberRole,
    organizationId: input.organizationId, hostId: input.hostId, keyId: input.keyId, keyFingerprint: input.keyFingerprint,
    nonceDigest: sha256({ nonce: input.nonce }), issuedAt: issuedAt.toISOString(), expiresAt: input.expiresAt.toISOString(),
    twoCustodianApprovalsRequired: true as const, registrarCannotBeCustodian: true as const, verifierCannotBeParticipant: true as const,
    productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, challengeDigest: sha256(material) }, input.issuer);
}

export function createOperatorKeyOwnershipResponseV33_28(input: {
  readonly participantSigner: SigningIdentity;
  readonly challenge: SignedEnvelope<OperatorCeremonyChallengeV33_28>;
  readonly challengeRegistry: KeyRegistry;
  readonly trustedChallengeSignerIds: readonly string[];
  readonly nonce: string;
  readonly respondedAt?: Date;
}): SignedEnvelope<OperatorKeyOwnershipResponseV33_28> {
  const now = input.respondedAt ?? new Date();
  verifyCeremonyChallenge(input.challenge, input.challengeRegistry, input.trustedChallengeSignerIds, now);
  const c = input.challenge.payload;
  if (input.participantSigner.keyId !== c.keyId) throw new Error('ownership_signer_binding_invalid');
  if (input.challengeRegistry.fingerprint(c.keyId) !== c.keyFingerprint) throw new Error('ownership_key_fingerprint_invalid');
  if (sha256({ nonce: input.nonce }) !== c.nonceDigest) throw new Error('ownership_nonce_invalid');
  const material = {
    version: '33.28' as const, responseId: randomUUID(), challengeId: c.challengeId, participantId: c.participantId,
    memberRole: c.memberRole, organizationId: c.organizationId, hostId: c.hostId, keyId: c.keyId,
    keyFingerprint: c.keyFingerprint, nonceDigest: c.nonceDigest, respondedAt: now.toISOString(),
    productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, responseDigest: sha256(material) }, input.participantSigner);
}

export function createCeremonyCustodianApprovalV33_28(input: {
  readonly custodian: SigningIdentity;
  readonly custodianId: string;
  readonly challenge: SignedEnvelope<OperatorCeremonyChallengeV33_28>;
  readonly ownershipResponse: SignedEnvelope<OperatorKeyOwnershipResponseV33_28>;
  readonly participantRegistry: KeyRegistry;
  readonly approvedAt?: Date;
  readonly expiresAt: Date;
}): SignedEnvelope<CeremonyCustodianApprovalV33_28> {
  const now = input.approvedAt ?? new Date();
  verifyOwnershipResponse(input.ownershipResponse, input.participantRegistry, now);
  if (input.ownershipResponse.payload.challengeId !== input.challenge.payload.challengeId) throw new Error('custodian_challenge_response_mismatch');
  if (input.expiresAt.getTime() <= now.getTime()) throw new Error('custodian_approval_expiry_invalid');
  const material = {
    version: '33.28' as const, approvalId: randomUUID(), challengeDigest: input.challenge.payload.challengeDigest,
    ownershipResponseDigest: input.ownershipResponse.payload.responseDigest, custodianId: input.custodianId,
    approvedAt: now.toISOString(), expiresAt: input.expiresAt.toISOString(), productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, approvalDigest: sha256(material) }, input.custodian);
}

export function createCeremonyEnrollmentRecordV33_28(input: {
  readonly registrar: SigningIdentity;
  readonly registrarRegistry: KeyRegistry;
  readonly trustedRegistrarSignerIds: readonly string[];
  readonly evidenceClass: CeremonyEvidenceClassV33_28;
  readonly challenge: SignedEnvelope<OperatorCeremonyChallengeV33_28>;
  readonly challengeRegistry: KeyRegistry;
  readonly trustedChallengeSignerIds: readonly string[];
  readonly ownershipResponse: SignedEnvelope<OperatorKeyOwnershipResponseV33_28>;
  readonly participantRegistry: KeyRegistry;
  readonly custodianApprovals: readonly [SignedEnvelope<CeremonyCustodianApprovalV33_28>, SignedEnvelope<CeremonyCustodianApprovalV33_28>];
  readonly custodianRegistry: KeyRegistry;
  readonly trustedCustodianSignerIds: readonly string[];
  readonly enrolledAt?: Date;
  readonly expiresAt: Date;
}): SignedEnvelope<CeremonyEnrollmentRecordV33_28> {
  const now = input.enrolledAt ?? new Date();
  if (!input.trustedRegistrarSignerIds.includes(input.registrar.keyId) || input.registrarRegistry.fingerprint(input.registrar.keyId) === undefined) throw new Error('registrar_untrusted');
  verifyCeremonyChallenge(input.challenge, input.challengeRegistry, input.trustedChallengeSignerIds, now);
  verifyOwnershipResponse(input.ownershipResponse, input.participantRegistry, now);
  const c = input.challenge.payload; const r = input.ownershipResponse.payload;
  if (r.challengeId !== c.challengeId || r.keyId !== c.keyId || r.keyFingerprint !== c.keyFingerprint) throw new Error('ceremony_binding_invalid');
  input.custodianApprovals.forEach((a) => verifyCustodianApproval(a, input.custodianRegistry, input.trustedCustodianSignerIds, now));
  const approvals = input.custodianApprovals;
  if (approvals[0].issuerKeyId === approvals[1].issuerKeyId) throw new Error('two_distinct_custodians_required');
  if (approvals.some((a) => a.issuerKeyId === input.registrar.keyId || a.issuerKeyId === c.keyId)) throw new Error('ceremony_role_overlap');
  if (approvals.some((a) => a.payload.challengeDigest !== c.challengeDigest || a.payload.ownershipResponseDigest !== r.responseDigest)) throw new Error('custodian_approval_binding_invalid');
  if (input.expiresAt.getTime() <= now.getTime()) throw new Error('enrollment_expiry_invalid');
  const material = {
    version: '33.28' as const, enrollmentId: randomUUID(), evidenceClass: input.evidenceClass, participantId: c.participantId,
    memberRole: c.memberRole, organizationId: c.organizationId, hostId: c.hostId, keyId: c.keyId,
    keyFingerprint: c.keyFingerprint, generation: 1, priorEnrollmentDigest: null, lifecycleStatus: 'ACTIVE' as const,
    challengeDigest: c.challengeDigest, ownershipResponseDigest: r.responseDigest,
    custodianApprovalDigests: [approvals[0].payload.approvalDigest, approvals[1].payload.approvalDigest] as const,
    enrolledAt: now.toISOString(), expiresAt: input.expiresAt.toISOString(), productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, enrollmentDigest: sha256(material) }, input.registrar);
}

export function createCeremonyKeyRotationRecordV33_28(input: {
  readonly registrar: SigningIdentity;
  readonly priorEnrollment: SignedEnvelope<CeremonyEnrollmentRecordV33_28>;
  readonly registrarRegistry: KeyRegistry;
  readonly trustedRegistrarSignerIds: readonly string[];
  readonly oldSigner: SigningIdentity;
  readonly newChallenge: SignedEnvelope<OperatorCeremonyChallengeV33_28>;
  readonly challengeRegistry: KeyRegistry;
  readonly trustedChallengeSignerIds: readonly string[];
  readonly newOwnershipResponse: SignedEnvelope<OperatorKeyOwnershipResponseV33_28>;
  readonly participantRegistry: KeyRegistry;
  readonly custodianApprovals: readonly [SignedEnvelope<CeremonyCustodianApprovalV33_28>, SignedEnvelope<CeremonyCustodianApprovalV33_28>];
  readonly custodianRegistry: KeyRegistry;
  readonly trustedCustodianSignerIds: readonly string[];
  readonly rotatedAt?: Date;
}): SignedEnvelope<CeremonyKeyRotationRecordV33_28> {
  const now = input.rotatedAt ?? new Date();
  verifyEnrollment(input.priorEnrollment, input.registrarRegistry, input.trustedRegistrarSignerIds, now);
  verifyCeremonyChallenge(input.newChallenge, input.challengeRegistry, input.trustedChallengeSignerIds, now);
  verifyOwnershipResponse(input.newOwnershipResponse, input.participantRegistry, now);
  const prior = input.priorEnrollment.payload; const challenge = input.newChallenge.payload; const ownership = input.newOwnershipResponse.payload;
  if (input.oldSigner.keyId !== prior.keyId) throw new Error('rotation_old_signer_invalid');
  if (challenge.participantId !== prior.participantId || challenge.memberRole !== prior.memberRole || challenge.organizationId !== prior.organizationId || challenge.hostId !== prior.hostId) throw new Error('rotation_identity_binding_invalid');
  if (ownership.challengeId !== challenge.challengeId || ownership.keyId !== challenge.keyId || ownership.keyFingerprint !== challenge.keyFingerprint) throw new Error('rotation_ownership_binding_invalid');
  if (challenge.keyId === prior.keyId || challenge.keyFingerprint === prior.keyFingerprint) throw new Error('rotation_new_key_invalid');
  input.custodianApprovals.forEach((a) => verifyCustodianApproval(a, input.custodianRegistry, input.trustedCustodianSignerIds, now));
  if (input.custodianApprovals[0].issuerKeyId === input.custodianApprovals[1].issuerKeyId) throw new Error('two_distinct_custodians_required');
  if (input.custodianApprovals.some((a) => a.payload.challengeDigest !== challenge.challengeDigest || a.payload.ownershipResponseDigest !== ownership.responseDigest)) throw new Error('rotation_custodian_binding_invalid');
  const material = {
    version: '33.28' as const, rotationId: randomUUID(), participantId: prior.participantId, memberRole: prior.memberRole,
    priorEnrollmentDigest: prior.enrollmentDigest, oldKeyId: prior.keyId, oldKeyFingerprint: prior.keyFingerprint,
    newKeyId: challenge.keyId, newKeyFingerprint: challenge.keyFingerprint, newGeneration: prior.generation + 1,
    newChallengeDigest: challenge.challengeDigest, newOwnershipResponseDigest: ownership.responseDigest,
    custodianApprovalDigests: [input.custodianApprovals[0].payload.approvalDigest, input.custodianApprovals[1].payload.approvalDigest] as const,
    rotatedAt: now.toISOString(), productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, rotationDigest: sha256(material) }, input.registrar);
}

export function applyCeremonyRotationV33_28(input: {
  readonly registrar: SigningIdentity;
  readonly priorEnrollment: SignedEnvelope<CeremonyEnrollmentRecordV33_28>;
  readonly rotation: SignedEnvelope<CeremonyKeyRotationRecordV33_28>;
  readonly registrarRegistry: KeyRegistry;
  readonly trustedRegistrarSignerIds: readonly string[];
  readonly activatedAt?: Date;
  readonly expiresAt: Date;
}): SignedEnvelope<CeremonyEnrollmentRecordV33_28> {
  const now = input.activatedAt ?? new Date();
  verifyEnrollment(input.priorEnrollment, input.registrarRegistry, input.trustedRegistrarSignerIds, now);
  if (!input.trustedRegistrarSignerIds.includes(input.rotation.issuerKeyId) || !input.registrarRegistry.verifyAt(input.rotation, now)) throw new Error('rotation_signature_invalid');
  if (sha256(stripDigest(input.rotation.payload, 'rotationDigest')) !== input.rotation.payload.rotationDigest) throw new Error('rotation_digest_invalid');
  const prior=input.priorEnrollment.payload; const r=input.rotation.payload;
  if (r.priorEnrollmentDigest !== prior.enrollmentDigest || r.newGeneration !== prior.generation + 1) throw new Error('rotation_prior_binding_invalid');
  if (input.expiresAt.getTime() <= now.getTime()) throw new Error('enrollment_expiry_invalid');
  const material={version:'33.28' as const,enrollmentId:randomUUID(),evidenceClass:prior.evidenceClass,participantId:prior.participantId,memberRole:prior.memberRole,organizationId:prior.organizationId,hostId:prior.hostId,keyId:r.newKeyId,keyFingerprint:r.newKeyFingerprint,generation:r.newGeneration,priorEnrollmentDigest:prior.enrollmentDigest,lifecycleStatus:'ACTIVE' as const,challengeDigest:r.newChallengeDigest,ownershipResponseDigest:r.newOwnershipResponseDigest,custodianApprovalDigests:r.custodianApprovalDigests,enrolledAt:now.toISOString(),expiresAt:input.expiresAt.toISOString(),productionAuthority:'NONE' as const,externalEffectsExecuted:0 as const};
  return signEnvelope({...material,enrollmentDigest:sha256(material)},input.registrar);
}

export function createCeremonyRevocationRecordV33_28(input: {
  readonly securityOfficer: SigningIdentity;
  readonly enrollment: SignedEnvelope<CeremonyEnrollmentRecordV33_28>;
  readonly registrarRegistry: KeyRegistry;
  readonly trustedRegistrarSignerIds: readonly string[];
  readonly reason: CeremonyRevocationRecordV33_28['reason'];
  readonly effectiveAt?: Date;
}): SignedEnvelope<CeremonyRevocationRecordV33_28> {
  const now = input.effectiveAt ?? new Date();
  verifyEnrollment(input.enrollment, input.registrarRegistry, input.trustedRegistrarSignerIds, now);
  if (input.securityOfficer.keyId === input.enrollment.payload.keyId || input.trustedRegistrarSignerIds.includes(input.securityOfficer.keyId)) throw new Error('revocation_role_overlap');
  const e = input.enrollment.payload;
  const material = {
    version: '33.28' as const, revocationId: randomUUID(), participantId: e.participantId, memberRole: e.memberRole,
    enrollmentDigest: e.enrollmentDigest, keyId: e.keyId, reason: input.reason, effectiveAt: now.toISOString(),
    securityOfficerKeyId: input.securityOfficer.keyId, productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, revocationDigest: sha256(material) }, input.securityOfficer);
}

export function createWitnessNetworkPolicyV33_28(input: {
  readonly issuer: SigningIdentity;
  readonly maximumObservationAgeMs: number;
  readonly maximumGossipAgeMs: number;
  readonly issuedAt?: Date;
  readonly expiresAt: Date;
}): SignedEnvelope<WitnessNetworkPolicyV33_28> {
  const now = input.issuedAt ?? new Date();
  if (!Number.isInteger(input.maximumObservationAgeMs) || input.maximumObservationAgeMs < 1_000) throw new Error('observation_age_policy_invalid');
  if (!Number.isInteger(input.maximumGossipAgeMs) || input.maximumGossipAgeMs < 1_000) throw new Error('gossip_age_policy_invalid');
  if (input.expiresAt.getTime() <= now.getTime()) throw new Error('network_policy_expiry_invalid');
  const material = {
    version: '33.28' as const, policyId: randomUUID(), minimumActiveWitnesses: 2 as const,
    maximumObservationAgeMs: input.maximumObservationAgeMs, maximumGossipAgeMs: input.maximumGossipAgeMs,
    allActiveWitnessesRequired: true as const, unanimousCheckpointRequired: true as const,
    bidirectionalGossipRequired: true as const, majorityVotingForbidden: true as const, staleEvidenceFailsClosed: true as const,
    issuedAt: now.toISOString(), expiresAt: input.expiresAt.toISOString(), productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, policyDigest: sha256(material) }, input.issuer);
}

export class WitnessNetworkLedgerV33_28 {
  readonly #events: WitnessNetworkLedgerEventV33_28[] = [];
  constructor(readonly ledgerId: string, readonly signer: SigningIdentity) { requireText(ledgerId, 'ledger_id_required'); }
  append(eventType: WitnessNetworkEventTypeV33_28, subjectId: string, evidenceDigest: string, recordedAt: Date = new Date()): SignedEnvelope<WitnessNetworkLedgerEventV33_28> {
    requireText(subjectId, 'ledger_subject_required'); if (!DIGEST_RE.test(evidenceDigest)) throw new Error('ledger_evidence_digest_invalid');
    const previous = this.#events.at(-1)?.eventDigest ?? null;
    const material = { version: '33.28' as const, sequence: this.#events.length + 1, eventId: randomUUID(), eventType, subjectId, evidenceDigest, previousEventDigest: previous, recordedAt: recordedAt.toISOString(), productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const };
    const event = { ...material, eventDigest: sha256(material) }; this.#events.push(event); return signEnvelope(event, this.signer);
  }
  snapshot(generatedAt: Date = new Date()): SignedEnvelope<WitnessNetworkLedgerSnapshotV33_28> {
    const material = { version: '33.28' as const, ledgerId: this.ledgerId, eventCount: this.#events.length, headEventDigest: this.#events.at(-1)?.eventDigest ?? null, events: [...this.#events], generatedAt: generatedAt.toISOString(), productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const };
    return signEnvelope({ ...material, snapshotDigest: sha256(material) }, this.signer);
  }
}

export function verifyWitnessNetworkLedgerSnapshotV33_28(envelope: SignedEnvelope<WitnessNetworkLedgerSnapshotV33_28>, registry: KeyRegistry, trustedSignerIds: readonly string[], now: Date = new Date()): void {
  if (!trustedSignerIds.includes(envelope.issuerKeyId) || !registry.verifyAt(envelope, now)) throw new Error('network_ledger_signature_invalid');
  const s = envelope.payload; if (s.eventCount !== s.events.length) throw new Error('network_ledger_count_invalid');
  let prior: string | null = null;
  s.events.forEach((event, index) => {
    if (event.sequence !== index + 1 || event.previousEventDigest !== prior || sha256(stripDigest(event, 'eventDigest')) !== event.eventDigest) throw new Error('network_ledger_chain_invalid');
    prior = event.eventDigest;
  });
  if (s.headEventDigest !== prior || sha256(stripDigest(s, 'snapshotDigest')) !== s.snapshotDigest) throw new Error('network_ledger_snapshot_invalid');
}

export function evaluateWitnessNetworkV33_28(input: {
  readonly parameterLedger: SignedEnvelope<SignedProgramParameterLedgerV33_28>;
  readonly parameterLedgerRegistry: KeyRegistry;
  readonly trustedParameterLedgerSignerIds: readonly string[];
  readonly policy: SignedEnvelope<WitnessNetworkPolicyV33_28>;
  readonly policyRegistry: KeyRegistry;
  readonly trustedPolicySignerIds: readonly string[];
  readonly witnessEnrollments: readonly SignedEnvelope<CeremonyEnrollmentRecordV33_28>[];
  readonly revocations: readonly SignedEnvelope<CeremonyRevocationRecordV33_28>[];
  readonly registrarRegistry: KeyRegistry;
  readonly trustedRegistrarSignerIds: readonly string[];
  readonly securityRegistry: KeyRegistry;
  readonly trustedSecuritySignerIds: readonly string[];
  readonly observations: readonly SignedEnvelope<TransparencyWitnessObservationV33_27>[];
  readonly gossipReceipts: readonly SignedEnvelope<TransparencyWitnessGossipReceiptV33_27>[];
  readonly witnessRegistry: KeyRegistry;
  readonly trustedWitnessSignerIds: readonly string[];
  readonly verifier: SigningIdentity;
  readonly now?: Date;
}): SignedEnvelope<WitnessNetworkQualificationVerdictV33_28> {
  const now = input.now ?? new Date();
  verifyProgramParameterLedgerV33_28(input.parameterLedger, input.parameterLedgerRegistry, input.trustedParameterLedgerSignerIds, now);
  verifyNetworkPolicy(input.policy, input.policyRegistry, input.trustedPolicySignerIds, now);
  const roleKeys = [...input.trustedParameterLedgerSignerIds, ...input.trustedPolicySignerIds, ...input.trustedRegistrarSignerIds, ...input.trustedSecuritySignerIds, ...input.trustedWitnessSignerIds];
  if (roleKeys.includes(input.verifier.keyId)) throw new Error('network_verifier_role_overlap');
  const enrollments = input.witnessEnrollments.map((e) => { verifyEnrollment(e, input.registrarRegistry, input.trustedRegistrarSignerIds, now); if (e.payload.memberRole !== 'TRANSPARENCY_WITNESS') throw new Error('non_witness_enrollment_in_network'); return e.payload; });
  unique(enrollments.map((e) => e.participantId), 'witness_participant_duplicate'); unique(enrollments.map((e) => e.keyId), 'witness_key_duplicate');
  const revocations = input.revocations.map((r) => { verifyRevocation(r, input.securityRegistry, input.trustedSecuritySignerIds, now); return r.payload; });
  const active = enrollments.filter((e) => !revocations.some((r) => r.enrollmentDigest === e.enrollmentDigest && Date.parse(r.effectiveAt) <= now.getTime()) && Date.parse(e.expiresAt) > now.getTime());
  const observations = input.observations.map((o) => { if (!input.trustedWitnessSignerIds.includes(o.issuerKeyId) || !input.witnessRegistry.verifyAt(o, now)) throw new Error('network_observation_signature_invalid'); if (sha256(stripDigest(o.payload, 'observationDigest')) !== o.payload.observationDigest) throw new Error('network_observation_digest_invalid'); const enrollment=active.find((e)=>e.keyId===o.issuerKeyId); if(enrollment===undefined||enrollment.participantId!==o.payload.witnessId||enrollment.organizationId!==o.payload.witnessOrganizationId||enrollment.hostId!==o.payload.witnessHostId||enrollment.evidenceClass!==o.payload.evidenceClass) throw new Error('network_observation_binding_invalid'); return o.payload; });
  const gossip = input.gossipReceipts.map((g) => { if (!input.trustedWitnessSignerIds.includes(g.issuerKeyId) || !input.witnessRegistry.verifyAt(g, now)) throw new Error('network_gossip_signature_invalid'); if (sha256(stripDigest(g.payload, 'gossipDigest')) !== g.payload.gossipDigest) throw new Error('network_gossip_digest_invalid'); if(g.payload.status==='CONSISTENT'&&g.payload.comparedRootHashes[0]!==g.payload.comparedRootHashes[1]) throw new Error('network_gossip_status_invalid'); if(g.payload.status==='SPLIT_VIEW_DETECTED'&&g.payload.comparedRootHashes[0]===g.payload.comparedRootHashes[1]) throw new Error('network_gossip_status_invalid'); return g.payload; });
  const activeIds = new Set(active.map((e) => e.participantId));
  const acceptedObs = observations.filter((o) => activeIds.has(o.witnessId));
  const independentActiveWitnesses = new Set(active.map((e)=>`${e.organizationId}:${e.hostId}`)).size === active.length;
  const allActiveWitnessesObserved = active.length >= input.policy.payload.minimumActiveWitnesses && independentActiveWitnesses && active.every((e) => acceptedObs.some((o) => o.witnessId === e.participantId));
  const obsFresh = acceptedObs.every((o) => age(now, o.observedAt) <= input.policy.payload.maximumObservationAgeMs);
  const gossipFresh = gossip.every((g) => age(now, g.gossipedAt) <= input.policy.payload.maximumGossipAgeMs);
  const allEvidenceFresh = obsFresh && gossipFresh;
  const coordinateSet = new Set(acceptedObs.map((o) => `${o.logId}:${o.treeSize}`));
  const rootSet = new Set(acceptedObs.map((o) => o.rootHash));
  const unanimousCheckpoint = acceptedObs.length >= 2 && coordinateSet.size === 1 && rootSet.size === 1;
  const splitViewDetected = acceptedObs.length >= 2 && coordinateSet.size === 1 && rootSet.size > 1 || gossip.some((g) => g.status === 'SPLIT_VIEW_DETECTED');
  const bidirectionalGossipVerified = active.length >= 2 && active.every((sender) => active.every((peer) => sender.participantId === peer.participantId || gossip.some((g) => g.senderWitnessId === sender.participantId && g.peerWitnessId === peer.participantId && g.status === 'CONSISTENT')));
  const liveWitnessCount = active.filter((e) => e.evidenceClass === 'LIVE_EXTERNAL').length;
  const syntheticWitnessCount = active.length - liveWitnessCount;
  let status: WitnessNetworkQualificationVerdictV33_28['status'];
  if (splitViewDetected) status = 'SPLIT_VIEW_DETECTED_QUARANTINE';
  else if (!allActiveWitnessesObserved || !bidirectionalGossipVerified) status = 'INCOMPLETE_NETWORK_FAIL_CLOSED';
  else if (!allEvidenceFresh) status = 'STALE_EVIDENCE_FAIL_CLOSED';
  else if (!unanimousCheckpoint) status = 'REJECTED';
  else if (liveWitnessCount === active.length && active.length >= 2) status = 'EXTERNAL_WITNESS_NETWORK_QUALIFIED_FOR_PILOT';
  else status = 'EXTERNAL_WITNESS_NETWORK_QUALIFICATION_REQUIRED';
  const material = {
    version: '33.28' as const, verdictId: randomUUID(), status, parameterLedgerVerified: true as const, parameterCount: 14 as const,
    activeWitnessCount: active.length, liveWitnessCount, syntheticWitnessCount, observationCount: acceptedObs.length, gossipReceiptCount: gossip.length,
    allActiveWitnessesObserved, allEvidenceFresh, unanimousCheckpoint, bidirectionalGossipVerified, majorityVotingUsed: false as const,
    splitViewDetected, eligibleForProductionPromotion: false as const, evaluatedAt: now.toISOString(), productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, verdictDigest: sha256(material) }, input.verifier);
}

function verifyCeremonyChallenge(e: SignedEnvelope<OperatorCeremonyChallengeV33_28>, registry: KeyRegistry, trusted: readonly string[], now: Date): void {
  if (!trusted.includes(e.issuerKeyId) || !registry.verifyAt(e, now)) throw new Error('ceremony_challenge_signature_invalid');
  if (Date.parse(e.payload.expiresAt) <= now.getTime()) throw new Error('ceremony_challenge_expired');
  if (sha256(stripDigest(e.payload, 'challengeDigest')) !== e.payload.challengeDigest) throw new Error('ceremony_challenge_digest_invalid');
}
function verifyOwnershipResponse(e: SignedEnvelope<OperatorKeyOwnershipResponseV33_28>, registry: KeyRegistry, now: Date): void {
  if (!registry.verifyAt(e, now)) throw new Error('ownership_response_signature_invalid');
  if (sha256(stripDigest(e.payload, 'responseDigest')) !== e.payload.responseDigest) throw new Error('ownership_response_digest_invalid');
}
function verifyCustodianApproval(e: SignedEnvelope<CeremonyCustodianApprovalV33_28>, registry: KeyRegistry, trusted: readonly string[], now: Date): void {
  if (!trusted.includes(e.issuerKeyId) || !registry.verifyAt(e, now)) throw new Error('custodian_approval_signature_invalid');
  if (Date.parse(e.payload.expiresAt) <= now.getTime()) throw new Error('custodian_approval_expired');
  if (sha256(stripDigest(e.payload, 'approvalDigest')) !== e.payload.approvalDigest) throw new Error('custodian_approval_digest_invalid');
}
function verifyEnrollment(e: SignedEnvelope<CeremonyEnrollmentRecordV33_28>, registry: KeyRegistry, trusted: readonly string[], now: Date): void {
  if (!trusted.includes(e.issuerKeyId) || !registry.verifyAt(e, now)) throw new Error('ceremony_enrollment_signature_invalid');
  if (sha256(stripDigest(e.payload, 'enrollmentDigest')) !== e.payload.enrollmentDigest) throw new Error('ceremony_enrollment_digest_invalid');
}
function verifyRevocation(e: SignedEnvelope<CeremonyRevocationRecordV33_28>, registry: KeyRegistry, trusted: readonly string[], now: Date): void {
  if (!trusted.includes(e.issuerKeyId) || !registry.verifyAt(e, now)) throw new Error('ceremony_revocation_signature_invalid');
  if (sha256(stripDigest(e.payload, 'revocationDigest')) !== e.payload.revocationDigest) throw new Error('ceremony_revocation_digest_invalid');
}
function verifyNetworkPolicy(e: SignedEnvelope<WitnessNetworkPolicyV33_28>, registry: KeyRegistry, trusted: readonly string[], now: Date): void {
  if (!trusted.includes(e.issuerKeyId) || !registry.verifyAt(e, now)) throw new Error('network_policy_signature_invalid');
  if (Date.parse(e.payload.expiresAt) <= now.getTime()) throw new Error('network_policy_expired');
  if (!e.payload.majorityVotingForbidden || !e.payload.allActiveWitnessesRequired || !e.payload.unanimousCheckpointRequired) throw new Error('network_policy_unsafe');
  if (sha256(stripDigest(e.payload, 'policyDigest')) !== e.payload.policyDigest) throw new Error('network_policy_digest_invalid');
}
function stripDigest<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> { const copy = { ...value }; delete copy[key]; return copy; }
function requireText(value: string, code: string): void { if (value.trim() === '') throw new Error(code); }
function unique(values: readonly string[], code: string): void { if (new Set(values).size !== values.length) throw new Error(code); }
function age(now: Date, value: string): number { const t = Date.parse(value); return Number.isFinite(t) ? Math.max(0, now.getTime() - t) : Number.POSITIVE_INFINITY; }
