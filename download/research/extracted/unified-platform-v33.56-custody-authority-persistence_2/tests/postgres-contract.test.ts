import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PostgresRuntimeStore, type PgClientLike, type PgPoolLike, type PgQueryResult } from '../src/runtime/postgres-store.js';

class RecordingClient implements PgClientLike {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  readonly scripted: Array<PgQueryResult<Record<string, unknown>>> = [];
  released = false;
  async query<Row extends Record<string, unknown>>(text: string, values: readonly unknown[] = []): Promise<PgQueryResult<Row>> {
    this.calls.push({ text, values });
    return (this.scripted.shift() ?? { rows: [], rowCount: 0 }) as PgQueryResult<Row>;
  }
  release(): void { this.released = true; }
}

class RecordingPool implements PgPoolLike {
  constructor(readonly client: RecordingClient) {}
  async connect(): Promise<PgClientLike> { return this.client; }
}

const missionRow = {
  mission_id: 'mission-1', tenant_id: 'tenant-1', subject_id: 'subject-1', builder_id: 'builder-1', scope: 'repository:read', effect_key: 'effect-1',
  approval_required: true, approval_status: 'PENDING', state: 'CREATED', revision: 0, lease_owner: null, lease_until: null, fence_token: 0,
  cancelled: false, created_at: '2026-07-16T12:00:00.000Z', updated_at: '2026-07-16T12:00:00.000Z',
};

test('PostgreSQL migration contains tenant RLS, append-only evidence and durable runtime tables', () => {
  const sql = readFileSync('infra/postgres/v19/001_canonical_runtime.sql', 'utf8');
  for (const table of ['missions', 'approvals', 'outbox', 'effects', 'events', 'evidence', 'revocations', 'idempotency_records', 'recovery_checkpoints']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.match(sql, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
  }
  assert.match(sql, /reject_append_only_update/);
  assert.match(sql, /UNIQUE \(tenant_id, effect_key\)/);
});

test('PostgreSQL mission creation is serializable, tenant-bound and append-only event aware', async () => {
  const client = new RecordingClient();
  client.scripted.push(
    { rows: [], rowCount: null },
    { rows: [], rowCount: 1 },
    { rows: [missionRow], rowCount: 1 },
    { rows: [], rowCount: null },
    { rows: [], rowCount: 0 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: null },
  );
  const store = new PostgresRuntimeStore(new RecordingPool(client));
  const created = await store.createMission({
    missionId: 'mission-1', tenantId: 'tenant-1', subjectId: 'subject-1', builderId: 'builder-1',
    scope: 'repository:read', effectKey: 'effect-1', approvalRequired: true,
  }, new Date('2026-07-16T12:00:00.000Z'));
  assert.equal(created.missionId, 'mission-1');
  assert.match(client.calls[0]?.text ?? '', /SERIALIZABLE/);
  assert.match(client.calls[1]?.text ?? '', /set_config\('app\.tenant_id'/);
  assert.equal(client.calls[1]?.values[0], 'tenant-1');
  assert.equal(client.calls.some((call) => call.text.includes('pg_advisory_xact_lock')), true);
  assert.equal(client.calls.at(-1)?.text.trim(), 'COMMIT');
  assert.equal(client.released, true);
});

test('PostgreSQL outbox claiming uses SKIP LOCKED and transaction rollback preserves original error', async () => {
  const client = new RecordingClient();
  client.scripted.push(
    { rows: [], rowCount: null },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 0 },
    { rows: [], rowCount: null },
  );
  const store = new PostgresRuntimeStore(new RecordingPool(client));
  const claimed = await store.claimPendingOutbox('tenant-1', 'worker-1', 30_000, new Date('2026-07-16T12:00:00.000Z'));
  assert.equal(claimed, null);
  assert.equal(client.calls.some((call) => /FOR UPDATE SKIP LOCKED/.test(call.text)), true);

  const failing = new RecordingClient();
  failing.query = async function<Row extends Record<string, unknown>>(text: string, values: readonly unknown[] = []): Promise<PgQueryResult<Row>> {
    this.calls.push({ text, values });
    if (text.includes('WITH candidate')) throw new Error('simulated_connection_loss');
    return { rows: [], rowCount: 0 } as PgQueryResult<Row>;
  };
  await assert.rejects(
    new PostgresRuntimeStore(new RecordingPool(failing)).claimPendingOutbox('tenant-1', 'worker-1', 30_000),
    /simulated_connection_loss/,
  );
  assert.equal(failing.calls.some((call) => call.text.trim() === 'ROLLBACK'), true);
});
