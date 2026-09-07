'use strict';
/**
 * src/lib/perUserVectorPersistence419.js — ECOS V419 (Phase P307) — Per-User Vector Persistence
 *
 * Adds a lightweight append-only JSONL persistence layer for PerUserVectorStore416
 * so that per-user vector embeddings survive server restarts.
 *
 * Architecture:
 *   PerUserVectorStore416 (in-memory cosine store) ←→ PerUserVectorPersistence419
 *       ↓ upsert / delete events                          ↑ replay on startup
 *   {dataDir}/vectors/{userId}.jsonl                  WAL-style log per user
 *
 * Design:
 *  - One JSONL file per user under dataDir/vectors/<userId>.jsonl
 *  - Each line is a JSON record: { op: 'upsert'|'delete', vectorId, vector, meta, ts }
 *  - On startup: replay all lines, last-write-wins per vectorId
 *  - On upsert: append a single JSON line (O(1), no rewrite)
 *  - On delete: append a tombstone line with op:'delete'
 *  - Compaction: rewrite file keeping only live vectors (removes tombstones + superseded)
 *  - Thread safety: single-process; file ops are synchronous (no async race)
 *
 * All identifiers end in 419 (R2). No new npm deps (R3). Sacred untouched (R1).
 * Zero new module-level singletons outside wire419 IIFE (R7).
 *
 * @version 419.0.0
 */

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const PERSISTENCE_VERSION_419 = '419.0.0';
const VECTORS_SUBDIR_419 = 'vectors';
const MAX_VECTOR_DIM_419 = 4096;
const MAX_VECTORS_PER_USER_419 = 10_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function sanitizeUserId419(userId) {
  if (typeof userId !== 'string' || !userId.trim()) throw new Error('userId must be a non-empty string (419)');
  // Allow only safe characters for filenames
  const safe = userId.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
  if (safe.length > 200) throw new Error('userId too long (419)');
  return safe;
}

function validateVector419(vector) {
  if (!Array.isArray(vector)) throw new Error('vector must be an array (419)');
  if (vector.length === 0) throw new Error('vector must not be empty (419)');
  if (vector.length > MAX_VECTOR_DIM_419) throw new Error(`vector dimension exceeds max ${MAX_VECTOR_DIM_419} (419)`);
  for (const v of vector) {
    if (typeof v !== 'number' || !isFinite(v)) throw new Error('vector must contain finite numbers (419)');
  }
  return true;
}

function cosineSimilarity419(a, b) {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// ── PerUserVectorPersistence419 ───────────────────────────────────────────────

class PerUserVectorPersistence419 {
  /**
   * @param {object} opts
   * @param {string} opts.dataDir  — base directory for persistence files (required)
   * @param {object} [opts.audit]  — optional audit function(type, payload)
   * @param {object} [opts.logger] — optional logger
   */
  constructor(opts = {}) {
    if (!opts.dataDir) throw new Error('dataDir required for PerUserVectorPersistence419 (419)');
    this._dataDir  = opts.dataDir;
    this._vectorsDir = path.join(opts.dataDir, VECTORS_SUBDIR_419);
    this._audit    = typeof opts.audit === 'function' ? opts.audit : null;
    this._logger   = opts.logger || null;

    // In-memory replica: Map<userId, Map<vectorId, {vectorId, vector, meta, ts}>>
    this._store419 = new Map();

    // Ensure directory exists
    this._ensureDirs419();
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  _ensureDirs419() {
    if (!fs.existsSync(this._dataDir)) fs.mkdirSync(this._dataDir, { recursive: true });
    if (!fs.existsSync(this._vectorsDir)) fs.mkdirSync(this._vectorsDir, { recursive: true });
  }

  _userFilePath419(userId) {
    return path.join(this._vectorsDir, `${sanitizeUserId419(userId)}.jsonl`);
  }

  _appendLine419(filePath, record) {
    const line = JSON.stringify(record) + '\n';
    fs.appendFileSync(filePath, line, 'utf8');
  }

  _emitAudit419(type, payload) {
    if (this._audit) {
      try { this._audit(type, Object.assign({ ts: Date.now(), version: PERSISTENCE_VERSION_419 }, payload)); } catch (_) {}
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Replay all persisted vectors from disk into in-memory store.
   * Should be called once at startup.
   * @returns {{ usersLoaded: number, vectorsLoaded: number, errors: number }}
   */
  loadAll419() {
    let usersLoaded = 0, vectorsLoaded = 0, errors = 0;
    this._ensureDirs419();

    let files;
    try { files = fs.readdirSync(this._vectorsDir); } catch (_) { files = []; }

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const userId = file.slice(0, -6); // strip .jsonl
      const filePath = path.join(this._vectorsDir, file);

      let lines;
      try { lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean); }
      catch (_) { errors++; continue; }

      const userMap = new Map();
      for (const line of lines) {
        try {
          const rec = JSON.parse(line);
          if (rec.op === 'upsert' && rec.vectorId) {
            userMap.set(rec.vectorId, { vectorId: rec.vectorId, vector: rec.vector, meta: rec.meta || {}, ts: rec.ts });
          } else if (rec.op === 'delete' && rec.vectorId) {
            userMap.delete(rec.vectorId);
          }
        } catch (_) { errors++; }
      }

      if (userMap.size > 0) {
        this._store419.set(userId, userMap);
        usersLoaded++;
        vectorsLoaded += userMap.size;
      }
    }

    this._emitAudit419('vector.persistence.load419', { usersLoaded, vectorsLoaded, errors });
    return { usersLoaded, vectorsLoaded, errors };
  }

  /**
   * Persist a new or updated vector for a user.
   * Appends to the user's JSONL file and updates in-memory store.
   * @param {string} userId
   * @param {string} vectorId
   * @param {number[]} vector
   * @param {object} [meta]
   * @returns {{ ok: boolean, vectorId: string, userId: string }}
   */
  upsert419(userId, vectorId, vector, meta = {}) {
    sanitizeUserId419(userId);
    if (typeof vectorId !== 'string' || !vectorId.trim()) throw new Error('vectorId must be a non-empty string (419)');
    validateVector419(vector);

    const userMap = this._store419.get(userId) || new Map();
    if (!this._store419.has(userId)) this._store419.set(userId, userMap);

    if (userMap.size >= MAX_VECTORS_PER_USER_419 && !userMap.has(vectorId)) {
      throw new Error(`Per-user vector limit ${MAX_VECTORS_PER_USER_419} reached for user (419)`);
    }

    const ts = Date.now();
    const record = { op: 'upsert', vectorId, vector, meta, ts };
    const filePath = this._userFilePath419(userId);

    this._appendLine419(filePath, record);
    userMap.set(vectorId, { vectorId, vector, meta, ts });

    this._emitAudit419('vector.persistence.upsert419', { userId, vectorId, dim: vector.length });
    return { ok: true, vectorId, userId };
  }

  /**
   * Delete a vector for a user (appends tombstone to JSONL).
   * @param {string} userId
   * @param {string} vectorId
   * @returns {{ ok: boolean, deleted: boolean }}
   */
  delete419(userId, vectorId) {
    sanitizeUserId419(userId);
    const userMap = this._store419.get(userId);
    if (!userMap || !userMap.has(vectorId)) return { ok: true, deleted: false };

    const filePath = this._userFilePath419(userId);
    this._appendLine419(filePath, { op: 'delete', vectorId, ts: Date.now() });
    userMap.delete(vectorId);
    if (userMap.size === 0) this._store419.delete(userId);

    this._emitAudit419('vector.persistence.delete419', { userId, vectorId });
    return { ok: true, deleted: true };
  }

  /**
   * Cosine-similarity search over a user's persisted vectors.
   * @param {string} userId
   * @param {number[]} queryVector
   * @param {number} [topK=10]
   * @returns {{ results: Array<{vectorId, score, meta}>, count: number }}
   */
  search419(userId, queryVector, topK = 10) {
    sanitizeUserId419(userId);
    validateVector419(queryVector);
    const userMap = this._store419.get(userId);
    if (!userMap || userMap.size === 0) return { results: [], count: 0 };

    const scored = [];
    for (const [, entry] of userMap) {
      if (entry.vector.length !== queryVector.length) continue;
      scored.push({ vectorId: entry.vectorId, score: cosineSimilarity419(queryVector, entry.vector), meta: entry.meta });
    }
    scored.sort((a, b) => b.score - a.score);
    return { results: scored.slice(0, topK), count: userMap.size };
  }

  /**
   * List all vectorIds for a user.
   * @param {string} userId
   * @returns {{ vectorIds: string[], count: number }}
   */
  list419(userId) {
    sanitizeUserId419(userId);
    const userMap = this._store419.get(userId);
    if (!userMap) return { vectorIds: [], count: 0 };
    return { vectorIds: Array.from(userMap.keys()), count: userMap.size };
  }

  /**
   * Compact a user's JSONL file: rewrite keeping only live vectors (removes tombstones + superseded entries).
   * @param {string} userId
   * @returns {{ ok: boolean, linesWritten: number }}
   */
  compact419(userId) {
    sanitizeUserId419(userId);
    const userMap = this._store419.get(userId);
    const filePath = this._userFilePath419(userId);

    if (!userMap || userMap.size === 0) {
      // Delete empty file
      try { fs.unlinkSync(filePath); } catch (_) {}
      return { ok: true, linesWritten: 0 };
    }

    const lines = Array.from(userMap.values())
      .map(entry => JSON.stringify({ op: 'upsert', vectorId: entry.vectorId, vector: entry.vector, meta: entry.meta, ts: entry.ts }) + '\n')
      .join('');

    fs.writeFileSync(filePath + '.tmp', lines, 'utf8');
    fs.renameSync(filePath + '.tmp', filePath);

    this._emitAudit419('vector.persistence.compact419', { userId, linesWritten: userMap.size });
    return { ok: true, linesWritten: userMap.size };
  }

  /**
   * Global stats snapshot.
   * @returns {{ totalUsers: number, totalVectors: number, dataDir: string, version: string }}
   */
  stats419() {
    let totalVectors = 0;
    for (const [, userMap] of this._store419) totalVectors += userMap.size;
    return {
      totalUsers: this._store419.size,
      totalVectors,
      dataDir: this._dataDir,
      version: PERSISTENCE_VERSION_419,
    };
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  PerUserVectorPersistence419,
  PERSISTENCE_VERSION_419,
  MAX_VECTOR_DIM_419,
  MAX_VECTORS_PER_USER_419,
  sanitizeUserId419,
  validateVector419,
  cosineSimilarity419,
};
