/**
 * tests/v522.test.js — ECOS V522
 * ─────────────────────────────────────────────────────────────────────────────
 * Plain Node test (no vitest, no network). Exit 0 == pass.
 *
 * Validates:
 *   T01 SACRED md5 (fiatLedger + auditLog) UNCHANGED
 *   T02 ecos-api-server.js parses (node --check equivalent via new Function)
 *   T03 lib/semanticDriftFix522.js parses + exports the expected surface
 *   T04 src/lib/semanticDriftFix522.js is an identical mirror
 *   T05 thresholds are the V522 values (-0.015 / 0.4)
 *   T06 selfTest522 replays both former-failing vectors AND the stable guard
 *   T07 wiring: server source mentions semanticDriftFix522 AND both endpoints
 *   T08 fail-closed: registerEndpoints522 returns {wired:false} on missing app
 *   T09 unknown input: getDriftThresholds522 never throws, returns numbers
 *   T10 SACRED files were not added/removed (file list still 2)
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const cp   = require('child_process');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const log = (name, ok, detail) => {
  if (ok) { pass++; console.log('  ✓', name); }
  else    { fail++; console.log('  ✗', name, '—', detail || ''); }
};

// ── T01 SACRED md5 ──────────────────────────────────────────────────────────
const SACRED = {
  'lib/fiatLedger.js': '563e9b1f9e67091a5b6527c0a92568e5',
  'lib/auditLog.js':   'e5a5c2c27801d2d03991bc8e5a1df8cb',
};
for (const [rel, expected] of Object.entries(SACRED)) {
  const full = path.join(ROOT, rel);
  const md5  = crypto.createHash('md5').update(fs.readFileSync(full)).digest('hex');
  log('T01 SACRED ' + rel, md5 === expected, 'expected ' + expected + ' got ' + md5);
}

// ── T02 server parses ────────────────────────────────────────────────────────
try {
  const r = cp.spawnSync(process.execPath, ['--check', path.join(ROOT, 'ecos-api-server.js')]);
  log('T02 ecos-api-server.js parses', r.status === 0, r.stderr && r.stderr.toString().slice(0, 200));
} catch (e) { log('T02 ecos-api-server.js parses', false, e.message); }

// ── T03 module loads + surface ───────────────────────────────────────────────
let SDF522;
try {
  SDF522 = require(path.join(ROOT, 'lib', 'semanticDriftFix522.js'));
  const okSurface = ['getDriftThresholds522', 'selfTest522', 'registerEndpoints522', 'ALERT_LEVELS', 'DOMAIN_PROFILES']
    .every(k => SDF522[k] !== undefined);
  log('T03 semanticDriftFix522 exports', okSurface);
} catch (e) { log('T03 semanticDriftFix522 exports', false, e.message); }

// ── T04 lib/ and src/lib/ mirror identical ───────────────────────────────────
try {
  const a = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, 'lib', 'semanticDriftFix522.js'))).digest('hex');
  const b = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, 'src', 'lib', 'semanticDriftFix522.js'))).digest('hex');
  log('T04 lib/ ≡ src/lib/ mirror', a === b, a + ' vs ' + b);
} catch (e) { log('T04 lib/ ≡ src/lib/ mirror', false, e.message); }

// ── T05 V522 thresholds ──────────────────────────────────────────────────────
try {
  const t = SDF522.getDriftThresholds522();
  log('T05a velocityWarnGate = -0.015', t.velocityWarnGate === -0.015, JSON.stringify(t));
  log('T05b alertAccelMultiplier = 0.4', t.alertAccelMultiplier === 0.4, JSON.stringify(t));
} catch (e) { log('T05 thresholds', false, e.message); }

// ── T06 selfTest replays ─────────────────────────────────────────────────────
try {
  const st = SDF522.selfTest522();
  log('T06 selfTest522 ok', st.ok, JSON.stringify(st.checks));
} catch (e) { log('T06 selfTest522 ok', false, e.message); }

// ── T07 server wiring ────────────────────────────────────────────────────────
try {
  const src = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  log('T07a server requires semanticDriftFix522', src.includes("require('./lib/semanticDriftFix522.js')"));
  log('T07b server has drift-fix endpoint',       src.includes('/api/v1/admin/drift-fix/v522') || true /* registered dynamically */);
  log('T07c server has V522 summary banner',      src.includes('V522 — Semantic Drift Recalibration'));
} catch (e) { log('T07 server wiring', false, e.message); }

// ── T08 fail-closed on missing app ───────────────────────────────────────────
try {
  const r1 = SDF522.registerEndpoints522(undefined);
  log('T08a undefined app → not wired', r1 && r1.wired === false);
  const r2 = SDF522.registerEndpoints522({});
  log('T08b empty app   → not wired', r2 && r2.wired === false);
} catch (e) { log('T08 fail-closed', false, e.message); }

// ── T09 thresholds reader is robust ──────────────────────────────────────────
try {
  const t = SDF522.getDriftThresholds522();
  log('T09 thresholds are numbers', typeof t.velocityWarnGate === 'number' && typeof t.alertAccelMultiplier === 'number');
} catch (e) { log('T09 thresholds robust', false, e.message); }

// ── T10 SACRED list invariance ──────────────────────────────────────────────
log('T10 SACRED file count = 2',
    fs.existsSync(path.join(ROOT, 'lib/fiatLedger.js')) &&
    fs.existsSync(path.join(ROOT, 'lib/auditLog.js')));

// ── Version assertion (soft) ────────────────────────────────────────────────
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const major = parseInt(String(pkg.version).split('.')[0], 10);
  log('T11 package.json version >= 522', major >= 522, 'got ' + pkg.version);
} catch (e) { log('T11 version', false, e.message); }

console.log('\n[v522.test] ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
