/**
 * tests/v276.test.cjs — V276 Structural + Behavioural Tests
 * CommonJS, zero new npm deps, self-running (NODE_ENV=test node tests/v276.test.cjs).
 *
 * Sections:
 *   A. Version stamps
 *   B. New module files (src/lib + lib mirror)
 *   C. AlertResolution276 — resolveAlert276 + acknowledgeAlert276
 *   D. AlertResolution276 — getUnresolved276
 *   E. AlertResolution276 — wireManualOverride276
 *   F. AlertResolution276 — SSE client management
 *   G. AlertResolution276 — event history + getStatus276
 *   H. providerAdapters276 — 26 contracts
 *   I. API patch — createV276State + route structure
 *   J. Release documentation
 *   K. Sacred files untouched (R1)
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

console.log('\n=== V276 Tests ===\n');

// ── A. Version stamps ─────────────────────────────────────────────────────────
console.log('A. Version stamps:');
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const major = parseInt((pkg.version || '').split('.')[0], 10);
  assert(major >= 276, `package.json version major >= 276 (got ${pkg.version})`);
  assert(typeof pkg.scripts['test:v276'] === 'string', 'package.json has test:v276 script');
} catch (e) {
  assert(false, `package.json readable: ${e.message}`);
}

try {
  const identity = JSON.parse(fs.readFileSync(path.join(ROOT, '.agent-identity.json'), 'utf8'));
  const v = identity.version || identity.ecosVersion || '';
  const major = parseInt((v || '').replace(/[^0-9.]/g, '').split('.')[0], 10);
  assert(major >= 276, `.agent-identity.json version major >= 276 (got ${v})`);
} catch (e) {
  assert(false, `.agent-identity.json readable: ${e.message}`);
}

// ── B. New module files ───────────────────────────────────────────────────────
console.log('\nB. New versioned module files (src/lib + lib mirror):');
const V276_MODULES = ['alertResolution276', 'providerAdapters276'];

for (const mod of V276_MODULES) {
  assert(fileExists(`src/lib/${mod}.js`), `src/lib/${mod}.js exists`);
  assert(fileExists(`lib/${mod}.js`),     `lib/${mod}.js exists (mirror)`);
}
assert(fileExists('ecos-api-server-v276-patch.js'), 'ecos-api-server-v276-patch.js exists');

// ── C. AlertResolution276 — resolveAlert276 + acknowledgeAlert276 ─────────────
console.log('\nC. AlertResolution276 — resolve + acknowledge:');
try {
  const { AlertResolution276 } = require('../src/lib/alertResolution276');

  // Fake bus with mutable history
  const fakeHistory = [
    { alertId: 'a1', alertType: 'SYBIL_FAIL_RATE', ts: new Date().toISOString(), resolved: false },
    { alertId: 'a2', alertType: 'TIP_CIRCULARITY', ts: new Date().toISOString(), resolved: false },
  ];
  const fakeBus = { _history275: fakeHistory };

  const res276 = new AlertResolution276({ counterAlertBus: fakeBus });

  // resolveAlert276
  const r1 = res276.resolveAlert276('a1', { resolvedBy: 'alice', note: 'fixed' });
  assert(r1.ok === true,                 'resolveAlert276 returns ok:true');
  assert(r1.alertId === 'a1',            'resolveAlert276 returns correct alertId');
  assert(typeof r1.resolvedAt === 'string', 'resolveAlert276 returns resolvedAt');
  assert(r1.alertFound === true,         'resolveAlert276 found alert in bus history');
  assert(fakeHistory[0].resolved === true, 'bus history alert flagged resolved');
  assert(fakeHistory[0].resolvedBy === 'alice', 'bus history resolvedBy set');

  // acknowledgeAlert276
  const r2 = res276.acknowledgeAlert276('a2', { ackedBy: 'bob' });
  assert(r2.ok === true,              'acknowledgeAlert276 returns ok:true');
  assert(r2.alertId === 'a2',         'acknowledgeAlert276 returns correct alertId');
  assert(fakeHistory[1].acknowledged === true, 'bus history alert flagged acknowledged');

  // Error cases
  const r3 = res276.resolveAlert276('');
  assert(r3.ok === false,             'resolveAlert276 rejects empty alertId');

} catch (e) {
  assert(false, `AlertResolution276 resolve/ack: ${e.message}`);
}

// ── D. AlertResolution276 — getUnresolved276 ─────────────────────────────────
console.log('\nD. AlertResolution276 — getUnresolved276:');
try {
  const { AlertResolution276 } = require('../src/lib/alertResolution276');

  const fakeHistory = [
    { alertId: 'u1', alertType: 'SYBIL_FAIL_RATE', ts: new Date().toISOString(), resolved: false },
    { alertId: 'u2', alertType: 'TIP_CIRCULARITY', ts: new Date().toISOString(), resolved: true },
    { alertId: 'u3', alertType: 'HALT_ISSUANCE',   ts: new Date().toISOString(), resolved: false },
  ];
  const fakeBus = { _history275: fakeHistory };

  const res276 = new AlertResolution276({ counterAlertBus: fakeBus });

  const result = res276.getUnresolved276();
  assert(result.ok === true,       'getUnresolved276 returns ok:true');
  assert(result.total === 2,       'getUnresolved276 returns only unresolved (2)');
  assert(result.alerts.every(a => !a.resolved), 'getUnresolved276 all alerts are unresolved');

  // Filter by alertType
  const filtered = res276.getUnresolved276({ alertType: 'SYBIL_FAIL_RATE' });
  assert(filtered.total === 1,    'getUnresolved276 filters by alertType');

  // No bus
  const res276b = new AlertResolution276({});
  const r2 = res276b.getUnresolved276();
  assert(r2.ok === true,          'getUnresolved276 returns ok:true with no bus');
  assert(r2.total === 0,          'getUnresolved276 returns 0 with no bus');

} catch (e) {
  assert(false, `getUnresolved276: ${e.message}`);
}

// ── E. AlertResolution276 — wireManualOverride276 ─────────────────────────────
console.log('\nE. AlertResolution276 — wireManualOverride276:');
try {
  const { AlertResolution276 } = require('../src/lib/alertResolution276');

  let overrideCalled = false;
  const fakeOverride = {
    applyManualOverride273: function(directive) {
      overrideCalled = true;
      return { ok: true, directive };
    }
  };

  const fakeHistory = [];
  const fakeBus = { _history275: fakeHistory };

  const res276 = new AlertResolution276({ counterAlertBus: fakeBus, manualOverride: fakeOverride });

  const wireResult = res276.wireManualOverride276();
  assert(wireResult.ok === true,          'wireManualOverride276 returns ok:true');
  assert(wireResult.wired === true,       'wireManualOverride276 wired:true');
  assert(res276._overrideWired276 === true, 'overrideWired276 flag set');

  // Calling the override should trigger both original and hook
  fakeOverride.applyManualOverride273({ action: 'halt' });
  assert(overrideCalled,                  'original override function still called');

  // Double-wire is idempotent
  const w2 = res276.wireManualOverride276();
  assert(w2.reason === 'already_wired',   'double-wire returns already_wired');

  // Unwire
  const uw = res276.unwireManualOverride276();
  assert(uw.ok === true,                  'unwireManualOverride276 returns ok:true');
  assert(res276._overrideWired276 === false, 'overrideWired276 flag cleared');

  // No override — graceful
  const res276b = new AlertResolution276({});
  const w3 = res276b.wireManualOverride276();
  assert(w3.wired === false,              'wireManualOverride276 graceful with no manualOverride');

} catch (e) {
  assert(false, `wireManualOverride276: ${e.message}`);
}

// ── F. AlertResolution276 — SSE client management ─────────────────────────────
console.log('\nF. AlertResolution276 — SSE client management:');
try {
  const { AlertResolution276 } = require('../src/lib/alertResolution276');
  const res276 = new AlertResolution276({});

  // Mock SSE response
  const events = [];
  const mockRes = {
    setHeader: () => {},
    flushHeaders: () => {},
    write: (data) => events.push(data),
    on: () => {},
    status: (code) => ({ json: () => {} }),
  };

  const clientId = res276.addResolutionSseClient276(mockRes);
  assert(typeof clientId === 'string',        'addResolutionSseClient276 returns clientId string');
  assert(res276._sseClients276.size === 1,    'SSE client added to map');

  // History sent on connect
  assert(events.length > 0,                  'history event sent on connect');
  assert(events[0].includes('event: history'), 'first SSE message is history event');

  // Remove
  res276.removeResolutionSseClient276(clientId);
  assert(res276._sseClients276.size === 0,    'SSE client removed from map');

  // Heartbeat
  res276.startResolutionHeartbeat276();
  assert(res276._heartbeatTimer276 !== null,  'heartbeat timer started');
  res276.shutdown276();
  assert(res276._heartbeatTimer276 === null,  'heartbeat timer cleared after shutdown');

} catch (e) {
  assert(false, `SSE client management: ${e.message}`);
}

// ── G. AlertResolution276 — event history + getStatus276 ──────────────────────
console.log('\nG. AlertResolution276 — event history + getStatus276:');
try {
  const { AlertResolution276 } = require('../src/lib/alertResolution276');

  const fakeHistory = [
    { alertId: 'g1', alertType: 'SYBIL_FAIL_RATE', ts: new Date().toISOString(), resolved: false },
  ];
  const res276 = new AlertResolution276({ counterAlertBus: { _history275: fakeHistory } });

  res276.resolveAlert276('g1');
  const hist = res276.getEventHistory276();
  assert(hist.ok === true,                    'getEventHistory276 returns ok:true');
  assert(hist.events.length >= 1,             'getEventHistory276 has entries');
  assert(hist.events[0].event === 'ALERT_RESOLVED', 'event type is ALERT_RESOLVED');

  const status = res276.getStatus276();
  assert(status.ok === true,                  'getStatus276 returns ok:true');
  assert(status.version === '276',            'getStatus276 version is 276');
  assert(typeof status.resolutions === 'number', 'getStatus276 has resolutions count');

  const health = res276.checkAlertResolutionHealth276();
  assert(health.ok === true,                  'checkAlertResolutionHealth276 returns ok:true');

} catch (e) {
  assert(false, `event history + status: ${e.message}`);
}

// ── H. providerAdapters276 — 26 contracts ─────────────────────────────────────
console.log('\nH. providerAdapters276 — 26 contracts:');
try {
  const { PROVIDER_CONTRACTS_276, validateProvider276, createAllStubs276 } = require('../src/lib/providerAdapters276');

  const count = Object.keys(PROVIDER_CONTRACTS_276).length;
  assert(count === 26, `PROVIDER_CONTRACTS_276 has 26 entries (got ${count})`);
  assert('alertResolution' in PROVIDER_CONTRACTS_276, 'alertResolution contract present');
  assert('counterAlertBus' in PROVIDER_CONTRACTS_276, 'counterAlertBus contract inherited from V275');

  // Validate alertResolution contract shape
  const arContract = PROVIDER_CONTRACTS_276.alertResolution;
  assert(arContract.required.includes('resolveAlert276'),       'required: resolveAlert276');
  assert(arContract.required.includes('acknowledgeAlert276'),   'required: acknowledgeAlert276');
  assert(arContract.required.includes('getUnresolved276'),      'required: getUnresolved276');
  assert(arContract.required.includes('wireManualOverride276'), 'required: wireManualOverride276');
  assert(arContract.required.includes('getStatus276'),          'required: getStatus276');

  // createAllStubs276
  const stubs = createAllStubs276();
  assert(typeof stubs.alertResolution === 'object',                            'stubs.alertResolution is object');
  assert(typeof stubs.alertResolution.resolveAlert276 === 'function',          'stubs.alertResolution.resolveAlert276 is function');
  assert(typeof stubs.alertResolution.acknowledgeAlert276 === 'function',      'stubs.alertResolution.acknowledgeAlert276 is function');
  assert(typeof stubs.alertResolution.getUnresolved276 === 'function',         'stubs.alertResolution.getUnresolved276 is function');
  assert(typeof stubs.alertResolution.wireManualOverride276 === 'function',    'stubs.alertResolution.wireManualOverride276 is function');

  // Validation pass/fail
  const { AlertResolution276 } = require('../src/lib/alertResolution276');
  const good = new AlertResolution276({});
  const vr = validateProvider276('alertResolution', good);
  assert(vr.ok === true, 'validateProvider276 passes for valid AlertResolution276');

  const bad = { resolveAlert276: () => {} };
  const vr2 = validateProvider276('alertResolution', bad);
  assert(vr2.ok === false, 'validateProvider276 fails for incomplete implementation');

} catch (e) {
  assert(false, `providerAdapters276: ${e.message}`);
}

// ── I. API patch — createV276State + route structure ──────────────────────────
console.log('\nI. API patch — createV276State + route structure:');
try {
  const { createV276State, registerEcosV276Routes } = require('../ecos-api-server-v276-patch.js');

  assert(typeof createV276State === 'function',       'createV276State exported');
  assert(typeof registerEcosV276Routes === 'function', 'registerEcosV276Routes exported');

  // createV276State with no deps
  const state = createV276State({});
  assert(typeof state === 'object',                   'createV276State returns object');
  assert(typeof state.alertResolution === 'object',   'state.alertResolution is object');
  assert(typeof state.counterAlertBus === 'object',   'state.counterAlertBus inherited from V275');
  assert(state.modules.alertResolution === 'AlertResolution276', 'modules.alertResolution set');

  // Route registration
  const routes = [];
  const mockApp = {
    get:  (p) => routes.push({ method: 'GET',  path: p }),
    post: (p) => routes.push({ method: 'POST', path: p }),
  };
  registerEcosV276Routes(mockApp, state);

  const V276_EXPECTED_ROUTES = [
    { method: 'GET',  path: '/api/v276/health' },
    { method: 'GET',  path: '/api/v276/perf' },
    { method: 'POST', path: '/api/v276/providers/validate' },
    { method: 'POST', path: '/api/v276/alerts/:alertId/resolve' },
    { method: 'POST', path: '/api/v276/alerts/:alertId/acknowledge' },
    { method: 'GET',  path: '/api/v276/alerts/unresolved' },
    { method: 'GET',  path: '/api/v276/alerts/resolution/subscribe' },
    { method: 'GET',  path: '/api/v276/alerts/resolution/history' },
    { method: 'GET',  path: '/api/v276/alerts/status' },
  ];

  for (const expected of V276_EXPECTED_ROUTES) {
    const found = routes.some(r => r.method === expected.method && r.path === expected.path);
    assert(found, `route registered: ${expected.method} ${expected.path}`);
  }

  // V275 routes still present
  const hasV275Health = routes.some(r => r.path === '/api/v275/health');
  assert(hasV275Health, 'V275 routes still registered (backward compat)');

} catch (e) {
  assert(false, `API patch: ${e.message}`);
}

// ── J. Release documentation ──────────────────────────────────────────────────
console.log('\nJ. Release documentation:');
assert(fileExists('CHANGELOG_V276.md'),            'CHANGELOG_V276.md exists');
assert(fileExists('NEXT_SESSION_PROMPT_V276.md'),  'NEXT_SESSION_PROMPT_V276.md exists');
assert(fileExists('AI_PROTOCOL_V276.md'),          'AI_PROTOCOL_V276.md exists');
assert(fileContains('CHANGELOG_V276.md', '276'),   'CHANGELOG_V276.md mentions 276');
assert(fileContains('AI_PROTOCOL_V276.md', 'resolveAlert276'), 'AI_PROTOCOL_V276.md mentions resolveAlert276');

// ── K. Sacred files untouched (R1) ────────────────────────────────────────────
console.log('\nK. Sacred files untouched (R1):');
try {
  const crypto = require('crypto');
  const EXPECTED = {
    'src/lib/fiatLedger.js': '563e9b1f',
    'src/lib/auditLog.js':   'e5a5c2c2',
  };
  for (const [rel, prefix] of Object.entries(EXPECTED)) {
    const full = path.join(ROOT, rel);
    const md5  = crypto.createHash('md5').update(fs.readFileSync(full)).digest('hex');
    assert(md5.startsWith(prefix), `${rel} MD5 starts with ${prefix} (got ${md5.slice(0,8)})`);
  }
} catch (e) {
  assert(false, `Sacred file check: ${e.message}`);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(40)}`);
console.log(`PASSED: ${passed}  FAILED: ${failed}`);
console.log(`${'─'.repeat(40)}\n`);
if (failed > 0) process.exit(1);
