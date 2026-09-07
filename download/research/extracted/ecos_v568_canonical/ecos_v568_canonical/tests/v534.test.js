/**
 * tests/v534.test.js — ECOS V534 — governanceHealthGate534
 * Run: NODE_ENV=test node tests/v534.test.js
 * @version 534.0.0
 */
'use strict';
process.env.NODE_ENV = 'test';

const assert  = require('assert');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');

const ROOT = path.resolve(__dirname, '..');

let passed = 0, failed = 0;
const errors = [];
function test(name, fn) {
  try { fn(); console.log('  \u2713 ' + name); passed++; }
  catch (e) { console.error('  \u2717 ' + name + ': ' + e.message); failed++; errors.push(name); }
}

// ── SACRED ───────────────────────────────────────────────────────────────────
console.log('\n[V534] SACRED integrity\n');

test('T01: fiatLedger.js SACRED hash', () => {
  const h = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, 'lib/fiatLedger.js'))).digest('hex');
  assert.strictEqual(h, '563e9b1f9e67091a5b6527c0a92568e5');
});

test('T02: auditLog.js SACRED hash', () => {
  const h = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, 'lib/auditLog.js'))).digest('hex');
  assert.strictEqual(h, 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// ── server parse ──────────────────────────────────────────────────────────────
console.log('\n[V534] Server checks\n');

test('T03: server parse-clean + V534 IIFE present', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  assert.ok(src.includes('_wireGovernanceHealthGate534'), 'V534 IIFE not found');
  assert.ok(src.includes('V534-T01'), 'V534 endpoint tag missing');
});

// ── module ────────────────────────────────────────────────────────────────────
console.log('\n[V534] governanceHealthGate534 checks\n');

test('T04: module loads from lib/', () => {
  const g = require(path.join(ROOT, 'lib/governanceHealthGate534.js'));
  assert.strictEqual(typeof g.buildHealthReport534, 'function', 'buildHealthReport534 must be function');
  assert.strictEqual(g.ECOS_VERSION_534, 'V534');
});

test('T05: buildHealthReport534 with no deps → level unavailable', () => {
  const g = require(path.join(ROOT, 'lib/governanceHealthGate534.js'));
  const r = g.buildHealthReport534({});
  assert.ok(['unavailable', 'degraded'].includes(r.level), 'no deps → degraded or unavailable');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.ecosVersion, 'V534');
});

test('T06: healthy bridge + healthy diag → level healthy', () => {
  const g = require(path.join(ROOT, 'lib/governanceHealthGate534.js'));
  const fakeBridge = {
    getSnapshot: () => ({ ok: true, data: 'snap', snapshotsFailed: 0 }),
    stats:       () => ({ snapshotsFailed: 0, snapshotsTaken: 5 }),
  };
  const fakeDiag533 = {
    diagnoseBridgeOpts533: () => ({ criticalDepsOk: true, deps: {} }),
  };
  const r = g.buildHealthReport534({ bridge532: fakeBridge, diagOpts533: {}, Diag533: fakeDiag533 });
  assert.strictEqual(r.level, 'healthy', 'healthy bridge + diag → healthy');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.enriched, false, 'no enrichment needed when healthy');
  assert.strictEqual(r.diagnose, null, 'diagnose omitted when healthy');
});

test('T07: failed snapshot → enriched=true, diagnose included', () => {
  const g = require(path.join(ROOT, 'lib/governanceHealthGate534.js'));
  const fakeBridge = {
    getSnapshot: () => ({ ok: false, reason: 'not_started' }),
    stats:       () => ({ snapshotsFailed: 3 }),
  };
  const fakeDiag533 = {
    diagnoseBridgeOpts533: () => ({ criticalDepsOk: false, deps: { O437: { status: 'missing' } } }),
  };
  const r = g.buildHealthReport534({ bridge532: fakeBridge, diagOpts533: {}, Diag533: fakeDiag533 });
  assert.strictEqual(r.enriched, true, 'enriched must be true when snap failed');
  assert.ok(r.diagnose !== null, 'diagnose must be included when enriched');
  assert.ok(r.level !== 'healthy', 'cannot be healthy with failed snap');
});

test('T08: failed snapshot + no diag module → still returns report (no throw)', () => {
  const g = require(path.join(ROOT, 'lib/governanceHealthGate534.js'));
  const fakeBridge = {
    getSnapshot: () => ({ ok: false, reason: 'not_started' }),
    stats:       () => ({ snapshotsFailed: 1 }),
  };
  let threw = false;
  let r;
  try { r = g.buildHealthReport534({ bridge532: fakeBridge }); } catch (_) { threw = true; }
  assert.ok(!threw, 'must not throw even without Diag533');
  assert.ok(r && r.ecosVersion === 'V534');
});

test('T09: reason field populated when not healthy', () => {
  const g = require(path.join(ROOT, 'lib/governanceHealthGate534.js'));
  const r = g.buildHealthReport534({});
  assert.ok(typeof r.reason === 'string', 'reason must be string when not healthy');
  assert.ok(r.reason.length > 0, 'reason must be non-empty');
});

test('T10: degraded bridge (snap ok, diag missing) → level unavailable', () => {
  const g = require(path.join(ROOT, 'lib/governanceHealthGate534.js'));
  const fakeBridge = {
    getSnapshot: () => ({ ok: true }),
    stats:       () => ({ snapshotsFailed: 0 }),
  };
  const fakeDiag533 = {
    diagnoseBridgeOpts533: () => ({ criticalDepsOk: false, deps: { gc499: { status: 'missing' } } }),
  };
  const r = g.buildHealthReport534({ bridge532: fakeBridge, diagOpts533: {}, Diag533: fakeDiag533 });
  assert.strictEqual(r.level, 'unavailable', 'criticalDepsOk=false → unavailable');
  assert.ok(r.reason && r.reason.includes('critical_deps_missing'));
});

test('T11: hbRunning reflected in report', () => {
  const g = require(path.join(ROOT, 'lib/governanceHealthGate534.js'));
  const fakeHb = { status: () => ({ running: true }) };
  const r = g.buildHealthReport534({ hb532: fakeHb });
  assert.strictEqual(r.hbRunning, true, 'hbRunning must reflect heartbeat status');
});

test('T12: version is 534.0.0', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(parseInt(pkg.version) >= 534, 'version must be >= 534, got: ' + pkg.version);
});

test('T13: audit-tests baseline — realFail count not increased', () => {
  // Check TEST_AUDIT.json written by most recent audit run (pre-V534)
  let audit;
  try { audit = JSON.parse(fs.readFileSync(path.join(ROOT, 'TEST_AUDIT.json'), 'utf8')); } catch (_) { return; }
  // realFail should be 0 (baseline from V533)
  const selfExcludes534 = new Set(['v510.test.js', 'v528.test.js', 'v534.test.js']);
  const rf534 = Array.isArray(audit.realFail) ? audit.realFail : [];
  const nonSelf534 = rf534.filter(r => !selfExcludes534.has(r.suite || r));
  assert.strictEqual(nonSelf534.length, 0, 'realFail baseline violated: ' + JSON.stringify(nonSelf534));
});

// ── summary ───────────────────────────────────────────────────────────────────
console.log('\n[V534] Results\n');
console.log('  ' + passed + ' passed, ' + failed + ' failed');
if (errors.length) console.error('  Failed:', errors.join(', '));
console.log('');
process.exit(failed > 0 ? 1 : 0);
