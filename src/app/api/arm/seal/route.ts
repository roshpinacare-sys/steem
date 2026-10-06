// ─────────────────────────────────────────────────────────────────────
// /api/arm/seal — דלת-ההשבה של הסמכות · Custody-Return Door (r135 · תא-הפיקוד)
//
// פורט מ-Zip/src/app/api/arm/seal/route.ts — אותן חוקי-ברזל:
//   1. מגבלת-קצב (5 ניסיונות לשעה לכל IP — כמו /api/arm).
//   2. הסיסמה נבדקת מול ה-seal בזיכרון בלבד: scrypt(2^14) + aes-256-gcm.
//      GCM דוחה סיסמה שגויה מיד.
//   3. אימות-תוכן: format מזוהה · כתובות שוות למטא · מפתחות 64-hex.
//      אי-התאמה = 403 כנה, שום דבר לא נכתב.
//   4. התאמה = upsert של SealKey — בדיוק מה שהפעימה-בענן הייתה כותבת.
//   5. אפס חומר-סוד בלוג, בתשובה או בזיכרון-מחוץ-לתהליך.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { tryOpenEnvelope, persistWeaveKeys, persistHeadcorner, sealStatus } from "@/lib/seal";

export const dynamic = "force-dynamic";

// ── מגבלת-קצב זיכרונית (כמו /api/arm) ───────────────────────────────

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

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "local"
  );
}

// ── הדלת ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (rateLimited(ip)) {
    return NextResponse.json(
      { ok: false, error: "rate-limited", detail: "5 ניסיונות לשעה — החלון ייפתח מאוחר יותר (כמו /api/arm)" },
      { status: 429 },
    );
  }

  let passphrase = "";
  try {
    const body = (await req.json()) as { passphrase?: unknown };
    if (typeof body.passphrase === "string") passphrase = body.passphrase.trim();
  } catch {
    return NextResponse.json({ ok: false, error: "bad-body" }, { status: 400 });
  }
  if (passphrase.length < 4) {
    return NextResponse.json(
      { ok: false, error: "missing-passphrase", detail: "הסיסמה שבמשמרת המפוצלת (GitHub Secrets / .env.local / הכספת האישית של המפעיל)" },
      { status: 400 },
    );
  }

  // הסיסמה נבדקת מול שתי המעטפות (בזיכרון בלבד) — התאמה אחת מספיקה
  const weavePayload = tryOpenEnvelope("weave", passphrase);
  const hcPayload = weavePayload ? null : tryOpenEnvelope("headcorner", passphrase);

  if (!weavePayload && !hcPayload) {
    // GCM דוחה סיסמה שגויה מיד — כנות, בלי רמזים על התוכן
    return NextResponse.json(
      { ok: false, error: "passphrase-rejected", detail: "ה-seal לא נפתח — AEAD דחה את הסיסמה. שום דבר לא נכתב." },
      { status: 401 },
    );
  }

  if (weavePayload) {
    const persisted = await persistWeaveKeys(weavePayload);
    if (!persisted) {
      return NextResponse.json(
        { ok: false, error: "content-mismatch", detail: "התוכן נפתח אך אינו תואם את המטא — נדחה. שום דבר לא נכתב." },
        { status: 403 },
      );
    }
    const status = await sealStatus();
    return NextResponse.json({
      ok: true,
      which: "weave",
      networkAddress: weavePayload.networkAddress,
      at: new Date().toISOString(),
      status: { weave: status.weave, headcorner: status.headcorner },
      detailHe:
        "הסמכות הושבה: מפתח-הרשת ומפתח-הענן חיים ב-DB המקומי — אפס סודות בתשובה או בלוג. המפתחות עצמם מעולם לא הוחלפו (r72) — זו ההשבה של המשמרת שהייתה.",
    });
  }

  const hcPersisted = await persistHeadcorner(hcPayload!);
  if (!hcPersisted) {
    return NextResponse.json(
      { ok: false, error: "content-mismatch", detail: "התוכן נפתח אך אינו תואם את המטא — נדחה. שום דבר לא נכתב." },
      { status: 403 },
    );
  }
  const status = await sealStatus();
  return NextResponse.json({
    ok: true,
    which: "headcorner",
    fingerprint: hcPayload!.keyFingerprint ? hcPayload!.keyFingerprint.slice(0, 10) + "…" : "headcorner",
    at: new Date().toISOString(),
    status: { weave: status.weave, headcorner: status.headcorner },
    detailHe:
      "חותם-הראש נפתח: טביעת-האצבע של מפתח-הראש אומתה מול המעטפת (zero-rotation). אפס סודות בתשובה או בלוג.",
  });
}

export async function GET() {
  // תצוגת-מצב בלבד: האם הסמכות חיה — אפס סודות
  const status = await sealStatus();
  return NextResponse.json({
    ok: true,
    weave: status.weave,
    headcorner: status.headcorner,
    door: "POST /api/arm/seal {passphrase} — הצעד היחיד של המפעיל להשיב סמכות",
    noteHe: status.noteHe,
  });
}
