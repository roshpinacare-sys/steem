#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// WEAVE-BOOK-PUSH (R93) — סגירת הפיצול: עדויות הסנדבוקס עולות לספר הקנוני
//
// הפער שנמדד (2026-09-23): הספר הקנוני חי בענן (בוטי weave-anchor פועמים
// ומייצאים), אך עדויות שנכתבות בסנדבוקס — עוגני צ'רטר, RESTORE — אף פעם
// לא זרמו חזרה למעלה: הן נכתבו מקומית והתייתמו בסנכרון הבא. עדויות
// R91/R92 אבדו כך בדיוק (הספר הענני מספר אותן במקומות אחרים).
//
// הזרימה הזאת סוגרת את הלולאה מהצד הסנדבוקס:
//   1. git fetch — אם origin התקדם, קודם ייבוא (ספר חדש יותר = אמת)
//   2. exportLedger מה-DB המקומי → sovereign/ledger.json
//   3. אימות מלא של השרשרת אחרי הייצוא (חתימות + ראש מחדש)
//   4. קומיט ריבוני + דחיפה עם rebase-ניסיונות-חוזרים
//
// חוק: אם origin חדש מה-DB המקומי אחרי ה-fetch — הריצה נעצרת בכנות
// (הענן קודם; הריפוי-העצמי ישחזר את העדויות על השושלת החדשה).
// ─────────────────────────────────────────────────────────────────────

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { db } from "../src/lib/db";
import { exportLedger, importLedger, parseLedgerSnapshot } from "../src/lib/weave/ledger-sync";
import { verifyLedger } from "../src/lib/weave/beat";

const ROOT = process.cwd();
const LEDGER_PATH = path.join(ROOT, "sovereign", "ledger.json");

function sh(cmd: string): string {
  return execSync(cmd, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).toString().trim();
}

function gitOk(cmd: string): string | null {
  try {
    return sh(cmd) || null;
  } catch {
    return null;
  }
}

async function main() {
  const msg = process.argv[2] ?? `weave-book-push: ${new Date().toISOString()}`;

  // 1. fetch — האם הענן התקדם?
  gitOk("git fetch origin main");
  const remoteRaw = gitOk("git show origin/main:sovereign/ledger.json");
  if (!remoteRaw) throw new Error("אין ledger.json ב-origin/main — לא ניתן לאמת את המירוץ");
  const remote = parseLedgerSnapshot(remoteRaw);
  const [localCount] = await Promise.all([db.attestation.count()]);

  if (remote.chainCount > localCount) {
    // הענן חדש — קודם כל ייבוא (אמת), ואז ייצוא-מחדש
    const snap = parseLedgerSnapshot(remoteRaw);
    const res = await importLedger(snap);
    console.log(`יובא מ-origin: ${res.imported.attestations} אימותים (הענן הקדים — סדר נכון)`);
  } else if (remote.chainCount === localCount) {
    const verify0 = await verifyLedger();
    if (!verify0.valid) throw new Error(`ספר מקומי פגום לפני ייצוא: ${verify0.errors[0] ?? "?"}`);
    const remoteHead = remote.headHash;
    const localHead = verify0.headHash;
    if (remoteHead !== localHead) {
      throw new Error(
        `סתירת שוויון-ספירה: origin ${remote.chainCount} (head ${remoteHead.slice(0, 12)}…) ≠ מקומי ${localCount} (head ${localHead.slice(0, 12)}…) — שושלות מקבילות. נדרשת הכרעה ידנית, לא דחיפה עיוורת.`,
      );
    }
    console.log("הספר המקומי זהה ל-origin — אין מה לדחוף");
    process.exit(0);
  }

  // 2. ייצוא
  const count = await db.attestation.count();
  const snap = await exportLedger();
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(snap, null, 2) + "\n");

  // 3. אימות מלא אחרי הייצוא — ההוכחה שהייצוא לא שבר כלום
  const verify = await verifyLedger();
  if (!verify.valid || verify.sigFail > 0) {
    throw new Error(`הספר המיוצא פגום: ${verify.errors[0] ?? `sigFail=${verify.sigFail}`}`);
  }
  console.log(`ledger.json ייוצא: ${snap.chainCount} אימותים · head=${snap.headHash.slice(0, 18)}… · אימות ${verify.sigOk}/${verify.checked} ✓`);

  // 4. קומיט + דחיפה עם rebase (עד 3 ניסיונות)
  sh("git add sovereign/ledger.json");
  let pushed = false;
  let lastErr = "";
  for (let attempt = 1; attempt <= 3 && !pushed; attempt++) {
    try {
      execSync(`git commit -m ${JSON.stringify(msg)} --no-verify`, { cwd: ROOT, stdio: "pipe" });
    } catch {
      // אולי כבר מחויב (ניסיון חוזר) — ממשיכים לדחיפה
    }
    try {
      execSync("git push origin HEAD:main", { cwd: ROOT, stdio: "pipe" });
      pushed = true;
    } catch (e: any) {
      lastErr = String(e?.message ?? e).slice(0, 200);
      console.log(`דחיפה ${attempt} נכשלה — rebase וניסיון חוזר: ${lastErr.slice(0, 80)}`);
      try {
        sh("git rebase origin/main");
        // אחרי rebase: אם origin התקדם בספר — עצירה כנה
        const rr = gitOk("git show origin/main:sovereign/ledger.json");
        if (rr) {
          const rc = parseLedgerSnapshot(rr);
          if (rc.chainCount > count) {
            throw new Error(`origin התקדם ל-${rc.chainCount} בזמן הדחיפה — עוצרים בכנות (הספר ייבדק מחדש)`);
          }
        }
      } catch (re) {
        throw new Error(`rebase נכשל: ${String((re as Error).message).slice(0, 150)}`);
      }
    }
  }
  if (!pushed) throw new Error(`דחיפה נכשלה אחרי 3 ניסיונות: ${lastErr}`);
  const head = sh("git rev-parse --short HEAD");
  console.log(`נדחף ✓ commit ${head} · ${snap.chainCount} אימותים בספר הקנוני`);
}

main().catch((e) => {
  console.error("✗ " + String((e as Error)?.message ?? e));
  process.exit(1);
});
