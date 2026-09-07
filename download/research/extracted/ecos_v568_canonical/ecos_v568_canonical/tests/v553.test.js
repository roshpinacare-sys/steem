/**
 * tests/v553.test.js — ECOS V553 — trendSeedBridge
 * Run: NODE_ENV=test node tests/v553.test.js
 * @version 553.0.0
 */
'use strict';
process.env.NODE_ENV = 'test';

var assert = require('assert');
var fs     = require('fs');
var path   = require('path');
var crypto = require('crypto');

var ROOT = path.resolve(__dirname, '..');
var LIB  = path.join(ROOT, 'lib');

var passed = 0, failed = 0, errors = [];
function test(name, fn) {
  try { fn(); console.log('  \u2713 ' + name); passed++; }
  catch (e) { console.error('  \u2717 ' + name + ': ' + e.message); failed++; errors.push(name); }
}

// ── SACRED ──
console.log('\n[V553] SACRED\n');
test('fiatLedger.js md5 unchanged', function() {
  var s = crypto.createHash('md5').update(fs.readFileSync(path.join(LIB,'fiatLedger.js'))).digest('hex');
  assert.strictEqual(s, '563e9b1f9e67091a5b6527c0a92568e5');
});
test('auditLog.js md5 unchanged', function() {
  var s = crypto.createHash('md5').update(fs.readFileSync(path.join(LIB,'auditLog.js'))).digest('hex');
  assert.strictEqual(s, 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// ── syntax ──
console.log('\n[V553] syntax\n');
test('ecos-api-server.js parses cleanly', function() {
  require('child_process').execSync('node --check ' + path.join(ROOT,'ecos-api-server.js'), {stdio:'pipe'});
});

// ── trendSeedBridge553 module ──
console.log('\n[V553] trendSeedBridge553\n');
var seed = require(path.join(LIB, 'trendSeedBridge553.js'));

test('SEED_VERSION_553 correct', function() {
  assert.strictEqual(seed.SEED_VERSION_553, '553.0.0');
});

test('SEED_DEFAULT_N_553 = 10', function() {
  assert.strictEqual(seed.SEED_DEFAULT_N_553, 10);
});

test('seedTrend553(10) returns seeded=10 and real direction', function() {
  var r = seed.seedTrend553(10);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.seeded, 10);
  assert.ok(r.trend, 'trend present');
  assert.ok(['stable','rising','falling','unknown'].includes(r.trend.direction),
    'direction is valid: ' + r.trend.direction);
  // after 10 pushes priorN should be >= 5
  assert.ok(r.trend.priorN >= 5 || r.trend.direction !== 'unknown',
    'should have enough history: priorN=' + r.trend.priorN);
});

test('seedTrend553 default (no arg) seeds 10', function() {
  var r = seed.seedTrend553();
  assert.strictEqual(r.seeded, 10);
});

test('seedTrend553 fail-closed: n>30 rejected', function() {
  // The module caps at 30 — verify cap is applied (no throw, n clamped to default)
  var r = seed.seedTrend553(31);
  // clamped to default 10
  assert.ok(r.seeded <= 10, 'n>30 clamped to default, seeded=' + r.seeded);
});

test('seedTrend553(0) fail-closed: invalid n → default', function() {
  var r = seed.seedTrend553(0);
  assert.ok(r.seeded > 0, 'invalid n uses default');
});

test('getTrendStatus553 returns trend + scheduler state', function() {
  var s = seed.getTrendStatus553();
  assert.ok(s.trend, 'trend present');
  assert.ok(typeof s.schedulerStatus === 'object', 'schedulerStatus present');
  assert.ok(typeof s.historyAvail === 'boolean', 'historyAvail present');
  assert.ok(typeof s.schedulerAvail === 'boolean', 'schedulerAvail present');
  assert.strictEqual(s.version, '553.0.0');
});

// After seeding, trend should not be unknown
test('getTrendStatus553 trend not unknown after seed', function() {
  seed.seedTrend553(10);
  var s = seed.getTrendStatus553();
  assert.notStrictEqual(s.trend.direction, 'unknown',
    'trend should be real after seeding, got: ' + s.trend.direction);
});

// ── src/lib mirror ──
console.log('\n[V553] src/lib mirror\n');
test('src and lib trendSeedBridge553 identical', function() {
  var a = fs.readFileSync(path.join(ROOT,'src/lib/trendSeedBridge553.js'));
  var b = fs.readFileSync(path.join(ROOT,'lib/trendSeedBridge553.js'));
  assert.ok(a.equals(b));
});

// ── endpoints wired ──
console.log('\n[V553] endpoints\n');
var serverSrc = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
test('POST /api/v1/deep-health/scheduler/seed wired', function() {
  assert.ok(serverSrc.includes('/api/v1/deep-health/scheduler/seed'));
});
test('GET /api/v1/deep-health/trend/live wired', function() {
  assert.ok(serverSrc.includes('/api/v1/deep-health/trend/live'));
});
test('GET /api/v1/admin/summary/v553 wired', function() {
  assert.ok(serverSrc.includes('/api/v1/admin/summary/v553'));
});

// ── version ──
console.log('\n[V553] version\n');
test('package.json version >= 553', function() {
  var pkg = JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8'));
  assert.ok(parseInt(pkg.version) >= 553);
});

console.log('\n' + '-'.repeat(50));
console.log('[V553] Results: ' + passed + ' passed, ' + failed + ' failed');
if (errors.length) console.error('Failed: ' + errors.join(', '));
console.log('-'.repeat(50) + '\n');
process.exit(failed > 0 ? 1 : 0);
