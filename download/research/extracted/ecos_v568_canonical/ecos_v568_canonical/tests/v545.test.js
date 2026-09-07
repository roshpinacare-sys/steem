'use strict';
/**
 * tests/v545.test.js — Deep Health Alert Aggregator V545
 * Run: NODE_ENV=test node tests/v545.test.js   → exit 0
 */

const crypto = require('crypto');
const path   = require('path');
const fs     = require('fs');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;

function assert(cond, label) {
  if (cond) { console.log('  ✓', label); passed++; }
  else       { console.error('  ✗', label); failed++; }
}

console.log('\nV545 — Deep Health Alert Aggregator\n');

// T01 — SACRED md5
const md5 = f => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');
assert(md5(path.join(ROOT,'lib/fiatLedger.js'))  === '563e9b1f9e67091a5b6527c0a92568e5', 'SACRED fiatLedger.js intact');
assert(md5(path.join(ROOT,'lib/auditLog.js'))     === 'e5a5c2c27801d2d03991bc8e5a1df8cb', 'SACRED auditLog.js intact');

// T02 — server parse
try {
  execSync(`node --check ${path.join(ROOT,'ecos-api-server.js')}`, { stdio: 'ignore' });
  assert(true, 'ecos-api-server.js node --check clean');
} catch (_) { assert(false, 'ecos-api-server.js node --check clean'); }

// T03 — module loads
let AGG545;
try {
  AGG545 = require(path.join(ROOT,'lib/deepHealthAlertAggregator545.js'));
  assert(true, 'deepHealthAlertAggregator545.js loads without error');
} catch (e) {
  assert(false, `deepHealthAlertAggregator545.js loads: ${e.message}`);
  console.log(`\n  Results: ${passed} passed, ${failed} failed`);
  process.exit(1);
}

// T04 — constants
assert(AGG545.AGGREGATOR_VERSION_545 === '545.0.0', 'AGGREGATOR_VERSION_545 === "545.0.0"');
assert(AGG545.AGGREGATOR_BUCKET_545  === 'hour',    'AGGREGATOR_BUCKET_545 === "hour"');
assert(AGG545.AGGREGATOR_TOP_N_545   === 5,         'AGGREGATOR_TOP_N_545 === 5');

// T05 — aggregate545 empty ring buffer
const agg0 = AGG545.aggregate545();
assert(agg0.ok === true, 'aggregate545() ok with empty buffer');
assert(Array.isArray(agg0.buckets), 'aggregate545().buckets is array');
assert(agg0.snapshotCount === 0 || typeof agg0.snapshotCount === 'number', 'snapshotCount is number');

// T06 — push snapshots and aggregate
const hist = require(path.join(ROOT,'lib/deepHealthAlertHistory542.js'));
hist.push542({}, 'test-t06-a');
hist.push542({}, 'test-t06-b');
hist.push542({}, 'test-t06-c');
const agg1 = AGG545.aggregate545();
assert(agg1.ok === true, 'aggregate545() ok after 3 pushes');
assert(agg1.snapshotCount >= 3, `snapshotCount >= 3 (got ${agg1.snapshotCount})`);
assert(agg1.bucketCount >= 1, 'at least 1 hourly bucket');

// T07 — bucket structure
const bucket0 = agg1.buckets[0];
assert(typeof bucket0.hourKey === 'string' && bucket0.hourKey.length === 13, 'hourKey is YYYY-MM-DDTHH (13 chars)');
assert(typeof bucket0.count === 'number' && bucket0.count >= 1, 'bucket.count >= 1');
assert(typeof bucket0.avgAlert === 'number', 'bucket.avgAlert is number');
assert(typeof bucket0.avgCritical === 'number', 'bucket.avgCritical is number');
assert(typeof bucket0.degradedCount === 'number', 'bucket.degradedCount is number');

// T08 — getTop545 default (n=5)
const top5 = AGG545.getTop545();
assert(top5.ok === true, 'getTop545() ok');
assert(Array.isArray(top5.topN), 'getTop545().topN is array');
assert(top5.n === 5, 'getTop545() default n=5');

// T09 — getTop545 clamp
const topClamped = AGG545.getTop545(200);
assert(topClamped.n === 50, 'getTop545(200) clamped to 50');
const topMin = AGG545.getTop545(0);
assert(topMin.n === 1, 'getTop545(0) clamped to 1');

// T10 — getBucketByHour545 valid key
const hKey = bucket0.hourKey;
const byHour = AGG545.getBucketByHour545(hKey);
assert(byHour.ok === true, 'getBucketByHour545(validKey) ok');
assert(byHour.bucket !== null, 'getBucketByHour545 returns bucket');
assert(byHour.bucket.hourKey === hKey, 'bucket.hourKey matches query');

// T11 — getBucketByHour545 missing key
const missing = AGG545.getBucketByHour545('2000-01-01T00');
assert(missing.ok === true, 'getBucketByHour545(missing) ok (not an error)');
assert(missing.bucket === null, 'getBucketByHour545(missing).bucket === null');

// T12 — getBucketByHour545 fail-closed (null)
const badNull = AGG545.getBucketByHour545(null);
assert(badNull.ok === false, 'getBucketByHour545(null) → ok:false');
assert(typeof badNull.error === 'string', 'getBucketByHour545(null) returns error string');

// T13 — getBucketByHour545 fail-closed (number)
const badNum = AGG545.getBucketByHour545(42);
assert(badNum.ok === false, 'getBucketByHour545(42) → ok:false');

// T14 — getInfo545 structure
const info = AGG545.getInfo545();
assert(info.module === 'deepHealthAlertAggregator545', 'getInfo545().module correct');
assert(Array.isArray(info.endpoints) && info.endpoints.length === 3, 'getInfo545().endpoints has 3 entries');

// T15 — registerEndpoints545 mock app
const routes = { get: [] };
const mockApp = { get: (p) => routes.get.push(p) };
const regResult = AGG545.registerEndpoints545(mockApp);
assert(regResult === true, 'registerEndpoints545(mockApp) returns true');
assert(routes.get.includes('/api/v1/deep-health/aggregate/v545'), 'GET /aggregate/v545 registered');
assert(routes.get.includes('/api/v1/deep-health/top/v545'), 'GET /top/v545 registered');
assert(routes.get.includes('/api/v1/admin/summary/v545'), 'GET /admin/summary/v545 registered');

// T16 — registerEndpoints545 null → false
assert(AGG545.registerEndpoints545(null) === false, 'registerEndpoints545(null) returns false');
assert(AGG545.registerEndpoints545({}) === false, 'registerEndpoints545({}) returns false (no .get)');

// T17 — server wires V545
const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'), 'utf8');
assert(src.includes('/api/v1/deep-health/aggregate/v545'), 'server has /aggregate/v545');
assert(src.includes('/api/v1/deep-health/top/v545'), 'server has /top/v545');
assert(src.includes('/api/v1/admin/summary/v545'), 'server has /admin/summary/v545');

// T18 — version 545.0.0
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'), 'utf8'));
assert(parseInt(pkg.version) >= 545, `package.json version >= 545 (got ${pkg.version})`);

// T19 — src/lib mirror exists
assert(fs.existsSync(path.join(ROOT,'src/lib/deepHealthAlertAggregator545.js')), 'src/lib mirror exists');

// T20 — aggregate returns granularity field
assert(agg1.granularity === 'hour', 'aggregate545().granularity === "hour"');

console.log(`\n  Results: ${passed} passed, ${failed} failed`);
if (failed === 0) console.log('  ✓ All V545 tests passed\n');
process.exit(failed > 0 ? 1 : 0);
