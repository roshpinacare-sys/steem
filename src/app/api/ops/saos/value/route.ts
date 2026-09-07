import { NextRequest, NextResponse } from "next/server";
import { getLiveAccount } from "@/lib/steem/steem-live";

export const dynamic = "force-dynamic";

/**
 * GET /api/ops/saos/value — the SAOS-1 value-derivation engine (Task 29).
 *
 * "כיצד נוכל להסיק ממנה ערך?" — answered with measurements: the token's
 * redemption promise is backed by the sovereign revenue engines already
 * measured on-chain (curation APR on effective SP, rental APR on own SP,
 * the claim drip). Backing per SAOS = committed share of annual engine
 * revenue ÷ live supply. Read-only, never 500.
 */

const COMMITMENT_PCT = 0.1; // policy: 10% of annual engine revenue backs redemption

export interface SaosValueResponse {
  ok: boolean
  error?: string
  username: string
  fetchedAt: string
  engine: {
    /** Curation APR × effective SP (measured 2.48-4.15% → midpoint). */
    curationUsdYear: number
    /** Rental APR 4.15% measured × own SP. */
    rentalUsdYear: number
    /** Claim drip extrapolated from the current pending balance. */
    dripUsdYear: number
    totalUsdYear: number
  } | null
  saos: {
    supply: number
    backingPerSaosUsd: number | null
    commitmentPct: number
  }
  notes: string[]
}

interface SaosOpRec {
  op: [string, Record<string, unknown>]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function saosSupply(issuer: string): Promise<number> {
  // Task 47 fix: walk ~12 pages (~1200 ops) — a single 100-op window misses
  // all mints on a high-volume account (wlog/bridge/acks flood the window),
  // which starved the MM of a supply reading and froze quoting.
  const RPCS = ["https://api.steemit.com", "https://api.justyy.com", "https://steemapi.boylikegirl.club"];
  const pages: [number, { op: [string, Record<string, unknown>] }][] = [];
  let start = -1;
  const seen = new Set<string>();
  for (let page = 0; page < 12; page++) {
    let win: [number, { op: [string, Record<string, unknown>] }][] | null = null;
    const settled = await Promise.allSettled(
      RPCS.map((u) =>
        fetch(u, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_account_history", params: [issuer, start, 100], id: 1 }),
          cache: "no-store",
        }).then((r) => r.json())
      )
    );
    let newestIdx = -1;
    for (const s of settled) {
      if (s.status !== "fulfilled") continue;
      const arr = (s.value as { result?: [number, { op: [string, Record<string, unknown>] }][] }).result;
      if (!Array.isArray(arr) || arr.length === 0) continue;
      const top = arr.reduce((m, [idx]) => Math.max(m, idx), -1);
      if (top > newestIdx) { newestIdx = top; win = arr; }
    }
    if (!win || win.length === 0) break;
    const key = `${win[0][0]}:${win[win.length - 1][0]}`;
    if (seen.has(key)) break;
    seen.add(key);
    for (const [idx, e] of win) if (!seen.has(String(idx))) { seen.add(String(idx)); pages.push([idx, e]); }
    const oldest = win[0][0];
    start = oldest - 1;
    if (oldest <= 1) break;
  }
  pages.sort((a, b) => a[0] - b[0]);
  let supply = 0;
  for (const [, entry] of pages) {
    const [type, value] = entry.op;
    if (type !== "custom_json" || value?.id !== "saos") continue;
    try {
      const p = JSON.parse(String(value.json ?? "{}")) as { protocol?: string; action?: string; amount?: number };
      if (p.protocol !== "saos/v1") continue;
      if (p.action === "mint") supply += Number(p.amount ?? 0);
      if (p.action === "burn") supply -= Number(p.amount ?? 0);
    } catch {
      /* ignore malformed */
    }
  }
  return round2(supply);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const username = (url.searchParams.get("username") ?? "headcorner").toLowerCase();

  const [liveR, supply] = await Promise.all([
    getLiveAccount(username).then((r) => (r.ok ? r : null)).catch(() => null),
    saosSupply(username),
  ]);

  if (!liveR) {
    const body: SaosValueResponse = {
      ok: false,
      error: "live account unavailable",
      username,
      fetchedAt: new Date().toISOString(),
      engine: null,
      saos: { supply, backingPerSaosUsd: null, commitmentPct: COMMITMENT_PCT },
      notes: [],
    };
    return NextResponse.json(body, { status: 200 });
  }

  const spUsd = (liveR.balances.spOwn + liveR.balances.spIn) * liveR.chain.steemUsd;
  const ownSpUsd = liveR.balances.spOwn * liveR.chain.steemUsd;
  const curationUsdYear = round2(spUsd * ((liveR.yield.curationApyLow + liveR.yield.curationApyHigh) / 2));
  const rentalUsdYear = round2(ownSpUsd * liveR.yield.rentalApr);
  // pending rewards refresh roughly weekly → extrapolate, honest estimate
  const dripUsdYear = round2(liveR.balances.pendingSbd * liveR.chain.sbdUsd * 52 + liveR.balances.pendingSteem * liveR.chain.steemUsd * 52);
  const totalUsdYear = round2(curationUsdYear + rentalUsdYear + dripUsdYear);

  const body: SaosValueResponse = {
    ok: true,
    username,
    fetchedAt: new Date().toISOString(),
    engine: { curationUsdYear, rentalUsdYear, dripUsdYear, totalUsdYear },
    saos: {
      supply,
      backingPerSaosUsd: supply > 0 ? round2((totalUsdYear * COMMITMENT_PCT) / supply) : null,
      commitmentPct: COMMITMENT_PCT,
    },
    notes: [
      "הגיבוי נמדד ממנועי-ההכנסה שכבר מדודים על השרשרת — לא הבטחה, חשבון",
      "מנגנון הפדיון נכנס לפעולה כשהסולם הריבוני מגיע לקומת נזילות (השכרה/קופת SPS)",
    ],
  };
  return NextResponse.json(body, { status: 200 });
}
