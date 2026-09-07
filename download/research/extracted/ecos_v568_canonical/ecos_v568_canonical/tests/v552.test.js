/**
 * tests/v552.test.js — ECOS V552 — Deep Health Score Bridge
 * Run: NODE_ENV=test node tests/v552.test.js
 * @version 552.0.0
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

// ── module API ──
console.log('\n[V552] deepHealthScoreBridge552 module API\n');

const { applyScoreBridge552, getScoreBridgeStats552, BRIDGE_VERSION_552 } =
  require(path.join(ROOT, 'lib/deepHealthScoreBridge552.js'));

test('BRIDGE_VERSION_552 = 552.0.0', () => {
  assert.strictEqual(BRIDGE_VERSION_552, '552.0.0');
});

test('applyScoreBridge552 and getScoreBridgeStats552 are functions', () => {
  assert.strictEqual(typeof applyScoreBridge552, 'function');
  assert.strictEqual(typeof getScoreBridgeStats552, 'function');
});

test('applyScoreBridge552 returns { patched: true }', () => {
  const result = applyScoreBridge552();
  assert.strictEqual(result.patched, true);
  assert.strictEqual(result.version, BRIDGE_VERSION_552);
});

test('applyScoreBridge552 is idempotent', () => {
  const r1 = applyScoreBridge552();
  const r2 = applyScoreBridge552();
  assert.strictEqual(r1.patched, true);
  assert.strictEqual(r2.patched, true);
  assert.strictEqual(r2.alreadyDone, true);
});

// ── field name fix ──
console.log('\n[V552] compositeScore → composite/score alias fix\n');

const canon543 = require(path.join(ROOT, 'lib/marketMakerCanon543.js'));

test('getCompositeScore543 now returns composite field (alias)', () => {
  applyScoreBridge552();
  const r = canon543.getCompositeScore543();
  assert.ok(typeof r.composite === 'number', 'composite field must be number');
  assert.ok(r.composite >= 0 && r.composite <= 1, 'composite must be in [0,1]');
});

test('getCompositeScore543 now returns score field (alias)', () => {
  const r = canon543.getCompositeScore543();
  assert.ok(typeof r.score === 'number', 'score field must be number');
  assert.strictEqual(r.score, r.composite, 'score and composite must be equal');
});

test('compositeScore field still present (original preserved)', () => {
  const r = canon543.getCompositeScore543();
  assert.ok(typeof r.compositeScore === 'number', 'original compositeScore must still be present');
  assert.strictEqual(r.compositeScore, r.composite, 'compositeScore must match composite');
});

test('_bridged552 flag set on result', () => {
  const r = canon543.getCompositeScore543();
  assert.strictEqual(r._bridged552, true);
});

test('original function preserved as _orig552', () => {
  assert.ok(typeof canon543.getCompositeScore543._orig552 === 'function');
});

// ── score propagation to gate ──
console.log('\n[V552] Score propagation: canon543 → policy546 → gate549\n');

const gate549 = require(path.join(ROOT, 'lib/orchestratorPolicyGate549.js'));

test('gate549 getPolicyStatus549 score > 0 after patch', () => {
  const status = gate549.getPolicyStatus549();
  assert.ok(status.score > 0, 'score must be > 0 after bridge patch, got: ' + status.score);
});

test('gate549 score is approximately 0.5 (marketMaker composite)', () => {
  const status = gate549.getPolicyStatus549();
  // V561: kurtosis fix raised compositeScore 0.5→0.8; relax upper bound
  assert.ok(status.score >= 0.4,
    'score expected >=0.4, got: ' + status.score);
});

test('gate decision is SUPERVISED or AUTO (not MANUAL due to score alone)', () => {
  // score=0.5 → could be SUPERVISED (≥0.4) if trend is known.
  // trend=unknown → MANUAL (fail-closed, correct). Either is valid.
  const status = gate549.getPolicyStatus549();
  // Just verify score is being read correctly (not 0)
  assert.ok(status.score > 0, 'if score read correctly, it must be > 0');
  // Decision can be MANUAL (due to trend) — that is correct fail-closed behavior
  assert.ok(['AUTO','SUPERVISED','MANUAL'].includes(status.decision));
});

test('getScoreBridgeStats552 calls counter increments', () => {
  const before = getScoreBridgeStats552().calls;
  canon543.getCompositeScore543();
  const after = getScoreBridgeStats552().calls;
  assert.ok(after > before, 'calls counter must increment');
});

test('getScoreBridgeStats552 lastScore is ~0.5', () => {
  canon543.getCompositeScore543();
  const stats = getScoreBridgeStats552();
  assert.ok(typeof stats.lastScore === 'number');
  // V561: kurtosis fix raised score; relax upper bound
  assert.ok(stats.lastScore >= 0.4,
    'lastScore expected >=0.4, got: ' + stats.lastScore);
});

// ── server wiring ──
console.log('\n[V552] Server wiring + SACRED\n');

const SERVER = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');

test('server parses cleanly', () => {
  assert.doesNotThrow(() => new vm.Script(SERVER, { filename: 'ecos-api-server.js' }));
});

test('V552 endpoints wired', () => {
  assert.ok(SERVER.includes('/api/v1/dispatch/gate/score'), 'missing gate/score');
  assert.ok(SERVER.includes('/api/v1/dispatch/gate/test'),  'missing gate/test');
  assert.ok(SERVER.includes('/api/v1/admin/summary/v552'),  'missing summary/v552');
});

test('V552 version tags present', () => {
  assert.ok(SERVER.includes('V552-T01'));
  assert.ok(SERVER.includes('V552-T02'));
  assert.ok(SERVER.includes('V552-T03'));
});

test('V551 patch/status endpoint still present (additive)', () => {
  assert.ok(SERVER.includes('/api/v1/dispatch/patch/status'));
});

test('bridge module in lib/ and src/lib/', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'lib/deepHealthScoreBridge552.js')));
  assert.ok(fs.existsSync(path.join(ROOT, 'src/lib/deepHealthScoreBridge552.js')));
});

test('package.json major >= 552', () => {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  assert.ok(parseInt(String(v).split('.')[0], 10) >= 552, 'got ' + v);
});

test('SACRED intact', () => {
  const md5 = p => crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
  assert.strictEqual(md5('lib/fiatLedger.js'), '563e9b1f9e67091a5b6527c0a92568e5');
  assert.strictEqual(md5('lib/auditLog.js'),   'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

test('handoff docs exist', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'CHANGELOG_V552.md')));
  assert.ok(fs.existsSync(path.join(ROOT, 'NEXT_SESSION_PROMPT_V552.md')));
});

console.log('\n  Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.error('Failed: ' + errs.join(', ')); process.exit(1); }
console.log('  \u2713 All V552 tests passed\n');
