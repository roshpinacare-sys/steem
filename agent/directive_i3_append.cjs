#!/usr/bin/env node
'use strict';
/**
 * directive_i3_append.cjs — רישום-הנחיית-הבעלים i=3 בשרשרת SAOS-DIRECTIVES-CHAIN/1
 * trace 1a10e3975b4668a1 · 2026-10-05T22:5xZ · נרשם מדברי-בעלים מילה-במילה (IM)
 *
 * D1 אין-עוד-פאוורדאון (ביטול-לוח-הזמנים הנותר ~475.95 SP · withdraw_vesting=0 · lane: vesting)
 * D2 כוח והאצלות לצי ב-steem + בניית-כוח ב-Hive וב-Blurt
 * D3 פעילות-רשת אינטיליגנטית + מסחר-מרובה + מדיניות-רווחים (הזרמה-לצמיחה)
 * D4 מנדט-עומד: אוטונומיה מתפתחת — לחפש כל-הזמן ערך/עליונות/ריבונות בלי-המתנה להכרעה פרטנית
 *
 * אפס-סודות · hash-chained (tamper-EVIDENT) · verify לפני ואחרי.
 */
const fs = require('fs');
const path = require('path');
const CHAIN = require('./lib/directivesChain.cjs');

const FILE = CHAIN.CHAIN_FILE;
const v0 = CHAIN.verifyChain(FILE);
if (!v0.ok) { console.error('[DIRECTIVES] chain verify FAILED before append: breakAt=' + v0.breakAt + ' reason=' + v0.reason); process.exit(1); }

const prev = v0.entries[v0.entries.length - 1];
const i = prev.i + 1;

const NOTE = [
  'OWNER DIRECTIVE 2026-10-05T22:45Z (IM trace 1a10e3975b4668a1) — דברי-הבעלים מילה-במילה:',
  "'עניתי על הפאוורדאון לא עושים עוד פאוורדאון!!!!! צריך את הכוח! צריך כוח לכולם! גם בhive blurt steem ולעבוד עם כולם על הרשת'",
  "'חייבים שיהיה כוח והאצלות לכולם ולאט לאט להשתלט כל הכל'",
  "'כשכסף מתחיל לזרום צריך להזרים גם לעוד דברים ולהתפח ללא הפסקה'",
  "'האוטונומיה תמיד צריכה לבדוק לאן היא יכולה ואיך להתפתח כדי להשיג עוד ערך ועליונות טכנולוגית אינטילגנציה ריבונות אוטונמיה הכל כל הזמן'",
  "'אני לא צריך להחליט מה לעשות יש אוטונומיה מתפתחת'",
  'מנדטים: D1 הפאוורדאון נעצר מיידית — ביטול-לוח-הזמנים הנותר (~475.95 SP, תשלום-אחרון שנקבע 2026-10-10T02:01:27Z) בwithdraw_vesting=0; הכוח נשמר ומורחב.',
  'D2 כוח והאצלות לצי-המאומת ב-steem (ההאצלות ל-10 חיילים קיימות ונשמרות) + בניית-כוח ונוכחות ב-Hive וב-Blurt — עבודה-עם-כל-הרשתות.',
  'D3 פעילות-רשת אינטיליגנטית (כפי-שנקבע) + מסחר-מרובה בגריד + מדיניות-רווחים: כל-זרימה חדשה מוזרמת לצמיחה (כוח/האצלות/פיתוח) ללא-הפסקה.',
  'D4 מנדט-עומד: אוטונומיה מתפתחת — לבדוק כל-הזמן לאן-ואיך להתפתח (ערך, עליונות-טכנולוגית, אינטילגנציה, ריבונות, אוטונומיה) ולהשתמש במערכות-הקיימות ברמה-הטובה-ביותר; הבעלים אינו מכריע פרטנית אלא-אם-ידרוש.',
  'כיסוי-מסילה: vesting בלבד (ביטול-פאוורדאון ומדיניות-SP). כל-שאר-המסילות נשארות-תחת STASIS+E10 בלי-שינוי. כנות: ראיה-tamper-EVIDENT בלבד (לא tamper-PROOF) — כתוב בגיט, diff גלוי.',
].join(' ');

const entry = {
  i,
  at: '2026-10-05T22:45:00Z',
  type: 'owner-note',
  trace: '1a10e3975b4668a1',
  source: 'IM-chat recorded by agent',
  lanes: ['vesting'],
  note: NOTE,
};

const hash = CHAIN.entryHash(prev.hash, entry);
const line = JSON.stringify({ ...entry, hash });
fs.appendFileSync(FILE, line + '\n');

const v1 = CHAIN.verifyChain(FILE);
if (!v1.ok) {
  console.error('[DIRECTIVES] chain verify FAILED after append — reverting last line');
  const lines = fs.readFileSync(FILE, 'utf8').split('\n').filter((l) => l.trim().length > 0);
  if (lines[lines.length - 1] === line) lines.pop();
  fs.writeFileSync(FILE, lines.join('\n') + '\n');
  process.exit(1);
}
console.log('[DIRECTIVES] appended i=' + i + ' type=' + entry.type + ' lanes=' + JSON.stringify(entry.lanes) + ' trace=' + entry.trace);
console.log('[DIRECTIVES] hash=' + hash.slice(0, 16) + '… · chain verify OK · entries=' + v1.entries.length);
