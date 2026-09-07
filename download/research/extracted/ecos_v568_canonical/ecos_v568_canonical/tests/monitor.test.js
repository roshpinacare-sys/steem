/**
 * monitor.test.js — V89-P5 / V90-P3 / V95
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests for engine/monitor/index.js status HTTP server.
 *
 * test 1: "GET /monitor/status returns sseClients field"
 *   Start monitor on a random port (MONITOR_HTTP_PORT env).
 *   Fetch /monitor/status and assert sseClients is a number.
 *
 * test 2: "GET /monitor/stream returns Content-Type text/event-stream"
 *   Fetch /monitor/stream, assert Content-Type header, abort immediately.
 *
 * test 3: [V95] "VALIDATOR_IDLE alert fires when no recent resolution"
 *   Call checkValidatorIdleState() directly with pending=3, lastResolvedAt=61min ago.
 *   Expect: returned alert type is VALIDATOR_IDLE.
 *
 * Shut down monitor after all tests.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

describe('Monitor status API — sseClients field (V89-P5)', () => {
  let statusServer;
  let monitorPort;
  let baseUrl;

  beforeAll(async () => {
    // Pick a random available port by setting MONITOR_HTTP_PORT=0
    // The monitor reads MONITOR_HTTP_PORT || MONITOR_PORT at require-time
    process.env.MONITOR_HTTP_PORT = '0';
    // Suppress console output from the monitor banner during tests
    const origLog = console.log;
    console.log = () => {};

    // Clear module cache so env vars are re-read
    const monitorPath = require.resolve('../monitor/index.js');
    delete require.cache[monitorPath];

    const monitorModule = require('../monitor/index.js');
    statusServer = monitorModule.statusServer;

    console.log = origLog;

    // Wait for the server to be listening
    if (!statusServer.listening) {
      await new Promise((resolve, reject) => {
        statusServer.once('listening', resolve);
        statusServer.once('error', reject);
      });
    }

    monitorPort = statusServer.address().port;
    baseUrl = `http://127.0.0.1:${monitorPort}`;
  });

  afterAll(async () => {
    if (statusServer && statusServer.listening) {
      await new Promise(resolve => statusServer.close(resolve));
    }
    delete process.env.MONITOR_HTTP_PORT;
    // Clear module cache so next require re-initialises cleanly
    const monitorPath = require.resolve('../monitor/index.js');
    delete require.cache[monitorPath];
  });

  it('GET /monitor/status returns sseClients field', async () => {
    const res  = await fetch(`${baseUrl}/monitor/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('sseClients');
    expect(typeof body.sseClients).toBe('number');
  });

  it('GET /monitor/stream returns Content-Type text/event-stream', async () => {
    // [V90-P3] Abort immediately after header check to avoid hanging
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 500);
    try {
      const res = await fetch(`${baseUrl}/monitor/stream`, { signal: controller.signal });
      expect(res.headers.get('content-type')).toContain('text/event-stream');
    } catch (err) {
      // AbortError is acceptable — we only needed the headers
      if (err.name !== 'AbortError') throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  });
});

// ── [V95] VALIDATOR_IDLE unit test ────────────────────────────────────────────
// Tests the pure checkValidatorIdleState() function directly — no HTTP, no server.
// Condition: pending > 0 AND now - lastResolvedAt > 30 min → VALIDATOR_IDLE alert.
describe('VALIDATOR_IDLE alert — pure function unit test (V95)', () => {
  it('VALIDATOR_IDLE alert fires when no recent resolution', () => {
    // Load the monitor module to access the exported pure function
    const monitorPath = require.resolve('../monitor/index.js');
    // Use cached module if already loaded, otherwise require fresh
    const monitorModule = require.cache[monitorPath]
      ? require.cache[monitorPath].exports
      : (() => {
          // Suppress banner output
          const origLog = console.log;
          console.log = () => {};
          // Ensure port 0 to avoid conflicts
          const savedPort = process.env.MONITOR_HTTP_PORT;
          process.env.MONITOR_HTTP_PORT = '0';
          delete require.cache[monitorPath];
          const mod = require('../monitor/index.js');
          console.log = origLog;
          if (savedPort !== undefined) process.env.MONITOR_HTTP_PORT = savedPort;
          return mod;
        })();

    const { checkValidatorIdleState } = monitorModule;
    expect(typeof checkValidatorIdleState).toBe('function');

    // Mock state: pending=3, lastResolvedAt=61 minutes ago
    const pendingCount    = 3;
    const sixtyOneMinMs   = 61 * 60 * 1000;
    const lastResolvedAt  = Date.now() - sixtyOneMinMs;

    const alert = checkValidatorIdleState(lastResolvedAt, pendingCount);

    // Must fire VALIDATOR_IDLE
    expect(alert).not.toBeNull();
    expect(alert.type).toBe('VALIDATOR_IDLE');
    expect(alert.value).toBe(pendingCount);
    expect(typeof alert.message).toBe('string');
    expect(alert.message).toContain('Pending: 3');
    expect(typeof alert.ts).toBe('string');
  });

  it('VALIDATOR_IDLE does NOT fire when last resolution was recent', () => {
    const monitorPath = require.resolve('../monitor/index.js');
    const monitorModule = require.cache[monitorPath]
      ? require.cache[monitorPath].exports
      : require('../monitor/index.js');

    const { checkValidatorIdleState } = monitorModule;

    // lastResolvedAt = 5 minutes ago → still within 30min window
    const recentTs = Date.now() - 5 * 60 * 1000;
    const alert    = checkValidatorIdleState(recentTs, 3);
    expect(alert).toBeNull();
  });

  it('VALIDATOR_IDLE does NOT fire when pending queue is empty', () => {
    const monitorPath = require.resolve('../monitor/index.js');
    const monitorModule = require.cache[monitorPath]
      ? require.cache[monitorPath].exports
      : require('../monitor/index.js');

    const { checkValidatorIdleState } = monitorModule;

    // lastResolvedAt = 61 minutes ago, but pendingCount = 0
    const oldTs = Date.now() - 61 * 60 * 1000;
    const alert = checkValidatorIdleState(oldTs, 0);
    expect(alert).toBeNull();
  });
});
