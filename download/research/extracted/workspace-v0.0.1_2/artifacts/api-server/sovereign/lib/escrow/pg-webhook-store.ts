/**
 * lib/escrow/pg-webhook-store.ts — PgWebhookStore: PostgreSQL-backed WebhookStore.
 *
 * PURPOSE
 * -------
 * Production-grade persistence for WebhookRegistrations.
 * Implements the WebhookStore interface (put / get / list / delete) using DbPool,
 * so it works with both InMemoryPool (tests) and pg.Pool (production).
 *
 * TENANT ISOLATION (invariant)
 * ----------------------------
 * Every query filters by tenant_id.  Cross-tenant get() → null.
 *
 * SCHEMA
 * ------
 * Table: webhook_registrations
 *   id          TEXT — UUID, primary key within tenant
 *   tenant_id   TEXT — isolation scope
 *   url         TEXT — destination endpoint
 *   events      TEXT — JSON-serialized string[] (no JSONB — InMemoryPool limitation)
 *   secret      TEXT — HMAC secret for signing
 *   created_at  TEXT — ISO 8601
 *   active      TEXT — "true" | "false" (no boolean — InMemoryPool limitation)
 *
 * InMemoryPool limitations honoured:
 *   • No RETURNING, no ON CONFLICT, no COUNT(*), no JSONB.
 *   • put() = upsert: check-then-INSERT or UPDATE in two queries.
 *   • events stored as JSON string; active stored as "true"/"false" TEXT.
 */

import type { DbPool } from "../db/types.ts";
import type { WebhookStore, WebhookRegistration } from "./webhook.ts";

// ─── DDL ──────────────────────────────────────────────────────────────────────

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS webhook_registrations (
    id         TEXT,
    tenant_id  TEXT,
    url        TEXT,
    events     TEXT,
    secret     TEXT,
    created_at TEXT,
    active     TEXT
  )
`;

// ─── Row shape ────────────────────────────────────────────────────────────────

type WebhookRow = {
  id: string;
  tenant_id: string;
  url: string;
  events: string;       // JSON-serialized string[]
  secret: string;
  created_at: string;
  active: string;       // "true" | "false"
};

// ─── Row ↔ domain conversion ──────────────────────────────────────────────────

function rowToRegistration(row: WebhookRow): WebhookRegistration {
  let events: string[] = [];
  try { events = JSON.parse(row.events) as string[]; } catch { events = []; }
  return {
    id: row.id,
    tenantId: row.tenant_id,
    url: row.url,
    events,
    secret: row.secret,
    createdAt: row.created_at,
    active: row.active === "true",
  };
}

// ─── PgWebhookStore ───────────────────────────────────────────────────────────

export class PgWebhookStore implements WebhookStore {
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

  async put(reg: WebhookRegistration): Promise<void> {
    await this.init();
    const eventsJson = JSON.stringify(reg.events);
    const activeStr = reg.active ? "true" : "false";

    // Check for existing row (upsert: check-then-INSERT or UPDATE)
    const existing = await this.pool.query<WebhookRow>(
      "SELECT id FROM webhook_registrations WHERE tenant_id = $1 AND id = $2",
      [reg.tenantId, reg.id],
    );

    if (existing.rows.length === 0) {
      await this.pool.query(
        `INSERT INTO webhook_registrations
           (id, tenant_id, url, events, secret, created_at, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [reg.id, reg.tenantId, reg.url, eventsJson, reg.secret, reg.createdAt, activeStr],
      );
    } else {
      await this.pool.query(
        `UPDATE webhook_registrations
            SET url = $1, events = $2, secret = $3, active = $4
          WHERE tenant_id = $5 AND id = $6`,
        [reg.url, eventsJson, reg.secret, activeStr, reg.tenantId, reg.id],
      );
    }
  }

  async get(tenantId: string, id: string): Promise<WebhookRegistration | null> {
    await this.init();
    const result = await this.pool.query<WebhookRow>(
      "SELECT id, tenant_id, url, events, secret, created_at, active FROM webhook_registrations WHERE tenant_id = $1 AND id = $2",
      [tenantId, id],
    );
    if (result.rows.length === 0) return null;
    return rowToRegistration(result.rows[0]);
  }

  async list(tenantId: string): Promise<WebhookRegistration[]> {
    await this.init();
    const result = await this.pool.query<WebhookRow>(
      "SELECT id, tenant_id, url, events, secret, created_at, active FROM webhook_registrations WHERE tenant_id = $1",
      [tenantId],
    );
    return result.rows.map(rowToRegistration);
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    await this.init();
    // Check first — InMemoryPool has no RETURNING
    const existing = await this.pool.query<WebhookRow>(
      "SELECT id FROM webhook_registrations WHERE tenant_id = $1 AND id = $2",
      [tenantId, id],
    );
    if (existing.rows.length === 0) return false;
    await this.pool.query(
      "DELETE FROM webhook_registrations WHERE tenant_id = $1 AND id = $2",
      [tenantId, id],
    );
    return true;
  }
}
