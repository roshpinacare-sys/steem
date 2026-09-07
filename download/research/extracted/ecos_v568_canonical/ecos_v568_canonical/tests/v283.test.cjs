'use strict';
/**
 * tests/v283.test.cjs — ECOS V283 Test Suite
 *
 * Self-running suite covering:
 *   A. Version stamps (package.json, .agent-identity.json)
 *   B. New module files + lib mirrors
 *   C. registerNotificationChannel283 — validation, registry
 *   D. deregisterNotificationChannel283 — removal
 *   E. getChannels283 / getChannel283 — list and get
 *   F. setChannelTemplate283 / unsetChannelTemplate283 — binding
 *   G. notifyDigest283 — delivery with and without template
 *   H. testChannel283 — dry-run with template rendering
 *   I. getStatus283 + checkNotificationChannelHealth283 + getPerf283
 *   J. providerAdapters283 (33 contracts, stub validation, pass/fail)
 *   K. API patch (createV283State, route registration, V282 backward compat)
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

function makeChannelModule() {
  const { NotificationChannel283 } = require('../src/lib/notificationChannel283');
  return NotificationChannel283;
}

function makeTemplateEngine() {
  const { NotificationTemplate282 } = require('../src/lib/notificationTemplate282');
  const engine = new NotificationTemplate282({});
  engine.registerNotificationTemplate282('t1', {
    subject: 'Alert: {{totalAlerts}}',
    body: 'There are {{totalAlerts}} alerts. Period: {{period}}.',
    contentType: 'text',
  });
  return engine;
}

function makeSampleDigest(overrides = {}) {
  return {
    ok:          true,
    digestId:    crypto.randomUUID(),
    version:     '283',
    period:      'scheduled',
    totalAlerts: 5,
    breached:    2,
    ts:          new Date().toISOString(),
    ...overrides,
  };
}

// ── A. Version stamps ──────────────────────────────────────────────────────────
section('A. Version stamps');

test('package.json version is 283.0.0', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '283.0.0');
});

test('.agent-identity.json ecosVersion is 283.0.0', () => {
  const id = JSON.parse(fs.readFileSync(path.join(ROOT, '.agent-identity.json'), 'utf8'));
  assert.equal(id.ecosVersion, '283.0.0');
});

// ── B. Module files + lib mirrors ─────────────────────────────────────────────
section('B. Module files + lib mirrors');

test('src/lib/notificationChannel283.js exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'src/lib/notificationChannel283.js')));
});

test('lib/notificationChannel283.js exists (mirror)', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'lib/notificationChannel283.js')));
});

test('src/lib/providerAdapters283.js exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'src/lib/providerAdapters283.js')));
});

test('lib/providerAdapters283.js exists (mirror)', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'lib/providerAdapters283.js')));
});

test('ecos-api-server-v283-patch.js exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'ecos-api-server-v283-patch.js')));
});

// ── C. registerNotificationChannel283 ─────────────────────────────────────────
section('C. registerNotificationChannel283');

test('registers a valid channel', () => {
  const C = makeChannelModule();
  const svc = new C({});
  const r = svc.registerNotificationChannel283('ch1', { url: 'https://example.com/hook' });
  assert.ok(r.ok);
  assert.equal(r.name, 'ch1');
  assert.equal(r.templateName, null);
  assert.equal(r.version, '283');
});

test('registers a channel with templateName', () => {
  const C = makeChannelModule();
  const svc = new C({});
  const r = svc.registerNotificationChannel283('ch2', { url: 'https://example.com/hook', templateName: 'myTpl' });
  assert.ok(r.ok);
  assert.equal(r.templateName, 'myTpl');
});

test('rejects duplicate name', () => {
  const C = makeChannelModule();
  const svc = new C({});
  svc.registerNotificationChannel283('ch1', { url: 'https://a.com' });
  const r = svc.registerNotificationChannel283('ch1', { url: 'https://b.com' });
  assert.ok(!r.ok);
  assert.match(r.error, /already registered/);
});

test('rejects missing url', () => {
  const C = makeChannelModule();
  const svc = new C({});
  const r = svc.registerNotificationChannel283('ch1', {});
  assert.ok(!r.ok);
  assert.match(r.error, /url/);
});

test('rejects empty name', () => {
  const C = makeChannelModule();
  const svc = new C({});
  const r = svc.registerNotificationChannel283('', { url: 'https://x.com' });
  assert.ok(!r.ok);
});

// ── D. deregisterNotificationChannel283 ───────────────────────────────────────
section('D. deregisterNotificationChannel283');

test('removes existing channel', () => {
  const C = makeChannelModule();
  const svc = new C({});
  svc.registerNotificationChannel283('ch1', { url: 'https://a.com' });
  const r = svc.deregisterNotificationChannel283('ch1');
  assert.ok(r.ok);
  assert.equal(r.name, 'ch1');
});

test('errors on unknown channel', () => {
  const C = makeChannelModule();
  const svc = new C({});
  const r = svc.deregisterNotificationChannel283('ghost');
  assert.ok(!r.ok);
  assert.match(r.error, /not found/);
});

// ── E. getChannels283 / getChannel283 ─────────────────────────────────────────
section('E. getChannels283 / getChannel283');

test('lists all channels', () => {
  const C = makeChannelModule();
  const svc = new C({});
  svc.registerNotificationChannel283('a', { url: 'https://a.com' });
  svc.registerNotificationChannel283('b', { url: 'https://b.com' });
  const r = svc.getChannels283();
  assert.ok(r.ok);
  assert.equal(r.total, 2);
  assert.equal(r.channels.length, 2);
});

test('gets a single channel', () => {
  const C = makeChannelModule();
  const svc = new C({});
  svc.registerNotificationChannel283('ch1', { url: 'https://a.com' });
  const r = svc.getChannel283('ch1');
  assert.ok(r.ok);
  assert.equal(r.channel.name, 'ch1');
  assert.equal(r.channel.url, 'https://a.com');
});

test('errors on unknown channel', () => {
  const C = makeChannelModule();
  const svc = new C({});
  const r = svc.getChannel283('nope');
  assert.ok(!r.ok);
});

// ── F. setChannelTemplate283 / unsetChannelTemplate283 ────────────────────────
section('F. setChannelTemplate283 / unsetChannelTemplate283');

test('binds a template to a channel', () => {
  const C = makeChannelModule();
  const svc = new C({});
  svc.registerNotificationChannel283('ch1', { url: 'https://a.com' });
  const r = svc.setChannelTemplate283('ch1', 'myTpl');
  assert.ok(r.ok);
  assert.equal(r.templateName, 'myTpl');
  assert.equal(svc.getChannel283('ch1').channel.templateName, 'myTpl');
});

test('rejects binding to unknown channel', () => {
  const C = makeChannelModule();
  const svc = new C({});
  const r = svc.setChannelTemplate283('ghost', 'tpl');
  assert.ok(!r.ok);
});

test('rejects empty templateName', () => {
  const C = makeChannelModule();
  const svc = new C({});
  svc.registerNotificationChannel283('ch1', { url: 'https://a.com' });
  const r = svc.setChannelTemplate283('ch1', '');
  assert.ok(!r.ok);
});

test('unbinds a template', () => {
  const C = makeChannelModule();
  const svc = new C({});
  svc.registerNotificationChannel283('ch1', { url: 'https://a.com', templateName: 'tpl' });
  const r = svc.unsetChannelTemplate283('ch1');
  assert.ok(r.ok);
  assert.equal(svc.getChannel283('ch1').channel.templateName, null);
});

test('errors unset on unknown channel', () => {
  const C = makeChannelModule();
  const svc = new C({});
  const r = svc.unsetChannelTemplate283('ghost');
  assert.ok(!r.ok);
});

// ── G. notifyDigest283 ────────────────────────────────────────────────────────
section('G. notifyDigest283');

test('delivers to all channels (no template)', () => {
  const C = makeChannelModule();
  const svc = new C({});
  svc.registerNotificationChannel283('a', { url: 'https://a.com' });
  svc.registerNotificationChannel283('b', { url: 'https://b.com' });
  const r = svc.notifyDigest283(makeSampleDigest());
  assert.ok(r.ok);
  assert.equal(r.delivered.length, 2);
  assert.equal(r.errors.length, 0);
});

test('delivers to single named channel', () => {
  const C = makeChannelModule();
  const svc = new C({});
  svc.registerNotificationChannel283('a', { url: 'https://a.com' });
  svc.registerNotificationChannel283('b', { url: 'https://b.com' });
  const r = svc.notifyDigest283(makeSampleDigest(), { channel: 'a' });
  assert.ok(r.ok);
  assert.equal(r.delivered.length, 1);
  assert.equal(r.delivered[0], 'a');
});

test('renders template when bound + engine present', () => {
  const C = makeChannelModule();
  const engine = makeTemplateEngine();
  const svc = new C({ notificationTemplate282: engine });
  svc.registerNotificationChannel283('ch1', { url: 'https://a.com', templateName: 't1' });
  const r = svc.notifyDigest283({ totalAlerts: 3, period: 'daily' });
  assert.ok(r.ok);
  assert.equal(r.delivered.length, 1);
});

test('skips channel on unknown template', () => {
  const C = makeChannelModule();
  const engine = makeTemplateEngine();
  const svc = new C({ notificationTemplate282: engine });
  svc.registerNotificationChannel283('ch1', { url: 'https://a.com', templateName: 'missing' });
  const r = svc.notifyDigest283({});
  assert.ok(r.ok);
  assert.equal(r.delivered.length, 0);
  assert.equal(r.skipped.length, 1);
});

// ── H. testChannel283 ─────────────────────────────────────────────────────────
section('H. testChannel283');

test('dry-run with no template returns note', () => {
  const C = makeChannelModule();
  const svc = new C({});
  svc.registerNotificationChannel283('ch1', { url: 'https://a.com' });
  const r = svc.testChannel283('ch1', makeSampleDigest());
  assert.ok(r.ok);
  assert.equal(r.templateName, null);
  assert.ok(r.note);
});

test('dry-run renders template', () => {
  const C = makeChannelModule();
  const engine = makeTemplateEngine();
  const svc = new C({ notificationTemplate282: engine });
  svc.registerNotificationChannel283('ch1', { url: 'https://a.com', templateName: 't1' });
  const r = svc.testChannel283('ch1', { totalAlerts: 7, period: 'weekly' });
  assert.ok(r.ok);
  assert.ok(r.subject.includes('7'));
  assert.ok(r.body.includes('weekly'));
});

test('errors on unknown channel', () => {
  const C = makeChannelModule();
  const svc = new C({});
  const r = svc.testChannel283('ghost', {});
  assert.ok(!r.ok);
});

// ── I. Status / Health / Perf ─────────────────────────────────────────────────
section('I. getStatus283 / checkNotificationChannelHealth283 / getPerf283');

test('getStatus283 returns ok with counts', () => {
  const C = makeChannelModule();
  const svc = new C({});
  svc.registerNotificationChannel283('ch1', { url: 'https://a.com' });
  const r = svc.getStatus283();
  assert.ok(r.ok);
  assert.equal(r.channelCount, 1);
  assert.equal(r.version, '283');
});

test('checkNotificationChannelHealth283 returns ok', () => {
  const C = makeChannelModule();
  const svc = new C({});
  const r = svc.checkNotificationChannelHealth283();
  assert.ok(r.ok);
  assert.equal(r.version, '283');
});

test('getPerf283 returns numeric percentiles', () => {
  const C = makeChannelModule();
  const svc = new C({});
  svc.registerNotificationChannel283('ch1', { url: 'https://a.com' });
  const r = svc.getPerf283();
  assert.equal(typeof r.p50, 'number');
  assert.equal(typeof r.p95, 'number');
  assert.equal(typeof r.p99, 'number');
  assert.ok(r.count >= 0);
});

// ── J. providerAdapters283 ────────────────────────────────────────────────────
section('J. providerAdapters283');

test('PROVIDER_CONTRACTS_283 has 33 contracts', () => {
  const { PROVIDER_CONTRACTS_283 } = require('../src/lib/providerAdapters283');
  assert.equal(Object.keys(PROVIDER_CONTRACTS_283).length, 33);
});

test('notificationChannel contract has required methods', () => {
  const { PROVIDER_CONTRACTS_283 } = require('../src/lib/providerAdapters283');
  const c = PROVIDER_CONTRACTS_283.templateBoundChannel;
  assert.ok(c.required.includes('registerNotificationChannel283'));
  assert.ok(c.required.includes('notifyDigest283'));
  assert.ok(c.optional.includes('testChannel283'));
});

test('stub passes validation', () => {
  const { createTemplateBoundChannelStub283, validateProvider283 } = require('../src/lib/providerAdapters283');
  const stub = createTemplateBoundChannelStub283();
  const r = validateProvider283('templateBoundChannel', stub);
  assert.ok(r.ok);
});

test('createAllStubs283 passes validateAllProviders283', () => {
  const { createAllStubs283, validateAllProviders283 } = require('../src/lib/providerAdapters283');
  const stubs = createAllStubs283();
  const r = validateAllProviders283(stubs);
  assert.ok(r.ok, JSON.stringify(r.results));
});

test('missing method fails validation', () => {
  const { validateProvider283 } = require('../src/lib/providerAdapters283');
  const r = validateProvider283('templateBoundChannel', {});
  assert.ok(!r.ok);
  assert.ok(r.errors.length > 0);
});

// ── K. API patch ──────────────────────────────────────────────────────────────
section('K. API patch');

test('createV283State extends v282State', () => {
  const { createV283State } = require('../ecos-api-server-v283-patch');
  const v283State = createV283State({});
  assert.ok(v283State.notificationChannel283);
  assert.equal(typeof v283State.notificationChannel283.registerNotificationChannel283, 'function');
});

test('createV283State passes template engine from v282State', () => {
  const { createV283State } = require('../ecos-api-server-v283-patch');
  const { NotificationTemplate282 } = require('../src/lib/notificationTemplate282');
  const tplEngine = new NotificationTemplate282({});
  const v283State = createV283State({ notificationTemplate282: tplEngine });
  // The channel service should have access to the template engine
  assert.ok(v283State.notificationChannel283._templateEngine283 === tplEngine);
});

test('registerV283Routes adds routes without error', () => {
  const { createV283State, registerV283Routes } = require('../ecos-api-server-v283-patch');
  const routes = [];
  const mockApp = {
    get:    (path) => routes.push('GET ' + path),
    post:   (path) => routes.push('POST ' + path),
    put:    (path) => routes.push('PUT ' + path),
    delete: (path) => routes.push('DELETE ' + path),
  };
  const v283State = createV283State({});
  registerV283Routes(mockApp, v283State);
  assert.ok(routes.some(r => r.includes('/api/v283/health')));
  assert.ok(routes.some(r => r.includes('/api/v283/alerts/channels')));
});

// ── L. Release documentation ──────────────────────────────────────────────────
section('L. Release documentation');

test('AI_PROTOCOL_V283.md exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'AI_PROTOCOL_V283.md')));
});

test('CHANGELOG_V283.md exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'CHANGELOG_V283.md')));
});

test('NEXT_SESSION_PROMPT_V283.md exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'NEXT_SESSION_PROMPT_V283.md')));
});

// ── M. Sacred file integrity ──────────────────────────────────────────────────
section('M. Sacred file integrity');

const SACRED_MD5_283 = {
  'lib/fiatLedger.js':  '563e9b1f',
  'lib/auditLog.js':    'e5a5c2c2',
};

for (const [relPath, expectedPrefix] of Object.entries(SACRED_MD5_283)) {
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
  console.log(`V283 results: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.error('\nFailures:');
    failures.forEach(f => console.error(`  ✗ ${f.name}: ${f.error}`));
  }
  process.exit(failed > 0 ? 1 : 0);
});
