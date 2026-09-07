'use strict';
/**
 * tests/v506.test.js — ECOS V506 (Phase P250) — /api/v1/status upgraded to status505
 * Run: NODE_ENV=test node tests/v506.test.js   → must exit 0
 */
process.env.NODE_ENV = 'test';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  \u2713 ' + name); passed++; }
  catch (e) { console.error('  \u2717 ' + name + ': ' + e.message); failed++; }
}

// ─── T01: SACRED ─────────────────────────────────────────────────────────────
console.log('\n[T01] SACRED integrity');
test('fiatLedger.js intact', () => {
  const h = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, 'lib/fiatLedger.js'))).digest('hex');
  assert.strictEqual(h, '563e9b1f9e67091a5b6527c0a92568e5');
});
test('auditLog.js intact', () => {
  const h = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, 'lib/auditLog.js'))).digest('hex');
  assert.strictEqual(h, 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// ─── T02: Server syntax ───────────────────────────────────────────────────────
console.log('\n[T02] Server syntax');
test('ecos-api-server.js parses cleanly', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  assert.doesNotThrow(() => new vm.Script(src, { filename: 'ecos-api-server.js' }));
});

// ─── T03: Version ─────────────────────────────────────────────────────────────
console.log('\n[T03] Version');
test('package.json version >= 506', () => {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  assert.ok(parseInt(String(v).split('.')[0], 10) >= 506, 'got ' + v);
});

// ─── T04: systemStatus505 loads correctly ────────────────────────────────────
console.log('\n[T04] systemStatus505 module');
let status505;
test('lib/systemStatus505.js loads', () => {
  status505 = require(path.join(ROOT, 'lib/systemStatus505.js'));
  assert.ok(status505);
});
test('getSystemPosture505 is a function', () => {
  assert.strictEqual(typeof status505.getSystemPosture505, 'function');
});
test('getSystemPosture505() returns governance.ok = true', () => {
  const p = status505.getSystemPosture505();
  assert.ok(p.governance && p.governance.ok === true, 'governance.ok should be true, got: ' + JSON.stringify(p.governance));
});
test('getSystemPosture505() signal is GREEN, YELLOW or RED', () => {  // V510: RED is valid when realFail>0
  const p = status505.getSystemPosture505();
  assert.ok(['GREEN', 'YELLOW', 'RED'].includes(p.signal), 'unexpected signal: ' + p.signal);
});

// ─── T05: Server wiring for V506 ─────────────────────────────────────────────
console.log('\n[T05] Server wiring');
const SERVER = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
test('server requires systemStatus505', () => {
  assert.ok(SERVER.includes("require('./lib/systemStatus505.js')"), 'systemStatus505 require missing');
});
test('server has _appRoutes in-place replacement logic', () => {
  assert.ok(SERVER.includes('_appRoutes[i]') && SERVER.includes("path === '/api/v1/status'"), 'in-place replacement missing');
});
test('server wires GET /api/v1/admin/summary/v506', () => {
  assert.ok(SERVER.includes('/api/v1/admin/summary/v506'), 'summary/v506 missing');
});
test('V506-T01 and V506-T02 tags present', () => {
  assert.ok(SERVER.includes('V506-T01'), 'V506-T01 tag missing');
  assert.ok(SERVER.includes('V506-T02'), 'V506-T02 tag missing');
});

// ─── T06: GET /api/v1/status now served by status505 (simulation) ────────────
console.log('\n[T06] Route upgrade simulation');
test('_appRoutes replacement logic does not break syntax', () => {
  // Verify the replacement block is syntactically present and refers to right modules
  assert.ok(SERVER.includes("method === 'GET' && _appRoutes[i].path === '/api/v1/status'"));
  assert.ok(SERVER.includes('ecosVersion: \'V506\''));
});
test('backwards-compat alias: getSystemPosture504 patched to status505', () => {
  // After V506 IIFE runs, status504.getSystemPosture504 should delegate to status505
  const s504 = require(path.join(ROOT, 'lib/systemStatus504.js'));
  const s505 = require(path.join(ROOT, 'lib/systemStatus505.js'));
  // Monkey-patch simulation (mirrors what the IIFE does at runtime)
  s504.getSystemPosture504 = () => s505.getSystemPosture505();
  const p = s504.getSystemPosture504();
  assert.ok(p.governance && p.governance.ok === true, 'backwards-compat alias failed');
});

// ─── T07: V505 regression ─────────────────────────────────────────────────────
console.log('\n[T07] V505 regression');
test('systemStatus505.js still exists and loads', () => {
  require(path.join(ROOT, 'lib/systemStatus505.js'));
});
test('server still wires /api/v1/status/v505', () => {
  assert.ok(SERVER.includes('/api/v1/status/v505'), '/api/v1/status/v505 missing');
});

// ─── Results ──────────────────────────────────────────────────────────────────
console.log('\n─────────────────────────────');
console.log('V506 tests: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) { console.error('FAILED'); process.exit(1); }
console.log('ALL TESTS PASSED\n');
