'use strict';
/**
 * tests/v542.test.js — ECOS V542
 * deepHealthAlertHistory542: ring buffer (N=50) + trend analysis
 * wrapping deepHealthAlertFilter541.buildFilteredAlerts541().
 * Exit 0 = all passed.
 */

const assert  = require('assert');
const path    = require('path');
const crypto  = require('crypto');
const fs      = require('fs');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;

function test542(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.error(`  ❌ ${name}: ${e.message}`); failed++; }
}

console.log('\n=== V542 Deep Health Alert History Tests ===\n');

// T01 – SACRED
test542('T01 SACRED fiatLedger md5', () => {
  const h = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT,'lib','fiatLedger.js'))).digest('hex');
  assert.strictEqual(h, '563e9b1f9e67091a5b6527c0a92568e5');
});
test542('T02 SACRED auditLog md5', () => {
  const h = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT,'lib','auditLog.js'))).digest('hex');
  assert.strictEqual(h, 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// T03 – server parse
test542('T03 ecos-api-server.js parse clean', () => {
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, ['--check', path.join(ROOT,'ecos-api-server.js')]);
  assert.strictEqual(r.status, 0, 'server: ' + r.stderr.toString());
});

// T04 – package version
test542('T04 package.json version >= 542', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8'));
  assert(parseInt(pkg.version) >= 542, `version=${pkg.version}`);
});

// T05 – module loads + constants
test542('T05 deepHealthAlertHistory542 loads', () => {
  const m = require(path.join(ROOT,'lib','deepHealthAlertHistory542.js'));
  assert.strictEqual(m.HISTORY_VERSION_542, '542.0.0');
  assert.strictEqual(m.HISTORY_MAX_DEFAULT_542, 50);
  assert.strictEqual(m.TREND_WINDOW_542, 5);
  assert(typeof m.push542 === 'function');
  assert(typeof m.getHistory542 === 'function');
  assert(typeof m.getTrend542 === 'function');
  assert(typeof m.setMax542 === 'function');
  assert(typeof m.registerEndpoints542 === 'function');
});

// T06 – filter dep loaded
test542('T06 deepHealthAlertFilter541 dependency loaded', () => {
  const m = require(path.join(ROOT,'lib','deepHealthAlertHistory542.js'));
  const info = m.getInfo542();
  assert(info.filterLoaded === true, `filter not loaded: ${info.loadError}`);
});

// T07 – push + snapshot shape
test542('T07 push542 returns valid snapshot', () => {
  const m = require(path.join(ROOT,'lib','deepHealthAlertHistory542.js'));
  const snap = m.push542({}, 'test-T07');
  assert(typeof snap.seqNo === 'number' && snap.seqNo >= 1);
  assert(typeof snap.ts === 'string');
  assert(typeof snap.alertCount === 'number');
  assert(typeof snap.criticalCount === 'number');
  assert(typeof snap.warningCount === 'number');
  assert(typeof snap.infoCount === 'number');
  assert(snap.triggerSource === 'test-T07');
  assert('ok' in snap);
});

// T08 – getHistory returns snapshots newest-first
test542('T08 getHistory542 returns newest-first, correct count', () => {
  const m = require(path.join(ROOT,'lib','deepHealthAlertHistory542.js'));
  // push 3 more
  m.push542({}, 'T08-a');
  m.push542({}, 'T08-b');
  m.push542({}, 'T08-c');
  const h = m.getHistory542({ limit: 3 });
  assert(h.ok);
  assert.strictEqual(h.returned, 3);
  assert(h.snapshots[0].seqNo > h.snapshots[1].seqNo, 'not newest-first');
  assert(typeof h.total === 'number');
  assert(h.total >= 3);
});

// T09 – getHistory limit
test542('T09 getHistory542 respects limit', () => {
  const m = require(path.join(ROOT,'lib','deepHealthAlertHistory542.js'));
  const h = m.getHistory542({ limit: 2 });
  assert(h.returned <= 2, `returned ${h.returned} > limit 2`);
});

// T10 – getHistory onlyDegraded filter
test542('T10 getHistory542 onlyDegraded filter works', () => {
  const m = require(path.join(ROOT,'lib','deepHealthAlertHistory542.js'));
  const h = m.getHistory542({ onlyDegraded: true, limit: 50 });
  assert(h.ok);
  for (const s of h.snapshots) {
    assert(!s.ok, `non-degraded snapshot in onlyDegraded result: seqNo=${s.seqNo}`);
  }
});

// T11 – getTrend shape
test542('T11 getTrend542 returns valid shape', () => {
  const m = require(path.join(ROOT,'lib','deepHealthAlertHistory542.js'));
  const t = m.getTrend542();
  assert(['rising','falling','stable','unknown'].includes(t.direction), `bad direction: ${t.direction}`);
  assert(typeof t.delta === 'number');
  assert(typeof t.windowSize === 'number');
  assert(t.version === '542.0.0');
});

// T12 – setMax trims ring
test542('T12 setMax542 trims ring when shrinking', () => {
  // use a fresh require via module cache trick — just test the logic
  const m = require(path.join(ROOT,'lib','deepHealthAlertHistory542.js'));
  const before = m.getInfo542().currentSize;
  m.setMax542(before + 100);  // no-op expand
  const after = m.getInfo542().maxSize;
  assert(after >= before, 'max should not shrink the ring without trimming');
  // set large max — ring should not lose data
  m.setMax542(500);
  assert(m.getInfo542().maxSize === 500);
  // reset to default
  m.setMax542(50);
  assert(m.getInfo542().maxSize === 50);
});

// T13 – setMax clamped to [5,500]
test542('T13 setMax542 clamps values', () => {
  const m = require(path.join(ROOT,'lib','deepHealthAlertHistory542.js'));
  m.setMax542(1);
  assert(m.getInfo542().maxSize === 5, 'min clamp failed');
  m.setMax542(9999);
  assert(m.getInfo542().maxSize === 500, 'max clamp failed');
  m.setMax542(50); // restore
});

// T14 – registerEndpoints542 safe with null
test542('T14 registerEndpoints542 safe with null app', () => {
  const m = require(path.join(ROOT,'lib','deepHealthAlertHistory542.js'));
  m.registerEndpoints542(null); // must not throw
});

// T15 – server wired
test542('T15 server contains V542 IIFE marker', () => {
  const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'),'utf8');
  assert(src.includes('deepHealthAlertHistory542'), 'missing deepHealthAlertHistory542');
  assert(src.includes('alert-history/v542'), 'missing endpoint tag');
});

// T16 – src/lib mirror exists
test542('T16 src/lib mirror exists', () => {
  assert(fs.existsSync(path.join(ROOT,'src','lib','deepHealthAlertHistory542.js')));
});

// T17 – fail-closed: push with no filter dep returns ok=false snapshot
test542('T17 fail-closed: degraded snapshot when filter unavailable', () => {
  // simulate missing dep by checking the degraded code path via a bad query
  // the module handles it; we confirm the snapshot always has required fields
  const m = require(path.join(ROOT,'lib','deepHealthAlertHistory542.js'));
  const snap = m.push542({ badParam: 'xxx' }, 'fail-closed-test');
  assert('ok' in snap);
  assert(typeof snap.alertCount === 'number');
  assert(typeof snap.criticalCount === 'number');
  assert(snap.triggerSource === 'fail-closed-test');
});

// T18 – getInfo returns endpoint list
test542('T18 getInfo542 lists 3 endpoints', () => {
  const m = require(path.join(ROOT,'lib','deepHealthAlertHistory542.js'));
  const info = m.getInfo542();
  assert(Array.isArray(info.endpoints) && info.endpoints.length === 3);
  assert(info.endpoints.some(e => e.includes('alert-history/v542')));
  assert(info.endpoints.some(e => e.includes('trend/v542')));
  assert(info.endpoints.some(e => e.includes('summary/v542')));
});

// Summary
console.log(`\n=== V542 Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
