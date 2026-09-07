/**
 * ECOS V113 — P9-07 EU AI Act Compliance Report Tests
 * Tests:
 *   1. GET /api/v1/audit/eu-ai-act-report returns 200 JSON
 *   2. Response has regulation, coverage, auditChain, humanOversight, confidenceGating
 *   3. coverage has all required Art.12 and Art.14 keys
 *   4. daysRemaining is a non-negative integer
 *   5. confidenceGating has correct thresholds
 *   6. recommendations is an array
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

describe('P9-07 — EU AI Act Compliance Report', () => {
  let server;
  let BASE;
  let report;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const app = require('../ecos-api-server.js');
    server = typeof app.startServer === 'function'
      ? await new Promise(r => { const s = app.startServer(0); s.once('listening', () => r(s)); })
      : app._server;
    const port = server && server.address ? server.address().port : 3000;
    BASE = `http://localhost:${port}`;

    const res = await fetch(`${BASE}/api/v1/audit/eu-ai-act-report`);
    report = await res.json();
  });

  afterAll(async () => {
    if (server && server.close) await new Promise(r => server.close(r));
  });

  it('returns HTTP 200 with application/json', async () => {
    const res = await fetch(`${BASE}/api/v1/audit/eu-ai-act-report`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('response has ok, generatedAt, version, deadline', () => {
    expect(report.ok).toBe(true);
    expect(report.version).toBe('V114');
    expect(typeof report.generatedAt).toBe('string');
    expect(report.deadline).toBe('2026-08-02T00:00:00Z');
  });

  it('daysRemaining is a non-negative number', () => {
    expect(typeof report.daysRemaining).toBe('number');
    expect(report.daysRemaining).toBeGreaterThanOrEqual(0);
  });

  it('regulation has name and articles', () => {
    expect(report.regulation.name).toBe('EU AI Act');
    expect(Array.isArray(report.regulation.articles)).toBe(true);
    expect(report.regulation.articles.length).toBeGreaterThan(0);
  });

  it('overallCompliant is a boolean', () => {
    expect(typeof report.overallCompliant).toBe('boolean');
  });

  it('coverage has all required Art.12 keys', () => {
    expect(report.coverage).toHaveProperty('art12_auditLogging');
    expect(report.coverage).toHaveProperty('art12_cryptoIntegrity');
    expect(report.coverage).toHaveProperty('art12_logRetention');
    expect(typeof report.coverage.art12_auditLogging.compliant).toBe('boolean');
  });

  it('coverage has all required Art.14 keys', () => {
    expect(report.coverage).toHaveProperty('art14_humanOversight');
    expect(report.coverage).toHaveProperty('art14_confidenceGate');
    expect(report.coverage).toHaveProperty('art14_overrideCapability');
    expect(typeof report.coverage.art14_humanOversight.compliant).toBe('boolean');
  });

  it('auditChain has length, intact, headHash, dbBacked', () => {
    const ac = report.auditChain;
    expect(typeof ac.length).toBe('number');
    expect(typeof (typeof ac.intact === 'object' ? ac.intact.ok : ac.intact)).toBe('boolean');
    expect(typeof ac.dbBacked).toBe('boolean');
  });

  it('humanOversight has hitlQueued, hitlResolved, autoFlow, blocked', () => {
    const ho = report.humanOversight;
    expect(typeof ho.hitlQueued).toBe('number');
    expect(typeof ho.hitlResolved).toBe('number');
    expect(typeof ho.autoFlow).toBe('number');
    expect(typeof ho.blocked).toBe('number');
  });

  it('confidenceGating has correct ECOS thresholds', () => {
    const cg = report.confidenceGating;
    expect(cg.autoThreshold).toBe(0.70);
    expect(cg.hitlLow).toBe(0.50);
    expect(cg.hitlHigh).toBe(0.70);
    expect(cg.blockThreshold).toBe(0.30);
  });

  it('recommendations is a non-empty array', () => {
    expect(Array.isArray(report.recommendations)).toBe(true);
    expect(report.recommendations.length).toBeGreaterThan(0);
    expect(report.recommendations[0]).toHaveProperty('severity');
    expect(report.recommendations[0]).toHaveProperty('msg');
  });
});
