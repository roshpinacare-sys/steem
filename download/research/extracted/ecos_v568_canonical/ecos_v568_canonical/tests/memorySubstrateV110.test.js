'use strict';
/**
 * Tests for MemorySubstrate V110 additions:
 *   - P8-01: Native pgvector <=> operator path (_pgRetrieveNative)
 *   - P8-01: _checkPgvectorNative() schema detection + caching
 *   - P8-01: _pgIngest() writes embedding column when available
 *   - P8-02: getEntryAsync() in-memory-first + DB fallback
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { MemorySubstrate, cosine, heuristicEmbed } = await import('../lib/memorySubstrate.js');

// ── Helper: build a fake pg.Pool ─────────────────────────────────────────────
function makePool(overrides = {}) {
  const queries = [];
  return {
    queries,
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (overrides.query) return overrides.query(sql, params);
      return { rows: [], rowCount: 0 };
    },
  };
}

// ── P8-01: _checkPgvectorNative — schema detection ────────────────────────────

describe('MemorySubstrate._checkPgvectorNative', () => {
  it('returns true when information_schema reports embedding column exists', async () => {
    const pool = makePool({
      query: async (sql) => {
        if (sql.includes('information_schema.columns')) {
          return { rows: [{ '?column?': 1 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });

    const mem = new MemorySubstrate({ backend: 'pgvector', pool });
    const result = await mem._checkPgvectorNative();
    expect(result).toBe(true);
  });

  it('returns false when embedding column absent', async () => {
    const pool = makePool({
      query: async () => ({ rows: [], rowCount: 0 }),
    });

    const mem = new MemorySubstrate({ backend: 'pgvector', pool });
    const result = await mem._checkPgvectorNative();
    expect(result).toBe(false);
  });

  it('caches the detection result after first call', async () => {
    let callCount = 0;
    const pool = makePool({
      query: async (sql) => {
        if (sql.includes('information_schema')) callCount++;
        return { rows: [], rowCount: 0 };
      },
    });

    const mem = new MemorySubstrate({ backend: 'pgvector', pool });
    await mem._checkPgvectorNative();
    await mem._checkPgvectorNative();
    await mem._checkPgvectorNative();

    // Schema query should only fire once
    expect(callCount).toBe(1);
  });

  it('resets cache after setPool()', async () => {
    let callCount = 0;
    const pool = makePool({
      query: async (sql) => {
        if (sql.includes('information_schema')) callCount++;
        return { rows: [], rowCount: 0 };
      },
    });

    const mem = new MemorySubstrate({ backend: 'pgvector', pool });
    await mem._checkPgvectorNative();
    expect(callCount).toBe(1);

    mem.setPool(pool); // resets _pgvectorNative to undefined
    await mem._checkPgvectorNative();
    expect(callCount).toBe(2);
  });

  it('returns false and does not throw when pool.query throws', async () => {
    const pool = makePool({
      query: async () => { throw new Error('pg unavailable'); },
    });

    const mem = new MemorySubstrate({ backend: 'pgvector', pool });
    const result = await mem._checkPgvectorNative();
    expect(result).toBe(false);
  });
});

// ── P8-01: _pgIngest — writes embedding column when native ────────────────────

describe('MemorySubstrate._pgIngest — native embedding column', () => {
  it('includes embedding parameter in INSERT when native=true', async () => {
    const queries = [];
    const pool = {
      queries,
      query: async (sql, params) => {
        queries.push({ sql, params });
        // schema check: respond with embedding column present
        if (sql.includes('information_schema')) {
          return { rows: [{}], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    };

    const mem = new MemorySubstrate({ backend: 'pgvector', pool });
    const vec  = heuristicEmbed('test content');
    const entry = {
      scope: 'agent', ownerId: 'a1', content: 'test',
      metadata: {}, importance: 0.5,
      createdAt: new Date().toISOString(),
      accessedAt: new Date().toISOString(),
    };

    await mem._pgIngest('mem::abc123', entry, vec);

    const insertQ = queries.find(q => q.sql.includes('INSERT INTO memory_entries'));
    expect(insertQ).toBeTruthy();
    expect(insertQ.sql).toContain('embedding');
    expect(insertQ.sql).toContain('::vector');
    // Vector literal should be in params as '[x,y,z,...]'
    const vectorParam = insertQ.params.find(p => typeof p === 'string' && p.startsWith('['));
    expect(vectorParam).toBeTruthy();
    expect(vectorParam).toMatch(/^\[[-\d.,e+]+\]$/);
  });

  it('omits embedding column in INSERT when native=false', async () => {
    const queries = [];
    const pool = {
      queries,
      query: async (sql, params) => {
        queries.push({ sql, params });
        // schema check: embedding column absent
        if (sql.includes('information_schema')) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    };

    const mem = new MemorySubstrate({ backend: 'pgvector', pool });
    const vec  = heuristicEmbed('test');
    const entry = {
      scope: 'agent', ownerId: 'a1', content: 'x',
      metadata: {}, importance: 0.5,
      createdAt: new Date().toISOString(),
      accessedAt: new Date().toISOString(),
    };

    await mem._pgIngest('mem::xyz', entry, vec);

    const insertQ = queries.find(q => q.sql.includes('INSERT INTO memory_entries'));
    expect(insertQ).toBeTruthy();
    expect(insertQ.sql).not.toContain('embedding');
  });
});

// ── P8-01: _pgRetrieveNative — uses <=> operator ──────────────────────────────

describe('MemorySubstrate._pgRetrieveNative', () => {
  it('executes ORDER BY embedding <=> query', async () => {
    const queries = [];
    const now = new Date().toISOString();
    const pool = {
      queries,
      query: async (sql, params) => {
        queries.push({ sql, params });
        if (sql.includes('ORDER BY embedding')) {
          return {
            rows: [{
              id: 'mem::native-1', scope: 'agent', owner_id: 'a1',
              content: 'semantic test', metadata: {}, importance: 0.8,
              access_count: 0, created_at: now, accessed_at: now,
              cosine_sim: 0.92,
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    };

    const mem   = new MemorySubstrate({ backend: 'pgvector', pool });
    const qVec  = heuristicEmbed('semantic test');
    const results = await mem._pgRetrieveNative({ queryVec: qVec, scope: 'agent', ownerId: 'a1', topK: 5, minScore: 0 });

    const retrieveQ = queries.find(q => q.sql.includes('ORDER BY embedding'));
    expect(retrieveQ).toBeTruthy();
    expect(retrieveQ.sql).toContain('<=>');
    expect(retrieveQ.params[0]).toMatch(/^\[/); // vector literal as first param
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('mem::native-1');
    expect(results[0]._native).toBe(true);
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('filters by scope and ownerId', async () => {
    let capturedSql = '';
    const now = new Date().toISOString();
    const pool = {
      query: async (sql, params) => {
        capturedSql = sql;
        return { rows: [], rowCount: 0 };
      },
    };

    const mem = new MemorySubstrate({ backend: 'pgvector', pool });
    await mem._pgRetrieveNative({
      queryVec: heuristicEmbed('x'), scope: 'workspace', ownerId: 'ws-1', topK: 10, minScore: 0,
    });

    expect(capturedSql).toContain('scope');
    expect(capturedSql).toContain('owner_id');
  });

  it('returns empty array when no rows match minScore threshold', async () => {
    const now = new Date().toISOString();
    const pool = {
      query: async (sql) => {
        if (sql.includes('ORDER BY embedding')) {
          return {
            rows: [{
              id: 'mem::low', scope: 'agent', owner_id: 'a1',
              content: 'unrelated', metadata: {}, importance: 0.1,
              access_count: 0, created_at: '2020-01-01T00:00:00Z', accessed_at: '2020-01-01T00:00:00Z',
              cosine_sim: 0.01,
            }],
          };
        }
        return { rows: [], rowCount: 0 };
      },
    };

    const mem     = new MemorySubstrate({ backend: 'pgvector', pool });
    const results = await mem._pgRetrieveNative({
      queryVec: heuristicEmbed('completely different'),
      scope: null, ownerId: null, topK: 5, minScore: 0.9,
    });

    expect(results).toHaveLength(0);
  });
});

// ── P8-01: retrieve() — dispatches to native vs JS path ──────────────────────

describe('MemorySubstrate.retrieve — native vs JS dispatch (P8-01)', () => {
  it('uses native path when embedding column exists', async () => {
    let usedNativePath = false;
    const now = new Date().toISOString();
    const pool = {
      query: async (sql, params) => {
        if (sql.includes('information_schema')) return { rows: [{}], rowCount: 1 };
        if (sql.includes('<=>')) { usedNativePath = true; return { rows: [], rowCount: 0 }; }
        return { rows: [], rowCount: 0 };
      },
    };

    const mem = new MemorySubstrate({ backend: 'pgvector', pool });
    await mem.retrieve({ query: 'hello world', topK: 5 });

    expect(usedNativePath).toBe(true);
  });

  it('uses JS cosine path when embedding column absent', async () => {
    let usedJSPath = false;
    const pool = {
      query: async (sql, params) => {
        if (sql.includes('information_schema')) return { rows: [], rowCount: 0 };
        if (sql.includes('vector_json') && !sql.includes('<=>')) {
          usedJSPath = true; return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    };

    const mem = new MemorySubstrate({ backend: 'pgvector', pool });
    await mem.retrieve({ query: 'hello world', topK: 5 });

    expect(usedJSPath).toBe(true);
  });

  it('falls back to in-memory when pgvector path throws', async () => {
    const pool = {
      query: async (sql) => {
        if (sql.includes('information_schema')) return { rows: [{}], rowCount: 1 };
        throw new Error('pgvector unavailable');
      },
    };

    const mem = new MemorySubstrate({ backend: 'pgvector', pool });
    await mem.ingest({ scope: 'agent', ownerId: 'a1', content: 'fallback test' });

    // Should NOT throw — falls through to in-memory
    await expect(mem.retrieve({ query: 'fallback test', topK: 5 })).resolves.toBeDefined();
  });
});

// ── P8-02: getEntryAsync — in-memory-first + DB fallback ──────────────────────

describe('MemorySubstrate.getEntryAsync (P8-02)', () => {
  it('returns in-memory entry immediately without hitting DB', async () => {
    const queries = [];
    const pool = makePool({
      query: async (sql, params) => {
        queries.push({ sql, params });
        return { rows: [], rowCount: 0 };
      },
    });

    const mem = new MemorySubstrate({ backend: 'pgvector', pool });
    const result = await mem.ingest({ scope: 'agent', ownerId: 'a1', content: 'cached entry' });
    const id = result.id;

    // Reset query log after ingest
    queries.length = 0;

    const entry = await mem.getEntryAsync(id);

    expect(entry).not.toBeNull();
    expect(entry.id).toBe(id);
    // Should NOT have hit DB for the getEntry lookup
    const selectQ = queries.find(q => q.sql.includes('SELECT') && q.sql.includes('memory_entries') && !q.sql.includes('information_schema'));
    expect(selectQ).toBeUndefined();
  });

  it('falls back to DB when entry not in memory', async () => {
    const now = new Date().toISOString();
    const fakeId = 'mem::db-only-9999';

    const pool = makePool({
      query: async (sql, params) => {
        if (sql.includes('WHERE id = $1')) {
          return {
            rows: [{
              id: fakeId, scope: 'user', owner_id: 'user-1',
              content: 'db-only content', metadata: {}, importance: '0.7',
              access_count: '3', created_at: now, accessed_at: now,
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });

    const mem = new MemorySubstrate({ backend: 'pgvector', pool });
    const entry = await mem.getEntryAsync(fakeId);

    expect(entry).not.toBeNull();
    expect(entry.id).toBe(fakeId);
    expect(entry.scope).toBe('user');
    expect(entry.ownerId).toBe('user-1');
    expect(entry.content).toBe('db-only content');
    expect(entry.importance).toBe(0.7);
    expect(entry.accessCount).toBe(3);
  });

  it('returns null when not found in memory or DB', async () => {
    const pool = makePool();
    const mem  = new MemorySubstrate({ backend: 'pgvector', pool });

    const entry = await mem.getEntryAsync('mem::nonexistent-xyz');
    expect(entry).toBeNull();
  });

  it('returns null and does not throw when DB lookup errors', async () => {
    const pool = makePool({
      query: async (sql) => {
        if (sql.includes('WHERE id = $1')) throw new Error('DB error');
        return { rows: [], rowCount: 0 };
      },
    });

    const mem   = new MemorySubstrate({ backend: 'pgvector', pool });
    const entry = await mem.getEntryAsync('mem::error-case');
    expect(entry).toBeNull();
  });

  it('skips DB when backend is in-memory', async () => {
    const queries = [];
    const pool    = makePool({ query: async (sql, p) => { queries.push(sql); return { rows: [], rowCount: 0 }; } });

    // backend=in-memory even though pool provided
    const mem = new MemorySubstrate({ backend: 'in-memory', pool });
    await mem.getEntryAsync('mem::never-in-db');

    const dbQuery = queries.find(q => q.includes('WHERE id = $1'));
    expect(dbQuery).toBeUndefined();
  });
});

// ── Backward compatibility: sync getEntry() unchanged ────────────────────────

describe('MemorySubstrate.getEntry (backward compat)', () => {
  it('still works synchronously for in-memory entries', async () => {
    const mem = new MemorySubstrate();
    const { id } = await mem.ingest({ scope: 'agent', ownerId: 'a1', content: 'sync test' });

    const entry = mem.getEntry(id); // sync — no await
    expect(entry).not.toBeNull();
    expect(entry.id).toBe(id);
  });

  it('returns null for unknown id', () => {
    const mem = new MemorySubstrate();
    expect(mem.getEntry('mem::does-not-exist')).toBeNull();
  });
});
