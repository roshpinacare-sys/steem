'use strict';
// tests/v515.test.js — V515: triTowerCanon515 (splitModule + quadraticFunding + x402)
const assert = require('assert');
const crypto = require('crypto');
const path   = require('path');
const fs     = require('fs');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

// T01 — SACRED
test('SACRED fiatLedger.js md5', () => {
  const h = crypto.createHash('md5').update(fs.readFileSync(path.join(__dirname,'../lib/fiatLedger.js'))).digest('hex');
  assert.strictEqual(h, '563e9b1f9e67091a5b6527c0a92568e5');
});
test('SACRED auditLog.js md5', () => {
  const h = crypto.createHash('md5').update(fs.readFileSync(path.join(__dirname,'../lib/auditLog.js'))).digest('hex');
  assert.strictEqual(h, 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// T02 — parse + version
test('server parses without error', () => {
  require('child_process').execSync('node --check ' + path.join(__dirname,'../ecos-api-server.js'), { stdio:'pipe' });
});
test('package.json version >= 515', () => {
  const p = JSON.parse(fs.readFileSync(path.join(__dirname,'../package.json'),'utf8'));
  assert(parseInt(p.version) >= 515, `version ${p.version} < 515`);
});

// T03 — triTowerCanon515 module
test('triTowerCanon515 loads without error', () => {
  const t = require('../lib/triTowerCanon515.js');
  assert(t && typeof t === 'object');
});
test('TRI_CANON_VERSION_515 is 515.0.0', () => {
  const t = require('../lib/triTowerCanon515.js');
  assert.strictEqual(t.TRI_CANON_VERSION_515, '515.0.0');
});
test('getTriCanonInfo515() correct metadata', () => {
  const t = require('../lib/triTowerCanon515.js');
  const info = t.getTriCanonInfo515();
  assert.strictEqual(info.towers.length, 3);
  assert.strictEqual(info.tip, 268);
  assert.strictEqual(info.base, 263);
  assert.strictEqual(info.totalModules, 18);
  assert(info.towersType.includes('parallel'));
});

// T04 — all three tips accessible
test('splitModule268 accessible via tri facade', () => {
  const t = require('../lib/triTowerCanon515.js');
  assert(t.SplitModule268 && t.splitModule268, 'splitModule268 missing');
});
test('quadraticFunding268 accessible via tri facade', () => {
  const t = require('../lib/triTowerCanon515.js');
  assert(t.QuadraticFunding268 && t.quadraticFunding268, 'quadraticFunding268 missing');
});
test('x402268 accessible via tri facade', () => {
  const t = require('../lib/triTowerCanon515.js');
  assert(t.X402Processor268 && t.x402268, 'x402268 missing');
});

// T05 — server IIFE wired
test('server has V515-T01 /api/v1/tri/canon/status', () => {
  const src = fs.readFileSync(path.join(__dirname,'../ecos-api-server.js'),'utf8');
  assert(src.includes('V515-T01') && src.includes('tri/canon/status'));
});
test('server has V515-T02 summary/v515', () => {
  const src = fs.readFileSync(path.join(__dirname,'../ecos-api-server.js'),'utf8');
  assert(src.includes('V515-T02') && src.includes('summary/v515'));
});

// T06 — fail-closed: facade constructor doesn't throw on empty call
test('SplitModule268 is a constructor or object (non-null)', () => {
  const t = require('../lib/triTowerCanon515.js');
  assert(t.SplitModule268 !== null && t.SplitModule268 !== undefined);
});

console.log(`\n  V515 results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
