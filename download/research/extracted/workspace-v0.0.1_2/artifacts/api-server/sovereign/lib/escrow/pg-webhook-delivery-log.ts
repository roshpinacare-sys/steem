/**
 * lib/escrow/pg-webhook-delivery-log.ts — PgWebhookDeliveryLog: PostgreSQL-backed
 * WebhookDeliveryLog (closes MANIFEST v318 "next missing" #1).
 *
 * PURPOSE
 * -------
 * The in-memory delivery log (InMemoryWebhookDeliveryLog) does not survive a
 * process restart — under TFA_PERSIST=pg every other webhook store is durable
 * except this one. PgWebhookDeliveryLog implements the same WebhookDeliveryLog
 * interface over DbPool so dispatch outcomes (including swallowed failures
 * after the relayer's retries are exhausted) remain observable across restarts.
 *
 * SCHEMA
 * ------
 * Table: webhook_delivery_log
 *   tenant_id       TEXT     — isolation scope
 *   id              TEXT     — delivery id (x-tfa-delivery-id)
 *   registration_id TEXT
 *   event           TEXT
 *   occurred_at     TEXT     — ISO 8601 (event time)
 *   attempted_at    TEXT     — ISO 8601 (delivery attempt time)
 *   ok              INTEGER  — 1/0 (no native boolean in the toy SQL engine)
 *   status_code     INTEGER  — nullable
 *   error           TEXT     — nullable
 *   seq             INTEGER  — monotonically increasing per tenant (app-managed,
 *                              same pattern as lib/orchestrator/pg-audit.ts) so
 *                              insertion order survives restart and ties in
 *                              attempted_at (e.g. tests, bursts) never reorder.
 *
 * CAP ENFORCEMENT (bounded — no unbounded growth under sustained failures)
 * --------------------------------------------------------------------
 * After each insert: find the seq of the (capPerTenant)-th newest row for this
 * tenant (ORDER BY seq DESC LIMIT 1 OFFSET cap-1), then DELETE everything with
 * a smaller seq. Two bounded queries per write; the table never holds more than
 * capPerTenant+1 rows per tenant between writes, so this never degrades into a
 * full-table scan as history grows — the saving compounds the longer the
 * tenant runs.
 *
 * InMemoryPool limitations honoured (see lib/db/in-memory-driver.ts):
 *   No COUNT(*), no RETURNING, no ON CONFLICT, no IN (...) — cap eviction uses
 *   ORDER BY + LIMIT/OFFSET + a single ranged DELETE instead.
 *
 * TENANT ISOLATION
 * -----------------
 * Every query filters by tenant_id. record() is fail-closed on a missing
 * tenantId (mirrors InMemoryWebhookDeliveryLog — never silently stores an
 * unscoped record). list() returns [] for a missing tenantId.
 */

import type { DbPool } from "../db/types.ts";
import type { WebhookDeliveryLog, WebhookDeliveryRecord } from "./webhook.ts";
import { DEFAULT_DELIVERY_LOG_CAP } from "./webhook.ts";

// ─── DDL ──────────────────────────────────────────────────────────────────────

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS webhook_delivery_log (
    tenant_id       TEXT,
    id              TEXT,
    registration_id TEXT,
    event           TEXT,
    occurred_at     TEXT,
    attempted_at    TEXT,
    ok              INTEGER,
    status_code     INTEGER,
    error           TEXT,
    seq             INTEGER
  )
`;

// ─── Row shape ────────────────────────────────────────────────────────────────

type DeliveryRow = {
  tenant_id: string;
  id: string;
  registration_id: string;
  event: string;
  occurred_at: string;
  attempted_at: string;
  ok: number;
  status_code: number | null;
  error: string | null;
  seq: number;
};

function rowToRecord(row: DeliveryRow): WebhookDeliveryRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    registrationId: row.registration_id,
    event: row.event,
    occurredAt: row.occurred_at,
    attemptedAt: row.attempted_at,
    ok: row.ok === 1,
    statusCode: row.status_code ?? undefined,
    error: row.error ?? undefined,
  };
}

// ─── PgWebhookDeliveryLog ─────────────────────────────────────────────────────

export class PgWebhookDeliveryLog implements WebhookDeliveryLog {
  private readonly pool: DbPool;
  private readonly capPerTenant: number;

  constructor(pool: DbPool, capPerTenant: number = DEFAULT_DELIVERY_LOG_CAP) {
    this.pool = pool;
    this.capPerTenant = capPerTenant > 0 ? capPerTenant : DEFAULT_DELIVERY_LOG_CAP;
  }

  async init(): Promise<void> {
    await this.pool.query(CREATE_TABLE, []);
  }

  async record(rec: WebhookDeliveryRecord): Promise<void> {
    if (!rec?.tenantId) return; // fail-closed: never store a record with no tenant scope

    const tail = await this.pool.query<{ seq: number }>(
      "SELECT seq FROM webhook_delivery_log WHERE tenant_id = $1 ORDER BY seq DESC LIMIT 1",
      [rec.tenantId],
    );
    const seq = tail.rowCount > 0 ? (tail.rows[0].seq as number) + 1 : 0;

    await this.pool.query(
      `INSERT INTO webhook_delivery_log
       (tenant_id, id, registration_id, event, occurred_at, attempted_at, ok, status_code, error, seq)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        rec.tenantId,
        rec.id,
        rec.registrationId,
        rec.event,
        rec.occurredAt,
        rec.attemptedAt,
        rec.ok ? 1 : 0,
        rec.statusCode ?? null,
        rec.error ?? null,
        seq,
      ],
    );

    await this.evictBeyondCap(rec.tenantId);
  }

  /** Bounded eviction: keep only the newest capPerTenant rows for this tenant. */
  private async evictBeyondCap(tenantId: string): Promise<void> {
    const cutoff = await this.pool.query<{ seq: number }>(
      "SELECT seq FROM webhook_delivery_log WHERE tenant_id = $1 ORDER BY seq DESC LIMIT 1 OFFSET $2",
      [tenantId, this.capPerTenant - 1],
    );
    if (cutoff.rowCount === 0) return; // at or under cap — nothing to evict
    const cutoffSeq = cutoff.rows[0].seq as number;
    await this.pool.query(
      "DELETE FROM webhook_delivery_log WHERE tenant_id = $1 AND seq < $2",
      [tenantId, cutoffSeq],
    );
  }

  async list(tenantId: string, registrationId?: string, limit = 50): Promise<WebhookDeliveryRecord[]> {
    if (!tenantId) return [];
    const result = registrationId
      ? await this.pool.query<DeliveryRow>(
          `SELECT tenant_id, id, registration_id, event, occurred_at, attempted_at, ok, status_code, error, seq
           FROM webhook_delivery_log
           WHERE tenant_id = $1 AND registration_id = $2
           ORDER BY seq DESC LIMIT $3`,
          [tenantId, registrationId, limit],
        )
      : await this.pool.query<DeliveryRow>(
          `SELECT tenant_id, id, registration_id, event, occurred_at, attempted_at, ok, status_code, error, seq
           FROM webhook_delivery_log
           WHERE tenant_id = $1
           ORDER BY seq DESC LIMIT $2`,
          [tenantId, limit],
        );
    return result.rows.map(rowToRecord);
  }
}
