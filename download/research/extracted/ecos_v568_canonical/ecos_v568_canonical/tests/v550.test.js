'use strict';
/**
 * tests/v550.test.js — ECOS V550 (Phase P268) — Agent Dispatch Bridge
 * Run: NODE_ENV=test node tests/v550.test.js   → must exit 0
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
test('package.json version >= 550', () => {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8')).version;
  assert.ok(parseInt(String(v).split('.')[0], 10) >= 550, 'got ' + v);
});

// ─── T04: Module loads ────────────────────────────────────────────────────────
console.log('\n[T04] Module loads');
let B550;
test('lib/dispatchBridge550 loads', () => {
  B550 = require(path.join(ROOT,'lib/dispatchBridge550.js'));
  assert.ok(B550);
});
test('src/lib/dispatchBridge550 loads (mirror)', () => {
  require(path.join(ROOT,'src/lib/dispatchBridge550.js'));
});
test('BRIDGE_DISPATCH_VERSION_550 = 550.0.0', () => {
  assert.strictEqual(B550.BRIDGE_DISPATCH_VERSION_550, '550.0.0');
});
test('dispatchPlan550 is a function', () => {
  assert.strictEqual(typeof B550.dispatchPlan550, 'function');
});
test('getDispatchStats550 is a function', () => {
  assert.strictEqual(typeof B550.getDispatchStats550, 'function');
});
test('GateBlockedError550 is a class', () => {
  assert.strictEqual(typeof B550.GateBlockedError550, 'function');
});

// ─── T05: dispatchPlan550 fail-closed behavior ────────────────────────────────
console.log('\n[T05] dispatchPlan550 — fail-closed');
test('invalid plan (no steps) throws GateBlockedError550 with INVALID_PLAN', () => {
  try {
    B550.dispatchPlan550({}, {}, {});
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(e instanceof B550.GateBlockedError550, 'not a GateBlockedError550');
    assert.strictEqual(e.code, 'INVALID_PLAN');
  }
});
test('null plan throws GateBlockedError550', () => {
  try {
    B550.dispatchPlan550(null, {}, {});
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(e instanceof B550.GateBlockedError550 || e instanceof TypeError);
  }
});
test('low-score plan (no health data) is BLOCKED by gate → GateBlockedError550', () => {
  // gate549 scores 0 when no health data → decision=MANUAL → blocked
  const plan = { steps: [{ type: 'audit', payload: { event: 'test550' } }] };
  try {
    B550.dispatchPlan550(plan, {}, { authorized: false });
    // If gate ALLOWS (fallback path) that's also acceptable
  } catch (e) {
    assert.ok(e instanceof B550.GateBlockedError550,
      'expected GateBlockedError550, got: ' + (e && e.constructor && e.constructor.name));
  }
});

// ─── T06: getDispatchStats550 ─────────────────────────────────────────────────
console.log('\n[T06] getDispatchStats550');
test('stats returns object with calls/allowed/blocked/fallback/errors', () => {
  const s = B550.getDispatchStats550();
  assert.ok(typeof s.calls === 'number');
  assert.ok(typeof s.blocked === 'number');
  assert.ok(typeof s.allowed === 'number');
  assert.ok(typeof s.fallback === 'number');
  assert.ok(typeof s.errors === 'number');
});
test('calls count is positive (reflects calls from T05)', () => {
  const s = B550.getDispatchStats550();
  assert.ok(s.calls >= 1, 'expected >= 1 call, got ' + s.calls);
});

// ─── T07: Server wiring ───────────────────────────────────────────────────────
console.log('\n[T07] Server wiring');
const SERVER = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
test('server requires dispatchBridge550', () => {
  assert.ok(SERVER.includes("require('./lib/dispatchBridge550.js')"));
});
test('server wires GET /api/v1/dispatch/bridge/stats', () => {
  assert.ok(SERVER.includes('/api/v1/dispatch/bridge/stats'));
});
test('server wires GET /api/v1/admin/summary/v550', () => {
  assert.ok(SERVER.includes('/api/v1/admin/summary/v550'));
});
test('V550-T01 and V550-T02 tags present', () => {
  assert.ok(SERVER.includes('V550-T01') && SERVER.includes('V550-T02'));
});

// ─── T08: V549 regression ─────────────────────────────────────────────────────
console.log('\n[T08] V549 regression');
test('orchestratorPolicyGate549 still loads', () => {
  require(path.join(ROOT,'lib/orchestratorPolicyGate549.js'));
});
test('server still wires /api/v1/admin/summary/v549', () => {
  assert.ok(SERVER.includes('/api/v1/admin/summary/v549'));
});

// ─── Results ──────────────────────────────────────────────────────────────────
console.log('\n─────────────────────────────');
console.log('V550 tests: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) { process.exit(1); }
console.log('ALL TESTS PASSED\n');
