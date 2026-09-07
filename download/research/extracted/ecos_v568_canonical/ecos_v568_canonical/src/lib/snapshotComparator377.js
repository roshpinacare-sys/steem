'use strict';
/**
 * lib/snapshotComparator377.js — ECOS V377 (Phase P265)
 *
 * DIRECTION 2: Snapshot comparison endpoint.
 *
 * `compareIndexSnapshots377(snapA, snapB)` reports the set difference
 * between two signed proof-index snapshots produced by
 * `buildSignedIndexSnapshot376`. It returns:
 *   - `added`:   missionIds present in snapB but not in snapA
 *   - `removed`: missionIds present in snapA but not in snapB
 *   - `changed`: missionIds present in both but with different proofHash
 *   - `unchanged`: count of missionIds identical in both
 *
 * Useful for restart-diff checks and external auditor workflows.
 *
 * Exports:
 *   COMPARATOR_VERSION_377                — '377.0.0'
 *   COMPARATOR_SCHEMA_377                 — schema tag
 *   compareIndexSnapshots377(snapA, snapB, opts)
 *     — pure; returns { ok, added, removed, changed, unchanged, totalA, totalB, ... }
 *
 * Endpoint: POST /api/v1/missions/proof-index/snapshot/compare [V377-T02]
 *
 * Pure (R3 — no new npm deps). All new identifiers end with 377 (R2).
 * Sacred untouched (R1). V361..V376 preserved (R6).
 *
 * @version 377.0.0
 */

const COMPARATOR_VERSION_377 = '377.0.0';
const COMPARATOR_SCHEMA_377  = 'ecos.integrity.mission.proof.index.snapshot.comparison/v377';

/**
 * Extract the entries map from a signed snapshot.
 * Handles both the V376 `snapshot.entries` array format:
 *   [ { missionId, proofHash, ... }, ... ]
 * and object-keyed format (future proofing):
 *   { missionId: { proofHash, ... } }
 *
 * @param {object} signedSnap — result of buildSignedIndexSnapshot376
 * @returns {Map<string, { proofHash: string }>}  keyed by missionId
 */
function _extractEntries377(signedSnap) {
  const result = new Map();
  if (!signedSnap) return result;

  // V376 layout: signedSnap.snapshot.entries (array of { missionId, proofHash, ... })
  let entries = null;
  try {
    const snap = signedSnap.snapshot || signedSnap;
    entries = (snap.entries) || (snap.payload && snap.payload.entries) || null;
  } catch (_) {}

  if (!entries) return result;

  // Array format: V376 canonical
  if (Array.isArray(entries)) {
    for (const info of entries) {
      if (info && typeof info.missionId === 'string') {
        result.set(info.missionId, {
          proofHash: info.proofHash || '',
          indexedAt: info.indexedAt374 || info.indexedAt || '',
        });
      }
    }
    return result;
  }

  // Object-keyed format (fallback)
  if (typeof entries === 'object') {
    for (const [missionId, info] of Object.entries(entries)) {
      result.set(String(missionId), {
        proofHash: (info && info.proofHash)  || '',
        indexedAt: (info && info.indexedAt)  || '',
      });
    }
  }
  return result;
}

/**
 * Compare two signed proof-index snapshots and report the diff.
 *
 * @param {object} snapA  — older signed snapshot (baseline)
 * @param {object} snapB  — newer signed snapshot (comparison target)
 * @param {{ includeDetails?: boolean }} [opts]
 * @returns {{
 *   ok: boolean,
 *   schema: string,
 *   added: string[],
 *   removed: string[],
 *   changed: Array<{ missionId: string, hashA: string, hashB: string }>,
 *   unchanged: number,
 *   totalA: number,
 *   totalB: number,
 *   identical: boolean,
 *   version: string,
 * }}
 */
function compareIndexSnapshots377(snapA, snapB, opts) {
  const o = opts || {};

  if (!snapA || !snapB) {
    return {
      ok:        false,
      error:     'both snapA and snapB are required',
      schema:    COMPARATOR_SCHEMA_377,
      added:     [],
      removed:   [],
      changed:   [],
      unchanged: 0,
      totalA:    0,
      totalB:    0,
      identical: false,
      version:   COMPARATOR_VERSION_377,
    };
  }

  const mapA = _extractEntries377(snapA);
  const mapB = _extractEntries377(snapB);

  const added   = [];
  const removed = [];
  const changed = [];
  let unchanged = 0;

  // Find added and changed
  for (const [mId, infoB] of mapB) {
    if (!mapA.has(mId)) {
      added.push(mId);
    } else {
      const infoA = mapA.get(mId);
      if (infoA.proofHash !== infoB.proofHash) {
        changed.push({
          missionId: mId,
          hashA: infoA.proofHash,
          hashB: infoB.proofHash,
        });
      } else {
        unchanged++;
      }
    }
  }

  // Find removed
  for (const mId of mapA.keys()) {
    if (!mapB.has(mId)) {
      removed.push(mId);
    }
  }

  const identical = added.length === 0 && removed.length === 0 && changed.length === 0;

  return {
    ok:        true,
    schema:    COMPARATOR_SCHEMA_377,
    added,
    removed,
    changed,
    unchanged,
    totalA:    mapA.size,
    totalB:    mapB.size,
    identical,
    version:   COMPARATOR_VERSION_377,
  };
}

module.exports = {
  COMPARATOR_VERSION_377,
  COMPARATOR_SCHEMA_377,
  compareIndexSnapshots377,
};
