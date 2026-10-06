// ─────────────────────────────────────────────────────────────────────
// /api/market/cross — השוק הבין-רשתי (R94).
//
// הוראת המפעיל: "חשוב לבחון את האפשרות של מסחר בין blurt hive steem
// sbd וכו על השוק של סטים ולהרוויח מmarket maker grid".
//
// ה-API הזה הוא מדידה חיה חסרת-מפתחות בלבד: Steem פנימי + Hive פנימי
// + מחירים חיצוניים + סימולציית גריד על ההיסטוריה האמיתית. אין כאן
// שער-פעולה כלשהו — הפעולה נשארת במוביל הכסף (R81) מאחורי חוקיו,
// וצד-הקנייה מאחורי שער-מפעיל. TTL 60ש' — השוק איטי, הנשימה רגועה.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { composeCrossMarket } from "@/lib/weave/crossmarket";
import { swrGet, cacheHeader } from "@/lib/live/swr";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const { value, meta } = await swrGet("market:cross", 60_000, composeCrossMarket);
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
}
