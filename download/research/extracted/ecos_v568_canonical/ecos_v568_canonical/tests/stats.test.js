/**
 * stats.test.js — GET /api/v1/stats (V80)
 * Uses the same real-server pattern as chat-endpoint.test.js.
 * 10 tests covering status, shape, field types, and value validation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const approvalsLogPath = path.join(os.tmpdir(), `ecos-stats-test-${process.pid}.ndjson`);
process.env.ECOS_APPROVALS_LOG = approvalsLogPath;

let serverModule;
let listener;
let baseUrl;
let body; // shared across tests — fetched once in beforeAll

describe('GET /api/v1/stats', () => {
  beforeAll(async () => {
    serverModule = require('../ecos-api-server.js');
    listener     = serverModule.startServer(0);
    await new Promise(resolve => listener.once('listening', resolve));
    const address = listener.address();
    baseUrl = `http://127.0.0.1:${address.port}`;

    // Fetch once; all tests inspect the same response
    const res = await fetch(`${baseUrl}/api/v1/stats`);
    body = await res.json();
    // Attach status to body for test 1
    body._status = res.status;
  });

  afterAll(async () => {
    if (listener?.listening) {
      await new Promise(resolve => listener.close(resolve));
    }
    fs.rmSync(approvalsLogPath, { force: true });
    delete process.env.ECOS_APPROVALS_LOG;
  });

  it('GET /api/v1/stats returns 200', () => {
    expect(body._status).toBe(200);
  });

  it('response has version field', () => {
    expect(body).toHaveProperty('version');
    expect(typeof body.version).toBe('string');
    expect(body.version.length).toBeGreaterThan(0);
  });

  it('chain.ok is boolean', () => {
    expect(body).toHaveProperty('chain');
    expect(typeof body.chain.ok).toBe('boolean');
  });

  it('approvals.pending is a number >= 0', () => {
    expect(body).toHaveProperty('approvals');
    expect(typeof body.approvals.pending).toBe('number');
    expect(body.approvals.pending).toBeGreaterThanOrEqual(0);
  });

  it('topValidators is an array', () => {
    expect(body).toHaveProperty('topValidators');
    expect(Array.isArray(body.topValidators)).toBe(true);
  });

  it('ledger has platformBalance and insuranceBalance', () => {
    expect(body).toHaveProperty('ledger');
    expect(body.ledger).toHaveProperty('platformBalance');
    expect(body.ledger).toHaveProperty('insuranceBalance');
    expect(typeof body.ledger.platformBalance).toBe('string');
    expect(typeof body.ledger.insuranceBalance).toBe('string');
  });

  it('ledger.platformBalance matches USD format', () => {
    expect(body.ledger.platformBalance).toMatch(/^\d+\.\d{4}$/);
  });

  it('uptime is a positive number', () => {
    expect(typeof body.uptime).toBe('number');
    expect(body.uptime).toBeGreaterThan(0);
  });

  it('calibrator.sampleCount is >= 0', () => {
    expect(body).toHaveProperty('calibrator');
    expect(body.calibrator.sampleCount).toBeGreaterThanOrEqual(0);
  });

  it('chain.length is >= 0', () => {
    expect(body).toHaveProperty('chain');
    expect(body.chain.length).toBeGreaterThanOrEqual(0);
  });

  it('approvals.all is a number >= 0', () => {
    expect(typeof body.approvals.all).toBe('number');
    expect(body.approvals.all).toBeGreaterThanOrEqual(0);
  });

  it("db field is 'connected' or 'offline'", () => {
    expect(['connected', 'offline']).toContain(body.db);
  });

  it('GET /api/v1/stats includes metricsGaugeCount === 10', () => {
    expect(body.metricsGaugeCount).toBe(10);
  });
});

// ── [P1-V88] Health wsClients test ───────────────────────────────────────────
describe('GET /api/v1/health — V88 fields', () => {
  let listener2;
  let BASE2;

  beforeAll(async () => {
    const { createRequire } = await import('module');
    const req2 = createRequire(import.meta.url);
    const serverModule2 = req2('../ecos-api-server.js');
    listener2 = serverModule2.startServer(0);
    await new Promise(resolve => listener2.once('listening', resolve));
    BASE2 = `http://127.0.0.1:${listener2.address().port}`;
  });

  afterAll(async () => {
    if (listener2?.listening) {
      await new Promise(resolve => listener2.close(resolve));
    }
  });

  it('GET /api/v1/health includes wsClients field', async () => {
    const res = await fetch(BASE2 + '/api/v1/health');
    const body = await res.json();
    expect(typeof body.wsClients).toBe('number');
  });
});
