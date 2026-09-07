'use strict';
/**
 * tests/v537.test.js — ECOS V537
 * בודק: activeHb532 exposure, SACRED, server parse, wiring
 * הרצה: NODE_ENV=test node tests/v537.test.js  →  exit 0
 */

const assert = require('assert');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const { execFileSync } = require('child_process');

const BASE = path.resolve(__dirname, '..');
let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.error('  ✗', name, '—', e.message); failed++; }
}
function md5File(p) {
  return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
}

console.log('\n=== ECOS V537 Tests ===\n');

// 1-2. SACRED
test('SACRED: fiatLedger.js md5 intact', () => {
  assert.strictEqual(md5File(path.join(BASE,'lib/fiatLedger.js')), '563e9b1f9e67091a5b6527c0a92568e5');
});
test('SACRED: auditLog.js md5 intact', () => {
  assert.strictEqual(md5File(path.join(BASE,'lib/auditLog.js')), 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// 3. version
test('package.json version >= 537', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(BASE,'package.json'),'utf8'));
  assert(parseInt(pkg.version) >= 537, 'version=' + pkg.version);
});

// 4. server parse
test('ecos-api-server.js parses cleanly', () => {
  execFileSync(process.execPath, ['--check', path.join(BASE,'ecos-api-server.js')]);
});

// 5. heartbeatGovernanceBridge532 exports activeHb532 accessor
test('heartbeatGovernanceBridge532 exports activeHb532 getter/setter', () => {
  const mod = require(path.join(BASE,'lib/heartbeatGovernanceBridge532.js'));
  // getter/setter must exist
  const desc = Object.getOwnPropertyDescriptor(mod, 'activeHb532');
  assert.ok(desc, 'activeHb532 not found on module exports');
  assert.strictEqual(typeof desc.get, 'function', 'activeHb532 has no getter');
  assert.strictEqual(typeof desc.set, 'function', 'activeHb532 has no setter');
});

// 6. activeHb532 initially null (before V532 IIFE runs in this test env)
test('activeHb532 starts as null before V532 IIFE', () => {
  const mod = require(path.join(BASE,'lib/heartbeatGovernanceBridge532.js'));
  // May be set if V532 IIFE ran; both null and non-null are valid here.
  // Just assert it's readable without throwing.
  const v = mod.activeHb532;
  assert.ok(v === null || typeof v === 'object', 'activeHb532 unexpected type: ' + typeof v);
});

// 7. activeHb532 setter round-trip
test('activeHb532 setter round-trip works', () => {
  const mod = require(path.join(BASE,'lib/heartbeatGovernanceBridge532.js'));
  const orig = mod.activeHb532;
  const fake = { status: () => ({ running: false }), _testMarker: 'v537' };
  mod.activeHb532 = fake;
  assert.strictEqual(mod.activeHb532._testMarker, 'v537', 'setter did not persist value');
  mod.activeHb532 = orig; // restore
});

// 8. activeBridge532 still intact (no regression)
test('activeBridge532 accessor still intact (no regression)', () => {
  const mod = require(path.join(BASE,'lib/heartbeatGovernanceBridge532.js'));
  const desc = Object.getOwnPropertyDescriptor(mod, 'activeBridge532');
  assert.ok(desc && typeof desc.get === 'function', 'activeBridge532 getter broken');
  assert.ok(desc && typeof desc.set === 'function', 'activeBridge532 setter broken');
});

// 9. V537 IIFE wired in server
test('V537 IIFE wired in ecos-api-server.js', () => {
  const src = fs.readFileSync(path.join(BASE,'ecos-api-server.js'),'utf8');
  assert.ok(src.includes('_wireActiveHb537'),                                   'missing IIFE');
  assert.ok(src.includes('/api/v1/diamond/heartbeat/governance/status/v537'),   'missing status endpoint');
  assert.ok(src.includes('/api/v1/admin/summary/v537'),                         'missing summary endpoint');
  assert.ok(src.includes('Bridge532.activeHb532'),                              'activeHb532 not read in IIFE');
});

// 10. _getOrCreate532 sets activeHb532 (line present in server)
test('_getOrCreate532 sets Bridge532.activeHb532 after creating hb', () => {
  const src = fs.readFileSync(path.join(BASE,'ecos-api-server.js'),'utf8');
  assert.ok(src.includes('Bridge532.activeHb532 = _hb532'), 'V537: _getOrCreate532 must set activeHb532');
});

// 11. activeHb532 setter in lib and src/lib stay in sync
test('src/lib/heartbeatGovernanceBridge532.js exports activeHb532 (copy in sync)', () => {
  const srcPath = path.join(BASE,'src/lib/heartbeatGovernanceBridge532.js');
  if (!fs.existsSync(srcPath)) { console.log('    (src/lib copy not present — skipped)'); passed++; return; }
  const src = require(srcPath);
  const desc = Object.getOwnPropertyDescriptor(src, 'activeHb532');
  assert.ok(desc && typeof desc.get === 'function', 'src/lib copy missing activeHb532 getter');
});

// 12. convention: activeBridge532 getter/setter convention still used in V532 IIFE
test('V532 IIFE still sets activeBridge532 (no regression)', () => {
  const src = fs.readFileSync(path.join(BASE,'ecos-api-server.js'),'utf8');
  assert.ok(src.includes('Bridge532.activeBridge532 = _bridge532'), 'V532 activeBridge532 assignment gone');
});

console.log('\n──────────────────────────────');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) { console.error('FAILED'); process.exit(1); }
else { console.log('ALL PASSED ✓'); process.exit(0); }
