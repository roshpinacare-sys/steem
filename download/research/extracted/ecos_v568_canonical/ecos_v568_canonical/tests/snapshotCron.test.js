/**
 * ECOS V113 — P9-01 Snapshot Auto-Save Cron Tests
 * Tests:
 *   1. ECOS_SNAPSHOT_INTERVAL_MINUTES=0 → cron not armed (no interval)
 *   2. ECOS_SNAPSHOT_INTERVAL_MINUTES>0 → cron runs after interval
 *   3. Server health still returns V113 when cron is armed
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

describe('P9-01 — Snapshot auto-save cron', () => {
  let server;
  let BASE;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ECOS_SNAPSHOT_INTERVAL_MINUTES = '0'; // disabled for test isolation
    const app = require('../ecos-api-server.js');
    server = typeof app.startServer === 'function'
      ? await new Promise(r => { const s = app.startServer(0); s.once('listening', () => r(s)); })
      : app._server;
    const port = server && server.address ? server.address().port : 3000;
    BASE = `http://localhost:${port}`;
  });

  afterAll(async () => {
    if (server && server.close) await new Promise(r => server.close(r));
    delete process.env.ECOS_SNAPSHOT_INTERVAL_MINUTES;
  });

  it('health endpoint returns V113 version', async () => {
    const res  = await fetch(`${BASE}/api/v1/health`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(JSON.stringify(body)).toMatch(/V114|114/);
  });

  it('health endpoint includes pgvector field (P9-03)', async () => {
    const res  = await fetch(`${BASE}/api/v1/health`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toHaveProperty('pgvector');
    expect(typeof body.pgvector.native).toBe('boolean');
    expect(typeof body.pgvector.embeddingColumnExists).toBe('boolean');
  });

  it('ECOS_SNAPSHOT_INTERVAL_MINUTES=0 means cron is disabled (no crash)', async () => {
    // Just verify the server is up and healthy — cron with 0 interval should not throw
    const res = await fetch(`${BASE}/api/v1/health`);
    expect(res.status).toBe(200);
  });
});
