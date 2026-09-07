/**
 * tests/v498.test.js — ECOS V498 (Phase P377) — Diamond Code-Health Signal
 * Run: NODE_ENV=test node tests/v498.test.js
 * @version 498.0.0
 */
'use strict';
process.env.NODE_ENV = 'test';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const C = require(path.join(ROOT, 'src/lib/diamondCodeHealthSignal498.js'));
const D = require(path.join(ROOT, 'lib/sovereignOperatorDiamond453.js'));
const OPTS = { libDir: path.join(ROOT, 'lib'), rootDir: ROOT };

let passed = 0, failed = 0; const errors = [];
function test(name, fn) { try { fn(); console.log('  \u2713 ' + name); passed++; } catch (e) { console.error('  \u2717 ' + name + ': ' + e.message); failed++; errors.push(name); } }

console.log('\n[V498] Gather code-health (from bridge496 + manifest497)\n');
let ch = null;
test('gathers a debt snapshot with chains, retirable, archived, score', () => {
  ch = C.gatherCodeHealth498(OPTS);
  assert.ok(ch.chains >= 1, 'expected inheritance chains');
  assert.ok(typeof ch.honestRetirable === 'number');
  assert.ok(ch.archivedOrphans >= 50, 'manifest should report archived orphans');
  assert.ok(ch.debtScore >= 0 && ch.debtScore <= 100);
  assert.ok(['INFO', 'MEDIUM'].includes(ch.severity), 'debt is never an emergency severity');
});
test('top chains carry base + canonical for the proposal', () => {
  assert.ok(Array.isArray(ch.topChains) && ch.topChains.length >= 1);
  ch.topChains.forEach(c => { assert.ok(c.base); assert.ok(c.versions >= 1); });
});

console.log('\n[V498] Augment cognition — bounded, never outranks money/safety\n');
test('healthy cognition gains a codeHealth concern and a bounded penalty', () => {
  const cog = D.assessSystem453({ solvency: { solvent: true, surplusMicro: '1000000' }, safety: { armed: true } });
  const aug = C.augmentCognition498(cog, ch);
  assert.ok(aug.concernCount === cog.concernCount + 1, 'one codeHealth concern added');
  assert.ok(aug.healthScore <= cog.healthScore, 'debt lowers health');
  assert.ok(cog.healthScore - aug.healthScore <= 10, 'penalty is bounded (<=10)');
  assert.ok(aug.concerns.some(c => c.pillar === 'codeHealth'));
});
test('a solvency emergency ALWAYS outranks code-health debt', () => {
  const cogBad = D.assessSystem453({ solvency: { solvent: false } });
  const aug = C.augmentCognition498(cogBad, ch);
  assert.strictEqual(aug.concerns[0].pillar, 'solvency');
  assert.strictEqual(aug.concerns[0].severity, 'CRITICAL');
});
test('debt applies NO health penalty when an emergency is present (focus on money)', () => {
  const cogBad = D.assessSystem453({ solvency: { solvent: false } });
  const aug = C.augmentCognition498(cogBad, ch);
  assert.strictEqual(aug.healthScore, cogBad.healthScore, 'no debt penalty under emergency');
});
test('bad args throw', () => {
  assert.throws(() => C.augmentCognition498({}, ch), e => e.code === 'BAD_COGNITION');
  assert.throws(() => C.augmentCognition498(D.assessSystem453({}), null), e => e.code === 'BAD_ARGS');
});

console.log('\n[V498] Cleanup proposals — bounded, proposal-only\n');
test('chains → manual-flatten proposals requiring auth', () => {
  const pro = C.proposeCleanup498(ch);
  const flat = pro.actions.find(a => a.capability === 'maintenance.flattenChain');
  assert.ok(flat, 'expected a flattenChain proposal');
  assert.strictEqual(flat.requiresAuth, true);
  assert.ok(/breaks the build|MANUAL/i.test(flat.reason));
  assert.ok(/proposals only/i.test(pro.note));
});
test('no debt → noop proposal', () => {
  const clean = { chains: 0, honestRetirable: 0, topChains: [], debtScore: 0 };
  const pro = C.proposeCleanup498(clean);
  assert.strictEqual(pro.actions[0].capability, 'monitor.noop');
});

console.log('\n[V498] Server wiring + sacred\n');
const SERVER = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
test('server parses, no corruption', () => {
  assert.doesNotThrow(() => new vm.Script(SERVER, { filename: 'ecos-api-server.js' }));
  assert.ok(!SERVER.includes('__manus_ec'));
});
test('code-health endpoints + tags wired, connecting the layers', () => {
  ['/api/v1/diamond/code-health', '/api/v1/diamond/cognition-augmented', '/api/v1/diamond/cleanup-proposals'].forEach(p => assert.ok(SERVER.includes(p), 'missing ' + p));
  ['V498-T01', 'V498-T02', 'V498-T03', 'V498-T04'].forEach(t => assert.ok(SERVER.includes(t)));
  assert.ok(SERVER.includes("require('./lib/diamondCodeHealthSignal498.js')"));
  const src = fs.readFileSync(path.join(ROOT, 'lib/diamondCodeHealthSignal498.js'), 'utf8');
  assert.ok(src.includes("require('./registryConsolidationBridge496.js')"));
  assert.ok(src.includes("require('./orphanArchiveManifest497.js')"));
});
test('package.json major >= 498', () => {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  assert.ok(parseInt(String(v).split('.')[0], 10) >= 498, 'got ' + v);
});
test('SACRED files intact (canonical MD5)', () => {
  const crypto = require('crypto');
  const md5 = p => crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
  assert.strictEqual(md5('lib/fiatLedger.js'), '563e9b1f9e67091a5b6527c0a92568e5');
  assert.strictEqual(md5('lib/auditLog.js'), 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});
test('handoff docs exist', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'CHANGELOG_V498.md')));
  assert.ok(fs.existsSync(path.join(ROOT, 'NEXT_SESSION_PROMPT_V498.md')));
});

console.log('\n  Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.error('Failed: ' + errors.join(', ')); process.exit(1); }
console.log('  \u2713 All V498 tests passed\n');
