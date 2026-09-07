/**
 * lib/introduction/pg-introduction-store.ts — PostgreSQL-backed IntroductionStore.
 *
 * PURPOSE
 * -------
 * Production-grade persistence for cross-tenant introduction requests.
 * Implements the IntroductionStore interface using DbPool,
 * so it works with both InMemoryPool (tests) and pg.Pool (production).
 *
 * TENANT ISOLATION (invariant)
 * ----------------------------
 * Every query filters by tenant_id. Cross-tenant get() → null.
 *
 * SCHEMA
 * ------
 * Table: introduction_requests
 *   id                      TEXT — UUID, primary key within tenant
 *   source_tenant_id        TEXT — isolation scope (outbox owner)
 *   target_tenant_id        TEXT — isolation scope (inbox owner)
 *   proof_target_kind       TEXT — "track-record" | "passport"
 *   proof_target_identity_id TEXT — identity identifier
 *   signature               TEXT — kernel signer signature
 *   created_at              TEXT — ISO 8601
 *
 * InMemoryPool limitations honoured:
 *   • No RETURNING, no ON CONFLICT, no COUNT(*), no JSONB.
 *   • save() = INSERT only (append-only); duplicate id → overwrite via check-then-replace.
 */

import type { DbPool } from "../db/types.ts";
import type { IntroductionRequest, IntroductionStore } from "./types.ts";

// ─── DDL ──────────────────────────────────────────────────────────────────────

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS introduction_requests (
    id                       TEXT,
    source_tenant_id         TEXT,
    target_tenant_id         TEXT,
    proof_target_kind        TEXT,
    proof_target_identity_id TEXT,
    signature                TEXT,
    created_at               TEXT
  )
`;

// ─── Row shape ────────────────────────────────────────────────────────────────

type IntroductionRow = {
  id: string;
  source_tenant_id: string;
  target_tenant_id: string;
  proof_target_kind: string;
  proof_target_identity_id: string;
  signature: string;
  created_at: string;
};

// ─── Row ↔ domain conversion ──────────────────────────────────────────────────

function rowToRequest(row: IntroductionRow): IntroductionRequest {
  return {
    id: row.id,
    sourceTenantId: row.source_tenant_id,
    targetTenantId: row.target_tenant_id,
    proofTarget: {
      kind: row.proof_target_kind as "track-record" | "passport",
      identityId: row.proof_target_identity_id,
    },
    signature: row.signature,
    createdAt: row.created_at,
  };
}

// ─── PgIntroductionStore ────────────────────────────────────────────────────────

export class PgIntroductionStore implements IntroductionStore {
  private readonly pool: DbPool;
  private initialised = false;

  constructor(pool: DbPool) {
    this.pool = pool;
  }

  /** Idempotent schema creation — safe to call multiple times. */
  async init(): Promise<void> {
    if (this.initialised) return;
    await this.pool.query(CREATE_TABLE);
    this.initialised = true;
  }

  async save(req: IntroductionRequest): Promise<void> {
    await this.init();

    // Check for existing row (check-then-replace for InMemoryPool compatibility)
    const existing = await this.pool.query<IntroductionRow>(
      "SELECT id FROM introduction_requests WHERE source_tenant_id = $1 AND id = $2",
      [req.sourceTenantId, req.id],
    );

    if (existing.rows.length === 0) {
      await this.pool.query(
        `INSERT INTO introduction_requests
           (id, source_tenant_id, target_tenant_id, proof_target_kind, proof_target_identity_id, signature, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          req.id,
          req.sourceTenantId,
          req.targetTenantId,
          req.proofTarget.kind,
          req.proofTarget.identityId,
          req.signature,
          req.createdAt,
        ],
      );
    } else {
      await this.pool.query(
        `UPDATE introduction_requests
            SET target_tenant_id = $1, proof_target_kind = $2, proof_target_identity_id = $3, signature = $4, created_at = $5
          WHERE source_tenant_id = $6 AND id = $7`,
        [
          req.targetTenantId,
          req.proofTarget.kind,
          req.proofTarget.identityId,
          req.signature,
          req.createdAt,
          req.sourceTenantId,
          req.id,
        ],
      );
    }
  }

  async list(tenantId: string): Promise<IntroductionRequest[]> {
    await this.init();
    const result = await this.pool.query<IntroductionRow>(
      "SELECT id, source_tenant_id, target_tenant_id, proof_target_kind, proof_target_identity_id, signature, created_at FROM introduction_requests WHERE source_tenant_id = $1",
      [tenantId],
    );
    return result.rows.map(rowToRequest);
  }

  async get(id: string, tenantId: string): Promise<IntroductionRequest | null> {
    await this.init();
    const result = await this.pool.query<IntroductionRow>(
      "SELECT id, source_tenant_id, target_tenant_id, proof_target_kind, proof_target_identity_id, signature, created_at FROM introduction_requests WHERE source_tenant_id = $1 AND id = $2",
      [tenantId, id],
    );
    if (result.rows.length === 0) return null;
    return rowToRequest(result.rows[0]);
  }

  async listForTarget(tenantId: string): Promise<IntroductionRequest[]> {
    await this.init();
    const result = await this.pool.query<IntroductionRow>(
      "SELECT id, source_tenant_id, target_tenant_id, proof_target_kind, proof_target_identity_id, signature, created_at FROM introduction_requests WHERE target_tenant_id = $1",
      [tenantId],
    );
    return result.rows.map(rowToRequest);
  }

  async getWithAccess(id: string, tenantId: string): Promise<IntroductionRequest | null> {
    await this.init();
    const result = await this.pool.query<IntroductionRow>(
      "SELECT id, source_tenant_id, target_tenant_id, proof_target_kind, proof_target_identity_id, signature, created_at FROM introduction_requests WHERE id = $1 AND (source_tenant_id = $2 OR target_tenant_id = $2)",
      [id, tenantId],
    );
    if (result.rows.length === 0) return null;
    return rowToRequest(result.rows[0]);
  }
}
