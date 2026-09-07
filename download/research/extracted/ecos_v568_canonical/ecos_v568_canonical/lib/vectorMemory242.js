/**
 * src/lib/vectorMemory242.js — ECOS Vector Memory Layer (P138)
 * ─────────────────────────────────────────────────────────────
 * In-memory cosine-similarity search on dense embedding vectors.
 * No external vector DB, no pgvector dep, no npm deps.
 *
 * Backed by the memorySubstrate.js patterns used by V225 memory endpoints.
 * Identifiers end with 242.
 */

'use strict';

const VECTOR_MEM_MAX_ENTRIES_242  = 50_000;   // FIFO eviction above this
const VECTOR_MEM_DEFAULT_TOPK_242 = 10;
const VECTOR_MEM_MAX_TOPK_242     = 100;
const VECTOR_MEM_DIM_WARN_242     = 4096;     // log a warning if dim > this
const VECTOR_MEM_INDEX_VERSION_242 = 1;

// ── Math helpers ──────────────────────────────────────────────────────────────

/**
 * Dot product of two Float32Arrays / plain arrays.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
function dot242(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

/**
 * L2 norm (magnitude) of a vector.
 * @param {number[]} v
 * @returns {number}
 */
function norm242(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  return Math.sqrt(s);
}

/**
 * Cosine similarity ∈ [-1, 1].
 * Returns 0 if either vector is the zero vector.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
function cosine242(a, b) {
  const na = norm242(a), nb = norm242(b);
  if (na === 0 || nb === 0) return 0;
  return dot242(a, b) / (na * nb);
}

/**
 * Normalize a vector to unit length (returns new array, safe on zero-vec).
 * @param {number[]} v
 * @returns {number[]}
 */
function normalizeVec242(v) {
  const n = norm242(v);
  if (n === 0) return v.slice();
  return v.map(x => x / n);
}

// ── VectorMemory242 ───────────────────────────────────────────────────────────

/**
 * @typedef {object} MemoryEntry242
 * @property {string}   key         - unique key
 * @property {number[]} vector      - raw embedding
 * @property {number[]} _normalized - unit-length embedding (pre-computed)
 * @property {object}   meta        - arbitrary metadata
 * @property {number}   storedAt    - unix ms
 * @property {number}   accessCount - how many times retrieved
 */

class VectorMemory242 {
  constructor() {
    /** @type {Map<string, MemoryEntry242>} */
    this._store242      = new Map();
    this._insertOrder242 = [];   // FIFO eviction queue (array of keys in order)
    this._searchCount242  = 0;
    this._storeCount242   = 0;
    this._hitCount242     = 0;
  }

  /**
   * Store (or overwrite) a vector with key and metadata.
   * @param {string}   key
   * @param {number[]} vector
   * @param {object}   [meta]
   * @returns {{ key: string, dim: number, storedAt: number }}
   */
  storeMemory242(key, vector, meta = {}) {
    if (!key || typeof key !== 'string') throw new Error('vectorMemory242: key must be a non-empty string');
    if (!Array.isArray(vector) && !(vector instanceof Float32Array)) {
      throw new Error('vectorMemory242: vector must be an array of numbers');
    }
    const v = Array.isArray(vector) ? vector : Array.from(vector);
    if (v.length === 0) throw new Error('vectorMemory242: vector must have length > 0');
    if (v.length > VECTOR_MEM_DIM_WARN_242) {
      // High-dim vectors accepted but warn
    }

    const now = Date.now();
    const existing = this._store242.has(key);

    /** @type {MemoryEntry242} */
    const entry = {
      key,
      vector:      v,
      _normalized: normalizeVec242(v),
      meta:        { ...meta },
      storedAt:    now,
      accessCount: 0,
    };

    this._store242.set(key, entry);

    if (!existing) {
      // FIFO eviction
      if (this._insertOrder242.length >= VECTOR_MEM_MAX_ENTRIES_242) {
        const evictKey = this._insertOrder242.shift();
        this._store242.delete(evictKey);
      }
      this._insertOrder242.push(key);
    }

    this._storeCount242++;
    return { key, dim: v.length, storedAt: now };
  }

  /**
   * Search for the topK most similar entries to queryVector.
   * Uses cosine similarity on pre-normalized vectors (O(n·d)).
   * @param {number[]} queryVector
   * @param {number}   [topK]
   * @param {object}   [opts]
   * @param {number}   [opts.minScore]   - minimum cosine score (default 0)
   * @param {object}   [opts.metaFilter] - exact-match filter on meta fields
   * @returns {Array<{ key, score, meta, storedAt }>}
   */
  searchMemory242(queryVector, topK = VECTOR_MEM_DEFAULT_TOPK_242, opts = {}) {
    if (!Array.isArray(queryVector) && !(queryVector instanceof Float32Array)) {
      throw new Error('vectorMemory242: queryVector must be an array');
    }
    const qv = Array.isArray(queryVector) ? queryVector : Array.from(queryVector);
    const k  = Math.min(Math.max(1, topK | 0), VECTOR_MEM_MAX_TOPK_242);
    const { minScore = 0, metaFilter } = opts;
    const qNorm = normalizeVec242(qv);

    this._searchCount242++;

    const results = [];
    for (const entry of this._store242.values()) {
      // Meta filter (exact-match on all specified keys)
      if (metaFilter) {
        let pass = true;
        for (const [mk, mv] of Object.entries(metaFilter)) {
          if (entry.meta[mk] !== mv) { pass = false; break; }
        }
        if (!pass) continue;
      }

      // Dimension mismatch: pad shorter with zeros or truncate
      const ev = entry._normalized;
      const score = cosine242(qNorm, ev);
      if (score >= minScore) results.push({ key: entry.key, score, meta: entry.meta, storedAt: entry.storedAt });
    }

    // Sort descending by score, take topK
    results.sort((a, b) => b.score - a.score);
    const top = results.slice(0, k);

    // Update access counts
    top.forEach(r => {
      const e = this._store242.get(r.key);
      if (e) { e.accessCount++; this._hitCount242++; }
    });

    return top;
  }

  /**
   * Get a single entry by key.
   * @param {string} key
   * @returns {MemoryEntry242|null}
   */
  getMemory242(key) {
    const e = this._store242.get(key);
    if (!e) return null;
    e.accessCount++;
    return { key: e.key, vector: e.vector, meta: e.meta, storedAt: e.storedAt, accessCount: e.accessCount };
  }

  /**
   * Delete an entry.
   * @param {string} key
   * @returns {boolean} - true if deleted
   */
  deleteMemory242(key) {
    const existed = this._store242.delete(key);
    if (existed) {
      const idx = this._insertOrder242.indexOf(key);
      if (idx !== -1) this._insertOrder242.splice(idx, 1);
    }
    return existed;
  }

  /**
   * Delete all entries matching a meta filter.
   * @param {object} metaFilter
   * @returns {number} - count deleted
   */
  deleteByMeta242(metaFilter) {
    let count = 0;
    for (const [key, entry] of this._store242.entries()) {
      let match = true;
      for (const [mk, mv] of Object.entries(metaFilter)) {
        if (entry.meta[mk] !== mv) { match = false; break; }
      }
      if (match) { this._store242.delete(key); count++; }
    }
    this._insertOrder242 = this._insertOrder242.filter(k => this._store242.has(k));
    return count;
  }

  /**
   * List all keys (optionally filtered by meta).
   * @param {object} [metaFilter]
   * @param {number} [limit]
   * @returns {string[]}
   */
  listKeys242(metaFilter, limit = 200) {
    const keys = [];
    for (const [key, entry] of this._store242.entries()) {
      if (metaFilter) {
        let pass = true;
        for (const [mk, mv] of Object.entries(metaFilter)) {
          if (entry.meta[mk] !== mv) { pass = false; break; }
        }
        if (!pass) continue;
      }
      keys.push(key);
      if (keys.length >= limit) break;
    }
    return keys;
  }

  /** Get usage stats. */
  getStats242() {
    const sizes = [];
    for (const e of this._store242.values()) sizes.push(e.vector.length);
    const avgDim = sizes.length > 0 ? Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length) : 0;
    return {
      entryCount:   this._store242.size,
      maxEntries:   VECTOR_MEM_MAX_ENTRIES_242,
      storeCount:   this._storeCount242,
      searchCount:  this._searchCount242,
      hitCount:     this._hitCount242,
      avgDimension: avgDim,
      indexVersion: VECTOR_MEM_INDEX_VERSION_242,
    };
  }

  /** Clear all entries (useful for testing). */
  clear242() {
    this._store242.clear();
    this._insertOrder242 = [];
  }

  /** Graceful shutdown — alias for clear. */
  shutdown() { this.clear242(); }
}

// ── Exposed math helpers (for unit tests and discoverTools237 reuse) ─────────
const defaultVectorMemory242 = new VectorMemory242();
module.exports = {
  VectorMemory242, defaultVectorMemory242,
  cosine242, dot242, norm242, normalizeVec242,
  VECTOR_MEM_MAX_ENTRIES_242, VECTOR_MEM_DEFAULT_TOPK_242,
  VECTOR_MEM_MAX_TOPK_242, VECTOR_MEM_DIM_WARN_242, VECTOR_MEM_INDEX_VERSION_242,
};
