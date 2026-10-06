// WEAVE-MIRROR — סוכן שיקוף ספרי-ה-weave לבית Domain (R66)
//
// הבעיה שנמדדה בשטח (INS-R65-001 ממצא F-2 → OL-13): ספרי ה-weave
// שהבית הזה מגיש — mirror.json (מצב הרשת הנגזר: עדויות, צ'קפוינטים,
// סוכנים, קווי-עיגון) ו-saos-live.json (ספר ה-Saos החי) — הועברו
// לכאן פעם אחת בלידת הבית ("ported from Console@8450edc", 00:24Z)
// ומאז קפאו לנצח: הלב הריבוני מפרסם את פעימותיו ל-Console החיה,
// ואף מכונה לא ריעננה את העתקים כאן. נמדד עומד: הספרים בני 17.2
// שעות בזמן שה-Console מגיש עותקים בני 4 שעות — הבית הציג אתמול
// כאילו הוא עכשיו. זה השקר העמוק ביותר שאתר נתונים יכול לספר.
//
// הריפוי (דוקטרינת R63, הפעלה שנייה): שיקוף שעתי חסר-מפתחות מהמראה
// הציבורית החיה של Console — קריאה ציבורית בלבד, כתיבה לריפו שלנו.
// שער G12 של מכונת האמת מודד את התוצאה המוגשת מעתה משני צירים:
// גיל מקומי (דוקטרינת 26 השעות) והסכמה עם התאום — פיגור גדול
// מ-2 שעות מול ה-Console אומר שהשיקוף נשבר.
//
// דוקטרינת כנות (זהה ל-dex-mirror):
//   - כל קובץ נבדק לפני כתיבה: JSON תקין + חותמת-זמן קריאה + גיל < 48ש'.
//     מקור מעופש/שבור לא נכתב — העותק הקיים נשמר והכישלון נרשם בכנות.
//   - כתיבה רק כשיש שינוי אמיתי (בתים) — בלי קומיטים ריקים.
//   - אפס מפתחות, אפס הזנקות: הסוכן רואה ומשקף, לא חותם ולא מזיז.
//
// תזמון: שעתי ב-:57 (מפת-הדקות של הצי ללא חפיפה אחת: money
// :02/:17/:32/:47 · dex-watch :09/:29/:49 · truth-gate :07 · moment
// :12/:42 · agents-watch :37 · console-publish :45 · dex-mirror :52 ·
// agent-verify :55 דו-שעתי).

import { readFileSync, writeFileSync, existsSync } from "node:fs";

// R75: status.json joins the mirror set. The witness status is regenerated
// hourly on the Console home by console-publish (render.mjs, keyless, from
// the public chain). Until now this home served its founding copy forever -
// A10 measured STALE here while the live line had already anchored fresh
// (INS-R75-001 F-1, Domain side). Same doctrine: keyless read, honest age
// gate, byte-true writes only.
const SRC = "https://roshpinacare-sys.github.io/Console";
const FILES = ["mirror.json", "saos-live.json", "status.json"];
const MAX_SOURCE_AGE_H = 48; // מקור מעופש מזה = צינור מת, לא משקפים אותו

const r2 = (v) => Math.round(v * 100) / 100;

function timestampOf(doc) {
  // mirror.json ו-saos-live.json: generatedAt בשורש (ISO). תמיכה
  // ב-publishedAt לכנות עתידה אם הסכמה תתרחב.
  if (doc.generatedAt) return Date.parse(doc.generatedAt);
  if (doc.publishedAt) return Date.parse(doc.publishedAt);
  return NaN;
}

let updated = 0, kept = 0, warned = 0;
const lines = [];

for (const f of FILES) {
  const url = `${SRC}/${f}?t=${Date.now()}`;
  let doc = null;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "weave-mirror" } });
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
  let changed = true;
  if (existsSync(f)) {
    try {
      changed = JSON.stringify(JSON.parse(readFileSync(f, "utf8"))) !== JSON.stringify(doc);
    } catch { changed = true; /* local copy corrupt - replace it */ }
  } else {
    warned++;
    lines.push(`WARN ${f}: no local copy at all - the book was never served from here`);
    changed = true;
  }
  if (changed) {
    writeFileSync(f, JSON.stringify(doc, null, 2) + "\n");
    updated++;
    lines.push(`MIRRORED ${f}: ${r2(ageH)}h old at source, bytes written`);
  } else {
    kept++;
    lines.push(`OK ${f}: identical to the live mirror (${r2(ageH)}h old at source)`);
  }
}

console.log(`[weave-mirror] updated=${updated} kept=${kept} warned=${warned} source=${SRC}`);
for (const l of lines) console.log(`[weave-mirror] ${l}`);
// יציאה ירוקה גם כשמקור מזהיר: המכונה חיה, האמת על המקור נרשמת למעלה
// ושער G12 של מכונת האמת יאדים ספר שמוגש מעופש או מפגר אחרי התאום.
