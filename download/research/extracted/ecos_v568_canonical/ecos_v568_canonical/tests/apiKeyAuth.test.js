/**
 * apiKeyAuth.test.js — V86
 * Unit + integration tests for middleware/apiKeyAuth.js JWT Bearer support
 * and POST /api/v1/deposit endpoint auth.
 *
 * test 1: POST /api/v1/deposit accepts valid JWT Bearer token
 * test 2: POST /api/v1/deposit rejects missing auth
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const crypto  = require('node:crypto');

// ── JWT helper — issue a signed HS256 token ──────────────────────────────────
const TEST_JWT_SECRET = 'ecos-dev-secret'; // default used by apiKeyAuth.js

function issueTestJwt(ttlSeconds = 3600) {
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'client::deposit-test',
    iss: 'ecos-test',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  })).toString('base64url');
  const sig = crypto
    .createHmac('sha256', Buffer.from(TEST_JWT_SECRET, 'utf8'))
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${sig}`;
}

// ── Server setup (DEV_PASSTHROUGH for API key — ECOS_DEPOSIT_API_KEY not set) ─
// The server starts with ECOS_DEPOSIT_API_KEY absent → DEV_PASSTHROUGH for
// raw-key path. But we set it to a known value and use JWT path for test 1.
// For test 2 we set the key so auth is enforced.

describe('POST /api/v1/deposit — JWT Bearer auth (V86)', () => {
  let listener;
  let baseUrl;

  beforeAll(async () => {
    // Set a deposit API key so auth is enforced (non-passthrough)
    process.env.ECOS_DEPOSIT_API_KEY = 'test-api-key-v86-deposit';
    // Set JWT_SECRET to the default so our test tokens are accepted
    process.env.JWT_SECRET = TEST_JWT_SECRET;

    // Clear module cache so apiKeyAuth re-reads env vars
    const authPath   = require.resolve('../middleware/apiKeyAuth');
    const serverPath = require.resolve('../ecos-api-server');
    delete require.cache[authPath];
    delete require.cache[serverPath];

    const serverModule = require('../ecos-api-server');
    listener = serverModule.startServer(0);
    await new Promise(resolve => listener.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${listener.address().port}`;
  });

  afterAll(async () => {
    if (listener?.listening) {
      await new Promise(resolve => listener.close(resolve));
    }
    delete process.env.ECOS_DEPOSIT_API_KEY;
    delete process.env.JWT_SECRET;
    // Restore module cache state
    const authPath   = require.resolve('../middleware/apiKeyAuth');
    const serverPath = require.resolve('../ecos-api-server');
    delete require.cache[authPath];
    delete require.cache[serverPath];
  });

  // ── test 1 ────────────────────────────────────────────────────────────────
  it('POST /api/v1/deposit accepts valid JWT Bearer token', async () => {
    const token = issueTestJwt();
    const res = await fetch(`${baseUrl}/api/v1/deposit`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        clientAccountId: 'client::jwt-auth-test',
        amountUsd:       '10.00',
        idempotencyKey:  `jwt-test-${Date.now()}`,
      }),
    });
    // Should NOT be 401 — either 200 (success) or 400 (bad body) is acceptable
    expect(res.status).not.toBe(401);
  });

  // ── test 2 ────────────────────────────────────────────────────────────────
  it('POST /api/v1/deposit rejects missing auth', async () => {
    const res = await fetch(`${baseUrl}/api/v1/deposit`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientAccountId: 'client::no-auth-test',
        amountUsd:       '5.00',
        idempotencyKey:  `no-auth-test-${Date.now()}`,
      }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthorized');
  });

  // ── test 3 ────────────────────────────────────────────────────────────────
  it('POST /api/v1/deposit rejects invalid X-API-Key', async () => {
    const res = await fetch(`${baseUrl}/api/v1/deposit`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key':    'wrong-key-value',
      },
      body: JSON.stringify({
        clientAccountId: 'client::invalid-key-test',
        amountUsd:       '5.00',
        idempotencyKey:  `invalid-key-test-${Date.now()}`,
      }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthorized');
  });

  // ── test 4 ────────────────────────────────────────────────────────────────
  it('POST /api/v1/deposit rejects expired JWT', async () => {
    const token = issueTestJwt(-1); // ttlSeconds = -1 → exp is in the past
    const res = await fetch(`${baseUrl}/api/v1/deposit`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        clientAccountId: 'client::expired-jwt-test',
        amountUsd:       '5.00',
        idempotencyKey:  `expired-jwt-test-${Date.now()}`,
      }),
    });
    expect(res.status).toBe(401);
  });
});

// ── [P3-V94] Raw API-Key auth tests ──────────────────────────────────────────
// These tests use the raw ECOS_DEPOSIT_API_KEY path (X-API-Key header),
// separate from the JWT Bearer path tested above.
describe('POST /api/v1/deposit — raw API key auth (P3-V94)', () => {
  const VALID_KEY = 'p3-v94-test-api-key-valid';

  let listener;
  let baseUrl;

  beforeAll(async () => {
    // Enforce API key so auth is required
    process.env.ECOS_DEPOSIT_API_KEY = VALID_KEY;
    delete process.env.JWT_SECRET;

    const authPath   = require.resolve('../middleware/apiKeyAuth');
    const serverPath = require.resolve('../ecos-api-server');
    delete require.cache[authPath];
    delete require.cache[serverPath];

    const serverModule = require('../ecos-api-server');
    listener = serverModule.startServer(0);
    await new Promise(resolve => listener.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${listener.address().port}`;
  });

  afterAll(async () => {
    if (listener?.listening) {
      await new Promise(resolve => listener.close(resolve));
    }
    delete process.env.ECOS_DEPOSIT_API_KEY;
    const authPath   = require.resolve('../middleware/apiKeyAuth');
    const serverPath = require.resolve('../ecos-api-server');
    delete require.cache[authPath];
    delete require.cache[serverPath];
  });

  it('POST /api/v1/deposit with valid key returns 200', async () => {
    const res = await fetch(`${baseUrl}/api/v1/deposit`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key':    VALID_KEY,
      },
      body: JSON.stringify({
        clientAccountId: 'client::p3-valid-key-test',
        amountUsd:       '10.00',
        idempotencyKey:  `p3-valid-${Date.now()}`,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.depositId).toBeDefined();
  });

  it('POST /api/v1/deposit with invalid key returns 401', async () => {
    const res = await fetch(`${baseUrl}/api/v1/deposit`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key':    'wrong-key-p3-v94',
      },
      body: JSON.stringify({
        clientAccountId: 'client::p3-invalid-key-test',
        amountUsd:       '5.00',
        idempotencyKey:  `p3-invalid-${Date.now()}`,
      }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthorized');
  });
});

// DEV mode (no key configured) — separate server instance
describe('POST /api/v1/deposit — DEV mode no key (P3-V94)', () => {
  let listener;
  let baseUrl;

  beforeAll(async () => {
    // Remove API key so server runs in DEV_PASSTHROUGH
    delete process.env.ECOS_DEPOSIT_API_KEY;
    delete process.env.JWT_SECRET;

    const authPath   = require.resolve('../middleware/apiKeyAuth');
    const serverPath = require.resolve('../ecos-api-server');
    delete require.cache[authPath];
    delete require.cache[serverPath];

    const serverModule = require('../ecos-api-server');
    listener = serverModule.startServer(0);
    await new Promise(resolve => listener.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${listener.address().port}`;
  });

  afterAll(async () => {
    if (listener?.listening) {
      await new Promise(resolve => listener.close(resolve));
    }
    const authPath   = require.resolve('../middleware/apiKeyAuth');
    const serverPath = require.resolve('../ecos-api-server');
    delete require.cache[authPath];
    delete require.cache[serverPath];
  });

  it('POST /api/v1/deposit without key in DEV mode returns 200', async () => {
    const res = await fetch(`${baseUrl}/api/v1/deposit`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientAccountId: 'client::p3-dev-mode-test',
        amountUsd:       '3.00',
        idempotencyKey:  `p3-dev-${Date.now()}`,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.depositId).toBeDefined();
  });
});
