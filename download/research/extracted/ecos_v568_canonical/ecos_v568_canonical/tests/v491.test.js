'use strict';
const assert = require('assert');
const path   = require('path');
const crypto = require('crypto');
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
console.log('\n=== V491 Tests ===\n');

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
test('package.json version >= 491', () => {
  const pkg = JSON.parse(require('fs').readFileSync(path.join(__dirname,'../package.json')));
  assert(parseInt(pkg.version)>=491,`got ${pkg.version}`);
});

const CANON491 = require('../lib/providerAdapters283Canon491.js');
test('Canon491 shim loads', () => { assert(CANON491); });
test('getCanonInfo491() version=491.0.0', () => {
  const info = CANON491.getCanonInfo491();
  assert.ok(parseInt(String(info.version).split('.')[0],10) >= 491, 'major >= 491');
  assert.strictEqual(info.file,'providerAdapters283Canon491.js');
  assert.strictEqual(info.prevShim,'providerAdapters282Canon490.js');
});
test('PROVIDER_CONTRACTS_283 has templateBoundChannel', () => {
  assert(CANON491.PROVIDER_CONTRACTS_283.templateBoundChannel,'contract missing');
});
test('validateProvider283 exported', () => {
  assert(typeof CANON491.validateProvider283==='function');
});
test('createAllStubs283 returns templateBoundChannel stub', () => {
  const stubs = CANON491.createAllStubs283();
  assert(stubs && stubs.templateBoundChannel,'templateBoundChannel stub missing');
});
test('providerAdapters284 imports via Canon491', () => {
  const src = require('fs').readFileSync(path.join(__dirname,'../lib/providerAdapters284.js'),'utf8');
  assert(src.includes('providerAdapters283Canon491'),'V284 not updated');
});
test('contractCount >= 33', () => {
  const info = CANON491.getCanonInfo491();
  assert(info.contractCount>=33,`got ${info.contractCount}`);
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed>0?1:0);
