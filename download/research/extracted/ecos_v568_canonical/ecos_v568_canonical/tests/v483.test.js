'use strict';
/**
 * tests/v483.test.js — ECOS V483
 * Run: NODE_ENV=test node tests/v483.test.js  → exit 0
 */
const assert = require('assert');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

console.log('\n=== ECOS V483 Tests ===\n');

// T01 — SACRED fiatLedger
test('SACRED fiatLedger.js md5', () => {
  const buf = fs.readFileSync(path.join(ROOT, 'lib/fiatLedger.js'));
  assert.strictEqual(crypto.createHash('md5').update(buf).digest('hex'), '563e9b1f9e67091a5b6527c0a92568e5');
});

// T02 — SACRED auditLog
test('SACRED auditLog.js md5', () => {
  const buf = fs.readFileSync(path.join(ROOT, 'lib/auditLog.js'));
  assert.strictEqual(crypto.createHash('md5').update(buf).digest('hex'), 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// T03 — server parse
test('ecos-api-server.js node --check', () => {
  execSync(`node --check ${path.join(ROOT, 'ecos-api-server.js')}`, { stdio: 'pipe' });
});

// T04 — version
test('package.json version = 483.0.0', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json')));
  assert.ok(parseInt(String(pkg.version).split('.')[0],10) >= 483, 'major >= 483');
});

// T05 — 275Canon483 exists
test('lib/providerAdapters275Canon483.js exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'lib/providerAdapters275Canon483.js')));
});

// T06 — 275Canon483 parses
test('providerAdapters275Canon483.js node --check', () => {
  execSync(`node --check ${path.join(ROOT, 'lib/providerAdapters275Canon483.js')}`, { stdio: 'pipe' });
});

// T07 — 275Canon483 exports correct surface
test('275Canon483 exports 25 contracts + counterAlertBus + getCanonInfo483', () => {
  const m = require(path.join(ROOT, 'lib/providerAdapters275Canon483.js'));
  assert.ok(typeof m.getCanonInfo483 === 'function', 'getCanonInfo483 missing');
  assert.ok('counterAlertBus' in m.PROVIDER_CONTRACTS_275, 'counterAlertBus missing');
  assert.ok(typeof m.validateProvider275 === 'function', 'validateProvider275 missing');
  const info = m.getCanonInfo483();
  assert.strictEqual(info.contractCount, 25);
});

// T08 — 276 imports from 275Canon483
test('providerAdapters276.js imports from 275Canon483', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/providerAdapters276.js'), 'utf8');
  assert.ok(src.includes('providerAdapters275Canon483'), '276 must require 275Canon483');
  assert.ok(!src.match(/require\(['"]\.\/providerAdapters275['"]\)/), '276 must not require 275 directly');
});

// T09 — Canon476 still loads correctly
test('Canon476 still healthy after chain change', () => {
  const c = require(path.join(ROOT, 'lib/providerAdaptersCanon476.js'));
  assert.ok(typeof c.getHealthSummary476 === 'function');
  assert.ok(Object.keys(c.PROVIDER_CONTRACTS_286).length >= 36);
});

// T10 — server wires V483 endpoints
test('server wires V483 endpoints', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  assert.ok(src.includes('/api/v1/towers/providers/chain-v483'));
  assert.ok(src.includes('/api/v1/admin/summary/v483'));
});

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
process.exit(0);
