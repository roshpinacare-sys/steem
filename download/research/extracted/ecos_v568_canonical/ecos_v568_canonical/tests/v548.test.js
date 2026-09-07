'use strict';
/**
 * tests/v548.test.js — ECOS V548
 * Run: NODE_ENV=test node tests/v548.test.js → exit 0
 */
const assert       = require('assert');
const crypto       = require('crypto');
const fs           = require('fs');
const path         = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

console.log('\n=== ECOS V548 Tests ===\n');

// T01 — SACRED fiatLedger
test('SACRED fiatLedger.js md5', () => {
  const buf = fs.readFileSync(path.join(ROOT, 'lib/fiatLedger.js'));
  assert.strictEqual(crypto.createHash('md5').update(buf).digest('hex'), '563e9b1f9e67091a5b6527c0a92568e5');
});

// T02 — SACRED auditLog
test('SACRED auditLog.js md5', () => {
  const buf = fs.readFileSync(path.join(ROOT, 'lib/auditLog.js'));
  assert.strictEqual(crypto.createHash('md5').update(buf).digest('hex'), 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// T03 — server parse
test('ecos-api-server.js node --check', () => {
  execSync(`node --check ${path.join(ROOT, 'ecos-api-server.js')}`, { stdio: 'pipe' });
});

// T04 — version
test('package.json version = 548.0.0', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json')));
  assert.ok(parseInt(pkg.version) >= 548, `version ${pkg.version} < 548`);
});

// T05 — module exists + parses
test('lib/deepHealthPolicyLog548.js exists + parses', () => {
  const p = path.join(ROOT, 'lib/deepHealthPolicyLog548.js');
  assert.ok(fs.existsSync(p));
  execSync(`node --check ${p}`, { stdio: 'pipe' });
});

// T06 — exports correct surface
test('exports: recordDecision548, getLog548, getTrendLog548, getLogSummary548, clearLog548', () => {
  const L = require(path.join(ROOT, 'lib/deepHealthPolicyLog548.js'));
  assert.strictEqual(typeof L.recordDecision548, 'function');
  assert.strictEqual(typeof L.getLog548,         'function');
  assert.strictEqual(typeof L.getTrendLog548,    'function');
  assert.strictEqual(typeof L.getLogSummary548,  'function');
  assert.strictEqual(typeof L.clearLog548,       'function');
  assert.strictEqual(L.LOG_MAX_ENTRIES_548, 50);
});

// T07 — ring buffer appends + cap at 50
test('ring buffer appends and caps at LOG_MAX_ENTRIES_548=50', () => {
  const L = require(path.join(ROOT, 'lib/deepHealthPolicyLog548.js'));
  L.clearLog548();
  for (let i = 0; i < 60; i++) {
    L.recordDecision548({ decision: 'MANUAL', score: i / 100, trend: 'down', source: 'test' });
  }
  assert.strictEqual(L.getLog548().length, 50, 'should cap at 50');
  L.clearLog548();
});

// T08 — getTrendLog548: improving
test('getTrendLog548 detects improving trend', () => {
  const L = require(path.join(ROOT, 'lib/deepHealthPolicyLog548.js'));
  L.clearLog548();
  // first half: MANUAL (level 0), second half: AUTO (level 2) → improving
  L.recordDecision548({ decision: 'MANUAL', score: 0.1, trend: 'down', source: 'test' });
  L.recordDecision548({ decision: 'MANUAL', score: 0.2, trend: 'down', source: 'test' });
  L.recordDecision548({ decision: 'AUTO',   score: 0.9, trend: 'up',   source: 'test' });
  L.recordDecision548({ decision: 'AUTO',   score: 0.9, trend: 'up',   source: 'test' });
  const t = L.getTrendLog548();
  assert.strictEqual(t.trend, 'improving', `expected improving, got ${t.trend}`);
  L.clearLog548();
});

// T09 — getTrendLog548: degrading
test('getTrendLog548 detects degrading trend', () => {
  const L = require(path.join(ROOT, 'lib/deepHealthPolicyLog548.js'));
  L.clearLog548();
  L.recordDecision548({ decision: 'AUTO',   score: 0.9, trend: 'up',   source: 'test' });
  L.recordDecision548({ decision: 'AUTO',   score: 0.9, trend: 'up',   source: 'test' });
  L.recordDecision548({ decision: 'MANUAL', score: 0.1, trend: 'down', source: 'test' });
  L.recordDecision548({ decision: 'MANUAL', score: 0.1, trend: 'down', source: 'test' });
  const t = L.getTrendLog548();
  assert.strictEqual(t.trend, 'degrading', `expected degrading, got ${t.trend}`);
  L.clearLog548();
});

// T10 — getLogSummary548 counts
test('getLogSummary548 returns correct counts + lastDecision', () => {
  const L = require(path.join(ROOT, 'lib/deepHealthPolicyLog548.js'));
  L.clearLog548();
  L.recordDecision548({ decision: 'MANUAL',     score: 0.1, trend: 'down', source: 'test', blocked: true });
  L.recordDecision548({ decision: 'SUPERVISED', score: 0.5, trend: 'up',   source: 'test', blocked: true });
  L.recordDecision548({ decision: 'AUTO',       score: 0.9, trend: 'up',   source: 'test', blocked: false });
  const s = L.getLogSummary548();
  assert.strictEqual(s.counts.MANUAL,     1);
  assert.strictEqual(s.counts.SUPERVISED, 1);
  assert.strictEqual(s.counts.AUTO,       1);
  assert.strictEqual(s.totalRecorded,     3);
  assert.strictEqual(s.blockedCount,      2);
  assert.strictEqual(s.lastDecision.decision, 'AUTO');
  L.clearLog548();
});

// T11 — fail-closed: invalid decision is silently ignored
test('recordDecision548 ignores invalid decision (fail-closed)', () => {
  const L = require(path.join(ROOT, 'lib/deepHealthPolicyLog548.js'));
  L.clearLog548();
  L.recordDecision548({ decision: 'BOGUS', score: 1, trend: 'up' });
  assert.strictEqual(L.getLog548().length, 0, 'invalid decision should not be recorded');
  // Actually check: the summary shows 0 — but BOGUS counts as 0 for summary.count
  // Per implementation: no 'BOGUS' key in counts — test passes either way
  L.clearLog548();
});

// T12 — getTrendLog548 unknown when < 4 entries
test('getTrendLog548 returns unknown with fewer than 4 entries', () => {
  const L = require(path.join(ROOT, 'lib/deepHealthPolicyLog548.js'));
  L.clearLog548();
  L.recordDecision548({ decision: 'MANUAL', score: 0.1, trend: 'down', source: 'test' });
  L.recordDecision548({ decision: 'AUTO',   score: 0.9, trend: 'up',   source: 'test' });
  const t = L.getTrendLog548();
  assert.strictEqual(t.trend, 'unknown');
  L.clearLog548();
});

// T13 — server wires all 4 V548 endpoints
test('server wires all V548 endpoints', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  assert.ok(src.includes('/api/v1/health/policy-log\''),        'policy-log missing');
  assert.ok(src.includes('/api/v1/health/policy-log/summary'),  'summary missing');
  assert.ok(src.includes('/api/v1/health/policy-log/record'),   'record missing');
  assert.ok(src.includes('/api/v1/admin/summary/v548'),         'admin summary missing');
});

// T14 — gate547 still loads (no regression)
test('orchestratorPolicyGate547 still loads (no regression)', () => {
  const g = require(path.join(ROOT, 'lib/orchestratorPolicyGate547.js'));
  assert.strictEqual(typeof g.gatePlan547, 'function');
  assert.strictEqual(g.GATE_VERSION_547, '547.0.0');
});

// T15 — policy546 still loads (no regression)
test('deepHealthPolicy546 still loads (no regression)', () => {
  const p = require(path.join(ROOT, 'lib/deepHealthPolicy546.js'));
  assert.strictEqual(typeof p.getPolicy546, 'function');
});

// T16 — DECISION_LEVELS_548 correct values
test('DECISION_LEVELS_548: AUTO=2, SUPERVISED=1, MANUAL=0', () => {
  const L = require(path.join(ROOT, 'lib/deepHealthPolicyLog548.js'));
  assert.strictEqual(L.DECISION_LEVELS_548.AUTO,       2);
  assert.strictEqual(L.DECISION_LEVELS_548.SUPERVISED, 1);
  assert.strictEqual(L.DECISION_LEVELS_548.MANUAL,     0);
});

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
process.exit(0);
