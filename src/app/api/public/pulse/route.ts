// ─────────────────────────────────────────────────────────────────────
// /api/public/pulse — הפולס הציבורי של הרשת (r147-c, חזית domain-power)
//
// המסילה הציבורית של הבית: קריאה-בלבד, אפס סודות, אפס אימות — המספרים
// שכבר חיים במצב-הריבוני, בלי העשרה ובלי המצאה. הצרכנים:
//   · Domain/agents/public-pulse.cjs (ספרי public/pulse.json + about/team.json)
//   · כל סוכן/דף שצריך אמת מדודה בלי מפתחות
//
// חוק הקובץ: כל מספר נושא את זמן-המדידה שלו ואת המקור שלו. מה שלא
// נמדד — לא מופיע. כשל-מקור מסומן בכנות (measured:false / null),
// לעולם לא מומצא מחדש.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { bump, usageOf } from "@/lib/feed-metrics";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PnlApi = {
  ok?: boolean;
  at?: string;
  realized?: { measured?: boolean; capturedSbd?: number; capturedUsd?: number; trips?: number; fillsTotal?: number; lastFillAt?: string };
  unrealized?: { measured?: boolean; ordersOpen?: number; bidsOpenSbd?: number };
};
type MissionApi = {
  ok?: boolean;
  at?: string;
  mission?: { targetUsdPerDay?: number };
  measured?: { usdPerDay7dAvg?: number; daysRecorded?: number };
};
type AudienceDigest = { fetchedAt?: string; digest?: { runAt?: string; totals?: Record<string, number>; conversationSharePct?: number; topics?: Array<{ tag: string; externalVotes?: number }> } };
type ScoutDigest = { at?: string; seq?: number; week?: string; tracks?: Array<{ id: string; status: string; sources?: unknown[] }>; insights?: Array<{ id: string; text: string; numbers?: Record<string, unknown> }> };

async function fetchSelf(api: string, ms = 6000): Promise<Record<string, unknown> | null> {
  try {
    const base = process.env.HOME_API_BASE || "http://127.0.0.1:3000";
    const r = await fetch(base + api, { signal: AbortSignal.timeout(ms), cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function GET() {
  const at = new Date().toISOString();
  bump("public-pulse");

  const pnl = (await fetchSelf("/api/economy/pnl")) as unknown as PnlApi | null;
  const mission = (await fetchSelf("/api/mission")) as unknown as MissionApi | null;
  const gov = (await fetchSelf("/api/governance")) as { governance?: { chain?: { ok?: boolean; entries?: number; brokenAt?: string | null } } } | null;

  return NextResponse.json({
    ok: true,
    at,
    format: "public-pulse-feed-v1",
    usage: usageOf("public-pulse"),
    law: "read-only, no secrets, no fabrication: every number carries measuredAt + source; a failed source is reported honestly (null), never re-invented",
    pnl: {
      measured: !!pnl?.realized?.measured,
      realizedSbd: pnl?.realized?.capturedSbd ?? null,
      realizedUsd: pnl?.realized?.capturedUsd ?? null,
      trips: pnl?.realized?.trips ?? null,
      fillsTotal: pnl?.realized?.fillsTotal ?? null,
      lastFillAt: pnl?.realized?.lastFillAt ?? null,
      ordersOpen: pnl?.unrealized?.ordersOpen ?? null,
      measuredAt: pnl?.at ?? null,
      source: "GET /api/economy/pnl (FIFO over real fill_order ops, chain-indexed)",
    },
    mission: {
      targetUsdPerDay: mission?.mission?.targetUsdPerDay ?? null,
      usdPerDay7dAvg: mission?.measured?.usdPerDay7dAvg ?? null,
      daysRecorded: mission?.measured?.daysRecorded ?? null,
      measuredAt: mission?.at ?? null,
      source: "GET /api/mission (sovereign/income/daily-*.json)",
    },
    governance: {
      chainOk: gov?.governance?.chain?.ok ?? null,
      entries: gov?.governance?.chain?.entries ?? null,
      brokenAt: gov?.governance?.chain?.brokenAt ?? null,
      measuredAt: gov ? at : null,
      source: "GET /api/governance (hash-chained decision log)",
    },
    note: "audience + scout digests are composed into the Domain public books by Domain/agents/public-pulse.cjs from the repo books; this feed carries the home-side truth only",
  });
}
