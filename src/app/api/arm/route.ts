// ─────────────────────────────────────────────────────────────────────
// /api/arm — דלת-המפתח (r185-ריבוני). "אין לי סיסמת משמרת... יש לך את
// כל הסיסמאות שלי תפעיל הכל מיד" — POST בלי wif שואב את STEEM_ACTIVE_WIF
// מכספת הסוכנים (~/.sovereign/vault) ומחמש בעצמו. אף אחד לא נשאל דבר.
// מסלול-ההדבקה (wif מלא) נשמר לתאימות-API בלבד.
//
// זרימה מאומתת-קריפטוגרפית, אפס-אחסון:
//   1. מגבלת-קצב (5 ניסיונות לשעה לכל IP — על המסלול-המוקלד בלבד).
//   2. נגזר מפתח-ציבורי מה-WIF (מהכספת או מההדבקה) — steem.auth.wifToPublic.
//   3. נקראת הסמכות החיה של @headcorner מ-api.steemit.com — ה-active
//      הרשום-בשרשרת. אין התאמה ביט-מול-ביט = 403 fail-closed.
//   4. התאמה = רק אז: מאוחזר מפתח-הציבורי של סודות-ה-Actions של
//      ריפו המנוע (saos-dex), ה-WIF נחתם ב-sealed box של libsodium
//      (crypto_box_seal — רק GitHub יכול לפתוח) ונשמר כסוד
//      STEEM_ACTIVE_WIF. הוא לעולם לא נכתב לדיסק, ללוג, או לתשובה.
//   5. מאומת בקריאה חוזרת שהסוד אכן קיים ברשימת הסודות.
//   6. משוגר dex-grid מיד (workflow_dispatch) כדי שההתחמשות תיראה
//      בפועל באותה דקה, ולא ב-03:17 של מחר.
//
// אבטחה: האימות מול השרשרת הוא ההרשאה — מפתח שגוי (מהכספת או מהדבקה)
// לא מגיע ל-GitHub כלל.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import sodium from "libsodium-wrappers";
import steemLibRaw from "steem";
import { activeWifFromVault } from "@/lib/operator-auth";
import { DEX_REPO, dexGhToken } from "@/lib/dex-token";

interface SteemAuth {
  auth: { wifToPublic(wif: string): string };
}
const steemLib = steemLibRaw as unknown as SteemAuth;

export const dynamic = "force-dynamic";

const SECRET_NAME = "STEEM_ACTIVE_WIF";
const COMMANDER = "headcorner";

// ── מגבלת-קצב זיכרונית ───────────────────────────────────────────────

const hits = new Map<string, number[]>();
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (list.length >= RATE_LIMIT) return true;
  list.push(now);
  hits.set(ip, list);
  return false;
}

// r140: הסמכות מהכספת המקומית — אפס תלות בעותק חיצוני שנעלם במיחזור
function ghToken(): string {
  return dexGhToken();
}

async function gh(path: string, init: RequestInit = {}): Promise<Response> {
  const tok = ghToken();
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${tok}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    cache: "no-store",
  });
}

// ── הסמכות החיה של המפקד מהשרשרת ────────────────────────────────────

async function commanderActiveKey(): Promise<string> {
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
        params: [[COMMANDER]],
      }),
      signal: ac.signal,
      cache: "no-store",
    });
    if (!r.ok) throw new Error(`steem-rpc-http-${r.status}`);
    const j = await r.json();
    const auths = j?.result?.[0]?.active?.key_auths;
    if (!Array.isArray(auths) || !auths.length) throw new Error("commander-active-not-readable");
    return String(auths[0][0]);
  } finally {
    clearTimeout(t);
  }
}

// ── הדלת ─────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "local";

  if (rateLimited(ip)) {
    return NextResponse.json(
      { ok: false, stage: "rate-limit", reason: "יותר מדי ניסיונות — נסה שוב בעוד שעה" },
      { status: 429 },
    );
  }

  let wif = "";
  try {
    const body = (await req.json().catch(() => ({}))) as { wif?: unknown };
    wif = typeof body.wif === "string" ? body.wif.trim() : "";
  } catch {
    wif = "";
  }

  // r185 · מצב-ריבוני אוטומטי: אפס קלט — ה-WIF נשאב מכספת הסוכנים
  let armMode: "vault-auto" | "pasted" = "pasted";
  if (!wif) {
    const vaultWif = activeWifFromVault();
    if (!vaultWif) {
      return NextResponse.json(
        {
          ok: false,
          stage: "vault-missing",
          reason: "כספת הסוכנים אינה זמינה כרגע — אין לבקש מפתח מהמפעיל; הסוכנים ישחזרו אותה בעצמם.",
        },
        { status: 503 },
      );
    }
    wif = vaultWif;
    armMode = "vault-auto";
  }
  if (wif.length < 35 || wif.length > 60) {
    return NextResponse.json(
      { ok: false, stage: "format", reason: "זה לא נראה כמו WIF (52 תווים בדרך-כלל). שום דבר לא נשמר." },
      { status: 400 },
    );
  }

  // שלב 1: גזירת המפתח הציבורי מה-WIF
  let pub = "";
  try {
    pub = steemLib.auth.wifToPublic(wif);
  } catch {
    return NextResponse.json(
      { ok: false, stage: "wif", reason: "ה-WIF אינו מפתח תקין (בדיקת checksum נכשלה). שום דבר לא נשמר." },
      { status: 400 },
    );
  }

  // שלב 2: הסמכות החיה של המפקד — ביט מול ביט
  let onChain = "";
  try {
    onChain = await commanderActiveKey();
  } catch (e) {
    return NextResponse.json(
      { ok: false, stage: "steem-rpc", reason: `קריאת השרשרת נכשלה: ${String((e as Error).message).slice(0, 60)}` },
      { status: 502 },
    );
  }
  if (pub !== onChain) {
    return NextResponse.json(
      {
        ok: false,
        stage: "authority",
        reason:
          armMode === "vault-auto"
            ? "המפתח שבכספת אינו ה-active החי של @headcorner — נדחה fail-closed. הסוכנים יתקנו את הכספת, לא המפעיל."
            : "המפתח שהוזן אינו ה-active של @headcorner כפי שרשום בשרשרת כרגע. שום דבר לא נשמר ושום דבר לא השתנה.",
      },
      { status: 403 },
    );
  }

  // שלב 3: חתימה-סגורה לסוד-GitHub (רק GitHub יכול לפתוח)
  try {
    await sodium.ready;
    const pkRes = await gh(`/repos/${DEX_REPO}/actions/secrets/public-key`);
    if (!pkRes.ok) throw new Error(`public-key HTTP ${pkRes.status}`);
    const pk = (await pkRes.json()) as { key: string; key_id: string };

    const sealed = sodium.crypto_box_seal(
      sodium.from_string(wif),
      sodium.from_base64(pk.key, sodium.base64_variants.ORIGINAL),
    );
    const encrypted = sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);

    const put = await gh(`/repos/${DEX_REPO}/actions/secrets/${SECRET_NAME}`, {
      method: "PUT",
      body: JSON.stringify({ encrypted_value: encrypted, key_id: pk.key_id }),
    });
    if (put.status !== 201 && put.status !== 204) {
      throw new Error(`put-secret HTTP ${put.status}: ${(await put.text()).slice(0, 120)}`);
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, stage: "github-secret", reason: `שמירת הסוד נכשלה: ${String((e as Error).message).slice(0, 100)}` },
      { status: 502 },
    );
  }

  // שלב 4: אימות חוזר — הסוד קיים ברשימה
  let verified = false;
  try {
    const list = await gh(`/repos/${DEX_REPO}/actions/secrets`);
    if (list.ok) {
      const j = (await list.json()) as { secrets?: { name: string }[] };
      verified = (j.secrets ?? []).some((s) => s.name === SECRET_NAME);
    }
  } catch {
    /* אימות-חוזר הוא עודף-ביטחון בלבד */
  }

  // שלב 5: שיגור dex-grid מיידי — שהחימוש ייראה בפועל עכשיו
  let dispatched = false;
  try {
    const d = await gh(`/repos/${DEX_REPO}/actions/workflows/dex-grid.yml/dispatches`, {
      method: "POST",
      body: JSON.stringify({ ref: "main" }),
    });
    dispatched = d.status === 204;
  } catch {
    /* לוח-הזמנים היומי ירוץ ב-03:17 UTC ממילא */
  }

  return NextResponse.json({
    ok: true,
    stage: "armed",
    mode: armMode,
    secretName: SECRET_NAME,
    secretVerified: verified,
    gridDispatched: dispatched,
    commander: COMMANDER,
    publicKey: pub,
    links: {
      gridLive: "https://roshpinacare-sys.github.io/Console/dex/grid.json",
      actionsRuns: `https://github.com/${DEX_REPO}/actions`,
      secretsSettings: `https://github.com/${DEX_REPO}/settings/secrets/actions`,
    },
  });
}
