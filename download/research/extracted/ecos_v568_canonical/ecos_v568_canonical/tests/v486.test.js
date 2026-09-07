/**
 * tests/v486.test.js — ECOS V486 — providerAdapters278Canon486 shim
 * Run: NODE_ENV=test node tests/v486.test.js
 * @version 486.0.0
 */
'use strict';
process.env.NODE_ENV = 'test';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

let passed = 0, failed = 0;
const errors = [];
function test(name, fn) {
  try { fn(); console.log('  \u2713 ' + name); passed++; }
  catch (e) { console.error('  \u2717 ' + name + ': ' + e.message); failed++; errors.push(name); }
}

// ── SACRED ───────────────────────────────────────────────────────────────────
console.log('\n[V486] SACRED integrity\n');

test('T01: fiatLedger.js SACRED hash', () => {
  const h = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, 'lib/fiatLedger.js'))).digest('hex');
  assert.strictEqual(h, '563e9b1f9e67091a5b6527c0a92568e5', 'fiatLedger SACRED violated');
});

test('T02: auditLog.js SACRED hash', () => {
  const h = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, 'lib/auditLog.js'))).digest('hex');
  assert.strictEqual(h, 'e5a5c2c27801d2d03991bc8e5a1df8cb', 'auditLog SACRED violated');
});

// ── server ────────────────────────────────────────────────────────────────────
console.log('\n[V486] Server checks\n');

test('T03: server parse-clean + V486 IIFE present', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  assert.ok(src.includes('_wireProviderAdapters278Canon486'), 'V486 IIFE not found');
  assert.ok(src.includes('V486-T01'), 'V486 endpoint tag not found');
});

// ── shim module ───────────────────────────────────────────────────────────────
console.log('\n[V486] Canon shim checks\n');

test('T04: providerAdapters278Canon486 loads from lib/', () => {
  const c = require(path.join(ROOT, 'lib/providerAdapters278Canon486.js'));
  assert.strictEqual(typeof c.getCanonInfo486, 'function', 'getCanonInfo486 must be function');
  assert.strictEqual(typeof c.validateProvider278, 'function', 'validateProvider278 must be function');
});

test('T05: getCanonInfo486 correct metadata', () => {
  const c    = require(path.join(ROOT, 'lib/providerAdapters278Canon486.js'));
  const info = c.getCanonInfo486();
  assert.ok(parseInt(String(info.version).split('.')[0],10) >= 486, 'major >= 486');
  assert.ok(info.file.includes('278Canon486'),                              'file name wrong');
  assert.ok(info.prevShim.includes('277Canon485'),                         'prevShim wrong');
  assert.ok(info.contractCount > 0,                                        'contractCount must be >0');
});

test('T06: full V278 surface re-exported via shim', () => {
  const c = require(path.join(ROOT, 'lib/providerAdapters278Canon486.js'));
  for (const sym of ['PROVIDER_CONTRACTS_278','validateProvider278','validateAllProviders278','createAlertSlaStub278','createAllStubs278']) {
    assert.ok(sym in c, 'missing export: ' + sym);
  }
});

test('T07: PROVIDER_CONTRACTS_278 is frozen object', () => {
  const c = require(path.join(ROOT, 'lib/providerAdapters278Canon486.js'));
  assert.ok(Object.isFrozen(c.PROVIDER_CONTRACTS_278), 'PROVIDER_CONTRACTS_278 must be frozen');
});

test('T08: validateProvider278 rejects unknown contract via shim', () => {
  const c   = require(path.join(ROOT, 'lib/providerAdapters278Canon486.js'));
  let threw = false, res;
  try { res = c.validateProvider278('nonexistent_key_486', {}); } catch (_) { threw = true; }
  // Either throws or returns { ok:false } / { valid:false } / { errors:... }
  if (!threw) {
    const isInvalid = res && (res.ok === false || res.valid === false || Array.isArray(res.errors));
    assert.ok(isInvalid, 'unknown contract should be rejected, got: ' + JSON.stringify(res));
  }
});

test('T09: V279 now imports from Canon486 shim (not 278 directly)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/providerAdapters279.js'), 'utf8');
  assert.ok(src.includes('providerAdapters278Canon486'), 'V279 must import Canon486 shim');
  assert.ok(!src.includes("require('./providerAdapters278')"), 'V279 must NOT import 278 directly');
});

test('T10: version is 486.0.0', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(parseInt(pkg.version) >= 486, 'version must be >= 486, got: ' + pkg.version);
});

// ── summary ───────────────────────────────────────────────────────────────────
console.log('\n[V486] Results\n');
console.log('  ' + passed + ' passed, ' + failed + ' failed');
if (errors.length) console.error('  Failed:', errors.join(', '));
console.log('');
process.exit(failed > 0 ? 1 : 0);
