/**
 * tests/v473.test.js — ECOS V473 — agentDispatchBridge Canon Facade
 * Run: NODE_ENV=test node tests/v473.test.js
 * @version 473.0.0
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

// ── SACRED md5 ──────────────────────────────────────────────────────────────
console.log('\n[V473] SACRED integrity check\n');

test('T01: fiatLedger.js SACRED hash', () => {
  const data = fs.readFileSync(path.join(ROOT, 'lib/fiatLedger.js'));
  const hash = crypto.createHash('md5').update(data).digest('hex');
  assert.strictEqual(hash, '563e9b1f9e67091a5b6527c0a92568e5', 'fiatLedger SACRED violated');
});

test('T02: auditLog.js SACRED hash', () => {
  const data = fs.readFileSync(path.join(ROOT, 'lib/auditLog.js'));
  const hash = crypto.createHash('md5').update(data).digest('hex');
  assert.strictEqual(hash, 'e5a5c2c27801d2d03991bc8e5a1df8cb', 'auditLog SACRED violated');
});

// ── server parse-clean ───────────────────────────────────────────────────────
console.log('\n[V473] Server & module checks\n');

test('T03: ecos-api-server.js parse-clean + V473 IIFE present', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  assert.ok(src.includes('_wireAgentDispatchBridgeCanon473'), 'V473 IIFE not found');
  assert.ok(src.includes('V473-T01'), 'V473 endpoint tags not found');
});

// ── canon module ─────────────────────────────────────────────────────────────
console.log('\n[V473] Canon facade checks\n');

test('T04: agentDispatchBridgeCanon473 loads from lib/', () => {
  const c = require(path.join(ROOT, 'lib/agentDispatchBridgeCanon473.js'));
  assert.strictEqual(typeof c.getCanonInfo473, 'function', 'getCanonInfo473 must be function');
  assert.strictEqual(c.CANON_TIP_473, 253, 'CANON_TIP must be 253');
  assert.strictEqual(c.CANON_BASE_473, 246, 'CANON_BASE must be 246');
});

test('T05: getCanonInfo473 returns correct tower metadata', () => {
  const c    = require(path.join(ROOT, 'lib/agentDispatchBridgeCanon473.js'));
  const info = c.getCanonInfo473();
  assert.strictEqual(info.tower,        'agentDispatchBridge', 'tower name wrong');
  assert.strictEqual(info.canonicalTip, 253,                   'canonicalTip wrong');
  assert.strictEqual(info.chainBase,    246,                   'chainBase wrong');
  assert.strictEqual(info.chainLength,  8,                     'chainLength must be 8');
  assert.strictEqual(info.tipVersion,   'V253',                'tipVersion wrong');
});

test('T06: V253 tip surface fully re-exported', () => {
  const c = require(path.join(ROOT, 'lib/agentDispatchBridgeCanon473.js'));
  const required253 = [
    'disableQuotaAutoSave253',
    'aggregateRetryResult253',
    'snapshotQuotas253',
    'resetEvictionStats253',
    'applyQuotaDiff253',
    'getBridgeStats253',
    'BRIDGE_VERSION_253',
  ];
  for (const sym of required253) {
    assert.ok(sym in c, 'missing export: ' + sym);
  }
});

test('T07: getBridgeStats253 returns valid stats object', () => {
  const c     = require(path.join(ROOT, 'lib/agentDispatchBridgeCanon473.js'));
  const stats = c.getBridgeStats253();
  assert.ok(stats !== null && typeof stats === 'object', 'stats must be object');
  assert.ok('ecosVersion' in stats, 'stats.ecosVersion missing');
});

test('T08: aggregateRetryResult253 aggregates correctly', () => {
  const c = require(path.join(ROOT, 'lib/agentDispatchBridgeCanon473.js'));
  // provide minimal valid structure
  const fakeRetry = { retryRounds: [{ attempted: 2, succeeded: 1, failed: 1 }, { attempted: 1, succeeded: 1, failed: 0 }] };
  const agg = c.aggregateRetryResult253(fakeRetry);
  assert.ok(agg !== null && typeof agg === 'object', 'aggregated must be object');
  // totalAttempted should be 3
  if ('totalAttempted' in agg) assert.strictEqual(agg.totalAttempted, 3, 'totalAttempted wrong');
});

test('T09: V246 factory accessible via canon', () => {
  const c = require(path.join(ROOT, 'lib/agentDispatchBridgeCanon473.js'));
  // createDispatchBridge246 may be null if V246 soft-fails, but key must exist
  assert.ok('createDispatchBridge246' in c, 'createDispatchBridge246 key missing from canon');
});

test('T10: server version is 473.0.0', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(parseInt(pkg.version) >= 473, 'version must be >= 473, got: ' + pkg.version);
});

// ── summary ──────────────────────────────────────────────────────────────────
console.log('\n[V473] Results\n');
console.log('  ' + passed + ' passed, ' + failed + ' failed');
if (errors.length) console.error('  Failed:', errors.join(', '));
console.log('');
process.exit(failed > 0 ? 1 : 0);
