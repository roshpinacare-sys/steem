'use strict';
/**
 * tests/v490.test.js — ECOS V490
 * בדיקת providerAdapters282Canon490 shim
 */

const assert = require('assert');
const path   = require('path');
const crypto = require('crypto');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

console.log('\n=== V490 Tests ===\n');

// T1-T2: SACRED
test('SACRED fiatLedger.js md5', () => {
  const h = crypto.createHash('md5').update(require('fs').readFileSync(path.join(__dirname,'../lib/fiatLedger.js'))).digest('hex');
  assert.strictEqual(h, '563e9b1f9e67091a5b6527c0a92568e5', `mismatch: ${h}`);
});
test('SACRED auditLog.js md5', () => {
  const h = crypto.createHash('md5').update(require('fs').readFileSync(path.join(__dirname,'../lib/auditLog.js'))).digest('hex');
  assert.strictEqual(h, 'e5a5c2c27801d2d03991bc8e5a1df8cb', `mismatch: ${h}`);
});

// T3: server parse
test('ecos-api-server.js parse clean', () => {
  require('child_process').execSync('node --check ' + path.join(__dirname,'../ecos-api-server.js'));
});

// T4: package version
test('package.json version = 490.x', () => {
  const pkg = JSON.parse(require('fs').readFileSync(path.join(__dirname,'../package.json')));
  assert(parseInt(pkg.version) >= 490, `expected >=490, got ${pkg.version}`);
});

// T5: Canon490 shim loads
const CANON490 = require('../lib/providerAdapters282Canon490.js');
test('Canon490 shim loads', () => { assert(CANON490, 'module falsy'); });

// T6: getCanonInfo490 metadata
test('getCanonInfo490() returns version 490.0.0', () => {
  const info = CANON490.getCanonInfo490();
  assert.ok(parseInt(String(info.version).split('.')[0],10) >= 490, 'major >= 490');
  assert.strictEqual(info.file, 'providerAdapters282Canon490.js');
  assert.strictEqual(info.prevShim, 'providerAdapters281Canon489.js');
});

// T7: PROVIDER_CONTRACTS_282 re-exported
test('PROVIDER_CONTRACTS_282 has notificationTemplate', () => {
  const { PROVIDER_CONTRACTS_282 } = CANON490;
  assert(PROVIDER_CONTRACTS_282, 'PROVIDER_CONTRACTS_282 missing');
  assert(PROVIDER_CONTRACTS_282.notificationTemplate, 'notificationTemplate contract missing');
});

// T8: validateProvider282 exported
test('validateProvider282 function exported', () => {
  assert(typeof CANON490.validateProvider282 === 'function');
});

// T9: createAllStubs282 includes notificationTemplate
test('createAllStubs282 returns stubs with notificationTemplate', () => {
  const stubs = CANON490.createAllStubs282();
  assert(stubs && typeof stubs === 'object');
  assert(stubs.notificationTemplate, 'notificationTemplate stub missing');
});

// T10: V283 imports via Canon490
test('providerAdapters283 imports via Canon490 shim', () => {
  const src = require('fs').readFileSync(path.join(__dirname,'../lib/providerAdapters283.js'),'utf8');
  assert(src.includes('providerAdapters282Canon490'), 'V283 not updated to Canon490');
});

// T11: contractCount >= 32
test('contractCount >= 32 (V282 adds notificationTemplate)', () => {
  const info = CANON490.getCanonInfo490();
  assert(info.contractCount >= 32, `expected >=32, got ${info.contractCount}`);
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
