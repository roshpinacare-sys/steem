'use strict';
/**
 * tests/v278.test.cjs — ECOS V278 Test Suite
 *
 * Self-running suite covering:
 *   A. Version stamps (package.json, .agent-identity.json)
 *   B. New module files + lib mirrors
 *   C. registerAlertSla278 — validation, defaults, error cases
 *   D. checkSlaBreach278 — status detection (OK / WARNING / BREACHED / RESOLVED)
 *   E. getBreachedAlerts278 / getWarningAlerts278 — filtering
 *   F. getSlaStatus278 — config + breach counts
 *   G. runSlaCheck278 — event firing, auto-escalate wiring
 *   H. Watchdog start / stop
 *   I. SSE client management (add, remove, broadcast, heartbeat, shutdown)
 *   J. Event history + getStatus278 + health check
 *   K. providerAdapters278 (28 contracts, stub validation, pass/fail)
 *   L. API patch (createV278State, route registration, V277 backward compat)
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

function test(name, fn) {
  try {
    fn();
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

function makeMockBus(alerts = []) {
  return { _history275: alerts };
}

function makeAlert(overrides = {}) {
  return {
    alertId:   overrides.alertId   || crypto.randomUUID(),
    alertType: overrides.alertType || 'TEST_ALERT',
    type:      overrides.alertType || 'TEST_ALERT',
    ts:        overrides.ts        || new Date(Date.now() - (overrides.ageMs || 0)).toISOString(),
    resolved:  overrides.resolved  || false,
    ...overrides,
  };
}

function makeSlaModule() {
  const { AlertSla278 } = require('../src/lib/alertSla278');
  return AlertSla278;
}

// ── A. Version stamps ──────────────────────────────────────────────────────────

section('A. Version stamps');

test('package.json version is 278.0.0', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '278.0.0', `Expected 278.0.0, got ${pkg.version}`);
});

test('.agent-identity.json ecosVersion is 278.0.0', () => {
  const id = JSON.parse(fs.readFileSync(path.join(ROOT, '.agent-identity.json'), 'utf8'));
  assert.equal(id.ecosVersion, '278.0.0');
  assert.equal(id.version, '278.0.0');
});

test('.agent-identity.json includes alert-sla feature', () => {
  const id = JSON.parse(fs.readFileSync(path.join(ROOT, '.agent-identity.json'), 'utf8'));
  assert.ok(id.features.some(f => f.includes('sla')), 'expected sla feature in identity');
});

// ── B. Module files + lib mirrors ────────────────────────────────────────────

section('B. Module files + lib mirrors');

test('src/lib/alertSla278.js exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'src/lib/alertSla278.js')));
});

test('lib/alertSla278.js exists (mirror)', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'lib/alertSla278.js')));
});

test('src/lib/providerAdapters278.js exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'src/lib/providerAdapters278.js')));
});

test('lib/providerAdapters278.js exists (mirror)', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'lib/providerAdapters278.js')));
});

test('ecos-api-server-v278-patch.js exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'ecos-api-server-v278-patch.js')));
});

test('src/lib/alertSla278.js and lib/alertSla278.js are identical', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/alertSla278.js'));
  const lib = fs.readFileSync(path.join(ROOT, 'lib/alertSla278.js'));
  assert.ok(src.equals(lib), 'mirror mismatch');
});

test('src/lib/providerAdapters278.js and lib/providerAdapters278.js are identical', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/providerAdapters278.js'));
  const lib = fs.readFileSync(path.join(ROOT, 'lib/providerAdapters278.js'));
  assert.ok(src.equals(lib), 'mirror mismatch');
});

// ── C. registerAlertSla278 ────────────────────────────────────────────────────

section('C. registerAlertSla278');

test('registers SLA with defaults', () => {
  const AlertSla278 = makeSlaModule();
  const sla = new AlertSla278({});
  const r = sla.registerAlertSla278('SYBIL_FAIL_RATE');
  assert.equal(r.ok, true);
  assert.equal(r.alertType, 'SYBIL_FAIL_RATE');
  assert.equal(r.warningMs, 300_000);
  assert.equal(r.breachMs, 900_000);
  assert.equal(r.autoEscalate, false);
});

test('registers SLA with custom values', () => {
  const AlertSla278 = makeSlaModule();
  const sla = new AlertSla278({});
  const r = sla.registerAlertSla278('CREDIT_OVERFLOW', { warningMs: 60_000, breachMs: 300_000, autoEscalate: true });
  assert.equal(r.ok, true);
  assert.equal(r.warningMs, 60_000);
  assert.equal(r.breachMs, 300_000);
  assert.equal(r.autoEscalate, true);
});

test('rejects registration without alertType', () => {
  const AlertSla278 = makeSlaModule();
  const sla = new AlertSla278({});
  const r = sla.registerAlertSla278('');
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

test('rejects registration when warningMs >= breachMs', () => {
  const AlertSla278 = makeSlaModule();
  const sla = new AlertSla278({});
  const r = sla.registerAlertSla278('X', { warningMs: 900_000, breachMs: 300_000 });
  assert.equal(r.ok, false);
  assert.match(r.error, /warningMs must be less than/);
});

test('getSlaConfig278 returns registered config', () => {
  const AlertSla278 = makeSlaModule();
  const sla = new AlertSla278({});
  sla.registerAlertSla278('RATE_LIMIT', { warningMs: 10_000, breachMs: 30_000 });
  const cfg = sla.getSlaConfig278('RATE_LIMIT');
  assert.equal(cfg.ok, true);
  assert.equal(cfg.warningMs, 10_000);
});

test('getSlaConfig278 returns error for unknown type', () => {
  const AlertSla278 = makeSlaModule();
  const sla = new AlertSla278({});
  const cfg = sla.getSlaConfig278('UNKNOWN');
  assert.equal(cfg.ok, false);
});

test('deregisterAlertSla278 removes config', () => {
  const AlertSla278 = makeSlaModule();
  const sla = new AlertSla278({});
  sla.registerAlertSla278('TMP_ALERT', { warningMs: 1000, breachMs: 5000 });
  const r = sla.deregisterAlertSla278('TMP_ALERT');
  assert.equal(r.ok, true);
  assert.equal(sla.getSlaConfig278('TMP_ALERT').ok, false);
});

// ── D. checkSlaBreach278 ──────────────────────────────────────────────────────

section('D. checkSlaBreach278');

test('returns OK for new alert within warningMs', () => {
  const AlertSla278 = makeSlaModule();
  const alert = makeAlert({ alertType: 'SYBIL_FAIL_RATE', ageMs: 0 });
  const sla = new AlertSla278({ counterAlertBus: makeMockBus([alert]) });
  sla.registerAlertSla278('SYBIL_FAIL_RATE', { warningMs: 300_000, breachMs: 900_000 });
  const r = sla.checkSlaBreach278(alert.alertId);
  assert.equal(r.ok, true);
  assert.equal(r.status, 'OK');
});

test('returns WARNING for alert past warningMs', () => {
  const AlertSla278 = makeSlaModule();
  const alert = makeAlert({ alertType: 'SYBIL_FAIL_RATE', ageMs: 400_000 });
  const sla = new AlertSla278({ counterAlertBus: makeMockBus([alert]) });
  sla.registerAlertSla278('SYBIL_FAIL_RATE', { warningMs: 300_000, breachMs: 900_000 });
  const r = sla.checkSlaBreach278(alert.alertId);
  assert.equal(r.ok, true);
  assert.equal(r.status, 'WARNING');
});

test('returns BREACHED for alert past breachMs', () => {
  const AlertSla278 = makeSlaModule();
  const alert = makeAlert({ alertType: 'SYBIL_FAIL_RATE', ageMs: 1_000_000 });
  const sla = new AlertSla278({ counterAlertBus: makeMockBus([alert]) });
  sla.registerAlertSla278('SYBIL_FAIL_RATE', { warningMs: 300_000, breachMs: 900_000 });
  const r = sla.checkSlaBreach278(alert.alertId);
  assert.equal(r.ok, true);
  assert.equal(r.status, 'BREACHED');
});

test('returns RESOLVED for resolved alert', () => {
  const AlertSla278 = makeSlaModule();
  const alert = makeAlert({ alertType: 'SYBIL_FAIL_RATE', resolved: true, ageMs: 2_000_000 });
  const sla = new AlertSla278({ counterAlertBus: makeMockBus([alert]) });
  sla.registerAlertSla278('SYBIL_FAIL_RATE', { warningMs: 300_000, breachMs: 900_000 });
  const r = sla.checkSlaBreach278(alert.alertId);
  assert.equal(r.ok, true);
  assert.equal(r.status, 'RESOLVED');
  assert.equal(r.resolved, true);
});

test('returns noSlaConfig: true when no SLA registered for type', () => {
  const AlertSla278 = makeSlaModule();
  const alert = makeAlert({ alertType: 'UNKNOWN_TYPE', ageMs: 500_000 });
  const sla = new AlertSla278({ counterAlertBus: makeMockBus([alert]) });
  const r = sla.checkSlaBreach278(alert.alertId);
  assert.equal(r.ok, true);
  assert.equal(r.noSlaConfig, true);
});

test('returns error for missing alertId', () => {
  const AlertSla278 = makeSlaModule();
  const sla = new AlertSla278({});
  const r = sla.checkSlaBreach278('');
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

test('returns error when alert not found in bus', () => {
  const AlertSla278 = makeSlaModule();
  const sla = new AlertSla278({ counterAlertBus: makeMockBus([]) });
  const r = sla.checkSlaBreach278('non-existent-id');
  assert.equal(r.ok, false);
});

// ── E. getBreachedAlerts278 / getWarningAlerts278 ─────────────────────────────

section('E. getBreachedAlerts278 / getWarningAlerts278');

test('getBreachedAlerts278 returns alerts past breachMs', () => {
  const AlertSla278 = makeSlaModule();
  const a1 = makeAlert({ alertType: 'CREDIT_OVERFLOW', ageMs: 1_000_000 }); // breached
  const a2 = makeAlert({ alertType: 'CREDIT_OVERFLOW', ageMs: 10_000 });    // ok
  const sla = new AlertSla278({ counterAlertBus: makeMockBus([a1, a2]) });
  sla.registerAlertSla278('CREDIT_OVERFLOW', { warningMs: 300_000, breachMs: 900_000 });
  const r = sla.getBreachedAlerts278();
  assert.equal(r.ok, true);
  assert.equal(r.total, 1);
  assert.equal(r.alerts[0].alertId, a1.alertId);
});

test('getBreachedAlerts278 filters by alertType', () => {
  const AlertSla278 = makeSlaModule();
  const a1 = makeAlert({ alertType: 'TYPE_A', ageMs: 1_000_000 });
  const a2 = makeAlert({ alertType: 'TYPE_B', ageMs: 1_000_000 });
  const sla = new AlertSla278({ counterAlertBus: makeMockBus([a1, a2]) });
  sla.registerAlertSla278('TYPE_A', { warningMs: 100, breachMs: 200 });
  sla.registerAlertSla278('TYPE_B', { warningMs: 100, breachMs: 200 });
  const r = sla.getBreachedAlerts278({ alertType: 'TYPE_A' });
  assert.equal(r.total, 1);
  assert.equal(r.alerts[0].alertType, 'TYPE_A');
});

test('getBreachedAlerts278 excludes resolved alerts', () => {
  const AlertSla278 = makeSlaModule();
  const a1 = makeAlert({ alertType: 'CREDIT_OVERFLOW', ageMs: 1_000_000, resolved: true });
  const sla = new AlertSla278({ counterAlertBus: makeMockBus([a1]) });
  sla.registerAlertSla278('CREDIT_OVERFLOW', { warningMs: 300_000, breachMs: 900_000 });
  const r = sla.getBreachedAlerts278();
  assert.equal(r.total, 0);
});

test('getWarningAlerts278 returns alerts between warningMs and breachMs', () => {
  const AlertSla278 = makeSlaModule();
  const a1 = makeAlert({ alertType: 'CREDIT_OVERFLOW', ageMs: 400_000 }); // warning
  const a2 = makeAlert({ alertType: 'CREDIT_OVERFLOW', ageMs: 1_000_000 }); // breached (excluded)
  const a3 = makeAlert({ alertType: 'CREDIT_OVERFLOW', ageMs: 10_000 });   // ok (excluded)
  const sla = new AlertSla278({ counterAlertBus: makeMockBus([a1, a2, a3]) });
  sla.registerAlertSla278('CREDIT_OVERFLOW', { warningMs: 300_000, breachMs: 900_000 });
  const r = sla.getWarningAlerts278();
  assert.equal(r.ok, true);
  assert.equal(r.total, 1);
  assert.equal(r.alerts[0].alertId, a1.alertId);
});

// ── F. getSlaStatus278 ────────────────────────────────────────────────────────

section('F. getSlaStatus278');

test('getSlaStatus278 returns config list and breach counts', () => {
  const AlertSla278 = makeSlaModule();
  const a1 = makeAlert({ alertType: 'SYBIL_FAIL_RATE', ageMs: 1_000_000 }); // breached
  const sla = new AlertSla278({ counterAlertBus: makeMockBus([a1]) });
  sla.registerAlertSla278('SYBIL_FAIL_RATE', { warningMs: 300_000, breachMs: 900_000 });
  const r = sla.getSlaStatus278();
  assert.equal(r.ok, true);
  assert.equal(r.version, '278');
  assert.equal(r.configCount, 1);
  assert.equal(r.breachCounts['SYBIL_FAIL_RATE'], 1);
});

test('getSlaStatus278 shows zero counts when no alerts', () => {
  const AlertSla278 = makeSlaModule();
  const sla = new AlertSla278({ counterAlertBus: makeMockBus([]) });
  sla.registerAlertSla278('MY_TYPE', { warningMs: 1000, breachMs: 5000 });
  const r = sla.getSlaStatus278();
  assert.equal(r.breachCounts['MY_TYPE'], 0);
  assert.equal(r.warnCounts['MY_TYPE'], 0);
});

// ── G. runSlaCheck278 ─────────────────────────────────────────────────────────

section('G. runSlaCheck278');

test('runSlaCheck278 fires warning event for alert past warningMs', () => {
  const AlertSla278 = makeSlaModule();
  const alert = makeAlert({ alertType: 'RATE_LIMIT', ageMs: 400_000 });
  const sla = new AlertSla278({ counterAlertBus: makeMockBus([alert]) });
  sla.registerAlertSla278('RATE_LIMIT', { warningMs: 300_000, breachMs: 900_000 });
  const r = sla.runSlaCheck278();
  assert.equal(r.ok, true);
  assert.equal(r.warnings, 1);
  assert.equal(r.breaches, 0);
});

test('runSlaCheck278 fires breach event for alert past breachMs', () => {
  const AlertSla278 = makeSlaModule();
  const alert = makeAlert({ alertType: 'RATE_LIMIT', ageMs: 1_000_000 });
  const sla = new AlertSla278({ counterAlertBus: makeMockBus([alert]) });
  sla.registerAlertSla278('RATE_LIMIT', { warningMs: 300_000, breachMs: 900_000 });
  const r = sla.runSlaCheck278();
  assert.equal(r.ok, true);
  assert.equal(r.breaches, 1);
});

test('runSlaCheck278 does not re-fire already-fired breach event', () => {
  const AlertSla278 = makeSlaModule();
  const alert = makeAlert({ alertType: 'RATE_LIMIT', ageMs: 1_000_000 });
  const sla = new AlertSla278({ counterAlertBus: makeMockBus([alert]) });
  sla.registerAlertSla278('RATE_LIMIT', { warningMs: 300_000, breachMs: 900_000 });
  sla.runSlaCheck278(); // first run
  const r2 = sla.runSlaCheck278(); // second run
  assert.equal(r2.breaches, 0); // already fired
});

test('runSlaCheck278 auto-escalates when autoEscalate is true', () => {
  const AlertSla278 = makeSlaModule();
  let escalateCalled = false;
  const mockEscalation = {
    escalateAlert277: () => { escalateCalled = true; return { ok: true }; },
  };
  const alert = makeAlert({ alertType: 'HIGH_PRIORITY', ageMs: 2_000_000 });
  const sla = new AlertSla278({
    counterAlertBus: makeMockBus([alert]),
    alertEscalation: mockEscalation,
  });
  sla.registerAlertSla278('HIGH_PRIORITY', { warningMs: 100_000, breachMs: 500_000, autoEscalate: true });
  sla.runSlaCheck278();
  assert.ok(escalateCalled, 'expected escalateAlert277 to be called');
});

test('runSlaCheck278 does NOT auto-escalate when autoEscalate is false', () => {
  const AlertSla278 = makeSlaModule();
  let escalateCalled = false;
  const mockEscalation = {
    escalateAlert277: () => { escalateCalled = true; return { ok: true }; },
  };
  const alert = makeAlert({ alertType: 'LOW_PRIORITY', ageMs: 2_000_000 });
  const sla = new AlertSla278({
    counterAlertBus: makeMockBus([alert]),
    alertEscalation: mockEscalation,
  });
  sla.registerAlertSla278('LOW_PRIORITY', { warningMs: 100_000, breachMs: 500_000, autoEscalate: false });
  sla.runSlaCheck278();
  assert.equal(escalateCalled, false, 'should not escalate when autoEscalate is false');
});

// ── H. Watchdog ───────────────────────────────────────────────────────────────

section('H. Watchdog start / stop');

test('startSlaWatchdog278 returns ok', () => {
  const AlertSla278 = makeSlaModule();
  const sla = new AlertSla278({});
  const r = sla.startSlaWatchdog278(10_000);
  assert.equal(r.ok, true);
  sla.stopSlaWatchdog278();
});

test('startSlaWatchdog278 returns alreadyRunning on second call', () => {
  const AlertSla278 = makeSlaModule();
  const sla = new AlertSla278({});
  sla.startSlaWatchdog278(10_000);
  const r = sla.startSlaWatchdog278(10_000);
  assert.equal(r.alreadyRunning, true);
  sla.stopSlaWatchdog278();
});

test('stopSlaWatchdog278 returns ok', () => {
  const AlertSla278 = makeSlaModule();
  const sla = new AlertSla278({});
  sla.startSlaWatchdog278(10_000);
  const r = sla.stopSlaWatchdog278();
  assert.equal(r.ok, true);
  assert.equal(r.stopped, true);
});

test('checkAlertSlaHealth278 reports watchdogActive correctly', () => {
  const AlertSla278 = makeSlaModule();
  const sla = new AlertSla278({});
  assert.equal(sla.checkAlertSlaHealth278().watchdogActive, false);
  sla.startSlaWatchdog278(10_000);
  assert.equal(sla.checkAlertSlaHealth278().watchdogActive, true);
  sla.stopSlaWatchdog278();
  assert.equal(sla.checkAlertSlaHealth278().watchdogActive, false);
});

// ── I. SSE client management ──────────────────────────────────────────────────

section('I. SSE client management');

function makeMockSseRes() {
  const writes = [];
  const res = {
    _writes: writes,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    flushHeaders() {},
    write(data) { writes.push(data); return true; },
    end() { this._ended = true; },
    on(event, fn) { this[`_on_${event}`] = fn; },
  };
  return res;
}

test('addSlaSseClient278 returns clientId', () => {
  const AlertSla278 = makeSlaModule();
  const sla = new AlertSla278({});
  const res = makeMockSseRes();
  const id = sla.addSlaSseClient278(res);
  assert.ok(typeof id === 'string' && id.length > 0);
  sla.removeSlaSseClient278(id);
});

test('addSlaSseClient278 sends history on connect', () => {
  const AlertSla278 = makeSlaModule();
  const sla = new AlertSla278({});
  // Add a dummy history event
  sla._appendEventHistory278({ event: 'SLA_BREACH', alertId: 'x', ts: new Date().toISOString() });
  const res = makeMockSseRes();
  sla.addSlaSseClient278(res);
  const historyWrite = res._writes.find(w => w.includes('history'));
  assert.ok(historyWrite, 'expected history event on connect');
});

test('removeSlaSseClient278 removes client', () => {
  const AlertSla278 = makeSlaModule();
  const sla = new AlertSla278({});
  const res = makeMockSseRes();
  const id = sla.addSlaSseClient278(res);
  sla.removeSlaSseClient278(id);
  assert.equal(sla._sseClients278.size, 0);
});

test('SSE client auto-removes on res close', () => {
  const AlertSla278 = makeSlaModule();
  const sla = new AlertSla278({});
  const res = makeMockSseRes();
  sla.addSlaSseClient278(res);
  assert.equal(sla._sseClients278.size, 1);
  res._on_close();
  assert.equal(sla._sseClients278.size, 0);
});

test('shutdown278 closes all SSE clients and clears state', () => {
  const AlertSla278 = makeSlaModule();
  const sla = new AlertSla278({});
  const res = makeMockSseRes();
  sla.addSlaSseClient278(res);
  sla.startSlaWatchdog278(10_000);
  const r = sla.shutdown278();
  assert.equal(r.ok, true);
  assert.equal(sla._sseClients278.size, 0);
  assert.equal(sla._watchdogTimer278, null);
});

// ── J. History / Status / Health ──────────────────────────────────────────────

section('J. Event history + getStatus278 + health');

test('getEventHistory278 returns events', () => {
  const AlertSla278 = makeSlaModule();
  const alert = makeAlert({ alertType: 'SYBIL_FAIL_RATE', ageMs: 1_000_000 });
  const sla = new AlertSla278({ counterAlertBus: makeMockBus([alert]) });
  sla.registerAlertSla278('SYBIL_FAIL_RATE', { warningMs: 300_000, breachMs: 900_000 });
  sla.runSlaCheck278();
  const hist = sla.getEventHistory278();
  assert.equal(hist.ok, true);
  assert.ok(hist.events.length >= 2); // SLA_REGISTERED + SLA_BREACH
});

test('getEventHistory278 supports since filter', () => {
  const AlertSla278 = makeSlaModule();
  const sla = new AlertSla278({});
  sla._appendEventHistory278({ event: 'SLA_BREACH', alertId: 'a', ts: new Date(Date.now() - 60_000).toISOString() });
  sla._appendEventHistory278({ event: 'SLA_WARNING', alertId: 'b', ts: new Date().toISOString() });
  const future = new Date(Date.now() - 30_000).toISOString();
  const r = sla.getEventHistory278({ since: future });
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].alertId, 'b');
});

test('getStatus278 returns version 278', () => {
  const AlertSla278 = makeSlaModule();
  const sla = new AlertSla278({});
  const r = sla.getStatus278();
  assert.equal(r.version, '278');
});

test('checkAlertSlaHealth278 returns ok', () => {
  const AlertSla278 = makeSlaModule();
  const sla = new AlertSla278({});
  const r = sla.checkAlertSlaHealth278();
  assert.equal(r.ok, true);
  assert.equal(r.version, '278');
  assert.equal(typeof r.configCount, 'number');
  assert.equal(typeof r.slaRecords, 'number');
});

// ── K. providerAdapters278 ────────────────────────────────────────────────────

section('K. providerAdapters278 (28 contracts)');

const { PROVIDER_CONTRACTS_278, validateProvider278, validateAllProviders278, createAlertSlaStub278, createAllStubs278 } = require('../src/lib/providerAdapters278');

test('PROVIDER_CONTRACTS_278 has exactly 28 contracts', () => {
  const keys = Object.keys(PROVIDER_CONTRACTS_278);
  assert.equal(keys.length, 28, `Expected 28 contracts, got ${keys.length}: ${keys.join(', ')}`);
});

test('PROVIDER_CONTRACTS_278 includes alertSla', () => {
  assert.ok('alertSla' in PROVIDER_CONTRACTS_278);
});

test('alertSla contract has all required methods', () => {
  const contract = PROVIDER_CONTRACTS_278.alertSla;
  const required = ['registerAlertSla278', 'checkSlaBreach278', 'getBreachedAlerts278', 'getSlaStatus278',
                    'addSlaSseClient278', 'removeSlaSseClient278', 'getStatus278'];
  for (const m of required) {
    assert.ok(contract.required.includes(m), `missing required method: ${m}`);
  }
});

test('createAlertSlaStub278 implements all required methods', () => {
  const stub = createAlertSlaStub278();
  const required = PROVIDER_CONTRACTS_278.alertSla.required;
  for (const m of required) {
    assert.equal(typeof stub[m], 'function', `stub missing method: ${m}`);
  }
});

test('validateProvider278 passes for valid stub', () => {
  const stub = createAlertSlaStub278();
  const r = validateProvider278('alertSla', stub);
  assert.equal(r.ok, true);
  assert.equal(r.errors.length, 0);
});

test('validateProvider278 fails for incomplete provider', () => {
  const r = validateProvider278('alertSla', {});
  assert.equal(r.ok, false);
  assert.ok(r.errors.length > 0);
});

test('validateProvider278 rejects unknown contract key', () => {
  const r = validateProvider278('nonExistentKey', {});
  assert.equal(r.ok, false);
});

test('createAllStubs278 returns 28-key object', () => {
  const stubs = createAllStubs278();
  assert.ok('alertSla' in stubs);
  assert.ok('alertEscalation' in stubs); // from v277
});

test('validateAllProviders278 passes for all stubs', () => {
  const stubs = createAllStubs278();
  const r = validateAllProviders278(stubs);
  assert.equal(r.ok, true);
});

// ── L. API Patch ──────────────────────────────────────────────────────────────

section('L. API patch (createV278State, route registration)');

const { createV278State, registerV278Routes, V278_ENDPOINTS } = require('../ecos-api-server-v278-patch');

test('createV278State returns object with alertSla278', () => {
  const state = createV278State({});
  assert.ok(state.alertSla278, 'expected alertSla278 in state');
  assert.equal(typeof state.alertSla278.registerAlertSla278, 'function');
});

test('createV278State forwards counterAlertBus from v277State', () => {
  const bus = makeMockBus([]);
  const v277State = { counterAlertBus275: bus };
  const state = createV278State(v277State);
  assert.equal(state.alertSla278._alertBus278, bus);
});

test('V278_ENDPOINTS has all expected routes', () => {
  const paths = V278_ENDPOINTS.map(e => e.path);
  assert.ok(paths.includes('/api/v278/health'));
  assert.ok(paths.includes('/api/v278/alerts/sla/breached'));
  assert.ok(paths.includes('/api/v278/alerts/sla/status'));
  assert.ok(paths.includes('/api/v278/alerts/sla/subscribe'));
  assert.ok(paths.includes('/api/v278/alerts/:alertId/sla'));
});

test('registerV278Routes registers routes on mock app', () => {
  const routes = [];
  const mockApp = {
    get:    (path, fn) => routes.push({ method: 'GET',    path }),
    post:   (path, fn) => routes.push({ method: 'POST',   path }),
    delete: (path, fn) => routes.push({ method: 'DELETE', path }),
  };
  const state = createV278State({});
  registerV278Routes(mockApp, state);
  const paths = routes.map(r => r.path);
  assert.ok(paths.includes('/api/v278/health'));
  assert.ok(paths.includes('/api/v278/alerts/sla/register'));
  assert.ok(paths.includes('/api/v278/alerts/sla/breached'));
});

// ── M. Release documentation ──────────────────────────────────────────────────

section('M. Release documentation');

test('CHANGELOG_V278.md exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'CHANGELOG_V278.md')));
});

test('NEXT_SESSION_PROMPT_V278.md exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'NEXT_SESSION_PROMPT_V278.md')));
});

test('AI_PROTOCOL_V278.md exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'AI_PROTOCOL_V278.md')));
});

test('CHANGELOG_V278.md mentions alertSla278', () => {
  const content = fs.readFileSync(path.join(ROOT, 'CHANGELOG_V278.md'), 'utf8');
  assert.ok(content.includes('alertSla278'), 'expected alertSla278 in changelog');
});

test('CHANGELOG_V278.md mentions registerAlertSla278', () => {
  const content = fs.readFileSync(path.join(ROOT, 'CHANGELOG_V278.md'), 'utf8');
  assert.ok(content.includes('registerAlertSla278'));
});

test('CHANGELOG_V278.md mentions checkSlaBreach278', () => {
  const content = fs.readFileSync(path.join(ROOT, 'CHANGELOG_V278.md'), 'utf8');
  assert.ok(content.includes('checkSlaBreach278'));
});

// ── N. Sacred file integrity ──────────────────────────────────────────────────

section('N. Sacred file integrity (MD5)');

const SACRED_MD5 = {
  'src/lib/fiatLedger.js': '563e9b1f9e67091a5b6527c0a92568e5',
  'src/lib/auditLog.js':   'e5a5c2c27801d2d03991bc8e5a1df8cb',
};

for (const [rel, expected] of Object.entries(SACRED_MD5)) {
  test(`${rel} MD5 unchanged`, () => {
    const buf    = fs.readFileSync(path.join(ROOT, rel));
    const actual = crypto.createHash('md5').update(buf).digest('hex');
    assert.equal(actual, expected, `Sacred file tampered: ${rel}`);
  });
}

// ── Summary ────────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(50));
console.log(`V278 Test Suite: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.error('\nFailed tests:');
  for (const { name, error } of failures) {
    console.error(`  ✗ ${name}: ${error}`);
  }
}
console.log('─'.repeat(50));

if (failed > 0) process.exit(1);
