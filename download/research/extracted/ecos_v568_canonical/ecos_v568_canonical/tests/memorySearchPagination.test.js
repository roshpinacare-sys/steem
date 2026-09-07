/**
 * ECOS V113 — P9-05 Memory Search Pagination Tests
 * Tests:
 *   1. GET /api/v1/memory/search?q=... returns ok, count, results, cursor, nextCursor, hasMore
 *   2. cursor=0 returns first page
 *   3. cursor>0 returns offset page
 *   4. limit param controls page size
 *   5. hasMore=false when at end of results
 *   6. Missing q returns 400
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

describe('P9-05 — Memory Search Pagination', () => {
  let server;
  let BASE;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const app = require('../ecos-api-server.js');
    server = typeof app.startServer === 'function'
      ? await new Promise(r => { const s = app.startServer(0); s.once('listening', () => r(s)); })
      : app._server;
    const port = server && server.address ? server.address().port : 3000;
    BASE = `http://localhost:${port}`;
  });

  afterAll(async () => {
    if (server && server.close) await new Promise(r => server.close(r));
  });

  it('returns pagination fields: cursor, nextCursor, hasMore, total', async () => {
    const res  = await fetch(`${BASE}/api/v1/memory/search?q=test`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.cursor).toBe('number');
    expect(typeof body.hasMore).toBe('boolean');
    expect(typeof body.total).toBe('number');
    expect(typeof body.count).toBe('number');
    expect(Array.isArray(body.results)).toBe(true);
  });

  it('cursor defaults to 0', async () => {
    const res  = await fetch(`${BASE}/api/v1/memory/search?q=test`);
    const body = await res.json();
    expect(body.cursor).toBe(0);
  });

  it('limit param controls page size', async () => {
    const res  = await fetch(`${BASE}/api/v1/memory/search?q=test&limit=1`);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.count).toBeLessThanOrEqual(1);
  });

  it('hasMore=false when empty result set', async () => {
    const res  = await fetch(`${BASE}/api/v1/memory/search?q=zzz_extremely_unlikely_query_xyzzy`);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
  });

  it('missing q returns 400', async () => {
    const res = await fetch(`${BASE}/api/v1/memory/search`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it('cursor=0 and cursor=page gives different starts', async () => {
    const r1 = await fetch(`${BASE}/api/v1/memory/search?q=test&cursor=0&limit=5`);
    const r2 = await fetch(`${BASE}/api/v1/memory/search?q=test&cursor=5&limit=5`);
    const b1 = await r1.json();
    const b2 = await r2.json();
    expect(b1.cursor).toBe(0);
    expect(b2.cursor).toBe(5);
    // Results should not overlap (or both empty)
    const ids1 = (b1.results || []).map(r => r.id);
    const ids2 = (b2.results || []).map(r => r.id);
    const overlap = ids1.filter(id => ids2.includes(id));
    expect(overlap.length).toBe(0);
  });
});
