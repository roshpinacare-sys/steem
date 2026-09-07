'use strict';
const assert = require('assert');
const path   = require('path');
const crypto = require('crypto');
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
console.log('\n=== V492 Tests ===\n');

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
test('package.json version >= 492', () => {
  const pkg = JSON.parse(require('fs').readFileSync(path.join(__dirname,'../package.json')));
  assert(parseInt(pkg.version)>=492,`got ${pkg.version}`);
});

const CANON492 = require('../lib/providerAdapters284Canon492.js');
test('Canon492 shim loads', () => { assert(CANON492); });
test('getCanonInfo492() version=492.0.0', () => {
  const info = CANON492.getCanonInfo492();
  assert.ok(parseInt(String(info.version).split('.')[0],10) >= 492, 'major >= 492');
  assert.strictEqual(info.file,'providerAdapters284Canon492.js');
  assert.strictEqual(info.prevShim,'providerAdapters283Canon491.js');
});
test('PROVIDER_CONTRACTS_284 has channelFilter', () => {
  assert(CANON492.PROVIDER_CONTRACTS_284.channelFilter,'contract missing');
});
test('validateProvider284 exported', () => {
  assert(typeof CANON492.validateProvider284==='function');
});
test('createAllStubs284 returns channelFilter stub', () => {
  const stubs = CANON492.createAllStubs284();
  assert(stubs && stubs.channelFilter,'channelFilter stub missing');
});
test('providerAdapters285 imports via Canon492', () => {
  const src = require('fs').readFileSync(path.join(__dirname,'../lib/providerAdapters285.js'),'utf8');
  assert(src.includes('providerAdapters284Canon492'),'V285 not updated');
});
test('contractCount >= 34', () => {
  const info = CANON492.getCanonInfo492();
  assert(info.contractCount>=34,`got ${info.contractCount}`);
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed>0?1:0);
