'use strict';
/**
 * tests/v285.test.cjs — ECOS V285 Test Suite
 *
 * Self-running suite covering:
 *   A. Version stamps (package.json, .agent-identity.json)
 *   B. New module files + lib mirrors
 *   C. registerFilterPreset285 — validation, creation, replacement
 *   D. getFilterPreset285 — retrieval, not-found
 *   E. listFilterPresets285 — empty and populated
 *   F. removeFilterPreset285 — removal, not-found
 *   G. applyFilterPreset285 — no channelFilter wired, with channelFilter wired, preset not found
 *   H. getStatus285 + checkFilterPresetHealth285 + getPerf285
 *   I. providerAdapters285 (35 contracts, stub validation, pass/fail)
 *   J. API patch (createV285State, route registration, V284 backward compat)
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

function makePresetsModule() {
  const { FilterPresets285 } = require('../src/lib/filterPresets285');
  return FilterPresets285;
}

function makeChannelFilterModule() {
  const { ChannelFilter284 } = require('../src/lib/notificationChannelFilter284');
  return new ChannelFilter284({});
}

function makePresets(opts = {}) {
  const FilterPresets285 = makePresetsModule();
  return new FilterPresets285(opts);
}

// ── A. Version stamps ──────────────────────────────────────────────────────────
section('A. Version stamps');

test('package.json version is 285.0.0', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '285.0.0');
});

test('.agent-identity.json ecosVersion is 285.0.0', () => {
  const id = JSON.parse(fs.readFileSync(path.join(ROOT, '.agent-identity.json'), 'utf8'));
  assert.equal(id.ecosVersion, '285.0.0');
});

// ── B. Module files ────────────────────────────────────────────────────────────
section('B. Module files + lib mirrors');

test('src/lib/filterPresets285.js exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'src/lib/filterPresets285.js')));
});

test('lib/filterPresets285.js (mirror) exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'lib/filterPresets285.js')));
});

test('src/lib/providerAdapters285.js exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'src/lib/providerAdapters285.js')));
});

test('lib/providerAdapters285.js (mirror) exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'lib/providerAdapters285.js')));
});

test('ecos-api-server-v285-patch.js exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'ecos-api-server-v285-patch.js')));
});

// ── C. registerFilterPreset285 ─────────────────────────────────────────────────
section('C. registerFilterPreset285');

test('registers a valid preset', () => {
  const fp = makePresets();
  const r = fp.registerFilterPreset285('billing-high', { categories: ['billing'], minSeverity: 'high' });
  assert.equal(r.ok, true);
  assert.equal(r.presetName, 'billing-high');
  assert.equal(r.version, '285');
  assert.deepEqual(r.preset.categories, ['billing']);
  assert.equal(r.preset.minSeverity, 'high');
});

test('replaces an existing preset', () => {
  const fp = makePresets();
  fp.registerFilterPreset285('mypreset', { minSeverity: 'low' });
  const r = fp.registerFilterPreset285('mypreset', { minSeverity: 'critical' });
  assert.equal(r.ok, true);
  assert.equal(r.preset.minSeverity, 'critical');
});

test('rejects empty presetName', () => {
  const fp = makePresets();
  const r = fp.registerFilterPreset285('', {});
  assert.equal(r.ok, false);
  assert.match(r.error, /presetName/);
});

test('rejects invalid minSeverity', () => {
  const fp = makePresets();
  const r = fp.registerFilterPreset285('bad', { minSeverity: 'extreme' });
  assert.equal(r.ok, false);
  assert.match(r.error, /minSeverity/);
});

test('rejects categories that are not array', () => {
  const fp = makePresets();
  const r = fp.registerFilterPreset285('bad2', { categories: 'billing' });
  assert.equal(r.ok, false);
});

test('registers preset with all fields', () => {
  const fp = makePresets();
  const r = fp.registerFilterPreset285('full', {
    categories: ['a', 'b'],
    excludeCategories: ['c'],
    minSeverity: 'medium',
    maxAlerts: 100,
    minAlerts: 1,
    periods: ['daily', 'weekly'],
    custom: { env: 'prod' },
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.preset.periods, ['daily', 'weekly']);
  assert.deepEqual(r.preset.custom, { env: 'prod' });
});

// ── D. getFilterPreset285 ──────────────────────────────────────────────────────
section('D. getFilterPreset285');

test('retrieves a registered preset', () => {
  const fp = makePresets();
  fp.registerFilterPreset285('p1', { minSeverity: 'high' });
  const r = fp.getFilterPreset285('p1');
  assert.equal(r.ok, true);
  assert.equal(r.presetName, 'p1');
  assert.equal(r.preset.minSeverity, 'high');
});

test('returns error for unknown preset', () => {
  const fp = makePresets();
  const r = fp.getFilterPreset285('nope');
  assert.equal(r.ok, false);
  assert.match(r.error, /no preset/);
});

test('rejects empty presetName', () => {
  const fp = makePresets();
  const r = fp.getFilterPreset285('');
  assert.equal(r.ok, false);
});

// ── E. listFilterPresets285 ────────────────────────────────────────────────────
section('E. listFilterPresets285');

test('returns empty list initially', () => {
  const fp = makePresets();
  const r = fp.listFilterPresets285();
  assert.equal(r.ok, true);
  assert.equal(r.count, 0);
  assert.deepEqual(r.presets, []);
});

test('lists all registered presets', () => {
  const fp = makePresets();
  fp.registerFilterPreset285('p1', { minSeverity: 'low' });
  fp.registerFilterPreset285('p2', { minSeverity: 'high' });
  const r = fp.listFilterPresets285();
  assert.equal(r.ok, true);
  assert.equal(r.count, 2);
  assert.equal(r.presets.length, 2);
});

// ── F. removeFilterPreset285 ───────────────────────────────────────────────────
section('F. removeFilterPreset285');

test('removes an existing preset', () => {
  const fp = makePresets();
  fp.registerFilterPreset285('del-me', { minSeverity: 'low' });
  const r = fp.removeFilterPreset285('del-me');
  assert.equal(r.ok, true);
  assert.equal(r.presetName, 'del-me');
});

test('preset gone after removal', () => {
  const fp = makePresets();
  fp.registerFilterPreset285('del-me2', { minSeverity: 'low' });
  fp.removeFilterPreset285('del-me2');
  const r = fp.getFilterPreset285('del-me2');
  assert.equal(r.ok, false);
});

test('returns error for unknown preset', () => {
  const fp = makePresets();
  const r = fp.removeFilterPreset285('ghost');
  assert.equal(r.ok, false);
});

// ── G. applyFilterPreset285 ────────────────────────────────────────────────────
section('G. applyFilterPreset285');

test('errors when no channelFilter284 wired', () => {
  const fp = makePresets(); // no channelFilter wired
  fp.registerFilterPreset285('p', { minSeverity: 'low' });
  const r = fp.applyFilterPreset285('mychannel', 'p');
  assert.equal(r.ok, false);
  assert.match(r.error, /channelFilter284/);
});

test('errors when preset not found', () => {
  const cf = makeChannelFilterModule();
  const fp = makePresets({ channelFilter284: cf });
  const r = fp.applyFilterPreset285('mychannel', 'nonexistent');
  assert.equal(r.ok, false);
  assert.match(r.error, /no preset/);
});

test('applies preset to channel via V284 engine', () => {
  const cf = makeChannelFilterModule();
  const fp = makePresets({ channelFilter284: cf });
  fp.registerFilterPreset285('billing', { categories: ['billing'], minSeverity: 'high' });
  const r = fp.applyFilterPreset285('alerts-channel', 'billing');
  assert.equal(r.ok, true);
  assert.equal(r.channelName, 'alerts-channel');
  assert.equal(r.presetName, 'billing');
  assert.ok(r.filter);
  // Verify the channel now has the filter applied
  const check = cf.getChannelFilter284('alerts-channel');
  assert.equal(check.ok, true);
  assert.deepEqual(check.filter.categories, ['billing']);
});

test('apply returns channelName and presetName', () => {
  const cf = makeChannelFilterModule();
  const fp = makePresets({ channelFilter284: cf });
  fp.registerFilterPreset285('pp', { minSeverity: 'critical' });
  const r = fp.applyFilterPreset285('ch', 'pp');
  assert.equal(r.channelName, 'ch');
  assert.equal(r.presetName, 'pp');
  assert.equal(r.version, '285');
});

// ── H. Status + Health + Perf ──────────────────────────────────────────────────
section('H. getStatus285 + checkFilterPresetHealth285 + getPerf285');

test('getStatus285 returns ok + version + presetCount', () => {
  const fp = makePresets();
  fp.registerFilterPreset285('s1', { minSeverity: 'low' });
  const r = fp.getStatus285();
  assert.equal(r.ok, true);
  assert.equal(r.version, '285');
  assert.equal(r.presetCount, 1);
});

test('checkFilterPresetHealth285 returns ok', () => {
  const fp = makePresets();
  const r = fp.checkFilterPresetHealth285();
  assert.equal(r.ok, true);
  assert.equal(r.version, '285');
});

test('getPerf285 returns perf shape', () => {
  const fp = makePresets();
  fp.registerFilterPreset285('perf', { minSeverity: 'low' });
  const p = fp.getPerf285();
  assert.ok('p50' in p && 'p95' in p && 'p99' in p && 'count' in p);
  assert.ok(p.count >= 1);
});

// ── I. providerAdapters285 ─────────────────────────────────────────────────────
section('I. providerAdapters285 (35 contracts)');

test('PROVIDER_CONTRACTS_285 has 35 contracts', () => {
  const { PROVIDER_CONTRACTS_285 } = require('../src/lib/providerAdapters285');
  assert.equal(Object.keys(PROVIDER_CONTRACTS_285).length, 35);
});

test('filterPresets contract has all required methods', () => {
  const { PROVIDER_CONTRACTS_285 } = require('../src/lib/providerAdapters285');
  const c = PROVIDER_CONTRACTS_285.filterPresets;
  assert.ok(c.required.includes('registerFilterPreset285'));
  assert.ok(c.required.includes('listFilterPresets285'));
  assert.ok(c.required.includes('applyFilterPreset285'));
});

test('validateProvider285 passes a valid filterPresets stub', () => {
  const { validateProvider285, createFilterPresetsStub285 } = require('../src/lib/providerAdapters285');
  const stub = createFilterPresetsStub285();
  const r = validateProvider285('filterPresets', stub);
  assert.equal(r.ok, true);
  assert.equal(r.errors.length, 0);
});

test('validateProvider285 fails missing method', () => {
  const { validateProvider285 } = require('../src/lib/providerAdapters285');
  const r = validateProvider285('filterPresets', {});
  assert.equal(r.ok, false);
  assert.ok(r.errors.length > 0);
});

test('createAllStubs285 includes filterPresets stub', () => {
  const { createAllStubs285 } = require('../src/lib/providerAdapters285');
  const stubs = createAllStubs285();
  assert.ok('filterPresets' in stubs);
  assert.equal(typeof stubs.filterPresets.registerFilterPreset285, 'function');
});

// ── J. API patch ───────────────────────────────────────────────────────────────
section('J. API patch');

test('createV285State exports a function', () => {
  const { createV285State } = require('../ecos-api-server-v285-patch');
  assert.equal(typeof createV285State, 'function');
});

test('registerV285Routes exports a function', () => {
  const { registerV285Routes } = require('../ecos-api-server-v285-patch');
  assert.equal(typeof registerV285Routes, 'function');
});

test('createV285State returns filterPresets285 instance', () => {
  const { createV285State } = require('../ecos-api-server-v285-patch');
  const state = createV285State({}, {});
  assert.ok(state.filterPresets285);
  assert.equal(typeof state.filterPresets285.registerFilterPreset285, 'function');
});

test('registerV285Routes registers routes without throwing', () => {
  const { createV285State, registerV285Routes } = require('../ecos-api-server-v285-patch');
  const state = createV285State({}, {});
  const routes = {};
  const app = {
    get:    (path, fn) => { routes[`GET ${path}`] = fn; },
    post:   (path, fn) => { routes[`POST ${path}`] = fn; },
    put:    (path, fn) => { routes[`PUT ${path}`] = fn; },
    delete: (path, fn) => { routes[`DELETE ${path}`] = fn; },
  };
  assert.doesNotThrow(() => registerV285Routes(app, state));
  assert.ok(`GET /api/v285/health` in routes);
  assert.ok(`GET /api/v285/alerts/filters/presets` in routes);
  assert.ok(`POST /api/v285/alerts/filters/presets` in routes);
  assert.ok(`DELETE /api/v285/alerts/filters/presets/:name` in routes);
  assert.ok(`POST /api/v285/alerts/channels/:name/filter/preset` in routes);
});

// ── K. Release documentation ───────────────────────────────────────────────────
section('K. Release documentation');

test('CHANGELOG_V285.md exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'CHANGELOG_V285.md')));
});

test('AI_PROTOCOL_V285.md exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'AI_PROTOCOL_V285.md')));
});

test('NEXT_SESSION_PROMPT_V285.md exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'NEXT_SESSION_PROMPT_V285.md')));
});

// ── L. Sacred file integrity ───────────────────────────────────────────────────
section('L. Sacred file integrity');

const SACRED_MD5 = {
  'lib/fiatLedger.js': '563e9b1f',
  'lib/auditLog.js':   'e5a5c2c2',
};

for (const [rel, prefix] of Object.entries(SACRED_MD5)) {
  test(`${rel} MD5 starts with ${prefix}`, () => {
    const content = fs.readFileSync(path.join(ROOT, rel));
    const md5 = crypto.createHash('md5').update(content).digest('hex');
    assert.ok(
      md5.startsWith(prefix),
      `Expected MD5 of ${rel} to start with ${prefix}, got ${md5}`
    );
  });
}

// ── Final report ───────────────────────────────────────────────────────────────

Promise.all(promises).then(() => {
  console.log(`\n── Summary: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.error('\nFailures:');
    for (const f of failures) console.error(`  ✗ ${f.name}: ${f.error}`);
    process.exit(1);
  }
  process.exit(0);
});
