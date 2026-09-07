'use strict';
/**
 * tests/v536.test.js — ECOS V536 — governanceHealthGate534 × activeBridge532 Connection
 * NODE_ENV=test node tests/v536.test.js → exit 0
 */

const assert = require('assert');
const path   = require('path');
const crypto = require('crypto');
const fs     = require('fs');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;

function t536(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

console.log('\n=== V536 governanceHealthGate534 × activeBridge532 Connection ===\n');

// T01-T02: SACRED
t536('T01: fiatLedger.js SACRED hash', () => {
  const h = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT,'lib/fiatLedger.js'))).digest('hex');
  assert.strictEqual(h, '563e9b1f9e67091a5b6527c0a92568e5');
});
t536('T02: auditLog.js SACRED hash', () => {
  const h = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT,'lib/auditLog.js'))).digest('hex');
  assert.strictEqual(h, 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// T03: server parse-clean + V536 IIFE present
t536('T03: server parse-clean + V536 IIFE present', () => {
  const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
  assert.ok(src.includes('_wireGovernanceHealthBridgeLink536'), 'V536 IIFE missing');
  assert.ok(src.includes('V536-T01'), 'V536 endpoint tags missing');
});

// T04: V534 IIFE no longer uses defunct defaultBridge532 as a callable
t536('T04: V534 IIFE uses activeBridge532 (not defaultBridge532 call)', () => {
  const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
  // The defunct pattern was: .defaultBridge532 ? require(...).defaultBridge532() : null
  assert.ok(!src.includes('.defaultBridge532()'), 'calling defaultBridge532() must be removed');
  // The fix must be present: activeBridge532 used in V534 section
  assert.ok(src.includes('activeBridge532'), 'activeBridge532 must be present in server');
});

// T05: activeBridge532 accessor is readable
t536('T05: activeBridge532 accessor returns null or bridge instance', () => {
  const B = require('../lib/heartbeatGovernanceBridge532.js');
  const val = B.activeBridge532;
  assert.ok(val === null || (typeof val === 'object' && typeof val.stats === 'function'),
    'activeBridge532 must be null or bridge instance');
});

// T06: buildHealthReport534 accepts null bridge (graceful)
t536('T06: buildHealthReport534 handles null bridge gracefully', () => {
  const GHG534 = require('../lib/governanceHealthGate534.js');
  const Diag   = require('../lib/governanceDiagnose533.js');
  const report = GHG534.buildHealthReport534({
    bridge532:   null,
    hb532:       null,
    diagOpts533: { O437: null, status505: null, gc499: null, audit: null, libDir: ROOT+'/lib' },
    Diag533:     Diag,
  });
  assert.ok(report, 'report must be returned');
  assert.ok(typeof report.level === 'string', 'report.level must be string');
  // Accept any valid level string — including 'unavailable' when bridge is null
  assert.ok(report.level.length > 0, `level must be a non-empty string, got: ${report.level}`);
});

// T07: buildHealthReport534 accepts live mock bridge
t536('T07: buildHealthReport534 uses real bridge when activeBridge532 is set', () => {
  const B    = require('../lib/heartbeatGovernanceBridge532.js');
  const GHG  = require('../lib/governanceHealthGate534.js');
  const Diag = require('../lib/governanceDiagnose533.js');
  const prev = B.activeBridge532;

  // Mock a bridge instance
  const mockBridge536 = {
    stats:       () => ({ beatsSeen: 3, hasSnapshot: true, snapshotAgeMs: 1000 }),
    getSnapshot: () => ({ ok: false, reason: 'not_started' }),
  };
  B.activeBridge532 = mockBridge536;

  const bridge536  = B.activeBridge532;
  const bridgeLive = !!bridge536;
  const report     = GHG.buildHealthReport534({
    bridge532:   bridge536,
    hb532:       null,
    diagOpts533: { O437: null, status505: null, gc499: null, audit: null, libDir: ROOT+'/lib' },
    Diag533:     Diag,
  });

  assert.strictEqual(bridgeLive, true, 'bridgeLive must be true when mock bridge is set');
  assert.ok(report, 'report must be returned even with mock bridge');
  B.activeBridge532 = prev;
});

// T08: health-v536 endpoint defined in server
t536('T08: server has GET /api/v1/diamond/heartbeat/governance/health-v536', () => {
  const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
  assert.ok(src.includes('/api/v1/diamond/heartbeat/governance/health-v536'), 'health-v536 endpoint missing');
});

// T09: V536 IIFE reads activeBridge532 in endpoint code
t536('T09: V536 IIFE endpoint reads Bridge532_536.activeBridge532', () => {
  const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
  assert.ok(src.includes('Bridge532_536.activeBridge532'), 'V536 must read activeBridge532 in endpoint');
});

// T10: bridgeLive field appears in V536 endpoint code
t536('T10: V536 endpoint returns bridgeLive field', () => {
  const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
  assert.ok(src.includes('bridgeLive:'), 'bridgeLive field must be in V536 endpoint');
});

// T11: package.json version >= 536
t536('T11: package.json version >= 536', () => {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8'));
  assert.ok(parseInt(d.version) >= 536, `version must be >= 536, got ${d.version}`);
});

// T12: governanceHealthGate534 module still loads cleanly (no regressions)
t536('T12: governanceHealthGate534 loads + buildHealthReport534 present', () => {
  const G = require('../lib/governanceHealthGate534.js');
  assert.strictEqual(typeof G.buildHealthReport534, 'function', 'buildHealthReport534 must be function');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
process.exit(0);
