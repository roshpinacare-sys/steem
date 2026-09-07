'use strict';
/**
 * db/proofIndexTtlEviction376.js — ECOS V376 (Phase P264)
 *
 * DIRECTION 3: Proof index TTL / eviction policy.
 *
 * Adds `evictOldEntries376(repo, opts)` to prune entries older than a
 * configurable `ttlMs` (default 30 days) so the proof index doesn't grow
 * unbounded.
 *
 * Works against both MissionProofIndexRepo374 (in-memory) and
 * MissionProofIndexDbAdapter375 (DB-backed):
 *   - In-memory repo: iterates entries, removes those beyond TTL via
 *     internal map manipulation (uses the same Map the repo owns).
 *   - DB adapter: issues a DELETE WHERE indexed_at_375 < cutoff via pool.
 *
 * Exports:
 *   EVICTION_VERSION_376            — '376.0.0'
 *   EVICTION_SCHEMA_376             — schema tag
 *   DEFAULT_TTL_MS_376              — 30 * 24 * 60 * 60 * 1000 (30 days)
 *   EVICTION_EVENT_TYPE_376         — audit event type
 *   evictOldEntries376(repo, opts)  — evict entries older than ttlMs
 *
 * Endpoint: POST /api/v1/missions/proof-index/evict [V376-T03]
 *
 * Pure (R3 — no new npm deps). All new identifiers end with 376 (R2).
 * Sacred untouched (R1). V361..V375 preserved (R6).
 *
 * @version 376.0.0
 */

const FLUSH = require('./missionProofIndexFlush375.js');

const EVICTION_VERSION_376    = '376.0.0';
const EVICTION_SCHEMA_376     = 'ecos.integrity.mission.proof.index.eviction/v376';
const DEFAULT_TTL_MS_376      = 30 * 24 * 60 * 60 * 1000; // 30 days
const EVICTION_EVENT_TYPE_376 = 'integrity.mission.proof.index.eviction_ran376';

const EVICT_DB_SQL_376 = `
DELETE FROM mission_proof_index
WHERE indexed_at_375 < $1
RETURNING mission_id;
`.trim();

/**
 * Evict proof index entries older than `opts.ttlMs` (default 30 days).
 *
 * Works with:
 *   - MissionProofIndexRepo374 (in-memory Map)
 *   - MissionProofIndexDbAdapter375 (DB-backed; requires adapter._pool375)
 *
 * @param {object} repo        — MissionProofIndexRepo374 or MissionProofIndexDbAdapter375
 * @param {{ ttlMs?: number, now?: number, auditLog?: object, dryRun?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean, evicted: number, cutoff: string, dryRun: boolean, version: string }>}
 */
async function evictOldEntries376(repo, opts) {
  const o       = opts || {};
  const ttlMs   = typeof o.ttlMs === 'number' && o.ttlMs > 0 ? o.ttlMs : DEFAULT_TTL_MS_376;
  const now     = typeof o.now   === 'number' ? o.now : Date.now();
  const cutoff  = new Date(now - ttlMs);
  const dryRun  = o.dryRun === true;

  if (!repo) {
    return { ok: false, error: 'repo required', evicted: 0, cutoff: cutoff.toISOString(), dryRun, version: EVICTION_VERSION_376 };
  }

  let evicted = 0;

  try {
    // Check if it's a DB adapter (has _pool375)
    const isDb = repo instanceof FLUSH.MissionProofIndexDbAdapter375;

    if (isDb && repo._pool375 && typeof repo._pool375.query === 'function') {
      // DB path
      if (!dryRun) {
        const result = await repo._pool375.query(EVICT_DB_SQL_376, [cutoff]);
        evicted = result.rowCount || 0;
      } else {
        // Dry run: count how many would be evicted
        const countResult = await repo._pool375.query(
          `SELECT COUNT(*) AS n FROM mission_proof_index WHERE indexed_at_375 < $1`,
          [cutoff]
        );
        evicted = parseInt((countResult.rows[0] || {}).n || 0, 10);
      }
    } else if (typeof repo.listByHasProof374 === 'function' && typeof repo._index374 !== 'undefined') {
      // In-memory repo path — direct map access
      const all = repo.listByHasProof374();
      const toEvict = all.filter(e => {
        const entryTs = e.indexedAt374 || e.ts || null;
        if (!entryTs) return false;
        return new Date(entryTs).getTime() < cutoff.getTime();
      });
      evicted = toEvict.length;
      if (!dryRun) {
        for (const e of toEvict) {
          repo._index374.delete(e.missionId);
        }
      }
    } else if (typeof repo.listByHasProof374 === 'function') {
      // Fallback: list + no-op (adapter without direct map access)
      const all = await Promise.resolve(repo.listByHasProof374());
      const arr = Array.isArray(all) ? all : [];
      evicted = arr.filter(e => {
        const t = e.indexedAt374 || e.ts || null;
        return t && new Date(t).getTime() < cutoff.getTime();
      }).length;
      // Cannot evict without direct map access in this path
      if (!dryRun) {
        // Best-effort: no eviction possible without internal access
        evicted = 0;
      }
    } else {
      return { ok: false, error: 'repo interface not supported', evicted: 0, cutoff: cutoff.toISOString(), dryRun, version: EVICTION_VERSION_376 };
    }
  } catch (e) {
    return { ok: false, error: e.message, evicted: 0, cutoff: cutoff.toISOString(), dryRun, version: EVICTION_VERSION_376 };
  }

  // Append audit event
  if (!dryRun && o.auditLog && typeof o.auditLog.append === 'function') {
    try {
      o.auditLog.append(EVICTION_EVENT_TYPE_376, {
        evicted,
        ttlMs,
        cutoff: cutoff.toISOString(),
        version: EVICTION_VERSION_376,
        ts: new Date().toISOString(),
      });
    } catch (_) { /* non-fatal */ }
  }

  return {
    ok:      true,
    evicted,
    cutoff:  cutoff.toISOString(),
    ttlMs,
    dryRun,
    version: EVICTION_VERSION_376,
  };
}

module.exports = {
  EVICTION_VERSION_376,
  EVICTION_SCHEMA_376,
  DEFAULT_TTL_MS_376,
  EVICTION_EVENT_TYPE_376,
  evictOldEntries376,
};
