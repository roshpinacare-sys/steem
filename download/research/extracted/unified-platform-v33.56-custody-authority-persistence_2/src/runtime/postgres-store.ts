import { randomUUID } from 'node:crypto';
import { evidenceDigest, validateEvidenceRecord, type EvidenceRecord } from '../contracts/canonical.js';
import { sha256 } from '../contracts/crypto.js';
import type { EffectReceipt, Lease, MissionRequest, MissionRow, OutboxRow } from './types.js';

export interface PgQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

export interface PgClientLike {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PgQueryResult<Row>>;
  release?(): void;
}

export interface PgPoolLike {
  connect(): Promise<PgClientLike>;
}

interface PgMissionRow extends Record<string, unknown> {
  mission_id: string;
  tenant_id: string;
  subject_id: string;
  builder_id: string;
  scope: string;
  effect_key: string;
  approval_required: boolean;
  approval_status: MissionRow['approvalStatus'];
  state: MissionRow['state'];
  revision: string | number;
  lease_owner: string | null;
  lease_until: Date | string | null;
  fence_token: string | number;
  cancelled: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

interface PgOutboxRow extends Record<string, unknown> {
  outbox_id: string;
  mission_id: string;
  tenant_id: string;
  effect_key: string;
  payload_json: Record<string, unknown> | string;
  payload_digest: string;
  status: OutboxRow['status'] | 'CLAIMED';
  attempt_count: number;
  fence_token: string | number;
  claimed_by: string | null;
  claimed_until: Date | string | null;
  created_at: Date | string;
  delivered_at: Date | string | null;
}

export class PostgresRuntimeStore {
  constructor(readonly pool: PgPoolLike) {}

  async createMission(request: MissionRequest, now = new Date()): Promise<MissionRow> {
    return this.#transaction(request.tenantId, async (client) => {
      const result = await client.query<PgMissionRow>(`
        INSERT INTO missions (
          mission_id, tenant_id, subject_id, builder_id, scope, effect_key,
          approval_required, approval_status, state, revision, fence_token,
          cancelled, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'CREATED',0,0,false,$9,$9)
        RETURNING *
      `, [
        request.missionId, request.tenantId, request.subjectId, request.builderId,
        request.scope, request.effectKey, request.approvalRequired,
        request.approvalRequired ? 'PENDING' : 'NOT_REQUIRED', now.toISOString(),
      ]);
      const row = requireOne(result, 'mission_insert_failed');
      await this.#appendEvent(client, request.missionId, request.tenantId, 'MISSION_CREATED', { scope: request.scope }, now);
      return mapMission(row);
    });
  }

  async acquireLease(tenantId: string, missionId: string, workerId: string, ttlMs: number, now = new Date()): Promise<Lease> {
    if (!Number.isInteger(ttlMs) || ttlMs <= 0) throw new Error('invalid_lease_ttl');
    return this.#transaction(tenantId, async (client) => {
      const result = await client.query<PgMissionRow>(`
        UPDATE missions
        SET lease_owner=$3,
            lease_until=$4::timestamptz + ($5::bigint * interval '1 millisecond'),
            fence_token=fence_token+1,
            revision=revision+1,
            updated_at=$4
        WHERE tenant_id=$1 AND mission_id=$2
          AND state NOT IN ('COMPLETED','CANCELLED','FAILED')
          AND (lease_until IS NULL OR lease_until <= $4 OR lease_owner=$3)
        RETURNING *
      `, [tenantId, missionId, workerId, now.toISOString(), ttlMs]);
      const row = requireOne(result, 'lease_busy_or_mission_missing');
      const mapped = mapMission(row);
      await this.#appendEvent(client, missionId, tenantId, 'LEASE_ACQUIRED', {
        workerId, fenceToken: mapped.fenceToken, expiresAt: mapped.leaseUntil,
      }, now);
      if (mapped.leaseUntil === null) throw new Error('lease_expiry_missing');
      return { missionId, workerId, fenceToken: mapped.fenceToken, expiresAt: mapped.leaseUntil };
    });
  }

  async approveMission(tenantId: string, missionId: string, reviewerId: string, expectedRevision: number, now = new Date()): Promise<MissionRow> {
    return this.#transaction(tenantId, async (client) => {
      const result = await client.query<PgMissionRow>(`
        UPDATE missions
        SET approval_status='APPROVED', state='READY', revision=revision+1,
            lease_owner=NULL, lease_until=NULL, updated_at=$5
        WHERE tenant_id=$1 AND mission_id=$2 AND revision=$3
          AND approval_status='PENDING' AND builder_id<>$4 AND cancelled=false
        RETURNING *
      `, [tenantId, missionId, expectedRevision, reviewerId, now.toISOString()]);
      const row = requireOne(result, 'approval_conflict_or_self_approval');
      await client.query(`
        INSERT INTO approvals (tenant_id, mission_id, reviewer_id, decision, mission_revision, created_at)
        VALUES ($1,$2,$3,'APPROVED',$4,$5)
      `, [tenantId, missionId, reviewerId, expectedRevision, now.toISOString()]);
      await this.#appendEvent(client, missionId, tenantId, 'MISSION_APPROVED', { reviewerId }, now);
      return mapMission(row);
    });
  }

  async prepareOutbox(
    tenantId: string,
    lease: Lease,
    payload: Readonly<Record<string, unknown>>,
    now = new Date(),
  ): Promise<OutboxRow | null> {
    return this.#transaction(tenantId, async (client) => {
      const missionResult = await client.query<PgMissionRow>(`
        SELECT * FROM missions
        WHERE tenant_id=$1 AND mission_id=$2
        FOR UPDATE
      `, [tenantId, lease.missionId]);
      const mission = mapMission(requireOne(missionResult, 'mission_not_found'));
      assertLease(mission, lease, now);
      if (mission.approvalRequired && mission.approvalStatus !== 'APPROVED') {
        await client.query(`
          UPDATE missions SET state='WAITING_APPROVAL', revision=revision+1, updated_at=$3
          WHERE tenant_id=$1 AND mission_id=$2 AND fence_token=$4
        `, [tenantId, lease.missionId, now.toISOString(), lease.fenceToken]);
        await this.#appendEvent(client, lease.missionId, tenantId, 'APPROVAL_WAIT', {}, now);
        return null;
      }
      const outboxId = randomUUID();
      const digest = sha256(payload);
      const result = await client.query<PgOutboxRow>(`
        INSERT INTO outbox (
          outbox_id, tenant_id, mission_id, effect_key, payload_json, payload_digest,
          status, attempt_count, fence_token, created_at
        ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,'PENDING',0,$7,$8)
        ON CONFLICT (tenant_id, effect_key) DO UPDATE
          SET effect_key=EXCLUDED.effect_key
        RETURNING *
      `, [outboxId, tenantId, mission.missionId, mission.effectKey, JSON.stringify(payload), digest, lease.fenceToken, now.toISOString()]);
      const outbox = mapOutbox(requireOne(result, 'outbox_insert_failed'));
      await client.query(`
        UPDATE missions SET state='EFFECT_PENDING', revision=revision+1, updated_at=$3
        WHERE tenant_id=$1 AND mission_id=$2 AND fence_token=$4
      `, [tenantId, mission.missionId, now.toISOString(), lease.fenceToken]);
      await this.#appendEvent(client, mission.missionId, tenantId, 'OUTBOX_PREPARED', { outboxId: outbox.outboxId }, now);
      return outbox;
    });
  }

  async claimPendingOutbox(tenantId: string, workerId: string, leaseMs: number, now = new Date()): Promise<OutboxRow | null> {
    if (tenantId.trim() === '' || workerId.trim() === '') throw new Error('claim_identity_required');
    if (!Number.isInteger(leaseMs) || leaseMs <= 0) throw new Error('invalid_outbox_claim_ttl');
    return this.#transaction(tenantId, async (client) => {
      const result = await client.query<PgOutboxRow>(`
        WITH candidate AS (
          SELECT outbox_id FROM outbox
          WHERE tenant_id=$1
            AND (status='PENDING' OR (status='CLAIMED' AND claimed_until <= $3))
          ORDER BY created_at, outbox_id
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE outbox o
        SET status='CLAIMED', claimed_by=$2,
            claimed_until=$3::timestamptz + ($4::bigint * interval '1 millisecond'),
            attempt_count=attempt_count+1
        FROM candidate
        WHERE o.tenant_id=$1 AND o.outbox_id=candidate.outbox_id
        RETURNING o.*
      `, [tenantId, workerId, now.toISOString(), leaseMs]);
      return result.rows[0] === undefined ? null : mapOutbox(result.rows[0]);
    });
  }

  async recordEffectAndComplete(
    tenantId: string,
    outbox: OutboxRow,
    lease: Lease,
    resultPayload: Readonly<Record<string, unknown>>,
    now = new Date(),
  ): Promise<EffectReceipt> {
    return this.#transaction(tenantId, async (client) => {
      const missionResult = await client.query<PgMissionRow>(`
        SELECT * FROM missions WHERE tenant_id=$1 AND mission_id=$2 FOR UPDATE
      `, [tenantId, lease.missionId]);
      const mission = mapMission(requireOne(missionResult, 'mission_not_found'));
      assertLease(mission, lease, now);

      const canonicalResult = await client.query<PgOutboxRow>(`
        SELECT * FROM outbox
        WHERE tenant_id=$1 AND outbox_id=$2
        FOR UPDATE
      `, [tenantId, outbox.outboxId]);
      const canonical = requireOne(canonicalResult, 'outbox_not_found');
      const canonicalPayload = parsePayload(canonical.payload_json);
      const canonicalDigest = sha256(canonicalPayload);
      if (canonical.payload_digest !== canonicalDigest) throw new Error('outbox_payload_digest_corrupt');
      if (canonical.status !== 'CLAIMED') throw new Error('outbox_not_claimed');
      if (canonical.claimed_by !== lease.workerId) throw new Error('outbox_claim_owner_mismatch');
      if (canonical.claimed_until === null || new Date(canonical.claimed_until).getTime() <= now.getTime()) throw new Error('outbox_claim_expired');
      if (canonical.mission_id !== mission.missionId || Number(canonical.fence_token) !== lease.fenceToken) throw new Error('stale_fence');
      if (outbox.missionId !== canonical.mission_id || outbox.effectKey !== canonical.effect_key || outbox.fenceToken !== Number(canonical.fence_token)) throw new Error('outbox_substitution_detected');
      if (sha256(outbox.payload) !== canonicalDigest) throw new Error('outbox_substitution_detected');

      const effect = await client.query<EffectReceipt & Record<string, unknown>>(`
        INSERT INTO effects (tenant_id, effect_key, payload_digest, result_json, applied_at)
        VALUES ($1,$2,$3,$4::jsonb,$5)
        ON CONFLICT (tenant_id, effect_key) DO UPDATE
          SET effect_key=EXCLUDED.effect_key
        RETURNING effect_key AS "effectKey", tenant_id AS "tenantId",
                  payload_digest AS "payloadDigest", result_json AS result,
                  applied_at AS "appliedAt"
      `, [tenantId, canonical.effect_key, canonicalDigest, JSON.stringify(resultPayload), now.toISOString()]);
      const receipt = requireOne(effect, 'effect_insert_failed');
      if (receipt.payloadDigest !== canonicalDigest) throw new Error('idempotency_payload_conflict');
      const delivered = await client.query(`
        UPDATE outbox SET status='DELIVERED', delivered_at=$5, claimed_by=NULL, claimed_until=NULL
        WHERE tenant_id=$1 AND outbox_id=$2 AND fence_token=$3
          AND status='CLAIMED' AND claimed_by=$4
      `, [tenantId, canonical.outbox_id, lease.fenceToken, lease.workerId, now.toISOString()]);
      if (delivered.rowCount !== 1) throw new Error('outbox_delivery_fence_failed');
      const completed = await client.query(`
        UPDATE missions SET state='COMPLETED', revision=revision+1,
          lease_owner=NULL, lease_until=NULL, updated_at=$4
        WHERE tenant_id=$1 AND mission_id=$2 AND fence_token=$3
      `, [tenantId, mission.missionId, lease.fenceToken, now.toISOString()]);
      if (completed.rowCount !== 1) throw new Error('completion_fence_failed');
      await this.#appendEvent(client, mission.missionId, tenantId, 'MISSION_COMPLETED', { effectKey: canonical.effect_key }, now);
      return receipt;
    });
  }

  async appendEvidence(record: EvidenceRecord): Promise<string> {
    validateEvidenceRecord(record);
    return this.#transaction(record.tenantId, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`evidence:${record.tenantId}`]);
      const previous = await client.query<{ digest: string } & Record<string, unknown>>(`
        SELECT digest FROM evidence WHERE tenant_id=$1 ORDER BY sequence DESC LIMIT 1
      `, [record.tenantId]);
      const normalized: EvidenceRecord = previous.rows[0] === undefined ? record : { ...record, previousDigest: previous.rows[0].digest };
      const digest = evidenceDigest(normalized);
      await client.query(`
        INSERT INTO evidence (tenant_id, record_json, previous_digest, digest)
        VALUES ($1,$2::jsonb,$3,$4)
      `, [record.tenantId, JSON.stringify(normalized), normalized.previousDigest ?? null, digest]);
      return digest;
    });
  }

  async #appendEvent(
    client: PgClientLike,
    missionId: string,
    tenantId: string,
    type: string,
    payload: Readonly<Record<string, unknown>>,
    now: Date,
  ): Promise<void> {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`event:${missionId}`]);
    const previous = await client.query<{ digest: string } & Record<string, unknown>>(`
      SELECT digest FROM events WHERE mission_id=$1 ORDER BY sequence DESC LIMIT 1
    `, [missionId]);
    const previousDigest = previous.rows[0]?.digest ?? null;
    const digest = sha256({ missionId, tenantId, type, payload, createdAt: now.toISOString(), previousDigest });
    await client.query(`
      INSERT INTO events (mission_id, tenant_id, event_type, payload_json, created_at, previous_digest, digest)
      VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)
    `, [missionId, tenantId, type, JSON.stringify(payload), now.toISOString(), previousDigest, digest]);
  }

  async #transaction<T>(tenantId: string, operation: (client: PgClientLike) => Promise<T>): Promise<T> {
    if (tenantId.trim() === '') throw new Error('tenant_id_required');
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
        const value = await operation(client);
        await client.query('COMMIT');
        return value;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* retain original error */ }
        if (attempt < maxAttempts && isRetryableTransactionError(error)) continue;
        throw error;
      } finally {
        client.release?.();
      }
    }
    throw new Error('transaction_retry_exhausted');
  }
}

function requireOne<Row extends Record<string, unknown>>(result: PgQueryResult<Row>, error: string): Row {
  if (result.rows.length !== 1) throw new Error(error);
  return result.rows[0] as Row;
}

function mapMission(row: PgMissionRow): MissionRow {
  return {
    missionId: row.mission_id,
    tenantId: row.tenant_id,
    subjectId: row.subject_id,
    builderId: row.builder_id,
    scope: row.scope,
    effectKey: row.effect_key,
    approvalRequired: row.approval_required,
    approvalStatus: row.approval_status,
    state: row.state,
    revision: Number(row.revision),
    leaseOwner: row.lease_owner,
    leaseUntil: row.lease_until === null ? null : new Date(row.lease_until).getTime(),
    fenceToken: Number(row.fence_token),
    cancelled: row.cancelled,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function parsePayload(payload: PgOutboxRow['payload_json']): Readonly<Record<string, unknown>> {
  return typeof payload === 'string' ? JSON.parse(payload) as Record<string, unknown> : payload;
}

function mapOutbox(row: PgOutboxRow): OutboxRow {
  return {
    outboxId: row.outbox_id,
    missionId: row.mission_id,
    tenantId: row.tenant_id,
    effectKey: row.effect_key,
    payload: parsePayload(row.payload_json),
    status: row.status === 'DELIVERED' ? 'DELIVERED' : 'PENDING',
    attemptCount: row.attempt_count,
    fenceToken: Number(row.fence_token),
    createdAt: new Date(row.created_at).toISOString(),
    deliveredAt: row.delivered_at === null ? null : new Date(row.delivered_at).toISOString(),
  };
}

function assertLease(mission: MissionRow, lease: Lease, now: Date): void {
  if (mission.leaseOwner !== lease.workerId || mission.fenceToken !== lease.fenceToken) throw new Error('stale_fence');
  if (mission.leaseUntil === null || mission.leaseUntil <= now.getTime()) throw new Error('lease_expired');
}

function isRetryableTransactionError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = String((error as { readonly code?: unknown }).code ?? '');
  return code === '40001' || code === '40P01';
}
