/**
 * tests/v533.test.js — ECOS V533 — governanceDiagnose
 * Run: NODE_ENV=test node tests/v533.test.js
 * @version 533.0.0
 */
'use strict';
process.env.NODE_ENV = 'test';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const LIB  = path.join(ROOT, 'lib');

let passed = 0, failed = 0, errors = [];
function test(name, fn) {
  try { fn(); console.log('  \u2713 ' + name); passed++; }
  catch (e) { console.error('  \u2717 ' + name + ': ' + e.message); failed++; errors.push(name); }
}

// ── SACRED ──
console.log('\n[V533] SACRED\n');
test('fiatLedger.js md5 unchanged', () => {
  const s = crypto.createHash('md5').update(fs.readFileSync(path.join(LIB,'fiatLedger.js'))).digest('hex');
  assert.strictEqual(s, '563e9b1f9e67091a5b6527c0a92568e5');
});
test('auditLog.js md5 unchanged', () => {
  const s = crypto.createHash('md5').update(fs.readFileSync(path.join(LIB,'auditLog.js'))).digest('hex');
  assert.strictEqual(s, 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// ── syntax ──
console.log('\n[V533] syntax\n');
test('ecos-api-server.js parses cleanly', () => {
  require('child_process').execSync('node --check ' + path.join(ROOT,'ecos-api-server.js'), {stdio:'pipe'});
});

// ── governanceDiagnose533 module ──
console.log('\n[V533] governanceDiagnose533\n');
const diag = require(path.join(LIB, 'governanceDiagnose533.js'));

test('DIAGNOSE_VERSION_533 correct', () => {
  assert.strictEqual(diag.DIAGNOSE_VERSION_533, '533.0.0');
});

test('diagnoseBridgeOpts533 — all missing → criticalDepsOk=false', () => {
  const r = diag.diagnoseBridgeOpts533({});
  assert.strictEqual(r.criticalDepsOk, false);
  assert.strictEqual(r.snapshotWillSucceed, false);
  assert.strictEqual(r.allOk, false);
  const missing = r.deps.filter(d => d.status !== 'ok').map(d => d.name);
  assert.ok(missing.includes('O437'), 'O437 missing');
  assert.ok(missing.includes('status505'), 'status505 missing');
  assert.ok(missing.includes('gc499'), 'gc499 missing');
});

test('diagnoseBridgeOpts533 — all ok → criticalDepsOk=true', () => {
  const opts = {
    O437:      { orchestrate437: function(){} },
    status505: { getSystemPosture505: function(){} },
    gc499:     { runGovernanceCycle499: function(){} },
    audit:     function(){},
    libDir:    '/tmp',
  };
  const r = diag.diagnoseBridgeOpts533(opts);
  assert.strictEqual(r.criticalDepsOk, true);
  assert.strictEqual(r.snapshotWillSucceed, true);
  assert.strictEqual(r.allOk, true);
  assert.ok(r.summary.includes('OK'));
});

test('diagnoseBridgeOpts533 — degraded status505 (missing fn)', () => {
  const opts = {
    O437:      { someMethod: function(){} },
    status505: { wrongFn: function(){} },  // missing getSystemPosture505
    gc499:     { runGovernanceCycle499: function(){} },
  };
  const r = diag.diagnoseBridgeOpts533(opts);
  const s505 = r.deps.find(d => d.name === 'status505');
  assert.strictEqual(s505.status, 'degraded');
  assert.ok(s505.missingFns.includes('getSystemPosture505'));
  assert.strictEqual(r.criticalDepsOk, false);
});

test('diagnoseBridgeOpts533 — null opts handled safely', () => {
  const r = diag.diagnoseBridgeOpts533(null);
  assert.strictEqual(r.criticalDepsOk, false);
  assert.ok(r.deps.length === 3);
});

test('diagnoseBridgeOpts533 — optional fields noted but not critical', () => {
  const opts = {
    O437:      { fn: function(){} },
    status505: { getSystemPosture505: function(){} },
    gc499:     { runGovernanceCycle499: function(){} },
    // no audit, no libDir
  };
  const r = diag.diagnoseBridgeOpts533(opts);
  assert.strictEqual(r.criticalDepsOk, true, 'critical deps ok without optional');
  assert.strictEqual(r.allOk, false, 'allOk false without optional');
  assert.ok(r.optional.audit.includes('missing'));
  assert.ok(r.optional.libDir.includes('missing'));
});

// ── src/lib mirror ──
console.log('\n[V533] src/lib mirror\n');
test('src and lib governanceDiagnose533 identical', () => {
  const a = fs.readFileSync(path.join(ROOT,'src/lib/governanceDiagnose533.js'));
  const b = fs.readFileSync(path.join(ROOT,'lib/governanceDiagnose533.js'));
  assert.ok(a.equals(b));
});

// ── endpoints wired ──
console.log('\n[V533] endpoints\n');
test('GET /api/v1/diamond/heartbeat/governance/diagnose wired', () => {
  assert.ok(fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8')
    .includes('/api/v1/diamond/heartbeat/governance/diagnose'));
});
test('GET /api/v1/admin/summary/v533 wired', () => {
  assert.ok(fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8')
    .includes('/api/v1/admin/summary/v533'));
});

// ── version ──
console.log('\n[V533] version\n');
test('package.json version >= 533', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8'));
  assert.ok(parseInt(pkg.version) >= 533);
});

console.log('\n' + '-'.repeat(50));
console.log('[V533] Results: ' + passed + ' passed, ' + failed + ' failed');
if (errors.length) console.error('Failed: ' + errors.join(', '));
console.log('-'.repeat(50) + '\n');
process.exit(failed > 0 ? 1 : 0);
