/**
 * ECOS Export & Audit Report Tests — V113
 * 3 tests covering:
 *   1. GET /api/v1/export/audit-report returns 200 JSON with summary + missions
 *   2. GET /api/v1/export/audit-report?format=csv returns text/csv content-type
 *   3. GET /api/v1/export/audit-report?status=pending filters correctly
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import * as os   from 'os';
import * as fs   from 'fs';
import * as path from 'path';

const require = createRequire(import.meta.url);
const approvalsLogPath = path.join(os.tmpdir(), `ecos-audit-integration-${process.pid}.ndjson`);
process.env.ECOS_APPROVALS_LOG = approvalsLogPath;

describe('Export & Audit Report — integration', () => {
  let listener;
  let BASE;

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

    // Use pre-seeded gumloop account (no deposit needed — seeded with $100k at startup)
    await post(BASE, '/api/v1/task', {
      clientAccountId: 'client::gumloop_003',
      priceUsd:        '2.00',
      rawConfidence:   0.55,
      aiOutput:        { result: 'Audit report test' },
      missionId:       `audit_mission_${Date.now()}`,
      taskInput:       { instruction: 'Audit report integration test' },
    });
  });

  afterAll(async () => {
    if (listener?.listening) {
      await new Promise(resolve => listener.close(resolve));
    }
    try { fs.unlinkSync(approvalsLogPath); } catch (_) {}
  });

  it('GET /api/v1/export/audit-report returns 200 JSON with summary + missions', async () => {
    const res  = await fetch(`${BASE}/api/v1/export/audit-report`);
    expect(res.status).toBe(200);

    const ct = res.headers.get('content-type') || '';
    expect(ct).toContain('application/json');

    const body = await res.json();
    expect(body).toHaveProperty('generatedAt');
    expect(body).toHaveProperty('version', 'V114');
    expect(body).toHaveProperty('summary');
    expect(body).toHaveProperty('missions');
    expect(Array.isArray(body.missions)).toBe(true);

    const s = body.summary;
    expect(typeof s.totalMissions).toBe('number');
    expect(typeof s.totalApproved).toBe('number');
    expect(typeof s.totalRejected).toBe('number');
    expect(typeof s.totalPending).toBe('number');
    expect(typeof s.totalRevenue).toBe('string');
    expect(typeof s.chainLength).toBe('number');
    expect(typeof s.chainIntegrity).toBe('boolean');

    // At least the seeded mission should be there
    expect(body.missions.length).toBeGreaterThan(0);
    const m = body.missions[0];
    expect(typeof m.missionId).toBe('string');
    expect(typeof m.status).toBe('string');
    expect(typeof m.priceUsd).toBe('string');
  });

  it('GET /api/v1/export/audit-report?format=csv returns text/csv content-type', async () => {
    const res = await fetch(`${BASE}/api/v1/export/audit-report?format=csv`);
    expect(res.status).toBe(200);

    const ct = res.headers.get('content-type') || '';
    expect(ct).toContain('text/csv');

    const text = await res.text();
    expect(typeof text).toBe('string');
    // Must have a header row
    const firstLine = text.split('\n')[0];
    expect(firstLine).toContain('missionId');
    expect(firstLine).toContain('status');
    expect(firstLine).toContain('priceUsd');
  });

  it('GET /api/v1/export/audit-report?status=pending includes only pending missions', async () => {
    const res  = await fetch(`${BASE}/api/v1/export/audit-report?status=pending`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.missions)).toBe(true);
    for (const m of body.missions) {
      expect(m.status).toBe('pending');
    }
    // summary.totalMissions should match the filtered count
    expect(body.summary.totalMissions).toBe(body.missions.length);
  });
});
