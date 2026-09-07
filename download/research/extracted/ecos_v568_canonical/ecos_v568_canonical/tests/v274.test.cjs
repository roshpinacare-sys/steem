/**
 * tests/v274.test.cjs — V274 Structural + Behavioural Tests
 * CommonJS, zero new npm deps, self-running (NODE_ENV=test node tests/v274.test.cjs).
 *
 * Sections:
 *   A. Version stamps
 *   B. New module files (src/lib + lib mirror)
 *   C. EventFeedBridge274 — hook wiring
 *   D. EventFeedBridge274 — SSE client management
 *   E. EventFeedBridge274 — telemetry (getPerf274, checkHealth)
 *   F. providerAdapters274 — 24 contracts
 *   G. API patch — createV274State + route structure
 *   H. Release documentation
 *   I. Sacred files untouched (R1)
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

console.log('\n=== V274 Tests ===\n');

// ── A. Version stamps ─────────────────────────────────────────────────────────
console.log('A. Version stamps:');
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert(pkg.version === '274.0.0', `package.json version = 274.0.0 (got ${pkg.version})`);
  assert(typeof pkg.scripts['test:v274'] === 'string', 'package.json has test:v274 script');
} catch (e) {
  assert(false, `package.json readable: ${e.message}`);
}

try {
  const identity = JSON.parse(fs.readFileSync(path.join(ROOT, '.agent-identity.json'), 'utf8'));
  const v = identity.version || identity.ecosVersion || '';
  assert(v === '274.0.0' || v === 'V274', `.agent-identity.json version = 274 (got ${v})`);
} catch (e) {
  assert(false, `.agent-identity.json readable: ${e.message}`);
}

// ── B. New module files ───────────────────────────────────────────────────────
console.log('\nB. New versioned module files (src/lib + lib mirror):');
const V274_MODULES = ['eventFeedBridge274', 'providerAdapters274'];
for (const mod of V274_MODULES) {
  assert(fileExists(`src/lib/${mod}.js`), `src/lib/${mod}.js exists`);
  assert(fileExists(`lib/${mod}.js`),     `lib/${mod}.js exists (mirror)`);
}
assert(fileExists('ecos-api-server-v274-patch.js'), 'ecos-api-server-v274-patch.js exists');

// ── C. EventFeedBridge274 — hook wiring ───────────────────────────────────────
console.log('\nC. EventFeedBridge274 — hook wiring:');
process.env.NODE_ENV = 'test';
let EFB274;
try {
  const mod = require(path.join(ROOT, 'src/lib/eventFeedBridge274.js'));
  EFB274 = mod.EventFeedBridge274;
  assert(typeof EFB274 === 'function',              'EventFeedBridge274 is a constructor');
  assert(typeof mod.BRIDGE_VERSION_274 === 'string','exports BRIDGE_VERSION_274');
  assert(mod.BRIDGE_VERSION_274 === '274',          'BRIDGE_VERSION_274 = "274"');
  assert(typeof mod.SSE_HEARTBEAT_MS_274 === 'number', 'exports SSE_HEARTBEAT_MS_274');
  assert(typeof mod.SSE_MAX_CLIENTS_274  === 'number', 'exports SSE_MAX_CLIENTS_274');
} catch (e) {
  assert(false, `eventFeedBridge274 loadable: ${e.message}`);
  EFB274 = null;
}

if (EFB274) {
  // Wire hooks with no real modules — should be idempotent
  const bridge0 = new EFB274();
  const w0 = bridge0.wireHooks274();
  assert(w0.ok === true,            'wireHooks274 ok = true (no deps)');
  assert(w0.sybilHooked === false,  'sybilHooked = false when no sybilGuard');
  assert(w0.tipHooked   === false,  'tipHooked = false when no tipModule');

  // Wire with mock sybil guard
  let sybilCallCount = 0;
  const mockSybil = {
    evaluate268: (userId) => {
      sybilCallCount++;
      return { ok: true, score: userId === 'bot' ? 0.1 : 0.9 };
    },
  };
  const mockChm = {
    getMetrics273:       () => ({ ok: false }),
    issuanceAllowed273:  () => ({ allowed: true, reason: null }),
    rewardsAllowed273:   () => ({ allowed: true, reason: null }),
    recordSybilEval273:  () => {},
    recordTip273:        () => {},
  };
  const bridge1 = new EFB274({ sybilGuard: mockSybil, creditHealthMonitor: mockChm });
  const w1 = bridge1.wireHooks274();
  assert(w1.sybilHooked === true, 'sybilHooked = true when sybilGuard provided');

  // Call the hooked method — original logic should run
  const r1 = mockSybil.evaluate268('alice');
  assert(r1.ok === true,        'hooked sybil.evaluate268 returns original result');
  assert(sybilCallCount === 1,  'original evaluate268 called once');

  // Wire with mock tip module
  let tipCallCount = 0;
  const mockTip = {
    tip268: (from, to, amount) => {
      tipCallCount++;
      return { ok: true, tipId: 'tip::1' };
    },
  };
  const bridge2 = new EFB274({ tipModule: mockTip, creditHealthMonitor: mockChm });
  const w2 = bridge2.wireHooks274();
  assert(w2.tipHooked === true, 'tipHooked = true when tipModule provided');

  const r2 = mockTip.tip268('alice', 'bob', 500n);
  assert(r2.ok === true,      'hooked tip268 returns original result');
  assert(tipCallCount === 1,  'original tip268 called once');

  // Unwire restores original methods
  const origEval = bridge1._origSybilEval274;
  bridge1.unwireHooks274();
  assert(bridge1._sybilHooked274 === false, 'sybilHooked = false after unwire');
  assert(mockSybil.evaluate268 === origEval, 'original evaluate268 restored after unwire');
}

// ── D. EventFeedBridge274 — SSE client management ────────────────────────────
console.log('\nD. EventFeedBridge274 — SSE client management:');
if (EFB274) {
  const bridge3 = new EFB274();
  // Mock SSE response object
  const mockRes = { write: () => {}, end: () => {}, written: [] };
  mockRes.write = (data) => { mockRes.written.push(data); };

  const addResult = bridge3.addSseClient274(mockRes);
  assert(addResult.ok === true,              'addSseClient274 ok = true');
  assert(typeof addResult.clientId === 'string', 'addSseClient274 returns clientId');
  assert(bridge3._sseClients274.size === 1,  'SSE client count = 1 after add');

  bridge3.removeSseClient274(addResult.clientId);
  assert(bridge3._sseClients274.size === 0,  'SSE client count = 0 after remove');

  // Capacity test (SSE_MAX_CLIENTS_274 = 200; add 201)
  const { SSE_MAX_CLIENTS_274 } = require(path.join(ROOT, 'src/lib/eventFeedBridge274.js'));
  const dummyRes = { write: () => {}, end: () => {} };
  for (let i = 0; i < SSE_MAX_CLIENTS_274; i++) bridge3.addSseClient274(dummyRes);
  const overCap = bridge3.addSseClient274(dummyRes);
  assert(overCap.ok === false, 'addSseClient274 returns ok=false when at capacity');
  assert(typeof overCap.error === 'string', 'capacity error message present');
}

// ── E. EventFeedBridge274 — telemetry ────────────────────────────────────────
console.log('\nE. EventFeedBridge274 — telemetry:');
if (EFB274) {
  const bridge4 = new EFB274();
  const p0 = bridge4.getPerf274();
  assert(p0.count === 0 && p0.p50 === 0, 'getPerf274 returns zeros before any broadcasts');

  const h = bridge4.checkEventFeedBridgeHealth274();
  assert(h.ok === true,               'checkEventFeedBridgeHealth274 ok = true');
  assert(h.version === '274',         'health version = 274');
  assert(typeof h.sseClients === 'number', 'health includes sseClients count');
  assert(h.sybilHooked === false,     'sybilHooked = false (no guard)');
  assert(h.chmWired    === false,     'chmWired = false (no CHM)');

  // getStatus274
  const s = bridge4.getStatus274();
  assert(s.ok === true,    'getStatus274 ok = true');
  assert(s.version === '274', 'getStatus274 version = 274');
}

// ── F. providerAdapters274 — 24 contracts ────────────────────────────────────
console.log('\nF. providerAdapters274 — 24 contracts:');
try {
  const pa = require(path.join(ROOT, 'src/lib/providerAdapters274.js'));
  assert(typeof pa.PROVIDER_CONTRACTS_274 === 'object',        'exports PROVIDER_CONTRACTS_274');
  assert(typeof pa.validateProvider274 === 'function',         'exports validateProvider274');
  assert(typeof pa.validateAllProviders274 === 'function',     'exports validateAllProviders274');
  assert(typeof pa.createEventFeedBridgeStub274 === 'function','exports createEventFeedBridgeStub274');
  assert(typeof pa.createAllStubs274 === 'function',           'exports createAllStubs274');

  const count = Object.keys(pa.PROVIDER_CONTRACTS_274).length;
  assert(count >= 24, `PROVIDER_CONTRACTS_274 has ≥ 24 entries (got ${count})`);
  assert('eventFeedBridge' in pa.PROVIDER_CONTRACTS_274, 'eventFeedBridge contract present');
  assert('creditHealthMonitor' in pa.PROVIDER_CONTRACTS_274,  'creditHealthMonitor contract preserved');

  // Validate the stub against its own contract
  const stub = pa.createEventFeedBridgeStub274();
  const result = pa.validateProvider274('eventFeedBridge', stub);
  assert(result.ok === true,
    `eventFeedBridge stub validates (errors: ${JSON.stringify(result.errors)})`);

  // createAllStubs274 includes the new contract
  const all = pa.createAllStubs274();
  assert(typeof all.eventFeedBridge === 'object', 'createAllStubs274 includes eventFeedBridge');
  assert(typeof all.creditHealthMonitor === 'object', 'createAllStubs274 preserves creditHealthMonitor');
} catch (e) {
  assert(false, `providerAdapters274 loadable: ${e.message}`);
}

// ── G. API patch wiring ───────────────────────────────────────────────────────
console.log('\nG. API patch — createV274State + route structure:');
try {
  const patch = require(path.join(ROOT, 'ecos-api-server-v274-patch.js'));
  assert(typeof patch.createV274State === 'function',          'exports createV274State');
  assert(typeof patch.registerEcosV274Routes === 'function',   'exports registerEcosV274Routes');
  assert(typeof patch.EventFeedBridge274 === 'function',       'exports EventFeedBridge274');
  assert(typeof patch.BRIDGE_VERSION_274 === 'string',         'exports BRIDGE_VERSION_274');

  const state = patch.createV274State({});
  assert(typeof state.eventFeedBridge === 'object',            'state.eventFeedBridge is object');
  assert(typeof state.eventFeedBridge.wireHooks274 === 'function', 'state.eventFeedBridge.wireHooks274 exists');
  assert('eventFeedBridge' in state.modules,                   'modules includes eventFeedBridge');
  assert(typeof state.creditHealthMonitor === 'object',        'creditHealthMonitor preserved in state');

  // Shutdown to clear timers from createV274State
  state.eventFeedBridge.shutdown274();
} catch (e) {
  assert(false, `ecos-api-server-v274-patch loadable: ${e.message}`);
}

// Mock Express route registration test
try {
  const patch = require(path.join(ROOT, 'ecos-api-server-v274-patch.js'));
  const routes = { get: [], post: [] };
  const mockApp = {
    get:  (p) => routes.get.push(p),
    post: (p) => routes.post.push(p),
  };
  const s = patch.registerEcosV274Routes(mockApp, {});
  s.eventFeedBridge.shutdown274();

  const V274_GET_ENDPOINTS = [
    '/api/v274/health',
    '/api/v274/perf',
    '/api/v274/credit-health/check',
    '/api/v274/credit-health/metrics',
    '/api/v274/credit-health/directives',
    '/api/v274/credit-health/thresholds',
    '/api/v274/credit-health/stream',
    '/api/v274/event-feed/status',
  ];
  for (const ep of V274_GET_ENDPOINTS) {
    assert(routes.get.includes(ep), `GET endpoint registered: ${ep}`);
  }

  const V274_POST_ENDPOINTS = [
    '/api/v274/providers/validate',
    '/api/v274/credit-health/check',
    '/api/v274/credit-health/override',
    '/api/v274/credit-health/sybil-event',
    '/api/v274/credit-health/tip-event',
    '/api/v274/event-feed/wire',
    '/api/v274/event-feed/unwire',
  ];
  for (const ep of V274_POST_ENDPOINTS) {
    assert(routes.post.includes(ep), `POST endpoint registered: ${ep}`);
  }
} catch (e) {
  assert(false, `route registration test: ${e.message}`);
}

// ── H. Release documentation ──────────────────────────────────────────────────
console.log('\nH. Release documentation:');
assert(fileExists('CHANGELOG_V274.md'),           'CHANGELOG_V274.md present');
assert(fileExists('AI_PROTOCOL_V274.md'),         'AI_PROTOCOL_V274.md present');
assert(fileExists('NEXT_SESSION_PROMPT_V274.md'), 'NEXT_SESSION_PROMPT_V274.md present');

// ── I. Sacred files untouched (R1) ────────────────────────────────────────────
console.log('\nI. Sacred files integrity (R1):');
assert(fileExists('src/lib/fiatLedger.js'), 'src/lib/fiatLedger.js exists');
assert(fileExists('src/lib/auditLog.js'),   'src/lib/auditLog.js exists');
assert(!fileContains('src/lib/fiatLedger.js', 'V274'), 'fiatLedger.js does not mention V274');
assert(!fileContains('src/lib/auditLog.js',   'V274'), 'auditLog.js does not mention V274');

const crypto = require('crypto');
const fiatHash  = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, 'src/lib/fiatLedger.js'))).digest('hex');
const auditHash = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, 'src/lib/auditLog.js'))).digest('hex');
assert(fiatHash  === '563e9b1f9e67091a5b6527c0a92568e5', `fiatLedger.js md5 = 563e9b1f... (got ${fiatHash})`);
assert(auditHash === 'e5a5c2c27801d2d03991bc8e5a1df8cb', `auditLog.js md5 = e5a5c2c2... (got ${auditHash})`);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
