import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * GET /api/ops/sovereign/microdex — Task 65: מיקרו-דקס חתום-חייל.
 *
 * הראיות החיות (כולן ממוסכות — אפס סודות):
 *  · microdex_state.json — ops חתומים-חייל (fill/order/pool_swap) עם txids
 *    ודגל-אימות get_transaction על צמתים-עצמאיים
 *  · fleet_state.json    — הצי החי (מי מקצקק)
 *  · agent-status.json   — לולאת microdex (25) מהדמון
 *  · dex snapshot מה-replay הרב-חשבוני — accountsScanned + extraOps
 *
 * לעולם לא 500 — תמיד 200 עם ok:true.
 */

const AGENT_DIR = path.join(process.cwd(), "agent");

interface AgentJson {
  [k: string]: unknown;
}

async function readAgentJson(name: string): Promise<AgentJson | null> {
  try {
    return JSON.parse(await readFile(path.join(AGENT_DIR, name), "utf8")) as AgentJson;
  } catch {
    return null;
  }
}

export interface MicrodexTx {
  at?: string;
  by?: string;
  why?: string;
  txid?: string | null;
  verified?: boolean;
}

export interface MicrodexResponse {
  ok: boolean;
  state: {
    day: string | null;
    beats: number;
    opsToday: number;
    bySoldier: Record<string, number>;
    txids: MicrodexTx[];
    verifiedCount: number;
    lastAt: string | null;
  };
  loop: {
    status: string | null;
    detail: string | null;
  } | null;
  fleetSize: number;
  replay: {
    accountsScanned: number;
    extraOps: number;
    openOrders: number;
    tradesTotal: number;
    poolSwaps: number;
  } | null;
  at: string;
}

export async function GET() {
  const [state, fleet, status] = await Promise.all([
    readAgentJson("microdex_state.json"),
    readAgentJson("fleet_state.json"),
    readAgentJson("agent-status.json"),
  ]);

  const txids = Array.isArray(state?.txids) ? (state.txids as MicrodexTx[]) : [];
  const loops = (status?.loops ?? null) as Record<string, { status?: string; detail?: string }> | null;
  const microdexLoop = loops && loops.microdex ? { status: loops.microdex.status ?? null, detail: loops.microdex.detail ?? null } : null;

  let replay: MicrodexResponse["replay"] = null;
  try {
    const res = await fetch("http://127.0.0.1:3000/api/ops/saos/dex?username=headcorner", { cache: "no-store" });
    const j = (await res.json()) as {
      accountsScanned?: string[];
      extraOps?: number;
      stats?: { openOrders?: number; tradesTotal?: number };
      pools?: { pair: string; swaps: number }[];
    };
    if (j && j.stats) {
      replay = {
        accountsScanned: (j.accountsScanned ?? []).length,
        extraOps: j.extraOps ?? 0,
        openOrders: j.stats.openOrders ?? 0,
        tradesTotal: j.stats.tradesTotal ?? 0,
        poolSwaps: (j.pools ?? []).find((p) => p.pair === "SAOS:STEEM")?.swaps ?? 0,
      };
    }
  } catch {
    /* replay not ready — the card degrades gracefully */
  }

  const body: MicrodexResponse = {
    ok: true,
    state: {
      day: (state?.day as string) ?? null,
      beats: (state?.beats as number) ?? 0,
      opsToday: (state?.opsToday as number) ?? 0,
      bySoldier: (state?.bySoldier as Record<string, number>) ?? {},
      txids: txids.slice(-10),
      verifiedCount: txids.filter((t) => t.verified).length,
      lastAt: (state?.lastAt as string) ?? null,
    },
    loop: microdexLoop,
    fleetSize: fleet ? Object.keys((fleet.seqBy as Record<string, number>) ?? {}).length : 0,
    replay,
    at: new Date().toISOString(),
  };
  return NextResponse.json(body, { status: 200 });
}
