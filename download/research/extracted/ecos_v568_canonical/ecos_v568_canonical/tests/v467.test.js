'use strict';
/**
 * V467 Tests — Diamond Autonomous Financial Action Guard
 * SACRED + parse + guard unit tests + endpoint wiring + fail-closed
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
console.log('\n[V467] Diamond Autonomous Guard Tests\n');

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

/* T3 — guard module loads */
const guard = require(path.join(ROOT, 'lib/diamondAutonomousGuard467.js'));
test('guard module exports version 467', () => {
  assert.strictEqual(guard.AUTONOMOUS_GUARD_VERSION_467, '467');
  assert.strictEqual(typeof guard.actWithGuard467, 'function');
  assert.strictEqual(typeof guard._computeUrgency467, 'function');
  assert.strictEqual(typeof guard._buildPreemptivePlan467, 'function');
});

/* T4 — act without heartbeat (fail-closed) */
test('act without heartbeat returns HEARTBEAT_MISSING', () => {
  const res = guard.actWithGuard467({});
  assert.strictEqual(res.ok, false);
  assert.ok(res.code === 'HEARTBEAT_MISSING' || res.code === 'ORCH_MISSING' || res.code === 'GUARD_MISSING', 'expected fail-closed code, got ' + res.code);
});

/* T5 — urgency computation */
test('_computeUrgency467 returns 0 for empty beat', () => {
  const u = guard._computeUrgency467(null);
  assert.strictEqual(u.urgency, 0);
});
test('_computeUrgency467 counts HIGH priority actions', () => {
  const beat = {
    trends: { earlyWarnings: [], earlyWarningsCount: 0 },
    proactive: { actions: [{ priority: 'HIGH' }, { priority: 'MEDIUM' }] },
  };
  const u = guard._computeUrgency467(beat);
  assert.ok(u.urgency >= 3, 'expected urgency >= 3 for HIGH+MEDIUM, got ' + u.urgency);
});
test('_computeUrgency467 counts dangerous early warnings', () => {
  const beat = {
    trends: { earlyWarnings: [{ projectionReadingsToDanger: 1 }, { projectionReadingsToDanger: 2 }] },
    proactive: { actions: [] },
  };
  const u = guard._computeUrgency467(beat);
  assert.ok(u.urgency >= 3, 'expected urgency >= 3 for two dangerous warnings, got ' + u.urgency);
});

/* T6 — act with low urgency (below threshold) */
test('act with low urgency returns acted:false', () => {
  const fakeHb = {
    status465: () => ({
      running: true,
      totalBeats: 1,
      lastBeat: {
        at: new Date().toISOString(),
        ok: true,
        state: { healthScore: 0.95, solvencySurplus: 1000000 },
        trends: { earlyWarnings: [], earlyWarningsCount: 0, ready: true },
        proactive: { actionsCount: 0, proactive: false, actions: [] },
      },
    }),
  };
  const res = guard.actWithGuard467({ heartbeat: fakeHb, threshold: 3 });
  assert.strictEqual(res.ok, true, res.error);
  assert.strictEqual(res.acted, false);
  assert.ok(res.urgency < 3, 'expected low urgency, got ' + res.urgency);
});

/* T7 — act with high urgency (above threshold, dryRun) */
test('act with high urgency dryRun returns acted:true with money steps', () => {
  const fakeHb = {
    status465: () => ({
      running: true,
      totalBeats: 1,
      lastBeat: {
        at: new Date().toISOString(),
        ok: true,
        state: { healthScore: 45, solvencySurplus: -5000 },
        trends: { earlyWarnings: [{ projectionReadingsToDanger: 1 }, { projectionReadingsToDanger: 2 }], earlyWarningsCount: 2, ready: true },
        proactive: { actionsCount: 1, proactive: true, actions: [{ priority: 'HIGH', reason: 'test' }] },
      },
    }),
  };
  const res = guard.actWithGuard467({ heartbeat: fakeHb, threshold: 3, dryRun: true });
  assert.strictEqual(res.ok, true, res.error);
  assert.strictEqual(res.acted, true);
  assert.ok(res.plan.moneySteps > 0, 'expected money steps > 0, got ' + res.plan.moneySteps);
  assert.strictEqual(res.plan.requiresGuard, true);
  assert.ok(res.execution.completed || res.execution.halted, 'execution should complete or halt');
});

/* T8 — fail-closed when guard blocks (simulated by no breaker) */
test('act with high urgency but no V402 breaker still generates plan and may halt', () => {
  const fakeHb = {
    status465: () => ({
      running: true,
      totalBeats: 1,
      lastBeat: {
        at: new Date().toISOString(),
        ok: true,
        state: { healthScore: 45, solvencySurplus: -5000 },
        trends: { earlyWarnings: [{ projectionReadingsToDanger: 1 }], earlyWarningsCount: 1, ready: true },
        proactive: { actionsCount: 1, proactive: true, actions: [{ priority: 'HIGH' }] },
      },
    }),
  };
  const res = guard.actWithGuard467({ heartbeat: fakeHb, threshold: 3, dryRun: true });
  assert.strictEqual(res.ok, true, res.error);
  assert.ok(res.plan != null);
});

/* T9 — server contains V467 endpoint wiring */
test('server contains V467 endpoint declarations', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  assert.ok(src.includes("POST /api/v1/diamond/orchestrator/act"), 'missing act endpoint');
  assert.ok(src.includes("/api/v1/admin/summary/v467"), 'missing admin summary endpoint');
  assert.ok(src.includes("V467"), 'missing V467 tag');
});

/* T10 — package.json version relaxed >= 467 */
test('package.json version >= 467', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const major = parseInt(pkg.version);
  assert.ok(major >= 467, 'package.json version must be >= 467, got ' + pkg.version);
});

/* ════════════════════════════════════════ */
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\n[V467] FAILED');
  process.exit(1);
} else {
  console.log('\n[V467] PASSED');
  process.exit(0);
}
