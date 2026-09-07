/**
 * src/http/pg-idempotency-store.ts — PgIdempotencyStore: PostgreSQL-backed IdempotencyStore.
 *
 * PURPOSE
 * -------
 * v111 added Idempotency-Key support (Stripe-style) but only InMemoryIdempotencyStore —
 * the dedup map resets on restart, so a crash-then-retry right after a crash could
 * double-execute a money-moving request. This is sub-step 1 of J1 (Persist-everything):
 * the idempotency record IS a trust primitive ("did this exact request already run?")
 * and must survive a restart, same as audit/escrow/track-record.
 *
 * Implements the IdempotencyStore interface (src/http/idempotency.ts) using DbPool, so it
 * works identically with InMemoryPool (tests/dev) and pg.Pool (production).
 *
 * TENANT ISOLATION (invariant)
 * ----------------------------
 * Every query filters by tenant_id. A key reserved by one tenant is invisible to another —
 * get(tenantA, key) never returns a row written by set(tenantB, key, ...).
 *
 * SCHEMA
 * ------
 * Table: idempotency_records
 *   tenant_id   TEXT — isolation scope
 *   key         TEXT — client-supplied Idempotency-Key
 *   path_key    TEXT — "METHOD /path" the key was first used for
 *   state       TEXT — "in-flight" | "done"
 *   status      TEXT — HTTP status code, stored as decimal string
 *   body        TEXT — JSON-serialised response body
 *   created_at  TEXT — epoch milliseconds, stored as decimal string (Date.now())
 *
 * InMemoryPool limitations honoured:
 *   • No RETURNING, no ON CONFLICT, no COUNT(*), no JOINs, no JSONB.
 *   • set() = upsert: check-then-INSERT or UPDATE in two queries (same pattern as PgEscrowStore).
 *   • TTL eviction is enforced on read (get()): an expired row is treated as absent — it is
 *     left in place (no DELETE-on-read race) but a fresh set() for the same key will UPDATE it.
 */

import type { DbPool } from "../../lib/db/types.ts";
import type { IdempotencyStore, IdempotencyRecord } from "./idempotency.ts";
import { bigIntSafe } from "./json-safe.ts";

// ─── DDL ──────────────────────────────────────────────────────────────────────

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS idempotency_records (
    tenant_id  TEXT,
    key        TEXT,
    path_key   TEXT,
    state      TEXT,
    status     TEXT,
    body       TEXT,
    created_at TEXT
  )
`;

// ─── Row shape ────────────────────────────────────────────────────────────────

type IdempotencyRow = {
  tenant_id: string;
  key: string;
  path_key: string;
  state: string;
  status: string;
  body: string;
  created_at: string;
};

function rowToRecord(row: IdempotencyRow): IdempotencyRecord {
  return {
    pathKey: row.path_key,
    state: row.state as IdempotencyRecord["state"],
    status: Number(row.status),
    // body is stored as JSON text; "null" decodes to null, matching the in-flight placeholder.
    body: JSON.parse(row.body),
    createdAt: Number(row.created_at),
  };
}

const SELECT_COLS = "tenant_id, key, path_key, state, status, body, created_at";

// ─── PgIdempotencyStore ─────────────────────────────────────────────────────────

export class PgIdempotencyStore implements IdempotencyStore {
  private readonly pool: DbPool;
  private readonly ttlMs: number;

  /**
   * @param pool   DbPool (InMemoryPool for tests/dev, pg.Pool in production).
   * @param ttlMs  Same TTL semantics as InMemoryIdempotencyStore — default 24h.
   *               Expired rows are treated as absent by get() (fail-open to "proceed",
   *               never silently replay a stale response).
   */
  constructor(pool: DbPool, ttlMs: number = 24 * 60 * 60 * 1000) {
    this.pool = pool;
    this.ttlMs = ttlMs;
  }

  /**
   * Create the table if it doesn't exist.
   * Call once at application startup (or await in buildSovereignStackAsync).
   * Idempotent (IF NOT EXISTS).
   */
  async init(): Promise<void> {
    await this.pool.query(CREATE_TABLE, []);
  }

  // ── get ───────────────────────────────────────────────────────────────────

  /**
   * Synchronous interface (IdempotencyStore.get is sync) — see note below.
   *
   * IdempotencyStore was designed around InMemoryIdempotencyStore's synchronous Map.
   * A Pg-backed store is inherently async. checkIdempotency() (idempotency.ts) is called
   * synchronously from the request handler before any await, so a sync interface cannot
   * be satisfied by a real network round-trip.
   *
   * Resolution: PgIdempotencyStore exposes async variants (getAsync/setAsync) as the
   * primary API for production wiring (see PgIdempotencySync adapter below), and the
   * sync get()/set() throw — making misuse (treating this as a drop-in for the sync
   * interface without the adapter) fail loudly rather than silently behaving like an
   * always-empty store (which would be fail-OPEN on a money endpoint — unacceptable).
   */
  get(_tenantId: string, _key: string): IdempotencyRecord | undefined {
    throw new Error(
      "PgIdempotencyStore.get() is async-only — use PgIdempotencySync (await .load() first) " +
      "or call getAsync()/setAsync() directly. A sync call here would fail-open on a money endpoint.",
    );
  }

  set(_tenantId: string, _key: string, _rec: IdempotencyRecord): void {
    throw new Error(
      "PgIdempotencyStore.set() is async-only — use PgIdempotencySync (await .load() first) " +
      "or call getAsync()/setAsync() directly.",
    );
  }

  async getAsync(tenantId: string, key: string): Promise<IdempotencyRecord | undefined> {
    if (!tenantId || !key) return undefined;
    const result = await this.pool.query<IdempotencyRow>(
      `SELECT ${SELECT_COLS} FROM idempotency_records WHERE tenant_id = $1 AND key = $2`,
      [tenantId, key],
    );
    if (result.rowCount === 0) return undefined;
    const rec = rowToRecord(result.rows[0] as IdempotencyRow);
    if (Date.now() - rec.createdAt > this.ttlMs) return undefined; // expired → treat as absent
    return rec;
  }

  async setAsync(tenantId: string, key: string, rec: IdempotencyRecord): Promise<void> {
    const existing = await this.pool.query<{ key: string }>(
      "SELECT key FROM idempotency_records WHERE tenant_id = $1 AND key = $2",
      [tenantId, key],
    );
    const body = JSON.stringify(bigIntSafe(rec.body));
    if (existing.rowCount === 0) {
      await this.pool.query(
        `INSERT INTO idempotency_records (tenant_id, key, path_key, state, status, body, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [tenantId, key, rec.pathKey, rec.state, String(rec.status), body, String(rec.createdAt)],
      );
    } else {
      await this.pool.query(
        `UPDATE idempotency_records
         SET path_key = $1, state = $2, status = $3, body = $4, created_at = $5
         WHERE tenant_id = $6 AND key = $7`,
        [rec.pathKey, rec.state, String(rec.status), body, String(rec.createdAt), tenantId, key],
      );
    }
  }

  /** Returns total count across ALL tenants (admin/diagnostic use). */
  async totalCount(): Promise<number> {
    const result = await this.pool.query<{ key: string }>("SELECT key FROM idempotency_records", []);
    return result.rows.length;
  }
}

/**
 * PgIdempotencySync — adapter that satisfies the synchronous IdempotencyStore interface
 * by pre-loading a tenant's idempotency records into an in-memory cache, then writing
 * through to PgIdempotencyStore on every set() (fire-and-forget the persistence, but the
 * in-process cache stays the source of truth for the lifetime of the request).
 *
 * Usage at composition root (per request, or cached per-tenant with periodic refresh):
 *   const sync = new PgIdempotencySync(pgStore);
 *   await sync.preload(tenantId, key);   // load this one key before checkIdempotency()
 *   checkIdempotency(sync, tenantId, key, method, path);
 *
 * This keeps checkIdempotency() fully synchronous (no interface break) while every
 * record is durably persisted in pg — restart-safe, satisfying J1 for this primitive.
 *
 * Note: this is a thin compatibility shim. The cache is unbounded per process lifetime
 * for keys it has seen; combine with the same TTL eviction as InMemoryIdempotencyStore
 * if long-lived processes accumulate many distinct keys (future hardening, not in scope
 * for this cycle — see MANIFEST "מה לא אומת").
 */
export class PgIdempotencySync implements IdempotencyStore {
  private readonly pg: PgIdempotencyStore;
  private cache = new Map<string, IdempotencyRecord>();
  /**
   * Per-key write-through queue. Two set() calls for the same key in quick succession
   * (the in-flight reservation immediately followed by finish()) are both async writes
   * to PgIdempotencyStore; without serialization their check-then-INSERT/UPDATE can race
   * (both see rowCount===0 and both INSERT), leaving a stale "in-flight" row. Chaining
   * on a per-key promise ensures the "done" write always lands after "in-flight".
   */
  private writeQueues = new Map<string, Promise<void>>();
  constructor(pg: PgIdempotencyStore) { this.pg = pg; }

  private k(t: string, key: string) { return t + "\u0000" + key; }

  /** Load (or refresh) the cache entry for one (tenantId, key) pair from pg. */
  async preload(tenantId: string, key: string): Promise<void> {
    const rec = await this.pg.getAsync(tenantId, key);
    if (rec) this.cache.set(this.k(tenantId, key), rec);
    else this.cache.delete(this.k(tenantId, key));
  }

  get(tenantId: string, key: string): IdempotencyRecord | undefined {
    return this.cache.get(this.k(tenantId, key));
  }

  set(tenantId: string, key: string, rec: IdempotencyRecord): void {
    this.cache.set(this.k(tenantId, key), rec);
    // Write-through, serialized per key (see writeQueues doc above). A failed persist
    // degrades to in-memory-only for this record (same risk profile as v111's
    // InMemoryIdempotencyStore) rather than blocking the response — but the common
    // case (pg healthy) is fully durable, and writes for the same key are ordered.
    const k = this.k(tenantId, key);
    const prev = this.writeQueues.get(k) ?? Promise.resolve();
    const next = prev
      .then(() => this.pg.setAsync(tenantId, key, rec))
      .catch((err: unknown) => {
        console.error("[idempotency] pg write-through failed (degraded to in-memory for this key):", err);
      });
    this.writeQueues.set(k, next);
  }
}
