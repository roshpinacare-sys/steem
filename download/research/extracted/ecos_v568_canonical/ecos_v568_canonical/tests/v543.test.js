'use strict';
/**
 * tests/v543.test.js — ECOS V543 — marketMaker Canon Enhanced Health Facade
 * Run: NODE_ENV=test node tests/v543.test.js → exit 0
 */
const assert = require('assert');
const path   = require('path');
const crypto = require('crypto');
const fs     = require('fs');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); console.log('  ✅ ' + name); passed++; }
  catch (e) { console.error('  ❌ ' + name + ': ' + e.message); failed++; }
}
console.log('\n=== V543 marketMaker Canon Enhanced Health Tests ===\n');

t('T01 SACRED fiatLedger md5', () => {
  const h = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT,'lib/fiatLedger.js'))).digest('hex');
  assert.strictEqual(h, '563e9b1f9e67091a5b6527c0a92568e5');
});
t('T02 SACRED auditLog md5', () => {
  const h = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT,'lib/auditLog.js'))).digest('hex');
  assert.strictEqual(h, 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});
t('T03 ecos-api-server.js parse clean + V543 IIFE', () => {
  const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
  assert.ok(src.includes('_wireMarketMakerCanon543'), 'V543 IIFE function name missing');
  assert.ok(src.includes('V543-T01'), 'V543 endpoint tag missing');
  assert.ok(src.includes('marketMakerCanon543.js'), 'marketMakerCanon543 require missing');
});
t('T04 package.json version >= 543', () => {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8'));
  assert.ok(parseInt(d.version) >= 543, 'version must be >= 543, got ' + d.version);
});
t('T05 marketMakerCanon543 loads', () => {
  const m = require(path.join(ROOT,'lib/marketMakerCanon543.js'));
  assert.ok(m.CANON_VERSION_543, 'CANON_VERSION_543 missing');
  assert.strictEqual(m.CANON_COUNT_543, 36, 'CANON_COUNT should be 36');
  assert.strictEqual(m.CANON_TIP_VERSION_543, 333, 'tip should be 333');
  assert.strictEqual(m.CANON_BASE_VERSION_543, 298, 'base should be 298');
});
t('T06 getCanonInfo543 shape', () => {
  const m = require(path.join(ROOT,'lib/marketMakerCanon543.js'));
  const info = m.getCanonInfo543();
  assert.strictEqual(info.tower, 'marketMaker');
  assert.strictEqual(info.canonModule, 'marketMakerCanon543');
  assert.strictEqual(info.moduleCount, 36);
  assert.strictEqual(info.prevCanon, 'marketMakerCanon475');
  assert.ok(info.importGuidance.includes('marketMakerCanon543'));
});
t('T07 getCompositeScore543 shape and range', () => {
  const m = require(path.join(ROOT,'lib/marketMakerCanon543.js'));
  const r = m.getCompositeScore543();
  assert.ok(typeof r.compositeScore === 'number', 'compositeScore must be number');
  assert.ok(r.compositeScore >= 0 && r.compositeScore <= 1, 'compositeScore must be in [0,1]');
  assert.ok(['A','B','C','D'].includes(r.grade), 'grade must be A/B/C/D, got ' + r.grade);
  const wSum = r.weights.kurtosis + r.weights.outlierZ + r.weights.autocorr + r.weights.entropy;
  assert.ok(Math.abs(wSum - 1.0) < 0.001, 'weights must sum to 1.0, got ' + wSum);
  assert.ok(r.componentScores, 'componentScores missing');
  assert.ok(r.details, 'details missing');
});
t('T08 getHealthReport543 trend + composite', () => {
  const m = require(path.join(ROOT,'lib/marketMakerCanon543.js'));
  m.getHealthReport543(); // first call
  const r = m.getHealthReport543(); // second call — trend becomes deterministic
  assert.strictEqual(r.ok, true);
  assert.ok(['rising','falling','stable','unknown'].includes(r.trend), 'invalid trend: ' + r.trend);
  assert.ok(r.composite && typeof r.composite.compositeScore === 'number', 'composite missing');
  assert.ok(r.historyLength >= 1, 'historyLength must be >= 1');
  assert.ok(r.timestamp > 0, 'timestamp missing');
  assert.strictEqual(r.ecosVersion, 'V543');
});
t('T09 registerEndpoints543 null-safe', () => {
  const m = require(path.join(ROOT,'lib/marketMakerCanon543.js'));
  assert.doesNotThrow(() => m.registerEndpoints543(null));
  assert.doesNotThrow(() => m.registerEndpoints543(undefined));
  assert.doesNotThrow(() => m.registerEndpoints543({}));
});
t('T10 src/lib mirror exists', () => {
  const p = path.join(ROOT,'src/lib/marketMakerCanon543.js');
  assert.ok(fs.existsSync(p), 'src/lib/marketMakerCanon543.js mirror missing');
  const src = fs.readFileSync(p,'utf8');
  assert.ok(src.includes('marketMakerCanon543'), 'mirror content invalid');
});
t('T11 re-exports MM_VERSION_333 and tip factories', () => {
  const m = require(path.join(ROOT,'lib/marketMakerCanon543.js'));
  assert.ok(m.MM_VERSION_333, 'MM_VERSION_333 re-export missing');
  assert.strictEqual(typeof m.defaultAuditCapTrail333, 'function');
  assert.strictEqual(typeof m.defaultPageRangeDiffBridge333, 'function');
  assert.strictEqual(typeof m.defaultRankedOverlapBuffer333, 'function');
  assert.strictEqual(typeof m.defaultNormDeltaPercentilesTracker333, 'function');
});
t('T12 grade is consistent with score', () => {
  const m = require(path.join(ROOT,'lib/marketMakerCanon543.js'));
  const r = m.getCompositeScore543();
  const expected = r.compositeScore >= 0.8 ? 'A' : r.compositeScore >= 0.6 ? 'B' : r.compositeScore >= 0.4 ? 'C' : 'D';
  assert.strictEqual(r.grade, expected);
});
t('T13 lib/rails/cryptoRail.js exists and loads', () => {
  const p = path.join(ROOT,'lib/rails/cryptoRail.js');
  assert.ok(fs.existsSync(p), 'cryptoRail.js missing');
  const { CryptoRail } = require(p);
  assert.strictEqual(typeof CryptoRail, 'function');
  const rail = new CryptoRail();
  assert.strictEqual(rail.id, 'crypto');
  assert.strictEqual(rail.isAvailable, false, 'should be disabled without ECOS_CRYPTO_ENABLED=1');
});
t('T14 withdrawalHistoryService.js parse-clean (no corrupted template literal)', () => {
  const p = path.join(ROOT,'lib/withdrawalHistoryService.js');
  assert.ok(fs.existsSync(p));
  // \` (backslash+backtick) at start of template literal is corrupted
  const raw = fs.readFileSync(p);
  const hasBadToken = raw.includes(Buffer.from([0x5c, 0x60])); // \`
  assert.ok(!hasBadToken, 'withdrawalHistoryService still has \\` corruption');
});
t('T15 server IIFE + SACRED intact', () => {
  const serverSrc = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
  assert.ok(serverSrc.includes('marketMakerCanon543.js'));
  assert.strictEqual(
    crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT,'lib/fiatLedger.js'))).digest('hex'),
    '563e9b1f9e67091a5b6527c0a92568e5'
  );
  assert.strictEqual(
    crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT,'lib/auditLog.js'))).digest('hex'),
    'e5a5c2c27801d2d03991bc8e5a1df8cb'
  );
});

console.log('\n=== V543 Results: ' + passed + ' passed, ' + failed + ' failed ===\n');
if (failed > 0) process.exit(1);
process.exit(0);
