'use strict';
/**
 * src/lib/missionProofIndexRepo374.js — ECOS V374 (Phase P262)
 *
 * DIRECTION 2: Persisted proof index — stores each `mission_proof_issued373`
 * event in a queryable index so `GET /missions?hasProof=true` is answerable.
 *
 * In-memory implementation (Map-backed) with the same interface a real DB
 * repo would expose. Drop-in replaceable with a Postgres/SQLite adapter.
 *
 * Exports:
 *   MissionProofIndexRepo374  — class; in-memory reference implementation
 *   PROOF_INDEX_VERSION_374   — '374.0.0'
 *   PROOF_INDEX_SCHEMA_374    — schema tag
 *
 * Interface (all sync unless noted):
 *   upsert374(missionId, entry)  — store/update proof index entry
 *   get374(missionId)            — retrieve entry or null
 *   listByHasProof374(hasProof)  — list all entries with hasProof true/false
 *   size374()                    — count of stored entries
 *   clear374()                   — reset (test use)
 *   toSnapshot374()              — serialisable snapshot for audit
 *
 * Pure — no new npm deps (R3). All new identifiers end with 374 (R2).
 * Sacred files untouched (R1). V361..V373 preserved (R6).
 *
 * @version 374.0.0
 */

const PROOF_INDEX_VERSION_374 = '374.0.0';
const PROOF_INDEX_SCHEMA_374  = 'ecos.integrity.mission.proof.index/v374';

class MissionProofIndexRepo374 {
  constructor() {
    /** @type {Map<string, object>} */
    this._index374 = new Map();
  }

  /**
   * Store or update the proof index entry for a mission.
   * @param {string} missionId
   * @param {{ proofHash: string, chainHeadHash?: string, overallIntegrity?: string, ts: string }} entry
   * @returns {{ ok: boolean, missionId: string, upserted: boolean }}
   */
  upsert374(missionId, entry) {
    if (!missionId) return { ok: false, error: 'missionId required' };
    const existing = this._index374.has(missionId);
    this._index374.set(missionId, {
      missionId,
      proofHash:        entry.proofHash        || null,
      chainHeadHash:    entry.chainHeadHash     || null,
      overallIntegrity: entry.overallIntegrity  || null,
      ts:               entry.ts               || new Date().toISOString(),
      indexedAt374:     new Date().toISOString(),
      schema:           PROOF_INDEX_SCHEMA_374,
      version:          PROOF_INDEX_VERSION_374,
    });
    return { ok: true, missionId, upserted: !existing };
  }

  /**
   * Retrieve the proof index entry for a mission, or null if not found.
   * @param {string} missionId
   * @returns {object|null}
   */
  get374(missionId) {
    return this._index374.get(missionId) || null;
  }

  /**
   * List all entries. When hasProof is true, returns only entries with a
   * non-null proofHash. When false, entries without a proofHash.
   * When omitted, returns all entries.
   * @param {boolean|undefined} hasProof
   * @returns {object[]}
   */
  listByHasProof374(hasProof) {
    const all = Array.from(this._index374.values());
    if (hasProof === undefined) return all;
    return all.filter(e => hasProof ? !!e.proofHash : !e.proofHash);
  }

  /** @returns {number} */
  size374() {
    return this._index374.size;
  }

  /** Reset — for test use only. */
  clear374() {
    this._index374.clear();
  }

  /** Return a plain-object snapshot of the index, serialisable to JSON. */
  toSnapshot374() {
    return {
      schema:   PROOF_INDEX_SCHEMA_374,
      version:  PROOF_INDEX_VERSION_374,
      count:    this._index374.size,
      entries:  Array.from(this._index374.values()),
    };
  }
}

module.exports = {
  MissionProofIndexRepo374,
  PROOF_INDEX_VERSION_374,
  PROOF_INDEX_SCHEMA_374,
};
