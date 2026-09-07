'use strict';
/**
 * tests/v524.test.js — ECOS V524 — Plain Node, exit-code truth
 *
 * Verifies the V524 vitest-shim matcher extensions:
 *  T01 SACRED md5 unchanged (lib/fiatLedger.js, lib/auditLog.js)
 *  T02 server parse OK
 *  T03 connector loads (lib/notificationFix524.js)
 *  T04 mirror lib/ ↔ src/lib/ byte-identical
 *  T05 selfTest524 reports ok:true and all checks pass
 *  T06 IIFE wiring text present in ecos-api-server.js
 *  T07 shim has .resolves.not chained handler
 *  T08 shim has all 5 new mock matchers
 *  T09 notification.test.js passes under plain `node` (the target realFail)
 *  T10 fail-closed: bad app object → registerEndpoints524 returns wired:false
 *  T11 version is >= 524 in package.json
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
let NF524;
try { NF524 = require('../lib/notificationFix524.js'); log('T03 connector loads', true); }
catch (e) { log('T03 connector loads', false, e.message); }

// T04 mirror byte-identical
try {
  const a = md5(path.join(ROOT, 'lib/notificationFix524.js'));
  const b = md5(path.join(ROOT, 'src/lib/notificationFix524.js'));
  log('T04 lib<->src mirror identical', a === b, a + ' vs ' + b);
} catch (e) { log('T04 lib<->src mirror identical', false, e.message); }

// T05 selfTest524 ok
try {
  const st = NF524.selfTest524();
  log('T05 selfTest524 ok', st.ok === true, st.checks.filter(c => !c.ok).map(c=>c.name).join(',') || 'all '+st.count+' pass');
} catch (e) { log('T05 selfTest524 ok', false, e.message); }

// T06 IIFE wiring
try {
  const srv = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  log('T06 V524 IIFE wired', srv.includes('_wireNotificationFix524') && srv.includes("'./lib/notificationFix524.js'"));
} catch (e) { log('T06 V524 IIFE wired', false, e.message); }

// T07 .resolves.not chain handler
try {
  const shim = fs.readFileSync(path.join(ROOT, 'node_modules/vitest/index.mjs'), 'utf8');
  log('T07 shim .resolves.not chained', shim.includes('_resolvesHandler') && shim.includes('_rejectsHandler'));
} catch (e) { log('T07 shim .resolves.not chained', false, e.message); }

// T08 mock matchers
try {
  const shim = fs.readFileSync(path.join(ROOT, 'node_modules/vitest/index.mjs'), 'utf8');
  const all = ['toHaveBeenCalled:','toHaveBeenCalledOnce:','toHaveBeenCalledTimes:','toHaveBeenCalledWith:','toHaveBeenLastCalledWith:'];
  const miss = all.filter(m => !shim.includes(m));
  log('T08 shim mock matchers', miss.length === 0, miss.length ? 'missing: ' + miss.join(',') : 'all 5 present');
} catch (e) { log('T08 shim mock matchers', false, e.message); }

// T09 notification.test.js passes under plain node
try {
  execSync('NODE_ENV=test node ' + JSON.stringify(path.join(ROOT, 'tests/notification.test.js')), { stdio: 'pipe', timeout: 30000 });
  log('T09 notification.test.js exit 0', true);
} catch (e) { log('T09 notification.test.js exit 0', false, 'exit ' + (e.status || '?')); }

// T10 fail-closed
try {
  const w1 = NF524.registerEndpoints524(null);
  const w2 = NF524.registerEndpoints524({});
  log('T10 fail-closed bad app', w1 && w1.wired === false && w2 && w2.wired === false);
} catch (e) { log('T10 fail-closed bad app', false, e.message); }

// T11 version >= 524
try {
  const pj = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const major = parseInt(String(pj.version).split('.')[0], 10);
  log('T11 package.json version >= 524', major >= 524, 'got ' + pj.version);
} catch (e) { log('T11 package.json version >= 524', false, e.message); }

// T12 SACRED md5 unchanged (sentinel)
try {
  let ok = true;
  for (const [f, want] of Object.entries(SACRED)) if (md5(path.join(ROOT, f)) !== want) ok = false;
  log('T12 SACRED md5 sentinel', ok);
} catch (e) { log('T12 SACRED md5 sentinel', false, e.message); }

console.log('---');
console.log('V524 tests: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail === 0 ? 0 : 1);
