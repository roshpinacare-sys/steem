// ─────────────────────────────────────────────────────────────────────
// /api/exchange/router — ראוטר ההחלפות החי (R96).
//
// הוראת המפעיל: "לעגן exchange של מטבעות אמיתיים על הרשת... לבדוק
// אופציות חיבור ראוטרים של dex מובילים במגוון רשתות... לאמת לבחון
// לאתגר."
//
// ה-API הזה הוא מדידה חיה חסרת-מפתחות בלבד: eth_call לחוזי הראוטרים
// האמיתיים ב-4 רשתות + סימוכין בינאנס + סולם תשואה מ-DefiLlama.
// אין כאן שער-פעולה כלשהו — חתימת עסקה דורשת מפתח = שער-מפעיל
// (חוק הברזל). TTL 60ש' — מספיק טרי לציטוט, עדין מספיק ל-RPC הציבורי.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { composeExchangeRouter } from "@/lib/weave/exchange-router";
import { swrGet, cacheHeader } from "@/lib/live/swr";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const { value, meta } = await swrGet("exchange:router", 60_000, composeExchangeRouter);
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
