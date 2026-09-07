'use strict';
/**
 * db/missionProofIndexFlush375.js — ECOS V375 (Phase P263)
 *
 * DIRECTION 1: MissionProofIndexRepo374 — DB flush adapter.
 *
 * Persists the in-memory MissionProofIndexRepo374 to the database so
 * the proof index survives server restart. Mirrors the V301 ReceiptDbAdapter
 * pattern: a lightweight adapter that bridges the in-memory repo to a Postgres
 * pool without touching the in-memory implementation.
 *
 * Key design:
 *   - `flushProofIndex375(repo, pool, opts)` — bulk-upserts all entries from
 *     the in-memory repo into `mission_proof_index` table.
 *   - `loadProofIndex375(repo, pool, opts)` — on startup, hydrates the in-memory
 *     repo from the DB so the index is warm without replaying the audit log.
 *   - `upsertProofEntry375(pool, entry)` — single-row upsert; called by the
 *     server monkey-patch to flush each new entry immediately on mission close.
 *   - `MissionProofIndexDbAdapter375` — drop-in class that wraps the pool and
 *     exposes `upsert375` / `get375` / `listByHasProof375` so the server can
 *     substitute it for the in-memory repo when a real DB is available.
 *
 * Table DDL (idempotent CREATE IF NOT EXISTS emitted by `ensureTable375`):
 *   mission_proof_index (
 *     mission_id       TEXT PRIMARY KEY,
 *     proof_hash       TEXT,
 *     chain_head_hash  TEXT,
 *     overall_integrity TEXT,
 *     ts               TIMESTAMPTZ,
 *     indexed_at_375   TIMESTAMPTZ NOT NULL DEFAULT now(),
 *     schema_tag       TEXT,
 *     version          TEXT
 *   )
 *
 * Pure (R3 — no new npm deps; uses node:crypto + the existing pool.js).
 * All new public identifiers end with 375 (R2). Sacred untouched (R1).
 * V361..V374 preserved (R6).
 *
 * @version 375.0.0
 */

const FLUSH_VERSION_375   = '375.0.0';
const FLUSH_SCHEMA_375    = 'ecos.integrity.mission.proof.index.flush/v375';
const TABLE_NAME_375      = 'mission_proof_index';

// ── DDL ───────────────────────────────────────────────────────────────────────

const CREATE_TABLE_SQL_375 = `
CREATE TABLE IF NOT EXISTS ${TABLE_NAME_375} (
  mission_id        TEXT PRIMARY KEY,
  proof_hash        TEXT,
  chain_head_hash   TEXT,
  overall_integrity TEXT,
  ts                TIMESTAMPTZ,
  indexed_at_375    TIMESTAMPTZ NOT NULL DEFAULT now(),
  schema_tag        TEXT,
  version           TEXT
);
`.trim();

const UPSERT_SQL_375 = `
INSERT INTO ${TABLE_NAME_375}
  (mission_id, proof_hash, chain_head_hash, overall_integrity, ts, schema_tag, version)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (mission_id) DO UPDATE SET
  proof_hash        = EXCLUDED.proof_hash,
  chain_head_hash   = EXCLUDED.chain_head_hash,
  overall_integrity = EXCLUDED.overall_integrity,
  ts                = EXCLUDED.ts,
  indexed_at_375    = now(),
  schema_tag        = EXCLUDED.schema_tag,
  version           = EXCLUDED.version;
`.trim();

const SELECT_ALL_SQL_375 = `SELECT * FROM ${TABLE_NAME_375} ORDER BY indexed_at_375 ASC;`;
const SELECT_ONE_SQL_375 = `SELECT * FROM ${TABLE_NAME_375} WHERE mission_id = $1;`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function _rowToEntry375(row) {
  if (!row) return null;
  return {
    missionId:        row.mission_id,
    proofHash:        row.proof_hash        || null,
    chainHeadHash:    row.chain_head_hash   || null,
    overallIntegrity: row.overall_integrity || null,
    ts:               row.ts ? row.ts.toISOString() : null,
    indexedAt375:     row.indexed_at_375 ? row.indexed_at_375.toISOString() : null,
    schema:           row.schema_tag || FLUSH_SCHEMA_375,
    version:          row.version    || FLUSH_VERSION_375,
  };
}

// ── ensureTable375 ────────────────────────────────────────────────────────────

/**
 * Idempotently create the mission_proof_index table.
 * Safe to call on every startup.
 *
 * @param {object} pool — pg Pool or compatible
 * @returns {Promise<{ ok: boolean, created: boolean, version: string }>}
 */
async function ensureTable375(pool) {
  if (!pool || typeof pool.query !== 'function') {
    return { ok: false, error: 'no pool', version: FLUSH_VERSION_375 };
  }
  try {
    await pool.query(CREATE_TABLE_SQL_375);
    return { ok: true, created: true, version: FLUSH_VERSION_375 };
  } catch (e) {
    return { ok: false, error: e.message, version: FLUSH_VERSION_375 };
  }
}

// ── upsertProofEntry375 ───────────────────────────────────────────────────────

/**
 * Upsert a single proof index entry into the DB.
 * Called by the server monkey-patch on each mission close.
 *
 * @param {object} pool
 * @param {{ missionId, proofHash?, chainHeadHash?, overallIntegrity?, ts? }} entry
 * @returns {Promise<{ ok: boolean, missionId: string, version: string }>}
 */
async function upsertProofEntry375(pool, entry) {
  if (!pool || typeof pool.query !== 'function') {
    return { ok: false, error: 'no pool', version: FLUSH_VERSION_375 };
  }
  if (!entry || !entry.missionId) {
    return { ok: false, error: 'entry.missionId required', version: FLUSH_VERSION_375 };
  }
  try {
    await pool.query(UPSERT_SQL_375, [
      entry.missionId,
      entry.proofHash        || null,
      entry.chainHeadHash    || null,
      entry.overallIntegrity || null,
      entry.ts               ? new Date(entry.ts) : new Date(),
      FLUSH_SCHEMA_375,
      FLUSH_VERSION_375,
    ]);
    return { ok: true, missionId: entry.missionId, version: FLUSH_VERSION_375 };
  } catch (e) {
    return { ok: false, error: e.message, missionId: entry.missionId, version: FLUSH_VERSION_375 };
  }
}

// ── flushProofIndex375 ────────────────────────────────────────────────────────

/**
 * Bulk-flush all entries from the in-memory repo to the DB.
 *
 * @param {object} repo — MissionProofIndexRepo374 instance
 * @param {object} pool — pg Pool
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean, flushed: number, errors: number, dryRun: boolean, version: string }>}
 */
async function flushProofIndex375(repo, pool, opts = {}) {
  const dryRun = opts.dryRun === true;
  if (!repo || typeof repo.listByHasProof374 !== 'function') {
    return { ok: false, error: 'repo must be a MissionProofIndexRepo374 instance', version: FLUSH_VERSION_375 };
  }
  if (!dryRun && (!pool || typeof pool.query !== 'function')) {
    return { ok: false, error: 'pool required for live flush', version: FLUSH_VERSION_375 };
  }

  const all = repo.listByHasProof374(); // all entries (hasProof undefined → all)
  if (dryRun) {
    return { ok: true, flushed: all.length, errors: 0, dryRun: true, version: FLUSH_VERSION_375 };
  }

  let flushed = 0, errors = 0;
  for (const entry of all) {
    const r = await upsertProofEntry375(pool, {
      missionId:        entry.missionId,
      proofHash:        entry.proofHash,
      chainHeadHash:    entry.chainHeadHash,
      overallIntegrity: entry.overallIntegrity,
      ts:               entry.ts,
    });
    if (r.ok) flushed++; else errors++;
  }
  return { ok: errors === 0, flushed, errors, dryRun: false, version: FLUSH_VERSION_375 };
}

// ── loadProofIndex375 ─────────────────────────────────────────────────────────

/**
 * Hydrate the in-memory repo from the DB on startup.
 *
 * @param {object} repo — MissionProofIndexRepo374 instance (will be populated)
 * @param {object} pool — pg Pool
 * @returns {Promise<{ ok: boolean, loaded: number, version: string }>}
 */
async function loadProofIndex375(repo, pool) {
  if (!repo || typeof repo.upsert374 !== 'function') {
    return { ok: false, error: 'repo must be a MissionProofIndexRepo374 instance', version: FLUSH_VERSION_375 };
  }
  if (!pool || typeof pool.query !== 'function') {
    return { ok: false, error: 'pool required', version: FLUSH_VERSION_375 };
  }
  try {
    const { rows } = await pool.query(SELECT_ALL_SQL_375);
    for (const row of rows) {
      const e = _rowToEntry375(row);
      if (e) repo.upsert374(e.missionId, e);
    }
    return { ok: true, loaded: rows.length, version: FLUSH_VERSION_375 };
  } catch (e) {
    return { ok: false, error: e.message, loaded: 0, version: FLUSH_VERSION_375 };
  }
}

// ── MissionProofIndexDbAdapter375 ────────────────────────────────────────────

/**
 * Drop-in replacement for MissionProofIndexRepo374 that persists directly to
 * the DB on every upsert. The server can substitute this for the in-memory
 * repo when a pool is available.
 *
 * Implements the same interface as MissionProofIndexRepo374 suffixed with 374,
 * PLUS new 375-suffixed methods.
 */
class MissionProofIndexDbAdapter375 {
  /**
   * @param {{ pool: object, fallbackRepo?: object }} opts
   */
  constructor(opts = {}) {
    this._pool375    = opts.pool        || null;
    this._fallback   = opts.fallbackRepo || null; // MissionProofIndexRepo374
    this._version375 = FLUSH_VERSION_375;
  }

  /**
   * Upsert a proof index entry into the DB (and the fallback in-memory repo
   * if provided).
   */
  async upsert374(missionId, entry) {
    const dbResult = await upsertProofEntry375(this._pool375, { missionId, ...entry });
    if (this._fallback && typeof this._fallback.upsert374 === 'function') {
      this._fallback.upsert374(missionId, entry);
    }
    return dbResult.ok
      ? { ok: true, missionId, upserted: true, source: 'db', version: FLUSH_VERSION_375 }
      : { ok: false, missionId, error: dbResult.error, version: FLUSH_VERSION_375 };
  }

  /**
   * Get a single entry from the DB.
   */
  async get374(missionId) {
    if (!this._pool375 || typeof this._pool375.query !== 'function') return null;
    try {
      const { rows } = await this._pool375.query(SELECT_ONE_SQL_375, [missionId]);
      return rows.length ? _rowToEntry375(rows[0]) : null;
    } catch (_) { return null; }
  }

  /**
   * List entries from the DB filtered by hasProof.
   */
  async listByHasProof374(hasProof) {
    if (!this._pool375 || typeof this._pool375.query !== 'function') return [];
    try {
      const { rows } = await this._pool375.query(SELECT_ALL_SQL_375);
      const all = rows.map(_rowToEntry375).filter(Boolean);
      if (hasProof === undefined) return all;
      return all.filter(e => hasProof ? !!e.proofHash : !e.proofHash);
    } catch (_) { return []; }
  }

  /**
   * Count entries in the DB.
   */
  async size374() {
    if (!this._pool375 || typeof this._pool375.query !== 'function') return 0;
    try {
      const { rows } = await this._pool375.query(`SELECT COUNT(*) AS n FROM ${TABLE_NAME_375}`);
      return parseInt(rows[0].n, 10) || 0;
    } catch (_) { return 0; }
  }

  /** Serialisable snapshot of the DB state (async). */
  async toSnapshot374() {
    const all = await this.listByHasProof374();
    return {
      schema:   FLUSH_SCHEMA_375,
      version:  FLUSH_VERSION_375,
      count:    all.length,
      entries:  all,
      source:   'db',
    };
  }
}

module.exports = {
  FLUSH_VERSION_375,
  FLUSH_SCHEMA_375,
  TABLE_NAME_375,
  ensureTable375,
  upsertProofEntry375,
  flushProofIndex375,
  loadProofIndex375,
  MissionProofIndexDbAdapter375,
};
