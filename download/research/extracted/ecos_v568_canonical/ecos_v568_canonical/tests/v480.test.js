'use strict';
/**
 * tests/v480.test.js — ECOS V480 Test Suite
 * PentaTowerCanon480: 5 towers (reputationLedger + reflectionLoop +
 *   quadraticFunding + offlineQueue + onboardingFlow), V263–V268
 * Exit 0 = all passed.
 */

const assert = require('assert');
const path   = require('path');
const crypto = require('crypto');
const fs     = require('fs');

const ROOT = path.join(__dirname, '..');
let passed = 0;
let failed = 0;

function test480(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

console.log('\n=== V480 PentaTowerCanon Tests ===\n');

// T01 – SACRED md5
test480('T01 SACRED fiatLedger md5', () => {
  const data = fs.readFileSync(path.join(ROOT, 'lib', 'fiatLedger.js'));
  const hash = crypto.createHash('md5').update(data).digest('hex');
  assert.strictEqual(hash, '563e9b1f9e67091a5b6527c0a92568e5', 'fiatLedger SACRED violated');
});

test480('T02 SACRED auditLog md5', () => {
  const data = fs.readFileSync(path.join(ROOT, 'lib', 'auditLog.js'));
  const hash = crypto.createHash('md5').update(data).digest('hex');
  assert.strictEqual(hash, 'e5a5c2c27801d2d03991bc8e5a1df8cb', 'auditLog SACRED violated');
});

// T03 – server parse clean
test480('T03 ecos-api-server.js parse clean', () => {
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, ['--check', path.join(ROOT, 'ecos-api-server.js')]);
  assert.strictEqual(r.status, 0, 'server parse failed: ' + r.stderr.toString());
});

// T04 – package version
test480('T04 package.json version >= 480', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert(parseInt(pkg.version) >= 480, `version is ${pkg.version}`);
});

// T05 – module loads
test480('T05 pentaTowerCanon480 loads', () => {
  const m = require(path.join(ROOT, 'lib', 'pentaTowerCanon480.js'));
  assert(m, 'module is falsy');
  assert.strictEqual(m.CANON_VERSION_480, '480.0.0');
  assert.strictEqual(m.CANON_TIP_VERSION_480, 268);
  assert.strictEqual(m.CANON_BASE_VERSION_480, 263);
  assert.strictEqual(m.CANON_COUNT_480, 6);
});

// T06 – getCanonInfo480
test480('T06 getCanonInfo480 returns correct metadata', () => {
  const m = require(path.join(ROOT, 'lib', 'pentaTowerCanon480.js'));
  const info = m.getCanonInfo480();
  assert.strictEqual(info.towers.length, 5, 'should have 5 towers');
  assert(info.towers.includes('reputationLedger268'), 'missing reputationLedger268');
  assert(info.towers.includes('reflectionLoop268'),   'missing reflectionLoop268');
  assert(info.towers.includes('quadraticFunding268'), 'missing quadraticFunding268');
  assert(info.towers.includes('offlineQueue268'),     'missing offlineQueue268');
  assert(info.towers.includes('onboardingFlow268'),   'missing onboardingFlow268');
  assert.strictEqual(info.ecosVersion, 'V480');
  assert(Array.isArray(info.endpoints) && info.endpoints.length >= 2, 'endpoints missing');
});

// T07 – getHealthSummary480 all 5 towers OK
test480('T07 getHealthSummary480 all towers healthy', () => {
  const m = require(path.join(ROOT, 'lib', 'pentaTowerCanon480.js'));
  const h = m.getHealthSummary480();
  assert(h.ok === true, 'health not ok: ' + JSON.stringify(h.towers));
  assert(h.towers.reputationLedger.ok,  'reputationLedger not ok');
  assert(h.towers.reflectionLoop.ok,    'reflectionLoop not ok');
  assert(h.towers.quadraticFunding.ok,  'quadraticFunding not ok');
  assert(h.towers.offlineQueue.ok,      'offlineQueue not ok');
  assert(h.towers.onboardingFlow.ok,    'onboardingFlow not ok');
  assert(typeof h.timestamp === 'number', 'missing timestamp');
});

// T08 – re-exports: reputationLedger268
test480('T08 re-export ReputationLedger268 class', () => {
  const m = require(path.join(ROOT, 'lib', 'pentaTowerCanon480.js'));
  assert(typeof m.ReputationLedger268 === 'function', 'ReputationLedger268 not a function');
  assert(m.defaultReputationLedger268, 'defaultReputationLedger268 missing');
  assert(Array.isArray(m.ATTESTATION_TYPES_268) && m.ATTESTATION_TYPES_268.length > 0);
});

// T09 – re-exports: reflectionLoop268
test480('T09 re-export ReflectionLoop268 class', () => {
  const m = require(path.join(ROOT, 'lib', 'pentaTowerCanon480.js'));
  assert(typeof m.ReflectionLoop268 === 'function', 'ReflectionLoop268 not a function');
  assert(m.defaultReflectionLoop268, 'defaultReflectionLoop268 missing');
  assert(typeof m.MAX_RETRIES_268 === 'number', 'MAX_RETRIES_268 not a number');
});

// T10 – re-exports: quadraticFunding268
test480('T10 re-export QuadraticFunding268 class', () => {
  const m = require(path.join(ROOT, 'lib', 'pentaTowerCanon480.js'));
  assert(typeof m.QuadraticFunding268 === 'function', 'QuadraticFunding268 not a function');
  assert(m.defaultQuadraticFunding268, 'defaultQuadraticFunding268 missing');
});

// T11 – re-exports: offlineQueue268
test480('T11 re-export OfflineQueue268 class', () => {
  const m = require(path.join(ROOT, 'lib', 'pentaTowerCanon480.js'));
  assert(typeof m.OfflineQueue268 === 'function', 'OfflineQueue268 not a function');
  assert(m.defaultOfflineQueue268, 'defaultOfflineQueue268 missing');
  assert(typeof m.MAX_QUEUE_SIZE_268 === 'number', 'MAX_QUEUE_SIZE_268 missing');
});

// T12 – re-exports: onboardingFlow268
test480('T12 re-export OnboardingFlow268 class', () => {
  const m = require(path.join(ROOT, 'lib', 'pentaTowerCanon480.js'));
  assert(typeof m.OnboardingFlow268 === 'function', 'OnboardingFlow268 not a function');
  assert(Array.isArray(m.FLOW_STEPS_268) && m.FLOW_STEPS_268.length > 0, 'FLOW_STEPS_268 missing');
  assert(Array.isArray(m.CHANNELS_268)   && m.CHANNELS_268.length > 0,   'CHANNELS_268 missing');
});

// T13 – registerEndpoints480 is a function (can't spin real express in test)
test480('T13 registerEndpoints480 is callable', () => {
  const m = require(path.join(ROOT, 'lib', 'pentaTowerCanon480.js'));
  assert(typeof m.registerEndpoints480 === 'function', 'registerEndpoints480 not a function');
  // call with null — must not throw
  m.registerEndpoints480(null);
});

// T14 – server IIFE wires V480
test480('T14 server contains V480 IIFE marker', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  assert(src.includes('pentaTowerCanon480'), 'server missing pentaTowerCanon480 reference');
  assert(src.includes('penta-tower-canon-facade'), 'server missing feature tag');
});

// T15 – src/lib mirror exists
test480('T15 src/lib/pentaTowerCanon480.js mirror exists', () => {
  const p = path.join(ROOT, 'src', 'lib', 'pentaTowerCanon480.js');
  assert(fs.existsSync(p), 'src/lib mirror missing');
});

// Summary
console.log(`\n=== V480 Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
