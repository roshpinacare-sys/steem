// ─────────────────────────────────────────────────────────────────────
// /api/admin/arm-grid — דלת-חימום הגריד החוץ (R37 · r185-ריבוני).
//
// r185 · D-OP-01: אף אחד לא שואל את המפעיל דבר. POST בלי key שואב את
// STEEM_ACTIVE_WIF מכספת-הסוכנים (~/.sovereign/vault), משפט ביט-מול-ביט
// מול ה-active החי של @headcorner, ואוטם אל כספת-הריפו — אפס קלט.
// מסלול-ההדבקה (key מלא) נשמר לתאימות-API בלבד.
//
//   1. נדרש סשן-מפעיל חתום (כמו כל אזור האדמין).
//   2. המפתח (מהכספת או מהדבקה) נגזר ומאומת ביט-מול-ביט מול השרשרת —
//      מפתח שגוי לא נוגע בכלום.
//   3. המפתח נאטם (libsodium sealed-box מפתח-הציבור של הריפו) ישר
//      אל כספת הריפו — GitHub Actions Secrets. הוא לא נשמר בשום מקום
//      אחר, לא נכתב ללוג ולא חוזר בתשובה.
//
// GET  → מצב: האם הסוד קיים (שם בלבד) + המצב החי של הגריד מהקונסולה.
// POST → אימות → אטימה → אימות-קיום → עדות.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import steemLibRaw from "steem";
import {
  operatorFromRequest,
  OPERATOR_ACCOUNT,
  commanderActiveKey,
  activeWifFromVault,
} from "@/lib/operator-auth";
import { listRepoSecrets, putRepoSecret, getGridState } from "@/lib/live/grid-arm";
import { remoteWorkflowScheduleDesc } from "@/lib/live/workflow-schedule";

interface SteemAuth {
  auth: {
    wifToPublic(wif: string): string;
    toWif(account: string, password: string, role: string): string;
  };
}
const steemLib = steemLibRaw as unknown as SteemAuth;

export const dynamic = "force-dynamic";

const DEX_REPO = "saos-dex";
const SECRET_NAME = "STEEM_ACTIVE_WIF";

// ── מגבלת-קצה זיכרונית (בנפרד מה-login) ─────────────────────────────

const hits = new Map<string, number[]>();
const RATE_LIMIT = 8;
const RATE_WINDOW_MS = 60 * 60 * 1000;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (list.length >= RATE_LIMIT) return true;
  list.push(now);
  hits.set(ip, list);
  return false;
}

// ── GET: המצב (שם-הסוד בלבד — לעולם לא הערך) ────────────────────────

export async function GET(req: NextRequest) {
  if (!operatorFromRequest(req)) {
    return NextResponse.json(
      { ok: false, locked: true, error: "דלת החימום נעולה. התחבר עם מפתח המפעיל." },
      { status: 401 },
    );
  }
  const [secrets, grid, gridSchedule] = await Promise.all([
    listRepoSecrets(DEX_REPO).catch(() => null),
    getGridState(),
    remoteWorkflowScheduleDesc(DEX_REPO, "dex-grid.yml"),
  ]);
  const secret = secrets?.find((s) => s.name === SECRET_NAME) ?? null;
  return NextResponse.json({
    ok: true,
    repo: DEX_REPO,
    // r124 · חוק: כישלון-קריאה אינו “הסוד לא קיים” — null = לא נקרא, לא false
    secretPresent: secrets == null ? null : Boolean(secret),
    secretUpdatedAt: secret?.updatedAt ?? null,
    nextScheduledRun: gridSchedule != null ? `dex-grid · ${gridSchedule}` : null,
    grid: grid
      ? {
          armed: grid.armed,
          verdict: grid.verdict,
          blocker: grid.blocker ?? [],
          fuel: grid.fuel ?? null,
          inventory: grid.inventory ?? null,
          publishedAt: grid.publishedAt,
        }
      : null,
  });
}

// ── POST: אימות → אטימה → עדות ──────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!operatorFromRequest(req)) {
    return NextResponse.json(
      { ok: false, locked: true, error: "דלת החימום נעולה. התחבר עם מפתח המפעיל." },
      { status: 401 },
    );
  }
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
  try {
    const body = (await req.json().catch(() => ({}))) as { key?: unknown };
    key = typeof body.key === "string" ? body.key.trim() : "";
  } catch {
    key = "";
  }

  // גזירת WIF-האטימה — מהכספת (אוטומטי, r185) או מההדבקה (תאימות)
  let pub = "";
  let wifToSeal = "";
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
    try {
      pub = steemLib.auth.wifToPublic(wif);
      wifToSeal = wif;
    } catch {
      pub = "";
    }
    if (!pub || !wifToSeal) {
      return NextResponse.json(
        { ok: false, stage: "derive", reason: "המפתח שבכספת לא נגזר. שום דבר לא נשמר ושום דבר לא השתנה." },
        { status: 500 },
      );
    }
    armMode = "vault-auto";
  } else {
    if (key.length < 8 || key.length > 120) {
      return NextResponse.json(
        {
          ok: false,
          stage: "format",
          reason: "הקלט קצר מדי או ארוך מדי. צפה WIF (52 תווים המתחיל ב-5/K/L) או סיסמת-אב.",
        },
        { status: 400 },
      );
    }
    const looksLikeWif = /^[5KL][1-9A-HJ-NP-Za-km-z]{39,59}$/.test(key);
    const attempts: Array<"wif" | "password"> = looksLikeWif ? ["wif"] : ["wif", "password"];
    for (const mode of attempts) {
      try {
        const wif = mode === "wif" ? key : steemLib.auth.toWif(OPERATOR_ACCOUNT, key, "active");
        pub = steemLib.auth.wifToPublic(wif);
        if (pub) {
          wifToSeal = wif;
          break;
        }
      } catch {
        pub = "";
      }
    }
    if (!pub || !wifToSeal) {
      return NextResponse.json(
        {
          ok: false,
          stage: "derive",
          reason: "לא הצלחתי לגזור מפתח-ציבורי מהקלט. שום דבר לא נשמר ושום דבר לא השתנה.",
        },
        { status: 400 },
      );
    }
  }

  // 2) הרשות החיה מהשרשרת — ביט מול ביט
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
            ? `המפתח שבכספת אינו ה-active החי של @${OPERATOR_ACCOUNT} — נדחה fail-closed. הסוכנים יתקנו את הכספת, לא המפעיל.`
            : `המפתח שהוזן אינו ה-active של @${OPERATOR_ACCOUNT} כפי שרשום בשרשרת כרגע. שום דבר לא נשמר ושום דבר לא השתנה.`,
        publicKey: pub.slice(0, 12) + "…",
      },
      { status: 403 },
    );
  }

  // 3) אטימה אל כספת-הריפו — היעד היחיד שבו המפתח יתקיים מרגע זה
  try {
    await putRepoSecret(DEX_REPO, SECRET_NAME, wifToSeal);
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        stage: "seal",
        reason: `האטימה אל כספת הריפו נכשלה (${String((e as Error).message).slice(0, 80)}). המפתח לא נשמר בשום מקום.`,
      },
      { status: 502 },
    );
  }

  // 4) עדות — הסוד קיים בכספת, עם חותמת-זמן
  let evidence: { updatedAt: string } | null = null;
  try {
    const list = await listRepoSecrets(DEX_REPO);
    const found = list.find((s) => s.name === SECRET_NAME);
    if (!found) throw new Error("secret-not-visible-after-put");
    evidence = { updatedAt: found.updatedAt };
  } catch {
    // ה-PUT הצליח אך הרשימה לא אישרה — דוח כנה על מה שידוע
    evidence = null;
  }

  // מחיקה מיידית מהזיכרון — המפתח חי רק בכספת המוצפנת של הריפו
  key = "";
  wifToSeal = "";

  // R122 · חוק הקדנס (r121): "מתי הגריד רץ" נקרא מה-workflow של saos-dex
  // בפועל (דרך ה-API של גיטהאב) — לא מהזיכרון. שליפה שנכשלה = null כנה,
  // לא מספר-זיכרון שהתיישן.
  const gridSchedule = await remoteWorkflowScheduleDesc(DEX_REPO, "dex-grid.yml");

  return NextResponse.json({
    ok: true,
    stage: "armed",
    mode: armMode,
    repo: DEX_REPO,
    secret: SECRET_NAME,
    secretUpdatedAt: evidence?.updatedAt ?? null,
    verifiedAgainst: `chain:active@${OPERATOR_ACCOUNT}`,
    publicKey: pub,
    nextScheduledRun: gridSchedule != null ? `dex-grid · ${gridSchedule}` : null,
    note:
      gridSchedule != null
        ? "המפתח נאטם בכספת המוצפנת של הריפו ורק ה-Actions שלו יכולים לפתוח. ההזנקה הידנית זמינה במרכז הפיקוד."
        : "המפתח נאטם בכספת הריפו — אך לוח-הזמנים של dex-grid לא נקרא מהענן ברגע זה (בלי טענת-זיכרון); ההזנקה הידנית זמינה במרכז הפיקוד.",
  });
}
