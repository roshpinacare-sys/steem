/**
 * tests/v496.test.js — ECOS V496 (Phase P375) — Registry↔Analyzer Bridge
 * Run: NODE_ENV=test node tests/v496.test.js
 * @version 496.0.0
 */
'use strict';
process.env.NODE_ENV = 'test';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const B = require(path.join(ROOT, 'src/lib/registryConsolidationBridge496.js'));
const OPTS = { libDir: path.join(ROOT, 'lib'), rootDir: ROOT };

let passed = 0, failed = 0; const errors = [];
function test(name, fn) { try { fn(); console.log('  \u2713 ' + name); passed++; } catch (e) { console.error('  \u2717 ' + name + ': ' + e.message); failed++; errors.push(name); } }

console.log('\n[V496] Honest duplication — corrects the naive V463 count\n');
let hd = null;
test('produces an honest report with both naive and true counts', () => {
  hd = B.honestDuplication496(OPTS);
  assert.ok(typeof hd.naiveRetirable_V463 === 'number');
  assert.ok(typeof hd.honestRetirable === 'number');
  assert.ok(hd.honestRetirable <= hd.naiveRetirable_V463, 'honest must be <= naive');
});
test('detects inheritance chains and excludes them from safe retirable', () => {
  assert.ok(hd.inheritanceChains >= 1, 'expected inheritance chains');
  // every chain tower must report trueRetirable 0 and not be safeToCollapse
  hd.towers.filter(t => t.kind === 'inheritance-chain').forEach(t => {
    assert.strictEqual(t.trueRetirable, 0, t.base + ' chain should be 0 retirable');
    assert.strictEqual(t.safeToCollapse, false);
  });
});
test('correction message explains the danger', () => {
  assert.ok(/break the build/.test(hd.correction));
});

console.log('\n[V496] Honest should-build — build-protecting GATE\n');
test('a chain tower → consolidate with method manual-flatten (NOT re-export)', () => {
  const g = B.honestShouldBuild496('marketMaker', OPTS);
  assert.strictEqual(g.recommend, 'consolidate');
  assert.ok(g.safety, 'expected safety classification');
  assert.strictEqual(g.safety.towerKind, 'inheritance-chain');
  assert.strictEqual(g.safety.method, 'manual-flatten');
  assert.strictEqual(g.safety.collapseSafeNow, false);
  assert.ok(/do NOT thin-re-export/i.test(g.safety.guidance));
});
test('a novel capability → build_new (no false safety block)', () => {
  const g = B.honestShouldBuild496('zzzTrulyNovelThing999', OPTS);
  assert.strictEqual(g.recommend, 'build_new');
  assert.strictEqual(g.safety, null);
});
test('bad args throw', () => {
  assert.throws(() => B.honestShouldBuild496('', OPTS), e => e.code === 'BAD_ARGS');
});

console.log('\n[V496] Server wiring + sacred\n');
const SERVER = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
test('server parses, no corruption', () => {
  assert.doesNotThrow(() => new vm.Script(SERVER, { filename: 'ecos-api-server.js' }));
  assert.ok(!SERVER.includes('__manus_ec'));
});
test('bridge endpoints + tags wired, composing registry463 + analyzer495', () => {
  ['/api/v1/registry/honest-duplication', '/api/v1/registry/honest-should-build'].forEach(p => assert.ok(SERVER.includes(p), 'missing ' + p));
  ['V496-T01', 'V496-T02', 'V496-T03'].forEach(t => assert.ok(SERVER.includes(t)));
  assert.ok(SERVER.includes("require('./lib/registryConsolidationBridge496.js')"));
  const src = fs.readFileSync(path.join(ROOT, 'lib/registryConsolidationBridge496.js'), 'utf8');
  assert.ok(src.includes("require('./canonicalCapabilityRegistry463.js')"));
  assert.ok(src.includes("require('./consolidationAnalyzer495.js')"));
});
test('package.json major >= 496', () => {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  assert.ok(parseInt(String(v).split('.')[0], 10) >= 496, 'got ' + v);
});
test('SACRED files intact (canonical MD5)', () => {
  const crypto = require('crypto');
  const md5 = p => crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
  assert.strictEqual(md5('lib/fiatLedger.js'), '563e9b1f9e67091a5b6527c0a92568e5');
  assert.strictEqual(md5('lib/auditLog.js'), 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});
test('handoff docs exist', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'CHANGELOG_V496.md')));
  assert.ok(fs.existsSync(path.join(ROOT, 'NEXT_SESSION_PROMPT_V496.md')));
});

console.log('\n  Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.error('Failed: ' + errors.join(', ')); process.exit(1); }
console.log('  \u2713 All V496 tests passed\n');
