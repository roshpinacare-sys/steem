'use strict';
/**
 * tests/v477.test.js — ECOS V477
 * economicIntegrityLoadBearing Canon Facade
 */

const assert   = require('assert');
const path     = require('path');
const crypto   = require('crypto');
const fs       = require('fs');
const { execSync } = require('child_process');

const serverPath = path.resolve(__dirname, '../ecos-api-server.js');
const root       = path.resolve(__dirname, '..');

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

console.log('\n─── V477 economicIntegrityLoadBearing Canon Tests ───');

// Load module
const CANON = require('../lib/economicIntegrityLoadBearingCanon477.js');

// [1] module loads
test('module loads and exports expected symbols', () => {
  assert.strictEqual(typeof CANON.getCanonInfo477,    'function');
  assert.strictEqual(typeof CANON.getHealthSummary477,'function');
  assert.strictEqual(typeof CANON.requireIntegrityVerified477, 'function');
  assert.strictEqual(typeof CANON.buildSignedPrewarmAttestationFeedPage477, 'function');
  assert.strictEqual(typeof CANON.registerEndpoints477, 'function');
});

// [2] version constants
test('CANON_VERSION_477 === 477.0.0', () => {
  assert.strictEqual(CANON.CANON_VERSION_477, '477.0.0');
  assert.strictEqual(CANON.CANON_TIP_VERSION_477, 371);
  assert.strictEqual(CANON.CANON_BASE_VERSION_477, 361);
  assert.strictEqual(CANON.CANON_COUNT_477, 11);
});

// [3] getCanonInfo477 returns correct metadata
test('getCanonInfo477 returns correct metadata', () => {
  const info = CANON.getCanonInfo477();
  assert.strictEqual(info.tower, 'economicIntegrityLoadBearing');
  assert.strictEqual(info.canonVersion, '477.0.0');
  assert.strictEqual(info.moduleCount, 11);
  assert.ok(info.importGuidance.includes('economicIntegrityLoadBearingCanon477'));
});

// [4] getHealthSummary477 — all 11 modules loaded
test('getHealthSummary477 reports 11/11 modules loaded', () => {
  const h = CANON.getHealthSummary477();
  assert.strictEqual(h.ok, true, `ok should be true, loadedCount=${h.loadedCount}`);
  assert.strictEqual(h.loadedCount, 11);
  assert.strictEqual(h.errorCount, 0);
  assert.strictEqual(h.canonVersion, '477.0.0');
});

// [5] gate and tip functions available
test('gateOk and tipOk both true', () => {
  const h = CANON.getHealthSummary477();
  assert.strictEqual(h.gateOk, true, 'gateOk should be true');
  assert.strictEqual(h.tipOk,  true, 'tipOk should be true');
});

// [6] all 11 module statuses present
test('health includes status for V361..V371', () => {
  const h = CANON.getHealthSummary477();
  for (let v = 361; v <= 371; v++) {
    assert.ok(h.moduleStatuses[`V${v}`], `V${v} missing from moduleStatuses`);
    assert.strictEqual(h.moduleStatuses[`V${v}`].loaded, true, `V${v} not loaded`);
  }
});

// [7] requireIntegrityVerified477 returns correct shape from V361
test('requireIntegrityVerified477 returns {allowed, attestation, reason} from V361 gate', () => {
  const r = CANON.requireIntegrityVerified477(null, {});
  assert.ok(typeof r === 'object', 'should return an object');
  assert.ok('allowed' in r, 'result must have allowed field');
  assert.ok('attestation' in r, 'result must have attestation field');
  assert.ok('reason' in r, 'result must have reason field');
  // allowed is boolean (V361 determines the value based on ctx/integrity)
  assert.strictEqual(typeof r.allowed, 'boolean');
});

// [8] registerEndpoints477 returns false without app
test('registerEndpoints477 returns false when no app provided', () => {
  const result = CANON.registerEndpoints477(null);
  assert.strictEqual(result, false);
  const result2 = CANON.registerEndpoints477(undefined);
  assert.strictEqual(result2, false);
});

// [9] SACRED files intact
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

// [10] server parse clean
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
