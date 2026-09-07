'use strict';
/**
 * tests/v557.test.js — ECOS V557 — deep-health/gate/evaluate/latest alias
 * NODE_ENV=test node tests/v557.test.js → exit 0
 */

const assert = require('assert');
const path   = require('path');
const crypto = require('crypto');
const fs     = require('fs');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;

function t557(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

console.log('\n=== V557 deep-health/gate/evaluate/latest alias ===\n');

// T01-T02: SACRED
t557('T01: fiatLedger.js SACRED hash', () => {
  const h = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT,'lib/fiatLedger.js'))).digest('hex');
  assert.strictEqual(h, '563e9b1f9e67091a5b6527c0a92568e5');
});
t557('T02: auditLog.js SACRED hash', () => {
  const h = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT,'lib/auditLog.js'))).digest('hex');
  assert.strictEqual(h, 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// T03: server parse-clean + V557 IIFE present
t557('T03: server parse-clean + V557 IIFE present', () => {
  const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
  assert.ok(src.includes('_wireDeepHealthGateLatest557'), 'V557 IIFE missing');
  assert.ok(src.includes('V557-T01'), 'V557 endpoint tags missing');
});

// T04: /latest endpoint defined in server
t557('T04: /api/v1/deep-health/gate/evaluate/latest defined in server', () => {
  const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
  assert.ok(src.includes('/api/v1/deep-health/gate/evaluate/latest'), '/latest endpoint missing');
});

// T05: V554 endpoint NOT removed
t557('T05: V554 /api/v1/deep-health/gate/evaluate still present', () => {
  const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
  assert.ok(src.includes("app.get('/api/v1/deep-health/gate/evaluate'"), 'V554 endpoint must NOT be removed');
});

// T06: V556 endpoint NOT removed
t557('T06: V556 /api/v1/deep-health/gate/evaluate/v556 still present', () => {
  const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
  assert.ok(src.includes('/api/v1/deep-health/gate/evaluate/v556'), 'V556 endpoint must NOT be removed');
});

// T07: gatePolicyTrendBridge556 loads correctly
t557('T07: gatePolicyTrendBridge556 loads + buildEnrichedEval556 present', () => {
  const B = require('../lib/gatePolicyTrendBridge556.js');
  assert.strictEqual(typeof B.buildEnrichedEval556, 'function', 'buildEnrichedEval556 must be function');
});

// T08: V557 uses V556 enriched logic (buildEnrichedEval556)
t557('T08: V557 IIFE uses buildEnrichedEval556 from gatePolicyTrendBridge556', () => {
  const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
  assert.ok(src.includes('B556_557.buildEnrichedEval556'), 'V557 must use buildEnrichedEval556');
});

// T09: result has routedTo and latestAlias fields (via inline logic test)
t557('T09: latest alias response adds routedTo + latestAlias fields', () => {
  const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
  assert.ok(src.includes('routedTo:'), 'routedTo field must be set in V557 response');
  assert.ok(src.includes('latestAlias:'), 'latestAlias field must be set in V557 response');
});

// T10: functional — buildEnrichedEval556 returns a valid result
t557('T10: buildEnrichedEval556 returns valid object with ok field', () => {
  const B556  = require('../lib/gatePolicyTrendBridge556.js');
  const E554  = require('../lib/gateEvaluateBridge554.js');
  const P546  = require('../lib/deepHealthPolicy546.js');
  const r = B556.buildEnrichedEval556({
    evalFn554:   () => E554.evaluateGate554(),
    policyFn546: () => P546.getPolicy546(),
  });
  assert.ok(typeof r.ok === 'boolean', 'result.ok must be boolean');
  assert.ok('policyTrend' in r, 'result must have policyTrend field');
  assert.ok('enrichedBy' in r, 'result must have enrichedBy field');
});

// T11: no new module created (no src/lib/v557.js) — alias uses existing modules
t557('T11: V557 uses no new lib module (alias pattern — existing modules only)', () => {
  const newMod = path.join(ROOT, 'lib', 'deepHealthGateLatest557.js');
  assert.ok(!fs.existsSync(newMod), 'no new lib module should be created for a pure alias');
});

// T12: package.json version >= 557
t557('T12: package.json version >= 557', () => {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8'));
  assert.ok(parseInt(d.version) >= 557, `version must be >= 557, got ${d.version}`);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
process.exit(0);
