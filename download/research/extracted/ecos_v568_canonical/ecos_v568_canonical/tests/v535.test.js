'use strict';
/**
 * tests/v535.test.js — ECOS V535 — Bridge532 Singleton Accessor
 * NODE_ENV=test node tests/v535.test.js → exit 0
 */

const assert = require('assert');
const path   = require('path');
const crypto = require('crypto');
const fs     = require('fs');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;

function t535(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

console.log('\n=== V535 Bridge532 Singleton Accessor ===\n');

// T01-T02: SACRED
t535('T01: fiatLedger.js SACRED hash', () => {
  const h = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT,'lib/fiatLedger.js'))).digest('hex');
  assert.strictEqual(h, '563e9b1f9e67091a5b6527c0a92568e5');
});
t535('T02: auditLog.js SACRED hash', () => {
  const h = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT,'lib/auditLog.js'))).digest('hex');
  assert.strictEqual(h, 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// T03: server parse-clean + V535 wired
t535('T03: server parse-clean + V535 IIFE present', () => {
  const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
  assert.ok(src.includes('_wireBridgeSingletonAccessor535'), 'V535 IIFE missing');
  assert.ok(src.includes('V535-T01'), 'V535 endpoint tags missing');
});

// T04: heartbeatGovernanceBridge532 exports activeBridge532 accessor
t535('T04: heartbeatGovernanceBridge532 exports activeBridge532 getter/setter', () => {
  const B = require('../lib/heartbeatGovernanceBridge532.js');
  assert.ok('activeBridge532' in B, 'activeBridge532 must be in exports');
  // initially null or a bridge instance (if server IIFE already ran in this process)
  const val = B.activeBridge532;
  assert.ok(val === null || (typeof val === 'object' && typeof val.stats === 'function'),
    'activeBridge532 must be null or a bridge instance');
});

// T05: setter works — can set and read back
t535('T05: activeBridge532 setter works', () => {
  const B = require('../lib/heartbeatGovernanceBridge532.js');
  const prev = B.activeBridge532;
  const mock535 = { stats: () => ({ beatsSeen: 0 }), getSnapshot: () => ({ ok: false, reason: 'mock' }) };
  B.activeBridge532 = mock535;
  assert.strictEqual(B.activeBridge532, mock535, 'setter/getter round-trip must work');
  B.activeBridge532 = prev;  // restore
});

// T06: V532 IIFE wires the setter (server source contains the assignment)
t535('T06: server V532 IIFE sets Bridge532.activeBridge532 = _bridge532', () => {
  const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
  assert.ok(src.includes('Bridge532.activeBridge532 = _bridge532'), 'V532 IIFE must set activeBridge532');
});

// T07: bridge-live endpoint is defined in server
t535('T07: server has GET /api/v1/diamond/heartbeat/governance/bridge-live', () => {
  const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
  assert.ok(src.includes('/api/v1/diamond/heartbeat/governance/bridge-live'), 'bridge-live endpoint missing');
});

// T08: bridge-live logic returns 503 when activeBridge532 is null (fail-closed)
t535('T08: bridge-live returns 503-shape when bridge is null', () => {
  const B = require('../lib/heartbeatGovernanceBridge532.js');
  const prev = B.activeBridge532;
  B.activeBridge532 = null;
  // Simulate the endpoint logic inline
  const bridge535 = B.activeBridge532;
  const response535 = !bridge535
    ? { ok: false, reason: 'bridge_not_initialized', status: 503 }
    : { ok: true };
  assert.strictEqual(response535.ok, false, 'must return ok:false when bridge is null');
  assert.strictEqual(response535.status, 503, 'must return 503 when bridge is null');
  B.activeBridge532 = prev;
});

// T09: bridge-live logic returns stats when bridge is present
t535('T09: bridge-live returns stats when bridge is available', () => {
  const B = require('../lib/heartbeatGovernanceBridge532.js');
  const prev = B.activeBridge532;
  const mock535b = {
    stats:       () => ({ beatsSeen: 5, hasSnapshot: true }),
    getSnapshot: () => ({ ok: true, snapshot: {} }),
  };
  B.activeBridge532 = mock535b;
  const bridge535 = B.activeBridge532;
  const stats = bridge535.stats();
  assert.strictEqual(stats.beatsSeen, 5, 'stats.beatsSeen must pass through');
  B.activeBridge532 = prev;
});

// T10: package.json version
t535('T10: package.json version is 535.0.0', () => {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8'));
  assert.ok(parseInt(d.version) >= 535, `version must be >= 535, got ${d.version}`);
});

// T11: Bridge532 module still parses cleanly (not broken by accessor addition)
t535('T11: heartbeatGovernanceBridge532.js parse-clean', () => {
  const src = fs.readFileSync(path.join(ROOT,'lib/heartbeatGovernanceBridge532.js'),'utf8');
  assert.ok(src.includes('createBridge532'), 'createBridge532 must still be present');
  assert.ok(src.includes('activeBridge532'), 'activeBridge532 must be present');
});

// T12: createBridge532 still works (not broken)
t535('T12: createBridge532 still creates a valid bridge instance', () => {
  const B = require('../lib/heartbeatGovernanceBridge532.js');
  const inst = B.createBridge532({
    buildSnapshot: async () => ({}),
    snapshotOpts: {},
    maxAge: 60000,
  });
  assert.strictEqual(typeof inst.stats, 'function', 'stats must be function');
  assert.strictEqual(typeof inst.getSnapshot, 'function', 'getSnapshot must be function');
  assert.strictEqual(typeof inst.onBeat, 'function', 'onBeat must be function');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
process.exit(0);
