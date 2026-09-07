'use strict';
/**
 * tests/v482.test.js — ECOS V482
 * providerAdapters267 thin re-export + providerAdaptersBridge482 + IIFE
 */

const assert = require('assert');
const path   = require('path');
const crypto = require('crypto');
const fs     = require('fs');

let pass482 = 0, fail482 = 0;
function t482(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass482++; }
  catch(e) { console.error(`  ✗ ${name}: ${e.message}`); fail482++; }
}

const ROOT = path.resolve(__dirname, '..');
console.log('\n=== ECOS V482 Tests ===\n');

// T01: SACRED fiatLedger
t482('T01 SACRED fiatLedger', () => {
  const md5 = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT,'lib/fiatLedger.js'))).digest('hex');
  assert.strictEqual(md5, '563e9b1f9e67091a5b6527c0a92568e5');
});

// T02: SACRED auditLog
t482('T02 SACRED auditLog', () => {
  const md5 = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT,'lib/auditLog.js'))).digest('hex');
  assert.strictEqual(md5, 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// T03: server parse
t482('T03 server node --check', () => {
  require('child_process').execSync(`node --check ${path.join(ROOT,'ecos-api-server.js')} 2>&1`);
});

// T04: version >= 482
t482('T04 version >= 482', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8'));
  assert(parseInt(pkg.version) >= 482, `got ${pkg.version}`);
});

// T05: providerAdapters267 is thin re-export
t482('T05 providerAdapters267 is thin re-export', () => {
  const src = fs.readFileSync(path.join(ROOT,'lib/providerAdapters267.js'),'utf8');
  assert(src.includes('providerAdaptersCanon476'), 'should re-export Canon476');
  assert(!src.includes('PROVIDER_CONTRACTS_267'), 'should not have old v267 symbols');
});

// T06: providerAdapters267 loads and has Canon476 exports
t482('T06 providerAdapters267 loads Canon476 exports', () => {
  const m = require(path.join(ROOT,'lib/providerAdapters267.js'));
  assert(typeof m.getCanonInfo476 === 'function', 'getCanonInfo476 missing');
  assert(typeof m.validateAllProviders476 === 'function', 'validateAllProviders476 missing');
});

// T07: bridge482 module loads
t482('T07 providerAdaptersBridge482 loads', () => {
  const b = require(path.join(ROOT,'lib/providerAdaptersBridge482.js'));
  assert.strictEqual(typeof b.getReport482, 'function');
  assert.strictEqual(typeof b.mapChain482, 'function');
  assert.strictEqual(typeof b.getHealth482, 'function');
});

// T08: getReport482 returns valid structure
t482('T08 getReport482 valid structure', () => {
  const b = require(path.join(ROOT,'lib/providerAdaptersBridge482.js'));
  const r = b.getReport482();
  assert.strictEqual(r.ok, true);
  assert(Array.isArray(r.chain), 'chain must be array');
  assert(r.chainLength > 0);
  assert(r.thinReexports >= 1, 'at least 1 thin re-export expected');
});

// T09: chain includes 267 as THIN_REEXPORT
t482('T09 chain shows 267 as THIN_REEXPORT', () => {
  const b = require(path.join(ROOT,'lib/providerAdaptersBridge482.js'));
  const r = b.getReport482();
  const v267 = r.chain.find(c => c.version === 267);
  assert(v267, '267 not in chain map');
  assert.strictEqual(v267.status, 'THIN_REEXPORT');
});

// T10: 268/269/273 shown as ACTIVE_PATCH
t482('T10 active patch versions marked correctly', () => {
  const b = require(path.join(ROOT,'lib/providerAdaptersBridge482.js'));
  const r = b.getReport482();
  for (const v of [268, 269, 273]) {
    const entry = r.chain.find(c => c.version === v);
    assert(entry, `${v} not in chain`);
    assert.strictEqual(entry.status, 'ACTIVE_PATCH', `${v} should be ACTIVE_PATCH`);
  }
});

// T11: V482 endpoints wired in server
t482('T11 V482 endpoints wired in server', () => {
  const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
  assert(src.includes('/api/v1/towers/providers/chain'), 'providers/chain missing');
  assert(src.includes('/api/v1/admin/summary/v482'), 'summary/v482 missing');
  assert(src.includes('_wireProviderBridge482'), 'IIFE name missing');
});

// T12: fail-closed: getHealth482 with bad dir returns ok:false
t482('T12 getHealth482 fail-closed on bad dir', () => {
  const b = require(path.join(ROOT,'lib/providerAdaptersBridge482.js'));
  const r = b.getHealth482('/nonexistent_dir_482');
  assert.strictEqual(r.ok, false, 'should be fail-closed');
  assert(r.error, 'error message expected');
});

console.log(`\n=== Results: ${pass482} passed, ${fail482} failed ===\n`);
process.exit(fail482 > 0 ? 1 : 0);
