'use strict';
/**
 * tests/v564.test.js — ECOS V564
 * Live Gate Evaluation: getCompositeScore563 → gate decision
 */

const assert   = require('assert');
const path     = require('path');
const crypto   = require('crypto');
const fs       = require('fs');
const { execSync } = require('child_process');

const root       = path.resolve(__dirname, '..');
const serverPath = path.join(root, 'ecos-api-server.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

console.log('\n─── V564 Live Gate Evaluation Tests ───');

const GLE = require('../lib/gateLiveEvaluate564.js');

// [1] module loads
test('module loads with expected exports', () => {
  assert.strictEqual(typeof GLE.evaluateLiveGate564,  'function');
  assert.strictEqual(typeof GLE.evaluateGateDiff564,  'function');
  assert.strictEqual(typeof GLE.registerEndpoints564, 'function');
  assert.strictEqual(typeof GLE.GATE_LIVE_VERSION_564,'string');
});

// [2] version
test('GATE_LIVE_VERSION_564 === 564.0.0', () => {
  assert.strictEqual(GLE.GATE_LIVE_VERSION_564, '564.0.0');
});

// [3] evaluateLiveGate564 returns correct shape
test('evaluateLiveGate564 returns {ok, decision, score, grade, trend, reasoning, scoreSource, version}', () => {
  const r = GLE.evaluateLiveGate564();
  assert.ok('ok'          in r, 'has ok');
  assert.ok('decision'    in r, 'has decision');
  assert.ok('score'       in r, 'has score');
  assert.ok('grade'       in r, 'has grade');
  assert.ok('trend'       in r, 'has trend');
  assert.ok('reasoning'   in r, 'has reasoning');
  assert.ok('scoreSource' in r, 'has scoreSource');
  assert.ok('version'     in r, 'has version');
});

// [4] version field
test('evaluateLiveGate564 version field is 564.0.0', () => {
  const r = GLE.evaluateLiveGate564();
  assert.strictEqual(r.version, '564.0.0');
});

// [5] score source is V563
test('scoreSource references V563-enhanced', () => {
  const r = GLE.evaluateLiveGate564();
  assert.ok(r.scoreSource.includes('563'), `scoreSource should mention V563, got: ${r.scoreSource}`);
});

// [6] score is a number in [0,1]
test('score is a number in [0, 1]', () => {
  const r = GLE.evaluateLiveGate564();
  assert.strictEqual(typeof r.score, 'number', 'score should be number');
  assert.ok(r.score >= 0 && r.score <= 1, `score out of range: ${r.score}`);
});

// [7] decision is valid enum
test('decision is valid enum (AUTO/SUPERVISED/MANUAL)', () => {
  const r = GLE.evaluateLiveGate564();
  assert.ok(['AUTO','SUPERVISED','MANUAL'].includes(r.decision), `invalid decision: ${r.decision}`);
});

// [8] evaluateGateDiff564 returns correct shape
test('evaluateGateDiff564 returns {baseline, live, scoreDelta, decisionChanged, summary, version}', () => {
  const d = GLE.evaluateGateDiff564();
  assert.ok('baseline'        in d, 'has baseline');
  assert.ok('live'            in d, 'has live');
  assert.ok('scoreDelta'      in d, 'has scoreDelta');
  assert.ok('decisionChanged' in d, 'has decisionChanged');
  assert.ok('summary'         in d, 'has summary');
  assert.strictEqual(d.version, '564.0.0');
});

// [9] diff live.decision matches evaluateLiveGate564
test('diff.live.decision matches direct evaluateLiveGate564().decision', () => {
  const direct = GLE.evaluateLiveGate564();
  const diff   = GLE.evaluateGateDiff564();
  assert.strictEqual(diff.live.decision, direct.decision);
});

// [10] fail-closed: registerEndpoints564 returns false without valid app
test('registerEndpoints564 returns false for null/missing app', () => {
  assert.strictEqual(GLE.registerEndpoints564(null),      false);
  assert.strictEqual(GLE.registerEndpoints564(undefined), false);
  assert.strictEqual(GLE.registerEndpoints564({}),        false); // no .get
});

// [11] libCount still < 645
test('lib file count still < 645 (v497 constraint)', () => {
  const libDir   = path.join(root, 'lib');
  const libCount = fs.readdirSync(libDir).filter(f => f.endsWith('.js')).length;
  assert.ok(libCount < 645, `libCount=${libCount} must be < 645`);
});

// [12] SACRED intact
test('SACRED files intact (fiatLedger + auditLog)', () => {
  const check = (file, expected) => {
    const hash = crypto.createHash('md5')
      .update(fs.readFileSync(path.join(root, file)))
      .digest('hex');
    assert.strictEqual(hash, expected, `SACRED hash mismatch: ${file}`);
  };
  check('lib/fiatLedger.js', '563e9b1f9e67091a5b6527c0a92568e5');
  check('lib/auditLog.js',   'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// [13] server parse clean
test('ecos-api-server.js parses without errors', () => {
  execSync(`node --check ${serverPath}`, { stdio: 'pipe' });
});

// ─── Summary ───
console.log('\n─────────────────────────');
console.log(`  Passed: ${passed} / ${passed + failed}`);
if (failed > 0) {
  console.error(`  FAILED: ${failed}`);
  process.exit(1);
} else {
  console.log('  All tests passed ✓');
  process.exit(0);
}
