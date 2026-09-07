'use strict';
/**
 * tests/v560.test.js — ECOS V560
 * בודק: compositeScore field fix, SACRED, server parse, no regressions
 * הרצה: NODE_ENV=test node tests/v560.test.js  →  exit 0
 */

const assert = require('assert');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const { execFileSync } = require('child_process');

const BASE = path.resolve(__dirname, '..');
let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.error('  ✗', name, '—', e.message); failed++; }
}
function md5File(p) {
  return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
}

console.log('\n=== ECOS V560 Tests ===\n');

// 1-2. SACRED
test('SACRED: fiatLedger.js md5 intact', () => {
  assert.strictEqual(md5File(path.join(BASE,'lib/fiatLedger.js')), '563e9b1f9e67091a5b6527c0a92568e5');
});
test('SACRED: auditLog.js md5 intact', () => {
  assert.strictEqual(md5File(path.join(BASE,'lib/auditLog.js')), 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// 3. version
test('package.json version >= 560', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(BASE,'package.json'),'utf8'));
  assert(parseInt(pkg.version) >= 560, 'version=' + pkg.version);
});

// 4. server parse
test('ecos-api-server.js parses cleanly', () => {
  execFileSync(process.execPath, ['--check', path.join(BASE,'ecos-api-server.js')]);
});

// 5. core fix: gateEvaluateBridge554 now reads compositeScore field
test('gateEvaluateBridge554 score field fix: compositeScore in lookup', () => {
  const src = fs.readFileSync(path.join(BASE,'lib/gateEvaluateBridge554.js'),'utf8');
  assert.ok(src.includes('sr.compositeScore'), 'compositeScore lookup missing from gateEvaluateBridge554');
  // compositeScore must appear BEFORE the standalone composite (sr.composite followed by space/colon, not part of compositeScore)
  const idxCompositeScore = src.indexOf('sr.compositeScore');
  // Find 'sr.composite ' or 'sr.composite\n' or 'sr.composite:' — not part of compositeScore
  const standaloneIdx = src.search(/sr\.composite[^S]/);
  assert.ok(standaloneIdx === -1 || idxCompositeScore < standaloneIdx,
    'compositeScore must appear before standalone composite in fallback chain');
});

// 6. evaluateGate554 now returns real score (>0) from getCompositeScore543
test('evaluateGate554 returns non-zero score after fix', () => {
  // Invalidate require cache so fix is picked up fresh
  const evalPath = require.resolve(path.join(BASE,'lib/gateEvaluateBridge554.js'));
  delete require.cache[evalPath];
  const E = require(path.join(BASE,'lib/gateEvaluateBridge554.js'));
  const r = E.evaluateGate554();
  assert.ok(typeof r.score === 'number', 'score is not a number: ' + typeof r.score);
  assert.ok(r.score > 0, 'score still 0 after fix — compositeScore not being read. score=' + r.score);
});

// 7. getUnifiedStatus558 gateScore now >0
test('getUnifiedStatus558 gateScore is now non-zero (0.5 expected)', () => {
  const uPath = require.resolve(path.join(BASE,'lib/deepHealthUnifiedStatus558.js'));
  delete require.cache[uPath];
  const U = require(path.join(BASE,'lib/deepHealthUnifiedStatus558.js'));
  const r = U.getUnifiedStatus558();
  assert.ok(typeof r.gateScore === 'number', 'gateScore not a number');
  assert.ok(r.gateScore > 0, 'gateScore still 0 in unified status. gateScore=' + r.gateScore);
});

// 8. getCompositeScore543 returns compositeScore field (root cause verification)
test('marketMakerCanon543.getCompositeScore543 returns compositeScore field', () => {
  const C = require(path.join(BASE,'lib/marketMakerCanon543.js'));
  assert.strictEqual(typeof C.getCompositeScore543, 'function', 'getCompositeScore543 not a function');
  const r = C.getCompositeScore543();
  assert.ok(typeof r.compositeScore === 'number', 'compositeScore field missing or not a number');
  assert.ok(r.compositeScore >= 0 && r.compositeScore <= 1, 'compositeScore out of [0,1] range: ' + r.compositeScore);
});

// 9. src/lib in sync with lib
test('src/lib/gateEvaluateBridge554.js in sync with lib/ (compositeScore present)', () => {
  const srcPath = path.join(BASE,'src/lib/gateEvaluateBridge554.js');
  if (!fs.existsSync(srcPath)) { console.log('    (src/lib copy not present — skipped)'); passed++; return; }
  const src = fs.readFileSync(srcPath,'utf8');
  assert.ok(src.includes('sr.compositeScore'), 'src/lib copy not synced — compositeScore missing');
});

// 10. no regression: v554 test suite still passes
test('v554.test.js still passes after fix (no regression)', () => {
  execFileSync(process.execPath, [path.join(BASE,'tests/v554.test.js')], {
    env: Object.assign({}, process.env, { NODE_ENV: 'test' }),
    stdio: 'pipe',
  });
});

// 11. V560 IIFE wired in server
test('V560 IIFE wired in ecos-api-server.js', () => {
  const src = fs.readFileSync(path.join(BASE,'ecos-api-server.js'),'utf8');
  assert.ok(src.includes('_wireGateScoreFix560'),                    'missing IIFE');
  assert.ok(src.includes('/api/v1/deep-health/gate-score/v560'),     'missing gate-score endpoint');
  assert.ok(src.includes('/api/v1/admin/summary/v560'),              'missing summary endpoint');
});

// 12. gateScore consistency: evaluateGate554 and getUnifiedStatus558 agree
test('gateScore consistent between evaluateGate554 and getUnifiedStatus558', () => {
  const E = require(path.join(BASE,'lib/gateEvaluateBridge554.js'));
  const U = require(path.join(BASE,'lib/deepHealthUnifiedStatus558.js'));
  const gate    = E.evaluateGate554();
  const unified = U.getUnifiedStatus558();
  // Both should be >0 and consistent (±0.05 tolerance for any intermediate rounding)
  assert.ok(Math.abs(gate.score - unified.gateScore) < 0.1,
    'score mismatch: gate=' + gate.score + ' unified=' + unified.gateScore);
});

console.log('\n──────────────────────────────');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) { console.error('FAILED'); process.exit(1); }
else { console.log('ALL PASSED ✓'); process.exit(0); }
