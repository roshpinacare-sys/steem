/**
 * tests/v499.test.js — ECOS V499 (Phase P378) — Diamond Governance Cycle
 * Run: NODE_ENV=test node tests/v499.test.js
 * @version 499.0.0
 */
'use strict';
process.env.NODE_ENV = 'test';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const G = require(path.join(ROOT, 'src/lib/diamondGovernanceCycle499.js'));
const O = require(path.join(ROOT, 'lib/moduleOrchestrator437.js'));
const Gd = require(path.join(ROOT, 'lib/economicMutationGuard402.js'));
const P = require(path.join(ROOT, 'lib/userProtection401.js'));
const CH = { libDir: path.join(ROOT, 'lib'), rootDir: ROOT };
function ctx(extra) { return Object.assign({ orchestrator: O, guard: Gd, breaker: new P.CircuitBreaker401(), audit: () => {}, codeHealthOpts: CH, authorized: false, dryRun: true }, extra || {}); }

let passed = 0, failed = 0; const errors = [];
function test(name, fn) { try { fn(); console.log('  \u2713 ' + name); passed++; } catch (e) { console.error('  \u2717 ' + name + ': ' + e.message); failed++; errors.push(name); } }

console.log('\n[V499] Unified cycle — economy + code in one loop\n');
test('healthy economy + code-health → one cycle with merged decisions, propose mode', () => {
  const r = G.runGovernanceCycle499({ solvency: { solvent: true, surplusMicro: '1000000' }, safety: { armed: true } }, ctx());
  assert.ok(r.summary.includes('mode=propose'));
  assert.ok(r.decisions.actionCount >= 1);
  assert.strictEqual(r.action.mode, 'propose');
  assert.ok(r.cognition.concerns.some(c => c.pillar === 'codeHealth'), 'code-health folded into cognition');
});
test('cleanup actions are advisory + proposal-only (never auto-execute)', () => {
  const r = G.runGovernanceCycle499({ solvency: { solvent: true, surplusMicro: '1' } }, ctx());
  const cleanups = r.decisions.actions.filter(a => a.capability === 'maintenance.flattenChain');
  cleanups.forEach(a => { assert.strictEqual(a.advisory, true); assert.strictEqual(a.requiresAuth, true); });
});
test('a solvency emergency leads the plan; cleanup never outranks it', () => {
  const r = G.runGovernanceCycle499({ solvency: { solvent: false } }, ctx());
  assert.strictEqual(r.decisions.actions[0].priority, 'CRITICAL');
  assert.strictEqual(r.decisions.actions[0].pillar, 'solvency');
  assert.strictEqual(r.cognition.posture, 'protect');
});
test('the cycle is audit-chained', () => {
  const ev = [];
  G.runGovernanceCycle499({ solvency: { solvent: true, surplusMicro: '1' } }, ctx({ audit: (t) => ev.push(t) }));
  assert.ok(ev.includes('diamond.governance_cycle'));
  assert.ok(ev.includes('diamond.act'));
});
test('includeCleanup:false yields economic-only decisions', () => {
  const r = G.runGovernanceCycle499({ solvency: { solvent: true, surplusMicro: '1' } }, ctx({ includeCleanup: false }));
  assert.ok(!r.decisions.actions.some(a => a.capability === 'maintenance.flattenChain'));
});

console.log('\n[V499] Fail-closed + bounded\n');
test('requires an orchestrator', () => {
  assert.throws(() => G.runGovernanceCycle499({}, { codeHealthOpts: CH }), e => e.code === 'NO_ORCHESTRATOR');
});
test('authorized execution runs through the spine (still bounded by V402)', () => {
  // economic-only safe action executes; prove it goes through the orchestrator
  const r = G.runGovernanceCycle499({ safety: { armed: false } }, ctx({ authorized: true, dryRun: false, includeCleanup: false, executors: { 'safety.arm': () => ({ armed: true }) } }));
  assert.strictEqual(r.action.mode, 'execute');
  assert.ok(r.action.orchestratorResult);
});

console.log('\n[V499] Server wiring + sacred\n');
const SERVER = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
test('server parses, no corruption', () => {
  assert.doesNotThrow(() => new vm.Script(SERVER, { filename: 'ecos-api-server.js' }));
  assert.ok(!SERVER.includes('__manus_ec'));
});
test('governance-cycle endpoints + tags wired, unifying the layers', () => {
  assert.ok(SERVER.includes('/api/v1/diamond/governance-cycle'));
  ['V499-T01', 'V499-T02'].forEach(t => assert.ok(SERVER.includes(t)));
  assert.ok(SERVER.includes("require('./lib/diamondGovernanceCycle499.js')"));
  const src = fs.readFileSync(path.join(ROOT, 'lib/diamondGovernanceCycle499.js'), 'utf8');
  assert.ok(src.includes("require('./sovereignOperatorDiamond453.js')"));
  assert.ok(src.includes("require('./diamondCodeHealthSignal498.js')"));
});
test('package.json major >= 499', () => {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  assert.ok(parseInt(String(v).split('.')[0], 10) >= 499, 'got ' + v);
});
test('SACRED files intact (canonical MD5)', () => {
  const crypto = require('crypto');
  const md5 = p => crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
  assert.strictEqual(md5('lib/fiatLedger.js'), '563e9b1f9e67091a5b6527c0a92568e5');
  assert.strictEqual(md5('lib/auditLog.js'), 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});
test('handoff docs exist', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'CHANGELOG_V499.md')));
  assert.ok(fs.existsSync(path.join(ROOT, 'NEXT_SESSION_PROMPT_V499.md')));
});

console.log('\n  Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.error('Failed: ' + errors.join(', ')); process.exit(1); }
console.log('  \u2713 All V499 tests passed\n');
