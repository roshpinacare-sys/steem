import { randomUUID } from 'node:crypto';
import {
  KeyRegistry,
  sha256,
  signEnvelope,
  type SignedEnvelope,
  type SigningIdentity,
} from '../contracts/crypto.js';
import {
  verifyExternalHumanPilotQualificationVerdictV33_31,
  type ExternalHumanPilotImportCheckpointV33_31,
  type ExternalHumanPilotImportReceiptV33_31,
  type ExternalHumanPilotQualificationVerdictV33_31,
} from './external-human-pilot-evidence-import-v33_31.js';

export interface FederatedCheckpointWitnessDescriptorV33_32 {
  readonly witnessId: string;
  readonly keyId: string;
  readonly keyFingerprint: string;
  readonly organizationId: string;
  readonly hostId: string;
}

export interface FederatedCheckpointWitnessPolicyV33_32 {
  readonly version: '33.32';
  readonly policyId: string;
  readonly studyId: string;
  readonly protocolDigest: string;
  readonly epoch: number;
  readonly quorum: number;
  readonly witnesses: readonly FederatedCheckpointWitnessDescriptorV33_32[];
  readonly importerKeyId: string;
  readonly importerOrganizationId: string;
  readonly importerHostId: string;
  readonly coordinatorKeyId: string;
  readonly coordinatorOrganizationId: string;
  readonly coordinatorHostId: string;
  readonly requireDistinctOrganizations: true;
  readonly requireDistinctHosts: true;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly policyDigest: string;
}

export interface FederatedCheckpointAnchorV33_32 {
  readonly version: '33.32';
  readonly anchorId: string;
  readonly policyDigest: string;
  readonly epoch: number;
  readonly sequence: number;
  readonly checkpointDigest: string;
  readonly certificateDigest: string | null;
  readonly previousAnchorDigest: string | null;
  readonly consumedChallengeDigests: readonly string[];
  readonly consumedPackageDigests: readonly string[];
  readonly anchoredAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly anchorDigest: string;
}

export interface FederatedCheckpointProposalV33_32 {
  readonly version: '33.32';
  readonly proposalId: string;
  readonly policyDigest: string;
  readonly epoch: number;
  readonly studyId: string;
  readonly protocolDigest: string;
  readonly previousAnchorDigest: string;
  readonly previousCheckpointDigest: string;
  readonly previousSequence: number;
  readonly candidateCheckpointDigest: string;
  readonly candidateSequence: number;
  readonly newChallengeDigest: string;
  readonly newPackageDigest: string;
  readonly importerKeyId: string;
  readonly importerOrganizationId: string;
  readonly importerHostId: string;
  readonly proposedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly proposalDigest: string;
}

export interface FederatedCheckpointWitnessVoteV33_32 {
  readonly version: '33.32';
  readonly voteId: string;
  readonly policyDigest: string;
  readonly proposalDigest: string;
  readonly epoch: number;
  readonly sequence: number;
  readonly previousAnchorDigest: string;
  readonly candidateCheckpointDigest: string;
  readonly witnessId: string;
  readonly witnessKeyId: string;
  readonly witnessOrganizationId: string;
  readonly witnessHostId: string;
  readonly decision: 'ACCEPT';
  readonly observedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly voteDigest: string;
}

export interface FederatedCheckpointCertificateV33_32 {
  readonly version: '33.32';
  readonly certificateId: string;
  readonly policyDigest: string;
  readonly proposalDigest: string;
  readonly epoch: number;
  readonly sequence: number;
  readonly previousAnchorDigest: string;
  readonly candidateCheckpointDigest: string;
  readonly newChallengeDigest: string;
  readonly newPackageDigest: string;
  readonly quorumRequired: number;
  readonly witnessVoteDigests: readonly string[];
  readonly witnessKeyIds: readonly string[];
  readonly witnessOrganizationIds: readonly string[];
  readonly witnessHostIds: readonly string[];
  readonly issuedAt: string;
  readonly coordinatorKeyId: string;
  readonly coordinatorOrganizationId: string;
  readonly coordinatorHostId: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly certificateDigest: string;
}

export interface FederatedCheckpointTransitionBundleV33_32 {
  readonly policy: SignedEnvelope<FederatedCheckpointWitnessPolicyV33_32>;
  readonly previousAnchor: SignedEnvelope<FederatedCheckpointAnchorV33_32>;
  readonly previousCheckpoint: SignedEnvelope<ExternalHumanPilotImportCheckpointV33_31>;
  readonly candidateCheckpoint: SignedEnvelope<ExternalHumanPilotImportCheckpointV33_31>;
  readonly proposal: SignedEnvelope<FederatedCheckpointProposalV33_32>;
  readonly votes: readonly SignedEnvelope<FederatedCheckpointWitnessVoteV33_32>[];
  readonly certificate: SignedEnvelope<FederatedCheckpointCertificateV33_32>;
  readonly nextAnchor: SignedEnvelope<FederatedCheckpointAnchorV33_32>;
}

export interface FederatedCheckpointTrustV33_32 {
  readonly policyRegistry: KeyRegistry;
  readonly trustedPolicySignerIds: readonly string[];
  readonly importerRegistry: KeyRegistry;
  readonly trustedImporterIds: readonly string[];
  readonly checkpointRegistry: KeyRegistry;
  readonly trustedCheckpointSignerIds: readonly string[];
  readonly witnessRegistry: KeyRegistry;
  readonly trustedWitnessIds: readonly string[];
  readonly coordinatorRegistry: KeyRegistry;
  readonly trustedCoordinatorIds: readonly string[];
  readonly anchorRegistry: KeyRegistry;
  readonly trustedAnchorSignerIds: readonly string[];
}

export interface FederatedCheckpointEquivocationFindingV33_32 {
  readonly witnessKeyId: string;
  readonly epoch: number;
  readonly sequence: number;
  readonly previousAnchorDigest: string;
  readonly conflictingCandidateCheckpointDigests: readonly string[];
  readonly conflictingVoteDigests: readonly string[];
}

export interface ExternalHumanPilotExecutionRoleV33_32 {
  readonly role: 'PILOT_OPERATOR' | 'RESEARCHER' | 'REGISTRAR' | 'EXPORTER' | 'IMPORTER' | 'OBSERVER' | 'VERIFIER' | 'WITNESS_COORDINATOR' | 'PRIVACY_OFFICER';
  readonly organizationId: string;
  readonly hostId: string;
  readonly keyId: string;
}

export interface ExternalHumanPilotExecutionKitV33_32 {
  readonly version: '33.32';
  readonly kitId: string;
  readonly studyId: string;
  readonly protocolDigest: string;
  readonly witnessPolicyDigest: string;
  readonly minimumExternalParticipants: number;
  readonly comparativeScenarioCount: number;
  readonly roleAssignments: readonly ExternalHumanPilotExecutionRoleV33_32[];
  readonly consentRequiredBeforeInstrumentation: true;
  readonly withdrawalSupported: true;
  readonly withdrawalDeletionSlaHours: number;
  readonly retentionDays: number;
  readonly rawPiiCollectionAllowed: false;
  readonly audioCollectionAllowed: false;
  readonly videoCollectionAllowed: false;
  readonly maximumClockSkewSeconds: number;
  readonly witnessQuorumRequiredDuringImport: true;
  readonly abortConditions: readonly string[];
  readonly preflightChecklist: readonly string[];
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly externalExecutionPerformed: false;
  readonly externalHumanParticipants: 0;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly kitDigest: string;
}

export interface ExternalHumanPilotExecutionReadinessV33_32 {
  readonly version: '33.32';
  readonly kitDigest: string;
  readonly status: 'STRUCTURALLY_READY_EXTERNAL_EXECUTION_NOT_PERFORMED';
  readonly structuralChecksPassed: true;
  readonly externalExecutionPerformed: false;
  readonly externalHumanParticipants: 0;
  readonly blockers: readonly string[];
  readonly evaluatedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly readinessDigest: string;
}

export interface FederatedHumanPilotQualificationVerdictV33_32 {
  readonly version: '33.32';
  readonly verdictId: string;
  readonly studyId: string;
  readonly protocolDigest: string;
  readonly packageDigest: string;
  readonly importReceiptDigest: string;
  readonly baseV33_31VerdictDigest: string;
  readonly checkpointCertificateDigest: string;
  readonly checkpointAnchorDigest: string;
  readonly checkpointEpoch: number;
  readonly checkpointSequence: number;
  readonly witnessQuorumVerified: true;
  readonly rollbackResistanceProtocolVerified: true;
  readonly equivocationDetectionEnabled: true;
  readonly externalProvenanceVerified: boolean;
  readonly participantCount: number;
  readonly externalHumanParticipants: number;
  readonly humanPilotPassed: boolean;
  readonly status:
    | 'HUMAN_UX_PILOT_PASSED_SHADOW_ONLY_FEDERATED_CHECKPOINT'
    | 'HUMAN_UX_PILOT_REQUIRED'
    | 'HUMAN_UX_PILOT_FAILED_THRESHOLDS'
    | 'HUMAN_UX_PILOT_INSUFFICIENT_EVIDENCE';
  readonly blockers: readonly string[];
  readonly generatedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly verdictDigest: string;
}

export function createFederatedCheckpointWitnessPolicyV33_32(input: {
  readonly policySigner: SigningIdentity;
  readonly studyId: string;
  readonly protocolDigest: string;
  readonly epoch: number;
  readonly quorum: number;
  readonly witnesses: readonly FederatedCheckpointWitnessDescriptorV33_32[];
  readonly importer: { readonly keyId: string; readonly organizationId: string; readonly hostId: string };
  readonly coordinator: { readonly keyId: string; readonly organizationId: string; readonly hostId: string };
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}): SignedEnvelope<FederatedCheckpointWitnessPolicyV33_32> {
  requireDate(input.issuedAt, 'v33_32_policy_time_invalid');
  requireDate(input.expiresAt, 'v33_32_policy_time_invalid');
  if (input.expiresAt.getTime() <= input.issuedAt.getTime()) throw new Error('v33_32_policy_window_invalid');
  identifier(input.studyId, 'v33_32_study_id_invalid');
  digest(input.protocolDigest, 'v33_32_protocol_digest_invalid');
  if (!Number.isInteger(input.epoch) || input.epoch < 1) throw new Error('v33_32_policy_epoch_invalid');
  if (!Number.isInteger(input.quorum) || input.quorum < 3 || input.quorum > input.witnesses.length) throw new Error('v33_32_policy_quorum_invalid');
  const witnesses = normalizeWitnesses(input.witnesses);
  ensureDistinctRoleBoundary(witnesses, input.importer, input.coordinator);
  const material = {
    version: '33.32' as const,
    policyId: randomUUID(),
    studyId: input.studyId,
    protocolDigest: input.protocolDigest,
    epoch: input.epoch,
    quorum: input.quorum,
    witnesses,
    importerKeyId: identifier(input.importer.keyId, 'v33_32_importer_key_invalid'),
    importerOrganizationId: identifier(input.importer.organizationId, 'v33_32_importer_org_invalid'),
    importerHostId: identifier(input.importer.hostId, 'v33_32_importer_host_invalid'),
    coordinatorKeyId: identifier(input.coordinator.keyId, 'v33_32_coordinator_key_invalid'),
    coordinatorOrganizationId: identifier(input.coordinator.organizationId, 'v33_32_coordinator_org_invalid'),
    coordinatorHostId: identifier(input.coordinator.hostId, 'v33_32_coordinator_host_invalid'),
    requireDistinctOrganizations: true as const,
    requireDistinctHosts: true as const,
    issuedAt: input.issuedAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, policyDigest: sha256(material) }, input.policySigner);
}

export function createFederatedCheckpointGenesisAnchorV33_32(input: {
  readonly anchorSigner: SigningIdentity;
  readonly policy: SignedEnvelope<FederatedCheckpointWitnessPolicyV33_32>;
  readonly initialCheckpoint: SignedEnvelope<ExternalHumanPilotImportCheckpointV33_31>;
  readonly generatedAt: Date;
}): SignedEnvelope<FederatedCheckpointAnchorV33_32> {
  requireDate(input.generatedAt, 'v33_32_anchor_time_invalid');
  const checkpoint = basicCheckpoint(input.initialCheckpoint.payload);
  if (checkpoint.sequence !== 0 || checkpoint.previousCheckpointDigest !== null) throw new Error('v33_32_genesis_checkpoint_invalid');
  const material = {
    version: '33.32' as const,
    anchorId: randomUUID(),
    policyDigest: input.policy.payload.policyDigest,
    epoch: input.policy.payload.epoch,
    sequence: 0,
    checkpointDigest: checkpoint.checkpointDigest,
    certificateDigest: null,
    previousAnchorDigest: null,
    consumedChallengeDigests: [...checkpoint.consumedChallengeDigests],
    consumedPackageDigests: [...checkpoint.consumedPackageDigests],
    anchoredAt: input.generatedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, anchorDigest: sha256(material) }, input.anchorSigner);
}

export function createFederatedCheckpointProposalV33_32(input: {
  readonly importer: SigningIdentity;
  readonly policy: SignedEnvelope<FederatedCheckpointWitnessPolicyV33_32>;
  readonly previousAnchor: SignedEnvelope<FederatedCheckpointAnchorV33_32>;
  readonly previousCheckpoint: SignedEnvelope<ExternalHumanPilotImportCheckpointV33_31>;
  readonly candidateCheckpoint: SignedEnvelope<ExternalHumanPilotImportCheckpointV33_31>;
  readonly newChallengeDigest: string;
  readonly newPackageDigest: string;
  readonly proposedAt: Date;
}): SignedEnvelope<FederatedCheckpointProposalV33_32> {
  requireDate(input.proposedAt, 'v33_32_proposal_time_invalid');
  const policy = input.policy.payload;
  const priorAnchor = input.previousAnchor.payload;
  const prior = basicCheckpoint(input.previousCheckpoint.payload);
  const candidate = basicCheckpoint(input.candidateCheckpoint.payload);
  validateTransitionShape(policy, priorAnchor, prior, candidate, input.newChallengeDigest, input.newPackageDigest);
  if (input.importer.keyId !== policy.importerKeyId) throw new Error('v33_32_proposal_importer_key_mismatch');
  const material = {
    version: '33.32' as const,
    proposalId: randomUUID(),
    policyDigest: policy.policyDigest,
    epoch: policy.epoch,
    studyId: policy.studyId,
    protocolDigest: policy.protocolDigest,
    previousAnchorDigest: priorAnchor.anchorDigest,
    previousCheckpointDigest: prior.checkpointDigest,
    previousSequence: prior.sequence,
    candidateCheckpointDigest: candidate.checkpointDigest,
    candidateSequence: candidate.sequence,
    newChallengeDigest: input.newChallengeDigest,
    newPackageDigest: input.newPackageDigest,
    importerKeyId: policy.importerKeyId,
    importerOrganizationId: policy.importerOrganizationId,
    importerHostId: policy.importerHostId,
    proposedAt: input.proposedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, proposalDigest: sha256(material) }, input.importer);
}

export function createFederatedCheckpointWitnessVoteV33_32(input: {
  readonly witness: SigningIdentity;
  readonly witnessId: string;
  readonly policy: SignedEnvelope<FederatedCheckpointWitnessPolicyV33_32>;
  readonly proposal: SignedEnvelope<FederatedCheckpointProposalV33_32>;
  readonly observedAt: Date;
}): SignedEnvelope<FederatedCheckpointWitnessVoteV33_32> {
  requireDate(input.observedAt, 'v33_32_vote_time_invalid');
  const descriptor = input.policy.payload.witnesses.find((row) => row.witnessId === input.witnessId);
  if (!descriptor || descriptor.keyId !== input.witness.keyId) throw new Error('v33_32_witness_not_enrolled');
  const proposal = input.proposal.payload;
  if (proposal.policyDigest !== input.policy.payload.policyDigest || proposal.epoch !== input.policy.payload.epoch) throw new Error('v33_32_vote_proposal_binding_invalid');
  const material = {
    version: '33.32' as const,
    voteId: randomUUID(),
    policyDigest: proposal.policyDigest,
    proposalDigest: proposal.proposalDigest,
    epoch: proposal.epoch,
    sequence: proposal.candidateSequence,
    previousAnchorDigest: proposal.previousAnchorDigest,
    candidateCheckpointDigest: proposal.candidateCheckpointDigest,
    witnessId: descriptor.witnessId,
    witnessKeyId: descriptor.keyId,
    witnessOrganizationId: descriptor.organizationId,
    witnessHostId: descriptor.hostId,
    decision: 'ACCEPT' as const,
    observedAt: input.observedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, voteDigest: sha256(material) }, input.witness);
}

export function finalizeFederatedCheckpointTransitionV33_32(input: {
  readonly coordinator: SigningIdentity;
  readonly bundle: Omit<FederatedCheckpointTransitionBundleV33_32, 'certificate' | 'nextAnchor'> & { readonly votes: readonly SignedEnvelope<FederatedCheckpointWitnessVoteV33_32>[] };
  readonly trust: FederatedCheckpointTrustV33_32;
  readonly issuedAt: Date;
}): { readonly certificate: SignedEnvelope<FederatedCheckpointCertificateV33_32>; readonly nextAnchor: SignedEnvelope<FederatedCheckpointAnchorV33_32> } {
  requireDate(input.issuedAt, 'v33_32_certificate_time_invalid');
  const verified = verifyTransitionCore(input.bundle, input.trust, input.issuedAt);
  if (input.coordinator.keyId !== verified.policy.coordinatorKeyId) throw new Error('v33_32_coordinator_key_mismatch');
  const votes = verified.votes.slice().sort((a, b) => a.witnessKeyId.localeCompare(b.witnessKeyId));
  const certificateMaterial = {
    version: '33.32' as const,
    certificateId: randomUUID(),
    policyDigest: verified.policy.policyDigest,
    proposalDigest: verified.proposal.proposalDigest,
    epoch: verified.policy.epoch,
    sequence: verified.candidate.sequence,
    previousAnchorDigest: verified.anchor.anchorDigest,
    candidateCheckpointDigest: verified.candidate.checkpointDigest,
    newChallengeDigest: verified.proposal.newChallengeDigest,
    newPackageDigest: verified.proposal.newPackageDigest,
    quorumRequired: verified.policy.quorum,
    witnessVoteDigests: votes.map((row) => row.voteDigest),
    witnessKeyIds: votes.map((row) => row.witnessKeyId),
    witnessOrganizationIds: votes.map((row) => row.witnessOrganizationId),
    witnessHostIds: votes.map((row) => row.witnessHostId),
    issuedAt: input.issuedAt.toISOString(),
    coordinatorKeyId: verified.policy.coordinatorKeyId,
    coordinatorOrganizationId: verified.policy.coordinatorOrganizationId,
    coordinatorHostId: verified.policy.coordinatorHostId,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  const certificate = signEnvelope({ ...certificateMaterial, certificateDigest: sha256(certificateMaterial) }, input.coordinator);
  const anchorMaterial = {
    version: '33.32' as const,
    anchorId: randomUUID(),
    policyDigest: verified.policy.policyDigest,
    epoch: verified.policy.epoch,
    sequence: verified.candidate.sequence,
    checkpointDigest: verified.candidate.checkpointDigest,
    certificateDigest: certificate.payload.certificateDigest,
    previousAnchorDigest: verified.anchor.anchorDigest,
    consumedChallengeDigests: [...verified.candidate.consumedChallengeDigests],
    consumedPackageDigests: [...verified.candidate.consumedPackageDigests],
    anchoredAt: input.issuedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  const nextAnchor = signEnvelope({ ...anchorMaterial, anchorDigest: sha256(anchorMaterial) }, input.coordinator);
  return { certificate, nextAnchor };
}

export function verifyFederatedCheckpointTransitionV33_32(input: {
  readonly bundle: FederatedCheckpointTransitionBundleV33_32;
  readonly trust: FederatedCheckpointTrustV33_32;
  readonly verifiedAt: Date;
}): FederatedCheckpointAnchorV33_32 {
  requireDate(input.verifiedAt, 'v33_32_verify_time_invalid');
  const verified = verifyTransitionCore(input.bundle, input.trust, input.verifiedAt);
  const certificate = verifyCertificate(input.bundle.certificate, input.trust, verified.policy, input.verifiedAt);
  const nextAnchor = verifyAnchor(input.bundle.nextAnchor, input.trust, input.verifiedAt);
  if (certificate.policyDigest !== verified.policy.policyDigest || certificate.proposalDigest !== verified.proposal.proposalDigest) throw new Error('v33_32_certificate_binding_invalid');
  if (certificate.sequence !== verified.candidate.sequence || certificate.candidateCheckpointDigest !== verified.candidate.checkpointDigest) throw new Error('v33_32_certificate_checkpoint_binding_invalid');
  if (certificate.previousAnchorDigest !== verified.anchor.anchorDigest) throw new Error('v33_32_certificate_anchor_binding_invalid');
  if (certificate.newChallengeDigest !== verified.proposal.newChallengeDigest || certificate.newPackageDigest !== verified.proposal.newPackageDigest) throw new Error('v33_32_certificate_consumption_binding_invalid');
  const votes = verified.votes.slice().sort((a, b) => a.witnessKeyId.localeCompare(b.witnessKeyId));
  if (!equalArrays(certificate.witnessVoteDigests, votes.map((row) => row.voteDigest)) || !equalArrays(certificate.witnessKeyIds, votes.map((row) => row.witnessKeyId))) throw new Error('v33_32_certificate_vote_set_invalid');
  if (!equalArrays(certificate.witnessOrganizationIds, votes.map((row) => row.witnessOrganizationId)) || !equalArrays(certificate.witnessHostIds, votes.map((row) => row.witnessHostId))) throw new Error('v33_32_certificate_topology_invalid');
  if (certificate.quorumRequired !== verified.policy.quorum || certificate.witnessKeyIds.length < verified.policy.quorum) throw new Error('v33_32_certificate_quorum_invalid');
  if (input.bundle.nextAnchor.issuerKeyId !== verified.policy.coordinatorKeyId) throw new Error('v33_32_next_anchor_signer_invalid');
  if (nextAnchor.policyDigest !== verified.policy.policyDigest || nextAnchor.epoch !== verified.policy.epoch || nextAnchor.sequence !== verified.candidate.sequence) throw new Error('v33_32_next_anchor_policy_invalid');
  if (nextAnchor.checkpointDigest !== verified.candidate.checkpointDigest || nextAnchor.certificateDigest !== certificate.certificateDigest || nextAnchor.previousAnchorDigest !== verified.anchor.anchorDigest) throw new Error('v33_32_next_anchor_binding_invalid');
  if (!equalArrays(nextAnchor.consumedChallengeDigests, verified.candidate.consumedChallengeDigests) || !equalArrays(nextAnchor.consumedPackageDigests, verified.candidate.consumedPackageDigests)) throw new Error('v33_32_next_anchor_consumption_invalid');
  return nextAnchor;
}

export function detectFederatedCheckpointEquivocationV33_32(votes: readonly SignedEnvelope<FederatedCheckpointWitnessVoteV33_32>[]): readonly FederatedCheckpointEquivocationFindingV33_32[] {
  const groups = new Map<string, FederatedCheckpointWitnessVoteV33_32[]>();
  for (const envelope of votes) {
    const vote = envelope.payload;
    const key = `${vote.witnessKeyId}|${vote.epoch}|${vote.sequence}|${vote.previousAnchorDigest}`;
    const rows = groups.get(key) ?? [];
    rows.push(vote);
    groups.set(key, rows);
  }
  const findings: FederatedCheckpointEquivocationFindingV33_32[] = [];
  for (const rows of groups.values()) {
    const candidates = [...new Set(rows.map((row) => row.candidateCheckpointDigest))].sort();
    if (candidates.length < 2) continue;
    const first = rows[0]!;
    findings.push({
      witnessKeyId: first.witnessKeyId,
      epoch: first.epoch,
      sequence: first.sequence,
      previousAnchorDigest: first.previousAnchorDigest,
      conflictingCandidateCheckpointDigests: candidates,
      conflictingVoteDigests: rows.map((row) => row.voteDigest).sort(),
    });
  }
  return findings.sort((a, b) => a.witnessKeyId.localeCompare(b.witnessKeyId));
}

export function createExternalHumanPilotExecutionKitV33_32(input: {
  readonly pilotOperator: SigningIdentity;
  readonly studyId: string;
  readonly protocolDigest: string;
  readonly witnessPolicyDigest: string;
  readonly roleAssignments: readonly ExternalHumanPilotExecutionRoleV33_32[];
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly retentionDays?: number;
  readonly withdrawalDeletionSlaHours?: number;
  readonly maximumClockSkewSeconds?: number;
}): SignedEnvelope<ExternalHumanPilotExecutionKitV33_32> {
  requireDate(input.issuedAt, 'v33_32_kit_time_invalid');
  requireDate(input.expiresAt, 'v33_32_kit_time_invalid');
  if (input.expiresAt.getTime() <= input.issuedAt.getTime()) throw new Error('v33_32_kit_window_invalid');
  const roleAssignments = normalizeExecutionRoles(input.roleAssignments);
  const requiredRoles: ExternalHumanPilotExecutionRoleV33_32['role'][] = ['PILOT_OPERATOR','RESEARCHER','REGISTRAR','EXPORTER','IMPORTER','OBSERVER','VERIFIER','WITNESS_COORDINATOR','PRIVACY_OFFICER'];
  for (const role of requiredRoles) if (!roleAssignments.some((row) => row.role === role)) throw new Error(`v33_32_kit_role_missing:${role}`);
  const operator = roleAssignments.find((row) => row.role === 'PILOT_OPERATOR')!;
  if (operator.keyId !== input.pilotOperator.keyId) throw new Error('v33_32_kit_operator_key_mismatch');
  const retentionDays = boundedInteger(input.retentionDays ?? 30, 1, 30, 'v33_32_retention_invalid');
  const withdrawalDeletionSlaHours = boundedInteger(input.withdrawalDeletionSlaHours ?? 24, 1, 72, 'v33_32_withdrawal_sla_invalid');
  const maximumClockSkewSeconds = boundedInteger(input.maximumClockSkewSeconds ?? 120, 1, 300, 'v33_32_clock_skew_invalid');
  const abortConditions = ['CONSENT_INVALID','WITNESS_QUORUM_LOST','CLOCK_SKEW_EXCEEDED','DATA_SCOPE_VIOLATION','PARTICIPANT_DISTRESS','SECURITY_INCIDENT'] as const;
  const preflightChecklist = ['ROLE_KEYS_VERIFIED','CONSENT_FORM_APPROVED','WITHDRAWAL_CHANNEL_TESTED','CLOCKS_SYNCHRONIZED','WITNESS_QUORUM_ONLINE','RETENTION_JOB_TESTED','INCIDENT_ABORT_PATH_TESTED','PRODUCTION_AUTHORITY_NONE'] as const;
  const material = {
    version: '33.32' as const,
    kitId: randomUUID(),
    studyId: identifier(input.studyId, 'v33_32_kit_study_invalid'),
    protocolDigest: digest(input.protocolDigest, 'v33_32_kit_protocol_digest_invalid'),
    witnessPolicyDigest: digest(input.witnessPolicyDigest, 'v33_32_kit_policy_digest_invalid'),
    minimumExternalParticipants: 5,
    comparativeScenarioCount: 3,
    roleAssignments,
    consentRequiredBeforeInstrumentation: true as const,
    withdrawalSupported: true as const,
    withdrawalDeletionSlaHours,
    retentionDays,
    rawPiiCollectionAllowed: false as const,
    audioCollectionAllowed: false as const,
    videoCollectionAllowed: false as const,
    maximumClockSkewSeconds,
    witnessQuorumRequiredDuringImport: true as const,
    abortConditions,
    preflightChecklist,
    issuedAt: input.issuedAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    externalExecutionPerformed: false as const,
    externalHumanParticipants: 0 as const,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, kitDigest: sha256(material) }, input.pilotOperator);
}

export function verifyExternalHumanPilotExecutionKitV33_32(input: {
  readonly kit: SignedEnvelope<ExternalHumanPilotExecutionKitV33_32>;
  readonly operatorRegistry: KeyRegistry;
  readonly trustedOperatorIds: readonly string[];
  readonly expectedProtocolDigest: string;
  readonly expectedWitnessPolicyDigest: string;
  readonly evaluatedAt: Date;
}): ExternalHumanPilotExecutionReadinessV33_32 {
  requireDate(input.evaluatedAt, 'v33_32_kit_verify_time_invalid');
  const kit = input.kit.payload;
  if (!input.trustedOperatorIds.includes(input.kit.issuerKeyId) || !input.operatorRegistry.verifyAt(input.kit, input.evaluatedAt)) throw new Error('v33_32_kit_signature_invalid');
  const { kitDigest, ...material } = kit;
  if (kitDigest !== sha256(material)) throw new Error('v33_32_kit_digest_invalid');
  if (kit.protocolDigest !== input.expectedProtocolDigest || kit.witnessPolicyDigest !== input.expectedWitnessPolicyDigest) throw new Error('v33_32_kit_binding_invalid');
  if (input.evaluatedAt.getTime() < Date.parse(kit.issuedAt) || input.evaluatedAt.getTime() >= Date.parse(kit.expiresAt)) throw new Error('v33_32_kit_not_active');
  const verifiedRoles = normalizeExecutionRoles(kit.roleAssignments);
  const requiredRoles: ExternalHumanPilotExecutionRoleV33_32['role'][] = ['PILOT_OPERATOR','RESEARCHER','REGISTRAR','EXPORTER','IMPORTER','OBSERVER','VERIFIER','WITNESS_COORDINATOR','PRIVACY_OFFICER'];
  for (const role of requiredRoles) if (!verifiedRoles.some((row) => row.role === role)) throw new Error(`v33_32_kit_role_missing:${role}`);
  const operator = verifiedRoles.find((row) => row.role === 'PILOT_OPERATOR')!;
  if (operator.keyId !== input.kit.issuerKeyId) throw new Error('v33_32_kit_operator_binding_invalid');
  if (kit.minimumExternalParticipants < 5 || kit.comparativeScenarioCount < 3 || kit.retentionDays > 30 || kit.withdrawalDeletionSlaHours > 72 || kit.maximumClockSkewSeconds > 300) throw new Error('v33_32_kit_limits_invalid');
  const requiredAbort = ['CONSENT_INVALID','WITNESS_QUORUM_LOST','CLOCK_SKEW_EXCEEDED','DATA_SCOPE_VIOLATION','PARTICIPANT_DISTRESS','SECURITY_INCIDENT'];
  if (requiredAbort.some((value) => !kit.abortConditions.includes(value))) throw new Error('v33_32_kit_abort_conditions_incomplete');
  if (!kit.consentRequiredBeforeInstrumentation || !kit.withdrawalSupported || !kit.witnessQuorumRequiredDuringImport || kit.rawPiiCollectionAllowed || kit.audioCollectionAllowed || kit.videoCollectionAllowed) throw new Error('v33_32_kit_privacy_boundary_invalid');
  if (kit.externalExecutionPerformed || kit.externalHumanParticipants !== 0 || kit.productionAuthority !== 'NONE' || kit.externalEffectsExecuted !== 0) throw new Error('v33_32_kit_false_execution_claim');
  const readinessMaterial = {
    version: '33.32' as const,
    kitDigest: kit.kitDigest,
    status: 'STRUCTURALLY_READY_EXTERNAL_EXECUTION_NOT_PERFORMED' as const,
    structuralChecksPassed: true as const,
    externalExecutionPerformed: false as const,
    externalHumanParticipants: 0 as const,
    blockers: ['independent_organizations_not_yet_assigned','external_participants_not_yet_recruited','protected_witness_hosts_not_yet_observed','privacy_retention_approval_pending'] as readonly string[],
    evaluatedAt: input.evaluatedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return { ...readinessMaterial, readinessDigest: sha256(readinessMaterial) };
}

export function finalizeFederatedHumanPilotVerdictV33_32(input: {
  readonly verifier: SigningIdentity;
  readonly baseVerdict: SignedEnvelope<ExternalHumanPilotQualificationVerdictV33_31>;
  readonly baseReceipt: SignedEnvelope<ExternalHumanPilotImportReceiptV33_31>;
  readonly baseVerifierRegistry: KeyRegistry;
  readonly trustedBaseVerifierIds: readonly string[];
  readonly receiptRegistry: KeyRegistry;
  readonly trustedReceiptSignerIds: readonly string[];
  readonly transition: FederatedCheckpointTransitionBundleV33_32;
  readonly transitionTrust: FederatedCheckpointTrustV33_32;
  readonly generatedAt: Date;
}): SignedEnvelope<FederatedHumanPilotQualificationVerdictV33_32> {
  requireDate(input.generatedAt, 'v33_32_final_verdict_time_invalid');
  const base = verifyExternalHumanPilotQualificationVerdictV33_31({
    verdict: input.baseVerdict,
    verifierRegistry: input.baseVerifierRegistry,
    trustedVerifierIds: input.trustedBaseVerifierIds,
    expectedProtocolDigest: input.baseVerdict.payload.protocolDigest,
    expectedPackageDigest: input.baseVerdict.payload.packageDigest,
  });
  const receipt = verifyReceipt(input.baseReceipt, input.receiptRegistry, input.trustedReceiptSignerIds, input.generatedAt);
  const anchor = verifyFederatedCheckpointTransitionV33_32({ bundle: input.transition, trust: input.transitionTrust, verifiedAt: input.generatedAt });
  const certificate = input.transition.certificate.payload;
  if (receipt.packageDigest !== base.packageDigest || receipt.receiptDigest !== base.importReceiptDigest || receipt.participantCount !== base.participantCount || receipt.evidenceClass !== base.evidenceClass) throw new Error('v33_32_receipt_verdict_binding_invalid');
  const receiptClassValid = receipt.evidenceClass === 'LIVE_EXTERNAL'
    ? receipt.status === 'VERIFIED_LIVE_EXTERNAL_EVIDENCE_READY_FOR_EVALUATION' && receipt.externalHumanParticipants === receipt.participantCount
    : receipt.status === 'SYNTHETIC_REFERENCE_NOT_EXTERNAL' && receipt.externalHumanParticipants === 0;
  if (!receiptClassValid || (base.externalProvenanceVerified && receipt.evidenceClass !== 'LIVE_EXTERNAL')) throw new Error('v33_32_receipt_evidence_class_invalid');
  if (receipt.checkpointSequence !== anchor.sequence || certificate.newPackageDigest !== receipt.packageDigest || certificate.newChallengeDigest !== receipt.challengeDigest) throw new Error('v33_32_receipt_checkpoint_binding_invalid');
  const humanPilotPassed = base.humanPilotPassed && base.externalProvenanceVerified && receipt.externalHumanParticipants >= 5;
  const status: FederatedHumanPilotQualificationVerdictV33_32['status'] = humanPilotPassed
    ? 'HUMAN_UX_PILOT_PASSED_SHADOW_ONLY_FEDERATED_CHECKPOINT'
    : base.status === 'HUMAN_UX_PILOT_FAILED_THRESHOLDS'
      ? 'HUMAN_UX_PILOT_FAILED_THRESHOLDS'
      : base.status === 'HUMAN_UX_PILOT_INSUFFICIENT_EVIDENCE'
        ? 'HUMAN_UX_PILOT_INSUFFICIENT_EVIDENCE'
        : 'HUMAN_UX_PILOT_REQUIRED';
  const blockers = humanPilotPassed ? [] : [...base.blockers, ...(base.externalProvenanceVerified ? [] : ['external_provenance_required']), ...(receipt.externalHumanParticipants >= 5 ? [] : ['five_external_participants_required'])];
  const material = {
    version: '33.32' as const,
    verdictId: randomUUID(),
    studyId: base.studyId,
    protocolDigest: base.protocolDigest,
    packageDigest: base.packageDigest,
    importReceiptDigest: receipt.receiptDigest,
    baseV33_31VerdictDigest: base.verdictDigest,
    checkpointCertificateDigest: certificate.certificateDigest,
    checkpointAnchorDigest: anchor.anchorDigest,
    checkpointEpoch: anchor.epoch,
    checkpointSequence: anchor.sequence,
    witnessQuorumVerified: true as const,
    rollbackResistanceProtocolVerified: true as const,
    equivocationDetectionEnabled: true as const,
    externalProvenanceVerified: base.externalProvenanceVerified,
    participantCount: base.participantCount,
    externalHumanParticipants: receipt.externalHumanParticipants,
    humanPilotPassed,
    status,
    blockers: [...new Set(blockers)].sort(),
    generatedAt: input.generatedAt.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, verdictDigest: sha256(material) }, input.verifier);
}

function verifyTransitionCore(bundle: Omit<FederatedCheckpointTransitionBundleV33_32, 'certificate' | 'nextAnchor'> & { readonly votes: readonly SignedEnvelope<FederatedCheckpointWitnessVoteV33_32>[] }, trust: FederatedCheckpointTrustV33_32, now: Date): {
  readonly policy: FederatedCheckpointWitnessPolicyV33_32;
  readonly anchor: FederatedCheckpointAnchorV33_32;
  readonly prior: ExternalHumanPilotImportCheckpointV33_31;
  readonly candidate: ExternalHumanPilotImportCheckpointV33_31;
  readonly proposal: FederatedCheckpointProposalV33_32;
  readonly votes: readonly FederatedCheckpointWitnessVoteV33_32[];
} {
  const policy = verifyPolicy(bundle.policy, trust, now);
  const anchor = verifyAnchor(bundle.previousAnchor, trust, now);
  const prior = verifyCheckpoint(bundle.previousCheckpoint, trust, now);
  const candidate = verifyCheckpoint(bundle.candidateCheckpoint, trust, now);
  const proposal = verifyProposal(bundle.proposal, trust, policy, now);
  validateTransitionShape(policy, anchor, prior, candidate, proposal.newChallengeDigest, proposal.newPackageDigest);
  if (proposal.previousAnchorDigest !== anchor.anchorDigest || proposal.previousCheckpointDigest !== prior.checkpointDigest || proposal.candidateCheckpointDigest !== candidate.checkpointDigest) throw new Error('v33_32_proposal_transition_binding_invalid');
  if (proposal.previousSequence !== prior.sequence || proposal.candidateSequence !== candidate.sequence) throw new Error('v33_32_proposal_sequence_binding_invalid');
  const votes = bundle.votes.map((row) => verifyVote(row, trust, policy, proposal, now));
  if (detectFederatedCheckpointEquivocationV33_32(bundle.votes).length > 0) throw new Error('v33_32_witness_equivocation_detected');
  const uniqueKeys = new Set(votes.map((row) => row.witnessKeyId));
  const uniqueOrgs = new Set(votes.map((row) => row.witnessOrganizationId));
  const uniqueHosts = new Set(votes.map((row) => row.witnessHostId));
  if (uniqueKeys.size !== votes.length || uniqueOrgs.size !== votes.length || uniqueHosts.size !== votes.length) throw new Error('v33_32_vote_topology_duplicate');
  if (votes.length < policy.quorum) throw new Error('v33_32_witness_quorum_not_met');
  return { policy, anchor, prior, candidate, proposal, votes };
}

function verifyPolicy(envelope: SignedEnvelope<FederatedCheckpointWitnessPolicyV33_32>, trust: FederatedCheckpointTrustV33_32, now: Date): FederatedCheckpointWitnessPolicyV33_32 {
  if (!trust.trustedPolicySignerIds.includes(envelope.issuerKeyId) || !trust.policyRegistry.verifyAt(envelope, now)) throw new Error('v33_32_policy_signature_invalid');
  const payload = envelope.payload; const { policyDigest, ...material } = payload;
  if (policyDigest !== sha256(material)) throw new Error('v33_32_policy_digest_invalid');
  if (now.getTime() < Date.parse(payload.issuedAt) || now.getTime() >= Date.parse(payload.expiresAt)) throw new Error('v33_32_policy_not_active');
  if (payload.quorum < 3 || payload.quorum > payload.witnesses.length || payload.epoch < 1) throw new Error('v33_32_policy_constraints_invalid');
  normalizeWitnesses(payload.witnesses);
  for (const witness of payload.witnesses) {
    if (!trust.trustedWitnessIds.includes(witness.keyId) || trust.witnessRegistry.fingerprint(witness.keyId) !== witness.keyFingerprint) throw new Error('v33_32_policy_witness_trust_binding_invalid');
  }
  ensureDistinctRoleBoundary(payload.witnesses, { keyId: payload.importerKeyId, organizationId: payload.importerOrganizationId, hostId: payload.importerHostId }, { keyId: payload.coordinatorKeyId, organizationId: payload.coordinatorOrganizationId, hostId: payload.coordinatorHostId });
  if (!payload.requireDistinctHosts || !payload.requireDistinctOrganizations || payload.productionAuthority !== 'NONE' || payload.externalEffectsExecuted !== 0) throw new Error('v33_32_policy_boundary_invalid');
  return payload;
}

function verifyProposal(envelope: SignedEnvelope<FederatedCheckpointProposalV33_32>, trust: FederatedCheckpointTrustV33_32, policy: FederatedCheckpointWitnessPolicyV33_32, now: Date): FederatedCheckpointProposalV33_32 {
  if (!trust.trustedImporterIds.includes(envelope.issuerKeyId) || !trust.importerRegistry.verifyAt(envelope, now)) throw new Error('v33_32_proposal_signature_invalid');
  const payload = envelope.payload; const { proposalDigest, ...material } = payload;
  if (proposalDigest !== sha256(material)) throw new Error('v33_32_proposal_digest_invalid');
  if (payload.importerKeyId !== envelope.issuerKeyId || payload.importerKeyId !== policy.importerKeyId || payload.importerOrganizationId !== policy.importerOrganizationId || payload.importerHostId !== policy.importerHostId) throw new Error('v33_32_proposal_importer_binding_invalid');
  if (payload.policyDigest !== policy.policyDigest || payload.epoch !== policy.epoch || payload.studyId !== policy.studyId || payload.protocolDigest !== policy.protocolDigest) throw new Error('v33_32_proposal_policy_binding_invalid');
  if (Date.parse(payload.proposedAt) > now.getTime() || payload.productionAuthority !== 'NONE' || payload.externalEffectsExecuted !== 0) throw new Error('v33_32_proposal_boundary_invalid');
  return payload;
}

function verifyVote(envelope: SignedEnvelope<FederatedCheckpointWitnessVoteV33_32>, trust: FederatedCheckpointTrustV33_32, policy: FederatedCheckpointWitnessPolicyV33_32, proposal: FederatedCheckpointProposalV33_32, now: Date): FederatedCheckpointWitnessVoteV33_32 {
  if (!trust.trustedWitnessIds.includes(envelope.issuerKeyId) || !trust.witnessRegistry.verifyAt(envelope, now)) throw new Error('v33_32_vote_signature_invalid');
  const payload = envelope.payload; const { voteDigest, ...material } = payload;
  if (voteDigest !== sha256(material)) throw new Error('v33_32_vote_digest_invalid');
  const descriptor = policy.witnesses.find((row) => row.keyId === envelope.issuerKeyId);
  if (!descriptor || payload.witnessId !== descriptor.witnessId || payload.witnessKeyId !== descriptor.keyId || payload.witnessOrganizationId !== descriptor.organizationId || payload.witnessHostId !== descriptor.hostId) throw new Error('v33_32_vote_enrollment_binding_invalid');
  if (payload.policyDigest !== policy.policyDigest || payload.proposalDigest !== proposal.proposalDigest || payload.epoch !== proposal.epoch || payload.sequence !== proposal.candidateSequence || payload.previousAnchorDigest !== proposal.previousAnchorDigest || payload.candidateCheckpointDigest !== proposal.candidateCheckpointDigest) throw new Error('v33_32_vote_proposal_binding_invalid');
  if (payload.decision !== 'ACCEPT' || Date.parse(payload.observedAt) > now.getTime() || payload.productionAuthority !== 'NONE' || payload.externalEffectsExecuted !== 0) throw new Error('v33_32_vote_boundary_invalid');
  return payload;
}

function verifyCertificate(envelope: SignedEnvelope<FederatedCheckpointCertificateV33_32>, trust: FederatedCheckpointTrustV33_32, policy: FederatedCheckpointWitnessPolicyV33_32, now: Date): FederatedCheckpointCertificateV33_32 {
  if (!trust.trustedCoordinatorIds.includes(envelope.issuerKeyId) || !trust.coordinatorRegistry.verifyAt(envelope, now)) throw new Error('v33_32_certificate_signature_invalid');
  const payload = envelope.payload; const { certificateDigest, ...material } = payload;
  if (certificateDigest !== sha256(material)) throw new Error('v33_32_certificate_digest_invalid');
  if (payload.coordinatorKeyId !== envelope.issuerKeyId || payload.coordinatorKeyId !== policy.coordinatorKeyId || payload.coordinatorOrganizationId !== policy.coordinatorOrganizationId || payload.coordinatorHostId !== policy.coordinatorHostId) throw new Error('v33_32_certificate_coordinator_binding_invalid');
  if (Date.parse(payload.issuedAt) > now.getTime() || payload.productionAuthority !== 'NONE' || payload.externalEffectsExecuted !== 0) throw new Error('v33_32_certificate_boundary_invalid');
  return payload;
}

function verifyAnchor(envelope: SignedEnvelope<FederatedCheckpointAnchorV33_32>, trust: FederatedCheckpointTrustV33_32, now: Date): FederatedCheckpointAnchorV33_32 {
  if (!trust.trustedAnchorSignerIds.includes(envelope.issuerKeyId) || !trust.anchorRegistry.verifyAt(envelope, now)) throw new Error('v33_32_anchor_signature_invalid');
  const payload = envelope.payload; const { anchorDigest, ...material } = payload;
  if (anchorDigest !== sha256(material)) throw new Error('v33_32_anchor_digest_invalid');
  if ((payload.sequence === 0) !== (payload.previousAnchorDigest === null && payload.certificateDigest === null) || payload.sequence < 0 || payload.epoch < 1) throw new Error('v33_32_anchor_sequence_invalid');
  if (Date.parse(payload.anchoredAt) > now.getTime() || payload.productionAuthority !== 'NONE' || payload.externalEffectsExecuted !== 0) throw new Error('v33_32_anchor_boundary_invalid');
  return payload;
}

function verifyCheckpoint(envelope: SignedEnvelope<ExternalHumanPilotImportCheckpointV33_31>, trust: FederatedCheckpointTrustV33_32, now: Date): ExternalHumanPilotImportCheckpointV33_31 {
  if (!trust.trustedCheckpointSignerIds.includes(envelope.issuerKeyId) || !trust.checkpointRegistry.verifyAt(envelope, now)) throw new Error('v33_32_checkpoint_signature_invalid');
  return basicCheckpoint(envelope.payload);
}

function basicCheckpoint(payload: ExternalHumanPilotImportCheckpointV33_31): ExternalHumanPilotImportCheckpointV33_31 {
  const { checkpointDigest, ...material } = payload;
  if (checkpointDigest !== sha256(material)) throw new Error('v33_32_checkpoint_digest_invalid');
  if (!Number.isInteger(payload.sequence) || payload.sequence < 0 || (payload.sequence === 0) !== (payload.previousCheckpointDigest === null)) throw new Error('v33_32_checkpoint_sequence_invalid');
  if (new Set(payload.consumedChallengeDigests).size !== payload.consumedChallengeDigests.length || new Set(payload.consumedPackageDigests).size !== payload.consumedPackageDigests.length) throw new Error('v33_32_checkpoint_duplicate_consumption');
  if (payload.productionAuthority !== 'NONE' || payload.externalEffectsExecuted !== 0) throw new Error('v33_32_checkpoint_boundary_invalid');
  return payload;
}

function validateTransitionShape(policy: FederatedCheckpointWitnessPolicyV33_32, anchor: FederatedCheckpointAnchorV33_32, prior: ExternalHumanPilotImportCheckpointV33_31, candidate: ExternalHumanPilotImportCheckpointV33_31, newChallengeDigest: string, newPackageDigest: string): void {
  digest(newChallengeDigest, 'v33_32_new_challenge_digest_invalid');
  digest(newPackageDigest, 'v33_32_new_package_digest_invalid');
  if (anchor.policyDigest !== policy.policyDigest || anchor.epoch !== policy.epoch) throw new Error('v33_32_anchor_policy_binding_invalid');
  if (anchor.sequence !== prior.sequence || anchor.checkpointDigest !== prior.checkpointDigest) throw new Error('v33_32_anchor_checkpoint_binding_invalid');
  if (candidate.sequence !== prior.sequence + 1 || candidate.previousCheckpointDigest !== prior.checkpointDigest) throw new Error('v33_32_checkpoint_non_monotonic');
  if (!isExactAppend(prior.consumedChallengeDigests, candidate.consumedChallengeDigests, newChallengeDigest)) throw new Error('v33_32_challenge_consumption_non_append');
  if (!isExactAppend(prior.consumedPackageDigests, candidate.consumedPackageDigests, newPackageDigest)) throw new Error('v33_32_package_consumption_non_append');
}

function normalizeWitnesses(input: readonly FederatedCheckpointWitnessDescriptorV33_32[]): FederatedCheckpointWitnessDescriptorV33_32[] {
  if (input.length < 3 || input.length > 9) throw new Error('v33_32_witness_count_invalid');
  const rows = input.map((row) => ({
    witnessId: identifier(row.witnessId, 'v33_32_witness_id_invalid'),
    keyId: identifier(row.keyId, 'v33_32_witness_key_invalid'),
    keyFingerprint: digest(row.keyFingerprint, 'v33_32_witness_fingerprint_invalid'),
    organizationId: identifier(row.organizationId, 'v33_32_witness_org_invalid'),
    hostId: identifier(row.hostId, 'v33_32_witness_host_invalid'),
  })).sort((a, b) => a.witnessId.localeCompare(b.witnessId));
  for (const values of [rows.map((row) => row.witnessId), rows.map((row) => row.keyId), rows.map((row) => row.organizationId), rows.map((row) => row.hostId)]) if (new Set(values).size !== values.length) throw new Error('v33_32_witness_topology_duplicate');
  return rows;
}

function ensureDistinctRoleBoundary(witnesses: readonly FederatedCheckpointWitnessDescriptorV33_32[], importer: { readonly keyId: string; readonly organizationId: string; readonly hostId: string }, coordinator: { readonly keyId: string; readonly organizationId: string; readonly hostId: string }): void {
  if (importer.keyId === coordinator.keyId || importer.organizationId === coordinator.organizationId || importer.hostId === coordinator.hostId) throw new Error('v33_32_importer_coordinator_overlap');
  for (const row of witnesses) {
    if ([importer.keyId, coordinator.keyId].includes(row.keyId) || [importer.organizationId, coordinator.organizationId].includes(row.organizationId) || [importer.hostId, coordinator.hostId].includes(row.hostId)) throw new Error('v33_32_witness_role_overlap');
  }
}

function normalizeExecutionRoles(input: readonly ExternalHumanPilotExecutionRoleV33_32[]): ExternalHumanPilotExecutionRoleV33_32[] {
  const rows = input.map((row) => ({ role: row.role, organizationId: identifier(row.organizationId, 'v33_32_execution_org_invalid'), hostId: identifier(row.hostId, 'v33_32_execution_host_invalid'), keyId: identifier(row.keyId, 'v33_32_execution_key_invalid') })).sort((a, b) => a.role.localeCompare(b.role));
  if (new Set(rows.map((row) => row.role)).size !== rows.length || new Set(rows.map((row) => row.keyId)).size !== rows.length || new Set(rows.map((row) => row.organizationId)).size !== rows.length || new Set(rows.map((row) => row.hostId)).size !== rows.length) throw new Error('v33_32_execution_role_overlap');
  return rows;
}

function verifyReceipt(envelope: SignedEnvelope<ExternalHumanPilotImportReceiptV33_31>, registry: KeyRegistry, trusted: readonly string[], now: Date): ExternalHumanPilotImportReceiptV33_31 {
  if (!trusted.includes(envelope.issuerKeyId) || !registry.verifyAt(envelope, now)) throw new Error('v33_32_receipt_signature_invalid');
  const payload = envelope.payload; const { receiptDigest, ...material } = payload;
  if (receiptDigest !== sha256(material)) throw new Error('v33_32_receipt_digest_invalid');
  if (payload.productionAuthority !== 'NONE' || payload.externalEffectsExecuted !== 0 || !payload.replayProtected) throw new Error('v33_32_receipt_boundary_invalid');
  return payload;
}

function isExactAppend(prior: readonly string[], next: readonly string[], appended: string): boolean {
  return next.length === prior.length + 1 && prior.every((value, index) => next[index] === value) && next[next.length - 1] === appended;
}
function equalArrays(a: readonly string[], b: readonly string[]): boolean { return a.length === b.length && a.every((value, index) => value === b[index]); }
function identifier(value: string, error: string): string { const clean = value.trim(); if (clean === '' || clean.length > 200) throw new Error(error); return clean; }
function digest(value: string, error: string): string { if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(error); return value; }
function boundedInteger(value: number, min: number, max: number, error: string): number { if (!Number.isInteger(value) || value < min || value > max) throw new Error(error); return value; }
function requireDate(value: Date, error: string): void { if (!Number.isFinite(value.getTime())) throw new Error(error); }
