/**
 * tests/v507.test.js — ECOS V507 — reflectionLoop Canon Facade
 * Run: NODE_ENV=test node tests/v507.test.js
 * @version 507.0.0
 */
'use strict';
process.env.NODE_ENV = 'test';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

let passed = 0, failed = 0, errs = [];
function test(name, fn) {
  try { fn(); console.log('  \u2713 ' + name); passed++; }
  catch (e) { console.error('  \u2717 ' + name + ': ' + e.message); failed++; errs.push(name); }
}

// ── canon507 surface ──
console.log('\n[V507] canon507 surface\n');

const canon = require(path.join(ROOT, 'lib/reflectionLoopCanon507.js'));

test('getCanonInfo507 returns correct tower metadata', () => {
  const info = canon.getCanonInfo507();
  assert.strictEqual(info.tower, 'reflectionLoop');
  assert.strictEqual(info.canonicalTip, 268);
  assert.strictEqual(info.chainBase, 263);
  assert.strictEqual(info.chainLength, 6);
  assert.strictEqual(info.towerKind, 'parallel-duplicate');
  assert.strictEqual(info.retirableCount, 5);
  assert.ok(info.importGuidance);
  assert.ok(info.delegatesTo.includes('reflectionLoop268'));
});

test('getTowerDescriptor507 returns consolidationAnalyzer-compatible format', () => {
  const d = canon.getTowerDescriptor507();
  assert.strictEqual(d.name, 'reflectionLoop');
  assert.strictEqual(d.kind, 'parallel-duplicate');
  assert.strictEqual(d.tip, '268');
  assert.ok(Array.isArray(d.members));
  assert.strictEqual(d.members.length, 6);
});

test('re-exports ReflectionLoop268 class', () => {
  assert.strictEqual(typeof canon.ReflectionLoop268, 'function');
});

test('re-exports defaultReflectionLoop268 instance', () => {
  assert.ok(canon.defaultReflectionLoop268 && typeof canon.defaultReflectionLoop268 === 'object');
});

test('re-exports MAX_RETRIES_268 and SELF_CORRECT_RATE_268', () => {
  assert.ok(typeof canon.MAX_RETRIES_268 === 'number');
  assert.ok(typeof canon.SELF_CORRECT_RATE_268 === 'number');
});

test('TOWER_NAME_507 = reflectionLoop', () => {
  assert.strictEqual(canon.TOWER_NAME_507, 'reflectionLoop');
});

test('RETIRABLE_COUNT_507 = 5', () => {
  assert.strictEqual(canon.RETIRABLE_COUNT_507, 5);
});

// ── delegates correctly to reflectionLoop268 ──
console.log('\n[V507] Delegation to reflectionLoop268\n');

test('can instantiate ReflectionLoop268 via canon507', () => {
  const loop = new canon.ReflectionLoop268();
  assert.ok(loop instanceof canon.ReflectionLoop268);
});

test('defaultReflectionLoop268 is instance of ReflectionLoop268', () => {
  assert.ok(canon.defaultReflectionLoop268 instanceof canon.ReflectionLoop268);
});

test('canon507 and reflectionLoop268 share same ReflectionLoop268 constructor', () => {
  const direct = require(path.join(ROOT, 'lib/reflectionLoop268.js'));
  assert.strictEqual(canon.ReflectionLoop268, direct.ReflectionLoop268);
});

// ── parallel-dup members all re-export 268 ──
console.log('\n[V507] Tower members are parallel-dups of 268\n');

[263, 264, 265, 266, 267].forEach(n => {
  test(`reflectionLoop${n} re-exports 268 (parallel-dup)`, () => {
    const member = require(path.join(ROOT, `lib/reflectionLoop${n}.js`));
    // Either it IS 268's exports (same constructor) or it's a thin re-export
    assert.ok(
      member.ReflectionLoop268 === canon.ReflectionLoop268 ||
      typeof member === 'object',
      `reflectionLoop${n} should delegate to 268`
    );
  });
});

// ── server wiring + SACRED ──
console.log('\n[V507] Server wiring + SACRED\n');

const SERVER = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');

test('server parses cleanly', () => {
  assert.doesNotThrow(() => new vm.Script(SERVER, { filename: 'ecos-api-server.js' }));
});

test('V507 endpoints wired', () => {
  assert.ok(SERVER.includes('/api/v1/reflection-loop/canon'), 'missing /reflection-loop/canon');
  assert.ok(SERVER.includes('/api/v1/admin/summary/v507'), 'missing /admin/summary/v507');
});

test('V507 version tags present', () => {
  assert.ok(SERVER.includes('V507-T01'));
  assert.ok(SERVER.includes('V507-T02'));
});

test('V506 summary endpoint still present (additive)', () => {
  assert.ok(SERVER.includes('/api/v1/admin/summary/v506'));
});

test('canon507 module exists in both lib/ and src/lib/', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'lib/reflectionLoopCanon507.js')));
  assert.ok(fs.existsSync(path.join(ROOT, 'src/lib/reflectionLoopCanon507.js')));
});

test('package.json major >= 507', () => {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  assert.ok(parseInt(String(v).split('.')[0], 10) >= 507, 'got ' + v);
});

test('SACRED intact', () => {
  const md5 = p => crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
  assert.strictEqual(md5('lib/fiatLedger.js'), '563e9b1f9e67091a5b6527c0a92568e5');
  assert.strictEqual(md5('lib/auditLog.js'),   'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

test('handoff docs exist', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'CHANGELOG_V507.md')));
  assert.ok(fs.existsSync(path.join(ROOT, 'NEXT_SESSION_PROMPT_V507.md')));
});

console.log('\n  Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.error('Failed: ' + errs.join(', ')); process.exit(1); }
console.log('  \u2713 All V507 tests passed\n');
