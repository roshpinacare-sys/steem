// ─────────────────────────────────────────────────────────────────────
// r140 · מקור-אמת אחד לסמכות-GitHub של מנוע-הכסף (saos-dex).
//
// השבריריות שתוקנת: ghToken() בדלתות /api/arm ו-/api/arm/all קרא את
// הטוקן מה-remote של עותק מקומי (/home/z/saos-dex) — עותק שנעלם בכל
// מיחזור-סנדבוקס, מה ששבר את אטימת-הסודות שוב ושוב (שורש-1 של r136b,
// חזר על עצמו אחרי-כן). התלות היתה גם מעגלית: העותק עצמו נוצר בעבר
// באמצעות טוקן-המנוע מ-upload/pat.env — אותה סמכות בדיוק.
//
// מעתה: הסמכות נקראת מהכספת המקומית (upload/pat.env), עם נפילה מסודרת
// לעותק המקומי אם הוא קיים. אפס תלות במצב-הדיסק שמחוץ לפרויקט.
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { execSync } from "child_process";

export const DEX_REPO = "roshpinacare-sys/saos-dex";
export const DEX_DIR = "/home/z/saos-dex";

const TOKEN_CANDIDATES = [
  path.join("/home/z/my-project", "upload", "pat.env"),
  path.resolve(process.cwd(), "upload", "pat.env"),
  path.resolve(process.cwd(), "..", "upload", "pat.env"),
  "/home/z/upload/pat.env",
];

/** טוקן-המנוע מהכספת המקומית — או null בכנות אם אין. */
export function engineToken(): string | null {
  for (const p of TOKEN_CANDIDATES) {
    try {
      const t = fs.readFileSync(p, "utf8").trim();
      if (t.length > 20) return t;
    } catch {
      /* הנתיב הבא */
    }
  }
  return null;
}

/** טוקן לקריאות-GitHub של מנוע-הכסף: הכספת קודמת; נפילה לעותק המקומי. */
export function dexGhToken(): string {
  const t = engineToken();
  if (t) return t;
  if (fs.existsSync(path.join(DEX_DIR, ".git"))) {
    const url = execSync("git remote get-url origin", {
      cwd: DEX_DIR,
      encoding: "utf8",
      timeout: 5000,
    }).trim();
    const m = url.match(/x-access-token:([^@]+)@/);
    if (m) return m[1];
  }
  throw new Error("engine-token-not-found");
}
