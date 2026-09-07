/**
 * tests/v532.test.js — ECOS V532 — Heartbeat → Governance Bridge
 * Run: NODE_ENV=test node tests/v532.test.js
 * @version 532.0.0
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

// ── bridge532 factory ──
console.log('\n[V532] createBridge532 factory + validation\n');

const { createBridge532, BRIDGE_VERSION_532, BridgeError532 } = require(path.join(ROOT, 'lib/heartbeatGovernanceBridge532.js'));

test('throws BridgeError532 without buildSnapshot', () => {
  assert.throws(() => createBridge532({}), e => e instanceof BridgeError532 && e.code === 'BAD_OPTS');
});

test('BRIDGE_VERSION_532 = 532.0.0', () => {
  assert.strictEqual(BRIDGE_VERSION_532, '532.0.0');
});

test('createBridge532 returns required API', () => {
  const b = createBridge532({ buildSnapshot: () => ({ ok: true }) });
  assert.strictEqual(typeof b.onBeat, 'function');
  assert.strictEqual(typeof b.getSnapshot, 'function');
  assert.strictEqual(typeof b.stats, 'function');
  assert.strictEqual(typeof b._triggerNow532, 'function');
});

// ── fail-closed: no snapshot yet ──
console.log('\n[V532] Fail-closed: no snapshot yet\n');

test('getSnapshot() before any beat → { ok:false, reason:"not_started" }', () => {
  const b = createBridge532({ buildSnapshot: () => ({ ok: true }) });
  const snap = b.getSnapshot();
  assert.strictEqual(snap.ok, false);
  assert.strictEqual(snap.reason, 'not_started');
});

test('stats().beatsSeen = 0 before any beat', () => {
  const b = createBridge532({ buildSnapshot: () => ({ ok: true }) });
  assert.strictEqual(b.stats().beatsSeen, 0);
  assert.strictEqual(b.stats().hasSnapshot, false);
});

// ── onBeat → snapshot stored ──
console.log('\n[V532] onBeat → snapshot stored\n');

test('after onBeat, getSnapshot() returns ok:true with bridge metadata', () => {
  const b = createBridge532({ buildSnapshot: () => ({ ok: true, signal: 'GREEN', version: '531' }) });
  b.onBeat({ beatIndex: 1, mode: 'propose' });
  const snap = b.getSnapshot();
  assert.strictEqual(snap.ok, true);
  assert.strictEqual(snap.signal, 'GREEN');
  assert.ok(snap._bridge532 && snap._bridge532.version === BRIDGE_VERSION_532);
  assert.strictEqual(snap._bridge532.beatIndex, 1);
});

test('stats() after one beat: beatsSeen=1, snapshotsOk=1, snapshotsFailed=0', () => {
  const b = createBridge532({ buildSnapshot: () => ({ ok: true }) });
  b.onBeat({ beatIndex: 1 });
  const s = b.stats();
  assert.strictEqual(s.beatsSeen, 1);
  assert.strictEqual(s.snapshotsOk, 1);
  assert.strictEqual(s.snapshotsFailed, 0);
  assert.strictEqual(s.lastError, null);
  assert.strictEqual(s.hasSnapshot, true);
});

test('multiple beats accumulate correctly', () => {
  const b = createBridge532({ buildSnapshot: () => ({ ok: true }) });
  b.onBeat({ beatIndex: 1 }); b.onBeat({ beatIndex: 2 }); b.onBeat({ beatIndex: 3 });
  assert.strictEqual(b.stats().beatsSeen, 3);
  assert.strictEqual(b.stats().snapshotsOk, 3);
});

// ── fail-closed: buildSnapshot throws ──
console.log('\n[V532] Fail-closed: buildSnapshot errors\n');

test('buildSnapshot error is non-fatal — onBeat does not throw', () => {
  const b = createBridge532({ buildSnapshot: () => { throw new Error('governance unavailable'); } });
  assert.doesNotThrow(() => b.onBeat({ beatIndex: 1 }));
});

test('after failed snapshot, snapshotsFailed increments', () => {
  const b = createBridge532({ buildSnapshot: () => { throw new Error('fail'); } });
  b.onBeat({ beatIndex: 1 });
  const s = b.stats();
  assert.strictEqual(s.snapshotsFailed, 1);
  assert.ok(s.lastError.includes('fail'));
  assert.strictEqual(s.hasSnapshot, false);
});

test('after failed snapshot, getSnapshot still returns not_started', () => {
  const b = createBridge532({ buildSnapshot: () => { throw new Error('fail'); } });
  b.onBeat({ beatIndex: 1 });
  assert.strictEqual(b.getSnapshot().reason, 'not_started');
});

// ── stale snapshot ──
console.log('\n[V532] Stale snapshot detection\n');

test('stale sentinel contains lastOk and reason=stale', () => {
  // maxAge=0 ensures any snapshot is immediately stale
  const b = createBridge532({ buildSnapshot: () => ({ ok: true, signal: 'GREEN' }), maxAge: 0 });
  b.onBeat({ beatIndex: 1 });
  const snap = b.getSnapshot();
  assert.strictEqual(snap.ok, false);
  assert.strictEqual(snap.reason, 'stale');
  assert.ok(snap.lastOk && snap.lastOk.signal === 'GREEN');
});

// ── _triggerNow532 ──
console.log('\n[V532] _triggerNow532 manual trigger\n');

test('_triggerNow532 sets snapshot without heartbeat running', () => {
  const b = createBridge532({ buildSnapshot: () => ({ ok: true, signal: 'YELLOW' }) });
  b._triggerNow532();
  assert.strictEqual(b.getSnapshot().ok, true);
  assert.strictEqual(b.getSnapshot().signal, 'YELLOW');
});

// ── integration with diamondHeartbeat454 ──
console.log('\n[V532] Integration with diamondHeartbeat454\n');

test('bridge onBeat can be used as HB454 onBeat callback', () => {
  const { createHeartbeat454 } = require(path.join(ROOT, 'lib/diamondHeartbeat454.js'));
  const D453 = require(path.join(ROOT, 'lib/sovereignOperatorDiamond453.js'));
  const snapshots = [];
  const b = createBridge532({
    buildSnapshot: () => { snapshots.push(1); return { ok: true, signal: 'TEST' }; },
  });
  const hb = createHeartbeat454({
    collectSignals: () => ({}),
    assess: D453.assessSystem453,
    decide: D453.decide453,
    onBeat: (beat) => b.onBeat(beat),
  });
  hb._tickOnce();
  assert.strictEqual(snapshots.length, 1);
  assert.strictEqual(b.getSnapshot().signal, 'TEST');
});

test('bridge beatIndex matches HB beat index', () => {
  const { createHeartbeat454 } = require(path.join(ROOT, 'lib/diamondHeartbeat454.js'));
  const D453 = require(path.join(ROOT, 'lib/sovereignOperatorDiamond453.js'));
  const b = createBridge532({ buildSnapshot: () => ({ ok: true }) });
  const hb = createHeartbeat454({
    collectSignals: () => ({}),
    assess: D453.assessSystem453,
    decide: D453.decide453,
    onBeat: (beat) => b.onBeat(beat),
  });
  hb._tickOnce(); hb._tickOnce();
  assert.strictEqual(b.stats().beatsSeen, 2);
  assert.strictEqual(b.getSnapshot()._bridge532.beatIndex, 2);
});

// ── server wiring + SACRED ──
console.log('\n[V532] Server wiring + SACRED\n');

const SERVER = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');

test('server parses cleanly', () => {
  assert.doesNotThrow(() => new vm.Script(SERVER, { filename: 'ecos-api-server.js' }));
});

test('all V532 endpoints wired', () => {
  [
    '/api/v1/diamond/heartbeat/governance/start',
    '/api/v1/diamond/heartbeat/governance/stop',
    '/api/v1/diamond/heartbeat/governance-state',
    '/api/v1/diamond/heartbeat/governance/stats',
    '/api/v1/admin/summary/v532',
  ].forEach(p => assert.ok(SERVER.includes(p), 'missing: ' + p));
});

test('V532 version tags present', () => {
  ['V532-T01','V532-T02','V532-T03','V532-T04','V532-T05'].forEach(t =>
    assert.ok(SERVER.includes(t), 'missing tag: ' + t));
});

test('V531 summary endpoint still present (additive)', () => {
  assert.ok(SERVER.includes('/api/v1/admin/summary/v531'));
});

test('V454 diamond/heartbeat/start still present (additive)', () => {
  assert.ok(SERVER.includes('/api/v1/diamond/heartbeat/start'));
});

test('bridge module exists in both lib/ and src/lib/', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'lib/heartbeatGovernanceBridge532.js')));
  assert.ok(fs.existsSync(path.join(ROOT, 'src/lib/heartbeatGovernanceBridge532.js')));
});

test('package.json major >= 532', () => {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  assert.ok(parseInt(String(v).split('.')[0], 10) >= 532, 'got ' + v);
});

test('SACRED intact', () => {
  const md5 = p => crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
  assert.strictEqual(md5('lib/fiatLedger.js'), '563e9b1f9e67091a5b6527c0a92568e5');
  assert.strictEqual(md5('lib/auditLog.js'),   'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

test('handoff docs exist', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'CHANGELOG_V532.md')));
  assert.ok(fs.existsSync(path.join(ROOT, 'NEXT_SESSION_PROMPT_V532.md')));
});

console.log('\n  Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.error('Failed: ' + errs.join(', ')); process.exit(1); }
console.log('  \u2713 All V532 tests passed\n');
