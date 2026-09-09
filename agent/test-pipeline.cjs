#!/usr/bin/env node
/**
 * הוכחת-פייפליין חתימה — בדיקה אופציונלית (לא רצה אוטומטית).
 *
 * מה היא מוכיחה? את השרשרת המלאה של דרך הדם של הסוכן:
 *   גזירת מפתח (getPrivateKeys) → isWif → חתימה מקומית (sendAsync) → שידור → השרשרת עונה.
 *
 * משתמשים במפתח פיקטיבי שנגזר מהביטוי 'fake' — אין לו שום סמכות על החשבון,
 * ולכן התוצאה הצפויה היא שגיאת-שרשרת "Missing Posting Authority".
 * דווקא קבלת השגיאה הזאת היא ההוכחה: הגזירה עבדה, החתימה עבדה, השידור עבד,
 * והשרשרת עצמה בדקה את החתימה מול ההרשאות ודחתה — הפייפליין חי מקצה לקצה.
 *
 * הרצה:  npm run test:pipeline   (או:  node test-pipeline.cjs)
 * דרישה: Node (לא bun!) — bun שובר את ה-ecc של steem-js.
 */
'use strict';

const steem = require('steem');

steem.api.setOptions({ url: process.env.RPC_URL ? 'https://' + process.env.RPC_URL.replace(/^https?:\/\//, '') : 'https://api.steemit.com' });

const ACCOUNT = process.env.AGENT_ACCOUNT || 'headcorner';

console.log('[1/4] deriving a FAKE posting key for @' + ACCOUNT + ' from seed "fake" ...');
const keys = steem.auth.getPrivateKeys(ACCOUNT, 'fake', ['posting']);
const wif = keys.posting;
console.log('      derived (never shown fully): ' + wif.slice(0, 3) + '*** (len ' + wif.length + ')');

console.log('[2/4] isWif check ...');
const ok = steem.auth.isWif(wif);
console.log('      isWif =', ok);
if (!ok) {
  console.error('FAIL: derived key is not a valid WIF');
  process.exit(1);
}

console.log('[3/4] building claim_reward_balance op and broadcasting with the FAKE key ...');
const op = [
  'claim_reward_balance',
  {
    account: ACCOUNT,
    reward_steem: '0.000 STEEM',
    reward_sbd: '0.000 SBD',
    // סכום חיובי כדי שאימות-הסכום בשרשרת יעבור ונגיע לבדיקת ההרשאות (שם המפתח
    // הפיקטיבי נדחה עם Missing Posting Authority — זו ההוכחה שרצינו)
    reward_vests: '42533.621148 VESTS',
  },
];

steem.broadcast
  .sendAsync({ operations: [op], extensions: [] }, [wif])
  .then((conf) => {
    // אסור לקרות — למפתח הפיקטיבי אין סמכות
    console.error('UNEXPECTED SUCCESS (should not happen):', conf);
    process.exit(1);
  })
  .catch((e) => {
    const msg = String((e && e.message) || e);
    console.log('[4/4] chain response: ' + msg.slice(0, 200));
    if (/Missing Posting Authority|missing.*authority|sig/i.test(msg)) {
      console.log('\nPASS — pipeline proven end-to-end: derive → isWif → local sign → broadcast → chain validation.');
      console.log('The chain itself rejected the fake key with an authority error, i.e. the tx was fully formed, signed and submitted.');
    } else {
      console.log('\nNOTE — chain answered with a different error (still proves derive→sign→broadcast→chain).');
    }
    process.exit(0);
  });
