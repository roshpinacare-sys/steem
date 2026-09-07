'use strict';
const assert = require('assert');
const path   = require('path');
const crypto = require('crypto');
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
console.log('\n=== V494 Tests ===\n');

test('SACRED fiatLedger.js md5', () => {
  const h = crypto.createHash('md5').update(require('fs').readFileSync(path.join(__dirname,'../lib/fiatLedger.js'))).digest('hex');
  assert.strictEqual(h,'563e9b1f9e67091a5b6527c0a92568e5',`mismatch:${h}`);
});
test('SACRED auditLog.js md5', () => {
  const h = crypto.createHash('md5').update(require('fs').readFileSync(path.join(__dirname,'../lib/auditLog.js'))).digest('hex');
  assert.strictEqual(h,'e5a5c2c27801d2d03991bc8e5a1df8cb',`mismatch:${h}`);
});
test('ecos-api-server.js parse clean', () => {
  require('child_process').execSync('node --check '+path.join(__dirname,'../ecos-api-server.js'));
});
test('package.json version >= 494', () => {
  const pkg = JSON.parse(require('fs').readFileSync(path.join(__dirname,'../package.json')));
  assert(parseInt(pkg.version)>=494,`got ${pkg.version}`);
});

// Canon494 shim
const CANON494 = require('../lib/providerAdapters286Canon494.js');
test('Canon494 shim loads', () => { assert(CANON494); });
test('getCanonInfo494() version=494.0.0', () => {
  const info = CANON494.getCanonInfo494();
  assert.ok(parseInt(String(info.version).split('.')[0],10) >= 494, 'major >= 494');
  assert.strictEqual(info.file,'providerAdapters286Canon494.js');
  assert.strictEqual(info.prevShim,'providerAdapters285Canon493.js');
  assert.strictEqual(info.chainComplete, true);
});
test('PROVIDER_CONTRACTS_286 has presetGroups', () => {
  assert(CANON494.PROVIDER_CONTRACTS_286.presetGroups,'contract missing');
});
test('createAllStubs286 returns presetGroups stub', () => {
  const stubs = CANON494.createAllStubs286();
  assert(stubs && stubs.presetGroups,'presetGroups stub missing');
});

// Canon476 facade now imports via Canon494
test('providerAdaptersCanon476 imports via Canon494', () => {
  const src = require('fs').readFileSync(path.join(__dirname,'../lib/providerAdaptersCanon476.js'),'utf8');
  assert(src.includes('providerAdapters286Canon494'),'Canon476 not updated to Canon494');
});
test('Canon476 facade loads and health OK via Canon494', () => {
  const facade = require('../lib/providerAdaptersCanon476.js');
  const health = facade.getHealthSummary476();
  assert(health.contractCount >= 36, `contractCount ${health.contractCount}`);
  assert(health.stubsOk, 'stubs not ok: '+JSON.stringify(health.errors));
});
test('contractCount >= 36', () => {
  const info = CANON494.getCanonInfo494();
  assert(info.contractCount>=36,`got ${info.contractCount}`);
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed>0?1:0);
