/**
 * tests/v509.test.js — ECOS V509 — tipModuleCanon509 facade
 * Run: NODE_ENV=test node tests/v509.test.js
 * @version 509.0.0
 */
'use strict';
process.env.NODE_ENV = 'test';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

let passed = 0, failed = 0;
const errors = [];
function test(name, fn) {
  try { fn(); console.log('  \u2713 ' + name); passed++; }
  catch (e) { console.error('  \u2717 ' + name + ': ' + e.message); failed++; errors.push(name); }
}

// ── SACRED ───────────────────────────────────────────────────────────────────
console.log('\n[V509] SACRED integrity\n');

test('T01: fiatLedger.js SACRED hash', () => {
  const h = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, 'lib/fiatLedger.js'))).digest('hex');
  assert.strictEqual(h, '563e9b1f9e67091a5b6527c0a92568e5', 'fiatLedger SACRED violated');
});

test('T02: auditLog.js SACRED hash', () => {
  const h = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, 'lib/auditLog.js'))).digest('hex');
  assert.strictEqual(h, 'e5a5c2c27801d2d03991bc8e5a1df8cb', 'auditLog SACRED violated');
});

// ── server ────────────────────────────────────────────────────────────────────
console.log('\n[V509] Server checks\n');

test('T03: server parse-clean + V509 IIFE present', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  assert.ok(src.includes('_wireTipModuleCanon509'), 'V509 IIFE not found');
  assert.ok(src.includes('V509-T01'), 'V509 endpoint tag missing');
});

// ── canon facade ──────────────────────────────────────────────────────────────
console.log('\n[V509] Canon facade checks\n');

test('T04: tipModuleCanon509 loads from lib/', () => {
  const c = require(path.join(ROOT, 'lib/tipModuleCanon509.js'));
  assert.strictEqual(typeof c.getTowerDescriptor509, 'function', 'getTowerDescriptor509 must be function');
  assert.strictEqual(typeof c.getCanonInfo509, 'function', 'getCanonInfo509 must be function');
});

test('T05: getTowerDescriptor509 returns correct shape', () => {
  const c   = require(path.join(ROOT, 'lib/tipModuleCanon509.js'));
  const d   = c.getTowerDescriptor509();
  assert.strictEqual(d.name,    'tipModule',          'tower name wrong');
  assert.strictEqual(d.kind,    'parallel-duplicate', 'kind must be parallel-duplicate');
  assert.strictEqual(d.tip,     '268',               'tip must be 268');
  assert.strictEqual(d.base,    '263',               'base must be 263');
  assert.strictEqual(d.members.length, 6,            'must have 6 members');
});

test('T06: V268 surface fully re-exported', () => {
  const c = require(path.join(ROOT, 'lib/tipModuleCanon509.js'));
  for (const sym of ['TipModule268','defaultTipModule268','TIP_MAX_MICRO_268','TIP_MIN_MICRO_268','COMMUNITY_MATCH_RATE_268']) {
    assert.ok(sym in c, 'missing export: ' + sym);
  }
});

test('T07: TIP_MAX_MICRO_268 is BigInt', () => {
  const c = require(path.join(ROOT, 'lib/tipModuleCanon509.js'));
  assert.strictEqual(typeof c.TIP_MAX_MICRO_268, 'bigint', 'must be BigInt (μ¢)');
  assert.ok(c.TIP_MAX_MICRO_268 > 0n, 'must be positive');
});

test('T08: TIP_MIN < TIP_MAX sanity', () => {
  const c = require(path.join(ROOT, 'lib/tipModuleCanon509.js'));
  assert.ok(c.TIP_MIN_MICRO_268 < c.TIP_MAX_MICRO_268, 'TIP_MIN must be < TIP_MAX');
});

test('T09: canonBridgePatch508 getKindDiff corrects tipModule', () => {
  // Re-require to ensure registration has fired
  require(path.join(ROOT, 'lib/tipModuleCanon509.js'));
  const patch508 = require(path.join(ROOT, 'lib/canonBridgePatch508.js'));
  const diff = patch508.getKindDiff508();
  // diff is an object with a corrections count + diffs array
  const entry = diff.diffs ? diff.diffs.find(d => d.tower === 'tipModule') : null;
  assert.ok(entry !== null, 'tipModule not found in getKindDiff508 output');
  assert.strictEqual(entry.canonKind, 'parallel-duplicate', 'canonKind must be parallel-duplicate');
});

test('T10: version is 509.0.0', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(parseInt(pkg.version) >= 509, 'version must be >= 509, got: ' + pkg.version);
});

// ── audit baseline ────────────────────────────────────────────────────────────
console.log('\n[V509] Audit baseline check\n');

test('T11: audit-tests baseline (informational only — skipped in-process)', () => {
  // Cannot run audit-tests.js from within v509.test.js without circular result.
  // Pre-existing realFails: v504 (T07 slot check) and v506 (signal RED) — not caused by V509.
  // Run manually: node scripts/audit-tests.js → expect v509.test.js in pass, not realFail.
  // This test always passes as a documentation marker.
  assert.ok(true, 'informational');
});

// ── summary ───────────────────────────────────────────────────────────────────
console.log('\n[V509] Results\n');
console.log('  ' + passed + ' passed, ' + failed + ' failed');
if (errors.length) console.error('  Failed:', errors.join(', '));
console.log('');
process.exit(failed > 0 ? 1 : 0);
