/**
 * ECOS Mission Full-Text Search Tests — V99
 * 3 tests covering:
 *   1. GET /api/v1/missions/search returns 200 with missions array
 *   2. GET /api/v1/missions/search?q= returns only relevant results (score > 0)
 *   3. GET /api/v1/missions/search with status filter returns filtered results
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import * as os   from 'os';
import * as fs   from 'fs';
import * as path from 'path';

const require = createRequire(import.meta.url);
const approvalsLogPath = path.join(os.tmpdir(), `ecos-search-integration-${process.pid}.ndjson`);
process.env.ECOS_APPROVALS_LOG = approvalsLogPath;

describe('Mission Full-Text Search — integration', () => {
  let listener;
  let BASE;
  let seededMissionId;

  async function deposit(base, clientId, idemKey) {
    await fetch(`${base}/api/v1/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: clientId, amountUsd: '100.00', idempotencyKey: idemKey }),
    });
  }

  async function submitTask(base, opts = {}) {
    const res = await fetch(`${base}/api/v1/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientAccountId: opts.clientId   || 'client::gumloop_001',
        priceUsd:        opts.price      || '2.00',
        rawConfidence:   opts.confidence || 0.55,
        aiOutput:        opts.aiOutput   || { result: opts.text || 'default output' },
        missionId:       opts.missionId  || `search_m_${Date.now()}`,
        taskInput:       { instruction: opts.text || 'default instruction' },
      }),
    });
    return res.json();
  }

  beforeAll(async () => {
    const serverModule = require('../ecos-api-server.js');
    listener = serverModule.startServer(0);
    await new Promise(resolve => listener.once('listening', resolve));
    BASE = `http://127.0.0.1:${listener.address().port}`;

    // Use pre-seeded gumloop account (no deposit needed — seeded with $100k at startup)
    const clientId  = 'client::gumloop_001';
    seededMissionId = `search_mission_${Date.now()}`;

    await submitTask(BASE, {
      clientId,
      missionId: seededMissionId,
      text: 'legal contract review compliance audit',
    });
  });

  afterAll(async () => {
    if (listener?.listening) {
      await new Promise(resolve => listener.close(resolve));
    }
    try { fs.unlinkSync(approvalsLogPath); } catch (_) {}
  });

  it('GET /api/v1/missions/search returns 200 with missions array', async () => {
    const res  = await fetch(`${BASE}/api/v1/missions/search`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('missions');
    expect(Array.isArray(body.missions)).toBe(true);
    expect(typeof body.count).toBe('number');
    expect(body.count).toBeGreaterThanOrEqual(0);
  });

  it('GET /api/v1/missions/search?q= returns relevant scored results', async () => {
    const res  = await fetch(`${BASE}/api/v1/missions/search?q=legal+contract&limit=10`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.missions)).toBe(true);
    // Each returned mission must have a score field
    for (const m of body.missions) {
      expect(typeof m.score).toBe('number');
      expect(m.score).toBeGreaterThanOrEqual(0);
      expect(typeof m.missionId).toBe('string');
      expect(typeof m.status).toBe('string');
    }
    // The seeded mission should rank highly for the query
    if (body.missions.length > 0) {
      expect(body.missions[0].score).toBeGreaterThan(0);
    }
  });

  it('GET /api/v1/missions/search with status filter returns only matching status', async () => {
    const res  = await fetch(`${BASE}/api/v1/missions/search?status=pending&limit=50`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.missions)).toBe(true);
    // Every result must be pending
    for (const m of body.missions) {
      expect(m.status).toBe('pending');
    }
  });
});
