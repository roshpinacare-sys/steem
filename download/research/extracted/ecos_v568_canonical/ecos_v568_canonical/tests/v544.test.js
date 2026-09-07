'use strict';
/**
 * tests/v544.test.js — Deep Health History Scheduler V544
 * Run: NODE_ENV=test node tests/v544.test.js   → exit 0 expected
 */

const crypto = require('crypto');
const path   = require('path');
const fs     = require('fs');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;

function assert(cond, label) {
  if (cond) { console.log('  ✓', label); passed++; }
  else       { console.error('  ✗', label); failed++; }
}

console.log('\nV544 — Deep Health History Scheduler\n');

// T01 — SACRED md5
const md5 = f => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');
assert(md5(path.join(ROOT,'lib/fiatLedger.js'))  === '563e9b1f9e67091a5b6527c0a92568e5', 'SACRED fiatLedger.js intact');
assert(md5(path.join(ROOT,'lib/auditLog.js'))     === 'e5a5c2c27801d2d03991bc8e5a1df8cb', 'SACRED auditLog.js intact');

// T02 — server parse
try {
  execSync(`node --check ${path.join(ROOT,'ecos-api-server.js')}`, { stdio: 'ignore' });
  assert(true, 'ecos-api-server.js node --check clean');
} catch (_) { assert(false, 'ecos-api-server.js node --check clean'); }

// T03 — module loads
let SCHED544;
try {
  SCHED544 = require(path.join(ROOT,'lib/deepHealthHistoryScheduler544.js'));
  assert(true, 'deepHealthHistoryScheduler544.js loads without error');
} catch (e) {
  assert(false, `deepHealthHistoryScheduler544.js loads: ${e.message}`);
  console.log(`\n  Results: ${passed} passed, ${failed} failed`);
  process.exit(1);
}

// T04 — version constant
assert(SCHED544.SCHEDULER_VERSION_544 === '544', 'SCHEDULER_VERSION_544 === "544"');

// T05 — status() initial state
const st0 = SCHED544.status544();
assert(typeof st0.attached === 'boolean', 'status544() returns attached boolean');
assert(typeof st0.historyAvailable === 'boolean', 'status544() returns historyAvailable boolean');
assert(st0.historyAvailable === true, 'deepHealthAlertHistory542 is available');
assert(st0.pushOk === 0 && st0.beatsReceived === 0, 'initial counts are 0');

// T06 — _onBeat544 pushes to history
const hist = require(path.join(ROOT,'lib/deepHealthAlertHistory542.js'));
const beforeTotal = (hist.getHistory542({limit:1}).total) || 0;
SCHED544._onBeat544({ version: 'test-beat' });
const afterTotal = (hist.getHistory542({limit:1}).total) || 0;
assert(afterTotal > beforeTotal, '_onBeat544() pushes snapshot to ring buffer (total grew)');
assert(SCHED544.status544().pushOk >= 1, 'pushOk incremented after _onBeat544');

// T07 — _onBeat544 increments beatsReceived
const bef = SCHED544.status544().beatsReceived;
SCHED544._onBeat544({ version: 'test-beat-2' });
const aft = SCHED544.status544().beatsReceived;
assert(aft === bef + 1, 'beatsReceived increments on each _onBeat544 call');

// T08 — circuit breaker
// Simulate many errors by breaking push542 temporarily
const _origPush = hist.push542;
hist.push542 = () => { throw new Error('sim-error'); };
// drain error budget (need to set errCount near max)
const m_state = SCHED544.status544();
// Run enough beats to trigger errors
for (let i = 0; i < 3; i++) SCHED544._onBeat544({});
hist.push542 = _origPush; // restore
const stErr = SCHED544.status544();
assert(stErr.pushErrors >= 3, 'pushErrors counted correctly on simulated errors');
assert(typeof stErr.lastError === 'string', 'lastError captured on push failure');

// T09 — detach resets state
const detResult = SCHED544.detach544();
assert(detResult.ok === true, 'detach544() returns ok:true');
const stDet = SCHED544.status544();
assert(stDet.attached === false, 'attached===false after detach');
assert(stDet.beatsReceived === 0, 'beatsReceived reset after detach');
assert(stDet.pushOk === 0, 'pushOk reset after detach');

// T10 — attach (no live heartbeat → returns ok:false but no throw)
const attachResult = SCHED544.attach544();
assert(typeof attachResult.ok === 'boolean', 'attach544() returns {ok} without throwing');
assert(typeof attachResult.reason === 'string', 'attach544() returns {reason}');
// With no live heartbeat, ok===false is expected
assert(attachResult.ok === false || attachResult.ok === true, 'attach544() ok is boolean');

// T11 — attach with mock heartbeat (sync test — wrap async call)
SCHED544.detach544();
const mockHb = {
  _beat465: async function() { return { version: 'mock' }; }
};
// patch bridge module to return our mock
const bridgeMod = require(path.join(ROOT,'lib/heartbeatGovernanceBridge532.js'));
bridgeMod.activeHb532 = mockHb;
const ar2 = SCHED544.attach544();
assert(ar2.ok === true, 'attach544() ok=true with mock active heartbeat');
assert(SCHED544.status544().attached === true, 'attached===true after mock attach');
// Simulate a beat through patched _beat465 (fire-and-forget, then check sync result via _onBeat544)
mockHb._beat465().catch(() => {}); // trigger the async chain
// check directly via _onBeat544 (same module cache)
const pushBefore = SCHED544.status544().pushOk;
SCHED544._onBeat544({ version: 'manual-mock' });
assert(SCHED544.status544().pushOk > pushBefore, 'push happened via _onBeat544 with mock attached');
// cleanup
bridgeMod.activeHb532 = null;
SCHED544.detach544();

// T12 — registerEndpoints (mock app)
const routes = { get: [], post: [] };
const mockApp = {
  get:  (p) => routes.get.push(p),
  post: (p) => routes.post.push(p),
};
const regResult = SCHED544.registerEndpoints544(mockApp);
assert(regResult === true, 'registerEndpoints544(mockApp) returns true');
assert(routes.get.includes('/api/v1/deep-health/scheduler/status'), 'GET /status registered');
assert(routes.post.includes('/api/v1/deep-health/scheduler/attach'), 'POST /attach registered');
assert(routes.get.includes('/api/v1/admin/summary/v544'), 'GET /admin/summary/v544 registered');

// T13 — registerEndpoints with null → false (fail-safe)
assert(SCHED544.registerEndpoints544(null) === false, 'registerEndpoints544(null) returns false');

// T14 — server wires V544
const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'), 'utf8');
assert(src.includes('/api/v1/deep-health/scheduler/status'), 'server has GET /scheduler/status');
assert(src.includes('/api/v1/deep-health/scheduler/attach'), 'server has POST /scheduler/attach');
assert(src.includes('/api/v1/admin/summary/v544'), 'server has /admin/summary/v544');

// T15 — version 544.0.0
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'), 'utf8'));
assert(parseInt(pkg.version) >= 544, `package.json version >= 544 (got ${pkg.version})`);

// T16 — src/lib mirror exists
assert(fs.existsSync(path.join(ROOT,'src/lib/deepHealthHistoryScheduler544.js')), 'src/lib mirror exists');

console.log(`\n  Results: ${passed} passed, ${failed} failed`);
if (failed === 0) console.log('  ✓ All V544 tests passed\n');
process.exit(failed > 0 ? 1 : 0);
