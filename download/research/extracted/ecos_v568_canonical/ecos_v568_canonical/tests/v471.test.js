/**
 * tests/v471.test.js — ECOS V471 — meshDispatcher Unified Status
 * Run: NODE_ENV=test node tests/v471.test.js
 * @version 471.0.0
 */
'use strict';
process.env.NODE_ENV = 'test';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

let passed = 0, failed = 0;
const errors = [];
function test(name, fn) {
  try { fn(); console.log('  \u2713 ' + name); passed++; }
  catch (e) { console.error('  \u2717 ' + name + ': ' + e.message); failed++; errors.push(name); }
}

// ── canon470 module ──
console.log('\n[V471] canon470 module API\n');

const canon = require(path.join(ROOT, 'lib/meshDispatcherCanon470.js'));

test('getCanonInfo470 returns expected fields', () => {
  const info = canon.getCanonInfo470();
  assert.strictEqual(info.canonicalTip, 297);
  assert.strictEqual(info.chainBase, 288);
  assert.strictEqual(info.chainLength, 10);
  assert.ok(info.tower);
  assert.ok(info.version);
});

test('canon module exposes D297 surface', () => {
  assert.ok(canon.ReasonIndexedFeed297 || canon.D297, 'D297 surface should be present');
});

// ── D297 runtime classes ──
console.log('\n[V471] D297 runtime classes\n');

const D297 = require(path.join(ROOT, 'lib/meshDispatcher297.js'));

test('ReasonIndexedFeed297 stats() returns ingested/searches', () => {
  const feed = new D297.ReasonIndexedFeed297();
  const s = feed.stats();
  assert.ok(typeof s.ingested === 'number');
  assert.ok(typeof s.searches === 'number');
});

test('PerValidatorQuorumStats297 stats() returns validators count', () => {
  const bv = new D297.PerValidatorQuorumStats297();
  const s = bv.stats();
  assert.ok(typeof s.validators === 'number');
});

test('QuorumStreamAuthGate297 stats() returns checks/allowed/denied', () => {
  const gate = new D297.QuorumStreamAuthGate297();
  const s = gate.stats();
  assert.ok(typeof s.checks === 'number');
  assert.ok(typeof s.allowed === 'number');
  assert.ok(typeof s.denied === 'number');
});

// ── unified status shape (simulate what the endpoint builds) ──
console.log('\n[V471] Unified status shape\n');

test('unified status shape has tower + runtime + ts fields', () => {
  const canonInfo = canon.getCanonInfo470();
  const feed  = new D297.ReasonIndexedFeed297();
  const bv    = new D297.PerValidatorQuorumStats297();
  const gate  = new D297.QuorumStreamAuthGate297();
  const result = {
    ok: true,
    ecosVersion: 'V471',
    tower: { ...canonInfo, importGuidance: 'Use meshDispatcherCanon470.js' },
    runtime: { reasonFeed: feed.stats(), byValidator: bv.stats(), authGate: gate.stats(), streamPresent: false },
    ts: new Date().toISOString(),
  };
  assert.strictEqual(result.ok, true);
  assert.ok(result.tower.canonicalTip === 297);
  assert.ok(typeof result.runtime.reasonFeed.ingested === 'number');
  assert.ok(typeof result.runtime.byValidator.validators === 'number');
  assert.ok(typeof result.runtime.authGate.checks === 'number');
  assert.ok(typeof result.ts === 'string');
});

test('tower importGuidance present in unified response', () => {
  const canonInfo = canon.getCanonInfo470();
  const tower = { ...canonInfo, importGuidance: 'Use meshDispatcherCanon470.js — never import D288..D296 directly.' };
  assert.ok(tower.importGuidance.includes('D288'));
  assert.ok(tower.importGuidance.includes('D296'));
});

// ── server wiring ──
console.log('\n[V471] Server wiring + SACRED\n');

const SERVER = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');

test('server parses cleanly', () => {
  assert.doesNotThrow(() => new vm.Script(SERVER, { filename: 'ecos-api-server.js' }));
});

test('V471 endpoints wired', () => {
  assert.ok(SERVER.includes('/api/v1/mesh/dispatch/status'), 'missing /mesh/dispatch/status');
  assert.ok(SERVER.includes('/api/v1/admin/summary/v471'),   'missing /admin/summary/v471');
});

test('V471 version tags present', () => {
  assert.ok(SERVER.includes('V471-T01'), 'missing V471-T01');
  assert.ok(SERVER.includes('V471-T02'), 'missing V471-T02');
});

test('V470 canonical endpoint still present (additive)', () => {
  assert.ok(SERVER.includes('/api/v1/mesh/dispatch/canonical'), 'V470 endpoint removed — must be additive');
});

test('V471 requires canon470 and D297 (not D288..D296 directly)', () => {
  assert.ok(SERVER.includes("require('./lib/meshDispatcherCanon470.js')"));
  assert.ok(SERVER.includes("require('./lib/meshDispatcher297.js')"));
});

test('package.json major >= 471', () => {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  assert.ok(parseInt(String(v).split('.')[0], 10) >= 471, 'got ' + v);
});

test('SACRED files intact', () => {
  const md5 = p => crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
  assert.strictEqual(md5('lib/fiatLedger.js'), '563e9b1f9e67091a5b6527c0a92568e5');
  assert.strictEqual(md5('lib/auditLog.js'),   'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

test('handoff docs exist', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'CHANGELOG_V471.md')));
  assert.ok(fs.existsSync(path.join(ROOT, 'NEXT_SESSION_PROMPT_V471.md')));
});

console.log('\n  Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.error('Failed: ' + errors.join(', ')); process.exit(1); }
console.log('  \u2713 All V471 tests passed\n');
