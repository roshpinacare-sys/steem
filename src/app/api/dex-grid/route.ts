// ─────────────────────────────────────────────────────────────────────
// /api/dex-grid — חשיפת-הגריד-המתנגד לממשק (r193).
//
// GET בלבד: מסירת /status מהדיבון החי (127.0.0.1:3051) עם דדליין-3ש'.
// כישלון-חיבור = כנות-מלאה ({status:"offline"}) — הממשק רשאי להציג
// "לא-חי" בלי להיות אדום-שקרי (אותו-דפוס של /api/market-maker).
// ─────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GRID_URL = "http://127.0.0.1:3051";

export async function GET(req: NextRequest) {
  const sub = (new URL(req.url).searchParams.get("with") ?? "status").replace(/[^a-z]/g, "");
  const path = sub === "grid" ? "/grid" : sub === "pnl" ? "/pnl" : sub === "drill" ? "/drill" : sub === "ignite" ? "/ignite" : sub === "selftest" ? "/selftest" : "/status";
  try {
    const res = await fetch(`${GRID_URL}${path}`, {
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
