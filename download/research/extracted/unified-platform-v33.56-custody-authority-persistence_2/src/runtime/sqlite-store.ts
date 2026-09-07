import { randomUUID } from 'node:crypto';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { evidenceDigest, validateEvidenceRecord, type EvidenceRecord } from '../contracts/canonical.js';
import { sha256 } from '../contracts/crypto.js';
import type { EffectReceipt, EventRow, Lease, MissionRequest, MissionRow, MissionState, OutboxRow } from './types.js';

interface MissionDatabaseRow {
  mission_id: string;
  tenant_id: string;
  subject_id: string;
  builder_id: string;
  scope: string;
  effect_key: string;
  approval_required: number;
  approval_status: MissionRow['approvalStatus'];
  state: MissionState;
  revision: number;
  lease_owner: string | null;
  lease_until: number | null;
  fence_token: number;
  cancelled: number;
  created_at: string;
  updated_at: string;
}

interface OutboxDatabaseRow {
  outbox_id: string;
  mission_id: string;
  tenant_id: string;
  effect_key: string;
  payload_json: string;
  status: OutboxRow['status'];
  attempt_count: number;
  fence_token: number;
  created_at: string;
  delivered_at: string | null;
}

interface EffectDatabaseRow {
  effect_key: string;
  tenant_id: string;
  payload_digest: string;
  result_json: string;
  applied_at: string;
}

interface EventDatabaseRow {
  sequence: number;
  mission_id: string;
  tenant_id: string;
  event_type: string;
  payload_json: string;
  created_at: string;
  previous_digest: string | null;
  digest: string;
}

interface EvidenceDatabaseRow {
  sequence: number;
  tenant_id: string;
  record_json: string;
  digest: string;
}

export class SqliteRuntimeStore {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.#migrate();
  }

  close(): void {
    this.#db.close();
  }

  createMission(request: MissionRequest, now = new Date()): MissionRow {
    if (request.approvalRequired && request.builderId.trim() === '') throw new Error('builder_required');
    const timestamp = now.toISOString();
    return this.#transaction(() => {
      this.#db.prepare(`
        INSERT INTO missions (
          mission_id, tenant_id, subject_id, builder_id, scope, effect_key,
          approval_required, approval_status, state, revision, fence_token,
          cancelled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CREATED', 0, 0, 0, ?, ?)
      `).run(
        request.missionId,
        request.tenantId,
        request.subjectId,
        request.builderId,
        request.scope,
        request.effectKey,
        request.approvalRequired ? 1 : 0,
        request.approvalRequired ? 'PENDING' : 'NOT_REQUIRED',
        timestamp,
        timestamp,
      );
      this.#appendEventUnsafe(request.missionId, request.tenantId, 'MISSION_CREATED', { scope: request.scope }, timestamp);
      return this.getMission(request.missionId);
    });
  }

  getMission(missionId: string): MissionRow {
    const row = this.#db.prepare('SELECT * FROM missions WHERE mission_id = ?').get(missionId) as MissionDatabaseRow | undefined;
    if (row === undefined) throw new Error('mission_not_found');
    return mapMission(row);
  }

  acquireLease(missionId: string, workerId: string, ttlMs: number, nowMs = Date.now()): Lease {
    if (workerId.trim() === '') throw new Error('worker_required');
    if (!Number.isInteger(ttlMs) || ttlMs <= 0) throw new Error('invalid_lease_ttl');
    return this.#transaction(() => {
      const mission = this.getMission(missionId);
      if (isTerminal(mission.state)) throw new Error('mission_terminal');
      if (mission.leaseUntil !== null && mission.leaseUntil > nowMs && mission.leaseOwner !== workerId) {
        throw new Error('lease_busy');
      }
      const expiresAt = nowMs + ttlMs;
      const changed = this.#db.prepare(`
        UPDATE missions
        SET lease_owner = ?, lease_until = ?, fence_token = fence_token + 1,
            revision = revision + 1, updated_at = ?
        WHERE mission_id = ? AND revision = ?
      `).run(workerId, expiresAt, new Date(nowMs).toISOString(), missionId, mission.revision);
      if (changed.changes !== 1) throw new Error('lease_compare_and_set_failed');
      const updated = this.getMission(missionId);
      this.#appendEventUnsafe(missionId, updated.tenantId, 'LEASE_ACQUIRED', {
        workerId,
        fenceToken: updated.fenceToken,
        expiresAt,
      }, new Date(nowMs).toISOString());
      return { missionId, workerId, fenceToken: updated.fenceToken, expiresAt };
    });
  }

  approveMission(missionId: string, reviewerId: string, expectedRevision: number, now = new Date()): MissionRow {
    if (reviewerId.trim() === '') throw new Error('reviewer_required');
    return this.#transaction(() => {
      const mission = this.getMission(missionId);
      if (mission.builderId === reviewerId) throw new Error('self_approval_forbidden');
      if (!mission.approvalRequired) throw new Error('approval_not_required');
      if (mission.revision !== expectedRevision) throw new Error('revision_conflict');
      if (mission.state === 'CANCELLED') throw new Error('mission_cancelled');
      const changed = this.#db.prepare(`
        UPDATE missions
        SET approval_status = 'APPROVED', state = 'READY', revision = revision + 1,
            lease_owner = NULL, lease_until = NULL, updated_at = ?
        WHERE mission_id = ? AND revision = ? AND approval_status = 'PENDING'
      `).run(now.toISOString(), missionId, expectedRevision);
      if (changed.changes !== 1) throw new Error('approval_compare_and_set_failed');
      this.#appendEventUnsafe(missionId, mission.tenantId, 'MISSION_APPROVED', { reviewerId }, now.toISOString());
      return this.getMission(missionId);
    });
  }

  cancelMission(missionId: string, expectedRevision: number, reason: string, now = new Date()): MissionRow {
    return this.#transaction(() => {
      const mission = this.getMission(missionId);
      if (mission.revision !== expectedRevision) throw new Error('revision_conflict');
      if (mission.state === 'COMPLETED') throw new Error('completed_mission_cannot_cancel');
      const changed = this.#db.prepare(`
        UPDATE missions
        SET state = 'CANCELLED', cancelled = 1, revision = revision + 1,
            lease_owner = NULL, lease_until = NULL, updated_at = ?
        WHERE mission_id = ? AND revision = ?
      `).run(now.toISOString(), missionId, expectedRevision);
      if (changed.changes !== 1) throw new Error('cancel_compare_and_set_failed');
      this.#appendEventUnsafe(missionId, mission.tenantId, 'MISSION_CANCELLED', { reason }, now.toISOString());
      return this.getMission(missionId);
    });
  }

  prepareOutbox(
    lease: Lease,
    payload: Readonly<Record<string, unknown>>,
    nowMs = Date.now(),
  ): OutboxRow | null {
    return this.#transaction(() => {
      const mission = this.#assertLease(lease, nowMs);
      if (mission.cancelled) throw new Error('mission_cancelled');
      if (mission.approvalRequired && mission.approvalStatus !== 'APPROVED') {
        this.#db.prepare(`
          UPDATE missions SET state = 'WAITING_APPROVAL', revision = revision + 1, updated_at = ?
          WHERE mission_id = ? AND fence_token = ?
        `).run(new Date(nowMs).toISOString(), mission.missionId, lease.fenceToken);
        this.#appendEventUnsafe(mission.missionId, mission.tenantId, 'APPROVAL_WAIT', {}, new Date(nowMs).toISOString());
        return null;
      }
      const existing = this.getOutboxByEffectKey(mission.effectKey);
      if (existing !== null) return existing;
      const outboxId = randomUUID();
      const timestamp = new Date(nowMs).toISOString();
      this.#db.prepare(`
        INSERT INTO outbox (
          outbox_id, mission_id, tenant_id, effect_key, payload_json, status,
          attempt_count, fence_token, created_at
        ) VALUES (?, ?, ?, ?, ?, 'PENDING', 0, ?, ?)
      `).run(
        outboxId,
        mission.missionId,
        mission.tenantId,
        mission.effectKey,
        JSON.stringify(payload),
        lease.fenceToken,
        timestamp,
      );
      this.#db.prepare(`
        UPDATE missions SET state = 'EFFECT_PENDING', revision = revision + 1, updated_at = ?
        WHERE mission_id = ? AND fence_token = ?
      `).run(timestamp, mission.missionId, lease.fenceToken);
      this.#appendEventUnsafe(mission.missionId, mission.tenantId, 'OUTBOX_PREPARED', {
        outboxId,
        effectKey: mission.effectKey,
      }, timestamp);
      return this.getOutbox(outboxId);
    });
  }

  getOutbox(outboxId: string): OutboxRow {
    const row = this.#db.prepare('SELECT * FROM outbox WHERE outbox_id = ?').get(outboxId) as OutboxDatabaseRow | undefined;
    if (row === undefined) throw new Error('outbox_not_found');
    return mapOutbox(row);
  }

  getOutboxByEffectKey(effectKey: string): OutboxRow | null {
    const row = this.#db.prepare('SELECT * FROM outbox WHERE effect_key = ?').get(effectKey) as OutboxDatabaseRow | undefined;
    return row === undefined ? null : mapOutbox(row);
  }

  listPendingOutbox(): readonly OutboxRow[] {
    const rows = this.#db.prepare("SELECT * FROM outbox WHERE status = 'PENDING' ORDER BY created_at").all() as unknown as OutboxDatabaseRow[];
    return rows.map(mapOutbox);
  }

  recordEffect(
    outboxId: string,
    lease: Lease,
    result: Readonly<Record<string, unknown>>,
    now = new Date(),
  ): EffectReceipt {
    return this.#transaction(() => {
      const mission = this.#assertLease(lease, now.getTime());
      const outbox = this.getOutbox(outboxId);
      if (outbox.missionId !== mission.missionId || outbox.fenceToken !== lease.fenceToken) throw new Error('stale_fence');
      const payloadDigest = sha256(outbox.payload);
      this.#db.prepare(`
        INSERT OR IGNORE INTO effects (effect_key, tenant_id, payload_digest, result_json, applied_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(outbox.effectKey, outbox.tenantId, payloadDigest, JSON.stringify(result), now.toISOString());
      const receipt = this.getEffect(outbox.effectKey);
      if (receipt.payloadDigest !== payloadDigest) throw new Error('idempotency_payload_conflict');
      this.#db.prepare('UPDATE outbox SET attempt_count = attempt_count + 1 WHERE outbox_id = ?').run(outboxId);
      this.#appendEventUnsafe(mission.missionId, mission.tenantId, 'EFFECT_RECORDED', {
        effectKey: outbox.effectKey,
        resultDigest: sha256(receipt.result),
      }, now.toISOString());
      return receipt;
    });
  }

  getEffect(effectKey: string): EffectReceipt {
    const row = this.#db.prepare('SELECT * FROM effects WHERE effect_key = ?').get(effectKey) as EffectDatabaseRow | undefined;
    if (row === undefined) throw new Error('effect_not_found');
    return {
      effectKey: row.effect_key,
      tenantId: row.tenant_id,
      payloadDigest: row.payload_digest,
      result: JSON.parse(row.result_json) as Record<string, unknown>,
      appliedAt: row.applied_at,
    };
  }

  countEffects(effectKey: string): number {
    const row = this.#db.prepare('SELECT COUNT(*) AS count FROM effects WHERE effect_key = ?').get(effectKey) as { count: number };
    return row.count;
  }

  acknowledgeOutbox(outboxId: string, lease: Lease, now = new Date()): MissionRow {
    return this.#transaction(() => {
      const mission = this.#assertLease(lease, now.getTime());
      const outbox = this.getOutbox(outboxId);
      this.getEffect(outbox.effectKey);
      const changed = this.#db.prepare(`
        UPDATE outbox SET status = 'DELIVERED', delivered_at = ?
        WHERE outbox_id = ? AND status = 'PENDING' AND fence_token = ?
      `).run(now.toISOString(), outboxId, lease.fenceToken);
      if (changed.changes !== 1 && this.getOutbox(outboxId).status !== 'DELIVERED') throw new Error('outbox_ack_failed');
      this.#db.prepare(`
        UPDATE missions SET state = 'COMPLETED', revision = revision + 1,
            lease_owner = NULL, lease_until = NULL, updated_at = ?
        WHERE mission_id = ? AND fence_token = ?
      `).run(now.toISOString(), mission.missionId, lease.fenceToken);
      this.#appendEventUnsafe(mission.missionId, mission.tenantId, 'MISSION_COMPLETED', {
        outboxId,
        effectKey: outbox.effectKey,
      }, now.toISOString());
      return this.getMission(mission.missionId);
    });
  }

  appendEvidence(record: EvidenceRecord): string {
    validateEvidenceRecord(record);
    return this.#transaction(() => {
      const last = this.#db.prepare(
        'SELECT digest FROM evidence WHERE tenant_id = ? ORDER BY sequence DESC LIMIT 1',
      ).get(record.tenantId) as { digest: string } | undefined;
      const normalized: EvidenceRecord = last === undefined
        ? record
        : { ...record, previousDigest: last.digest };
      const digest = evidenceDigest(normalized);
      this.#db.prepare(`
        INSERT INTO evidence (tenant_id, record_json, digest) VALUES (?, ?, ?)
      `).run(normalized.tenantId, JSON.stringify(normalized), digest);
      return digest;
    });
  }

  verifyEvidenceChain(tenantId: string): { ok: boolean; count: number; root: string | null } {
    const rows = this.#db.prepare(
      'SELECT sequence, record_json, digest FROM evidence WHERE tenant_id = ? ORDER BY sequence',
    ).all(tenantId) as unknown as EvidenceDatabaseRow[];
    let previous: string | undefined;
    for (const row of rows) {
      const record = JSON.parse(row.record_json) as EvidenceRecord;
      if (record.previousDigest !== previous) return { ok: false, count: rows.length, root: null };
      if (evidenceDigest(record) !== row.digest) return { ok: false, count: rows.length, root: null };
      previous = row.digest;
    }
    return { ok: true, count: rows.length, root: previous ?? null };
  }

  listEvents(missionId: string): readonly EventRow[] {
    const rows = this.#db.prepare('SELECT * FROM events WHERE mission_id = ? ORDER BY sequence').all(missionId) as unknown as EventDatabaseRow[];
    return rows.map((row) => ({
      sequence: row.sequence,
      missionId: row.mission_id,
      tenantId: row.tenant_id,
      type: row.event_type,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
      createdAt: row.created_at,
      previousDigest: row.previous_digest,
      digest: row.digest,
    }));
  }

  verifyEventChain(missionId: string): { ok: boolean; count: number; root: string | null } {
    const events = this.listEvents(missionId);
    let previous: string | null = null;
    for (const event of events) {
      if (event.previousDigest !== previous) return { ok: false, count: events.length, root: null };
      const expected = eventDigest({
        missionId: event.missionId,
        tenantId: event.tenantId,
        type: event.type,
        payload: event.payload,
        createdAt: event.createdAt,
        previousDigest: event.previousDigest,
      });
      if (expected !== event.digest) return { ok: false, count: events.length, root: null };
      previous = event.digest;
    }
    return { ok: true, count: events.length, root: previous };
  }

  unsafeSqlForTestOnly(sql: string): void {
    if (process.env.NODE_ENV !== 'test') throw new Error('unsafe_sql_test_only');
    this.#db.exec(sql);
  }

  #assertLease(lease: Lease, nowMs: number): MissionRow {
    const mission = this.getMission(lease.missionId);
    if (mission.leaseOwner !== lease.workerId || mission.fenceToken !== lease.fenceToken) throw new Error('stale_fence');
    if (mission.leaseUntil === null || mission.leaseUntil <= nowMs) throw new Error('lease_expired');
    return mission;
  }

  #appendEventUnsafe(
    missionId: string,
    tenantId: string,
    type: string,
    payload: Readonly<Record<string, unknown>>,
    createdAt: string,
  ): void {
    const last = this.#db.prepare(
      'SELECT digest FROM events WHERE mission_id = ? ORDER BY sequence DESC LIMIT 1',
    ).get(missionId) as { digest: string } | undefined;
    const previousDigest = last?.digest ?? null;
    const digest = eventDigest({ missionId, tenantId, type, payload, createdAt, previousDigest });
    this.#db.prepare(`
      INSERT INTO events (mission_id, tenant_id, event_type, payload_json, created_at, previous_digest, digest)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(missionId, tenantId, type, JSON.stringify(payload), createdAt, previousDigest, digest);
  }

  #transaction<T>(fn: () => T): T {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      this.#db.exec('COMMIT');
      return value;
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  #migrate(): void {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS missions (
        mission_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        builder_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        effect_key TEXT NOT NULL UNIQUE,
        approval_required INTEGER NOT NULL,
        approval_status TEXT NOT NULL,
        state TEXT NOT NULL,
        revision INTEGER NOT NULL,
        lease_owner TEXT,
        lease_until INTEGER,
        fence_token INTEGER NOT NULL,
        cancelled INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS outbox (
        outbox_id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL REFERENCES missions(mission_id),
        tenant_id TEXT NOT NULL,
        effect_key TEXT NOT NULL UNIQUE,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt_count INTEGER NOT NULL,
        fence_token INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        delivered_at TEXT
      );
      CREATE TABLE IF NOT EXISTS effects (
        effect_key TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        payload_digest TEXT NOT NULL,
        result_json TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        mission_id TEXT NOT NULL REFERENCES missions(mission_id),
        tenant_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        previous_digest TEXT,
        digest TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS evidence (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        record_json TEXT NOT NULL,
        digest TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_mission ON events(mission_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_evidence_tenant ON evidence(tenant_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status, created_at);
    `);
  }
}

function mapMission(row: MissionDatabaseRow): MissionRow {
  return {
    missionId: row.mission_id,
    tenantId: row.tenant_id,
    subjectId: row.subject_id,
    builderId: row.builder_id,
    scope: row.scope,
    effectKey: row.effect_key,
    approvalRequired: row.approval_required === 1,
    approvalStatus: row.approval_status,
    state: row.state,
    revision: row.revision,
    leaseOwner: row.lease_owner,
    leaseUntil: row.lease_until,
    fenceToken: row.fence_token,
    cancelled: row.cancelled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapOutbox(row: OutboxDatabaseRow): OutboxRow {
  return {
    outboxId: row.outbox_id,
    missionId: row.mission_id,
    tenantId: row.tenant_id,
    effectKey: row.effect_key,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    status: row.status,
    attemptCount: row.attempt_count,
    fenceToken: row.fence_token,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
  };
}

function eventDigest(event: {
  missionId: string;
  tenantId: string;
  type: string;
  payload: Readonly<Record<string, unknown>>;
  createdAt: string;
  previousDigest: string | null;
}): string {
  return sha256(event);
}

function isTerminal(state: MissionState): boolean {
  return state === 'COMPLETED' || state === 'CANCELLED' || state === 'FAILED';
}
