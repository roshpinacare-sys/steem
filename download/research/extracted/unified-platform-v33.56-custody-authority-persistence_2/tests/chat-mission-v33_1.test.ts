import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthorityGrant } from '../src/contracts/canonical.js';
import {
  buildPushApprovalCard,
  compileChatMission,
  recordApprovalDecision,
  type ApprovalPolicy,
  type ChatMissionRequest,
} from '../src/product/chat-mission.js';

const now = new Date('2026-07-21T04:00:00.000Z');
const grant: AuthorityGrant = {
  grantId: 'grant-chat-1', tenantId: 'tenant-1', subjectId: 'user-1', workspaceId: 'workspace-1',
  scopes: ['repository.read', 'repository.change.prepare', 'production.deploy'],
  issuedAt: '2026-07-21T03:00:00.000Z', expiresAt: '2026-07-21T08:00:00.000Z', issuer: 'canonical-authority',
};
const policy: ApprovalPolicy = {
  policyId: 'policy-chat-1',
  autoPrepareScopes: ['repository.read', 'repository.change.prepare'],
  approvalRequiredScopes: ['production.deploy'],
  maxAutoPrepareCostUsd: 5,
  maxAutoPrepareRisk: 'MEDIUM',
  minimumConfidence: 0.8,
  requireApprovalForIrreversible: true,
  requireApprovalForUnknownReversibility: true,
  approverIds: ['reviewer-1', 'reviewer-2'],
};
const base: ChatMissionRequest = {
  missionId: 'mission-chat-1', tenantId: 'tenant-1', requesterId: 'user-1', workspaceId: 'workspace-1',
  message: 'Inspect the repository and prepare a tested patch. Do not merge or deploy.',
  objective: 'Prepare a tested repository patch',
  requestedScopes: ['repository.read', 'repository.change.prepare'],
  riskLevel: 'LOW', reversibility: 'REVERSIBLE', estimatedCostUsd: 2, confidence: 0.95,
  constraints: ['use isolated workspace'], prohibitedActions: ['merge', 'deploy'], completionCriteria: ['tests pass', 'rollback exists'],
  createdAt: '2026-07-21T03:59:00.000Z', expiresAt: '2026-07-21T05:00:00.000Z',
};

test('low-risk authorized mission reaches autonomous preparation without external effects', () => {
  const mission = compileChatMission(base, grant, policy, now);
  assert.equal(mission.status, 'READY_FOR_AUTONOMOUS_PREPARATION');
  assert.equal(mission.approvalRequired, false);
  assert.equal(mission.externalEffectsExecuted, 0);
  assert.equal(mission.promotionCeiling, 'shadow');
  assert.throws(() => buildPushApprovalCard(mission, policy), /mission_does_not_require_approval/);
});

test('high-risk scope produces a concise push card with canonical authority binding', () => {
  const mission = compileChatMission({ ...base, requestedScopes: ['repository.read', 'production.deploy'], riskLevel: 'HIGH', estimatedCostUsd: 20 }, grant, policy, now);
  assert.equal(mission.status, 'AWAITING_APPROVAL');
  assert.deepEqual(mission.approvalReasons, ['COST_ABOVE_POLICY', 'KERNEL_HIGH_RISK_SCOPE', 'POLICY_REQUIRES_SCOPE_APPROVAL', 'RISK_ABOVE_POLICY', 'SCOPE_NOT_AUTO_PREPARE']);
  const card = buildPushApprovalCard(mission, policy);
  assert.deepEqual(card.options, ['YES', 'NO', 'CHANGE_CONDITIONS', 'EXPLAIN']);
  assert.equal(card.authorityGrantDigest, mission.authorityGrantDigest);
  assert.equal(card.requestedScopes.includes('production.deploy'), true);
});

test('approval records do not enlarge scopes or execute effects', () => {
  const mission = compileChatMission({ ...base, requestedScopes: ['production.deploy'], riskLevel: 'CRITICAL', reversibility: 'IRREVERSIBLE' }, grant, policy, now);
  const card = buildPushApprovalCard(mission, policy);
  const decision = recordApprovalDecision(card, {
    decisionId: 'decision-1', cardId: card.cardId, actorId: 'reviewer-1', option: 'YES', occurredAt: '2026-07-21T04:00:01.000Z', reason: 'Proceed within the existing grant only',
  }, new Date('2026-07-21T04:00:02.000Z'));
  assert.equal(decision.outcome, 'APPROVED');
  assert.deepEqual(decision.approvedScopes, ['production.deploy']);
  assert.equal(decision.externalEffectsExecuted, 0);
  assert.equal(decision.authorityGrantDigest, mission.authorityGrantDigest);
});

test('change conditions requires explicit replacement conditions', () => {
  const mission = compileChatMission({ ...base, riskLevel: 'HIGH' }, grant, policy, now);
  const card = buildPushApprovalCard(mission, policy);
  assert.throws(() => recordApprovalDecision(card, {
    decisionId: 'decision-2', cardId: card.cardId, actorId: 'reviewer-1', option: 'CHANGE_CONDITIONS', occurredAt: '2026-07-21T04:00:01.000Z',
  }, new Date('2026-07-21T04:00:02.000Z')), /changed_conditions_required/);
  const decision = recordApprovalDecision(card, {
    decisionId: 'decision-3', cardId: card.cardId, actorId: 'reviewer-1', option: 'CHANGE_CONDITIONS', occurredAt: '2026-07-21T04:00:01.000Z', changedConditions: ['lower cost ceiling', 'shadow only'],
  }, new Date('2026-07-21T04:00:02.000Z'));
  assert.equal(decision.outcome, 'REVISION_REQUIRED');
  assert.deepEqual(decision.approvedScopes, []);
});

test('cross-tenant, unauthorized scope and unauthorized approver fail closed', () => {
  assert.throws(() => compileChatMission({ ...base, tenantId: 'tenant-2' }, grant, policy, now), /scope_not_authorized/);
  assert.throws(() => compileChatMission({ ...base, requestedScopes: ['secret.read'] }, grant, policy, now), /scope_not_authorized:secret.read/);
  const mission = compileChatMission({ ...base, riskLevel: 'HIGH' }, grant, policy, now);
  const card = buildPushApprovalCard(mission, policy);
  assert.throws(() => recordApprovalDecision(card, {
    decisionId: 'decision-4', cardId: card.cardId, actorId: 'requester-self', option: 'YES', occurredAt: '2026-07-21T04:00:01.000Z',
  }, new Date('2026-07-21T04:00:02.000Z')), /approval_actor_not_authorized/);
});

test('expired cards and malformed confidence fail closed', () => {
  assert.throws(() => compileChatMission({ ...base, confidence: 1.1 }, grant, policy, now), /confidence_invalid/);
  const mission = compileChatMission({ ...base, riskLevel: 'HIGH', expiresAt: '2026-07-21T04:01:00.000Z' }, grant, policy, now);
  const card = buildPushApprovalCard(mission, policy);
  assert.throws(() => recordApprovalDecision(card, {
    decisionId: 'decision-5', cardId: card.cardId, actorId: 'reviewer-1', option: 'NO', occurredAt: '2026-07-21T04:01:00.000Z',
  }, new Date('2026-07-21T04:01:00.000Z')), /approval_card_expired/);
});
