import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { AuthorityGrant } from '../src/contracts/canonical.js';
import { sha256 } from '../src/contracts/crypto.js';
import {
  buildPushApprovalCard,
  compileChatMission,
  type ApprovalPolicy,
  type ChatMissionRequest,
  type PushApprovalCard,
} from '../src/product/chat-mission.js';
import {
  FileMissionConversationStore,
  InMemoryApprovalInbox,
  InMemoryMissionConversationStore,
  verifyConversationSnapshot,
  verifyInboxItem,
} from '../src/product/mission-conversation-v33_2.js';

const t0 = new Date('2026-07-21T04:00:00.000Z');
const authorityDigest = sha256({ grant: 'canonical-grant-33.2' });
const grant: AuthorityGrant = {
  grantId: 'grant-chat-33-2', tenantId: 'tenant-1', subjectId: 'user-1', workspaceId: 'workspace-1',
  scopes: ['repository.read', 'repository.change.prepare', 'production.deploy'],
  issuedAt: '2026-07-21T03:00:00.000Z', expiresAt: '2026-07-21T08:00:00.000Z', issuer: 'canonical-authority',
};
const policy: ApprovalPolicy = {
  policyId: 'policy-chat-33-2', autoPrepareScopes: ['repository.read', 'repository.change.prepare'], approvalRequiredScopes: ['production.deploy'],
  maxAutoPrepareCostUsd: 5, maxAutoPrepareRisk: 'MEDIUM', minimumConfidence: 0.8,
  requireApprovalForIrreversible: true, requireApprovalForUnknownReversibility: true, approverIds: ['reviewer-1', 'reviewer-2'],
};
const request: ChatMissionRequest = {
  missionId: 'mission-chat-33-2', tenantId: 'tenant-1', requesterId: 'user-1', workspaceId: 'workspace-1',
  message: 'Prepare a production deployment but do not execute it before approval.', objective: 'Prepare governed deployment',
  requestedScopes: ['production.deploy'], riskLevel: 'CRITICAL', reversibility: 'IRREVERSIBLE', estimatedCostUsd: 20, confidence: 0.9,
  constraints: ['shadow preparation'], prohibitedActions: ['execute external effect'], completionCriteria: ['approval receipt exists'],
  createdAt: '2026-07-21T03:59:00.000Z', expiresAt: '2026-07-21T05:00:00.000Z',
};

function card(overrides: Partial<PushApprovalCard> = {}): PushApprovalCard {
  const mission = compileChatMission(request, grant, policy, t0);
  const created = buildPushApprovalCard(mission, policy);
  if (Object.keys(overrides).length === 0) return created;
  const material = { ...created, ...overrides } as PushApprovalCard;
  const { cardDigest: _digest, ...withoutDigest } = material;
  return { ...withoutDigest, cardDigest: sha256(withoutDigest) };
}

function event(overrides: Partial<Parameters<InMemoryMissionConversationStore['append']>[0]> = {}) {
  return {
    eventId: 'event-1', tenantId: 'tenant-1', missionId: 'mission-1', authorityGrantDigest: authorityDigest,
    actorId: 'user-1', type: 'USER_INTENT' as const, occurredAt: '2026-07-21T04:00:00.000Z',
    content: 'Prepare the change under the existing authority.', evidenceRefs: ['evidence:intent:1'], ...overrides,
  };
}

test('conversation store is append-only, hash chained and idempotent', () => {
  const store = new InMemoryMissionConversationStore();
  const first = store.append(event(), t0);
  const duplicate = store.append(event(), new Date('2026-07-21T04:00:01.000Z'));
  assert.equal(duplicate.digest, first.digest);
  const second = store.append(event({ eventId: 'event-2', actorId: 'system', type: 'MISSION_COMPILED', occurredAt: '2026-07-21T04:00:01.000Z', content: 'Mission compiled in shadow mode.' }), new Date('2026-07-21T04:00:02.000Z'));
  assert.equal(second.sequence, 2);
  assert.equal(second.previousDigest, first.digest);
  const snapshot = store.get('tenant-1', 'mission-1')!;
  assert.equal(snapshot.events.length, 2);
  assert.equal(snapshot.rootDigest, second.digest);
  assert.equal(snapshot.externalEffectsExecuted, 0);
  verifyConversationSnapshot(snapshot);
});

test('conversation event id conflict and authority rebinding fail closed', () => {
  const store = new InMemoryMissionConversationStore();
  store.append(event(), t0);
  assert.throws(() => store.append(event({ content: 'Conflicting content.' }), t0), /conversation_event_id_conflict/);
  assert.throws(() => store.append(event({ eventId: 'event-2', authorityGrantDigest: sha256({ other: true }), occurredAt: '2026-07-21T04:00:01.000Z' }), new Date('2026-07-21T04:00:02.000Z')), /conversation_authority_binding_mismatch/);
});

test('tenant keying prevents cross-tenant conversation reads', () => {
  const store = new InMemoryMissionConversationStore();
  store.append(event(), t0);
  assert.equal(store.get('tenant-2', 'mission-1'), undefined);
  assert.equal(store.get('tenant-1', 'mission-1')?.events.length, 1);
});

test('file conversation store survives reopen and detects tampering', () => {
  const root = mkdtempSync(join(tmpdir(), 'mission-conversation-v33-2-'));
  try {
    const store = new FileMissionConversationStore(root);
    store.append(event(), t0);
    const reopened = new FileMissionConversationStore(root);
    assert.equal(reopened.get('tenant-1', 'mission-1')?.events.length, 1);
    const files = readdirSync(root).filter((name) => name.endsWith('.json'));
    assert.equal(files.length, 1);
    const path = join(root, files[0]!);
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { events: Array<{ content: string }> };
    raw.events[0]!.content = 'tampered';
    writeFileSync(path, JSON.stringify(raw));
    assert.throws(() => reopened.get('tenant-1', 'mission-1'), /conversation_content_digest_invalid|conversation_event_digest_invalid|conversation_snapshot_digest_invalid/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('conversation export and restore preserve integrity', () => {
  const store = new InMemoryMissionConversationStore();
  store.append(event(), t0);
  const restored = InMemoryMissionConversationStore.restore(store.export());
  assert.equal(restored.get('tenant-1', 'mission-1')?.rootDigest, store.get('tenant-1', 'mission-1')?.rootDigest);
  const tampered = structuredClone(store.export());
  (tampered[0]!.events[0] as { content: string }).content = 'tampered';
  assert.throws(() => InMemoryMissionConversationStore.restore(tampered), /conversation_content_digest_invalid/);
});

test('approval inbox deduplicates enqueue and delivery without effects', () => {
  const inbox = new InMemoryApprovalInbox();
  const approvalCard = card();
  const first = inbox.enqueue(approvalCard, t0);
  const duplicate = inbox.enqueue(approvalCard, new Date('2026-07-21T04:00:01.000Z'));
  assert.equal(duplicate.itemDigest, first.itemDigest);
  const deliveryInput = { deliveryId: 'delivery-1', tenantId: 'tenant-1', cardId: approvalCard.cardId, approverId: 'reviewer-1', deliveredAt: '2026-07-21T04:00:01.000Z' };
  const delivery = inbox.deliver(deliveryInput, new Date('2026-07-21T04:00:02.000Z'));
  const repeated = inbox.deliver(deliveryInput, new Date('2026-07-21T04:00:03.000Z'));
  assert.equal(repeated.deliveryDigest, delivery.deliveryDigest);
  assert.equal(delivery.externalEffectsExecuted, 0);
  assert.equal(inbox.get('tenant-1', approvalCard.cardId, new Date('2026-07-21T04:00:03.000Z'))?.deliveries.length, 1);
});

test('cross-tenant and unauthorized approval access fail closed', () => {
  const inbox = new InMemoryApprovalInbox();
  const approvalCard = card();
  inbox.enqueue(approvalCard, t0);
  assert.equal(inbox.get('tenant-2', approvalCard.cardId, t0), undefined);
  assert.deepEqual(inbox.list('tenant-2', 'reviewer-1', t0), []);
  assert.throws(() => inbox.deliver({ deliveryId: 'delivery-x', tenantId: 'tenant-2', cardId: approvalCard.cardId, approverId: 'reviewer-1', deliveredAt: '2026-07-21T04:00:01.000Z' }, new Date('2026-07-21T04:00:02.000Z')), /approval_card_not_found/);
  assert.throws(() => inbox.deliver({ deliveryId: 'delivery-y', tenantId: 'tenant-1', cardId: approvalCard.cardId, approverId: 'intruder', deliveredAt: '2026-07-21T04:00:01.000Z' }, new Date('2026-07-21T04:00:02.000Z')), /approval_actor_not_authorized/);
});

test('expired card cannot be delivered or decided', () => {
  const inbox = new InMemoryApprovalInbox();
  const approvalCard = card({ expiresAt: '2026-07-21T04:01:00.000Z' });
  inbox.enqueue(approvalCard, t0);
  const expired = new Date('2026-07-21T04:01:00.000Z');
  assert.equal(inbox.get('tenant-1', approvalCard.cardId, expired)?.state, 'EXPIRED');
  assert.throws(() => inbox.deliver({ deliveryId: 'delivery-expired', tenantId: 'tenant-1', cardId: approvalCard.cardId, approverId: 'reviewer-1', deliveredAt: '2026-07-21T04:00:59.000Z' }, expired), /approval_card_expired/);
  assert.throws(() => inbox.decide('tenant-1', { decisionId: 'decision-expired', cardId: approvalCard.cardId, actorId: 'reviewer-1', option: 'YES', occurredAt: '2026-07-21T04:00:59.000Z' }, expired), /approval_card_expired/);
});

test('explanation is nonterminal and one later terminal decision is allowed', () => {
  const inbox = new InMemoryApprovalInbox();
  const approvalCard = card();
  inbox.enqueue(approvalCard, t0);
  const explain = inbox.decide('tenant-1', { decisionId: 'decision-explain', cardId: approvalCard.cardId, actorId: 'reviewer-1', option: 'EXPLAIN', occurredAt: '2026-07-21T04:00:01.000Z' }, new Date('2026-07-21T04:00:02.000Z'));
  assert.equal(explain.outcome, 'EXPLANATION_REQUESTED');
  assert.equal(inbox.get('tenant-1', approvalCard.cardId, new Date('2026-07-21T04:00:02.000Z'))?.state, 'PENDING');
  const deliveryInput = { deliveryId: 'delivery-before-approve', tenantId: 'tenant-1', cardId: approvalCard.cardId, approverId: 'reviewer-1', deliveredAt: '2026-07-21T04:00:02.500Z' };
  const delivery = inbox.deliver(deliveryInput, new Date('2026-07-21T04:00:02.600Z'));
  const approveInput = { decisionId: 'decision-approve', cardId: approvalCard.cardId, actorId: 'reviewer-1', option: 'YES' as const, occurredAt: '2026-07-21T04:00:03.000Z' };
  const approved = inbox.decide('tenant-1', approveInput, new Date('2026-07-21T04:00:04.000Z'));
  const repeated = inbox.decide('tenant-1', approveInput, new Date('2026-07-21T04:00:05.000Z'));
  assert.equal(repeated.decisionDigest, approved.decisionDigest);
  const deliveryRetry = inbox.deliver(deliveryInput, new Date('2026-07-21T04:00:05.000Z'));
  assert.equal(deliveryRetry.deliveryDigest, delivery.deliveryDigest);
  assert.deepEqual(approved.approvedScopes, approvalCard.requestedScopes);
  assert.equal(approved.externalEffectsExecuted, 0);
  assert.equal(inbox.get('tenant-1', approvalCard.cardId, new Date('2026-07-21T04:00:05.000Z'))?.state, 'DECIDED');
});

test('conflicting or second terminal decisions are rejected', () => {
  const inbox = new InMemoryApprovalInbox();
  const approvalCard = card();
  inbox.enqueue(approvalCard, t0);
  inbox.decide('tenant-1', { decisionId: 'decision-final', cardId: approvalCard.cardId, actorId: 'reviewer-1', option: 'YES', occurredAt: '2026-07-21T04:00:01.000Z' }, new Date('2026-07-21T04:00:02.000Z'));
  assert.throws(() => inbox.decide('tenant-1', { decisionId: 'decision-final', cardId: approvalCard.cardId, actorId: 'reviewer-1', option: 'NO', occurredAt: '2026-07-21T04:00:01.000Z' }, new Date('2026-07-21T04:00:03.000Z')), /approval_decision_id_conflict/);
  assert.throws(() => inbox.decide('tenant-1', { decisionId: 'decision-second', cardId: approvalCard.cardId, actorId: 'reviewer-2', option: 'NO', occurredAt: '2026-07-21T04:00:02.000Z' }, new Date('2026-07-21T04:00:03.000Z')), /approval_card_terminal_decision_exists/);
});

test('approval inbox export and restore reject tampering', () => {
  const inbox = new InMemoryApprovalInbox();
  const approvalCard = card();
  inbox.enqueue(approvalCard, t0);
  const restored = InMemoryApprovalInbox.restore(inbox.export(), t0);
  const row = restored.get('tenant-1', approvalCard.cardId, t0)!;
  verifyInboxItem(row, t0);
  const tampered = structuredClone(inbox.export());
  (tampered[0] as { state: string }).state = 'DECIDED';
  assert.throws(() => InMemoryApprovalInbox.restore(tampered, t0), /approval_terminal_state_invalid|approval_inbox_digest_invalid/);
});

test('approval card identity conflicts are rejected', () => {
  const inbox = new InMemoryApprovalInbox();
  const approvalCard = card();
  inbox.enqueue(approvalCard, t0);
  const changed = card({ title: 'Changed title' });
  assert.equal(changed.cardId, approvalCard.cardId);
  assert.throws(() => inbox.enqueue(changed, t0), /approval_card_id_conflict/);
});
