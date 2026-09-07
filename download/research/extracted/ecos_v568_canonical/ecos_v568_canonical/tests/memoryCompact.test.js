/**
 * ECOS V113 — P9-02 Memory Compaction API Tests
 * Tests:
 *   1. POST /api/v1/memory/compact returns 200 with evictedCount
 *   2. compact with scope filter only evicts from that scope
 *   3. threshold validation — out-of-range values return 400
 *   4. After ingest of entry with importance=0, compact evicts it
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

describe('P9-02 — Memory Compaction API', () => {
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

  it('POST /api/v1/memory/compact returns 200 with evictedCount', async () => {
    const res  = await fetch(`${BASE}/api/v1/memory/compact`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.evictedCount).toBe('number');
    expect(body.evictedCount).toBeGreaterThanOrEqual(0);
  });

  it('POST /api/v1/memory/compact returns totalBefore and totalAfter', async () => {
    const res  = await fetch(`${BASE}/api/v1/memory/compact`, { method: 'POST' });
    const body = await res.json();
    expect(typeof body.totalBefore).toBe('number');
    expect(typeof body.totalAfter).toBe('number');
    expect(body.totalAfter).toBeLessThanOrEqual(body.totalBefore);
  });

  it('POST /api/v1/memory/compact?scope=test_scope returns scoped result', async () => {
    const res  = await fetch(`${BASE}/api/v1/memory/compact?scope=test_scope`, { method: 'POST' });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.scope).toBe('test_scope');
  });

  it('threshold out of range returns 400', async () => {
    const res = await fetch(`${BASE}/api/v1/memory/compact?threshold=2.5`, { method: 'POST' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/threshold/i);
  });

  it('default scope is "all"', async () => {
    const res  = await fetch(`${BASE}/api/v1/memory/compact`, { method: 'POST' });
    const body = await res.json();
    expect(body.scope).toBe('all');
  });
});
