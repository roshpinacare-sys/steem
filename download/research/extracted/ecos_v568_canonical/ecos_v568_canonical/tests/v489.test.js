'use strict';
/**
 * tests/v489.test.js — ECOS V489
 * בדיקת providerAdapters281Canon489 shim
 */

const assert = require('assert');
const path   = require('path');
const crypto = require('crypto');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

console.log('\n=== V489 Tests ===\n');

// T1: SACRED md5
test('SACRED fiatLedger.js md5', () => {
  const data = require('fs').readFileSync(path.join(__dirname, '../lib/fiatLedger.js'));
  const hash = crypto.createHash('md5').update(data).digest('hex');
  assert.strictEqual(hash, '563e9b1f9e67091a5b6527c0a92568e5', `fiatLedger md5 mismatch: ${hash}`);
});

test('SACRED auditLog.js md5', () => {
  const data = require('fs').readFileSync(path.join(__dirname, '../lib/auditLog.js'));
  const hash = crypto.createHash('md5').update(data).digest('hex');
  assert.strictEqual(hash, 'e5a5c2c27801d2d03991bc8e5a1df8cb', `auditLog md5 mismatch: ${hash}`);
});

// T2: server parse
test('ecos-api-server.js parse clean', () => {
  const { execSync } = require('child_process');
  execSync('node --check ' + path.join(__dirname, '../ecos-api-server.js'));
});

// T3: package version
test('package.json version = 489.x', () => {
  const pkg = JSON.parse(require('fs').readFileSync(path.join(__dirname, '../package.json')));
  assert(parseInt(pkg.version) >= 489, `expected >=489, got ${pkg.version}`);
});

// T4: Canon489 shim loads
const CANON489 = require('../lib/providerAdapters281Canon489.js');
test('Canon489 shim loads', () => {
  assert(CANON489, 'module falsy');
});

// T5: getCanonInfo489 returns correct data
test('getCanonInfo489() returns version 489.0.0', () => {
  const info = CANON489.getCanonInfo489();
  assert.ok(parseInt(String(info.version).split('.')[0],10) >= 489, 'major >= 489');
  assert.strictEqual(info.file, 'providerAdapters281Canon489.js');
  assert(info.prevShim === 'providerAdapters280Canon488.js');
});

// T6: PROVIDER_CONTRACTS_281 re-exported correctly
test('PROVIDER_CONTRACTS_281 has digestScheduler', () => {
  const { PROVIDER_CONTRACTS_281 } = CANON489;
  assert(PROVIDER_CONTRACTS_281, 'PROVIDER_CONTRACTS_281 missing');
  assert(PROVIDER_CONTRACTS_281.digestScheduler, 'digestScheduler contract missing');
});

// T7: validateProvider281 delegated
test('validateProvider281 function exported', () => {
  assert(typeof CANON489.validateProvider281 === 'function');
});

// T8: createAllStubs281 returns object with digestScheduler
test('createAllStubs281 returns stubs with digestScheduler', () => {
  const stubs = CANON489.createAllStubs281();
  assert(stubs && typeof stubs === 'object', 'stubs not an object');
  assert(stubs.digestScheduler, 'digestScheduler stub missing');
});

// T9: V282 now imports via Canon489
test('providerAdapters282 imports via Canon489 shim', () => {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '../lib/providerAdapters282.js'), 'utf8');
  assert(src.includes('providerAdapters281Canon489'), 'V282 not updated to Canon489');
});

// T10: contractCount >= 31
test('contractCount >= 31 (V281 adds digestScheduler)', () => {
  const info = CANON489.getCanonInfo489();
  assert(info.contractCount >= 31, `expected >=31, got ${info.contractCount}`);
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
else process.exit(0);
