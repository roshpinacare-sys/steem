'use strict';
/**
 * tests/v546.test.js — ECOS V546
 * deepHealthPolicy546: decision engine (score+trend+buckets → AUTO/SUPERVISED/MANUAL)
 */

const assert = require('assert');
const path   = require('path');
const crypto = require('crypto');
const fs     = require('fs');

let pass546 = 0, fail546 = 0;
function t546(name, fn) {
  try   { fn(); console.log(`  ✓ ${name}`); pass546++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); fail546++; }
}

const ROOT = path.resolve(__dirname, '..');
console.log('\n=== ECOS V546 Tests ===\n');

// T01–T02: SACRED
t546('T01 SACRED fiatLedger', () => {
  const md5 = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT,'lib/fiatLedger.js'))).digest('hex');
  assert.strictEqual(md5, '563e9b1f9e67091a5b6527c0a92568e5');
});
t546('T02 SACRED auditLog', () => {
  const md5 = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT,'lib/auditLog.js'))).digest('hex');
  assert.strictEqual(md5, 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// T03: server parse
t546('T03 server node --check', () => {
  require('child_process').execSync(`node --check ${path.join(ROOT,'ecos-api-server.js')} 2>&1`);
});

// T04: version
t546('T04 version >= 546', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8'));
  assert(parseInt(pkg.version) >= 546, `got ${pkg.version}`);
});

// T05: module loads
t546('T05 deepHealthPolicy546 loads', () => {
  const m = require(path.join(ROOT,'lib/deepHealthPolicy546.js'));
  assert.strictEqual(typeof m.getPolicy546, 'function');
  assert.strictEqual(typeof m.explainPolicy546, 'function');
  assert.strictEqual(typeof m._decide546, 'function');
  assert.strictEqual(typeof m.POLICY_VERSION_546, 'string');
});

// T06: getPolicy546 returns valid structure
t546('T06 getPolicy546 valid structure', () => {
  const m = require(path.join(ROOT,'lib/deepHealthPolicy546.js'));
  const r = m.getPolicy546();
  assert.strictEqual(r.ok, true);
  assert(['AUTO','SUPERVISED','MANUAL'].includes(r.decision), `bad decision: ${r.decision}`);
  assert(typeof r.score   === 'number', 'score must be number');
  assert(typeof r.trend   === 'string', 'trend must be string');
  assert(typeof r.reasoning === 'string', 'reasoning must be string');
  assert(r.sources, 'sources missing');
  assert(r.thresholds, 'thresholds missing');
});

// T07: decision logic — AUTO at high score + stable trend
t546('T07 _decide546: AUTO when score>=0.7 and stable', () => {
  const { _decide546 } = require(path.join(ROOT,'lib/deepHealthPolicy546.js'));
  assert.strictEqual(_decide546(0.80, 'stable',  {ok:true}), 'AUTO');
  assert.strictEqual(_decide546(0.70, 'falling', {ok:true}), 'AUTO');
  assert.strictEqual(_decide546(0.95, 'stable',  {ok:true}), 'AUTO');
});

// T08: decision logic — SUPERVISED at mid score
t546('T08 _decide546: SUPERVISED at mid score', () => {
  const { _decide546 } = require(path.join(ROOT,'lib/deepHealthPolicy546.js'));
  assert.strictEqual(_decide546(0.60, 'stable',  {ok:true}), 'SUPERVISED');
  assert.strictEqual(_decide546(0.40, 'falling', {ok:true}), 'SUPERVISED');
  assert.strictEqual(_decide546(0.45, 'stable',  {ok:true}), 'SUPERVISED');
});

// T09: fail-closed — MANUAL at low score
t546('T09 _decide546: MANUAL at low score', () => {
  const { _decide546 } = require(path.join(ROOT,'lib/deepHealthPolicy546.js'));
  assert.strictEqual(_decide546(0.30, 'stable',  {ok:true}), 'MANUAL');
  assert.strictEqual(_decide546(0.00, 'stable',  {ok:true}), 'MANUAL');
});

// T10: fail-closed — rising trend always MANUAL
t546('T10 _decide546: MANUAL when trend=rising (any score)', () => {
  const { _decide546 } = require(path.join(ROOT,'lib/deepHealthPolicy546.js'));
  assert.strictEqual(_decide546(0.99, 'rising',  {ok:true}), 'MANUAL');
  assert.strictEqual(_decide546(0.80, 'rising',  {ok:true}), 'MANUAL');
  assert.strictEqual(_decide546(0.50, 'rising',  {ok:true}), 'MANUAL');
});

// T11: fail-closed — unknown trend always MANUAL
t546('T11 _decide546: MANUAL when trend=unknown', () => {
  const { _decide546 } = require(path.join(ROOT,'lib/deepHealthPolicy546.js'));
  assert.strictEqual(_decide546(0.99, 'unknown', {ok:true}), 'MANUAL');
});

// T12: explainPolicy546 returns string
t546('T12 explainPolicy546 returns string', () => {
  const m = require(path.join(ROOT,'lib/deepHealthPolicy546.js'));
  const s = m.explainPolicy546();
  assert(typeof s === 'string' && s.length > 0);
  assert(s.includes('V546'), 'should mention V546');
});

// T13: live policy — MANUAL in test env (no live heartbeat)
t546('T13 live policy = MANUAL in test env (fail-closed, expected)', () => {
  const m = require(path.join(ROOT,'lib/deepHealthPolicy546.js'));
  const r = m.getPolicy546();
  // In test env: score≈0, trend=unknown → MANUAL is correct (fail-closed)
  assert.strictEqual(r.decision, 'MANUAL', 'Expected MANUAL without live heartbeat');
});

// T14: lib/ mirror exists
t546('T14 lib/ mirror exists', () => {
  assert(fs.existsSync(path.join(ROOT,'lib/deepHealthPolicy546.js')), 'lib mirror missing');
});

// T15: V546 endpoints wired in server
t546('T15 V546 endpoints wired in server', () => {
  const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
  assert(src.includes('/api/v1/deep-health/policy/v546'), 'policy endpoint missing');
  assert(src.includes('/api/v1/admin/summary/v546'), 'summary endpoint missing');
  assert(src.includes('_wireDeepHealthPolicy546'), 'IIFE name missing');
});

console.log(`\n=== V546 Results: ${pass546} passed, ${fail546} failed ===`);
console.log(`=== cannotRun (vitest/pg/express): not counted ===\n`);
process.exit(fail546 > 0 ? 1 : 0);
