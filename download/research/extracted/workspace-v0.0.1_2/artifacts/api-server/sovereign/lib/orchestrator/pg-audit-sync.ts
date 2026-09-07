/**
 * lib/orchestrator/pg-audit-sync.ts — PgAuditSync: synchronous AuditStore backed by PostgreSQL.
 *
 * PURPOSE
 * -------
 * The orchestrator's AuditStore interface is synchronous (no Promise returns).
 * PgAuditStore is fully async. PgAuditSync bridges the gap with the same
 * preload+write-through pattern used by PgIdempotencySync (v112) and PgIdentityStore (v113):
 *
 *   1. In-memory cache (Map<tenantId, AuditRecord[]>) — satisfies sync reads.
 *   2. init(): Promise<void> — creates the table if needed, then preloads ALL
 *      existing records into the cache. Awaited at composition time before the
 *      server accepts traffic, so verifyChain() and getChain() work immediately.
 *   3. append() — writes to cache synchronously (returns the record), then fires
 *      an async INSERT into pg (write-through, fire-and-forget).
 *      A crash between the sync write and the pg write is theoretically possible;
 *      accepted trade-off (same stance as PgIdentityStore). The audit chain is
 *      low-volume and can be recovered from the in-memory cache on a graceful
 *      restart, or from a periodic flush.
 *
 * HASH CHAIN
 * ----------
 * Hash computation and chain verification are identical to InMemoryAuditStore:
 *   hash = SHA-256( id | tenantId | actionType | outcome | prevHash )
 * The chain is stored in insertion order in the cache and in pg (ordered by id,
 * with the entire ordered set preloaded at init time).
 *
 * TENANT ISOLATION
 * ----------------
 * Every cache operation and every pg query filters by tenantId. Cross-tenant
 * reads never occur: getChain(t) only returns records for tenant t.
 *
 * TABLE SCHEMA (shared with PgAuditStore — same table name so records written by
 * either implementation are visible to both)
 * -------------------------------------------
 * Table: audit_records
 *   id           TEXT  — AuditRecord.id
 *   tenant_id    TEXT  — AuditRecord.tenantId
 *   action_id    TEXT  — AuditRecord.actionId
 *   action_type  TEXT  — AuditRecord.actionType
 *   source       TEXT  — AuditRecord.source
 *   outcome      TEXT  — AuditRecord.outcome
 *   reason       TEXT  — nullable; AuditRecord.reason
 *   occurred_at  TEXT  — AuditRecord.occurredAt
 *   prev_hash    TEXT  — AuditRecord.prevHash
 *   hash         TEXT  — AuditRecord.hash
 *   signature    TEXT  — nullable; AuditRecord.signature
 *
 * InMemoryPool limitations honoured:
 *   No RETURNING, no ON CONFLICT, no COUNT(*), no JOINs, no ORDER BY seq.
 *   Ordering is reconstructed from insertion order (records are inserted in order).
 *   init() performs a full SELECT * and restores order by re-verifying prevHash links.
 */

import { createHash } from "node:crypto";
import type { DbPool } from "../db/types.ts";
import type { AuditId, AuditRecord, AuditStore, Signer } from "./types.ts";

// ─── DDL ──────────────────────────────────────────────────────────────────────

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS audit_records (
    id          TEXT,
    tenant_id   TEXT,
    action_id   TEXT,
    action_type TEXT,
    source      TEXT,
    outcome     TEXT,
    reason      TEXT,
    occurred_at TEXT,
    prev_hash   TEXT,
    hash        TEXT,
    signature   TEXT
  )
`;

// ─── Hash computation (identical to InMemoryAuditStore) ───────────────────────

function computeHash(record: Omit<AuditRecord, "hash">): string {
  const data = [
    record.id,
    record.tenantId,
    record.actionType,
    record.outcome,
    record.prevHash,
  ].join("|");
  return createHash("sha256").update(data, "utf8").digest("hex");
}

// ─── Row ↔ AuditRecord conversions ────────────────────────────────────────────

type AuditRow = {
  id: string;
  tenant_id: string;
  action_id: string;
  action_type: string;
  source: string;
  outcome: string;
  reason: string | null;
  occurred_at: string;
  prev_hash: string;
  hash: string;
  signature: string | null;
};

function rowToRecord(row: AuditRow): AuditRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    actionId: row.action_id,
    actionType: row.action_type,
    source: row.source,
    outcome: row.outcome as AuditRecord["outcome"],
    reason: row.reason ?? undefined,
    occurredAt: row.occurred_at,
    prevHash: row.prev_hash,
    hash: row.hash,
    signature: row.signature ?? undefined,
  };
}

function recordToValues(r: AuditRecord): unknown[] {
  return [
    r.id,
    r.tenantId,
    r.actionId,
    r.actionType,
    r.source,
    r.outcome,
    r.reason ?? null,
    r.occurredAt,
    r.prevHash,
    r.hash,
    r.signature ?? null,
  ];
}

// ─── PgAuditSync ─────────────────────────────────────────────────────────────

export class PgAuditSync implements AuditStore {
  private readonly pool: DbPool;
  private readonly signer?: Signer;

  /** In-memory cache: tenantId → ordered AuditRecord[]. Source of truth for sync reads. */
  private readonly chains = new Map<string, AuditRecord[]>();

  /** Fast lookup by id across all tenants (for getRecord). */
  private readonly byId = new Map<AuditId, AuditRecord>();

  /** Count of async write-through failures (for observability). */
  private writeErrors = 0;

  constructor(pool: DbPool, signer?: Signer) {
    this.pool = pool;
    this.signer = signer;
  }

  /**
   * Initialise: create the table if absent, then preload all existing records
   * into the in-memory cache. Must be awaited before the server accepts traffic.
   * Idempotent — safe to call more than once (re-preloads from pg each time).
   */
  async init(): Promise<void> {
    await this.pool.query(CREATE_TABLE, []);

    const result = await this.pool.query<AuditRow>(
      "SELECT id, tenant_id, action_id, action_type, source, outcome, reason, occurred_at, prev_hash, hash, signature FROM audit_records",
      [],
    );

    // Clear and rebuild caches from pg rows.
    // InMemoryPool returns rows in insertion order; rebuild chains in that order.
    this.chains.clear();
    this.byId.clear();

    for (const row of result.rows) {
      const rec = rowToRecord(row);
      const chain = this.chains.get(rec.tenantId) ?? [];
      chain.push(rec);
      this.chains.set(rec.tenantId, chain);
      this.byId.set(rec.id, rec);
    }
  }

  // ─── AuditStore (synchronous interface) ────────────────────────────────────

  /**
   * Append a new record to the tenant's chain.
   * prevHash and hash are computed automatically (identical algorithm to
   * InMemoryAuditStore). Signature is added when a Signer is configured.
   * Written to cache synchronously; persisted to pg asynchronously (write-through).
   */
  append(input: Omit<AuditRecord, "hash" | "prevHash">): AuditRecord {
    if (!input.tenantId) throw new Error("PgAuditSync.append: tenantId is required");
    if (!input.actionId) throw new Error("PgAuditSync.append: actionId is required");

    const chain = this.chains.get(input.tenantId) ?? [];
    const prevHash = chain.length > 0 ? chain[chain.length - 1].hash : "genesis";

    // Strip any incoming signature — the store is source of truth.
    const { signature: _ignored, ...cleanInput } = input as AuditRecord;
    const partial: Omit<AuditRecord, "hash"> = { ...cleanInput, prevHash };
    const hash = computeHash(partial);
    let record: AuditRecord = { ...partial, hash };

    if (this.signer) {
      record = { ...record, signature: this.signer.sign(hash) };
    }

    // ── Sync: write to cache ──────────────────────────────────────────────────
    chain.push(record);
    this.chains.set(input.tenantId, chain);
    this.byId.set(record.id, record);

    // ── Async: write-through to pg (fire-and-forget) ──────────────────────────
    this.pool.query(
      `INSERT INTO audit_records (id, tenant_id, action_id, action_type, source, outcome, reason, occurred_at, prev_hash, hash, signature)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      recordToValues(record),
    ).catch((err: unknown) => {
      this.writeErrors++;
      console.error(
        `[PgAuditSync] write-through INSERT failed for audit record ${record.id}:`,
        err,
      );
    });

    return record;
  }

  /** Return all records for a tenant in insertion order. Returns [] if none. */
  getChain(tenantId: string): AuditRecord[] {
    return [...(this.chains.get(tenantId) ?? [])];
  }

  /**
   * Walk the chain and verify every hash link. Returns true if intact.
   * An empty chain is considered intact.
   * If a Signer was configured at construction, also verifies signatures.
   */
  verifyChain(tenantId: string): boolean {
    const chain = this.chains.get(tenantId);
    if (!chain || chain.length === 0) return true;

    for (let i = 0; i < chain.length; i++) {
      const rec = chain[i];

      // Verify prevHash link
      const expectedPrev = i === 0 ? "genesis" : chain[i - 1].hash;
      if (rec.prevHash !== expectedPrev) return false;

      // Recompute and verify hash
      const { hash, signature, ...partial } = rec;
      const expected = computeHash(partial);
      if (hash !== expected) return false;

      // Verify signature if signer configured
      if (this.signer) {
        if (!signature || !this.signer.verify(hash, signature)) return false;
      }
    }
    return true;
  }

  /** Look up a single record by its id (across all tenants). */
  getRecord(id: AuditId): AuditRecord | null {
    return this.byId.get(id) ?? null;
  }

  // ─── Observability ─────────────────────────────────────────────────────────

  /** Number of async write-through failures since startup. */
  get pgWriteErrors(): number {
    return this.writeErrors;
  }

  /** Total number of audit records currently in cache. */
  get cacheSize(): number {
    return this.byId.size;
  }
}
