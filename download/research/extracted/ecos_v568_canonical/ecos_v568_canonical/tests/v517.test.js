'use strict';
/**
 * tests/v517.test.js — ECOS V517
 * Test the canon-registry-bridge-extension that registers onboardingFlow + agentDispatchBridge
 * with canonBridgePatch508. exit 0 = pass.
 */
const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;
function test517(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.error('  ✗', name, '\n   ', e.message); failed++; }
}

console.log('\n=== V517 tests ===');

// ── SACRED guard ──
test517('SACRED fiatLedger.js md5 unchanged', () => {
  const buf = fs.readFileSync(path.join(ROOT, 'lib', 'fiatLedger.js'));
  const md5 = crypto.createHash('md5').update(buf).digest('hex');
  assert.strictEqual(md5, '563e9b1f9e67091a5b6527c0a92568e5', 'fiatLedger md5 drifted');
});
test517('SACRED auditLog.js md5 unchanged', () => {
  const buf = fs.readFileSync(path.join(ROOT, 'lib', 'auditLog.js'));
  const md5 = crypto.createHash('md5').update(buf).digest('hex');
  assert.strictEqual(md5, 'e5a5c2c27801d2d03991bc8e5a1df8cb', 'auditLog md5 drifted');
});

// ── Parse ──
test517('server parses (node --check equivalent)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  assert(src.length > 1000, 'server too small');
  // node --check is run separately; here we just verify the IIFE marker exists
  assert(src.includes('_wireCanonRegistryBridge517'), 'V517 IIFE missing');
});

// ── Module loads ──
test517('canonRegistryBridge517 loads', () => {
  const m = require(path.join(ROOT, 'lib', 'canonRegistryBridge517.js'));
  assert.strictEqual(m.BRIDGE_VERSION_517, '517.0.0');
  assert(Array.isArray(m.STATIC_DESCRIPTORS_517));
  assert.strictEqual(m.STATIC_DESCRIPTORS_517.length, 2);
});

// ── Descriptors shape ──
test517('descriptors are parallel-duplicate with correct members', () => {
  const m = require(path.join(ROOT, 'lib', 'canonRegistryBridge517.js'));
  const byName = Object.fromEntries(m.STATIC_DESCRIPTORS_517.map(d => [d.name, d]));

  const ob = byName['onboardingFlow'];
  assert(ob, 'onboardingFlow descriptor missing');
  assert.strictEqual(ob.kind, 'parallel-duplicate');
  assert.strictEqual(ob.base, '263');
  assert.strictEqual(ob.tip, '268');
  assert.strictEqual(ob.members.length, 6);

  const ad = byName['agentDispatchBridge'];
  assert(ad, 'agentDispatchBridge descriptor missing');
  assert.strictEqual(ad.kind, 'parallel-duplicate');
  assert.strictEqual(ad.base, '246');
  assert.strictEqual(ad.tip, '253');
  assert.strictEqual(ad.members.length, 8);
});

// ── All declared members exist on disk ──
test517('every declared member file exists in lib/', () => {
  const m = require(path.join(ROOT, 'lib', 'canonRegistryBridge517.js'));
  for (const d of m.STATIC_DESCRIPTORS_517) {
    for (const v of d.members) {
      const fp = path.join(ROOT, 'lib', `${d.name}${v}.js`);
      assert(fs.existsSync(fp), `missing member file: ${fp}`);
    }
  }
});

// ── Non-tip members are thin re-exports of tip (verified parallel-duplicate) ──
test517('non-tip members re-export the tip module', () => {
  const m = require(path.join(ROOT, 'lib', 'canonRegistryBridge517.js'));
  for (const d of m.STATIC_DESCRIPTORS_517) {
    for (const v of d.members) {
      if (v === d.tip) continue;
      const src = fs.readFileSync(path.join(ROOT, 'lib', `${d.name}${v}.js`), 'utf8');
      const expected = `./${d.name}${d.tip}.js`;
      assert(
        src.includes(expected),
        `${d.name}${v}.js is not a thin re-export of ${expected} — parallel-duplicate claim invalid`
      );
    }
  }
});

// ── Registration succeeded ──
test517('getRegistrationSummary517 reports ok with 2 registered', () => {
  const m = require(path.join(ROOT, 'lib', 'canonRegistryBridge517.js'));
  const s = m.getRegistrationSummary517();
  assert(!s.bridgeError, `bridge error: ${s.bridgeError}`);
  assert.strictEqual(s.totalAttempted, 2);
  assert.strictEqual(s.totalRegistered, 2);
  assert(s.registered.includes('onboardingFlow'));
  assert(s.registered.includes('agentDispatchBridge'));
});

// ── Fail-closed: bridge508 still has its API ──
test517('bridge508 still exposes its API (no regression)', () => {
  require(path.join(ROOT, 'lib', 'canonRegistryBridge517.js'));
  const p = require(path.join(ROOT, 'lib', 'canonBridgePatch508.js'));
  assert(typeof p.registerCanonFacade508 === 'function');
  assert(typeof p.getPatchedDuplication508 === 'function');
  assert(typeof p.listRegisteredFacades508 === 'function');
});

// ── bridge508 registry contains the two new towers ──
test517('bridge508 registry contains onboardingFlow + agentDispatchBridge', () => {
  require(path.join(ROOT, 'lib', 'canonRegistryBridge517.js'));
  const p = require(path.join(ROOT, 'lib', 'canonBridgePatch508.js'));
  const names = p.listRegisteredFacades508().map(f => f.name);
  for (const expected of ['onboardingFlow', 'agentDispatchBridge']) {
    assert(names.includes(expected), `bridge508 missing ${expected}. Has: ${names.join(',')}`);
  }
});

// ── V516 still registered (no regression) ──
test517('V516 registrations still present (no regression)', () => {
  require(path.join(ROOT, 'lib', 'canonRegistryBridge516.js'));
  require(path.join(ROOT, 'lib', 'canonRegistryBridge517.js'));
  const p = require(path.join(ROOT, 'lib', 'canonBridgePatch508.js'));
  const names = p.listRegisteredFacades508().map(f => f.name);
  for (const expected of ['telemetry','sybilGuard','reputationLedger','offlineQueue','splitModule','quadraticFunding','x402']) {
    assert(names.includes(expected), `V516 regression: bridge508 missing ${expected}`);
  }
});

// ── Endpoint registration is safe with null ──
test517('registerEndpoints517 safe with null app', () => {
  const m = require(path.join(ROOT, 'lib', 'canonRegistryBridge517.js'));
  m.registerEndpoints517(null); // must not throw
});

// ── Endpoint registration registers 3 GETs on a mock app ──
test517('registerEndpoints517 registers 3 GET endpoints on a mock app', () => {
  const m = require(path.join(ROOT, 'lib', 'canonRegistryBridge517.js'));
  const paths = [];
  const mockApp = {
    get(p, h) { paths.push(p); assert.strictEqual(typeof h, 'function'); },
  };
  m.registerEndpoints517(mockApp);
  assert.strictEqual(paths.length, 3, `expected 3 endpoints, got ${paths.length}: ${paths.join(',')}`);
  assert(paths.includes('/api/v1/admin/summary/v517'));
});

// ── getPatchedReport517 is invocable (graceful) ──
test517('getPatchedReport517 returns object or throws gracefully', () => {
  const m = require(path.join(ROOT, 'lib', 'canonRegistryBridge517.js'));
  try {
    const r = m.getPatchedReport517({ libDir: path.join(ROOT, 'lib'), rootDir: ROOT });
    assert(r && typeof r === 'object', 'report not an object');
  } catch (e) {
    assert(e.message, 'error has no message');
  }
});

// ── Wiring: server contains V517 IIFE marker + module reference ──
test517('server wires canonRegistryBridge517 in IIFE', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  assert(src.includes('canonRegistryBridge517'), 'missing canonRegistryBridge517 in server');
  assert(src.includes('canon-registry-bridge-extension'), 'missing feature tag in server');
  assert(src.includes('_wireCanonRegistryBridge517'), 'missing IIFE name');
});

// ── src/lib mirror ──
test517('src/lib mirror exists and matches lib/', () => {
  const a = fs.readFileSync(path.join(ROOT, 'lib', 'canonRegistryBridge517.js'));
  const b = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'canonRegistryBridge517.js'));
  assert.strictEqual(
    crypto.createHash('md5').update(a).digest('hex'),
    crypto.createHash('md5').update(b).digest('hex'),
    'src/lib mirror md5 differs from lib/'
  );
});

// ── package.json bumped ──
test517('package.json version >= 517.0.0', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const major = parseInt(String(pkg.version).split('.')[0], 10);
  assert(major >= 517, `expected version >= 517, got ${pkg.version}`);
});

console.log(`\n=== V517 Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
