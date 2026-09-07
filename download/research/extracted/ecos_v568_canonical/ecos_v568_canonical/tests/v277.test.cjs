/**
 * tests/v277.test.cjs — V277 Structural + Behavioural Tests
 * CommonJS, zero new npm deps, self-running (NODE_ENV=test node tests/v277.test.cjs).
 *
 * Sections:
 *   A. Version stamps
 *   B. New module files (src/lib + lib mirror)
 *   C. AlertEscalation277 — escalateAlert277 + deescalateAlert277
 *   D. AlertEscalation277 — assignAlert277 + unassignAlert277
 *   E. AlertEscalation277 — getAssignedAlerts277
 *   F. AlertEscalation277 — getEscalatedAlerts277
 *   G. AlertEscalation277 — SSE client management
 *   H. AlertEscalation277 — event history + getStatus277
 *   I. providerAdapters277 — 27 contracts
 *   J. API patch — createV277State + route structure
 *   K. Release documentation
 *   L. Sacred files untouched (R1)
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let passed = 0, failed = 0;

function assert(condition, message) {
  if (condition) { console.log('  ✓', message); passed++; }
  else           { console.error('  ✗', message); failed++; }
}

function fileExists(rel)        { return fs.existsSync(path.join(ROOT, rel)); }
function fileContains(rel, sub) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8').includes(sub); }
  catch (_) { return false; }
}

console.log('\n=== V277 Tests ===\n');

// ── A. Version stamps ──────────────────────────────────────────────────────────
console.log('A. Version stamps:');
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const major = parseInt((pkg.version || '').split('.')[0], 10);
  assert(major >= 277, `package.json version major >= 277 (got ${pkg.version})`);
  assert(typeof pkg.scripts['test:v277'] === 'string', 'package.json has test:v277 script');
} catch (e) {
  assert(false, `package.json readable: ${e.message}`);
}

try {
  const identity = JSON.parse(fs.readFileSync(path.join(ROOT, '.agent-identity.json'), 'utf8'));
  const v = identity.version || identity.ecosVersion || '';
  const major = parseInt((v || '').replace(/[^0-9.]/g, '').split('.')[0], 10);
  assert(major >= 277, `.agent-identity.json version major >= 277 (got ${v})`);
} catch (e) {
  assert(false, `.agent-identity.json readable: ${e.message}`);
}

// ── B. New module files ────────────────────────────────────────────────────────
console.log('\nB. New versioned module files (src/lib + lib mirror):');
const V277_MODULES = ['alertEscalation277', 'providerAdapters277'];

for (const mod of V277_MODULES) {
  assert(fileExists(`src/lib/${mod}.js`), `src/lib/${mod}.js exists`);
  assert(fileExists(`lib/${mod}.js`),     `lib/${mod}.js exists (mirror)`);
}
assert(fileExists('ecos-api-server-v277-patch.js'), 'ecos-api-server-v277-patch.js exists');

// ── C. AlertEscalation277 — escalate + deescalate ─────────────────────────────
console.log('\nC. AlertEscalation277 — escalateAlert277 + deescalateAlert277:');
try {
  const { AlertEscalation277 } = require('../src/lib/alertEscalation277');

  const fakeHistory = [
    { alertId: 'e1', alertType: 'SYBIL_FAIL_RATE', ts: new Date().toISOString(), resolved: false },
    { alertId: 'e2', alertType: 'TIP_CIRCULARITY',  ts: new Date().toISOString(), resolved: false },
  ];
  const fakeBus = { _history275: fakeHistory };

  const esc277 = new AlertEscalation277({ counterAlertBus: fakeBus });

  // escalateAlert277 — default HIGH priority
  const r1 = esc277.escalateAlert277('e1', { escalatedTo: 'ops-team', reason: 'urgent' });
  assert(r1.ok === true,                'escalateAlert277 returns ok:true');
  assert(r1.alertId === 'e1',           'escalateAlert277 returns correct alertId');
  assert(typeof r1.escalatedAt === 'string', 'escalateAlert277 returns escalatedAt');
  assert(r1.priority === 'HIGH',        'escalateAlert277 defaults to HIGH priority');
  assert(r1.escalatedTo === 'ops-team', 'escalateAlert277 records escalatedTo');
  assert(r1.alertFound === true,        'escalateAlert277 found alert in bus history');
  assert(fakeHistory[0].escalated === true,         'bus history flagged escalated');
  assert(fakeHistory[0].priority277 === 'HIGH',     'bus history priority277 set');
  assert(fakeHistory[0].escalatedTo === 'ops-team', 'bus history escalatedTo set');

  // escalateAlert277 — CRITICAL priority
  const r2 = esc277.escalateAlert277('e2', { priority: 'CRITICAL', escalatedBy: 'alice' });
  assert(r2.priority === 'CRITICAL',    'escalateAlert277 supports CRITICAL priority');
  assert(fakeHistory[1].priority277 === 'CRITICAL', 'bus history CRITICAL priority set');

  // Error case
  const r3 = esc277.escalateAlert277('');
  assert(r3.ok === false,               'escalateAlert277 rejects empty alertId');

  // deescalateAlert277
  const r4 = esc277.deescalateAlert277('e1');
  assert(r4.ok === true,                'deescalateAlert277 returns ok:true');
  assert(r4.alertId === 'e1',           'deescalateAlert277 returns alertId');
  assert(fakeHistory[0].escalated === false, 'bus history escalated cleared');
  assert(fakeHistory[0].priority277 === null, 'bus history priority277 cleared');

  // deescalate a non-escalated alert
  const r5 = esc277.deescalateAlert277('e1'); // already removed
  assert(r5.ok === false,               'deescalateAlert277 rejects non-escalated alert');

} catch (e) {
  assert(false, `AlertEscalation277 escalate/deescalate: ${e.message}`);
}

// ── D. AlertEscalation277 — assignAlert277 + unassignAlert277 ─────────────────
console.log('\nD. AlertEscalation277 — assignAlert277 + unassignAlert277:');
try {
  const { AlertEscalation277 } = require('../src/lib/alertEscalation277');

  const fakeHistory = [
    { alertId: 'a1', alertType: 'HALT_ISSUANCE', ts: new Date().toISOString(), resolved: false },
    { alertId: 'a2', alertType: 'SYBIL_FAIL_RATE', ts: new Date().toISOString(), resolved: false },
  ];
  const fakeBus = { _history275: fakeHistory };

  const esc277 = new AlertEscalation277({ counterAlertBus: fakeBus });

  // assignAlert277
  const r1 = esc277.assignAlert277('a1', 'alice', { assignedBy: 'manager', note: 'urgent fix' });
  assert(r1.ok === true,             'assignAlert277 returns ok:true');
  assert(r1.alertId === 'a1',        'assignAlert277 returns correct alertId');
  assert(r1.assignee === 'alice',    'assignAlert277 returns assignee');
  assert(typeof r1.assignedAt === 'string', 'assignAlert277 returns assignedAt');
  assert(r1.alertFound === true,     'assignAlert277 found alert in bus history');
  assert(fakeHistory[0].assignee === 'alice',   'bus history assignee set');
  assert(fakeHistory[0].assignedBy === 'manager', 'bus history assignedBy set');

  // reassign — prev assignee tracked
  const r2 = esc277.assignAlert277('a1', 'bob');
  assert(r2.ok === true,             'reassign returns ok:true');
  assert(r2.assignee === 'bob',      'reassign updates assignee to bob');

  // Error cases
  const r3 = esc277.assignAlert277('', 'alice');
  assert(r3.ok === false,            'assignAlert277 rejects empty alertId');
  const r4 = esc277.assignAlert277('a1', '');
  assert(r4.ok === false,            'assignAlert277 rejects empty assignee');

  // unassignAlert277
  const r5 = esc277.unassignAlert277('a1');
  assert(r5.ok === true,             'unassignAlert277 returns ok:true');
  assert(r5.prevAssignee === 'bob',  'unassignAlert277 returns prev assignee');

  // unassign non-assigned
  const r6 = esc277.unassignAlert277('a1');
  assert(r6.ok === false,            'unassignAlert277 rejects non-assigned alert');

} catch (e) {
  assert(false, `AlertEscalation277 assign/unassign: ${e.message}`);
}

// ── E. AlertEscalation277 — getAssignedAlerts277 ──────────────────────────────
console.log('\nE. AlertEscalation277 — getAssignedAlerts277:');
try {
  const { AlertEscalation277 } = require('../src/lib/alertEscalation277');

  const fakeHistory = [
    { alertId: 'ga1', alertType: 'HALT_ISSUANCE',   ts: new Date().toISOString(), resolved: false },
    { alertId: 'ga2', alertType: 'TIP_CIRCULARITY',  ts: new Date().toISOString(), resolved: false },
    { alertId: 'ga3', alertType: 'SYBIL_FAIL_RATE',  ts: new Date().toISOString(), resolved: true  },
  ];
  const fakeBus = { _history275: fakeHistory };

  const esc277 = new AlertEscalation277({ counterAlertBus: fakeBus });

  esc277.assignAlert277('ga1', 'carol');
  esc277.assignAlert277('ga3', 'carol'); // resolved

  const r1 = esc277.getAssignedAlerts277('carol');
  assert(r1.ok === true,          'getAssignedAlerts277 returns ok:true');
  assert(r1.assignee === 'carol', 'getAssignedAlerts277 returns assignee');
  assert(r1.total === 1,          'getAssignedAlerts277 excludes resolved by default (1 active)');

  const r2 = esc277.getAssignedAlerts277('carol', { includeResolved: true });
  assert(r2.total === 2,          'getAssignedAlerts277 includeResolved:true returns 2');

  const r3 = esc277.getAssignedAlerts277('nobody');
  assert(r3.ok === true,          'getAssignedAlerts277 returns ok:true for unknown assignee');
  assert(r3.total === 0,          'getAssignedAlerts277 returns 0 for unknown assignee');

  const r4 = esc277.getAssignedAlerts277('');
  assert(r4.ok === false,         'getAssignedAlerts277 rejects empty assignee');

} catch (e) {
  assert(false, `AlertEscalation277 getAssignedAlerts277: ${e.message}`);
}

// ── F. AlertEscalation277 — getEscalatedAlerts277 ─────────────────────────────
console.log('\nF. AlertEscalation277 — getEscalatedAlerts277:');
try {
  const { AlertEscalation277 } = require('../src/lib/alertEscalation277');

  const fakeHistory = [
    { alertId: 'ge1', alertType: 'HALT_ISSUANCE',   ts: new Date().toISOString(), resolved: false, escalated: false },
    { alertId: 'ge2', alertType: 'TIP_CIRCULARITY',  ts: new Date().toISOString(), resolved: false, escalated: false },
    { alertId: 'ge3', alertType: 'SYBIL_FAIL_RATE',  ts: new Date().toISOString(), resolved: true,  escalated: false },
  ];
  const fakeBus = { _history275: fakeHistory };

  const esc277 = new AlertEscalation277({ counterAlertBus: fakeBus });

  esc277.escalateAlert277('ge1', { priority: 'HIGH' });
  esc277.escalateAlert277('ge2', { priority: 'CRITICAL' });
  esc277.escalateAlert277('ge3', { priority: 'HIGH' }); // resolved — should not appear

  const r1 = esc277.getEscalatedAlerts277();
  assert(r1.ok === true,    'getEscalatedAlerts277 returns ok:true');
  assert(r1.total === 2,    'getEscalatedAlerts277 returns 2 unresolved escalated alerts');

  const r2 = esc277.getEscalatedAlerts277({ priority: 'CRITICAL' });
  assert(r2.total === 1,    'getEscalatedAlerts277 filters by CRITICAL priority');

  const r3 = esc277.getEscalatedAlerts277({ priority: 'HIGH' });
  assert(r3.total === 1,    'getEscalatedAlerts277 filters by HIGH priority');

} catch (e) {
  assert(false, `AlertEscalation277 getEscalatedAlerts277: ${e.message}`);
}

// ── G. AlertEscalation277 — SSE client management ─────────────────────────────
console.log('\nG. AlertEscalation277 — SSE client management:');
try {
  const { AlertEscalation277 } = require('../src/lib/alertEscalation277');

  const esc277 = new AlertEscalation277({});

  // Fake SSE response
  const chunks = [];
  const fakeRes = {
    status(code) { this._code = code; return this; },
    json(data)  { this._json = data; return this; },
    setHeader() {},
    flushHeaders() {},
    write(chunk) { chunks.push(chunk); },
    end() { this._ended = true; },
    on(ev, fn) { if (ev === 'close') this._closeFn = fn; },
  };

  const clientId = esc277.addEscalationSseClient277(fakeRes);
  assert(typeof clientId === 'string', 'addEscalationSseClient277 returns clientId string');
  assert(esc277._sseClients277.size === 1, 'SSE client added to map');
  assert(chunks.some(c => c.includes('history')), 'history sent on connect');

  // Broadcast
  esc277.escalateAlert277('sse-test-alert', { escalatedTo: 'sre' });
  assert(chunks.some(c => c.includes('ALERT_ESCALATED')), 'escalation event broadcast over SSE');

  // Remove
  const rem = esc277.removeEscalationSseClient277(clientId);
  assert(rem.ok === true,              'removeEscalationSseClient277 returns ok:true');
  assert(esc277._sseClients277.size === 0, 'SSE client removed from map');

  // Heartbeat timer
  esc277.startEscalationHeartbeat277();
  assert(esc277._heartbeatTimer277 !== null, 'heartbeat timer started');
  esc277.startEscalationHeartbeat277(); // idempotent
  assert(esc277._heartbeatTimer277 !== null, 'heartbeat idempotent');

  // Shutdown
  const sd = esc277.shutdown277();
  assert(sd.ok === true,               'shutdown277 returns ok:true');
  assert(esc277._heartbeatTimer277 === null, 'heartbeat timer cleared on shutdown');

} catch (e) {
  assert(false, `AlertEscalation277 SSE: ${e.message}`);
}

// ── H. AlertEscalation277 — event history + getStatus277 ──────────────────────
console.log('\nH. AlertEscalation277 — event history + getStatus277:');
try {
  const { AlertEscalation277 } = require('../src/lib/alertEscalation277');

  const esc277 = new AlertEscalation277({});

  esc277.escalateAlert277('h1', { priority: 'HIGH' });
  esc277.assignAlert277('h1', 'dave');

  const hist = esc277.getEventHistory277();
  assert(hist.ok === true,     'getEventHistory277 returns ok:true');
  assert(hist.total >= 2,      'getEventHistory277 contains escalate + assign events');
  assert(Array.isArray(hist.events), 'getEventHistory277 returns events array');

  const status = esc277.getStatus277();
  assert(status.ok === true,   'getStatus277 returns ok:true');
  assert(status.version === '277', 'getStatus277 returns version 277');
  assert(status.escalations === 1, 'getStatus277 escalations count correct');
  assert(status.assignments === 1, 'getStatus277 assignments count correct');

  const health = esc277.checkAlertEscalationHealth277();
  assert(health.ok === true,   'checkAlertEscalationHealth277 returns ok:true');
  assert(health.version === '277', 'checkAlertEscalationHealth277 reports version 277');

} catch (e) {
  assert(false, `AlertEscalation277 history/status: ${e.message}`);
}

// ── I. providerAdapters277 — 27 contracts ─────────────────────────────────────
console.log('\nI. providerAdapters277 — 27 contracts:');
try {
  const { PROVIDER_CONTRACTS_277, validateProvider277, validateAllProviders277,
          createAlertEscalationStub277, createAllStubs277 } = require('../src/lib/providerAdapters277');

  const keys = Object.keys(PROVIDER_CONTRACTS_277);
  assert(keys.length === 27, `PROVIDER_CONTRACTS_277 has 27 contracts (got ${keys.length})`);
  assert(keys.includes('alertEscalation'), 'alertEscalation contract present');
  assert(keys.includes('alertResolution'), 'alertResolution contract present (from V276)');

  // Stub factories
  const stub277 = createAlertEscalationStub277();
  const required277 = ['escalateAlert277', 'assignAlert277', 'getAssignedAlerts277',
    'getEscalatedAlerts277', 'addEscalationSseClient277', 'removeEscalationSseClient277', 'getStatus277'];
  for (const m of required277) {
    assert(typeof stub277[m] === 'function', `createAlertEscalationStub277 has ${m}`);
  }

  // Validate stub passes
  const vResult = validateProvider277('alertEscalation', stub277);
  assert(vResult.ok === true, 'validateProvider277 passes stub');
  assert(vResult.errors.length === 0, 'validateProvider277 no errors for stub');

  // Validate stub fails on empty obj
  const vFail = validateProvider277('alertEscalation', {});
  assert(vFail.ok === false, 'validateProvider277 fails empty object');
  assert(vFail.errors.length > 0, 'validateProvider277 reports errors for empty obj');

  // Unknown contract
  const vUnk = validateProvider277('unknownContract277', {});
  assert(vUnk.ok === false, 'validateProvider277 rejects unknown contract key');

  // createAllStubs277
  const allStubs = createAllStubs277();
  assert(typeof allStubs.alertEscalation === 'object', 'createAllStubs277 includes alertEscalation');
  assert(typeof allStubs.alertResolution === 'object', 'createAllStubs277 includes alertResolution (V276 preserved)');

} catch (e) {
  assert(false, `providerAdapters277: ${e.message}`);
}

// ── J. API patch — createV277State + route structure ──────────────────────────
console.log('\nJ. API patch — createV277State + route structure:');
try {
  const { createV277State, registerEcosV277Routes } = require('../ecos-api-server-v277-patch');

  // createV277State
  const state = createV277State({});
  assert(typeof state === 'object',                      'createV277State returns an object');
  assert(typeof state.alertEscalation === 'object',      'createV277State includes alertEscalation');
  assert(state.modules.alertEscalation === 'AlertEscalation277', 'modules map has AlertEscalation277');

  // V276 modules still present
  assert(typeof state.alertResolution === 'object',      'createV277State preserves alertResolution (V276)');

  // Route registration
  const routes = {};
  const mockApp = {
    get:  (path, fn) => { routes[`GET:${path}`] = fn; },
    post: (path, fn) => { routes[`POST:${path}`] = fn; },
  };

  registerEcosV277Routes(mockApp, {});

  const expectedRoutes = [
    'GET:/api/v277/health',
    'GET:/api/v277/perf',
    'POST:/api/v277/providers/validate',
    'POST:/api/v277/alerts/:alertId/escalate',
    'POST:/api/v277/alerts/:alertId/deescalate',
    'POST:/api/v277/alerts/:alertId/assign',
    'POST:/api/v277/alerts/:alertId/unassign',
    'GET:/api/v277/alerts/assigned/:assignee',
    'GET:/api/v277/alerts/escalated',
    'GET:/api/v277/alerts/escalation/subscribe',
    'GET:/api/v277/alerts/escalation/history',
    'GET:/api/v277/alerts/status',
  ];

  for (const r of expectedRoutes) {
    assert(typeof routes[r] === 'function', `Route registered: ${r}`);
  }

  // V276 backward compat check
  assert(typeof routes['GET:/api/v276/health'] === 'function', 'V276 health route preserved');
  assert(typeof routes['POST:/api/v276/alerts/:alertId/resolve'] === 'function', 'V276 resolve route preserved');

} catch (e) {
  assert(false, `API patch v277: ${e.message}`);
}

// ── K. Release documentation ───────────────────────────────────────────────────
console.log('\nK. Release documentation:');
assert(fileExists('CHANGELOG_V277.md'),                  'CHANGELOG_V277.md exists');
assert(fileContains('CHANGELOG_V277.md', '277'),         'CHANGELOG_V277.md references V277');
assert(fileExists('NEXT_SESSION_PROMPT_V277.md'),        'NEXT_SESSION_PROMPT_V277.md exists');
assert(fileContains('NEXT_SESSION_PROMPT_V277.md','277'),'NEXT_SESSION_PROMPT_V277.md references V277');
assert(fileExists('docs/changelogs/CHANGELOG_V277.md'),  'docs/changelogs/CHANGELOG_V277.md exists');

// ── L. Sacred files untouched (R1) ────────────────────────────────────────────
console.log('\nL. Sacred files integrity (R1):');
const crypto = require('crypto');

function md5file(rel) {
  try {
    return crypto.createHash('md5')
      .update(fs.readFileSync(path.join(ROOT, rel)))
      .digest('hex');
  } catch (_) { return null; }
}

const SACRED_MD5 = {
  'lib/fiatLedger.js': '563e9b1f9e67091a5b6527c0a92568e5',
  'lib/auditLog.js':   'e5a5c2c27801d2d03991bc8e5a1df8cb',
};

for (const [rel, expected] of Object.entries(SACRED_MD5)) {
  const actual = md5file(rel);
  assert(actual === expected, `${rel} MD5 intact (${actual})`);
}

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
