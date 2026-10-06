// ─────────────────────────────────────────────────────────────────────
// /api/market-maker — חשיפת-מנוע-הגריד לממשק (Task 2-b)
//
// GET בלבד: מסירת /status מהדיבון החי (127.0.0.1:3049) עם דדליין-3ש'.
// אפס-סודות: המצב והתצורה פומביים-מטבעם. כישלון-חיבור = כנות-מלאה
// ({status:"offline", reason}) עם HTTP 200 — הממשק רשאי להציג "לא-חי"
// בלי להיות אדום-שקרי.
// ─────────────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MM_URL = "http://127.0.0.1:3049/status";

export async function GET() {
  try {
    const res = await fetch(MM_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      return NextResponse.json(
        { status: "offline", reason: `הדיבון החזיר HTTP ${res.status}` },
        { headers: { "cache-control": "no-store" } },
      );
    }
    const j = await res.json();
    return NextResponse.json(j, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const reason = String((e as Error)?.message ?? e).slice(0, 140);
    return NextResponse.json(
      { status: "offline", reason },
      { headers: { "cache-control": "no-store" } },
    );
  }
}
