// ─────────────────────────────────────────────────────────────────────
// COCKPIT SEAL LIB · חותם-הרשת בתוך תא-הפיקוד
//
// המעטפות חיות כאן: sovereign/weave-seal.enc + sovereign/headcorner-seal.enc
// (מועתקות מ-Zip/sovereign — אותן מעטפות קנוניות, אפס-סיבוב-מפתחות).
//
// נוסחת הבית (r135, scripts/weave-seal.ts ב-Zip): MAGIC בשורה-הראשונה,
// hex(salt16+iv12+tag16+ct) בשורות של 100 · scrypt(N=2^14) + aes-256-gcm.
//
// משמרת-מפוצלת (מטא): GitHub Secrets בענן (WEAVE_SEAL_PASSPHRASE /
// HEADCORNER_SEAL_PASSPHRASE / MAIN_KEY) · .env.local בסנדבוקס · המפעיל.
// הסיסמה לעולם לא בגיט — המעטפת חסרת-ערך לבדה.
//
// נתיב-השחזור המקומי הקנוני (r72/R93 · seal-recover-local.ts + seal-adopt.mjs):
// המפתחות עצמם מעולם לא הוחלפו — רק הסיסמה סבבה (G3 → r72). לפני הסבב
// הסיסמה חיה במטא שבגיט (דוקטרינת ריפו-פרטי דאז) — blob היסטורי + סיסמה
// היסטורית משושלת הגיט = אותם מפתחות בדיוק (מדוד: כתובות תואמות-מטא-חי).
//
// חוקי-ברזל:
//   · אף סיסמה, אף מפתח — לא מודפסים, לא נכנסים ללוג או לתשובת-API.
//   · כתובות חייבות להתאים למטא החי — אי-התאמה = דחייה כנה, אפס כתיבה.
//   · fail-closed: בלי פתיחה — סטטוס GATED, אפס סודות בתשובה.
// ─────────────────────────────────────────────────────────────────────

import * as crypto from "crypto";
import * as fs from "fs";
import path from "path";
import { db } from "@/lib/db";

const ROOT = path.resolve(process.cwd());
const SEAL_DIR = path.join(ROOT, "sovereign");
const MAGIC = "WEAVE-CLOUD-SEAL-1";
const HC_MAGIC = "HEADCORNER-KEY-SEAL-1";

// Zip repo (the sovereign home) — lineage refs for the pre-G3 pair
const ZIP_REPO = "roshpinacare-sys/Zip";
const HIST_COMMIT = "a776515"; // הקומיט שבו הסיסמה עוד במטא (לפני סבב G3)

export interface SealPayload {
  format: string;
  sealedAt: string;
  cloudKeyHex?: string;
  networkKeyHex?: string;
  cloudAddress?: string;
  networkAddress?: string;
  keyFingerprint?: string;
  account?: string;
}

export interface EnvelopeInfo {
  name: "weave" | "headcorner";
  encPath: string;
  metaPath: string;
  encExists: boolean;
  meta: Record<string, unknown> | null;
}

function readTokenFromPatEnv(): string | null {
  try {
    const raw = fs.readFileSync(path.join(ROOT, "upload", "pat.env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (t.length === 0) continue;
      // פורמט נתמך: "VAR=token" או טוקן-גולמי בשורה
      const m = t.match(/^[A-Za-z_][A-Za-z0-9_]*=(.+)$/);
      const v = (m ? m[1] : t).trim();
      if (v.length > 20 && !/\s/.test(v)) return v;
    }
  } catch {
    /* no pat — lineage path unavailable */
  }
  return null;
}

function parseEnvelopeText(raw: string): { magic: string; payloadHex: string } {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const magic = lines[0];
  const payloadHex = lines.slice(1).join("");
  if (!/^[0-9a-fA-F]+$/.test(payloadHex)) throw new Error("seal body אינו hex תקני");
  return { magic, payloadHex };
}

function readEnvelopeFile(p: string): { magic: string; payloadHex: string } {
  return parseEnvelopeText(fs.readFileSync(p, "utf8"));
}

export function sealDecrypt(payloadHex: string, passphrase: string, expectMagic = MAGIC): SealPayload {
  const payload = Buffer.from(payloadHex, "hex");
  if (payload.length < 45) throw new Error("seal payload קצר מכדי להיות תקני");
  const salt = payload.subarray(0, 16);
  const iv = payload.subarray(16, 28);
  const tag = payload.subarray(28, 44);
  const ct = payload.subarray(44);
  // scrypt ברירת-מחדל N=2^14 — תואם המטא (kdf: scrypt(2^14))
  const key = crypto.scryptSync(passphrase, salt, 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(pt) as SealPayload;
  if (parsed.format !== expectMagic) throw new Error("תוכן seal לא מזוהה");
  return parsed;
}

// ── מטמון-זיכרון בלבד (מיחזור-סנדבוקס = סגירה-כנה והדלת נפתחת מחדש) ──

interface OpenState {
  open: boolean;
  at: string;
  via: string;
  addresses: Record<string, string>;
}
const memState: Record<string, OpenState> = {};

export function memoryState(name: string): OpenState | null {
  return memState[name] ?? null;
}

export function markOpen(name: string, via: string, addresses: Record<string, string>) {
  memState[name] = { open: true, at: new Date().toISOString(), via, addresses };
}

// ── DB cache (אותו מקום שהפעימה-בענן הייתה כותבת) ───────────────────

export async function dbKey(id: string) {
  try {
    return await db.sealKey.findUnique({ where: { id } });
  } catch {
    return null;
  }
}

async function dbUpsert(id: string, address: string, secretHex: string | null, source: string) {
  await db.sealKey.upsert({
    where: { id },
    create: { id, address, secretHex, source },
    update: { secretHex, address, source },
  });
}

// ── env משמרת (מהסביבה — .env.local מקומי / GitHub Secret בענן) ──────

function envPassphrases(name: "weave" | "headcorner"): string[] {
  const vals: string[] = [];
  const push = (v: string | undefined) => {
    if (typeof v === "string" && v.trim().length > 0) vals.push(v.trim());
  };
  if (name === "weave") {
    push(process.env.WEAVE_SEAL_PASSPHRASE);
    push(process.env.MAIN_KEY);
  } else {
    push(process.env.HEADCORNER_SEAL_PASSPHRASE);
    push(process.env.WEAVE_SEAL_PASSPHRASE); // אותו ערך נמסר תחת שני השמות
    push(process.env.MAIN_KEY);
  }
  return vals;
}

// ── נתיב-השושלת: blob היסטורי + סיסמה היסטורית משושלת הגיט ──────────
// (seal-adopt.mjs r72: "מוציא מההיסטוריה כל (blob, סיסמה) אפשרי... המפתחות
// זהים לאורך השושלת — הסבבים החליפו סיסמאות בלבד")

let lineageCache: { keys: SealPayload; at: string } | null = null;
let lineageLastErr: string | null = null;

async function fetchZipRaw(ref: string, file: string, token: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/${ZIP_REPO}/${ref}/${file}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!r.ok) throw new Error(`zip-raw ${r.status}`);
  return r.text();
}

async function lineageOpen(): Promise<SealPayload | null> {
  if (lineageCache) return lineageCache.keys;
  lineageLastErr = null;
  const token = process.env.GITHUB_TOKEN?.trim() || readTokenFromPatEnv();
  if (!token) {
    lineageLastErr = "no-token";
    return null;
  }
  try {
    const oldMetaRaw = await fetchZipRaw(HIST_COMMIT, "sovereign/weave-seal.meta.json", token);
    const oldEncRaw = await fetchZipRaw(HIST_COMMIT, "sovereign/weave-seal.enc", token);
    const oldMeta = JSON.parse(oldMetaRaw) as { passphrase?: string };
    if (typeof oldMeta.passphrase !== "string" || oldMeta.passphrase.length === 0) {
      lineageLastErr = "no-pass-in-meta";
      return null;
    }
    const { payloadHex } = parseEnvelopeText(oldEncRaw);
    const keys = sealDecrypt(payloadHex, oldMeta.passphrase, MAGIC);
    // השער המשולש: הכתובות מה-blob ההיסטורי חייבות להתאים למטא החי המקומי
    const curMeta = JSON.parse(fs.readFileSync(path.join(SEAL_DIR, "weave-seal.meta.json"), "utf8")) as {
      cloudAddress?: string;
      networkAddress?: string;
    };
    if (keys.cloudAddress?.toLowerCase() !== curMeta.cloudAddress?.toLowerCase()) {
      lineageLastErr = "cloud-addr-mismatch";
      return null;
    }
    if (keys.networkAddress?.toLowerCase() !== curMeta.networkAddress?.toLowerCase()) {
      lineageLastErr = "network-addr-mismatch";
      return null;
    }
    lineageCache = { keys, at: new Date().toISOString() };
    return keys;
  } catch (e) {
    lineageLastErr = String(e instanceof Error ? e.message : e).slice(0, 80);
    return null; // fail-closed כנה — אין שרשרת-שחזור
  }
}

// ── פתיחה-מלאה: env → שושלת → מטמון-DB → fail-closed ────────────────

export interface SealStatus {
  weave: {
    envelopeExists: boolean;
    rotatedAt: string | null;
    cloudAddress: string | null;
    networkAddress: string | null;
    custody: "OPEN" | "GATED";
    via: string | null;
    networkKeyCached: boolean;
  };
  headcorner: {
    envelopeExists: boolean;
    sealedAt: string | null;
    zeroRotation: boolean;
    localKeyPresent: boolean;
    localKeyPath: string;
    custody: "OPEN" | "GATED";
  };
  door: string;
  noteHe: string;
  lineageNote: string | null;
}

export async function sealStatus(): Promise<SealStatus> {
  const weaveEnc = path.join(SEAL_DIR, "weave-seal.enc");
  const weaveMetaP = path.join(SEAL_DIR, "weave-seal.meta.json");
  const hcEnc = path.join(SEAL_DIR, "headcorner-seal.enc");
  const hcMetaP = path.join(SEAL_DIR, "headcorner-seal.meta.json");

  let weaveMeta: { rotatedAt?: string; cloudAddress?: string; networkAddress?: string } | null = null;
  let hcMeta: { sealedAt?: string; zeroRotation?: boolean } | null = null;
  try {
    weaveMeta = JSON.parse(fs.readFileSync(weaveMetaP, "utf8"));
  } catch { /* absent */ }
  try {
    hcMeta = JSON.parse(fs.readFileSync(hcMetaP, "utf8"));
  } catch { /* absent */ }

  // weave: env קודם, אחר-כך השושלת (r72), אחר-כך מטמון ה-DB
  let weaveOpen = false;
  let weaveVia: string | null = null;
  const envP = envPassphrases("weave");
  if (fs.existsSync(weaveEnc) && weaveMeta) {
    for (const p of envP) {
      try {
        const { payloadHex } = readEnvelopeFile(weaveEnc);
        const payload = sealDecrypt(payloadHex, p, MAGIC);
        if (
          payload.networkAddress?.toLowerCase() === weaveMeta.networkAddress?.toLowerCase() &&
          payload.cloudAddress?.toLowerCase() === weaveMeta.cloudAddress?.toLowerCase()
        ) {
          weaveOpen = true;
          weaveVia = "env";
          markOpen("weave", "env", {
            cloud: payload.cloudAddress!,
            network: payload.networkAddress!,
          });
          const nk = normKey(payload.networkKeyHex!);
          if (/^[0-9a-f]{64}$/.test(nk)) {
            await dbUpsert("weave-network", payload.networkAddress!.toLowerCase(), "0x" + nk, "env").catch(() => {});
          }
          break;
        }
      } catch {
        /* wrong passphrase — continue */
      }
    }
    if (!weaveOpen) {
      const keys = await lineageOpen();
      if (keys) {
        weaveOpen = true;
        weaveVia = `lineage(${HIST_COMMIT})`;
        markOpen("weave", weaveVia, {
          cloud: keys.cloudAddress!,
          network: keys.networkAddress!,
        });
        const nk = normKey(keys.networkKeyHex!);
        if (/^[0-9a-f]{64}$/.test(nk)) {
          await dbUpsert("weave-network", keys.networkAddress!.toLowerCase(), "0x" + nk, "lineage").catch(() => {});
        }
        const ck = normKey(keys.cloudKeyHex!);
        if (/^[0-9a-f]{64}$/.test(ck)) {
          await dbUpsert("weave-cloud", keys.cloudAddress!.toLowerCase(), "0x" + ck, "lineage").catch(() => {});
        }
      }
    }
  }
  if (!weaveOpen) {
    const cached = await dbKey("weave-network");
    if (cached?.secretHex) {
      weaveOpen = true;
      weaveVia = "db-cache";
    }
  }

  // headcorner: המפתח-עצמו חי ב-.secrets/headcorner.key (0600, מאומץ-מנוע)
  const hcKeyPath = path.join(ROOT, ".secrets", "headcorner.key");
  const hcLocalKey = fs.existsSync(hcKeyPath);
  let hcOpen = hcLocalKey;
  if (!hcOpen && fs.existsSync(hcEnc)) {
    for (const p of envP) {
      try {
        const { magic, payloadHex } = readEnvelopeFile(hcEnc);
        void magic;
        const payload = sealDecrypt(payloadHex, p, HC_MAGIC);
        if (payload.keyFingerprint || payload.account) {
          hcOpen = true;
          markOpen("headcorner", "env", { fingerprint: payload.keyFingerprint ?? "" });
          await dbUpsert("headcorner-key", payload.keyFingerprint ?? "headcorner", null, "env").catch(() => {});
          break;
        }
      } catch {
        /* wrong passphrase — continue */
      }
    }
  }

  return {
    weave: {
      envelopeExists: fs.existsSync(weaveEnc),
      rotatedAt: weaveMeta?.rotatedAt ?? null,
      cloudAddress: weaveMeta?.cloudAddress ?? null,
      networkAddress: weaveMeta?.networkAddress ?? null,
      custody: weaveOpen ? "OPEN" : "GATED",
      via: weaveVia,
      networkKeyCached: Boolean((await dbKey("weave-network"))?.secretHex),
    },
    headcorner: {
      envelopeExists: fs.existsSync(hcEnc),
      sealedAt: hcMeta?.sealedAt ?? null,
      zeroRotation: Boolean(hcMeta?.zeroRotation),
      localKeyPresent: hcLocalKey,
      localKeyPath: ".secrets/headcorner.key",
      custody: hcOpen ? "OPEN" : "GATED",
    },
    door: "POST /api/arm/seal {passphrase} — הצעד-היחיד של המפעיל להשיב סמכות",
    noteHe:
      "הסיסמה במשמרת-מפוצלת (GitHub Secrets / .env.local / המפעיל) ולעולם לא בגיט. מפתחות-הענן-והרשת מעולם לא הוחלפו (r72) — נתיב-השושלת משחזר אותם מקומית בלי שום מסירה חוץ-גיט.",
    lineageNote: weaveOpen ? null : lineageLastErr,
  };
}

const HEX64 = /^[0-9a-f]{64}$/;
export const normKey = (k: string) => k.replace(/^0x/, "").toLowerCase();
export const toKeyHex = (k: string) => "0x" + normKey(k);

/** הדלת: בדיקת סיסמה מול מעטפת אחת (בזיכרון בלבד) — מחזיר payload או null */
export function tryOpenEnvelope(name: "weave" | "headcorner", passphrase: string): SealPayload | null {
  const p = name === "weave" ? path.join(SEAL_DIR, "weave-seal.enc") : path.join(SEAL_DIR, "headcorner-seal.enc");
  const magic = name === "weave" ? MAGIC : HC_MAGIC;
  try {
    const { payloadHex } = readEnvelopeFile(p);
    return sealDecrypt(payloadHex, passphrase, magic);
  } catch {
    return null; // GCM דוחה סיסמה שגויה מיד
  }
}

export async function persistWeaveKeys(payload: SealPayload): Promise<boolean> {
  const meta = JSON.parse(fs.readFileSync(path.join(SEAL_DIR, "weave-seal.meta.json"), "utf8")) as {
    cloudAddress?: string;
    networkAddress?: string;
  };
  const netOk = HEX64.test(normKey(payload.networkKeyHex ?? "")) && payload.networkAddress?.toLowerCase() === meta.networkAddress?.toLowerCase();
  const cloudOk = HEX64.test(normKey(payload.cloudKeyHex ?? "")) && payload.cloudAddress?.toLowerCase() === meta.cloudAddress?.toLowerCase();
  if (!netOk || !cloudOk) return false;
  await dbUpsert("weave-network", payload.networkAddress!.toLowerCase(), toKeyHex(payload.networkKeyHex!), "custody-return");
  await dbUpsert("weave-cloud", payload.cloudAddress!.toLowerCase(), toKeyHex(payload.cloudKeyHex!), "custody-return");
  markOpen("weave", "custody-return", { cloud: payload.cloudAddress!, network: payload.networkAddress! });
  return true;
}

export async function persistHeadcorner(payload: SealPayload): Promise<boolean> {
  if (!payload.keyFingerprint && !payload.account) return false;
  await dbUpsert("headcorner-key", payload.keyFingerprint ?? payload.account!, null, "custody-return");
  markOpen("headcorner", "custody-return", { fingerprint: payload.keyFingerprint ?? "" });
  return true;
}
