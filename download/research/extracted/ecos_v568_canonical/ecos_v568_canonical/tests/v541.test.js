'use strict';
// tests/v541.test.js — V541: deepHealthAlertFilter541 severity+category filter
const assert  = require('assert');
const crypto  = require('crypto');
const path    = require('path');
const fs      = require('fs');

let passed = 0, failed = 0;
function test(name, fn) {
  try   { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

// ── T01 SACRED ───────────────────────────────────────────────────────────────
test('SACRED fiatLedger.js md5', () => {
  const h = crypto.createHash('md5').update(fs.readFileSync(path.join(__dirname,'../lib/fiatLedger.js'))).digest('hex');
  assert.strictEqual(h, '563e9b1f9e67091a5b6527c0a92568e5');
});
test('SACRED auditLog.js md5', () => {
  const h = crypto.createHash('md5').update(fs.readFileSync(path.join(__dirname,'../lib/auditLog.js'))).digest('hex');
  assert.strictEqual(h, 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// ── T02 parse + version ───────────────────────────────────────────────────────
test('server parses without error', () => {
  require('child_process').execSync(
    'node --check ' + path.join(__dirname,'../ecos-api-server.js'), { stdio:'pipe' });
});
test('package.json version >= 541', () => {
  const p = JSON.parse(fs.readFileSync(path.join(__dirname,'../package.json'),'utf8'));
  assert(parseInt(p.version) >= 541, `version ${p.version} < 541`);
});

// ── T03 module loads ─────────────────────────────────────────────────────────
test('deepHealthAlertFilter541 loads without error', () => {
  const m = require('../lib/deepHealthAlertFilter541.js');
  assert(m && typeof m === 'object');
});
test('ALERT_FILTER_VERSION_541 is 541.0.0', () => {
  const m = require('../lib/deepHealthAlertFilter541.js');
  assert.strictEqual(m.ALERT_FILTER_VERSION_541, '541.0.0');
});

// ── T04 _parseFilterParams541 (unit) ─────────────────────────────────────────
test('_parseFilterParams541: empty query → defaults (no filters, no errors)', () => {
  const { _parseFilterParams541, FILTER_LIMIT_MAX_541 } = require('../lib/deepHealthAlertFilter541.js');
  const p = _parseFilterParams541({});
  assert.strictEqual(p.severity, null);
  assert.strictEqual(p.category, null);
  assert.strictEqual(p.limit, FILTER_LIMIT_MAX_541);
  assert.strictEqual(p.errors.length, 0);
});
test('_parseFilterParams541: valid severity=critical', () => {
  const { _parseFilterParams541 } = require('../lib/deepHealthAlertFilter541.js');
  const p = _parseFilterParams541({ severity: 'critical' });
  assert.strictEqual(p.severity, 'critical');
  assert.strictEqual(p.errors.length, 0);
});
test('_parseFilterParams541: valid category=bridge', () => {
  const { _parseFilterParams541 } = require('../lib/deepHealthAlertFilter541.js');
  const p = _parseFilterParams541({ category: 'bridge' });
  assert.strictEqual(p.category, 'bridge');
  assert.strictEqual(p.errors.length, 0);
});
test('_parseFilterParams541: unknown severity → error in errors[], severity stays null (fail-soft)', () => {
  const { _parseFilterParams541 } = require('../lib/deepHealthAlertFilter541.js');
  const p = _parseFilterParams541({ severity: 'EXTREME' });
  assert.strictEqual(p.severity, null, 'unknown severity should not be applied');
  assert(p.errors.length > 0, 'should have error message');
  assert(p.errors[0].includes('unknown severity'), p.errors[0]);
});
test('_parseFilterParams541: unknown category → error, category stays null', () => {
  const { _parseFilterParams541 } = require('../lib/deepHealthAlertFilter541.js');
  const p = _parseFilterParams541({ category: 'pizza' });
  assert.strictEqual(p.category, null);
  assert(p.errors.length > 0);
});
test('_parseFilterParams541: limit capped at FILTER_LIMIT_MAX_541', () => {
  const { _parseFilterParams541, FILTER_LIMIT_MAX_541 } = require('../lib/deepHealthAlertFilter541.js');
  const p = _parseFilterParams541({ limit: '99999' });
  assert.strictEqual(p.limit, FILTER_LIMIT_MAX_541);
  assert.strictEqual(p.errors.length, 0);
});
test('_parseFilterParams541: limit=0 → error', () => {
  const { _parseFilterParams541 } = require('../lib/deepHealthAlertFilter541.js');
  const p = _parseFilterParams541({ limit: '0' });
  assert(p.errors.length > 0, 'limit=0 should produce error');
});

// ── T05 filterAlerts541 (unit) ───────────────────────────────────────────────
test('filterAlerts541: no filter → returns all', () => {
  const { filterAlerts541 } = require('../lib/deepHealthAlertFilter541.js');
  const alerts = [
    { severity:'critical', category:'bridge' },
    { severity:'warning',  category:'heartbeat' },
    { severity:'info',     category:'module' },
  ];
  const r = filterAlerts541(alerts, { severity: null, category: null, limit: 500 });
  assert.strictEqual(r.length, 3);
});
test('filterAlerts541: severity=critical → only critical', () => {
  const { filterAlerts541 } = require('../lib/deepHealthAlertFilter541.js');
  const alerts = [
    { severity:'critical', category:'bridge' },
    { severity:'warning',  category:'heartbeat' },
    { severity:'critical', category:'governance' },
  ];
  const r = filterAlerts541(alerts, { severity: 'critical', category: null, limit: 500 });
  assert.strictEqual(r.length, 2);
  assert(r.every(a => a.severity === 'critical'));
});
test('filterAlerts541: category=heartbeat → only heartbeat', () => {
  const { filterAlerts541 } = require('../lib/deepHealthAlertFilter541.js');
  const alerts = [
    { severity:'critical', category:'bridge' },
    { severity:'warning',  category:'heartbeat' },
    { severity:'info',     category:'heartbeat' },
  ];
  const r = filterAlerts541(alerts, { severity: null, category: 'heartbeat', limit: 500 });
  assert.strictEqual(r.length, 2);
  assert(r.every(a => a.category === 'heartbeat'));
});
test('filterAlerts541: severity+category combined', () => {
  const { filterAlerts541 } = require('../lib/deepHealthAlertFilter541.js');
  const alerts = [
    { severity:'warning', category:'heartbeat' },
    { severity:'critical', category:'heartbeat' },
    { severity:'warning', category:'bridge' },
  ];
  const r = filterAlerts541(alerts, { severity: 'warning', category: 'heartbeat', limit: 500 });
  assert.strictEqual(r.length, 1);
});
test('filterAlerts541: limit=1 → only first alert', () => {
  const { filterAlerts541 } = require('../lib/deepHealthAlertFilter541.js');
  const alerts = [
    { severity:'critical', category:'bridge' },
    { severity:'warning',  category:'heartbeat' },
  ];
  const r = filterAlerts541(alerts, { severity: null, category: null, limit: 1 });
  assert.strictEqual(r.length, 1);
});
test('filterAlerts541: non-array input → returns empty array (fail-closed)', () => {
  const { filterAlerts541 } = require('../lib/deepHealthAlertFilter541.js');
  const r = filterAlerts541(null, { severity: null, category: null, limit: 500 });
  assert.deepStrictEqual(r, []);
});

// ── T06 buildFilteredAlerts541 (integration) ─────────────────────────────────
test('buildFilteredAlerts541: runs without throw', () => {
  const { buildFilteredAlerts541 } = require('../lib/deepHealthAlertFilter541.js');
  const r = buildFilteredAlerts541({});
  assert(r && typeof r === 'object', 'should return object');
  assert('ok' in r, 'missing ok');
  assert(Array.isArray(r.alerts), 'missing alerts array');
  assert(r.version === '541.0.0', 'wrong version');
});
test('buildFilteredAlerts541: filters property echoes params', () => {
  const { buildFilteredAlerts541 } = require('../lib/deepHealthAlertFilter541.js');
  const r = buildFilteredAlerts541({ severity: 'critical' });
  assert(r.filters && r.filters.severity === 'critical', 'filters.severity not echoed');
});
test('buildFilteredAlerts541: bad severity → filterErrors non-empty, still returns ok response', () => {
  const { buildFilteredAlerts541 } = require('../lib/deepHealthAlertFilter541.js');
  const r = buildFilteredAlerts541({ severity: 'EXTREME' });
  assert(Array.isArray(r.filterErrors) && r.filterErrors.length > 0, 'should have filterErrors');
  assert(Array.isArray(r.alerts), 'should still return alerts array');
});

// ── T07 SCHEMA ────────────────────────────────────────────────────────────────
test('FILTER_SCHEMA_541 has 3 query params', () => {
  const { FILTER_SCHEMA_541 } = require('../lib/deepHealthAlertFilter541.js');
  assert.strictEqual(FILTER_SCHEMA_541.queryParams.length, 3);
});
test('FILTER_SCHEMA_541 has examples array', () => {
  const { FILTER_SCHEMA_541 } = require('../lib/deepHealthAlertFilter541.js');
  assert(Array.isArray(FILTER_SCHEMA_541.examples) && FILTER_SCHEMA_541.examples.length >= 2);
});

// ── T08 server wiring ─────────────────────────────────────────────────────────
test('server has V541-T01 /api/v1/deep-health/alerts/v541', () => {
  const src = fs.readFileSync(path.join(__dirname,'../ecos-api-server.js'),'utf8');
  assert(src.includes('V541-T01'));
  assert(src.includes('/api/v1/deep-health/alerts/v541'));
});
test('server has V541-T03 summary/v541', () => {
  const src = fs.readFileSync(path.join(__dirname,'../ecos-api-server.js'),'utf8');
  assert(src.includes('V541-T03'));
  assert(src.includes('summary/v541'));
});

// ── T09 V540 dep still intact ─────────────────────────────────────────────────
test('deepHealthAlerts540 still loads (no regression)', () => {
  const m = require('../lib/deepHealthAlerts540.js');
  assert(m.buildAlerts540 && typeof m.buildAlerts540 === 'function');
});

console.log(`\n  V541 results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
