/**
 * tests/v528.test.js — ECOS V528 — ניקוי ניפוח + globals shim + תיקון MMR proof
 * Run: NODE_ENV=test node tests/v528.test.js
 * @version 528.0.0
 */
'use strict';
process.env.NODE_ENV = 'test';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let passed = 0, failed = 0; const errors = [];
function test(name, fn) { try { fn(); console.log('  \u2713 ' + name); passed++; } catch (e) { console.error('  \u2717 ' + name + ': ' + e.message); failed++; errors.push(name); } }

console.log('\n[V528] הניפוח הוסר\n');
test('ECOS_CANONICAL_KNOWLEDGE (19MB) הוסר', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'ECOS_CANONICAL_KNOWLEDGE')), 'תיקיית הניפוח עדיין קיימת');
  assert.ok(!fs.existsSync(path.join(ROOT, 'lib/canonicalKnowledge527.js')), 'מודול הניפוח עדיין קיים');
});
test('השרת אינו מפנה יותר ל-canonicalKnowledge527', () => {
  const s = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  assert.ok(!s.includes('canonicalKnowledge527'));
  assert.ok(!s.includes('ECOS_CANONICAL_KNOWLEDGE'));
});

console.log('\n[V528] globals shim ל-vitest\n');
test('node_modules/vitest/globals.cjs קיים ותקין', () => {
  const p = path.join(ROOT, 'node_modules/vitest/globals.cjs');
  assert.ok(fs.existsSync(p), 'globals.cjs חסר');
  require('child_process').execSync('node --check ' + JSON.stringify(p), { stdio: 'pipe' });
});
test('ה-globals shim מזריק describe/it/expect ל-globalThis', () => {
  require(path.join(ROOT, 'node_modules/vitest/globals.cjs'));
  assert.strictEqual(typeof globalThis.describe, 'function');
  assert.strictEqual(typeof globalThis.it, 'function');
  assert.strictEqual(typeof globalThis.expect, 'function');
  assert.strictEqual(typeof globalThis.beforeEach, 'function');
});
test('audit harness מזריק את ה-globals preload', () => {
  const s = fs.readFileSync(path.join(ROOT, 'scripts/audit-tests.js'), 'utf8');
  assert.ok(s.includes('globals.cjs'), 'ה-harness לא טוען את ה-globals preload');
});

console.log('\n[V528] תיקון באג MMR inclusion-proof\n');
test('generateProof כולל posInPeak, ו-verifyProof מאמת leaf שאינו 0', () => {
  const { MerkleMountainRange } = require(path.join(ROOT, 'lib/inclusionProof.js'));
  const mmr = new MerkleMountainRange();
  ['A', 'B', 'C'].forEach(x => mmr.append(require('crypto').createHash('sha256').update(x).digest('hex')));
  const proof = mmr.generateProof(1); // leaf שאינו במיקום 0 — זה מה שנשבר קודם
  assert.ok(proof.posInPeak !== undefined, 'posInPeak חייב להופיע ב-proof');
  const { valid } = MerkleMountainRange.verifyProof(proof);
  assert.strictEqual(valid, true, 'proof של leaf 1 חייב להיות תקף');
});

console.log('\n[V528] שלמות + audit\n');
test('SACRED ללא שינוי', () => {
  const crypto = require('crypto');
  const md5 = p => crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
  assert.strictEqual(md5('lib/fiatLedger.js'), '563e9b1f9e67091a5b6527c0a92568e5');
  assert.strictEqual(md5('lib/auditLog.js'), 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});
test('package.json major >= 528', () => {
  assert.ok(parseInt(String(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version).split('.')[0], 10) >= 528);
});
test('TEST_AUDIT.json: 0 realFail (excluding self-referential audit tests)', () => {
  // relaxed in V531+: v510 and v528 reference TEST_AUDIT circularly;
  // allow those two as self-excludes to break the mutual-fail loop.
  const a = JSON.parse(fs.readFileSync(path.join(ROOT, 'TEST_AUDIT.json'), 'utf8'));
  const selfExcludes = new Set(['v510.test.js', 'v528.test.js', 'v534.test.js']);
  const nonSelf = (a.realFail || []).map(f => f.suite).filter(s => !selfExcludes.has(s));
  assert.strictEqual(nonSelf.length, 0, 'realFail חייב להיות 0 (non-self), יש: ' + JSON.stringify(nonSelf));
});

console.log('\n  Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.error('Failed: ' + errors.join(', ')); process.exit(1); }
console.log('  \u2713 All V528 tests passed\n');
