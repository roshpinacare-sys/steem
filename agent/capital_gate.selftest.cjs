'use strict';
/**
 * capital_gate.selftest.cjs — וקטורים דטרמיניסטיים אופליין לשער-ההון המודע-מסילות (staged lanes)
 *   node agent/capital_gate.selftest.cjs  → אפס-רשת, אפס-מפתחות, אפס-כתיבה-למדינה-החיה
 *   (השער נבדק תמיד על עותק-חול שלו + STASIS.json פיקטיבי — המדינה-החיה לא נוגעת)
 * נולד ב-T-B (owner directive 2026-10-05, trace 1a10bfe1342b2391 — staged re-entry):
 * הבלם נשאר active=true; mode=staged פותח רק מסילות-מפורטות; כל-כישלון-קריאה = עצירה.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SRC = path.join(__dirname, 'lib', 'capital_gate.cjs');

let failures = 0;
function t(name, ok) {
  console.log(`${ok ? ' ✓' : ' ✗'} ${name}`);
  if (!ok) failures++;
}

/* חול: עותק-בתים של השער + STASIS.json פיקטיבי (השער קורא path.join(__dirname,'..','STASIS.json')) */
const SANDBOXES = [];
function loadWith(doc, captured) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capgate-selftest-'));
  SANDBOXES.push(root);
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'lib', 'capital_gate.cjs'), fs.readFileSync(SRC, 'utf8'));
  if (doc !== null && doc !== undefined) {
    fs.writeFileSync(path.join(root, 'STASIS.json'),
      typeof doc === 'string' ? doc : JSON.stringify(doc, null, 2));
  }
  const origLog = console.log;
  console.log = (...a) => { captured.lines.push(a.join(' ')); };
  try {
    delete require.cache[require.resolve(path.join(root, 'lib', 'capital_gate.cjs'))];
    return require(path.join(root, 'lib', 'capital_gate.cjs'));
  } finally { console.log = origLog; }
}

const STAGED = (allow) => ({
  protocol: 'SAOS-FATE-DEFENSE-STASIS/1', active: true, mode: 'staged',
  reason: 'selftest staged brake', since: '2026-10-05T00:00:00Z',
  stagedLanes: { allow, reason: 'selftest', since: '2026-10-05T00:00:00Z' },
});

function withCapture(fn, captured) {
  const origLog = console.log;
  console.log = (...a) => { captured.lines.push(a.join(' ')); };
  try { return fn(); } finally { console.log = origLog; }
}

const captured = { lines: [] };

/* 1) מורשת: active=true בלי-mode → עצירה מלאה גם-לכלי-תביעות */
let g = loadWith({ protocol: 'SAOS-FATE-DEFENSE-STASIS/1', active: true, reason: 'full brake' }, captured);
t('legacy active=true (no mode) halts even a claims tool', g.stasisHalt('agent:claim') === true);

/* 2) staged + מסילת-claims פתוחה → כלי-התביעות מותר עם קבלת STASIS-STAGED-ALLOW */
captured.lines.length = 0;
g = loadWith(STAGED(['grid', 'claims']), captured);
let ok = withCapture(() => g.stasisHalt('agent:claim') === false && g.stasisHalt('fleet-claim') === false, captured);
t('staged + allowed lane (claims) lets claim tools sign', ok);
t('allow path prints the STASIS-STAGED-ALLOW receipt with the lane', captured.lines.some((l) => /STASIS-STAGED-ALLOW agent:claim \(lane=claims\)/.test(l)));

/* 3) staged + מסילת-grid פתוחה → מכונת-הסולם מותרת */
captured.lines.length = 0;
g = loadWith(STAGED(['grid', 'claims']), captured);
ok = withCapture(() => g.stasisHalt('ladder-refresh') === false, captured) && captured.lines.some((l) => /STASIS-STAGED-ALLOW ladder-refresh \(lane=grid\)/.test(l));
t('staged + allowed lane (grid) lets the ladder machine sign', ok);

/* 4) staged + כלי-לא-מוכר → עצירה (fail-closed) */
captured.lines.length = 0;
g = loadWith(STAGED(['grid', 'claims']), captured);
ok = withCapture(() => g.stasisHalt('totally-unknown-tool') === true, captured) && captured.lines.some((l) => /STASIS-HALT totally-unknown-tool \(lane=general\)/.test(l));
t('staged + unknown tool halts on the general lane', ok);

/* 5) staged + כלי-האצלה/העברה → עצירה (המסילות-האסורות-נשארות-סגורות) */
g = loadWith(STAGED(['grid', 'claims']), captured);
t('staged does NOT open head-delegate (general lane)', g.stasisHalt('head-delegate') === true);
t('staged does NOT open agent:payroll (general lane)', g.stasisHalt('agent:payroll') === true);
t('staged does NOT open wrapped:sbd-buy (general lane)', g.stasisHalt('wrapped:sbd-buy') === true);

/* 6) active=true + mode=full → עצירה גם-למסילה-רשומה (הדגל-הראשי מנצח) */
g = loadWith({ protocol: 'SAOS-FATE-DEFENSE-STASIS/1', active: true, mode: 'full', reason: 'full brake', stagedLanes: { allow: ['claims'] } }, captured);
t('mode=full halts even a listed lane', g.stasisHalt('agent:claim') === true);

/* 7) קובץ-חסר → עצירה fail-closed */
g = loadWith(null, captured);
t('missing stasis file halts — fail-closed', g.stasisHalt('agent:claim') === true);

/* 8) קובץ-שבור → עצירה fail-closed */
g = loadWith('{ this is not json', captured);
t('corrupt stasis file halts — fail-closed', g.stasisHalt('ladder-refresh') === true);

/* 9) הדגל-הראשי active=false → מותר (תאימות-אחורה מלאה) */
g = loadWith({ protocol: 'SAOS-FATE-DEFENSE-STASIS/1', active: false, reason: 'lifted' }, captured);
t('active=false still allows (full-lift backward compat)', g.stasisHalt('agent:claim') === false && g.stasisHalt('ladder-refresh') === false && g.stasisHalt('head-delegate') === false);

/* 10) laneOf — המיפוי-המפורש עצמו */
g = loadWith(STAGED(['claims']), captured);
ok = g.laneOf('agent:claim') === 'claims' && g.laneOf('agent:army-claim') === 'claims' && g.laneOf('fleet-claim') === 'claims'
  && g.laneOf('head-revive:claim') === 'claims' && g.laneOf('fleetv3-autopilot:claim') === 'claims'
  && g.laneOf('ladder-refresh') === 'grid'
  && g.laneOf('head-delegate') === 'general' && g.laneOf('agent:army-sweep') === 'general'
  && g.laneOf('agent:factory-claim-account') === 'general' && g.laneOf('') === 'general' && g.laneOf(undefined) === 'general';
t('laneOf maps by audited op class; unknown → general', ok);

/* 11) תאימות: STASIS.json אמיתי-בבית-זה (mode=staged, active=true) → הסולם-והתביעות מותרות, יתר עצור */
const live = require(SRC);
t('live home file: staged lanes grid+claims honored (ladder-refresh allowed)', live.stasisHalt('ladder-refresh') === false);
t('live home file: general lane still halts (head-delegate)', live.stasisHalt('head-delegate') === true);

for (const s of SANDBOXES) fs.rmSync(s, { recursive: true, force: true });
console.log(failures ? 'capital_gate.selftest: FAIL' : 'capital_gate.selftest: all vectors PASS');
process.exit(failures ? 1 : 0);
