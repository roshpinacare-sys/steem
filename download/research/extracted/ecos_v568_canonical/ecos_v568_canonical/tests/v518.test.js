'use strict';
/**
 * tests/v518.test.js — ECOS V518
 * Test the canon-tower-auditor that verifies tower-classification truth.
 * exit 0 = pass.
 */
const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;
function test518(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.error('  ✗', name, '\n   ', e.message); failed++; }
}

console.log('\n=== V518 tests ===');

// ── SACRED guard ──
test518('SACRED fiatLedger.js md5 unchanged', () => {
  const buf = fs.readFileSync(path.join(ROOT, 'lib', 'fiatLedger.js'));
  const md5 = crypto.createHash('md5').update(buf).digest('hex');
  assert.strictEqual(md5, '563e9b1f9e67091a5b6527c0a92568e5', 'fiatLedger md5 drifted');
});
test518('SACRED auditLog.js md5 unchanged', () => {
  const buf = fs.readFileSync(path.join(ROOT, 'lib', 'auditLog.js'));
  const md5 = crypto.createHash('md5').update(buf).digest('hex');
  assert.strictEqual(md5, 'e5a5c2c27801d2d03991bc8e5a1df8cb', 'auditLog md5 drifted');
});

// ── Parse / wiring ──
test518('server source contains V518 IIFE marker', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  assert(src.length > 1000, 'server too small');
  assert(src.includes('_wireCanonTowerAuditor518'), 'V518 IIFE missing');
  assert(src.includes("require('./lib/canonTowerAuditor518.js')"), 'V518 require missing');
});

// ── Module loads ──
test518('canonTowerAuditor518 loads with expected exports', () => {
  const m = require(path.join(ROOT, 'lib', 'canonTowerAuditor518.js'));
  assert.strictEqual(m.AUDITOR_VERSION_518, '518.0.0');
  assert.deepStrictEqual([...m.CANDIDATE_NAMES_518], [
    'marketMaker', 'providerAdapters', 'economicIntegrityLoadBearing',
  ]);
  assert.strictEqual(typeof m.classifyTower518, 'function');
  assert.strictEqual(typeof m.auditAllTowers518, 'function');
  assert.strictEqual(typeof m.registerEndpoints518, 'function');
});

// ── Source-of-truth verdicts on the 3 candidates ──
test518('marketMaker is NOT parallel-duplicate (35 active non-tip members)', () => {
  const m = require(path.join(ROOT, 'lib', 'canonTowerAuditor518.js'));
  const v = m.classifyTower518('marketMaker');
  assert.strictEqual(v.count, 36);
  assert.strictEqual(v.base, '298');
  assert.strictEqual(v.tip, '333');
  assert.strictEqual(v.nonTipTotal, 35);
  assert.strictEqual(v.thinReexport, 0);
  assert.strictEqual(v.active, 35);
  assert.strictEqual(v.isParallelDuplicate, false);
  assert.strictEqual(v.eligible, false);
});

test518('providerAdapters is NOT parallel-duplicate (only 1 thin re-export)', () => {
  const m = require(path.join(ROOT, 'lib', 'canonTowerAuditor518.js'));
  const v = m.classifyTower518('providerAdapters');
  assert.strictEqual(v.count, 17);
  assert.strictEqual(v.base, '267');
  assert.strictEqual(v.tip, '286');
  assert.strictEqual(v.nonTipTotal, 16);
  assert.strictEqual(v.thinReexport, 1, 'expected exactly the V482 thin re-export');
  assert.strictEqual(v.active, 15);
  assert.strictEqual(v.isParallelDuplicate, false);
  assert.strictEqual(v.eligible, false);
});

test518('economicIntegrityLoadBearing is NOT parallel-duplicate (10 active non-tip)', () => {
  const m = require(path.join(ROOT, 'lib', 'canonTowerAuditor518.js'));
  const v = m.classifyTower518('economicIntegrityLoadBearing');
  assert.strictEqual(v.count, 11);
  assert.strictEqual(v.base, '361');
  assert.strictEqual(v.tip, '371');
  assert.strictEqual(v.nonTipTotal, 10);
  assert.strictEqual(v.thinReexport, 0);
  assert.strictEqual(v.active, 10);
  assert.strictEqual(v.isParallelDuplicate, false);
});

// ── Positive control: the towers V517 already registered MUST be classified parallel-dup ──
test518('onboardingFlow IS parallel-duplicate (V517 already registered it)', () => {
  const m = require(path.join(ROOT, 'lib', 'canonTowerAuditor518.js'));
  const v = m.classifyTower518('onboardingFlow');
  assert.strictEqual(v.count, 6);
  assert.strictEqual(v.tip, '268');
  assert.strictEqual(v.active, 0, 'no non-tip should be active');
  assert.strictEqual(v.thinReexport, 5);
  assert.strictEqual(v.isParallelDuplicate, true);
});

test518('agentDispatchBridge IS parallel-duplicate (V517 already registered it)', () => {
  const m = require(path.join(ROOT, 'lib', 'canonTowerAuditor518.js'));
  const v = m.classifyTower518('agentDispatchBridge');
  assert.strictEqual(v.count, 8);
  assert.strictEqual(v.tip, '253');
  assert.strictEqual(v.active, 0);
  assert.strictEqual(v.thinReexport, 7);
  assert.strictEqual(v.isParallelDuplicate, true);
});

// ── auditAllTowers518 shape + cross-check ──
test518('auditAllTowers518 returns frozen report with sane shape', () => {
  const m = require(path.join(ROOT, 'lib', 'canonTowerAuditor518.js'));
  const r = m.auditAllTowers518();
  assert.strictEqual(r.ok, true);
  assert(Array.isArray(r.towers));
  assert(r.towers.length >= 5, 'expected at least a few towers');
  const names = r.towers.map(t => t.name);
  assert(names.includes('marketMaker'));
  assert(names.includes('onboardingFlow'));
  assert(names.includes('agentDispatchBridge'));
  // eligible list MUST include the two V517-registered towers
  assert(r.eligibleForRegistration.includes('onboardingFlow'));
  assert(r.eligibleForRegistration.includes('agentDispatchBridge'));
  // and MUST NOT include the 3 rejected candidates
  assert(!r.eligibleForRegistration.includes('marketMaker'));
  assert(!r.eligibleForRegistration.includes('providerAdapters'));
  assert(!r.eligibleForRegistration.includes('economicIntegrityLoadBearing'));
});

// ── getCandidateVerdicts518: all 3 ineligible ──
test518('getCandidateVerdicts518 reports zero eligible candidates', () => {
  const m = require(path.join(ROOT, 'lib', 'canonTowerAuditor518.js'));
  const verdicts = m.getCandidateVerdicts518();
  assert.strictEqual(verdicts.length, 3);
  for (const v of verdicts) {
    assert.strictEqual(v.eligible, false, v.name + ' was unexpectedly eligible');
  }
});

// ── fail-closed: unknown tower ──
test518('classifyTower518 fails closed on unknown tower name', () => {
  const m = require(path.join(ROOT, 'lib', 'canonTowerAuditor518.js'));
  const v = m.classifyTower518('definitelyNotARealTowerXYZ518');
  assert.strictEqual(v.count, 0);
  assert.strictEqual(v.eligible, false);
});

// ── endpoint registration is non-throwing on a minimal stub ──
test518('registerEndpoints518 accepts an express-like app stub without throwing', () => {
  const m = require(path.join(ROOT, 'lib', 'canonTowerAuditor518.js'));
  const routes = [];
  const stub = { get: (p, h) => routes.push({ p, h }) };
  m.registerEndpoints518(stub);
  assert.strictEqual(routes.length, 3, 'expected 3 endpoints (T01..T03)');
  const paths = routes.map(r => r.p);
  assert(paths.includes('/api/v1/registry/canon-auditor-v518/status'));
  assert(paths.includes('/api/v1/registry/canon-auditor-v518/full'));
  assert(paths.includes('/api/v1/admin/summary/v518'));
});

// ── safe on missing/invalid app ──
test518('registerEndpoints518 is a no-op for invalid app argument', () => {
  const m = require(path.join(ROOT, 'lib', 'canonTowerAuditor518.js'));
  m.registerEndpoints518(null);
  m.registerEndpoints518({});
  m.registerEndpoints518({ get: 'not a function' });
});

// ── src/lib mirror exists and matches lib/ ──
test518('src/lib mirror of canonTowerAuditor518.js exists and matches lib/', () => {
  const a = fs.readFileSync(path.join(ROOT, 'lib', 'canonTowerAuditor518.js'));
  const b = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'canonTowerAuditor518.js'));
  const ha = crypto.createHash('md5').update(a).digest('hex');
  const hb = crypto.createHash('md5').update(b).digest('hex');
  assert.strictEqual(ha, hb, 'lib/ and src/lib/ copies diverged');
});

// ── package.json version bumped ──
test518('package.json version >= 518', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const major = parseInt(String(pkg.version).split('.')[0], 10);
  assert(major >= 518, 'expected major >= 518, got ' + pkg.version);
});

console.log(`\n=== V518: ${passed}/${passed + failed} passed ===`);
process.exit(failed === 0 ? 0 : 1);
