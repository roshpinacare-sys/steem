#!/usr/bin/env node
/* archive_heal.cjs — Task 99b: קנוניזציה של ספר-הארכיון.
 *
 * התקלה-הנמדדת: סופר-כפול (מנוע-תושב + פעימות-דמון) כותבים חלונות-חופפים
 * ל-chain-archive.jsonl — 10,214 שורות עבור 8,965 גבהים (1,249 כפילויות:
 * 1,225 זהות-byte · 24 שונות-מזלג). ה-replay מדה-דוף עכשיו בצומת (99b-heal),
 * והסקריפט הזה מרפא את הקובץ עצמו: ראשון-לגובה שורד · שינוי-מספר-שורות
 * מדווח בכנות · גיבוי .bak לפני כתיבה.
 *
 * שימוש: node archive_heal.cjs [--check]   (--check = מדידה בלבד, בלי כתיבה)
 */
const fs = require('fs');
const path = require('path');

const NODE_DIR = __dirname;
const ARCHIVE = path.join(NODE_DIR, 'chain-archive.jsonl');
const CHECK = process.argv.includes('--check');

const raw = fs.readFileSync(ARCHIVE, 'utf8');
const lines = raw.trim().split('\n');
const byH = new Map();
let dupIdentical = 0, dupDiffering = 0, bad = 0;
const kept = [];
for (const l of lines) {
  let b = null;
  try { b = JSON.parse(l); } catch (_) {}
  if (!b || !Number.isInteger(b.height)) { bad++; kept.push(l); continue; } // שורה-פגומה נשמרת (מדיניות-אל-תמחק-עדות)
  const prev = byH.get(b.height);
  if (prev === undefined) { byH.set(b.height, l); kept.push(l); continue; }
  if (prev === l) dupIdentical++;
  else {
    try {
      if (JSON.stringify(JSON.parse(prev)) === JSON.stringify(b)) dupIdentical++;
      else { dupDiffering++; kept.push(l); } // מזלג — נשמר (ה-replay ידה-דוף לפי גובה, ראשון-מנצח)
    } catch (_) { dupDiffering++; }
  }
}
const report = {
  at: new Date().toISOString(),
  linesIn: lines.length,
  uniqueHeights: byH.size,
  dupIdentical, dupDiffering, badLines: bad,
  wouldShrinkTo: kept.length,
};
console.log(JSON.stringify(report, null, 2));

if (CHECK) { console.log('check-only — no write'); process.exit(0); }
if (kept.length >= lines.length) { console.log('nothing to heal — archive already canonical'); fs.writeFileSync(path.join(NODE_DIR, 'archive_heal_last.json'), JSON.stringify(report, null, 2)); process.exit(0); }

fs.writeFileSync(ARCHIVE + '.bak', raw);
fs.writeFileSync(ARCHIVE, kept.join('\n') + '\n');
fs.writeFileSync(path.join(NODE_DIR, 'archive_heal_last.json'), JSON.stringify(Object.assign(report, { healedAt: new Date().toISOString(), backup: 'chain-archive.jsonl.bak' }), null, 2));
console.log('HEALED · ' + lines.length + ' → ' + kept.length + ' lines · backup chain-archive.jsonl.bak');
