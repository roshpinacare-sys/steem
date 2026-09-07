/**
 * lib/potential/pg-personality-store.ts — PgPersonalityStore
 *
 * PURPOSE
 * -------
 * Persists and retrieves PersonalityProfile objects in a PostgreSQL table.
 * Works identically with:
 *   • InMemoryPool — tests / local dev (no external Postgres required)
 *   • pg.Pool      — production
 *
 * TENANT ISOLATION (invariant)
 * ----------------------------
 * Every query filters by tenant_id. No path returns a PersonalityProfile
 * whose tenantId ≠ the requested tenantId.
 *
 * SCHEMA
 * ------
 * Table: personality_profiles
 *   user_id     TEXT — (user_id, tenant_id) together are the primary key
 *   tenant_id   TEXT — isolation scope
 *   traits      TEXT — JSON-encoded PersonalityTraits (stored as TEXT, InMemoryPool compat)
 *   evidence    TEXT — JSON-encoded TraitEvidence[]
 *   confidence  TEXT — JSON-encoded Record<keyof PersonalityTraits, number>
 *   analyzed_at TEXT — ISO timestamp
 *
 * InMemoryPool limitations honoured:
 *   • No COUNT(*), no RETURNING, no ON CONFLICT, no JOIN, no JSONB.
 *   • Upsert implemented as: check-then-insert or update (two queries inside the same pool call).
 *   • totalCount() does SELECT user_id … and counts result.rows.length.
 */

import type { DbPool } from "../db/types.ts";
import type { PersonalityProfile, PersonalityTraits, TraitEvidence } from "./personality-types.ts";

// ─── DDL ──────────────────────────────────────────────────────────────────────

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS personality_profiles (
    user_id     TEXT,
    tenant_id   TEXT,
    traits      TEXT,
    evidence    TEXT,
    confidence  TEXT,
    analyzed_at TEXT
  )
`;

// ─── Row shape ────────────────────────────────────────────────────────────────

type ProfileRow = {
  user_id: string;
  tenant_id: string;
  traits: string;
  evidence: string;
  confidence: string;
  analyzed_at: string;
}

// ─── Row ↔ domain conversion ──────────────────────────────────────────────────

function rowToProfile(row: ProfileRow): PersonalityProfile {
  let traits: PersonalityTraits = { extroversion: 0, focus: 0, collaboration: 0, creativity: 0, leadership: 0 };
  let evidence: TraitEvidence[] = [];
  let confidence: Record<keyof PersonalityTraits, number> = {
    extroversion: 0, focus: 0, collaboration: 0, creativity: 0, leadership: 0,
  };
  try { traits = JSON.parse(row.traits); } catch {}
  try { evidence = JSON.parse(row.evidence); } catch {}
  try { confidence = JSON.parse(row.confidence); } catch {}
  return {
    userId: row.user_id,
    tenantId: row.tenant_id,
    traits,
    evidence,
    confidence,
    analyzedAt: row.analyzed_at,
  };
}

// ─── Error type ───────────────────────────────────────────────────────────────

export type PersonalityStoreErrorCode =
  | "MISSING_USER_ID"
  | "MISSING_TENANT_ID"
  | "INVALID_TRAITS";

export class PersonalityStoreError extends Error {
  readonly code: PersonalityStoreErrorCode;
  constructor(code: PersonalityStoreErrorCode, message: string) {
    super(message);
    this.name = "PersonalityStoreError";
    this.code = code;
  }
}

// ─── PgPersonalityStore ────────────────────────────────────────────────────────

/**
 * PgPersonalityStore — save and load PersonalityProfile objects in PostgreSQL (or InMemoryPool).
 *
 * Usage:
 *   const store = new PgPersonalityStore(pool);
 *   await store.init();                 // idempotent — call once on startup
 *   await store.save(profile);          // upsert (latest analysis wins)
 *   const p = await store.load(tenantId, userId);   // null if not found
 *   const all = await store.listByTenant(tenantId); // all profiles for tenant
 *   await store.delete(tenantId, userId);            // false if not found
 *   const n = await store.totalCount(tenantId);     // count for tenant
 */
export class PgPersonalityStore {
  private readonly pool: DbPool;
  constructor(pool: DbPool) {
    this.pool = pool;
  }

  // ─── init ─────────────────────────────────────────────────────────────────

  /**
   * Create the personality_profiles table if it doesn't exist.
   * Idempotent — safe to call on every startup.
   */
  async init(): Promise<void> {
    await this.pool.query(CREATE_TABLE);
  }

  // ─── save (upsert) ────────────────────────────────────────────────────────

  /**
   * Persist a PersonalityProfile. Upserts: if a profile already exists for
   * (userId, tenantId), it is replaced by the new one (latest analysis wins).
   *
   * Validation:
   *   - userId + tenantId are required (non-empty strings).
   *   - traits must be an object with all five keys (extroversion, focus,
   *     collaboration, creativity, leadership), each a number 0–100.
   */
  async save(profile: PersonalityProfile): Promise<void> {
    if (!profile.userId) {
      throw new PersonalityStoreError("MISSING_USER_ID", "userId is required");
    }
    if (!profile.tenantId) {
      throw new PersonalityStoreError("MISSING_TENANT_ID", "tenantId is required");
    }
    this.validateTraits(profile.traits);

    const traitsJson     = JSON.stringify(profile.traits);
    const evidenceJson   = JSON.stringify(profile.evidence ?? []);
    const confidenceJson = JSON.stringify(profile.confidence ?? {});
    const analyzedAt     = profile.analyzedAt ?? new Date().toISOString();

    // Upsert: check existence → UPDATE or INSERT (InMemoryPool-safe, no ON CONFLICT)
    const existing = await this.pool.query<{ user_id: string }>(
      `SELECT user_id FROM personality_profiles WHERE user_id = $1 AND tenant_id = $2`,
      [profile.userId, profile.tenantId]
    );
    if (existing.rows.length > 0) {
      await this.pool.query(
        `UPDATE personality_profiles
           SET traits = $1, evidence = $2, confidence = $3, analyzed_at = $4
         WHERE user_id = $5 AND tenant_id = $6`,
        [traitsJson, evidenceJson, confidenceJson, analyzedAt, profile.userId, profile.tenantId]
      );
    } else {
      await this.pool.query(
        `INSERT INTO personality_profiles (user_id, tenant_id, traits, evidence, confidence, analyzed_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [profile.userId, profile.tenantId, traitsJson, evidenceJson, confidenceJson, analyzedAt]
      );
    }
  }

  // ─── load ─────────────────────────────────────────────────────────────────

  /**
   * Load a PersonalityProfile by (tenantId, userId).
   * Returns null if not found. Cross-tenant: always returns null (tenant-scoped SELECT).
   */
  async load(tenantId: string, userId: string): Promise<PersonalityProfile | null> {
    if (!tenantId || !userId) return null;
    const result = await this.pool.query<ProfileRow>(
      `SELECT user_id, tenant_id, traits, evidence, confidence, analyzed_at
       FROM personality_profiles
       WHERE user_id = $1 AND tenant_id = $2`,
      [userId, tenantId]
    );
    return result.rows.length > 0 ? rowToProfile(result.rows[0]) : null;
  }

  // ─── listByTenant ─────────────────────────────────────────────────────────

  /**
   * List all PersonalityProfiles for a tenant.
   * Returns [] if none found or if tenantId is empty.
   */
  async listByTenant(tenantId: string): Promise<PersonalityProfile[]> {
    if (!tenantId) return [];
    const result = await this.pool.query<ProfileRow>(
      `SELECT user_id, tenant_id, traits, evidence, confidence, analyzed_at
       FROM personality_profiles
       WHERE tenant_id = $1`,
      [tenantId]
    );
    return result.rows.map(rowToProfile);
  }

  // ─── delete ───────────────────────────────────────────────────────────────

  /**
   * Delete a PersonalityProfile by (tenantId, userId).
   * Returns true if deleted, false if not found.
   * Cross-tenant: won't find the row → returns false (data intact).
   */
  async delete(tenantId: string, userId: string): Promise<boolean> {
    if (!tenantId || !userId) return false;
    const existing = await this.pool.query<{ user_id: string }>(
      `SELECT user_id FROM personality_profiles WHERE user_id = $1 AND tenant_id = $2`,
      [userId, tenantId]
    );
    if (existing.rows.length === 0) return false;
    await this.pool.query(
      `DELETE FROM personality_profiles WHERE user_id = $1 AND tenant_id = $2`,
      [userId, tenantId]
    );
    return true;
  }

  // ─── totalCount ───────────────────────────────────────────────────────────

  /**
   * Count the number of stored profiles for a tenant.
   * Uses SELECT user_id (not COUNT(*)) for InMemoryPool compatibility.
   */
  async totalCount(tenantId: string): Promise<number> {
    if (!tenantId) return 0;
    const result = await this.pool.query<{ user_id: string }>(
      `SELECT user_id FROM personality_profiles WHERE tenant_id = $1`,
      [tenantId]
    );
    return result.rows.length;
  }

  // ─── private: validateTraits ──────────────────────────────────────────────

  private validateTraits(traits: PersonalityTraits): void {
    if (!traits || typeof traits !== "object") {
      throw new PersonalityStoreError("INVALID_TRAITS", "traits must be an object");
    }
    const keys: Array<keyof PersonalityTraits> = [
      "extroversion", "focus", "collaboration", "creativity", "leadership",
    ];
    for (const k of keys) {
      const v = (traits as unknown as Record<string, unknown>)[k];
      if (typeof v !== "number" || v < 0 || v > 100) {
        throw new PersonalityStoreError(
          "INVALID_TRAITS",
          `traits.${k} must be a number 0–100 (got ${JSON.stringify(v)})`
        );
      }
    }
  }
}
