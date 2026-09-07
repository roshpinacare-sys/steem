import { NextResponse } from "next/server";
import { fetchCapabilitySnapshot } from "@/lib/steem/capabilities";

export const dynamic = "force-dynamic";

/**
 * GET /api/ops/capabilities — the live "hidden capability" probe (Task 27).
 * Chain pulse census + internal market + claim pool. Cached 120s server-side,
 * never 500 (per-field degradation via allSettled).
 */
let cache: { at: number; data: Awaited<ReturnType<typeof fetchCapabilitySnapshot>> } | null = null;
const TTL_MS = 120_000;

export async function GET() {
  try {
    if (cache && Date.now() - cache.at < TTL_MS) {
      return NextResponse.json({ ...cache.data, cached: true });
    }
    const data = await fetchCapabilitySnapshot();
    cache = { at: Date.now(), data };
    return NextResponse.json({ ...data, cached: false });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        fetchedAt: new Date().toISOString(),
        pulse: null,
        market: null,
        claimPool: null,
        dgp: null,
        errors: [String(e).slice(0, 200)],
      },
      { status: 200 },
    );
  }
}
