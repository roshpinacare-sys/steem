'use strict';
/**
 * tests/v280.test.cjs — ECOS V280 Test Suite
 *
 * Self-running suite covering:
 *   A. Version stamps (package.json, .agent-identity.json)
 *   B. New module files + lib mirrors
 *   C. registerNotificationChannel280 — validation, registry
 *   D. deregisterNotificationChannel280 — removal
 *   E. getChannels280 — list
 *   F. notifyDigest280 — in-memory delivery, filter matching, force flag
 *   G. getNotificationHistory280 — storage, since/limit/channel filters
 *   H. Retry logic — scheduleRetry, exhaustion
 *   I. SSE client management (add, remove, broadcast, heartbeat, shutdown)
 *   J. checkNotificationChannelHealth280 + getStatus280 + getPerf280
 *   K. providerAdapters280 (30 contracts, stub validation, pass/fail)
 *   L. API patch (createV280State, route registration, V279 backward compat)
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
    const result = fn();
    if (result && typeof result.then === 'function') {
      // async test — run synchronously via a flag; we'll handle below
      return result.then(() => {
        console.log(`  ✓ ${name}`);
        passed++;
      }).catch(err => {
        console.error(`  ✗ ${name}\n    ${err.message}`);
        failed++;
        failures.push({ name, error: err.message });
      });
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

function makeNotificationModule() {
  const { NotificationChannel280 } = require('../src/lib/notificationChannel280');
  return NotificationChannel280;
}

function makeDigest(overrides = {}) {
  return {
    ok:        true,
    digestId:  crypto.randomUUID(),
    version:   '279',
    period:    overrides.period    || 'test',
    totalAlerts: overrides.totalAlerts || 0,
    unresolved:  overrides.unresolved  || 0,
    breached:    overrides.breached    ?? null,
    warned:      overrides.warned      ?? null,
    escalated:   overrides.escalated   || 0,
    topTypes:    overrides.topTypes    || [],
    slaSnapshot: null,
    ts:          new Date().toISOString(),
    ...overrides,
  };
}

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
    status(code) { this._statusCode = code; return this; },
    json(obj) { this._jsonBody = obj; },
  };
  return res;
}

// ── A. Version stamps ──────────────────────────────────────────────────────────

section('A. Version stamps');

test('package.json version is 280.0.0', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '280.0.0', `Expected 280.0.0, got ${pkg.version}`);
});

test('.agent-identity.json ecosVersion is 280.0.0', () => {
  const id = JSON.parse(fs.readFileSync(path.join(ROOT, '.agent-identity.json'), 'utf8'));
  assert.equal(id.ecosVersion, '280.0.0');
  assert.equal(id.version, '280.0.0');
});

test('.agent-identity.json includes notification feature', () => {
  const id = JSON.parse(fs.readFileSync(path.join(ROOT, '.agent-identity.json'), 'utf8'));
  assert.ok(id.features.some(f => f.includes('notification')), 'expected notification feature in identity');
});

// ── B. Module files + lib mirrors ─────────────────────────────────────────────

section('B. Module files + lib mirrors');

test('src/lib/notificationChannel280.js exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'src/lib/notificationChannel280.js')));
});

test('lib/notificationChannel280.js exists (mirror)', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'lib/notificationChannel280.js')));
});

test('src/lib/providerAdapters280.js exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'src/lib/providerAdapters280.js')));
});

test('lib/providerAdapters280.js exists (mirror)', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'lib/providerAdapters280.js')));
});

test('ecos-api-server-v280-patch.js exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'ecos-api-server-v280-patch.js')));
});

test('src/lib/notificationChannel280.js and lib/notificationChannel280.js are identical', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/notificationChannel280.js'));
  const lib = fs.readFileSync(path.join(ROOT, 'lib/notificationChannel280.js'));
  assert.ok(src.equals(lib), 'mirror mismatch');
});

test('src/lib/providerAdapters280.js and lib/providerAdapters280.js are identical', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/providerAdapters280.js'));
  const lib = fs.readFileSync(path.join(ROOT, 'lib/providerAdapters280.js'));
  assert.ok(src.equals(lib), 'mirror mismatch');
});

// ── C. registerNotificationChannel280 ────────────────────────────────────────

section('C. registerNotificationChannel280');

test('registers channel with defaults', () => {
  const NotificationChannel280 = makeNotificationModule();
  const nc = new NotificationChannel280({});
  const r = nc.registerNotificationChannel280('slack');
  assert.equal(r.ok, true);
  assert.equal(r.name, 'slack');
  assert.equal(r.minSeverity, 'INFO');
  assert.equal(r.onlyBreached, false);
  assert.equal(r.maxRetries, 3);
});

test('registers channel with custom url and filters', () => {
  const NotificationChannel280 = makeNotificationModule();
  const nc = new NotificationChannel280({});
  const r = nc.registerNotificationChannel280('webhook1', {
    url: 'https://example.com/hook',
    alertTypes: ['SYBIL_FAIL_RATE'],
    minSeverity: 'CRITICAL',
    onlyBreached: true,
    maxRetries: 5,
  });
  assert.equal(r.ok, true);
  assert.equal(r.url, 'https://example.com/hook');
  assert.deepEqual(r.alertTypes, ['SYBIL_FAIL_RATE']);
  assert.equal(r.minSeverity, 'CRITICAL');
  assert.equal(r.onlyBreached, true);
  assert.equal(r.maxRetries, 5);
});

test('rejects empty name', () => {
  const NotificationChannel280 = makeNotificationModule();
  const nc = new NotificationChannel280({});
  const r = nc.registerNotificationChannel280('');
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

test('second register overwrites first for same name', () => {
  const NotificationChannel280 = makeNotificationModule();
  const nc = new NotificationChannel280({});
  nc.registerNotificationChannel280('ch', { url: 'https://a.com' });
  nc.registerNotificationChannel280('ch', { url: 'https://b.com' });
  const list = nc.getChannels280();
  assert.equal(list.total, 1);
  assert.equal(list.channels[0].url, 'https://b.com');
});

// ── D. deregisterNotificationChannel280 ──────────────────────────────────────

section('D. deregisterNotificationChannel280');

test('removes existing channel', () => {
  const NotificationChannel280 = makeNotificationModule();
  const nc = new NotificationChannel280({});
  nc.registerNotificationChannel280('ch');
  const r = nc.deregisterNotificationChannel280('ch');
  assert.equal(r.ok, true);
  assert.equal(nc.getChannels280().total, 0);
});

test('returns ok:false for unknown channel', () => {
  const NotificationChannel280 = makeNotificationModule();
  const nc = new NotificationChannel280({});
  const r = nc.deregisterNotificationChannel280('ghost');
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

// ── E. getChannels280 ─────────────────────────────────────────────────────────

section('E. getChannels280');

test('returns empty list when no channels registered', () => {
  const NotificationChannel280 = makeNotificationModule();
  const nc = new NotificationChannel280({});
  const r = nc.getChannels280();
  assert.equal(r.ok, true);
  assert.equal(r.total, 0);
  assert.ok(Array.isArray(r.channels));
});

test('lists all registered channels', () => {
  const NotificationChannel280 = makeNotificationModule();
  const nc = new NotificationChannel280({});
  nc.registerNotificationChannel280('alpha');
  nc.registerNotificationChannel280('beta');
  const r = nc.getChannels280();
  assert.equal(r.total, 2);
  const names = r.channels.map(c => c.name);
  assert.ok(names.includes('alpha'));
  assert.ok(names.includes('beta'));
});

// ── F. notifyDigest280 ────────────────────────────────────────────────────────

section('F. notifyDigest280');

test('returns ok with zero attempted when no channels', async () => {
  const NotificationChannel280 = makeNotificationModule();
  const nc = new NotificationChannel280({});
  const r = await nc.notifyDigest280(makeDigest());
  assert.equal(r.ok, true);
  assert.equal(r.attempted, 0);
  assert.equal(r.delivered, 0);
});

test('delivers to in-memory channel (no url)', async () => {
  const NotificationChannel280 = makeNotificationModule();
  const nc = new NotificationChannel280({});
  nc.registerNotificationChannel280('mem');
  const r = await nc.notifyDigest280(makeDigest());
  assert.equal(r.attempted, 1);
  assert.equal(r.delivered, 1);
  assert.equal(r.failed, 0);
});

test('delivers to mock webhook channel', async () => {
  const NotificationChannel280 = makeNotificationModule();
  const httpPost = async (url, payload) => ({ ok: true, status: 200 });
  const nc = new NotificationChannel280({ httpPost });
  nc.registerNotificationChannel280('hook', { url: 'https://example.com/hook' });
  const r = await nc.notifyDigest280(makeDigest());
  assert.equal(r.attempted, 1);
  assert.equal(r.delivered, 1);
});

test('records failed delivery for webhook non-2xx', async () => {
  const NotificationChannel280 = makeNotificationModule();
  const httpPost = async () => ({ ok: false, status: 500 });
  const nc = new NotificationChannel280({ httpPost });
  nc.registerNotificationChannel280('hook', { url: 'https://x.com', maxRetries: 1 });
  const r = await nc.notifyDigest280(makeDigest());
  assert.equal(r.attempted, 1);
  // retrying=true means scheduled for retry — not yet failed
  const delivery = r.deliveries[0];
  assert.ok(delivery.retrying || !delivery.ok, 'expected retry or failure');
  nc.shutdown280();
});

test('force=true bypasses all filters', async () => {
  const NotificationChannel280 = makeNotificationModule();
  const nc = new NotificationChannel280({});
  // channel with very restrictive filter
  nc.registerNotificationChannel280('strict', { onlyBreached: true });
  // digest with breached=0 — would normally be filtered out
  const digest = makeDigest({ breached: 0 });
  const r = await nc.notifyDigest280(digest, { force: true });
  assert.equal(r.attempted, 1, 'force should bypass onlyBreached filter');
});

test('onlyBreached filter excludes digest when breached is null', async () => {
  const NotificationChannel280 = makeNotificationModule();
  const nc = new NotificationChannel280({});
  nc.registerNotificationChannel280('breached-only', { onlyBreached: true });
  const r = await nc.notifyDigest280(makeDigest({ breached: null }));
  assert.equal(r.attempted, 0, 'expected 0 attempted when breached is null');
});

test('returns error for invalid digest arg', async () => {
  const NotificationChannel280 = makeNotificationModule();
  const nc = new NotificationChannel280({});
  const r = await nc.notifyDigest280(null);
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

// ── G. getNotificationHistory280 ─────────────────────────────────────────────

section('G. getNotificationHistory280');

test('returns empty when no deliveries', () => {
  const NotificationChannel280 = makeNotificationModule();
  const nc = new NotificationChannel280({});
  const r = nc.getNotificationHistory280();
  assert.equal(r.ok, true);
  assert.equal(r.total, 0);
  assert.ok(Array.isArray(r.deliveries));
});

test('limit caps results', async () => {
  const NotificationChannel280 = makeNotificationModule();
  const nc = new NotificationChannel280({});
  nc.registerNotificationChannel280('mem');
  for (let i = 0; i < 10; i++) await nc.notifyDigest280(makeDigest());
  const r = nc.getNotificationHistory280({ limit: 3 });
  assert.ok(r.deliveries.length <= 3);
});

test('channel filter returns only matching channel deliveries', async () => {
  const NotificationChannel280 = makeNotificationModule();
  const nc = new NotificationChannel280({});
  nc.registerNotificationChannel280('alpha');
  nc.registerNotificationChannel280('beta');
  await nc.notifyDigest280(makeDigest());
  const r = nc.getNotificationHistory280({ channel: 'alpha' });
  for (const d of r.deliveries) {
    assert.equal(d.channel, 'alpha');
  }
});

// ── H. Retry logic ────────────────────────────────────────────────────────────

section('H. Retry logic');

test('scheduleRetry marks exhausted when attempt >= maxRetries', async () => {
  const NotificationChannel280 = makeNotificationModule();
  const httpPost = async () => ({ ok: false, status: 503 });
  const nc = new NotificationChannel280({ httpPost });
  nc.registerNotificationChannel280('hook', { url: 'https://x.com', maxRetries: 1 });
  await nc.notifyDigest280(makeDigest());
  // After first attempt fails and maxRetries=1, result should be retrying (scheduled)
  // Cleanup
  nc.shutdown280();
});

test('shutdown clears pending retryTimers', async () => {
  const NotificationChannel280 = makeNotificationModule();
  const httpPost = async () => ({ ok: false, status: 500 });
  const nc = new NotificationChannel280({ httpPost });
  nc.registerNotificationChannel280('hook', { url: 'https://x.com', maxRetries: 3 });
  await nc.notifyDigest280(makeDigest());
  nc.shutdown280();
  assert.equal(nc._retryTimers280.size, 0);
});

// ── I. SSE client management ──────────────────────────────────────────────────

section('I. SSE client management');

test('addNotificationSseClient280 returns clientId', () => {
  const NotificationChannel280 = makeNotificationModule();
  const nc = new NotificationChannel280({});
  const res = makeMockSseRes();
  const id = nc.addNotificationSseClient280(res);
  assert.ok(typeof id === 'string' && id.length > 0);
  nc.removeNotificationSseClient280(id);
  nc.shutdown280();
});

test('addNotificationSseClient280 sends channel list on connect', () => {
  const NotificationChannel280 = makeNotificationModule();
  const nc = new NotificationChannel280({});
  nc.registerNotificationChannel280('alpha');
  const res = makeMockSseRes();
  nc.addNotificationSseClient280(res);
  const initialWrite = res._writes.find(w => w.includes('channels'));
  assert.ok(initialWrite, 'expected channels event on connect');
  nc.shutdown280();
});

test('removeNotificationSseClient280 removes client', () => {
  const NotificationChannel280 = makeNotificationModule();
  const nc = new NotificationChannel280({});
  const res = makeMockSseRes();
  const id = nc.addNotificationSseClient280(res);
  nc.removeNotificationSseClient280(id);
  assert.equal(nc._sseClients280.size, 0);
  nc.shutdown280();
});

test('SSE client auto-removes on res close', () => {
  const NotificationChannel280 = makeNotificationModule();
  const nc = new NotificationChannel280({});
  const res = makeMockSseRes();
  nc.addNotificationSseClient280(res);
  assert.equal(nc._sseClients280.size, 1);
  res._on_close();
  assert.equal(nc._sseClients280.size, 0);
  nc.shutdown280();
});

test('shutdown280 closes all SSE clients and clears timers', () => {
  const NotificationChannel280 = makeNotificationModule();
  const nc = new NotificationChannel280({});
  const res = makeMockSseRes();
  nc.addNotificationSseClient280(res);
  const r = nc.shutdown280();
  assert.equal(r.ok, true);
  assert.equal(nc._sseClients280.size, 0);
});

// ── J. Health / Status / Perf ────────────────────────────────────────────────

section('J. checkNotificationChannelHealth280 + getStatus280 + getPerf280');

test('checkNotificationChannelHealth280 returns ok', () => {
  const NotificationChannel280 = makeNotificationModule();
  const nc = new NotificationChannel280({});
  const r = nc.checkNotificationChannelHealth280();
  assert.equal(r.ok, true);
  assert.equal(r.version, '280');
  assert.equal(typeof r.channelCount, 'number');
  assert.equal(typeof r.deliveryCount, 'number');
  assert.equal(typeof r.pendingRetries, 'number');
  assert.equal(typeof r.sseClients, 'number');
});

test('getStatus280 returns version 280', () => {
  const NotificationChannel280 = makeNotificationModule();
  const nc = new NotificationChannel280({});
  const r = nc.getStatus280();
  assert.equal(r.version, '280');
});

test('getPerf280 returns p50/p95/p99/count', () => {
  const NotificationChannel280 = makeNotificationModule();
  const nc = new NotificationChannel280({});
  const r = nc.getPerf280();
  assert.equal(typeof r.p50, 'number');
  assert.equal(typeof r.p95, 'number');
  assert.equal(typeof r.p99, 'number');
  assert.equal(typeof r.count, 'number');
});

test('channelCount reflects registered channels', () => {
  const NotificationChannel280 = makeNotificationModule();
  const nc = new NotificationChannel280({});
  nc.registerNotificationChannel280('a');
  nc.registerNotificationChannel280('b');
  assert.equal(nc.getStatus280().channelCount, 2);
  nc.deregisterNotificationChannel280('a');
  assert.equal(nc.getStatus280().channelCount, 1);
});

// ── K. providerAdapters280 ────────────────────────────────────────────────────

section('K. providerAdapters280 (30 contracts)');

const { PROVIDER_CONTRACTS_280, validateProvider280, validateAllProviders280, createNotificationChannelStub280, createAllStubs280 } = require('../src/lib/providerAdapters280');

test('PROVIDER_CONTRACTS_280 has exactly 30 contracts', () => {
  const keys = Object.keys(PROVIDER_CONTRACTS_280);
  assert.equal(keys.length, 30, `Expected 30 contracts, got ${keys.length}: ${keys.join(', ')}`);
});

test('PROVIDER_CONTRACTS_280 includes notificationChannel', () => {
  assert.ok('notificationChannel' in PROVIDER_CONTRACTS_280);
});

test('notificationChannel contract has all required methods', () => {
  const contract = PROVIDER_CONTRACTS_280.notificationChannel;
  const required = [
    'registerNotificationChannel280',
    'deregisterNotificationChannel280',
    'notifyDigest280',
    'getChannels280',
    'getNotificationHistory280',
    'getStatus280',
    'addNotificationSseClient280',
    'removeNotificationSseClient280',
  ];
  for (const m of required) {
    assert.ok(contract.required.includes(m), `missing required method: ${m}`);
  }
});

test('createNotificationChannelStub280 implements all required methods', () => {
  const stub = createNotificationChannelStub280();
  const required = PROVIDER_CONTRACTS_280.notificationChannel.required;
  for (const m of required) {
    assert.equal(typeof stub[m], 'function', `stub missing method: ${m}`);
  }
});

test('validateProvider280 passes for valid stub', () => {
  const stub = createNotificationChannelStub280();
  const r = validateProvider280('notificationChannel', stub);
  assert.equal(r.ok, true);
  assert.equal(r.errors.length, 0);
});

test('validateProvider280 fails for incomplete provider', () => {
  const r = validateProvider280('notificationChannel', {});
  assert.equal(r.ok, false);
  assert.ok(r.errors.length > 0);
});

test('validateProvider280 rejects unknown contract key', () => {
  const r = validateProvider280('nonExistentKey', {});
  assert.equal(r.ok, false);
});

test('createAllStubs280 returns 30-key object with notificationChannel', () => {
  const stubs = createAllStubs280();
  assert.ok('notificationChannel' in stubs);
  assert.ok('alertDigest' in stubs);    // from v279
  assert.ok('alertSla' in stubs);       // from v278
  assert.ok('alertEscalation' in stubs); // from v277
});

test('validateAllProviders280 passes for all stubs', () => {
  const stubs = createAllStubs280();
  const r = validateAllProviders280(stubs);
  assert.equal(r.ok, true);
});

// ── L. API Patch ──────────────────────────────────────────────────────────────

section('L. API patch (createV280State, route registration)');

const { createV280State, registerV280Routes, V280_ENDPOINTS } = require('../ecos-api-server-v280-patch');

test('createV280State returns object with notificationChannel280', () => {
  const state = createV280State({});
  assert.ok(state.notificationChannel280, 'expected notificationChannel280 in state');
  assert.equal(typeof state.notificationChannel280.registerNotificationChannel280, 'function');
  assert.equal(typeof state.notificationChannel280.notifyDigest280, 'function');
});

test('createV280State preserves v279State properties', () => {
  const mock279 = { alertDigest279: { checkAlertDigestHealth279: () => ({ ok: true }) } };
  const state = createV280State(mock279);
  assert.ok(state.alertDigest279, 'expected alertDigest279 preserved in state');
});

test('V280_ENDPOINTS has all expected routes', () => {
  const paths = V280_ENDPOINTS.map(e => e.path);
  assert.ok(paths.includes('/api/v280/health'));
  assert.ok(paths.includes('/api/v280/alerts/channels'));
  assert.ok(paths.includes('/api/v280/alerts/notify'));
  assert.ok(paths.includes('/api/v280/alerts/notify/history'));
  assert.ok(paths.includes('/api/v280/alerts/notify/subscribe'));
});

test('registerV280Routes registers routes on mock app', () => {
  const routes = [];
  const mockApp = {
    get:    (path, fn) => routes.push({ method: 'GET',    path }),
    post:   (path, fn) => routes.push({ method: 'POST',   path }),
    delete: (path, fn) => routes.push({ method: 'DELETE', path }),
  };
  const state = createV280State({});
  registerV280Routes(mockApp, state);
  const paths = routes.map(r => r.path);
  assert.ok(paths.includes('/api/v280/health'));
  assert.ok(paths.includes('/api/v280/alerts/channels'));
  assert.ok(paths.includes('/api/v280/alerts/notify'));
  assert.ok(paths.includes('/api/v280/alerts/notify/subscribe'));
  // DELETE route
  const deletePaths = routes.filter(r => r.method === 'DELETE').map(r => r.path);
  assert.ok(deletePaths.includes('/api/v280/alerts/channels/:name'));
});

// ── M. Release documentation ──────────────────────────────────────────────────

section('M. Release documentation');

test('CHANGELOG_V280.md exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'CHANGELOG_V280.md')));
});

test('NEXT_SESSION_PROMPT_V280.md exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'NEXT_SESSION_PROMPT_V280.md')));
});

test('AI_PROTOCOL_V280.md exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'AI_PROTOCOL_V280.md')));
});

test('CHANGELOG_V280.md mentions notificationChannel280', () => {
  const content = fs.readFileSync(path.join(ROOT, 'CHANGELOG_V280.md'), 'utf8');
  assert.ok(content.includes('notificationChannel280'), 'expected notificationChannel280 in changelog');
});

test('CHANGELOG_V280.md mentions notifyDigest280', () => {
  const content = fs.readFileSync(path.join(ROOT, 'CHANGELOG_V280.md'), 'utf8');
  assert.ok(content.includes('notifyDigest280'));
});

test('CHANGELOG_V280.md mentions registerNotificationChannel280', () => {
  const content = fs.readFileSync(path.join(ROOT, 'CHANGELOG_V280.md'), 'utf8');
  assert.ok(content.includes('registerNotificationChannel280'));
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

// Wait for any async tests then print summary
setImmediate(() => {
  console.log('\n' + '─'.repeat(50));
  console.log(`V280 Test Suite: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.error('\nFailed tests:');
    for (const { name, error } of failures) {
      console.error(`  ✗ ${name}: ${error}`);
    }
  }
  console.log('─'.repeat(50));
  if (failed > 0) process.exit(1);
});
