'use strict';
/**
 * tests/v525.test.js — ECOS V525 — Plain Node, exit-code truth
 *
 * Verifies the V525 agent-require ESM bridge restore:
 *  T01 SACRED md5 unchanged (lib/fiatLedger.js, lib/auditLog.js)
 *  T02 server parse OK
 *  T03 connector loads (lib/agentRequireFix525.js)
 *  T04 mirror lib/ <-> src/lib/ byte-identical
 *  T05 selfTest525 reports ok:true and all checks pass
 *  T06 IIFE wiring text present in ecos-api-server.js
 *  T07 agent.test.js has `createRequire` import
 *  T08 agent.test.js has `const require = createRequire(import.meta.url)`
 *  T09 agent.test.js no longer reports `require is not defined` (the target realFail)
 *  T10 fail-closed: bad app object -> registerEndpoints525 returns wired:false
 *  T11 version is >= 525 in package.json
 *  T12 SACRED md5 unchanged (re-check, anti-regression sentinel)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const log = (n, ok, info) => { (ok ? pass++ : fail++); console.log((ok?'ok  ':'FAIL') + ' ' + n + (info?' :: '+info:'')); };
const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');

// T01 SACRED md5 unchanged
const SACRED = {
  'lib/fiatLedger.js': '563e9b1f9e67091a5b6527c0a92568e5',
  'lib/auditLog.js':   'e5a5c2c27801d2d03991bc8e5a1df8cb',
};
let sacredOk = true;
for (const [f, want] of Object.entries(SACRED)) {
  const got = md5(path.join(ROOT, f));
  if (got !== want) { sacredOk = false; log('T01 SACRED ' + f, false, got + ' != ' + want); }
}
if (sacredOk) log('T01 SACRED md5 unchanged', true);

// T02 server parse OK
try {
  execSync('node --check ' + JSON.stringify(path.join(ROOT, 'ecos-api-server.js')), { stdio: 'pipe' });
  log('T02 ecos-api-server.js parse', true);
} catch (e) { log('T02 ecos-api-server.js parse', false, e.message); }

// T03 connector loads
let ARF525;
try { ARF525 = require('../lib/agentRequireFix525.js'); log('T03 connector loads', true); }
catch (e) { log('T03 connector loads', false, e.message); }

// T04 mirror byte-identical
try {
  const a = md5(path.join(ROOT, 'lib/agentRequireFix525.js'));
  const b = md5(path.join(ROOT, 'src/lib/agentRequireFix525.js'));
  log('T04 lib<->src mirror identical', a === b, a + ' vs ' + b);
} catch (e) { log('T04 lib<->src mirror identical', false, e.message); }

// T05 selfTest525 ok
try {
  const st = ARF525.selfTest525();
  log('T05 selfTest525 ok', st.ok === true, st.checks.filter(c => !c.ok).map(c=>c.name).join(',') || 'all '+st.count+' pass');
} catch (e) { log('T05 selfTest525 ok', false, e.message); }

// T06 IIFE wiring
try {
  const srv = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  log('T06 V525 IIFE wired', srv.includes('_wireAgentRequireFix525') && srv.includes("'./lib/agentRequireFix525.js'"));
} catch (e) { log('T06 V525 IIFE wired', false, e.message); }

// T07 createRequire import
try {
  const src = fs.readFileSync(path.join(ROOT, 'tests/agent.test.js'), 'utf8');
  log('T07 agent.test.js has createRequire import', /import\s*\{\s*createRequire\s*\}\s*from\s*['"]module['"]/.test(src));
} catch (e) { log('T07 agent.test.js has createRequire import', false, e.message); }

// T08 require bridge
try {
  const src = fs.readFileSync(path.join(ROOT, 'tests/agent.test.js'), 'utf8');
  log('T08 agent.test.js has require bridge', /const\s+require\s*=\s*createRequire\s*\(\s*import\.meta\.url\s*\)/.test(src));
} catch (e) { log('T08 agent.test.js has require bridge', false, e.message); }

// T09 target realFail no longer reports `require is not defined`
try {
  let out = '';
  try {
    out = execSync('NODE_ENV=test node ' + JSON.stringify(path.join(ROOT, 'tests/agent.test.js')),
                   { cwd: ROOT, stdio: 'pipe', timeout: 60000 }).toString();
  } catch (e) {
    out = (e.stdout ? e.stdout.toString() : '') + (e.stderr ? e.stderr.toString() : '');
  }
  const hasOldError = /require is not defined/i.test(out);
  log('T09 agent.test.js no `require is not defined`', !hasOldError,
      hasOldError ? 'still present' : 'gone');
} catch (e) { log('T09 agent.test.js no `require is not defined`', false, e.message); }

// T10 fail-closed
try {
  const r1 = ARF525.registerEndpoints525(null);
  const r2 = ARF525.registerEndpoints525({});
  log('T10 fail-closed on bad app', r1.wired === false && r2.wired === false,
      JSON.stringify({r1, r2}));
} catch (e) { log('T10 fail-closed on bad app', false, e.message); }

// T11 version >= 525
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const v = parseInt(String(pkg.version).split('.')[0], 10);
  log('T11 package.json version >= 525', v >= 525, 'got=' + pkg.version);
} catch (e) { log('T11 package.json version >= 525', false, e.message); }

// T12 SACRED sentinel re-check
let sacredOk2 = true;
for (const [f, want] of Object.entries(SACRED)) {
  try { if (md5(path.join(ROOT, f)) !== want) sacredOk2 = false; } catch (_) { sacredOk2 = false; }
}
log('T12 SACRED md5 re-check', sacredOk2);

console.log('\n[V525] ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
