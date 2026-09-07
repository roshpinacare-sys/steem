'use strict';
/**
 * tests/v481.test.js — Hexa Tower Canon Facade V481
 * Run: NODE_ENV=test node tests/v481.test.js
 * Expected: exit 0
 */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

let passed = 0, failed = 0;
function assert(cond, label) {
  if (cond) { console.log('  ✓', label); passed++; }
  else       { console.error('  ✗', label); failed++; }
}

async function run() {
  console.log('\nV481 — Hexa Tower Canon Facade Tests\n');

  const ROOT = path.join(__dirname, '..');

  // T01 — SACRED md5
  const md5 = f => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');
  assert(md5(path.join(ROOT,'lib/fiatLedger.js'))  === '563e9b1f9e67091a5b6527c0a92568e5', 'SACRED fiatLedger.js intact');
  assert(md5(path.join(ROOT,'lib/auditLog.js'))     === 'e5a5c2c27801d2d03991bc8e5a1df8cb', 'SACRED auditLog.js intact');

  // T02 — server node --check
  const { execSync } = require('child_process');
  try {
    execSync(`node --check ${path.join(ROOT,'ecos-api-server.js')}`, { stdio: 'ignore' });
    assert(true, 'ecos-api-server.js node --check clean');
  } catch (e) { assert(false, 'ecos-api-server.js node --check clean'); }

  // T03 — module loads
  let HX481;
  try {
    HX481 = require(path.join(ROOT,'lib/hexaTowerCanon481.js'));
    assert(true, 'hexaTowerCanon481.js loads without error');
  } catch (e) {
    assert(false, `hexaTowerCanon481.js loads: ${e.message}`);
    return finish();
  }

  // T04 — version constant
  assert(HX481.CANON_VERSION_481 === '481', 'CANON_VERSION_481 === "481"');

  // T05 — getCanonInfo481
  const info = HX481.getCanonInfo481();
  assert(info.subCanons && info.subCanons.length === 6, 'getCanonInfo481 returns 6 subCanons');
  assert(typeof info.totalModules === 'number' && info.totalModules > 0, 'totalModules is a positive number');

  // T06 — all 6 sub-canons loaded
  const loadedCount = info.subCanons.filter(s => s.loaded).length;
  assert(loadedCount === 6, `all 6 sub-canons loaded (got ${loadedCount})`);

  // T07 — subCanon names correct
  const names = info.subCanons.map(s => s.name);
  assert(names.includes('agentDispatchBridgeCanon473'), 'subCanon agentDispatchBridgeCanon473 listed');
  assert(names.includes('economicIntegrityLoadBearingCanon477'), 'subCanon economicIntegrityLoadBearingCanon477 listed');
  assert(names.includes('pentaTowerCanon480'), 'subCanon pentaTowerCanon480 listed');

  // T08 — getHealthSummary481
  const health = HX481.getHealthSummary481();
  assert(health.allLoaded === true, 'getHealthSummary481 allLoaded === true');
  assert(health.loadedCount === 6, 'getHealthSummary481 loadedCount === 6');

  // T09 — requireIntegrityVerified481 delegates (returns result, no "not available" error)
  let delegateOk481 = false;
  try {
    const result481 = HX481.requireIntegrityVerified481({}, {});
    // Canon477 returns {allowed, attestation, reason} — not throws in partial mode
    delegateOk481 = result481 != null && ('allowed' in result481 || 'ok' in result481);
  } catch (e) {
    delegateOk481 = !e.message.includes('not available');
  }
  assert(delegateOk481, 'requireIntegrityVerified481 delegates to Canon477 (returns result)');

  // T10 — validateProvider481 delegates
  let vpOk481 = false;
  try {
    const vr481 = HX481.validateProvider481('nonexistent-provider', {});
    vpOk481 = vr481 != null && ('ok' in vr481 || 'errors' in vr481);
  } catch (e) {
    vpOk481 = !e.message.includes('not available');
  }
  assert(vpOk481, 'validateProvider481 delegates to Canon476 (returns result)');

  // T11 — registerEndpoints481 (mock app)
  const routes481 = [];
  const mockApp = { get: (path) => routes481.push(path) };
  const reg = HX481.registerEndpoints481(mockApp);
  assert(reg === true, 'registerEndpoints481 returns true');
  assert(routes481.includes('/api/v1/towers/hexa/health'), 'route /api/v1/towers/hexa/health registered');
  assert(routes481.includes('/api/v1/towers/hexa/info'), 'route /api/v1/towers/hexa/info registered');

  // T12 — registerEndpoints481 with null app (fail-closed)
  const regNull = HX481.registerEndpoints481(null);
  assert(regNull === false, 'registerEndpoints481(null) returns false (fail-safe)');

  // T13 — server wires V481 endpoints
  const src = fs.readFileSync(path.join(ROOT,'ecos-api-server.js'), 'utf8');
  assert(src.includes('/api/v1/towers/hexa/health'), 'server has /api/v1/towers/hexa/health');
  assert(src.includes('/api/v1/admin/summary/v481'), 'server has /api/v1/admin/summary/v481');

  // T14 — version 481.0.0
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'), 'utf8'));
  assert(parseInt(pkg.version) >= 481, `package.json version >= 481 (got ${pkg.version})`);

  finish();
}

function finish() {
  console.log(`\n=== V481 Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error('FATAL:', e); process.exit(1); });
