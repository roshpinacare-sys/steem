// ─────────────────────────────────────────────────────────────────────
// /api/live/dex — טרמינל הדקס מהענן (world.json המפורסם על-ידי dex-beat).
// אותה צורת-API כמו הדמון המקומי — החלפת מקור שקופה לתצוגה.
//
// לקח-R53 (נמדד): הגרסה הקודמת החזירה 502 כשהרשת נפלה אחרי פקיעת
// ה-TTL — למרות שעותק בן 30 שניות שכב ביד. מעתה SWR: עותק ישן מוגש
// מיד עם רענון-רקע single-flight; 502 רק בקור-אמיתי ללא שום עותק.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { swrGet, cacheHeader } from "@/lib/live/swr";

const WORLD_URL =
  "https://raw.githubusercontent.com/roshpinacare-sys/Console/main/dex/world.json";

export const dynamic = "force-dynamic";

const SWR_KEY = "api:live-dex";
const SWR_TTL_MS = 30_000;

export async function GET() {
  try {
    const { value, meta } = await swrGet(SWR_KEY, SWR_TTL_MS, fetchWorldBody);
    return new NextResponse(value, {
      headers: {
        "Content-Type": "application/json",
        "X-Live-Source": meta.cached ? (meta.stale ? "cache-stale" : "cache") : "cloud",
        "X-SAOS-Cache": cacheHeader(meta),
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? `מראת הדקס בענן לא נענתה: ${err.message}`
            : "מראת הדקס בענן לא נענתה",
      },
      { status: 502 },
    );
  }
}

/** הגוף הגולמי נשמר כמו שהוא — אפס פרסור-מחדש, העברה שקופה בייט-לבייט */
async function fetchWorldBody(): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(WORLD_URL, {
      signal: ctrl.signal,
      cache: "no-store",
      headers: { "User-Agent": "the-weave-live/1.0" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}
