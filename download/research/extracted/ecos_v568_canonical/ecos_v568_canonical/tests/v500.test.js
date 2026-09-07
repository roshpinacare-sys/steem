/**
 * tests/v500.test.js — ECOS V500 (Phase P379) — Learning Governance Tick
 * Run: NODE_ENV=test node tests/v500.test.js
 * @version 500.0.0
 */
'use strict';
process.env.NODE_ENV = 'test';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const T = require(path.join(ROOT, 'src/lib/governanceTick500.js'));
const O = require(path.join(ROOT, 'lib/moduleOrchestrator437.js'));
const Gd = require(path.join(ROOT, 'lib/economicMutationGuard402.js'));
const P = require(path.join(ROOT, 'lib/userProtection401.js'));
const CE = require(path.join(ROOT, 'lib/diamondCognitionEngine462.js'));
const CH = { libDir: path.join(ROOT, 'lib'), rootDir: ROOT };
function ctx(extra) { return Object.assign({ orchestrator: O, guard: Gd, breaker: new P.CircuitBreaker401(), audit: () => {}, codeHealthOpts: CH, engine: new CE.DiamondCognitionEngine462() }, extra || {}); }

let passed = 0, failed = 0; const errors = [];
function test(name, fn) { try { fn(); console.log('  \u2713 ' + name); passed++; } catch (e) { console.error('  \u2717 ' + name + ': ' + e.message); failed++; errors.push(name); } }

console.log('\n[V500] The learning beat — run cycle + remember\n');
test('one tick runs the cycle (propose-only) and ingests into memory', () => {
  const r = T.governanceTick500({ solvency: { solvent: true, surplusMicro: '1000000' }, safety: { armed: true } }, ctx());
  assert.strictEqual(r.mode, 'propose');
  assert.strictEqual(r.ingested, true);
  assert.strictEqual(r.historyLength, 1);
  assert.ok(typeof r.healthScore === 'number');
});
test('repeated beats accumulate memory across the same engine', () => {
  const c = ctx();
  let r;
  for (let i = 0; i < 4; i++) r = T.governanceTick500({ solvency: { solvent: true, surplusMicro: '1000000' } }, c);
  assert.strictEqual(r.historyLength, 4);
});
test('a tick NEVER auto-executes, even with authorized passed (heartbeat is propose-only)', () => {
  const r = T.governanceTick500({ safety: { armed: false } }, ctx({ authorized: true, dryRun: false, executors: { 'safety.arm': () => ({ armed: true }) } }));
  assert.strictEqual(r.mode, 'propose', 'a beat must stay propose-only regardless of ctx.authorized');
});
test('emergency posture surfaces on a tick but still only proposes', () => {
  const r = T.governanceTick500({ solvency: { solvent: false } }, ctx());
  assert.strictEqual(r.posture, 'protect');
  assert.strictEqual(r.mode, 'propose');
});
test('records a governance_tick audit event', () => {
  const ev = [];
  T.governanceTick500({ solvency: { solvent: true, surplusMicro: '1' } }, ctx({ audit: (t) => ev.push(t) }));
  assert.ok(ev.includes('diamond.governance_tick'));
});
test('recordHistory:false skips ingestion', () => {
  const r = T.governanceTick500({ solvency: { solvent: true, surplusMicro: '1' } }, ctx({ recordHistory: false }));
  assert.strictEqual(r.ingested, false);
});

console.log('\n[V500] Fail-closed\n');
test('requires an orchestrator', () => {
  assert.throws(() => T.governanceTick500({}, { codeHealthOpts: CH }), e => e.code === 'NO_ORCHESTRATOR');
});

console.log('\n[V500] Server wiring + sacred\n');
const SERVER = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
test('server parses, no corruption', () => {
  assert.doesNotThrow(() => new vm.Script(SERVER, { filename: 'ecos-api-server.js' }));
  assert.ok(!SERVER.includes('__manus_ec'));
});
test('governance-tick endpoints + tags wired, connecting V499 + V462', () => {
  ['/api/v1/diamond/governance-tick', '/api/v1/diamond/heartbeat-trends'].forEach(p => assert.ok(SERVER.includes(p), 'missing ' + p));
  ['V500-T01', 'V500-T02', 'V500-T03'].forEach(t => assert.ok(SERVER.includes(t)));
  assert.ok(SERVER.includes("require('./lib/governanceTick500.js')"));
  const src = fs.readFileSync(path.join(ROOT, 'lib/governanceTick500.js'), 'utf8');
  assert.ok(src.includes("require('./diamondGovernanceCycle499.js')"));
  assert.ok(src.includes("require('./diamondCognitionEngine462.js')"));
});
test('NOT a third heartbeat — no timer/scheduler class added', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/governanceTick500.js'), 'utf8');
  assert.ok(!/setInterval|setTimeout/.test(src), 'tick must not own a timer; schedulers drive it');
});
test('package.json major >= 500', () => {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  assert.ok(parseInt(String(v).split('.')[0], 10) >= 500, 'got ' + v);
});
test('SACRED files intact (canonical MD5)', () => {
  const crypto = require('crypto');
  const md5 = p => crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
  assert.strictEqual(md5('lib/fiatLedger.js'), '563e9b1f9e67091a5b6527c0a92568e5');
  assert.strictEqual(md5('lib/auditLog.js'), 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});
test('handoff docs exist', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'CHANGELOG_V500.md')));
  assert.ok(fs.existsSync(path.join(ROOT, 'NEXT_SESSION_PROMPT_V500.md')));
});

console.log('\n  Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.error('Failed: ' + errors.join(', ')); process.exit(1); }
console.log('  \u2713 All V500 tests passed\n');
