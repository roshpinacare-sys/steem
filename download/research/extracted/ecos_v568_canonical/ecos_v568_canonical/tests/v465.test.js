'use strict';
/**
 * tests/v465.test.js — Diamond Heartbeat V465
 * Run: NODE_ENV=test node tests/v465.test.js
 * Expected: exit 0 (all pass)
 */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

let passed = 0, failed = 0;
function assert(cond, label) {
  if (cond) { console.log('  ✓', label); passed++; }
  else       { console.error('  ✗', label); failed++; }
}
async function run() {
  console.log('\nV465 — Diamond Heartbeat Tests\n');

  // T01 — SACRED md5
  const { createHash } = crypto;
  const md5 = f => createHash('md5').update(fs.readFileSync(f)).digest('hex');
  const ROOT = path.join(__dirname, '..');
  assert(md5(path.join(ROOT,'lib/fiatLedger.js'))  === '563e9b1f9e67091a5b6527c0a92568e5', 'SACRED fiatLedger.js md5 intact');
  assert(md5(path.join(ROOT,'lib/auditLog.js'))     === 'e5a5c2c27801d2d03991bc8e5a1df8cb', 'SACRED auditLog.js md5 intact');

  // T02 — server node --check
  const { execSync } = require('child_process');
  try {
    execSync(`node --check ${path.join(ROOT,'ecos-api-server.js')}`, { stdio: 'ignore' });
    assert(true, 'ecos-api-server.js node --check clean');
  } catch (e) {
    assert(false, 'ecos-api-server.js node --check clean');
  }

  // T03 — module loads
  let HB465, DiamondHeartbeat465, defaultDiamondHeartbeat465;
  try {
    const m = require(path.join(ROOT,'lib/diamondHeartbeat465.js'));
    HB465 = m;
    DiamondHeartbeat465 = m.DiamondHeartbeat465;
    defaultDiamondHeartbeat465 = m.defaultDiamondHeartbeat465;
    assert(true, 'diamondHeartbeat465.js loads without error');
  } catch (e) {
    assert(false, `diamondHeartbeat465.js loads: ${e.message}`);
    return finish();
  }

  // T04 — version constant
  assert(HB465.HEARTBEAT_VERSION_465 === '465', 'HEARTBEAT_VERSION_465 === "465"');

  // T05 — constructor requires cognitionEngine
  let threw = false;
  try { new DiamondHeartbeat465({}); } catch (e) { threw = e.code === 'BAD_ARGS'; }
  assert(threw, 'constructor throws BAD_ARGS without cognitionEngine');

  // T06 — construct with mock engine
  const E462 = require(path.join(ROOT,'lib/diamondCognitionEngine462.js'));
  const mockEngine = new E462.DiamondCognitionEngine462();
  const auditEvents = [];
  const hb = new DiamondHeartbeat465({
    cognitionEngine: mockEngine,
    auditLog: (ev, d) => auditEvents.push({ ev, d }),
    getSystemState: async () => ({ healthScore: 80, solvencySurplus: 500, dissatisfaction: 0.1 }),
    intervalMs: 999999, // won't fire in test
    autoStart: false,
  });
  assert(hb instanceof DiamondHeartbeat465, 'DiamondHeartbeat465 instantiates with mock engine');

  // T07 — manual beat cycle
  const beat = await hb._beat465();
  assert(beat.ok === true, 'manual _beat465() returns ok:true');
  assert(beat.state && beat.state.healthScore === 80, 'beat captures healthScore=80');
  assert(Array.isArray(beat.trends.earlyWarnings), 'beat.trends.earlyWarnings is array');

  // T08 — audit recorded
  assert(auditEvents.length >= 1 && auditEvents[0].ev === 'diamond.heartbeat', 'audit event "diamond.heartbeat" recorded');

  // T09 — status465
  const st = hb.status465();
  assert(st.totalBeats === 1 && st.version === '465', 'status465 reports 1 beat');

  // T10 — recentBeats465
  const recent = hb.recentBeats465(5);
  assert(recent.length === 1 && recent[0].ok === true, 'recentBeats465 returns 1 record');

  // T11 — error in getSystemState → fail-closed (ok:false, no crash)
  const hbBad = new DiamondHeartbeat465({
    cognitionEngine: mockEngine,
    getSystemState: async () => { throw new Error('sim-state-error'); },
  });
  const badBeat = await hbBad._beat465();
  assert(badBeat.ok === false && badBeat.error === 'sim-state-error', 'fail-closed: state error captured, no crash');

  // T12 — server wires V465 endpoints
  const serverSrc = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'), 'utf8');
  assert(serverSrc.includes('/api/v1/diamond/heartbeat/status'), 'server has /api/v1/diamond/heartbeat/status endpoint');
  assert(serverSrc.includes('/api/v1/admin/summary/v465'), 'server has /api/v1/admin/summary/v465 endpoint');

  finish();
}

function finish() {
  console.log(`\n  V465 results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error('FATAL:', e); process.exit(1); });
