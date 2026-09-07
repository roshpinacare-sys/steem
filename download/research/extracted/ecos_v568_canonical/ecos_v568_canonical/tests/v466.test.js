'use strict';
/**
 * V466 Tests — Diamond ↔ Orchestrator Bridge
 * SACRED + parse + bridge unit tests + endpoint wiring + fail-closed
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
    passed++;
    console.log('  ✓', name);
  } catch (e) {
    failed++;
    console.error('  ✗', name, '—', e.message);
  }
}

/* ════════════════════════════════════════ */
console.log('\n[V466] Diamond-Orchestrator Bridge Tests\n');

/* T1 — SACRED md5 */
test('SACRED lib/fiatLedger.js md5 unchanged', () => {
  assert.strictEqual(md5(path.join(ROOT, 'lib/fiatLedger.js')), '563e9b1f9e67091a5b6527c0a92568e5');
});
test('SACRED lib/auditLog.js md5 unchanged', () => {
  assert.strictEqual(md5(path.join(ROOT, 'lib/auditLog.js')), 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

/* T2 — server parse clean */
test('ecos-api-server.js parses cleanly (node --check)', () => {
  const r = exec('node --check ecos-api-server.js');
  assert.strictEqual(r.ok, true, r.err);
});

/* T3 — bridge module loads */
const bridge = require(path.join(ROOT, 'lib/diamondOrchestratorBridge466.js'));
test('bridge module exports version 466', () => {
  assert.strictEqual(bridge.ORCH_BRIDGE_VERSION_466, '466');
  assert.strictEqual(typeof bridge.syncHeartbeatToOrchestrator466, 'function');
  assert.strictEqual(typeof bridge.getDiamondOrchestratorStatus466, 'function');
});

/* T4 — status without heartbeat (fail-closed graceful) */
test('status without heartbeat returns ok but not connected', () => {
  const st = bridge.getDiamondOrchestratorStatus466();
  assert.strictEqual(st.ok, true);
  assert.strictEqual(st.version, '466');
  assert.strictEqual(st.connected, false);
  assert.strictEqual(st.heartbeat, null);
});

/* T5 — sync without heartbeat (fail-closed) */
test('sync without heartbeat returns error HEARTBEAT_MISSING', () => {
  const res = bridge.syncHeartbeatToOrchestrator466({});
  assert.strictEqual(res.ok, false);
  assert.ok(res.code === 'HEARTBEAT_MISSING' || res.code === 'BEAT_MISSING' || res.code === 'ORCH_MISSING', 'expected fail-closed code, got ' + res.code);
});

/* T6 — sync with mocked heartbeat but no beat record (fail-closed) */
test('sync with empty heartbeat returns BEAT_MISSING', () => {
  const fakeHb = { status465: () => ({ running: true, totalBeats: 0, lastBeat: null }) };
  const res = bridge.syncHeartbeatToOrchestrator466({ heartbeat: fakeHb });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.code, 'BEAT_MISSING');
});

/* T7 — sync with mocked heartbeat + beat record succeeds */
test('sync with valid beat record produces non-money plan and executes', () => {
  const fakeHb = {
    status465: () => ({
      running: true,
      totalBeats: 1,
      lastBeat: {
        at: new Date().toISOString(),
        ok: true,
        state: { healthScore: 0.92, solvencySurplus: 1000000n, dissatisfaction: 0.05 },
        trends: { earlyWarningsCount: 0, ready: true },
        proactive: { actionsCount: 1, proactive: true, actions: [{ action: 'scale', reason: 'load', urgency: 2 }] },
      },
    }),
  };
  const res = bridge.syncHeartbeatToOrchestrator466({ heartbeat: fakeHb });
  assert.strictEqual(res.ok, true, res.error);
  assert.strictEqual(res.version, '466');
  assert.strictEqual(res.plan.moneySteps, 0, 'bridge must never generate money steps');
  assert.strictEqual(res.plan.requiresGuard, false);
  assert.strictEqual(res.execution.completed, true);
  assert.strictEqual(res.execution.halted, false);
  assert.strictEqual(res.execution.executed, 1);
});

/* T8 — server contains V466 endpoint wiring */
test('server contains V466 endpoint declarations', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  assert.ok(src.includes("POST /api/v1/diamond/orchestrator/sync"), 'missing sync endpoint');
  assert.ok(src.includes("GET  /api/v1/diamond/orchestrator/status"), 'missing status endpoint');
  assert.ok(src.includes("/api/v1/admin/summary/v466"), 'missing admin summary endpoint');
  assert.ok(src.includes("V466"), 'missing V466 tag');
});

/* T9 — package.json version relaxed >= 466 */
test('package.json version >= 466', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const major = parseInt(pkg.version);
  assert.ok(major >= 466, 'package.json version must be >= 466, got ' + pkg.version);
});

/* ════════════════════════════════════════ */
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\n[V466] FAILED');
  process.exit(1);
} else {
  console.log('\n[V466] PASSED');
  process.exit(0);
}
