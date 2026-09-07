import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { sha256 } from '../src/contracts/crypto.js';
import { PostgresRuntimeStore, type PgClientLike, type PgPoolLike, type PgQueryResult } from '../src/runtime/postgres-store.js';
import type { Lease, OutboxRow } from '../src/runtime/types.js';

const now = new Date('2026-07-17T09:00:00.000Z');
const missionRow = {
  mission_id: 'mission-1', tenant_id: 'tenant-1', subject_id: 'subject-1', builder_id: 'builder-1', scope: 'repository:read', effect_key: 'effect-1',
  approval_required: false, approval_status: 'NOT_REQUIRED', state: 'EFFECT_PENDING', revision: 2, lease_owner: 'worker-1',
  lease_until: '2026-07-17T09:05:00.000Z', fence_token: 7, cancelled: false,
  created_at: '2026-07-17T08:59:00.000Z', updated_at: '2026-07-17T09:00:00.000Z',
};
const payload = { operation: 'apply', value: 42 };
const canonicalOutbox = {
  outbox_id: '11111111-1111-4111-8111-111111111111', mission_id: 'mission-1', tenant_id: 'tenant-1', effect_key: 'effect-1',
  payload_json: payload, payload_digest: sha256(payload), status: 'CLAIMED', attempt_count: 2, fence_token: 7,
  claimed_by: 'worker-1', claimed_until: '2026-07-17T09:02:00.000Z', created_at: '2026-07-17T08:59:30.000Z', delivered_at: null,
};
const lease: Lease = { missionId: 'mission-1', workerId: 'worker-1', fenceToken: 7, expiresAt: Date.parse('2026-07-17T09:05:00.000Z') };
const outbox: OutboxRow = {
  outboxId: canonicalOutbox.outbox_id, missionId: 'mission-1', tenantId: 'tenant-1', effectKey: 'effect-1', payload,
  status: 'PENDING', attemptCount: 2, fenceToken: 7, createdAt: canonicalOutbox.created_at, deliveredAt: null,
};

class RoutedClient implements PgClientLike {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  released = false;
  constructor(readonly route: (text: string, values: readonly unknown[]) => PgQueryResult<Record<string, unknown>> | Promise<PgQueryResult<Record<string, unknown>>>) {}
  async query<Row extends Record<string, unknown>>(text: string, values: readonly unknown[] = []): Promise<PgQueryResult<Row>> {
    this.calls.push({ text, values });
    return await this.route(text, values) as PgQueryResult<Row>;
  }
  release(): void { this.released = true; }
}
class StaticPool implements PgPoolLike {
  constructor(readonly client: PgClientLike) {}
  async connect(): Promise<PgClientLike> { return this.client; }
}

function empty(): PgQueryResult<Record<string, unknown>> { return { rows: [], rowCount: 0 }; }

function recordClient(overrides: Partial<typeof canonicalOutbox> = {}, deliveredCount = 1): RoutedClient {
  const row = { ...canonicalOutbox, ...overrides };
  return new RoutedClient((text) => {
    if (/SELECT \* FROM missions/.test(text)) return { rows: [missionRow], rowCount: 1 };
    if (/SELECT \* FROM outbox/.test(text)) return { rows: [row], rowCount: 1 };
    if (/INSERT INTO effects/.test(text)) return { rows: [{ effectKey: row.effect_key, tenantId: row.tenant_id, payloadDigest: row.payload_digest, result: { ok: true }, appliedAt: now.toISOString() }], rowCount: 1 };
    if (/UPDATE outbox SET status='DELIVERED'/.test(text)) return { rows: [], rowCount: deliveredCount };
    if (/UPDATE missions SET state='COMPLETED'/.test(text)) return { rows: [], rowCount: 1 };
    if (/SELECT digest FROM events/.test(text)) return empty();
    if (/INSERT INTO events/.test(text)) return { rows: [], rowCount: 1 };
    return empty();
  });
}

test('v23 PostgreSQL migration forces RLS and binds mission foreign keys to tenant', () => {
  const sql = readFileSync('infra/postgres/v23/001_canonical_runtime.sql', 'utf8');
  for (const table of ['missions','approvals','outbox','effects','events','evidence','revocations','idempotency_records','recovery_checkpoints','memberships','private_sessions','artifact_records','trust_snapshots','action_passports','audit_records']) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
  }
  for (const constraint of ['approvals_mission_tenant_fk','outbox_mission_tenant_fk','events_mission_tenant_fk','recovery_mission_tenant_fk']) assert.match(sql, new RegExp(constraint));
  assert.match(sql, /outbox_claimable_idx/);
});

test('expired PostgreSQL outbox claims are reclaimable with SKIP LOCKED', async () => {
  const client = new RoutedClient((text) => {
    if (/WITH candidate/.test(text)) return { rows: [canonicalOutbox], rowCount: 1 };
    return empty();
  });
  const claimed = await new PostgresRuntimeStore(new StaticPool(client)).claimPendingOutbox('tenant-1', 'worker-1', 30_000, now);
  assert.equal(claimed?.outboxId, canonicalOutbox.outbox_id);
  const sql = client.calls.find((call) => /WITH candidate/.test(call.text))?.text ?? '';
  assert.match(sql, /status='CLAIMED' AND claimed_until <= \$3/);
  assert.match(sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(sql, /o\.tenant_id=\$1/);
});

test('invalid PostgreSQL outbox claim TTL is rejected before connecting', async () => {
  let connects = 0;
  const pool: PgPoolLike = { async connect() { connects += 1; return new RoutedClient(() => empty()); } };
  await assert.rejects(new PostgresRuntimeStore(pool).claimPendingOutbox('tenant-1', 'worker-1', 0, now), /invalid_outbox_claim_ttl/);
  assert.equal(connects, 0);
});

test('completion rejects caller-supplied outbox substitution before inserting an effect', async () => {
  const client = recordClient();
  await assert.rejects(
    new PostgresRuntimeStore(new StaticPool(client)).recordEffectAndComplete('tenant-1', { ...outbox, payload: { operation: 'tampered' } }, lease, { ok: true }, now),
    /outbox_substitution_detected/,
  );
  assert.equal(client.calls.some((call) => /INSERT INTO effects/.test(call.text)), false);
  assert.equal(client.calls.some((call) => /SELECT \* FROM outbox[\s\S]*FOR UPDATE/.test(call.text)), true);
});

test('completion rejects stolen, expired and corrupted canonical claims', async () => {
  for (const [overrides, pattern] of [
    [{ claimed_by: 'worker-2' }, /outbox_claim_owner_mismatch/],
    [{ claimed_until: '2026-07-17T08:59:59.000Z' }, /outbox_claim_expired/],
    [{ payload_digest: 'bad-digest' }, /outbox_payload_digest_corrupt/],
  ] as const) {
    await assert.rejects(
      new PostgresRuntimeStore(new StaticPool(recordClient(overrides))).recordEffectAndComplete('tenant-1', outbox, lease, { ok: true }, now),
      pattern,
    );
  }
});

test('completion fails closed when the fenced delivered update affects no row', async () => {
  const client = recordClient({}, 0);
  await assert.rejects(
    new PostgresRuntimeStore(new StaticPool(client)).recordEffectAndComplete('tenant-1', outbox, lease, { ok: true }, now),
    /outbox_delivery_fence_failed/,
  );
  assert.equal(client.calls.some((call) => /UPDATE missions SET state='COMPLETED'/.test(call.text)), false);
});

test('serializable and deadlock failures retry on a fresh connection, generic failures do not', async () => {
  let connects = 0;
  const first = new RoutedClient((text) => {
    if (/WITH candidate/.test(text)) throw Object.assign(new Error('serialization'), { code: '40001' });
    return empty();
  });
  const second = new RoutedClient(() => empty());
  const retryPool: PgPoolLike = { async connect() { connects += 1; return connects === 1 ? first : second; } };
  assert.equal(await new PostgresRuntimeStore(retryPool).claimPendingOutbox('tenant-1', 'worker-1', 30_000, now), null);
  assert.equal(connects, 2);
  assert.equal(first.released, true);
  assert.equal(second.released, true);

  let genericConnects = 0;
  const genericPool: PgPoolLike = { async connect() {
    genericConnects += 1;
    return new RoutedClient((text) => { if (/WITH candidate/.test(text)) throw new Error('network'); return empty(); });
  } };
  await assert.rejects(new PostgresRuntimeStore(genericPool).claimPendingOutbox('tenant-1', 'worker-1', 30_000, now), /network/);
  assert.equal(genericConnects, 1);
});
