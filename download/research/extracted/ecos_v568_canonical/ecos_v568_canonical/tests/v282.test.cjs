'use strict';
/**
 * tests/v282.test.cjs — ECOS V282 Test Suite
 *
 * Self-running suite covering:
 *   A. Version stamps (package.json, .agent-identity.json)
 *   B. New module files + lib mirrors
 *   C. registerNotificationTemplate282 — validation, registry
 *   D. deregisterNotificationTemplate282 — removal
 *   E. getTemplates282 / getTemplate282 — list and get
 *   F. renderTemplate282 — Mustache substitution
 *   G. previewTemplate282 — digest-to-context flattening
 *   H. getStatus282 + checkNotificationTemplateHealth282 + getPerf282
 *   I. providerAdapters282 (32 contracts, stub validation, pass/fail)
 *   J. API patch (createV282State, route registration, V281 backward compat)
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

function makeTemplateModule() {
  const { NotificationTemplate282 } = require('../src/lib/notificationTemplate282');
  return NotificationTemplate282;
}

function makeSampleDigest(overrides = {}) {
  return {
    ok:          true,
    digestId:    crypto.randomUUID(),
    version:     '279',
    period:      'scheduled',
    totalAlerts: 5,
    breached:    2,
    ts:          new Date().toISOString(),
    ...overrides,
  };
}

// ── A. Version stamps ──────────────────────────────────────────────────────────
section('A. Version stamps');

test('package.json version is 282.0.0', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '282.0.0');
});

test('.agent-identity.json ecosVersion is 282.0.0', () => {
  const id = JSON.parse(fs.readFileSync(path.join(ROOT, '.agent-identity.json'), 'utf8'));
  assert.equal(id.ecosVersion, '282.0.0');
});

// ── B. Module files + lib mirrors ─────────────────────────────────────────────
section('B. Module files + lib mirrors');

test('src/lib/notificationTemplate282.js exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'src/lib/notificationTemplate282.js')));
});

test('lib/notificationTemplate282.js exists (mirror)', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'lib/notificationTemplate282.js')));
});

test('src/lib/providerAdapters282.js exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'src/lib/providerAdapters282.js')));
});

test('lib/providerAdapters282.js exists (mirror)', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'lib/providerAdapters282.js')));
});

test('ecos-api-server-v282-patch.js exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'ecos-api-server-v282-patch.js')));
});

test('NotificationTemplate282 is a class', () => {
  const NotificationTemplate282 = makeTemplateModule();
  assert.equal(typeof NotificationTemplate282, 'function');
});

// ── C. registerNotificationTemplate282 ───────────────────────────────────────
section('C. registerNotificationTemplate282');

test('registers a valid template and returns ok', () => {
  const T = makeTemplateModule();
  const t = new T();
  const r = t.registerNotificationTemplate282('my-tmpl', { subject: 'Alert {{period}}', body: 'Total: {{totalAlerts}}' });
  assert.ok(r.ok);
  assert.equal(r.name, 'my-tmpl');
  assert.equal(r.contentType, 'text');
  assert.equal(r.version, '282');
});

test('rejects missing name', () => {
  const T = makeTemplateModule();
  const t = new T();
  const r = t.registerNotificationTemplate282('', { body: 'hello' });
  assert.equal(r.ok, false);
});

test('rejects missing body', () => {
  const T = makeTemplateModule();
  const t = new T();
  const r = t.registerNotificationTemplate282('no-body', {});
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('body'));
});

test('rejects duplicate template name', () => {
  const T = makeTemplateModule();
  const t = new T();
  t.registerNotificationTemplate282('dup', { body: 'x' });
  const r = t.registerNotificationTemplate282('dup', { body: 'y' });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('already registered'));
});

test('registers contentType json correctly', () => {
  const T = makeTemplateModule();
  const t = new T();
  const r = t.registerNotificationTemplate282('json-tmpl', { body: '{"alerts":{{totalAlerts}}}', contentType: 'json' });
  assert.ok(r.ok);
  assert.equal(r.contentType, 'json');
});

// ── D. deregisterNotificationTemplate282 ─────────────────────────────────────
section('D. deregisterNotificationTemplate282');

test('removes a registered template', () => {
  const T = makeTemplateModule();
  const t = new T();
  t.registerNotificationTemplate282('rem', { body: 'bye' });
  const r = t.deregisterNotificationTemplate282('rem');
  assert.ok(r.ok);
  assert.equal(r.name, 'rem');
  const list = t.getTemplates282();
  assert.equal(list.total, 0);
});

test('returns error for unknown template', () => {
  const T = makeTemplateModule();
  const t = new T();
  const r = t.deregisterNotificationTemplate282('ghost');
  assert.equal(r.ok, false);
});

// ── E. getTemplates282 / getTemplate282 ───────────────────────────────────────
section('E. getTemplates282 / getTemplate282');

test('lists all registered templates', () => {
  const T = makeTemplateModule();
  const t = new T();
  t.registerNotificationTemplate282('t1', { body: 'A' });
  t.registerNotificationTemplate282('t2', { body: 'B' });
  const list = t.getTemplates282();
  assert.ok(list.ok);
  assert.equal(list.total, 2);
  assert.equal(list.version, '282');
});

test('getTemplate282 returns correct template', () => {
  const T = makeTemplateModule();
  const t = new T();
  t.registerNotificationTemplate282('single', { body: 'hello {{name}}', subject: 'Hi' });
  const r = t.getTemplate282('single');
  assert.ok(r.ok);
  assert.equal(r.template.name, 'single');
  assert.equal(r.template.body, 'hello {{name}}');
});

test('getTemplate282 returns error for unknown template', () => {
  const T = makeTemplateModule();
  const t = new T();
  const r = t.getTemplate282('missing');
  assert.equal(r.ok, false);
});

// ── F. renderTemplate282 ──────────────────────────────────────────────────────
section('F. renderTemplate282 — Mustache substitution');

test('renders body with context values', () => {
  const T = makeTemplateModule();
  const t = new T();
  t.registerNotificationTemplate282('render-test', { body: 'Alerts: {{totalAlerts}}, Period: {{period}}' });
  const r = t.renderTemplate282('render-test', { totalAlerts: 7, period: 'hourly' });
  assert.ok(r.ok);
  assert.equal(r.body, 'Alerts: 7, Period: hourly');
});

test('renders subject with context values', () => {
  const T = makeTemplateModule();
  const t = new T();
  t.registerNotificationTemplate282('subj-test', { subject: 'Alert: {{period}}', body: 'body' });
  const r = t.renderTemplate282('subj-test', { period: 'daily' });
  assert.ok(r.ok);
  assert.equal(r.subject, 'Alert: daily');
});

test('unknown template vars render as empty string', () => {
  const T = makeTemplateModule();
  const t = new T();
  t.registerNotificationTemplate282('empty-var', { body: 'x={{unknown}}' });
  const r = t.renderTemplate282('empty-var', {});
  assert.ok(r.ok);
  assert.equal(r.body, 'x=');
});

test('returns error for unknown template name', () => {
  const T = makeTemplateModule();
  const t = new T();
  const r = t.renderTemplate282('nonexistent', {});
  assert.equal(r.ok, false);
});

test('preserves contentType in render result', () => {
  const T = makeTemplateModule();
  const t = new T();
  t.registerNotificationTemplate282('json-render', { body: '{}', contentType: 'json' });
  const r = t.renderTemplate282('json-render', {});
  assert.equal(r.contentType, 'json');
});

// ── G. previewTemplate282 ─────────────────────────────────────────────────────
section('G. previewTemplate282 — digest-to-context flattening');

test('preview renders template with sample digest', () => {
  const T = makeTemplateModule();
  const t = new T();
  t.registerNotificationTemplate282('prev', { body: 'Breached: {{breached}}, Total: {{totalAlerts}}', subject: 'Digest {{period}}' });
  const sample = makeSampleDigest({ totalAlerts: 10, breached: 3, period: 'daily' });
  const r = t.previewTemplate282('prev', sample);
  assert.ok(r.ok);
  assert.equal(r.body, 'Breached: 3, Total: 10');
  assert.equal(r.subject, 'Digest daily');
  assert.ok(r.sampleContext);
  assert.equal(r.sampleContext.totalAlerts, 10);
});

test('preview returns error for missing template', () => {
  const T = makeTemplateModule();
  const t = new T();
  const r = t.previewTemplate282('no-such', {});
  assert.equal(r.ok, false);
});

// ── H. Health + status + perf ─────────────────────────────────────────────────
section('H. getStatus282 + checkNotificationTemplateHealth282 + getPerf282');

test('getStatus282 returns correct templateCount', () => {
  const T = makeTemplateModule();
  const t = new T();
  t.registerNotificationTemplate282('st1', { body: 'x' });
  t.registerNotificationTemplate282('st2', { body: 'y' });
  const status = t.getStatus282();
  assert.ok(status.ok);
  assert.equal(status.version, '282');
  assert.equal(status.templateCount, 2);
});

test('checkNotificationTemplateHealth282 returns health object', () => {
  const T = makeTemplateModule();
  const t = new T();
  const h = t.checkNotificationTemplateHealth282();
  assert.ok(h.ok);
  assert.equal(h.version, '282');
  assert.ok('templateCount' in h);
});

test('getPerf282 returns latency structure', () => {
  const T = makeTemplateModule();
  const t = new T();
  const p = t.getPerf282();
  assert.ok('p50' in p && 'p95' in p && 'p99' in p && 'count' in p);
});

test('getPerf282 records latency after operations', () => {
  const T = makeTemplateModule();
  const t = new T();
  t.registerNotificationTemplate282('perf1', { body: 'x' });
  t.renderTemplate282('perf1', {});
  const p = t.getPerf282();
  assert.ok(p.count >= 1);
});

// ── I. providerAdapters282 ────────────────────────────────────────────────────
section('I. providerAdapters282 — 32 contracts');

test('PROVIDER_CONTRACTS_282 has 32 contracts', () => {
  const { PROVIDER_CONTRACTS_282 } = require('../src/lib/providerAdapters282');
  const count = Object.keys(PROVIDER_CONTRACTS_282).length;
  assert.equal(count, 32);
});

test('notificationTemplate contract has required methods', () => {
  const { PROVIDER_CONTRACTS_282 } = require('../src/lib/providerAdapters282');
  const contract = PROVIDER_CONTRACTS_282.notificationTemplate;
  assert.ok(contract);
  assert.ok(contract.required.includes('registerNotificationTemplate282'));
  assert.ok(contract.required.includes('deregisterNotificationTemplate282'));
  assert.ok(contract.required.includes('getTemplates282'));
  assert.ok(contract.required.includes('getTemplate282'));
  assert.ok(contract.required.includes('renderTemplate282'));
  assert.ok(contract.required.includes('getStatus282'));
});

test('validateProvider282 passes a valid notificationTemplate', () => {
  const { validateProvider282 } = require('../src/lib/providerAdapters282');
  const T = makeTemplateModule();
  const t = new T();
  const r = validateProvider282('notificationTemplate', t);
  assert.ok(r.ok);
  assert.equal(r.errors.length, 0);
});

test('validateProvider282 fails an empty object', () => {
  const { validateProvider282 } = require('../src/lib/providerAdapters282');
  const r = validateProvider282('notificationTemplate', {});
  assert.equal(r.ok, false);
  assert.ok(r.errors.length > 0);
});

test('createNotificationTemplateStub282 passes validation', () => {
  const { validateProvider282, createNotificationTemplateStub282 } = require('../src/lib/providerAdapters282');
  const stub = createNotificationTemplateStub282();
  const r = validateProvider282('notificationTemplate', stub);
  assert.ok(r.ok);
});

test('createAllStubs282 has notificationTemplate key', () => {
  const { createAllStubs282 } = require('../src/lib/providerAdapters282');
  const stubs = createAllStubs282();
  assert.ok('notificationTemplate' in stubs);
  assert.ok('digestScheduler' in stubs);    // V281 still present
  assert.ok('notificationChannel' in stubs); // V280 still present
});

// ── J. API patch ──────────────────────────────────────────────────────────────
section('J. API patch — createV282State + routes');

test('createV282State extends v281State with notificationTemplate282', () => {
  const { createV282State } = require('../ecos-api-server-v282-patch');
  const state = createV282State({});
  assert.ok(state.notificationTemplate282);
  assert.ok(typeof state.notificationTemplate282.registerNotificationTemplate282 === 'function');
});

test('registerV282Routes registers all expected routes', () => {
  const { createV282State, registerV282Routes } = require('../ecos-api-server-v282-patch');
  const registeredRoutes = [];
  const mockApp = {
    get:    (path) => registeredRoutes.push({ method: 'GET', path }),
    post:   (path) => registeredRoutes.push({ method: 'POST', path }),
    delete: (path) => registeredRoutes.push({ method: 'DELETE', path }),
  };
  const state = createV282State({});
  registerV282Routes(mockApp, state);
  const paths = registeredRoutes.map(r => r.path);
  assert.ok(paths.includes('/api/v282/health'));
  assert.ok(paths.includes('/api/v282/alerts/templates'));
  assert.ok(paths.includes('/api/v282/alerts/templates/:name'));
});

test('V281 backward compat: PROVIDER_CONTRACTS_281 still accessible from v282 adapters', () => {
  const { PROVIDER_CONTRACTS_281 } = require('../src/lib/providerAdapters282');
  assert.ok(PROVIDER_CONTRACTS_281);
  assert.equal(Object.keys(PROVIDER_CONTRACTS_281).length, 31);
});

// ── K. Release documentation ──────────────────────────────────────────────────
section('K. Release documentation');

test('CHANGELOG_V282.md exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'CHANGELOG_V282.md')));
});

test('AI_PROTOCOL_V282.md exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'AI_PROTOCOL_V282.md')));
});

test('NEXT_SESSION_PROMPT_V282.md exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'NEXT_SESSION_PROMPT_V282.md')));
});

test('CHANGELOG_V282.md mentions notificationTemplate', () => {
  const content = fs.readFileSync(path.join(ROOT, 'CHANGELOG_V282.md'), 'utf8');
  assert.ok(content.includes('notificationTemplate') || content.includes('NotificationTemplate'));
});

// ── L. Sacred file integrity ───────────────────────────────────────────────────
section('L. Sacred file integrity');

const SACRED_FILES = [
  { relPath: 'src/lib/fiatLedger.js',  md5: '563e9b1f' },
  { relPath: 'src/lib/auditLog.js',    md5: 'e5a5c2c2' },
];

for (const { relPath, md5 } of SACRED_FILES) {
  test(`${relPath} MD5 prefix matches ${md5}`, () => {
    const full = path.join(ROOT, relPath);
    assert.ok(fs.existsSync(full), `${relPath} does not exist`);
    const hash = crypto.createHash('md5').update(fs.readFileSync(full)).digest('hex');
    assert.ok(hash.startsWith(md5), `${relPath} MD5 mismatch: got ${hash.slice(0, 8)}, expected prefix ${md5}`);
  });
}

// ── Runner ────────────────────────────────────────────────────────────────────

async function run() {
  await Promise.all(promises);
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.error('\nFailed tests:');
    for (const f of failures) console.error(`  • ${f.name}: ${f.error}`);
    process.exitCode = 1;
  } else {
    console.log('✅ All V282 tests passed');
  }
}

run();
