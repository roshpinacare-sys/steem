import { NextRequest, NextResponse } from "next/server";
import { fetchDexSnapshot } from "@/lib/steem/saos-dex";

export const dynamic = "force-dynamic";

/**
 * GET /api/ops/saos/dex?username=headcorner — the SAOS-1/STEEM DEX snapshot
 * (Task 31). The order book is a deterministic replay of the issuer's account
 * history: orders / cancels / fills on the feeless custom_json bus (id="saos",
 * protocol saos/v1) plus native STEEM escrow rails (transfers with saos:
 * memos). Solvency of the STEEM credit side is measured live against the
 * issuer's real balance. Server read-only, never throws, always 200.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const username = (url.searchParams.get("username") ?? "headcorner").toLowerCase();
  const snap = await fetchDexSnapshot(username);
  return NextResponse.json(snap, { status: 200 });
}
