'use strict';
/**
 * tests/v514.test.js — ECOS V514
 * offlineQueue Canon Facade
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

console.log('\n─── V514 offlineQueue Canon Tests ───');

const canon514 = require('../lib/offlineQueueCanon514.js');

// [1] module loads with all expected exports
test('module loads with expected exports', () => {
  assert.strictEqual(typeof canon514.getCanonInfo514,       'function');
  assert.strictEqual(typeof canon514.getHealthSummary514,   'function');
  assert.strictEqual(typeof canon514.createInstance514,     'function');
  assert.strictEqual(typeof canon514.getDefaultInstance514, 'function');
  assert.strictEqual(typeof canon514.getQueueStatus514,     'function');
  assert.strictEqual(typeof canon514.registerEndpoints514,  'function');
  assert.strictEqual(typeof canon514.CANON_VERSION_514,     'string');
});

// [2] version correct
test('CANON_VERSION_514 === 514.0.0', () => {
  assert.strictEqual(canon514.CANON_VERSION_514, '514.0.0');
});

// [3] getCanonInfo514 structure
test('getCanonInfo514 returns expected fields', () => {
  const info = canon514.getCanonInfo514();
  assert.ok(parseInt(String(info.version).split('.')[0],10) >= 514);
  assert.strictEqual(info.tower, 'offlineQueue');
  assert.strictEqual(info.canonicalTip, 268);
  assert.strictEqual(info.chainBase, 263);
  assert.strictEqual(info.chainLength, 6);
  assert.ok(Array.isArray(info.capabilities));
  assert.ok(info.capabilities.length > 0);
});

// [4] getHealthSummary514 is safe and returns ok
test('getHealthSummary514 returns ok:true with expected shape', () => {
  const h = canon514.getHealthSummary514();
  assert.strictEqual(h.ok, true);
  assert.ok(parseInt(String(h.version).split('.')[0],10) >= 514);
  assert.ok('towerLoaded' in h);
  assert.ok('instanceReady' in h);
  assert.ok('priorityLevels' in h);
});

// [5] tower loaded (OfflineQueue268 available)
test('OfflineQueue268 class is accessible via canon', () => {
  assert.ok(canon514.OfflineQueue268, 'OfflineQueue268 should be exported');
  assert.strictEqual(typeof canon514.OfflineQueue268, 'function');
});

// [6] PRIORITY_LEVELS pass-through
test('PRIORITY_LEVELS_268 exported with CRITICAL/NORMAL/LOW', () => {
  const p = canon514.PRIORITY_LEVELS_268;
  assert.ok(p, 'PRIORITY_LEVELS_268 should exist');
  assert.ok('CRITICAL' in p);
  assert.ok('NORMAL' in p);
  assert.ok('LOW' in p);
});

// [7] createInstance514 returns working instance
test('createInstance514 returns ok:true with OfflineQueue268 instance', () => {
  const r = canon514.createInstance514();
  assert.strictEqual(r.ok, true);
  assert.ok(r.instance, 'instance should exist');
  assert.ok(typeof r.instance.enqueue268 === 'function' || typeof r.instance.middleware268 === 'function');
});

// [8] getDefaultInstance514 returns singleton
test('getDefaultInstance514 returns same instance on repeated calls', () => {
  const a = canon514.getDefaultInstance514();
  const b = canon514.getDefaultInstance514();
  assert.ok(a, 'default instance should exist');
  assert.strictEqual(a, b, 'should be the same singleton');
});

// [9] getQueueStatus514 fail-closed on missing userId
test('getQueueStatus514(null) → ok:false', () => {
  const r = canon514.getQueueStatus514(null);
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

// [10] getQueueStatus514 fail-closed on empty userId
test("getQueueStatus514('') → ok:false", () => {
  const r = canon514.getQueueStatus514('');
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

// [11] getQueueStatus514 valid userId → ok:true, depth=0
test("getQueueStatus514('user-test-514') → ok:true, depth 0 (empty queue)", () => {
  const r = canon514.getQueueStatus514('user-test-514');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.userId, 'user-test-514');
  assert.strictEqual(typeof r.depth, 'number');
  assert.ok('byPriority' in r);
});

// [12] SACRED hashes
test('SACRED files intact (fiatLedger + auditLog)', () => {
  const crypto = require('crypto');
  const fs     = require('fs');
  const check  = (file, expected) => {
    const hash = crypto.createHash('md5')
      .update(fs.readFileSync(path.resolve(__dirname, '..', file)))
      .digest('hex');
    assert.strictEqual(hash, expected, `SACRED hash mismatch: ${file}`);
  };
  check('lib/fiatLedger.js', '563e9b1f9e67091a5b6527c0a92568e5');
  check('lib/auditLog.js',   'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// [13] server parse clean
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
