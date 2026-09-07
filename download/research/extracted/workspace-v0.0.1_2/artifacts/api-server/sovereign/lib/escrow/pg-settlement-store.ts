/**
 * lib/escrow/pg-settlement-store.ts — PgSettlementStore: PostgreSQL-backed SettlementStore.
 *
 * PURPOSE
 * -------
 * Production-grade persistence for SettlementAgreements.
 * Implements the SettlementStore interface (put / get / list) using DbPool (lib/db/types.ts),
 * so it works identically with:
 *   • InMemoryPool — tests / local dev (no external Postgres required)
 *   • pg.Pool      — production (swap in at composition root)
 *
 * TENANT ISOLATION (invariant)
 * ----------------------------
 * Every query filters by tenant_id. No path returns an agreement whose
 * tenantId ≠ the requested tenantId. Cross-tenant get() → null.
 *
 * SCHEMA
 * ------
 * Table: settlement_agreements
 *   id                  TEXT — UUID, primary key within tenant
 *   tenant_id           TEXT — isolation scope
 *   opportunity_id      TEXT
 *   payer_account_id    TEXT
 *   worker_account_id   TEXT
 *   escrow_account_id   TEXT
 *   total_amount        TEXT — bigint μ¢ stored as decimal string
 *   released_amount     TEXT — bigint μ¢ stored as decimal string
 *   state               TEXT — SettlementState
 *   created_at          TEXT — ISO 8601
 *   settled_by          TEXT — release authority identity
 *   release_audit_ids   TEXT — JSON array of audit ids (nullable)
 *   reversal_audit_id   TEXT — nullable
 *   fund_audit_id       TEXT — nullable
 *   disputed_by         TEXT — nullable
 *   dispute_reason      TEXT — nullable
 *   threshold_amount    TEXT — nullable bigint μ¢; if set, releases above this require approval
 *
 * InMemoryPool limitations honoured:
 *   • No RETURNING, no ON CONFLICT, no COUNT(*), no JOINs, no JSONB.
 *   • put() = upsert: check-then-INSERT or UPDATE in two queries.
 *   • Arrays stored as JSON text.
 */

import type { DbPool } from "../db/types.ts";
import type { SettlementStore, SettlementAgreement } from "./settlement.ts";

// ─── DDL ──────────────────────────────────────────────────────────────────────

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS settlement_agreements (
    id                TEXT,
    tenant_id         TEXT,
    opportunity_id    TEXT,
    payer_account_id  TEXT,
    worker_account_id TEXT,
    escrow_account_id TEXT,
    total_amount      TEXT,
    released_amount   TEXT,
    state             TEXT,
    created_at        TEXT,
    settled_by        TEXT,
    release_audit_ids TEXT,
    reversal_audit_id TEXT,
    fund_audit_id     TEXT,
    disputed_by       TEXT,
    dispute_reason    TEXT,
    threshold_amount  TEXT
  )
`;

// ─── Row shape ────────────────────────────────────────────────────────────────

type SettlementRow = {
  id: string;
  tenant_id: string;
  opportunity_id: string;
  payer_account_id: string;
  worker_account_id: string;
  escrow_account_id: string;
  total_amount: string;
  released_amount: string;
  state: string;
  created_at: string;
  settled_by: string;
  release_audit_ids: string | null;
  reversal_audit_id: string | null;
  fund_audit_id: string | null;
  disputed_by: string | null;
  dispute_reason: string | null;
  threshold_amount: string | null;
};

// ─── Row ↔ domain conversion ──────────────────────────────────────────────────

function rowToAgreement(row: SettlementRow): SettlementAgreement {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    opportunityId: row.opportunity_id,
    payerAccountId: row.payer_account_id,
    workerAccountId: row.worker_account_id,
    escrowAccountId: row.escrow_account_id,
    totalAmount: BigInt(row.total_amount),
    releasedAmount: BigInt(row.released_amount),
    state: row.state as SettlementAgreement["state"],
    createdAt: row.created_at,
    settledBy: row.settled_by,
    ...(row.release_audit_ids
      ? { releaseAuditIds: JSON.parse(row.release_audit_ids) as string[] }
      : {}),
    ...(row.reversal_audit_id ? { reversalAuditId: row.reversal_audit_id } : {}),
    ...(row.fund_audit_id ? { fundAuditId: row.fund_audit_id } : {}),
    ...(row.disputed_by ? { disputedBy: row.disputed_by } : {}),
    ...(row.dispute_reason ? { disputeReason: row.dispute_reason } : {}),
    ...(row.threshold_amount ? { thresholdAmount: BigInt(row.threshold_amount) } : {}),
  };
}

const SELECT_COLS =
  "id, tenant_id, opportunity_id, payer_account_id, worker_account_id, " +
  "escrow_account_id, total_amount, released_amount, state, created_at, settled_by, " +
  "release_audit_ids, reversal_audit_id, fund_audit_id, disputed_by, dispute_reason, threshold_amount";

// ─── PgSettlementStore ────────────────────────────────────────────────────────

export class PgSettlementStore implements SettlementStore {
  private readonly pool: DbPool;
  constructor(pool: DbPool) { this.pool = pool; }

  /**
   * Create the table if it doesn't exist.
   * Call once at application startup. Idempotent (IF NOT EXISTS).
   */
  async init(): Promise<void> {
    await this.pool.query(CREATE_TABLE, []);
  }

  // ── put (upsert) ────────────────────────────────────────────────────────────

  /**
   * Insert or update an agreement.
   * InMemoryPool has no ON CONFLICT support, so we check-then-insert/update.
   */
  async put(a: SettlementAgreement): Promise<void> {
    const existing = await this.pool.query<{ id: string }>(
      "SELECT id FROM settlement_agreements WHERE tenant_id = $1 AND id = $2",
      [a.tenantId, a.id],
    );

    const releaseAuditIdsJson = a.releaseAuditIds ? JSON.stringify(a.releaseAuditIds) : null;
    const thresholdAmountStr =
      (a as SettlementAgreement & { thresholdAmount?: bigint }).thresholdAmount !== undefined
        ? String((a as SettlementAgreement & { thresholdAmount?: bigint }).thresholdAmount)
        : null;

    if (existing.rowCount === 0) {
      await this.pool.query(
        `INSERT INTO settlement_agreements
         (id, tenant_id, opportunity_id, payer_account_id, worker_account_id,
          escrow_account_id, total_amount, released_amount, state, created_at, settled_by,
          release_audit_ids, reversal_audit_id, fund_audit_id, disputed_by, dispute_reason, threshold_amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          a.id,
          a.tenantId,
          a.opportunityId,
          a.payerAccountId,
          a.workerAccountId,
          a.escrowAccountId,
          a.totalAmount.toString(),
          a.releasedAmount.toString(),
          a.state,
          a.createdAt,
          a.settledBy,
          releaseAuditIdsJson,
          a.reversalAuditId ?? null,
          a.fundAuditId ?? null,
          a.disputedBy ?? null,
          a.disputeReason ?? null,
          thresholdAmountStr,
        ],
      );
    } else {
      await this.pool.query(
        `UPDATE settlement_agreements
         SET released_amount = $1, state = $2, release_audit_ids = $3,
             reversal_audit_id = $4, fund_audit_id = $5, disputed_by = $6,
             dispute_reason = $7, threshold_amount = $8
         WHERE tenant_id = $9 AND id = $10`,
        [
          a.releasedAmount.toString(),
          a.state,
          releaseAuditIdsJson,
          a.reversalAuditId ?? null,
          a.fundAuditId ?? null,
          a.disputedBy ?? null,
          a.disputeReason ?? null,
          thresholdAmountStr,
          a.tenantId,
          a.id,
        ],
      );
    }
  }

  // ── get ─────────────────────────────────────────────────────────────────────

  async get(tenantId: string, id: string): Promise<SettlementAgreement | null> {
    if (!tenantId || !id) return null;
    const result = await this.pool.query<SettlementRow>(
      `SELECT ${SELECT_COLS} FROM settlement_agreements WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    if (result.rowCount === 0) return null;
    return rowToAgreement(result.rows[0] as SettlementRow);
  }

  // ── list ────────────────────────────────────────────────────────────────────

  async list(tenantId: string): Promise<SettlementAgreement[]> {
    if (!tenantId) return [];
    const result = await this.pool.query<SettlementRow>(
      `SELECT ${SELECT_COLS} FROM settlement_agreements WHERE tenant_id = $1`,
      [tenantId],
    );
    return result.rows.map((r) => rowToAgreement(r as SettlementRow));
  }

  /** Returns total count across ALL tenants (admin/diagnostic use). */
  async totalCount(): Promise<number> {
    const result = await this.pool.query<{ id: string }>(
      "SELECT id FROM settlement_agreements",
      [],
    );
    return result.rows.length;
  }
}
