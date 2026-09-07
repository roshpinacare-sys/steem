import {
  HIGH_RISK_SCOPES,
  authorityAllows,
  validateAuthorityGrant,
  type AuthorityGrant,
} from '../contracts/canonical.js';
import { sha256 } from '../contracts/crypto.js';

export const MISSION_RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type MissionRiskLevel = (typeof MISSION_RISK_LEVELS)[number];
export type MissionReversibility = 'REVERSIBLE' | 'COMPENSATABLE' | 'IRREVERSIBLE' | 'UNKNOWN';
export type ChatMissionStatus = 'READY_FOR_AUTONOMOUS_PREPARATION' | 'AWAITING_APPROVAL';
export type ApprovalOption = 'YES' | 'NO' | 'CHANGE_CONDITIONS' | 'EXPLAIN';
export type ApprovalOutcome = 'APPROVED' | 'REJECTED' | 'REVISION_REQUIRED' | 'EXPLANATION_REQUESTED';

export interface ChatMissionRequest {
  readonly missionId: string;
  readonly tenantId: string;
  readonly requesterId: string;
  readonly workspaceId?: string;
  readonly message: string;
  readonly objective: string;
  readonly requestedScopes: readonly string[];
  readonly riskLevel: MissionRiskLevel;
  readonly reversibility: MissionReversibility;
  readonly estimatedCostUsd: number;
  readonly confidence: number;
  readonly constraints: readonly string[];
  readonly prohibitedActions: readonly string[];
  readonly completionCriteria: readonly string[];
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface ApprovalPolicy {
  readonly policyId: string;
  readonly autoPrepareScopes: readonly string[];
  readonly approvalRequiredScopes: readonly string[];
  readonly maxAutoPrepareCostUsd: number;
  readonly maxAutoPrepareRisk: MissionRiskLevel;
  readonly minimumConfidence: number;
  readonly requireApprovalForIrreversible: boolean;
  readonly requireApprovalForUnknownReversibility: boolean;
  readonly approverIds: readonly string[];
}

export type ApprovalReason =
  | 'SCOPE_NOT_AUTO_PREPARE'
  | 'POLICY_REQUIRES_SCOPE_APPROVAL'
  | 'KERNEL_HIGH_RISK_SCOPE'
  | 'RISK_ABOVE_POLICY'
  | 'COST_ABOVE_POLICY'
  | 'CONFIDENCE_BELOW_POLICY'
  | 'IRREVERSIBLE_ACTION'
  | 'UNKNOWN_REVERSIBILITY';

export interface CompiledChatMission {
  readonly version: '33.1';
  readonly missionId: string;
  readonly tenantId: string;
  readonly requesterId: string;
  readonly workspaceId?: string;
  readonly objective: string;
  readonly normalizedMessage: string;
  readonly requestedScopes: readonly string[];
  readonly constraints: readonly string[];
  readonly prohibitedActions: readonly string[];
  readonly completionCriteria: readonly string[];
  readonly riskLevel: MissionRiskLevel;
  readonly reversibility: MissionReversibility;
  readonly estimatedCostUsd: number;
  readonly confidence: number;
  readonly authorityGrantDigest: string;
  readonly policyId: string;
  readonly status: ChatMissionStatus;
  readonly approvalRequired: boolean;
  readonly approvalReasons: readonly ApprovalReason[];
  readonly promotionCeiling: 'shadow';
  readonly externalEffectsExecuted: 0;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly missionDigest: string;
}

export interface PushApprovalCard {
  readonly version: '33.1';
  readonly cardId: string;
  readonly missionId: string;
  readonly tenantId: string;
  readonly title: string;
  readonly summary: string;
  readonly riskLevel: MissionRiskLevel;
  readonly reversibility: MissionReversibility;
  readonly estimatedCostUsd: number;
  readonly requestedScopes: readonly string[];
  readonly reasons: readonly ApprovalReason[];
  readonly approverIds: readonly string[];
  readonly options: readonly ['YES', 'NO', 'CHANGE_CONDITIONS', 'EXPLAIN'];
  readonly authorityGrantDigest: string;
  readonly missionDigest: string;
  readonly expiresAt: string;
  readonly cardDigest: string;
}

export interface ApprovalDecisionInput {
  readonly decisionId: string;
  readonly cardId: string;
  readonly actorId: string;
  readonly option: ApprovalOption;
  readonly occurredAt: string;
  readonly reason?: string;
  readonly changedConditions?: readonly string[];
}

export interface ApprovalDecisionRecord {
  readonly version: '33.1';
  readonly decisionId: string;
  readonly cardId: string;
  readonly missionId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly option: ApprovalOption;
  readonly outcome: ApprovalOutcome;
  readonly occurredAt: string;
  readonly reason?: string;
  readonly changedConditions?: readonly string[];
  readonly approvedScopes: readonly string[];
  readonly authorityGrantDigest: string;
  readonly missionDigest: string;
  readonly cardDigest: string;
  readonly externalEffectsExecuted: 0;
  readonly decisionDigest: string;
}

const riskRank: Readonly<Record<MissionRiskLevel, number>> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

function nonEmpty(value: string, code: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized === '') throw new Error(code);
  return normalized;
}

function uniqueStrings(values: readonly string[], code: string, emptyCode: string): readonly string[] {
  const normalized = values.map((value) => nonEmpty(value, emptyCode));
  if (new Set(normalized).size !== normalized.length) throw new Error(code);
  return Object.freeze([...normalized]);
}

function instant(value: string, code: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(code);
  return parsed;
}

function validateRequest(request: ChatMissionRequest, now: Date): void {
  nonEmpty(request.missionId, 'mission_id_required');
  nonEmpty(request.tenantId, 'tenant_id_required');
  nonEmpty(request.requesterId, 'requester_id_required');
  nonEmpty(request.message, 'message_required');
  nonEmpty(request.objective, 'objective_required');
  if (!MISSION_RISK_LEVELS.includes(request.riskLevel)) throw new Error('mission_risk_invalid');
  if (!['REVERSIBLE', 'COMPENSATABLE', 'IRREVERSIBLE', 'UNKNOWN'].includes(request.reversibility)) {
    throw new Error('mission_reversibility_invalid');
  }
  if (!Number.isFinite(request.estimatedCostUsd) || request.estimatedCostUsd < 0) throw new Error('estimated_cost_invalid');
  if (!Number.isFinite(request.confidence) || request.confidence < 0 || request.confidence > 1) throw new Error('confidence_invalid');
  if (request.requestedScopes.length === 0) throw new Error('requested_scope_required');
  uniqueStrings(request.requestedScopes, 'duplicate_requested_scope', 'requested_scope_invalid');
  uniqueStrings(request.constraints, 'duplicate_constraint', 'constraint_invalid');
  uniqueStrings(request.prohibitedActions, 'duplicate_prohibited_action', 'prohibited_action_invalid');
  if (request.completionCriteria.length === 0) throw new Error('completion_criterion_required');
  uniqueStrings(request.completionCriteria, 'duplicate_completion_criterion', 'completion_criterion_invalid');
  const created = instant(request.createdAt, 'created_at_invalid');
  const expires = instant(request.expiresAt, 'expires_at_invalid');
  if (expires <= created) throw new Error('mission_expiry_invalid');
  if (now.getTime() >= expires) throw new Error('mission_expired');
}

function validatePolicy(policy: ApprovalPolicy): void {
  nonEmpty(policy.policyId, 'policy_id_required');
  if (!MISSION_RISK_LEVELS.includes(policy.maxAutoPrepareRisk)) throw new Error('policy_risk_invalid');
  if (!Number.isFinite(policy.maxAutoPrepareCostUsd) || policy.maxAutoPrepareCostUsd < 0) throw new Error('policy_cost_invalid');
  if (!Number.isFinite(policy.minimumConfidence) || policy.minimumConfidence < 0 || policy.minimumConfidence > 1) {
    throw new Error('policy_confidence_invalid');
  }
  uniqueStrings(policy.autoPrepareScopes, 'duplicate_auto_prepare_scope', 'auto_prepare_scope_invalid');
  uniqueStrings(policy.approvalRequiredScopes, 'duplicate_approval_scope', 'approval_scope_invalid');
  uniqueStrings(policy.approverIds, 'duplicate_approver', 'approver_invalid');
}

export function compileChatMission(
  request: ChatMissionRequest,
  grant: AuthorityGrant,
  policy: ApprovalPolicy,
  now = new Date(),
): CompiledChatMission {
  if (!Number.isFinite(now.getTime())) throw new Error('current_time_invalid');
  validateRequest(request, now);
  validatePolicy(policy);
  validateAuthorityGrant(grant, now);
  const requestedScopes = uniqueStrings(request.requestedScopes, 'duplicate_requested_scope', 'requested_scope_invalid');
  for (const scope of requestedScopes) {
    if (!authorityAllows(grant, {
      tenantId: request.tenantId,
      subjectId: request.requesterId,
      scope,
      ...(request.workspaceId === undefined ? {} : { workspaceId: request.workspaceId }),
    }, now)) throw new Error(`scope_not_authorized:${scope}`);
  }

  const reasons = new Set<ApprovalReason>();
  for (const scope of requestedScopes) {
    if (!policy.autoPrepareScopes.includes(scope)) reasons.add('SCOPE_NOT_AUTO_PREPARE');
    if (policy.approvalRequiredScopes.includes(scope)) reasons.add('POLICY_REQUIRES_SCOPE_APPROVAL');
    if (HIGH_RISK_SCOPES.has(scope)) reasons.add('KERNEL_HIGH_RISK_SCOPE');
  }
  if (riskRank[request.riskLevel] > riskRank[policy.maxAutoPrepareRisk]) reasons.add('RISK_ABOVE_POLICY');
  if (request.estimatedCostUsd > policy.maxAutoPrepareCostUsd) reasons.add('COST_ABOVE_POLICY');
  if (request.confidence < policy.minimumConfidence) reasons.add('CONFIDENCE_BELOW_POLICY');
  if (request.reversibility === 'IRREVERSIBLE' && policy.requireApprovalForIrreversible) reasons.add('IRREVERSIBLE_ACTION');
  if (request.reversibility === 'UNKNOWN' && policy.requireApprovalForUnknownReversibility) reasons.add('UNKNOWN_REVERSIBILITY');
  if (reasons.size > 0 && policy.approverIds.length === 0) throw new Error('approval_required_but_no_approver');

  const authorityGrantDigest = sha256(grant);
  const approvalReasons = Object.freeze([...reasons].sort());
  const material = {
    version: '33.1' as const,
    missionId: nonEmpty(request.missionId, 'mission_id_required'),
    tenantId: nonEmpty(request.tenantId, 'tenant_id_required'),
    requesterId: nonEmpty(request.requesterId, 'requester_id_required'),
    ...(request.workspaceId === undefined ? {} : { workspaceId: nonEmpty(request.workspaceId, 'workspace_id_invalid') }),
    objective: nonEmpty(request.objective, 'objective_required'),
    normalizedMessage: nonEmpty(request.message, 'message_required'),
    requestedScopes,
    constraints: uniqueStrings(request.constraints, 'duplicate_constraint', 'constraint_invalid'),
    prohibitedActions: uniqueStrings(request.prohibitedActions, 'duplicate_prohibited_action', 'prohibited_action_invalid'),
    completionCriteria: uniqueStrings(request.completionCriteria, 'duplicate_completion_criterion', 'completion_criterion_invalid'),
    riskLevel: request.riskLevel,
    reversibility: request.reversibility,
    estimatedCostUsd: request.estimatedCostUsd,
    confidence: request.confidence,
    authorityGrantDigest,
    policyId: nonEmpty(policy.policyId, 'policy_id_required'),
    status: (approvalReasons.length === 0 ? 'READY_FOR_AUTONOMOUS_PREPARATION' : 'AWAITING_APPROVAL') as ChatMissionStatus,
    approvalRequired: approvalReasons.length > 0,
    approvalReasons,
    promotionCeiling: 'shadow' as const,
    externalEffectsExecuted: 0 as const,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
  };
  return { ...material, missionDigest: sha256(material) };
}

function truncate(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
}

export function buildPushApprovalCard(mission: CompiledChatMission, policy: ApprovalPolicy): PushApprovalCard {
  validatePolicy(policy);
  if (!mission.approvalRequired || mission.status !== 'AWAITING_APPROVAL') throw new Error('mission_does_not_require_approval');
  if (mission.policyId !== policy.policyId) throw new Error('approval_policy_binding_mismatch');
  const approverIds = uniqueStrings(policy.approverIds, 'duplicate_approver', 'approver_invalid');
  if (approverIds.length === 0) throw new Error('approval_card_approver_required');
  const cardId = `approval-${mission.missionDigest.slice(0, 24)}`;
  const material = {
    version: '33.1' as const,
    cardId,
    missionId: mission.missionId,
    tenantId: mission.tenantId,
    title: truncate(mission.objective, 80),
    summary: truncate(mission.normalizedMessage, 220),
    riskLevel: mission.riskLevel,
    reversibility: mission.reversibility,
    estimatedCostUsd: mission.estimatedCostUsd,
    requestedScopes: mission.requestedScopes,
    reasons: mission.approvalReasons,
    approverIds,
    options: ['YES', 'NO', 'CHANGE_CONDITIONS', 'EXPLAIN'] as const,
    authorityGrantDigest: mission.authorityGrantDigest,
    missionDigest: mission.missionDigest,
    expiresAt: mission.expiresAt,
  };
  return { ...material, cardDigest: sha256(material) };
}

export function recordApprovalDecision(
  card: PushApprovalCard,
  input: ApprovalDecisionInput,
  now = new Date(),
): ApprovalDecisionRecord {
  if (!Number.isFinite(now.getTime())) throw new Error('current_time_invalid');
  if (input.cardId !== card.cardId) throw new Error('approval_card_binding_mismatch');
  if (!card.approverIds.includes(input.actorId)) throw new Error('approval_actor_not_authorized');
  if (!['YES', 'NO', 'CHANGE_CONDITIONS', 'EXPLAIN'].includes(input.option)) throw new Error('approval_option_invalid');
  const occurred = instant(input.occurredAt, 'approval_time_invalid');
  if (occurred > now.getTime()) throw new Error('approval_time_in_future');
  if (occurred >= instant(card.expiresAt, 'approval_expiry_invalid') || now.getTime() >= instant(card.expiresAt, 'approval_expiry_invalid')) {
    throw new Error('approval_card_expired');
  }
  const changedConditions = input.changedConditions === undefined
    ? undefined
    : uniqueStrings(input.changedConditions, 'duplicate_changed_condition', 'changed_condition_invalid');
  if (input.option === 'CHANGE_CONDITIONS' && (changedConditions === undefined || changedConditions.length === 0)) {
    throw new Error('changed_conditions_required');
  }
  if (input.option !== 'CHANGE_CONDITIONS' && changedConditions !== undefined) throw new Error('changed_conditions_not_allowed');
  const outcome: ApprovalOutcome = input.option === 'YES'
    ? 'APPROVED'
    : input.option === 'NO'
      ? 'REJECTED'
      : input.option === 'CHANGE_CONDITIONS'
        ? 'REVISION_REQUIRED'
        : 'EXPLANATION_REQUESTED';
  const reason = input.reason === undefined ? undefined : nonEmpty(input.reason, 'approval_reason_invalid');
  const material = {
    version: '33.1' as const,
    decisionId: nonEmpty(input.decisionId, 'decision_id_required'),
    cardId: card.cardId,
    missionId: card.missionId,
    tenantId: card.tenantId,
    actorId: nonEmpty(input.actorId, 'approval_actor_required'),
    option: input.option,
    outcome,
    occurredAt: input.occurredAt,
    ...(reason === undefined ? {} : { reason }),
    ...(changedConditions === undefined ? {} : { changedConditions }),
    approvedScopes: input.option === 'YES' ? card.requestedScopes : [],
    authorityGrantDigest: card.authorityGrantDigest,
    missionDigest: card.missionDigest,
    cardDigest: card.cardDigest,
    externalEffectsExecuted: 0 as const,
  };
  return { ...material, decisionDigest: sha256(material) };
}
