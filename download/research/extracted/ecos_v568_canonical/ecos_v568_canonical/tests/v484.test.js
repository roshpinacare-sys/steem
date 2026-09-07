/**
 * tests/v484.test.js — ECOS V484 — providerAdapters276 Canon Shim
 * Run: NODE_ENV=test node tests/v484.test.js
 * @version 484.0.0
 */
'use strict';
process.env.NODE_ENV = 'test';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

let passed = 0, failed = 0, errs = [];
function test(name, fn) {
  try { fn(); console.log('  \u2713 ' + name); passed++; }
  catch (e) { console.error('  \u2717 ' + name + ': ' + e.message); failed++; errs.push(name); }
}

// ── canon484 shim surface ──
console.log('\n[V484] canon484 shim surface\n');

const canon484 = require(path.join(ROOT, 'lib/providerAdapters276Canon484.js'));

test('shim re-exports PROVIDER_CONTRACTS_276', () => {
  assert.ok(canon484.PROVIDER_CONTRACTS_276 && typeof canon484.PROVIDER_CONTRACTS_276 === 'object');
  assert.ok(Object.keys(canon484.PROVIDER_CONTRACTS_276).length >= 26);
});

test('shim re-exports validateProvider276 as function', () => {
  assert.strictEqual(typeof canon484.validateProvider276, 'function');
});

test('shim re-exports validateAllProviders276 as function', () => {
  assert.strictEqual(typeof canon484.validateAllProviders276, 'function');
});

test('shim re-exports createAllStubs276 as function', () => {
  assert.strictEqual(typeof canon484.createAllStubs276, 'function');
});

test('shim re-exports createAdapterScaffold276 as function', () => {
  assert.strictEqual(typeof canon484.createAdapterScaffold276, 'function');
});

test('getCanonInfo484 returns correct version and file', () => {
  const info = canon484.getCanonInfo484();
  assert.ok(parseInt(String(info.version).split('.')[0],10) >= 484, 'major >= 484');
  assert.ok(info.file.includes('276Canon484'));
  assert.ok(info.delegatesTo.includes('providerAdapters276.js'));
  assert.strictEqual(info.prevShim, 'providerAdapters275Canon483.js');
});

test('getCanonInfo484 contractCount >= 26', () => {
  const info = canon484.getCanonInfo484();
  assert.ok(info.contractCount >= 26);
  assert.ok(Array.isArray(info.contracts));
  assert.ok(info.contracts.includes('alertResolution'));
});

// ── V277 imports via canon484 ──
console.log('\n[V484] V277 imports via canon484 shim\n');

const v277 = require(path.join(ROOT, 'lib/providerAdapters277.js'));

test('V277 loads successfully via canon484 shim', () => {
  assert.ok(v277.PROVIDER_CONTRACTS_277);
});

test('V277 has 27 contracts (26 from 276 + 1 new)', () => {
  assert.strictEqual(Object.keys(v277.PROVIDER_CONTRACTS_277).length, 27);
});

test('V277 validateProvider277 works end-to-end via shim chain', () => {
  const result = v277.validateProvider277('settlementProvider', { handle: () => {} });
  assert.ok(typeof result === 'object');
  assert.ok('ok' in result || 'valid' in result, 'expects ok or valid field');
});

test('V277 createAllStubs277 returns object with all 277 contracts', () => {
  const stubs = v277.createAllStubs277();
  assert.ok(typeof stubs === 'object');
  assert.ok('settlementProvider' in stubs);
  assert.ok('alertEscalation' in stubs);  // V277's new contract
});

test('V277 source imports providerAdapters276Canon484 (not 276 directly)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/providerAdapters277.js'), 'utf8');
  assert.ok(src.includes('providerAdapters276Canon484'), 'V277 must import from canon484 shim');
  assert.ok(!src.match(/require\(['"]\.\/providerAdapters276['"]\)/), 'V277 must NOT import V276 directly');
});

// ── server wiring + SACRED ──
console.log('\n[V484] Server wiring + SACRED\n');

const SERVER = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');

test('server parses cleanly', () => {
  assert.doesNotThrow(() => new vm.Script(SERVER, { filename: 'ecos-api-server.js' }));
});

test('V484 endpoints wired', () => {
  assert.ok(SERVER.includes('/api/v1/provider/adapters/canon/276'), 'missing canon/276 endpoint');
  assert.ok(SERVER.includes('/api/v1/admin/summary/v484'), 'missing summary/v484');
});

test('V484 version tags present', () => {
  assert.ok(SERVER.includes('V484-T01'));
  assert.ok(SERVER.includes('V484-T02'));
});

test('V483 summary endpoint still present (additive)', () => {
  assert.ok(SERVER.includes('/api/v1/admin/summary/v483'));
});

test('package.json major >= 484', () => {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  assert.ok(parseInt(String(v).split('.')[0], 10) >= 484, 'got ' + v);
});

test('SACRED intact', () => {
  const md5 = p => crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
  assert.strictEqual(md5('lib/fiatLedger.js'), '563e9b1f9e67091a5b6527c0a92568e5');
  assert.strictEqual(md5('lib/auditLog.js'),   'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

test('handoff docs exist', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'CHANGELOG_V484.md')));
  assert.ok(fs.existsSync(path.join(ROOT, 'NEXT_SESSION_PROMPT_V484.md')));
});

console.log('\n  Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.error('Failed: ' + errs.join(', ')); process.exit(1); }
console.log('  \u2713 All V484 tests passed\n');
