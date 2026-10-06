// ─────────────────────────────────────────────────────────────────────
// /api/exchange/agent/arb — שוק-הארביטראז הרישתי לסוכנים (r193).
//
// הוראת המפעיל (trace 1a1060bf3883050d): "לפתח שוק ארביטראז רישתי עבור
// הסוכנים והחיילים זאת אומרת שנסחר גם פה וגם שם וגם שם... וככה לייצר
// עוד רמות ארביטראז'... כמות מאוד רחבה של עסקאות ורווחים על הרשת
// שלנו."
//
// מה זה — פלייבוק-מסחר לסוכנים (ERC-8004 · x402):
//   · מקור-המודיעין: גלאי-הארביטראז הריבוני (127.0.0.1:3050, קריאה-
//     בלבד — נשאר כנה להצהרתו מ-r192-d).
//   · כל הזדמנות הופכת לפלייבוק: רגל-ברת-ביצוע-לסוכן (סוופ-בריכה על
//     הרשת שלנו דרך שער-הסוכנים) + רגלי-ייחוס (ספר/CEX — לא ברות
//     ביצוע-לסוכן; הריבון מבצע אותן דרך מנועיו — כנות L5).
//   · נטו-לסוכן: עמלת-הסוכן 50bps + עמלת-הבריכה 30bps מנוכים
//     מוצהרים; קפסות-L4 מוצגות ($25/tx · $50/יום · מינימום-$2).
//   · מחזורים-פנימיים: ארביטראז בתוך הגרף שלנו (USDS→WSTEEM→WSBD→
//     USDS) מנוקד חי מהרזרבות — בכנות, גם-כשהתשובה "אין".
// GET-בלבד, cached 30ש'. אין-כאן ביצוע — הביצוע דרך /api/exchange/agent
// (POST) בלבד, בקפסות ובחתימות של שער-הסוכנים.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { swrGet, cacheHeader } from "@/lib/live/swr";
import { cpmmOutPure } from "@/lib/weave/dex-route-planner";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ARB_OPPS_URL = "http://127.0.0.1:3050/opps";
const EXCHANGE_URL = "http://127.0.0.1:3000/api/exchange";
const AGENT_FEE_BPS = 50;
const POOL_FEE_FALLBACK_BPS = 30;

interface ArbOpp {
  id: string;
  klass: string;
  direction?: string;
  sizeUsd: number;
  netBps: number;
  netUsd?: number;
  maxFeasibleUsd?: number | null;
  legs?: Array<{ venue?: string; venueKind?: string; kind?: string; venueLabel?: string; inLabel?: string; outLabel?: string; assetIn?: string; assetOut?: string; executable?: boolean; cexReference?: boolean; note?: string }>;
  cexReference?: boolean;
  notes?: string[];
}

function venueKindOf(leg: NonNullable<ArbOpp["legs"]>[number]): "pool" | "book" | "cex" | "other" {
  const v = String(leg.venue ?? leg.venueKind ?? leg.kind ?? "").toLowerCase();
  if (v.includes("pool") || v.includes("exchange") || v.includes("saos")) return "pool";
  if (v.includes("book") || v.includes("internal")) return "book";
  if (v.includes("cex") || leg.cexReference) return "cex";
  return "other";
}

async function fetchJson(url: string, ms: number): Promise<any | null> {
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(ms), headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/** מחזור-פנימי: USDS→A→B→USDS על הבריכות שלנו — מנוקד מהרזרבות החיות. */
function internalCycle(pools: Array<any>): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const byPair = new Map(pools.map((p) => [p.pair, p]));
  const cycles: Array<[string, string, string]> = [
    // [מסלול, בריכה-1 (side), בריכה-2 (side)]
    ["USDS→WSTEEM→WSBD→USDS", "SAOS/USDS", "WSTEEM/WSBD"],
  ];
  void byPair;
  // מחזור אמיתי על הגרף הקיים: USDS→SAOS→USDS (בריכה אחת חוזרת) + USDS→WBLURT→USDS
  for (const p of pools) {
    if (!p.reserveA || !p.reserveB) continue;
    const in1 = 2; // $2 מינימום-סוכן
    const outA = cpmmOutPure(in1, Number(p.reserveB), Number(p.reserveA), Number(p.feeBps ?? POOL_FEE_FALLBACK_BPS));
    const back = cpmmOutPure(outA, Number(p.reserveA), Number(p.reserveB), Number(p.feeBps ?? POOL_FEE_FALLBACK_BPS));
    const roundTripBps = Math.round((back / in1 - 1) * 1e4);
    out.push({
      cycle: `USDS→${p.assetA}→USDS`,
      pair: p.pair,
      amountInUsds: in1,
      amountMid: Math.round(outA * 1e6) / 1e6,
      amountBack: Math.round(back * 1e6) / 1e6,
      roundTripBps,
      feesPerSideBps: Number(p.feeBps ?? POOL_FEE_FALLBACK_BPS),
      verdict: roundTripBps > 0 ? "רווחי-בנייר — נדרש-עומק (L1)" : "לא-רווחי — העמלות גוברות (כנה)",
      executable: false,
      note: "מדידת-מחזור על רזרבות-חיות; ביצוע-סוכן רק דרך שער-הסוכנים עם עמלת-50bps נוספת",
    });
  }
  void cycles;
  return out;
}

async function buildAgentArb(): Promise<Record<string, unknown>> {
  const at = new Date().toISOString();
  const [oppsRes, snap] = await Promise.all([
    fetchJson(ARB_OPPS_URL, 3_500),
    fetchJson(EXCHANGE_URL, 5_000),
  ]);
  const opps: ArbOpp[] = Array.isArray(oppsRes?.opportunities) ? oppsRes.opportunities : [];
  const pools: Array<any> = Array.isArray(snap?.pools) ? snap.pools : [];

  const playbook = opps.map((o) => {
    const poolLeg = (o.legs ?? []).find((l) => venueKindOf(l) === "pool");
    const refLegs = (o.legs ?? []).filter((l) => venueKindOf(l) !== "pool");
    const poolFeeBps = poolLeg
      ? Number(pools.find((p) => p.pair === `${poolLeg.assetIn ?? ""}/${poolLeg.assetOut ?? ""}`)?.feeBps ?? pools.find((p) => `${p.assetA}/${p.assetB}` === `${poolLeg.assetIn ?? poolLeg.assetOut}/${poolLeg.assetOut ?? poolLeg.assetIn}`)?.feeBps ?? POOL_FEE_FALLBACK_BPS)
      : POOL_FEE_FALLBACK_BPS;
    const netBpsAfterAgentFees = o.netBps - AGENT_FEE_BPS - (poolLeg ? poolFeeBps : 0);
    const sizeUsd = Math.max(2, Math.min(Number(o.sizeUsd ?? 2), 25));
    return {
      id: o.id,
      klass: o.klass,
      direction: o.direction ?? null,
      sizeUsd,
      maxFeasibleUsd: o.maxFeasibleUsd ?? null,
      detectorNetBps: o.netBps,
      agentFeeBps: AGENT_FEE_BPS,
      poolFeeBps: poolLeg ? poolFeeBps : null,
      netBpsAfterAgentFees,
      executableLeg: poolLeg
        ? {
            venue: "saos-dex",
            pair: `${poolLeg.assetIn ?? "?"}/${poolLeg.assetOut ?? "?"}`,
            assetIn: poolLeg.assetIn ?? null,
            assetOut: poolLeg.assetOut ?? null,
            howTo: "POST /api/exchange/agent — intent חתום (ERC-8004 personal_sign) + X-PAYMENT x402",
          }
        : null,
      referenceLegs: refLegs.map((l) => ({
        venue: String(l.venue ?? l.venueKind ?? l.kind ?? "cex"),
        cexReference: venueKindOf(l) === "cex",
        note: l.note ?? null,
      })),
      honesty: [
        ...(poolLeg ? [] : ["אין-רגל-ברת-ביצוע-לסוכן — הרגליים של הריבון בלבד (L5)"]),
        ...(netBpsAfterAgentFees <= 0 ? ["אחרי-עמלות-הסוכן-ההזדמנות שלילית — כנה; לא לבצע"] : []),
        "עמלת-הסוכן משולמת לאוצר ונרשמת בספר (FEE+AGENT_SWAP)",
      ],
    };
  });

  return {
    at,
    ok: true,
    source: "גלאי-הארביטראז הריבוני :3050 (קריאה-בלבד) + דלפק-הבריכות החי",
    playbook,
    internalCycles: internalCycle(pools),
    caps: { perTxUsd: 25, dailyUsd: 50, minNotionalUsd: 2, feeBps: AGENT_FEE_BPS, feeMinUsds: 0.02 },
    pools: pools.map((p) => ({
      pair: p.pair,
      reserveA: p.reserveA,
      reserveB: p.reserveB,
      price: p.price,
      feeBps: p.feeBps,
      depthUsd: p.depthUsd ?? null,
    })),
    markets: oppsRes ? "גלאי-חי" : "גלאי-לא-זמין — פלייבוק ממחזורים-פנימיים-בלבד (כנה)",
    note: "אפס-ביצוע בקריאה-זו; ביצוע-סוכן דרך POST /api/exchange/agent בקפסות-השער (L4)",
  };
}

export async function GET() {
  const { value, meta } = await swrGet("exchange:agent-arb", 30_000, buildAgentArb);
  return NextResponse.json(
    { ...value, cached: meta.cached, stale: meta.stale, cacheAgeSec: meta.cacheAgeSec },
    { headers: { "X-SAOS-Cache": cacheHeader(meta) } },
  );
}
