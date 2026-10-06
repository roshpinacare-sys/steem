// ─────────────────────────────────────────────────────────────────────
// /api/gate — שער-העסקאות (R97 · TX-GATE).
//
// הוראת המפעיל: "מערכת אוטונומית לא צריכה שער מפעיל רק במקרים של
// עסקאות באמת גדולות 100$ ומעלה."
//
// GET  — תמונת-השער בגלוי: המדיניות, התור, ההכרעות האחרונות והמונים.
//        ציבורי — האמת במדידה, לא בזיכרון.
// POST — אישור/דחייה של פעולה מהתור. שער-מפעיל בלבד (סשן חתום,
//        הרשאה = השרשרת). ביצוע הפעולה עצמה נשאר בעורקים הקיימים
//        (/api/money וכו') — השער מכריע, העורק מבצע.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { operatorFromRequest } from "@/lib/operator-auth";
import { decideQueued, gateSnapshot, GATE_THRESHOLD_USD } from "@/lib/weave/tx-gate";
import { ownerKeyPresent } from "@/lib/owner-key";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  try {
    const snap = await gateSnapshot();
    return NextResponse.json({
      ok: true,
      ...snap,
      // r141 · אמת-בית: נוכחות-מפתח בוליאנית בלבד (אפס-חשיפת-סוד) —
      // הפתיח של השער נקשר למדידה במקום לטעון "המפתח חי בענן" גם כשהוא
      // חי בבית והסולם החי נחתם והוצב מכאן (נמדד 15:41 ו-16:27).
      house: { keyPresent: ownerKeyPresent() },
      doctrine: [
        `אוטונומיה מלאה מתחת ל-$${GATE_THRESHOLD_USD} — ברירת-המחדל של הרשת, לא החריג.`,
        `מ-$${GATE_THRESHOLD_USD} ומעלה — תור אישור מפעיל. שום כסף לא זז בלי החלטתו.`,
        "USD נמדד חי בזמן ההחלטה (בינאנס/CoinGecko) — לעולם לא מונח מראש.",
        "כל הכרעה נשמרת עם קבלה: מקור, פעולה, ערך, בסיס-הערכה ותוצאה.",
      ],
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String((e as Error)?.message ?? e).slice(0, 160) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const session = operatorFromRequest(req);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "שער-מפעיל בלבד — התחבר עם מפתח ה-active (השרשרת היא ההרשאה)" },
      { status: 401 },
    );
  }
  let body: { id?: unknown; decision?: unknown };
  try {
    body = (await req.json()) as { id?: unknown; decision?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "גוף הבקשה אינו JSON" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  const decision = body.decision === "approve" ? "approve" : body.decision === "reject" ? "reject" : null;
  if (!id || !decision) {
    return NextResponse.json({ ok: false, error: "נדרשים: id (מהתור) + decision (approve|reject)" }, { status: 400 });
  }
  try {
    const by = `operator:${session.pub.slice(0, 24)}`;
    const res = await decideQueued(id, decision, by);
    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          code: res.code,
          verdict: res.verdict,
          error: res.code === "NOT-FOUND" ? "הרשומה לא נמצאה" : "הרשומה אינה בתור (אולי כבר הוכרעה)",
        },
        { status: res.code === "NOT-FOUND" ? 404 : 409 },
      );
    }
    return NextResponse.json({
      ok: true,
      decision,
      record: res.record,
      he:
        decision === "approve"
          ? "אושרה על-ידי המפעיל — הפעולה תבוצע דרך העורק המוסמך (במפעיל או בדיבון במחזור הבא)"
          : "נדחתה על-ידי המפעיל — הכסף לא זז",
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String((e as Error)?.message ?? e).slice(0, 160) },
      { status: 500 },
    );
  }
}
