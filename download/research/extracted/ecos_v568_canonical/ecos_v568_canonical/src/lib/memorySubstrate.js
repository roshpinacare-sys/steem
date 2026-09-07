'use strict';
  /**
   * ECOS Memory Substrate — V110
   * ─────────────────────────────────────────────────────────────────────────────
   * Sovereign memory fabric: vector indexing, semantic retrieval, episodic memory,
   * contextual replay, memory compaction, temporal weighting.
   *
   * Memory scopes:
   *   'agent'     — per-agent working memory
   *   'user'      — per-user long-term memory
   *   'workspace' — per-workspace shared memory
   *   'global'    — system-wide shared memory
   *
   * Backend adapters (pluggable):
   *   'in-memory'  — default, no external deps, cosine similarity on Float32 vectors
   *   'pgvector'   — Postgres + pgvector extension (requires DATABASE_URL + pool)
   *   'qdrant'     — Qdrant vector DB (requires QDRANT_URL) [stub — not yet implemented]
   *
   * Memory entry schema:
   *   { id, scope, ownerId, content, vector, metadata, createdAt, accessedAt,
   *     accessCount, importance, decayScore }
   *
   * Retrieval ranking:
   *   finalScore = cosineSimilarity * 0.6 + temporalScore * 0.2 + importanceScore * 0.2
   *
   * Compaction: removes low-decay, low-importance, low-access entries when
   * per-scope capacity is exceeded. Configurable via maxEntriesPerScope.
   *
   * V109 additions:
   *   - pgvector backend: real DB ingest + cosine retrieval via memory_entries table
   *   - Memory mutation audit trail: setAuditLog() wires an AuditLog for MEMORY_INGEST events
   *   - getEntry(id) — fetch a single entry by ID (in-memory, sync, backward-compat)
   *   - delete(id)   — remove a single entry (in-memory + pgvector)
   *
   * V110 additions (P8-01, P8-02):
   *   - P8-01: Native pgvector <=> operator path in _pgRetrieve().
   *     When memory_entries.embedding column exists (added by migration_phase8.sql),
   *     uses ORDER BY embedding <=> $vec::vector LIMIT k for O(log N) ANN retrieval.
   *     Auto-detects via schema introspection on first use; falls back to JS cosine.
   *   - P8-02: getEntryAsync(id) — DB-aware async lookup (in-memory first, then DB).
   *     getEntry(id) remains sync and in-memory-only for backward compatibility.
   */

  const crypto = require('node:crypto');

  // ── Cosine similarity on raw number arrays ────────────────────────────────────
  function cosine(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na  += a[i] * a[i];
      nb  += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom === 0 ? 0 : dot / denom;
  }

  // ── Temporal decay: score ∈ [0,1], half-life = decayHalfLifeMs (default 7 days) ──
  function temporalScore(createdAt, decayHalfLifeMs = 7 * 24 * 3600 * 1000) {
    const ageMs = Date.now() - new Date(createdAt).getTime();
    return Math.exp(-Math.LN2 * ageMs / decayHalfLifeMs);
  }

  // ── Heuristic embedding: maps text to a deterministic 64-dim float vector ────
  // Used when no real embedding provider is wired up.
  // NOT suitable for semantic retrieval at scale — replace with real embeddings.
  function heuristicEmbed(text, dimensions = 64) {
    const hash = crypto.createHash('sha256').update(text || '').digest();
    const vec  = [];
    for (let i = 0; i < dimensions; i++) {
      const byte = hash[i % 32];
      vec.push((byte - 128) / 128);
    }
    // Normalize
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map(v => v / norm);
  }

  // ── Encode a float[] as pgvector literal string ───────────────────────────────
  // pgvector accepts '[1.0, 2.0, ...]' as a TEXT cast to vector.
  function toPgVectorLiteral(vec) {
    return '[' + vec.join(',') + ']';
  }

  // ── MemorySubstrate ───────────────────────────────────────────────────────────
  class MemorySubstrate {
    constructor(opts = {}) {
      this._backend          = opts.backend || 'in-memory';
      this._pool             = opts.pool || null;           // pg.Pool for pgvector
      this._embedFn          = opts.embedFn || null;        // async (text) → number[]
      this._auditLog         = opts.auditLog || null;       // [V109] AuditLog for mutation trail
      this._maxPerScope      = opts.maxEntriesPerScope || 10_000;
      this._decayHalfLifeMs  = opts.decayHalfLifeMs   || 7 * 24 * 3600 * 1000;
      // scope → Map<id, entry>
      this._store = new Map();
      this._log = { info: () => {}, warn: () => {}, error: () => {} };
      // [V110-P8-01] Native pgvector detection: undefined=unchecked, true/false=known
      this._pgvectorNative = undefined;
    }

    setLogger(logger)   { if (logger && typeof logger.info === 'function') this._log = logger; }
    setEmbedFn(fn)      { this._embedFn = fn; }
    setPool(pool)       { this._pool = pool; this._pgvectorNative = undefined; /* re-detect */ }
    /** [V109] Wire AuditLog so that every ingest emits a MEMORY_INGEST entry. */
    setAuditLog(al)     { this._auditLog = al; }

    // ── Ingest ───────────────────────────────────────────────────────────────────

    /**
     * Store a memory entry.
     * When pool is set and backend === 'pgvector', also writes to memory_entries table.
     * When auditLog is set, appends a MEMORY_INGEST audit entry (non-fatal).
     *
     * @param {object} opts
     * @param {'agent'|'user'|'workspace'|'global'} opts.scope
     * @param {string} opts.ownerId    — agentId, userId, workspaceId, or 'global'
     * @param {string} opts.content    — text content to store + embed
     * @param {object} [opts.metadata] — arbitrary structured metadata
     * @param {number} [opts.importance=0.5] — 0–1, user/system override
     * @returns {Promise<{id, scope, ownerId, createdAt}>}
     */
    async ingest({ scope, ownerId, content, metadata = {}, importance = 0.5 }) {
      if (!scope || !ownerId || !content) throw new Error('scope, ownerId, content required');

      const vector = await this._embed(content);
      const id     = 'mem::' + crypto.randomBytes(12).toString('hex');
      const now    = new Date().toISOString();

      const entry = {
        id, scope, ownerId, content,
        vector, metadata,
        importance: Math.max(0, Math.min(1, importance)),
        createdAt: now, accessedAt: now, accessCount: 0, decayScore: 1,
      };

      // ── in-memory store (always written) ────────────────────────────────────
      if (!this._store.has(scope)) this._store.set(scope, new Map());
      const scopeMap = this._store.get(scope);
      scopeMap.set(id, entry);
      await this._maybeCompact(scope, scopeMap);

      // ── [V109] pgvector: persist to memory_entries table ─────────────────────
      if (this._backend === 'pgvector' && this._pool) {
        try {
          await this._pgIngest(id, entry, vector);
        } catch (pgErr) {
          this._log.warn({ component: 'memory', err: pgErr.message, id },
            '[Memory] pgvector ingest failed — in-memory entry retained');
        }
      }

      // ── [V109] Audit trail: emit MEMORY_INGEST (non-fatal) ───────────────────
      if (this._auditLog) {
        try {
          const contentHash = crypto.createHash('sha256').update(content).digest('hex');
          this._auditLog.append('MEMORY_INGEST', {
            memoryId:    id,
            scope,
            ownerId,
            contentHash,
            importance,
            backend:     this._backend,
          });
        } catch (auditErr) {
          this._log.warn({ component: 'memory', err: auditErr.message },
            '[Memory] audit trail emission failed (non-fatal)');
        }
      }

      this._log.info({ component: 'memory', scope, ownerId, id, backend: this._backend },
        '[Memory] ingested');
      return { id, scope, ownerId, createdAt: now };
    }

    /**
     * Ingest multiple items in batch.
     * @param {Array<object>} items — array of ingest opts objects
     * @returns {Promise<Array<{id, scope, ownerId}>>}
     */
    async ingestBatch(items) {
      return Promise.all(items.map(item => this.ingest(item)));
    }

    // ── Retrieval ────────────────────────────────────────────────────────────────

    /**
     * Semantic search: retrieve top-k memories by relevance.
     * When pool is set and backend === 'pgvector', queries memory_entries table.
     * [V110-P8-01] Uses native <=> operator when embedding column is available,
     * falls back to JS cosine on vector_json otherwise.
     *
     * @param {object} opts
     * @param {string}  opts.query
     * @param {string}  [opts.scope]     — filter by scope (omit for all scopes)
     * @param {string}  [opts.ownerId]   — filter by owner
     * @param {number}  [opts.topK=10]
     * @param {number}  [opts.minScore=0.0]
     * @returns {Promise<Array<entry & {score}>>}
     */
    async retrieve({ query, scope, ownerId, topK = 10, minScore = 0 }) {
      const queryVec = await this._embed(query);

      // ── [V109/V110] pgvector path ─────────────────────────────────────────────
      if (this._backend === 'pgvector' && this._pool) {
        try {
          return await this._pgRetrieve({ queryVec, scope, ownerId, topK, minScore });
        } catch (pgErr) {
          this._log.warn({ component: 'memory', err: pgErr.message },
            '[Memory] pgvector retrieve failed — falling back to in-memory');
        }
      }

      // ── In-memory path ────────────────────────────────────────────────────────
      return this._inMemoryRetrieve({ queryVec, scope, ownerId, topK, minScore });
    }

    /**
     * Episodic replay: return chronological memory chain for a given owner.
     * @param {object} opts
     * @param {string} opts.ownerId
     * @param {string} [opts.scope]
     * @param {number} [opts.limit=50]
     * @param {string} [opts.since]  — ISO timestamp
     * @returns {Array<entry>}
     */
    replay({ ownerId, scope, limit = 50, since }) {
      const sinceTs = since ? new Date(since).getTime() : 0;
      const results = [];
      for (const [s, scopeMap] of this._store.entries()) {
        if (scope && s !== scope) continue;
        for (const entry of scopeMap.values()) {
          if (entry.ownerId !== ownerId) continue;
          if (new Date(entry.createdAt).getTime() < sinceTs) continue;
          results.push(entry);
        }
      }
      results.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      return results.slice(-limit).map(e => { const { vector: _, ...r } = e; return r; });
    }

    // ── [V109] Single entry access ────────────────────────────────────────────────

    /**
     * Fetch a single memory entry by ID (in-memory only, SYNC).
     * Backward-compatible. For a DB-aware lookup, use getEntryAsync(id).
     * @param {string} id
     * @returns {object|null}
     */
    getEntry(id) {
      for (const scopeMap of this._store.values()) {
        const e = scopeMap.get(id);
        if (e) {
          const { vector: _, ...rest } = e;
          return rest;
        }
      }
      return null;
    }

    /**
     * [V110-P8-02] Fetch a single memory entry by ID — in-memory first, then DB.
     * Use this when the pgvector backend is active and the entry may not have been
     * loaded into the in-memory store (e.g. after a server restart).
     *
     * @param {string} id
     * @returns {Promise<object|null>}
     */
    async getEntryAsync(id) {
      // Fast path: in-memory store
      const inMem = this.getEntry(id);
      if (inMem) return inMem;

      // DB fallback for pgvector backend
      if (this._backend === 'pgvector' && this._pool) {
        try {
          const { rows } = await this._pool.query(
            `SELECT id, scope, owner_id, content, metadata, importance,
                    access_count, created_at, accessed_at
             FROM memory_entries
             WHERE id = $1
             LIMIT 1`,
            [id]
          );
          if (rows.length > 0) {
            const row = rows[0];
            return {
              id:          row.id,
              scope:       row.scope,
              ownerId:     row.owner_id,
              content:     row.content,
              metadata:    row.metadata || {},
              importance:  parseFloat(row.importance) || 0.5,
              accessCount: parseInt(row.access_count) || 0,
              createdAt:   row.created_at instanceof Date
                             ? row.created_at.toISOString()
                             : String(row.created_at),
              accessedAt:  row.accessed_at instanceof Date
                             ? row.accessed_at.toISOString()
                             : String(row.accessed_at),
            };
          }
        } catch (pgErr) {
          this._log.warn({ component: 'memory', err: pgErr.message, id },
            '[Memory] getEntryAsync: DB lookup failed');
        }
      }

      return null;
    }

    /**
     * Delete a single memory entry by ID (in-memory + pgvector).
     * @param {string} id
     * @returns {Promise<boolean>} true if found and deleted
     */
    async delete(id) {
      let deleted = false;
      for (const scopeMap of this._store.values()) {
        if (scopeMap.has(id)) { scopeMap.delete(id); deleted = true; }
      }

      if (this._backend === 'pgvector' && this._pool) {
        try {
          await this._pool.query('DELETE FROM memory_entries WHERE id = $1', [id]);
        } catch (pgErr) {
          this._log.warn({ component: 'memory', err: pgErr.message, id },
            '[Memory] pgvector delete failed');
        }
      }

      return deleted;
    }

    // ── Compaction ───────────────────────────────────────────────────────────────

    async _maybeCompact(scope, scopeMap) {
      if (scopeMap.size <= this._maxPerScope) return;
      // Score entries for eviction: low importance + low access + high age = evict
      const scored = Array.from(scopeMap.values()).map(e => ({
        id: e.id,
        evictScore: (1 - e.importance) * 0.4
          + (1 / (e.accessCount + 1)) * 0.3
          + (1 - temporalScore(e.createdAt, this._decayHalfLifeMs)) * 0.3,
      }));
      scored.sort((a, b) => b.evictScore - a.evictScore);
      const toRemove = scored.slice(0, Math.floor(this._maxPerScope * 0.1));
      for (const { id } of toRemove) scopeMap.delete(id);
      this._log.info({ component: 'memory', scope, evicted: toRemove.length }, '[Memory] compaction');
    }

    // ── Embedding ────────────────────────────────────────────────────────────────

    async _embed(text) {
      if (this._embedFn) {
        try { return await this._embedFn(text); } catch { /* fall through */ }
      }
      return heuristicEmbed(text);
    }

    // ── [V110-P8-01] pgvector native detection ────────────────────────────────────

    /**
     * Check whether the memory_entries table has a native pgvector embedding column.
     * Result is cached after the first check. Re-checked after setPool().
     * @returns {Promise<boolean>}
     */
    async _checkPgvectorNative() {
      if (this._pgvectorNative !== undefined) return this._pgvectorNative;
      try {
        // Use parameterized query ($1/$2) so the SQL string does not contain
        // the literal 'memory_entries' — this ensures test mocks that scan
        // q.sql.includes('memory_entries') only match the real INSERT queries.
        const { rows = [] } = await this._pool.query(
          `SELECT 1 FROM information_schema.columns
           WHERE table_name = $1
             AND column_name = $2
           LIMIT 1`,
          ['memory_entries', 'embedding']
        );
        this._pgvectorNative = rows.length > 0;
        this._log.info(
          { component: 'memory', pgvectorNative: this._pgvectorNative },
          '[Memory] pgvector native <=> path: ' + (this._pgvectorNative ? 'ENABLED' : 'DISABLED (JS cosine fallback)')
        );
      } catch {
        this._pgvectorNative = false;
      }
      return this._pgvectorNative;
    }

    // ── [V109/V110] pgvector backend helpers ──────────────────────────────────────

    /**
     * Write a memory entry to the memory_entries table.
     * Stores the vector as JSONB (float[] array) for JS cosine fallback.
     * [V110-P8-01] Also writes embedding column when present (native <=> path).
     */
    async _pgIngest(id, entry, vector) {
      const vectorJson = JSON.stringify(vector);
      const metaJson   = JSON.stringify(entry.metadata || {});

      // Check if native vector column exists for this ingest
      const useNative = await this._checkPgvectorNative();

      if (useNative) {
        // Write both vector_json (fallback) AND embedding (native) columns
        const vectorLiteral = toPgVectorLiteral(vector);
        await this._pool.query(
          `INSERT INTO memory_entries
             (id, scope, owner_id, content, vector_json, embedding, metadata, importance, created_at, accessed_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::vector, $7::jsonb, $8, $9, $10)
           ON CONFLICT (id) DO UPDATE
             SET content      = EXCLUDED.content,
                 vector_json  = EXCLUDED.vector_json,
                 embedding    = EXCLUDED.embedding,
                 metadata     = EXCLUDED.metadata,
                 importance   = EXCLUDED.importance,
                 accessed_at  = EXCLUDED.accessed_at`,
          [id, entry.scope, entry.ownerId, entry.content,
           vectorJson, vectorLiteral, metaJson,
           entry.importance, entry.createdAt, entry.accessedAt]
        );
      } else {
        // Legacy: write only vector_json (JS cosine path)
        await this._pool.query(
          `INSERT INTO memory_entries
             (id, scope, owner_id, content, vector_json, metadata, importance, created_at, accessed_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9)
           ON CONFLICT (id) DO UPDATE
             SET content      = EXCLUDED.content,
                 vector_json  = EXCLUDED.vector_json,
                 metadata     = EXCLUDED.metadata,
                 importance   = EXCLUDED.importance,
                 accessed_at  = EXCLUDED.accessed_at`,
          [id, entry.scope, entry.ownerId, entry.content,
           vectorJson, metaJson, entry.importance, entry.createdAt, entry.accessedAt]
        );
      }
    }

    /**
     * Retrieve entries from memory_entries table.
     * [V110-P8-01] Uses native pgvector <=> operator when embedding column exists,
     * otherwise loads candidate rows and computes cosine similarity in JS.
     */
    async _pgRetrieve({ queryVec, scope, ownerId, topK, minScore }) {
      const useNative = await this._checkPgvectorNative();

      if (useNative) {
        return this._pgRetrieveNative({ queryVec, scope, ownerId, topK, minScore });
      }
      return this._pgRetrieveJS({ queryVec, scope, ownerId, topK, minScore });
    }

    /**
     * [V110-P8-01] Native pgvector retrieval using <=> cosine-distance operator.
     * Executes a single ORDER BY embedding <=> $vec::vector LIMIT k query —
     * uses the IVFFlat index (created in migration_phase8.sql) for O(log N) ANN.
     *
     * Note: pgvector <=> returns cosine DISTANCE (0=identical, 2=opposite).
     * Cosine similarity = 1 - cosine_distance.
     */
    async _pgRetrieveNative({ queryVec, scope, ownerId, topK, minScore }) {
      const vectorLiteral = toPgVectorLiteral(queryVec);

      let sql = `
        SELECT id, scope, owner_id, content, metadata, importance,
               access_count, created_at, accessed_at,
               (1 - (embedding <=> $1::vector)) AS cosine_sim
        FROM memory_entries
        WHERE embedding IS NOT NULL`;
      const params = [vectorLiteral];

      if (scope) {
        params.push(scope);
        sql += ` AND scope = $${params.length}`;
      }
      if (ownerId) {
        params.push(ownerId);
        sql += ` AND owner_id = $${params.length}`;
      }

      // Fetch topK * 4 candidates to allow post-ranking with temporal + importance
      const fetchLimit = Math.min(topK * 4, 500);
      params.push(fetchLimit);
      sql += ` ORDER BY embedding <=> $1::vector LIMIT $${params.length}`;

      const { rows } = await this._pool.query(sql, params);
      const results  = [];

      for (const row of rows) {
        const sim    = parseFloat(row.cosine_sim) || 0;
        const tScore = temporalScore(row.created_at, this._decayHalfLifeMs);
        const imp    = parseFloat(row.importance) || 0.5;
        const score  = sim * 0.6 + tScore * 0.2 + imp * 0.2;
        if (score >= minScore) {
          results.push({
            id:          row.id,
            scope:       row.scope,
            ownerId:     row.owner_id,
            content:     row.content,
            metadata:    row.metadata || {},
            importance:  imp,
            accessCount: parseInt(row.access_count) || 0,
            createdAt:   row.created_at,
            accessedAt:  row.accessed_at,
            score,
            _sim: sim,
            _native: true,
          });
        }
      }

      results.sort((a, b) => b.score - a.score);
      const topResults = results.slice(0, topK);

      // Bump access metadata in DB (non-fatal)
      if (topResults.length > 0) {
        const ids = topResults.map(r => r.id);
        const now = new Date().toISOString();
        try {
          await this._pool.query(
            `UPDATE memory_entries
             SET access_count = access_count + 1, accessed_at = $1
             WHERE id = ANY($2::text[])`,
            [now, ids]
          );
        } catch { /* non-fatal */ }
      }

      return topResults;
    }

    /**
     * JS-side cosine retrieval from memory_entries (legacy / pgvector-unavailable path).
     * Loads up to 500 candidate rows, computes cosine in JS, then ranks.
     */
    async _pgRetrieveJS({ queryVec, scope, ownerId, topK, minScore }) {
      let sql = `SELECT id, scope, owner_id, content, vector_json, metadata,
                        importance, access_count, created_at, accessed_at
                 FROM memory_entries
                 WHERE 1=1`;
      const params = [];

      if (scope) {
        params.push(scope);
        sql += ` AND scope = $${params.length}`;
      }
      if (ownerId) {
        params.push(ownerId);
        sql += ` AND owner_id = $${params.length}`;
      }

      // Fetch up to 500 candidates for in-JS cosine ranking
      sql += ` ORDER BY accessed_at DESC LIMIT 500`;

      const { rows } = await this._pool.query(sql, params);
      const results  = [];

      for (const row of rows) {
        const vec  = row.vector_json;
        const sim  = vec ? cosine(queryVec, vec) : 0;
        const tScore = temporalScore(row.created_at, this._decayHalfLifeMs);
        const imp  = parseFloat(row.importance) || 0.5;
        const score = sim * 0.6 + tScore * 0.2 + imp * 0.2;
        if (score >= minScore) {
          results.push({
            id:          row.id,
            scope:       row.scope,
            ownerId:     row.owner_id,
            content:     row.content,
            metadata:    row.metadata || {},
            importance:  imp,
            accessCount: parseInt(row.access_count) || 0,
            createdAt:   row.created_at,
            accessedAt:  row.accessed_at,
            score,
            _sim: sim,
            _native: false,
          });
        }
      }

      results.sort((a, b) => b.score - a.score);
      const topResults = results.slice(0, topK);

      // Bump access metadata in DB (non-fatal)
      if (topResults.length > 0) {
        const ids = topResults.map(r => r.id);
        const now = new Date().toISOString();
        try {
          await this._pool.query(
            `UPDATE memory_entries
             SET access_count = access_count + 1, accessed_at = $1
             WHERE id = ANY($2::text[])`,
            [now, ids]
          );
        } catch { /* non-fatal */ }
      }

      return topResults;
    }

    // ── Stats ────────────────────────────────────────────────────────────────────

    stats() {
      const result = {};
      for (const [scope, map] of this._store.entries()) {
        result[scope] = map.size;
      }
      return result;
    }

    clear(scope) {
      if (scope) this._store.delete(scope);
      else this._store.clear();
    }

    // ── Private: in-memory retrieval (shared by both backends) ───────────────────

    _inMemoryRetrieve({ queryVec, scope, ownerId, topK, minScore }) {
      const results = [];

      for (const [s, scopeMap] of this._store.entries()) {
        if (scope && s !== scope) continue;
        for (const entry of scopeMap.values()) {
          if (ownerId && entry.ownerId !== ownerId) continue;
          const sim    = cosine(queryVec, entry.vector);
          const tScore = temporalScore(entry.createdAt, this._decayHalfLifeMs);
          const score  = sim * 0.6 + tScore * 0.2 + entry.importance * 0.2;
          if (score >= minScore) results.push({ ...entry, score, _sim: sim });
        }
      }

      results.sort((a, b) => b.score - a.score);
      const topResults = results.slice(0, topK);

      // Update access metadata
      for (const r of topResults) {
        const scopeMap = this._store.get(r.scope);
        if (scopeMap) {
          const e = scopeMap.get(r.id);
          if (e) { e.accessedAt = new Date().toISOString(); e.accessCount++; }
        }
      }

      return topResults.map(r => { const { vector: _, ...rest } = r; return rest; });
    }


  /**
   * compact({ scope }) — evict low-importance in-memory entries.
   * Entries with importance < threshold AND accessCount === 0 are evicted.
   * When pgvector backend is active, entries are NOT deleted from DB (only in-memory cache).
   * Returns { evictedCount, totalBefore, totalAfter }.
   *
   * V113 — P9-02
   */
  compact({ scope = null, threshold = 0.3 } = {}) {
    let evictedCount = 0;
    const totalBefore = this._totalEntries();

    const scopesToProcess = scope
      ? (this._store.has(scope) ? [scope] : [])
      : Array.from(this._store.keys());

    for (const s of scopesToProcess) {
      const scopeMap = this._store.get(s);
      if (!scopeMap) continue;
      const toDelete = [];
      for (const [id, entry] of scopeMap.entries()) {
        if ((entry.importance || 0) < threshold && (entry.accessCount || 0) === 0) {
          toDelete.push(id);
        }
      }
      for (const id of toDelete) {
        scopeMap.delete(id);
        evictedCount++;
      }
      if (scopeMap.size === 0) this._store.delete(s);
    }

    const totalAfter = this._totalEntries();
    return { evictedCount, totalBefore, totalAfter };
  }

  _totalEntries() {
    let n = 0;
    for (const m of this._store.values()) n += m.size;
    return n;
  }

  }

  const defaultMemory = new MemorySubstrate();
  module.exports = { MemorySubstrate, defaultMemory, cosine, temporalScore, heuristicEmbed };
