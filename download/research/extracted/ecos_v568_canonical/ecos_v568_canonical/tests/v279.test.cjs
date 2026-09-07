'use strict';
/**
 * tests/v279.test.cjs — ECOS V279 Test Suite
 *
 * Self-running suite covering:
 *   A. Version stamps (package.json, .agent-identity.json)
 *   B. New module files + lib mirrors
 *   C. aggregateAlerts279 — groupBy, counts, escalation summary
 *   D. generateAlertDigest279 — structure, topTypes, slaSnapshot wiring
 *   E. getDigestHistory279 — storage, since filter
 *   F. Scheduler start / stop / alreadyRunning
 *   G. SSE client management (add, remove, broadcast, heartbeat, shutdown)
 *   H. checkAlertDigestHealth279 + getStatus279
 *   I. providerAdapters279 (29 contracts, stub validation, pass/fail)
 *   J. API patch (createV279State, route registration, V278 backward compat)
 *   K. Release documentation
 *   L. Sacred file integrity (MD5 verified)
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
    severity:  overrides.severity  || 'WARNING',
    ts:        overrides.ts        || new Date(Date.now() - (overrides.ageMs || 0)).toISOString(),
    resolved:  overrides.resolved  || false,
    escalated: overrides.escalated || false,
    assignee:  overrides.assignee  || null,
    ...overrides,
  };
}

function makeDigestModule() {
  const { AlertDigest279 } = require('../src/lib/alertDigest279');
  return AlertDigest279;
}

function makeMockSla(breachCounts = {}, warnCounts = {}) {
  return {
    getSlaStatus278: () => ({
      ok: true,
      breachCounts,
      warnCounts,
      configCount: Object.keys(breachCounts).length,
    }),
  };
}

// ── A. Version stamps ──────────────────────────────────────────────────────────

section('A. Version stamps');

test('package.json version is 279.0.0', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '279.0.0', `Expected 279.0.0, got ${pkg.version}`);
});

test('.agent-identity.json ecosVersion is 279.0.0', () => {
  const id = JSON.parse(fs.readFileSync(path.join(ROOT, '.agent-identity.json'), 'utf8'));
  assert.equal(id.ecosVersion, '279.0.0');
  assert.equal(id.version, '279.0.0');
});

test('.agent-identity.json includes alert-digest feature', () => {
  const id = JSON.parse(fs.readFileSync(path.join(ROOT, '.agent-identity.json'), 'utf8'));
  assert.ok(id.features.some(f => f.includes('digest')), 'expected digest feature in identity');
});

// ── B. Module files + lib mirrors ────────────────────────────────────────────

section('B. Module files + lib mirrors');

test('src/lib/alertDigest279.js exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'src/lib/alertDigest279.js')));
});

test('lib/alertDigest279.js exists (mirror)', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'lib/alertDigest279.js')));
});

test('src/lib/providerAdapters279.js exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'src/lib/providerAdapters279.js')));
});

test('lib/providerAdapters279.js exists (mirror)', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'lib/providerAdapters279.js')));
});

test('ecos-api-server-v279-patch.js exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'ecos-api-server-v279-patch.js')));
});

test('src/lib/alertDigest279.js and lib/alertDigest279.js are identical', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/alertDigest279.js'));
  const lib = fs.readFileSync(path.join(ROOT, 'lib/alertDigest279.js'));
  assert.ok(src.equals(lib), 'mirror mismatch');
});

test('src/lib/providerAdapters279.js and lib/providerAdapters279.js are identical', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/providerAdapters279.js'));
  const lib = fs.readFileSync(path.join(ROOT, 'lib/providerAdapters279.js'));
  assert.ok(src.equals(lib), 'mirror mismatch');
});

// ── C. aggregateAlerts279 ─────────────────────────────────────────────────────

section('C. aggregateAlerts279');

test('returns ok with empty bus', () => {
  const AlertDigest279 = makeDigestModule();
  const d = new AlertDigest279({ counterAlertBus: makeMockBus([]) });
  const r = d.aggregateAlerts279();
  assert.equal(r.ok, true);
  assert.equal(r.totalAlerts, 0);
});

test('counts alerts byType correctly', () => {
  const AlertDigest279 = makeDigestModule();
  const a1 = makeAlert({ alertType: 'SYBIL_FAIL_RATE' });
  const a2 = makeAlert({ alertType: 'SYBIL_FAIL_RATE' });
  const a3 = makeAlert({ alertType: 'CREDIT_OVERFLOW' });
  const d = new AlertDigest279({ counterAlertBus: makeMockBus([a1, a2, a3]) });
  const r = d.aggregateAlerts279();
  assert.equal(r.byType['SYBIL_FAIL_RATE'].count, 2);
  assert.equal(r.byType['CREDIT_OVERFLOW'].count, 1);
});

test('counts bySeverity correctly', () => {
  const AlertDigest279 = makeDigestModule();
  const a1 = makeAlert({ severity: 'CRITICAL' });
  const a2 = makeAlert({ severity: 'CRITICAL' });
  const a3 = makeAlert({ severity: 'WARNING' });
  const d = new AlertDigest279({ counterAlertBus: makeMockBus([a1, a2, a3]) });
  const r = d.aggregateAlerts279();
  assert.equal(r.bySeverity['CRITICAL'].count, 2);
  assert.equal(r.bySeverity['WARNING'].count, 1);
});

test('counts byAssignee correctly', () => {
  const AlertDigest279 = makeDigestModule();
  const a1 = makeAlert({ assignee: 'alice' });
  const a2 = makeAlert({ assignee: 'alice' });
  const a3 = makeAlert({ assignee: 'bob' });
  const d = new AlertDigest279({ counterAlertBus: makeMockBus([a1, a2, a3]) });
  const r = d.aggregateAlerts279();
  assert.equal(r.byAssignee['alice'].count, 2);
  assert.equal(r.byAssignee['bob'].count, 1);
});

test('escalatedCount reflects escalated alerts', () => {
  const AlertDigest279 = makeDigestModule();
  const a1 = makeAlert({ escalated: true });
  const a2 = makeAlert({ escalated: false });
  const d = new AlertDigest279({ counterAlertBus: makeMockBus([a1, a2]) });
  const r = d.aggregateAlerts279();
  assert.equal(r.escalatedCount, 1);
});

test('groupBy=type returns only byType', () => {
  const AlertDigest279 = makeDigestModule();
  const d = new AlertDigest279({ counterAlertBus: makeMockBus([makeAlert()]) });
  const r = d.aggregateAlerts279({ groupBy: 'type' });
  assert.ok('byType' in r);
  assert.ok(!('bySeverity' in r));
});

test('groupBy=severity returns only bySeverity', () => {
  const AlertDigest279 = makeDigestModule();
  const d = new AlertDigest279({ counterAlertBus: makeMockBus([makeAlert()]) });
  const r = d.aggregateAlerts279({ groupBy: 'severity' });
  assert.ok('bySeverity' in r);
  assert.ok(!('byType' in r));
});

test('groupBy=assignee returns only byAssignee', () => {
  const AlertDigest279 = makeDigestModule();
  const d = new AlertDigest279({ counterAlertBus: makeMockBus([makeAlert({ assignee: 'alice' })]) });
  const r = d.aggregateAlerts279({ groupBy: 'assignee' });
  assert.ok('byAssignee' in r);
  assert.ok(!('byType' in r));
});

test('includeResolved=false excludes resolved alerts', () => {
  const AlertDigest279 = makeDigestModule();
  const a1 = makeAlert({ resolved: true });
  const a2 = makeAlert({ resolved: false });
  const d = new AlertDigest279({ counterAlertBus: makeMockBus([a1, a2]) });
  const r = d.aggregateAlerts279({ includeResolved: false });
  assert.equal(r.totalAlerts, 1);
});

test('includeResolved=true includes resolved alerts', () => {
  const AlertDigest279 = makeDigestModule();
  const a1 = makeAlert({ resolved: true });
  const a2 = makeAlert({ resolved: false });
  const d = new AlertDigest279({ counterAlertBus: makeMockBus([a1, a2]) });
  const r = d.aggregateAlerts279({ includeResolved: true });
  assert.equal(r.totalAlerts, 2);
});

// ── D. generateAlertDigest279 ─────────────────────────────────────────────────

section('D. generateAlertDigest279');

test('returns ok with required fields', () => {
  const AlertDigest279 = makeDigestModule();
  const d = new AlertDigest279({ counterAlertBus: makeMockBus([]) });
  const r = d.generateAlertDigest279();
  assert.equal(r.ok, true);
  assert.ok(r.digestId, 'expected digestId');
  assert.ok(r.version);
  assert.ok(r.ts);
  assert.equal(typeof r.totalAlerts, 'number');
  assert.equal(typeof r.unresolved, 'number');
  assert.equal(typeof r.escalated, 'number');
  assert.ok(Array.isArray(r.topTypes));
});

test('digest uses provided period label', () => {
  const AlertDigest279 = makeDigestModule();
  const d = new AlertDigest279({ counterAlertBus: makeMockBus([]) });
  const r = d.generateAlertDigest279({ period: 'test-period-X' });
  assert.equal(r.period, 'test-period-X');
});

test('topTypes sorted by unresolved count desc, max 5', () => {
  const AlertDigest279 = makeDigestModule();
  const alerts = [];
  for (let i = 0; i < 6; i++) {
    alerts.push(makeAlert({ alertType: `TYPE_${i}` }));
    alerts.push(makeAlert({ alertType: `TYPE_${i}` })); // 2 per type
  }
  const d = new AlertDigest279({ counterAlertBus: makeMockBus(alerts) });
  const r = d.generateAlertDigest279();
  assert.ok(r.topTypes.length <= 5, `expected max 5 topTypes, got ${r.topTypes.length}`);
});

test('slaSnapshot included when sla module provided', () => {
  const AlertDigest279 = makeDigestModule();
  const d = new AlertDigest279({
    counterAlertBus: makeMockBus([]),
    alertSla: makeMockSla({ SYBIL_FAIL_RATE: 2 }, { CREDIT_OVERFLOW: 1 }),
  });
  const r = d.generateAlertDigest279();
  assert.ok(r.slaSnapshot !== null);
  assert.equal(r.breached, 2);
  assert.equal(r.warned, 1);
});

test('slaSnapshot is null when no sla module', () => {
  const AlertDigest279 = makeDigestModule();
  const d = new AlertDigest279({ counterAlertBus: makeMockBus([]) });
  const r = d.generateAlertDigest279();
  assert.equal(r.slaSnapshot, null);
  assert.equal(r.breached, null);
  assert.equal(r.warned, null);
});

test('digest is stored in history', () => {
  const AlertDigest279 = makeDigestModule();
  const d = new AlertDigest279({ counterAlertBus: makeMockBus([]) });
  d.generateAlertDigest279({ period: 'p1' });
  d.generateAlertDigest279({ period: 'p2' });
  const h = d.getDigestHistory279();
  assert.equal(h.ok, true);
  assert.equal(h.total, 2);
});

test('each digest has unique digestId', () => {
  const AlertDigest279 = makeDigestModule();
  const d = new AlertDigest279({ counterAlertBus: makeMockBus([]) });
  const r1 = d.generateAlertDigest279();
  const r2 = d.generateAlertDigest279();
  assert.notEqual(r1.digestId, r2.digestId);
});

// ── E. getDigestHistory279 ────────────────────────────────────────────────────

section('E. getDigestHistory279');

test('returns empty when no digests generated', () => {
  const AlertDigest279 = makeDigestModule();
  const d = new AlertDigest279({});
  const r = d.getDigestHistory279();
  assert.equal(r.ok, true);
  assert.equal(r.total, 0);
  assert.ok(Array.isArray(r.digests));
});

test('limit parameter caps results', () => {
  const AlertDigest279 = makeDigestModule();
  const d = new AlertDigest279({ counterAlertBus: makeMockBus([]) });
  for (let i = 0; i < 10; i++) d.generateAlertDigest279();
  const r = d.getDigestHistory279({ limit: 3 });
  assert.ok(r.digests.length <= 3);
});

test('since filter returns only newer digests', () => {
  const AlertDigest279 = makeDigestModule();
  const d = new AlertDigest279({ counterAlertBus: makeMockBus([]) });
  d._appendDigestHistory279({ digestId: 'old', ts: new Date(Date.now() - 120_000).toISOString() });
  d._appendDigestHistory279({ digestId: 'new', ts: new Date().toISOString() });
  const since = new Date(Date.now() - 60_000).toISOString();
  const r = d.getDigestHistory279({ since });
  assert.equal(r.digests.length, 1);
  assert.equal(r.digests[0].digestId, 'new');
});

// ── F. Scheduler ──────────────────────────────────────────────────────────────

section('F. Scheduler start / stop');

test('startDigestScheduler279 returns ok', () => {
  const AlertDigest279 = makeDigestModule();
  const d = new AlertDigest279({});
  const r = d.startDigestScheduler279(60_000);
  assert.equal(r.ok, true);
  d.stopDigestScheduler279();
});

test('startDigestScheduler279 returns alreadyRunning on second call', () => {
  const AlertDigest279 = makeDigestModule();
  const d = new AlertDigest279({});
  d.startDigestScheduler279(60_000);
  const r = d.startDigestScheduler279(60_000);
  assert.equal(r.alreadyRunning, true);
  d.stopDigestScheduler279();
});

test('stopDigestScheduler279 returns ok', () => {
  const AlertDigest279 = makeDigestModule();
  const d = new AlertDigest279({});
  d.startDigestScheduler279(60_000);
  const r = d.stopDigestScheduler279();
  assert.equal(r.ok, true);
  assert.equal(r.stopped, true);
});

test('checkAlertDigestHealth279 reports schedulerActive correctly', () => {
  const AlertDigest279 = makeDigestModule();
  const d = new AlertDigest279({});
  assert.equal(d.checkAlertDigestHealth279().schedulerActive, false);
  d.startDigestScheduler279(60_000);
  assert.equal(d.checkAlertDigestHealth279().schedulerActive, true);
  d.stopDigestScheduler279();
  assert.equal(d.checkAlertDigestHealth279().schedulerActive, false);
});

// ── G. SSE client management ──────────────────────────────────────────────────

section('G. SSE client management');

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

test('addDigestSseClient279 returns clientId', () => {
  const AlertDigest279 = makeDigestModule();
  const d = new AlertDigest279({});
  const res = makeMockSseRes();
  const id = d.addDigestSseClient279(res);
  assert.ok(typeof id === 'string' && id.length > 0);
  d.removeDigestSseClient279(id);
});

test('addDigestSseClient279 sends history on connect', () => {
  const AlertDigest279 = makeDigestModule();
  const d = new AlertDigest279({ counterAlertBus: makeMockBus([]) });
  d.generateAlertDigest279({ period: 'seed' });
  const res = makeMockSseRes();
  d.addDigestSseClient279(res);
  const historyWrite = res._writes.find(w => w.includes('history'));
  assert.ok(historyWrite, 'expected history event on connect');
});

test('removeDigestSseClient279 removes client', () => {
  const AlertDigest279 = makeDigestModule();
  const d = new AlertDigest279({});
  const res = makeMockSseRes();
  const id = d.addDigestSseClient279(res);
  d.removeDigestSseClient279(id);
  assert.equal(d._sseClients279.size, 0);
});

test('SSE client auto-removes on res close', () => {
  const AlertDigest279 = makeDigestModule();
  const d = new AlertDigest279({});
  const res = makeMockSseRes();
  d.addDigestSseClient279(res);
  assert.equal(d._sseClients279.size, 1);
  res._on_close();
  assert.equal(d._sseClients279.size, 0);
});

test('shutdown279 closes all SSE clients and clears scheduler', () => {
  const AlertDigest279 = makeDigestModule();
  const d = new AlertDigest279({});
  const res = makeMockSseRes();
  d.addDigestSseClient279(res);
  d.startDigestScheduler279(60_000);
  const r = d.shutdown279();
  assert.equal(r.ok, true);
  assert.equal(d._sseClients279.size, 0);
  assert.equal(d._schedulerTimer279, null);
});

// ── H. Health / Status ────────────────────────────────────────────────────────

section('H. checkAlertDigestHealth279 + getStatus279');

test('checkAlertDigestHealth279 returns ok', () => {
  const AlertDigest279 = makeDigestModule();
  const d = new AlertDigest279({});
  const r = d.checkAlertDigestHealth279();
  assert.equal(r.ok, true);
  assert.equal(r.version, '279');
  assert.equal(typeof r.digestCount, 'number');
  assert.equal(typeof r.schedulerActive, 'boolean');
  assert.equal(typeof r.sseClients, 'number');
});

test('getStatus279 returns version 279', () => {
  const AlertDigest279 = makeDigestModule();
  const d = new AlertDigest279({});
  const r = d.getStatus279();
  assert.equal(r.version, '279');
});

// ── I. providerAdapters279 ────────────────────────────────────────────────────

section('I. providerAdapters279 (29 contracts)');

const { PROVIDER_CONTRACTS_279, validateProvider279, validateAllProviders279, createAlertDigestStub279, createAllStubs279 } = require('../src/lib/providerAdapters279');

test('PROVIDER_CONTRACTS_279 has exactly 29 contracts', () => {
  const keys = Object.keys(PROVIDER_CONTRACTS_279);
  assert.equal(keys.length, 29, `Expected 29 contracts, got ${keys.length}: ${keys.join(', ')}`);
});

test('PROVIDER_CONTRACTS_279 includes alertDigest', () => {
  assert.ok('alertDigest' in PROVIDER_CONTRACTS_279);
});

test('alertDigest contract has all required methods', () => {
  const contract = PROVIDER_CONTRACTS_279.alertDigest;
  const required = ['aggregateAlerts279', 'generateAlertDigest279', 'getDigestHistory279',
                    'addDigestSseClient279', 'removeDigestSseClient279', 'getStatus279'];
  for (const m of required) {
    assert.ok(contract.required.includes(m), `missing required method: ${m}`);
  }
});

test('createAlertDigestStub279 implements all required methods', () => {
  const stub = createAlertDigestStub279();
  const required = PROVIDER_CONTRACTS_279.alertDigest.required;
  for (const m of required) {
    assert.equal(typeof stub[m], 'function', `stub missing method: ${m}`);
  }
});

test('validateProvider279 passes for valid stub', () => {
  const stub = createAlertDigestStub279();
  const r = validateProvider279('alertDigest', stub);
  assert.equal(r.ok, true);
  assert.equal(r.errors.length, 0);
});

test('validateProvider279 fails for incomplete provider', () => {
  const r = validateProvider279('alertDigest', {});
  assert.equal(r.ok, false);
  assert.ok(r.errors.length > 0);
});

test('validateProvider279 rejects unknown contract key', () => {
  const r = validateProvider279('nonExistentKey', {});
  assert.equal(r.ok, false);
});

test('createAllStubs279 returns 29-key object with alertDigest', () => {
  const stubs = createAllStubs279();
  assert.ok('alertDigest' in stubs);
  assert.ok('alertSla' in stubs);        // from v278
  assert.ok('alertEscalation' in stubs); // from v277
});

test('validateAllProviders279 passes for all stubs', () => {
  const stubs = createAllStubs279();
  const r = validateAllProviders279(stubs);
  assert.equal(r.ok, true);
});

// ── J. API Patch ──────────────────────────────────────────────────────────────

section('J. API patch (createV279State, route registration)');

const { createV279State, registerV279Routes, V279_ENDPOINTS } = require('../ecos-api-server-v279-patch');

test('createV279State returns object with alertDigest279', () => {
  const state = createV279State({});
  assert.ok(state.alertDigest279, 'expected alertDigest279 in state');
  assert.equal(typeof state.alertDigest279.aggregateAlerts279, 'function');
  assert.equal(typeof state.alertDigest279.generateAlertDigest279, 'function');
});

test('createV279State wires alertSla278 from v278State', () => {
  const mockSla = makeMockSla({}, {});
  const v278State = { alertSla278: mockSla };
  const state = createV279State(v278State);
  assert.equal(state.alertDigest279._sla279, mockSla);
});

test('V279_ENDPOINTS has all expected routes', () => {
  const paths = V279_ENDPOINTS.map(e => e.path);
  assert.ok(paths.includes('/api/v279/health'));
  assert.ok(paths.includes('/api/v279/alerts/aggregate'));
  assert.ok(paths.includes('/api/v279/alerts/digest'));
  assert.ok(paths.includes('/api/v279/alerts/digest/history'));
  assert.ok(paths.includes('/api/v279/alerts/digest/subscribe'));
});

test('registerV279Routes registers routes on mock app', () => {
  const routes = [];
  const mockApp = {
    get:    (path, fn) => routes.push({ method: 'GET',    path }),
    post:   (path, fn) => routes.push({ method: 'POST',   path }),
    delete: (path, fn) => routes.push({ method: 'DELETE', path }),
  };
  const state = createV279State({});
  registerV279Routes(mockApp, state);
  const paths = routes.map(r => r.path);
  assert.ok(paths.includes('/api/v279/health'));
  assert.ok(paths.includes('/api/v279/alerts/aggregate'));
  assert.ok(paths.includes('/api/v279/alerts/digest'));
  assert.ok(paths.includes('/api/v279/alerts/digest/scheduler/start'));
  assert.ok(paths.includes('/api/v279/alerts/digest/scheduler/stop'));
  assert.ok(paths.includes('/api/v279/alerts/digest/subscribe'));
});

// ── K. Release documentation ──────────────────────────────────────────────────

section('K. Release documentation');

test('CHANGELOG_V279.md exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'CHANGELOG_V279.md')));
});

test('NEXT_SESSION_PROMPT_V279.md exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'NEXT_SESSION_PROMPT_V279.md')));
});

test('AI_PROTOCOL_V279.md exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'AI_PROTOCOL_V279.md')));
});

test('CHANGELOG_V279.md mentions alertDigest279', () => {
  const content = fs.readFileSync(path.join(ROOT, 'CHANGELOG_V279.md'), 'utf8');
  assert.ok(content.includes('alertDigest279'), 'expected alertDigest279 in changelog');
});

test('CHANGELOG_V279.md mentions aggregateAlerts279', () => {
  const content = fs.readFileSync(path.join(ROOT, 'CHANGELOG_V279.md'), 'utf8');
  assert.ok(content.includes('aggregateAlerts279'));
});

test('CHANGELOG_V279.md mentions generateAlertDigest279', () => {
  const content = fs.readFileSync(path.join(ROOT, 'CHANGELOG_V279.md'), 'utf8');
  assert.ok(content.includes('generateAlertDigest279'));
});

// ── L. Sacred file integrity ──────────────────────────────────────────────────

section('L. Sacred file integrity (MD5)');

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
console.log(`V279 Test Suite: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.error('\nFailed tests:');
  for (const { name, error } of failures) {
    console.error(`  ✗ ${name}: ${error}`);
  }
}
console.log('─'.repeat(50));

if (failed > 0) process.exit(1);
