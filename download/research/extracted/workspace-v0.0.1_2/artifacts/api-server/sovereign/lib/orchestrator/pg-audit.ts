/**
 * lib/orchestrator/pg-audit.ts — PgAuditStore: PostgreSQL-backed AsyncAuditStore.
 *
 * PURPOSE
 * -------
 * Production-grade audit persistence. Uses DbPool (lib/db/types.ts) so it
 * works identically with:
 *   • InMemoryPool   — tests / local dev (no external Postgres required)
 *   • pg.Pool        — production (swap in at DI / composition root)
 *
 * INVARIANTS (same as InMemoryAuditStore)
 * ----------------------------------------
 * • prevHash of record[i] = hash of record[i-1] (or "genesis" for i=0).
 * • hash = SHA-256( id | tenantId | actionType | outcome | prevHash ).
 * • Chains are per-tenant — NEVER cross-tenant leakage.
 * • tenantId required on every append(); missing → thrown AuditError.
 *
 * MULTI-PROCESS NOTES
 * -------------------
 * InMemoryPool is single-process (JS single-threaded, no races).
 * Real pg.Pool in multi-process deployments: wrap append() in a
 * transaction with SELECT … FOR UPDATE on a per-tenant advisory lock row
 * to prevent concurrent prevHash drift. That SQL is left as a comment
 * below — InMemoryPool does not support FOR UPDATE.
 *
 * SCHEMA
 * ------
 * Table: audit_records
 *   id          TEXT   — UUID (primary identifier)
 *   tenant_id   TEXT   — tenant isolation key
 *   action_id   TEXT   — id of the action that triggered this record
 *   action_type TEXT   — hierarchical action type (e.g. "agent.task.run")
 *   source      TEXT   — actor that produced the action
 *   outcome     TEXT   — "allowed" | "denied" | "error"
 *   reason      TEXT   — nullable; explanation for denied/error
 *   occurred_at TEXT   — ISO-8601 timestamp
 *   prev_hash   TEXT   — hash of previous record ("genesis" if first)
 *   hash        TEXT   — SHA-256 over canonical fields
 *   seq         INTEGER — monotonically increasing per tenant (managed by app)
 *
 * Zero external dependencies — node:crypto + DbPool only.
 */

import { createHash } from "node:crypto";
import type { DbPool } from "../db/types.ts";
import type { AuditId, AuditRecord, AsyncAuditStore, Signer } from "./types.ts";
import { AuditError } from "./audit.ts";

// ─── DDL ─────────────────────────────────────────────────────────────────────

const CREATE_TABLE_SQL = `
  CREATE TABLE audit_records (
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
    signature   TEXT,
    seq         INTEGER
  )
`;

// ─── Hash (same algorithm as InMemoryAuditStore) ──────────────────────────────

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

// ─── Row → AuditRecord ────────────────────────────────────────────────────────

function rowToRecord(row: Record<string, unknown>): AuditRecord {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    actionId: row.action_id as string,
    actionType: row.action_type as string,
    source: row.source as string,
    outcome: row.outcome as AuditRecord["outcome"],
    reason: (row.reason as string | null) ?? undefined,
    occurredAt: row.occurred_at as string,
    prevHash: row.prev_hash as string,
    hash: row.hash as string,
    signature: (row.signature as string | null) ?? undefined,
  };
}

// ─── PgAuditStore ─────────────────────────────────────────────────────────────

/**
 * PgAuditStore — implements AsyncAuditStore on top of a DbPool.
 *
 * Call init() once before first use to ensure the table exists.
 *
 * Usage (InMemoryPool — tests):
 * ```ts
 * const pool = new InMemoryPool();
 * const store = new PgAuditStore(pool);
 * await store.init();
 * const rec = await store.append({ id: uuid(), tenantId: "t1", ... });
 * ```
 *
 * Usage (production — real pg.Pool):
 * ```ts
 * import { Pool } from "pg";
 * const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 * const store = new PgAuditStore(pool as unknown as DbPool);
 * await store.init(); // idempotent — CREATE TABLE IF NOT EXISTS handled by flag
 * ```
 */
export class PgAuditStore implements AsyncAuditStore {
  private readonly pool: DbPool;
  private readonly signer?: Signer;
  private initialised = false;

  constructor(pool: DbPool, signer?: Signer) {
    this.pool = pool;
    this.signer = signer;
  }

  // ── init ──────────────────────────────────────────────────────────────────

  /**
   * Create the audit_records table if it does not already exist.
   * Safe to call multiple times (idempotent — checks initialised flag).
   * For production Postgres, run migrations separately and skip this method.
   */
  async init(): Promise<void> {
    if (this.initialised) return;
    try {
      await this.pool.query(CREATE_TABLE_SQL);
    } catch (err) {
      // If table already exists Postgres throws "already exists" — tolerate.
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("already exists")) throw err;
    }
    this.initialised = true;
  }

  // ── append ────────────────────────────────────────────────────────────────

  /**
   * Append a new record to the tenant's chain.
   *
   * Algorithm:
   *   1. Fetch the most recent record for this tenant (tail) to get prevHash + seq.
   *   2. Compute prevHash (or "genesis" if first) and hash.
   *   3. INSERT the new record.
   *
   * Thread safety:
   *   • In-process (InMemoryPool / single-threaded): no races.
   *   • Multi-process real Postgres: wrap steps 1–3 in a transaction with
   *     SELECT … FOR UPDATE on a per-tenant lock row to serialise appends.
   *     Example (real pg only — InMemoryPool does not support FOR UPDATE):
   *       BEGIN;
   *       SELECT hash, seq FROM audit_records
   *         WHERE tenant_id = $1 ORDER BY seq DESC LIMIT 1 FOR UPDATE;
   *       INSERT INTO audit_records (...) VALUES (...);
   *       COMMIT;
   */
  async append(
    input: Omit<AuditRecord, "hash" | "prevHash">,
  ): Promise<AuditRecord> {
    if (!input.tenantId) {
      throw new AuditError("MISSING_TENANT", "tenantId is required");
    }
    if (!input.actionId) {
      throw new AuditError("MISSING_ACTION", "actionId is required");
    }

    // Step 1: Fetch chain tail for prevHash + next seq.
    const tailResult = await this.pool.query<Record<string, unknown>>(
      "SELECT * FROM audit_records WHERE tenant_id = $1 ORDER BY seq DESC LIMIT 1",
      [input.tenantId],
    );

    const tail = tailResult.rows[0] ?? null;
    const prevHash = tail ? (tail.hash as string) : "genesis";
    const seq = tail ? (tail.seq as number) + 1 : 0;

    // Step 2: Compute hash. Strip any incoming signature — store is source of truth.
    const { signature: _ignored, ...cleanInput } = input as AuditRecord;
    const partial: Omit<AuditRecord, "hash"> = { ...cleanInput, prevHash };
    const hash = computeHash(partial);
    let record: AuditRecord = { ...partial, hash };

    // Step 3: Sign if configured.
    if (this.signer) {
      record = { ...record, signature: this.signer.sign(hash) };
    }

    // Step 4: Insert.
    await this.pool.query(
      `INSERT INTO audit_records
         (id, tenant_id, action_id, action_type, source, outcome, reason,
          occurred_at, prev_hash, hash, signature, seq)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        record.id,
        record.tenantId,
        record.actionId,
        record.actionType,
        record.source,
        record.outcome,
        record.reason ?? null,
        record.occurredAt,
        record.prevHash,
        record.hash,
        record.signature ?? null,
        seq,
      ],
    );

    return record;
  }

  // ── getChain ──────────────────────────────────────────────────────────────

  /**
   * Return all records for a tenant in insertion order (seq ASC).
   * Returns [] if the tenant has no records.
   * NEVER returns records from another tenant.
   */
  async getChain(tenantId: string): Promise<AuditRecord[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      "SELECT * FROM audit_records WHERE tenant_id = $1 ORDER BY seq ASC",
      [tenantId],
    );
    return result.rows.map(rowToRecord);
  }

  // ── verifyChain ───────────────────────────────────────────────────────────

  /**
   * Walk the chain and recompute every hash.
   * Returns true iff the chain is intact (no tampering detected).
   * An empty chain is considered intact.
   *
   * NOTE: For production with millions of records, verifyChain over the full
   * chain is expensive. Implement windowed verification (e.g. last N records)
   * or a periodic background job for scalable integrity checks.
   */
  async verifyChain(tenantId: string): Promise<boolean> {
    const chain = await this.getChain(tenantId);
    if (chain.length === 0) return true;

    for (let i = 0; i < chain.length; i++) {
      const rec = chain[i];

      // Verify prevHash link
      const expectedPrev = i === 0 ? "genesis" : chain[i - 1].hash;
      if (rec.prevHash !== expectedPrev) return false;

      // Recompute hash
      const { hash, signature, ...partial } = rec;
      if (hash !== computeHash(partial)) return false;

      // Verify signature if signer configured
      if (this.signer) {
        if (!signature || !this.signer.verify(hash, signature)) return false;
      }
    }
    return true;
  }

  // ── getRecord ─────────────────────────────────────────────────────────────

  /**
   * Look up a single record by its audit id.
   * Returns null if not found.
   * tenantId is embedded in the record — callers should verify it matches.
   */
  async getRecord(id: AuditId): Promise<AuditRecord | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      "SELECT * FROM audit_records WHERE id = $1 LIMIT 1",
      [id],
    );
    return result.rows.length > 0 ? rowToRecord(result.rows[0]) : null;
  }
}
