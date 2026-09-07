'use strict';
/**
 * tests/v286.test.cjs — ECOS V286 Test Suite
 *
 * Self-running suite covering:
 *   A. Version stamps (package.json, .agent-identity.json)
 *   B. New module files + lib mirrors
 *   C. createPresetGroup286 — validation, creation, replacement, deduplication
 *   D. getPresetGroup286 — retrieval, not-found
 *   E. listPresetGroups286 — empty and populated
 *   F. removePresetGroup286 — removal, not-found
 *   G. applyPresetGroup286 — no filterPresets285 wired, group not found, full apply, partial fail
 *   H. getStatus286 + checkPresetGroupHealth286 + getPerf286
 *   I. providerAdapters286 (36 contracts, stub validation, pass/fail)
 *   J. API patch (createV286State, route registration, V285 backward compat)
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

function makePresetGroupsModule() {
  const { PresetGroups286 } = require('../src/lib/presetGroups286');
  return PresetGroups286;
}

function makeGroups(opts = {}) {
  const PresetGroups286 = makePresetGroupsModule();
  return new PresetGroups286(opts);
}

/** Make a minimal filterPresets285 stub that always succeeds apply */
function makeFilterPresetsStub285() {
  const store = new Map();
  return {
    registerFilterPreset285: (name, opts) => { store.set(name, opts); return { ok: true, version: '285' }; },
    applyFilterPreset285: (channelName, presetName) => {
      if (!store.has(presetName)) return { ok: false, error: `no preset found: '${presetName}'`, version: '285' };
      return { ok: true, channelName, presetName, version: '285' };
    },
    getStatus285: () => ({ ok: true, version: '285', presetCount: store.size }),
  };
}

/** Make filterPresets285 that always fails apply */
function makeFailingFilterPresetsStub285() {
  return {
    registerFilterPreset285: () => ({ ok: true, version: '285' }),
    applyFilterPreset285: () => ({ ok: false, error: 'simulated apply failure', version: '285' }),
    getStatus285: () => ({ ok: true, version: '285', presetCount: 0 }),
  };
}

// ── A. Version stamps ──────────────────────────────────────────────────────────
section('A. Version stamps');

test('package.json version is 286.0.0', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '286.0.0');
});

test('.agent-identity.json ecosVersion is 286.0.0', () => {
  const id = JSON.parse(fs.readFileSync(path.join(ROOT, '.agent-identity.json'), 'utf8'));
  assert.equal(id.ecosVersion, '286.0.0');
});

// ── B. Module files ────────────────────────────────────────────────────────────
section('B. Module files + lib mirrors');

test('src/lib/presetGroups286.js exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'src/lib/presetGroups286.js')));
});

test('lib/presetGroups286.js (mirror) exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'lib/presetGroups286.js')));
});

test('src/lib/providerAdapters286.js exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'src/lib/providerAdapters286.js')));
});

test('lib/providerAdapters286.js (mirror) exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'lib/providerAdapters286.js')));
});

test('ecos-api-server-v286-patch.js exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'ecos-api-server-v286-patch.js')));
});

// ── C. createPresetGroup286 ────────────────────────────────────────────────────
section('C. createPresetGroup286');

test('creates a valid group', () => {
  const pg = makeGroups();
  const r = pg.createPresetGroup286('grp1', ['preset-a', 'preset-b']);
  assert.equal(r.ok, true);
  assert.equal(r.groupName, 'grp1');
  assert.equal(r.version, '286');
  assert.deepEqual(r.group.presetNames, ['preset-a', 'preset-b']);
});

test('replaces an existing group', () => {
  const pg = makeGroups();
  pg.createPresetGroup286('g', ['a']);
  const r = pg.createPresetGroup286('g', ['b', 'c']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.group.presetNames, ['b', 'c']);
});

test('deduplicates preset names', () => {
  const pg = makeGroups();
  const r = pg.createPresetGroup286('dedup', ['x', 'x', 'y']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.group.presetNames, ['x', 'y']);
});

test('rejects empty groupName', () => {
  const pg = makeGroups();
  const r = pg.createPresetGroup286('', ['p1']);
  assert.equal(r.ok, false);
  assert.match(r.error, /groupName/);
});

test('rejects empty presetNames array', () => {
  const pg = makeGroups();
  const r = pg.createPresetGroup286('g', []);
  assert.equal(r.ok, false);
  assert.match(r.error, /presetNames/);
});

test('rejects non-array presetNames', () => {
  const pg = makeGroups();
  const r = pg.createPresetGroup286('g', 'not-array');
  assert.equal(r.ok, false);
});

test('rejects presetNames with non-string entries', () => {
  const pg = makeGroups();
  const r = pg.createPresetGroup286('g', ['ok', 123]);
  assert.equal(r.ok, false);
});

test('createdAt is set', () => {
  const pg = makeGroups();
  const r = pg.createPresetGroup286('ts-test', ['p']);
  assert.ok(r.group.createdAt);
  assert.ok(new Date(r.group.createdAt).getTime() > 0);
});

// ── D. getPresetGroup286 ───────────────────────────────────────────────────────
section('D. getPresetGroup286');

test('retrieves a registered group', () => {
  const pg = makeGroups();
  pg.createPresetGroup286('g1', ['pa', 'pb']);
  const r = pg.getPresetGroup286('g1');
  assert.equal(r.ok, true);
  assert.equal(r.groupName, 'g1');
  assert.deepEqual(r.group.presetNames, ['pa', 'pb']);
});

test('returns error for unknown group', () => {
  const pg = makeGroups();
  const r = pg.getPresetGroup286('nope');
  assert.equal(r.ok, false);
  assert.match(r.error, /no group/);
});

test('rejects empty groupName', () => {
  const pg = makeGroups();
  const r = pg.getPresetGroup286('');
  assert.equal(r.ok, false);
});

// ── E. listPresetGroups286 ─────────────────────────────────────────────────────
section('E. listPresetGroups286');

test('returns empty list initially', () => {
  const pg = makeGroups();
  const r = pg.listPresetGroups286();
  assert.equal(r.ok, true);
  assert.equal(r.count, 0);
  assert.deepEqual(r.groups, []);
});

test('lists all registered groups', () => {
  const pg = makeGroups();
  pg.createPresetGroup286('g1', ['p1']);
  pg.createPresetGroup286('g2', ['p2', 'p3']);
  const r = pg.listPresetGroups286();
  assert.equal(r.ok, true);
  assert.equal(r.count, 2);
  assert.equal(r.groups.length, 2);
});

test('list returns copies, not references', () => {
  const pg = makeGroups();
  pg.createPresetGroup286('g', ['p']);
  const r = pg.listPresetGroups286();
  r.groups[0].presetNames.push('injected');
  const r2 = pg.listPresetGroups286();
  assert.deepEqual(r2.groups[0].presetNames, ['p']);
});

// ── F. removePresetGroup286 ────────────────────────────────────────────────────
section('F. removePresetGroup286');

test('removes an existing group', () => {
  const pg = makeGroups();
  pg.createPresetGroup286('del', ['p']);
  const r = pg.removePresetGroup286('del');
  assert.equal(r.ok, true);
  assert.equal(r.groupName, 'del');
});

test('group gone after removal', () => {
  const pg = makeGroups();
  pg.createPresetGroup286('del2', ['p']);
  pg.removePresetGroup286('del2');
  const r = pg.getPresetGroup286('del2');
  assert.equal(r.ok, false);
});

test('returns error for unknown group', () => {
  const pg = makeGroups();
  const r = pg.removePresetGroup286('ghost');
  assert.equal(r.ok, false);
  assert.match(r.error, /no group/);
});

test('count decrements after removal', () => {
  const pg = makeGroups();
  pg.createPresetGroup286('a', ['p']);
  pg.createPresetGroup286('b', ['q']);
  pg.removePresetGroup286('a');
  const r = pg.listPresetGroups286();
  assert.equal(r.count, 1);
});

// ── G. applyPresetGroup286 ─────────────────────────────────────────────────────
section('G. applyPresetGroup286');

test('errors when no filterPresets285 wired', () => {
  const pg = makeGroups(); // no filterPresets wired
  pg.createPresetGroup286('grp', ['p']);
  const r = pg.applyPresetGroup286(['ch1'], 'grp');
  assert.equal(r.ok, false);
  assert.match(r.error, /filterPresets285/);
});

test('errors when group not found', () => {
  const fp = makeFilterPresetsStub285();
  const pg = makeGroups({ filterPresets285: fp });
  const r = pg.applyPresetGroup286(['ch1'], 'nonexistent');
  assert.equal(r.ok, false);
  assert.match(r.error, /no group/);
});

test('errors for empty channelNames array', () => {
  const fp = makeFilterPresetsStub285();
  const pg = makeGroups({ filterPresets285: fp });
  pg.createPresetGroup286('grp', ['p']);
  const r = pg.applyPresetGroup286([], 'grp');
  assert.equal(r.ok, false);
  assert.match(r.error, /channelNames/);
});

test('errors for non-array channelNames', () => {
  const fp = makeFilterPresetsStub285();
  const pg = makeGroups({ filterPresets285: fp });
  pg.createPresetGroup286('grp', ['p']);
  const r = pg.applyPresetGroup286('ch1', 'grp');
  assert.equal(r.ok, false);
});

test('applies group with 1 channel and 1 preset', () => {
  const fp = makeFilterPresetsStub285();
  fp.registerFilterPreset285('billing', { categories: ['billing'] });
  const pg = makeGroups({ filterPresets285: fp });
  pg.createPresetGroup286('grp', ['billing']);
  const r = pg.applyPresetGroup286(['chan-a'], 'grp');
  assert.equal(r.ok, true);
  assert.equal(r.applied, 1);
  assert.equal(r.failed, 0);
  assert.equal(r.results.length, 1);
  assert.equal(r.results[0].channelName, 'chan-a');
  assert.equal(r.results[0].presetName, 'billing');
  assert.equal(r.results[0].ok, true);
});

test('applies group with multiple channels and multiple presets', () => {
  const fp = makeFilterPresetsStub285();
  fp.registerFilterPreset285('p1', { minSeverity: 'low' });
  fp.registerFilterPreset285('p2', { minSeverity: 'high' });
  const pg = makeGroups({ filterPresets285: fp });
  pg.createPresetGroup286('multi', ['p1', 'p2']);
  const r = pg.applyPresetGroup286(['ch1', 'ch2', 'ch3'], 'multi');
  assert.equal(r.ok, true);
  assert.equal(r.applied, 6);   // 3 channels × 2 presets
  assert.equal(r.failed, 0);
  assert.equal(r.results.length, 6);
});

test('deduplicates duplicate channel names in apply', () => {
  const fp = makeFilterPresetsStub285();
  fp.registerFilterPreset285('px', { minSeverity: 'low' });
  const pg = makeGroups({ filterPresets285: fp });
  pg.createPresetGroup286('g', ['px']);
  const r = pg.applyPresetGroup286(['ch1', 'ch1', 'ch2'], 'g');
  assert.equal(r.applied, 2); // only unique channels: ch1, ch2
  assert.equal(r.channelNames.length, 2);
});

test('ok is false when any apply fails', () => {
  const fp = makeFailingFilterPresetsStub285();
  const pg = makeGroups({ filterPresets285: fp });
  pg.createPresetGroup286('g', ['p']);
  const r = pg.applyPresetGroup286(['ch1'], 'g');
  assert.equal(r.ok, false);
  assert.equal(r.failed, 1);
  assert.equal(r.results[0].ok, false);
  assert.ok(r.results[0].error);
});

test('result includes groupName, channelNames, presetNames, version', () => {
  const fp = makeFilterPresetsStub285();
  fp.registerFilterPreset285('pp', {});
  const pg = makeGroups({ filterPresets285: fp });
  pg.createPresetGroup286('g', ['pp']);
  const r = pg.applyPresetGroup286(['c'], 'g');
  assert.equal(r.groupName, 'g');
  assert.deepEqual(r.channelNames, ['c']);
  assert.deepEqual(r.presetNames, ['pp']);
  assert.equal(r.version, '286');
});

// ── H. Status + Health + Perf ──────────────────────────────────────────────────
section('H. getStatus286 + checkPresetGroupHealth286 + getPerf286');

test('getStatus286 returns ok + version + groupCount', () => {
  const pg = makeGroups();
  pg.createPresetGroup286('s1', ['p']);
  const r = pg.getStatus286();
  assert.equal(r.ok, true);
  assert.equal(r.version, '286');
  assert.equal(r.groupCount, 1);
});

test('checkPresetGroupHealth286 returns ok', () => {
  const pg = makeGroups();
  const r = pg.checkPresetGroupHealth286();
  assert.equal(r.ok, true);
  assert.equal(r.version, '286');
});

test('getPerf286 returns perf shape after operations', () => {
  const pg = makeGroups();
  pg.createPresetGroup286('perf-test', ['p']);
  const p = pg.getPerf286();
  assert.ok('p50' in p && 'p95' in p && 'p99' in p && 'count' in p);
  assert.ok(p.count >= 1);
});

test('getPerf286 returns zeros when no ops', () => {
  const pg = makeGroups();
  const p = pg.getPerf286();
  assert.equal(p.count, 0);
  assert.equal(p.p50, 0);
});

// ── I. providerAdapters286 ─────────────────────────────────────────────────────
section('I. providerAdapters286 (36 contracts)');

test('PROVIDER_CONTRACTS_286 has 36 contracts', () => {
  const { PROVIDER_CONTRACTS_286 } = require('../src/lib/providerAdapters286');
  assert.equal(Object.keys(PROVIDER_CONTRACTS_286).length, 36);
});

test('presetGroups contract has all required methods', () => {
  const { PROVIDER_CONTRACTS_286 } = require('../src/lib/providerAdapters286');
  const c = PROVIDER_CONTRACTS_286.presetGroups;
  assert.ok(c.required.includes('createPresetGroup286'));
  assert.ok(c.required.includes('listPresetGroups286'));
  assert.ok(c.required.includes('applyPresetGroup286'));
  assert.ok(c.required.includes('getStatus286'));
});

test('validateProvider286 passes a valid presetGroups stub', () => {
  const { validateProvider286, createPresetGroupsStub286 } = require('../src/lib/providerAdapters286');
  const stub = createPresetGroupsStub286();
  const r = validateProvider286('presetGroups', stub);
  assert.equal(r.ok, true);
  assert.equal(r.errors.length, 0);
});

test('validateProvider286 fails missing method', () => {
  const { validateProvider286 } = require('../src/lib/providerAdapters286');
  const r = validateProvider286('presetGroups', {});
  assert.equal(r.ok, false);
  assert.ok(r.errors.length > 0);
});

test('createAllStubs286 includes presetGroups stub', () => {
  const { createAllStubs286 } = require('../src/lib/providerAdapters286');
  const stubs = createAllStubs286();
  assert.ok('presetGroups' in stubs);
  assert.equal(typeof stubs.presetGroups.createPresetGroup286, 'function');
  assert.equal(typeof stubs.presetGroups.applyPresetGroup286, 'function');
});

test('createAllStubs286 still includes filterPresets (V285 backward compat)', () => {
  const { createAllStubs286 } = require('../src/lib/providerAdapters286');
  const stubs = createAllStubs286();
  assert.ok('filterPresets' in stubs);
});

// ── J. API patch ───────────────────────────────────────────────────────────────
section('J. API patch');

test('createV286State exports a function', () => {
  const { createV286State } = require('../ecos-api-server-v286-patch');
  assert.equal(typeof createV286State, 'function');
});

test('registerV286Routes exports a function', () => {
  const { registerV286Routes } = require('../ecos-api-server-v286-patch');
  assert.equal(typeof registerV286Routes, 'function');
});

test('createV286State returns presetGroups286 instance', () => {
  const { createV286State } = require('../ecos-api-server-v286-patch');
  const state = createV286State({}, {});
  assert.ok(state.presetGroups286);
  assert.equal(typeof state.presetGroups286.createPresetGroup286, 'function');
});

test('registerV286Routes registers all expected routes without throwing', () => {
  const { createV286State, registerV286Routes } = require('../ecos-api-server-v286-patch');
  const state = createV286State({}, {});
  const routes = {};
  const app = {
    get:    (path, fn) => { routes[`GET ${path}`] = fn; },
    post:   (path, fn) => { routes[`POST ${path}`] = fn; },
    put:    (path, fn) => { routes[`PUT ${path}`] = fn; },
    delete: (path, fn) => { routes[`DELETE ${path}`] = fn; },
  };
  assert.doesNotThrow(() => registerV286Routes(app, state));
  assert.ok(`GET /api/v286/health` in routes);
  assert.ok(`GET /api/v286/alerts/filters/groups` in routes);
  assert.ok(`POST /api/v286/alerts/filters/groups` in routes);
  assert.ok(`GET /api/v286/alerts/filters/groups/:name` in routes);
  assert.ok(`DELETE /api/v286/alerts/filters/groups/:name` in routes);
  assert.ok(`POST /api/v286/alerts/filters/groups/:name/apply` in routes);
});

test('V286 state still carries filterPresets285 (V285 backward compat)', () => {
  const { createV286State } = require('../ecos-api-server-v286-patch');
  const { FilterPresets285 } = require('../src/lib/filterPresets285');
  const fp285 = new FilterPresets285({});
  const state = createV286State({ filterPresets285: fp285 }, {});
  assert.ok(state.filterPresets285 === fp285);
});

// ── K. Release documentation ───────────────────────────────────────────────────
section('K. Release documentation');

test('CHANGELOG_V286.md exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'CHANGELOG_V286.md')));
});

test('AI_PROTOCOL_V286.md exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'AI_PROTOCOL_V286.md')));
});

test('NEXT_SESSION_PROMPT_V286.md exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'NEXT_SESSION_PROMPT_V286.md')));
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
