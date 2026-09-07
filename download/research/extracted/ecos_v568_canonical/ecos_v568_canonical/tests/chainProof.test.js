/**
 * chainProof.test.js — V102
 * Integration tests for GET /api/v1/chain/proof endpoint.
 *
 * Verifies:
 *   - 200 status with correct shape
 *   - intact === true on fresh chain
 *   - chainLength reflects actual audit log size
 *   - headHash / tailHash are 64-char hex strings when entries exist
 *   - recentHashes is an array (max 10, newest-first)
 *   - verifiedAt is a valid ISO timestamp
 *   - ecosVersion is "V102"
 *
 * Run: npx vitest run tests/chainProof.test.js
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import os   from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

// Isolate approvals log
const approvalsLogPath = path.join(os.tmpdir(), `ecos-chainproof-test-${process.pid}.ndjson`);
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

describe('GET /api/v1/chain/proof — V102', () => {
  it('returns 200 with correct top-level shape', async () => {
    const res  = await fetch(`${BASE}/api/v1/chain/proof`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(typeof body.intact).toBe('boolean');
    expect(typeof body.chainLength).toBe('number');
    expect(typeof body.verifiedAt).toBe('string');
    expect(body.ecosVersion).toBe('V114');
    expect(Array.isArray(body.recentHashes)).toBe(true);
  });

  it('intact is true on a fresh (unmodified) chain', async () => {
    const res  = await fetch(`${BASE}/api/v1/chain/proof`);
    const body = await res.json();
    expect(body.intact).toBe(true);
    expect(body.brokenAt).toBeNull();
    expect(body.reason).toBeNull();
  });

  it('chainLength is a non-negative integer', async () => {
    const res  = await fetch(`${BASE}/api/v1/chain/proof`);
    const body = await res.json();
    expect(body.chainLength).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(body.chainLength)).toBe(true);
  });

  it('headHash and tailHash are 64-char hex or null when chain is empty', async () => {
    const res  = await fetch(`${BASE}/api/v1/chain/proof`);
    const body = await res.json();
    if (body.chainLength > 0) {
      expect(body.headHash).toMatch(/^[0-9a-f]{64}$/);
      expect(body.tailHash).toMatch(/^[0-9a-f]{64}$/);
    } else {
      expect(body.headHash).toBeNull();
      expect(body.tailHash).toBeNull();
    }
  });

  it('recentHashes has at most 10 entries', async () => {
    const res  = await fetch(`${BASE}/api/v1/chain/proof`);
    const body = await res.json();
    expect(body.recentHashes.length).toBeLessThanOrEqual(10);
  });

  it('verifiedAt is a valid ISO 8601 timestamp', async () => {
    const res  = await fetch(`${BASE}/api/v1/chain/proof`);
    const body = await res.json();
    expect(new Date(body.verifiedAt).toISOString()).toBe(body.verifiedAt);
  });

  it('X-Agent-Id response header is a valid UUID when identity is initialized', async () => {
    const res = await fetch(`${BASE}/api/v1/chain/proof`);
    const agentId = res.headers.get('x-agent-id');
    if (agentId) {
      expect(agentId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    }
  });
});
