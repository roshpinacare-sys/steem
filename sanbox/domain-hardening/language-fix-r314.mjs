#!/usr/bin/env node
/**
 * language-fix-r314.mjs — כלי-השפה של R314 עבור roshpinacare-sys/Domain · מהדורה-בטוחה-2
 *
 * שימוש · node language-fix-r314.mjs <תיקיית-עותק-Domain>
 *
 * מהדורה-2 אחרי תפיסה-עצמית בדיפר (R314) — הגרסה-הראשונה שחתה בשלושה ·
 *  · נגעה בתוך <style> (שברה CSS — border: → border)
 *  · הרסה יחסים וחותמות-זמן (1:1 → 11 · ב-07:57 → ב-0757)
 *  · דגלה מרכאות-קוד בתוך <script> כטקסט-גלוי
 *
 * חוקי-המהדורה-2 ·
 *  · רק צמתים-טקסטואליים אמיתיים — <style> ו-<script> מוצאים-מכללה לגמרי
 *  · R1 תיקון-בטוח יחיד — נקודותיים הצמודות ישירות לאות-עברית, עם רווח+ספרה אחריהן
 *      `דופק: 28` → `דופק 28`
 *    נאסרים מכל-וכל — נקודותיים אחרי ספרה (יחסים, שעות, בלוקים) · נקודותיים ב-CSS/JS
 *  · R2 דגלון בלבד — מרכאות-ישרות בטקסט-גלוי (הכרעה-ידנית, אפס מגע)
 *  · דוח מלא · language-fix-report.json · חובה בדיקת-דיפר לפני כל דחיפה
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2];
if (!root || !statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
  console.error("שימוש · node language-fix-r314.mjs <תיקיית-Domain>");
  process.exit(2);
}

const report = { fixed: [], manual: [], scanned: [] };
const HE = /[\u05d0-\u05ea]/;

/* מוציא-מכללה · style/script/comments — נגיעה רק בטקסט-גלוי אמיתי */
function processHtml(html, file) {
  const guard = [];
  let h = html
    .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, (m) => { guard.push(m); return `\u0000G${guard.length - 1}\u0000`; })
    .replace(/<!--[\s\S]*?-->/g, (m) => { guard.push(m); return `\u0000G${guard.length - 1}\u0000`; });

  h = h.replace(/>([^<]+)</g, (m, text) => {
    let out = text;
    /* R1 · אות-עברית צמודה לנקודותיים + רווח+ספרה · התו-שלפני-הנקודותיים חייב להיות אות-עברית עצמה */
    const r1 = out.replace(/([\u05d0-\u05ea]):(?=[ ]?\d)/g, "$1");
    if (r1 !== out) collect(out, r1, file, "R1-colon-after-hebrew-letter");
    out = r1;
    /* R2 · מרכאות-ישרות בטקסט-גלוי · דגלון בלבד */
    if (/["\u201c\u201d]/.test(out.replace(/&quot;/g, ""))) collect(out, null, file, "R2-quotes-in-visible-text");
    return ">" + out + "<";
  });

  return h.replace(/\u0000G(\d+)\u0000/g, (_, i) => guard[Number(i)]);
}

function collect(before, after, file, rule) {
  const ctx = (s) => s.replace(/\s+/g, " ").trim().slice(0, 100);
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
      const out = processHtml(html, p);
      if (out !== html) writeFileSync(p, out);
      report.scanned.push({ file: p, changed: out !== html });
    }
  }
}

walk(root);
writeFileSync(join(root, "language-fix-report.json"), JSON.stringify(report, null, 2));
console.log(`נסרקו ${report.scanned.length} קבצי-html · תוקנו ${report.fixed.length} מופעי-R1 · הועברו להכרעה ${report.manual.length} מופעי-R2`);
console.log("חובה · בדיקת git diff מלאה לפני דחיפה · דוח · language-fix-report.json");
