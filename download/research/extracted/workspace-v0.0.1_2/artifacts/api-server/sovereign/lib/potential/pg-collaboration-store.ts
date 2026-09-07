/**
 * lib/potential/pg-collaboration-store.ts — PgCollaborationStore
 *
 * PURPOSE
 * -------
 * Caches the latest top-N CollaborationMatch results per (userId, tenantId).
 * Works identically with:
 *   • InMemoryPool — tests / local dev (no external Postgres required)
 *   • pg.Pool      — production
 *
 * TENANT ISOLATION (invariant)
 * ----------------------------
 * Every query filters by tenant_id. No path returns data whose
 * tenantId ≠ the requested tenantId.
 *
 * KEY
 * ---
 * Natural key: (tenant_id, user_id). One row per user — stores the latest
 * batch of matches. Callers re-POST to refresh.
 *
 * SCHEMA
 * ------
 * Table: collaboration_matches_cache
 *   user_id    TEXT — the user who requested collaboration matches
 *   tenant_id  TEXT — isolation scope
 *   matches    TEXT — JSON-encoded CollaborationMatch[]
 *   updated_at TEXT — ISO timestamp of last save
 *
 * InMemoryPool limitations honoured:
 *   • No COUNT(*), no RETURNING, no ON CONFLICT, no JOIN, no JSONB.
 *   • Upsert: check existence by (user_id, tenant_id) → UPDATE or INSERT.
 *   • totalCount() selects user_id and counts result.rows.length.
 */

import type { DbPool } from "../db/types.ts";
import type { CollaborationMatch } from "./personality-types.ts";

// ─── DDL ──────────────────────────────────────────────────────────────────────

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS collaboration_matches_cache (
    user_id    TEXT,
    tenant_id  TEXT,
    matches    TEXT,
    updated_at TEXT
  )
`;

// ─── Row shape ────────────────────────────────────────────────────────────────

type CacheRow = {
  user_id: string;
  tenant_id: string;
  matches: string;
  updated_at: string;
}

// ─── Row ↔ domain conversion ──────────────────────────────────────────────────

function rowToMatches(row: CacheRow): CollaborationMatch[] {
  try { return JSON.parse(row.matches); } catch { return []; }
}

// ─── Error ────────────────────────────────────────────────────────────────────

export type CollaborationStoreErrorCode =
  | "MISSING_USER_ID"
  | "MISSING_TENANT_ID"
  | "INVALID_MATCHES";

export class CollaborationStoreError extends Error {
  readonly code: CollaborationStoreErrorCode;
  constructor(
    code: CollaborationStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = "CollaborationStoreError";
  }
}

// ─── PgCollaborationStore ─────────────────────────────────────────────────────

/**
 * PgCollaborationStore — implements a per-user cache of CollaborationMatch[]
 * on top of a DbPool.
 *
 * Call init() once at startup to ensure the table exists.
 *
 * Usage (InMemoryPool — tests):
 * ```ts
 * const pool = new InMemoryPool();
 * const store = new PgCollaborationStore(pool);
 * await store.init();
 * await store.save("tenant-1", "user-1", matches);
 * const cached = await store.load("tenant-1", "user-1");
 * ```
 */
export class PgCollaborationStore {
  private readonly pool: DbPool;
  private initialised = false;

  constructor(pool: DbPool) {
    this.pool = pool;
  }

  // ── init ──────────────────────────────────────────────────────────────────

  async init(): Promise<void> {
    if (this.initialised) return;
    try {
      await this.pool.query(CREATE_TABLE);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("already exists")) throw err;
    }
    this.initialised = true;
  }

  // ── save (upsert) ─────────────────────────────────────────────────────────

  /**
   * Save (upsert) the top-N matches for a user.
   * Replaces the entire cached list for (tenantId, userId).
   */
  async save(
    tenantId: string,
    userId: string,
    matches: CollaborationMatch[],
  ): Promise<void> {
    if (!userId) {
      throw new CollaborationStoreError("MISSING_USER_ID", "userId is required");
    }
    if (!tenantId) {
      throw new CollaborationStoreError("MISSING_TENANT_ID", "tenantId is required");
    }
    if (!Array.isArray(matches)) {
      throw new CollaborationStoreError("INVALID_MATCHES", "matches must be an array");
    }

    const matchesJson = JSON.stringify(matches);
    const updatedAt = new Date().toISOString();

    // Upsert: check existence → UPDATE or INSERT (InMemoryPool-safe, no ON CONFLICT)
    const existing = await this.pool.query<{ user_id: string }>(
      `SELECT user_id FROM collaboration_matches_cache WHERE user_id = $1 AND tenant_id = $2`,
      [userId, tenantId],
    );

    if (existing.rows.length > 0) {
      await this.pool.query(
        `UPDATE collaboration_matches_cache
           SET matches = $1, updated_at = $2
         WHERE user_id = $3 AND tenant_id = $4`,
        [matchesJson, updatedAt, userId, tenantId],
      );
    } else {
      await this.pool.query(
        `INSERT INTO collaboration_matches_cache (user_id, tenant_id, matches, updated_at)
         VALUES ($1, $2, $3, $4)`,
        [userId, tenantId, matchesJson, updatedAt],
      );
    }
  }

  // ── load ──────────────────────────────────────────────────────────────────

  /**
   * Load cached matches for (tenantId, userId).
   * Returns null if no cache exists. Cross-tenant: always returns null.
   */
  async load(
    tenantId: string,
    userId: string,
  ): Promise<CollaborationMatch[] | null> {
    if (!tenantId || !userId) return null;

    const result = await this.pool.query<CacheRow>(
      `SELECT * FROM collaboration_matches_cache WHERE user_id = $1 AND tenant_id = $2 LIMIT 1`,
      [userId, tenantId],
    );

    if (result.rows.length === 0) return null;
    return rowToMatches(result.rows[0]);
  }

  // ── delete ────────────────────────────────────────────────────────────────

  /**
   * Delete cached matches for (tenantId, userId).
   * Returns true if a row was deleted, false if not found.
   * Cross-tenant deletes are safe (no-op: WHERE filters prevent leakage).
   */
  async delete(tenantId: string, userId: string): Promise<boolean> {
    if (!tenantId || !userId) return false;

    const before = await this.pool.query<{ user_id: string }>(
      `SELECT user_id FROM collaboration_matches_cache WHERE user_id = $1 AND tenant_id = $2`,
      [userId, tenantId],
    );
    if (before.rows.length === 0) return false;

    await this.pool.query(
      `DELETE FROM collaboration_matches_cache WHERE user_id = $1 AND tenant_id = $2`,
      [userId, tenantId],
    );
    return true;
  }

  // ── totalCount ────────────────────────────────────────────────────────────

  /**
   * Count the number of users with cached matches for a tenant.
   * Uses SELECT user_id (not COUNT(*)) for InMemoryPool compatibility.
   */
  async totalCount(tenantId: string): Promise<number> {
    if (!tenantId) return 0;
    const result = await this.pool.query<{ user_id: string }>(
      `SELECT user_id FROM collaboration_matches_cache WHERE tenant_id = $1`,
      [tenantId],
    );
    return result.rows.length;
  }
}
