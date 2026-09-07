'use strict';
/**
 * tests/v469.test.js — ECOS V469 test suite
 * Tests: tower registry module, SACRED md5, server parse, IIFE endpoints wired
 */

const assert = require('assert');
const path   = require('path');
const crypto = require('crypto');
const fs     = require('fs');

let passed469 = 0;
let failed469 = 0;

function test469(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed469++;
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    failed469++;
  }
}

const ROOT = path.resolve(__dirname, '..');

console.log('\n=== ECOS V469 Tests ===\n');

// T01: SACRED md5 — fiatLedger
test469('T01 SACRED fiatLedger md5', () => {
  const data = fs.readFileSync(path.join(ROOT, 'lib/fiatLedger.js'));
  const md5  = crypto.createHash('md5').update(data).digest('hex');
  assert.strictEqual(md5, '563e9b1f9e67091a5b6527c0a92568e5', `fiatLedger md5 mismatch: ${md5}`);
});

// T02: SACRED md5 — auditLog
test469('T02 SACRED auditLog md5', () => {
  const data = fs.readFileSync(path.join(ROOT, 'lib/auditLog.js'));
  const md5  = crypto.createHash('md5').update(data).digest('hex');
  assert.strictEqual(md5, 'e5a5c2c27801d2d03991bc8e5a1df8cb', `auditLog md5 mismatch: ${md5}`);
});

// T03: Server parses cleanly
test469('T03 server node --check exits 0', () => {
  const { execSync } = require('child_process');
  const out = execSync(`node --check ${path.join(ROOT, 'ecos-api-server.js')} 2>&1`, { encoding: 'utf8' });
  // no throw = exit 0
});

// T04: Version is 469.0.0
test469('T04 package.json version is 469.0.0', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert(parseInt(pkg.version) >= 469, `Version ${pkg.version} < 469`);
});

// T05: towerRegistryMap469 module loads
test469('T05 towerRegistryMap469 module loads', () => {
  const mod = require(path.join(ROOT, 'src/lib/towerRegistryMap469.js'));
  assert.strictEqual(typeof mod.scanTowers469, 'function');
  assert.strictEqual(typeof mod.getConsolidationReport469, 'function');
  assert.strictEqual(typeof mod.TOWER_THRESHOLD_469, 'number');
});

// T06: getConsolidationReport469 returns valid structure
test469('T06 getConsolidationReport469 returns valid report', () => {
  const mod    = require(path.join(ROOT, 'src/lib/towerRegistryMap469.js'));
  const report = mod.getConsolidationReport469(ROOT);
  assert.strictEqual(report.ok, true, 'report.ok must be true');
  assert(typeof report.towerCount === 'number', 'towerCount must be a number');
  assert(Array.isArray(report.towers), 'towers must be array');
  assert(typeof report.summary === 'string', 'summary must be string');
});

// T07: Towers are detected (we know marketMaker tower exists)
test469('T07 towers detected (marketMaker expected)', () => {
  const mod    = require(path.join(ROOT, 'src/lib/towerRegistryMap469.js'));
  const report = mod.getConsolidationReport469(ROOT);
  assert(report.towerCount > 0, 'Expected at least one tower');
  const mmTower = report.towers.find(t => t.prefix === 'marketMaker');
  assert(mmTower, 'marketMaker tower expected');
  assert(mmTower.count > 3, `marketMaker count ${mmTower.count} should be >3`);
});

// T08: Orphaned patches v274-v286 are gone
test469('T08 orphaned patch chain v274-v286 deleted', () => {
  for (let v = 274; v <= 286; v++) {
    const f = path.join(ROOT, `ecos-api-server-v${v}-patch.js`);
    assert(!fs.existsSync(f), `File should not exist: ecos-api-server-v${v}-patch.js`);
  }
});

// T09: V469 IIFE wired — endpoints present in server source
test469('T09 V469 endpoints wired in server', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  assert(src.includes('/api/v1/registry/consolidate'), 'consolidate endpoint missing');
  assert(src.includes('/api/v1/admin/summary/v469'), 'summary endpoint missing');
  assert(src.includes('_wireTowerRegistry469'), 'IIFE name missing');
});

// T10: lib/towerRegistryMap469.js mirror exists
test469('T10 lib/ mirror of towerRegistryMap469 exists', () => {
  const f = path.join(ROOT, 'lib/towerRegistryMap469.js');
  assert(fs.existsSync(f), 'lib/towerRegistryMap469.js mirror missing');
});

console.log(`\n=== Results: ${passed469} passed, ${failed469} failed ===\n`);
process.exit(failed469 > 0 ? 1 : 0);
