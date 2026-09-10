#!/usr/bin/env node
/* archive_manifest.cjs — 117p8-R8: מניפסט-פערים כנה-מלא של ספר-השרשרת.
 * הישן תיעד רק את 703-709; הסריקה-החיה מצאה 26 טווחים (29,165 גבהים, 22.8%).
 * הכלל: כנות-מלאה — כל-פער מתועד עם גודלו, והדוקטרינה מתוקננת: replay-מג'נזיס
 * בלתי-אפשרי על הדיסק; שרשרת-הבסיס (state-root→snapshot→replay-מעליו) היא דרך-השחזור.
 * אפס-מחיקה, אפס-המצאה: רק מדידה + תיעוד. */
'use strict';
const fs = require('fs');
const path = require('path');
const NODE = __dirname;
const lines = fs.readFileSync(path.join(NODE, 'chain-archive.jsonl'), 'utf8').split('\n');
const byH = new Set();
let badLines = 0, maxH = 0;
for (const l of lines) {
  if (!l.trim()) continue;
  try { const b = JSON.parse(l); byH.add(b.height); if (b.height > maxH) maxH = b.height; } catch (_) { badLines++; }
}
const missing = [];
for (let h = 1; h <= maxH; h++) if (!byH.has(h)) missing.push(h);
const ranges = [];
let s = null, p = null;
for (const h of missing) {
  if (s === null) { s = p = h; continue; }
  if (h === p + 1) { p = h; continue; }
  ranges.push([s, p]); s = p = h;
}
if (s !== null) ranges.push([s, p]);
const doc = {
  at: new Date().toISOString(),
  book: 'chain-archive.jsonl',
  coverage: { uniqueHeights: byH.size, maxH, missing: missing.length, missingPct: +(100 * missing.length / maxH).toFixed(2), badLines },
  law: '117p8-R8: replay-מג׳נזיס בלתי-אפשרי על-הדיסק — שרשרת-הבסיס (state-root → snapshot → replay-מעליו, עם חלון-הוכחה) היא דרך-השחזור הקנונית. הפעימה ממשיכה מהגובה-האמיתי (honest continuation).',
  gaps: ranges.map(([a, b]) => ({
    heights: a === b ? [a] : [a, b],
    count: b - a + 1,
    status: 'permanent-honest-gap',
    note: a === 703
      ? 'בלוקים עתיקים מהשבועות-הראשונים — נבלעו בתקלות-הארכיון שלפני מגן-הזנב (99b). מתועד-מקורית.'
      : 'נבלעו בתקלות-ארכיון/הפעלות-מקבילות/קריסות-סנדבוקס במהלך-החיים. האפקט-הכלכלי-שלהם אינו-במצב-החי (ghost-continuation מתועד ב-spec §10). אין-מקור-שחזור.',
  })),
};
fs.writeFileSync(path.join(NODE, 'archive_gaps.json'), JSON.stringify(doc, null, 2));
console.log('gaps: ' + ranges.length + ' ranges · missing=' + missing.length + '/' + maxH + ' (' + doc.coverage.missingPct + '%) · badLines=' + badLines);
console.log('largest: ' + ranges.sort((x, y) => (y[1] - y[0]) - (x[1] - x[0])).slice(0, 5).map(([a, b]) => a + '-' + b + '(' + (b - a + 1) + ')').join(' · '));
