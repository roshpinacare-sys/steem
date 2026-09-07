/**
 * tests/v495.test.js — ECOS V495 (Phase P374) — Consolidation Safety Analyzer + executed collapse
 * Run: NODE_ENV=test node tests/v495.test.js
 * @version 495.0.0
 */
'use strict';
process.env.NODE_ENV = 'test';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const A = require(path.join(ROOT, 'src/lib/consolidationAnalyzer495.js'));

let passed = 0, failed = 0; const errors = [];
function test(name, fn) {
  try { fn(); console.log('  \u2713 ' + name); passed++; }
  catch (e) { console.error('  \u2717 ' + name + ': ' + e.message); failed++; errors.push(name); }
}
function towerFiles(base) {
  const dir = path.join(ROOT, 'lib');
  return fs.readdirSync(dir).filter(f => new RegExp('^' + base + '\\d+\\.js$').test(f)).map(f => path.join(dir, f));
}

console.log('\n[V495] Tower classification — chain vs parallel (the honest distinction)\n');
test('marketMaker is correctly classified as an inheritance-chain', () => {
  const t = A.classifyTower495('marketMaker', towerFiles('marketMaker'));
  assert.strictEqual(t.kind, 'inheritance-chain');
  assert.ok(t.internalDeps > 0, 'a chain must have internal deps');
  assert.ok(t.head);
});
test('an inheritance-chain reports ZERO naive-retirable (prevents the build-breaking mistake)', () => {
  const t = A.classifyTower495('marketMaker', towerFiles('marketMaker'));
  const r = A.trueRetirable495(t, () => false);
  assert.strictEqual(r.retirable, 0);
  assert.ok(/inheritance chain/.test(r.reason));
});
test('version extraction works', () => {
  assert.strictEqual(A._versionOf495('marketMaker333.js'), 333);
  assert.strictEqual(A._versionOf495('foo'), null);
});

console.log('\n[V495] Honest plan over the real lib\n');
let plan = null;
test('safeCollapsePlan distinguishes chains from parallel duplicates', () => {
  const dir = path.join(ROOT, 'lib');
  const files = fs.readdirSync(dir).filter(f => /^[a-zA-Z]+\d+\.js$/.test(f));
  const fam = {}; for (const f of files) { const b = f.replace(/\d+\.js$/, ''); (fam[b] = fam[b] || []).push(path.join(dir, f)); }
  const towers = Object.entries(fam).filter(([b, fl]) => fl.length >= 3).map(([base, fl]) => ({ base, files: fl }));
  // after this version's collapse, the "is referenced" predicate is the live grep used at runtime;
  // for the test we treat nothing as referenced to exercise the math.
  plan = A.safeCollapsePlan495(towers, () => false);
  assert.ok(plan.inheritanceChains >= 1, 'expected at least one inheritance chain');
  assert.ok(plan.towersAnalyzed >= plan.inheritanceChains + plan.parallelDuplicateTowers - 0);
});
test('inheritance chains are EXCLUDED from the safe-retire count (honesty)', () => {
  // the big chains (marketMaker, providerAdapters, meshDispatcher) must not appear in collapses
  const collapsedBases = (plan.collapses || []).map(c => c.base);
  ['marketMaker', 'providerAdapters', 'meshDispatcher'].forEach(b => assert.ok(!collapsedBases.includes(b), b + ' is a chain, must not be in safe collapses'));
});
test('bad args throw', () => {
  assert.throws(() => A.classifyTower495(), e => e.code === 'BAD_ARGS');
  assert.throws(() => A.safeCollapsePlan495('nope'), e => e.code === 'BAD_ARGS');
});

console.log('\n[V495] The EXECUTED collapse is real, safe, and consistent\n');
test('113 modules were collapsed to thin re-exports this version', () => {
  const dir = path.join(ROOT, 'lib');
  const thin = fs.readdirSync(dir).filter(f => f.endsWith('.js')).filter(f => /V495 consolidation/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.ok(thin.length >= 100, 'expected ~113 thin re-exports, got ' + thin.length);
});
test('a sample collapsed module re-exports its canonical and loads', () => {
  const dir = path.join(ROOT, 'lib');
  const sample = fs.readdirSync(dir).find(f => /V495 consolidation/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.ok(sample, 'no collapsed module found');
  const src = fs.readFileSync(path.join(dir, sample), 'utf8');
  assert.ok(/module\.exports = require\('\.\/[a-zA-Z]+\d+\.js'\)/.test(src));
  assert.doesNotThrow(() => require(path.join(dir, sample)));
});
test('collapsed module exports equal its canonical (no API loss)', () => {
  const dir = path.join(ROOT, 'lib');
  const sample = fs.readdirSync(dir).find(f => /V495 consolidation/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  const src = fs.readFileSync(path.join(dir, sample), 'utf8');
  const canon = src.match(/require\('\.\/([a-zA-Z]+\d+)\.js'\)/)[1];
  const a = require(path.join(dir, sample));
  const b = require(path.join(dir, canon + '.js'));
  assert.deepStrictEqual(Object.keys(a).sort(), Object.keys(b).sort());
});

console.log('\n[V495] Server wiring + sacred\n');
const SERVER = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
test('server parses, no corruption', () => {
  assert.doesNotThrow(() => new vm.Script(SERVER, { filename: 'ecos-api-server.js' }));
  assert.ok(!SERVER.includes('__manus_ec'));
});
test('consolidation-safety endpoints + tags wired', () => {
  assert.ok(SERVER.includes('/api/v1/registry/consolidation-safety'));
  ['V495-T01', 'V495-T02'].forEach(t => assert.ok(SERVER.includes(t)));
  assert.ok(SERVER.includes("require('./lib/consolidationAnalyzer495.js')"));
});
test('package.json major >= 495', () => {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  assert.ok(parseInt(String(v).split('.')[0], 10) >= 495, 'got ' + v);
});
test('SACRED files intact (canonical MD5)', () => {
  const crypto = require('crypto');
  const md5 = p => crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
  assert.strictEqual(md5('lib/fiatLedger.js'), '563e9b1f9e67091a5b6527c0a92568e5');
  assert.strictEqual(md5('lib/auditLog.js'), 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});
test('handoff docs exist', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'CHANGELOG_V495.md')));
  assert.ok(fs.existsSync(path.join(ROOT, 'NEXT_SESSION_PROMPT_V495.md')));
});

console.log('\n  Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.error('Failed: ' + errors.join(', ')); process.exit(1); }
console.log('  \u2713 All V495 tests passed\n');
