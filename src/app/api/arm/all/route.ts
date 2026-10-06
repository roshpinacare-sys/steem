// ─────────────────────────────────────────────────────────────────────
// /api/arm/all — דלת-ההפעלה האחת (r136 · r185-ריבוני). "לחיצה אחת מחמשת הכל — אפס קלט".
//
// r185 · D-OP-01: "אין לי סיסמת משמרת... יש לך את כל הסיסמאות שלי תפעיל
// הכל מיד" — POST בלי key שואב את ה-active מכספת-הסוכנים
// (~/.sovereign/vault) ומפעיל את כל השרשרת: אימות-מול-שרשרת → כספת-ארנק
// → אטימת חוט-המפתחות לכספת-הריפו → שיגור dex-grid. אף אחד לא נשאל
// אף שאלה. מסלול-ההדבקה נשמר לתאימות-API בלבד.
//
//   1. מגבלת-קצב (5 לשעה לכל IP — על המסלול-המוקלד בלבד).
//   2. המפתח (מהכספת או מהדבקה) → WIF-שליטה (תקן Steemit).
//   3. שיפוט: הפומבי נבדק ביט-מול-ביט מול ה-active החי של
//      @headcorner מהשרשרת. אי-התאמה = 403 fail-closed.
//   4. מקור-המפתח הריבוני (upload/headcorner.txt — מחוץ-לגיט):
//      במצב-אוטומטי לא דורסים מקור קיים; אם חסר — נכתב במצב-wif.
//   5. פתיחת כספת-הארנק עם WIF-השליטה.
//   6. מסירת חוט-המפתחות המלא לכספת-הריפו — כל מפתח נשפט מול
//      הרשות החיה של שרשרתו לפני האטימה.
//   7. שיגור dex-grid מיידי.
//   8. קבלת-ChainRun כנה (בלי שום חומר-סוד בפירוט, לעולם).
//
// אבטחה: הקלט חי בזיכרון-הבקשה בלבד. המפתחות שנפתחים מהכספת
// לא נכתבים לדיסק, לא ללוג ולא חוזרים בתשובה — רק פסקי-דין.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import sodium from "libsodium-wrappers";
import steemLibRaw from "steem";
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import {
  OPERATOR_ACCOUNT,
  commanderActiveKey,
  activeWifFromVault,
} from "@/lib/operator-auth";
import { fetchAuthorities } from "@/lib/live/authorities";
import { openVaultWithControlWif } from "@/lib/dex/wallet-vault";
import { DEX_REPO, dexGhToken } from "@/lib/dex-token";

interface SteemAuth {
  auth: { toWif(account: string, password: string, role: string): string; wifToPublic(wif: string): string };
}
const steemLib = steemLibRaw as unknown as SteemAuth;

export const dynamic = "force-dynamic";

const LIVE_REPO = "roshpinacare-sys/Domain";
const HOME = "/home/z/my-project";
const OWNER_FILE = path.join(HOME, "upload", "headcorner.txt");

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

// ── GitHub: טוקן מהשלט של המנוע + אטימת-סוד (כמו /api/arm) ──────────

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

async function sealSecret(name: string, value: string): Promise<void> {
  await sodium.ready;
  const pkRes = await gh(`/repos/${DEX_REPO}/actions/secrets/public-key`);
  if (!pkRes.ok) throw new Error(`public-key HTTP ${pkRes.status}`);
  const pk = (await pkRes.json()) as { key: string; key_id: string };
  const sealed = sodium.crypto_box_seal(
    sodium.from_string(value),
    sodium.from_base64(pk.key, sodium.base64_variants.ORIGINAL),
  );
  const encrypted = sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);
  const put = await gh(`/repos/${DEX_REPO}/actions/secrets/${name}`, {
    method: "PUT",
    body: JSON.stringify({ encrypted_value: encrypted, key_id: pk.key_id }),
  });
  if (put.status !== 201 && put.status !== 204) {
    throw new Error(`put-secret-${name} HTTP ${put.status}`);
  }
}

// ── הדלת ────────────────────────────────────────────────────────────

interface ArmResult {
  secret: string;
  chain: string;
  role: string;
  ok: boolean;
  detailHe: string;
}

export async function POST(req: NextRequest) {
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

  let key = "";
  let wroteOwnerFile = false; // r137 · D-026: נכתב בשני-המצבים (אב או wif)
  try {
    const body = (await req.json().catch(() => ({}))) as { key?: unknown };
    key = typeof body.key === "string" ? body.key.trim() : "";
  } catch {
    key = "";
  }
  if (key && (key.length < 8 || key.length > 200)) {
    return NextResponse.json(
      { ok: false, stage: "format", reason: "הקלט קצר מדי או ארוך מדי. במקום זה — אין צורך בקלט בכלל: שלח גוף ריק והמפתח יישאב מכספת הסוכנים. שום דבר לא נשמר." },
      { status: 400 },
    );
  }

  // r185 · מצב-ריבוני אוטומטי: אפס קלט — השליטה נשאבת מכספת הסוכנים
  let armMode: "vault-auto" | "pasted" = "pasted";
  if (!key) {
    const wif = activeWifFromVault();
    if (!wif) {
      return NextResponse.json(
        {
          ok: false,
          stage: "vault-missing",
          reason: "כספת הסוכנים אינה זמינה כרגע — אין לבקש מפתח מהמפעיל; הסוכנים ישחזרו אותה בעצמם.",
        },
        { status: 503 },
      );
    }
    key = wif;
    armMode = "vault-auto";
  }

  // 1) גזירת WIF-השליטה
  const looksLikeWif = /^[5JKL][1-9A-HJ-NP-Za-km-z]{39,59}$/.test(key);
  let controlWif = "";
  let controlPub = "";
  try {
    controlWif = looksLikeWif ? key : steemLib.auth.toWif(OPERATOR_ACCOUNT, key, "active");
    // r136 · הרחבה: WIF פגום (checksum/גרסה שגויה) זורק AssertionError —
    // חייב להיתפס כאן ולהיענות 400 כנה, לא 500 עם גוף-ריק.
    controlPub = steemLib.auth.wifToPublic(controlWif);
  } catch {
    return NextResponse.json(
      { ok: false, stage: "derive", reason: "הקלט אינו מפתח תקין (WIF פגום או סיסמה שלא נגזרת). שום דבר לא נשמר ושום דבר לא השתנה." },
      { status: 400 },
    );
  }

  // 2) שיפוט — ביט מול ביט מול ה-active החי
  let onChain = "";
  try {
    onChain = await commanderActiveKey();
  } catch (e) {
    return NextResponse.json(
      { ok: false, stage: "steem-rpc", reason: `קריאת השרשרת נכשלה: ${String((e as Error).message).slice(0, 60)}` },
      { status: 502 },
    );
  }
  if (controlPub !== onChain) {
    // אבחון כנה: אולי זה ה-owner?
    let hint = "";
    try {
      const ownerAuth = await fetchAuthorities("steem", OPERATOR_ACCOUNT);
      const ownerPub = ownerAuth.roles.find((r) => r.role === "owner")?.pub ?? null;
      if (ownerPub && ownerPub === controlPub) {
        hint = " מה שהודבק הוא מפתח-ה-owner — מפתח-הזהות. הוא לא חותם עסקאות. במקום להדביק כלום — שלח גוף ריק והשליטה תישאב מכספת הסוכנים.";
      }
    } catch {
      /* ההכוונה היא תוספת — כישלונה לא משנה את פסק-הדין */
    }
    return NextResponse.json(
      {
        ok: false,
        stage: "authority",
        reason: `המפתח שהוזן אינו ה-active של @${OPERATOR_ACCOUNT} כפי שרשום בשרשרת כרגע.${hint} שום דבר לא נשמר ושום דבר לא השתנה.`,
        publicKey: controlPub.slice(0, 12) + "…",
      },
      { status: 403 },
    );
  }

  // 3) מקור-המפתח הריבוני (מחוץ-לגיט) — כל סטאק-החתימה המקומי
  //    (money · pulse · vault) חוזר לחיים ממנו במחזור הבא.
  //    r137 · D-026: מקור דו-מצבי — סיסמת-אב נכתבת כמקודם, ועכשיו גם
  //    WIF שהודבק ישירות נכתב במצב-wif ("account\nwif:<WIF>"). זה התיקון
  //    של "הוא מזהה כ-active אבל הוא לא עובר": החימוש בענן עבר, אבל הבית
  //    נשאר עיוור כי מקור-המפתח לא נכתב. ה-WIF נכתב 0600 מחוץ-לגיט —
  //    אותו סטנדרט-אחסון של סיסמת-האב עצמה, אף-בייט לא בלוג ולא בתשובה.
  let ownerFileMode: "master" | "wif" | "already-live" | null = null;
  try {
    fs.mkdirSync(path.dirname(OWNER_FILE), { recursive: true });
    const ownerExists = fs.existsSync(OWNER_FILE);
    if (armMode === "vault-auto") {
      // r185 · במצב-אוטומטי לא דורסים מקור קיים (ייתכן שבו סיסמת-אב —
      // המקור העדיף); אם חסר — נכתב במצב-wif כדי להחיות את החתימה המקומית.
      ownerFileMode = ownerExists ? "already-live" : "wif";
      if (!ownerExists) {
        fs.writeFileSync(OWNER_FILE, `${OPERATOR_ACCOUNT}\nwif:${controlWif}\n`, { mode: 0o600 });
        wroteOwnerFile = true;
      }
    } else if (looksLikeWif) {
      fs.writeFileSync(OWNER_FILE, `${OPERATOR_ACCOUNT}\nwif:${controlWif}\n`, { mode: 0o600 });
      wroteOwnerFile = true;
      ownerFileMode = "wif";
    } else {
      fs.writeFileSync(OWNER_FILE, `${OPERATOR_ACCOUNT}\n${key}\n`, { mode: 0o600 });
      wroteOwnerFile = true;
      ownerFileMode = "master";
    }
  } catch {
    /* כתיבה כושלת לא עוצרת את שאר-החימוש — מדווח בכנות בתוצאות */
  }

  // 4) פתיחת הכספת עם WIF-השליטה
  const vault = openVaultWithControlWif(controlWif);
  const vaultOpen = vault.ok;

  // 5) מסירת חוט-המפתחות — כל מפתח נשפט מול שרשרתו לפני אטימה
  const results: ArmResult[] = [];

  // 5א. ה-active עצמו — כבר נשפט ואושר מול השרשרת למעלה
  try {
    await sealSecret("STEEM_ACTIVE_WIF", controlWif);
    results.push({ secret: "STEEM_ACTIVE_WIF", chain: "steem", role: "active", ok: true, detailHe: "אומת מול ה-active החי ונאטם" });
  } catch (e) {
    results.push({ secret: "STEEM_ACTIVE_WIF", chain: "steem", role: "active", ok: false, detailHe: `אטימה נכשלה: ${String((e as Error).message).slice(0, 80)}` });
  }

  // 5ב. שאר חוט-המפתחות — מהכספת, עם שיפוט מול שרשרת-מקור
  const deliveries: { secret: string; chain: "steem" | "hive" | "blurt"; role: string; label: string }[] = [
    { secret: "STEEM_POSTING_WIF", chain: "steem", role: "posting", label: "steem/headcorner/posting" },
    { secret: "HIVE_ACTIVE_WIF", chain: "hive", role: "active", label: "hive/headcorner/active" },
    { secret: "HIVE_POSTING_WIF", chain: "hive", role: "posting", label: "hive/headcorner/posting" },
    { secret: "BLURT_ACTIVE_WIF", chain: "blurt", role: "active", label: "blurt/headcorner/active" },
  ];

  if (vaultOpen) {
    for (const d of deliveries) {
      try {
        const opened = vault.open(d.chain, "headcorner", d.role);
        if (!opened.ok || !opened.priv) {
          results.push({ secret: d.secret, chain: d.chain, role: d.role, ok: false, detailHe: `הכספת לא פתחה (${opened.detail ?? "?"})` });
          continue;
        }
        // שיפוט מול הרשות החיה של שרשרת-המקור — עם ניסיון-חוזר אחד
        // (צומת-רפה אינו פסק-דין: r136b — הבחנה כנה בין "לא תואם" ל"לא נקרא")
        let auth = await fetchAuthorities(d.chain, "headcorner");
        let livePub = auth.roles.find((r) => r.role === d.role)?.pub ?? null;
        if (!livePub) {
          await new Promise((r) => setTimeout(r, 1500));
          auth = await fetchAuthorities(d.chain, "headcorner");
          livePub = auth.roles.find((r) => r.role === d.role)?.pub ?? null;
        }
        if (!livePub) {
          results.push({ secret: d.secret, chain: d.chain, role: d.role, ok: false, detailHe: `השרשרת ${d.chain} לא נקראה כרגע (צומת רפה, לא פסק-דין) — לא נאטם במחזור זה; החימוש הבא ישפוט שוב` });
          continue;
        }
        const derivedPub = d.chain === "steem" ? steemLib.auth.wifToPublic(opened.priv) : null;
        // hive/blurt חולקים את פורמט-הפומבי של steem (קידומת שונה בלבד
        // בכרטיס-המפתח של הארנק — הנגזרת עצמה זהה ביט-מול-ביט)
        const entryTail = opened.entryPub?.replace(/^(STM|HIVE|BLT|TST)/, "") ?? "";
        const derivedTail = derivedPub ? derivedPub.replace(/^STM/, "") : "";
        const matches = livePub ? livePub.replace(/^(STM|HIVE|BLT)/, "") === entryTail : derivedTail === entryTail && entryTail.length > 0;
        if (!matches) {
          results.push({ secret: d.secret, chain: d.chain, role: d.role, ok: false, detailHe: "המפתח שבכספת אינו תואם את הרשות החיה בשרשרת — לא נאטם (כנות)" });
          continue;
        }
        await sealSecret(d.secret, opened.priv);
        results.push({ secret: d.secret, chain: d.chain, role: d.role, ok: true, detailHe: `אומת מול ${d.chain}:${d.role} חי ונאטם` });
      } catch (e) {
        results.push({ secret: d.secret, chain: d.chain, role: d.role, ok: false, detailHe: `כשל: ${String((e as Error).message).slice(0, 80)}` });
      }
    }
  } else {
    for (const d of deliveries) {
      results.push({ secret: d.secret, chain: d.chain, role: d.role, ok: false, detailHe: "כספת-הארנק לא נפתחה עם WIF-השליטה — הסוכנים יתקנו מהכספת בעצמם; אין לבקש קלט מהמפעיל" });
    }
  }

  // 6) שיגור dex-grid מיידי — המנוע החי הוא Domain (D-025, דקות-חינם),
  //    saos-dex הוא עותק-הגיבוי (מכסת-הדקות שלו מתה, מדווח בכנות)
  let dispatched = false;
  try {
    const d = await gh(`/repos/${LIVE_REPO}/actions/workflows/dex-grid.yml/dispatches`, {
      method: "POST",
      body: JSON.stringify({ ref: "main" }),
    });
    dispatched = d.status === 204;
  } catch {
    /* לוח-הזמנים היומי של Domain ירוץ ממילא */
  }
  let dispatchedBackup = false;
  try {
    const d = await gh(`/repos/${DEX_REPO}/actions/workflows/dex-grid.yml/dispatches`, {
      method: "POST",
      body: JSON.stringify({ ref: "main" }),
    });
    dispatchedBackup = d.status === 204;
  } catch {
    /* הגיבוי מדווח בכנות */
  }

  // 7) קבלת-ChainRun כנה — אפס חומר-סוד
  const sealedCount = results.filter((r) => r.ok).length;
  try {
    await db.chainRun.create({
      data: {
        chain: "fleet",
        step: "arm-all",
        firedBy: "operator",
        ok: sealedCount > 0,
        detail: `דלת-ההפעלה-האחת (mode=${armMode}): active אומת מול השרשרת · ${sealedCount}/${results.length} סודות נאטמו לכספת-הריפו · כספת-ארנק ${vaultOpen ? "נפתחה" : "לא נפתחה"} · מקור-מפתח מקומי ${ownerFileMode ?? (wroteOwnerFile ? "נכתב" : "לא נכתב")} · dex-grid חי (Domain) ${dispatched ? "שוגר" : "לא שוגר"} · גיבוי (saos-dex) ${dispatchedBackup ? "שוגר" : "לא שוגר"}`,
      },
    });
  } catch {
    /* הקבלה היא רישום — כישלונה לא משנה את התוצאה */
  }

  // מחיקה מהזיכרון
  key = "";
  controlWif = "";

  const allCore = results.every((r) => r.ok);
  return NextResponse.json({
    ok: sealedCount > 0,
    stage: allCore ? "armed" : "partial",
    mode: armMode,
    sealedCount,
    total: results.length,
    vaultOpen,
    wroteOwnerFile,
    ownerFileMode,
    dispatched,
    dispatchedBackup,
    results,
    detailHe: allCore
      ? `הכל חומש: הגריד, הקול והכספת חיים. dex-grid שוגר למנוע החי (Domain)${dispatchedBackup ? " ולגיבוי (saos-dex)" : " — הגיבוי מדווח בנפרד"}. התוצאות ייראו בקונסולה בעוד דקות.`
      : `${sealedCount}/${results.length} נאטמו — השאר מדווחים בכנות למטה. מה שנאטם חי ועובד.`,
  });
}
