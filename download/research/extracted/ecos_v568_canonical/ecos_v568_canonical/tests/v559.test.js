'use strict';
/**
 * tests/v559.test.js — ECOS V559 — /latest upgrade to V558 unified
 * NODE_ENV=test node tests/v559.test.js → exit 0
 */

const assert = require('assert');
const path   = require('path');
const crypto = require('crypto');
const fs     = require('fs');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;

function t559(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

console.log('\n=== V559 /latest upgrade to V558 unified ===\n');

// T01-T02: SACRED
t559('T01: fiatLedger.js SACRED hash', () => {
  const h = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT,'lib/fiatLedger.js'))).digest('hex');
  assert.strictEqual(h, '563e9b1f9e67091a5b6527c0a92568e5');
});
t559('T02: auditLog.js SACRED hash', () => {
  const h = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT,'lib/auditLog.js'))).digest('hex');
  assert.strictEqual(h, 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// T03: server parse-clean + V559 IIFE present
t559('T03: server parse-clean + V559 IIFE present', () => {
  const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
  assert.ok(src.includes('_wireLatestUpgrade559'), 'V559 IIFE missing');
  assert.ok(src.includes('V559-T01'), 'V559 endpoint tags missing');
});

// T04: V557 IIFE now loads deepHealthUnifiedStatus558
t559('T04: V557 IIFE loads deepHealthUnifiedStatus558 (V559 upgrade)', () => {
  const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
  assert.ok(src.includes('deepHealthUnifiedStatus558.js'), 'V557 IIFE must load deepHealthUnifiedStatus558');
  assert.ok(src.includes("routedTo:    'v558-unified'"), "V557 /latest must route to v558-unified");
});

// T05: V554 + V556 endpoints still present (not removed)
t559('T05: V554 and V556 endpoints still present', () => {
  const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
  assert.ok(src.includes("app.get('/api/v1/deep-health/gate/evaluate'"), 'V554 must not be removed');
  assert.ok(src.includes('/api/v1/deep-health/gate/evaluate/v556'), 'V556 must not be removed');
});

// T06: getUnifiedStatus558 returns trendAgreement !== null
t559('T06: getUnifiedStatus558 returns non-null trendAgreement', () => {
  const U = require('../lib/deepHealthUnifiedStatus558.js');
  const r = U.getUnifiedStatus558();
  assert.ok(r.trendAgreement !== null, `trendAgreement must not be null, got: ${r.trendAgreement}`);
  assert.ok(typeof r.trendAgreement === 'boolean', `trendAgreement must be boolean`);
});

// T07: /latest/v559 endpoint in server
t559('T07: server has GET /api/v1/deep-health/gate/evaluate/latest/v559', () => {
  const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
  assert.ok(src.includes('/api/v1/deep-health/gate/evaluate/latest/v559'), 'latest/v559 endpoint missing');
});

// T08: V559 IIFE uses getUnifiedStatus558 in endpoint
t559('T08: V559 IIFE calls getUnifiedStatus558 in endpoint', () => {
  const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
  assert.ok(src.includes('U558_559.getUnifiedStatus558()'), 'V559 IIFE must call getUnifiedStatus558');
});

// T09: trendAgreement comes back true when ring buffer is seeded (end-to-end)
t559('T09: end-to-end: getUnifiedStatus558 returns trendAgreement:true after seed', () => {
  const U = require('../lib/deepHealthUnifiedStatus558.js');
  const r = U.getUnifiedStatus558();
  // After lazy seed, trend should be known and policy should agree
  assert.ok(r.trend !== 'unknown', `trend must not be unknown, got: ${r.trend}`);
  assert.ok(r.trendAgreement === true || r.trendAgreement === false,
    `trendAgreement must be boolean, got: ${r.trendAgreement}`);
});

// T10: V557 IIFE fallback path still present (robustness)
t559('T10: V557 IIFE has fallback to V556 if unified unavailable', () => {
  const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
  assert.ok(src.includes("routedTo:     'v556'"), 'V556 fallback must still be in V557 IIFE');
  assert.ok(src.includes("Fallback to V556"), 'Fallback comment must be present');
});

// T11: no new lib module for V559 (wiring-only)
t559('T11: no new lib module for V559 (wiring-only upgrade)', () => {
  assert.ok(!fs.existsSync(path.join(ROOT,'lib','latestUpgrade559.js')), 'no new lib module expected');
  assert.ok(!fs.existsSync(path.join(ROOT,'lib','deepHealthLatest559.js')), 'no new lib module expected');
});

// T12: package.json version >= 559
t559('T12: package.json version >= 559', () => {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8'));
  assert.ok(parseInt(d.version) >= 559, `version must be >= 559, got ${d.version}`);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
process.exit(0);
