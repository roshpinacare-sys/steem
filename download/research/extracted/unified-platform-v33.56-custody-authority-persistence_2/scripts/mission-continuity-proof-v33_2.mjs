import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { sha256 } from '../dist/src/contracts/crypto.js';
import { buildPushApprovalCard, compileChatMission } from '../dist/src/product/chat-mission.js';
import { FileMissionConversationStore, InMemoryApprovalInbox } from '../dist/src/product/mission-conversation-v33_2.js';

const now = new Date('2026-07-21T04:00:00.000Z');
const later = new Date('2026-07-21T04:00:10.000Z');
const authorityGrantDigest = sha256({ grant: 'proof-v33.2' });
const root = mkdtempSync(join(tmpdir(), 'v33-2-proof-'));
const blocked = (operation, pattern) => {
  try { operation(); return false; } catch (error) { return pattern.test(String(error)); }
};

try {
  const store = new FileMissionConversationStore(root);
  const firstInput = {
    eventId: 'event-proof-1', tenantId: 'tenant-proof', missionId: 'mission-proof', authorityGrantDigest,
    actorId: 'user-proof', type: 'USER_INTENT', occurredAt: now.toISOString(),
    content: 'Prepare the governed change.', evidenceRefs: ['evidence:proof:intent'],
  };
  const first = store.append(firstInput, now);
  const duplicate = store.append(firstInput, later);
  const second = store.append({ ...firstInput, eventId: 'event-proof-2', actorId: 'system', type: 'MISSION_COMPILED', occurredAt: '2026-07-21T04:00:01.000Z', content: 'Compiled under the same authority.' }, later);
  const reopened = new FileMissionConversationStore(root).get('tenant-proof', 'mission-proof');

  const grant = {
    grantId: 'grant-proof', tenantId: 'tenant-proof', subjectId: 'user-proof', workspaceId: 'workspace-proof',
    scopes: ['production.deploy'], issuedAt: '2026-07-21T03:00:00.000Z', expiresAt: '2026-07-21T08:00:00.000Z', issuer: 'canonical-authority',
  };
  const policy = {
    policyId: 'policy-proof', autoPrepareScopes: [], approvalRequiredScopes: ['production.deploy'], maxAutoPrepareCostUsd: 5,
    maxAutoPrepareRisk: 'MEDIUM', minimumConfidence: 0.8, requireApprovalForIrreversible: true,
    requireApprovalForUnknownReversibility: true, approverIds: ['reviewer-proof'],
  };
  const mission = compileChatMission({
    missionId: 'mission-proof', tenantId: 'tenant-proof', requesterId: 'user-proof', workspaceId: 'workspace-proof',
    message: 'Prepare deployment and wait for approval.', objective: 'Prepare governed deployment', requestedScopes: ['production.deploy'],
    riskLevel: 'CRITICAL', reversibility: 'IRREVERSIBLE', estimatedCostUsd: 20, confidence: 0.9,
    constraints: ['shadow'], prohibitedActions: ['external effect'], completionCriteria: ['decision receipt'],
    createdAt: '2026-07-21T03:59:00.000Z', expiresAt: '2026-07-21T05:00:00.000Z',
  }, grant, policy, now);
  const card = buildPushApprovalCard(mission, policy);
  const inbox = new InMemoryApprovalInbox();
  inbox.enqueue(card, now);
  const deliveryInput = { deliveryId: 'delivery-proof', tenantId: 'tenant-proof', cardId: card.cardId, approverId: 'reviewer-proof', deliveredAt: '2026-07-21T04:00:01.000Z' };
  const delivery = inbox.deliver(deliveryInput, later);
  const duplicateDelivery = inbox.deliver(deliveryInput, later);
  const explain = inbox.decide('tenant-proof', { decisionId: 'decision-explain-proof', cardId: card.cardId, actorId: 'reviewer-proof', option: 'EXPLAIN', occurredAt: '2026-07-21T04:00:02.000Z' }, later);
  const approveInput = { decisionId: 'decision-approve-proof', cardId: card.cardId, actorId: 'reviewer-proof', option: 'YES', occurredAt: '2026-07-21T04:00:03.000Z' };
  const approved = inbox.decide('tenant-proof', approveInput, later);
  const duplicateDecision = inbox.decide('tenant-proof', approveInput, later);

  const assertions = {
    filePersistenceReopened: reopened?.events.length === 2,
    appendIdempotent: duplicate.digest === first.digest,
    hashChainBound: second.previousDigest === first.digest && reopened?.rootDigest === second.digest,
    tenantIsolation: store.get('tenant-other', 'mission-proof') === undefined && inbox.get('tenant-other', card.cardId, later) === undefined,
    authorityRebindingBlocked: blocked(() => store.append({ ...firstInput, eventId: 'event-proof-3', authorityGrantDigest: sha256({ other: true }), occurredAt: '2026-07-21T04:00:04.000Z' }, later), /conversation_authority_binding_mismatch/),
    duplicateDeliveryIdempotent: duplicateDelivery.deliveryDigest === delivery.deliveryDigest,
    explanationNonterminal: explain.outcome === 'EXPLANATION_REQUESTED',
    oneTerminalDecision: approved.outcome === 'APPROVED' && duplicateDecision.decisionDigest === approved.decisionDigest,
    secondTerminalBlocked: blocked(() => inbox.decide('tenant-proof', { decisionId: 'decision-second-proof', cardId: card.cardId, actorId: 'reviewer-proof', option: 'NO', occurredAt: '2026-07-21T04:00:04.000Z' }, later), /approval_card_terminal_decision_exists/),
    noScopeExpansion: JSON.stringify(approved.approvedScopes) === JSON.stringify(card.requestedScopes),
    noExternalEffects: approved.externalEffectsExecuted === 0 && delivery.externalEffectsExecuted === 0 && reopened?.externalEffectsExecuted === 0,
    expiredApprovalBlocked: (() => {
      const expiring = { ...card, cardId: `${card.cardId}-expired`, expiresAt: '2026-07-21T04:00:05.000Z' };
      const { cardDigest: _old, ...material } = expiring;
      const signed = { ...material, cardDigest: sha256(material) };
      const expiredInbox = new InMemoryApprovalInbox();
      expiredInbox.enqueue(signed, now);
      return blocked(() => expiredInbox.decide('tenant-proof', { decisionId: 'expired-decision', cardId: signed.cardId, actorId: 'reviewer-proof', option: 'YES', occurredAt: '2026-07-21T04:00:04.000Z' }, new Date('2026-07-21T04:00:05.000Z')), /approval_card_expired/);
    })(),
  };
  assert.equal(Object.values(assertions).every(Boolean), true);
  const material = {
    version: '33.2', generatedAt: new Date().toISOString(), status: 'passed', classification: 'local-contract-proof-shadow-only',
    assertions,
    counts: { conversationEvents: reopened?.events.length ?? 0, deliveries: inbox.get('tenant-proof', card.cardId, later)?.deliveries.length ?? 0, decisions: inbox.get('tenant-proof', card.cardId, later)?.decisions.length ?? 0 },
    digests: { conversationRoot: reopened?.rootDigest, card: card.cardDigest, delivery: delivery.deliveryDigest, decision: approved.decisionDigest },
    limitations: ['No external mobile push transport.', 'Approval inbox adapter is in-memory.', 'Conversation file integrity is hash-based and not yet externally signed.', 'No human comprehension or task-flow evidence.'],
    productionPromotion: 'blocked', externalQualification: 'not_executed',
  };
  const report = { ...material, reportDigest: sha256(material) };
  mkdirSync('release-evidence/v33.2', { recursive: true });
  writeFileSync('release-evidence/v33.2/V33_2_MISSION_CONTINUITY_PROOF.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}
