'use strict';
/**
 * tests/v488.test.js — ECOS V488
 * בודק: providerAdapters280Canon488 shim, SACRED, server parse
 * הרצה: NODE_ENV=test node tests/v488.test.js  →  exit 0
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

console.log('\n=== ECOS V488 Tests ===\n');

// 1-2. SACRED
test('SACRED: fiatLedger.js md5 intact', () => {
  assert.strictEqual(md5File(path.join(BASE,'lib/fiatLedger.js')), '563e9b1f9e67091a5b6527c0a92568e5');
});
test('SACRED: auditLog.js md5 intact', () => {
  assert.strictEqual(md5File(path.join(BASE,'lib/auditLog.js')), 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// 3. version
test('package.json version >= 488', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(BASE,'package.json'),'utf8'));
  assert(parseInt(pkg.version) >= 488, 'version=' + pkg.version);
});

// 4. server parse
test('ecos-api-server.js parses cleanly', () => {
  execFileSync(process.execPath, ['--check', path.join(BASE,'ecos-api-server.js')]);
});

// 5. shim loads and exports correct surface
test('providerAdapters280Canon488 exports correct surface', () => {
  const m = require(path.join(BASE,'lib/providerAdapters280Canon488.js'));
  assert.strictEqual(typeof m.getCanonInfo488,              'function');
  assert.strictEqual(typeof m.validateProvider280,          'function');
  assert.strictEqual(typeof m.validateAllProviders280,      'function');
  assert.strictEqual(typeof m.createNotificationChannelStub280, 'function');
  assert.strictEqual(typeof m.createAllStubs280,            'function');
  assert.ok(m.PROVIDER_CONTRACTS_280,                       'missing PROVIDER_CONTRACTS_280');
});

// 6. getCanonInfo488 content
test('getCanonInfo488 returns correct metadata', () => {
  const m = require(path.join(BASE,'lib/providerAdapters280Canon488.js'));
  const info = m.getCanonInfo488();
  assert.ok(parseInt(String(info.version).split('.')[0],10) >= 488, 'major >= 488');
  assert.ok(info.prevShim.includes('279Canon487'), 'chain broken: ' + info.prevShim);
  assert.strictEqual(info.contractCount, 30);
  assert.ok(info.contracts.includes('notificationChannel'), 'missing notificationChannel contract');
});

// 7. surface parity: shim contracts === original
test('shim PROVIDER_CONTRACTS_280 identical to original', () => {
  const shim = require(path.join(BASE,'lib/providerAdapters280Canon488.js'));
  const orig = require(path.join(BASE,'lib/providerAdapters280.js'));
  const shimKeys = Object.keys(shim.PROVIDER_CONTRACTS_280).sort().join(',');
  const origKeys = Object.keys(orig.PROVIDER_CONTRACTS_280).sort().join(',');
  assert.strictEqual(shimKeys, origKeys, 'contract keys mismatch');
});

// 8. V281 now imports via shim (not direct)
test('providerAdapters281.js imports via 280Canon488 shim', () => {
  const src = fs.readFileSync(path.join(BASE,'lib/providerAdapters281.js'),'utf8');
  assert.ok(src.includes('providerAdapters280Canon488'), 'V281 must import via Canon488 shim');
  assert.ok(!src.includes("require('./providerAdapters280')"), 'V281 must not import V280 directly');
});

// 9. IIFE in server
test('V488 IIFE wired in ecos-api-server.js', () => {
  const src = fs.readFileSync(path.join(BASE,'ecos-api-server.js'),'utf8');
  assert.ok(src.includes('_wireProviderAdapters280Canon488'), 'missing IIFE');
  assert.ok(src.includes('/api/v1/provider-adapters/280/canon/status'), 'missing status endpoint');
  assert.ok(src.includes('/api/v1/admin/summary/v488'), 'missing summary endpoint');
});

// 10. V281 still loads correctly after shim update
test('providerAdapters281.js loads cleanly via shim chain', () => {
  const m281 = require(path.join(BASE,'lib/providerAdapters281.js'));
  assert.ok(m281.PROVIDER_CONTRACTS_281 || m281.PROVIDER_CONTRACTS_280, 'V281 exports missing after shim update');
});

console.log('\n──────────────────────────────');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) { console.error('FAILED'); process.exit(1); }
else { console.log('ALL PASSED ✓'); process.exit(0); }
