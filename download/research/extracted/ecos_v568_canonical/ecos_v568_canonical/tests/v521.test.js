/**
 * tests/v521.test.js — ECOS V521 (Phase P382) — Vitest Shim
 * Run: NODE_ENV=test node tests/v521.test.js
 * @version 521.0.0
 */
'use strict';
process.env.NODE_ENV = 'test';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const VS = require(path.join(ROOT, 'src/lib/vitestShim521.js'));

let passed = 0, failed = 0; const errors = [];
function test(name, fn) { try { fn(); console.log('  \u2713 ' + name); passed++; } catch (e) { console.error('  \u2717 ' + name + ': ' + e.message); failed++; errors.push(name); } }

console.log('\n[V521] The vendored vitest shim exists and works\n');
test('shim is vendored at node_modules/vitest (package + index.mjs)', () => {
  assert.ok(VS.shimPresent521(ROOT), 'shim missing');
  assert.ok(fs.existsSync(path.join(ROOT, 'node_modules/vitest/index.mjs')));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/vitest/package.json'), 'utf8'));
  assert.strictEqual(pkg.name, 'vitest');
  assert.strictEqual(pkg.type, 'module');
});
test('shim is zero-dependency (Node builtins only — no install)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'node_modules/vitest/index.mjs'), 'utf8');
  // only allowed import is node:assert; no bare third-party imports
  const imports = (src.match(/^import .* from ['"]([^'"]+)['"]/gm) || []);
  imports.forEach(line => { const m = line.match(/from ['"]([^'"]+)['"]/); assert.ok(m[1].startsWith('node:'), 'non-builtin import: ' + m[1]); });
});
test('shim self-test passes (expect/describe/it contract)', () => {
  const r = VS.selfTest521();
  assert.strictEqual(r.ok, true);
  assert.ok(r.checks.every(c => c.pass));
});
test('shim actually RUNS a real ESM vitest suite that was cannotRun before', () => {
  // auditLog.test.js uses import {..} from 'vitest' — run it; exit 0 proves the shim works
  const p = path.join(ROOT, 'tests/auditLog.test.js');
  if (!fs.existsSync(p)) { console.log('    (auditLog.test.js absent; skipping live-run check)'); return; }
  let rc = 0;
  try { execSync(`NODE_ENV=test node ${JSON.stringify(p)}`, { cwd: ROOT, stdio: 'pipe', timeout: 60000 }); }
  catch (e) { rc = e.status || 1; }
  assert.strictEqual(rc, 0, 'auditLog.test.js should pass under the shim');
});

console.log('\n[V521] Audit snapshot is honest\n');
test('TEST_AUDIT.json reflects the shim (more pass, fewer cannotRun than pre-shim 72)', () => {
  const s = VS.auditSnapshot521(ROOT);
  assert.ok(s.total >= 130);
  assert.ok(s.pass >= 90, 'expected many more passing suites, got ' + s.pass);
  assert.ok(s.cannotRun < 72, 'cannotRun should drop below the pre-shim 72, got ' + s.cannotRun);
  assert.strictEqual(s.total, s.pass + s.cannotRun + s.realFail);
});
test('real failures are named, not hidden', () => {
  const s = VS.auditSnapshot521(ROOT);
  assert.ok(Array.isArray(s.realFailures));
  assert.ok(/compatibility layer|shim limitations/i.test(s.caveat), 'caveat must disclose shim is not full vitest');
});

console.log('\n[V521] Server wiring + sacred\n');
const SERVER = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
test('server parses, no corruption', () => {
  assert.doesNotThrow(() => new vm.Script(SERVER, { filename: 'ecos-api-server.js' }));
  assert.ok(!SERVER.includes('__manus_ec'));
});
test('shim endpoints + tags wired', () => {
  assert.ok(SERVER.includes('/api/v1/admin/test-audit/v521'));
  ['V521-T01', 'V521-T02'].forEach(t => assert.ok(SERVER.includes(t)));
  assert.ok(SERVER.includes("require('./lib/vitestShim521.js')"));
});
test('package.json major >= 521', () => {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  assert.ok(parseInt(String(v).split('.')[0], 10) >= 521, 'got ' + v);
});
test('SACRED files intact (canonical MD5)', () => {
  const crypto = require('crypto');
  const md5 = p => crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
  assert.strictEqual(md5('lib/fiatLedger.js'), '563e9b1f9e67091a5b6527c0a92568e5');
  assert.strictEqual(md5('lib/auditLog.js'), 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});
test('handoff docs exist', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'CHANGELOG_V521.md')));
  assert.ok(fs.existsSync(path.join(ROOT, 'NEXT_SESSION_PROMPT_V521.md')));
});

console.log('\n  Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.error('Failed: ' + errors.join(', ')); process.exit(1); }
console.log('  \u2713 All V521 tests passed\n');
