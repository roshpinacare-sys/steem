'use strict';
/**
 * tests/v474.test.js — ECOS V474 — meshDispatcher Canon Facade Update
 * NODE_ENV=test node tests/v474.test.js  → exit 0
 */

const assert = require('assert');
const path   = require('path');
const crypto = require('crypto');
const fs     = require('fs');

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

console.log('\n=== V474 meshDispatcher Canon Facade Update ===\n');

// ── T01: SACRED md5 ─────────────────────────────────────────────────────────
test('T01: fiatLedger.js SACRED hash', () => {
  const data = fs.readFileSync(path.join(__dirname, '../lib/fiatLedger.js'));
  const hash = crypto.createHash('md5').update(data).digest('hex');
  assert.strictEqual(hash, '563e9b1f9e67091a5b6527c0a92568e5', 'fiatLedger SACRED violated');
});

test('T02: auditLog.js SACRED hash', () => {
  const data = fs.readFileSync(path.join(__dirname, '../lib/auditLog.js'));
  const hash = crypto.createHash('md5').update(data).digest('hex');
  assert.strictEqual(hash, 'e5a5c2c27801d2d03991bc8e5a1df8cb', 'auditLog SACRED violated');
});

// ── T03: server parse-clean ──────────────────────────────────────────────────
test('T03: ecos-api-server.js parse-clean + V474 present', () => {
  const src = fs.readFileSync(path.join(__dirname, '../ecos-api-server.js'), 'utf8');
  assert.ok(src.includes('_wireMeshDispatcherCanon474'), 'V474 IIFE not in server');
  assert.ok(src.includes('V474-T01'), 'V474 endpoint tags not found');
});

// ── T04: module loads ────────────────────────────────────────────────────────
test('T04: meshDispatcherCanon474 module loads', () => {
  const c = require('../lib/meshDispatcherCanon474.js');
  assert.strictEqual(typeof c.getCanonInfo474, 'function', 'getCanonInfo474 missing');
  assert.strictEqual(typeof c.getHealthSummary474, 'function', 'getHealthSummary474 missing');
  assert.strictEqual(typeof c.dispatchCapability474, 'function', 'dispatchCapability474 missing');
  assert.strictEqual(c.CANON_VERSION_474, '474.0.0', 'CANON_VERSION_474 mismatch');
});

// ── T05: getCanonInfo474 ─────────────────────────────────────────────────────
test('T05: getCanonInfo474 returns correct tower metadata', () => {
  const c = require('../lib/meshDispatcherCanon474.js');
  const info = c.getCanonInfo474();
  assert.strictEqual(info.tower, 'meshDispatcher', 'tower mismatch');
  assert.strictEqual(info.canonicalTip, 297, 'canonicalTip must be 297');
  assert.strictEqual(info.chainBase, 288, 'chainBase must be 288');
  assert.strictEqual(info.chainLength, 10, 'chainLength must be 10 (288..297)');
  assert.ok(info.bridgeVersion, 'bridgeVersion must be present');
});

// ── T06: getHealthSummary474 ─────────────────────────────────────────────────
test('T06: getHealthSummary474 returns ok health snapshot', () => {
  const c = require('../lib/meshDispatcherCanon474.js');
  const h = c.getHealthSummary474();
  assert.strictEqual(h.ok, true, 'health.ok must be true');
  assert.ok(parseInt(String(h.version).split('.')[0],10) >= 474, 'major >= 474');
  assert.ok('reasonFeed' in h, 'reasonFeed must be present');
  assert.ok('byValidator' in h, 'byValidator must be present');
  assert.ok('authGate' in h, 'authGate must be present');
});

// ── T07: dispatchCapability474 — known caps ──────────────────────────────────
test('T07: dispatchCapability474 handles health and info', () => {
  const c = require('../lib/meshDispatcherCanon474.js');
  const health = c.dispatchCapability474('health');
  assert.strictEqual(health.ok, true, 'health dispatch must succeed');
  assert.strictEqual(health.capId, 'health', 'capId must be health');
  const info = c.dispatchCapability474('info');
  assert.strictEqual(info.ok, true, 'info dispatch must succeed');
});

// ── T08: dispatchCapability474 — fail-closed ─────────────────────────────────
test('T08: dispatchCapability474 fail-closed on unknown capId', () => {
  const c = require('../lib/meshDispatcherCanon474.js');
  const bad = c.dispatchCapability474('totally_unknown_cap');
  assert.strictEqual(bad.ok, false, 'unknown cap must return ok:false');
  assert.ok(bad.error, 'error message must be present');
  assert.ok(Array.isArray(bad.known), 'known caps list must be present');
});

// ── T09: dispatchCapability474 — invalid input ───────────────────────────────
test('T09: dispatchCapability474 fail-closed on null capId', () => {
  const c = require('../lib/meshDispatcherCanon474.js');
  const bad = c.dispatchCapability474(null);
  assert.strictEqual(bad.ok, false, 'null capId must return ok:false');
});

// ── T10: D297 surface re-exported ────────────────────────────────────────────
test('T10: D297 surface re-exported from canon474', () => {
  const c = require('../lib/meshDispatcherCanon474.js');
  assert.ok(c.D297, 'D297 must be exported');
  assert.ok(c.ReasonIndexedFeed297, 'ReasonIndexedFeed297 must be exported');
  assert.ok(c.PerValidatorQuorumStats297, 'PerValidatorQuorumStats297 must be exported');
  assert.ok(c.QuorumStreamAuthGate297, 'QuorumStreamAuthGate297 must be exported');
});

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
process.exit(0);
