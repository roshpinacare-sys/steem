// ─────────────────────────────────────────────────────────────────────
// /api/economy — מנוע הכלכלה הריבונית (R98).
//
// הוראת המפעיל: "הבן את כל המכלול שבידינו נסה ליישם ככל הניתן או
// לפחות לתכנן ככל הניתן ריבונות שוק וכלכלה ריבונית אוטונומית...
// לבחון איך לטפל ולפתוח סתימות חסימות דימומים מה שנמצא חסום (ולמה)".
//
// GET  — התמונה המלאה: מרשם החסימות (עם שכבה חיה), מטריצת הזרימה,
//        יעילות העוגנים, מסלול הפג, קצב בניית ה-SBD ותוכנית ערבוב-הסוואפ
//        המוגדרת. ציבורי — האמת במדידה, לא בזיכרון.
// POST — חישוב תוכנית ערבוב-סוואפ לגודל מותאם (מדידה בלבד: הפרמטר
//        היחיד הוא גודל ההזנה; אין כאן שער-פעולה — המנוע מתכנן,
//        המפעיל חותם).
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { cacheHeader, swrGet } from "@/lib/live/swr";
import { composeEconomy, ECONOMY_SWR_KEY, ECONOMY_SWR_TTL_MS } from "@/lib/weave/economy";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    // fresh=1 — דילוג על המטמון (כפתור "מדידה מחדש" ב-UI)
    const fresh = new URL(req.url).searchParams.get("fresh") === "1";
    if (fresh) {
      const snap = await composeEconomy();
      return NextResponse.json({ ...snap, cached: false, stale: false, cacheAgeSec: 0, refreshing: false });
    }
    const { value, meta } = await swrGet(ECONOMY_SWR_KEY, ECONOMY_SWR_TTL_MS, () => composeEconomy());
    return NextResponse.json(
      {
        ...value,
        cached: meta.cached,
        stale: meta.stale,
        cacheAgeSec: meta.cacheAgeSec,
        refreshing: meta.refreshing,
      },
      { headers: { "X-SAOS-Cache": cacheHeader(meta) } },
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String((e as Error)?.message ?? e).slice(0, 160) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  let sizeSteem: number | undefined;
  try {
    const body = (await req.json()) as { sizeSteem?: unknown };
    const n = typeof body.sizeSteem === "number" ? body.sizeSteem : parseFloat(String(body.sizeSteem ?? ""));
    if (Number.isFinite(n) && n > 0) sizeSteem = Math.min(n, 100_000);
  } catch {
    /* בלי גוף — ברירת המחדל */
  }
  try {
    const snap = await composeEconomy(sizeSteem ?? 10);
    return NextResponse.json({ ...snap, cached: false, stale: false, cacheAgeSec: 0, refreshing: false });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String((e as Error)?.message ?? e).slice(0, 160) },
      { status: 500 },
    );
  }
}
