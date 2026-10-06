// ─────────────────────────────────────────────────────────────────────
// מקור-המפתח הריבוני — ספרייה משותפת אחת לכל-הצרכנים (r137 · D-026)
//
// השיעור החי של r136b: הדלת אימתה את ה-active ואטמה 5/5 לענן, אך
// הערימה המקומית נשארה עיוורת — כי הדלת כתבה מקור-מפתח רק כשמודבקת
// סיסמת-אב. המפעיל הדביק WIF → keyPresent=false → הסולם ריק ו-925
// STEEM נזילים. התיקון השורשי: מקור-מפתח דו-מצבי, וכל-הצרכנים קוראים
// מכאן ולא יותר קריאה ישירה של הקובץ.
//
// פורמט הקובץ (upload/headcorner.txt — מחוץ-לגיט, 0600), שתי-שורות:
//   · מצב-אב:   "headcorner\n<סיסמת-אב>"  → גזירה לכל-תפקיד (toWif)
//   · מצב-WIF:  "headcorner\nwif:<WIF>"   → ה-active עצמו; שאר-התפקידים
//     נפתחים מהכספת דרך WIF-השליטה (openVaultWithControlWif — אותו
//     קריפטו, אותה סמכות). מצב-WIF חלש מסיסמת-אב ולא חזק ממנה: האב
//     גוזר את כל-התפקידים, ה-WIF פותח את הכספת שממנה כל-התפקידים.
//
// חוקי-ברזל (נשמרים מ-R75/R101c): הסוד חי בזיכרון-ההרצה בלבד; השרשרת
// היא השופט — הפומבי הנגזר חייב להיאמת מול הרשות החיה לפני כל שידור;
// אף-פונקציה כאן לא מחזירה סיסמה לקובץ-יומן, לתשובה או לתצוגה.
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { openVaultWithControlWif } from "@/lib/dex/wallet-vault";

export const HOME = "/home/z/my-project";
export const UPLOAD_DIR = path.join(HOME, "upload");
export const OWNER_FILE = path.join(UPLOAD_DIR, "headcorner.txt");

const WIF_PREFIX = "wif:";

export type OwnerRole = "active" | "posting" | "owner" | "memo";

export interface OwnerSource {
  account: string;
  mode: "master" | "wif";
  /** מצב-אב בלבד — סיסמת-האב הגוזרת את כל-התפקידים */
  master?: string;
  /** מצב-WIF בלבד — ה-active שממנו נפתחת הכספת */
  activeWif?: string;
}

/** קריאת מקור-המפתח בשני-המצבים. null = אין מקור (keyPresent=false). */
export function readOwnerSource(): OwnerSource | null {
  try {
    const raw = fs.readFileSync(OWNER_FILE, "utf8").trim();
    if (!raw) return null;
    const lines = raw
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean);
    const account = lines[0];
    const secret = lines[1] ?? "";
    if (!account || !secret) return null;
    if (secret.startsWith(WIF_PREFIX)) {
      const wif = secret.slice(WIF_PREFIX.length).trim();
      if (!wif) return null;
      return { account, mode: "wif", activeWif: wif };
    }
    return { account, mode: "master", master: secret };
  } catch {
    return null;
  }
}

/** כתיבת מקור-המפתח (הדלת בלבד). כותב 0600 מחוץ-לגיט. */
export function writeOwnerSource(source: OwnerSource): void {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const secret =
    source.mode === "wif" ? `${WIF_PREFIX}${source.activeWif ?? ""}` : (source.master ?? "");
  fs.writeFileSync(OWNER_FILE, `${source.account}\n${secret}\n`, { mode: 0o600 });
}

function steemLib(): {
  auth: { toWif(a: string, p: string, r: string): string; wifToPublic(w: string): string };
} {
  const nodeRequire = createRequire(path.join(HOME, "package.json"));
  return nodeRequire("steem") as {
    auth: { toWif(a: string, p: string, r: string): string; wifToPublic(w: string): string };
  };
}

export interface SigningKey {
  account: string;
  /** ה-WIF לחתימה — זיכרון-הרצה בלבד, לעולם לא נרשם */
  wif: string;
  /** מקור-הגזירה — לשקיפות בלי סוד: "master:toWif" או "vault:control-wif" */
  via: string;
}

/**
 * גזירת WIF לחתימה לפי תפקיד — השער-האחד של כל-הסטאק המקומי.
 *   · מצב-אב: toWif(אב, תפקיד) — הדפוס המוכח שעבר 4/4 ב-R75.
 *   · מצב-WIF: ה-active חותם ישירות; תפקידים אחרים נפתחים מהכספת
 *     תחת WIF-השליטה. אין-גזירה = null כנה (NO-KEY), אף-ניחוש.
 */
export function steemSigningWif(role: OwnerRole, expectAccount?: string): SigningKey | null {
  const src = readOwnerSource();
  if (!src) return null;
  if (expectAccount && src.account !== expectAccount) return null;
  const lib = steemLib();
  try {
    if (src.mode === "master" && src.master) {
      return { account: src.account, wif: lib.auth.toWif(src.account, src.master, role), via: "master:toWif" };
    }
    if (src.mode === "wif" && src.activeWif) {
      if (role === "active") {
        return { account: src.account, wif: src.activeWif, via: "wif:direct" };
      }
      const vault = openVaultWithControlWif(src.activeWif);
      if (!vault.ok) return null;
      const opened = vault.open("steem", src.account, role);
      if (!opened.ok || !opened.priv) return null;
      // הפומבי נגזר כאן לצורך אימות-השופט אצל הקורא — ה-WIF עצמו חי בזיכרון
      return { account: src.account, wif: opened.priv, via: `vault:${opened.detail ?? "control-wif"}` };
    }
    return null;
  } catch {
    return null;
  }
}

/** בדיקת-נוכחות בוליאנית בלבד — ל-probes (D-021), אפס-חשיפת-סוד. */
export function ownerKeyPresent(): boolean {
  return readOwnerSource() != null;
}
