#!/usr/bin/env node
'use strict';

/**
 * scripts/smoke-live.js — ECOS V145
 * ─────────────────────────────────────────────────────────────
 * [V145-DEPLOY-01] Smoke test against a live public ECOS instance.
 *
 * Usage:
 *   node scripts/smoke-live.js https://ecos-api.onrender.com
 *   SMOKE_URL=https://ecos-api.fly.dev npm run smoke:live
 *
 * Environment:
 *   SMOKE_URL     — base URL of the deployed instance (required)
 *   SMOKE_TIMEOUT — per-request timeout in ms (default: 10000)
 *   SMOKE_VERBOSE — set to 1 for request/response details
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more checks failed
 */

const https = require('node:https');
const http  = require('node:http');

const BASE_URL = process.argv[2] || process.env.SMOKE_URL || '';
const TIMEOUT  = parseInt(process.env.SMOKE_TIMEOUT || '10000');
const VERBOSE  = process.env.SMOKE_VERBOSE === '1';

if (!BASE_URL) {
  console.error('Usage: node scripts/smoke-live.js <BASE_URL>');
  console.error('   or: SMOKE_URL=https://... npm run smoke:live');
  process.exit(1);
}

const base = BASE_URL.replace(/\/$/, '');

// ── HTTP helper ───────────────────────────────────────────────────────────────

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url     = new URL(path, base);
    const driver  = url.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;

    const opts = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
      timeout: TIMEOUT,
    };

    const req = driver.request(opts, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        let data = null;
        try { data = JSON.parse(raw); } catch (_) { data = raw; }
        if (VERBOSE) {
          console.log(`  → ${res.statusCode} ${method} ${path}`);
          if (data && typeof data === 'object') console.log('  ', JSON.stringify(data).slice(0, 200));
        }
        resolve({ status: res.statusCode, data, headers: res.headers });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${method} ${path}`)); });

    if (payload) req.write(payload);
    req.end();
  });
}

// ── Test runner ───────────────────────────────────────────────────────────────

const results = [];

async function check(name, fn) {
  const start = Date.now();
  try {
    await fn();
    const ms = Date.now() - start;
    console.log(`  ✅  ${name} (${ms}ms)`);
    results.push({ name, ok: true, ms });
  } catch (err) {
    const ms = Date.now() - start;
    console.log(`  ❌  ${name}: ${err.message}`);
    results.push({ name, ok: false, ms, error: err.message });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ── Smoke tests ───────────────────────────────────────────────────────────────

async function runSmoke() {
  console.log(`\n🔥  ECOS Smoke Test — live instance`);
  console.log(`    Target: ${base}`);
  console.log(`    Timeout: ${TIMEOUT}ms\n`);

  // 1. Health endpoint
  await check('GET /api/v1/health returns 200 + status:ok', async () => {
    const r = await request('GET', '/api/v1/health');
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.data && r.data.status === 'ok', `Expected {status:'ok'}, got ${JSON.stringify(r.data).slice(0, 100)}`);
  });

  // 2. Health reports version
  await check('GET /api/v1/health contains version field', async () => {
    const r = await request('GET', '/api/v1/health');
    assert(r.data && r.data.version, `Missing version field`);
    if (VERBOSE) console.log(`    version: ${r.data.version}`);
  });

  // 3. Chain proof endpoint
  await check('GET /api/v1/chain/proof returns intact field', async () => {
    const r = await request('GET', '/api/v1/chain/proof');
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(typeof r.data.intact === 'boolean', `Missing intact field`);
  });

  // 4. Auth register (new unique email)
  const ts    = Date.now();
  const email = `smoketest_${ts}@ecos-smoke.invalid`;
  let accessToken = null;

  await check('POST /api/v1/auth/register creates account', async () => {
    const r = await request('POST', '/api/v1/auth/register', {
      email,
      password: 'SmokeTest_Pass_' + ts,
      displayName: 'Smoke Tester',
    });
    assert(r.status === 201, `Expected 201, got ${r.status}: ${JSON.stringify(r.data).slice(0, 100)}`);
    assert(r.data.accessToken, 'Missing accessToken in response');
    accessToken = r.data.accessToken;
  });

  // 5. Auth login
  await check('POST /api/v1/auth/login returns tokens', async () => {
    const r = await request('POST', '/api/v1/auth/login', {
      email,
      password: 'SmokeTest_Pass_' + ts,
    });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.data.accessToken, 'Missing accessToken');
  });

  // 6. /auth/me with token
  await check('GET /api/v1/auth/me returns user info', async () => {
    assert(accessToken, 'No access token from register step');
    const r = await request('GET', '/api/v1/auth/me', null, {
      Authorization: `Bearer ${accessToken}`,
    });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.data.email === email, `Email mismatch: ${r.data.email}`);
  });

  // 7. Sovereign stats (V131)
  await check('GET /api/v1/sovereign/stats returns stats', async () => {
    const r = await request('GET', '/api/v1/sovereign/stats');
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(typeof r.data.totalInferences === 'number', 'Missing totalInferences');
  });

  // 8. 404 for unknown path
  await check('Unknown path returns 404', async () => {
    const r = await request('GET', '/api/v1/does_not_exist_smoke_test_' + ts);
    assert(r.status === 404, `Expected 404, got ${r.status}`);
  });

  // 9. X-Agent-Id header present
  await check('Responses include X-Agent-Id header', async () => {
    const r = await request('GET', '/api/v1/health');
    assert(r.headers['x-agent-id'], 'Missing X-Agent-Id header');
  });

  // ── Summary ──────────────────────────────────────────────────────────────
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  const totalMs = results.reduce((s, r) => s + r.ms, 0);

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  ${passed}/${results.length} checks passed  (${totalMs}ms total)`);

  if (failed > 0) {
    console.log(`\n  Failed checks:`);
    results.filter(r => !r.ok).forEach(r => {
      console.log(`    ❌ ${r.name}: ${r.error}`);
    });
    console.log('');
    process.exit(1);
  } else {
    console.log(`\n  🎉 All checks passed — instance is healthy!\n`);
    process.exit(0);
  }
}

runSmoke().catch(err => {
  console.error(`\nFatal error: ${err.message}`);
  process.exit(1);
});


// ── [V154] Admin + Withdrawal History checks ───────────────────────────────────

async function checkAdminStats(base) {
  const res = await request('GET', '/api/v1/admin/stats');
  const ok = res.status === 200 && res.data && 'validatorCount' in res.data;
  return { name: 'GET /api/v1/admin/stats', ok, detail: ok ? `V${res.data.ecosVersion}` : `HTTP ${res.status}` };
}

async function checkAdminEvents(base) {
  const res = await request('GET', '/api/v1/admin/events?limit=5');
  const ok = res.status === 200 && Array.isArray(res.data?.events);
  return { name: 'GET /api/v1/admin/events', ok, detail: ok ? `${res.data.events.length} events` : `HTTP ${res.status}` };
}

async function checkDashboardSummary(base) {
  const res = await request('GET', '/api/v1/dashboard/summary');
  const ok = res.status === 200 && res.data && 'totalTasks' in res.data;
  return { name: 'GET /api/v1/dashboard/summary', ok, detail: ok ? `autoFlowRate: ${res.data.autoFlowRate}%` : `HTTP ${res.status}` };
}

async function checkWithdrawalHistoryEndpoint(base) {
  // Should return 400 if no accountId — that's expected
  const res = await request('GET', '/api/v1/withdrawals/history');
  const ok = res.status === 400 && res.data?.error?.includes('accountId');
  return { name: 'GET /api/v1/withdrawals/history (no accountId → 400)', ok, detail: ok ? 'validation works' : `HTTP ${res.status}` };
}

async function checkSecurityHeaders(base) {
  const res = await request('GET', '/api/v1/system/readiness');
  const headers = res.headers || {};
  const hasXCTO    = headers['x-content-type-options'] === 'nosniff';
  const hasXFO     = headers['x-frame-options'] === 'DENY';
  const ok = hasXCTO && hasXFO;
  return { name: 'Security Headers (X-Content-Type-Options + X-Frame-Options)', ok,
    detail: ok ? 'present' : `XCTO=${headers['x-content-type-options']}, XFO=${headers['x-frame-options']}` };
}

// ── Append V154 checks to the run list if this module exports checks ──────────
if (typeof V154_SMOKE_CHECKS === 'undefined') {
  const V154_SMOKE_CHECKS = [
    checkAdminStats,
    checkAdminEvents,
    checkDashboardSummary,
    checkWithdrawalHistoryEndpoint,
    checkSecurityHeaders,
  ];
  // Export for use in run()
  if (typeof module !== 'undefined') module.exports = { ...module.exports, V154_SMOKE_CHECKS };
}
