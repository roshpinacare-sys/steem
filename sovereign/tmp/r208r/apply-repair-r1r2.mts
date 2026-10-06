// ─────────────────────────────────────────────────────────────────────
// R208R REPAIR R1+R2 — §VII תחילת-מקור-הסף · §VIII עיגון-האש-המפה
// trace 1a10dda614a62251 · כתיבה-חיה אחת מבוקרת (האורגניזם-עצמו מתקן)
// ─────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import { createHash } from "node:crypto";

const H = "/home/z/my-project";
const OBJ = `${H}/sovereign/objectives`;
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

// ── לפני ────────────────────────────────────────────────────────────
const before = Object.fromEntries(
  ["objectives.json", "options.json", "capabilities.json", "authority-map.json"].map((f) => [f, sha(fs.readFileSync(`${OBJ}/${f}`))]),
);

// ── R1א: הסף עובר למודל (OBJECTIVE-PARAMETER — §VII) ────────────────
const optionsPath = `${OBJ}/options.json`;
const options = JSON.parse(fs.readFileSync(optionsPath, "utf8"));
if (!options._meta.armingThreshold) {
  options._meta.armingThreshold = {
    value: 3.0,
    unit: "SBD",
    source: "הסף-הרג'ימי של מימון-צד-העטיפה לזריעה (A-prime): ~2.4 WSBD נדרשים ביחס-הבריכה — נקבע באדג'ודיקטור R207, אומת R208, הועבר-למודל R208R",
    at: new Date().toISOString(),
    classification: "OBJECTIVE-PARAMETER (§VII R208R)",
    whoMayChange: "אדג'ודיקטור-מטרות בלבד (מפעיל/ממשל) — אסור ללמידה, לדיבון, לחיישן ולצרכן",
    notA: "אינו SAFETY-CAP (הקפסות קבועות-קוד) · אינו AUTHORITY-CONDITION (המפה והשערים חוץ-מודליים)",
    law: "שינוי-הסף משנה-הכרעה — ולעולם אינו יוצר סמכות",
  };
  fs.writeFileSync(optionsPath, JSON.stringify(options, null, 1) + "\n");
  console.log("R1a: armingThreshold נכתב למודל options.json");
} else console.log("R1a: armingThreshold כבר-קיים — דילוג");

// ── R1ב: חתימה-מחדש של P#1 על המודל החדש (EXPIRE→UPDATE עם אסמכתאות-טריות) ──
process.env.PREF_DIR = `${H}/sovereign/preferences`; // החי — הכתיבה-החוקית היחידה במודול
const prefs = await import(`${H}/mini-services/preferences.ts`);
const chainBefore = prefs.verifyChain();
console.log(`R1b: שרשרת-לפני ok=${chainBefore.ok} count=${chainBefore.count}`);
if (chainBefore.ok) {
  const exp = prefs.appendPreference({
    kind: "PREFERENCE-EXPIRE",
    subject: "grid-pool-seed",
    reason: "חתימה-מחדש R208R (§VII): האסמכתאות חתומות על עץ-מודל שהשתנה (הסף עבר-למודל) — פק-תוקף-טכני והנפקה-מחדש-מיידית עם אסמכתאות-טריות; אין-שינוי-כיוון",
    authority: "ADVISORY-ONLY",
  });
  console.log(`R1b: EXPIRE ok=${exp.ok} ${exp.ok ? "" : (exp as any).why}`);
  if (exp.ok) {
    const upd = prefs.appendPreference({
      kind: "PREFERENCE-UPDATE",
      subject: "grid-pool-seed",
      direction: "DOWN",
      scope: { regime: ["pre-landing-window", "sbd-unfunded"] },
      confidence: "medium",
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      evidence: [
        { book: "sovereign/objectives/options.json", ref: "unitErrorCorrection", value: "סף-זריעה אמיתי ~160 WSTEEM (תיקון-שגיאת-יחידות 96) · צד-SBD בלתי-ממומן", at: new Date().toISOString(), sha256: "" },
        { book: "sovereign/objectives/capabilities.json", ref: "C5", value: "SBD מדיד 0.015 — מתחת-למימון-צד-העטיפה", at: new Date().toISOString(), sha256: "" },
        { book: "sovereign/objectives/options.json", ref: "_meta.armingThreshold", value: "הסף-הרג'ימי חי-כעת במודל — OBJECTIVE-PARAMETER (§VII R208R)", at: new Date().toISOString(), sha256: "" },
      ],
      reason: "העדפה-נלמדת מראיות-מעוגנות: התנאי-החי שלילי (ראה evidence) — דיכוי-advisory בלבד; חתימה-מחדש R208R",
      authority: "ADVISORY-ONLY",
    });
    console.log(`R1b: UPDATE ok=${upd.ok} ${upd.ok ? `seq=${(upd as any).entry.seq}` : (upd as any).why}`);
  }
}
const chainAfter = prefs.verifyChain();
console.log(`R1b: שרשרת-אחרי ok=${chainAfter.ok} count=${chainAfter.count}`);
const active = prefs.activeDown("grid-pool-seed");
console.log(`R1b: P#1 פעיל=${!!active} seq=${active?.seq} evidence=${(active?.evidence ?? []).length}`);

// ── R2: ספר-עיגון-האש למפת-הסמכות (§VIII) ───────────────────────────
const mapPath = `${OBJ}/authority-map.json`;
const mapHash = sha(fs.readFileSync(mapPath));
const anchorPath = `${OBJ}/authority-anchor.jsonl`;
if (!fs.existsSync(anchorPath)) {
  const base = {
    seq: 1,
    at: new Date().toISOString(),
    authorityMapSha256: mapHash,
    by: "r208r-repair (§VIII): עיגון-ראשון — האורגניזם חותם על בייטס-המפה שהוא מכיר",
    trace: "1a10dda614a62251",
    law: "פורמט-תקין ≠ סמכות-תקינה: שינוי-בייט-אחד במפה בלי עיגון-חדש = דחיית-תצוגה (fail-closed)",
    prevHash: "GENESIS",
  };
  const entry = { ...base, entryHash: sha(JSON.stringify(base)) };
  fs.writeFileSync(anchorPath, JSON.stringify(entry) + "\n");
  console.log(`R2: עיגון-ראשון נכתב map=${mapHash.slice(0, 12)}`);
} else console.log("R2: ספר-עיגון קיים — דילוג");

// ── אחרי ────────────────────────────────────────────────────────────
const after = Object.fromEntries(
  ["objectives.json", "options.json", "capabilities.json", "authority-map.json"].map((f) => [f, sha(fs.readFileSync(`${OBJ}/${f}`))]),
);
console.log(JSON.stringify({
  before, after,
  changed: Object.keys(before).filter((f) => before[f] !== after[f]),
  mapHash,
}, null, 1));
