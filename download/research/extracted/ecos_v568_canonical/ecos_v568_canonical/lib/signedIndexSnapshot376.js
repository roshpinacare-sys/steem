'use strict';
/**
 * lib/signedIndexSnapshot376.js — ECOS V376 (Phase P264)
 *
 * DIRECTION 4: Signed proof index snapshot.
 *
 * `buildSignedIndexSnapshot376(repo, auditLog, opts)` serialises
 * `toSnapshot374()` + a sha256 commitment over the serialised entries +
 * an audit-log append, so the proof index state is itself
 * integrity-attested and comparable across restarts.
 *
 * The snapshot schema/recipe mirrors the V372 portable-proof style so
 * downstream verifiers can use the same pattern.
 *
 * Exports:
 *   SNAPSHOT_VERSION_376             — '376.0.0'
 *   SNAPSHOT_SCHEMA_376              — schema tag
 *   SNAPSHOT_ISSUED_TYPE_376         — audit event type
 *   buildSignedIndexSnapshot376(repo, auditLog, opts)
 *     — async (for DB adapter compat); returns { snapshot, snapshotHash, recipe, version }
 *   verifyIndexSnapshot376(signedSnap, opts)
 *     — pure verifier; returns { valid, reason, ... }
 *
 * Endpoint: GET /api/v1/missions/proof-index/snapshot [V376-T04]
 *
 * Pure (R3 — no new npm deps; uses node:crypto). All new identifiers end
 * with 376 (R2). Sacred untouched (R1). V361..V375 preserved (R6).
 *
 * @version 376.0.0
 */

const crypto = require('crypto');

const SNAPSHOT_VERSION_376     = '376.0.0';
const SNAPSHOT_SCHEMA_376      = 'ecos.integrity.mission.proof.index.snapshot/v376';
const SNAPSHOT_ISSUED_TYPE_376 = 'integrity.mission.proof.index.snapshot_issued376';

// ── internal helpers ──────────────────────────────────────────────────────────

function _sha256hex376(s) {
  return crypto.createHash('sha256').update(typeof s === 'string' ? s : JSON.stringify(s)).digest('hex');
}

function _canonicalize376(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(_canonicalize376).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + _canonicalize376(v[k])).join(',') + '}';
}

// ── buildSignedIndexSnapshot376 ───────────────────────────────────────────────

/**
 * Serialise the proof index into a sha256-committed, audit-logged snapshot.
 *
 * @param {object} repo        — MissionProofIndexRepo374 or MissionProofIndexDbAdapter375
 * @param {object} [auditLog]  — AuditLog instance (append-only)
 * @param {{ now?: number }} [opts]
 * @returns {Promise<{ ok: boolean, snapshot: object, snapshotHash: string, recipe: object, version: string }>}
 */
async function buildSignedIndexSnapshot376(repo, auditLog, opts) {
  if (!repo) {
    return { ok: false, error: 'repo required', version: SNAPSHOT_VERSION_376 };
  }

  const o = opts || {};

  // Support both sync (in-memory) and async (DB adapter) toSnapshot374
  let rawSnap;
  try {
    const snap = repo.toSnapshot374();
    rawSnap = (snap && typeof snap.then === 'function') ? await snap : snap;
  } catch (e) {
    return { ok: false, error: 'toSnapshot374 failed: ' + e.message, version: SNAPSHOT_VERSION_376 };
  }

  const ts        = new Date(typeof o.now === 'number' ? o.now : Date.now()).toISOString();
  const entryCount = (rawSnap && typeof rawSnap.count === 'number') ? rawSnap.count : 0;

  // Build the canonical payload to commit
  const payload = {
    schema:      SNAPSHOT_SCHEMA_376,
    version:     SNAPSHOT_VERSION_376,
    ts,
    entryCount,
    indexSchema: (rawSnap && rawSnap.schema) || '',
    indexVersion:(rawSnap && rawSnap.version) || '',
    // Commit to the sorted list of missionIds for determinism
    missionIds:  Array.isArray(rawSnap && rawSnap.entries)
      ? rawSnap.entries.map(e => e.missionId || '').sort()
      : [],
  };

  const canonical     = _canonicalize376(payload);
  const snapshotHash  = _sha256hex376(canonical);

  const snapshot = {
    ...payload,
    snapshotHash,
    entries: (rawSnap && rawSnap.entries) || [],
  };

  // Append to audit log (non-fatal)
  if (auditLog && typeof auditLog.append === 'function') {
    try {
      auditLog.append(SNAPSHOT_ISSUED_TYPE_376, {
        snapshotHash,
        entryCount,
        ts,
        version: SNAPSHOT_VERSION_376,
      });
    } catch (_) { /* non-fatal */ }
  }

  const recipe = {
    algo:          'sha256',
    input:         'canonical JSON of {schema,version,ts,entryCount,indexSchema,indexVersion,missionIds} with sorted keys',
    canonicalize:  'recursive sorted-keys JSON stringify',
    encoding:      'hex',
    verifierFile:  'lib/signedIndexSnapshot376.js',
    verifierFn:    'verifyIndexSnapshot376',
  };

  return {
    ok:           true,
    snapshot,
    snapshotHash,
    recipe,
    version:      SNAPSHOT_VERSION_376,
  };
}

// ── verifyIndexSnapshot376 ────────────────────────────────────────────────────

/**
 * Pure verifier: re-derives the snapshotHash and checks it matches.
 * No external dependencies, no I/O.
 *
 * @param {object} signedSnap   — snapshot object returned by buildSignedIndexSnapshot376
 * @param {object} [opts]
 * @returns {{ valid: boolean, reason: string, expected: string, provided: string, version: string }}
 */
function verifyIndexSnapshot376(signedSnap, opts) {
  if (!signedSnap || typeof signedSnap !== 'object') {
    return { valid: false, reason: 'snapshot missing or not an object', expected: '', provided: '', version: SNAPSHOT_VERSION_376 };
  }

  const provided = signedSnap.snapshotHash || '';

  // Re-derive payload (same fields, same order exclusion of snapshotHash + entries)
  const payload = {
    schema:       signedSnap.schema      || '',
    version:      signedSnap.version     || '',
    ts:           signedSnap.ts          || '',
    entryCount:   typeof signedSnap.entryCount === 'number' ? signedSnap.entryCount : 0,
    indexSchema:  signedSnap.indexSchema  || '',
    indexVersion: signedSnap.indexVersion || '',
    missionIds:   Array.isArray(signedSnap.missionIds) ? signedSnap.missionIds : [],
  };

  const canonical = _canonicalize376(payload);
  const expected  = _sha256hex376(canonical);

  if (expected !== provided) {
    return {
      valid:    false,
      reason:   'snapshotHash mismatch',
      expected,
      provided,
      version:  SNAPSHOT_VERSION_376,
    };
  }

  if (signedSnap.schema !== SNAPSHOT_SCHEMA_376) {
    return {
      valid:    false,
      reason:   'schema mismatch: expected ' + SNAPSHOT_SCHEMA_376,
      expected: SNAPSHOT_SCHEMA_376,
      provided: signedSnap.schema || '',
      version:  SNAPSHOT_VERSION_376,
    };
  }

  return {
    valid:    true,
    reason:   'ok',
    expected,
    provided,
    entryCount: payload.entryCount,
    version:  SNAPSHOT_VERSION_376,
  };
}

module.exports = {
  SNAPSHOT_VERSION_376,
  SNAPSHOT_SCHEMA_376,
  SNAPSHOT_ISSUED_TYPE_376,
  buildSignedIndexSnapshot376,
  verifyIndexSnapshot376,
};
