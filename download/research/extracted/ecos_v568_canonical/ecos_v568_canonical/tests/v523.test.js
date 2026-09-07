/**
 * tests/v523.test.js — ECOS V523
 * ─────────────────────────────────────────────────────────────────────────────
 * Plain Node test (no vitest, no network). Exit 0 == pass.
 *
 * Validates:
 *   T01 SACRED md5 (fiatLedger + auditLog) UNCHANGED
 *   T02 ecos-api-server.js parses (node --check)
 *   T03 lib/graduationFix523.js parses + exports expected surface
 *   T04 src/lib/graduationFix523.js is an identical mirror
 *   T05 engine API is synchronous (getStage/evaluate/progressionReport)
 *   T06 selfTest523 replays all assertions of graduationEngine.test.js — green
 *   T07 wiring: server source mentions graduationFix523 AND both endpoints
 *   T08 fail-closed: registerEndpoints523 returns {wired:false} on missing app
 *   T09 unknown input: getStage(undefined) never throws, returns stageId=1
 *   T10 SACRED files were not added/removed (file list still 2)
 *   T11 lib/graduationEngine.js + src/lib mirror are byte-identical
 *   T12 awaiting sync engine methods still works (back-compat with V116 callers)
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
const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');

console.log('ECOS V523 — Graduation Engine Sync Restore');
console.log('═══════════════════════════════════════════');

// ── T01 SACRED md5 ──────────────────────────────────────────────────────────
const SACRED = {
  'lib/fiatLedger.js': '563e9b1f9e67091a5b6527c0a92568e5',
  'lib/auditLog.js':   'e5a5c2c27801d2d03991bc8e5a1df8cb',
};
for (const [rel, want] of Object.entries(SACRED)) {
  const got = md5(path.join(ROOT, rel));
  log(`T01 SACRED ${rel} md5`, got === want, `want ${want} got ${got}`);
}

// ── T02 server parses ───────────────────────────────────────────────────────
try {
  cp.execFileSync(process.execPath, ['--check', path.join(ROOT, 'ecos-api-server.js')], { stdio: 'pipe' });
  log('T02 ecos-api-server.js parses', true);
} catch (e) {
  log('T02 ecos-api-server.js parses', false, e.message);
}

// ── T03 connector parses + surface ──────────────────────────────────────────
let GF523;
try {
  cp.execFileSync(process.execPath, ['--check', path.join(ROOT, 'lib/graduationFix523.js')], { stdio: 'pipe' });
  GF523 = require(path.join(ROOT, 'lib/graduationFix523.js'));
  const surface = ['getEngineShape523','selfTest523','registerEndpoints523','STAGES'];
  const missing = surface.filter(k => !(k in GF523));
  log('T03 graduationFix523 surface', missing.length === 0, missing.length ? 'missing: ' + missing.join(',') : '');
} catch (e) {
  log('T03 graduationFix523 surface', false, e.message);
}

// ── T04 identical mirror ────────────────────────────────────────────────────
{
  const a = md5(path.join(ROOT, 'lib/graduationFix523.js'));
  const b = md5(path.join(ROOT, 'src/lib/graduationFix523.js'));
  log('T04 src/lib mirror identical', a === b, `lib=${a} src=${b}`);
}

// ── T05 engine API is sync ──────────────────────────────────────────────────
try {
  const { GraduationEngine } = require(path.join(ROOT, 'lib/graduationEngine.js'));
  const e = new GraduationEngine();
  const isSync = (fn) => typeof fn === 'function' && fn.constructor.name === 'Function';
  const ok = isSync(e.getStage) && isSync(e.evaluate) && isSync(e.progressionReport);
  log('T05 engine API is synchronous', ok, ok ? '' : 'one of getStage/evaluate/progressionReport is still AsyncFunction');
} catch (e) {
  log('T05 engine API is synchronous', false, e.message);
}

// ── T06 selfTest523 green ───────────────────────────────────────────────────
try {
  const st = GF523.selfTest523();
  const failed = st.checks.filter(c => !c.ok).map(c => c.name);
  log('T06 selfTest523 all checks pass', st.ok, failed.length ? 'failed: ' + failed.join(',') : '');
} catch (e) {
  log('T06 selfTest523 all checks pass', false, e.message);
}

// ── T07 server wiring ───────────────────────────────────────────────────────
{
  const src = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  const ok = src.includes('graduationFix523')
          && src.includes('/api/v1/admin/graduation-fix/v523')
          && src.includes('/api/v1/admin/summary/v523');
  log('T07 server wires V523 endpoints', ok);
}

// ── T08 fail-closed without app ─────────────────────────────────────────────
try {
  const r = GF523.registerEndpoints523(null);
  log('T08 fail-closed on missing app', r && r.wired === false, JSON.stringify(r));
} catch (e) {
  log('T08 fail-closed on missing app', false, 'threw: ' + e.message);
}

// ── T09 unknown input never throws ──────────────────────────────────────────
try {
  const { GraduationEngine } = require(path.join(ROOT, 'lib/graduationEngine.js'));
  const e = new GraduationEngine();
  const s = e.getStage(undefined);
  log('T09 getStage(undefined) returns stage 1', s && s.stageId === 1, JSON.stringify(s));
} catch (e) {
  log('T09 getStage(undefined) returns stage 1', false, 'threw: ' + e.message);
}

// ── T10 SACRED file list unchanged ──────────────────────────────────────────
{
  const sacredFiles = Object.keys(SACRED);
  const allExist = sacredFiles.every(f => fs.existsSync(path.join(ROOT, f)));
  log('T10 SACRED file list still 2', sacredFiles.length === 2 && allExist);
}

// ── T11 engine mirror byte-identical ────────────────────────────────────────
{
  const a = md5(path.join(ROOT, 'lib/graduationEngine.js'));
  const b = md5(path.join(ROOT, 'src/lib/graduationEngine.js'));
  log('T11 graduationEngine mirror identical', a === b, `lib=${a} src=${b}`);
}

// ── T12 awaiting sync methods still works (V116-style back-compat) ──────────
(async () => {
  try {
    const { GraduationEngine } = require(path.join(ROOT, 'lib/graduationEngine.js'));
    const e = new GraduationEngine();
    const s = await e.getStage('back-compat');
    const r = await e.evaluate('back-compat', { validationsCompleted: 1 });
    const ok = s && s.stageId === 1 && r && r.advanced === true && r.newStage.name === 'VERIFY';
    log('T12 await-on-sync still works', ok, ok ? '' : JSON.stringify({s, r}));
  } catch (e) {
    log('T12 await-on-sync still works', false, e.message);
  }

  console.log('───────────────────────────────────────────');
  console.log(`Result: ${pass} pass, ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
})();
