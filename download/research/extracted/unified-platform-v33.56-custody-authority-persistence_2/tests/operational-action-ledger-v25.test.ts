import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from '../src/contracts/crypto.js';
import { OperationalActionLedger } from '../src/operations/action-ledger.js';
import type { OperationalAction } from '../src/operations/operator-action-center.js';
const start = '2026-07-17T10:00:00.000Z';
const evidence = sha256({ result: 'verified' });
const critical: OperationalAction = { id: 'db-qualification', priority: 1, category: 'stop', title: 'Qualify database', why: 'Production durability is unqualified.', owner: 'Runtime Lead', runbook: 'docs/db.md', completionEvidence: 'Primary/standby failover evidence.' };
const medium: OperationalAction = { id: 'optimize-cache', priority: 3, category: 'optimize', title: 'Optimize cache', why: 'Latency is above local target.', owner: 'Performance Lead', completionEvidence: 'Bound benchmark report.' };
const transition = (ledger: OperationalActionLedger, actionId: string, type: 'ACKNOWLEDGED'|'STARTED'|'BLOCKED'|'UNBLOCKED'|'RESOLVED'|'WAIVED'|'REOPENED', minute: number, extra: { evidenceDigest?: string; approverIds?: readonly string[] } = {}) => ledger.transition({ actionId, type, actorId: 'operator-1', occurredAt: `2026-07-17T10:${String(minute).padStart(2,'0')}:00.000Z`, reason: `${type.toLowerCase()} with evidence`, ...extra });

test('action ledger records a digest-linked lifecycle through resolution', () => {
  const ledger = new OperationalActionLedger([critical], start);
  transition(ledger, critical.id, 'ACKNOWLEDGED', 1);
  transition(ledger, critical.id, 'STARTED', 2);
  transition(ledger, critical.id, 'RESOLVED', 3, { evidenceDigest: evidence });
  assert.equal(ledger.state(critical.id).status, 'RESOLVED');
  assert.equal(ledger.state(critical.id).resolutionEvidenceDigest, evidence);
  assert.equal(ledger.verify(), true);
  assert.equal(ledger.snapshot().events.length, 4);
});

test('resolution requires digest-bound completion evidence', () => {
  const ledger = new OperationalActionLedger([medium], start);
  assert.throws(() => transition(ledger, medium.id, 'RESOLVED', 1), /resolution_evidence_required/);
  assert.throws(() => transition(ledger, medium.id, 'RESOLVED', 1, { evidenceDigest: 'bad' }), /resolution_evidence_required/);
  transition(ledger, medium.id, 'RESOLVED', 1, { evidenceDigest: evidence });
  assert.equal(ledger.state(medium.id).status, 'RESOLVED');
});

test('priority-one waiver requires two independent approvers and evidence', () => {
  const ledger = new OperationalActionLedger([critical], start);
  assert.throws(() => transition(ledger, critical.id, 'WAIVED', 1, { evidenceDigest: evidence, approverIds: ['reviewer-1'] }), /waiver_approval_invalid/);
  assert.throws(() => transition(ledger, critical.id, 'WAIVED', 1, { evidenceDigest: evidence, approverIds: ['operator-1', 'reviewer-2'] }), /waiver_approval_invalid/);
  transition(ledger, critical.id, 'WAIVED', 1, { evidenceDigest: evidence, approverIds: ['reviewer-1', 'reviewer-2'] });
  assert.deepEqual(ledger.state(critical.id).waiverApproverIds, ['reviewer-1', 'reviewer-2']);
});

test('blocked actions must be unblocked before resolution', () => {
  const ledger = new OperationalActionLedger([critical], start);
  transition(ledger, critical.id, 'BLOCKED', 1);
  assert.throws(() => transition(ledger, critical.id, 'RESOLVED', 2, { evidenceDigest: evidence }), /transition_not_allowed/);
  transition(ledger, critical.id, 'UNBLOCKED', 2);
  transition(ledger, critical.id, 'RESOLVED', 3, { evidenceDigest: evidence });
  assert.equal(ledger.state(critical.id).status, 'RESOLVED');
});

test('resolved and waived actions can be reopened without retaining old closure evidence', () => {
  const ledger = new OperationalActionLedger([critical, medium], start);
  transition(ledger, critical.id, 'WAIVED', 1, { evidenceDigest: evidence, approverIds: ['reviewer-1', 'reviewer-2'] });
  transition(ledger, medium.id, 'RESOLVED', 1, { evidenceDigest: evidence });
  transition(ledger, critical.id, 'REOPENED', 2);
  transition(ledger, medium.id, 'REOPENED', 2);
  assert.equal(ledger.state(critical.id).status, 'IN_PROGRESS');
  assert.equal(ledger.state(critical.id).resolutionEvidenceDigest, undefined);
  assert.equal(ledger.state(critical.id).waiverApproverIds, undefined);
  assert.equal(ledger.state(medium.id).resolutionEvidenceDigest, undefined);
});

test('export and restore preserve the exact verified event chain', () => {
  const ledger = new OperationalActionLedger([medium], start);
  transition(ledger, medium.id, 'RESOLVED', 1, { evidenceDigest: evidence });
  const restored = OperationalActionLedger.restore(ledger.export());
  assert.deepEqual(restored.export(), ledger.export());
  assert.equal(restored.verify(), true);
});

test('tampered exported event chains are rejected on restore', () => {
  const ledger = new OperationalActionLedger([medium], start);
  const exported = ledger.export();
  const events = exported.events.map((event, index) => index === 0 ? { ...event, reason: 'tampered' } : event);
  assert.throws(() => OperationalActionLedger.restore({ actions: exported.actions, events }), /integrity_invalid/);
});

test('overdue unresolved actions are surfaced but resolved actions are excluded', () => {
  const ledger = new OperationalActionLedger([critical, medium], start);
  transition(ledger, medium.id, 'RESOLVED', 1, { evidenceDigest: evidence });
  const snapshot = ledger.snapshot(new Date('2026-07-18T12:00:00.000Z'), 60 * 60 * 1000);
  assert.deepEqual(snapshot.overdueActionIds, [critical.id]);
  assert.equal(snapshot.statusCounts.RESOLVED, 1);
});

test('invalid action identities, timestamps and transitions fail closed', () => {
  assert.throws(() => new OperationalActionLedger([critical, critical], start), /duplicate_action/);
  assert.throws(() => new OperationalActionLedger([critical], 'bad'), /time_invalid/);
  const ledger = new OperationalActionLedger([critical], start);
  assert.throws(() => ledger.transition({ actionId: 'missing', type: 'STARTED', actorId: 'a', occurredAt: start, reason: 'x' }), /action_not_found/);
  assert.throws(() => ledger.transition({ actionId: critical.id, type: 'STARTED', actorId: '', occurredAt: start, reason: 'x' }), /transition_invalid/);
  transition(ledger, critical.id, 'STARTED', 1);
  assert.throws(() => transition(ledger, critical.id, 'STARTED', 2), /transition_not_allowed/);
  assert.throws(() => ledger.snapshot(new Date('bad')), /snapshot_input_invalid/);
});
