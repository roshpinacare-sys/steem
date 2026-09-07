/**
 * tests/v501.test.js — ECOS V501 (Phase P380) — Governance-Backed Heartbeat State
 * Run: NODE_ENV=test node tests/v501.test.js
 * @version 501.0.0
 */
'use strict';
process.env.NODE_ENV = 'test';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const S = require(path.join(ROOT, 'src/lib/heartbeatGovernanceState501.js'));
const HB = require(path.join(ROOT, 'lib/diamondHeartbeat465.js'));
const CE = require(path.join(ROOT, 'lib/diamondCognitionEngine462.js'));
const O = require(path.join(ROOT, 'lib/moduleOrchestrator437.js'));
const Gd = require(path.join(ROOT, 'lib/economicMutationGuard402.js'));
const P = require(path.join(ROOT, 'lib/userProtection401.js'));
function ctx(extra) { return Object.assign({ orchestrator: O, guard: Gd, breaker: new P.CircuitBreaker401(), codeHealthOpts: { libDir: path.join(ROOT, 'lib'), rootDir: ROOT } }, extra || {}); }

let passed = 0, failed = 0; const errors = [];
function test(name, fn) { try { fn(); console.log('  \u2713 ' + name); passed++; } catch (e) { console.error('  \u2717 ' + name + ': ' + e.message); failed++; errors.push(name); } }
async function atest(name, fn) { try { await fn(); console.log('  \u2713 ' + name); passed++; } catch (e) { console.error('  \u2717 ' + name + ': ' + e.message); failed++; errors.push(name); } }

(async () => {
  console.log('\n[V501] Real governance-backed state (vs the constant-70 placeholder)\n');
  await atest('returns a REAL healthScore + posture from the unified cycle', async () => {
    const getState = S.governanceSystemState501(ctx({ signals: { solvency: { solvent: true, surplusMicro: '1000000' }, safety: { armed: true } } }));
    const st = await getState();
    assert.ok(typeof st.healthScore === 'number', 'healthScore must be a real number');
    assert.notStrictEqual(st.healthScore, 70, 'must not be the old placeholder constant');
    assert.ok(['nominal', 'watch', 'guard', 'protect'].includes(st.posture));
    assert.ok(typeof st.proposals === 'number');
  });
  await atest('reflects an emergency (posture protect) in the state', async () => {
    const getState = S.governanceSystemState501(ctx({ signals: { solvency: { solvent: false } } }));
    const st = await getState();
    assert.strictEqual(st.posture, 'protect');
  });
  await atest('signals may be a function (live read each beat)', async () => {
    let calls = 0;
    const getState = S.governanceSystemState501(ctx({ signals: () => { calls++; return { solvency: { solvent: true, surplusMicro: '1' } }; } }));
    await getState(); await getState();
    assert.strictEqual(calls, 2, 'signals fn called each beat');
  });

  console.log('\n[V501] Fail-closed\n');
  test('requires an orchestrator', () => {
    assert.throws(() => S.governanceSystemState501({ codeHealthOpts: {} }), e => e.code === 'NO_ORCHESTRATOR');
  });

  console.log('\n[V501] Drives the EXISTING heartbeat465 (connection, not a new heartbeat)\n');
  await atest('heartbeat465 constructed with the provider learns from REAL state', async () => {
    const engine = new CE.DiamondCognitionEngine462();
    const getState = S.governanceSystemState501(ctx({ signals: { solvency: { solvent: true, surplusMicro: '1000000' }, safety: { armed: true } } }));
    const hb = new HB.DiamondHeartbeat465({ cognitionEngine: engine, getSystemState: getState, autoStart: false });
    hb.start465();
    await new Promise(r => setTimeout(r, 40));
    hb.stop465();
    const s = hb.status465();
    assert.ok(s.totalBeats >= 1, 'at least one beat fired');
    assert.ok(engine.history.length >= 1, 'engine learned from the beat');
  });
  test('does NOT introduce a new heartbeat class/timer (reuses 465)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib/heartbeatGovernanceState501.js'), 'utf8');
    assert.ok(!/setInterval|class .*Heartbeat/.test(src), 'must reuse heartbeat465, not add a scheduler');
  });

  console.log('\n[V501] Server wiring + sacred\n');
  const SERVER = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  test('server parses, no corruption', () => {
    assert.doesNotThrow(() => new vm.Script(SERVER, { filename: 'ecos-api-server.js' }));
    assert.ok(!SERVER.includes('__manus_ec'));
  });
  test('governance-heartbeat endpoints + tags wired, connecting 465 + V499', () => {
    ['/api/v1/diamond/heartbeat/governance-state', '/api/v1/diamond/heartbeat/governance-start', '/api/v1/diamond/heartbeat/governance-status'].forEach(p => assert.ok(SERVER.includes(p), 'missing ' + p));
    ['V501-T01', 'V501-T02', 'V501-T03', 'V501-T04'].forEach(t => assert.ok(SERVER.includes(t)));
    assert.ok(SERVER.includes("require('./lib/heartbeatGovernanceState501.js')"));
    assert.ok(SERVER.includes("require('./lib/diamondHeartbeat465.js')"));
    const src = fs.readFileSync(path.join(ROOT, 'lib/heartbeatGovernanceState501.js'), 'utf8');
    assert.ok(src.includes("require('./diamondGovernanceCycle499.js')"));
  });
  test('existing V465 heartbeat endpoints are untouched (addition only)', () => {
    assert.ok(SERVER.includes('/api/v1/diamond/heartbeat/start'));
    assert.ok(SERVER.includes('/api/v1/diamond/heartbeat/stop'));
  });
  test('package.json major >= 501', () => {
    const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    assert.ok(parseInt(String(v).split('.')[0], 10) >= 501, 'got ' + v);
  });
  test('SACRED files intact (canonical MD5)', () => {
    const crypto = require('crypto');
    const md5 = p => crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
    assert.strictEqual(md5('lib/fiatLedger.js'), '563e9b1f9e67091a5b6527c0a92568e5');
    assert.strictEqual(md5('lib/auditLog.js'), 'e5a5c2c27801d2d03991bc8e5a1df8cb');
  });
  test('handoff docs exist', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'CHANGELOG_V501.md')));
    assert.ok(fs.existsSync(path.join(ROOT, 'NEXT_SESSION_PROMPT_V501.md')));
  });

  console.log('\n  Results: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.error('Failed: ' + errors.join(', ')); process.exit(1); }
  console.log('  \u2713 All V501 tests passed\n');
})();
