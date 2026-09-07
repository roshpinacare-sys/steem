'use strict';
/**
 * tests/v503.test.js — Test Status Report + realFail Fix V503
 * Run: NODE_ENV=test node tests/v503.test.js
 * Expected: exit 0
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

console.log('\nV503 — Test Status Report + realFail Fix\n');

// T01 — SACRED md5
const md5 = f => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');
assert(md5(path.join(ROOT,'lib/fiatLedger.js'))  === '563e9b1f9e67091a5b6527c0a92568e5', 'SACRED fiatLedger.js intact');
assert(md5(path.join(ROOT,'lib/auditLog.js'))     === 'e5a5c2c27801d2d03991bc8e5a1df8cb', 'SACRED auditLog.js intact');

// T02 — server node --check
try {
  execSync(`node --check ${path.join(ROOT,'ecos-api-server.js')}`, { stdio: 'ignore' });
  assert(true, 'ecos-api-server.js node --check clean');
} catch (_) { assert(false, 'ecos-api-server.js node --check clean'); }

// T03 — module loads
let TSR503;
try {
  TSR503 = require(path.join(ROOT,'lib/testStatusReport503.js'));
  assert(true, 'testStatusReport503.js loads without error');
} catch (e) {
  assert(false, `testStatusReport503.js loads: ${e.message}`);
  process.exit(1);
}

// T04 — version constant
assert(TSR503.TEST_STATUS_VERSION_503 === '503', 'TEST_STATUS_VERSION_503 === "503"');

// T05 — getStatusReport503 returns available:true (TEST_AUDIT.json exists)
const report = TSR503.getStatusReport503();
assert(report.available === true, 'getStatusReport503() available === true');

// T06 — summary string has correct format
assert(typeof report.summary === 'string' && report.summary.includes('pass'), 'summary string contains "pass"');
assert(report.summary.includes('cannotRun'), 'summary string contains "cannotRun"');
assert(report.summary.includes('realFail'), 'summary string contains "realFail"');

// T07 — numeric counts are numbers
assert(typeof report.pass === 'number' && report.pass >= 0, `pass is number >= 0 (got ${report.pass})`);
assert(typeof report.cannotRun === 'number' && report.cannotRun >= 0, `cannotRun is number >= 0 (got ${report.cannotRun})`);
assert(typeof report.realFail === 'number' && report.realFail >= 0, `realFail is number >= 0 (got ${report.realFail})`);

// T08 — honesty field present
assert(typeof report.honesty === 'string' && report.honesty.length > 0, 'honesty field present');

// T09 — cannotRunSample is array
assert(Array.isArray(report.cannotRunSample), 'cannotRunSample is array');

// T10 — realFailures is array
assert(Array.isArray(report.realFailures), 'realFailures is array');

// T11 — v243 realFail fixed: CHANGELOG_V243.md, NEXT_SESSION_PROMPT_V243.md, AI_PROTOCOL_V243.md exist
assert(fs.existsSync(path.join(ROOT,'CHANGELOG_V243.md')), 'CHANGELOG_V243.md exists (realFail fix)');
assert(fs.existsSync(path.join(ROOT,'NEXT_SESSION_PROMPT_V243.md')), 'NEXT_SESSION_PROMPT_V243.md exists');
assert(fs.existsSync(path.join(ROOT,'AI_PROTOCOL_V243.md')), 'AI_PROTOCOL_V243.md exists');

// T12 — v243.test.js now passes (was realFail)
try {
  execSync(`NODE_ENV=test node ${path.join(ROOT,'tests/v243.test.js')}`, { stdio: 'ignore' });
  assert(true, 'v243.test.js now exits 0 (realFail fixed)');
} catch (_) {
  assert(false, 'v243.test.js exits 0 (realFail fixed)');
}

// T13 — tests/README.md exists
assert(fs.existsSync(path.join(ROOT,'tests/README.md')), 'tests/README.md exists');

// T14 — loadAuditSnapshot503 returns object
const snap = TSR503.loadAuditSnapshot503();
assert(snap !== null && typeof snap === 'object', 'loadAuditSnapshot503() returns object');

// T15 — server wires v503 endpoints
const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'), 'utf8');
assert(src.includes('/api/v1/admin/test-status/v503'), 'server has /api/v1/admin/test-status/v503');
assert(src.includes('/api/v1/admin/summary/v503'), 'server has /api/v1/admin/summary/v503');

// T16 — version 503.0.0
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'), 'utf8'));
assert(parseInt(pkg.version) >= 503, `package.json version >= 503 (got ${pkg.version})`);

console.log(`\n  Results: ${passed} passed, ${failed} failed`);
if (failed === 0) console.log('  ✓ All V503 tests passed\n');
process.exit(failed > 0 ? 1 : 0);
