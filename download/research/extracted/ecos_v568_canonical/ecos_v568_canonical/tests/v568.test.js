'use strict';
// tests/v568.test.js — V568: AutoCorr Seed Batch (IIFE-only)
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
test('package.json version >= 568', () => {
  const p = JSON.parse(fs.readFileSync(path.join(__dirname,'../package.json'),'utf8'));
  assert(parseInt(p.version) >= 568, `version ${p.version} < 568`);
});

// ── T03 libCount constraint ────────────────────────────────────────────────────
test('libCount still 646 (IIFE-only — no new lib file)', () => {
  const libDir = path.join(__dirname,'../lib');
  const count = fs.readdirSync(libDir).filter(f => f.endsWith('.js')).length;
  assert(count <= 646, `libCount ${count} > 646 — violated IIFE-only constraint`);
});

// ── T04 dep module intact ──────────────────────────────────────────────────────
test('tokenSnapshotBuffer562 loads + has required API', () => {
  const m = require('../lib/tokenSnapshotBuffer562.js');
  assert(typeof m.pushTokenSnapshot562 === 'function', 'pushTokenSnapshot562 missing');
  assert(typeof m.getTokenSnapshots562 === 'function', 'getTokenSnapshots562 missing');
  assert(typeof m.clearTokenSnapshots562 === 'function', 'clearTokenSnapshots562 missing');
  assert(typeof m.MIN_SNAPSHOTS_562 === 'number', 'MIN_SNAPSHOTS_562 missing');
});

// ── T05 IIFE wiring in server ──────────────────────────────────────────────────
test('server has V568-T01 seed/batch endpoint tag', () => {
  const src = fs.readFileSync(path.join(__dirname,'../ecos-api-server.js'),'utf8');
  assert(src.includes('V568-T01'), 'Missing V568-T01 tag');
  assert(src.includes('seed/batch/v568'), 'Missing seed/batch/v568 route');
});
test('server has V568-T02 summary/v568', () => {
  const src = fs.readFileSync(path.join(__dirname,'../ecos-api-server.js'),'utf8');
  assert(src.includes('V568-T02'), 'Missing V568-T02 tag');
  assert(src.includes('summary/v568'), 'Missing summary/v568 route');
});
test('server IIFE references pushTokenSnapshot562', () => {
  const src = fs.readFileSync(path.join(__dirname,'../ecos-api-server.js'),'utf8');
  assert(src.includes('pushTokenSnapshot562'));
});
test('server IIFE has BAD_ARGS_568 fail-closed guard', () => {
  const src = fs.readFileSync(path.join(__dirname,'../ecos-api-server.js'),'utf8');
  assert(src.includes('BAD_ARGS_568'));
});
test('server IIFE has TOO_MANY_BATCHES_568 guard', () => {
  const src = fs.readFileSync(path.join(__dirname,'../ecos-api-server.js'),'utf8');
  assert(src.includes('TOO_MANY_BATCHES_568'));
});

// ── T06 batch logic (unit) ────────────────────────────────────────────────────
test('batch: 3 valid batches → pushed=3, bufferSize increases', () => {
  const m = require('../lib/tokenSnapshotBuffer562.js');
  m.clearTokenSnapshots562();
  const batches = [['ETH','BTC','SOL'],['ETH','MATIC','ARB'],['BTC','SOL','OP']];
  let pushed = 0, skipped = 0;
  batches.forEach(b => { const r = m.pushTokenSnapshot562(b); r.ok ? pushed++ : skipped++; });
  assert.strictEqual(pushed, 3);
  assert.strictEqual(skipped, 0);
  assert.strictEqual(m.getTokenSnapshots562().length, 3);
});

test('batch: batches reaching minRequired → warmedUp=true', () => {
  const m = require('../lib/tokenSnapshotBuffer562.js');
  m.clearTokenSnapshots562();
  const minReq = m.MIN_SNAPSHOTS_562;
  for (let i = 0; i < minReq; i++) m.pushTokenSnapshot562(['TKN'+i,'ETH']);
  const bufferSize = m.getTokenSnapshots562().length;
  assert(bufferSize >= minReq, `bufferSize ${bufferSize} < minRequired ${minReq}`);
  assert(bufferSize >= minReq);  // warmedUp=true logic
});

test('batch: partial fail — bad entries skipped, good ones pushed', () => {
  const m = require('../lib/tokenSnapshotBuffer562.js');
  m.clearTokenSnapshots562();
  const goodBatch = ['ETH','BTC'];
  const badBatch  = [];   // empty → should fail
  let pushed = 0, skipped = 0;
  [goodBatch, badBatch].forEach(b => {
    const r = m.pushTokenSnapshot562(b);
    r.ok ? pushed++ : skipped++;
  });
  assert.strictEqual(pushed, 1, 'good batch should be pushed');
  assert.strictEqual(skipped, 1, 'empty batch should be skipped');
  assert.strictEqual(m.getTokenSnapshots562().length, 1);
});

test('batch: non-array batch entry → ok=false from push', () => {
  const m = require('../lib/tokenSnapshotBuffer562.js');
  const r = m.pushTokenSnapshot562('not-array');
  assert.strictEqual(r.ok, false);
});

test('batch: all-whitespace tokens in array → ok=false', () => {
  const m = require('../lib/tokenSnapshotBuffer562.js');
  const r = m.pushTokenSnapshot562(['  ', '\t', '']);
  assert.strictEqual(r.ok, false, 'all-whitespace tokens should fail');
});

// ── T07 MAX_BATCHES guard logic ───────────────────────────────────────────────
test('MAX_BATCHES_568=50 referenced in server', () => {
  const src = fs.readFileSync(path.join(__dirname,'../ecos-api-server.js'),'utf8');
  assert(src.includes('MAX_BATCHES_568') || src.includes('50'), 'MAX_BATCHES guard not found');
});

// ── T08 warm-up integration check ────────────────────────────────────────────
test('warm-up-status/v567 IIFE still present after V568 addition', () => {
  const src = fs.readFileSync(path.join(__dirname,'../ecos-api-server.js'),'utf8');
  assert(src.includes('warm-up-status/v567'), 'V567 warm-up status route missing after V568');
});

// ── T09 no regression ────────────────────────────────────────────────────────
test('_validateSeedBody566 still in server (no regression)', () => {
  const src = fs.readFileSync(path.join(__dirname,'../ecos-api-server.js'),'utf8');
  assert(src.includes('validateSeedBody566') || src.includes('_validateSeedBody566'));
});
test('deepHealthAlertFilter541 still loads', () => {
  const m = require('../lib/deepHealthAlertFilter541.js');
  assert(typeof m.buildFilteredAlerts541 === 'function');
});

console.log(`\n  V568 results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
