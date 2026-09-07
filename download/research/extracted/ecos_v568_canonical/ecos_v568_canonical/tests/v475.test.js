'use strict';
/**
 * tests/v475.test.js — ECOS V475
 * בודק: marketMakerCanon475, SACRED, server parse
 * הרצה: NODE_ENV=test node tests/v475.test.js  →  exit 0
 */

const assert = require('assert');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const BASE = path.resolve(__dirname, '..');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.error('  ✗', name, '—', e.message); failed++; }
}

function md5File(p) {
  return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
}

console.log('\n=== ECOS V475 Tests ===\n');

// 1. SACRED
test('SACRED: fiatLedger.js md5 intact', () => {
  assert.strictEqual(md5File(path.join(BASE,'lib/fiatLedger.js')), '563e9b1f9e67091a5b6527c0a92568e5');
});
test('SACRED: auditLog.js md5 intact', () => {
  assert.strictEqual(md5File(path.join(BASE,'lib/auditLog.js')), 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// 2. version
test('package.json version >= 475', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(BASE,'package.json'),'utf8'));
  assert(parseInt(pkg.version) >= 475, 'version=' + pkg.version);
});

// 3. server parse
test('ecos-api-server.js parses cleanly', () => {
  const { execFileSync } = require('child_process');
  execFileSync(process.execPath, ['--check', path.join(BASE,'ecos-api-server.js')]);
});

// 4. module loads
test('marketMakerCanon475 loads and exports expected symbols', () => {
  const m = require(path.join(BASE,'lib/marketMakerCanon475.js'));
  assert.strictEqual(typeof m.getCanonInfo475,      'function');
  assert.strictEqual(typeof m.getHealthSummary475,  'function');
  assert.strictEqual(typeof m.registerEndpoints475, 'function');
  assert.strictEqual(typeof m.defaultAuditTrail475, 'function');
  assert.strictEqual(m.CANON_VERSION_475,           '475.0.0');
  assert.strictEqual(m.CANON_COUNT_475,             36);
});

// 5. getCanonInfo475 content
test('getCanonInfo475 returns correct tower metadata', () => {
  const m = require(path.join(BASE,'lib/marketMakerCanon475.js'));
  const info = m.getCanonInfo475();
  assert.strictEqual(info.tower,         'marketMaker');
  assert.strictEqual(info.tipVersionNum, 333);
  assert.strictEqual(info.baseVersion,   298);
  assert.strictEqual(info.moduleCount,   36);
  assert.ok(info.importGuidance.includes('marketMakerCanon475'));
});

// 6. tip re-exports intact
test('canonical tip exports re-exported correctly (MM_VERSION_333)', () => {
  const m = require(path.join(BASE,'lib/marketMakerCanon475.js'));
  assert.strictEqual(m.MM_VERSION_333, '333.0.0');
  assert.strictEqual(typeof m.AuditCapTrail333,              'function');
  assert.strictEqual(typeof m.defaultAuditCapTrail333,       'function');
  assert.strictEqual(typeof m.PageRangeDiffBridge333,        'function');
  assert.strictEqual(typeof m.NormDeltaPercentilesTracker333,'function');
});

// 7. getHealthSummary475 returns ok shape
test('getHealthSummary475 returns valid summary shape', () => {
  const m = require(path.join(BASE,'lib/marketMakerCanon475.js'));
  const h = m.getHealthSummary475();
  assert.ok(h.canon,      'missing canon');
  assert.ok(h.instances,  'missing instances');
  assert.ok(typeof h.timestamp === 'number', 'missing timestamp');
  assert.strictEqual(h.canon.tower, 'marketMaker');
});

// 8. defaultAuditTrail475 returns instance
test('defaultAuditTrail475 returns an AuditCapTrail333 instance', () => {
  const m = require(path.join(BASE,'lib/marketMakerCanon475.js'));
  const trail = m.defaultAuditTrail475();
  assert.ok(trail !== null, 'should not be null');
  assert.ok(trail instanceof m.AuditCapTrail333, 'should be AuditCapTrail333 instance');
});

// 9. registerEndpoints475 gracefully handles no-app
test('registerEndpoints475 with null app does not throw', () => {
  const m = require(path.join(BASE,'lib/marketMakerCanon475.js'));
  assert.doesNotThrow(() => m.registerEndpoints475(null));
  assert.doesNotThrow(() => m.registerEndpoints475(undefined));
});

// 10. IIFE in server
test('V475 IIFE present in ecos-api-server.js', () => {
  const src = fs.readFileSync(path.join(BASE,'ecos-api-server.js'),'utf8');
  assert.ok(src.includes('_wireMarketMakerCanon475'),   'missing _wireMarketMakerCanon475 IIFE');
  assert.ok(src.includes('marketMakerCanon475'),        'missing marketMakerCanon475 require');
  assert.ok(src.includes('/api/v1/market-maker/canon/status'), 'missing status endpoint');
});

console.log('\n──────────────────────────────');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) { console.error('FAILED'); process.exit(1); }
else { console.log('ALL PASSED ✓'); process.exit(0); }
