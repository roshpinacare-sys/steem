'use strict';
/**
 * tests/v531.test.js — ECOS V531 (Phase P259) — Governance × Status Bridge
 * Run: NODE_ENV=test node tests/v531.test.js   → must exit 0
 */
process.env.NODE_ENV = 'test';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  \u2713 ' + name); passed++; }
  catch (e) { console.error('  \u2717 ' + name + ': ' + e.message); failed++; }
}

// ─── T01: SACRED ─────────────────────────────────────────────────────────────
console.log('\n[T01] SACRED integrity');
test('fiatLedger.js intact', () => {
  const h = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT,'lib/fiatLedger.js'))).digest('hex');
  assert.strictEqual(h, '563e9b1f9e67091a5b6527c0a92568e5');
});
test('auditLog.js intact', () => {
  const h = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT,'lib/auditLog.js'))).digest('hex');
  assert.strictEqual(h, 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// ─── T02: Server syntax ───────────────────────────────────────────────────────
console.log('\n[T02] Server syntax');
test('ecos-api-server.js parses cleanly', () => {
  const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
  assert.doesNotThrow(() => new vm.Script(src, { filename: 'ecos-api-server.js' }));
});

// ─── T03: Version ─────────────────────────────────────────────────────────────
console.log('\n[T03] Version');
test('package.json version >= 531', () => {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8')).version;
  assert.ok(parseInt(String(v).split('.')[0], 10) >= 531, 'got ' + v);
});

// ─── T04: Module loads ────────────────────────────────────────────────────────
console.log('\n[T04] Module loads');
let B531, s505, gc499, O437;
test('lib/governanceStatusBridge531 loads', () => {
  B531 = require(path.join(ROOT,'lib/governanceStatusBridge531.js'));
  assert.ok(B531);
});
test('src/lib/governanceStatusBridge531 loads (mirror)', () => {
  require(path.join(ROOT,'src/lib/governanceStatusBridge531.js'));
});
test('BRIDGE_VERSION_531 = 531.0.0', () => {
  assert.strictEqual(B531.BRIDGE_VERSION_531, '531.0.0');
});
test('buildBridgeSnapshot531 is a function', () => {
  assert.strictEqual(typeof B531.buildBridgeSnapshot531, 'function');
});

// ─── T05: buildBridgeSnapshot531 with real deps ───────────────────────────────
console.log('\n[T05] buildBridgeSnapshot531 — real deps');
let snap531;
test('loads deps without error', () => {
  s505  = require(path.join(ROOT,'lib/systemStatus505.js'));
  gc499 = require(path.join(ROOT,'lib/diamondGovernanceCycle499.js'));
  O437  = require(path.join(ROOT,'lib/moduleOrchestrator437.js'));
});
test('buildBridgeSnapshot531 returns ok=true', () => {
  snap531 = B531.buildBridgeSnapshot531({ status505: s505, gc499, O437, libDir: ROOT+'/lib', rootDir: ROOT });
  assert.strictEqual(snap531.ok, true, 'errors: ' + JSON.stringify(snap531.errors));
});
test('snapshot has valid signal (GREEN|YELLOW|RED)', () => {
  assert.ok(['GREEN','YELLOW','RED'].includes(snap531.signal), 'signal: ' + snap531.signal);
});
test('snapshot has governanceCycle with posture', () => {
  assert.ok(snap531.governanceCycle && snap531.governanceCycle.posture, 'governanceCycle.posture missing');
});
test('snapshot governanceCycle mode = propose (never executes autonomously)', () => {
  assert.strictEqual(snap531.governanceCycle.mode, 'propose', 'expected propose, got: ' + snap531.governanceCycle.mode);
});
test('snapshot systemStatus has governance.ok = true', () => {
  assert.ok(snap531.systemStatus && snap531.systemStatus.governanceOk === true, 'governanceOk: ' + (snap531.systemStatus && snap531.systemStatus.governanceOk));
});

// ─── T06: Fail-safe — degraded inputs ────────────────────────────────────────
console.log('\n[T06] Fail-safe behavior');
test('missing status505 → ok=false but no throw', () => {
  const r = B531.buildBridgeSnapshot531({ gc499, O437 });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors && r.errors.length > 0);
});
test('missing gc499 → ok=false but no throw', () => {
  const r = B531.buildBridgeSnapshot531({ status505: s505, O437 });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors && r.errors.length > 0);
});
test('missing O437 → ok=false but no throw', () => {
  const r = B531.buildBridgeSnapshot531({ status505: s505, gc499 });
  assert.strictEqual(r.ok, false);
});

// ─── T07: Server wiring ───────────────────────────────────────────────────────
console.log('\n[T07] Server wiring');
const SERVER = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
test('server requires governanceStatusBridge531', () => {
  assert.ok(SERVER.includes("require('./lib/governanceStatusBridge531.js')"));
});
test('server wires GET /api/v1/status/governance', () => {
  assert.ok(SERVER.includes('/api/v1/status/governance'));
});
test('server wires GET /api/v1/admin/summary/v531', () => {
  assert.ok(SERVER.includes('/api/v1/admin/summary/v531'));
});
test('V531-T01 and V531-T02 tags present', () => {
  assert.ok(SERVER.includes('V531-T01') && SERVER.includes('V531-T02'));
});

// ─── T08: V530 regression ─────────────────────────────────────────────────────
console.log('\n[T08] V530 regression');
test('server still wires /api/v1/admin/summary/v530', () => {
  assert.ok(SERVER.includes('/api/v1/admin/summary/v530'));
});
test('systemStatus505 still loads', () => {
  require(path.join(ROOT,'lib/systemStatus505.js'));
});
test('diamondGovernanceCycle499 still loads', () => {
  require(path.join(ROOT,'lib/diamondGovernanceCycle499.js'));
});

// ─── Results ──────────────────────────────────────────────────────────────────
console.log('\n─────────────────────────────');
console.log('V531 tests: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) { console.error('FAILED'); process.exit(1); }
console.log('ALL TESTS PASSED\n');
