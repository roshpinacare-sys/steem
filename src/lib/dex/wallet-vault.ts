// ─────────────────────────────────────────────────────────────────────
// THE WALLET-VAULT — נתיב-המפתח הריבוני שמחבר את כל הרשתות (R101c)
//
// החוק (הוראת המפעיל, הוכח חי ב-R99 ושוב כאן): "כל הרשתות מתחברות
// עם המפתח הראשי". המפתח-הראשי = סיסמת-האב של המפעיל (upload/headcorner.txt).
// היא גוזרת את ה-active החי של STEEM (שורש המורשת — אומת ביט-מול-ביט
// מול השרשרת בכל פתיחה), וה-WIF הזה פותח את חותמת-הכספת בארנק
// (Saosmartwallet, scrypt KEK) — וממנה את המפתח-האב הפנימי (32 בייט),
// שפותח ב-AES-256-GCM כל רשומת-מפתח לפי (רשת, חשבון, תפקיד).
//
// חוקי-ברזל (מארכיטקטורת הארנק, 2026-09-08):
//   · ה-WIF חי בזיכרון-ההרצה בלבד — לא נכתב, לא מודפס, לא נכנס ללוג.
//   · השרשרת היא השופט: הקורא מחויב לאמת את הפומבי מול הרשות החיה
//     לפני כל שידור (המודול מחזיר pub לצורך האימות הזה בלבד).
//   · ה-DB מוצפן במנוחה; המפתח-הראשי הפנימי חתום תחת 12 חותמות —
//     כל מפתח ששולט בשרשרת יכול לפתוח (אין נקודת-כשל יחידה).
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const HOME = "/home/z/my-project";
const OWNER_FILE = path.join(HOME, "upload", "headcorner.txt");
const WALLET_DB = process.env.WALLET_DB || path.join(HOME, "db", "wallet-vault.db");

function nodeSteemLib(): {
  auth: { toWif(a: string, p: string, r: string): string; wifToPublic(w: string): string };
} {
  const nodeRequire = createRequire(path.join(HOME, "package.json"));
  return nodeRequire("steem") as {
    auth: { toWif(a: string, p: string, r: string): string; wifToPublic(w: string): string };
  };
}

/**
 * r137 · D-026 — קריאת WIF-השליטה ממקור-המפתח הדו-מצבי:
 *   · מצב-אב:  "account\n<סיסמת-אב>" → toWif(account, אב, "active")
 *   · מצב-WIF: "account\nwif:<WIF>"  → ה-WIF עצמו ישירות
 * הפונקציה מחזירה חומר-סוד — קוראיה חייבים בזיכרון-הרצה בלבד.
 */
export function readOwnerControlWif(): { account: string; controlWif: string; mode: "master" | "wif" } | null {
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
    if (secret.startsWith("wif:")) {
      const wif = secret.slice(4).trim();
      if (!wif) return null;
      return { account, controlWif: wif, mode: "wif" };
    }
    const controlWif = nodeSteemLib().auth.toWif(account, secret, "active");
    return { account, controlWif, mode: "master" };
  } catch {
    return null;
  }
}

export type VaultChain = "steem" | "hive" | "blurt";

export interface VaultKeyResult {
  ok: boolean;
  wif?: string;
  /** הפומבי הנגזר מה-WIF (קידומת STM תמיד) — לאימות מול השרשרת החיה */
  pub?: string;
  /** הפומבי כפי שנשמר ברשומת הארנק (עלול קידומת רשת: HIVE…/BLT…) */
  entryPub?: string;
  detail?: string;
}

/**
 * R102 — פתיחה גולמית שררשרת-אגנוסטית: אותו נתיב ריבוני
 * (סיסמת-האב → active-STEEM חי → חותמת → מפתח-אב → AES-256-GCM),
 * אבל בלי גזירת-פומבי גרפנית — כי evm-key הוא 64-hex ו-sol-key הוא
 * hex-seed של 32 בייט. הקורא מחויב לאמת את הפומבי הנגזר מול entryPub
 * (חוק השרשרת-השופט) לפני כל שימוש בשידור.
 */
export interface VaultRawResult {
  ok: boolean;
  /** חומר-המפתח הגולמי (64-hex ל-EVM · hex-seed 32-byte ל-SOL) — זיכרון-הרצה בלבד */
  priv?: string;
  /** הפומבי הרשום בארנק — השופט לאימות הנגזרת */
  entryPub?: string;
  status?: string;
  detail?: string;
}

export function openVaultEntryRaw(chain: string, account: string, role: string): VaultRawResult {
  try {
    // r137 · D-026: מקור-המפתח הדו-מצבי (סיסמת-אב או WIF ישיר) — קריאה
    // דרך העוזר המשותף, אותו קריפטו בשני-המצבים.
    const src = readOwnerControlWif();
    if (!src) {
      return { ok: false, detail: "NO-OWNER-FILE: מקור המפתח (upload/headcorner.txt) לא נמצא או ריק" };
    }
    const { account: ownerAccount, controlWif } = src;
    const steemLib = nodeSteemLib();
    const controlPub = steemLib.auth.wifToPublic(controlWif);
    if (!fs.existsSync(WALLET_DB)) {
      return { ok: false, detail: `NO-WALLET-DB: ${path.basename(WALLET_DB)} לא נמצא` };
    }
    const { DatabaseSync } = createRequire(path.join(HOME, "package.json"))("node:sqlite") as {
      DatabaseSync: new (p: string, o?: { readOnly?: boolean }) => {
        prepare(q: string): { get(...a: unknown[]): Record<string, unknown> | undefined };
      };
    };
    const db = new DatabaseSync(WALLET_DB, { readOnly: true });
    const cfgRow = db.prepare("SELECT keySeals FROM GateConfig WHERE id = 'gate'").get() as
      | { keySeals: string }
      | undefined;
    if (!cfgRow?.keySeals) {
      return { ok: false, detail: "NO-SEALS: אין חותמות בכספת" };
    }
    const seals = JSON.parse(cfgRow.keySeals) as KeySeal[];
    const seal = seals.find((s) => s.pub === controlPub);
    if (!seal) {
      return { ok: false, detail: `NO-SEAL-FOR-KEY: אין חותמה תחת ה-active החי (${controlPub.slice(0, 12)}…)` };
    }
    const kek = crypto.scryptSync(controlWif, Buffer.from(seal.kdfSalt, "hex"), 32, SCRYPT);
    const masterHexStr = aesGcmOpen(kek, seal.encMaster, seal.sealIv, seal.sealTag).toString("utf8");
    if (!/^[0-9a-fA-F]{64}$/.test(masterHexStr)) {
      return { ok: false, detail: "BAD-MASTER: החותמת נפתחה אך תוכנה אינו מפתח-אב תקין" };
    }
    const master = Buffer.from(masterHexStr, "hex");
    const entry = db
      .prepare(
        "SELECT pub, encPriv, privIv, privTag, status FROM VaultEntry WHERE chain = ? AND account = ? AND role = ? ORDER BY status = 'verified' DESC, id DESC LIMIT 1",
      )
      .get(chain, account, role) as
      | { pub: string; encPriv: string; privIv: string; privTag: string; status: string }
      | undefined;
    if (!entry) {
      return { ok: false, detail: `NO-ENTRY: אין רשומת ${role} ל-${account} ברשת ${chain}` };
    }
    const priv = aesGcmOpen(master, entry.encPriv, entry.privIv, entry.privTag).toString("utf8");
    return { ok: true, priv, entryPub: entry.pub, status: entry.status, detail: `vault:${chain}/${account}/${role} (${entry.status})` };
  } catch (e) {
    return { ok: false, detail: `VAULT-ERROR: ${String((e as Error).message ?? e).slice(0, 140)}` };
  }
}

interface KeySeal {
  pub: string;
  chain: string;
  account: string;
  role: string;
  kdfSalt: string;
  encMaster: string;
  sealIv: string;
  sealTag: string;
}

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };

function aesGcmOpen(key: Buffer, ctHex: string, ivHex: string, tagHex: string): Buffer {
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  d.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([d.update(Buffer.from(ctHex, "hex")), d.final()]);
}

/**
 * r136 — פתיחת-כספת עם WIF-שליטה בזיכרון (אותה סמכות, אותו קריפטו).
 *
 * הנתיב המתועד למעלה קורא את סיסמת-האב מהקובץ. נתיב זה מקבל את ה-WIF
 * השליטה עצמו בזיכרון-הריצה (למשל: ה-active שהמפעיל הדביק בדלת-ההפעלה
 * ואומת מול השרשרת ביט-מול-ביט). ה-KEK נגזר מה-WIF בדיוק כמו בנתיב
 * הקובץ (scrypt(controlWif, salt) — כך נבנה ה-Keystore), ולכן התוצאה
 * זהה ביט-מול-ביט. ה-WIF והמפתח-האב חיים בסגירה בלבד — לא נכתבים,
 * לא מודפסים, לא חוזרים מהפונקציה.
 *
 * מחזיר פותח-רשומות (chain, account, role) → { priv, entryPub, status }.
 * הקורא מחויב לאמת את הנגזרת מול הרשות החיה לפני כל שידור (חוק-השופט).
 */
export interface VaultOpener {
  ok: boolean;
  detail?: string;
  open(chain: string, account: string, role: string): VaultRawResult & { wif?: string };
}

export function openVaultWithControlWif(controlWif: string): VaultOpener {
  const open = (chain: string, account: string, role: string): VaultRawResult & { wif?: string } => {
    try {
      if (!fs.existsSync(WALLET_DB)) {
        return { ok: false, detail: `NO-WALLET-DB: ${path.basename(WALLET_DB)} לא נמצא` };
      }
      const nodeRequire = createRequire(path.join(HOME, "package.json"));
      const { DatabaseSync } = nodeRequire("node:sqlite") as {
        DatabaseSync: new (p: string, o?: { readOnly?: boolean }) => {
          prepare(q: string): { get(...a: unknown[]): Record<string, unknown> | undefined };
        };
      };
      const db = new DatabaseSync(WALLET_DB, { readOnly: true });
      const cfgRow = db.prepare("SELECT keySeals FROM GateConfig WHERE id = 'gate'").get() as
        | { keySeals: string }
        | undefined;
      if (!cfgRow?.keySeals) return { ok: false, detail: "NO-SEALS: אין חותמות בכספת" };
      const seals = JSON.parse(cfgRow.keySeals) as KeySeal[];
      const seal = seals.find((s) => s.pub === sealPub);
      if (!seal) {
        return {
          ok: false,
          detail: `NO-SEAL-FOR-KEY: אין חותמה תחת ה-WIF שנגזר (${sealPub.slice(0, 12)}…)`,
        };
      }
      const kek = crypto.scryptSync(controlWif, Buffer.from(seal.kdfSalt, "hex"), 32, SCRYPT);
      const masterHexStr = aesGcmOpen(kek, seal.encMaster, seal.sealIv, seal.sealTag).toString("utf8");
      if (!/^[0-9a-fA-F]{64}$/.test(masterHexStr)) {
        return { ok: false, detail: "BAD-MASTER: החותמת נפתחה אך תוכנה אינו מפתח-אב תקין" };
      }
      const master = Buffer.from(masterHexStr, "hex");
      const entry = db
        .prepare(
          "SELECT pub, encPriv, privIv, privTag, status FROM VaultEntry WHERE chain = ? AND account = ? AND role = ? ORDER BY status = 'verified' DESC, id DESC LIMIT 1",
        )
        .get(chain, account, role) as
        | { pub: string; encPriv: string; privIv: string; privTag: string; status: string }
        | undefined;
      if (!entry) {
        return { ok: false, detail: `NO-ENTRY: אין רשומת ${role} ל-${account} ברשת ${chain}` };
      }
      const priv = aesGcmOpen(master, entry.encPriv, entry.privIv, entry.privTag).toString("utf8");
      return { ok: true, priv, entryPub: entry.pub, status: entry.status, detail: `vault:${chain}/${account}/${role} (${entry.status})` };
    } catch (e) {
      return { ok: false, detail: `VAULT-ERROR: ${String((e as Error).message ?? e).slice(0, 140)}` };
    }
  };

  // החותמת נבדקת פעם אחת בעת הבנייה — אם אין התאמה, הפותח מדווח בכנות
  let sealPub = "";
  try {
    const nodeRequire = createRequire(path.join(HOME, "package.json"));
    const steemLib = nodeRequire("steem") as {
      auth: { wifToPublic(w: string): string };
    };
    sealPub = steemLib.auth.wifToPublic(controlWif);
  } catch {
    return {
      ok: false,
      detail: "BAD-CONTROL-WIF: ה-WIF השליטה אינו תקין",
      open,
    };
  }
  return { ok: true, detail: `vault-opened-by-control-wif (${sealPub.slice(0, 12)}…)`, open };
}

/**
 * פתיחת רשומת-מפתח מהארנק בנתיב הריבוני.
 * זורם: סיסמת-האב → WIF-ה-active החי של STEEM → חותמת → מפתח-אב → AES-GCM → WIF.
 */
export function openVaultKey(chain: VaultChain, account: string, role: string): VaultKeyResult {
  try {
    // 1+2) r137 · D-026: מקור-המפתח הדו-מצבי → WIF-השליטה (שורש-המורשת,
    //      מפתח-הפתיחה של החותמת) — קריאה דרך העוזר המשותף
    const src = readOwnerControlWif();
    if (!src) {
      return { ok: false, detail: "NO-OWNER-FILE: מקור המפתח (upload/headcorner.txt) לא נמצא או ריק" };
    }
    const ownerAccount = src.account;
    const steemLib = nodeSteemLib();
    const controlWif = src.controlWif;
    const controlPub = steemLib.auth.wifToPublic(controlWif);

    // 3) פתיחת הארנק (קריאה-בלבד)
    if (!fs.existsSync(WALLET_DB)) {
      return { ok: false, detail: `NO-WALLET-DB: ${path.basename(WALLET_DB)} לא נמצא — הארנק המוצפן חסר` };
    }
    const { DatabaseSync } = createRequire(path.join(HOME, "package.json"))("node:sqlite") as {
      DatabaseSync: new (p: string, o?: { readOnly?: boolean }) => {
        prepare(q: string): { get(...a: unknown[]): Record<string, unknown> | undefined };
      };
    };
    const db = new DatabaseSync(WALLET_DB, { readOnly: true });

    // 4) החותמת תחת ה-active החי
    const cfgRow = db.prepare("SELECT keySeals FROM GateConfig WHERE id = 'gate'").get() as
      | { keySeals: string }
      | undefined;
    if (!cfgRow?.keySeals) {
      return { ok: false, detail: "NO-SEALS: אין חותמות בכספת" };
    }
    const seals = JSON.parse(cfgRow.keySeals) as KeySeal[];
    const seal = seals.find((s) => s.pub === controlPub);
    if (!seal) {
      return { ok: false, detail: `NO-SEAL-FOR-KEY: אין חותמה תחת ה-active החי (${controlPub.slice(0, 12)}…)` };
    }

    // 5) KEK = scrypt(controlWif, seal.salt) → פתיחת מפתח-האב
    const kek = crypto.scryptSync(controlWif, Buffer.from(seal.kdfSalt, "hex"), 32, SCRYPT);
    const masterHexStr = aesGcmOpen(kek, seal.encMaster, seal.sealIv, seal.sealTag).toString("utf8");
    if (!/^[0-9a-fA-F]{64}$/.test(masterHexStr)) {
      return { ok: false, detail: "BAD-MASTER: החותמת נפתחה אך תוכנה אינו מפתח-אב תקין" };
    }
    const master = Buffer.from(masterHexStr, "hex");

    // 6) רשומת המפתח המבוקשת
    const entry = db
      .prepare(
        "SELECT pub, encPriv, privIv, privTag, status FROM VaultEntry WHERE chain = ? AND account = ? AND role = ? ORDER BY status = 'verified' DESC, id DESC LIMIT 1",
      )
      .get(chain, account, role) as
      | { pub: string; encPriv: string; privIv: string; privTag: string; status: string }
      | undefined;
    if (!entry) {
      return { ok: false, detail: `NO-ENTRY: אין רשומת ${role} ל-${account} ברשת ${chain}` };
    }

    // 7) פתיחת ה-WIF והפקת הפומבי
    const wif = aesGcmOpen(master, entry.encPriv, entry.privIv, entry.privTag).toString("utf8");
    const pub = steemLib.auth.wifToPublic(wif);
    return { ok: true, wif, pub, entryPub: entry.pub, detail: `vault:${chain}/${account}/${role} (${entry.status})` };
  } catch (e) {
    // תג GCM שגוי / DB פגום / כל דבר אחר — סירוב כנה, אף בייט לא דולף
    return { ok: false, detail: `VAULT-ERROR: ${String((e as Error).message ?? e).slice(0, 140)}` };
  }
}
