/**
 * tests/v275.test.cjs — V275 Structural + Behavioural Tests
 * CommonJS, zero new npm deps, self-running (NODE_ENV=test node tests/v275.test.cjs).
 *
 * Sections:
 *   A. Version stamps
 *   B. New module files (src/lib + lib mirror)
 *   C. CounterAlertBus275 — threshold evaluation + alert firing
 *   D. CounterAlertBus275 — SSE client management
 *   E. CounterAlertBus275 — subscription to EventFeedBridge274
 *   F. CounterAlertBus275 — alert history + getStatus275
 *   G. providerAdapters275 — 25 contracts
 *   H. API patch — createV275State + route structure
 *   I. Release documentation
 *   J. Sacred files untouched (R1)
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

console.log('\n=== V275 Tests ===\n');

// ── A. Version stamps ─────────────────────────────────────────────────────────
console.log('A. Version stamps:');
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const major = parseInt((pkg.version || '').split('.')[0], 10);
  assert(major >= 275, `package.json version major >= 275 (got ${pkg.version})`);
  assert(typeof pkg.scripts['test:v275'] === 'string', 'package.json has test:v275 script');
} catch (e) {
  assert(false, `package.json readable: ${e.message}`);
}

try {
  const identity = JSON.parse(fs.readFileSync(path.join(ROOT, '.agent-identity.json'), 'utf8'));
  const v = identity.version || identity.ecosVersion || '';
  const major = parseInt((v || '').replace(/[^0-9.]/g, '').split('.')[0], 10);
  assert(major >= 275, `.agent-identity.json version major >= 275 (got ${v})`);
} catch (e) {
  assert(false, `.agent-identity.json readable: ${e.message}`);
}

// ── B. New module files ───────────────────────────────────────────────────────
console.log('\nB. New versioned module files (src/lib + lib mirror):');
const V275_MODULES = ['counterAlertBus275', 'providerAdapters275'];
for (const mod of V275_MODULES) {
  assert(fileExists(`src/lib/${mod}.js`), `src/lib/${mod}.js exists`);
  assert(fileExists(`lib/${mod}.js`),     `lib/${mod}.js exists (mirror)`);
}
assert(fileExists('ecos-api-server-v275-patch.js'), 'ecos-api-server-v275-patch.js exists');

// ── C. CounterAlertBus275 — threshold evaluation + alert firing ───────────────
console.log('\nC. CounterAlertBus275 — threshold evaluation + alert firing:');
process.env.NODE_ENV = 'test';
let CAB275;
try {
  const mod = require(path.join(ROOT, 'src/lib/counterAlertBus275.js'));
  CAB275 = mod.CounterAlertBus275;
  assert(typeof CAB275 === 'function',                       'CounterAlertBus275 is a constructor');
  assert(typeof mod.ALERT_BUS_VERSION_275 === 'string',      'exports ALERT_BUS_VERSION_275');
  assert(mod.ALERT_BUS_VERSION_275 === '275',                'ALERT_BUS_VERSION_275 = "275"');
  assert(typeof mod.DEFAULT_THRESHOLDS_275 === 'object',     'exports DEFAULT_THRESHOLDS_275');
  assert(typeof mod.ALERT_TYPE_SYBIL_FAIL_RATE_275 === 'string', 'exports ALERT_TYPE_SYBIL_FAIL_RATE_275');
  assert(typeof mod.ALERT_TYPE_TIP_CIRCULARITY_275 === 'string', 'exports ALERT_TYPE_TIP_CIRCULARITY_275');
  assert(typeof mod.ALERT_HISTORY_MAX_275 === 'number',      'exports ALERT_HISTORY_MAX_275');
  assert(mod.ALERT_HISTORY_MAX_275 === 500,                  'ALERT_HISTORY_MAX_275 = 500');
} catch (e) {
  assert(false, `counterAlertBus275 loadable: ${e.message}`);
  CAB275 = null;
}

if (CAB275) {
  // Alert firing via _maybeFireAlert275
  const bus0 = new CAB275({ thresholds: { sybilFailRate: 0.10, tipCircularity: 0.80 } });
  let fired = [];
  bus0.onAlert275('*', (alert) => fired.push(alert));

  // Should not fire (below threshold)
  bus0._onCounterEvent275('sybilEval', {});
  assert(fired.length === 0, 'No alert below threshold');

  // Manually trigger via _maybeFireAlert275
  bus0._maybeFireAlert275('SYBIL_FAIL_RATE', { rate: 0.20, threshold: 0.10, eventType: 'sybilEval' });
  assert(fired.length === 1,                  'Alert fired when threshold crossed');
  assert(fired[0].alertType === 'SYBIL_FAIL_RATE', 'Alert has correct alertType');
  assert(typeof fired[0].alertId === 'string', 'Alert has alertId (uuid)');
  assert(typeof fired[0].ts === 'string',       'Alert has ts (ISO string)');
  assert(fired[0].resolved === false,           'Alert resolved = false by default');

  // Cooldown: same type fires again only after ALERT_COOLDOWN_MS_275
  bus0._maybeFireAlert275('SYBIL_FAIL_RATE', { rate: 0.20, threshold: 0.10, eventType: 'sybilEval' });
  assert(fired.length === 1, 'Cooldown prevents duplicate alert within window');

  // History stored
  const hist = bus0.getHistory275();
  assert(hist.ok === true,          'getHistory275 ok = true');
  assert(hist.alerts.length === 1,  'History contains 1 alert');
  assert(hist.total === 1,          'History total = 1');

  // Handler offAlert
  const handler2 = (a) => {};
  bus0.onAlert275('TIP_CIRCULARITY', handler2);
  bus0.offAlert275('TIP_CIRCULARITY', handler2);
  assert(true, 'onAlert275 / offAlert275 API works without throwing');
}

// ── D. CounterAlertBus275 — SSE client management ────────────────────────────
console.log('\nD. CounterAlertBus275 — SSE client management:');
if (CAB275) {
  const bus1 = new CAB275();
  const written = [];
  const mockRes = { write: (d) => written.push(d), end: () => {} };

  const addResult = bus1.addAlertSseClient275(mockRes);
  assert(addResult.ok === true,                   'addAlertSseClient275 ok = true');
  assert(typeof addResult.clientId === 'string',  'addAlertSseClient275 returns clientId');
  assert(bus1._sseClients275.size === 1,          'SSE client count = 1 after add');
  assert(written.some(d => d.includes('history')), 'history event sent immediately on connect');

  bus1.removeAlertSseClient275(addResult.clientId);
  assert(bus1._sseClients275.size === 0,          'SSE client count = 0 after remove');

  // Broadcast test
  const bus2 = new CAB275();
  const written2 = [];
  const mockRes2 = { write: (d) => written2.push(d), end: () => {} };
  bus2.addAlertSseClient275(mockRes2);
  bus2._broadcastAlert275({ alertType: 'TEST', alertId: 'abc', ts: new Date().toISOString() });
  assert(written2.some(d => d.includes('alert')), 'alert SSE event sent to client');
}

// ── E. CounterAlertBus275 — subscription to EventFeedBridge274 ───────────────
console.log('\nE. CounterAlertBus275 — subscription to EventFeedBridge274:');
if (CAB275) {
  const bus3 = new CAB275();

  // No bridge — subscribe gracefully
  const sub0 = bus3.subscribe275();
  assert(sub0.ok === true,            'subscribe275 ok = true (no bridge)');
  assert(sub0.subscribed === false,   'subscribed = false when no bridge');

  // Mock EventFeedBridge274 with _broadcastCounterUpdate274
  let origCalled = 0;
  const mockBridge = {
    _broadcastCounterUpdate274: (eventType, data) => { origCalled++; },
  };
  const mockChm = {
    checkHealth273: () => ({
      counters:   { sybilFailRate: 0.05, tipCircularity: 0.3 },
      directives: { halt_issuance: false, pause_rewards: false },
    }),
  };
  const bus4 = new CAB275({ eventFeedBridge: mockBridge, creditHealthMonitor: mockChm });
  const sub1 = bus4.subscribe275();
  assert(sub1.ok === true,         'subscribe275 ok = true with bridge');
  assert(sub1.subscribed === true, 'subscribed = true with bridge');
  assert(bus4._subscribed275,      '_subscribed275 = true');

  // Call the hooked broadcast — original must still be called
  mockBridge._broadcastCounterUpdate274('sybilEval', { userId: 'alice' });
  assert(origCalled === 1, 'Original _broadcastCounterUpdate274 called through hook');

  // Unsubscribe restores original
  bus4.unsubscribe275();
  assert(bus4._subscribed275 === false, '_subscribed275 = false after unsubscribe');
}

// ── F. CounterAlertBus275 — alert history + getStatus275 ─────────────────────
console.log('\nF. CounterAlertBus275 — alert history + getStatus275:');
if (CAB275) {
  const bus5 = new CAB275({ thresholds: { sybilFailRate: 0.05, tipCircularity: 0.50 } });

  // Fire multiple alerts (bypass cooldown by direct call to _buildAlert275 + push)
  for (let i = 0; i < 5; i++) {
    const alert = bus5._buildAlert275('SYBIL_FAIL_RATE', { rate: 0.20 });
    bus5._history275.push(alert);
  }

  const hist2 = bus5.getHistory275({ limit: 3 });
  assert(hist2.ok === true,          'getHistory275 ok');
  assert(hist2.alerts.length === 3,  'getHistory275 limit works (3)');
  assert(hist2.total === 5,          'getHistory275 total = 5');
  assert(hist2.filtered === 3,       'getHistory275 filtered = 3');

  const hist3 = bus5.getHistory275({ alertType: 'TIP_CIRCULARITY' });
  assert(hist3.alerts.length === 0,  'getHistory275 filter by alertType works');

  const status = bus5.getStatus275();
  assert(status.ok === true,             'getStatus275 ok');
  assert(status.version === '275',       'getStatus275 version = 275');
  assert(typeof status.subscribed === 'boolean', 'getStatus275 has subscribed');
  assert(typeof status.thresholds === 'object',  'getStatus275 has thresholds');
  assert(status.historyCount === 5,      'getStatus275 historyCount = 5');
}

// ── G. providerAdapters275 — 25 contracts ────────────────────────────────────
console.log('\nG. providerAdapters275 — 25 contracts:');
try {
  const mod = require(path.join(ROOT, 'src/lib/providerAdapters275.js'));
  assert(typeof mod.PROVIDER_CONTRACTS_275 === 'object', 'exports PROVIDER_CONTRACTS_275');
  const count = Object.keys(mod.PROVIDER_CONTRACTS_275).length;
  assert(count === 25, `25 contracts defined (got ${count})`);
  assert(typeof mod.PROVIDER_CONTRACTS_275.counterAlertBus === 'object', 'counterAlertBus contract present');

  const req = mod.PROVIDER_CONTRACTS_275.counterAlertBus.required || [];
  assert(req.includes('subscribe275'),            'counterAlertBus requires subscribe275');
  assert(req.includes('getHistory275'),           'counterAlertBus requires getHistory275');
  assert(req.includes('addAlertSseClient275'),    'counterAlertBus requires addAlertSseClient275');

  // validateProvider275
  if (CAB275) {
    const stubBus = new CAB275();
    const vResult = mod.validateProvider275('counterAlertBus', stubBus);
    assert(vResult.ok === true, 'validateProvider275 counterAlertBus stub passes');
  }

  // createAllStubs275
  assert(typeof mod.createAllStubs275 === 'function', 'exports createAllStubs275');
  const stubs = mod.createAllStubs275();
  assert(typeof stubs.counterAlertBus === 'object', 'createAllStubs275 includes counterAlertBus');
} catch (e) {
  assert(false, `providerAdapters275 loadable: ${e.message}`);
}

// ── H. API patch — createV275State + route structure ─────────────────────────
console.log('\nH. API patch — createV275State + route structure:');
try {
  const mod = require(path.join(ROOT, 'ecos-api-server-v275-patch.js'));
  assert(typeof mod.createV275State === 'function',     'exports createV275State');
  assert(typeof mod.registerEcosV275Routes === 'function', 'exports registerEcosV275Routes');

  const state = mod.createV275State({});
  assert(typeof state.counterAlertBus === 'object', 'createV275State includes counterAlertBus');
  assert(typeof state.eventFeedBridge === 'object', 'createV275State includes eventFeedBridge (V274)');
  assert(typeof state.creditHealthMonitor === 'object', 'createV275State includes creditHealthMonitor (V273)');
  assert(state.modules.counterAlertBus === 'CounterAlertBus275', 'modules.counterAlertBus = CounterAlertBus275');

  // Route registration
  const routes = {};
  const mockApp = {
    get:  (path, ...args) => { routes['GET:' + path] = true; },
    post: (path, ...args) => { routes['POST:' + path] = true; },
  };
  mod.registerEcosV275Routes(mockApp, {});

  const expectedRoutes = [
    'GET:/api/v275/health',
    'GET:/api/v275/perf',
    'POST:/api/v275/providers/validate',
    'GET:/api/v275/alerts/subscribe',
    'GET:/api/v275/alerts/history',
    'GET:/api/v275/alerts/thresholds',
    'POST:/api/v275/alerts/thresholds',
    'GET:/api/v275/credit-health/dashboard',
    'GET:/api/v275/alerts/status',
  ];

  for (const route of expectedRoutes) {
    assert(routes[route] === true, `Route registered: ${route}`);
  }

  // V274 routes still present
  assert(routes['GET:/api/v274/health'] === true,          'V274 health route preserved');
  assert(routes['GET:/api/v274/credit-health/stream'] === true, 'V274 SSE stream route preserved');
} catch (e) {
  assert(false, `ecos-api-server-v275-patch loadable: ${e.message}`);
}

// ── I. Release documentation ──────────────────────────────────────────────────
console.log('\nI. Release documentation:');
assert(fileExists('CHANGELOG_V275.md'),              'CHANGELOG_V275.md exists');
assert(fileExists('AI_PROTOCOL_V275.md'),            'AI_PROTOCOL_V275.md exists');
assert(fileExists('NEXT_SESSION_PROMPT_V275.md'),    'NEXT_SESSION_PROMPT_V275.md exists');
assert(fileContains('CHANGELOG_V275.md', '275'),     'CHANGELOG_V275.md mentions 275');
assert(fileContains('AI_PROTOCOL_V275.md', '275'),   'AI_PROTOCOL_V275.md mentions 275');

// ── J. Sacred files untouched (R1) ───────────────────────────────────────────
console.log('\nJ. Sacred file integrity (R1):');
const crypto = require('crypto');
function md5file(rel) {
  try {
    return crypto.createHash('md5')
      .update(fs.readFileSync(path.join(ROOT, rel)))
      .digest('hex');
  } catch (_) { return null; }
}
const fiatMd5   = md5file('lib/fiatLedger.js');
const auditMd5  = md5file('lib/auditLog.js');
const fiatMd5s  = md5file('src/lib/fiatLedger.js');
const auditMd5s = md5file('src/lib/auditLog.js');

assert(fiatMd5  === '563e9b1f9e67091a5b6527c0a92568e5', `lib/fiatLedger.js md5 unchanged (got ${fiatMd5})`);
assert(auditMd5 === 'e5a5c2c27801d2d03991bc8e5a1df8cb', `lib/auditLog.js md5 unchanged (got ${auditMd5})`);
assert(fiatMd5s === fiatMd5,                            'src/lib/fiatLedger.js matches lib/ mirror');
assert(auditMd5s === auditMd5,                          'src/lib/auditLog.js matches lib/ mirror');

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
