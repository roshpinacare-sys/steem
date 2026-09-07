'use strict';
/**
 * tests/v476.test.js — ECOS V476
 * בודק: providerAdaptersCanon476, SACRED md5, server parse, endpoints
 * הרצה: NODE_ENV=test node tests/v476.test.js  →  exit 0
 */

const assert = require('assert');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const BASE = path.resolve(__dirname, '..');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  ✓', name);
    passed++;
  } catch (e) {
    console.error('  ✗', name, '—', e.message);
    failed++;
  }
}

function md5File(fp) {
  return crypto.createHash('md5').update(fs.readFileSync(fp)).digest('hex');
}

console.log('\n=== ECOS V476 Tests ===\n');

// ── 1. SACRED ───────────────────────────────────────────────────────────────
test('SACRED: fiatLedger.js md5 intact', () => {
  assert.strictEqual(md5File(path.join(BASE, 'lib/fiatLedger.js')),
    '563e9b1f9e67091a5b6527c0a92568e5');
});

test('SACRED: auditLog.js md5 intact', () => {
  assert.strictEqual(md5File(path.join(BASE, 'lib/auditLog.js')),
    'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// ── 2. version ──────────────────────────────────────────────────────────────
test('package.json version >= 476', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(BASE, 'package.json'), 'utf8'));
  assert(parseInt(pkg.version) >= 476, 'version=' + pkg.version);
});

// ── 3. server parse ─────────────────────────────────────────────────────────
test('ecos-api-server.js parses cleanly', () => {
  const { execFileSync } = require('child_process');
  execFileSync(process.execPath, ['--check', path.join(BASE, 'ecos-api-server.js')]);
});

// ── 4. module loads ─────────────────────────────────────────────────────────
test('providerAdaptersCanon476 module loads', () => {
  const mod = require(path.join(BASE, 'lib/providerAdaptersCanon476.js'));
  assert.strictEqual(typeof mod.getCanonInfo476,       'function');
  assert.strictEqual(typeof mod.getHealthSummary476,   'function');
  assert.strictEqual(typeof mod.validateProvider476,   'function');
  assert.strictEqual(typeof mod.createAllStubs476,     'function');
  assert.strictEqual(typeof mod.registerEndpoints476,  'function');
  assert.ok(mod.CANON_VERSION_476.startsWith('476'));
});

// ── 5. getCanonInfo476 ──────────────────────────────────────────────────────
test('getCanonInfo476 returns correct metadata', () => {
  const mod = require(path.join(BASE, 'lib/providerAdaptersCanon476.js'));
  const info = mod.getCanonInfo476();
  assert.strictEqual(info.tower,           'providerAdapters');
  assert.strictEqual(info.tipVersion,      286);
  assert.strictEqual(info.baseVersion,     267);
  assert.strictEqual(info.moduleCount,     17);
  assert.strictEqual(info.contractCount,   36);
  assert.ok(info.importGuidance.includes('providerAdaptersCanon476'));
});

// ── 6. getHealthSummary476 ──────────────────────────────────────────────────
test('getHealthSummary476 reports healthy with 36 contracts', () => {
  const mod = require(path.join(BASE, 'lib/providerAdaptersCanon476.js'));
  const h = mod.getHealthSummary476();
  assert.ok(h.healthy, 'should be healthy; errors: ' + JSON.stringify(h.errors));
  assert.strictEqual(h.contractCount, 36);
  assert.ok(h.stubsOk,      'stubs should match contract count');
  assert.ok(h.validationOk, 'self-validation should pass');
  assert.ok(typeof h.ts === 'string');
});

// ── 7. validateProvider476 delegates correctly ───────────────────────────────
test('validateProvider476 validates a known contract (presetGroups stub)', () => {
  const mod = require(path.join(BASE, 'lib/providerAdaptersCanon476.js'));
  const stubs = mod.createAllStubs476();
  const result = mod.validateProvider476('presetGroups', stubs.presetGroups);
  assert.ok(result.ok, 'should validate OK; errors: ' + JSON.stringify(result.errors));
  assert.deepStrictEqual(result.errors, []);
});

// ── 8. validateProvider476 rejects unknown contract ──────────────────────────
test('validateProvider476 rejects unknown contract key', () => {
  const mod = require(path.join(BASE, 'lib/providerAdaptersCanon476.js'));
  const result = mod.validateProvider476('nonExistentContract999', {});
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.length > 0);
});

// ── 9. createAllStubs476 produces 36 contracts ───────────────────────────────
test('createAllStubs476 produces all 36 contract stubs', () => {
  const mod = require(path.join(BASE, 'lib/providerAdaptersCanon476.js'));
  const stubs = mod.createAllStubs476();
  assert.strictEqual(Object.keys(stubs).length, 36);
  // spot-check a few known contracts
  assert.ok(stubs.settlementProvider, 'settlementProvider stub missing');
  assert.ok(stubs.presetGroups,       'presetGroups stub missing');
  assert.ok(stubs.filterPresets,      'filterPresets stub missing');
});

// ── 10. lib and src copies match ─────────────────────────────────────────────
test('lib/ and src/lib/ copies of canon476 are identical', () => {
  const libPath = path.join(BASE, 'lib/providerAdaptersCanon476.js');
  const srcPath = path.join(BASE, 'src/lib/providerAdaptersCanon476.js');
  assert.ok(fs.existsSync(libPath), 'lib copy missing');
  assert.ok(fs.existsSync(srcPath), 'src/lib copy missing');
  // content should match (they were created from the same source)
  const libHash = md5File(libPath);
  const srcHash = md5File(srcPath);
  assert.strictEqual(libHash, srcHash, 'lib/ and src/lib/ copies differ');
});

// ── Results ──────────────────────────────────────────────────────────────────
console.log('\n─────────────────────────');
console.log(`  Passed: ${passed} / ${passed + failed}`);
if (failed > 0) {
  console.error(`  Failed: ${failed}`);
  process.exit(1);
} else {
  console.log('  All tests passed ✓');
  process.exit(0);
}
