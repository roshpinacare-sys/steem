'use strict';
/**
 * tests/v513.test.js — ECOS V513
 * reputationLedger Canon Facade
 */

const assert   = require('assert');
const path     = require('path');
const crypto   = require('crypto');
const fs       = require('fs');
const { execSync } = require('child_process');

const root       = path.resolve(__dirname, '..');
const serverPath = path.join(root, 'ecos-api-server.js');

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

console.log('\n─── V513 reputationLedger Canon Tests ───');

const CANON = require('../lib/reputationLedgerCanon513.js');

// [1] module loads
test('module loads with expected exports', () => {
  assert.strictEqual(typeof CANON.getCanonInfo513,      'function');
  assert.strictEqual(typeof CANON.getHealthSummary513,  'function');
  assert.strictEqual(typeof CANON.createInstance513,    'function');
  assert.strictEqual(typeof CANON.getDefaultInstance513,'function');
  assert.strictEqual(typeof CANON.registerEndpoints513, 'function');
});

// [2] version constants
test('version constants correct', () => {
  assert.strictEqual(CANON.CANON_VERSION_513,      '513.0.0');
  assert.strictEqual(CANON.CANON_TIP_VERSION_513,  268);
  assert.strictEqual(CANON.CANON_BASE_VERSION_513, 263);
  assert.strictEqual(CANON.CANON_COUNT_513,        6);
});

// [3] getCanonInfo513 metadata
test('getCanonInfo513 returns correct metadata', () => {
  const info = CANON.getCanonInfo513();
  assert.strictEqual(info.tower, 'reputationLedger');
  assert.strictEqual(info.canonVersion, '513.0.0');
  assert.strictEqual(info.moduleCount, 6);
  assert.ok(info.importGuidance.includes('reputationLedgerCanon513'));
  assert.ok(info.description.includes('V263'));
});

// [4] health — tip loaded, instance ok
test('getHealthSummary513 ok=true, tipOk=true, instanceOk=true', () => {
  const h = CANON.getHealthSummary513();
  assert.strictEqual(h.ok,         true, `ok should be true — loadError: ${h.loadError}`);
  assert.strictEqual(h.tipOk,      true, 'tipOk should be true');
  assert.strictEqual(h.instanceOk, true, 'instanceOk should be true');
  assert.strictEqual(h.canonVersion, '513.0.0');
});

// [5] ATTESTATION_TYPES_513 re-exported
test('ATTESTATION_TYPES_513 is an array with expected types', () => {
  assert.ok(Array.isArray(CANON.ATTESTATION_TYPES_513), 'should be array');
  assert.ok(CANON.ATTESTATION_TYPES_513.includes('peer_review'), 'should include peer_review');
  assert.ok(CANON.ATTESTATION_TYPES_513.includes('mission_complete'), 'should include mission_complete');
});

// [6] DECAY_HALF_LIFE_MS_513 re-exported
test('DECAY_HALF_LIFE_MS_513 is a positive number (90 days)', () => {
  assert.ok(typeof CANON.DECAY_HALF_LIFE_MS_513 === 'number');
  assert.ok(CANON.DECAY_HALF_LIFE_MS_513 > 0, 'half-life should be positive');
  // 90 days = 90 * 24 * 3600 * 1000
  assert.strictEqual(CANON.DECAY_HALF_LIFE_MS_513, 90 * 24 * 3600_000);
});

// [7] createInstance513 returns a working ReputationLedger268
test('createInstance513 creates an instance with attest268 and getStanding268', () => {
  const inst = CANON.createInstance513();
  assert.strictEqual(typeof inst.attest268,      'function');
  assert.strictEqual(typeof inst.getStanding268, 'function');
  assert.strictEqual(typeof inst.stats268,       'function');
  // test attest and getStanding
  inst.systemAttest268('user-x', 'mission_complete', { missionId: 'm1' });
  const standing = inst.getStanding268('user-x');
  assert.ok(standing, 'standing should be defined');
});

// [8] getDefaultInstance513 returns shared instance
test('getDefaultInstance513 returns shared defaultReputationLedger268 instance', () => {
  const def = CANON.getDefaultInstance513();
  assert.strictEqual(typeof def.getStanding268, 'function');
  // calling twice returns same object
  assert.strictEqual(CANON.getDefaultInstance513(), def);
});

// [9] registerEndpoints513 fail-safe
test('registerEndpoints513 returns false for null/undefined app', () => {
  assert.strictEqual(CANON.registerEndpoints513(null),      false);
  assert.strictEqual(CANON.registerEndpoints513(undefined), false);
  assert.strictEqual(CANON.registerEndpoints513({}),        false); // no .get
});

// [10] SACRED intact
test('SACRED files intact (fiatLedger + auditLog)', () => {
  const check = (file, expected) => {
    const hash = crypto.createHash('md5')
      .update(fs.readFileSync(path.join(root, file)))
      .digest('hex');
    assert.strictEqual(hash, expected, `SACRED hash mismatch: ${file}`);
  };
  check('lib/fiatLedger.js', '563e9b1f9e67091a5b6527c0a92568e5');
  check('lib/auditLog.js',   'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// [11] server parse clean
test('ecos-api-server.js parses without errors', () => {
  execSync(`node --check ${serverPath}`, { stdio: 'pipe' });
});

// ─── Summary ───
console.log('\n─────────────────────────');
console.log(`  Passed: ${passed} / ${passed + failed}`);
if (failed > 0) {
  console.error(`  FAILED: ${failed}`);
  process.exit(1);
} else {
  console.log('  All tests passed ✓');
  process.exit(0);
}
