'use strict';
/**
 * tests/v478.test.js — ECOS V478
 * meshDispatcher Canon Facade (updated)
 */

const assert = require('assert');
const path   = require('path');
const { execSync } = require('child_process');
const serverPath = path.resolve(__dirname, '../ecos-api-server.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

console.log('\n─── V478 meshDispatcher Canon Tests ───');

const canon478 = require('../lib/meshDispatcherCanon478.js');

// [1] module loads
test('module loads with expected exports', () => {
  assert.strictEqual(typeof canon478.getCanonInfo478,       'function');
  assert.strictEqual(typeof canon478.getHealthSummary478,   'function');
  assert.strictEqual(typeof canon478.dispatchCapability478, 'function');
  assert.strictEqual(typeof canon478.registerEndpoints478,  'function');
  assert.strictEqual(typeof canon478.CANON_VERSION_478,     'string');
});

// [2] version
test('CANON_VERSION_478 === 478.0.0', () => {
  assert.strictEqual(canon478.CANON_VERSION_478, '478.0.0');
});

// [3] getCanonInfo478 structure
test('getCanonInfo478 returns expected fields', () => {
  const info = canon478.getCanonInfo478();
  assert.ok(parseInt(String(info.version).split('.')[0],10) >= 478, 'major >= 478');
  assert.strictEqual(info.tower, 'meshDispatcher');
  assert.strictEqual(info.canonicalTip, 297);
  assert.strictEqual(info.chainBase, 288);
  assert.strictEqual(info.chainLength, 10);
  assert.ok(Array.isArray(info.supersedes));
  assert.ok(info.supersedes.includes('meshDispatcherCanon474'));
});

// [4] getHealthSummary478 is safe and returns ok
test('getHealthSummary478 returns ok:true and version', () => {
  const h = canon478.getHealthSummary478();
  assert.strictEqual(h.ok, true);
  assert.ok(parseInt(String(h.version).split('.')[0],10) >= 478, 'major >= 478');
  assert.ok('towerLoaded' in h);
  assert.ok('streamPresent' in h);
  assert.ok('defaults' in h);
});

// [5] dispatch 'info'
test("dispatchCapability478('info') returns canon info", () => {
  const r = canon478.dispatchCapability478('info');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.capId, 'info');
  assert.ok(parseInt(String(r.result.version).split('.')[0],10) >= 478, 'major >= 478');
});

// [6] dispatch 'health'
test("dispatchCapability478('health') returns health object", () => {
  const r = canon478.dispatchCapability478('health');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.capId, 'health');
  assert.ok(r.result && typeof r.result.ok === 'boolean');
});

// [7] dispatch 'stats'
test("dispatchCapability478('stats') returns stats structure", () => {
  const r = canon478.dispatchCapability478('stats');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.capId, 'stats');
  assert.ok('result' in r);
  assert.ok(parseInt(String(r.result.version).split('.')[0],10) >= 478, 'major >= 478');
});

// [8] dispatch unknown → fail-closed
test("dispatchCapability478('unknown') → ok:false", () => {
  const r = canon478.dispatchCapability478('unknown-cap-xyz');
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
  assert.ok(Array.isArray(r.known));
  assert.ok(r.known.includes('search'));
});

// [9] dispatch invalid input → fail-closed
test('dispatchCapability478(null) → ok:false', () => {
  const r = canon478.dispatchCapability478(null);
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

// [10] dispatch 'search-by-decision' — bad decision → ok:false
test("dispatchCapability478('search-by-decision') missing decision → ok:false", () => {
  const r = canon478.dispatchCapability478('search-by-decision', {});
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

// [11] SACRED hashes
test('SACRED files intact (fiatLedger + auditLog)', () => {
  const crypto = require('crypto');
  const fs     = require('fs');
  const check  = (file, expected) => {
    const hash = crypto.createHash('md5').update(fs.readFileSync(path.resolve(__dirname, '..', file))).digest('hex');
    assert.strictEqual(hash, expected, `SACRED hash mismatch: ${file}`);
  };
  check('lib/fiatLedger.js', '563e9b1f9e67091a5b6527c0a92568e5');
  check('lib/auditLog.js',   'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// [12] server parse clean
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
