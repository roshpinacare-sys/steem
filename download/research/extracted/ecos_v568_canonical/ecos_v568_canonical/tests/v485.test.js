/**
 * tests/v485.test.js — ECOS V485 — providerAdapters277 Canon Shim
 * Run: NODE_ENV=test node tests/v485.test.js
 * @version 485.0.0
 */
'use strict';
process.env.NODE_ENV = 'test';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

let passed = 0, failed = 0, errors = [];
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + ': ' + e.message); failed++; errors.push(name); }
}

// ── SACRED ──
console.log('\n[V485] SACRED\n');
test('fiatLedger.js md5 unchanged', () => {
  const sum = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT,'lib/fiatLedger.js'))).digest('hex');
  assert.strictEqual(sum, '563e9b1f9e67091a5b6527c0a92568e5');
});
test('auditLog.js md5 unchanged', () => {
  const sum = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT,'lib/auditLog.js'))).digest('hex');
  assert.strictEqual(sum, 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// ── syntax ──
console.log('\n[V485] syntax\n');
test('ecos-api-server.js parses cleanly', () => {
  require('child_process').execSync('node --check ' + path.join(ROOT,'ecos-api-server.js'), {stdio:'pipe'});
});

// ── canon485 module ──
console.log('\n[V485] providerAdapters277Canon485\n');
const canon = require(path.join(ROOT,'lib/providerAdapters277Canon485.js'));

test('getCanonInfo485 metadata correct', () => {
  const info = canon.getCanonInfo485();
  assert.ok(parseInt(String(info.version).split('.')[0],10) >= 485, 'major >= 485');
  assert.ok(info.file.includes('277Canon485'));
  assert.strictEqual(info.contractCount, 27);
  assert.ok(Array.isArray(info.contracts));
  assert.ok(info.contracts.includes('alertEscalation'), 'alertEscalation contract present');
});

test('CANON_VERSION_485 not needed — PROVIDER_CONTRACTS_277 exported', () => {
  assert.ok(canon.PROVIDER_CONTRACTS_277, 'PROVIDER_CONTRACTS_277 exported');
  assert.strictEqual(Object.keys(canon.PROVIDER_CONTRACTS_277).length, 27);
});

test('validateProvider277 is function', () => {
  assert.strictEqual(typeof canon.validateProvider277, 'function');
});

test('createAllStubs277 is function', () => {
  assert.strictEqual(typeof canon.createAllStubs277, 'function');
});

// ── V278 loads via shim ──
console.log('\n[V485] V278 chain via shim\n');
test('providerAdapters278 loads via canon485 shim', () => {
  require(path.join(ROOT,'lib/providerAdapters278.js'));
});

test('V278 lib require points to canon485', () => {
  const src = fs.readFileSync(path.join(ROOT,'lib/providerAdapters278.js'),'utf8');
  assert.ok(src.includes('providerAdapters277Canon485'), 'V278 lib must import via canon485');
});

test('V278 src require points to canon485', () => {
  const src = fs.readFileSync(path.join(ROOT,'src/lib/providerAdapters278.js'),'utf8');
  assert.ok(src.includes('providerAdapters277Canon485'), 'V278 src must import via canon485');
});

// ── mirror ──
console.log('\n[V485] src/lib mirror\n');
test('src and lib canon485 shim are identical', () => {
  const a = fs.readFileSync(path.join(ROOT,'src/lib/providerAdapters277Canon485.js'));
  const b = fs.readFileSync(path.join(ROOT,'lib/providerAdapters277Canon485.js'));
  assert.ok(a.equals(b), 'src and lib must be byte-identical');
});

// ── endpoints wired ──
console.log('\n[V485] endpoints\n');
test('GET /api/v1/providers/canon/277/status wired', () => {
  const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
  assert.ok(src.includes('/api/v1/providers/canon/277/status'));
});
test('GET /api/v1/admin/summary/v485 wired', () => {
  const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
  assert.ok(src.includes('/api/v1/admin/summary/v485'));
});

// ── package version ──
console.log('\n[V485] version\n');
test('package.json version >= 485', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8'));
  assert.ok(parseInt(pkg.version) >= 485);
});

console.log('\n' + '─'.repeat(50));
console.log(`[V485] Results: ${passed} passed, ${failed} failed`);
if (errors.length) console.error('Failed:', errors.join(', '));
console.log('─'.repeat(50) + '\n');
process.exit(failed > 0 ? 1 : 0);
