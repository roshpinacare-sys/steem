'use strict';
const assert = require('assert');
const path   = require('path');
const crypto = require('crypto');
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
console.log('\n=== V493 Tests ===\n');

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
test('package.json version >= 493', () => {
  const pkg = JSON.parse(require('fs').readFileSync(path.join(__dirname,'../package.json')));
  assert(parseInt(pkg.version)>=493,`got ${pkg.version}`);
});

const CANON493 = require('../lib/providerAdapters285Canon493.js');
test('Canon493 shim loads', () => { assert(CANON493); });
test('getCanonInfo493() version=493.0.0', () => {
  const info = CANON493.getCanonInfo493();
  assert.ok(parseInt(String(info.version).split('.')[0],10) >= 493, 'major >= 493');
  assert.strictEqual(info.file,'providerAdapters285Canon493.js');
  assert.strictEqual(info.prevShim,'providerAdapters284Canon492.js');
});
test('PROVIDER_CONTRACTS_285 has filterPresets', () => {
  assert(CANON493.PROVIDER_CONTRACTS_285.filterPresets,'contract missing');
});
test('validateProvider285 exported', () => {
  assert(typeof CANON493.validateProvider285==='function');
});
test('createAllStubs285 returns filterPresets stub', () => {
  const stubs = CANON493.createAllStubs285();
  assert(stubs && stubs.filterPresets,'filterPresets stub missing');
});
test('providerAdapters286 imports via Canon493', () => {
  const src = require('fs').readFileSync(path.join(__dirname,'../lib/providerAdapters286.js'),'utf8');
  assert(src.includes('providerAdapters285Canon493'),'V286 not updated');
});
test('contractCount >= 35', () => {
  const info = CANON493.getCanonInfo493();
  assert(info.contractCount>=35,`got ${info.contractCount}`);
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed>0?1:0);
