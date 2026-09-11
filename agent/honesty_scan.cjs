#!/usr/bin/env node
/**
 * R18l — honesty_scan.cjs: סריקת-כנות-שגיאות (לקח-r29 מהערוץ: "בעיה-מס'-1 של-מערכת-עצמאית
 * היא לא להשיג — זו להבין שהשיגה"; המעמד הקטלני: שגיאה-אמיתית שנבלעת → "ERROR: undefined").
 *
 * מה-הוא-בודק (קריאה-בלבד, אפס-שינויים):
 *  - כל catch-בקבצי agent/*.cjs|mjs:
 *      honest          — catch(e) והגוף מזכיר את e (הפרט-נשמר)
 *      mask-risk       — catch(e) אך הגוף לא מזכיר את e (הפרט-עלול-ללכת-לאיבוד)
 *      skip-intentional— catch {} ללא-גוף-ממשי (דילוג-כוונה — מדווח-וזהו)
 *      mask-high       — catch {} עם-גוף-ממשי (השגיאה-נזרקת-כליל-וגם-קורה-משהו)
 *
 * הרצה: node agent/honesty_scan.cjs  →  agent/honesty_report.json
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const files = fs.readdirSync(path.join(ROOT, 'agent'))
  .filter((f) => /\.(cjs|mjs)$/.test(f))
  .map((f) => path.join(ROOT, 'agent', f));

// מציאת-בלוק-מאוזן: מ-{ נעוץ מחזיר-אינדקס-הסוגר-הזוגי
function blockEnd(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function scan() {
  const report = { at: new Date().toISOString(), files: [], totals: { honest: 0, rethrowContext: 0, skipIntentional: 0, maskRisk: 0, maskHigh: 0 } };
  const rx = /catch\s*(?:\((\w+)\)\s*)?\{/g;

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    const rows = [];
    let m;
    while ((m = rx.exec(src))) {
      const varName = m[1] || null;
      const openIdx = m.index + m[0].length - 1;
      const closeIdx = blockEnd(src, openIdx);
      if (closeIdx < 0) continue;
      const body = src.slice(openIdx + 1, closeIdx);
      const realBody = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').trim();

      let kind;
      const realClean = realBody.replace(/\s+/g, '');
      if (varName) {
        if (new RegExp(`\\b${varName}\\b`).test(body)) kind = 'honest';
        else if (realClean.length === 0 || realClean === '{}') kind = 'skip-documented'; // גוף-הערה/ריק — דילוג-שקט-מכוון
        else if (/new\s+Error\s*\(/.test(realBody)) kind = 'rethrow-context';          // נזרקת-שגיאה-חדשה-עם-הקשר
        else kind = 'mask-risk';                                                        // התנהלות-בלי-הפרט
      } else {
        kind = realBody.length === 0 ? 'skip-intentional' : 'mask-high';               // השגיאה-נזרקת-כליל-וקורה-משהו — המסוכן-ביותר
      }

      report.totals[kind === 'honest' ? 'honest' : kind === 'mask-risk' ? 'maskRisk' : kind === 'skip-intentional' || kind === 'skip-documented' ? 'skipIntentional' : kind === 'rethrow-context' ? 'rethrowContext' : 'maskHigh']++;
      if (kind === 'mask-risk' || kind === 'mask-high') {
        rows.push({ kind, line: src.slice(0, m.index).split('\n').length, body: body.replace(/\s+/g, ' ').slice(0, 90) });
      }
    }
    if (rows.length) report.files.push({ file: rel, findings: rows });
  }
  return report;
}

const report = scan();
fs.writeFileSync(path.join(ROOT, 'agent/honesty_report.json'), JSON.stringify(report, null, 2) + '\n');

console.log('== סריקת-כנות-שגיאות R18l ==');
console.log(`קבצים-נסרקו: ${files.length}`);
console.log(`honest=${report.totals.honest} · rethrow-context=${report.totals.rethrowContext} · skip-documented/intentional=${report.totals.skipIntentional} · mask-risk=${report.totals.maskRisk} · mask-high=${report.totals.maskHigh}`);
console.log(report.totals.maskHigh === 0 && report.totals.maskRisk === 0
  ? 'פסק-דין: כנות-מלאה — אף-שגיאה-לא-נבלעת-בנתיב-פעיל'
  : `פסק-דין: ${report.totals.maskHigh}-נתיבים-בסיכון-גבוה (catch-אנונימי-עם-גוף) + ${report.totals.maskRisk}-נתיבים-שהפרט-עלול-ללכת-לאיבוד`);
for (const f of report.files) {
  console.log(`\n[${f.file}] ${f.findings.length}:`);
  f.findings.slice(0, 6).forEach((r) => console.log(`  ${r.kind} @שורה-${r.line}: ${r.body}`));
  if (f.findings.length > 6) console.log(`  …+${f.findings.length - 6} נוספים (בדוח)`);
}
console.log('\nדוח: agent/honesty_report.json · אפס-שינויי-קוד-בסריקה זו');
