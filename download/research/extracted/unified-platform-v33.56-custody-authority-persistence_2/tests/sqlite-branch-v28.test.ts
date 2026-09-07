import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EvidenceRecord } from '../src/contracts/canonical.js';
import { SqliteRuntimeStore } from '../src/runtime/sqlite-store.js';
import type { MissionRequest } from '../src/runtime/types.js';

const now = new Date('2026-07-17T12:00:00.000Z');

function request(id: string, approvalRequired: boolean, builderId = 'builder'): MissionRequest {
  return { missionId: id, tenantId: 'tenant-1', subjectId: 'subject-1', builderId, scope: 'repository.read', effectKey: `effect:${id}`, approvalRequired };
}

function evidence(id: string, score: number): EvidenceRecord {
  return { recordId: id, tenantId: 'tenant-1', kind: 'computed', subject: id, payload: { score }, evidenceClass: 'COMPUTED', method: 'test', environment: {}, createdAt: now.toISOString(), limitations: [] };
}

function withStore<T>(operation: (store: SqliteRuntimeStore) => T): T {
  const directory = mkdtempSync(join(tmpdir(), 'sqlite-v28-'));
  const store = new SqliteRuntimeStore(join(directory, 'runtime.db'));
  try { return operation(store); }
  finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
}

test('mission creation, lookup and lease validation cover approval and terminal branches', () => withStore((store) => {
  assert.throws(() => store.createMission(request('bad-builder', true, '')), /builder_required/);
  const noApproval = store.createMission(request('no-approval', false, ''), now);
  assert.equal(noApproval.approvalStatus, 'NOT_REQUIRED');
  const approval = store.createMission(request('approval', true), now);
  assert.equal(approval.approvalStatus, 'PENDING');
  assert.throws(() => store.getMission('missing'), /mission_not_found/);
  assert.throws(() => store.acquireLease('approval', '', 1000, now.getTime()), /worker_required/);
  assert.throws(() => store.acquireLease('approval', 'worker', 1.5, now.getTime()), /invalid_lease_ttl/);
  assert.throws(() => store.acquireLease('approval', 'worker', 0, now.getTime()), /invalid_lease_ttl/);

  const first = store.acquireLease('approval', 'worker-a', 1000, now.getTime());
  assert.throws(() => store.acquireLease('approval', 'worker-b', 1000, now.getTime() + 1), /lease_busy/);
  const renewed = store.acquireLease('approval', 'worker-a', 1000, now.getTime() + 1);
  assert.ok(renewed.fenceToken > first.fenceToken);

  store.createMission(request('cancelled', false), now);
  const cancelled = store.getMission('cancelled');
  store.cancelMission('cancelled', cancelled.revision, 'stop', now);
  assert.throws(() => store.acquireLease('cancelled', 'worker', 1000, now.getTime()), /mission_terminal/);

  store.createMission(request('failed', false), now);
  process.env.NODE_ENV = 'test';
  store.unsafeSqlForTestOnly("UPDATE missions SET state='FAILED' WHERE mission_id='failed'");
  assert.throws(() => store.acquireLease('failed', 'worker', 1000, now.getTime()), /mission_terminal/);
  delete process.env.NODE_ENV;
}));

test('approval and cancellation reject all invalid state and compare-and-set branches', () => withStore((store) => {
  store.createMission(request('not-required', false), now);
  assert.throws(() => store.approveMission('not-required', '', 0, now), /reviewer_required/);
  assert.throws(() => store.approveMission('not-required', 'reviewer', 0, now), /approval_not_required/);

  store.createMission(request('self', true), now);
  assert.throws(() => store.approveMission('self', 'builder', 0, now), /self_approval_forbidden/);
  assert.throws(() => store.approveMission('self', 'reviewer', 1, now), /revision_conflict/);

  store.createMission(request('cancel-before-approve', true), now);
  const cancelled = store.cancelMission('cancel-before-approve', 0, 'stop', now);
  assert.equal(cancelled.cancelled, true);
  assert.throws(() => store.approveMission('cancel-before-approve', 'reviewer', cancelled.revision, now), /mission_cancelled/);

  store.createMission(request('approval-cas', true), now);
  process.env.NODE_ENV = 'test';
  store.unsafeSqlForTestOnly("UPDATE missions SET approval_status='APPROVED' WHERE mission_id='approval-cas'");
  assert.throws(() => store.approveMission('approval-cas', 'reviewer', 0, now), /approval_compare_and_set_failed/);

  store.createMission(request('cancel-cas', false), now);
  store.unsafeSqlForTestOnly("CREATE TRIGGER block_cancel BEFORE UPDATE OF state ON missions WHEN NEW.state='CANCELLED' BEGIN SELECT RAISE(IGNORE); END");
  assert.throws(() => store.cancelMission('cancel-cas', 0, 'stop', now), /cancel_compare_and_set_failed/);
  store.unsafeSqlForTestOnly('DROP TRIGGER block_cancel');
  delete process.env.NODE_ENV;
}));

test('outbox branches cover approval wait, existing outbox, lookup and cancelled flag', () => withStore((store) => {
  store.createMission(request('wait', true), now);
  const waitingLease = store.acquireLease('wait', 'worker', 10_000, now.getTime());
  assert.equal(store.prepareOutbox(waitingLease, { operation: 'read' }, now.getTime()), null);
  assert.equal(store.listPendingOutbox().length, 0);
  const waiting = store.getMission('wait');
  store.approveMission('wait', 'reviewer', waiting.revision, new Date(now.getTime() + 1));
  const approvedLease = store.acquireLease('wait', 'worker', 10_000, now.getTime() + 2);
  const outbox = store.prepareOutbox(approvedLease, { operation: 'read' }, now.getTime() + 2)!;
  assert.equal(store.prepareOutbox(approvedLease, { operation: 'different' }, now.getTime() + 2)?.outboxId, outbox.outboxId);
  assert.equal(store.getOutboxByEffectKey('missing'), null);
  assert.equal(store.getOutboxByEffectKey(outbox.effectKey)?.outboxId, outbox.outboxId);
  assert.equal(store.listPendingOutbox().length, 1);
  assert.throws(() => store.getOutbox('missing'), /outbox_not_found/);

  store.createMission(request('cancel-flag', false), now);
  const cancelLease = store.acquireLease('cancel-flag', 'worker', 10_000, now.getTime());
  process.env.NODE_ENV = 'test';
  store.unsafeSqlForTestOnly("UPDATE missions SET cancelled=1 WHERE mission_id='cancel-flag'");
  assert.throws(() => store.prepareOutbox(cancelLease, {}, now.getTime()), /mission_cancelled/);
  delete process.env.NODE_ENV;
}));

test('effect and acknowledgement branches reject missing, cross-mission, stale and invalid outbox states', () => withStore((store) => {
  store.createMission(request('effect-a', false), now);
  store.createMission(request('effect-b', false), now);
  const leaseA = store.acquireLease('effect-a', 'worker-a', 100_000, now.getTime());
  const leaseB = store.acquireLease('effect-b', 'worker-b', 100_000, now.getTime());
  const outboxA = store.prepareOutbox(leaseA, { value: 1 }, now.getTime())!;
  const outboxB = store.prepareOutbox(leaseB, { value: 2 }, now.getTime())!;
  assert.throws(() => store.recordEffect(outboxA.outboxId, leaseB, { result: 1 }, now), /stale_fence/);
  assert.throws(() => store.getEffect('missing'), /effect_not_found/);
  assert.throws(() => store.acknowledgeOutbox(outboxA.outboxId, leaseA, now), /effect_not_found/);

  store.recordEffect(outboxA.outboxId, leaseA, { result: 1 }, now);
  process.env.NODE_ENV = 'test';
  store.unsafeSqlForTestOnly(`UPDATE outbox SET status='BROKEN' WHERE outbox_id='${outboxA.outboxId}'`);
  assert.throws(() => store.acknowledgeOutbox(outboxA.outboxId, leaseA, now), /outbox_ack_failed/);
  store.unsafeSqlForTestOnly(`UPDATE outbox SET status='PENDING' WHERE outbox_id='${outboxA.outboxId}'`);
  assert.equal(store.acknowledgeOutbox(outboxA.outboxId, leaseA, now).state, 'COMPLETED');
  assert.throws(() => store.cancelMission('effect-a', store.getMission('effect-a').revision, 'late', now), /completed_mission_cannot_cancel/);

  store.recordEffect(outboxB.outboxId, leaseB, { result: 2 }, now);
  store.acknowledgeOutbox(outboxB.outboxId, leaseB, now);
  store.unsafeSqlForTestOnly(`UPDATE missions SET lease_owner='worker-b', lease_until=${now.getTime()+100000}, fence_token=${leaseB.fenceToken} WHERE mission_id='effect-b'`);
  assert.equal(store.acknowledgeOutbox(outboxB.outboxId, leaseB, now).state, 'COMPLETED');
  delete process.env.NODE_ENV;
}));

test('evidence and event verification distinguish previous-link and digest tampering', () => withStore((store) => {
  assert.deepEqual(store.verifyEvidenceChain('tenant-1'), { ok: true, count: 0, root: null });
  store.appendEvidence(evidence('e1', 1));
  store.appendEvidence(evidence('e2', 2));
  process.env.NODE_ENV = 'test';
  store.unsafeSqlForTestOnly("UPDATE evidence SET record_json=replace(record_json, '\"previousDigest\":\"', '\"previousDigest\":\"bad') WHERE sequence=2");
  assert.equal(store.verifyEvidenceChain('tenant-1').ok, false);

  store.createMission(request('event-chain', false), now);
  store.acquireLease('event-chain', 'worker', 1000, now.getTime());
  store.unsafeSqlForTestOnly("UPDATE events SET previous_digest='bad' WHERE mission_id='event-chain' AND sequence=(SELECT MAX(sequence) FROM events WHERE mission_id='event-chain')");
  assert.equal(store.verifyEventChain('event-chain').ok, false);
  delete process.env.NODE_ENV;
}));

test('unsafe SQL is unavailable outside test mode and expired leases are rejected', () => withStore((store) => {
  delete process.env.NODE_ENV;
  assert.throws(() => store.unsafeSqlForTestOnly('SELECT 1'), /unsafe_sql_test_only/);
  store.createMission(request('expired', false), now);
  const lease = store.acquireLease('expired', 'worker', 1, now.getTime());
  assert.throws(() => store.prepareOutbox(lease, {}, now.getTime() + 2), /lease_expired/);
}));
