'use strict';
/**
 * Tests for MemorySubstrate V109 additions:
 *   - pgvector backend (mocked pool)
 *   - Memory mutation audit trail (setAuditLog)
 *   - getEntry() and delete()
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { MemorySubstrate, cosine, heuristicEmbed } = await import('../lib/memorySubstrate.js');

// ── pgvector backend — ingest ────────────────────────────────────────────────

describe('MemorySubstrate pgvector backend — ingest', () => {
  it('writes to memory_entries table when backend=pgvector + pool set', async () => {
    const queries = [];
    const fakePool = {
      query: async (sql, params) => { queries.push({ sql, params }); return {}; },
    };

    const mem = new MemorySubstrate({ backend: 'pgvector', pool: fakePool });
    const result = await mem.ingest({
      scope: 'agent', ownerId: 'agent-1', content: 'hello world',
    });

    expect(result.id).toMatch(/^mem::/);
    const pgInsert = queries.find(q => q.sql.includes('memory_entries'));
    expect(pgInsert).toBeTruthy();
    expect(pgInsert.params[1]).toBe('agent');   // scope
    expect(pgInsert.params[2]).toBe('agent-1'); // owner_id
  });

  it('also stores in in-memory store when pgvector backend active', async () => {
    const fakePool = { query: async () => ({}) };
    const mem = new MemorySubstrate({ backend: 'pgvector', pool: fakePool });

    await mem.ingest({ scope: 'agent', ownerId: 'a1', content: 'test' });
    const stats = mem.stats();
    expect(stats.agent).toBe(1);
  });

  it('falls back gracefully when pgvector insert throws', async () => {
    const fakePool = {
      query: async () => { throw new Error('pgvector unavailable'); },
    };
    const mem = new MemorySubstrate({ backend: 'pgvector', pool: fakePool });
    // Should not throw — in-memory entry retained
    await expect(mem.ingest({ scope: 'global', ownerId: 'sys', content: 'test' })).resolves.toBeDefined();
    expect(mem.stats().global).toBe(1);
  });

  it('does not write to DB when backend=in-memory (default)', async () => {
    const queries = [];
    const fakePool = { query: async (sql, p) => { queries.push(sql); return {}; } };
    const mem = new MemorySubstrate({ pool: fakePool }); // backend defaults to 'in-memory'
    await mem.ingest({ scope: 'user', ownerId: 'u1', content: 'hi' });
    const memInsert = queries.find(q => q.includes('memory_entries'));
    expect(memInsert).toBeFalsy();
  });
});

// ── pgvector backend — retrieve ────────────────────────────────────────────────

describe('MemorySubstrate pgvector backend — retrieve', () => {
  it('queries memory_entries table on retrieve with pgvector backend', async () => {
    const queries = [];
    const fakePool = {
      query: async (sql, params) => {
        queries.push({ sql, params });
        if (sql.includes('SELECT') && sql.includes('memory_entries')) {
          const vec = heuristicEmbed('hello world');
          return {
            rows: [{
              id:          'mem::abc',
              scope:       'agent',
              owner_id:    'a1',
              content:     'hello world',
              vector_json: vec,
              metadata:    {},
              importance:  0.5,
              access_count: 0,
              created_at:  new Date().toISOString(),
              accessed_at: new Date().toISOString(),
            }],
          };
        }
        return { rows: [] };
      },
    };

    const mem = new MemorySubstrate({ backend: 'pgvector', pool: fakePool });
    const results = await mem.retrieve({ query: 'hello world', topK: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe('mem::abc');
    const selectQ = queries.find(q => q.sql.includes('SELECT') && q.sql.includes('memory_entries'));
    expect(selectQ).toBeTruthy();
  });

  it('falls back to in-memory on pgvector retrieve error', async () => {
    let callCount = 0;
    const fakePool = {
      query: async (sql) => {
        callCount++;
        if (sql.includes('SELECT')) throw new Error('pgvector unavailable');
        return {};
      },
    };
    const mem = new MemorySubstrate({ backend: 'pgvector', pool: fakePool });
    await mem.ingest({ scope: 'agent', ownerId: 'a1', content: 'hello pgvector fallback' });
    // Should not throw
    const results = await mem.retrieve({ query: 'hello pgvector' });
    expect(Array.isArray(results)).toBe(true);
  });

  it('applies scope filter in pgvector query', async () => {
    let capturedParams = null;
    const fakePool = {
      query: async (sql, params) => {
        if (sql.includes('SELECT')) capturedParams = params;
        return { rows: [] };
      },
    };
    const mem = new MemorySubstrate({ backend: 'pgvector', pool: fakePool });
    await mem.retrieve({ query: 'test', scope: 'workspace' });
    expect(capturedParams).toBeTruthy();
    expect(capturedParams).toContain('workspace');
  });
});

// ── Memory audit trail ────────────────────────────────────────────────────────

describe('MemorySubstrate audit trail (setAuditLog)', () => {
  it('emits MEMORY_INGEST when auditLog is wired', async () => {
    const events = [];
    const fakeAuditLog = {
      append: (type, payload) => events.push({ type, payload }),
    };

    const mem = new MemorySubstrate();
    mem.setAuditLog(fakeAuditLog);
    await mem.ingest({ scope: 'agent', ownerId: 'a1', content: 'hello audit trail' });

    expect(events.length).toBe(1);
    expect(events[0].type).toBe('MEMORY_INGEST');
    expect(events[0].payload.scope).toBe('agent');
    expect(events[0].payload.ownerId).toBe('a1');
    expect(typeof events[0].payload.contentHash).toBe('string');
    expect(events[0].payload.contentHash).toHaveLength(64);
  });

  it('does not include raw content in audit entry (only hash)', async () => {
    const events = [];
    const fakeAuditLog = { append: (t, p) => events.push(p) };

    const mem = new MemorySubstrate();
    mem.setAuditLog(fakeAuditLog);
    const sensitiveContent = 'SSN: 123-45-6789 PII data';
    await mem.ingest({ scope: 'user', ownerId: 'u1', content: sensitiveContent });

    expect(JSON.stringify(events)).not.toContain(sensitiveContent);
    expect(events[0].contentHash).toBeTruthy(); // hash is present
  });

  it('does not throw when auditLog.append throws (non-fatal)', async () => {
    const fakeAuditLog = { append: () => { throw new Error('audit write failed'); } };
    const mem = new MemorySubstrate();
    mem.setAuditLog(fakeAuditLog);
    // Should not propagate
    await expect(mem.ingest({ scope: 'global', ownerId: 'sys', content: 'test' })).resolves.toBeDefined();
  });

  it('does not emit when auditLog not set', async () => {
    const mem = new MemorySubstrate();
    // No auditLog — should just work normally
    await expect(mem.ingest({ scope: 'agent', ownerId: 'a1', content: 'test' })).resolves.toBeDefined();
  });

  it('emits correct importance value', async () => {
    const events = [];
    const fakeAuditLog = { append: (t, p) => events.push(p) };
    const mem = new MemorySubstrate();
    mem.setAuditLog(fakeAuditLog);
    await mem.ingest({ scope: 'agent', ownerId: 'a1', content: 'test', importance: 0.9 });
    expect(events[0].importance).toBe(0.9);
  });
});

// ── getEntry() ────────────────────────────────────────────────────────────────

describe('MemorySubstrate.getEntry', () => {
  it('returns entry by id (without vector field)', async () => {
    const mem = new MemorySubstrate();
    const { id } = await mem.ingest({ scope: 'agent', ownerId: 'a1', content: 'findme' });
    const entry = mem.getEntry(id);
    expect(entry).toBeTruthy();
    expect(entry.id).toBe(id);
    expect(entry.content).toBe('findme');
    expect(entry.vector).toBeUndefined(); // vector stripped
  });

  it('returns null for unknown id', () => {
    const mem = new MemorySubstrate();
    expect(mem.getEntry('mem::nonexistent')).toBeNull();
  });
});

// ── delete() ──────────────────────────────────────────────────────────────────

describe('MemorySubstrate.delete', () => {
  it('removes entry from in-memory store', async () => {
    const mem = new MemorySubstrate();
    const { id } = await mem.ingest({ scope: 'agent', ownerId: 'a1', content: 'deleteme' });
    expect(mem.stats().agent).toBe(1);
    const deleted = await mem.delete(id);
    expect(deleted).toBe(true);
    expect(mem.stats().agent).toBe(0);
  });

  it('returns false for unknown id', async () => {
    const mem = new MemorySubstrate();
    const result = await mem.delete('mem::doesnotexist');
    expect(result).toBe(false);
  });

  it('issues DELETE to DB when pgvector backend active', async () => {
    const queries = [];
    const fakePool = { query: async (sql, p) => { queries.push({ sql, params: p }); return {}; } };
    const mem = new MemorySubstrate({ backend: 'pgvector', pool: fakePool });
    await mem.ingest({ scope: 'agent', ownerId: 'a1', content: 'test' });
    const { id } = (await mem.retrieve({ query: 'test', topK: 1 }))[0] || await (async () => {
      const stat = mem.stats();
      // get id from internal store
      for (const sm of mem._store.values()) for (const e of sm.values()) return e;
    })();
    // just get any inserted id
    const allIds = [];
    for (const sm of mem._store.values()) for (const e of sm.values()) allIds.push(e.id);
    const deleted = await mem.delete(allIds[0]);
    expect(deleted).toBe(true);
    const deleteQ = queries.find(q => q.sql.includes('DELETE') && q.sql.includes('memory_entries'));
    expect(deleteQ).toBeTruthy();
  });
});

// ── setPool / setAuditLog chaining ────────────────────────────────────────────

describe('MemorySubstrate setters', () => {
  it('setPool updates pool reference', () => {
    const mem = new MemorySubstrate();
    const pool = { query: async () => ({}) };
    mem.setPool(pool);
    expect(mem._pool).toBe(pool);
  });

  it('setAuditLog updates auditLog reference', () => {
    const mem = new MemorySubstrate();
    const al = { append: () => {} };
    mem.setAuditLog(al);
    expect(mem._auditLog).toBe(al);
  });
});
