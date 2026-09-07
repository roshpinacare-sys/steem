'use strict';
/**
 * tests/v562.test.js — ECOS V562
 * בודק: tokenSnapshotBuffer562, autocorr fix, SACRED, server parse
 * הרצה: NODE_ENV=test node tests/v562.test.js  →  exit 0
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

console.log('\n=== ECOS V562 Tests ===\n');

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
test('package.json version >= 562', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(BASE,'package.json'),'utf8'));
  assert(parseInt(pkg.version) >= 562, 'got: ' + pkg.version);
});

// ── 4. server parse ──────────────────────────────────────────────────────────
test('ecos-api-server.js parses cleanly', () => {
  execFileSync(process.execPath, ['--check', path.join(BASE,'ecos-api-server.js')]);
});

// ── 5. module loads ──────────────────────────────────────────────────────────
test('tokenSnapshotBuffer562 module loads with all exports', () => {
  const mod = require(path.join(BASE,'lib/tokenSnapshotBuffer562.js'));
  assert.strictEqual(typeof mod.pushTokenSnapshot562,         'function');
  assert.strictEqual(typeof mod.getTokenSnapshots562,         'function');
  assert.strictEqual(typeof mod.clearTokenSnapshots562,       'function');
  assert.strictEqual(typeof mod.getAutoCorrelationScore562,   'function');
  assert.strictEqual(typeof mod.registerEndpoints562,         'function');
  assert.ok(mod.TOKEN_SNAPSHOT_VERSION_562.startsWith('562'));
  assert.strictEqual(mod.MAX_SNAPSHOTS_562, 20);
  assert.strictEqual(mod.MIN_SNAPSHOTS_562, 5);
});

// ── 6. pushTokenSnapshot562 basic ────────────────────────────────────────────
test('pushTokenSnapshot562: valid list → ok:true, size increases', () => {
  const mod = require(path.join(BASE,'lib/tokenSnapshotBuffer562.js'));
  mod.clearTokenSnapshots562();
  const r = mod.pushTokenSnapshot562(['BTC','ETH','SOL']);
  assert.ok(r.ok, 'push should return ok:true');
  assert.strictEqual(r.bufferSize, 1);
  mod.clearTokenSnapshots562();
});

// ── 7. pushTokenSnapshot562 rejects empty ────────────────────────────────────
test('pushTokenSnapshot562: empty list → ok:false', () => {
  const mod = require(path.join(BASE,'lib/tokenSnapshotBuffer562.js'));
  const r = mod.pushTokenSnapshot562([]);
  assert.ok(!r.ok);
  assert.ok(typeof r.error === 'string');
});

// ── 8. ring buffer caps at MAX_SNAPSHOTS_562 ─────────────────────────────────
test('ring buffer caps at 20 snapshots', () => {
  const mod = require(path.join(BASE,'lib/tokenSnapshotBuffer562.js'));
  mod.clearTokenSnapshots562();
  for (let i = 0; i < 25; i++) mod.pushTokenSnapshot562(['TOK' + i, 'TOK' + (i+1)]);
  assert.strictEqual(mod.getTokenSnapshots562().length, 20, 'should cap at 20');
  mod.clearTokenSnapshots562();
});

// ── 9. getAutoCorrelationScore562 with real data → ok:true ──────────────────
test('getAutoCorrelationScore562: ≥5 snapshots → ok:true, score:1', () => {
  const mod = require(path.join(BASE,'lib/tokenSnapshotBuffer562.js'));
  const { defaultRankedOverlapBuffer333 } = require(path.join(BASE,'lib/marketMakerCanon543.js'));
  mod.clearTokenSnapshots562();
  // Push 6 ranked token snapshots
  [['BTC','ETH','SOL'],['ETH','BTC','SOL'],['SOL','ETH','BTC'],
   ['BTC','SOL','ETH'],['ETH','SOL','BTC'],['SOL','BTC','ETH']].forEach(t => mod.pushTokenSnapshot562(t));
  const rb = defaultRankedOverlapBuffer333();
  const r = mod.getAutoCorrelationScore562(rb);
  assert.ok(r.ok, 'should be ok:true with 6 snapshots; error: ' + r.error);
  assert.strictEqual(r.score, 1, 'score should be 1 when ok:true');
  assert.strictEqual(r.bufferSize, 6);
  mod.clearTokenSnapshots562();
});

// ── 10. getAutoCorrelationScore562 too few → ok:false ───────────────────────
test('getAutoCorrelationScore562: <5 snapshots → ok:false', () => {
  const mod = require(path.join(BASE,'lib/tokenSnapshotBuffer562.js'));
  const { defaultRankedOverlapBuffer333 } = require(path.join(BASE,'lib/marketMakerCanon543.js'));
  mod.clearTokenSnapshots562();
  mod.pushTokenSnapshot562(['BTC','ETH']);
  mod.pushTokenSnapshot562(['ETH','SOL']);
  const rb = defaultRankedOverlapBuffer333();
  const r = mod.getAutoCorrelationScore562(rb);
  assert.ok(!r.ok, 'should be ok:false with only 2 snapshots');
  assert.strictEqual(r.score, 0);
  mod.clearTokenSnapshots562();
});

// ── 11. lib/ and src/lib/ copies identical ───────────────────────────────────
test('lib/ and src/lib/ copies of tokenSnapshotBuffer562 are identical', () => {
  const libPath = path.join(BASE,'lib/tokenSnapshotBuffer562.js');
  const srcPath = path.join(BASE,'src/lib/tokenSnapshotBuffer562.js');
  assert.ok(fs.existsSync(libPath), 'lib/ copy missing');
  assert.ok(fs.existsSync(srcPath), 'src/lib/ copy missing');
  assert.strictEqual(md5File(libPath), md5File(srcPath), 'copies differ');
});

// ── 12. v497 libCount guard still ok ─────────────────────────────────────────
test('v497 libCount threshold still satisfied', () => {
  const libFiles = fs.readdirSync(path.join(BASE,'lib')).filter(f => f.endsWith('.js'));
  assert(libFiles.length < 650, 'libCount=' + libFiles.length + ' ≥ 650 — update v497 threshold');
});

// ── Results ──────────────────────────────────────────────────────────────────
console.log('\n─────────────────────────');
console.log(`  Passed: ${passed} / ${passed + failed}`);
if (failed > 0) { console.error(`  Failed: ${failed}`); process.exit(1); }
else { console.log('  All tests passed ✓'); process.exit(0); }
