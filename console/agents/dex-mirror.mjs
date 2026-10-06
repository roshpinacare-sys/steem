// DEX-MIRROR — סוכן שיקוף הספר החי לבית Domain (R63)
//
// הבעיה שנמדדה בשטח: דפי הכסף וה-defi של הבית החדש קוראים את
// dex/grid.json, dex/world.json, dex/state.json, dex/credits.json ואת
// dex/portfolio.json בנתיב יחסי — אבל ב-Domain אף מכונה לא ריעננה אותם
// מאז ההעברה. המנוע מפרסם את פעימותיו (dex-beat/grid-beat) ל-Console
// החיה, והעתקים ב-Domain קפאו: grid.json בן יום, world/state/credits
// בני שעות. אתר שמציג אתמול כאילו הוא עכשיו היא השקר העמוק ביותר
// שאתר נתונים יכול לספר. שער 11 של מכונת האמת מודד את זה באדום;
// הסוכן הזה הוא הריפוי: שיקוף שעתי של הספר החי מהמראה הציבורית של
// Console — קריאה חסרת-מפתחות של קבצים ציבוריים, כתיבה ל-repo שלנו.
//
// דוקטרינת כנות:
//   - כל קובץ נבדק לפני כתיבה: JSON תקין + חותמת-זמן קריאה + גיל < 48ש'.
//     מקור מעופש/שבור לא נכתב — העותק הקיים נשמר והכישלון נרשם בכנות.
//   - כתיבה רק כשיש שינוי אמיתי (בתים) — בלי קומיטים ריקים.
//   - אפס מפתחות, אפס הזנקות: הסוכן רואה ומשקף, לא חותם ולא מזיז.
//
// תזמון: שעתי ב-:52 (מפת-הדקות של הצי ללא חפיפה אחת: money :02/:17/:32/:47
// · dex-watch :09/:29/:49 · truth-gate :07 · moment :12/:42 · agents-watch :37
// · console-publish :45 · agent-verify :55 דו-שעתי).

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const SRC = "https://roshpinacare-sys.github.io/Console/dex";
const OUT_DIR = "dex";
const FILES = ["grid.json", "world.json", "state.json", "credits.json", "portfolio.json"];
const MAX_SOURCE_AGE_H = 48; // מקור מעופש מזה = צינור מת, לא משקפים אותו

const r2 = (v) => Math.round(v * 100) / 100;

function timestampOf(doc) {
  // grid/world/state/credits: publishedAt בשורש. portfolio: generatedAt (epoch-ms)
  // בתוך אובייקט portfolio. שניהם נתמכים בכנות.
  if (doc.publishedAt) return Date.parse(doc.publishedAt);
  if (doc.generatedAt) return Date.parse(doc.generatedAt);
  if (doc.portfolio && doc.portfolio.generatedAt) return Number(doc.portfolio.generatedAt);
  return NaN;
}

let updated = 0, kept = 0, warned = 0;
const lines = [];

for (const f of FILES) {
  const url = `${SRC}/${f}?t=${Date.now()}`;
  let doc = null;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "dex-mirror" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    doc = await r.json();
  } catch (e) {
    warned++;
    lines.push(`WARN ${f}: source unreadable (${String(e.message).slice(0, 60)}) - current copy kept`);
    continue;
  }
  const ts = timestampOf(doc);
  if (!Number.isFinite(ts)) {
    warned++;
    lines.push(`WARN ${f}: no parseable timestamp - current copy kept`);
    continue;
  }
  const ageH = (Date.now() - ts) / 3.6e6;
  if (ageH > MAX_SOURCE_AGE_H) {
    warned++;
    lines.push(`WARN ${f}: source ${r2(ageH)}h old (> ${MAX_SOURCE_AGE_H}h) - a dying pipeline is not mirrored, current copy kept`);
    continue;
  }
  const local = `${OUT_DIR}/${f}`;
  let changed = true;
  if (existsSync(local)) {
    try {
      changed = JSON.stringify(JSON.parse(readFileSync(local, "utf8"))) !== JSON.stringify(doc);
    } catch { changed = true; /* local copy corrupt - replace it */ }
  }
  if (changed) {
    writeFileSync(local, JSON.stringify(doc, null, 1) + "\n");
    updated++;
    lines.push(`MIRRORED ${f}: ${r2(ageH)}h old at source, bytes written`);
  } else {
    kept++;
    lines.push(`OK ${f}: identical to the live mirror (${r2(ageH)}h old at source)`);
  }
}

console.log(`[dex-mirror] updated=${updated} kept=${kept} warned=${warned} source=${SRC}`);
for (const l of lines) console.log(`[dex-mirror] ${l}`);
// יציאה ירוקה גם כשמקור מזהיר: המכונה חיה, האמת על המקור נרשמת למעלה
// ושער 11 של מכונת האמת יאדים ספר שמוגש מעופש.
