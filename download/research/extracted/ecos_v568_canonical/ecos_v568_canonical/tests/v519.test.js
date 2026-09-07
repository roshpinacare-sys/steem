'use strict';
/**
 * tests/v519.test.js — ECOS V519
 * Audit-completeness probe tests. exit 0 = pass.
 */
const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

let passed = 0, failed = 0;
function test519(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.error('  ✗', name, '\n   ', e.message); failed++; }
}

console.log('\n=== V519 tests ===');

// ── SACRED guard ──
test519('SACRED fiatLedger.js md5 unchanged', () => {
  const md5 = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, 'lib', 'fiatLedger.js'))).digest('hex');
  assert.strictEqual(md5, '563e9b1f9e67091a5b6527c0a92568e5');
});
test519('SACRED auditLog.js md5 unchanged', () => {
  const md5 = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, 'lib', 'auditLog.js'))).digest('hex');
  assert.strictEqual(md5, 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// ── Wiring ──
test519('server source contains V519 IIFE marker and require', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  assert(src.includes('_wireAuditCompletenessProbe519'), 'V519 IIFE missing');
  assert(src.includes("require('./lib/auditCompletenessProbe519.js')"), 'V519 require missing');
});

// ── lib & src/lib mirror ──
test519('lib/ and src/lib/ copies have identical md5', () => {
  const a = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, 'lib',     'auditCompletenessProbe519.js'))).digest('hex');
  const b = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, 'src','lib','auditCompletenessProbe519.js'))).digest('hex');
  assert.strictEqual(a, b, 'lib/ and src/lib/ copies must match');
});

// ── Module shape ──
test519('module exports expected surface', () => {
  const m = require(path.join(ROOT, 'lib', 'auditCompletenessProbe519.js'));
  assert.strictEqual(m.PROBE_VERSION_519, '519.0.0');
  assert.strictEqual(typeof m.scanServer519, 'function');
  assert.strictEqual(typeof m.getProbeSummary519, 'function');
  assert.strictEqual(typeof m.registerEndpoints519, 'function');
  assert(Array.isArray(m.MONEY_TOKENS_519) && m.MONEY_TOKENS_519.length >= 7);
  assert(m.GUARD_TOKENS_519.includes('guardMint402'));
  assert(m.GUARD_TOKENS_519.includes('guardWithdraw402'));
});

// ── Scan behavior ──
const probe = require(path.join(ROOT, 'lib', 'auditCompletenessProbe519.js'));
const scan  = probe.scanServer519();

test519('scan succeeds and finds >=10 money-touching endpoints', () => {
  assert.strictEqual(scan.ok, true);
  assert(scan.endpoints.length >= 10, 'expected >=10, got ' + scan.endpoints.length);
});

test519('scan detects the V402 guard endpoints as guarded', () => {
  const mint = scan.endpoints.find(e => e.path === '/api/v1/guard/mint');
  const wdr  = scan.endpoints.find(e => e.path === '/api/v1/guard/withdraw');
  assert(mint && mint.hasGuard, 'guard/mint must show hasGuard=true');
  assert(wdr  && wdr.hasGuard,  'guard/withdraw must show hasGuard=true');
});

test519('totals are internally consistent', () => {
  const t = scan.totals;
  assert(t.moneyTouching === scan.endpoints.length);
  assert(t.withGuard <= t.moneyTouching);
  assert(t.withAudit <= t.moneyTouching);
  assert(t.missingGuard <= t.moneyTouching);
  assert(t.missingAudit <= t.moneyTouching);
});

test519('GET endpoints are never flagged as needing guard/audit (read-only exempt)', () => {
  for (const e of scan.endpoints) {
    if (e.method === 'GET') {
      assert.strictEqual(e.needsGuardReview, false, 'GET ' + e.path + ' should not need guard');
      assert.strictEqual(e.needsAuditReview, false, 'GET ' + e.path + ' should not need audit');
    }
  }
});

// ── fail-closed: unknown tower / missing handler => not auto-cleared ──
test519('non-money path is not classified as money-touching', () => {
  // /api/v1/healthz or similar should not appear
  const bogus = scan.endpoints.find(e => e.path.indexOf('healthz') !== -1);
  assert.strictEqual(bogus, undefined);
});

// ── Endpoint registration via stub express ──
test519('registerEndpoints519 registers exactly 3 routes', () => {
  const routes = [];
  const stub = { get: (p, h) => { routes.push(p); } };
  probe.registerEndpoints519(stub);
  assert.strictEqual(routes.length, 3);
  assert(routes.includes('/api/v1/registry/audit-completeness-v519/status'));
  assert(routes.includes('/api/v1/registry/audit-completeness-v519/full'));
  assert(routes.includes('/api/v1/admin/summary/v519'));
});

test519('endpoint handlers produce ok json without throwing', () => {
  const calls = [];
  let captured = null;
  const fakeRes = {
    json: (x) => { captured = x; return fakeRes; },
    status: (_c) => fakeRes,
  };
  const stub = { get: (p, h) => calls.push({ p, h }) };
  probe.registerEndpoints519(stub);
  for (const c of calls) {
    captured = null;
    c.h({ query: {} }, fakeRes);
    assert(captured && captured.ok === true, 'handler ' + c.p + ' did not respond ok');
    assert.strictEqual(captured.ecosVersion, 'V519');
  }
});

// ── Server size sanity (parse-check is run separately via node --check) ──
test519('ecos-api-server.js is non-trivial size', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  assert(src.length > 100000, 'server unexpectedly small');
});

// ── version bump ──
test519('package.json version >= 519.0.0', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const major = parseInt(String(pkg.version).split('.')[0], 10);
  assert(major >= 519, 'expected major >= 519, got ' + pkg.version);
});

console.log('\nV519:', passed, 'passed,', failed, 'failed');
process.exit(failed === 0 ? 0 : 1);
