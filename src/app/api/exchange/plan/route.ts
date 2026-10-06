// ─────────────────────────────────────────────────────────────────────
// /api/exchange/plan — ראוטר-העומק הריבוני (r193).
//
// GET ?from=WSTEEM&to=SBD&amountIn=2 — מתכנן-מסלולים רב-רגלי חי:
// בריכות + פגים + ספרים + פדיון, עם פיצול-מים לסכומים-גדולים.
// קריאה-בלבד: אין כאן ביצוע — הביצוע בשערים הקיימים (חוק L4).
// TTL 20ש' — מספיק טרי לעומק, עדין מספיק ל-RPC.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { planRoutes } from "@/lib/weave/dex-route-planner";
import { swrGet, cacheHeader } from "@/lib/live/swr";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const from = (url.searchParams.get("from") ?? "").toUpperCase().slice(0, 12);
  const to = (url.searchParams.get("to") ?? "").toUpperCase().slice(0, 12);
  const amountIn = Number(url.searchParams.get("amountIn") ?? 0);
  if (!from || !to) {
    return NextResponse.json(
      { ok: false, error: "חסר from/to — לדוגמה ?from=WSTEEM&to=SBD&amountIn=2" },
      { status: 400 },
    );
  }
  const key = `exchange:plan:${from}:${to}:${amountIn}`;
  const { value, meta } = await swrGet(key, 20_000, () => planRoutes(from, to, amountIn));
  return NextResponse.json(
    { ...value, cached: meta.cached, stale: meta.stale, cacheAgeSec: meta.cacheAgeSec },
    { headers: { "X-SAOS-Cache": cacheHeader(meta) } },
  );
}
