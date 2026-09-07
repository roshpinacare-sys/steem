'use strict';
/**
 * tests/v512.test.js — ECOS V512
 * בודק: sybilGuardCanon512, SACRED md5, server parse
 * הרצה: NODE_ENV=test node tests/v512.test.js  →  exit 0
 */

const assert = require('assert');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const { execFileSync } = require('child_process');

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

console.log('\n=== ECOS V512 Tests ===\n');

// ── 1-2. SACRED ─────────────────────────────────────────────────────────────
test('SACRED: fiatLedger.js md5 intact', () => {
  assert.strictEqual(md5File(path.join(BASE, 'lib/fiatLedger.js')),
    '563e9b1f9e67091a5b6527c0a92568e5');
});

test('SACRED: auditLog.js md5 intact', () => {
  assert.strictEqual(md5File(path.join(BASE, 'lib/auditLog.js')),
    'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// ── 3. version ───────────────────────────────────────────────────────────────
test('package.json version >= 512', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(BASE, 'package.json'), 'utf8'));
  assert(parseInt(pkg.version) >= 512, 'got: ' + pkg.version);
});

// ── 4. server parse ──────────────────────────────────────────────────────────
test('ecos-api-server.js parses cleanly', () => {
  execFileSync(process.execPath, ['--check', path.join(BASE, 'ecos-api-server.js')]);
});

// ── 5. module loads ──────────────────────────────────────────────────────────
test('sybilGuardCanon512 module loads with all exports', () => {
  const mod = require(path.join(BASE, 'lib/sybilGuardCanon512.js'));
  assert.strictEqual(typeof mod.getCanonInfo512,      'function');
  assert.strictEqual(typeof mod.getHealthSummary512,  'function');
  assert.strictEqual(typeof mod.createInstance512,    'function');
  assert.strictEqual(typeof mod.registerEndpoints512, 'function');
  assert.strictEqual(typeof mod.SybilGuard268,        'function');
  assert.ok(mod.CANON_VERSION_512.startsWith('512'));
});

// ── 6. getCanonInfo512 ───────────────────────────────────────────────────────
test('getCanonInfo512 returns correct tower metadata', () => {
  const mod = require(path.join(BASE, 'lib/sybilGuardCanon512.js'));
  const info = mod.getCanonInfo512();
  assert.strictEqual(info.tower,       'sybilGuard');
  assert.strictEqual(info.tipVersion,  268);
  assert.strictEqual(info.baseVersion, 263);
  assert.strictEqual(info.moduleCount, 6);
  assert.ok(info.importGuidance.includes('sybilGuardCanon512'));
});

// ── 7. getHealthSummary512 ───────────────────────────────────────────────────
test('getHealthSummary512 reports healthy with 10 signals', () => {
  const mod = require(path.join(BASE, 'lib/sybilGuardCanon512.js'));
  const h = mod.getHealthSummary512();
  assert.ok(h.healthy, 'should be healthy; errors: ' + JSON.stringify(h.errors));
  assert.strictEqual(h.signalCount,  10);
  assert.ok(h.instanceOk, 'instance should be SybilGuard268');
  assert.strictEqual(h.moduleCount,  6);
  assert.deepStrictEqual(h.errors, []);
});

// ── 8. createInstance512 ─────────────────────────────────────────────────────
test('createInstance512 produces a SybilGuard268 instance', () => {
  const mod = require(path.join(BASE, 'lib/sybilGuardCanon512.js'));
  const sg = mod.createInstance512({});
  assert.ok(sg instanceof mod.SybilGuard268, 'should be SybilGuard268 instance');
});

// ── 9. SIGNAL_WEIGHTS_268 re-exported ────────────────────────────────────────
test('SIGNAL_WEIGHTS_268 re-exported with correct keys', () => {
  const mod = require(path.join(BASE, 'lib/sybilGuardCanon512.js'));
  const sw = mod.SIGNAL_WEIGHTS_268;
  assert.ok(sw, 'SIGNAL_WEIGHTS_268 should be present');
  assert.ok(typeof sw.has_tip_history      === 'number', 'has_tip_history missing');
  assert.ok(typeof sw.has_mission_complete === 'number', 'has_mission_complete missing');
  assert.ok(typeof sw.flag_velocity        === 'number', 'flag_velocity missing');
  assert.ok(typeof sw.self_reported        === 'number', 'self_reported missing');
  assert.strictEqual(Object.keys(sw).length, 10);
});

// ── 10. lib and src copies match ─────────────────────────────────────────────
test('lib/ and src/lib/ copies are identical', () => {
  const libPath = path.join(BASE, 'lib/sybilGuardCanon512.js');
  const srcPath = path.join(BASE, 'src/lib/sybilGuardCanon512.js');
  assert.ok(fs.existsSync(libPath), 'lib/ copy missing');
  assert.ok(fs.existsSync(srcPath), 'src/lib/ copy missing');
  const h1 = md5File(libPath);
  const h2 = md5File(srcPath);
  assert.strictEqual(h1, h2, 'lib/ and src/lib/ differ');
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
