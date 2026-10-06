// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Brain — המוח הריבוני של הרשת (Task 21)
//
// מאגר מפתחות NVIDIA NIM עם רוטציה אוטומטית — "שלא יחסמו אותנו":
//   · 429 (קצב) ⇒ מקרר מפתח-בודד 90 שניות; הבא משרת מיד — בלי שינה.
//   · 401/403 (מת) ⇒ מקרר 30 דקות; שאר המאגר ממשיך.
//   · כל-המפתחות בקירור ⇒ המתנה-מוגבלת (עד 5ש' דגימה) ל-429, כשל-כן למתים.
//   · מפתח-חתום-רקוב אחד לא מסנוור את המאגר — GCM נבדק בפתיחה, נרשם בכנות.
//
// משמרת: המפתחות אטומים ב-DB המקומי (gitignored) תחת גזירת
// מפתח-הרשת — אותה גזירה של ה-DAEMONs (weave-daemon/v1:weave-brain:<netkey>).
// אפס סוד ב-API, בלוג, ב-ledger — רק טביעת-אצבע בלתי-הפיכה (nv-fp:…).
// תווית אמת: המודל עצמו נקרא חי מ-integrate.api.nvidia.com — הריבונות
// היא על המפתחות, הזיהוי והרוטציה, לא על משקולות-המודל.
// ─────────────────────────────────────────────────────────────────────
import crypto from "node:crypto";
import { keccak256, toUtf8Bytes } from "ethers";
import { db } from "@/lib/db";

export const BRAIN_NIM_BASE = "https://integrate.api.nvidia.com/v1/chat/completions";
export const BRAIN_DEFAULT_MODEL = "openai/gpt-oss-20b";

const COOLDOWN_RATE_MS = 90_000; // 429 → 90 שניות למפתח-בודד
const COOLDOWN_DEAD_MS = 30 * 60_000; // 401/403 → 30 דקות
const POOL_WAIT_SAMPLE_MS = 4_000; // הכל בקירור-429 → דגימת-המתנה קצרה וניסיון-חוזר

// ─── גזירת ה-KEK — אותה נוסחה של ה-DAEMONs, אותה תוצאה בכל סביבה ──

function brainKek(netKeyHex: string): Buffer {
  const hex = keccak256(toUtf8Bytes(`weave-daemon/v1:weave-brain:${netKeyHex}`));
  return Buffer.from(hex.slice(2), "hex");
}

async function netKeyHexOrFail(): Promise<string> {
  const nk = await db.networkKey.findUnique({ where: { id: "weave-network" } });
  if (!nk?.devKeyHex) throw new Error("מפתח הרשת אינו זמין — המוח נעול (fail-closed)");
  return nk.devKeyHex;
}

interface BrainRow {
  id: string;
  fingerprint: string;
  encKey: string;
  keyIv: string;
  keyTag: string;
  status: string;
  lastCode: string | null;
  cooldownUntil: Date | null;
  verifiedAt: Date | null;
}

function openBrainKey(kek: Buffer, row: BrainRow): string | null {
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", kek, Buffer.from(row.keyIv, "hex"));
    d.setAuthTag(Buffer.from(row.keyTag, "hex"));
    return Buffer.concat([d.update(Buffer.from(row.encKey, "hex")), d.final()]).toString("utf8");
  } catch {
    return null; // חתום-רקוב — לא מפיל את המאגר, נרשם בכנות
  }
}

// ─── מצב המאגר (מסכה מלאה — לתצוגה ול-API) ──

export interface BrainPoolStatus {
  total: number;
  live: number;
  cooling: number;
  keys: Array<{
    fingerprint: string;
    status: string;
    lastCode: string | null;
    cooldownRemainingSec: number;
    verified: boolean;
  }>;
  model: string;
  endpoint: string;
  ready: boolean;
  at: string;
}

export async function brainPoolStatus(): Promise<BrainPoolStatus> {
  const rows = (await db.brainKey.findMany({ orderBy: { createdAt: "asc" } })) as BrainRow[];
  const now = Date.now();
  const keys = rows.map((r) => {
    const cooling = r.cooldownUntil ? r.cooldownUntil.getTime() > now : false;
    return {
      fingerprint: r.fingerprint,
      status: cooling ? "cooling" : r.status,
      lastCode: r.lastCode,
      cooldownRemainingSec: cooling && r.cooldownUntil ? Math.ceil((r.cooldownUntil.getTime() - now) / 1000) : 0,
      verified: r.status === "verified",
    };
  });
  const live = keys.filter((k) => k.status !== "cooling" && k.verified).length;
  const cooling = keys.filter((k) => k.status === "cooling").length;
  return {
    total: rows.length,
    live,
    cooling,
    keys,
    model: BRAIN_DEFAULT_MODEL,
    endpoint: BRAIN_NIM_BASE,
    ready: live > 0,
    at: new Date().toISOString(),
  };
}

// ─── השרתת מפתח זמין (הרוטציה בפועל) ──

async function serveKey(kek: Buffer): Promise<{ row: BrainRow; key: string } | null> {
  const now = new Date();
  const rows = (await db.brainKey.findMany({
    where: { status: "verified", OR: [{ cooldownUntil: null }, { cooldownUntil: { lte: now } }] },
    orderBy: { cooldownUntil: "asc" }, // המוקדם-להתקרר ראשון — עגלה הוגנת
  })) as BrainRow[];
  for (const row of rows) {
    const key = openBrainKey(kek, row);
    if (key) return { row, key };
  }
  return null;
}

async function markCode(row: BrainRow, code: number): Promise<void> {
  const now = Date.now();
  if (code === 429) {
    await db.brainKey.update({ where: { id: row.id }, data: { lastCode: String(code), cooldownUntil: new Date(now + COOLDOWN_RATE_MS) } });
  } else if (code === 401 || code === 403) {
    await db.brainKey.update({ where: { id: row.id }, data: { lastCode: String(code), cooldownUntil: new Date(now + COOLDOWN_DEAD_MS) } });
  } else {
    await db.brainKey.update({ where: { id: row.id }, data: { lastCode: String(code), verifiedAt: new Date(now), cooldownUntil: null } });
  }
}

export interface BrainChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface BrainChatResult {
  ok: boolean;
  model: string;
  keyFingerprint: string;
  content: string;
  attempts: number;
  error?: string;
}

/**
 * המוח מדבר — chat completion עם רוטציה אוטומטית על פני המאגר.
 * מי שקורא: סוכני הרשת (API) והמפעיל (UI). אפס סוד חוזר לעולם.
 */
export async function brainChat(
  messages: BrainChatMessage[],
  opts?: { model?: string; maxTokens?: number; temperature?: number }
): Promise<BrainChatResult> {
  const model = opts?.model ?? BRAIN_DEFAULT_MODEL;
  const kek = brainKek(await netKeyHexOrFail());

  let current = await serveKey(kek);
  if (!current) {
    // הכל בקירור? אולי 429 — דגימת-המתנה קצרה וניסיון-חוזר אחד (לא שינה)
    const rows = (await db.brainKey.findMany()) as BrainRow[];
    const anyDead = rows.some((r) => r.lastCode === "401" || r.lastCode === "403");
    if (rows.length > 0 && !anyDead) {
      await new Promise((r) => setTimeout(r, POOL_WAIT_SAMPLE_MS));
      current = await serveKey(kek);
    }
    if (!current) {
      return { ok: false, model, keyFingerprint: "—", content: "", attempts: 0, error: "המאגר בקירור — אין מפתח זמין כרגע (fail-closed כן)" };
    }
  }

  let attempts = 0;
  while (current) {
    attempts++;
    const res = await fetch(BRAIN_NIM_BASE, {
      method: "POST",
      headers: { Authorization: `Bearer ${current.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: opts?.maxTokens ?? 512,
        temperature: opts?.temperature ?? 0.2,
      }),
      signal: AbortSignal.timeout(60_000),
    }).catch(() => null);

    if (res && res.ok) {
      const j = (await res.json().catch(() => null)) as { choices?: Array<{ message?: { content?: string } }> } | null;
      const content = j?.choices?.[0]?.message?.content ?? "";
      await markCode(current.row, 200);
      return { ok: true, model, keyFingerprint: current.row.fingerprint, content, attempts };
    }
    const code = res?.status ?? 0;
    await markCode(current.row, code);
    if (code !== 429 && code !== 401 && code !== 403) {
      // כשל רשת/שרת — אין טעם לסובב מפתחים על שגיאה שאינה בעיית-מפתח
      return { ok: false, model, keyFingerprint: current.row.fingerprint, content: "", attempts, error: `כשל NIM (${code || "network"}) — fail-closed` };
    }
    current = await serveKey(kek); // המפתח הבא, או כלום — כל מפתח נוסה פעם אחת
  }
  return { ok: false, model, keyFingerprint: "—", content: "", attempts, error: "המאגר אזל ברוטציה — כל המפתחות נדחו (429/401/403)" };
}

/** בדיקת-אמת חיה של כל המאגר — 1-token chat (לא /v1/models הציבורי-המטעה). */
export async function brainProbeAll(): Promise<Array<{ fingerprint: string; live: boolean; code: number | string }>> {
  const kek = brainKek(await netKeyHexOrFail());
  const rows = (await db.brainKey.findMany({ orderBy: { createdAt: "asc" } })) as BrainRow[];
  const out: Array<{ fingerprint: string; live: boolean; code: number | string }> = [];
  for (const row of rows) {
    const key = openBrainKey(kek, row);
    if (!key) {
      out.push({ fingerprint: row.fingerprint, live: false, code: "seal-broken" });
      await db.brainKey.update({ where: { id: row.id }, data: { status: "unverified", lastCode: "seal-broken" } });
      continue;
    }
    try {
      const res = await fetch(BRAIN_NIM_BASE, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: BRAIN_DEFAULT_MODEL, messages: [{ role: "user", content: "1" }], max_tokens: 1 }),
        signal: AbortSignal.timeout(30_000),
      });
      const live = res.ok;
      await db.brainKey.update({
        where: { id: row.id },
        data: {
          status: live ? "verified" : "unverified",
          lastCode: String(res.status),
          verifiedAt: live ? new Date() : row.verifiedAt,
          cooldownUntil: null,
        },
      });
      out.push({ fingerprint: row.fingerprint, live, code: res.status });
    } catch (e) {
      out.push({ fingerprint: row.fingerprint, live: false, code: e instanceof Error ? e.message.slice(0, 40) : "err" });
    }
  }
  return out;
}
