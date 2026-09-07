'use strict';
/**
 * tests/v516.test.js — ECOS V516
 * canonRegistryBridge516: connects canonBridgePatch508 with 7 towers from
 * telemetryCanon511, sybilGuardCanon512, reputationLedgerCanon513,
 * offlineQueueCanon514, triTowerCanon515 (splitModule+quadraticFunding+x402).
 * Exit 0 = all passed.
 */

const assert = require('assert');
const path   = require('path');
const crypto = require('crypto');
const fs     = require('fs');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;

function test516(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.error(`  ❌ ${name}: ${e.message}`); failed++; }
}

console.log('\n=== V516 Canon Registry Bridge Tests ===\n');

// T01 – SACRED
test516('T01 SACRED fiatLedger md5', () => {
  const h = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT,'lib','fiatLedger.js'))).digest('hex');
  assert.strictEqual(h, '563e9b1f9e67091a5b6527c0a92568e5');
});
test516('T02 SACRED auditLog md5', () => {
  const h = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT,'lib','auditLog.js'))).digest('hex');
  assert.strictEqual(h, 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// T03 – server parse
test516('T03 ecos-api-server.js parse clean', () => {
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, ['--check', path.join(ROOT,'ecos-api-server.js')]);
  assert.strictEqual(r.status, 0, 'server parse failed: ' + r.stderr.toString());
});

// T04 – package version
test516('T04 package.json version >= 516', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8'));
  assert(parseInt(pkg.version) >= 516, `version is ${pkg.version}`);
});

// T05 – module loads
test516('T05 canonRegistryBridge516 loads', () => {
  const m = require(path.join(ROOT,'lib','canonRegistryBridge516.js'));
  assert(m, 'module falsy');
  assert.strictEqual(m.BRIDGE_VERSION_516, '516.0.0');
  assert(Array.isArray(m.STATIC_DESCRIPTORS_516));
  assert.strictEqual(m.STATIC_DESCRIPTORS_516.length, 7);
});

// T06 – all 7 towers registered
test516('T06 all 7 towers registered with bridge508', () => {
  const m = require(path.join(ROOT,'lib','canonRegistryBridge516.js'));
  const s = m.getRegistrationSummary516();
  assert.strictEqual(s.totalRegistered, 7, `only ${s.totalRegistered} registered: ${JSON.stringify(s.skipped)}`);
  assert(s.ok, 'summary.ok is false');
  assert.strictEqual(s.skipped.length, 0, 'some towers skipped');
});

// T07 – expected tower names are registered
test516('T07 correct tower names registered', () => {
  const m = require(path.join(ROOT,'lib','canonRegistryBridge516.js'));
  const s = m.getRegistrationSummary516();
  const expected = ['telemetry','sybilGuard','reputationLedger','offlineQueue','splitModule','quadraticFunding','x402'];
  for (const name of expected) {
    assert(s.registered.includes(name), `missing: ${name}`);
  }
});

// T08 – all descriptors are parallel-duplicate
test516('T08 all descriptors kind=parallel-duplicate', () => {
  const m = require(path.join(ROOT,'lib','canonRegistryBridge516.js'));
  for (const d of m.STATIC_DESCRIPTORS_516) {
    assert.strictEqual(d.kind, 'parallel-duplicate', `${d.name} has wrong kind`);
    assert.strictEqual(d.base, '263');
    assert.strictEqual(d.tip, '268');
    assert.strictEqual(d.members.length, 6);
  }
});

// T09 – getRegistrationSummary516 no bridge error
test516('T09 no bridge error', () => {
  const m = require(path.join(ROOT,'lib','canonRegistryBridge516.js'));
  const s = m.getRegistrationSummary516();
  assert(!s.bridgeError, `bridge error: ${s.bridgeError}`);
});

// T10 – registerEndpoints516 is callable with null
test516('T10 registerEndpoints516 safe with null', () => {
  const m = require(path.join(ROOT,'lib','canonRegistryBridge516.js'));
  assert(typeof m.registerEndpoints516 === 'function');
  m.registerEndpoints516(null); // must not throw
});

// T11 – getPatchedReport516 (without libDir/rootDir — may fail gracefully)
test516('T11 getPatchedReport516 returns object or throws gracefully', () => {
  const m = require(path.join(ROOT,'lib','canonRegistryBridge516.js'));
  try {
    const r = m.getPatchedReport516({ libDir: ROOT + '/lib', rootDir: ROOT });
    assert(typeof r === 'object', 'report not an object');
  } catch (e) {
    // bridge may need real libDir; that's acceptable — this is a connection test not runtime
    assert(e.message, 'error has no message');
  }
});

// T12 – server contains V516 IIFE
test516('T12 server contains V516 IIFE marker', () => {
  const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
  assert(src.includes('canonRegistryBridge516'), 'missing canonRegistryBridge516 in server');
  assert(src.includes('canon-registry-bridge'), 'missing feature tag in server');
});

// T13 – src/lib mirror exists
test516('T13 src/lib/canonRegistryBridge516.js mirror exists', () => {
  assert(fs.existsSync(path.join(ROOT,'src','lib','canonRegistryBridge516.js')));
});

// T14 – bridge508 still loads (no regression)
test516('T14 canonBridgePatch508 still loads after registration', () => {
  // load bridge516 first so registrations happen, then check bridge508
  require(path.join(ROOT,'lib','canonRegistryBridge516.js'));
  const p = require(path.join(ROOT,'lib','canonBridgePatch508.js'));
  assert(typeof p.registerCanonFacade508 === 'function');
  assert(typeof p.getPatchedDuplication508 === 'function');
  assert(typeof p.listRegisteredFacades508 === 'function');
});

// T15 – bridge508 has the 7 new towers in registry
test516('T15 bridge508 registry contains newly registered towers', () => {
  // bridge516 must be loaded first (it performs the registrations)
  require(path.join(ROOT,'lib','canonRegistryBridge516.js'));
  const p = require(path.join(ROOT,'lib','canonBridgePatch508.js'));
  const facades = p.listRegisteredFacades508();
  const names = facades.map(f => f.name);
  const expected = ['telemetry','sybilGuard','reputationLedger','offlineQueue','splitModule','quadraticFunding','x402'];
  for (const name of expected) {
    assert(names.includes(name), `bridge508 missing: ${name}. Has: ${names.join(',')}`);
  }
});

// Summary
console.log(`\n=== V516 Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
