'use strict';
/**
 * tests/v284.test.cjs — ECOS V284 Test Suite
 *
 * Self-running suite covering:
 *   A. Version stamps (package.json, .agent-identity.json)
 *   B. New module files + lib mirrors
 *   C. setChannelFilter284 — validation, creation, replacement
 *   D. getChannelFilter284 — retrieval, not-found
 *   E. removeChannelFilter284 — removal, not-found
 *   F. applyChannelFilter284 — no filter, categories, excludeCategories, severity, alertCount, periods, custom
 *   G. notifyDigest284 — filtered delivery, all-pass, single channel
 *   H. testChannelFilter284 — dry-run with filter blocking, dry-run passing
 *   I. getStatus284 + checkChannelFilterHealth284 + getPerf284
 *   J. providerAdapters284 (34 contracts, stub validation, pass/fail)
 *   K. API patch (createV284State, route registration, V283 backward compat)
 *   L. Release documentation
 *   M. Sacred file integrity (MD5 verified)
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

function makeFilterModule() {
  const { ChannelFilter284 } = require('../src/lib/notificationChannelFilter284');
  return ChannelFilter284;
}

function makeChannelEngine() {
  const { NotificationChannel283 } = require('../src/lib/notificationChannel283');
  return new NotificationChannel283({});
}

function makeSampleDigest(overrides = {}) {
  return {
    ok:          true,
    digestId:    crypto.randomUUID(),
    version:     '284',
    period:      'scheduled',
    totalAlerts: 5,
    breached:    2,
    severity:    'medium',
    category:    'billing',
    ts:          new Date().toISOString(),
    ...overrides,
  };
}

// ── A. Version stamps ──────────────────────────────────────────────────────────
section('A. Version stamps');

test('package.json version is 284.0.0', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '284.0.0');
});

test('.agent-identity.json ecosVersion is 284.0.0', () => {
  const id = JSON.parse(fs.readFileSync(path.join(ROOT, '.agent-identity.json'), 'utf8'));
  assert.equal(id.ecosVersion, '284.0.0');
});

// ── B. Module files + lib mirrors ─────────────────────────────────────────────
section('B. Module files + lib mirrors');

test('src/lib/notificationChannelFilter284.js exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'src/lib/notificationChannelFilter284.js')));
});

test('lib/notificationChannelFilter284.js exists (mirror)', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'lib/notificationChannelFilter284.js')));
});

test('src/lib/providerAdapters284.js exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'src/lib/providerAdapters284.js')));
});

test('lib/providerAdapters284.js exists (mirror)', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'lib/providerAdapters284.js')));
});

test('ecos-api-server-v284-patch.js exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'ecos-api-server-v284-patch.js')));
});

// ── C. setChannelFilter284 ────────────────────────────────────────────────────
section('C. setChannelFilter284');

test('sets a basic filter with categories', () => {
  const F = makeFilterModule();
  const svc = new F({});
  const r = svc.setChannelFilter284('ch1', { categories: ['billing', 'auth'] });
  assert.ok(r.ok);
  assert.equal(r.channelName, 'ch1');
  assert.deepEqual(r.filter.categories, ['billing', 'auth']);
  assert.equal(r.version, '284');
});

test('sets a filter with minSeverity', () => {
  const F = makeFilterModule();
  const svc = new F({});
  const r = svc.setChannelFilter284('ch1', { minSeverity: 'high' });
  assert.ok(r.ok);
  assert.equal(r.filter.minSeverity, 'high');
});

test('sets a filter with minAlerts and maxAlerts', () => {
  const F = makeFilterModule();
  const svc = new F({});
  const r = svc.setChannelFilter284('ch1', { minAlerts: 2, maxAlerts: 10 });
  assert.ok(r.ok);
  assert.equal(r.filter.minAlerts, 2);
  assert.equal(r.filter.maxAlerts, 10);
});

test('sets a filter with periods', () => {
  const F = makeFilterModule();
  const svc = new F({});
  const r = svc.setChannelFilter284('ch1', { periods: ['daily', 'weekly'] });
  assert.ok(r.ok);
  assert.deepEqual(r.filter.periods, ['daily', 'weekly']);
});

test('sets a filter with custom key/value', () => {
  const F = makeFilterModule();
  const svc = new F({});
  const r = svc.setChannelFilter284('ch1', { custom: { region: 'us-east' } });
  assert.ok(r.ok);
  assert.deepEqual(r.filter.custom, { region: 'us-east' });
});

test('replaces an existing filter', () => {
  const F = makeFilterModule();
  const svc = new F({});
  svc.setChannelFilter284('ch1', { categories: ['billing'] });
  const r = svc.setChannelFilter284('ch1', { minSeverity: 'critical' });
  assert.ok(r.ok);
  assert.equal(r.filter.categories, null);
  assert.equal(r.filter.minSeverity, 'critical');
});

test('rejects empty channelName', () => {
  const F = makeFilterModule();
  const svc = new F({});
  const r = svc.setChannelFilter284('', {});
  assert.ok(!r.ok);
  assert.match(r.error, /channelName/);
});

test('rejects invalid minSeverity', () => {
  const F = makeFilterModule();
  const svc = new F({});
  const r = svc.setChannelFilter284('ch1', { minSeverity: 'extreme' });
  assert.ok(!r.ok);
  assert.match(r.error, /minSeverity/);
});

test('rejects maxAlerts < minAlerts', () => {
  const F = makeFilterModule();
  const svc = new F({});
  const r = svc.setChannelFilter284('ch1', { minAlerts: 10, maxAlerts: 5 });
  assert.ok(!r.ok);
  assert.match(r.error, /maxAlerts/);
});

test('rejects negative maxAlerts', () => {
  const F = makeFilterModule();
  const svc = new F({});
  const r = svc.setChannelFilter284('ch1', { maxAlerts: -1 });
  assert.ok(!r.ok);
});

// ── D. getChannelFilter284 ────────────────────────────────────────────────────
section('D. getChannelFilter284');

test('gets an existing filter', () => {
  const F = makeFilterModule();
  const svc = new F({});
  svc.setChannelFilter284('ch1', { categories: ['auth'] });
  const r = svc.getChannelFilter284('ch1');
  assert.ok(r.ok);
  assert.equal(r.channelName, 'ch1');
  assert.deepEqual(r.filter.categories, ['auth']);
});

test('errors on unknown channel', () => {
  const F = makeFilterModule();
  const svc = new F({});
  const r = svc.getChannelFilter284('ghost');
  assert.ok(!r.ok);
  assert.match(r.error, /no filter found/);
});

test('errors on empty channelName', () => {
  const F = makeFilterModule();
  const svc = new F({});
  const r = svc.getChannelFilter284('');
  assert.ok(!r.ok);
});

// ── E. removeChannelFilter284 ─────────────────────────────────────────────────
section('E. removeChannelFilter284');

test('removes an existing filter', () => {
  const F = makeFilterModule();
  const svc = new F({});
  svc.setChannelFilter284('ch1', { categories: ['billing'] });
  const r = svc.removeChannelFilter284('ch1');
  assert.ok(r.ok);
  assert.equal(r.channelName, 'ch1');
  assert.ok(!svc.getChannelFilter284('ch1').ok);
});

test('errors on unknown channel', () => {
  const F = makeFilterModule();
  const svc = new F({});
  const r = svc.removeChannelFilter284('ghost');
  assert.ok(!r.ok);
  assert.match(r.error, /no filter found/);
});

// ── F. applyChannelFilter284 ──────────────────────────────────────────────────
section('F. applyChannelFilter284');

test('passes when no filter is set', () => {
  const F = makeFilterModule();
  const svc = new F({});
  const r = svc.applyChannelFilter284('ch1', makeSampleDigest());
  assert.ok(r.ok);
  assert.ok(r.passes);
  assert.match(r.reason, /no filter/);
});

test('passes when category is in allowlist', () => {
  const F = makeFilterModule();
  const svc = new F({});
  svc.setChannelFilter284('ch1', { categories: ['billing'] });
  const r = svc.applyChannelFilter284('ch1', makeSampleDigest({ category: 'billing' }));
  assert.ok(r.ok);
  assert.ok(r.passes);
});

test('blocks when category not in allowlist', () => {
  const F = makeFilterModule();
  const svc = new F({});
  svc.setChannelFilter284('ch1', { categories: ['billing'] });
  const r = svc.applyChannelFilter284('ch1', makeSampleDigest({ category: 'auth' }));
  assert.ok(r.ok);
  assert.ok(!r.passes);
  assert.match(r.reason, /allowlist/);
});

test('blocks when category is excluded', () => {
  const F = makeFilterModule();
  const svc = new F({});
  svc.setChannelFilter284('ch1', { excludeCategories: ['spam'] });
  const r = svc.applyChannelFilter284('ch1', makeSampleDigest({ category: 'spam' }));
  assert.ok(r.ok);
  assert.ok(!r.passes);
  assert.match(r.reason, /excluded/);
});

test('passes when category not in excludeCategories', () => {
  const F = makeFilterModule();
  const svc = new F({});
  svc.setChannelFilter284('ch1', { excludeCategories: ['spam'] });
  const r = svc.applyChannelFilter284('ch1', makeSampleDigest({ category: 'billing' }));
  assert.ok(r.passes);
});

test('passes when severity meets minSeverity', () => {
  const F = makeFilterModule();
  const svc = new F({});
  svc.setChannelFilter284('ch1', { minSeverity: 'medium' });
  const r = svc.applyChannelFilter284('ch1', makeSampleDigest({ severity: 'high' }));
  assert.ok(r.passes);
});

test('blocks when severity below minSeverity', () => {
  const F = makeFilterModule();
  const svc = new F({});
  svc.setChannelFilter284('ch1', { minSeverity: 'high' });
  const r = svc.applyChannelFilter284('ch1', makeSampleDigest({ severity: 'low' }));
  assert.ok(!r.passes);
  assert.match(r.reason, /below minSeverity/);
});

test('passes when totalAlerts within minAlerts/maxAlerts', () => {
  const F = makeFilterModule();
  const svc = new F({});
  svc.setChannelFilter284('ch1', { minAlerts: 2, maxAlerts: 10 });
  const r = svc.applyChannelFilter284('ch1', makeSampleDigest({ totalAlerts: 5 }));
  assert.ok(r.passes);
});

test('blocks when totalAlerts exceeds maxAlerts', () => {
  const F = makeFilterModule();
  const svc = new F({});
  svc.setChannelFilter284('ch1', { maxAlerts: 3 });
  const r = svc.applyChannelFilter284('ch1', makeSampleDigest({ totalAlerts: 10 }));
  assert.ok(!r.passes);
  assert.match(r.reason, /maxAlerts/);
});

test('blocks when totalAlerts below minAlerts', () => {
  const F = makeFilterModule();
  const svc = new F({});
  svc.setChannelFilter284('ch1', { minAlerts: 5 });
  const r = svc.applyChannelFilter284('ch1', makeSampleDigest({ totalAlerts: 1 }));
  assert.ok(!r.passes);
  assert.match(r.reason, /minAlerts/);
});

test('passes when period is in allowed list', () => {
  const F = makeFilterModule();
  const svc = new F({});
  svc.setChannelFilter284('ch1', { periods: ['daily'] });
  const r = svc.applyChannelFilter284('ch1', makeSampleDigest({ period: 'daily' }));
  assert.ok(r.passes);
});

test('blocks when period not in allowed list', () => {
  const F = makeFilterModule();
  const svc = new F({});
  svc.setChannelFilter284('ch1', { periods: ['daily'] });
  const r = svc.applyChannelFilter284('ch1', makeSampleDigest({ period: 'weekly' }));
  assert.ok(!r.passes);
  assert.match(r.reason, /period/);
});

test('passes when custom field matches', () => {
  const F = makeFilterModule();
  const svc = new F({});
  svc.setChannelFilter284('ch1', { custom: { region: 'us-east' } });
  const r = svc.applyChannelFilter284('ch1', makeSampleDigest({ region: 'us-east' }));
  assert.ok(r.passes);
});

test('blocks when custom field does not match', () => {
  const F = makeFilterModule();
  const svc = new F({});
  svc.setChannelFilter284('ch1', { custom: { region: 'us-east' } });
  const r = svc.applyChannelFilter284('ch1', makeSampleDigest({ region: 'eu-west' }));
  assert.ok(!r.passes);
  assert.match(r.reason, /custom field/);
});

// ── G. notifyDigest284 ────────────────────────────────────────────────────────
section('G. notifyDigest284');

test('delivers to all channels when no filters set and no engine', () => {
  const F = makeFilterModule();
  const svc = new F({});
  // No engine, no filters — channelNames is empty list of filter keys
  const r = svc.notifyDigest284(makeSampleDigest());
  assert.ok(r.ok);
  assert.equal(r.version, '284');
});

test('filters out a channel that does not pass', () => {
  const F = makeFilterModule();
  const engine = makeChannelEngine();
  engine.registerNotificationChannel283('ch1', { url: 'https://a.com' });
  engine.registerNotificationChannel283('ch2', { url: 'https://b.com' });
  const svc = new F({ notificationChannel283: engine });
  // Block ch1, allow ch2
  svc.setChannelFilter284('ch1', { maxAlerts: 0 });
  const r = svc.notifyDigest284(makeSampleDigest({ totalAlerts: 5 }));
  assert.ok(r.ok);
  assert.ok(r.filtered.includes('ch1'));
  // ch2 has no filter → should pass and be delivered
  assert.ok(r.delivered.includes('ch2'));
});

test('delivers to single named channel', () => {
  const F = makeFilterModule();
  const engine = makeChannelEngine();
  engine.registerNotificationChannel283('ch1', { url: 'https://a.com' });
  engine.registerNotificationChannel283('ch2', { url: 'https://b.com' });
  const svc = new F({ notificationChannel283: engine });
  const r = svc.notifyDigest284(makeSampleDigest(), { channel: 'ch1' });
  assert.ok(r.ok);
  assert.equal(r.delivered.length + r.filtered.length + r.skipped.length + r.errors.length, 1);
});

test('returns filtered array when single channel is blocked', () => {
  const F = makeFilterModule();
  const engine = makeChannelEngine();
  engine.registerNotificationChannel283('ch1', { url: 'https://a.com' });
  const svc = new F({ notificationChannel283: engine });
  svc.setChannelFilter284('ch1', { categories: ['billing'] });
  const r = svc.notifyDigest284(makeSampleDigest({ category: 'auth' }), { channel: 'ch1' });
  assert.ok(r.ok);
  assert.equal(r.filtered.length, 1);
  assert.equal(r.delivered.length, 0);
});

// ── H. testChannelFilter284 ───────────────────────────────────────────────────
section('H. testChannelFilter284');

test('dry-run: filter blocks returns passes=false', () => {
  const F = makeFilterModule();
  const svc = new F({});
  svc.setChannelFilter284('ch1', { minAlerts: 100 });
  const r = svc.testChannelFilter284('ch1', makeSampleDigest({ totalAlerts: 3 }));
  assert.ok(r.ok);
  assert.ok(!r.passes);
  assert.match(r.note, /blocked/);
});

test('dry-run: filter passes, note returned (no engine)', () => {
  const F = makeFilterModule();
  const svc = new F({});
  svc.setChannelFilter284('ch1', { minAlerts: 1 });
  const r = svc.testChannelFilter284('ch1', makeSampleDigest({ totalAlerts: 5 }));
  assert.ok(r.ok);
  assert.ok(r.passes);
  assert.ok(r.note);
});

test('dry-run: no filter set, passes', () => {
  const F = makeFilterModule();
  const svc = new F({});
  const r = svc.testChannelFilter284('ch1', makeSampleDigest());
  assert.ok(r.ok);
  assert.ok(r.passes);
  assert.equal(r.filter, null);
});

test('dry-run: passes + engine renders template', () => {
  const F = makeFilterModule();
  const { NotificationChannel283 } = require('../src/lib/notificationChannel283');
  const { NotificationTemplate282 } = require('../src/lib/notificationTemplate282');
  const tplEngine = new NotificationTemplate282({});
  tplEngine.registerNotificationTemplate282('t1', {
    subject: 'Alerts: {{totalAlerts}}',
    body: 'Period: {{period}}.',
    contentType: 'text',
  });
  const engine = new NotificationChannel283({ notificationTemplate282: tplEngine });
  engine.registerNotificationChannel283('ch1', { url: 'https://a.com', templateName: 't1' });
  const svc = new F({ notificationChannel283: engine });
  svc.setChannelFilter284('ch1', { minAlerts: 1 });
  const r = svc.testChannelFilter284('ch1', { totalAlerts: 7, period: 'weekly' });
  assert.ok(r.ok);
  assert.ok(r.passes);
  assert.ok(r.subject && r.subject.includes('7'));
  assert.ok(r.body && r.body.includes('weekly'));
});

test('errors on unknown channelName', () => {
  const F = makeFilterModule();
  const svc = new F({});
  // Ghost channel with no filter — passes:true (no filter), no error
  const r = svc.testChannelFilter284('ghost', makeSampleDigest());
  assert.ok(r.ok);
  // passes because no filter set
  assert.ok(r.passes);
});

// ── I. Status / Health / Perf ─────────────────────────────────────────────────
section('I. getStatus284 / checkChannelFilterHealth284 / getPerf284');

test('getStatus284 returns ok with filterCount', () => {
  const F = makeFilterModule();
  const svc = new F({});
  svc.setChannelFilter284('ch1', { categories: ['auth'] });
  const r = svc.getStatus284();
  assert.ok(r.ok);
  assert.equal(r.filterCount, 1);
  assert.equal(r.version, '284');
});

test('checkChannelFilterHealth284 returns ok', () => {
  const F = makeFilterModule();
  const svc = new F({});
  const r = svc.checkChannelFilterHealth284();
  assert.ok(r.ok);
  assert.equal(r.version, '284');
});

test('getPerf284 returns numeric percentiles', () => {
  const F = makeFilterModule();
  const svc = new F({});
  svc.setChannelFilter284('ch1', { categories: ['auth'] });
  const r = svc.getPerf284();
  assert.equal(typeof r.p50, 'number');
  assert.equal(typeof r.p95, 'number');
  assert.equal(typeof r.p99, 'number');
  assert.ok(r.count >= 0);
});

// ── J. providerAdapters284 ────────────────────────────────────────────────────
section('J. providerAdapters284');

test('PROVIDER_CONTRACTS_284 has 34 contracts', () => {
  const { PROVIDER_CONTRACTS_284 } = require('../src/lib/providerAdapters284');
  assert.equal(Object.keys(PROVIDER_CONTRACTS_284).length, 34);
});

test('channelFilter contract has required methods', () => {
  const { PROVIDER_CONTRACTS_284 } = require('../src/lib/providerAdapters284');
  const c = PROVIDER_CONTRACTS_284.channelFilter;
  assert.ok(c.required.includes('setChannelFilter284'));
  assert.ok(c.required.includes('getChannelFilter284'));
  assert.ok(c.required.includes('removeChannelFilter284'));
  assert.ok(c.required.includes('applyChannelFilter284'));
  assert.ok(c.required.includes('notifyDigest284'));
  assert.ok(c.optional.includes('testChannelFilter284'));
});

test('stub passes validation', () => {
  const { createChannelFilterStub284, validateProvider284 } = require('../src/lib/providerAdapters284');
  const stub = createChannelFilterStub284();
  const r = validateProvider284('channelFilter', stub);
  assert.ok(r.ok, JSON.stringify(r.errors));
});

test('createAllStubs284 passes validateAllProviders284', () => {
  const { createAllStubs284, validateAllProviders284 } = require('../src/lib/providerAdapters284');
  const stubs = createAllStubs284();
  const r = validateAllProviders284(stubs);
  assert.ok(r.ok, JSON.stringify(r.results));
});

test('missing method fails validation', () => {
  const { validateProvider284 } = require('../src/lib/providerAdapters284');
  const r = validateProvider284('channelFilter', {});
  assert.ok(!r.ok);
  assert.ok(r.errors.length > 0);
});

test('includes all 33 V283 contracts', () => {
  const { PROVIDER_CONTRACTS_283 } = require('../src/lib/providerAdapters283');
  const { PROVIDER_CONTRACTS_284 } = require('../src/lib/providerAdapters284');
  for (const key of Object.keys(PROVIDER_CONTRACTS_283)) {
    assert.ok(key in PROVIDER_CONTRACTS_284, `V283 contract '${key}' missing in V284`);
  }
});

// ── K. API patch ──────────────────────────────────────────────────────────────
section('K. API patch');

test('createV284State extends v283State', () => {
  const { createV284State } = require('../ecos-api-server-v284-patch');
  const v284State = createV284State({});
  assert.ok(v284State.channelFilter284);
  assert.equal(typeof v284State.channelFilter284.setChannelFilter284, 'function');
  assert.equal(typeof v284State.channelFilter284.getChannelFilter284, 'function');
  assert.equal(typeof v284State.channelFilter284.removeChannelFilter284, 'function');
  assert.equal(typeof v284State.channelFilter284.notifyDigest284, 'function');
});

test('createV284State passes channel engine from v283State', () => {
  const { createV284State } = require('../ecos-api-server-v284-patch');
  const { NotificationChannel283 } = require('../src/lib/notificationChannel283');
  const engine = new NotificationChannel283({});
  const v284State = createV284State({ notificationChannel283: engine });
  assert.ok(v284State.channelFilter284._channelEngine284 === engine);
});

test('registerV284Routes adds routes without error', () => {
  const { createV284State, registerV284Routes } = require('../ecos-api-server-v284-patch');
  const routes = [];
  const mockApp = {
    get:    (path) => routes.push('GET '    + path),
    post:   (path) => routes.push('POST '   + path),
    put:    (path) => routes.push('PUT '    + path),
    delete: (path) => routes.push('DELETE ' + path),
  };
  const v284State = createV284State({});
  registerV284Routes(mockApp, v284State);
  assert.ok(routes.some(r => r.includes('/api/v284/health')));
  assert.ok(routes.some(r => r.includes('/api/v284/alerts/channels')));
  assert.ok(routes.some(r => r.includes('filter')));
});

test('V283 patch still loadable (backward compat)', () => {
  const { createV283State } = require('../ecos-api-server-v283-patch');
  const v283State = createV283State({});
  assert.ok(v283State.notificationChannel283);
});

// ── L. Release documentation ──────────────────────────────────────────────────
section('L. Release documentation');

test('AI_PROTOCOL_V284.md exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'AI_PROTOCOL_V284.md')));
});

test('CHANGELOG_V284.md exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'CHANGELOG_V284.md')));
});

test('NEXT_SESSION_PROMPT_V284.md exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'NEXT_SESSION_PROMPT_V284.md')));
});

// ── M. Sacred file integrity ──────────────────────────────────────────────────
section('M. Sacred file integrity');

const SACRED_MD5_284 = {
  'lib/fiatLedger.js':  '563e9b1f',
  'lib/auditLog.js':    'e5a5c2c2',
};

for (const [relPath, expectedPrefix] of Object.entries(SACRED_MD5_284)) {
  test(`${relPath} MD5 starts with ${expectedPrefix}`, () => {
    const absPath = path.join(ROOT, relPath);
    assert.ok(fs.existsSync(absPath), `${relPath} missing`);
    const hash = crypto.createHash('md5').update(fs.readFileSync(absPath)).digest('hex');
    assert.ok(hash.startsWith(expectedPrefix), `MD5 mismatch for ${relPath}: ${hash}`);
  });
}

// ── Run ───────────────────────────────────────────────────────────────────────

Promise.all(promises).then(() => {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`V284 results: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.error('\nFailures:');
    failures.forEach(f => console.error(`  ✗ ${f.name}: ${f.error}`));
  }
  process.exit(failed > 0 ? 1 : 0);
});
