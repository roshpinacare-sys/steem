import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { fetchDexSnapshot } from "@/lib/steem/saos-dex";

export const dynamic = "force-dynamic";

/**
 * GET /api/ops/employment — תעסוקת-הצבא בתמונה-אחת (Task 49).
 *
 * מסילת-הדלק: 500 SP מוקצים מהאוצר (10×50) + הון-חוזר 0.3 STEEM (memo saos:fuel)
 * מסדר-התעסוקה: גל-escrow — כל חייל חותם בעצמו → קרדיט-DEX → SAOS → LP
 * סולם-גיוס-הון: מכירת ארנק-HE לתוך bids חיים → SWAP.HIVE
 *
 * כל הנתונים מקובצי-תוצאה של הרצות אמיתיות + סנפשוט-DEX חי מה-replay.
 * לעולם לא 500 — תמיד { ok:true } עם מה שיש.
 */

const AGENT_DIR = path.join(process.cwd(), "agent");
const ISSUER = (process.env.AGENT_ACCOUNT || "headcorner").toLowerCase();

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

export interface SoldierRow {
  username: string;
  credit: number;
  saos: number;
  lpShares: number | null;
  escrowMuster: number | null;
  escrowTxid: string | null;
  escrowToday: number;
}

export async function GET() {
  const [fuel, muster, ladder, liqState, dex] = await Promise.all([
    readAgentJson("fuel_result.json"),
    readAgentJson("muster_result.json"),
    readAgentJson("he_ladder_result.json"),
    readAgentJson("liq_state.json"),
    fetchDexSnapshot(ISSUER).catch(() => null),
  ]);

  // מצב-חיילים מה-replay החי
  const balances = new Map<string, { credit: number; saos: number }>();
  const lpBy = new Map<string, number>();
  let pool: Record<string, unknown> | null = null;
  if (dex && dex.ok) {
    for (const b of dex.balances ?? []) {
      if (b.account !== ISSUER) balances.set(b.account, { credit: b.credit ?? 0, saos: b.saos ?? 0 });
    }
    const poolRaw = (dex.pools ?? []).find((p) => p.pair === "SAOS:STEEM") ?? null;
    if (poolRaw) {
      pool = poolRaw as unknown as Record<string, unknown>;
      for (const lp of (poolRaw as { lp?: { account: string; shares: number }[] }).lp ?? []) {
        if (lp.account !== ISSUER) lpBy.set(lp.account, lp.shares);
      }
    }
  }

  const musterWaves = ((muster?.waves as { username: string; amt: number; txid?: string }[]) ?? []).filter(
    (w) => w && w.username,
  );
  const musterBy = new Map(musterWaves.map((w) => [w.username, w]));
  const escrowedBy = (liqState?.escrowedBySoldier as Record<string, { amt?: number; txid?: string }>) ?? {};

  const usernames = new Set<string>([
    ...((fuel?.soldiers as string[]) ?? []),
    ...musterWaves.map((w) => w.username),
    ...balances.keys(),
  ]);

  const soldiers: SoldierRow[] = [...usernames].map((u) => {
    const m = musterBy.get(u);
    const e = escrowedBy[u];
    const b = balances.get(u);
    return {
      username: u,
      credit: b?.credit ?? 0,
      saos: b?.saos ?? 0,
      lpShares: lpBy.has(u) ? (lpBy.get(u) as number) : null,
      escrowMuster: m ? m.amt : null,
      escrowTxid: m?.txid ?? e?.txid ?? null,
      escrowToday: e?.amt ?? 0,
    };
  });

  const funded = ((fuel?.soldiers as string[]) ?? []).length;
  const escrowed = musterWaves.filter((w) => w.txid).length;
  const withSaos = soldiers.filter((s) => s.saos > 0).length;
  const withLp = soldiers.filter((s) => (s.lpShares ?? 0) > 0).length;

  return NextResponse.json({
    ok: true,
    at: new Date().toISOString(),
    fuel: fuel
      ? {
          at: fuel.at,
          mode: fuel.mode,
          spPerSoldier: fuel.spPerSoldier,
          vestsPerSoldier: fuel.vestsPerSoldier,
          fuelSteem: fuel.fuelSteem,
          soldiers: funded,
          delegations: fuel.delegations,
          capital: fuel.capital,
          delegationConfirmed: fuel.delegationConfirmed,
        }
      : null,
    muster: muster
      ? {
          at: muster.at,
          mode: muster.mode,
          employment: muster.employment,
          employed: muster.employed,
          totalEscrow: muster.totalEscrow,
          waves: musterWaves,
        }
      : null,
    ladder: ladder
      ? {
          at: ladder.at,
          mode: ladder.mode,
          orders: ladder.orders ?? [],
          skip: ladder.skip ?? [],
          swapHiveBefore: ladder.swapHiveBefore ?? null,
          swapHiveAfter: ladder.swapHiveAfter ?? null,
          swapHiveDelta: ladder.swapHiveDelta ?? null,
          fills: ladder.fills ?? [],
        }
      : null,
    live: {
      soldiers,
      employedFleet: soldiers.length,
      escrowed,
      withSaos,
      withLp,
      pool,
      feeCaptureSeen: liqState?.feeCaptureSeen ?? 0,
      liqLastAction: liqState?.lastAction ?? null,
    },
    score: {
      funded,
      escrowed,
      withSaos,
      withLp,
      employmentPct: soldiers.length ? Math.round((escrowed / soldiers.length) * 100) : 0,
    },
  });
}
