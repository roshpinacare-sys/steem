'use strict';
/**
 * V468 Tests — Canonical Cleanup Registry
 * SACRED + parse + cleanup unit tests + endpoint wiring + fail-closed
 */

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/* ── helpers ── */
function md5(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');
}
function exec(cmd) {
  try {
    const buf = require('node:child_process').execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true, out: buf };
  } catch (e) {
    return { ok: false, out: e.stdout || '', err: e.stderr || e.message };
  }
}

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log('  ✓ ' + name);
    passed += 1;
  } catch (e) {
    console.log('  ✗ ' + name + ' — ' + e.message);
    failed += 1;
  }
}

console.log('\n=== V468 Canonical Cleanup Registry Tests ===\n');

/* ── T01: SACRED files unchanged ── */
test('SACRED fiatLedger.js md5 intact', () => {
  const h = md5(path.join(ROOT, 'lib', 'fiatLedger.js'));
  assert.strictEqual(h, '563e9b1f9e67091a5b6527c0a92568e5');
});

test('SACRED auditLog.js md5 intact', () => {
  const h = md5(path.join(ROOT, 'lib', 'auditLog.js'));
  assert.strictEqual(h, 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

/* ── T02: Server parses cleanly ── */
test('ecos-api-server.js parses without error', () => {
  const r = exec('node --check ecos-api-server.js');
  assert.ok(r.ok, r.err || 'parse failed');
});

/* ── T03: cleanupRegistry468 module loads and behaves ── */
const cleanup468 = require(path.join(ROOT, 'lib', 'cleanupRegistry468.js'));

test('cleanupRegistry468 exports version ending in 468', () => {
  assert.strictEqual(cleanup468.CLEANUP_VERSION_468, '468');
});

test('getCleanupReport468 returns removed patch count 47', () => {
  const report = cleanup468.getCleanupReport468();
  assert.strictEqual(report.removed.patchFiles.count, 47);
  assert.ok(Array.isArray(report.removed.patchFiles.examples));
});

test('getCleanupReport468 returns removed image count 3', () => {
  const report = cleanup468.getCleanupReport468();
  assert.strictEqual(report.removed.images.count, 3);
  assert.ok(report.removed.images.approximateBytesSaved > 0);
});

test('getSummary468 returns correct version and endpoints', () => {
  const s = cleanup468.getSummary468();
  assert.strictEqual(s.version, 'V468');
  assert.ok(s.endpoints.some(e => e.includes('registry/cleanup')));
  assert.ok(s.endpoints.some(e => e.includes('admin/summary/v468')));
  assert.strictEqual(s.ecosVersion, 'V468');
});

/* ── T04: Unreferenced files actually deleted ── */
test('unreferenced patch v216-patch.js is deleted', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'ecos-api-server-v216-patch.js')));
});

test('unreferenced patch v436-patch.js is deleted', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'ecos-api-server-v436-patch.js')));
});

test('unreferenced image social_launch_card.png is deleted', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'gumloop', 'assets', 'social_launch_card.png')));
});

test('unreferenced script reembed-patches.js is deleted', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'scripts', 'reembed-patches.js')));
});

test('unreferenced test patch v216-patch.js is deleted', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'tests', 'ecos-api-server-v216-patch.js')));
});

/* ── T05: Referenced files still exist (do not break the base) ── */
test('referenced patch v225-patch.js still exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'ecos-api-server-v225-patch.js')));
});

test('referenced patch v243-patch.js still exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'ecos-api-server-v243-patch.js')));
});

test('referenced patch v248-patch.js still exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'ecos-api-server-v248-patch.js')));
});

/* ── T06: Fail-closed on bad input ── */
test('CleanupRegistryError468 carries code and statusCode', () => {
  const err = new cleanup468.CleanupRegistryError468('test error', 'TEST468');
  assert.strictEqual(err.code, 'TEST468');
  assert.strictEqual(err.statusCode, 500);
});

/* ── T07: Endpoint wiring presence in server source ── */
test('server source contains V468 registry/cleanup endpoint', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  assert.ok(src.includes("app.get('/api/v1/registry/cleanup'"));
  assert.ok(src.includes("app.get('/api/v1/admin/summary/v468'"));
});

test('server source contains V468 IIFE tag _wireCleanupRegistry468', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  assert.ok(src.includes('_wireCleanupRegistry468'));
});

/* ── T08: package.json version ── */
test('package.json version >= 468.0.0', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const major = parseInt(pkg.version.split('.')[0], 10);
  assert.ok(major >= 468, 'version is ' + pkg.version);
});

/* ── summary ── */
console.log('\n────────────────────────────────────────');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
console.log('────────────────────────────────────────\n');

process.exit(failed > 0 ? 1 : 0);
