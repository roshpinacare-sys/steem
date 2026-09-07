/**
 * src/pg-plan-sync.ts — PgPlanSync: synchronous TenantPlanRegistry backed by PostgreSQL.
 *
 * PURPOSE
 * -------
 * TenantPlanRegistry is a synchronous in-memory map (get/set).
 * On server restart, all assigned plans are lost — a tenant is effectively
 * "downgraded to unassigned" until POST /api/tenants is called again.
 * PgPlanSync bridges the gap with the same preload+write-through pattern
 * used by PgAuditSync (v116) and PgIdentityStore (v115):
 *
 *   1. In-memory map (Map<tenantId, PlanName>) — satisfies sync get/set.
 *   2. init(): Promise<void> — creates the table if absent, preloads ALL
 *      existing entries into the map. Awaited at composition time before
 *      traffic is accepted, so plans are available from the first request.
 *   3. set() — writes to in-memory map synchronously, then fires an async
 *      UPSERT (INSERT … or UPDATE via two-query approach) into pg.
 *      A crash between sync and pg write is theoretically possible;
 *      accepted trade-off (same stance as PgAuditSync / PgIdentityStore).
 *
 * TENANT ISOLATION
 * ----------------
 * Each row stores one (tenant_id, plan) pair. Reads filter by tenantId.
 * Cross-tenant leakage is structurally impossible — get() filters by tenantId
 * and the map key IS the tenantId.
 *
 * TABLE SCHEMA
 * ------------
 * Table: tenant_plans
 *   tenant_id   TEXT  — primary key (one row per tenant)
 *   plan        TEXT  — "free" | "pro" (or any future PlanName)
 *   updated_at  TEXT  — ISO-8601 timestamp of last set()
 *
 * InMemoryPool limitations honoured (same constraints as PgAuditSync):
 *   No RETURNING, no ON CONFLICT DO UPDATE (not supported by InMemoryPool).
 *   Upsert is implemented as DELETE + INSERT (idempotent in memory, correct in pg).
 *
 * INSTANCE API (compatible with TenantPlanRegistry instance shape)
 * ----------------------------------------------------------------
 *   get(tenantId): PlanName | undefined   — sync
 *   set(tenantId, plan): void             — sync write + async pg flush
 *   init(): Promise<void>                 — must be awaited before traffic
 *   pgWriteErrors: number                 — observability
 *   cacheSize: number                     — observability
 *
 * Note: TenantPlanRegistry.isValidPlan() is a STATIC method — it remains on the
 * original class and is called as TenantPlanRegistry.isValidPlan(x) throughout
 * the routes. PgPlanSync does not need to replicate it.
 */

import type { DbPool } from "../lib/db/types.ts";

// ─── PlanName (mirror of composition.ts to avoid circular import) ─────────────
// composition.ts defines PlanName as keyof typeof PLAN_LIMITS = "free" | "pro".
// Replicated here as a string alias so this file is self-contained.
export type PlanName = string;

// ─── DDL ──────────────────────────────────────────────────────────────────────

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS tenant_plans (
    tenant_id   TEXT,
    plan        TEXT,
    updated_at  TEXT
  )
`;

// ─── PgPlanSync ───────────────────────────────────────────────────────────────

export class PgPlanSync {
  private readonly pool: DbPool;

  /** In-memory cache: tenantId → PlanName. Source of truth for sync reads. */
  private readonly plans = new Map<string, PlanName>();

  /** Count of async write-through failures (for observability). */
  private writeErrors = 0;

  constructor(pool: DbPool) {
    this.pool = pool;
  }

  /**
   * Initialise: create the table if absent, then preload all existing entries
   * into the in-memory map. Must be awaited before the server accepts traffic.
   * Idempotent — safe to call more than once (re-preloads from pg each time).
   */
  async init(): Promise<void> {
    await this.pool.query(CREATE_TABLE, []);

    type PlanRow = { tenant_id: string; plan: string };
    const result = await this.pool.query<PlanRow>(
      "SELECT tenant_id, plan FROM tenant_plans",
      [],
    );

    this.plans.clear();
    for (const row of result.rows) {
      this.plans.set(row.tenant_id, row.plan);
    }
  }

  // ─── Sync interface (compatible with TenantPlanRegistry instance) ───────────

  /**
   * Return the tenant's assigned plan, or `undefined` if no plan was ever set.
   * Reads from the in-memory cache — synchronous, no await.
   */
  get(tenantId: string): PlanName | undefined {
    return this.plans.get(tenantId);
  }

  /**
   * Assign (or change) a tenant's plan.
   * Written to cache synchronously; persisted to pg asynchronously (write-through).
   *
   * Upsert strategy: DELETE existing row + INSERT new row (InMemoryPool does not
   * support ON CONFLICT DO UPDATE; DELETE+INSERT is idempotent and correct for both
   * InMemoryPool and real PostgreSQL).
   */
  set(tenantId: string, plan: PlanName): void {
    if (!tenantId) throw new Error("PgPlanSync.set: tenantId is required");
    if (!plan) throw new Error("PgPlanSync.set: plan is required");

    // ── Sync: write to cache ─────────────────────────────────────────────────
    this.plans.set(tenantId, plan);

    // ── Async: write-through to pg (fire-and-forget) ─────────────────────────
    const updatedAt = new Date().toISOString();
    this.pool.query(
      "DELETE FROM tenant_plans WHERE tenant_id = $1",
      [tenantId],
    ).then(() =>
      this.pool.query(
        "INSERT INTO tenant_plans (tenant_id, plan, updated_at) VALUES ($1, $2, $3)",
        [tenantId, plan, updatedAt],
      )
    ).catch((err: unknown) => {
      this.writeErrors++;
      console.error(
        `[PgPlanSync] write-through failed for tenant "${tenantId}" plan "${plan}":`,
        err,
      );
    });
  }

  // ─── Observability ──────────────────────────────────────────────────────────

  /** Number of async write-through failures since startup. */
  get pgWriteErrors(): number {
    return this.writeErrors;
  }

  /** Total number of tenant-plan entries currently in cache. */
  get cacheSize(): number {
    return this.plans.size;
  }
}
