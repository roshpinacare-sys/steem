/**
 * lib/track-record/pg-track-record-cache.ts — PgTrackRecordCache: PostgreSQL-backed TrackRecordCache.
 *
 * PURPOSE
 * -------
 * Production-grade persistence for cached track records.
 * Uses DbPool (lib/db/types.ts) so it works identically with:
 *   • InMemoryPool — tests / local dev (no external Postgres required)
 *   • pg.Pool      — production (swap in at composition root)
 *
 * SCHEMA
 * ------
 * Table: track_record_cache
 *   tenant_id       TEXT  — isolation scope
 *   identity_id     TEXT  — cached identity
 *   settled_as_worker INTEGER
 *   settled_as_funder INTEGER
 *   refunded        INTEGER
 *   denied          INTEGER
 *   settled_volume  TEXT  — bigint μ¢ as decimal string
 *   score           INTEGER
 *   explanation     TEXT  — JSON array of explanation strings
 *   computed_at     TEXT  — ISO 8601
 *
 * TENANT ISOLATION
 * ----------------
 * Every query filters by tenant_id. No path returns a record whose tenantId
 * ≠ the requested tenantId.
 */

import type { DbPool } from "../db/types.ts";
import type { TrackRecordCache } from "./track-record-cache.ts";
import type { TrackRecord } from "./track-record.ts";

// ─── DDL ──────────────────────────────────────────────────────────────────────

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS track_record_cache (
    tenant_id         TEXT,
    identity_id       TEXT,
    settled_as_worker INTEGER,
    settled_as_funder INTEGER,
    refunded          INTEGER,
    denied            INTEGER,
    settled_volume    TEXT,
    score             INTEGER,
    explanation       TEXT,
    computed_at       TEXT
  )
`;

// ─── Row shape ────────────────────────────────────────────────────────────────

type TrackRecordRow = {
  tenant_id: string;
  identity_id: string;
  settled_as_worker: number;
  settled_as_funder: number;
  refunded: number;
  denied: number;
  settled_volume: string;
  score: number;
  explanation: string;
  computed_at: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rowToRecord(row: TrackRecordRow): TrackRecord {
  return {
    tenantId: row.tenant_id,
    identityId: row.identity_id,
    settledAsWorker: row.settled_as_worker,
    settledAsFunder: row.settled_as_funder,
    refunded: row.refunded,
    denied: row.denied,
    selfDealing: (row as any).self_dealing ?? 0,
    settledVolume: row.settled_volume,
    score: row.score,
    explanation: JSON.parse(row.explanation) as string[],
    computedAt: row.computed_at,
  };
}

function recordToValues(r: TrackRecord): unknown[] {
  return [
    r.tenantId,
    r.identityId,
    r.settledAsWorker,
    r.settledAsFunder,
    r.refunded,
    r.denied,
    r.settledVolume,
    r.score,
    JSON.stringify(r.explanation),
    r.computedAt,
  ];
}

// ─── PgTrackRecordCache ─────────────────────────────────────────────────────

export class PgTrackRecordCache implements TrackRecordCache {
  private readonly pool: DbPool;
  constructor(pool: DbPool) { this.pool = pool; }

  async init(): Promise<void> {
    await this.pool.query(CREATE_TABLE, []);
  }

  async get(tenantId: string, identityId: string): Promise<TrackRecord | null> {
    if (!tenantId || !identityId) return null;
    const result = await this.pool.query<TrackRecordRow>(
      `SELECT tenant_id, identity_id, settled_as_worker, settled_as_funder,
              refunded, denied, settled_volume, score, explanation, computed_at
       FROM track_record_cache
       WHERE tenant_id = $1 AND identity_id = $2`,
      [tenantId, identityId],
    );
    if (result.rowCount === 0) return null;
    return rowToRecord(result.rows[0] as TrackRecordRow);
  }

  async set(tenantId: string, identityId: string, record: TrackRecord): Promise<void> {
    if (!tenantId || !identityId) return;
    const existing = await this.pool.query<{ tenant_id: string }>(
      "SELECT tenant_id FROM track_record_cache WHERE tenant_id = $1 AND identity_id = $2",
      [tenantId, identityId],
    );
    if (existing.rowCount === 0) {
      await this.pool.query(
        `INSERT INTO track_record_cache
         (tenant_id, identity_id, settled_as_worker, settled_as_funder, refunded, denied,
          settled_volume, score, explanation, computed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        recordToValues(record),
      );
    } else {
      await this.pool.query(
        `UPDATE track_record_cache
         SET settled_as_worker = $3, settled_as_funder = $4, refunded = $5, denied = $6,
             settled_volume = $7, score = $8, explanation = $9, computed_at = $10
         WHERE tenant_id = $1 AND identity_id = $2`,
        recordToValues(record),
      );
    }
  }

  async invalidate(tenantId: string, identityId: string): Promise<void> {
    if (!tenantId || !identityId) return;
    await this.pool.query(
      "DELETE FROM track_record_cache WHERE tenant_id = $1 AND identity_id = $2",
      [tenantId, identityId],
    );
  }

  async invalidateTenant(tenantId: string): Promise<void> {
    if (!tenantId) return;
    await this.pool.query(
      "DELETE FROM track_record_cache WHERE tenant_id = $1",
      [tenantId],
    );
  }
}
