/**
 * tests/v556.test.js — ECOS V556 — gatePolicyTrendBridge556
 * Run: NODE_ENV=test node tests/v556.test.js
 * @version 556.0.0
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
console.log('\n[V556] SACRED integrity\n');

test('T01: fiatLedger.js SACRED hash', () => {
  const h = crypto.createHash('md5').update(fs.readFileSync(path.join(LIB, 'fiatLedger.js'))).digest('hex');
  assert.strictEqual(h, '563e9b1f9e67091a5b6527c0a92568e5', 'fiatLedger SACRED violated');
});

test('T02: auditLog.js SACRED hash', () => {
  const h = crypto.createHash('md5').update(fs.readFileSync(path.join(LIB, 'auditLog.js'))).digest('hex');
  assert.strictEqual(h, 'e5a5c2c27801d2d03991bc8e5a1df8cb', 'auditLog SACRED violated');
});

// ── server ────────────────────────────────────────────────────────────────────
console.log('\n[V556] Server checks\n');

test('T03: server parse-clean + V556 IIFE present', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  assert.ok(src.includes('_wireGatePolicyTrendBridge556'), 'V556 IIFE not found');
  assert.ok(src.includes('V556-T01'), 'V556 endpoint tag missing');
  assert.ok(src.includes('V556-T02'), 'V556 summary tag missing');
});

// ── module ────────────────────────────────────────────────────────────────────
console.log('\n[V556] gatePolicyTrendBridge556 checks\n');

test('T04: module loads from lib/', () => {
  const b = require(path.join(LIB, 'gatePolicyTrendBridge556.js'));
  assert.strictEqual(typeof b.enrichWithPolicyTrend556, 'function', 'enrichWithPolicyTrend556 must be function');
  assert.strictEqual(typeof b.buildEnrichedEval556,     'function', 'buildEnrichedEval556 must be function');
  assert.strictEqual(b.ENRICH_VERSION_556, 'V556');
});

test('T05: enrichWithPolicyTrend556 adds policyTrend + trendAgreement', () => {
  const b = require(path.join(LIB, 'gatePolicyTrendBridge556.js'));
  const gate   = { ok: true, trend: 'stable', decision: 'MANUAL', score: 0, version: '554.0.0' };
  const policy = { ok: true, trend: 'stable', decision: 'MANUAL' };
  const r = b.enrichWithPolicyTrend556(gate, policy);
  assert.strictEqual(r.policyTrend,    'stable', 'policyTrend wrong');
  assert.strictEqual(r.trendAgreement, true,     'trendAgreement should be true when trends match');
  assert.strictEqual(r.enrichedBy,     'V556');
  assert.deepStrictEqual(r.trendSources, { gate: '554', policy: '546' });
});

test('T06: trendAgreement=false when trends disagree', () => {
  const b = require(path.join(LIB, 'gatePolicyTrendBridge556.js'));
  const gate   = { ok: true, trend: 'rising',  decision: 'MANUAL', score: 0 };
  const policy = { ok: true, trend: 'falling', decision: 'MANUAL' };
  const r = b.enrichWithPolicyTrend556(gate, policy);
  assert.strictEqual(r.trendAgreement, false, 'must be false when trends differ');
});

test('T07: trendAgreement=null when either trend is unknown', () => {
  const b = require(path.join(LIB, 'gatePolicyTrendBridge556.js'));
  const gate   = { ok: false, trend: 'unknown', decision: 'MANUAL', score: 0 };
  const policy = { ok: true,  trend: 'stable',  decision: 'MANUAL' };
  const r = b.enrichWithPolicyTrend556(gate, policy);
  assert.strictEqual(r.trendAgreement, null, 'null when gate trend is unknown');
});

test('T08: enrichWithPolicyTrend556 throws on invalid gateResult', () => {
  const b = require(path.join(LIB, 'gatePolicyTrendBridge556.js'));
  let threw = false;
  try { b.enrichWithPolicyTrend556(null, {}); } catch (_) { threw = true; }
  assert.ok(threw, 'must throw on null gateResult');
});

test('T09: buildEnrichedEval556 with real modules — trendAgreement after seed', () => {
  require(path.join(LIB, 'trendSeedBridge553.js')).seedTrend553(10);
  const b      = require(path.join(LIB, 'gatePolicyTrendBridge556.js'));
  const Eval554 = require(path.join(LIB, 'gateEvaluateBridge554.js'));
  const Pol546  = require(path.join(LIB, 'deepHealthPolicy546.js'));
  const result = b.buildEnrichedEval556({
    evalFn554:   () => Eval554.evaluateGate554(),
    policyFn546: () => Pol546.getPolicy546(),
  });
  // Both sources fixed; they must agree
  assert.strictEqual(result.trend,       'stable', 'gateTrend must be stable after seed');
  assert.strictEqual(result.policyTrend, 'stable', 'policyTrend must be stable after seed');
  assert.strictEqual(result.trendAgreement, true,  'must agree after V555 fix');
});

test('T10: buildEnrichedEval556 without fns → soft-fail, no throw', () => {
  const b = require(path.join(LIB, 'gatePolicyTrendBridge556.js'));
  let threw = false, r;
  try { r = b.buildEnrichedEval556({}); } catch (_) { threw = true; }
  assert.ok(!threw, 'must not throw without fns');
  assert.ok(r && r.enrichedBy === 'V556', 'must return enriched object');
});

test('T11: src/lib and lib/ are identical', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/gatePolicyTrendBridge556.js'), 'utf8');
  const lib = fs.readFileSync(path.join(LIB, 'gatePolicyTrendBridge556.js'), 'utf8');
  assert.strictEqual(src, lib, 'src/lib and lib/ copies must be identical');
});

test('T12: version is 556.0.0', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(parseInt(pkg.version) >= 556, 'version must be >= 556, got: ' + pkg.version);
});

// ── summary ───────────────────────────────────────────────────────────────────
console.log('\n[V556] Results\n');
console.log('  ' + passed + ' passed, ' + failed + ' failed');
if (errors.length) console.error('  Failed:', errors.join(', '));
console.log('');
process.exit(failed > 0 ? 1 : 0);
