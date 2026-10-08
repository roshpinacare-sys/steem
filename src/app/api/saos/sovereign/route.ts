import { NextResponse } from "next/server";
import { sovereignSnapshot, sovereignControl, SOVEREIGN_INTERVALS } from "@/lib/sovereign";
import { deDashDeep } from "@/lib/clean-dashes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * T-10 · שכבת-הריבונות-המתמשכת: נקודת-שליטה.
 * GET  → מצב-ה-watchdog/מחזורים/איכות + יומן-החלטות (self-arms אם לא עולה עדיין)
 * POST → { action } = kick-cycle | pause | resume | force-heal
 * המערכת דואגת לעצמה; כפתורים כאן הם ערוץ-התערבות, לא תנאי-הפעלה.
 */
export async function GET() {
  try {
    return NextResponse.json(deDashDeep({ ...sovereignSnapshot(), intervals: SOVEREIGN_INTERVALS }));
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { action?: string };
    if (!body?.action) {
      return NextResponse.json({ ok: false, error: "action required: kick-cycle | pause | resume | force-heal" }, { status: 400 });
    }
    return NextResponse.json(deDashDeep(sovereignControl(body.action)));
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, { status: 500 });
  }
}
