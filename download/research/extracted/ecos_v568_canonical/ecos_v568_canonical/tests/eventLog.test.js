/**
 * ECOS MissionEventLog Tests — V99
 * ---------------------------------
 * 4 tests covering:
 *   1. In-memory mode (no dataDir) — backward-compatible behavior
 *   2. NDJSON file persistence — record() writes to disk
 *   3. GET /api/v1/events/replay — returns timeline for a known mission
 *   4. GET /api/v1/events/export — 200 + application/x-ndjson content-type
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fs      = require('fs');
const os      = require('os');
const path    = require('path');

// ── Test 1 + 2: Unit tests for MissionEventLog class ─────────────────────────
describe('MissionEventLog — persistence unit tests', () => {
  it('in-memory mode works without filePath', () => {
    // In-memory: no dataDir supplied
    const { MissionEventLog } = require('../lib/missionEventLog');
    const log = new MissionEventLog();
    expect(log._filePath).toBeNull();

    const ev = log.append('mission_test_mem', 'task.created', 'client::alice', { priceUsd: '5.00' });
    expect(ev.id).toMatch(/^mev_\d+$/);
    expect(ev.missionId).toBe('mission_test_mem');
    expect(ev.type).toBe('task.created');
    expect(log.countForMission('mission_test_mem')).toBe(1);
    expect(log.size()).toBe(1);
    // No file written
    expect(log._filePath).toBeNull();
  });

  it('record() appends to NDJSON file when dataDir provided', () => {
    // Use a tmp directory; set NODE_ENV != 'test' by temporarily overriding
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecos-eventlog-'));
    const savedEnv = process.env.NODE_ENV;

    try {
      process.env.NODE_ENV = 'development';  // enable file persistence
      const { MissionEventLog } = require('../lib/missionEventLog');
      const log = new MissionEventLog(tmpDir);

      expect(log._filePath).toBe(path.join(tmpDir, 'events.ndjson'));

      const ev = log.append('mission_file_test', 'task.created', 'client::bob', { priceUsd: '2.50' });
      expect(ev.type).toBe('task.created');

      // File must exist and contain a valid JSON line
      const filePath = path.join(tmpDir, 'events.ndjson');
      expect(fs.existsSync(filePath)).toBe(true);

      const contents = fs.readFileSync(filePath, 'utf8').trim();
      expect(contents.length).toBeGreaterThan(0);
      const parsed = JSON.parse(contents.split('\n')[0]);
      expect(parsed.missionId).toBe('mission_file_test');
      expect(parsed.type).toBe('task.created');
      expect(parsed.id).toMatch(/^mev_\d+$/);
    } finally {
      process.env.NODE_ENV = savedEnv;
      // cleanup
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
  });
});

// ── Test 3 + 4: Integration tests against live server ────────────────────────
const approvalsLogPath = path.join(os.tmpdir(), `ecos-eventlog-integration-${process.pid}.ndjson`);
process.env.ECOS_APPROVALS_LOG = approvalsLogPath;

describe('Event Log endpoints — integration', () => {
  let listener;
  let BASE;

  async function submitTask(base, { clientId = 'client::gumloop_004', missionId, idemKey } = {}) {
    const resp = await fetch(`${base}/api/v1/task`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientAccountId: clientId,
        priceUsd:        '1.00',
        rawConfidence:   0.55,
        aiOutput:        { result: 'Event log test output' },
        missionId:       missionId || `evlog_mission_${Date.now()}`,
        taskInput:       { instruction: 'Event log integration test' },
      }),
    });
    const data = await resp.json();
    return data;
  }

  beforeAll(async () => {
    const serverModule = require('../ecos-api-server.js');
    listener = serverModule.startServer(0);
    await new Promise(resolve => listener.once('listening', resolve));
    BASE = `http://127.0.0.1:${listener.address().port}`;
  });

  afterAll(async () => {
    if (listener?.listening) {
      await new Promise(resolve => listener.close(resolve));
    }
    try { fs.unlinkSync(approvalsLogPath); } catch (_) {}
  });

  it('GET /api/v1/events/replay returns timeline for known mission', async () => {
    const missionId = `replay_mission_${Date.now()}`;
    await submitTask(BASE, {
      clientId:  'client::gumloop_004',
      missionId,
    });

    const res  = await fetch(`${BASE}/api/v1/events/replay?missionId=${missionId}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.missionId).toBe(missionId);
    expect(Array.isArray(body.timeline)).toBe(true);
    expect(body.timeline.length).toBeGreaterThan(0);
    expect(body.summary).toBeDefined();
    expect(typeof body.summary.totalSteps).toBe('number');
    expect(typeof body.summary.durationMs).toBe('number');
    expect(body.summary.totalSteps).toBe(body.timeline.length);
    // First step has elapsed 0
    expect(body.timeline[0].elapsed).toBe(0);
    expect(typeof body.timeline[0].step).toBe('number');
    expect(typeof body.timeline[0].type).toBe('string');
  });

  it('GET /api/v1/events/export returns 200 with ndjson content-type', async () => {
    const res = await fetch(`${BASE}/api/v1/events/export`);
    expect(res.status).toBe(200);
    const ct = res.headers.get('content-type') || '';
    expect(ct).toContain('application/x-ndjson');
    // Read body — must be a string (even if empty)
    const text = await res.text();
    expect(typeof text).toBe('string');
  });
});
