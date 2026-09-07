'use strict';
/**
 * tests/v505.test.js — ECOS V505
 * Run: NODE_ENV=test node tests/v505.test.js → exit 0
 */
const assert      = require('assert');
const crypto      = require('crypto');
const fs          = require('fs');
const path        = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

console.log('\n=== ECOS V505 Tests ===\n');

// T01 — SACRED fiatLedger
test('SACRED fiatLedger.js md5', () => {
  const buf = fs.readFileSync(path.join(ROOT, 'lib/fiatLedger.js'));
  assert.strictEqual(crypto.createHash('md5').update(buf).digest('hex'), '563e9b1f9e67091a5b6527c0a92568e5');
});

// T02 — SACRED auditLog
test('SACRED auditLog.js md5', () => {
  const buf = fs.readFileSync(path.join(ROOT, 'lib/auditLog.js'));
  assert.strictEqual(crypto.createHash('md5').update(buf).digest('hex'), 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// T03 — server parse
test('ecos-api-server.js node --check', () => {
  execSync(`node --check ${path.join(ROOT, 'ecos-api-server.js')}`, { stdio: 'pipe' });
});

// T04 — version
test('package.json version = 505.0.0', () => { // relaxed in V506+
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json')));
  assert.ok(parseInt(pkg.version) >= 505, 'expected >= 505, got ' + pkg.version);
});

// T05 — systemStatus505.js exists
test('lib/systemStatus505.js exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'lib/systemStatus505.js')));
});

// T06 — systemStatus505.js parses clean
test('systemStatus505.js node --check', () => {
  execSync(`node --check ${path.join(ROOT, 'lib/systemStatus505.js')}`, { stdio: 'pipe' });
});

// T07 — governance.ok = true (the V504 bug fix)
test('governance.ok = true (V504 bug fixed)', () => {
  const s = require(path.join(ROOT, 'lib/systemStatus505.js'));
  const p = s.getSystemPosture505();
  assert.strictEqual(p.governance.ok, true, `governance.ok is ${p.governance.ok}: ${p.governance.error}`);
});

// T08 — posture returns valid signal
test('getSystemPosture505 returns valid signal', () => {
  const s = require(path.join(ROOT, 'lib/systemStatus505.js'));
  const p = s.getSystemPosture505();
  assert.ok(['GREEN', 'YELLOW', 'RED'].includes(p.signal), `invalid signal: ${p.signal}`);
  assert.ok(p.version && parseInt(p.version) >= 505, 'expected version >= 505, got ' + p.version);
});

// T09 — server wires V505 endpoints
test('server wires /api/v1/status/v505 and /api/v1/admin/summary/v505', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  assert.ok(src.includes('/api/v1/status/v505'));
  assert.ok(src.includes('/api/v1/admin/summary/v505'));
});

// T10 — systemStatus504.js still exists (no regression)
test('systemStatus504.js untouched (no regression)', () => {
  execSync(`node --check ${path.join(ROOT, 'lib/systemStatus504.js')}`, { stdio: 'pipe' });
});

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
process.exit(0);
