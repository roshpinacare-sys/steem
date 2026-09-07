/**
 * tests/v502.test.js — ECOS V502 (Phase P381) — Honest Test Audit
 * Run: NODE_ENV=test node tests/v502.test.js
 * @version 502.0.0
 */
'use strict';
process.env.NODE_ENV = 'test';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const A = require(path.join(ROOT, 'src/lib/testAuditHarness502.js'));

let passed = 0, failed = 0; const errors = [];
function test(name, fn) { try { fn(); console.log('  \u2713 ' + name); passed++; } catch (e) { console.error('  \u2717 ' + name + ': ' + e.message); failed++; errors.push(name); } }

console.log('\n[V502] Honest audit harness + report\n');
test('audit generator script exists and parses', () => {
  const p = path.join(ROOT, 'scripts/audit-tests.js');
  assert.ok(fs.existsSync(p), 'scripts/audit-tests.js missing');
  assert.doesNotThrow(() => new vm.Script(fs.readFileSync(p, 'utf8'), { filename: 'audit-tests.js' }));
});
test('TEST_AUDIT.json exists with full counts (no sampling)', () => {
  const a = A.loadAudit502(ROOT);
  assert.ok(a.total >= 100, 'audit should cover the whole suite, got total ' + a.total);
  assert.ok(a.counts && typeof a.counts.pass === 'number' && typeof a.counts.cannotRun === 'number' && typeof a.counts.realFail === 'number');
  assert.strictEqual(a.total, a.counts.pass + a.counts.cannotRun + a.counts.realFail, 'buckets must sum to total');
});
test('summary states the honest caveat about unverified suites', () => {
  const s = A.summarize502(ROOT);
  assert.ok(s.cannotRun >= 1, 'there are suites that cannot run here');
  assert.ok(/NOT verified|not verified/i.test(s.honestCaveat), 'must disclose what is not verified');
  assert.ok(s.verifiableHerePct >= 0 && s.verifiableHerePct <= 100);
});
test('real failures are listed explicitly (not hidden)', () => {
  const s = A.summarize502(ROOT);
  assert.ok(Array.isArray(s.realFailures));
  s.realFailures.forEach(f => assert.ok(f.suite && f.reason));
});

console.log('\n[V502] The V497 regression is corrected\n');
test('the 11 test-referenced modules archived by V497 were restored to lib/', () => {
  ['providerAdapters267', 'alertDigest279', 'alertEscalation277', 'alertSla278', 'digestScheduler281',
   'notificationChannel280', 'notificationChannel283', 'notificationChannelFilter284', 'notificationTemplate282',
   'presetGroups286', 'filterPresets285'].forEach(n => {
    assert.ok(fs.existsSync(path.join(ROOT, 'lib', n + '.js')), n + ' must be restored to lib/');
  });
});
test('the V497 manifest is now truthful (lists only still-archived modules)', () => {
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, '_archive_orphans_v497/MANIFEST.json'), 'utf8'));
  man.modules.forEach(n => assert.ok(!fs.existsSync(path.join(ROOT, 'lib', n + '.js')), 'manifest lists ' + n + ' but it is in lib/'));
  assert.strictEqual(man.count, man.modules.length);
});
test('v482 (the suite my V497 cleanup broke) is no longer in real failures', () => {
  const s = A.summarize502(ROOT);
  assert.ok(!s.realFailures.some(f => f.suite === 'v482.test.js'), 'v482 should pass now');
});

console.log('\n[V502] Server wiring + sacred\n');
const SERVER = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
test('server parses, no corruption', () => {
  assert.doesNotThrow(() => new vm.Script(SERVER, { filename: 'ecos-api-server.js' }));
  assert.ok(!SERVER.includes('__manus_ec'));
});
test('test-audit endpoints + tags wired', () => {
  assert.ok(SERVER.includes('/api/v1/admin/test-audit/v502'));
  ['V502-T01', 'V502-T02'].forEach(t => assert.ok(SERVER.includes(t)));
  assert.ok(SERVER.includes("require('./lib/testAuditHarness502.js')"));
});
test('package.json major >= 502', () => {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  assert.ok(parseInt(String(v).split('.')[0], 10) >= 502, 'got ' + v);
});
test('SACRED files intact (canonical MD5)', () => {
  const crypto = require('crypto');
  const md5 = p => crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
  assert.strictEqual(md5('lib/fiatLedger.js'), '563e9b1f9e67091a5b6527c0a92568e5');
  assert.strictEqual(md5('lib/auditLog.js'), 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});
test('handoff docs exist', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'CHANGELOG_V502.md')));
  assert.ok(fs.existsSync(path.join(ROOT, 'NEXT_SESSION_PROMPT_V502.md')));
  assert.ok(fs.existsSync(path.join(ROOT, 'TEST_AUDIT_V502.md')));
});

console.log('\n  Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.error('Failed: ' + errors.join(', ')); process.exit(1); }
console.log('  \u2713 All V502 tests passed\n');
