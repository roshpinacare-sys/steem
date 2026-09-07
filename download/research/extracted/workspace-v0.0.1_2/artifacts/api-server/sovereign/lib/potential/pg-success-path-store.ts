/**
 * lib/potential/pg-success-path-store.ts — PgSuccessPathStore
 *
 * PURPOSE
 * -------
 * Persists and retrieves SuccessPath objects (computed learning paths) in a
 * PostgreSQL table. Works identically with:
 *   • InMemoryPool — tests / local dev (no external Postgres required)
 *   • pg.Pool      — production
 *
 * TENANT ISOLATION (invariant)
 * ----------------------------
 * Every query filters by tenant_id. No path returns a SuccessPath whose
 * tenantId ≠ the requested tenantId.
 *
 * KEY
 * ---
 * The natural key is (tenant_id, user_id, target_opportunity_id). The latest
 * path computed for a given (user, opportunity) replaces the previous one —
 * callers re-POST to refresh.
 *
 * SCHEMA
 * ------
 * Table: success_paths
 *   id                    TEXT — UUID, set by SuccessPathRouter
 *   user_id               TEXT
 *   tenant_id             TEXT
 *   target_opportunity_id TEXT
 *   current_fit_score     TEXT — stored as TEXT for InMemoryPool compat (numeric in PG)
 *   projected_fit_score   TEXT
 *   steps                 TEXT — JSON-encoded LearningStep[]
 *   total_hours           TEXT — stored as TEXT
 *   created_at            TEXT — ISO timestamp
 *
 * InMemoryPool limitations honoured:
 *   • No COUNT(*), no RETURNING, no ON CONFLICT, no JOIN, no JSONB.
 *   • Upsert: check existence by (user_id, tenant_id, target_opportunity_id)
 *     → UPDATE or INSERT.
 */

import type { DbPool } from "../db/types.ts";
import type { SuccessPath, LearningStep } from "./personality-types.ts";

// ─── DDL ──────────────────────────────────────────────────────────────────────

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS success_paths (
    id                    TEXT,
    user_id               TEXT,
    tenant_id             TEXT,
    target_opportunity_id TEXT,
    current_fit_score     TEXT,
    projected_fit_score   TEXT,
    steps                 TEXT,
    total_hours           TEXT,
    created_at            TEXT
  )
`;

// ─── Row shape ────────────────────────────────────────────────────────────────

type SuccessPathRow = {
  id: string;
  user_id: string;
  tenant_id: string;
  target_opportunity_id: string;
  current_fit_score: string;
  projected_fit_score: string;
  steps: string;
  total_hours: string;
  created_at: string;
}

// ─── Row ↔ domain conversion ──────────────────────────────────────────────────

function rowToPath(row: SuccessPathRow): SuccessPath {
  let steps: LearningStep[] = [];
  try { steps = JSON.parse(row.steps); } catch {}
  return {
    id: row.id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    targetOpportunityId: row.target_opportunity_id,
    currentFitScore: Number(row.current_fit_score),
    projectedFitScore: Number(row.projected_fit_score),
    steps,
    totalHours: Number(row.total_hours),
    createdAt: row.created_at,
  };
}

// ─── Error type ───────────────────────────────────────────────────────────────

export type SuccessPathStoreErrorCode =
  | "MISSING_USER_ID"
  | "MISSING_TENANT_ID"
  | "MISSING_OPPORTUNITY_ID"
  | "MISSING_PATH_ID";

export class SuccessPathStoreError extends Error {
  readonly code: SuccessPathStoreErrorCode;
  constructor(code: SuccessPathStoreErrorCode, message: string) {
    super(message);
    this.name = "SuccessPathStoreError";
    this.code = code;
  }
}

// ─── PgSuccessPathStore ───────────────────────────────────────────────────────

/**
 * PgSuccessPathStore — save and load SuccessPath objects in PostgreSQL (or InMemoryPool).
 *
 * Usage:
 *   const store = new PgSuccessPathStore(pool);
 *   await store.init();                              // idempotent — call once on startup
 *   await store.save(path);                          // upsert by (user, tenant, opportunity)
 *   const p = await store.load(tenantId, userId, opportunityId);  // null if not found
 *   const all = await store.listByUser(tenantId, userId);         // all paths for user
 *   await store.delete(tenantId, userId, opportunityId);           // false if not found
 *   const n = await store.totalCount(tenantId);                   // count for tenant
 */
export class PgSuccessPathStore {
  private readonly pool: DbPool;
  constructor(pool: DbPool) {
    this.pool = pool;
  }

  // ─── init ─────────────────────────────────────────────────────────────────

  /** Create the success_paths table. Idempotent — safe to call on every startup. */
  async init(): Promise<void> {
    await this.pool.query(CREATE_TABLE);
  }

  // ─── save (upsert) ────────────────────────────────────────────────────────

  /**
   * Persist a SuccessPath. Upserts by (userId, tenantId, targetOpportunityId):
   * if a path already exists for this (user, tenant, opportunity), it is replaced
   * by the new one (re-compute = refresh).
   *
   * Validation:
   *   - userId, tenantId, targetOpportunityId, id are required (non-empty).
   */
  async save(path: SuccessPath): Promise<void> {
    if (!path.userId) throw new SuccessPathStoreError("MISSING_USER_ID", "userId is required");
    if (!path.tenantId) throw new SuccessPathStoreError("MISSING_TENANT_ID", "tenantId is required");
    if (!path.targetOpportunityId) throw new SuccessPathStoreError("MISSING_OPPORTUNITY_ID", "targetOpportunityId is required");
    if (!path.id) throw new SuccessPathStoreError("MISSING_PATH_ID", "id is required");

    const stepsJson = JSON.stringify(path.steps ?? []);
    const createdAt = path.createdAt ?? new Date().toISOString();

    const existing = await this.pool.query<{ id: string }>(
      `SELECT id FROM success_paths WHERE user_id = $1 AND tenant_id = $2 AND target_opportunity_id = $3`,
      [path.userId, path.tenantId, path.targetOpportunityId]
    );
    if (existing.rows.length > 0) {
      await this.pool.query(
        `UPDATE success_paths
           SET id = $1, current_fit_score = $2, projected_fit_score = $3, steps = $4, total_hours = $5, created_at = $6
         WHERE user_id = $7 AND tenant_id = $8 AND target_opportunity_id = $9`,
        [
          path.id,
          String(path.currentFitScore ?? 0),
          String(path.projectedFitScore ?? 0),
          stepsJson,
          String(path.totalHours ?? 0),
          createdAt,
          path.userId, path.tenantId, path.targetOpportunityId,
        ]
      );
    } else {
      await this.pool.query(
        `INSERT INTO success_paths
           (id, user_id, tenant_id, target_opportunity_id, current_fit_score, projected_fit_score, steps, total_hours, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          path.id,
          path.userId,
          path.tenantId,
          path.targetOpportunityId,
          String(path.currentFitScore ?? 0),
          String(path.projectedFitScore ?? 0),
          stepsJson,
          String(path.totalHours ?? 0),
          createdAt,
        ]
      );
    }
  }

  // ─── load ─────────────────────────────────────────────────────────────────

  /**
   * Load a SuccessPath by (tenantId, userId, targetOpportunityId).
   * Returns null if not found. Cross-tenant always returns null (tenant-scoped SELECT).
   */
  async load(tenantId: string, userId: string, targetOpportunityId: string): Promise<SuccessPath | null> {
    if (!tenantId || !userId || !targetOpportunityId) return null;
    const result = await this.pool.query<SuccessPathRow>(
      `SELECT id, user_id, tenant_id, target_opportunity_id, current_fit_score, projected_fit_score, steps, total_hours, created_at
       FROM success_paths
       WHERE user_id = $1 AND tenant_id = $2 AND target_opportunity_id = $3`,
      [userId, tenantId, targetOpportunityId]
    );
    return result.rows.length > 0 ? rowToPath(result.rows[0]) : null;
  }

  // ─── listByUser ───────────────────────────────────────────────────────────

  /**
   * List all SuccessPaths for a (tenantId, userId).
   * Returns [] if none found or if inputs are empty.
   */
  async listByUser(tenantId: string, userId: string): Promise<SuccessPath[]> {
    if (!tenantId || !userId) return [];
    const result = await this.pool.query<SuccessPathRow>(
      `SELECT id, user_id, tenant_id, target_opportunity_id, current_fit_score, projected_fit_score, steps, total_hours, created_at
       FROM success_paths
       WHERE user_id = $1 AND tenant_id = $2`,
      [userId, tenantId]
    );
    return result.rows.map(rowToPath);
  }

  // ─── delete ───────────────────────────────────────────────────────────────

  /**
   * Delete a SuccessPath by (tenantId, userId, targetOpportunityId).
   * Returns true if deleted, false if not found.
   * Cross-tenant: returns false without touching data.
   */
  async delete(tenantId: string, userId: string, targetOpportunityId: string): Promise<boolean> {
    if (!tenantId || !userId || !targetOpportunityId) return false;
    const existing = await this.pool.query<{ id: string }>(
      `SELECT id FROM success_paths WHERE user_id = $1 AND tenant_id = $2 AND target_opportunity_id = $3`,
      [userId, tenantId, targetOpportunityId]
    );
    if (existing.rows.length === 0) return false;
    await this.pool.query(
      `DELETE FROM success_paths WHERE user_id = $1 AND tenant_id = $2 AND target_opportunity_id = $3`,
      [userId, tenantId, targetOpportunityId]
    );
    return true;
  }

  // ─── totalCount ───────────────────────────────────────────────────────────

  /**
   * Count stored paths for a tenant.
   * Uses SELECT id (not COUNT(*)) for InMemoryPool compatibility.
   */
  async totalCount(tenantId: string): Promise<number> {
    if (!tenantId) return 0;
    const result = await this.pool.query<{ id: string }>(
      `SELECT id FROM success_paths WHERE tenant_id = $1`,
      [tenantId]
    );
    return result.rows.length;
  }
}
