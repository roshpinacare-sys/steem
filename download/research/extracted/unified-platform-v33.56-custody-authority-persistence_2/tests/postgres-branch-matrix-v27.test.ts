import assert from 'node:assert/strict';
import test from 'node:test';
import { evidenceDigest, type EvidenceRecord } from '../src/contracts/canonical.js';
import { sha256 } from '../src/contracts/crypto.js';
import { PostgresRuntimeStore, type PgClientLike, type PgPoolLike, type PgQueryResult } from '../src/runtime/postgres-store.js';
import type { Lease, OutboxRow } from '../src/runtime/types.js';

const now = new Date('2026-07-17T12:00:00.000Z');
const mission = (overrides: Record<string, unknown> = {}) => ({
  mission_id: 'mission-1', tenant_id: 'tenant-1', subject_id: 'subject-1', builder_id: 'builder-1', scope: 'repository.read', effect_key: 'effect-1',
  approval_required: false, approval_status: 'NOT_REQUIRED', state: 'CREATED', revision: 0, lease_owner: null, lease_until: null, fence_token: 0,
  cancelled: false, created_at: now.toISOString(), updated_at: now.toISOString(), ...overrides,
});
const payload = { operation: 'bounded', value: 7 };
const outboxRow = (overrides: Record<string, unknown> = {}) => ({
  outbox_id: '11111111-1111-4111-8111-111111111111', mission_id: 'mission-1', tenant_id: 'tenant-1', effect_key: 'effect-1',
  payload_json: payload, payload_digest: sha256(payload), status: 'CLAIMED', attempt_count: 1, fence_token: 4,
  claimed_by: 'worker-1', claimed_until: new Date(now.getTime() + 60_000).toISOString(), created_at: now.toISOString(), delivered_at: null, ...overrides,
});
const lease: Lease = { missionId: 'mission-1', workerId: 'worker-1', fenceToken: 4, expiresAt: now.getTime() + 60_000 };
const suppliedOutbox: OutboxRow = {
  outboxId: String(outboxRow().outbox_id), missionId: 'mission-1', tenantId: 'tenant-1', effectKey: 'effect-1', payload,
  status: 'PENDING', attemptCount: 1, fenceToken: 4, createdAt: now.toISOString(), deliveredAt: null,
};

class RouteClient implements PgClientLike {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  released = false;
  constructor(readonly route: (text: string, values: readonly unknown[], index: number) => PgQueryResult<Record<string, unknown>> | Promise<PgQueryResult<Record<string, unknown>>>) {}
  async query<Row extends Record<string, unknown>>(text: string, values: readonly unknown[] = []): Promise<PgQueryResult<Row>> {
    this.calls.push({ text, values });
    return await this.route(text, values, this.calls.length) as PgQueryResult<Row>;
  }
  release(): void { this.released = true; }
}
class SequencePool implements PgPoolLike {
  readonly clients: RouteClient[] = [];
  constructor(readonly factory: (attempt: number) => RouteClient) {}
  async connect(): Promise<PgClientLike> { const client = this.factory(this.clients.length + 1); this.clients.push(client); return client; }
}
const empty = (): PgQueryResult<Record<string, unknown>> => ({ rows: [], rowCount: 0 });
function normalTransactionRoute(domain: (text: string, values: readonly unknown[]) => PgQueryResult<Record<string, unknown>>): RouteClient {
  return new RouteClient((text, values) => {
    if (text.trim() === 'BEGIN ISOLATION LEVEL SERIALIZABLE' || text.trim() === 'COMMIT' || text.trim() === 'ROLLBACK') return { rows: [], rowCount: null };
    if (text.includes("set_config('app.tenant_id'")) return { rows: [], rowCount: 1 };
    return domain(text, values);
  });
}

test('Postgres create, lease, approval and outbox preparation cover both approval paths', async () => {
  const createdClient = normalTransactionRoute((text) => {
    if (text.includes('INSERT INTO missions')) return { rows: [mission()], rowCount: 1 };
    if (text.includes('SELECT digest FROM events')) return { rows: [{ digest: 'previous-event' }], rowCount: 1 };
    if (text.includes('INSERT INTO events')) return { rows: [], rowCount: 1 };
    return empty();
  });
  const created = await new PostgresRuntimeStore(new SequencePool(() => createdClient)).createMission({
    missionId: 'mission-1', tenantId: 'tenant-1', subjectId: 'subject-1', builderId: 'builder-1', scope: 'repository.read', effectKey: 'effect-1', approvalRequired: false,
  }, now);
  assert.equal(created.approvalStatus, 'NOT_REQUIRED');
  assert.equal(createdClient.calls.some((call) => call.values.includes('previous-event')), true);

  await assert.rejects(new PostgresRuntimeStore(new SequencePool(() => normalTransactionRoute(() => empty()))).acquireLease('tenant-1', 'mission-1', 'worker', 0), /invalid_lease_ttl/);
  const leaseClient = normalTransactionRoute((text) => {
    if (text.includes('UPDATE missions') && text.includes('lease_owner')) return { rows: [mission({ lease_owner: 'worker-1', lease_until: new Date(now.getTime() + 1000).toISOString(), fence_token: 4, revision: 1 })], rowCount: 1 };
    if (text.includes('SELECT digest FROM events') || text.includes('INSERT INTO events')) return empty();
    return empty();
  });
  const acquired = await new PostgresRuntimeStore(new SequencePool(() => leaseClient)).acquireLease('tenant-1', 'mission-1', 'worker-1', 1000, now);
  assert.equal(acquired.fenceToken, 4);
  assert.equal(acquired.expiresAt, now.getTime() + 1000);

  const approvalClient = normalTransactionRoute((text) => {
    if (text.includes("approval_status='APPROVED'")) return { rows: [mission({ approval_required: true, approval_status: 'APPROVED', state: 'READY', revision: 2 })], rowCount: 1 };
    if (text.includes('INSERT INTO approvals') || text.includes('SELECT digest FROM events') || text.includes('INSERT INTO events')) return empty();
    return empty();
  });
  const approved = await new PostgresRuntimeStore(new SequencePool(() => approvalClient)).approveMission('tenant-1', 'mission-1', 'reviewer-1', 1, now);
  assert.equal(approved.state, 'READY');

  const waitingClient = normalTransactionRoute((text) => {
    if (text.includes('SELECT * FROM missions')) return { rows: [mission({ approval_required: true, approval_status: 'PENDING', lease_owner: 'worker-1', lease_until: new Date(now.getTime() + 60_000).toISOString(), fence_token: 4 })], rowCount: 1 };
    if (text.includes("state='WAITING_APPROVAL'") || text.includes('SELECT digest FROM events') || text.includes('INSERT INTO events')) return empty();
    return empty();
  });
  assert.equal(await new PostgresRuntimeStore(new SequencePool(() => waitingClient)).prepareOutbox('tenant-1', lease, payload, now), null);

  const prepareClient = normalTransactionRoute((text) => {
    if (text.includes('SELECT * FROM missions')) return { rows: [mission({ lease_owner: 'worker-1', lease_until: new Date(now.getTime() + 60_000).toISOString(), fence_token: 4 })], rowCount: 1 };
    if (text.includes('INSERT INTO outbox')) return { rows: [outboxRow({ payload_json: JSON.stringify(payload), status: 'PENDING' })], rowCount: 1 };
    if (text.includes("state='EFFECT_PENDING'") || text.includes('SELECT digest FROM events') || text.includes('INSERT INTO events')) return empty();
    return empty();
  });
  const prepared = await new PostgresRuntimeStore(new SequencePool(() => prepareClient)).prepareOutbox('tenant-1', lease, payload, now);
  assert.deepEqual(prepared?.payload, payload);
});

test('Postgres claim validates identities and maps delivered and pending rows', async () => {
  const store = new PostgresRuntimeStore(new SequencePool(() => normalTransactionRoute(() => empty())));
  await assert.rejects(store.claimPendingOutbox('', 'worker', 1), /claim_identity_required/);
  await assert.rejects(store.claimPendingOutbox('tenant', '', 1), /claim_identity_required/);
  await assert.rejects(store.claimPendingOutbox('tenant', 'worker', -1), /invalid_outbox_claim_ttl/);
  const claimedClient = normalTransactionRoute((text) => text.includes('WITH candidate')
    ? { rows: [outboxRow({ status: 'DELIVERED', delivered_at: now.toISOString() })], rowCount: 1 } : empty());
  const claimed = await new PostgresRuntimeStore(new SequencePool(() => claimedClient)).claimPendingOutbox('tenant-1', 'worker-1', 1000, now);
  assert.equal(claimed?.status, 'DELIVERED');
  assert.equal(claimed?.deliveredAt, now.toISOString());
});

function completionClient(overrides: { mission?: Record<string, unknown>; outbox?: Record<string, unknown>; effect?: Record<string, unknown>; delivered?: number; completed?: number } = {}): RouteClient {
  return normalTransactionRoute((text) => {
    if (text.includes('SELECT * FROM missions')) return { rows: [mission({ lease_owner: 'worker-1', lease_until: new Date(now.getTime() + 60_000).toISOString(), fence_token: 4, ...overrides.mission })], rowCount: 1 };
    if (text.includes('SELECT * FROM outbox')) return { rows: [outboxRow(overrides.outbox)], rowCount: 1 };
    if (text.includes('INSERT INTO effects')) return { rows: [{ effectKey: 'effect-1', tenantId: 'tenant-1', payloadDigest: sha256(payload), result: { ok: true }, appliedAt: now.toISOString(), ...overrides.effect }], rowCount: 1 };
    if (text.includes("UPDATE outbox SET status='DELIVERED'")) return { rows: [], rowCount: overrides.delivered ?? 1 };
    if (text.includes("UPDATE missions SET state='COMPLETED'")) return { rows: [], rowCount: overrides.completed ?? 1 };
    if (text.includes('SELECT digest FROM events') || text.includes('INSERT INTO events')) return empty();
    return empty();
  });
}

test('Postgres effect completion validates canonical outbox, claims, fencing and idempotency', async () => {
  const run = (client: RouteClient, supplied: OutboxRow = suppliedOutbox) => new PostgresRuntimeStore(new SequencePool(() => client)).recordEffectAndComplete('tenant-1', supplied, lease, { ok: true }, now);
  assert.equal((await run(completionClient())).effectKey, 'effect-1');
  await assert.rejects(run(completionClient({ outbox: { payload_digest: sha256('wrong') } })), /outbox_payload_digest_corrupt/);
  await assert.rejects(run(completionClient({ outbox: { status: 'PENDING' } })), /outbox_not_claimed/);
  await assert.rejects(run(completionClient({ outbox: { claimed_by: 'other' } })), /outbox_claim_owner_mismatch/);
  await assert.rejects(run(completionClient({ outbox: { claimed_until: now.toISOString() } })), /outbox_claim_expired/);
  await assert.rejects(run(completionClient({ outbox: { fence_token: 5 } })), /stale_fence/);
  await assert.rejects(run(completionClient(), { ...suppliedOutbox, effectKey: 'substituted' }), /outbox_substitution_detected/);
  await assert.rejects(run(completionClient(), { ...suppliedOutbox, payload: { operation: 'attacker' } }), /outbox_substitution_detected/);
  await assert.rejects(run(completionClient({ effect: { payloadDigest: sha256('other') } })), /idempotency_payload_conflict/);
  await assert.rejects(run(completionClient({ delivered: 0 })), /outbox_delivery_fence_failed/);
  await assert.rejects(run(completionClient({ completed: 0 })), /completion_fence_failed/);
  await assert.rejects(run(completionClient({ mission: { lease_owner: 'other' } })), /stale_fence/);
  await assert.rejects(run(completionClient({ mission: { lease_until: now.toISOString() } })), /lease_expired/);
});

test('Postgres appendEvidence chains records and validates input', async () => {
  const base: EvidenceRecord = {
    recordId: 'record-1', tenantId: 'tenant-1', kind: 'coverage', subject: 'subject-1', payload: { ok: true }, evidenceClass: 'COMPUTED', method: 'v27.test', environment: { runtime: 'node' }, createdAt: now.toISOString(), limitations: [],
  };
  const firstClient = normalTransactionRoute((text) => {
    if (text.includes('SELECT digest FROM evidence')) return empty();
    return empty();
  });
  assert.equal(await new PostgresRuntimeStore(new SequencePool(() => firstClient)).appendEvidence(base), evidenceDigest(base));
  const previousDigest = sha256('previous');
  const chainedClient = normalTransactionRoute((text) => text.includes('SELECT digest FROM evidence') ? { rows: [{ digest: previousDigest }], rowCount: 1 } : empty());
  const expected = evidenceDigest({ ...base, previousDigest });
  assert.equal(await new PostgresRuntimeStore(new SequencePool(() => chainedClient)).appendEvidence(base), expected);
  await assert.rejects(new PostgresRuntimeStore(new SequencePool(() => normalTransactionRoute(() => empty()))).appendEvidence({ ...base, tenantId: '' }), /tenant_id_required/);
});

test('Postgres transaction retries serialization/deadlock errors only and always releases clients', async () => {
  const pool = new SequencePool((attempt) => normalTransactionRoute((text) => {
    if (text.includes('WITH candidate') && attempt < 3) { const error = new Error('retry'); Object.assign(error, { code: attempt === 1 ? '40001' : '40P01' }); throw error; }
    if (text.includes('WITH candidate')) return empty();
    return empty();
  }));
  assert.equal(await new PostgresRuntimeStore(pool).claimPendingOutbox('tenant-1', 'worker-1', 1000, now), null);
  assert.equal(pool.clients.length, 3);
  assert.equal(pool.clients.every((client) => client.released), true);

  const nonRetry = new SequencePool(() => normalTransactionRoute((text) => {
    if (text.includes('WITH candidate')) { const error = new Error('not-retryable'); Object.assign(error, { code: 'XX000' }); throw error; }
    if (text.trim() === 'ROLLBACK') throw new Error('rollback-failed');
    return empty();
  }));
  await assert.rejects(new PostgresRuntimeStore(nonRetry).claimPendingOutbox('tenant-1', 'worker-1', 1000, now), /not-retryable/);
  assert.equal(nonRetry.clients.length, 1);
  await assert.rejects(new PostgresRuntimeStore(new SequencePool(() => normalTransactionRoute(() => empty()))).createMission({ missionId: 'm', tenantId: '   ', subjectId: 's', builderId: 'b', scope: 'r', effectKey: 'e', approvalRequired: false }, now), /tenant_id_required/);
});
