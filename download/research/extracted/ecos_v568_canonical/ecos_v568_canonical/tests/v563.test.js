'use strict';
/**
 * tests/v563.test.js — ECOS V563
 * בודק: marketMakerCompositeEnhanced563, autocorr חיבור ל-V562 buffer, SACRED, parse
 * הרצה: NODE_ENV=test node tests/v563.test.js  →  exit 0
 */

const assert = require('assert');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const { execFileSync } = require('child_process');

const BASE = path.resolve(__dirname, '..');
let passed = 0; let failed = 0;

function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.error('  ✗', name, '—', e.message); failed++; }
}
function md5File(fp) { return crypto.createHash('md5').update(fs.readFileSync(fp)).digest('hex'); }

// helper — seed N ranked snapshots into TSB562
function seedSnapshots563(mod, n) {
  const tokens = ['BTC','ETH','SOL','XRP','BNB','ADA','DOT','AVAX'];
  for (let i = 0; i < n; i++) {
    // rotate token order slightly each time
    const shifted = tokens.slice(i % 4).concat(tokens.slice(0, i % 4));
    mod.pushTokenSnapshot562(shifted.slice(0, 5));
  }
}

console.log('\n=== ECOS V563 Tests ===\n');

// ── 1-2. SACRED ─────────────────────────────────────────────────────────────
test('SACRED: fiatLedger.js md5 intact', () => {
  assert.strictEqual(md5File(path.join(BASE,'lib/fiatLedger.js')),
    '563e9b1f9e67091a5b6527c0a92568e5');
});
test('SACRED: auditLog.js md5 intact', () => {
  assert.strictEqual(md5File(path.join(BASE,'lib/auditLog.js')),
    'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// ── 3. version ───────────────────────────────────────────────────────────────
test('package.json version >= 563', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(BASE,'package.json'),'utf8'));
  assert(parseInt(pkg.version) >= 563, 'got: ' + pkg.version);
});

// ── 4. server parse ──────────────────────────────────────────────────────────
test('ecos-api-server.js parses cleanly', () => {
  execFileSync(process.execPath, ['--check', path.join(BASE,'ecos-api-server.js')]);
});

// ── 5. module loads ──────────────────────────────────────────────────────────
test('marketMakerCompositeEnhanced563 module loads', () => {
  const mod = require(path.join(BASE,'lib/marketMakerCompositeEnhanced563.js'));
  assert.strictEqual(typeof mod.getCompositeScore563,   'function');
  assert.strictEqual(typeof mod.registerEndpoints563,   'function');
  assert.ok(mod.ENHANCED_VERSION_563.startsWith('563'));
  assert.ok(typeof mod.WEIGHTS_563 === 'object');
  // Weights must sum to 1.0
  const sum = Object.values(mod.WEIGHTS_563).reduce((a,b) => a+b, 0);
  assert(Math.abs(sum - 1.0) < 0.0001, 'weights must sum to 1.0, got: ' + sum);
});

// ── 6. empty buffer → compositeScore = 0.8 (same as V543 baseline) ───────────
test('getCompositeScore563: empty buffer → compositeScore=0.8, autocorrSource=V562-buffer-empty', () => {
  const mod  = require(path.join(BASE,'lib/marketMakerCompositeEnhanced563.js'));
  const TSB  = require(path.join(BASE,'lib/tokenSnapshotBuffer562.js'));
  TSB.clearTokenSnapshots562();
  const r = mod.getCompositeScore563();
  assert.strictEqual(r.componentScores.autocorr, 0,   'autocorr should be 0 with empty buffer');
  assert.strictEqual(r.compositeScore, 0.8,            'compositeScore should be 0.8 (= V543 baseline)');
  assert.ok(r.autocorrSource.includes('empty'),        'autocorrSource should mention empty');
  assert.strictEqual(r.v543baseline, 0.8,              'v543baseline should match');
  assert.strictEqual(r.improvement, 0,                 'improvement should be 0 with empty buffer');
});

// ── 7. seeded buffer (≥5) → compositeScore = 1.0, grade A+ ──────────────────
test('getCompositeScore563: 6 snapshots → compositeScore=1.0, grade=A+', () => {
  const mod  = require(path.join(BASE,'lib/marketMakerCompositeEnhanced563.js'));
  const TSB  = require(path.join(BASE,'lib/tokenSnapshotBuffer562.js'));
  TSB.clearTokenSnapshots562();
  seedSnapshots563(TSB, 6);
  const r = mod.getCompositeScore563();
  assert.strictEqual(r.componentScores.autocorr, 1,   'autocorr should be 1 with 6 snapshots');
  assert.strictEqual(r.compositeScore, 1.0,            'compositeScore should be 1.0');
  assert.strictEqual(r.grade, 'A+',                   'grade should be A+');
  assert.strictEqual(r.improvement, 0.2,              'improvement should be 0.2 (autocorr weight)');
  assert.ok(r.autocorrSource.includes('seeded'),       'autocorrSource should mention seeded');
  assert.ok(r.details.autocorr.ok,                    'details.autocorr.ok should be true');
  TSB.clearTokenSnapshots562();
});

// ── 8. V543 baseline preserved in output ─────────────────────────────────────
test('getCompositeScore563: v543baseline field matches getCompositeScore543', () => {
  const mod  = require(path.join(BASE,'lib/marketMakerCompositeEnhanced563.js'));
  const C543 = require(path.join(BASE,'lib/marketMakerCanon543.js'));
  const TSB  = require(path.join(BASE,'lib/tokenSnapshotBuffer562.js'));
  TSB.clearTokenSnapshots562();
  const r563 = mod.getCompositeScore563();
  const r543 = C543.getCompositeScore543();
  assert.strictEqual(r563.v543baseline, r543.compositeScore, 'v543baseline must equal V543 score');
});

// ── 9. weights are V543-compatible ───────────────────────────────────────────
test('WEIGHTS_563 matches V543 weights exactly', () => {
  const mod  = require(path.join(BASE,'lib/marketMakerCompositeEnhanced563.js'));
  assert.strictEqual(mod.WEIGHTS_563.kurtosis, 0.3);
  assert.strictEqual(mod.WEIGHTS_563.outlierZ, 0.3);
  assert.strictEqual(mod.WEIGHTS_563.autocorr, 0.2);
  assert.strictEqual(mod.WEIGHTS_563.entropy,  0.2);
});

// ── 10. details.autocorr has hint when buffer empty ──────────────────────────
test('details.autocorr.hint present when buffer empty', () => {
  const mod = require(path.join(BASE,'lib/marketMakerCompositeEnhanced563.js'));
  const TSB = require(path.join(BASE,'lib/tokenSnapshotBuffer562.js'));
  TSB.clearTokenSnapshots562();
  const r = mod.getCompositeScore563();
  assert.ok(typeof r.details.autocorr.hint === 'string', 'hint should be a string');
  assert.ok(r.details.autocorr.hint.includes('seed'), 'hint should mention seeding');
  assert.ok(typeof r.details.autocorr.bufferSize === 'number');
});

// ── 11. lib/ and src/lib/ copies identical ───────────────────────────────────
test('lib/ and src/lib/ copies of marketMakerCompositeEnhanced563 are identical', () => {
  const libPath = path.join(BASE,'lib/marketMakerCompositeEnhanced563.js');
  const srcPath = path.join(BASE,'src/lib/marketMakerCompositeEnhanced563.js');
  assert.ok(fs.existsSync(libPath), 'lib/ copy missing');
  assert.ok(fs.existsSync(srcPath), 'src/lib/ copy missing');
  assert.strictEqual(md5File(libPath), md5File(srcPath), 'copies differ');
});

// ── 12. v497 libCount guard ───────────────────────────────────────────────────
test('v497 libCount threshold still satisfied (<650)', () => {
  const libFiles = fs.readdirSync(path.join(BASE,'lib')).filter(f => f.endsWith('.js'));
  assert(libFiles.length < 650, 'libCount=' + libFiles.length + ' ≥ 650');
});

// ── Results ──────────────────────────────────────────────────────────────────
console.log('\n─────────────────────────');
console.log(`  Passed: ${passed} / ${passed + failed}`);
if (failed > 0) { console.error(`  Failed: ${failed}`); process.exit(1); }
else { console.log('  All tests passed ✓'); process.exit(0); }
