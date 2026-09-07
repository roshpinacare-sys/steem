/**
 * tests/v472.test.js — ECOS V472 — economicIntegrity Canon Facade
 * Run: NODE_ENV=test node tests/v472.test.js
 * @version 472.0.0
 */
'use strict';
process.env.NODE_ENV = 'test';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

let passed = 0, failed = 0;
const errors = [];
function test(name, fn) {
  try { fn(); console.log('  \u2713 ' + name); passed++; }
  catch (e) { console.error('  \u2717 ' + name + ': ' + e.message); failed++; errors.push(name); }
}

// ── SACRED md5 ──
console.log('\n[V472] SACRED integrity check\n');

test('fiatLedger.js md5 unchanged', () => {
  const data = fs.readFileSync(path.join(ROOT, 'lib/fiatLedger.js'));
  const sum  = crypto.createHash('md5').update(data).digest('hex');
  assert.strictEqual(sum, '563e9b1f9e67091a5b6527c0a92568e5', 'fiatLedger.js SACRED hash mismatch');
});

test('auditLog.js md5 unchanged', () => {
  const data = fs.readFileSync(path.join(ROOT, 'lib/auditLog.js'));
  const sum  = crypto.createHash('md5').update(data).digest('hex');
  assert.strictEqual(sum, 'e5a5c2c27801d2d03991bc8e5a1df8cb', 'auditLog.js SACRED hash mismatch');
});

// ── server syntax ──
console.log('\n[V472] server syntax\n');

test('ecos-api-server.js parses cleanly (node --check)', () => {
  const { execSync } = require('child_process');
  execSync('node --check ' + path.join(ROOT, 'ecos-api-server.js'), { stdio: 'pipe' });
});

// ── canon472 module ──
console.log('\n[V472] economicIntegrityCanon472 module\n');

const canon = require(path.join(ROOT, 'lib/economicIntegrityCanon472.js'));

test('getCanonInfo472 returns correct tower metadata', () => {
  const info = canon.getCanonInfo472();
  assert.strictEqual(info.canonicalTip, 371, 'canonicalTip should be 371');
  assert.strictEqual(info.chainBase, 361, 'chainBase should be 361');
  assert.strictEqual(info.chainLength, 11, 'chainLength should be 11');
  assert.strictEqual(info.tower, 'economicIntegrityLoadBearing');
  assert.ok(info.version, 'version field present');
  assert.ok(info.proofBase, 'proofBase field present');
});

test('canon exposes LB371 surface', () => {
  assert.ok(canon.LB371, 'LB371 should be exported');
  assert.ok(typeof canon.buildSignedPrewarmAttestationFeedPage371 === 'function',
    'buildSignedPrewarmAttestationFeedPage371 should be a function');
  assert.ok(typeof canon.verifyRepoIntegrityRotationTranscript371 === 'function',
    'verifyRepoIntegrityRotationTranscript371 should be a function');
  assert.ok(typeof canon.simulateBreakGlassClear371 === 'function',
    'simulateBreakGlassClear371 should be a function');
  assert.ok(typeof canon.enforceDeliveryReplayCompactionPolicyAdaptive371 === 'function',
    'enforceDeliveryReplayCompactionPolicyAdaptive371 should be a function');
});

test('CANON_VERSION_472 is correct string', () => {
  assert.strictEqual(canon.CANON_VERSION_472, '472.0.0');
});

// ── src copy matches lib copy ──
console.log('\n[V472] src/lib mirror check\n');

test('src/lib/economicIntegrityCanon472.js exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'src/lib/economicIntegrityCanon472.js')),
    'src copy must exist');
});

test('src and lib canon472 are identical', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/economicIntegrityCanon472.js'));
  const lib = fs.readFileSync(path.join(ROOT, 'lib/economicIntegrityCanon472.js'));
  assert.ok(src.equals(lib), 'src/lib and lib copies must be byte-identical');
});

// ── endpoints wired in server ──
console.log('\n[V472] endpoint wiring check\n');

test('GET /api/v1/integrity/canon/status is wired in server', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  assert.ok(src.includes('/api/v1/integrity/canon/status'), 'V472-T01 endpoint missing');
});

test('GET /api/v1/admin/summary/v472 is wired in server', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  assert.ok(src.includes('/api/v1/admin/summary/v472'), 'V472-T02 endpoint missing');
});

// ── package version ──
console.log('\n[V472] package version\n');

test('package.json version >= 472', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(parseInt(pkg.version) >= 472, 'package.json version must be >= 472');
});

// ── summary ──
console.log('\n' + '─'.repeat(50));
console.log(`[V472] Results: ${passed} passed, ${failed} failed`);
if (errors.length) console.error('Failed:', errors.join(', '));
console.log('─'.repeat(50) + '\n');
process.exit(failed > 0 ? 1 : 0);
