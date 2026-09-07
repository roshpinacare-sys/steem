import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { fetchDexSnapshot, type SaosDexResponse } from "@/lib/steem/saos-dex";

export const dynamic = "force-dynamic";

/**
 * GET /api/ops/liq — ממלכת-הנזילות בתמונה-אחת (Task 47).
 *
 * מאגד, מבלי להפיל לעולם:
 *  - ה-DEX הריבוני מה-replay (ספר, בריכות-AMM, מניות-LP, עמלות)
 *  - מצב-ניתוב-החיילים (liq_state.json) + מצב-MM (dex_mm_state.json)
 *  - ארנק Hive-Engine של האוצר + הצבא (אילו מטבעות-רשת אחרת ביד —
 *    מועמדים לצמדים/מכירה/מדרגה) — cache 5 דק'
 *  - מדרגת-הג׳נזיס (SWAP.HIVE→BEE→SAOS-HE) + מצב-הגשר (פריטה רשתות)
 */

const AGENT_DIR = path.join(process.cwd(), "agent");
const ISSUER = (process.env.AGENT_ACCOUNT || "headcorner").toLowerCase();

interface AgentJsonFile {
  ok?: boolean;
  error?: string;
  at?: string;
  [k: string]: unknown;
}

async function readAgentJson(name: string): Promise<AgentJsonFile | null> {
  try {
    return JSON.parse(await readFile(path.join(AGENT_DIR, name), "utf8")) as AgentJsonFile;
  } catch {
    return null;
  }
}

/* ── ארנק HE עם cache בזיכרון (5 דק') ─────────────────────────────── */
export interface HeTokenRow {
  account: string
  symbol: string
  balance: number
  stake: number
}
let heCache: { at: number; rows: HeTokenRow[] } | null = null;
async function heWallet(accounts: string[]): Promise<HeTokenRow[]> {
  if (heCache && Date.now() - heCache.at < 5 * 60 * 1000) return heCache.rows;
  const rows: HeTokenRow[] = [];
  const settled = await Promise.allSettled(
    accounts.map(async (account) => {
      const res = await fetch("https://api.hive-engine.com/rpc/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "find",
          params: { contract: "tokens", table: "balances", query: { account }, limit: 100, offset: 0, indexes: [] },
          id: 1,
        }),
        signal: AbortSignal.timeout(9000),
        cache: "no-store",
      });
      const j = (await res.json()) as { result?: { symbol: string; balance: string; stake: string }[] };
      return { account, tokens: j.result ?? [] };
    })
  );
  for (const s of settled) {
    if (s.status !== "fulfilled") continue;
    for (const t of s.value.tokens) {
      const balance = parseFloat(t.balance) || 0;
      const stake = parseFloat(t.stake) || 0;
      if (balance > 0 || stake > 0) {
        rows.push({ account: s.value.account, symbol: t.symbol, balance, stake });
      }
    }
  }
  heCache = { at: Date.now(), rows };
  return rows;
}

export async function GET() {
  const [dex, liqState, dexState, genesis, bridge, keyscan] = await Promise.all([
    fetchDexSnapshot(ISSUER).then((r: SaosDexResponse) => r).catch(() => null),
    readAgentJson("liq_state.json"),
    readAgentJson("dex_mm_state.json"),
    readAgentJson("he_genesis_result.json"),
    readAgentJson("bridge_state.json"),
    readAgentJson("keyscan_result.json"),
  ]);

  // חשבונות לארנק-HE: אוצר + חיילים מה-רוסטר של keyscan
  const armyNames: string[] = [];
  try {
    const accounts = (keyscan?.accounts as { chain: string; account: string }[] | undefined) ?? [];
    for (const a of accounts) if (a.chain === "steem" && a.account !== ISSUER && !armyNames.includes(a.account)) armyNames.push(a.account);
  } catch {
    /* degrade */
  }
  const heRows = await heWallet([ISSUER, ...armyNames.slice(0, 12)]);

  const pools = dex?.pools ?? [];
  const mainPool = pools.find((p) => p.pair === "SAOS:STEEM") ?? null;

  const ladder = {
    at: (genesis?.at as string) ?? null,
    bee: (genesis?.ladder as { bee?: { after?: number } } | undefined)?.bee?.after ?? null,
    swapHive: (genesis?.ladder as { swapHive?: { after?: number } } | undefined)?.swapHive?.after ?? null,
    token: (genesis?.token as { symbol?: string; created?: boolean } | undefined) ?? null,
  };
  const bridgeBrief = {
    at: (bridge?.lastCheckpointAt as string) ?? null,
    anchoredTotal: (bridge?.anchoredTotal as number) ?? null,
    lastTxid: (bridge?.lastTxid as string) ?? null,
  };

  return NextResponse.json({
    ok: true,
    fetchedAt: new Date().toISOString(),
    issuer: ISSUER,
    dex: dex
      ? {
          ok: dex.ok,
          error: dex.error,
          stats: dex.stats,
          mine: dex.mine,
          solvency: dex.solvency,
          book: dex.book,
          trades: dex.trades.slice(0, 12),
          balances: dex.balances.slice(0, 20),
          pools: dex.pools,
        }
      : null,
    routing: {
      at: (liqState?.day as string) ?? null,
      lastAction: (liqState?.lastAction as string) ?? null,
      escrowsToday: (liqState?.escrowsToday as number) ?? 0,
      escrowedBySoldier: (liqState?.escrowedBySoldier as Record<string, { amt?: number; txid?: string }>) ?? {},
      lpGranted: (liqState?.lpGranted as Record<string, number>) ?? {},
      arbsToday: (liqState?.arbsToday as number) ?? 0,
      lastArbAt: (liqState?.lastArbAt as string) ?? null,
      feeCaptureSeen: (liqState?.feeCaptureSeen as number) ?? 0,
    },
    mm: {
      day: (dexState?.day as string) ?? null,
      broadcastsToday: (dexState?.broadcastsToday as number) ?? 0,
      fillsToday: (dexState?.fillsToday as number) ?? 0,
      escrowedTotal: (dexState?.escrowedTotal as number) ?? 0,
      lastQuotes: (dexState?.lastQuotes as { askPrice?: number; bidPrice?: number } | null) ?? null,
    },
    ladder,
    bridge: bridgeBrief,
    heWallet: heRows,
    heSymbols: [...new Set(heRows.map((r) => r.symbol))],
    mainPool,
  });
}
