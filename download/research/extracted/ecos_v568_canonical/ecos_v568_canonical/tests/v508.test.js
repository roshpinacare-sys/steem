/**
 * tests/v508.test.js — ECOS V508 — canonBridgePatch
 * Run: NODE_ENV=test node tests/v508.test.js
 * @version 508.0.0
 */
'use strict';
process.env.NODE_ENV = 'test';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const LIB  = path.join(ROOT, 'lib');

let passed = 0, failed = 0, errors = [];
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + ': ' + e.message); failed++; errors.push(name); }
}

// ── SACRED ──
console.log('\n[V508] SACRED\n');
test('fiatLedger.js md5 unchanged', () => {
  const s = crypto.createHash('md5').update(fs.readFileSync(path.join(LIB,'fiatLedger.js'))).digest('hex');
  assert.strictEqual(s, '563e9b1f9e67091a5b6527c0a92568e5');
});
test('auditLog.js md5 unchanged', () => {
  const s = crypto.createHash('md5').update(fs.readFileSync(path.join(LIB,'auditLog.js'))).digest('hex');
  assert.strictEqual(s, 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// ── syntax ──
console.log('\n[V508] syntax\n');
test('ecos-api-server.js parses cleanly', () => {
  require('child_process').execSync('node --check ' + path.join(ROOT,'ecos-api-server.js'), {stdio:'pipe'});
});

// ── canonBridgePatch508 module ──
console.log('\n[V508] canonBridgePatch508\n');
const patch = require(path.join(LIB, 'canonBridgePatch508.js'));

test('PATCH_VERSION_508 correct', () => {
  assert.strictEqual(patch.PATCH_VERSION_508, '508.0.0');
});

test('listRegisteredFacades508 includes reflectionLoop', () => {
  const facades = patch.listRegisteredFacades508();
  assert.ok(facades.length >= 1, 'at least one facade registered');
  const rl = facades.find(f => f.name === 'reflectionLoop');
  assert.ok(rl, 'reflectionLoop facade registered');
  assert.strictEqual(rl.kind, 'parallel-duplicate');
});

test('getKindDiff508 finds reflectionLoop correction', () => {
  const diff = patch.getKindDiff508({ libDir: path.join(ROOT,'lib'), rootDir: ROOT });
  assert.ok(diff.corrections >= 1, 'at least 1 correction expected');
  const rl = diff.diffs.find(d => d.tower === 'reflectionLoop');
  assert.ok(rl, 'reflectionLoop diff present');
  assert.strictEqual(rl.bridgeKind, 'inheritance-chain');
  assert.strictEqual(rl.canonKind, 'parallel-duplicate');
  assert.strictEqual(rl.canonRetirable, 5);
});

test('getPatchedDuplication508 corrects reflectionLoop to parallel-duplicate', () => {
  const rep = patch.getPatchedDuplication508({ libDir: path.join(ROOT,'lib'), rootDir: ROOT });
  const rl = rep.towers.find(t => t.base === 'reflectionLoop');
  assert.ok(rl, 'reflectionLoop in patched report');
  assert.strictEqual(rl.kind, 'parallel-duplicate', 'kind patched');
  assert.strictEqual(rl.trueRetirable, 5, 'trueRetirable patched to 5');
  assert.strictEqual(rl.safeToCollapse, true, 'safeToCollapse now true');
  assert.ok(rl._patchedBy508, '_patchedBy508 tag present');
  assert.ok(rl._bridgeOriginal, '_bridgeOriginal preserved');
});

test('getPatchedDuplication508 honestRetirable >= 5', () => {
  const rep = patch.getPatchedDuplication508({ libDir: path.join(ROOT,'lib'), rootDir: ROOT });
  assert.ok(rep.honestRetirable >= 5, 'at least 5 honest retirable after patch');
  assert.ok(rep.patchedTowers >= 1, 'at least 1 tower patched');
});

test('registerCanonFacade508 accepts valid descriptor', () => {
  patch.registerCanonFacade508({ name: 'testTower508', kind: 'parallel-duplicate', base: '100', tip: '103', members: ['100','101','102','103'] });
  const facades = patch.listRegisteredFacades508();
  assert.ok(facades.find(f => f.name === 'testTower508'), 'new facade registered');
});

test('registerCanonFacade508 rejects invalid kind', () => {
  assert.throws(() => {
    patch.registerCanonFacade508({ name: 'badTower', kind: 'unknown-kind', base: '1', tip: '2', members: ['1','2'] });
  }, /kind must be/);
});

// ── src/lib mirror ──
console.log('\n[V508] src/lib mirror\n');
test('src and lib canonBridgePatch508 identical', () => {
  const a = fs.readFileSync(path.join(ROOT,'src/lib/canonBridgePatch508.js'));
  const b = fs.readFileSync(path.join(ROOT,'lib/canonBridgePatch508.js'));
  assert.ok(a.equals(b));
});

// ── endpoints ──
console.log('\n[V508] endpoints\n');
test('GET /api/v1/registry/honest-patched wired', () => {
  assert.ok(fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8').includes('/api/v1/registry/honest-patched'));
});
test('GET /api/v1/registry/kind-diff wired', () => {
  assert.ok(fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8').includes('/api/v1/registry/kind-diff'));
});
test('GET /api/v1/admin/summary/v508 wired', () => {
  assert.ok(fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8').includes('/api/v1/admin/summary/v508'));
});

// ── version ──
console.log('\n[V508] version\n');
test('package.json version >= 508', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8'));
  assert.ok(parseInt(pkg.version) >= 508);
});

console.log('\n' + '─'.repeat(50));
console.log(`[V508] Results: ${passed} passed, ${failed} failed`);
if (errors.length) console.error('Failed:', errors.join(', '));
console.log('─'.repeat(50) + '\n');
process.exit(failed > 0 ? 1 : 0);
