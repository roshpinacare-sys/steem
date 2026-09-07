/**
 * lib/api-key/pg-api-key-store.ts — PgApiKeyStore: PostgreSQL-backed ApiKeyStore.
 *
 * PURPOSE
 * -------
 * v91 added per-tenant API keys (ApiKeyService + InMemoryApiKeyStore), but the
 * key registry is in-memory: every key (and every revocation) is lost on restart,
 * silently re-enabling a "revoked" key and forcing all tenants to re-issue keys
 * after every deploy. This is J1 sub-step 2, part A (api-keys) — same persistence
 * requirement as audit/escrow/idempotency: a revocation IS a trust decision and
 * must survive a restart.
 *
 * Unlike PgIdempotencyStore (J1 sub-step 1), ApiKeyStore's interface is already
 * fully async (put/get/getByHashedSecret/list/revoke all return Promises) —
 * PgApiKeyStore is a direct drop-in, no sync/async adapter needed. Works
 * identically with InMemoryPool (tests/dev) and pg.Pool (production), same as
 * PgPersonalityStore / PgEscrowStore.
 *
 * TENANT ISOLATION (invariant)
 * ----------------------------
 * list(tenantId) filters by tenant_id. get(keyId) and getByHashedSecret(hash) are
 * intentionally GLOBAL lookups by design (mirrors InMemoryApiKeyStore: a keyId and
 * a hashed secret are both globally unique, and auth middleware does not know the
 * tenant up-front — that's *why* the key carries tenantId). The caller (ApiKeyService
 * / auth middleware) is responsible for using the returned key's tenantId for any
 * subsequent tenant-scoped operation.
 *
 * SCHEMA
 * ------
 * Table: api_keys
 *   key_id        TEXT — globally unique, primary lookup key
 *   tenant_id     TEXT — isolation scope for list()
 *   name          TEXT
 *   hashed_secret TEXT — SHA-256(secret), base64url; globally unique
 *   scopes        TEXT — JSON-encoded string[]
 *   created_at    TEXT — ISO timestamp
 *   revoked_at    TEXT — ISO timestamp, or "" if not revoked (InMemoryPool has no NULL ergonomics
 *                  for equality checks the way real pg does; "" round-trips cleanly and
 *                  rowToKey() maps "" back to `undefined`, matching ApiKey's optional field)
 *   expires_at    TEXT — ISO timestamp, or ""
 *
 * InMemoryPool limitations honoured:
 *   • No COUNT(*), no RETURNING, no ON CONFLICT, no JOIN, no JSONB.
 *   • put() = upsert: check-then-INSERT or UPDATE (same two-query pattern as PgPersonalityStore).
 */

import type { DbPool } from "../db/types.ts";
import type { ApiKey, ApiKeyStore } from "./types.ts";

// ─── DDL ──────────────────────────────────────────────────────────────────────

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS api_keys (
    key_id        TEXT,
    tenant_id     TEXT,
    name          TEXT,
    hashed_secret TEXT,
    scopes        TEXT,
    created_at    TEXT,
    revoked_at    TEXT,
    expires_at    TEXT
  )
`;

// ─── Row shape ────────────────────────────────────────────────────────────────

type ApiKeyRow = {
  key_id: string;
  tenant_id: string;
  name: string;
  hashed_secret: string;
  scopes: string;
  created_at: string;
  revoked_at: string;
  expires_at: string;
};

const SELECT_COLS = "key_id, tenant_id, name, hashed_secret, scopes, created_at, revoked_at, expires_at";

function rowToKey(row: ApiKeyRow): ApiKey {
  let scopes: string[] = [];
  try { scopes = JSON.parse(row.scopes); } catch {}
  const key: ApiKey = {
    keyId: row.key_id,
    tenantId: row.tenant_id,
    name: row.name,
    hashedSecret: row.hashed_secret,
    scopes: Array.isArray(scopes) ? scopes : [],
    createdAt: row.created_at,
  };
  if (row.revoked_at) key.revokedAt = row.revoked_at;
  if (row.expires_at) key.expiresAt = row.expires_at;
  return key;
}

// ─── PgApiKeyStore ───────────────────────────────────────────────────────────

/**
 * PgApiKeyStore — PostgreSQL-backed ApiKeyStore (drop-in for InMemoryApiKeyStore).
 *
 * Usage:
 *   const store = new PgApiKeyStore(pool);
 *   await store.init();                       // idempotent — call once on startup
 *   const svc = new ApiKeyService(store);      // unchanged — ApiKeyService is store-agnostic
 */
export class PgApiKeyStore implements ApiKeyStore {
  private readonly pool: DbPool;
  constructor(pool: DbPool) {
    this.pool = pool;
  }

  /** Create the api_keys table if it doesn't exist. Idempotent (IF NOT EXISTS). */
  async init(): Promise<void> {
    await this.pool.query(CREATE_TABLE, []);
  }

  // ── put (upsert by keyId) ───────────────────────────────────────────────
  async put(key: ApiKey): Promise<void> {
    const scopesJson = JSON.stringify(key.scopes ?? []);
    const revokedAt = key.revokedAt ?? "";
    const expiresAt = key.expiresAt ?? "";
    const existing = await this.pool.query<{ key_id: string }>(
      "SELECT key_id FROM api_keys WHERE key_id = $1",
      [key.keyId],
    );
    if (existing.rowCount === 0) {
      await this.pool.query(
        `INSERT INTO api_keys (key_id, tenant_id, name, hashed_secret, scopes, created_at, revoked_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [key.keyId, key.tenantId, key.name, key.hashedSecret, scopesJson, key.createdAt, revokedAt, expiresAt],
      );
    } else {
      await this.pool.query(
        `UPDATE api_keys
         SET tenant_id = $1, name = $2, hashed_secret = $3, scopes = $4, created_at = $5, revoked_at = $6, expires_at = $7
         WHERE key_id = $8`,
        [key.tenantId, key.name, key.hashedSecret, scopesJson, key.createdAt, revokedAt, expiresAt, key.keyId],
      );
    }
  }

  // ── get (global lookup by keyId) ────────────────────────────────────────
  async get(keyId: string): Promise<ApiKey | null> {
    if (!keyId) return null;
    const result = await this.pool.query<ApiKeyRow>(
      `SELECT ${SELECT_COLS} FROM api_keys WHERE key_id = $1`,
      [keyId],
    );
    return result.rowCount > 0 ? rowToKey(result.rows[0] as ApiKeyRow) : null;
  }

  // ── getByHashedSecret (global lookup) ───────────────────────────────────
  async getByHashedSecret(hashedSecret: string): Promise<ApiKey | null> {
    if (!hashedSecret) return null;
    const result = await this.pool.query<ApiKeyRow>(
      `SELECT ${SELECT_COLS} FROM api_keys WHERE hashed_secret = $1`,
      [hashedSecret],
    );
    return result.rowCount > 0 ? rowToKey(result.rows[0] as ApiKeyRow) : null;
  }

  // ── list (tenant-scoped, hashedSecret omitted) ──────────────────────────
  async list(tenantId: string): Promise<Omit<ApiKey, "hashedSecret">[]> {
    if (!tenantId) return [];
    const result = await this.pool.query<ApiKeyRow>(
      `SELECT ${SELECT_COLS} FROM api_keys WHERE tenant_id = $1`,
      [tenantId],
    );
    return result.rows.map((row) => {
      const { hashedSecret: _h, ...rest } = rowToKey(row as ApiKeyRow);
      return rest;
    });
  }

  // ── revoke (global by keyId) ────────────────────────────────────────────
  async revoke(keyId: string): Promise<boolean> {
    const existing = await this.pool.query<{ key_id: string; revoked_at: string }>(
      "SELECT key_id, revoked_at FROM api_keys WHERE key_id = $1",
      [keyId],
    );
    if (existing.rowCount === 0) return false;
    if ((existing.rows[0] as any).revoked_at) return false; // already revoked
    await this.pool.query(
      "UPDATE api_keys SET revoked_at = $1 WHERE key_id = $2",
      [new Date().toISOString(), keyId],
    );
    return true;
  }

  /** Returns total key count across ALL tenants (admin/diagnostic use). */
  async totalCount(): Promise<number> {
    const result = await this.pool.query<{ key_id: string }>("SELECT key_id FROM api_keys", []);
    return result.rows.length;
  }
}
