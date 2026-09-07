/**
 * missionDashboard.test.js — V103-P3
 * Integration tests for GET /api/v1/missions/dashboard endpoint.
 *
 * Verifies:
 *   - 200 status with correct top-level shape
 *   - All numeric counters are non-negative integers
 *   - totalMissions === pending + approved + rejected (statuses exhaustive)
 *   - autoFlow + hitlQueue === totalMissions
 *   - blocked is a non-negative integer ≤ totalMissions
 *   - avgConfidence is null or a number in [0, 1]
 *   - chainIntact is a boolean
 *   - topClients is an array with at most 5 entries
 *   - Each topClient has clientAccountId (string) and missionCount (positive integer)
 *   - generatedAt is a valid ISO 8601 timestamp
 *   - ecosVersion is "V103"
 *   - Counters update correctly after submitting tasks
 *
 * Run: npx vitest run tests/missionDashboard.test.js
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import os   from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

// Isolate approvals log so tests don't pollute production data
const approvalsLogPath = path.join(
  os.tmpdir(),
  `ecos-dashboard-test-${process.pid}.ndjson`
);
process.env.ECOS_APPROVALS_LOG = approvalsLogPath;

let listener;
let BASE;

beforeAll(async () => {
  const serverModule = require('../ecos-api-server.js');
  listener = serverModule.startServer(0);
  await new Promise(resolve => listener.once('listening', resolve));
  const { port } = listener.address();
  BASE = `http://127.0.0.1:${port}`;
}, 15000);

afterAll(async () => {
  if (listener) await new Promise(r => listener.close(r));
});

describe('GET /api/v1/missions/dashboard — V103', () => {
  it('returns 200 with correct top-level shape', async () => {
    const res  = await fetch(`${BASE}/api/v1/missions/dashboard`);
    const body = await res.json();
    expect(res.status).toBe(200);

    expect(typeof body.totalMissions).toBe('number');
    expect(typeof body.pending).toBe('number');
    expect(typeof body.approved).toBe('number');
    expect(typeof body.rejected).toBe('number');
    expect(typeof body.blocked).toBe('number');
    expect(typeof body.autoFlow).toBe('number');
    expect(typeof body.hitlQueue).toBe('number');
    expect(typeof body.chainIntact).toBe('boolean');
    expect(Array.isArray(body.topClients)).toBe(true);
    expect(typeof body.generatedAt).toBe('string');
    expect(body.ecosVersion).toBe('V103');
  });

  it('all counters are non-negative integers', async () => {
    const body = await fetch(`${BASE}/api/v1/missions/dashboard`).then(r => r.json());
    const intFields = ['totalMissions', 'pending', 'approved', 'rejected', 'blocked', 'autoFlow', 'hitlQueue'];
    for (const f of intFields) {
      expect(body[f]).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(body[f])).toBe(true);
    }
  });

  it('status counts are exhaustive: pending + approved + rejected === totalMissions', async () => {
    const body = await fetch(`${BASE}/api/v1/missions/dashboard`).then(r => r.json());
    expect(body.pending + body.approved + body.rejected).toBe(body.totalMissions);
  });

  it('verdict counts are exhaustive: autoFlow + hitlQueue === totalMissions', async () => {
    const body = await fetch(`${BASE}/api/v1/missions/dashboard`).then(r => r.json());
    expect(body.autoFlow + body.hitlQueue).toBe(body.totalMissions);
  });

  it('blocked is a non-negative integer no greater than totalMissions', async () => {
    const body = await fetch(`${BASE}/api/v1/missions/dashboard`).then(r => r.json());
    expect(body.blocked).toBeGreaterThanOrEqual(0);
    expect(body.blocked).toBeLessThanOrEqual(body.totalMissions);
  });

  it('avgConfidence is null or a number in [0, 1]', async () => {
    const body = await fetch(`${BASE}/api/v1/missions/dashboard`).then(r => r.json());
    if (body.avgConfidence !== null) {
      expect(typeof body.avgConfidence).toBe('number');
      expect(body.avgConfidence).toBeGreaterThanOrEqual(0);
      expect(body.avgConfidence).toBeLessThanOrEqual(1);
    }
  });

  it('chainIntact is boolean true on a fresh chain', async () => {
    const body = await fetch(`${BASE}/api/v1/missions/dashboard`).then(r => r.json());
    expect(body.chainIntact).toBe(true);
  });

  it('topClients has at most 5 entries', async () => {
    const body = await fetch(`${BASE}/api/v1/missions/dashboard`).then(r => r.json());
    expect(body.topClients.length).toBeLessThanOrEqual(5);
  });

  it('each topClient has clientAccountId (string) and missionCount (positive integer)', async () => {
    // Submit a task to create at least one entry
    await fetch(`${BASE}/api/v1/task`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientAccountId: 'client::dashboard-test',
        priceUsd: '1.00',
        rawConfidence: 0.85,
        aiOutput: { result: 'dashboard test output' },
        taskType: 'default',
      }),
    });

    const body = await fetch(`${BASE}/api/v1/missions/dashboard`).then(r => r.json());
    for (const client of body.topClients) {
      expect(typeof client.clientAccountId).toBe('string');
      expect(typeof client.missionCount).toBe('number');
      expect(client.missionCount).toBeGreaterThan(0);
      expect(Number.isInteger(client.missionCount)).toBe(true);
    }
  });

  it('totalMissions increases after a new task is submitted', async () => {
    const before = await fetch(`${BASE}/api/v1/missions/dashboard`).then(r => r.json());

    await fetch(`${BASE}/api/v1/task`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientAccountId: 'client::dashboard-counter-test',
        priceUsd: '2.00',
        rawConfidence: 0.75,
        aiOutput: { result: 'counter increment test' },
        taskType: 'default',
      }),
    });

    const after = await fetch(`${BASE}/api/v1/missions/dashboard`).then(r => r.json());
    expect(after.totalMissions).toBeGreaterThan(before.totalMissions);
  });

  it('generatedAt is a valid ISO 8601 timestamp', async () => {
    const body = await fetch(`${BASE}/api/v1/missions/dashboard`).then(r => r.json());
    expect(new Date(body.generatedAt).toISOString()).toBe(body.generatedAt);
  });
});
