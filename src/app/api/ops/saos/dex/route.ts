import { NextRequest, NextResponse } from "next/server";
import { fetchDexSnapshot, type SaosDexResponse } from "@/lib/steem/saos-dex";

export const dynamic = "force-dynamic";

/**
 * GET /api/ops/saos/dex?username=headcorner — the SAOS-1/STEEM DEX snapshot
 * (Task 31). The order book is a deterministic replay of the issuer's account
 * history: orders / cancels / fills on the feeless custom_json bus (id="saos",
 * protocol saos/v1) plus native STEEM escrow rails (transfers with saos:
 * memos). Solvency of the STEEM credit side is measured live against the
 * issuer's real balance. Server read-only, never throws, always 200.
 *
 * 117p8-R7 roast fix: a full replay scans up to 1400 issuer ops + 11 soldier
 * histories — measured 10–12s per call (daemon + UI poll it). A freshness-
 * aware server cache now holds the snapshot for TTL_HOT (45s). Between TTL_HOT
 * and TTL_STALE (10min) we serve the last snapshot instantly and refresh in
 * the background (stale-while-revalidate); beyond that we block on a fresh
 * replay. First cold call is unchanged (slow), every warm call is ~0ms.
 */
const TTL_HOT = 45_000;
const TTL_STALE = 10 * 60_000;

type CacheEntry = { at: number; data: SaosDexResponse; refreshing: boolean };
const g = globalThis as unknown as { __saosDexCache?: Map<string, CacheEntry> };
const cache: Map<string, CacheEntry> =
  g.__saosDexCache ?? (g.__saosDexCache = new Map());

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const username = (url.searchParams.get("username") ?? "headcorner").toLowerCase();
  const now = Date.now();
  const entry = cache.get(username);

  if (entry && now - entry.at < TTL_HOT) {
    return NextResponse.json(entry.data, { status: 200 });
  }

  if (entry && now - entry.at < TTL_STALE) {
    // stale-while-revalidate: answer instantly, refresh in the background
    if (!entry.refreshing) {
      entry.refreshing = true;
      fetchDexSnapshot(username)
        .then((data) => cache.set(username, { at: Date.now(), data, refreshing: false }))
        .catch(() => {
          const e2 = cache.get(username);
          if (e2) e2.refreshing = false;
        });
    }
    return NextResponse.json(entry.data, { status: 200 });
  }

  const snap = await fetchDexSnapshot(username);
  cache.set(username, { at: Date.now(), data: snap, refreshing: false });
  return NextResponse.json(snap, { status: 200 });
}
