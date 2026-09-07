/**
 * tests/v273.test.cjs — V273 Structural + Behavioural Tests
 * CommonJS, zero new npm deps, self-running (NODE_ENV=test node tests/v273.test.cjs).
 *
 * Sections:
 *   A. Version stamps
 *   B. New module files (src/lib + lib mirror)
 *   C. CreditHealthMonitor273 — live counter wiring
 *   D. CreditHealthMonitor273 — fail-closed directives
 *   E. CreditHealthMonitor273 — telemetry (getPerf273, checkHealth)
 *   F. providerAdapters273 — 23 contracts
 *   G. API patch — createV273State + route structure
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

function fileExists(rel)         { return fs.existsSync(path.join(ROOT, rel)); }
function fileContains(rel, sub)  {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8').includes(sub); }
  catch (_) { return false; }
}

console.log('\n=== V273 Tests ===\n');

// ── A. Version stamps ────────────────────────────────────────────────────────
console.log('A. Version stamps:');
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert(pkg.version === '273.0.0', `package.json version = 273.0.0 (got ${pkg.version})`);
  assert(typeof pkg.scripts['test:v273'] === 'string', 'package.json has test:v273 script');
} catch (e) {
  assert(false, `package.json readable: ${e.message}`);
}

try {
  const identity = JSON.parse(fs.readFileSync(path.join(ROOT, '.agent-identity.json'), 'utf8'));
  const v = identity.version || identity.ecosVersion || '';
  assert(v === '273.0.0' || v === 'V273', `.agent-identity.json version = 273 (got ${v})`);
} catch (e) {
  assert(false, `.agent-identity.json readable: ${e.message}`);
}

// ── B. New module files ──────────────────────────────────────────────────────
console.log('\nB. New versioned module files (src/lib + lib mirror):');
const V273_MODULES = ['creditHealthMonitor273', 'providerAdapters273'];
for (const mod of V273_MODULES) {
  assert(fileExists(`src/lib/${mod}.js`), `src/lib/${mod}.js exists`);
  assert(fileExists(`lib/${mod}.js`),     `lib/${mod}.js exists (mirror)`);
}
assert(fileExists('ecos-api-server-v273-patch.js'), 'ecos-api-server-v273-patch.js exists');

// ── C. CreditHealthMonitor273 — live counter wiring ──────────────────────────
console.log('\nC. CreditHealthMonitor273 — live counter wiring:');
process.env.NODE_ENV = 'test';
let CHM273;
try {
  const mod = require(path.join(ROOT, 'src/lib/creditHealthMonitor273.js'));
  CHM273 = mod.CreditHealthMonitor273;
  assert(typeof CHM273 === 'function', 'CreditHealthMonitor273 is a constructor');
  assert(typeof mod.CREDIT_HEALTH_THRESHOLDS_273 === 'object', 'exports CREDIT_HEALTH_THRESHOLDS_273');
  assert(typeof mod.HALT_THRESHOLD_273 === 'number',            'exports HALT_THRESHOLD_273');
  assert(typeof mod.REWARD_INFLOW_MAX_273 === 'number',         'exports REWARD_INFLOW_MAX_273');
} catch (e) {
  assert(false, `creditHealthMonitor273 loadable: ${e.message}`);
  CHM273 = null;
}

if (CHM273) {
  // recordSybilEval273 / recordTip273 / getMetrics273
  const chm = new CHM273();
  chm.recordSybilEval273('user1', true);
  chm.recordSybilEval273('user2', false);
  chm.recordSybilEval273('user3', true);
  assert(chm._sybilWindow273.length === 3, 'sybil window length = 3');

  chm.recordTip273('alice', 'bob',   1000n);
  chm.recordTip273('bob',   'alice', 500n);
  chm.recordTip273('carol', 'dave',  200n);
  assert(chm._tipWindow273.length === 3, 'tip window length = 3');

  // checkHealth273 runs without error on empty data sources
  const h = chm.checkHealth273();
  assert(h.ok === true, 'checkHealth273 ok = true (no data sources)');
  assert(typeof h.counters === 'object', 'checkHealth273 returns counters');
  assert(typeof h.counters.rewardToInflow === 'object',  'counters.rewardToInflow present');
  assert(typeof h.counters.sybilFailRate  === 'object',  'counters.sybilFailRate present');
  assert(typeof h.counters.sellThrough    === 'object',  'counters.sellThrough present');
  assert(typeof h.counters.tipCircularity === 'object',  'counters.tipCircularity present');
  assert(typeof h.directives === 'object', 'checkHealth273 returns directives');

  // Sybil fail rate: 1 failed out of 3 = 0.333
  const sybilRate = h.counters.sybilFailRate;
  assert(Math.abs(sybilRate.rate - 1/3) < 0.01, `sybilFailRate = ~0.333 (got ${sybilRate.rate})`);

  // Tip circularity: alice→bob and bob→alice = 1 circular out of 3
  const tipCirc = h.counters.tipCircularity;
  assert(tipCirc.circular === 1, `tip circular = 1 (got ${tipCirc.circular})`);
  assert(Math.abs(tipCirc.index - 1/3) < 0.01, `tipCirc index = ~0.333 (got ${tipCirc.index})`);

  // getMetrics273 returns cached after checkHealth273
  const m = chm.getMetrics273();
  assert(m.ok === true && m.cached === true, 'getMetrics273 returns cached metrics');
}

// ── D. Fail-closed directives ────────────────────────────────────────────────
console.log('\nD. Fail-closed directives:');
if (CHM273) {
  // Mock creditReserve that reports backing ratio below halt threshold
  const lowReserve = {
    getStatus268: () => ({
      totalIssued268:    '100000',
      reserveBalance268: '5000',  // < (100000 / peg=10000 = 10) → ratio well below 1.0
      outstanding268:    '90000',
      totalConsumed268:  '10000',
    }),
    getBackingRatio268: () => 0.5,  // below HALT_THRESHOLD_273 = 1.0
  };

  const chm2 = new CHM273({ creditReserve: lowReserve });
  const h2 = chm2.checkHealth273();
  assert(h2.directives.halt_issuance === true, 'halt_issuance = true when backing_ratio < 1.0');

  const ia = chm2.issuanceAllowed273();
  assert(ia.allowed === false, 'issuanceAllowed273 = false when halted');
  assert(typeof ia.reason === 'string', 'issuanceAllowed273 returns a reason string');
  assert(ia.directive === 'halt_issuance', 'issuanceAllowed273 directive = halt_issuance');

  // Mock that triggers pause_rewards via high reward-to-inflow
  const highIssuance = {
    getStatus268: () => ({
      totalIssued268:    '900000',
      reserveBalance268: '100000',
      outstanding268:    '100000',
      totalConsumed268:  '50000',
    }),
    getBackingRatio268: () => 1.5,  // above halt threshold
  };
  const chm3 = new CHM273({ creditReserve: highIssuance });
  const h3 = chm3.checkHealth273();
  assert(h3.directives.pause_rewards === true || h3.directives.halt_issuance === true,
    'pause_rewards or halt_issuance triggered with extreme issuance');

  // manualOverride273
  const chm4 = new CHM273();
  const ov = chm4.manualOverride273('halt_issuance', true, 'test_override');
  assert(ov.ok === true,                            'manualOverride273 ok = true');
  assert(chm4._haltIssuance273 === true,            'override sets _haltIssuance273');
  assert(chm4._haltReason273 === 'test_override',   'override sets reason');
  const clear = chm4.manualOverride273('halt_issuance', false);
  assert(clear.ok === true && chm4._haltIssuance273 === false, 'override clears halt');

  // Bad directive
  const bad = chm4.manualOverride273('unknown_directive', true);
  assert(bad.ok === false, 'manualOverride273 returns ok=false for unknown directive');
}

// ── E. Telemetry ─────────────────────────────────────────────────────────────
console.log('\nE. CreditHealthMonitor273 telemetry:');
if (CHM273) {
  const chm5 = new CHM273();
  const h0 = chm5.getPerf273();
  assert(h0.count === 0 && h0.p50 === 0, 'getPerf273 returns zero before any checks');

  chm5.checkHealth273();
  chm5.checkHealth273();
  const hN = chm5.getPerf273();
  assert(hN.count === 2, `getPerf273 count = 2 after 2 checks (got ${hN.count})`);
  assert(typeof hN.p50 === 'number', 'getPerf273 p50 is a number');
  assert(typeof hN.p95 === 'number', 'getPerf273 p95 is a number');

  const ht = chm5.checkCreditHealthMonitorHealth273();
  assert(ht.ok === true,                    'checkCreditHealthMonitorHealth273 ok = true');
  assert(ht.version === '273',              'health version = 273');
  assert(typeof ht.dataSourcesWired === 'object', 'health includes dataSourcesWired');
  assert(ht.dataSourcesWired.creditReserve === false, 'creditReserve unwired = false');
  assert(ht.countersPresent === true,        'countersPresent = true after check');
}

// ── F. providerAdapters273 ───────────────────────────────────────────────────
console.log('\nF. providerAdapters273 — 23 contracts:');
try {
  const pa = require(path.join(ROOT, 'src/lib/providerAdapters273.js'));
  assert(typeof pa.PROVIDER_CONTRACTS_273 === 'object',          'exports PROVIDER_CONTRACTS_273');
  assert(typeof pa.validateProvider273 === 'function',           'exports validateProvider273');
  assert(typeof pa.validateAllProviders273 === 'function',       'exports validateAllProviders273');
  assert(typeof pa.createCreditHealthMonitorStub273 === 'function', 'exports createCreditHealthMonitorStub273');
  assert(typeof pa.createAllStubs273 === 'function',             'exports createAllStubs273');

  const count = Object.keys(pa.PROVIDER_CONTRACTS_273).length;
  assert(count >= 23, `PROVIDER_CONTRACTS_273 has ≥ 23 entries (got ${count})`);
  assert('creditHealthMonitor' in pa.PROVIDER_CONTRACTS_273, 'creditHealthMonitor contract present');

  // Validate the stub against its own contract
  const stub = pa.createCreditHealthMonitorStub273();
  const result = pa.validateProvider273('creditHealthMonitor', stub);
  assert(result.ok === true, `creditHealthMonitor stub validates (errors: ${JSON.stringify(result.errors)})`);
} catch (e) {
  assert(false, `providerAdapters273 loadable: ${e.message}`);
}

// ── G. API patch wiring ──────────────────────────────────────────────────────
console.log('\nG. API patch — createV273State + route structure:');
try {
  const patch = require(path.join(ROOT, 'ecos-api-server-v273-patch.js'));
  assert(typeof patch.createV273State === 'function',            'exports createV273State');
  assert(typeof patch.registerEcosV273Routes === 'function',     'exports registerEcosV273Routes');
  assert(typeof patch.CreditHealthMonitor273 === 'function',     'exports CreditHealthMonitor273');
  assert(typeof patch.CREDIT_HEALTH_THRESHOLDS_273 === 'object', 'exports CREDIT_HEALTH_THRESHOLDS_273');

  const state = patch.createV273State({});
  assert(typeof state.creditHealthMonitor === 'object', 'state.creditHealthMonitor is object');
  assert(typeof state.creditHealthMonitor.checkHealth273 === 'function', 'state.creditHealthMonitor.checkHealth273 exists');
  assert('creditHealthMonitor' in state.modules, 'modules includes creditHealthMonitor');
} catch (e) {
  assert(false, `ecos-api-server-v273-patch loadable: ${e.message}`);
}

// Mock Express to test route registration
try {
  const patch = require(path.join(ROOT, 'ecos-api-server-v273-patch.js'));
  const routes = { get: [], post: [] };
  const mockApp = {
    get:  (path, fn) => routes.get.push(path),
    post: (path, fn) => routes.post.push(path),
  };
  patch.registerEcosV273Routes(mockApp, {});
  const V273_ENDPOINTS = [
    '/api/v273/health',
    '/api/v273/perf',
    '/api/v273/credit-health/check',
    '/api/v273/credit-health/metrics',
    '/api/v273/credit-health/directives',
    '/api/v273/credit-health/thresholds',
  ];
  for (const ep of V273_ENDPOINTS) {
    const registered = routes.get.includes(ep) || routes.post.includes(ep);
    assert(registered, `endpoint registered: ${ep}`);
  }
  const V273_POST = [
    '/api/v273/providers/validate',
    '/api/v273/credit-health/check',
    '/api/v273/credit-health/override',
    '/api/v273/credit-health/sybil-event',
    '/api/v273/credit-health/tip-event',
  ];
  for (const ep of V273_POST) {
    assert(routes.post.includes(ep), `POST endpoint registered: ${ep}`);
  }
} catch (e) {
  assert(false, `route registration test: ${e.message}`);
}

// ── H. Release documentation ─────────────────────────────────────────────────
console.log('\nH. Release documentation:');
assert(fileExists('CHANGELOG_V273.md'),           'CHANGELOG_V273.md present');
assert(fileExists('AI_PROTOCOL_V273.md'),         'AI_PROTOCOL_V273.md present');
assert(fileExists('NEXT_SESSION_PROMPT_V273.md'), 'NEXT_SESSION_PROMPT_V273.md present');

// ── I. Sacred files untouched (R1) ────────────────────────────────────────────
console.log('\nI. Sacred files integrity (R1):');
assert(fileExists('src/lib/fiatLedger.js'), 'src/lib/fiatLedger.js exists');
assert(fileExists('src/lib/auditLog.js'),   'src/lib/auditLog.js exists');
assert(!fileContains('src/lib/fiatLedger.js', 'V273'), 'fiatLedger.js does not mention V273');
assert(!fileContains('src/lib/auditLog.js',   'V273'), 'auditLog.js does not mention V273');

// Verify sacred md5 matches
const crypto = require('crypto');
const fiatHash = crypto.createHash('md5').update(
  fs.readFileSync(path.join(ROOT, 'src/lib/fiatLedger.js'))
).digest('hex');
const auditHash = crypto.createHash('md5').update(
  fs.readFileSync(path.join(ROOT, 'src/lib/auditLog.js'))
).digest('hex');
assert(fiatHash  === '563e9b1f9e67091a5b6527c0a92568e5', `fiatLedger.js md5 = 563e9b1f... (got ${fiatHash})`);
assert(auditHash === 'e5a5c2c27801d2d03991bc8e5a1df8cb', `auditLog.js md5 = e5a5c2c2... (got ${auditHash})`);

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
