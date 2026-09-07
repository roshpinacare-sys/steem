/**
 * lib/potential/pg-kg-source.ts — PgKnowledgeGraphSource.
 *
 * PostgreSQL-backed implementation of KnowledgeGraphSource.
 * Works identically with:
 *   • InMemoryPool — tests / local dev (no external Postgres required)
 *   • pg.Pool      — production
 *
 * TENANT ISOLATION (invariant)
 * ----------------------------
 * Every query filters by tenant_id. No path returns a KnowledgeSignal whose
 * tenantId ≠ the requested tenantId.
 *
 * SCHEMA
 * ------
 * Table: kg_signals
 *   user_id   TEXT — signal owner
 *   tenant_id TEXT — isolation scope
 *   node_type TEXT — KG node type (e.g. "skill", "achievement", "project")
 *   category  TEXT — strength category (e.g. "technical", "leadership")
 *   weight    TEXT — stored as TEXT for InMemoryPool compat (numeric 0–1)
 *
 * InMemoryPool limitations honoured:
 *   • No COUNT(*), no RETURNING, no ON CONFLICT, no JOIN, no JSONB.
 */

import type { DbPool } from "../db/types.ts";
import type { KnowledgeSignal, KnowledgeGraphSource } from "./types.ts";

// ─── DDL ──────────────────────────────────────────────────────────────────────

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS kg_signals (
    user_id   TEXT,
    tenant_id TEXT,
    node_type TEXT,
    category  TEXT,
    weight    TEXT
  )
`;

// ─── Row shape ────────────────────────────────────────────────────────────────

type KgSignalRow = {
  user_id: string;
  tenant_id: string;
  node_type: string;
  category: string;
  weight: string;
}

// ─── Row ↔ domain conversion ──────────────────────────────────────────────────

function rowToSignal(row: KgSignalRow): KnowledgeSignal {
  let weight = 0;
  try { weight = Number(row.weight); } catch {}
  return {
    userId: row.user_id,
    tenantId: row.tenant_id,
    nodeType: row.node_type,
    category: row.category,
    weight: Math.max(0, Math.min(1, weight)),
  };
}

// ─── Error type ───────────────────────────────────────────────────────────────

export type KgSourceErrorCode =
  | "MISSING_USER_ID"
  | "MISSING_TENANT_ID"
  | "MISSING_NODE_TYPE"
  | "MISSING_CATEGORY";

export class KgSourceError extends Error {
  readonly code: KgSourceErrorCode;
  constructor(code: KgSourceErrorCode, message: string) {
    super(message);
    this.name = "KgSourceError";
    this.code = code;
  }
}

// ─── PgKnowledgeGraphSource ─────────────────────────────────────────────────

export class PgKnowledgeGraphSource implements KnowledgeGraphSource {
  private readonly pool: DbPool;

  constructor(pool: DbPool) {
    this.pool = pool;
  }

  /** Create the kg_signals table. Idempotent — safe to call on every startup. */
  async init(): Promise<void> {
    await this.pool.query(CREATE_TABLE);
  }

  /** Persist a KnowledgeSignal. Validation: userId, tenantId, nodeType, category required. */
  async addSignal(signal: KnowledgeSignal): Promise<void> {
    if (!signal.userId) throw new KgSourceError("MISSING_USER_ID", "userId is required");
    if (!signal.tenantId) throw new KgSourceError("MISSING_TENANT_ID", "tenantId is required");
    if (!signal.nodeType) throw new KgSourceError("MISSING_NODE_TYPE", "nodeType is required");
    if (!signal.category) throw new KgSourceError("MISSING_CATEGORY", "category is required");

    await this.pool.query(
      `INSERT INTO kg_signals (user_id, tenant_id, node_type, category, weight)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        signal.userId,
        signal.tenantId,
        signal.nodeType,
        signal.category,
        String(Math.max(0, Math.min(1, signal.weight))),
      ]
    );
  }

  /** Fetch KnowledgeSignals for a (userId, tenantId). Tenant-scoped SELECT. */
  async fetchSignals(userId: string, tenantId: string): Promise<KnowledgeSignal[]> {
    if (!userId || !tenantId) return [];
    const result = await this.pool.query<KgSignalRow>(
      `SELECT user_id, tenant_id, node_type, category, weight
       FROM kg_signals
       WHERE user_id = $1 AND tenant_id = $2`,
      [userId, tenantId]
    );
    return result.rows.map(rowToSignal);
  }

  /** Remove all signals for a (userId, tenantId). Returns count removed. */
  async clearForUser(userId: string, tenantId: string): Promise<number> {
    if (!userId || !tenantId) return 0;
    const result = await this.pool.query(
      `DELETE FROM kg_signals WHERE user_id = $1 AND tenant_id = $2`,
      [userId, tenantId]
    );
    return result.rowCount ?? 0;
  }

  /** Total signal count for a tenant (for tests / diagnostics). */
  async totalCount(tenantId: string): Promise<number> {
    if (!tenantId) return 0;
    const result = await this.pool.query<KgSignalRow>(
      `SELECT user_id, tenant_id, node_type, category, weight
       FROM kg_signals
       WHERE tenant_id = $1`,
      [tenantId]
    );
    return result.rows.length;
  }
}
