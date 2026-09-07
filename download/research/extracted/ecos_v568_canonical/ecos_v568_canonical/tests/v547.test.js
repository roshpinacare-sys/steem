'use strict';
/**
 * tests/v547.test.js — ECOS V547
 * orchestratorPolicyGate547: policy-gated executePlan437
 */

const assert = require('assert');
const path   = require('path');
const crypto = require('crypto');
const fs     = require('fs');

let pass547 = 0, fail547 = 0;
function t547(name, fn) {
  try   { fn(); console.log(`  ✓ ${name}`); pass547++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); fail547++; }
}

const ROOT = path.resolve(__dirname, '..');
console.log('\n=== ECOS V547 Tests ===\n');

// T01–T02: SACRED
t547('T01 SACRED fiatLedger', () => {
  const md5 = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT,'lib/fiatLedger.js'))).digest('hex');
  assert.strictEqual(md5, '563e9b1f9e67091a5b6527c0a92568e5');
});
t547('T02 SACRED auditLog', () => {
  const md5 = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT,'lib/auditLog.js'))).digest('hex');
  assert.strictEqual(md5, 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// T03: server parse
t547('T03 server node --check', () => {
  require('child_process').execSync(`node --check ${path.join(ROOT,'ecos-api-server.js')} 2>&1`);
});

// T04: version
t547('T04 version >= 547', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8'));
  assert(parseInt(pkg.version) >= 547, `got ${pkg.version}`);
});

// T05: module loads
t547('T05 orchestratorPolicyGate547 loads', () => {
  const m = require(path.join(ROOT,'lib/orchestratorPolicyGate547.js'));
  assert.strictEqual(typeof m.gatePlan547, 'function');
  assert.strictEqual(typeof m.getPolicyStatus547, 'function');
  assert.strictEqual(typeof m.probeCapability547, 'function');
  assert.strictEqual(typeof m.GATE_VERSION_547, 'string');
});

// T06: getPolicyStatus547 returns valid shape
t547('T06 getPolicyStatus547 valid shape', () => {
  const m = require(path.join(ROOT,'lib/orchestratorPolicyGate547.js'));
  const s = m.getPolicyStatus547();
  assert.strictEqual(s.ok, true);
  assert(typeof s.gateOpen === 'boolean', 'gateOpen must be boolean');
  assert(['AUTO','SUPERVISED','MANUAL'].includes(s.decision), `bad decision: ${s.decision}`);
  assert(s.stats, 'stats missing');
  assert(typeof s.orchAvailable === 'boolean');
});

// T07: Orchestrator available through gate
t547('T07 orchestrator available', () => {
  const m = require(path.join(ROOT,'lib/orchestratorPolicyGate547.js'));
  const s = m.getPolicyStatus547();
  assert.strictEqual(s.orchAvailable, true, 'moduleOrchestrator437 should be loadable');
});

// T08: gate blocked in test env (MANUAL, no live heartbeat — fail-closed)
t547('T08 gate blocked=true in test env (MANUAL, fail-closed expected)', () => {
  const m = require(path.join(ROOT,'lib/orchestratorPolicyGate547.js'));
  const s = m.getPolicyStatus547();
  // In test env: score=0, trend=unknown → MANUAL
  assert.strictEqual(s.decision, 'MANUAL', 'Expected MANUAL without live heartbeat');
  assert.strictEqual(s.gateOpen, false, 'Gate should be closed (MANUAL)');
});

// T09: gatePlan547 blocks when policy=MANUAL
t547('T09 gatePlan547 blocks a plan when MANUAL', () => {
  const gate = require(path.join(ROOT,'lib/orchestratorPolicyGate547.js'));
  const orch = require(path.join(ROOT,'lib/moduleOrchestrator437.js'));
  const plan = orch.planFromIntent437({ steps: [{ capability: 'test-read', kind: 'read' }] });
  const r = gate.gatePlan547(plan, {});
  assert.strictEqual(r.ok, false, 'Should be blocked');
  assert.strictEqual(r.blocked, true, 'blocked must be true');
  assert.strictEqual(r.gateDecision, 'MANUAL', 'gateDecision must be MANUAL');
  assert(typeof r.reason === 'string' && r.reason.length > 0, 'reason must be a string');
});

// T10: probeCapability547 returns correct shape
t547('T10 probeCapability547 returns shape', () => {
  const m = require(path.join(ROOT,'lib/orchestratorPolicyGate547.js'));
  const r = m.probeCapability547('sendPayment');
  assert(typeof r.allowed === 'boolean', 'allowed must be boolean');
  assert(typeof r.decision === 'string', 'decision must be string');
  assert(typeof r.reason === 'string', 'reason must be string');
  assert.strictEqual(r.capability, 'sendPayment');
});

// T11: probeCapability547 blocks in test env
t547('T11 probeCapability547: allowed=false in test env', () => {
  const m = require(path.join(ROOT,'lib/orchestratorPolicyGate547.js'));
  const r = m.probeCapability547('anyCapability');
  assert.strictEqual(r.allowed, false, 'should be blocked (MANUAL in test env)');
});

// T12: fail-closed — invalid capability → allowed=false
t547('T12 probeCapability547: invalid cap → fail-closed', () => {
  const m = require(path.join(ROOT,'lib/orchestratorPolicyGate547.js'));
  assert.strictEqual(m.probeCapability547(null).allowed,      false);
  assert.strictEqual(m.probeCapability547('').allowed,        false);
  assert.strictEqual(m.probeCapability547(undefined).allowed, false);
});

// T13: stats counter increments
t547('T13 stats.total increments on each gatePlan call', () => {
  const gate = require(path.join(ROOT,'lib/orchestratorPolicyGate547.js'));
  const orch = require(path.join(ROOT,'lib/moduleOrchestrator437.js'));
  const before = gate.getPolicyStatus547().stats.total;
  const plan = orch.planFromIntent437({ steps: [{ capability: 'x', kind: 'read' }] });
  gate.gatePlan547(plan, {});
  const after = gate.getPolicyStatus547().stats.total;
  assert(after > before, `stats.total should increment (${before} → ${after})`);
});

// T14: lib/ mirror exists
t547('T14 lib/ mirror exists', () => {
  assert(fs.existsSync(path.join(ROOT,'lib/orchestratorPolicyGate547.js')), 'lib mirror missing');
});

// T15: V547 endpoints wired in server
t547('T15 V547 endpoints wired in server', () => {
  const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
  assert(src.includes('/api/v1/orchestrator/policy-gate/v547'), 'gate endpoint missing');
  assert(src.includes('/api/v1/admin/summary/v547'), 'summary endpoint missing');
  assert(src.includes('_wireOrchestratorPolicyGate547'), 'IIFE name missing');
});

// T16: result structure when MANUAL (blocked case)
t547('T16 blocked result has policy sub-object', () => {
  const gate = require(path.join(ROOT,'lib/orchestratorPolicyGate547.js'));
  const orch = require(path.join(ROOT,'lib/moduleOrchestrator437.js'));
  const plan = orch.planFromIntent437({ steps: [{ capability: 'test', kind: 'read' }] });
  const r = gate.gatePlan547(plan, {});
  assert(r.policy, 'policy sub-object missing');
  assert.strictEqual(r.policy.decision, 'MANUAL');
  assert(typeof r.policy.score === 'number', 'policy.score must be number');
  assert(typeof r.policy.trend === 'string', 'policy.trend must be string');
});

console.log(`\n=== V547 Results: ${pass547} passed, ${fail547} failed ===`);
console.log(`=== Baseline: 144/163 pass, 19 cannotRun, 0 realFail ===\n`);
process.exit(fail547 > 0 ? 1 : 0);
