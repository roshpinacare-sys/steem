#!/usr/bin/env node
/* reclaim-lost-soldiers.cjs — כלי-החזרת-ההון-התקוע (owner directive 2026-10-04, trace 1a108e28015b0451)
 * ══════════════════════════════════════════════════════════════════════════════════════════════════
 * הבעיה החיה (נמדד 2026-10-04): hcsoldier1/2/3 — חיילי-דור-אבוד (LOST-NO-CUSTODY, אומת 3
 * פעמים, אין-שום-חומר-מפתח, אפס-עוגני-רשות) — מחזיקים על-השרשרת:
 *   · 18.667 STEEM + 0.139 SBD כ"א (~56 STEEM סה"כ) — בלתי-ניתנים-להחזרה בלי-מפתחות
 *   · האצלות-SP טריות שנחתמו אוטומטית אחר-הפסק-המשמורת: 9928 + 9928 + 10033 VESTS (~5 SP)
 * הכלי: מחזיר את ההאצלות (delegate_vesting_shares → 0) מחזרה לאוצר headcorner.
 *   · ה-SP המואצל חוזר אחרי 7-ימים (חוק-השרשרת) — כנות-מלאה בקבלה.
 *   · היתרות-הנזילות של האבודים אינן-ניתנות-להחזרה — נשארות על-השרשרת כהוכחת-העבר.
 *
 * שערי-בטיחות (ברזל):
 *   1. DRY כברירת-מחדל — --live בלבד לשידור.
 *   2. live_gate מלא: --live + HE_LIVE_CONFIRM=headcorner נדרשים יחד (אין-ברירת-מחדל).
 *   3. STASIS: כשהבלם פעיל, הכלי מסרב — חוץ-מריצה-אחת-מפורשת עם
 *      OWNER_DIRECTIVE=RECLAIM-LOST-SOLDIERS-2026-10-04 (מילת-הבעלים המתועדת —
 *      היא גם רשומת-ההתחדשות של הבלם לפעולה-זו-בלבד).
 *   4. סורג-בייטים: ה-WIF הנגזר מול active.key_auths חי של headcorner → בלב-חתימה.
 *   5. יעדים מקובעים בקוד (hcsoldier1/2/3) — אין-קלט-חופשי; פעולה אחת בלבד: החזרה-ל-0.
 *   6. אפס-סודות בלוג/קבלה · קריאה-חוזרת לכל-האצלה.
 *
 * ריצה:  AGENT_ACCOUNT=headcorner node agent/reclaim-lost-soldiers.cjs          (DRY — בטוח)
 *        AGENT_ACCOUNT=headcorner HE_LIVE_CONFIRM=headcorner OWNER_DIRECTIVE=RECLAIM-LOST-SOLDIERS-2026-10-04 \
 *          node agent/reclaim-lost-soldiers.cjs --live                          (חי — לאחר-אישור-הבעלים)
 */
'use strict';
if (!process.env.AGENT_ACCOUNT) { console.error('usage: AGENT_ACCOUNT=<account> node agent/reclaim-lost-soldiers.cjs — no default acting account'); process.exit(1); }
const fs = require('fs');
const path = require('path');
const steem = require('steem');
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');

steem.api.setOptions({ url: 'https://api.steemit.com' });
const GATE = resolveLiveGate(process.argv);
const LIVE = GATE.live;
const ACCOUNT = (process.env.AGENT_ACCOUNT || '').toLowerCase();
const OWNER_DIRECTIVE_TOKEN = 'RECLAIM-LOST-SOLDIERS-2026-10-04';
const TARGETS = Object.freeze(['hcsoldier1', 'hcsoldier2', 'hcsoldier3']); // מקובע — אין-קלט-חופשי
const capGate = require('./lib/capital_gate.cjs');
const OUT = path.join(__dirname, 'reclaim_lost_soldiers_result.json');
announceGate(GATE, (m) => console.log(m));

let activeWif = process.env.ACTIVE_WIF || '';
try {
  const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  if (!activeWif) activeWif = (env.match(/^ACTIVE_WIF=(.+)$/m) || [])[1]?.trim() || '';
} catch (_) { /* אין .env */ }

const P = (fn) => new Promise((res, rej) => fn((e, r) => (e ? rej(e) : res(r))));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('=== reclaim-lost-soldiers · ' + (LIVE ? 'LIVE' : 'DRY') + ' · @' + ACCOUNT + ' ===');
  // שער 3: הבלם — מסרב גם ב-DRY? לא: DRY הוא מדידה בלבד. חי בלי מילת-בעלים = מסרב.
  const stasis = capGate.stasisState();
  if (LIVE && stasis.active === true && process.env.OWNER_DIRECTIVE !== OWNER_DIRECTIVE_TOKEN) {
    console.log('[CAPITAL-GATE] REFUSED live run — STASIS active and OWNER_DIRECTIVE token absent (' + OWNER_DIRECTIVE_TOKEN + '). Run DRY or present the owner word.');
    process.exit(1);
  }

  if (!activeWif && LIVE) { console.log('FATAL: no ACTIVE_WIF (env or agent/.env) — live run impossible'); process.exit(1); }
  if (!activeWif) console.log('[dry] no ACTIVE_WIF present — keyless DRY measurement (honest), no broadcast anyway');
  else {
    const [head] = await P((cb) => steem.api.getAccounts([ACCOUNT], cb));
    if (!head) { console.log('FATAL: head account absent from chain'); process.exit(1); }
    let actOk = false;
    try { actOk = steem.auth.wifToPublic(activeWif) === head.active.key_auths[0][0]; } catch (_) {}
    console.log('[byte-gate] derived active vs live key_auths: ' + actOk);
    if (!actOk) { console.log('GATE FAIL — no broadcast, honest exit'); process.exit(1); }
  }

  const ratio = parseFloat((await P((cb) => steem.api.getDynamicGlobalProperties(cb))).total_vesting_fund_steem) /
    parseFloat((await P((cb) => steem.api.getDynamicGlobalProperties(cb))).total_vesting_shares);

  const results = []; let reclaimed = 0, failed = 0, nothing = 0;
  for (const name of TARGETS) {
    const R = { target: name, action: 'reclaim-delegation-to-zero' };
    try {
      // שוער-רוסטר: היעד חייב להיות אסור-הון בדיוק-מהסיבה-הנכונה (הגנה-מפני-טעות-ברשימה)
      const guard = capGate.guardTargets('reclaim-lost-soldiers', [name], 'steem');
      if (guard.allowed.length !== 0) throw new Error('guard mismatch: target is not on the ban list — refusing (the tool reclaims ONLY banned-lost accounts)');
      const [sa] = await P((cb) => steem.api.getAccounts([name], cb));
      if (!sa) { R.status = 'ABSENT-FROM-CHAIN'; nothing++; }
      else {
        const have = parseFloat(sa.received_vesting_shares);
        R.haveVests = have; R.haveSp = +(have * ratio).toFixed(3);
        R.liquidStranded = sa.balance + ' / ' + sa.sbd_balance + ' (unrecoverable without keys — honest note)';
        if (!have || have < 1) { R.status = 'NOTHING-TO-RECLAIM'; nothing++; }
        else if (!LIVE) { R.status = 'DRY-WOULD-RECLAIM'; }
        else {
          await P((cb) => steem.broadcast.delegateVestingShares(activeWif, ACCOUNT, name, '0.000000 VESTS', cb));
          await sleep(2500);
          const [sa2] = await P((cb) => steem.api.getAccounts([name], cb));
          const left = parseFloat(sa2.received_vesting_shares);
          R.status = left < have * 0.5 ? 'RECLAIMED-VERIFIED' : 'NO-READBACK';
          R.leftVests = left;
          if (R.status === 'RECLAIMED-VERIFIED') reclaimed++; else failed++;
        }
      }
    } catch (e) { R.status = 'FAIL'; R.err = String(e.message || e).slice(0, 140); failed++; }
    results.push(R);
    console.log('[' + R.status + '] headcorner ↩ @' + name + (R.haveSp != null ? ' (' + R.haveSp + ' SP pending return within 7 days of reclaim)' : ''));
    await sleep(400);
  }

  capGate.journal('reclaim-lost-soldiers', { live: LIVE, ownerDirective: LIVE && stasis.active ? OWNER_DIRECTIVE_TOKEN : null, targets: TARGETS, reclaimed, nothing, failed, results });
  const receipt = {
    ok: true, tool: 'reclaim-lost-soldiers.cjs', at: new Date().toISOString(), live: LIVE,
    stasisWasActive: stasis.active === true, ownerDirective: LIVE && stasis.active ? OWNER_DIRECTIVE_TOKEN : null,
    doctrine: 'the lost generation (hcsoldier1/2/3, LOST-NO-CUSTODY) must not hold fleet capital; delegations return to the treasury, liquid stranded balances stay on-chain as proof-of-past (unrecoverable without keys)',
    results, totals: { reclaimed, nothing, failed },
  };
  fs.writeFileSync(OUT, JSON.stringify(receipt, null, 1) + '\n');
  console.log('receipt → ' + OUT + ' · reclaimed=' + reclaimed + ' nothing=' + nothing + ' failed=' + failed);
  process.exit(0); // fail-soft
}

main().catch((e) => { console.error('[reclaim-lost] fatal:', String(e.message || e).slice(0, 180)); process.exit(0); });
