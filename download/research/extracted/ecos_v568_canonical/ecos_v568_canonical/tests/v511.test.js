'use strict';
/**
 * tests/v511.test.js — ECOS V511
 * בודק: telemetryCanon511, SACRED, server parse, wiring
 * הרצה: NODE_ENV=test node tests/v511.test.js  →  exit 0
 */

const assert = require('assert');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const { execFileSync } = require('child_process');

const BASE = path.resolve(__dirname, '..');
let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.error('  ✗', name, '—', e.message); failed++; }
}
function md5File(p) {
  return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
}

console.log('\n=== ECOS V511 Tests ===\n');

// 1-2. SACRED
test('SACRED: fiatLedger.js md5 intact', () => {
  assert.strictEqual(md5File(path.join(BASE,'lib/fiatLedger.js')), '563e9b1f9e67091a5b6527c0a92568e5');
});
test('SACRED: auditLog.js md5 intact', () => {
  assert.strictEqual(md5File(path.join(BASE,'lib/auditLog.js')), 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// 3. version
test('package.json version >= 511', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(BASE,'package.json'),'utf8'));
  assert(parseInt(pkg.version) >= 511, 'version=' + pkg.version);
});

// 4. server parse
test('ecos-api-server.js parses cleanly', () => {
  execFileSync(process.execPath, ['--check', path.join(BASE,'ecos-api-server.js')]);
});

// 5. module loads and exports
test('telemetryCanon511 loads with correct exports', () => {
  const m = require(path.join(BASE,'lib/telemetryCanon511.js'));
  assert.strictEqual(typeof m.getCanonInfo511,       'function');
  assert.strictEqual(typeof m.getHealthSummary511,   'function');
  assert.strictEqual(typeof m.defaultTelemetry511,   'function');
  assert.strictEqual(typeof m.registerEndpoints511,  'function');
  assert.strictEqual(m.CANON_VERSION_511,            '511.0.0');
  assert.strictEqual(m.CANON_COUNT_511,              6);
  assert.strictEqual(typeof m.Telemetry268,          'function');
});

// 6. getCanonInfo511 content
test('getCanonInfo511 returns correct tower metadata', () => {
  const m = require(path.join(BASE,'lib/telemetryCanon511.js'));
  const info = m.getCanonInfo511();
  assert.strictEqual(info.tower,      'telemetry');
  assert.strictEqual(info.tipVersion,  268);
  assert.strictEqual(info.baseVersion, 263);
  assert.strictEqual(info.moduleCount, 6);
  assert.ok(info.importGuidance.includes('telemetryCanon511'));
});

// 7. getHealthSummary511 valid shape
test('getHealthSummary511 returns valid shape with ok', () => {
  const m = require(path.join(BASE,'lib/telemetryCanon511.js'));
  const h = m.getHealthSummary511();
  assert.ok(h.canon,                         'missing canon');
  assert.ok(typeof h.timestamp === 'number', 'missing timestamp');
  assert.ok(h.telemetry,                     'missing telemetry field');
  assert.strictEqual(h.telemetry.ok, true,   'health check failed');
});

// 8. defaultTelemetry511 returns Telemetry268 instance
test('defaultTelemetry511 returns Telemetry268 instance', () => {
  const m = require(path.join(BASE,'lib/telemetryCanon511.js'));
  const t = m.defaultTelemetry511();
  assert.ok(t instanceof m.Telemetry268, 'not a Telemetry268 instance');
});

// 9. registerEndpoints511 gracefully handles no-app
test('registerEndpoints511 with null app does not throw', () => {
  const m = require(path.join(BASE,'lib/telemetryCanon511.js'));
  assert.doesNotThrow(() => m.registerEndpoints511(null));
  assert.doesNotThrow(() => m.registerEndpoints511(undefined));
});

// 10. IIFE wired in server
test('V511 IIFE wired in ecos-api-server.js', () => {
  const src = fs.readFileSync(path.join(BASE,'ecos-api-server.js'),'utf8');
  assert.ok(src.includes('_wireTelemetryCanon511'),          'missing IIFE');
  assert.ok(src.includes('telemetryCanon511'),               'missing require');
  assert.ok(src.includes('/api/v1/telemetry/canon/status'),  'missing status endpoint');
  assert.ok(src.includes('/api/v1/admin/summary/v511'),      'missing summary endpoint');
});

console.log('\n──────────────────────────────');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) { console.error('FAILED'); process.exit(1); }
else { console.log('ALL PASSED ✓'); process.exit(0); }
