/**
 * lib/marketplace/pg-catalog.ts — PgOpportunityCatalog: PostgreSQL-backed OpportunityCatalog.
 *
 * PURPOSE
 * -------
 * Production-grade persistence for the marketplace opportunity catalog.
 * Implements the async OpportunityCatalog interface using DbPool (lib/db/types.ts),
 * so it works identically with:
 *   • InMemoryPool — tests / local dev (no external Postgres required)
 *   • pg.Pool        — production (swap in at composition root)
 *
 * TENANT ISOLATION (invariant)
 * ----------------------------
 * Every query filters by tenant_id. No path returns an Opportunity
 * whose tenantId ≠ the requested tenantId.
 *
 * SCHEMA
 * ------
 * Table: marketplace_opportunities
 *   id                 TEXT   — UUID, primary key within tenant
 *   tenant_id          TEXT   — isolation scope
 *   title              TEXT
 *   description        TEXT
 *   required_strengths TEXT   — JSON array, stored as TEXT (InMemoryPool compat)
 *
 * InMemoryPool limitations honoured:
 *   • No COUNT(*), no RETURNING, no ON CONFLICT, no JOIN.
 *   • totalCount() does SELECT id … and counts result.rows.length.
 *   • Existence check before DELETE (no RETURNING).
 */

import { randomUUID } from "node:crypto";
import type { DbPool } from "../db/types.ts";
import type { Opportunity } from "../potential/types.ts";
import {
  MarketplaceError,
  type OpportunityCatalog,
  type OpportunityInput,
} from "./types.ts";

// ─── DDL ──────────────────────────────────────────────────────────────────────

const CREATE_OPPORTUNITIES_TABLE = `
  CREATE TABLE IF NOT EXISTS marketplace_opportunities (
    id                 TEXT,
    tenant_id          TEXT,
    title              TEXT,
    description        TEXT,
    required_strengths TEXT,
    budget_mc          TEXT
  )
`;

// ─── Row shape ────────────────────────────────────────────────────────────────

type OpportunityRow = {
  id: string;
  tenant_id: string;
  title: string;
  description: string;
  required_strengths: string; // JSON-encoded array
  budget_mc: string | null;   // decimal string μ¢, or null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rowToOpportunity(row: OpportunityRow): Opportunity {
  let requiredStrengths: Array<{ category: string; minScore: number }> = [];
  try {
    requiredStrengths = JSON.parse(row.required_strengths) ?? [];
  } catch {
    requiredStrengths = [];
  }
  const opp: Opportunity = {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    description: row.description,
    requiredStrengths,
  };
  if (row.budget_mc != null && row.budget_mc !== "") {
    opp.budget = BigInt(row.budget_mc);
  }
  return opp;
}

function validateInput(input: OpportunityInput): {
  title: string;
  description: string;
  requiredStrengths: Array<{ category: string; minScore: number }>;
} {
  if (!input.tenantId || typeof input.tenantId !== "string" || !input.tenantId.trim()) {
    throw new MarketplaceError("tenantId is required", "missing_tenant_id");
  }
  if (!input.title || typeof input.title !== "string" || !input.title.trim()) {
    throw new MarketplaceError("title is required", "missing_title");
  }

  const requiredStrengths = (input.requiredStrengths ?? []).map((rs) => {
    if (!rs.category || typeof rs.category !== "string" || !rs.category.trim()) {
      throw new MarketplaceError(
        "requiredStrength.category must be a non-empty string",
        "invalid_required_strength",
      );
    }
    if (
      typeof rs.minScore !== "number" ||
      isNaN(rs.minScore) ||
      rs.minScore < 0 ||
      rs.minScore > 100
    ) {
      throw new MarketplaceError(
        `requiredStrength.minScore must be 0–100, got ${rs.minScore}`,
        "invalid_min_score",
      );
    }
    return { category: rs.category.trim(), minScore: rs.minScore };
  });

  return {
    title: input.title.trim(),
    description: (input.description ?? "").trim(),
    requiredStrengths,
  };
}

// ─── PgOpportunityCatalog ─────────────────────────────────────────────────────

export class PgOpportunityCatalog implements OpportunityCatalog {
  private pool: DbPool;

  constructor(pool: DbPool) {
    this.pool = pool;
  }

  /**
   * Create the backing table. Idempotent — safe to call multiple times
   * (uses CREATE TABLE IF NOT EXISTS). Call once at application startup.
   */
  async init(): Promise<void> {
    await this.pool.query(CREATE_OPPORTUNITIES_TABLE);
  }

  // ── create ─────────────────────────────────────────────────────────────────

  async create(input: OpportunityInput): Promise<Opportunity> {
    const { title, description, requiredStrengths } = validateInput(input);
    const id = input.id ?? randomUUID();

    // Check for duplicate within this tenant (fail-closed)
    const existing = await this.pool.query<{ id: string }>(
      "SELECT id FROM marketplace_opportunities WHERE tenant_id = $1 AND id = $2",
      [input.tenantId, id],
    );
    if (existing.rowCount > 0) {
      throw new MarketplaceError(
        `Opportunity with id "${id}" already exists in tenant "${input.tenantId}"`,
        "duplicate_id",
      );
    }

    const strengthsJson = JSON.stringify(requiredStrengths);
    const budgetMc = input.budget !== undefined ? input.budget.toString() : null;
    await this.pool.query(
      `INSERT INTO marketplace_opportunities (id, tenant_id, title, description, required_strengths, budget_mc)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, input.tenantId, title, description, strengthsJson, budgetMc],
    );

    return {
      id, tenantId: input.tenantId, title, description, requiredStrengths,
      ...(input.budget !== undefined ? { budget: input.budget } : {}),
    };
  }

  // ── list ───────────────────────────────────────────────────────────────────

  async list(tenantId: string): Promise<Opportunity[]> {
    if (!tenantId) return [];
    const result = await this.pool.query<OpportunityRow>(
      "SELECT id, tenant_id, title, description, required_strengths, budget_mc FROM marketplace_opportunities WHERE tenant_id = $1",
      [tenantId],
    );
    return result.rows.map(rowToOpportunity);
  }

  // ── get ────────────────────────────────────────────────────────────────────

  async get(tenantId: string, id: string): Promise<Opportunity | null> {
    if (!tenantId || !id) return null;
    const result = await this.pool.query<OpportunityRow>(
      "SELECT id, tenant_id, title, description, required_strengths, budget_mc FROM marketplace_opportunities WHERE tenant_id = $1 AND id = $2",
      [tenantId, id],
    );
    if (result.rowCount === 0) return null;
    return rowToOpportunity(result.rows[0] as OpportunityRow);
  }

  // ── delete ─────────────────────────────────────────────────────────────────

  async delete(tenantId: string, id: string): Promise<boolean> {
    if (!tenantId || !id) return false;
    // Check existence first (InMemoryPool has no RETURNING)
    const check = await this.pool.query<{ id: string }>(
      "SELECT id FROM marketplace_opportunities WHERE tenant_id = $1 AND id = $2",
      [tenantId, id],
    );
    if (check.rowCount === 0) return false;
    await this.pool.query(
      "DELETE FROM marketplace_opportunities WHERE tenant_id = $1 AND id = $2",
      [tenantId, id],
    );
    return true;
  }

  // ── totalCount ─────────────────────────────────────────────────────────────

  async totalCount(): Promise<number> {
    // InMemoryPool does not support COUNT(*) — fetch ids and count rows.
    const result = await this.pool.query<{ id: string }>(
      "SELECT id FROM marketplace_opportunities",
    );
    return result.rows.length;
  }
}
