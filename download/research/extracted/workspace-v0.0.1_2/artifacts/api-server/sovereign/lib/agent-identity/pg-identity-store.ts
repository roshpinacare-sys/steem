/**
 * lib/agent-identity/pg-identity-store.ts — PgIdentityStore: PostgreSQL-backed IdentityStore.
 *
 * PURPOSE
 * -------
 * Production-grade persistence for AgentIdentity records.
 * Implements the IdentityStore interface (lib/agent-identity/types.ts) using DbPool
 * (lib/db/types.ts), so it works identically with:
 *   • InMemoryPool — tests / local dev (no external Postgres required)
 *   • pg.Pool      — production (swap in at composition root)
 *
 * SYNC FACADE PATTERN
 * -------------------
 * IdentityStore methods are synchronous (no Promise return type). The orchestrator
 * calls requireValidDelegation(identities) synchronously at policy-evaluation time.
 * To satisfy both the sync interface AND durable persistence we use:
 *
 *   1. In-memory cache (Map<id, AgentIdentity>) — satisfies sync reads.
 *   2. init(): Promise<void> — preloads the full table into the cache on startup.
 *      Called once at composition time (awaited before the server accepts traffic).
 *   3. create() — writes to cache first (sync, returns immediately), then fires
 *      an async pg INSERT in the background (write-through fire-and-forget).
 *      A crash between the sync write and the pg write is theoretically possible;
 *      the trade-off is identical to PgIdempotencyStore (v112) and accepted for now
 *      (identity records are low-volume and re-creatable on restart via init preload).
 *
 * TENANT ISOLATION (invariant)
 * ----------------------------
 * Every query filters by tenant_id. getByTenant() never returns identities from
 * other tenants. getById() does NOT filter by tenant — callers are responsible
 * (consistent with InMemoryIdentityStore behaviour; delegation chain validation
 * checks tenantId match explicitly).
 *
 * SCHEMA
 * ------
 * Table: agent_identities
 *   id          TEXT  — unique identity id (uuid-style)
 *   tenant_id   TEXT  — isolation scope
 *   type        TEXT  — "human" | "agent" | "sub-agent"
 *   public_key  TEXT  — nullable; Ed25519 public key
 *   parent_id   TEXT  — nullable; delegation parent
 *   created_at  TEXT  — ISO-8601 timestamp
 *   metadata    TEXT  — nullable; JSON-encoded Record<string,unknown>
 *
 * InMemoryPool limitations honoured:
 *   • No RETURNING, no ON CONFLICT, no COUNT(*), no JOINs, no JSONB.
 *   • No UPDATE (identities are immutable after creation).
 *   • init() uses a full SELECT * and builds the in-memory cache.
 *   • put() = INSERT only (duplicate detection happens before, in create(), via cache).
 */

import type { DbPool } from "../db/types.ts";
import type { IdentityStore, AgentIdentity, AgentType } from "./types.ts";
import { IdentityError } from "./types.ts";

// ─── DDL ──────────────────────────────────────────────────────────────────────

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS agent_identities (
    id         TEXT,
    tenant_id  TEXT,
    type       TEXT,
    public_key TEXT,
    parent_id  TEXT,
    created_at TEXT,
    metadata   TEXT
  )
`;

// ─── Row shape ────────────────────────────────────────────────────────────────

type IdentityRow = {
  id: string;
  tenant_id: string;
  type: string;
  public_key: string | null;
  parent_id: string | null;
  created_at: string;
  metadata: string | null;
};

// ─── Conversions ─────────────────────────────────────────────────────────────

function rowToIdentity(row: IdentityRow): AgentIdentity {
  let metadata: Record<string, unknown> | undefined;
  if (row.metadata) {
    try { metadata = JSON.parse(row.metadata); } catch { metadata = undefined; }
  }
  return {
    id: row.id,
    tenantId: row.tenant_id,
    type: row.type as AgentType,
    publicKey: row.public_key ?? undefined,
    parentId: row.parent_id ?? null,
    createdAt: row.created_at,
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

function identityToValues(id: AgentIdentity): unknown[] {
  return [
    id.id,
    id.tenantId,
    id.type,
    id.publicKey ?? null,
    id.parentId ?? null,
    id.createdAt,
    id.metadata !== undefined ? JSON.stringify(id.metadata) : null,
  ];
}

// ─── PgIdentityStore ─────────────────────────────────────────────────────────

export class PgIdentityStore implements IdentityStore {
  private readonly pool: DbPool;
  /** In-memory cache — source of truth for sync reads. Populated by init(). */
  private readonly cache = new Map<string, AgentIdentity>();
  /** Track async write failures for observability (non-fatal). */
  private writeErrors = 0;

  constructor(pool: DbPool) {
    this.pool = pool;
  }

  /**
   * Initialise the store: create the table if absent, then preload all
   * existing rows into the in-memory cache.
   *
   * Must be awaited before the server accepts traffic so that
   * requireValidDelegation() can resolve existing chains synchronously.
   */
  async init(): Promise<void> {
    await this.pool.query(CREATE_TABLE, []);
    const result = await this.pool.query<IdentityRow>(
      "SELECT id, tenant_id, type, public_key, parent_id, created_at, metadata FROM agent_identities",
      [],
    );
    for (const row of result.rows) {
      this.cache.set(row.id, rowToIdentity(row));
    }
  }

  // ─── IdentityStore (synchronous interface) ──────────────────────────────────

  /**
   * Register a new identity.
   *
   * Validation is identical to InMemoryIdentityStore:
   *   • human  → parentId must be null
   *   • agent  → parentId must be a human in the same tenant
   *   • sub-agent → parentId must be an agent or sub-agent in the same tenant
   *
   * On success: written to cache immediately, queued to pg async (write-through).
   * Throws IdentityError on rule violations (before any write occurs).
   */
  create(identity: AgentIdentity): AgentIdentity {
    // ── Duplicate check ───────────────────────────────────────────────────────
    if (this.cache.has(identity.id)) {
      throw new IdentityError(
        `Identity already exists: ${identity.id}`,
        "duplicate_id",
      );
    }

    // ── Human must be root ────────────────────────────────────────────────────
    if (identity.type === "human" && identity.parentId !== null) {
      throw new IdentityError(
        `Human identity must not have a parent: ${identity.id}`,
        "human_with_parent",
      );
    }

    // ── Agent must delegate from a human ─────────────────────────────────────
    if (identity.type === "agent") {
      if (!identity.parentId) {
        throw new IdentityError(
          `Agent must have a human parent: ${identity.id}`,
          "agent_without_human_parent",
        );
      }
      const parent = this.cache.get(identity.parentId);
      if (!parent) {
        throw new IdentityError(
          `Parent not found for agent: ${identity.parentId}`,
          "parent_not_found",
        );
      }
      if (parent.type !== "human") {
        throw new IdentityError(
          `Agent parent must be human: ${identity.parentId}`,
          "parent_not_found",
        );
      }
      if (parent.tenantId !== identity.tenantId) {
        throw new IdentityError(
          `Parent tenant mismatch: ${identity.parentId}`,
          "parent_wrong_tenant",
        );
      }
    }

    // ── Sub-agent must have a parent (agent or sub-agent) ─────────────────────
    if (identity.type === "sub-agent") {
      if (!identity.parentId) {
        throw new IdentityError(
          `Sub-agent must have a parent: ${identity.id}`,
          "subagent_without_parent",
        );
      }
      const parent = this.cache.get(identity.parentId);
      if (!parent) {
        throw new IdentityError(
          `Parent not found for sub-agent: ${identity.parentId}`,
          "parent_not_found",
        );
      }
      if (parent.tenantId !== identity.tenantId) {
        throw new IdentityError(
          `Parent tenant mismatch: ${identity.parentId}`,
          "parent_wrong_tenant",
        );
      }
    }

    // ── Write to cache synchronously ──────────────────────────────────────────
    this.cache.set(identity.id, identity);

    // ── Write-through to pg (async, fire-and-forget) ─────────────────────────
    this.pool.query(
      `INSERT INTO agent_identities (id, tenant_id, type, public_key, parent_id, created_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      identityToValues(identity),
    ).catch((err: unknown) => {
      this.writeErrors++;
      // Non-fatal: identity is already in cache. Log and continue.
      console.error(
        `[PgIdentityStore] write-through INSERT failed for ${identity.id}:`,
        err,
      );
    });

    return identity;
  }

  /** Fetch a single identity by id. null if not found. O(1) cache lookup. */
  getById(id: string): AgentIdentity | null {
    return this.cache.get(id) ?? null;
  }

  /** All identities for a tenant (no specific order). Filters by tenantId. */
  getByTenant(tenantId: string): AgentIdentity[] {
    const out: AgentIdentity[] = [];
    for (const identity of this.cache.values()) {
      if (identity.tenantId === tenantId) out.push(identity);
    }
    return out;
  }

  // ─── Observability ───────────────────────────────────────────────────────────

  /** Number of async write failures since startup (for health checks). */
  get pgWriteErrors(): number {
    return this.writeErrors;
  }

  /** Number of identities currently in the in-memory cache. */
  get cacheSize(): number {
    return this.cache.size;
  }
}
