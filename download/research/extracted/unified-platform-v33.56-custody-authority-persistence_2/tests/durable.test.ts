import assert from 'node:assert/strict';
import test from 'node:test';
import type { EvidenceRecord } from '../src/contracts/canonical.js';
import { createHarness } from './helpers.js';

function missionRequest(id: string, approvalRequired = false) {
  return {
    missionId: id,
    tenantId: 'tenant-1',
    subjectId: 'subject-1',
    builderId: 'builder-1',
    scope: 'repository.read',
    effectKey: `effect:${id}`,
    approvalRequired,
  } as const;
}

test('normal durable execution completes with one visible effect', async () => {
  const h = createHarness();
  try {
    h.engine.createAuthorizedMission(h.signedGrant, missionRequest('m-normal'), h.now);
    const lease = h.engine.acquire('m-normal', 'worker-1', 30_000, h.now.getTime());
    const outbox = h.engine.prepare(lease, { operation: 'read' }, h.now.getTime());
    if (outbox === null) throw new Error('outbox_expected');
    await h.engine.execute(outbox, lease, () => ({ ok: true }), { now: h.now });
    assert.equal(h.store.getMission('m-normal').state, 'COMPLETED');
    assert.equal(h.store.countEffects('effect:m-normal'), 1);
    assert.equal(h.store.verifyEventChain('m-normal').ok, true);
  } finally { h.store.close(); }
});

test('crash after effect is recovered without duplicate effect', async () => {
  const h = createHarness();
  try {
    h.engine.createAuthorizedMission(h.signedGrant, missionRequest('m-crash'), h.now);
    const lease = h.engine.acquire('m-crash', 'worker-1', 30_000, h.now.getTime());
    const outbox = h.engine.prepare(lease, { operation: 'read' }, h.now.getTime());
    if (outbox === null) throw new Error('outbox_expected');
    await assert.rejects(
      h.engine.execute(outbox, lease, () => ({ ok: true }), { crashAfterEffect: true, now: h.now }),
      /injected_crash_after_effect/,
    );
    assert.equal(h.store.countEffects('effect:m-crash'), 1);
    await h.engine.execute(outbox, lease, () => { throw new Error('must_not_reexecute'); }, { now: h.now });
    assert.equal(h.store.countEffects('effect:m-crash'), 1);
    assert.equal(h.store.getMission('m-crash').state, 'COMPLETED');
  } finally { h.store.close(); }
});

test('stale fencing token is rejected', () => {
  const h = createHarness();
  try {
    h.engine.createAuthorizedMission(h.signedGrant, missionRequest('m-fence'), h.now);
    const oldLease = h.engine.acquire('m-fence', 'worker-1', 1, h.now.getTime());
    const newLease = h.engine.acquire('m-fence', 'worker-2', 30_000, h.now.getTime() + 2);
    assert.ok(newLease.fenceToken > oldLease.fenceToken);
    assert.throws(() => h.engine.prepare(oldLease, {}, h.now.getTime() + 2), /stale_fence|lease_expired/);
  } finally { h.store.close(); }
});

test('approval wait creates no outbox and resumes after independent review', () => {
  const h = createHarness();
  try {
    h.engine.createAuthorizedMission(h.signedGrant, missionRequest('m-approval', true), h.now);
    const lease = h.engine.acquire('m-approval', 'worker-1', 30_000, h.now.getTime());
    assert.equal(h.engine.prepare(lease, { operation: 'read' }, h.now.getTime()), null);
    assert.equal(h.store.listPendingOutbox().length, 0);
    const waiting = h.store.getMission('m-approval');
    assert.equal(waiting.state, 'WAITING_APPROVAL');
    assert.throws(() => h.engine.approve('m-approval', 'builder-1', waiting.revision, h.now), /self_approval_forbidden/);
    h.engine.approve('m-approval', 'reviewer-1', waiting.revision, h.now);
    const resumedLease = h.engine.acquire('m-approval', 'worker-2', 30_000, h.now.getTime() + 1);
    assert.ok(h.engine.prepare(resumedLease, { operation: 'read' }, h.now.getTime() + 1));
  } finally { h.store.close(); }
});

test('cancellation prevents effects', () => {
  const h = createHarness();
  try {
    h.engine.createAuthorizedMission(h.signedGrant, missionRequest('m-cancel'), h.now);
    const revision = h.store.getMission('m-cancel').revision;
    h.store.cancelMission('m-cancel', revision, 'user_cancelled', h.now);
    assert.throws(() => h.engine.acquire('m-cancel', 'worker-1', 30_000, h.now.getTime()), /mission_terminal/);
    assert.equal(h.store.countEffects('effect:m-cancel'), 0);
  } finally { h.store.close(); }
});

test('revision compare-and-set rejects stale approval and cancel', () => {
  const h = createHarness();
  try {
    h.engine.createAuthorizedMission(h.signedGrant, missionRequest('m-cas', true), h.now);
    h.engine.acquire('m-cas', 'worker-1', 30_000, h.now.getTime());
    const revision = h.store.getMission('m-cas').revision;
    assert.throws(() => h.engine.approve('m-cas', 'reviewer-1', revision - 1, h.now), /revision_conflict/);
    assert.throws(() => h.store.cancelMission('m-cas', revision - 1, 'stale', h.now), /revision_conflict/);
  } finally { h.store.close(); }
});

test('idempotency key cannot be reused with different payload', () => {
  const h = createHarness();
  try {
    h.engine.createAuthorizedMission(h.signedGrant, missionRequest('m-idem'), h.now);
    const lease = h.engine.acquire('m-idem', 'worker-1', 30_000, h.now.getTime());
    const outbox = h.engine.prepare(lease, { value: 1 }, h.now.getTime());
    if (outbox === null) throw new Error('outbox_expected');
    h.store.recordEffect(outbox.outboxId, lease, { result: 1 }, h.now);
    process.env.NODE_ENV = 'test';
    h.store.unsafeSqlForTestOnly("UPDATE outbox SET payload_json = '{\"value\":2}' WHERE outbox_id = '" + outbox.outboxId + "'");
    assert.throws(() => h.store.recordEffect(outbox.outboxId, lease, { result: 2 }, h.now), /idempotency_payload_conflict/);
  } finally { delete process.env.NODE_ENV; h.store.close(); }
});

test('event-chain tampering is detected', () => {
  const h = createHarness();
  try {
    h.engine.createAuthorizedMission(h.signedGrant, missionRequest('m-event'), h.now);
    assert.equal(h.store.verifyEventChain('m-event').ok, true);
    process.env.NODE_ENV = 'test';
    h.store.unsafeSqlForTestOnly("UPDATE events SET payload_json = '{\"tampered\":true}' WHERE mission_id = 'm-event'");
    assert.equal(h.store.verifyEventChain('m-event').ok, false);
  } finally { delete process.env.NODE_ENV; h.store.close(); }
});

test('evidence-chain tampering is detected', () => {
  const h = createHarness();
  try {
    const record: EvidenceRecord = {
      recordId: 'e1', tenantId: 'tenant-1', kind: 'computed', subject: 'm1', payload: { score: 1 },
      evidenceClass: 'COMPUTED', method: 'test', environment: {}, createdAt: h.now.toISOString(), limitations: [],
    };
    h.store.appendEvidence(record);
    h.store.appendEvidence({ ...record, recordId: 'e2', payload: { score: 2 } });
    assert.equal(h.store.verifyEvidenceChain('tenant-1').ok, true);
    process.env.NODE_ENV = 'test';
    h.store.unsafeSqlForTestOnly("UPDATE evidence SET record_json = replace(record_json, '\"score\":1', '\"score\":9') WHERE sequence = 1");
    assert.equal(h.store.verifyEvidenceChain('tenant-1').ok, false);
  } finally { delete process.env.NODE_ENV; h.store.close(); }
});
