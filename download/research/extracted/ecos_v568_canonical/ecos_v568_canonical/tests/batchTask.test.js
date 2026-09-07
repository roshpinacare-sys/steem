/**
 * ECOS Batch Task API Tests — V99
 * 4 tests covering:
 *   1. POST /api/v1/batch returns 400 if tasks not array
 *   2. POST /api/v1/batch returns 400 if tasks array empty
 *   3. POST /api/v1/batch returns 400 if tasks exceeds 20
 *   4. POST /api/v1/batch with valid tasks returns batchId + results
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import * as os   from 'os';
import * as fs   from 'fs';
import * as path from 'path';

const require = createRequire(import.meta.url);
const approvalsLogPath = path.join(os.tmpdir(), `ecos-batch-integration-${process.pid}.ndjson`);
process.env.ECOS_APPROVALS_LOG = approvalsLogPath;

describe('Batch Task API — integration', () => {
  let listener;
  let BASE;
  const CLIENT_ID = 'client::gumloop_002';

  async function post(base, url, body) {
    return fetch(`${base}${url}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
  }

  beforeAll(async () => {
    const serverModule = require('../ecos-api-server.js');
    listener = serverModule.startServer(0);
    await new Promise(resolve => listener.once('listening', resolve));
    BASE = `http://127.0.0.1:${listener.address().port}`;

    // Pre-fund via pre-seeded gumloop accounts (no deposit needed — $100k seeded at startup)
    // Re-map CLIENT_ID to use pre-seeded account
  });

  afterAll(async () => {
    if (listener?.listening) {
      await new Promise(resolve => listener.close(resolve));
    }
    try { fs.unlinkSync(approvalsLogPath); } catch (_) {}
  });

  it('POST /api/v1/batch returns 400 if tasks not an array', async () => {
    const res  = await post(BASE, '/api/v1/batch', { tasks: 'invalid' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/array/i);
  });

  it('POST /api/v1/batch returns 400 if tasks array is empty', async () => {
    const res  = await post(BASE, '/api/v1/batch', { tasks: [] });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/empty/i);
  });

  it('POST /api/v1/batch returns 400 if tasks exceeds 20', async () => {
    const bigTasks = Array.from({ length: 21 }, (_, i) => ({
      clientAccountId: CLIENT_ID,
      priceUsd: '1.00',
      message: `task ${i}`,
    }));
    const res  = await post(BASE, '/api/v1/batch', { tasks: bigTasks });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/maximum|exceeds/i);
  });

  it('POST /api/v1/batch with valid tasks returns batchId and results', async () => {
    const tasks = [
      { clientAccountId: CLIENT_ID, priceUsd: '1.00', message: 'Review this contract clause' },
      { clientAccountId: CLIENT_ID, priceUsd: '2.00', message: 'Verify compliance document'  },
      { clientAccountId: CLIENT_ID, priceUsd: '1.50', message: 'Summarize legal brief'        },
    ];

    const res  = await post(BASE, '/api/v1/batch', { tasks });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(typeof body.batchId).toBe('string');
    expect(body.batchId).toMatch(/^batch_/);

    expect(typeof body.processed).toBe('number');
    expect(body.processed).toBe(tasks.length);

    expect(Array.isArray(body.results)).toBe(true);
    expect(Array.isArray(body.errors)).toBe(true);

    expect(body.summary).toBeDefined();
    expect(typeof body.summary.autoFlow).toBe('number');
    expect(typeof body.summary.hitlQueue).toBe('number');
    expect(typeof body.summary.errors).toBe('number');

    // Total accounted for
    expect(body.results.length + body.errors.length).toBe(tasks.length);

    // Each result has required fields
    for (const r of body.results) {
      expect(typeof r.index).toBe('number');
      expect(['AUTO_FLOW', 'HITL_QUEUE']).toContain(r.verdict);
      expect(typeof r.approvalId).toBe('string');
      expect(typeof r.missionId).toBe('string');
    }
  });

  it('POST /api/v1/batch idempotency key deduplicates repeat requests', async () => {
    const tasks = [
      { clientAccountId: CLIENT_ID, priceUsd: '1.00', message: 'Idempotent batch task' },
    ];
    const idempotencyKey = `idem-batch-${Date.now()}`;

    // First call
    const res1  = await post(BASE, '/api/v1/batch', { tasks, idempotencyKey });
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(typeof body1.batchId).toBe('string');

    // Second call with same key
    const res2  = await post(BASE, '/api/v1/batch', { tasks, idempotencyKey });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();

    // Must return the same batchId (idempotent)
    expect(body2.batchId).toBe(body1.batchId);
  });
});
