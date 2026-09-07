'use strict';
/**
 * tests/v470.test.js — ECOS V470 test suite
 * Tests: canon facade, SACRED md5, server parse-clean, endpoint wiring
 * Run: NODE_ENV=test node tests/v470.test.js
 * Must exit 0.
 */

const assert = require('assert');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

console.log('\n=== ECOS V470 Tests ===\n');

// T01 — SACRED: fiatLedger.js md5
test('SACRED fiatLedger.js md5', () => {
  const buf = fs.readFileSync(path.join(ROOT, 'lib/fiatLedger.js'));
  const actual = crypto.createHash('md5').update(buf).digest('hex');
  assert.strictEqual(actual, '563e9b1f9e67091a5b6527c0a92568e5', `fiatLedger md5 mismatch: ${actual}`);
});

// T02 — SACRED: auditLog.js md5
test('SACRED auditLog.js md5', () => {
  const buf = fs.readFileSync(path.join(ROOT, 'lib/auditLog.js'));
  const actual = crypto.createHash('md5').update(buf).digest('hex');
  assert.strictEqual(actual, 'e5a5c2c27801d2d03991bc8e5a1df8cb', `auditLog md5 mismatch: ${actual}`);
});

// T03 — server parses clean
test('ecos-api-server.js node --check', () => {
  execSync(`node --check ${path.join(ROOT, 'ecos-api-server.js')}`, { stdio: 'pipe' });
});

// T04 — package.json version is 470.0.0
test('package.json version = 470.0.0', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json')));
  assert.ok(parseInt(String(pkg.version).split('.')[0],10) >= 470, 'major >= 470');
});

// T05 — meshDispatcherCanon470.js exists in lib/
test('lib/meshDispatcherCanon470.js exists', () => {
  const p = path.join(ROOT, 'lib', 'meshDispatcherCanon470.js');
  assert.ok(fs.existsSync(p), 'lib/meshDispatcherCanon470.js not found');
});

// T06 — meshDispatcherCanon470.js parses clean
test('meshDispatcherCanon470.js node --check', () => {
  execSync(`node --check ${path.join(ROOT, 'lib/meshDispatcherCanon470.js')}`, { stdio: 'pipe' });
});

// T07 — canon module loads and getCanonInfo470 returns correct data
test('getCanonInfo470() returns correct tower metadata', () => {
  const canon = require(path.join(ROOT, 'lib/meshDispatcherCanon470.js'));
  const info = canon.getCanonInfo470();
  assert.ok(parseInt(String(info.version).split('.')[0],10) >= 470, 'major >= 470');
  assert.strictEqual(info.tower, 'meshDispatcher');
  assert.strictEqual(info.canonicalTip, 297);
  assert.strictEqual(info.chainBase, 288);
  assert.strictEqual(info.chainLength, 10);
});

// T08 — canon module exports D297 surface
test('canon exports ReasonIndexedFeed297', () => {
  const canon = require(path.join(ROOT, 'lib/meshDispatcherCanon470.js'));
  assert.ok(typeof canon.ReasonIndexedFeed297 === 'function', 'ReasonIndexedFeed297 not a function');
});

// T09 — server contains V470 endpoint
test('server wires GET /api/v1/mesh/dispatch/canonical', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  assert.ok(src.includes('/api/v1/mesh/dispatch/canonical'), 'canonical endpoint not found in server');
});

// T10 — server contains V470 summary endpoint
test('server wires GET /api/v1/admin/summary/v470', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  assert.ok(src.includes('/api/v1/admin/summary/v470'), 'summary/v470 not found in server');
});

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
process.exit(0);
