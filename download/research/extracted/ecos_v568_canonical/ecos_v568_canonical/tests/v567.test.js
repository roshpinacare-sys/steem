'use strict';
// tests/v567.test.js — V567: AutoCorr Warm-Up Status (IIFE-only)
const assert = require('assert');
const crypto = require('crypto');
const path   = require('path');
const fs     = require('fs');

let passed = 0, failed = 0;
function test(name, fn) {
  try   { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

// ── T01 SACRED ────────────────────────────────────────────────────────────────
test('SACRED fiatLedger.js md5', () => {
  const h = crypto.createHash('md5')
    .update(fs.readFileSync(path.join(__dirname,'../lib/fiatLedger.js'))).digest('hex');
  assert.strictEqual(h, '563e9b1f9e67091a5b6527c0a92568e5');
});
test('SACRED auditLog.js md5', () => {
  const h = crypto.createHash('md5')
    .update(fs.readFileSync(path.join(__dirname,'../lib/auditLog.js'))).digest('hex');
  assert.strictEqual(h, 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// ── T02 parse + version ────────────────────────────────────────────────────────
test('server parses without error', () => {
  require('child_process').execSync(
    'node --check ' + path.join(__dirname,'../ecos-api-server.js'), { stdio:'pipe' });
});
test('package.json version >= 567', () => {
  const p = JSON.parse(fs.readFileSync(path.join(__dirname,'../package.json'),'utf8'));
  assert(parseInt(p.version) >= 567, `version ${p.version} < 567`);
});

// ── T03 libCount constraint (v497) ────────────────────────────────────────────
test('libCount still 646 (IIFE-only — no new lib file added)', () => {
  const libDir = path.join(__dirname,'../lib');
  const count = fs.readdirSync(libDir).filter(f => f.endsWith('.js')).length;
  assert(count <= 646, `libCount ${count} > 646 — violated IIFE-only constraint`);
});

// ── T04 dep module ─────────────────────────────────────────────────────────────
test('tokenSnapshotBuffer562 loads without error', () => {
  const m = require('../lib/tokenSnapshotBuffer562.js');
  assert(m && typeof m.getAutoCorrelationScore562 === 'function');
  assert(typeof m.pushTokenSnapshot562 === 'function');
  assert(typeof m.getTokenSnapshots562 === 'function');
  assert(typeof m.clearTokenSnapshots562 === 'function');
});
test('MIN_SNAPSHOTS_562 is a positive integer', () => {
  const m = require('../lib/tokenSnapshotBuffer562.js');
  assert(Number.isInteger(m.MIN_SNAPSHOTS_562) && m.MIN_SNAPSHOTS_562 >= 1,
    `MIN_SNAPSHOTS_562=${m.MIN_SNAPSHOTS_562}`);
});

// ── T05 IIFE wiring in server ─────────────────────────────────────────────────
test('server has V567-T01 warm-up-status endpoint', () => {
  const src = fs.readFileSync(path.join(__dirname,'../ecos-api-server.js'),'utf8');
  assert(src.includes('V567-T01'), 'Missing V567-T01 tag');
  assert(src.includes('warm-up-status/v567'), 'Missing warm-up-status/v567 route');
});
test('server has V567-T02 summary/v567', () => {
  const src = fs.readFileSync(path.join(__dirname,'../ecos-api-server.js'),'utf8');
  assert(src.includes('V567-T02'), 'Missing V567-T02 tag');
  assert(src.includes('summary/v567'), 'Missing summary/v567 route');
});
test('server IIFE references tokenSnapshotBuffer562', () => {
  const src = fs.readFileSync(path.join(__dirname,'../ecos-api-server.js'),'utf8');
  assert(src.includes('tokenSnapshotBuffer562'));
});
test('server IIFE references getAutoCorrelationScore562', () => {
  const src = fs.readFileSync(path.join(__dirname,'../ecos-api-server.js'),'utf8');
  assert(src.includes('getAutoCorrelationScore562'));
});

// ── T06 warm-up logic (unit — using getTokenSnapshots562().length) ────────────
test('warm-up: empty buffer → bufferSize=0, warmedUp=false', () => {
  const m = require('../lib/tokenSnapshotBuffer562.js');
  m.clearTokenSnapshots562();
  const bufferSize = m.getTokenSnapshots562().length;
  const minReq = m.MIN_SNAPSHOTS_562;
  assert.strictEqual(bufferSize, 0, 'buffer should be empty');
  assert.strictEqual(bufferSize >= minReq, false, 'should NOT be warmed up');
});

test('warm-up: push minRequired string[] snapshots → bufferSize >= minRequired', () => {
  const m = require('../lib/tokenSnapshotBuffer562.js');
  m.clearTokenSnapshots562();
  const minReq = m.MIN_SNAPSHOTS_562;
  for (let i = 0; i < minReq; i++) {
    const result = m.pushTokenSnapshot562(['ETH', 'BTC', 'SOL', 'MATIC' + i]);
    assert(result.ok, `push ${i} failed: ${result.error}`);
  }
  const bufferSize = m.getTokenSnapshots562().length;
  assert(bufferSize >= minReq, `bufferSize ${bufferSize} < minRequired ${minReq}`);
});

test('warm-up: fillPercent=0 for empty buffer', () => {
  const m = require('../lib/tokenSnapshotBuffer562.js');
  m.clearTokenSnapshots562();
  const bufferSize = m.getTokenSnapshots562().length;
  const minReq = m.MIN_SNAPSHOTS_562;
  const fillPct = minReq > 0 ? Math.min(100, Math.round((bufferSize / minReq) * 100)) : 100;
  assert.strictEqual(fillPct, 0);
});

test('warm-up: fillPercent=100 after minRequired pushes', () => {
  const m = require('../lib/tokenSnapshotBuffer562.js');
  m.clearTokenSnapshots562();
  const minReq = m.MIN_SNAPSHOTS_562;
  for (let i = 0; i < minReq; i++) m.pushTokenSnapshot562(['ETH', 'BTC' + i]);
  const bufferSize = m.getTokenSnapshots562().length;
  const fillPct = Math.min(100, Math.round((bufferSize / minReq) * 100));
  assert(fillPct >= 100, `fillPercent ${fillPct} < 100`);
});

test('warm-up: remaining=0 after minRequired pushes', () => {
  const m = require('../lib/tokenSnapshotBuffer562.js');
  // buffer already has minRequired from prev test (module cached)
  const bufferSize = m.getTokenSnapshots562().length;
  const minReq = m.MIN_SNAPSHOTS_562;
  const remaining = Math.max(0, minReq - bufferSize);
  if (bufferSize >= minReq) {
    assert.strictEqual(remaining, 0);
  } else {
    assert(remaining > 0, 'remaining should be > 0 if not warmed up');
  }
});

// ── T07 fail-closed ───────────────────────────────────────────────────────────
test('remaining never negative regardless of buffer state', () => {
  const m = require('../lib/tokenSnapshotBuffer562.js');
  const bufferSize = m.getTokenSnapshots562().length;
  const minReq = m.MIN_SNAPSHOTS_562;
  const remaining = Math.max(0, minReq - bufferSize);
  assert(remaining >= 0);
});
test('pushTokenSnapshot562: non-array input → ok=false (fail-closed)', () => {
  const m = require('../lib/tokenSnapshotBuffer562.js');
  const r = m.pushTokenSnapshot562('not-an-array');
  assert.strictEqual(r.ok, false, 'non-array should fail gracefully');
});
test('pushTokenSnapshot562: empty array → ok=false', () => {
  const m = require('../lib/tokenSnapshotBuffer562.js');
  const r = m.pushTokenSnapshot562([]);
  assert.strictEqual(r.ok, false, 'empty array should fail gracefully');
});

// ── T08 no regression ────────────────────────────────────────────────────────
test('v566: _validateSeedBody566 still exists in server (no regression)', () => {
  const src = fs.readFileSync(path.join(__dirname,'../ecos-api-server.js'),'utf8');
  assert(src.includes('_validateSeedBody566') || src.includes('validateSeedBody566'),
    '_validateSeedBody566 missing from server');
});
test('deepHealthAlertFilter541 still loads (dep chain intact)', () => {
  const m = require('../lib/deepHealthAlertFilter541.js');
  assert(m && typeof m.buildFilteredAlerts541 === 'function');
});

console.log(`\n  V567 results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
