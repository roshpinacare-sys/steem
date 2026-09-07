/**
 * lib/escrow/pg-escrow-store.ts — PgEscrowStore: PostgreSQL-backed EscrowStore.
 *
 * PURPOSE
 * -------
 * Production-grade persistence for EscrowAgreements.
 * Implements the EscrowStore interface (put / get / list) using DbPool (lib/db/types.ts),
 * so it works identically with:
 *   • InMemoryPool — tests / local dev (no external Postgres required)
 *   • pg.Pool      — production (swap in at composition root)
 *
 * TENANT ISOLATION (invariant)
 * ----------------------------
 * Every query filters by tenant_id.  No path returns an agreement whose
 * tenantId ≠ the requested tenantId.  Cross-tenant get() → null.
 *
 * SCHEMA
 * ------
 * Table: escrow_agreements
 *   id                TEXT  — UUID, primary key within tenant
 *   tenant_id         TEXT  — isolation scope
 *   opportunity_id    TEXT
 *   payer_account_id  TEXT
 *   worker_account_id TEXT
 *   escrow_account_id TEXT
 *   amount            TEXT  — bigint μ¢ stored as decimal string (JSON-safe)
 *   state             TEXT  — "created"|"funded"|"released"|"refunded"|"disputed"
 *   created_at        TEXT  — ISO 8601
 *   fund_audit_id     TEXT  — nullable
 *   settle_audit_id   TEXT  — nullable
 *   funded_by         TEXT  — nullable; settlement authority identity
 *   disputed_by       TEXT  — nullable; identity that raised the dispute (v88)
 *   dispute_reason    TEXT  — nullable; human-readable dispute reason (v88)
 *
 * InMemoryPool limitations honoured:
 *   • No RETURNING, no ON CONFLICT, no COUNT(*), no JOINs, no JSONB.
 *   • put() = upsert: check-then-INSERT or UPDATE in two queries.
 *   • totalCount() fetches ids and counts rows.
 */

import type { DbPool } from "../db/types.ts";
import type { EscrowStore } from "./escrow.ts";
import type { EscrowAgreement } from "./types.ts";

// ─── DDL ──────────────────────────────────────────────────────────────────────

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS escrow_agreements (
    id                TEXT,
    tenant_id         TEXT,
    opportunity_id    TEXT,
    payer_account_id  TEXT,
    worker_account_id TEXT,
    escrow_account_id TEXT,
    amount            TEXT,
    state             TEXT,
    created_at        TEXT,
    fund_audit_id     TEXT,
    settle_audit_id   TEXT,
    funded_by         TEXT,
    disputed_by       TEXT,
    dispute_reason    TEXT,
    fee_basis_points  TEXT,
    fee_amount        TEXT,
    fee_account_id    TEXT,
    fee_audit_id      TEXT
  )
`;

// ─── Row shape ────────────────────────────────────────────────────────────────

type EscrowRow = {
  id: string;
  tenant_id: string;
  opportunity_id: string;
  payer_account_id: string;
  worker_account_id: string;
  escrow_account_id: string;
  amount: string;
  state: string;
  created_at: string;
  fund_audit_id: string | null;
  settle_audit_id: string | null;
  funded_by: string | null;
  disputed_by: string | null;
  dispute_reason: string | null;
  fee_basis_points: string | null;
  fee_amount: string | null;
  fee_account_id: string | null;
  fee_audit_id: string | null;
};

// ─── Row ↔ domain conversion ──────────────────────────────────────────────────

function rowToAgreement(row: EscrowRow): EscrowAgreement {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    opportunityId: row.opportunity_id,
    payerAccountId: row.payer_account_id,
    workerAccountId: row.worker_account_id,
    escrowAccountId: row.escrow_account_id,
    amount: BigInt(row.amount),
    state: row.state as EscrowAgreement["state"],
    createdAt: row.created_at,
    ...(row.fund_audit_id   ? { fundAuditId:   row.fund_audit_id   } : {}),
    ...(row.settle_audit_id ? { settleAuditId: row.settle_audit_id } : {}),
    ...(row.funded_by       ? { fundedBy:      row.funded_by       } : {}),
    ...(row.disputed_by     ? { disputedBy:    row.disputed_by     } : {}),
    ...(row.dispute_reason  ? { disputeReason: row.dispute_reason  } : {}),
    ...(row.fee_basis_points ? { feeBasisPoints: Number(row.fee_basis_points) } : {}),
    ...(row.fee_amount       ? { feeAmount: BigInt(row.fee_amount) } : {}),
    ...(row.fee_account_id   ? { feeAccountId: row.fee_account_id } : {}),
    ...(row.fee_audit_id     ? { feeAuditId: row.fee_audit_id } : {}),
  };
}

const SELECT_COLS =
  "id, tenant_id, opportunity_id, payer_account_id, worker_account_id, " +
  "escrow_account_id, amount, state, created_at, fund_audit_id, settle_audit_id, " +
  "funded_by, disputed_by, dispute_reason, fee_basis_points, fee_amount, " +
  "fee_account_id, fee_audit_id";

// ─── PgEscrowStore ────────────────────────────────────────────────────────────

export class PgEscrowStore implements EscrowStore {
  private readonly pool: DbPool;
  constructor(pool: DbPool) { this.pool = pool; }

  /**
   * Create the table if it doesn't exist.
   * Call once at application startup (or await in buildSovereignStackAsync).
   * Idempotent (IF NOT EXISTS).
   */
  async init(): Promise<void> {
    await this.pool.query(CREATE_TABLE, []);
  }

  // ── put (upsert) ────────────────────────────────────────────────────────────

  /**
   * Insert or update an agreement.
   * InMemoryPool has no ON CONFLICT support, so we check-then-insert/update.
   * Mutable fields: state, fund_audit_id, settle_audit_id, funded_by, disputed_by, dispute_reason.
   */
  async put(a: EscrowAgreement): Promise<void> {
    const existing = await this.pool.query<{ id: string }>(
      "SELECT id FROM escrow_agreements WHERE tenant_id = $1 AND id = $2",
      [a.tenantId, a.id],
    );

    if (existing.rowCount === 0) {
      // INSERT new agreement
      await this.pool.query(
        `INSERT INTO escrow_agreements
         (id, tenant_id, opportunity_id, payer_account_id, worker_account_id,
          escrow_account_id, amount, state, created_at, fund_audit_id, settle_audit_id,
          funded_by, disputed_by, dispute_reason, fee_basis_points, fee_amount,
          fee_account_id, fee_audit_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
        [
          a.id,
          a.tenantId,
          a.opportunityId,
          a.payerAccountId,
          a.workerAccountId,
          a.escrowAccountId,
          a.amount.toString(),
          a.state,
          a.createdAt,
          a.fundAuditId    ?? null,
          a.settleAuditId  ?? null,
          a.fundedBy       ?? null,
          a.disputedBy     ?? null,
          a.disputeReason  ?? null,
          a.feeBasisPoints !== undefined ? String(a.feeBasisPoints) : null,
          a.feeAmount !== undefined ? a.feeAmount.toString() : null,
          a.feeAccountId   ?? null,
          a.feeAuditId     ?? null,
        ],
      );
    } else {
      // UPDATE mutable fields
      await this.pool.query(
        `UPDATE escrow_agreements
         SET state = $1, fund_audit_id = $2, settle_audit_id = $3,
             funded_by = $4, disputed_by = $5, dispute_reason = $6,
             fee_basis_points = $7, fee_amount = $8, fee_account_id = $9, fee_audit_id = $10
         WHERE tenant_id = $11 AND id = $12`,
        [
          a.state,
          a.fundAuditId   ?? null,
          a.settleAuditId ?? null,
          a.fundedBy      ?? null,
          a.disputedBy    ?? null,
          a.disputeReason ?? null,
          a.feeBasisPoints !== undefined ? String(a.feeBasisPoints) : null,
          a.feeAmount !== undefined ? a.feeAmount.toString() : null,
          a.feeAccountId  ?? null,
          a.feeAuditId    ?? null,
          a.tenantId,
          a.id,
        ],
      );
    }
  }

  // ── get ─────────────────────────────────────────────────────────────────────

  async get(tenantId: string, id: string): Promise<EscrowAgreement | null> {
    if (!tenantId || !id) return null;
    const result = await this.pool.query<EscrowRow>(
      `SELECT ${SELECT_COLS} FROM escrow_agreements WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    if (result.rowCount === 0) return null;
    return rowToAgreement(result.rows[0] as EscrowRow);
  }

  // ── list ────────────────────────────────────────────────────────────────────

  async list(tenantId: string): Promise<EscrowAgreement[]> {
    if (!tenantId) return [];
    const result = await this.pool.query<EscrowRow>(
      `SELECT ${SELECT_COLS} FROM escrow_agreements WHERE tenant_id = $1`,
      [tenantId],
    );
    return result.rows.map((r) => rowToAgreement(r as EscrowRow));
  }

  // ── totalCount ──────────────────────────────────────────────────────────────

  /** Returns total count across ALL tenants (admin/diagnostic use). */
  async totalCount(): Promise<number> {
    // InMemoryPool does not support COUNT(*) — fetch ids and count rows.
    const result = await this.pool.query<{ id: string }>(
      "SELECT id FROM escrow_agreements",
      [],
    );
    return result.rows.length;
  }
}
