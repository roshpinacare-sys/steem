#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// SAOS WEB · web-publish-local (R55) — פרסום ריבוני-מקומי, אפס-ריפו.
//
// פקודת המפעיל: תוכן המשחקים לעולם לא יגע בריפו (GitHub) — רק ברשת.
// הצינורית הישנה העבירה חבילות דרך דואר-נכנס בגיט → סוכן-ענן
// (Secrets ב-GitHub) — הן מסלול החותם והן מסלול הבייטים עברו בריפו.
//
// הצינורית הזו: המחסן הריבוני המקומי הוא האמת המוגשת. החבילה נארזת
// באותו כותב-זיפ מינימלי (דחיסה מקסימלית — אותם בייטים כמו הענן),
// נבדקת באימות-עגול (הפריקה חייבת להחזיר בדיוק את אותם קבצים),
// ונכתבת למחסן + מניפסט pending-seal. אפס פעולות גיט.
//
// החותם על השרשרת: ייחתם במסלול-מפתח עתידי של המפעיל (הסנדבוקס
// נטול-מפתח בכוונה). עד אז ההגשה מסומנת בכנות "ממתין לחותם"
// (X-SAOS-Web-Source: local-pending-seal) — לא מתחזה לחתום.
//
// שימוש: bun scripts/web-publish-local.ts [--src <dir>] [--name <name>]
// ─────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as path from "path";
import { buildZip, parseZip, sha256Hex } from "@/lib/web/netstore";

const ROOT = path.resolve(__dirname, "..");
const PACKAGES = path.join(ROOT, "sovereign", "web", "packages");
const MANIFESTS = path.join(ROOT, "sovereign", "web", "manifests");

function arg(flag: string, def: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function main(): void {
  const src = path.resolve(arg("--src", path.join("sovereign", "web", "src-luck")));
  const name = arg("--name", "saos-luck-v1.zip");

  if (!fs.existsSync(src)) throw new Error(`תיקיית המקור לא נמצאה: ${src}`);

  // 1. איסוף הקבצים — html בלבד (חבילת אתר עצמאית)
  const names = fs.readdirSync(src).filter((f) => f.endsWith(".html")).sort();
  if (!names.includes("index.html")) throw new Error("אין index.html בתיקיית המקור — אין דלת כניסה");
  const entries = names.map((n) => ({ name: n, data: fs.readFileSync(path.join(src, n)) }));

  // 2. אריזה — אותו כותב-זיפ מינימלי של הרשת (דחיסה מקסימלית)
  const zip = buildZip(entries);

  // 3. אימות-עגול חובה — הפריקה מחזירה בדיוק את אותם קבצים
  const round = parseZip(zip);
  if (round.length !== entries.length) {
    throw new Error(`אימות-עגול: פורקו ${round.length} קבצים מתוך ${entries.length}`);
  }
  for (const e of entries) {
    const back = round.find((r) => r.name === e.name);
    if (!back || !back.data.equals(e.data)) throw new Error(`אימות-עגול נכשל עבור ${e.name}`);
  }

  // 4. חשיש — הכתובת שתשמש את השעת
  const hash = sha256Hex(zip);
  // R120: נוסחת ה-b64 הנכונה — 4×ceil(n/3). הנוסחה הקודמת ceil(4n/3) קיצרה
  // עד 2 תווים, ובדיקת-השלמות בשעת (joined.length === b64len) לעולם לא הייתה נסגרת.
  const b64len = Math.ceil(zip.length / 3) * 4;

  // 5. כתיבה למחסן הריבוני + מניפסט pending-seal. אפס גיט.
  fs.mkdirSync(PACKAGES, { recursive: true });
  fs.mkdirSync(MANIFESTS, { recursive: true });
  fs.writeFileSync(path.join(PACKAGES, `${hash}.bin`), zip);
  const manifestPath = path.join(MANIFESTS, `${hash}.json`);
  if (fs.existsSync(manifestPath)) {
    const prev = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { status?: string };
    if (prev.status !== "pending-seal") {
      throw new Error(`מניפסט קיים בסטטוס ${prev.status} — לא דורסים אמת קיימת`);
    }
  }
  const record = {
    manifest: {
      v: 1,
      protocol: "saos-web/1",
      name,
      sha256: hash,
      bytes: zip.length,
      mime: "application/zip",
      entry: "index.html",
      b64len,
      chunkSize: 0,
      mode: "chunks",
      by: "sovereign-local",
      at: new Date().toISOString(),
    },
    status: "pending-seal",
    chain: { manifestOp: null, chunks: [] },
    publishedBy: "local/web-publish-local",
    note: "פורסם ריבונית-מקומית — לא נשלח דבר לריפו. ממתין לחותם-שרשרת במסלול-מפתח של המפעיל.",
  };
  fs.writeFileSync(manifestPath, JSON.stringify(record, null, 2) + "\n");

  console.log(`✔ ${name} — פורסם למחסן הריבוני`);
  console.log(`  קבצים: ${entries.length} (${names.join(", ")})`);
  console.log(`  בייטים: ${zip.length} · b64: ${b64len} תווים`);
  console.log(`  sha256: ${hash}`);
  console.log(`  מחסן: sovereign/web/packages/${hash}.bin`);
  console.log(`  מניפסט: sovereign/web/manifests/${hash}.json (status=pending-seal)`);
  console.log(`  שעת: /api/web/c/${hash}/index.html`);
  console.log(`  גיט: אפס פעולות — התוכן לא נוגע בריפו`);
}

main();
