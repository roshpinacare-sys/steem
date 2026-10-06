// ─────────────────────────────────────────────────────────────────────
// /api/money/pnl — כלכלת הגריד (R95).
//
// מדידת-האמת של שאלת המפעיל "להרוויח מmarket maker grid": כמה
// מילויים היו, אילו סבבים נסגרו, מה נלכד, ובאיזה משטר כלכלי הסולם
// חי. הסריקה העמוקה כבדה — SWR של 10 דק' מאחורי התשובה, וצ'קפוינט
// לקובץ הופך את הריצות הבאות לזולות (רק החדש).
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { swrGet, cacheHeader } from "@/lib/live/swr";
import { composeGridPnl } from "@/lib/weave/grid-pnl";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SWR_KEY = "money:grid-pnl";
const SWR_TTL_MS = 10 * 60_000;

export async function GET() {
  const { value, meta } = await swrGet(SWR_KEY, SWR_TTL_MS, composeGridPnl);
  return NextResponse.json(
    { ...value, cached: meta.cached, stale: meta.stale, cacheAgeSec: meta.cacheAgeSec, refreshing: meta.refreshing },
    { headers: { "X-SAOS-Cache": cacheHeader(meta) } },
  );
}
