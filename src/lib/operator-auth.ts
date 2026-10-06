// ─────────────────────────────────────────────────────────────────────
// operator-auth — סשן-מפעיל חתום, אפס-אחסון-מפתח.
//
// דוקטרינה (זהה לדלת /api/arm): ההרשאה היחידה היא השרשרת.
//   1. ה-WIF (או סיסמת-אב) שהוזן נגזר למפתח-ציבורי.
//   2. המפתח-הציבורי נבדק ביט-מול-ביט מול ה-active החי
//      של @headcorner מ-api.steemit.com.
//   3. התאמה ← טוקן-סשן חתום HMAC-SHA256 (מפתח-סוד שנוצר פעם
//      אחת וחי בדיסק הסנדבוקס בלבד). ה-WIF עצמו לעולם לא נשמר,
//   לא נכתב ללוג, ולא חוזר בשום תשובה.
//
// טוקן: base64url(payload).base64url(hmac) כאשר payload = {pub, exp}.
// TTL 12 שעות. אימות הוא חסר-מצב — השרת לא מחזיק שום טבלת סשן.
// ─────────────────────────────────────────────────────────────────────

import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import os from "os";
import path from "path";

export const OPERATOR_ACCOUNT = "headcorner";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 שעות

// ── סוד החתימה: נוצר פעם אחת ונשמר בתיקיית ה-db של הסנדבוקס ──────────

const SECRET_PATH = path.join(process.cwd(), "db", "session.key");

function sessionSecret(): Buffer {
  try {
    if (existsSync(SECRET_PATH)) {
      const raw = readFileSync(SECRET_PATH, "utf8").trim();
      if (raw.length >= 64) return Buffer.from(raw, "hex");
    }
    const dir = path.dirname(SECRET_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const secret = randomBytes(32).toString("hex");
    writeFileSync(SECRET_PATH, secret + "\n", { mode: 0o600 });
    return Buffer.from(secret, "hex");
  } catch {
    // גלוקלי-מקומי בלבד — לא מיועד לעולם להיכשל; נופלים לסוד-זמני
    return randomBytes(32);
  }
}

// ── base64url ────────────────────────────────────────────────────────

function b64u(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ── הנפקה / אימות ────────────────────────────────────────────────────

export interface OperatorSession {
  pub: string;
  exp: number;
}

export function issueToken(pub: string): { token: string; exp: number } {
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ pub, exp }), "utf8");
  const sig = createHmac("sha256", sessionSecret()).update(payload).digest();
  return { token: `${b64u(payload)}.${b64u(sig)}`, exp };
}

export function verifyToken(token: string | null | undefined): OperatorSession | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  let payload: Buffer;
  let sig: Buffer;
  try {
    payload = Buffer.from(parts[0].replace(/-/g, "+").replace(/_/g, "/"), "base64");
    sig = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64");
  } catch {
    return null;
  }
  const expected = createHmac("sha256", sessionSecret()).update(payload).digest();
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
  let parsed: { pub?: unknown; exp?: unknown };
  try {
    parsed = JSON.parse(payload.toString("utf8")) as { pub?: unknown; exp?: unknown };
  } catch {
    return null;
  }
  if (typeof parsed.pub !== "string" || typeof parsed.exp !== "number") return null;
  if (parsed.exp < Date.now()) return null; // פג-תוקף
  return { pub: parsed.pub, exp: parsed.exp };
}

// ── מפתח-ה-active מכספת-הסוכנים (r185 · D-OP-01) ─────────────────────
//
// הוראת-הבעלים המכוננת: "אין לי סיסמת משמרת... יש לך את כל הסיסמאות שלי
// תפעיל הכל מיד" — אף ממשק לא שואל את המפעיל דבר. המפתח נשאב מ-
// ~/.sovereign/vault/secrets/STEEM_ACTIVE_WIF (0600, מחוץ-לגיט) — אותה
// כספת שהסוכנים קוראים דרך vault-read.mjs — ומשפט מול השרשרת החיה
// לפני כל שימוש. כל קריאה נרשמת access.log (שם+זמן בלבד).
// קש-משמעות: הערך לעולם לא נכתב ללוג/תשובה/שגיאה — רק נגזר ממנו פומבי.

const VAULT_SECRET_PATH = path.join(os.homedir(), ".sovereign", "vault", "secrets", "STEEM_ACTIVE_WIF");
const VAULT_ACCESS_LOG = path.join(os.homedir(), ".sovereign", "vault", "access.log");
const VAULT_WIF_RE = /^[5KL][1-9A-HJ-NP-Za-km-z]{39,59}$/;

let vaultKeyCache: { wif: string; at: number } | null = null;

export function activeWifFromVault(): string | null {
  if (vaultKeyCache && Date.now() - vaultKeyCache.at < 5 * 60_000) return vaultKeyCache.wif;
  try {
    if (!existsSync(VAULT_SECRET_PATH)) return null;
    const raw = readFileSync(VAULT_SECRET_PATH, "utf8").trim();
    if (!VAULT_WIF_RE.test(raw)) return null;
    try {
      appendFileSync(VAULT_ACCESS_LOG, `${new Date().toISOString()} read STEEM_ACTIVE_WIF\n`, { mode: 0o600 });
    } catch {
      /* כישלון-רישום אינו חוסם קריאה */
    }
    vaultKeyCache = { wif: raw, at: Date.now() };
    return raw;
  } catch {
    return null;
  }
}

// ── שליפת הסשן מבקשה (Authorization: Bearer) ──────────────────────────

export function operatorFromRequest(req: Request): OperatorSession | null {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? verifyToken(m[1].trim()) : null;
}

// ── הרשאת-האמת: ה-active החי של המפקד מהשרשרת ───────────────────────

export async function commanderActiveKey(): Promise<string> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 12000);
  try {
    const r = await fetch("https://api.steemit.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "condenser_api.get_accounts",
        params: [[OPERATOR_ACCOUNT]],
      }),
      signal: ac.signal,
      cache: "no-store",
    });
    if (!r.ok) throw new Error(`steem-rpc-http-${r.status}`);
    const j = (await r.json()) as { result?: Array<{ active?: { key_auths?: unknown[][] } }> };
    const auths = j?.result?.[0]?.active?.key_auths;
    if (!Array.isArray(auths) || !auths.length) throw new Error("commander-active-not-readable");
    return String(auths[0][0]);
  } finally {
    clearTimeout(t);
  }
}
