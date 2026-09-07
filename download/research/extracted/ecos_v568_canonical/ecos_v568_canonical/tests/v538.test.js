'use strict';
/**
 * tests/v538.test.js — ECOS V538
 * בודק: aggregatedHeartbeatStatus538, תיקון hbRunning, SACRED md5, server parse
 * הרצה: NODE_ENV=test node tests/v538.test.js  →  exit 0
 */

const assert = require('assert');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const { execFileSync } = require('child_process');

const BASE = path.resolve(__dirname, '..');
let passed = 0; let failed = 0;

function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.error('  ✗', name, '—', e.message); failed++; }
}
function md5File(fp) { return crypto.createHash('md5').update(fs.readFileSync(fp)).digest('hex'); }

console.log('\n=== ECOS V538 Tests ===\n');

// ── 1-2. SACRED ─────────────────────────────────────────────────────────────
test('SACRED: fiatLedger.js md5 intact', () => {
  assert.strictEqual(md5File(path.join(BASE,'lib/fiatLedger.js')),
    '563e9b1f9e67091a5b6527c0a92568e5');
});
test('SACRED: auditLog.js md5 intact', () => {
  assert.strictEqual(md5File(path.join(BASE,'lib/auditLog.js')),
    'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// ── 3. version ───────────────────────────────────────────────────────────────
test('package.json version >= 538', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(BASE,'package.json'),'utf8'));
  assert(parseInt(pkg.version) >= 538, 'got: ' + pkg.version);
});

// ── 4. server parse ──────────────────────────────────────────────────────────
test('ecos-api-server.js parses cleanly', () => {
  execFileSync(process.execPath, ['--check', path.join(BASE,'ecos-api-server.js')]);
});

// ── 5. module loads ──────────────────────────────────────────────────────────
test('aggregatedHeartbeatStatus538 module loads', () => {
  const mod = require(path.join(BASE,'lib/aggregatedHeartbeatStatus538.js'));
  assert.strictEqual(typeof mod.buildAggregatedStatus538, 'function');
  assert.ok(mod.AGGREGATE_VERSION_538.startsWith('538'));
});

// ── 6. buildAggregatedStatus538 with null Bridge → graceful degraded ─────────
test('buildAggregatedStatus538: null Bridge → degraded, no throw', () => {
  const { buildAggregatedStatus538 } = require(path.join(BASE,'lib/aggregatedHeartbeatStatus538.js'));
  const result = buildAggregatedStatus538({ Bridge532: null });
  assert.ok(!result.ok, 'should not be ok with null bridge');
  assert.strictEqual(result.level, 'unhealthy');
  assert.strictEqual(result.hbRunning, false);
  assert.strictEqual(result.ecosVersion, 'V538');
  assert.ok(typeof result.ts === 'string');
});

// ── 7. buildAggregatedStatus538 with mock activeHb532 running=true ────────────
test('buildAggregatedStatus538: mock hb running → hbRunning:true', () => {
  const { buildAggregatedStatus538 } = require(path.join(BASE,'lib/aggregatedHeartbeatStatus538.js'));
  // Simulate what Bridge532 looks like after V532 IIFE runs
  const mockHb = {
    getStatus: () => ({ running: true, intervalMs: 5000, ticks: 42, lastTick: Date.now() }),
  };
  const mockBridge = {
    activeBridge532: { name: 'mock-bridge' },
    activeHb532:     mockHb,
  };
  const result = buildAggregatedStatus538({ Bridge532: mockBridge });
  assert.ok(result.ok, 'should be ok; errors: ' + JSON.stringify(result.errors));
  assert.strictEqual(result.level,     'healthy');
  assert.strictEqual(result.hbRunning, true,  'hbRunning should be true');
  assert.strictEqual(result.hbLive,    true,  'hbLive should be true');
  assert.strictEqual(result.bridgeLive,true,  'bridgeLive should be true');
  assert.strictEqual(result.phases.hb532.ticks, 42);
});

// ── 8. buildAggregatedStatus538: bridge present, hb null → degraded ───────────
test('buildAggregatedStatus538: bridge live, hb null → degraded + hbRunning:false', () => {
  const { buildAggregatedStatus538 } = require(path.join(BASE,'lib/aggregatedHeartbeatStatus538.js'));
  const mockBridge = {
    activeBridge532: { name: 'mock-bridge' },
    activeHb532:     null,
  };
  const result = buildAggregatedStatus538({ Bridge532: mockBridge });
  assert.ok(!result.ok);
  assert.strictEqual(result.level,     'degraded');
  assert.strictEqual(result.hbRunning, false);
  assert.strictEqual(result.bridgeLive, true);
  assert.strictEqual(result.hbLive,    false);
});

// ── 9. hbFix field present in output ──────────────────────────────────────────
test('buildAggregatedStatus538 output contains hbFix description', () => {
  const { buildAggregatedStatus538 } = require(path.join(BASE,'lib/aggregatedHeartbeatStatus538.js'));
  const result = buildAggregatedStatus538({ Bridge532: null });
  assert.ok(typeof result.hbFix === 'string' && result.hbFix.includes('V534'),
    'hbFix should reference V534 bug');
});

// ── 10. lib and src/lib copies identical ─────────────────────────────────────
test('lib/ and src/lib/ copies of aggregatedHeartbeatStatus538 are identical', () => {
  const libPath = path.join(BASE,'lib/aggregatedHeartbeatStatus538.js');
  const srcPath = path.join(BASE,'src/lib/aggregatedHeartbeatStatus538.js');
  assert.ok(fs.existsSync(libPath), 'lib/ copy missing');
  assert.ok(fs.existsSync(srcPath), 'src/lib/ copy missing');
  assert.strictEqual(
    md5File(libPath), md5File(srcPath),
    'lib/ and src/lib/ copies differ'
  );
});

// ── Results ──────────────────────────────────────────────────────────────────
console.log('\n─────────────────────────');
console.log(`  Passed: ${passed} / ${passed + failed}`);
if (failed > 0) { console.error(`  Failed: ${failed}`); process.exit(1); }
else { console.log('  All tests passed ✓'); process.exit(0); }
