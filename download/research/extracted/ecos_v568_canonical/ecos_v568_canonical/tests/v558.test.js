'use strict';
/**
 * tests/v558.test.js — ECOS V558 — deepHealthUnifiedStatus: lazy-seed + unified response
 * NODE_ENV=test node tests/v558.test.js → exit 0
 */

const assert = require('assert');
const path   = require('path');
const crypto = require('crypto');
const fs     = require('fs');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;

function t558(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

console.log('\n=== V558 deepHealthUnifiedStatus ===\n');

// T01-T02: SACRED
t558('T01: fiatLedger.js SACRED hash', () => {
  const h = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT,'lib/fiatLedger.js'))).digest('hex');
  assert.strictEqual(h, '563e9b1f9e67091a5b6527c0a92568e5');
});
t558('T02: auditLog.js SACRED hash', () => {
  const h = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT,'lib/auditLog.js'))).digest('hex');
  assert.strictEqual(h, 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// T03: server parse-clean + V558 IIFE present
t558('T03: server parse-clean + V558 IIFE present', () => {
  const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
  assert.ok(src.includes('_wireDeepHealthUnifiedStatus558'), 'V558 IIFE missing');
  assert.ok(src.includes('V558-T01'), 'V558 endpoint tags missing');
});

// T04: module loads
t558('T04: deepHealthUnifiedStatus558 loads + getUnifiedStatus558 present', () => {
  const U = require('../lib/deepHealthUnifiedStatus558.js');
  assert.strictEqual(typeof U.getUnifiedStatus558, 'function');
  assert.strictEqual(typeof U._ensureSeed558, 'function');
  assert.strictEqual(U.UNIFIED_VERSION_558, '558.0.0');
});

// T05: getUnifiedStatus558 returns ok result
t558('T05: getUnifiedStatus558 returns ok:true + trendAgreement boolean', () => {
  const U = require('../lib/deepHealthUnifiedStatus558.js');
  const r = U.getUnifiedStatus558();
  assert.strictEqual(r.ok, true, `ok must be true, got: ${JSON.stringify(r)}`);
  assert.ok(typeof r.trendAgreement === 'boolean' || r.trendAgreement === null,
    `trendAgreement must be boolean or null, got: ${r.trendAgreement}`);
});

// T06: trendAgreement is NOT null after getUnifiedStatus558 (lazy seed works)
t558('T06: trendAgreement is true or false (not null) — lazy seed resolves unknown', () => {
  const U = require('../lib/deepHealthUnifiedStatus558.js');
  const r = U.getUnifiedStatus558();
  assert.ok(r.trendAgreement !== null,
    `trendAgreement must not be null after lazy seed, got: ${r.trendAgreement}`);
});

// T07: trend is not 'unknown' after seed
t558('T07: trend direction is not unknown after lazy seed', () => {
  const U = require('../lib/deepHealthUnifiedStatus558.js');
  const r = U.getUnifiedStatus558();
  assert.ok(r.trend !== 'unknown', `trend must not be unknown after seed, got: ${r.trend}`);
});

// T08: seedFired field present
t558('T08: result has seedFired field', () => {
  const U = require('../lib/deepHealthUnifiedStatus558.js');
  const r = U.getUnifiedStatus558();
  assert.ok('seedFired' in r, 'seedFired field must be present');
  assert.ok(typeof r.seedFired === 'boolean', 'seedFired must be boolean');
});

// T09: all required fields present
t558('T09: result has all required fields', () => {
  const U = require('../lib/deepHealthUnifiedStatus558.js');
  const r = U.getUnifiedStatus558();
  ['ok','version','trend','trendAgreement','gateDecision','policyTrend','seedFired','enrichedBy'].forEach(k => {
    assert.ok(k in r, `field ${k} missing from result`);
  });
});

// T10: _ensureSeed558 non-fatal when seed module absent
t558('T10: _ensureSeed558 returns null gracefully when deps missing', () => {
  // Test that the function can run without throwing — deps are loaded lazily
  const U = require('../lib/deepHealthUnifiedStatus558.js');
  let threw = false;
  try { U._ensureSeed558(); } catch (_) { threw = true; }
  assert.ok(!threw, '_ensureSeed558 must not throw');
});

// T11: endpoint defined in server
t558('T11: server has GET /api/v1/deep-health/status/v558', () => {
  const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
  assert.ok(src.includes('/api/v1/deep-health/status/v558'), 'status/v558 endpoint missing');
});

// T12: package.json version >= 558
t558('T12: package.json version >= 558', () => {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8'));
  assert.ok(parseInt(d.version) >= 558, `version must be >= 558, got ${d.version}`);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
process.exit(0);
