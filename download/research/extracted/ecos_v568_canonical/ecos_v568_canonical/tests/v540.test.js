'use strict';
/**
 * tests/v540.test.js — ECOS V540
 * deepHealthAlerts540 — Structured Alert Export
 */

const assert = require('assert');
const path   = require('path');
const { execSync } = require('child_process');
const serverPath = path.resolve(__dirname, '../ecos-api-server.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

console.log('\n─── V540 deepHealthAlerts Tests ───');

const da540 = require('../lib/deepHealthAlerts540.js');

// [1] module loads with expected exports
test('module loads with expected exports', () => {
  assert.strictEqual(typeof da540.buildAlerts540,          'function');
  assert.strictEqual(typeof da540.registerEndpoints540,    'function');
  assert.strictEqual(typeof da540._classifyItem540,        'function');
  assert.strictEqual(typeof da540.DEEP_HEALTH_ALERTS_VERSION_540, 'string');
  assert.strictEqual(typeof da540.SEVERITY_CRITICAL_540,   'string');
  assert.strictEqual(typeof da540.SEVERITY_WARNING_540,    'string');
  assert.strictEqual(typeof da540.SEVERITY_INFO_540,       'string');
});

// [2] version correct
test('DEEP_HEALTH_ALERTS_VERSION_540 === 540.0.0', () => {
  assert.strictEqual(da540.DEEP_HEALTH_ALERTS_VERSION_540, '540.0.0');
});

// [3] buildAlerts540 returns valid shape
test('buildAlerts540() returns valid shape', () => {
  const r = da540.buildAlerts540();
  assert.ok(typeof r.ok       === 'boolean', 'ok must be boolean');
  assert.ok(typeof r.status   === 'string',  'status must be string');
  assert.ok(typeof r.alertCount === 'number', 'alertCount must be number');
  assert.ok(Array.isArray(r.alerts),          'alerts must be array');
  assert.strictEqual(r.version, '540.0.0');
  assert.ok(typeof r.ts === 'string',         'ts must be string');
});

// [4] alert count consistency
test('alertCount matches alerts.length', () => {
  const r = da540.buildAlerts540();
  assert.strictEqual(r.alertCount, r.alerts.length);
  assert.strictEqual(r.criticalCount + r.warningCount + r.infoCount, r.alertCount);
});

// [5] each alert has required fields
test('each alert has id, severity, category, message, fix_url, ts', () => {
  const r = da540.buildAlerts540();
  for (const a of r.alerts) {
    assert.ok(typeof a.id       === 'string' && a.id.startsWith('ecos-540-'), `id wrong: ${a.id}`);
    assert.ok(['critical','warning','info'].includes(a.severity), `severity: ${a.severity}`);
    assert.ok(typeof a.category === 'string', 'category missing');
    assert.ok(typeof a.message  === 'string', 'message missing');
    assert.ok(typeof a.fix_url  === 'string' && a.fix_url.startsWith('/'), 'fix_url missing');
    assert.ok(typeof a.ts       === 'string', 'ts missing');
  }
});

// [6] _classifyItem540 — bridge → critical
test('_classifyItem540: bridge message → critical+bridge', () => {
  const c = da540._classifyItem540('activeBridge532 is null — ensure V532 IIFE ran');
  assert.strictEqual(c.severity, 'critical');
  assert.strictEqual(c.category, 'bridge');
});

// [7] _classifyItem540 — heartbeat null → critical
test('_classifyItem540: heartbeat null → critical+heartbeat', () => {
  const c = da540._classifyItem540('heartbeat (activeHb532) is null — Bridge532 must be initialised');
  assert.strictEqual(c.severity, 'critical');
  assert.strictEqual(c.category, 'heartbeat');
});

// [8] _classifyItem540 — hbRunning=false → warning
test('_classifyItem540: hbRunning=false → warning+heartbeat', () => {
  const c = da540._classifyItem540('Heartbeat object exists but hbRunning=false — call hb.start()');
  assert.strictEqual(c.severity, 'warning');
  assert.strictEqual(c.category, 'heartbeat');
});

// [9] _classifyItem540 — governance dep → warning
test('_classifyItem540: governance dep missing → warning+governance', () => {
  const c = da540._classifyItem540('Governance dep "someModule" missing — missing fns: someFunc');
  assert.strictEqual(c.severity, 'warning');
  assert.strictEqual(c.category, 'governance');
});

// [10] _classifyItem540 — module not loaded → info
test('_classifyItem540: module not loaded → info+module', () => {
  const c = da540._classifyItem540('V538 aggregate module not loaded — check lib/...');
  assert.strictEqual(c.severity, 'info');
  assert.strictEqual(c.category, 'module');
});

// [11] _classifyItem540 — unknown → info+unknown
test('_classifyItem540: unknown message → info+unknown', () => {
  const c = da540._classifyItem540('some random unclassifiable problem xyz');
  assert.strictEqual(c.severity, 'info');
  assert.strictEqual(c.category, 'unknown');
});

// [12] registerEndpoints540 accepts null gracefully (no throw)
test('registerEndpoints540(null) returns false without throwing', () => {
  const result = da540.registerEndpoints540(null);
  assert.strictEqual(result, false);
});

// [13] SACRED hashes
test('SACRED files intact (fiatLedger + auditLog)', () => {
  const crypto = require('crypto');
  const fs     = require('fs');
  const check  = (file, expected) => {
    const hash = crypto.createHash('md5')
      .update(fs.readFileSync(path.resolve(__dirname, '..', file)))
      .digest('hex');
    assert.strictEqual(hash, expected, `SACRED hash mismatch: ${file}`);
  };
  check('lib/fiatLedger.js', '563e9b1f9e67091a5b6527c0a92568e5');
  check('lib/auditLog.js',   'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// [14] server parse clean
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
