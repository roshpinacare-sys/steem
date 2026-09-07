import { NextResponse } from "next/server";
import { replayWeave, CHECKPOINT_EVERY } from "@/lib/weave";

export const dynamic = "force-dynamic";

/**
 * GET /api/weave/checkpoints — ציר-הצ'קפוינטים: חקירת-האימות המלאה.
 *
 * כל צ'קפוינט היסטורי — הגובה, שורש-המצב של הצומת, והאם ה-replay המתמטי
 * (ג'נזיס → ארכיון מלא על הקרנל) מניב בדיוק את אותו שורש.
 * זהו המקור של "אימות 24/33" — כאן הוא נפתח לרשימה, לא לתעלומה.
 */
export async function GET() {
  const rp = replayWeave();
  if (!rp.ok) {
    return NextResponse.json({ ok: false, why: rp.why ?? "replay-failed" });
  }
  return NextResponse.json({
    ok: true,
    checkpointEvery: CHECKPOINT_EVERY,
    height: rp.height ?? 0,
    summary: rp.cps ?? null,
    checkpoints: rp.cpsDetail ?? [],
  });
}
