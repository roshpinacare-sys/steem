'use strict';
/**
 * tests/v539.test.js — ECOS V539
 * Deep Health: aggregatedHeartbeatStatus538 + governanceDiagnose533
 */

const assert   = require('assert');
const path     = require('path');
const crypto   = require('crypto');
const fs       = require('fs');
const { execSync } = require('child_process');

const root       = path.resolve(__dirname, '..');
const serverPath = path.join(root, 'ecos-api-server.js');

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

console.log('\n─── V539 Deep Health Tests ───');

const DH = require('../lib/deepHealthStatus539.js');

// [1] module loads
test('module loads with expected exports', () => {
  assert.strictEqual(typeof DH.buildDeepHealth539,     'function');
  assert.strictEqual(typeof DH.registerEndpoints539,   'function');
  assert.strictEqual(typeof DH.DEEP_HEALTH_VERSION_539,'string');
});

// [2] version
test('DEEP_HEALTH_VERSION_539 === 539.0.0', () => {
  assert.strictEqual(DH.DEEP_HEALTH_VERSION_539, '539.0.0');
});

// [3] buildDeepHealth539 returns correct shape
test('buildDeepHealth539 returns {ok, status, version, aggregate, diagnostic, actionItems, summary}', () => {
  const r = DH.buildDeepHealth539();
  assert.ok(typeof r === 'object', 'result is object');
  assert.ok('ok'          in r, 'has ok');
  assert.ok('status'      in r, 'has status');
  assert.ok('version'     in r, 'has version');
  assert.ok('aggregate'   in r, 'has aggregate');
  assert.ok('diagnostic'  in r, 'has diagnostic');
  assert.ok('actionItems' in r, 'has actionItems');
  assert.ok('summary'     in r, 'has summary');
  assert.ok('ts'          in r, 'has ts');
});

// [4] version field correct
test('buildDeepHealth539 version field is 539.0.0', () => {
  const r = DH.buildDeepHealth539();
  assert.strictEqual(r.version, '539.0.0');
});

// [5] aggregate layer loaded (V538 dep available)
test('aggregate layer loaded from aggregatedHeartbeatStatus538', () => {
  const r = DH.buildDeepHealth539();
  assert.strictEqual(r.aggregate.loaded, true, 'aggregate.loaded should be true');
  assert.strictEqual(r.aggregate.error, null, `aggregate.error should be null, got: ${r.aggregate.error}`);
  assert.ok(r.aggregate.data, 'aggregate.data should be present');
});

// [6] diagnostic layer loaded (V533 dep available)
test('diagnostic layer loaded from governanceDiagnose533', () => {
  const r = DH.buildDeepHealth539();
  assert.strictEqual(r.diagnostic.loaded, true, 'diagnostic.loaded should be true');
  assert.strictEqual(r.diagnostic.error, null, `diagnostic.error should be null, got: ${r.diagnostic.error}`);
  assert.ok(r.diagnostic.data, 'diagnostic.data should be present');
});

// [7] actionItems is non-empty array (system has known issues in test env)
test('actionItems is an array with at least one item', () => {
  const r = DH.buildDeepHealth539();
  assert.ok(Array.isArray(r.actionItems), 'actionItems should be array');
  assert.ok(r.actionItems.length >= 1, 'should have at least one action item');
  // each item is a string
  for (const item of r.actionItems) {
    assert.strictEqual(typeof item, 'string', `item should be string: ${item}`);
  }
});

// [8] status is one of ok/degraded/unhealthy
test('status is valid enum value', () => {
  const r = DH.buildDeepHealth539();
  assert.ok(['ok','degraded','unhealthy'].includes(r.status), `invalid status: ${r.status}`);
});

// [9] fail-closed: registerEndpoints539 returns false for bad/missing app
test('registerEndpoints539 returns false for null/missing app', () => {
  assert.strictEqual(DH.registerEndpoints539(null),      false);
  assert.strictEqual(DH.registerEndpoints539(undefined), false);
  assert.strictEqual(DH.registerEndpoints539({}),        false); // no .get fn
});

// [10] SACRED intact
test('SACRED files intact (fiatLedger + auditLog)', () => {
  const check = (file, expected) => {
    const hash = crypto.createHash('md5')
      .update(fs.readFileSync(path.join(root, file)))
      .digest('hex');
    assert.strictEqual(hash, expected, `SACRED hash mismatch: ${file}`);
  };
  check('lib/fiatLedger.js', '563e9b1f9e67091a5b6527c0a92568e5');
  check('lib/auditLog.js',   'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// [11] server parse clean
test('ecos-api-server.js parses without errors', () => {
  execSync(`node --check ${serverPath}`, { stdio: 'pipe' });
});

// ─── Summary ───
console.log('\n─────────────────────────');
console.log(`  Passed: ${passed} / ${passed + failed}`);
if (failed > 0) {
  console.error(`  FAILED: ${failed}`);
  process.exit(1);
} else {
  console.log('  All tests passed ✓');
  process.exit(0);
}
