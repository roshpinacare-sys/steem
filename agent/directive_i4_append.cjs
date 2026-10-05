#!/usr/bin/env node
'use strict';
/**
 * directive_i4_append.cjs — רישום-הנחיית-הבעלים i=4 (trace 1a10e563dee41f15)
 * OWNER WORD: 'זה ממש לא מספיק אני רוצה הרבה הרבה יותר מזה. תוכיע
 * מנדט: הגדלת-האצלות-הצי — 10 מפעילים 30→75 SP, hive-177702 10→50, powerspan 50→75.
 * אפס-סודות · hash-chained · verify לפני ואחרי.
 */
const fs = require('fs');
const CHAIN = require('./lib/directivesChain.cjs');

const FILE = CHAIN.CHAIN_FILE;
const v0 = CHAIN.verifyChain(FILE);
if (!v0.ok) { console.error('[DIRECTIVES] chain verify FAILED before append'); process.exit(1); }
const prev = v0.entries[v0.entries.length - 1];
const i = prev.i + 1;

const NOTE = [
  'OWNER DIRECTIVE 2026-10-05T23:2xZ (IM trace 1a10e563dee41f15) — דברי-הבעלים מילה-במילה:',
  "'זה ממש לא מספיק אני רוצה הרבה הרבה יותר מזה. תוכיע",
  "מנדט D2-b (הרחבת-מנדט D2 מ-i=3): גל-האצלות-מוגדל לצי-המאומת — 10 המפעילים מוגדלים מ-30 ל-75 SP כל-אחד; hive-177702 מ-10 ל-50 SP; powerspan מ-50 ל-75 SP. hcsoldier4/5/6 לא-יכללו בגל-זה (שורות-רוסטר blocked-no-key — כספת לא-זמינה לאימות-משמורת בסביבה זו); ynet אסור (retired).",
  "גבולות-קשיחים: תקרה 75 SP לחשבון · תקרת-דלתא כוללת 700 SP · אידמפוטנטי (skip אם כבר מעל 95% מהיעד) · read-back לכל-האצלה · קבלות ליומן-ההחלטות.",
  "כיסוי-מסילה: delegations (הגדלת-האצלות-קיימות לרוסטר-המאומת בלבד). ההרצה = יד-בעלים דרך משטח-החתימה תחת-הנחיה זו — לא הרחבת-מסילה של האורגניזם; STASIS+E10 נשארים בתוקף לפעולות-הון שמקורן האורגניזם; boundaryStatus נשאר OWNER_ONLY.",
].join(' ');

const entry = { i, at: '2026-10-05T23:25:00Z', type: 'owner-note', trace: '1a10e563dee41f15', source: 'IM-chat recorded by agent', lanes: ['delegations'], note: NOTE };
const hash = CHAIN.entryHash(prev.hash, entry);
const line = JSON.stringify({ ...entry, hash });
fs.appendFileSync(FILE, line + '\n');

const v1 = CHAIN.verifyChain(FILE);
if (!v1.ok) {
  console.error('[DIRECTIVES] verify FAILED after append — reverting');
  const lines = fs.readFileSync(FILE, 'utf8').split('\n').filter((l) => l.trim().length > 0);
  if (lines[lines.length - 1] === line) lines.pop();
  fs.writeFileSync(FILE, lines.join('\n') + '\n');
  process.exit(1);
}
console.log('[DIRECTIVES] appended i=' + i + ' · hash=' + hash.slice(0, 16) + '… · entries=' + v1.entries.length);
