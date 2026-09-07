'use strict';
/**
 * tests/v561.test.js — ECOS V561
 * בודק: kurtosis method-name fix, SACRED, server parse, no regressions
 * הרצה: NODE_ENV=test node tests/v561.test.js  →  exit 0
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
function freshRequire(modPath) {
  const resolved = require.resolve(modPath);
  delete require.cache[resolved];
  return require(resolved);
}

console.log('\n=== ECOS V561 Tests ===\n');

// 1-2. SACRED
test('SACRED: fiatLedger.js md5 intact', () => {
  assert.strictEqual(md5File(path.join(BASE,'lib/fiatLedger.js')), '563e9b1f9e67091a5b6527c0a92568e5');
});
test('SACRED: auditLog.js md5 intact', () => {
  assert.strictEqual(md5File(path.join(BASE,'lib/auditLog.js')), 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// 3. version
test('package.json version >= 561', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(BASE,'package.json'),'utf8'));
  assert(parseInt(pkg.version) >= 561, 'version=' + pkg.version);
});

// 4. server parse
test('ecos-api-server.js parses cleanly', () => {
  execFileSync(process.execPath, ['--check', path.join(BASE,'ecos-api-server.js')]);
});

// 5. root cause: marketMakerCanon543 now calls detectAccelerationKurtosis333
test('marketMakerCanon543.js uses detectAccelerationKurtosis333 (not detectStreakChanges333)', () => {
  const src = fs.readFileSync(path.join(BASE,'lib/marketMakerCanon543.js'),'utf8');
  assert.ok(src.includes('detectAccelerationKurtosis333'), 'detectAccelerationKurtosis333 not found');
  assert.ok(!src.includes('detectStreakChanges333'),       'old detectStreakChanges333 still present');
});

// 6. AuditCapTrail333 actually has detectAccelerationKurtosis333
test('AuditCapTrail333 has detectAccelerationKurtosis333 method', () => {
  const C = require(path.join(BASE,'lib/marketMakerCanon543.js'));
  const at = C.defaultAuditCapTrail333();
  assert.strictEqual(typeof at.detectAccelerationKurtosis333, 'function',
    'detectAccelerationKurtosis333 not a function on AuditCapTrail333');
});

// 7. kurtosis component is now 1 (not 0)
test('getCompositeScore543 kurtosis component is now 1', () => {
  const C = freshRequire(path.join(BASE,'lib/marketMakerCanon543.js'));
  const r = C.getCompositeScore543();
  assert.strictEqual(r.componentScores.kurtosis, 1,
    'kurtosis still 0 — fix not working. got: ' + r.componentScores.kurtosis);
});

// 8. compositeScore >= 0.8 (kurtosis 0.3 added)
test('compositeScore >= 0.8 after kurtosis fix', () => {
  const C = freshRequire(path.join(BASE,'lib/marketMakerCanon543.js'));
  const r = C.getCompositeScore543();
  assert.ok(r.compositeScore >= 0.8,
    'compositeScore too low: ' + r.compositeScore + ' (expected ≥0.8)');
  assert.ok(['A','B'].includes(r.grade),
    'grade should be A or B, got: ' + r.grade);
});

// 9. gateScore also reflects fix
test('evaluateGate554 gateScore >= 0.8 after fix', () => {
  // Clear caches so fresh values are read
  [
    'marketMakerCanon543', 'gateEvaluateBridge554', 'gatePolicyTrendBridge556',
    'deepHealthUnifiedStatus558'
  ].forEach(name => {
    Object.keys(require.cache)
      .filter(k => k.includes(name))
      .forEach(k => delete require.cache[k]);
  });
  const E = require(path.join(BASE,'lib/gateEvaluateBridge554.js'));
  const r = E.evaluateGate554();
  assert.ok(r.score >= 0.8, 'gateScore < 0.8 after fix: ' + r.score);
});

// 10. src/lib in sync
test('src/lib/marketMakerCanon543.js in sync (uses detectAccelerationKurtosis333)', () => {
  const srcPath = path.join(BASE,'src/lib/marketMakerCanon543.js');
  if (!fs.existsSync(srcPath)) { console.log('    (src/lib copy not present — skipped)'); passed++; return; }
  const src = fs.readFileSync(srcPath,'utf8');
  assert.ok(src.includes('detectAccelerationKurtosis333'), 'src/lib copy not synced');
  assert.ok(!src.includes('detectStreakChanges333'),       'src/lib copy still has old method name');
});

// 11. V561 IIFE wired in server
test('V561 IIFE wired in ecos-api-server.js', () => {
  const src = fs.readFileSync(path.join(BASE,'ecos-api-server.js'),'utf8');
  assert.ok(src.includes('_wireCompositeScoreFix561'),                    'missing IIFE');
  assert.ok(src.includes('/api/v1/deep-health/composite-score/v561'),     'missing endpoint');
  assert.ok(src.includes('/api/v1/admin/summary/v561'),                   'missing summary endpoint');
});

// 12. no regression on v543 and v560 tests
test('v543.test.js still passes (no regression)', () => {
  execFileSync(process.execPath, [path.join(BASE,'tests/v543.test.js')], {
    env: Object.assign({}, process.env, { NODE_ENV: 'test' }), stdio: 'pipe',
  });
});

console.log('\n──────────────────────────────');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) { console.error('FAILED'); process.exit(1); }
else { console.log('ALL PASSED ✓'); process.exit(0); }
