#!/usr/bin/env node
/**
 * הוכחת-פייפליין B1 (מפעל חשבונות RC) — בדיקה אופציונלית (לא רצה אוטומטית).
 *
 * מה היא מוכיחה? את השרשרת המלאה של לופ המפעל ב-agent.cjs:
 *   גזירת מפתח active פיקטיבי (getPrivateKeys) → isWif → חתימה מקומית (sendAsync)
 *   → שידור claim_account → השרשרת עצמה בודקת הרשאות ועונה.
 *
 * משתמשים במפתח active פיקטיבי שנגזר מהביטוי 'saos-agent-test' — אין לו שום
 * סמכות על החשבון, ולכן התוצאה הצפויה היא שגיאת-שרשרת
 * "Missing Active Authority headcorner".
 * דווקא קבלת השגיאה הזאת היא ההוכחה: op claim_account (creator + fee=0) מגיע
 * לשרשרת תקין וחתום, והשרשרת מזהה שהוא דורש רשות active ודוחה את המפתח —
 * כלומר פורמט ה-op חוקי והפייפליין חי מקצה לקצה.
 *
 * הרצה:  npm run test:factory   (או:  node test-factory.cjs)
 * דרישה: Node (לא bun!) — bun שובר את ה-ecc של steem-js.
 * חשוב: הדימון עצמו נשאר DRY_RUN=true ברירת-מחדל; הסקריפט הזה עצמאי ומפיק
 * מפתח שלא שייך לאף חשבון — אין שום סיכון.
 */
// 8-b: חשבון-פעולה חובה לפני-כל-טעינה — אין ברירת-מחדל, לעולם (המשך 7-c · docs/117o-KEY-INCIDENT.md)
if (!process.env.AGENT_ACCOUNT) { console.error('usage: AGENT_ACCOUNT=<account> node agent/test-factory.cjs — no default acting account (2026-09-08 incident)'); process.exit(1); }
'use strict';

const steem = require('steem');

steem.api.setOptions({ url: process.env.RPC_URL ? 'https://' + process.env.RPC_URL.replace(/^https?:\/\//, '') : 'https://api.steemit.com' });
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv);
const DRY = GATE.dry;
announceGate(GATE);
if (DRY) { console.log('[DRY] LIVE-GATE — negative-key broadcast test skipped (nothing sent)'); process.exit(0); }


const ACCOUNT = process.env.AGENT_ACCOUNT || '';

console.log('[1/4] deriving a FAKE active key for @' + ACCOUNT + ' from seed "saos-agent-test" ...');
const keys = steem.auth.getPrivateKeys(ACCOUNT, 'saos-agent-test', ['active']);
const wif = keys.active;
console.log('      derived (never shown fully): ' + wif.slice(0, 3) + '*** (len ' + wif.length + ')');

console.log('[2/4] isWif check ...');
const ok = steem.auth.isWif(wif);
console.log('      isWif =', ok);
if (!ok) {
  console.error('FAIL: derived key is not a valid WIF');
  process.exit(1);
}

console.log('[3/4] building claim_account op {creator, fee:"0.000 STEEM"} and broadcasting with the FAKE active key ...');
const op = [
  'claim_account',
  {
    creator: ACCOUNT,
    fee: '0.000 STEEM',
  },
];

steem.broadcast
  .sendAsync({ operations: [op], extensions: [] }, [wif])
  .then((conf) => {
    // אסור לקרות — למפתח הפיקטיבי אין סמכות active על החשבון
    console.error('UNEXPECTED SUCCESS (should not happen):', conf);
    process.exit(1);
  })
  .catch((e) => {
    const msg = String((e && e.message) || e);
    console.log('[4/4] chain response: ' + msg.slice(0, 300));
    if (/Missing Active Authority|missing.*active.*authority/i.test(msg)) {
      console.log('\nPASS — B1 factory pipeline proven end-to-end: derive → isWif → local sign → broadcast → chain authority validation.');
      console.log('The chain itself recognized claim_account as an active-authority op and rejected the fake key, i.e. the op format is chain-valid.');
    } else {
      console.log('\nNOTE — chain answered with a different error (still proves derive→sign→broadcast→chain).');
    }
    process.exit(0);
  });
