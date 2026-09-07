import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AuthorityGrant } from '../contracts/canonical.js';
import {
  KeyRegistry,
  type SignedEnvelope,
  type SigningIdentity,
  sha256,
  signEnvelope,
} from '../contracts/crypto.js';
import {
  approveChangeSession,
  executeChangePlan,
  loadChangeSession,
  rollbackChangeSession,
  sessionArtifactSummary,
  type ChangeSessionState,
  type ExplicitChangePlan,
} from '../repository/change-assurance.js';
import { KeyLifecycleRegistry } from '../security/key-lifecycle.js';
import {
  buildPushApprovalCard,
  compileChatMission,
  recordApprovalDecision,
  type ApprovalDecisionInput,
  type ApprovalDecisionRecord,
  type ApprovalPolicy,
  type ChatMissionRequest,
  type CompiledChatMission,
  type PushApprovalCard,
} from '../product/chat-mission.js';

export interface ChatEngineeringPreparationV33_8 {
  readonly version: '33.8';
  readonly mission: CompiledChatMission;
  readonly approvalCard?: PushApprovalCard;
  readonly approvalDecision?: ApprovalDecisionRecord;
  readonly changeSessionId: string;
  readonly changeStatus: 'AWAITING_REVIEW';
  readonly evidenceRoot: string;
  readonly changedFiles: readonly string[];
  readonly testPassed: true;
  readonly reviewRequired: true;
  readonly externalGitMutationExecuted: false;
  readonly externalEffectsExecuted: 0;
  readonly preparationDigest: string;
}

export interface PullRequestProposalV33_8 {
  readonly version: '33.8';
  readonly proposalId: string;
  readonly tenantId: string;
  readonly missionId: string;
  readonly changeSessionId: string;
  readonly sourceRepositoryName: string;
  readonly baseCommit: string;
  readonly proposedHeadRef: string;
  readonly title: string;
  readonly body: string;
  readonly changedFiles: readonly string[];
  readonly patchDigest: string;
  readonly rollbackDigest: string;
  readonly evidenceRoot: string;
  readonly actionPassportDigest: string;
  readonly reviewerId: string;
  readonly builderId: string;
  readonly requesterId: string;
  readonly createdAt: string;
  readonly promotionCeiling: 'shadow';
  readonly externalGitMutationExecuted: false;
  readonly mergeExecuted: false;
  readonly deploymentExecuted: false;
  readonly externalEffectsExecuted: 0;
  readonly proposalDigest: string;
}

export interface ReviewedEngineeringMissionV33_8 {
  readonly version: '33.8';
  readonly approvedState: ChangeSessionState;
  readonly pullRequestProposal: SignedEnvelope<PullRequestProposalV33_8>;
  readonly reviewPacket: Readonly<Record<string, unknown>>;
  readonly externalEffectsExecuted: 0;
  readonly resultDigest: string;
}

export async function prepareChatEngineeringMissionV33_8(input: {
  readonly request: ChatMissionRequest;
  readonly grant: AuthorityGrant;
  readonly policy: ApprovalPolicy;
  readonly changePlan: ExplicitChangePlan;
  readonly sessionsRoot: string;
  readonly approvalDecision?: ApprovalDecisionInput;
  readonly now?: Date;
}): Promise<ChatEngineeringPreparationV33_8> {
  const now = input.now ?? new Date();
  validDate(now);
  validateMissionPlanBinding(input.request, input.grant, input.changePlan);
  const mission = compileChatMission(input.request, input.grant, input.policy, now);
  let approvalCard: PushApprovalCard | undefined;
  let approvalDecision: ApprovalDecisionRecord | undefined;
  if (mission.approvalRequired) {
    approvalCard = buildPushApprovalCard(mission, input.policy);
    if (input.approvalDecision === undefined) throw new Error('engineering_mission_approval_required');
    approvalDecision = recordApprovalDecision(approvalCard, input.approvalDecision, now);
    if (approvalDecision.outcome !== 'APPROVED') throw new Error(`engineering_mission_not_approved:${approvalDecision.outcome}`);
    if (sha256(approvalDecision.approvedScopes) !== sha256(mission.requestedScopes)) throw new Error('engineering_approval_scope_mismatch');
  } else if (input.approvalDecision !== undefined) {
    throw new Error('engineering_mission_unexpected_approval');
  }
  const state = await executeChangePlan(input.changePlan, { sessionsRoot: input.sessionsRoot });
  if (state.status !== 'AWAITING_REVIEW' || state.evidenceRoot === undefined || state.testExecution?.passed !== true) throw new Error('engineering_preparation_incomplete');
  const material = {
    version: '33.8' as const,
    mission,
    ...(approvalCard === undefined ? {} : { approvalCard }),
    ...(approvalDecision === undefined ? {} : { approvalDecision }),
    changeSessionId: state.sessionId,
    changeStatus: 'AWAITING_REVIEW' as const,
    evidenceRoot: state.evidenceRoot,
    changedFiles: state.changedFiles,
    testPassed: true as const,
    reviewRequired: true as const,
    externalGitMutationExecuted: false as const,
    externalEffectsExecuted: 0 as const,
  };
  return { ...material, preparationDigest: sha256(material) };
}

export function reviewAndPreparePullRequestV33_8(input: {
  readonly preparation: ChatEngineeringPreparationV33_8;
  readonly sessionsRoot: string;
  readonly reviewerId: string;
  readonly passportSigner: SigningIdentity;
  readonly passportRegistry: KeyLifecycleRegistry;
  readonly proposalSigner: SigningIdentity;
  readonly proposalKeys: KeyRegistry;
  readonly trustedProposalSignerIds: readonly string[];
  readonly now?: Date;
}): ReviewedEngineeringMissionV33_8 {
  const now = input.now ?? new Date();
  validDate(now);
  verifyPreparation(input.preparation);
  const state = loadChangeSession(input.sessionsRoot, input.preparation.changeSessionId);
  if (state.status !== 'AWAITING_REVIEW' || state.evidenceRoot !== input.preparation.evidenceRoot) throw new Error('engineering_session_binding_invalid');
  if (input.reviewerId === state.plan.builderId || input.reviewerId === input.preparation.mission.requesterId) throw new Error('engineering_review_independence_required');
  const approved = approveChangeSession({ sessionsRoot: input.sessionsRoot, sessionId: state.sessionId, reviewerId: input.reviewerId, passportSigner: input.passportSigner, keyRegistry: input.passportRegistry, now });
  if (approved.passport === undefined || approved.manifest === undefined || approved.evidenceRoot === undefined) throw new Error('engineering_approval_evidence_missing');
  const patchPath = join(approved.artifactDirectory, 'change.patch');
  const rollbackPath = join(approved.artifactDirectory, 'rollback.patch');
  if (!existsSync(patchPath) || !existsSync(rollbackPath)) throw new Error('engineering_patch_artifacts_missing');
  const proposalMaterial = {
    version: '33.8' as const,
    proposalId: `pr-proposal-${approved.sessionId}`,
    tenantId: approved.plan.tenantId,
    missionId: input.preparation.mission.missionId,
    changeSessionId: approved.sessionId,
    sourceRepositoryName: String(sessionArtifactSummary(approved).sourceRepository),
    baseCommit: approved.baseCommit,
    proposedHeadRef: `sovereign/${input.preparation.mission.missionId}/${approved.sessionId}`,
    title: truncate(input.preparation.mission.objective, 80),
    body: buildProposalBody(input.preparation, approved),
    changedFiles: approved.changedFiles,
    patchDigest: sha256(readFileSync(patchPath, 'utf8')),
    rollbackDigest: sha256(readFileSync(rollbackPath, 'utf8')),
    evidenceRoot: approved.evidenceRoot,
    actionPassportDigest: sha256(approved.passport),
    reviewerId: input.reviewerId,
    builderId: approved.plan.builderId,
    requesterId: input.preparation.mission.requesterId,
    createdAt: now.toISOString(),
    promotionCeiling: 'shadow' as const,
    externalGitMutationExecuted: false as const,
    mergeExecuted: false as const,
    deploymentExecuted: false as const,
    externalEffectsExecuted: 0 as const,
  };
  const proposal: PullRequestProposalV33_8 = { ...proposalMaterial, proposalDigest: sha256(proposalMaterial) };
  if (!input.trustedProposalSignerIds.includes(input.proposalSigner.keyId)) throw new Error('pull_request_proposal_signer_untrusted');
  const signed = signEnvelope(proposal, input.proposalSigner);
  if (!input.proposalKeys.verifyAt(signed, now)) throw new Error('pull_request_proposal_signature_invalid');
  writeFileSync(join(approved.artifactDirectory, 'pull-request-proposal.json'), JSON.stringify(signed, null, 2));
  const reviewPacket = sessionArtifactSummary(approved);
  const material = { version: '33.8' as const, approvedState: approved, pullRequestProposal: signed, reviewPacket, externalEffectsExecuted: 0 as const };
  return { ...material, resultDigest: sha256(material) };
}

export function verifyPullRequestProposalV33_8(input: {
  readonly envelope: SignedEnvelope<PullRequestProposalV33_8>;
  readonly proposalKeys: KeyRegistry;
  readonly trustedProposalSignerIds: readonly string[];
  readonly at?: Date;
}): boolean {
  const at = input.at ?? new Date();
  validDate(at);
  const proposal = input.envelope.payload;
  if (!input.trustedProposalSignerIds.includes(input.envelope.issuerKeyId)) return false;
  if (!input.proposalKeys.verifyAt(input.envelope, at)) return false;
  const { proposalDigest, ...material } = proposal;
  if (sha256(material) !== proposalDigest) return false;
  if (proposal.promotionCeiling !== 'shadow' || proposal.externalGitMutationExecuted || proposal.mergeExecuted || proposal.deploymentExecuted || proposal.externalEffectsExecuted !== 0) return false;
  if (proposal.reviewerId === proposal.builderId || proposal.reviewerId === proposal.requesterId) return false;
  return true;
}

export function rollbackReviewedEngineeringMissionV33_8(input: { readonly sessionsRoot: string; readonly sessionId: string }): ChangeSessionState {
  const state = rollbackChangeSession(input.sessionsRoot, input.sessionId);
  if (state.status !== 'ROLLED_BACK' || state.changedFiles.length !== 0) throw new Error('engineering_rollback_verification_failed');
  return state;
}

function validateMissionPlanBinding(request: ChatMissionRequest, grant: AuthorityGrant, plan: ExplicitChangePlan): void {
  if (request.tenantId !== plan.tenantId || grant.tenantId !== plan.tenantId) throw new Error('engineering_tenant_binding_mismatch');
  if (request.requesterId !== plan.subjectId || grant.subjectId !== request.requesterId) throw new Error('engineering_subject_binding_mismatch');
  if (!request.requestedScopes.includes('repository.write')) throw new Error('engineering_repository_write_scope_required');
  if (!grant.scopes.includes('repository.write')) throw new Error('engineering_repository_write_not_granted');
  if (request.objective.trim() !== plan.objective.trim()) throw new Error('engineering_objective_binding_mismatch');
  if (!request.prohibitedActions.includes('git.push') || !request.prohibitedActions.includes('git.merge') || !request.prohibitedActions.includes('production.deploy')) throw new Error('engineering_prohibited_actions_incomplete');
  if (!request.completionCriteria.includes('tests pass') || !request.completionCriteria.includes('rollback verified') || !request.completionCriteria.includes('independent review')) throw new Error('engineering_completion_criteria_incomplete');
}
function verifyPreparation(preparation: ChatEngineeringPreparationV33_8): void {
  const { preparationDigest, ...material } = preparation;
  if (sha256(material) !== preparationDigest || preparation.version !== '33.8' || preparation.changeStatus !== 'AWAITING_REVIEW' || preparation.externalGitMutationExecuted || preparation.externalEffectsExecuted !== 0) throw new Error('engineering_preparation_digest_invalid');
  if (preparation.mission.approvalRequired && (preparation.approvalCard === undefined || preparation.approvalDecision?.outcome !== 'APPROVED')) throw new Error('engineering_preparation_approval_missing');
}
function buildProposalBody(preparation: ChatEngineeringPreparationV33_8, state: ChangeSessionState): string {
  return [
    `## Objective\n${preparation.mission.objective}`,
    `## Changed files\n${state.changedFiles.map((file) => `- ${file}`).join('\n')}`,
    `## Verification\n- Tests passed: ${state.testExecution?.passed === true ? 'yes' : 'no'}\n- Independent reviewer: ${state.reviewerId ?? 'pending'}\n- Evidence root: ${state.evidenceRoot ?? 'missing'}\n- Rollback patch: available`,
    `## Boundaries\n- Shadow-only proposal\n- No git push executed\n- No merge executed\n- No deployment executed`,
  ].join('\n\n');
}
function truncate(value: string, max: number): string { const normalized=value.trim().replace(/\s+/g,' '); return normalized.length<=max?normalized:`${normalized.slice(0,max-1).trimEnd()}…`; }
function validDate(value: Date): void { if (!Number.isFinite(value.getTime())) throw new Error('current_time_invalid'); }
