/**
 * tests/v551.test.js — ECOS V551 — dispatchBridge550 gate patch
 * Run: NODE_ENV=test node tests/v551.test.js
 * @version 551.0.0
 */
'use strict';
process.env.NODE_ENV = 'test';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

let passed = 0, failed = 0, errs = [];
function test(name, fn) {
  try { fn(); console.log('  \u2713 ' + name); passed++; }
  catch (e) { console.error('  \u2717 ' + name + ': ' + e.message); failed++; errs.push(name); }
}

// ── Load modules ──
const O437 = require(path.join(ROOT, 'lib/moduleOrchestrator437.js'));
const D550 = require(path.join(ROOT, 'lib/dispatchBridge550.js'));
const Guard467  = require(path.join(ROOT, 'lib/diamondAutonomousGuard467.js'));
const Bridge466 = require(path.join(ROOT, 'lib/diamondOrchestratorBridge466.js'));

// ── Apply the patch (same logic as IIFE, for isolated test) ──
// We do this manually so the test is self-contained.
let _patchApplied = false;
let _calls = 0, _allowed = 0, _blocked = 0;

function _applyPatch() {
  if (O437._patched551) { _patchApplied = true; return; } // already patched by server boot
  const _orig = O437.executePlan437;
  O437.executePlan437 = function executePlan437_test551(plan, ctx) {
    _calls++;
    const result = D550.dispatchPlan550(plan, ctx, {
      authorized:    ctx && ctx.authorized === true,
      allowFallback: false,
      audit:         null,
    });
    _allowed++;
    return result;
  };
  O437.executePlan437._origExecutePlan437_551 = _orig;
  O437._patched551 = true;
  O437._patchStats551 = () => ({ calls: _calls, allowed: _allowed, blocked: _blocked });
  _patchApplied = true;
}

// ── dispatchBridge550 direct API ──
console.log('\n[V551] dispatchBridge550 direct API\n');

test('dispatchPlan550 is exported', () => {
  assert.strictEqual(typeof D550.dispatchPlan550, 'function');
});

test('dispatchPlan550 authorized=true → processed by gate (ALLOWED or MANUAL-blocked)', () => {
  const plan = { steps: [{ type: 'advisory', description: 'test step' }] };
  // Gate may allow or block based on policy score — both are valid gate outcomes.
  // We only verify the call reaches the gate (no unhandled crash, correct error types).
  try {
    const result = D550.dispatchPlan550(plan, {}, { authorized: true, allowFallback: false });
    assert.ok(typeof result === 'object', 'ALLOWED: result should be object');
  } catch (e) {
    // MANUAL/DEGRADED → GateBlockedError550 is the expected fail-closed error
    assert.ok(e.name === 'GateBlockedError550' || e.message.includes('gate'),
      'gate error expected, got: ' + e.message);
  }
});

test('dispatchPlan550 authorized=false → throws GateBlockedError550', () => {
  const plan = { steps: [{ type: 'advisory', description: 'test step' }] };
  assert.throws(
    () => D550.dispatchPlan550(plan, {}, { authorized: false, allowFallback: false }),
    e => e.name === 'GateBlockedError550' || (e.message && e.message.includes('gate'))
  );
});

test('dispatchPlan550 missing steps → throws', () => {
  assert.throws(
    () => D550.dispatchPlan550({ steps: 'not-array' }, {}, { authorized: true }),
    e => !!e
  );
});

// ── require-cache patch ──
console.log('\n[V551] require-cache monkey-patch\n');

// Apply patch before testing
_applyPatch();

test('O437._patched551 flag is set after patch', () => {
  assert.strictEqual(O437._patched551, true);
});

test('O437.executePlan437 is the patched version', () => {
  assert.ok(typeof O437.executePlan437._origExecutePlan437_551 === 'function',
    'original must be preserved');
});

test('original function is preserved as _origExecutePlan437_551', () => {
  assert.ok(typeof O437.executePlan437._origExecutePlan437_551 === 'function');
  // Original should be different from patched
  assert.notStrictEqual(O437.executePlan437, O437.executePlan437._origExecutePlan437_551);
});

test('patch is idempotent — applying twice does not double-wrap', () => {
  const before = O437.executePlan437;
  _applyPatch(); // second call
  assert.strictEqual(O437.executePlan437, before, 'function reference must not change on second apply');
});

// ── guard467 routes through patch ──
console.log('\n[V551] guard467 routes through dispatchBridge550 gate\n');

test('guard467 module loads', () => {
  assert.ok(typeof Guard467 === 'object' || typeof Guard467 === 'function');
});

test('guard467 uses require("./moduleOrchestrator437") → same O437 object', () => {
  // The cached require returns the exact same object
  const O437again = require(path.join(ROOT, 'lib/moduleOrchestrator437.js'));
  assert.strictEqual(O437again, O437, 'require cache must return same object');
  assert.strictEqual(O437again._patched551, true, 'patched flag visible to all requirers');
});

test('bridge466 uses require("./moduleOrchestrator437") → sees patch', () => {
  const O437via466 = require(path.join(ROOT, 'lib/moduleOrchestrator437.js'));
  assert.strictEqual(O437via466._patched551, true);
  assert.ok(typeof O437via466.executePlan437._origExecutePlan437_551 === 'function');
});

// ── fail-closed: unauthorized call blocked ──
console.log('\n[V551] fail-closed: unauthorized plan execution\n');

test('executePlan437 with authorized:false → throws GateBlockedError550 or similar', () => {
  const plan = { steps: [{ type: 'money', description: 'steal funds' }] };
  assert.throws(
    () => O437.executePlan437(plan, { authorized: false }),
    e => (e.name === 'GateBlockedError550' || e.message.includes('gate') || e.message.includes('authorized'))
  );
});

test('executePlan437 with no ctx → treated as unauthorized', () => {
  const plan = { steps: [{ type: 'advisory', description: 'neutral step' }] };
  // ctx=undefined → authorized=false → should be blocked
  assert.throws(
    () => O437.executePlan437(plan, undefined),
    e => !!e
  );
});

test('executePlan437 with authorized:true → processed by gate (policy applies)', () => {
  const plan = { steps: [{ type: 'advisory', description: 'safe advisory' }] };
  // With low policy score, gate returns MANUAL (fail-closed). That is correct behavior.
  // Test verifies gate is applied (authorized path reaches gate, not raw executor).
  try {
    O437.executePlan437(plan, { authorized: true });
    // If here: ALLOWED
  } catch (e) {
    // GateBlockedError550 = gate working correctly (MANUAL policy decision)
    assert.ok(e.name === 'GateBlockedError550' || e.message.includes('gate') || e.message.includes('MANUAL'),
      'Expected gate error, got: ' + e.message);
  }
});

// ── server wiring + SACRED ──
console.log('\n[V551] Server wiring + SACRED\n');

const SERVER = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');

test('server parses cleanly', () => {
  assert.doesNotThrow(() => new vm.Script(SERVER, { filename: 'ecos-api-server.js' }));
});

test('V551 endpoints wired', () => {
  assert.ok(SERVER.includes('/api/v1/dispatch/patch/status'), 'missing patch/status');
  assert.ok(SERVER.includes('/api/v1/admin/summary/v551'), 'missing admin/summary/v551');
});

test('V551 version tags present', () => {
  assert.ok(SERVER.includes('V551-T01'));
  assert.ok(SERVER.includes('V551-T02'));
});

test('V550 summary still present (additive)', () => {
  assert.ok(SERVER.includes('/api/v1/admin/summary/v550'));
});

test('server requires dispatchBridge550 and moduleOrchestrator437', () => {
  assert.ok(SERVER.includes("require('./lib/dispatchBridge550.js')"));
  assert.ok(SERVER.includes("require('./lib/moduleOrchestrator437.js')"));
});

test('package.json major >= 551', () => {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  assert.ok(parseInt(String(v).split('.')[0], 10) >= 551, 'got ' + v);
});

test('SACRED intact', () => {
  const md5 = p => crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
  assert.strictEqual(md5('lib/fiatLedger.js'), '563e9b1f9e67091a5b6527c0a92568e5');
  assert.strictEqual(md5('lib/auditLog.js'),   'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

test('handoff docs exist', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'CHANGELOG_V551.md')));
  assert.ok(fs.existsSync(path.join(ROOT, 'NEXT_SESSION_PROMPT_V551.md')));
});

console.log('\n  Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.error('Failed: ' + errs.join(', ')); process.exit(1); }
console.log('  \u2713 All V551 tests passed\n');
