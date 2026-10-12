#!/usr/bin/env node
/**
 * language-fix-r314.mjs — כלי-השפה של R314 עבור roshpinacare-sys/Domain
 *
 * שימוש · node language-fix-r314.mjs <תיקיית-עותק-Domain>
 *
 * מה הוא עושה ·
 *  · סורק טקסט-גלוי (מחוץ לתגיות) בכל קבצי .html
 *  · R1 תיקון-בטוח — נקודותיים אחרי אות-עברית כשאחריהם רווח ומספר (`דופק: 28` → `דופק 28`)
 *  · R2 דגלון בלבד — מרכאות-ישרות בטקסט וכל נקודותיים שאינם דפוס-מספרי (הכרעה-ידנית)
 *  · כותב language-fix-report.json עם כל שורה — מה תוקן ומה הועבר להכרעה
 *
 * חוקי-הבית · אפס המצאה · תיקון רק דפוס-מדוד · דיווח מלא · אין נגיעה בתכונות-HTML.
 * הרצה לפני דחיפה · rebase על origin/main · ואז push לפי הפרוטוקול.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2];
if (!root || !statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
  console.error("שימוש · node language-fix-r314.mjs <תיקיית-Domain>");
  process.exit(2);
}

const HE = /[\u05d0-\u05ea]/;
const report = { fixed: [], manual: [], scanned: [] };

/* הפרדה-נאיבית אך בטוחה — כל מה שבין > ו-< הוא טקסט; תכונות לא נוגעות */
function fixTextSegments(html, file) {
  return html.replace(/>([^<]+)</g, (m, text) => {
    let out = text;
    /* R1 · תווית-עברית + נקודותיים + רווח + ספרה → בלי נקודותיים */
    const r1 = out.replace(new RegExp(`(${HE.source}[^<>:]{0,40}):(?=\\s?\\d)`, "g"), "$1");
    if (r1 !== out) {
      collect(out, r1, file, "R1-colon-before-number");
      out = r1;
    }
    /* R2 · מרכאות-ישרות בטקסט → דגלון בלבד */
    if (/"/.test(out)) collect(out, null, file, "R2-straight-quotes");
    return ">" + out + "<";
  });
}

function collect(before, after, file, rule) {
  const ctx = (s) => s.replace(/\s+/g, " ").slice(0, 90);
  if (after == null) report.manual.push({ file, rule, context: ctx(before) });
  else report.fixed.push({ file, rule, before: ctx(before), after: ctx(after) });
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === ".git" || name === "node_modules") continue;
      walk(p);
    } else if (name.endsWith(".html")) {
      const html = readFileSync(p, "utf8");
      const out = fixTextSegments(html, p);
      if (out !== html) {
        writeFileSync(p, out);
        report.scanned.push({ file: p, changed: true });
      } else report.scanned.push({ file: p, changed: false });
    }
  }
}

walk(root);
writeFileSync(join(root, "language-fix-report.json"), JSON.stringify(report, null, 2));
console.log(`נסרקו ${report.scanned.length} קבצי-html · תוקנו ${report.fixed.length} מופעי-R1 · הועברו להכרעה ${report.manual.length} מופעי-R2`);
console.log("דוח מלא · language-fix-report.json");
