/**
 * metrics.test.js — GET /api/v1/metrics (V80)
 * Uses the same real-server pattern as chat-endpoint.test.js.
 * 8 tests covering status, Content-Type, and metric name presence.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const approvalsLogPath = path.join(os.tmpdir(), `ecos-metrics-test-${process.pid}.ndjson`);
process.env.ECOS_APPROVALS_LOG = approvalsLogPath;

let serverModule;
let listener;
let baseUrl;
let metricsRes;  // raw Response
let metricsText; // plain-text body

describe('GET /api/v1/metrics', () => {
  beforeAll(async () => {
    serverModule = require('../ecos-api-server.js');
    listener     = serverModule.startServer(0);
    await new Promise(resolve => listener.once('listening', resolve));
    const address = listener.address();
    baseUrl = `http://127.0.0.1:${address.port}`;

    // Fetch once; all tests share the same response
    metricsRes  = await fetch(`${baseUrl}/api/v1/metrics`);
    metricsText = await metricsRes.text();
  });

  afterAll(async () => {
    if (listener?.listening) {
      await new Promise(resolve => listener.close(resolve));
    }
    fs.rmSync(approvalsLogPath, { force: true });
    delete process.env.ECOS_APPROVALS_LOG;
  });

  it('GET /api/v1/metrics returns 200', () => {
    expect(metricsRes.status).toBe(200);
  });

  it('Content-Type contains text/plain', () => {
    const ct = metricsRes.headers.get('content-type') || '';
    expect(ct).toContain('text/plain');
  });

  it('response contains ecos_uptime_seconds', () => {
    expect(metricsText).toContain('ecos_uptime_seconds');
  });

  it('response contains ecos_pending_approvals', () => {
    expect(metricsText).toContain('ecos_pending_approvals');
  });

  it('response contains ecos_chain_length', () => {
    expect(metricsText).toContain('ecos_chain_length');
  });

  it('ecos_calibrator_ready value is 0 or 1', () => {
    const line = metricsText.split('\n').find(l => /^ecos_calibrator_ready /.test(l.trim()));
    expect(line).toBeTruthy();
    const value = line.trim().split(' ')[1];
    expect(value === '0' || value === '1').toBe(true);
  });

  it('response contains ecos_insurance_balance_usd', () => {
    expect(metricsText).toContain('ecos_insurance_balance_usd');
  });

  it('ecos_chain_verify_ok is 0 or 1', () => {
    const line = metricsText.split('\n').find(l => /^ecos_chain_verify_ok /.test(l.trim()));
    expect(line).toBeTruthy();
    const value = line.trim().split(' ')[1];
    expect(value === '0' || value === '1').toBe(true);
  });
});
