/**
 * mmrAuditBridge.js — ECOS V123
 * ================================
 * Bridges the audit log (sacred file) with the MMR inclusion proof system.
 *
 * Strategy: wrap `auditLog.append()` at runtime (monkey-patch) so every
 * audit entry's hash is automatically appended to the MMR singleton.
 * This keeps lib/auditLog.js (sacred file) untouched.
 *
 * Also maintains a hash→leafIndex map for hash-addressed proof lookup:
 *   GET /api/v1/chain/mmr/proof/:hash
 *
 * Usage (call once at server startup, before any audit entries):
 *   const { wireMMRToAuditLog, getLeafIndexByHash } = require('./lib/mmrAuditBridge');
 *   wireMMRToAuditLog(defaultAuditLog, defaultMMR);
 *
 * [V123-P14-01] Initial implementation
 */

'use strict';

// hash → leafIndex map (in-memory; rebuilt from DB on restore)
const _hashToLeafIndex = new Map();

/**
 * Wrap auditLog.append() to also append the entry hash to the MMR.
 * Safe to call multiple times (idempotent via _wired guard).
 *
 * @param {AuditLog} auditLog — the defaultAuditLog instance
 * @param {MerkleMountainRange} mmr — the defaultMMR instance
 */
// Post-append callbacks — registered via registerPostAppendCallback()
const _postAppendCallbacks = [];

/**
 * Register a callback invoked after every successful MMR leaf append.
 * callback(leafIndex: number, leafCount: number) — non-throwing, non-blocking.
 * [V126-P17-02]
 */
function registerPostAppendCallback(cb) {
  if (typeof cb === 'function') _postAppendCallbacks.push(cb);
}

function wireMMRToAuditLog(auditLog, mmr) {
  if (auditLog._mmrWired) return; // idempotent

  const originalAppend = auditLog.append.bind(auditLog);

  auditLog.append = function mmrWrappedAppend(type, payload) {
    const entry = originalAppend(type, payload);
    try {
      const { leafIndex } = mmr.append(entry.hash);
      _hashToLeafIndex.set(entry.hash, leafIndex);
      // [V126-P17-02] Fire post-append callbacks (non-blocking, non-fatal)
      if (_postAppendCallbacks.length > 0) {
        const leafCount = typeof mmr.size === 'number' ? mmr.size : leafIndex + 1;
        for (const cb of _postAppendCallbacks) {
          try { cb(leafIndex, leafCount); } catch (_) {}
        }
      }
    } catch (err) {
      // Non-fatal — MMR append failure must never block audit logging
      console.error('[mmrAuditBridge] MMR append failed (non-fatal):', err.message);
    }
    return entry;
  };

  auditLog._mmrWired = true;
  return auditLog;
}

/**
 * Look up a leaf index by audit-entry hash.
 * @param {string} hash — 64-char hex SHA-256
 * @returns {number|null}
 */
function getLeafIndexByHash(hash) {
  const idx = _hashToLeafIndex.get(hash);
  return idx !== undefined ? idx : null;
}

/**
 * Seed the hash→leafIndex map from a restored MMR (e.g. loaded from DB).
 * Call after wireMMRToAuditLog() when restoring persisted state.
 *
 * @param {MerkleMountainRange} mmr — restored MMR instance
 */
function seedHashMap(mmr) {
  if (!mmr._leafHashes) return;
  _hashToLeafIndex.clear();
  mmr._leafHashes.forEach((h, i) => _hashToLeafIndex.set(h, i));
}

/**
 * Return a snapshot of the hash map (for diagnostics / tests).
 */
function getHashMap() {
  return new Map(_hashToLeafIndex);
}

module.exports = {
  wireMMRToAuditLog,
  getLeafIndexByHash,
  seedHashMap,
  getHashMap,
  registerPostAppendCallback,
};
