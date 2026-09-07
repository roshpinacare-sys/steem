'use strict';
/**
 * tests/v281.test.cjs — ECOS V281 Test Suite
 *
 * Self-running suite covering:
 *   A. Version stamps (package.json, .agent-identity.json)
 *   B. New module files + lib mirrors
 *   C. registerDigestSchedule281 — validation, registry
 *   D. deregisterDigestSchedule281 — removal
 *   E. pauseSchedule281 / resumeSchedule281
 *   F. getSchedules281 — list
 *   G. getScheduleHistory281 — storage, since/limit/schedule filters
 *   H. Internal _runSchedule281 — digest + notify wiring
 *   I. SSE client management (add, remove, broadcast, heartbeat, shutdown)
 *   J. checkDigestSchedulerHealth281 + getStatus281 + getPerf281
 *   K. providerAdapters281 (31 contracts, stub validation, pass/fail)
 *   L. API patch (createV281State, route registration, V280 backward compat)
 *   M. Release documentation
 *   N. Sacred file integrity (MD5 verified)
 */

const assert  = require('node:assert/strict');
const crypto  = require('node:crypto');
const path    = require('node:path');
const fs      = require('node:fs');

const ROOT = path.resolve(__dirname, '..');

// ── helpers ────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];
const promises = [];

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      const p = result.then(() => {
        console.log(`  ✓ ${name}`);
        passed++;
      }).catch(err => {
        console.error(`  ✗ ${name}\n    ${err.message}`);
        failed++;
        failures.push({ name, error: err.message });
      });
      promises.push(p);
      return;
    }
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    failed++;
    failures.push({ name, error: err.message });
  }
}

function section(title) {
  console.log(`\n── ${title}`);
}

function makeSchedulerModule() {
  const { DigestScheduler281 } = require('../src/lib/digestScheduler281');
  return DigestScheduler281;
}

function makeMockDigest(overrides = {}) {
  return {
    ok:          true,
    digestId:    crypto.randomUUID(),
    version:     '279',
    period:      overrides.period    || 'scheduled',
    totalAlerts: overrides.totalAlerts || 0,
    breached:    overrides.breached    ?? 0,
    ts:          new Date().toISOString(),
    ...overrides,
  };
}

function makeMockAlertDigest(digest = null) {
  return {
    generateAlertDigest279: (opts = {}) => digest || makeMockDigest({ period: opts.period || 'scheduled' }),
  };
}

function makeMockNotificationChannel(result = null) {
  return {
    notifyDigest280: async (digest, opts = {}) => result || { ok: true, attempted: 1, delivered: 1, failed: 0, deliveries: [], version: '280', ts: new Date().toISOString() },
  };
}

function makeMockSseRes() {
  const writes = [];
  return {
    _writes: writes,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    flushHeaders() {},
    write(data) { writes.push(data); return true; },
    end() { this._ended = true; },
    on(event, fn) { this[`_on_${event}`] = fn; },
    status(code) { this._statusCode = code; return this; },
    json(obj) { this._jsonBody = obj; },
  };
}

// ── A. Version stamps ──────────────────────────────────────────────────────────
section('A. Version stamps');

test('package.json version is 281.0.0', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '281.0.0');
});

test('.agent-identity.json ecosVersion is 281.0.0', () => {
  const id = JSON.parse(fs.readFileSync(path.join(ROOT, '.agent-identity.json'), 'utf8'));
  assert.equal(id.ecosVersion, '281.0.0');
});

// ── B. Module files + lib mirrors ─────────────────────────────────────────────
section('B. Module files + lib mirrors');

test('src/lib/digestScheduler281.js exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'src/lib/digestScheduler281.js')));
});

test('lib/digestScheduler281.js exists (mirror)', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'lib/digestScheduler281.js')));
});

test('src/lib/providerAdapters281.js exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'src/lib/providerAdapters281.js')));
});

test('lib/providerAdapters281.js exists (mirror)', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'lib/providerAdapters281.js')));
});

test('ecos-api-server-v281-patch.js exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'ecos-api-server-v281-patch.js')));
});

test('DigestScheduler281 is a class', () => {
  const DigestScheduler281 = makeSchedulerModule();
  assert.equal(typeof DigestScheduler281, 'function');
});

// ── C. registerDigestSchedule281 ──────────────────────────────────────────────
section('C. registerDigestSchedule281');

test('registers a valid schedule and returns ok', () => {
  const DigestScheduler281 = makeSchedulerModule();
  const s = new DigestScheduler281();
  const r = s.registerDigestSchedule281('test-schedule', { intervalMs: 10000 });
  assert.ok(r.ok);
  assert.equal(r.name, 'test-schedule');
  assert.equal(r.intervalMs, 10000);
  assert.equal(r.paused, false);
  assert.equal(r.version, '281');
  s.shutdown281();
});

test('rejects missing name', () => {
  const DigestScheduler281 = makeSchedulerModule();
  const s = new DigestScheduler281();
  const r = s.registerDigestSchedule281('', { intervalMs: 10000 });
  assert.equal(r.ok, false);
  s.shutdown281();
});

test('rejects intervalMs too small', () => {
  const DigestScheduler281 = makeSchedulerModule();
  const s = new DigestScheduler281();
  const r = s.registerDigestSchedule281('x', { intervalMs: 100 });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('intervalMs'));
  s.shutdown281();
});

test('rejects duplicate schedule name', () => {
  const DigestScheduler281 = makeSchedulerModule();
  const s = new DigestScheduler281();
  s.registerDigestSchedule281('dup', { intervalMs: 10000 });
  const r = s.registerDigestSchedule281('dup', { intervalMs: 10000 });
  assert.equal(r.ok, false);
  s.shutdown281();
});

test('registers channels array', () => {
  const DigestScheduler281 = makeSchedulerModule();
  const s = new DigestScheduler281();
  const r = s.registerDigestSchedule281('ch-test', { intervalMs: 10000, channels: ['ch1', 'ch2'] });
  assert.ok(r.ok);
  assert.deepEqual(r.channels, ['ch1', 'ch2']);
  s.shutdown281();
});

// ── D. deregisterDigestSchedule281 ────────────────────────────────────────────
section('D. deregisterDigestSchedule281');

test('removes a registered schedule', () => {
  const DigestScheduler281 = makeSchedulerModule();
  const s = new DigestScheduler281();
  s.registerDigestSchedule281('rem', { intervalMs: 10000 });
  const r = s.deregisterDigestSchedule281('rem');
  assert.ok(r.ok);
  assert.equal(r.name, 'rem');
  const list = s.getSchedules281();
  assert.equal(list.schedules.length, 0);
  s.shutdown281();
});

test('returns error for unknown schedule', () => {
  const DigestScheduler281 = makeSchedulerModule();
  const s = new DigestScheduler281();
  const r = s.deregisterDigestSchedule281('ghost');
  assert.equal(r.ok, false);
  s.shutdown281();
});

// ── E. pauseSchedule281 / resumeSchedule281 ───────────────────────────────────
section('E. pauseSchedule281 / resumeSchedule281');

test('pause sets schedule to paused', () => {
  const DigestScheduler281 = makeSchedulerModule();
  const s = new DigestScheduler281();
  s.registerDigestSchedule281('pausable', { intervalMs: 10000 });
  const r = s.pauseSchedule281('pausable');
  assert.ok(r.ok);
  assert.equal(r.paused, true);
  const list = s.getSchedules281();
  assert.ok(list.schedules[0].paused);
  s.shutdown281();
});

test('double-pause returns error', () => {
  const DigestScheduler281 = makeSchedulerModule();
  const s = new DigestScheduler281();
  s.registerDigestSchedule281('pp', { intervalMs: 10000 });
  s.pauseSchedule281('pp');
  const r = s.pauseSchedule281('pp');
  assert.equal(r.ok, false);
  s.shutdown281();
});

test('resume restores schedule to active', () => {
  const DigestScheduler281 = makeSchedulerModule();
  const s = new DigestScheduler281();
  s.registerDigestSchedule281('res', { intervalMs: 10000 });
  s.pauseSchedule281('res');
  const r = s.resumeSchedule281('res');
  assert.ok(r.ok);
  assert.equal(r.paused, false);
  s.shutdown281();
});

test('resume on active schedule returns error', () => {
  const DigestScheduler281 = makeSchedulerModule();
  const s = new DigestScheduler281();
  s.registerDigestSchedule281('ra', { intervalMs: 10000 });
  const r = s.resumeSchedule281('ra');
  assert.equal(r.ok, false);
  s.shutdown281();
});

// ── F. getSchedules281 ────────────────────────────────────────────────────────
section('F. getSchedules281');

test('lists all registered schedules', () => {
  const DigestScheduler281 = makeSchedulerModule();
  const s = new DigestScheduler281();
  s.registerDigestSchedule281('s1', { intervalMs: 10000 });
  s.registerDigestSchedule281('s2', { intervalMs: 20000 });
  const list = s.getSchedules281();
  assert.ok(list.ok);
  assert.equal(list.total, 2);
  assert.equal(list.schedules.length, 2);
  assert.equal(list.version, '281');
  s.shutdown281();
});

test('returns empty list when no schedules', () => {
  const DigestScheduler281 = makeSchedulerModule();
  const s = new DigestScheduler281();
  const list = s.getSchedules281();
  assert.ok(list.ok);
  assert.equal(list.total, 0);
  s.shutdown281();
});

// ── G. getScheduleHistory281 ──────────────────────────────────────────────────
section('G. getScheduleHistory281');

test('returns empty history initially', () => {
  const DigestScheduler281 = makeSchedulerModule();
  const s = new DigestScheduler281();
  const h = s.getScheduleHistory281();
  assert.ok(h.ok);
  assert.equal(h.total, 0);
  assert.equal(h.version, '281');
  s.shutdown281();
});

test('returns history after a run', async () => {
  const DigestScheduler281 = makeSchedulerModule();
  const s = new DigestScheduler281({
    alertDigest: makeMockAlertDigest(),
    notificationChannel: makeMockNotificationChannel(),
  });
  s.registerDigestSchedule281('hist-test', { intervalMs: 60000 });
  await s._runSchedule281('hist-test');
  const h = s.getScheduleHistory281();
  assert.equal(h.total, 1);
  assert.ok(h.runs[0].ok);
  assert.equal(h.runs[0].name, 'hist-test');
  s.shutdown281();
});

test('filters history by schedule name', async () => {
  const DigestScheduler281 = makeSchedulerModule();
  const s = new DigestScheduler281({
    alertDigest: makeMockAlertDigest(),
    notificationChannel: makeMockNotificationChannel(),
  });
  s.registerDigestSchedule281('sched-a', { intervalMs: 60000 });
  s.registerDigestSchedule281('sched-b', { intervalMs: 60000 });
  await s._runSchedule281('sched-a');
  await s._runSchedule281('sched-b');
  const h = s.getScheduleHistory281({ schedule: 'sched-a' });
  assert.equal(h.total, 1);
  assert.equal(h.runs[0].name, 'sched-a');
  s.shutdown281();
});

test('respects limit parameter', async () => {
  const DigestScheduler281 = makeSchedulerModule();
  const s = new DigestScheduler281({ alertDigest: makeMockAlertDigest(), notificationChannel: makeMockNotificationChannel() });
  s.registerDigestSchedule281('lim', { intervalMs: 60000 });
  for (let i = 0; i < 5; i++) await s._runSchedule281('lim');
  const h = s.getScheduleHistory281({ limit: 3 });
  assert.ok(h.runs.length <= 3);
  s.shutdown281();
});

// ── H. Internal _runSchedule281 ───────────────────────────────────────────────
section('H. Internal _runSchedule281');

test('run calls generateAlertDigest279 and notifyDigest280', async () => {
  const DigestScheduler281 = makeSchedulerModule();
  let digestCalled = false;
  let notifyCalled = false;

  const mockDigest = { ...makeMockAlertDigest(), generateAlertDigest279: (opts) => { digestCalled = true; return makeMockDigest(); } };
  const mockNotify = { notifyDigest280: async () => { notifyCalled = true; return { ok: true, attempted: 1, delivered: 1, failed: 0, deliveries: [] }; } };

  const s = new DigestScheduler281({ alertDigest: mockDigest, notificationChannel: mockNotify });
  s.registerDigestSchedule281('wired', { intervalMs: 60000 });
  await s._runSchedule281('wired');

  assert.ok(digestCalled, 'generateAlertDigest279 was called');
  assert.ok(notifyCalled, 'notifyDigest280 was called');
  assert.equal(s._schedules281.get('wired').runCount, 1);
  s.shutdown281();
});

test('run records ok:false on alertDigest error', async () => {
  const DigestScheduler281 = makeSchedulerModule();
  const mockDigest = { generateAlertDigest279: () => { throw new Error('digest fail'); } };
  const s = new DigestScheduler281({ alertDigest: mockDigest });
  s.registerDigestSchedule281('errored', { intervalMs: 60000 });
  await s._runSchedule281('errored');
  const h = s.getScheduleHistory281();
  assert.equal(h.total, 1);
  assert.equal(h.runs[0].ok, false);
  assert.ok(h.runs[0].error);
  assert.equal(s._schedules281.get('errored').failCount, 1);
  s.shutdown281();
});

test('run skips paused schedule', async () => {
  const DigestScheduler281 = makeSchedulerModule();
  const s = new DigestScheduler281({ alertDigest: makeMockAlertDigest(), notificationChannel: makeMockNotificationChannel() });
  s.registerDigestSchedule281('skip', { intervalMs: 60000 });
  s.pauseSchedule281('skip');
  await s._runSchedule281('skip');
  const h = s.getScheduleHistory281();
  assert.equal(h.total, 0);
  s.shutdown281();
});

// ── I. SSE client management ──────────────────────────────────────────────────
section('I. SSE client management');

test('addScheduleSseClient281 sends initial schedules event', () => {
  const DigestScheduler281 = makeSchedulerModule();
  const s = new DigestScheduler281();
  s.registerDigestSchedule281('sse-sched', { intervalMs: 10000 });
  const res = makeMockSseRes();
  const id = s.addScheduleSseClient281(res);
  assert.ok(typeof id === 'string');
  assert.ok(res._writes.length > 0);
  const payload = JSON.parse(res._writes[0].replace(/^data: /, '').replace(/\n\n$/, ''));
  assert.equal(payload.type, 'schedules');
  assert.ok(Array.isArray(payload.schedules));
  s.shutdown281();
});

test('removeScheduleSseClient281 removes client', () => {
  const DigestScheduler281 = makeSchedulerModule();
  const s = new DigestScheduler281();
  const res = makeMockSseRes();
  const id = s.addScheduleSseClient281(res);
  assert.equal(s._sseClients281.size, 1);
  s.removeScheduleSseClient281(id);
  assert.equal(s._sseClients281.size, 0);
  s.shutdown281();
});

test('shutdown281 clears all timers and SSE clients', () => {
  const DigestScheduler281 = makeSchedulerModule();
  const s = new DigestScheduler281();
  s.registerDigestSchedule281('shut1', { intervalMs: 10000 });
  s.registerDigestSchedule281('shut2', { intervalMs: 20000 });
  const res = makeMockSseRes();
  s.addScheduleSseClient281(res);
  s.shutdown281();
  assert.equal(s._timers281.size, 0);
  assert.equal(s._sseClients281.size, 0);
});

// ── J. Health + status + perf ─────────────────────────────────────────────────
section('J. checkDigestSchedulerHealth281 + getStatus281 + getPerf281');

test('getStatus281 returns correct counts', () => {
  const DigestScheduler281 = makeSchedulerModule();
  const s = new DigestScheduler281();
  s.registerDigestSchedule281('st1', { intervalMs: 10000 });
  s.registerDigestSchedule281('st2', { intervalMs: 10000 });
  s.pauseSchedule281('st2');
  const status = s.getStatus281();
  assert.ok(status.ok);
  assert.equal(status.version, '281');
  assert.equal(status.activeSchedules, 1);
  assert.equal(status.pausedSchedules, 1);
  s.shutdown281();
});

test('checkDigestSchedulerHealth281 returns health object', () => {
  const DigestScheduler281 = makeSchedulerModule();
  const s = new DigestScheduler281();
  const h = s.checkDigestSchedulerHealth281();
  assert.ok(h.ok);
  assert.equal(h.version, '281');
  assert.ok('activeSchedules' in h);
  assert.ok('pendingTimers' in h);
  s.shutdown281();
});

test('getPerf281 returns latency structure', () => {
  const DigestScheduler281 = makeSchedulerModule();
  const s = new DigestScheduler281();
  const p = s.getPerf281();
  assert.ok('p50' in p && 'p95' in p && 'p99' in p && 'count' in p);
  s.shutdown281();
});

// ── K. providerAdapters281 ────────────────────────────────────────────────────
section('K. providerAdapters281 — 31 contracts');

test('PROVIDER_CONTRACTS_281 has 31 contracts', () => {
  const { PROVIDER_CONTRACTS_281 } = require('../src/lib/providerAdapters281');
  const count = Object.keys(PROVIDER_CONTRACTS_281).length;
  assert.equal(count, 31);
});

test('digestScheduler contract has required methods', () => {
  const { PROVIDER_CONTRACTS_281 } = require('../src/lib/providerAdapters281');
  const contract = PROVIDER_CONTRACTS_281.digestScheduler;
  assert.ok(contract);
  assert.ok(contract.required.includes('registerDigestSchedule281'));
  assert.ok(contract.required.includes('deregisterDigestSchedule281'));
  assert.ok(contract.required.includes('pauseSchedule281'));
  assert.ok(contract.required.includes('resumeSchedule281'));
  assert.ok(contract.required.includes('getSchedules281'));
});

test('validateProvider281 passes a valid digestScheduler', () => {
  const { validateProvider281 } = require('../src/lib/providerAdapters281');
  const DigestScheduler281 = makeSchedulerModule();
  const s = new DigestScheduler281();
  const r = validateProvider281('digestScheduler', s);
  assert.ok(r.ok);
  assert.equal(r.errors.length, 0);
  s.shutdown281();
});

test('validateProvider281 fails an empty object', () => {
  const { validateProvider281 } = require('../src/lib/providerAdapters281');
  const r = validateProvider281('digestScheduler', {});
  assert.equal(r.ok, false);
  assert.ok(r.errors.length > 0);
});

test('createDigestSchedulerStub281 passes validation', () => {
  const { validateProvider281, createDigestSchedulerStub281 } = require('../src/lib/providerAdapters281');
  const stub = createDigestSchedulerStub281();
  const r = validateProvider281('digestScheduler', stub);
  assert.ok(r.ok);
});

test('createAllStubs281 has digestScheduler key', () => {
  const { createAllStubs281 } = require('../src/lib/providerAdapters281');
  const stubs = createAllStubs281();
  assert.ok('digestScheduler' in stubs);
  assert.ok('notificationChannel' in stubs); // V280 still present
});

// ── L. API patch ──────────────────────────────────────────────────────────────
section('L. API patch — createV281State + routes');

test('createV281State extends v280State with digestScheduler281', () => {
  const { createV281State } = require('../ecos-api-server-v281-patch');
  const state = createV281State({});
  assert.ok(state.digestScheduler281);
  assert.ok(typeof state.digestScheduler281.registerDigestSchedule281 === 'function');
});

test('createV281State wires alertDigest and notificationChannel from v280State', () => {
  const { createV281State } = require('../ecos-api-server-v281-patch');
  const mockDigest = makeMockAlertDigest();
  const mockNotify = makeMockNotificationChannel();
  const state = createV281State({ alertDigest279: mockDigest, notificationChannel280: mockNotify });
  assert.equal(state.digestScheduler281._alertDigest281, mockDigest);
  assert.equal(state.digestScheduler281._notificationChannel281, mockNotify);
  state.digestScheduler281.shutdown281();
});

test('registerV281Routes registers all expected routes', () => {
  const { createV281State, registerV281Routes } = require('../ecos-api-server-v281-patch');
  const registeredRoutes = [];
  const mockApp = {
    get:    (path) => registeredRoutes.push({ method: 'GET', path }),
    post:   (path) => registeredRoutes.push({ method: 'POST', path }),
    delete: (path) => registeredRoutes.push({ method: 'DELETE', path }),
  };
  const state = createV281State({});
  registerV281Routes(mockApp, state);
  const paths = registeredRoutes.map(r => r.path);
  assert.ok(paths.includes('/api/v281/health'));
  assert.ok(paths.includes('/api/v281/alerts/schedules'));
  assert.ok(paths.includes('/api/v281/alerts/schedules/history'));
  assert.ok(paths.includes('/api/v281/alerts/schedules/subscribe'));
  state.digestScheduler281.shutdown281();
});

test('V280 backward compat: PROVIDER_CONTRACTS_280 still accessible from v281 adapters', () => {
  const { PROVIDER_CONTRACTS_280 } = require('../src/lib/providerAdapters281');
  assert.ok(PROVIDER_CONTRACTS_280);
  assert.equal(Object.keys(PROVIDER_CONTRACTS_280).length, 30);
});

// ── M. Release documentation ──────────────────────────────────────────────────
section('M. Release documentation');

test('CHANGELOG_V281.md exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'CHANGELOG_V281.md')));
});

test('AI_PROTOCOL_V281.md exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'AI_PROTOCOL_V281.md')));
});

test('NEXT_SESSION_PROMPT_V281.md exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'NEXT_SESSION_PROMPT_V281.md')));
});

test('CHANGELOG_V281.md mentions digestScheduler', () => {
  const content = fs.readFileSync(path.join(ROOT, 'CHANGELOG_V281.md'), 'utf8');
  assert.ok(content.includes('digestScheduler') || content.includes('DigestScheduler'));
});

// ── N. Sacred file integrity ───────────────────────────────────────────────────
section('N. Sacred file integrity');

const SACRED_FILES = [
  { relPath: 'src/lib/fiatLedger.js',   md5: '563e9b1f' },
  { relPath: 'src/lib/auditLog.js',      md5: 'e5a5c2c2' },
];

for (const { relPath, md5 } of SACRED_FILES) {
  test(`${relPath} MD5 prefix matches ${md5}`, () => {
    const full = path.join(ROOT, relPath);
    assert.ok(fs.existsSync(full), `${relPath} does not exist`);
    const hash = crypto.createHash('md5').update(fs.readFileSync(full)).digest('hex');
    assert.ok(hash.startsWith(md5), `${relPath} MD5 mismatch: got ${hash.slice(0, 8)}, expected prefix ${md5}`);
  });
}

// ── Runner ────────────────────────────────────────────────────────────────────

async function run() {
  await Promise.all(promises);
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.error('\nFailed tests:');
    for (const f of failures) console.error(`  • ${f.name}: ${f.error}`);
    process.exitCode = 1;
  } else {
    console.log('✅ All V281 tests passed');
  }
}

run();
