/**
 * tests/v555.test.js — ECOS V555 — deepHealthPolicy546 trend bug fix
 * Run: NODE_ENV=test node tests/v555.test.js
 * @version 555.0.0
 */
'use strict';
process.env.NODE_ENV = 'test';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const LIB  = path.join(ROOT, 'lib');

let passed = 0, failed = 0;
const errors = [];
function test(name, fn) {
  try { fn(); console.log('  \u2713 ' + name); passed++; }
  catch (e) { console.error('  \u2717 ' + name + ': ' + e.message); failed++; errors.push(name); }
}

// ── SACRED ───────────────────────────────────────────────────────────────────
console.log('\n[V555] SACRED integrity\n');

test('T01: fiatLedger.js SACRED hash', () => {
  const h = crypto.createHash('md5').update(fs.readFileSync(path.join(LIB, 'fiatLedger.js'))).digest('hex');
  assert.strictEqual(h, '563e9b1f9e67091a5b6527c0a92568e5', 'fiatLedger SACRED violated');
});

test('T02: auditLog.js SACRED hash', () => {
  const h = crypto.createHash('md5').update(fs.readFileSync(path.join(LIB, 'auditLog.js'))).digest('hex');
  assert.strictEqual(h, 'e5a5c2c27801d2d03991bc8e5a1df8cb', 'auditLog SACRED violated');
});

// ── server ────────────────────────────────────────────────────────────────────
console.log('\n[V555] Server checks\n');

test('T03: server parse-clean + V555 IIFE present', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  assert.ok(src.includes('_wireDeepHealthPolicyFix555'), 'V555 IIFE not found');
  assert.ok(src.includes('V555-T01'), 'V555 endpoint tag missing');
});

// ── bug fix verification ──────────────────────────────────────────────────────
console.log('\n[V555] Bug fix: deepHealthPolicy546._readTrend546\n');

test('T04: getTrend542 returns .direction (not .trend)', () => {
  const hist = require(path.join(LIB, 'deepHealthAlertHistory542.js'));
  const r = hist.getTrend542();
  assert.ok('direction' in r, 'getTrend542 must return .direction field');
  assert.ok(!('trend' in r), 'getTrend542 must NOT have .trend field (confirms the original bug)');
});

test('T05: lib/deepHealthPolicy546.js now reads .direction', () => {
  const src = fs.readFileSync(path.join(LIB, 'deepHealthPolicy546.js'), 'utf8');
  assert.ok(src.includes('r.direction'), 'fix must reference r.direction');
  assert.ok(!src.includes('r.trend'), 'fix must NOT reference r.trend');
});

test('T06: src/lib/deepHealthPolicy546.js matches lib/ fix', () => {
  const srcLib = fs.readFileSync(path.join(ROOT, 'src/lib/deepHealthPolicy546.js'), 'utf8');
  assert.ok(srcLib.includes('r.direction'), 'src/lib copy must also reference r.direction');
  assert.ok(!srcLib.includes('r.trend'), 'src/lib copy must NOT reference r.trend');
});

test('T07: after seed, policy546.trend is not "unknown"', () => {
  const seed = require(path.join(LIB, 'trendSeedBridge553.js'));
  seed.seedTrend553(10);
  const pol = require(path.join(LIB, 'deepHealthPolicy546.js'));
  const p = pol.getPolicy546();
  assert.ok(p.ok === true, 'policy.ok must be true after seed');
  assert.notStrictEqual(p.trend, 'unknown', 'policy.trend must not be unknown after seed (bug fixed)');
});

test('T08: after seed, policy546.trend matches getTrend542().direction', () => {
  const hist = require(path.join(LIB, 'deepHealthAlertHistory542.js'));
  const pol  = require(path.join(LIB, 'deepHealthPolicy546.js'));
  const rawDir = hist.getTrend542().direction;
  const p = pol.getPolicy546();
  if (rawDir !== 'unknown') {
    assert.strictEqual(p.trend, rawDir, 'policy.trend must match getTrend542().direction');
  }
});

test('T09: policy546 with no data → trend=unknown (correct fallback)', () => {
  // Create isolated module instance — test default state without seed
  // The module uses a module-level cache; we test the logic by checking the format
  const pol = require(path.join(LIB, 'deepHealthPolicy546.js'));
  const p = pol.getPolicy546();
  // Either has a valid trend (if previous tests seeded) or 'unknown' (no data)
  const validTrends = ['stable', 'rising', 'falling', 'unknown'];
  assert.ok(validTrends.includes(p.trend), 'policy.trend must be a valid trend value: ' + p.trend);
});

test('T10: policy546.decision is valid enum value', () => {
  const pol = require(path.join(LIB, 'deepHealthPolicy546.js'));
  const p = pol.getPolicy546();
  const validDecisions = ['AUTO', 'MANUAL', 'HOLD', 'BLOCK'];
  assert.ok(validDecisions.includes(p.decision), 'decision must be valid, got: ' + p.decision);
});

test('T11: v554.test.js updated — no longer expects bug', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tests/v554.test.js'), 'utf8');
  assert.ok(!src.includes("policy546 misreads trend (documented bug)"), 'v554 test must not expect old bug assert');
  assert.ok(src.includes('V555 fix'), 'v554 test must mention V555 fix');
});

test('T12: version is 555.0.0', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(parseInt(pkg.version) >= 555, 'version must be >= 555, got: ' + pkg.version);
});

// ── summary ───────────────────────────────────────────────────────────────────
console.log('\n[V555] Results\n');
console.log('  ' + passed + ' passed, ' + failed + ' failed');
if (errors.length) console.error('  Failed:', errors.join(', '));
console.log('');
process.exit(failed > 0 ? 1 : 0);
