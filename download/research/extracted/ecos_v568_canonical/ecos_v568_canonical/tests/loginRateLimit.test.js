/**
 * loginRateLimit.test.js — V61
 * Unit + integration tests for POST /api/v1/validator/login rate limiting.
 *
 * Tests the _checkLoginRateLimit / _resetLoginRateLimit helpers exported
 * from ecos-api-server.js — unit tests run WITHOUT starting HTTP server.
 * The final describe block starts a real server for HTTP-level assertions.
 *
 * Run: npx vitest run tests/loginRateLimit.test.js
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Mock offlineInference BEFORE requiring the server module (avoids Ollama calls)
const offlineInference = require('../lib/offlineInference');
offlineInference.executeTask = async () => ({
  aiOutput: { result: 'mock' }, confidence: 0.5,
});

// Load server module — helpers only, no HTTP port opened here
const {
  _checkLoginRateLimit,
  _resetLoginRateLimit,
  _loginAttempts,
} = require('../ecos-api-server.js');

// ── helpers ───────────────────────────────────────────────────────────────────

const TEST_IP  = '10.0.0.1';
const OTHER_IP = '10.0.0.2';
function clearAll() { _loginAttempts.clear(); }

// ── unit tests ────────────────────────────────────────────────────────────────

describe('loginRateLimit — _checkLoginRateLimit', () => {
  beforeEach(() => clearAll());

  it('allows first attempt', () => {
    const r = _checkLoginRateLimit(TEST_IP);
    expect(r.allowed).toBe(true);
  });

  it('allows up to 5 attempts (default max)', () => {
    for (let i = 0; i < 5; i++) {
      expect(_checkLoginRateLimit(TEST_IP).allowed).toBe(true);
    }
  });

  it('blocks the 6th attempt', () => {
    for (let i = 0; i < 5; i++) _checkLoginRateLimit(TEST_IP);
    const r = _checkLoginRateLimit(TEST_IP);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
    expect(r.retryAfterSec).toBeLessThanOrEqual(900);
  });

  it('retryAfterSec is an integer (for Retry-After header)', () => {
    for (let i = 0; i < 5; i++) _checkLoginRateLimit(TEST_IP);
    const r = _checkLoginRateLimit(TEST_IP);
    expect(r.allowed).toBe(false);
    expect(Number.isInteger(r.retryAfterSec)).toBe(true);
  });

  it('IPs are isolated — blocking TEST_IP does not block OTHER_IP', () => {
    for (let i = 0; i < 6; i++) _checkLoginRateLimit(TEST_IP);
    expect(_checkLoginRateLimit(OTHER_IP).allowed).toBe(true);
  });

  it('continues to block after many excess attempts', () => {
    for (let i = 0; i < 12; i++) _checkLoginRateLimit(TEST_IP);
    expect(_checkLoginRateLimit(TEST_IP).allowed).toBe(false);
  });

  it('window resets after LOGIN_RATE_LIMIT_WINDOW ms (simulated by backdating)', () => {
    for (let i = 0; i < 5; i++) _checkLoginRateLimit(TEST_IP);
    // Backdate the window start by > 15 minutes
    const entry = _loginAttempts.get(TEST_IP);
    entry.windowStart = Date.now() - 901_000;
    // New window — first attempt should be allowed
    const r = _checkLoginRateLimit(TEST_IP);
    expect(r.allowed).toBe(true);
    expect(_loginAttempts.get(TEST_IP).count).toBe(1);
  });
});

describe('loginRateLimit — _resetLoginRateLimit', () => {
  beforeEach(() => clearAll());

  it('removes the IP entry', () => {
    for (let i = 0; i < 3; i++) _checkLoginRateLimit(TEST_IP);
    expect(_loginAttempts.has(TEST_IP)).toBe(true);
    _resetLoginRateLimit(TEST_IP);
    expect(_loginAttempts.has(TEST_IP)).toBe(false);
  });

  it('after reset, IP is allowed again (simulates successful login unlocking)', () => {
    for (let i = 0; i < 5; i++) _checkLoginRateLimit(TEST_IP);
    expect(_checkLoginRateLimit(TEST_IP).allowed).toBe(false);
    _resetLoginRateLimit(TEST_IP);
    expect(_checkLoginRateLimit(TEST_IP).allowed).toBe(true);
  });

  it('reset on unknown IP does not throw', () => {
    expect(() => _resetLoginRateLimit('99.99.99.99')).not.toThrow();
  });
});

// ── HTTP-level tests ──────────────────────────────────────────────────────────

describe('loginRateLimit — HTTP integration', () => {
  let listener;
  let baseUrl;

  beforeAll(async () => {
    clearAll();
    const { startServer } = require('../ecos-api-server.js');
    listener = startServer(0);
    await new Promise(resolve => listener.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${listener.address().port}`;
  });

  afterAll(async () => {
    clearAll();
    if (listener?.listening) {
      await new Promise(resolve => listener.close(resolve));
    }
  });

  it('returns 503 when VALIDATOR_LOGIN_PASSWORD is not configured', async () => {
    const saved = process.env.VALIDATOR_LOGIN_PASSWORD;
    delete process.env.VALIDATOR_LOGIN_PASSWORD;

    const res = await fetch(`${baseUrl}/api/v1/validator/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ validatorId: 'validator::test', password: 'x' }),
    });
    expect(res.status).toBe(503);

    if (saved !== undefined) process.env.VALIDATOR_LOGIN_PASSWORD = saved;
  });

  it('returns 400 when validatorId is missing (when login IS configured)', async () => {
    const loginPw = process.env.VALIDATOR_LOGIN_PASSWORD;
    const jwtSec  = process.env.VALIDATOR_JWT_SECRET;
    if (!loginPw || !jwtSec) return; // DEV_PASSTHROUGH — skip

    clearAll();
    const res = await fetch(`${baseUrl}/api/v1/validator/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ password: 'whatever' }),
    });
    expect(res.status).toBe(400);
    clearAll();
  });

  it('returns 429 with Retry-After after 5 bad attempts (when login IS configured)', async () => {
    const loginPw = process.env.VALIDATOR_LOGIN_PASSWORD;
    const jwtSec  = process.env.VALIDATOR_JWT_SECRET;
    if (!loginPw || !jwtSec) {
      // DEV_PASSTHROUGH: server returns 503 on first call — skip rate limit test
      return;
    }

    clearAll();
    const body_ = JSON.stringify({ validatorId: 'validator::tester', password: '__wrong__' });
    const hdrs  = { 'Content-Type': 'application/json' };

    for (let i = 0; i < 5; i++) {
      await fetch(`${baseUrl}/api/v1/validator/login`, { method: 'POST', headers: hdrs, body: body_ });
    }

    const res = await fetch(`${baseUrl}/api/v1/validator/login`, {
      method: 'POST', headers: hdrs, body: body_,
    });

    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBeTruthy();

    const json_ = await res.json();
    expect(json_.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(json_.retryAfterSec).toBeGreaterThan(0);

    clearAll();
  });
});
