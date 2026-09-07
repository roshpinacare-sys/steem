'use strict';
// tests/v479.test.js — V479: quadTowerCanon479 facade (tipModule+telemetry+sybilGuard+splitModule)
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
test('package.json version >= 479', () => {
  const p = JSON.parse(fs.readFileSync(path.join(__dirname,'../package.json'),'utf8'));
  assert(parseInt(p.version) >= 479, `version ${p.version} < 479`);
});

// T03 — quadTowerCanon479 loads and has correct structure
test('quadTowerCanon479 loads without error', () => {
  const q = require('../lib/quadTowerCanon479.js');
  assert(q && typeof q === 'object');
});
test('quadTowerCanon479.QUAD_CANON_VERSION_479 is 479.0.0', () => {
  const q = require('../lib/quadTowerCanon479.js');
  assert.strictEqual(q.QUAD_CANON_VERSION_479, '479.0.0');
});
test('quadTowerCanon479.getQuadCanonInfo479() returns correct metadata', () => {
  const q = require('../lib/quadTowerCanon479.js');
  const info = q.getQuadCanonInfo479();
  assert.strictEqual(info.towers.length, 4);
  assert.strictEqual(info.tip, 268);
  assert.strictEqual(info.base, 263);
  assert.strictEqual(info.totalModules, 24);
});

// T04 — all four tower tips accessible
test('tipModule268 accessible via quad facade', () => {
  const q = require('../lib/quadTowerCanon479.js');
  assert(q.TipModule268 || q.tipModule268, 'tipModule268 not in facade');
});
test('telemetry268 accessible via quad facade', () => {
  const q = require('../lib/quadTowerCanon479.js');
  assert(q.Telemetry268 || q.telemetry268, 'telemetry268 not in facade');
});
test('sybilGuard268 accessible via quad facade', () => {
  const q = require('../lib/quadTowerCanon479.js');
  assert(q.SybilGuard268 || q.sybilGuard268, 'sybilGuard268 not in facade');
});
test('splitModule268 accessible via quad facade', () => {
  const q = require('../lib/quadTowerCanon479.js');
  assert(q.SplitModule268 || q.splitModule268, 'splitModule268 not in facade');
});

// T05 — server IIFE wired
test('server has V479-T01 /api/v1/quad/canon/status', () => {
  const src = fs.readFileSync(path.join(__dirname,'../ecos-api-server.js'),'utf8');
  assert(src.includes('V479-T01'));
  assert(src.includes('quad/canon/status'));
});
test('server has V479-T02 summary/v479', () => {
  const src = fs.readFileSync(path.join(__dirname,'../ecos-api-server.js'),'utf8');
  assert(src.includes('V479-T02'));
  assert(src.includes('summary/v479'));
});

console.log(`\n  V479 results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
